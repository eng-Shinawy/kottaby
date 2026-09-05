/**
 * NotificationEngine — EMIT surface tests (Task 2.6; the inbox surface is
 * Task 2.7's `notification-engine.inbox.test.ts`).
 *
 * Per `backend/db/test/AGENTS.md` + `backend/services/AGENTS.md`:
 *  - 4-Tier mixed suite. DB-bound cases run inside `runInRollback`; `tx` is
 *    passed to EVERY service call that accepts one. The OWN-COMMIT tier
 *    (publish-after-commit + idempotency receipt store REQUIRE a durable
 *    commit — `runInRollback` can never prove them) runs against committed
 *    fixtures with reverse-order tracked teardown and zero-residue
 *    assertions (the journey-layer pattern, scoped to this file).
 *  - All rejection assertions use try/catch helpers (`expectRepoError`) —
 *    `expect(...).rejects.toThrow()` appears nowhere.
 *  - The fan-out transport is SPIED (`SpiedFanoutTransport` from the journey
 *    helpers) or scripted to fail; the idempotency claim cache is an
 *    in-memory double injected through the engine's options seam — no Redis,
 *    no WebSocket frames, ever.
 *  - Domain-degradation logs are captured via a `logger.logDomainError` spy
 *    (silenced + counted), restored with `mockRestore`.
 *
 * Coverage map:
 *  - Tier 1 (branch/stmt): validation branch matrix (pre-DB, fail-closed);
 *    single + batch happy paths on BOTH transaction paths; receipt shape +
 *    verbatim copy round-trip; duplicate-key suppression (pre-seeded prior
 *    receipt AND end-to-end own-commit replay); publishReceipts per-receipt
 *    publishing.
 *  - Tier 2 (boundary): title lengths 0/1/255/256; entityRef half-pairs;
 *    idempotencyKey 128/129; claim-key recipe (determinism, order
 *    insensitivity, cohort sensitivity, hex-only digest); TTL pin (24h).
 *  - Tier 3 (chaos/degradation): forced outer-tx rollback → ZERO rows AND
 *    ZERO publishes; cache outage fail-open (claim/get/store) persists +
 *    warns; publish-failure post-commit swallowed-with-log (own-commit AND
 *    publishReceipts, incl. per-receipt isolation); no-cache fail-open.
 *  - Tier 4 (security/hostile): positive-safe-int guard matrix; hostile
 *    titles (RTL/emoji/SQL-wildcards) stored verbatim; hostile idempotency
 *    keys (hashed, never stored raw); corrupt stored receipts fail open;
 *    BOPLA smuggled-field probe (extra input fields ignored).
 */

import { afterAll, beforeAll, describe, expect, spyOn, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { count, eq, or } from "drizzle-orm";
import { db } from "@/backend/db";
import { notifications } from "@/backend/db/schema/notifications";
import { users } from "@/backend/db/schema/users/users";
import { createTestUser } from "@/backend/db/test/entity-setup";
import { expectRepoError, runInRollback } from "@/backend/db/test/test-utils";
import { NotificationType } from "@/backend/enum/notifications/notification-type.enum";
import { resetEnvironmentCache } from "@/backend/lib/env";
import { ValidationError } from "@/backend/lib/errors";
import { type DomainErrorContext, logger } from "@/backend/lib/logger";
import {
  buildEmitClaimKey,
  NOTIFICATION_EMIT_CLAIM_TTL_SECONDS,
  type NotificationIdempotencyClaimCache,
  parseStoredEmitReceipt,
  serializeEmitReceipt,
} from "@/backend/services/notifications/emit-idempotency";
import { isPositiveSafeInt } from "@/backend/services/notifications/emit-validation";
import { NotificationEngine } from "@/backend/services/notifications/notification-engine.service";
import type {
  DBTransaction,
  NotificationDeliveryReceipt,
  NotificationEmitBatchInput,
  NotificationEmitInput,
  NotificationReturnType,
  UserSelectType,
} from "@/backend/types";
import { getServerTranslations } from "@/shared/locale/server-graphql";
import { SpiedFanoutTransport } from "@/test/workflows/helpers";

/** English translated generic validation copy — never hardcoded English. */
const EN_VALIDATION = getServerTranslations("en").errorsTranslations.validation;

/** A user id that cannot exist (positive safe int far beyond any sequence). */
const NONEXISTENT_USER_ID = 2_000_000_000;

/** Fixed idempotency-key fixture for the claim/replay cases. */
const CLAIM_KEY_FIXTURE = "emit-claim-fixture-key";

/** Executor union for direct inbox-count oracle reads (tx OR the db handle). */
type NotificationExecutor = DBTransaction | typeof db;

/** Independent read-back oracle — direct Drizzle count, not via the engine. */
async function countNotificationsFor(executor: NotificationExecutor, userId: number): Promise<number> {
  const [row] = await executor.select({ value: count() }).from(notifications).where(eq(notifications.userId, userId));
  return row?.value ?? 0;
}

/** First row of a receipt — throws when the receipt is unexpectedly empty. */
function firstRow(receipt: NotificationDeliveryReceipt): NotificationReturnType {
  const row = receipt.notifications.at(0);
  if (!row) {
    throw new Error("expected the receipt to carry at least one row");
  }
  return row;
}

/** Second row of a receipt — throws when the batch is unexpectedly short. */
function secondRow(receipt: NotificationDeliveryReceipt): NotificationReturnType {
  const row = receipt.notifications.at(1);
  if (!row) {
    throw new Error("expected the receipt to carry a second row");
  }
  return row;
}

/**
 * Narrows the union emit result to a delivery receipt (J1's structural
 * narrowing — `emitForUser` own-commit returns the row, every other path a
 * receipt).
 */
function receiptOf(result: NotificationReturnType | NotificationDeliveryReceipt): NotificationDeliveryReceipt {
  if ("notifications" in result) {
    return result;
  }
  throw new Error("expected a delivery receipt, but the emit returned a bare row");
}

/** Builds a valid single-recipient emit input (unique title per call). */
function singleInput(userId: number, overrides: Partial<NotificationEmitInput> = {}): NotificationEmitInput {
  return {
    userId,
    type: NotificationType.SessionRequest,
    title: `emit-${randomUUID()}`,
    body: "A student requested a session",
    relatedEntityType: "session",
    relatedEntityId: 4242,
    ...overrides,
  };
}

/** Builds a valid batch emit input (unique title per call). */
function batchInput(
  userIds: readonly number[],
  overrides: Partial<NotificationEmitBatchInput> = {}
): NotificationEmitBatchInput {
  return {
    userIds,
    type: NotificationType.SystemBroadcast,
    title: `broadcast-${randomUUID()}`,
    body: null,
    relatedEntityType: null,
    relatedEntityId: null,
    ...overrides,
  };
}

/** One realistic stored row for pre-seeded duplicate-replay cases. */
function storedRow(userId: number, notificationId: number): NotificationReturnType {
  return {
    id: notificationId,
    userId,
    type: NotificationType.SystemBroadcast,
    title: "prior emission row",
    body: null,
    isRead: false,
    relatedEntityType: null,
    relatedEntityId: null,
    createdAt: new Date("2026-01-15T08:30:00.000Z"),
  };
}

/** A realistic stored receipt for pre-seeded duplicate-replay cases. */
function makeStoredReceipt(userId: number, notificationId: number): NotificationDeliveryReceipt {
  return { notifications: [storedRow(userId, notificationId)], recipientUserIds: [userId] };
}

/**
 * Scripted claim-cache double mirroring SET-NX-EX semantics with real
 * held-key tracking (the J2 journey double's in-memory shape, plus call
 * recording): the first claim for a key wins, later claims for the same key
 * report held, `preHeldKeys` lets a test simulate an externally-claimed key,
 * and every operation can be toggled into an outage — while recording every
 * claim key + TTL for the recipe pins.
 */
class ScriptedClaimCache implements NotificationIdempotencyClaimCache {
  claimThrows = false;
  getThrows = false;
  storeThrows = false;
  /** Keys pre-marked as held (simulates an already-claimed emission). */
  readonly preHeldKeys = new Set<string>();
  /** Backing store — pre-seed for duplicate replays; `store()` writes here. */
  readonly stored = new Map<string, string>();
  readonly claimKeys: string[] = [];
  readonly claimTtls: number[] = [];
  private readonly heldKeys = new Set<string>();

  async claim(key: string, ttlSeconds: number): Promise<boolean> {
    if (this.claimThrows) {
      throw new Error("scripted claim outage");
    }
    this.claimKeys.push(key);
    this.claimTtls.push(ttlSeconds);
    if (this.heldKeys.has(key) || this.preHeldKeys.has(key)) {
      return false;
    }
    this.heldKeys.add(key);
    return true;
  }

  async get(key: string): Promise<string | null> {
    if (this.getThrows) {
      throw new Error("scripted get outage");
    }
    return this.stored.get(key) ?? null;
  }

  async store(key: string, value: string, _ttlSeconds: number): Promise<void> {
    if (this.storeThrows) {
      throw new Error("scripted store outage");
    }
    this.stored.set(key, value);
  }
}

/** Fan-out transport that fails EVERY publish (post-commit outage analogue). */
class FailingFanoutTransport {
  readonly publishAttempts: number[] = [];

  async publishFanout(): Promise<void> {
    this.publishAttempts.push(this.publishAttempts.length);
    throw new Error("forced fan-out outage");
  }
}

/** Fan-out transport that fails ONLY the first publish, then delivers. */
class FailFirstFanoutTransport {
  readonly deliveredUserIds: number[] = [];
  private failedOnce = false;

  async publishFanout(userIds: readonly number[]): Promise<void> {
    if (!this.failedOnce) {
      this.failedOnce = true;
      throw new Error("first publish fails");
    }
    this.deliveredUserIds.push(...userIds);
  }
}

/**
 * Installs a recording stub over `logger.logDomainError`: domain logs never
 * reach test stdout AND every call's code/entity pair becomes assertable.
 * Callers MUST `spy.mockRestore()` (try/finally).
 */
function recordDomainLogs(): { spy: ReturnType<typeof spyOn>; entries: Array<{ code: string; entity: string }> } {
  const entries: Array<{ code: string; entity: string }> = [];
  const spy = spyOn(logger, "logDomainError").mockImplementation((_message: string, ctx?: DomainErrorContext) => {
    entries.push({ code: ctx?.code ?? "MISSING_CODE", entity: ctx?.entity ?? "MISSING_ENTITY" });
  });
  return { spy, entries };
}

// ─── Tier 1: validation branch matrix (pre-DB, fail-closed) ──────────────────

describe("NotificationEngine.emitForUser — validation matrix (fail-closed BEFORE any DB access)", () => {
  const transportSpy = new SpiedFanoutTransport();

  const INVALID_SINGLE_INPUTS: readonly NotificationEmitInput[] = [
    singleInput(0),
    singleInput(-7),
    singleInput(1.5),
    singleInput(Number.NaN),
    singleInput(2 ** 53),
    singleInput(NONEXISTENT_USER_ID, { title: "" }),
    singleInput(NONEXISTENT_USER_ID, { title: "   " }),
    singleInput(NONEXISTENT_USER_ID, { title: "x".repeat(256) }),
    singleInput(NONEXISTENT_USER_ID, { relatedEntityType: "session", relatedEntityId: null }),
    singleInput(NONEXISTENT_USER_ID, { relatedEntityType: null, relatedEntityId: 4242 }),
    singleInput(NONEXISTENT_USER_ID, { relatedEntityType: "e".repeat(101), relatedEntityId: 4242 }),
    singleInput(NONEXISTENT_USER_ID, { relatedEntityType: "session", relatedEntityId: 0 }),
    singleInput(NONEXISTENT_USER_ID, { idempotencyKey: "" }),
    singleInput(NONEXISTENT_USER_ID, { idempotencyKey: "   " }),
    singleInput(NONEXISTENT_USER_ID, { idempotencyKey: "k".repeat(129) }),
  ];

  test("every invalid single-emit input rejects with the translated generic ValidationError", async () => {
    const errors = await Promise.all(
      INVALID_SINGLE_INPUTS.map(input =>
        expectRepoError(() => NotificationEngine.emitForUser(input, "en", undefined, { transport: transportSpy }))
      )
    );

    expect(errors).toHaveLength(INVALID_SINGLE_INPUTS.length);
    for (const error of errors) {
      expect(error).toBeInstanceOf(ValidationError);
      expect(error.message).toBe(EN_VALIDATION);
      if (error instanceof ValidationError) {
        expect(error.code).toBe("VALIDATION");
      }
    }
  });

  test("an invalid input never reaches the database (a nonexistent recipient would surface an FK error instead)", async () => {
    // The recipient id below is valid, but the input is not: if validation ran
    // AFTER the DB access, the FK-violation path would fire — a ValidationError
    // proves the guard rejected the input first.
    const error = await expectRepoError(() =>
      NotificationEngine.emitForUser(singleInput(NONEXISTENT_USER_ID, { title: "" }), "en", undefined, {
        transport: transportSpy,
      })
    );
    expect(error).toBeInstanceOf(ValidationError);

    // The transport was never touched either (no publish for a rejected input).
    expect(transportSpy.publishCount).toBe(0);
  });
});

describe("NotificationEngine.emitForUsers — validation matrix (fail-closed BEFORE any DB access)", () => {
  const transportSpy = new SpiedFanoutTransport();

  const INVALID_BATCH_INPUTS: readonly NotificationEmitBatchInput[] = [
    batchInput([], { title: "empty cohort" }),
    batchInput([0]),
    batchInput([NONEXISTENT_USER_ID, -3]),
    batchInput([NONEXISTENT_USER_ID, 2.5]),
    batchInput([NONEXISTENT_USER_ID, NONEXISTENT_USER_ID]),
    batchInput([NONEXISTENT_USER_ID], { title: "x".repeat(256) }),
    batchInput([NONEXISTENT_USER_ID], { relatedEntityType: "session", relatedEntityId: null }),
    batchInput([NONEXISTENT_USER_ID], { idempotencyKey: "k".repeat(129) }),
  ];

  test("every invalid batch input rejects with the translated generic ValidationError", async () => {
    const errors = await Promise.all(
      INVALID_BATCH_INPUTS.map(input =>
        expectRepoError(() => NotificationEngine.emitForUsers(input, "en", undefined, { transport: transportSpy }))
      )
    );

    expect(errors).toHaveLength(INVALID_BATCH_INPUTS.length);
    for (const error of errors) {
      expect(error).toBeInstanceOf(ValidationError);
      expect(error.message).toBe(EN_VALIDATION);
    }
  });
});

// ─── Tier 1 + 2 + 4: caller-transaction path (runInRollback) ─────────────────

describe("NotificationEngine.emitForUser — caller-transaction path (receipt without publish)", () => {
  test("inserts inside the caller's tx and returns a receipt WITHOUT publishing", async () => {
    await runInRollback(async tx => {
      const recipient = await createTestUser(tx);
      const transportSpy = new SpiedFanoutTransport();
      const input = singleInput(recipient.id);

      const result = await NotificationEngine.emitForUser(input, "en", tx, { transport: transportSpy });
      const receipt = receiptOf(result);

      expect(receipt.recipientUserIds).toEqual([recipient.id]);
      expect(receipt.notifications).toHaveLength(1);
      const row = firstRow(receipt);
      // Verbatim copy (REQ-015/028) + full row shape + read-latch default.
      expect(row.userId).toBe(recipient.id);
      expect(row.type).toBe(NotificationType.SessionRequest);
      expect(row.title).toBe(input.title);
      expect(row.body).toBe(input.body);
      expect(row.relatedEntityType).toBe(input.relatedEntityType);
      expect(row.relatedEntityId).toBe(input.relatedEntityId);
      expect(row.isRead).toBe(false);
      expect(row.createdAt).toBeInstanceOf(Date);

      // The row is visible inside the caller's (rolled-back) unit…
      expect(await countNotificationsFor(tx, recipient.id)).toBe(1);
      // …and NOTHING was published for uncommitted rows (REQ-042).
      expect(transportSpy.publishCount).toBe(0);
    });
  });

  test("boundary titles: 1-char and 255-char copy round-trips verbatim (incl. RTL/emoji)", async () => {
    await runInRollback(async tx => {
      const recipient = await createTestUser(tx);
      const transportSpy = new SpiedFanoutTransport();
      const oneChar = "ى";
      const twoFiftyFive = `${"لا".repeat(80)}ق${"🎉".repeat(47)}`.slice(0, 255);

      const oneCharResult = await NotificationEngine.emitForUser(
        singleInput(recipient.id, { title: oneChar }),
        "en",
        tx,
        {
          transport: transportSpy,
        }
      );
      const longResult = await NotificationEngine.emitForUser(
        singleInput(recipient.id, { title: twoFiftyFive }),
        "en",
        tx,
        { transport: transportSpy }
      );

      expect(firstRow(receiptOf(oneCharResult)).title).toBe(oneChar);
      expect(firstRow(receiptOf(longResult)).title).toBe(twoFiftyFive);
      expect(twoFiftyFive).toHaveLength(255);
      expect(await countNotificationsFor(tx, recipient.id)).toBe(2);
      expect(transportSpy.publishCount).toBe(0);
    });
  });

  test("hostile title content (RTL override, SQL wildcard/injection shapes) is stored verbatim, inert", async () => {
    await runInRollback(async tx => {
      const recipient = await createTestUser(tx);
      const transportSpy = new SpiedFanoutTransport();
      const hostileTitle = "\u202E%s_' OR 1=1; -- DROP TABLE notifications;--\u202C";

      const result = await NotificationEngine.emitForUser(
        singleInput(recipient.id, { title: hostileTitle }),
        "en",
        tx,
        {
          transport: transportSpy,
        }
      );

      expect(firstRow(receiptOf(result)).title).toBe(hostileTitle);
      expect(await countNotificationsFor(tx, recipient.id)).toBe(1);
    });
  });

  test("BOPLA probe: smuggled extra input fields are ignored (field-by-field whitelist mapping)", async () => {
    await runInRollback(async tx => {
      const recipient = await createTestUser(tx);
      const transportSpy = new SpiedFanoutTransport();
      const smuggled: NotificationEmitInput & { readonly smuggledField: string } = {
        ...singleInput(recipient.id),
        smuggledField: "must never reach the insert",
      };

      const result = await NotificationEngine.emitForUser(smuggled, "en", tx, { transport: transportSpy });

      // The insert succeeded with exactly the whitelisted columns — an extra
      // input property has no landing spot in the field-by-field mapping.
      expect(await countNotificationsFor(tx, recipient.id)).toBe(1);
      const row = firstRow(receiptOf(result));
      expect(row.title).toBe(smuggled.title);
      expect(row.type).toBe(smuggled.type);
      expect(transportSpy.publishCount).toBe(0);
    });
  });
});

describe("NotificationEngine.emitForUsers — caller-transaction path (batch)", () => {
  test("inserts one row per recipient in ONE batch (shared createdAt) and returns the receipt WITHOUT publishing", async () => {
    await runInRollback(async tx => {
      const recipientA = await createTestUser(tx);
      const recipientB = await createTestUser(tx);
      const transportSpy = new SpiedFanoutTransport();
      const input = batchInput([recipientA.id, recipientB.id]);

      const receipt = await NotificationEngine.emitForUsers(input, "en", tx, { transport: transportSpy });

      expect(receipt.recipientUserIds).toEqual([recipientA.id, recipientB.id]);
      expect(receipt.notifications).toHaveLength(2);
      // Input order preserved — row i belongs to recipient i.
      expect(firstRow(receipt).userId).toBe(recipientA.id);
      expect(secondRow(receipt).userId).toBe(recipientB.id);
      // ONE `now` per batch (REQ-047): sibling rows share the instant exactly.
      expect(secondRow(receipt).createdAt.getTime()).toBe(firstRow(receipt).createdAt.getTime());
      expect(firstRow(receipt).isRead).toBe(false);

      expect(await countNotificationsFor(tx, recipientA.id)).toBe(1);
      expect(await countNotificationsFor(tx, recipientB.id)).toBe(1);
      // ONE batch, ZERO per-recipient publishes on the caller-tx path.
      expect(transportSpy.publishCount).toBe(0);
    });
  });
});

// ─── Tier 2: idempotency claim-key recipe + window ──────────────────────────

describe("emit claim-key recipe (buildEmitClaimKey)", () => {
  test("is deterministic, order-insensitive across the recipient set, and cohort-sensitive", () => {
    const key = "cohort-event-key";

    const ab = buildEmitClaimKey([11, 22], NotificationType.SystemBroadcast, key);
    const ba = buildEmitClaimKey([22, 11], NotificationType.SystemBroadcast, key);
    const abc = buildEmitClaimKey([11, 22, 33], NotificationType.SystemBroadcast, key);
    const otherType = buildEmitClaimKey([11, 22], NotificationType.SessionRequest, key);
    const otherKey = buildEmitClaimKey([11, 22], NotificationType.SystemBroadcast, `${key}-2`);

    expect(ab).toBe(ba);
    expect(ab).not.toBe(abc);
    expect(ab).not.toBe(otherType);
    expect(ab).not.toBe(otherKey);
  });

  test("digest is hex-only and never carries the raw key or recipient ids", () => {
    const rawKey = "super-secret-raw-key-🤫";
    const digest = buildEmitClaimKey([42], NotificationType.PaymentConfirmation, rawKey);

    expect(digest.startsWith("notif:emit:")).toBe(true);
    expect(digest).toMatch(/^notif:emit:[a-f0-9]{64}$/);
    expect(digest.includes(rawKey)).toBe(false);
    expect(digest.includes("42")).toBe(false);
  });
});

// ─── Tier 1 + 3 + 4: idempotency behavior on the caller-tx path ──────────────

describe("emit idempotency — claim, duplicate, outage (fail-open, deviation D5)", () => {
  test("a keyed emit claims BEFORE the insert with the 24h window", async () => {
    await runInRollback(async tx => {
      const recipient = await createTestUser(tx);
      const transportSpy = new SpiedFanoutTransport();
      const cache = new ScriptedClaimCache();

      await NotificationEngine.emitForUser(singleInput(recipient.id, { idempotencyKey: CLAIM_KEY_FIXTURE }), "en", tx, {
        transport: transportSpy,
        cache,
      });

      expect(cache.claimTtls).toEqual([NOTIFICATION_EMIT_CLAIM_TTL_SECONDS]);
      expect(cache.claimTtls.at(0)).toBe(86_400);
      expect(cache.claimKeys).toEqual([
        buildEmitClaimKey([recipient.id], NotificationType.SessionRequest, CLAIM_KEY_FIXTURE),
      ]);
      expect(await countNotificationsFor(tx, recipient.id)).toBe(1);
    });
  });

  test("a replayable duplicate returns the PRIOR receipt with NO insert and NO publish", async () => {
    await runInRollback(async tx => {
      const recipient = await createTestUser(tx);
      const transportSpy = new SpiedFanoutTransport();
      const cache = new ScriptedClaimCache();
      const prior = makeStoredReceipt(recipient.id, 90210);
      const expectedKey = buildEmitClaimKey([recipient.id], NotificationType.SessionRequest, CLAIM_KEY_FIXTURE);
      cache.preHeldKeys.add(expectedKey);
      cache.stored.set(expectedKey, serializeEmitReceipt(prior));

      const result = await NotificationEngine.emitForUser(
        singleInput(recipient.id, { idempotencyKey: CLAIM_KEY_FIXTURE }),
        "en",
        tx,
        { transport: transportSpy, cache }
      );

      // The PRIOR receipt comes back — same row id, Dates revived.
      expect(result).toEqual(prior);
      expect(result).not.toBe(prior);
      expect(firstRow(receiptOf(result)).createdAt).toBeInstanceOf(Date);

      // NO insert, NO publish (REQ-016).
      expect(await countNotificationsFor(tx, recipient.id)).toBe(0);
      expect(transportSpy.publishCount).toBe(0);
    });
  });

  test("a duplicate batch replay returns the prior receipt with NO new rows", async () => {
    await runInRollback(async tx => {
      const recipientA = await createTestUser(tx);
      const recipientB = await createTestUser(tx);
      const transportSpy = new SpiedFanoutTransport();
      const cache = new ScriptedClaimCache();
      const prior: NotificationDeliveryReceipt = {
        notifications: [storedRow(recipientA.id, 1001), storedRow(recipientB.id, 1002)],
        recipientUserIds: [recipientA.id, recipientB.id],
      };
      const batchClaimKey = buildEmitClaimKey(
        [recipientA.id, recipientB.id],
        NotificationType.SystemBroadcast,
        CLAIM_KEY_FIXTURE
      );
      cache.preHeldKeys.add(batchClaimKey);
      cache.stored.set(batchClaimKey, serializeEmitReceipt(prior));

      const replay = await NotificationEngine.emitForUsers(
        batchInput([recipientA.id, recipientB.id], { idempotencyKey: CLAIM_KEY_FIXTURE }),
        "en",
        tx,
        { transport: transportSpy, cache }
      );

      expect(replay).toEqual(prior);
      expect(await countNotificationsFor(tx, recipientA.id)).toBe(0);
      expect(await countNotificationsFor(tx, recipientB.id)).toBe(0);
      expect(transportSpy.publishCount).toBe(0);
    });
  });

  test("a claim cache OUTAGE fails OPEN: the row still persists, with one structured warn", async () => {
    await runInRollback(async tx => {
      const recipient = await createTestUser(tx);
      const transportSpy = new SpiedFanoutTransport();
      const cache = new ScriptedClaimCache();
      cache.claimThrows = true;
      const logs = recordDomainLogs();

      try {
        const result = await NotificationEngine.emitForUser(
          singleInput(recipient.id, { idempotencyKey: CLAIM_KEY_FIXTURE }),
          "en",
          tx,
          { transport: transportSpy, cache }
        );

        expect(await countNotificationsFor(tx, recipient.id)).toBe(1);
        expect(receiptOf(result).notifications).toHaveLength(1);
        expect(logs.entries).toEqual([{ code: "NOTIFICATION_IDEMPOTENCY_DEGRADED", entity: "notifications" }]);
      } finally {
        logs.spy.mockRestore();
      }
    });
  });

  test("a keyed emit with NO cache injected fails OPEN with one structured warn", async () => {
    await runInRollback(async tx => {
      const recipient = await createTestUser(tx);
      const transportSpy = new SpiedFanoutTransport();
      const logs = recordDomainLogs();

      try {
        await NotificationEngine.emitForUser(
          singleInput(recipient.id, { idempotencyKey: CLAIM_KEY_FIXTURE }),
          "en",
          tx,
          {
            transport: transportSpy,
          }
        );

        expect(await countNotificationsFor(tx, recipient.id)).toBe(1);
        expect(logs.entries).toEqual([{ code: "NOTIFICATION_IDEMPOTENCY_DEGRADED", entity: "notifications" }]);
      } finally {
        logs.spy.mockRestore();
      }
    });
  });

  test("a held claim whose receipt cannot be READ (get outage) fails OPEN and inserts", async () => {
    await runInRollback(async tx => {
      const recipient = await createTestUser(tx);
      const transportSpy = new SpiedFanoutTransport();
      const cache = new ScriptedClaimCache();
      cache.preHeldKeys.add(buildEmitClaimKey([recipient.id], NotificationType.SessionRequest, CLAIM_KEY_FIXTURE));
      cache.getThrows = true;
      const logs = recordDomainLogs();

      try {
        await NotificationEngine.emitForUser(
          singleInput(recipient.id, { idempotencyKey: CLAIM_KEY_FIXTURE }),
          "en",
          tx,
          {
            transport: transportSpy,
            cache,
          }
        );

        expect(await countNotificationsFor(tx, recipient.id)).toBe(1);
        expect(logs.entries).toEqual([{ code: "NOTIFICATION_IDEMPOTENCY_DEGRADED", entity: "notifications" }]);
      } finally {
        logs.spy.mockRestore();
      }
    });
  });

  test("a held claim with NOTHING stored yet (first emission still in flight) fails OPEN and inserts", async () => {
    await runInRollback(async tx => {
      const recipient = await createTestUser(tx);
      const transportSpy = new SpiedFanoutTransport();
      const cache = new ScriptedClaimCache();
      cache.preHeldKeys.add(buildEmitClaimKey([recipient.id], NotificationType.SessionRequest, CLAIM_KEY_FIXTURE));
      const logs = recordDomainLogs();

      try {
        await NotificationEngine.emitForUser(
          singleInput(recipient.id, { idempotencyKey: CLAIM_KEY_FIXTURE }),
          "en",
          tx,
          {
            transport: transportSpy,
            cache,
          }
        );

        expect(await countNotificationsFor(tx, recipient.id)).toBe(1);
        expect(logs.entries).toEqual([{ code: "NOTIFICATION_IDEMPOTENCY_DEGRADED", entity: "notifications" }]);
      } finally {
        logs.spy.mockRestore();
      }
    });
  });
});

// ─── Tier 4: corrupt stored receipts fail open ───────────────────────────────

/** One structurally valid stored row (corruptible per case by mutation). */
function baseStoredRow(): Record<string, unknown> {
  return {
    id: 501,
    userId: 7,
    type: "system_broadcast",
    title: "stored row",
    body: null,
    isRead: false,
    relatedEntityType: null,
    relatedEntityId: null,
    createdAt: "2026-01-15T08:30:00.000Z",
  };
}

/** Serializes one receipt-shaped JSON value around (optionally corrupted) rows. */
function storedReceiptJson(rowCorruption?: (row: Record<string, unknown>) => void, envelope?: string): string {
  if (envelope !== undefined) {
    return envelope;
  }
  const row = baseStoredRow();
  rowCorruption?.(row);
  return JSON.stringify({ notifications: [row], recipientUserIds: [7] });
}

describe("emit idempotency — corrupt stored receipts fail open (never crash)", () => {
  const CORRUPT_STORED_VALUES: readonly string[] = [
    storedReceiptJson(undefined, "{not json"),
    storedReceiptJson(undefined, "null"),
    storedReceiptJson(undefined, "42"),
    storedReceiptJson(undefined, '"a string"'),
    storedReceiptJson(undefined, "{}"),
    storedReceiptJson(undefined, '{"notifications":[{}]}'),
    storedReceiptJson(undefined, '{"notifications":[],"recipientUserIds":[]}'),
    storedReceiptJson(row => {
      row.id = "501";
    }),
    storedReceiptJson(row => {
      row.type = "bogus_type";
    }),
    storedReceiptJson(row => {
      row.createdAt = "not-a-date";
    }),
    storedReceiptJson(row => {
      delete row.title;
    }),
    storedReceiptJson(undefined, '{"notifications":[{"id":501}],"recipientUserIds":["7"]}'),
  ];

  test("every corrupt stored value degrades to fail-open: insert + ONE warn, no publish", async () => {
    async function runCorruptCase(index: number): Promise<void> {
      const corrupt = CORRUPT_STORED_VALUES.at(index);
      if (corrupt === undefined) {
        return;
      }
      await runInRollback(async tx => {
        const recipient = await createTestUser(tx);
        const transportSpy = new SpiedFanoutTransport();
        const cache = new ScriptedClaimCache();
        const corruptClaimKey = buildEmitClaimKey([recipient.id], NotificationType.SessionRequest, CLAIM_KEY_FIXTURE);
        cache.preHeldKeys.add(corruptClaimKey);
        cache.stored.set(corruptClaimKey, corrupt);
        const logs = recordDomainLogs();

        try {
          const result = await NotificationEngine.emitForUser(
            singleInput(recipient.id, { idempotencyKey: CLAIM_KEY_FIXTURE }),
            "en",
            tx,
            { transport: transportSpy, cache }
          );

          expect(await countNotificationsFor(tx, recipient.id), `corrupt case #${index}`).toBe(1);
          expect(receiptOf(result).notifications, `corrupt case #${index}`).toHaveLength(1);
          expect(transportSpy.publishCount, `corrupt case #${index}`).toBe(0);
          expect(logs.entries, `corrupt case #${index}`).toEqual([
            { code: "NOTIFICATION_IDEMPOTENCY_DEGRADED", entity: "notifications" },
          ]);
        } finally {
          logs.spy.mockRestore();
        }
      });
      await runCorruptCase(index + 1);
    }

    await runCorruptCase(0);
  });
});

// ─── Tier 3: forced outer-tx rollback — zero rows AND zero publishes ─────────

describe("forced outer-transaction rollback — ghost pushes are impossible (REQ-042)", () => {
  test("single emit inside a rolled-back outer tx leaves ZERO rows and ZERO publishes", async () => {
    const transportSpy = new SpiedFanoutTransport();
    const uniqueTitle = `rollback-single-${randomUUID()}`;

    await runInRollback(async tx => {
      const recipient = await createTestUser(tx);
      const result = await NotificationEngine.emitForUser(singleInput(recipient.id, { title: uniqueTitle }), "en", tx, {
        transport: transportSpy,
      });

      // Inside the unit: the row exists, nothing was published.
      expect(receiptOf(result).notifications).toHaveLength(1);
      expect(await countNotificationsFor(tx, recipient.id)).toBe(1);
      expect(transportSpy.publishCount).toBe(0);
    });

    // runInRollback ALWAYS rolls back: the row never escaped the unit…
    const survivors = await db.select().from(notifications).where(eq(notifications.title, uniqueTitle));
    expect(survivors).toHaveLength(0);
    // …and nothing was EVER published for it (ghost push impossible).
    expect(transportSpy.publishCount).toBe(0);
  });

  test("batch emit inside a rolled-back outer tx leaves ZERO rows and ZERO publishes", async () => {
    const transportSpy = new SpiedFanoutTransport();
    const uniqueTitle = `rollback-batch-${randomUUID()}`;

    await runInRollback(async tx => {
      const recipientA = await createTestUser(tx);
      const recipientB = await createTestUser(tx);
      const receipt = await NotificationEngine.emitForUsers(
        batchInput([recipientA.id, recipientB.id], { title: uniqueTitle }),
        "en",
        tx,
        { transport: transportSpy }
      );

      expect(receipt.notifications).toHaveLength(2);
      expect(await countNotificationsFor(tx, recipientA.id)).toBe(1);
      expect(await countNotificationsFor(tx, recipientB.id)).toBe(1);
      expect(transportSpy.publishCount).toBe(0);
    });

    const survivors = await db.select().from(notifications).where(eq(notifications.title, uniqueTitle));
    expect(survivors).toHaveLength(0);
    expect(transportSpy.publishCount).toBe(0);
  });
});

// ─── Tier 1 + 3: publishReceipts — the post-commit publisher ─────────────────

describe("NotificationEngine.publishReceipts — post-commit publisher", () => {
  test("publishes ONE fan-out PER receipt, in order, each carrying its full recipient list", async () => {
    await runInRollback(async tx => {
      const recipientA = await createTestUser(tx);
      const recipientB = await createTestUser(tx);
      const transportSpy = new SpiedFanoutTransport();

      const receiptA = await NotificationEngine.emitForUsers(batchInput([recipientA.id]), "en", tx, {
        transport: transportSpy,
      });
      const receiptB = await NotificationEngine.emitForUsers(batchInput([recipientB.id]), "en", tx, {
        transport: transportSpy,
      });
      expect(transportSpy.publishCount).toBe(0); // caller-tx emits never publish

      await NotificationEngine.publishReceipts([receiptA, receiptB], "en", { transport: transportSpy });

      expect(transportSpy.publishCount).toBe(2);
      const firstPublish = transportSpy.calls.at(0);
      const secondPublish = transportSpy.calls.at(1);
      if (!firstPublish || !secondPublish) {
        throw new Error("expected two recorded publishes");
      }
      expect(firstPublish.userIds).toEqual([recipientA.id]);
      expect(secondPublish.userIds).toEqual([recipientB.id]);

      // Payload = the receipt's representative first row, field-by-field.
      const representativeRow = firstRow(receiptA);
      expect(firstPublish.payload.v).toBe(1);
      expect(firstPublish.payload.kind).toBe("notification");
      expect(firstPublish.payload.data.id).toBe(representativeRow.id);
      expect(firstPublish.payload.data.type).toBe(representativeRow.type);
      expect(firstPublish.payload.data.title).toBe(representativeRow.title);
      expect(firstPublish.payload.data.body).toBe(representativeRow.body);
      expect(firstPublish.payload.data.relatedEntityType).toBe(representativeRow.relatedEntityType);
      expect(firstPublish.payload.data.relatedEntityId).toBe(representativeRow.relatedEntityId);
      expect(firstPublish.payload.data.createdAt).toEqual(representativeRow.createdAt);
      // No account identifier rides the payload (REQ-021).
      expect(Object.hasOwn(firstPublish.payload.data, "userId")).toBe(false);
    });
  });

  test("an empty receipts array is a documented no-op", async () => {
    const transportSpy = new SpiedFanoutTransport();

    await NotificationEngine.publishReceipts([], "en", { transport: transportSpy });

    expect(transportSpy.publishCount).toBe(0);
  });

  test("a degenerate receipt with zero rows is skipped without publishing", async () => {
    const transportSpy = new SpiedFanoutTransport();
    const degenerate: NotificationDeliveryReceipt = { notifications: [], recipientUserIds: [] };

    await NotificationEngine.publishReceipts([degenerate], "en", { transport: transportSpy });

    expect(transportSpy.publishCount).toBe(0);
  });

  test("a failing transport is swallowed WITH a degradation log per receipt (REQ-011)", async () => {
    await runInRollback(async tx => {
      const recipientA = await createTestUser(tx);
      const recipientB = await createTestUser(tx);
      const failing = new FailingFanoutTransport();
      const logs = recordDomainLogs();

      try {
        const receiptA = await NotificationEngine.emitForUsers(batchInput([recipientA.id]), "en", tx, {});
        const receiptB = await NotificationEngine.emitForUsers(batchInput([recipientB.id]), "en", tx, {});

        // Resolves — never throws — despite every publish failing.
        await NotificationEngine.publishReceipts([receiptA, receiptB], "en", { transport: failing });

        expect(failing.publishAttempts).toHaveLength(2);
        expect(logs.entries).toEqual([
          { code: "NOTIFICATION_DELIVERY_DEGRADED", entity: "notifications" },
          { code: "NOTIFICATION_DELIVERY_DEGRADED", entity: "notifications" },
        ]);
      } finally {
        logs.spy.mockRestore();
      }
    });
  });

  test("one receipt's publish failure never blocks the next receipt's publish", async () => {
    await runInRollback(async tx => {
      const recipientA = await createTestUser(tx);
      const recipientB = await createTestUser(tx);
      const failFirst = new FailFirstFanoutTransport();
      const logs = recordDomainLogs();

      try {
        const receiptA = await NotificationEngine.emitForUsers(batchInput([recipientA.id]), "en", tx, {});
        const receiptB = await NotificationEngine.emitForUsers(batchInput([recipientB.id]), "en", tx, {});

        await NotificationEngine.publishReceipts([receiptA, receiptB], "en", { transport: failFirst });

        // Receipt B's publish still happened after receipt A's failure.
        expect(failFirst.deliveredUserIds).toEqual([recipientB.id]);
        expect(logs.entries).toEqual([{ code: "NOTIFICATION_DELIVERY_DEGRADED", entity: "notifications" }]);
      } finally {
        logs.spy.mockRestore();
      }
    });
  });
});

// ─── Tier 1 + 3: own-commit path (committed fixtures, tracked teardown) ──────

describe("NotificationEngine own-commit path (real commits; publish-after-commit, receipt store)", () => {
  const committedUsers: UserSelectType[] = [];

  beforeAll(async () => {
    // Commit-or-nothing fixture provisioning (the journey pattern, scoped
    // here because runInRollback can never prove a COMMIT + post-commit
    // publish/store sequence).
    await db.transaction(async tx => {
      committedUsers.push(await createTestUser(tx), await createTestUser(tx));
    });
  });

  afterAll(async () => {
    // Reverse-FK-order tracked teardown with zero-residue assertions — a
    // leaking afterAll fails the suite.
    const userIds = committedUsers.map(user => user.id);
    if (userIds.length === 0) {
      return;
    }
    const notificationResidueFilter = or(...userIds.map(id => eq(notifications.userId, id)));
    const userResidueFilter = or(...userIds.map(id => eq(users.id, id)));
    await db.delete(notifications).where(notificationResidueFilter);
    await db.delete(users).where(userResidueFilter);
    const notificationResidue = (
      await db.select({ value: count() }).from(notifications).where(notificationResidueFilter)
    ).at(0);
    const userResidue = (await db.select({ value: count() }).from(users).where(userResidueFilter)).at(0);
    expect(notificationResidue?.value ?? 0).toBe(0);
    expect(userResidue?.value ?? 0).toBe(0);
  });

  test("emitForUser commits its own unit, then publishes exactly ONCE to the recipient, then returns the row", async () => {
    const recipient = committedUsers.at(0);
    if (!recipient) {
      throw new Error("expected the first committed fixture recipient to exist");
    }
    const transportSpy = new SpiedFanoutTransport();
    const logs = recordDomainLogs();
    const beforeCount = await countNotificationsFor(db, recipient.id);

    try {
      const input = singleInput(recipient.id);
      const result = await NotificationEngine.emitForUser(input, "en", undefined, { transport: transportSpy });

      // Own-commit single emit returns the ROW (not a receipt).
      expect("notifications" in result).toBe(false);
      if ("notifications" in result) {
        throw new Error("unreachable narrowing guard");
      }
      expect(result.userId).toBe(recipient.id);
      expect(result.title).toBe(input.title);
      expect(result.isRead).toBe(false);

      // The row is DURABLE (visible outside any transaction).
      expect(await countNotificationsFor(db, recipient.id)).toBe(beforeCount + 1);

      // Exactly ONE publish, to the recipient only, valid payload shape.
      expect(transportSpy.publishCount).toBe(1);
      const publish = transportSpy.lastCall;
      if (!publish) {
        throw new Error("expected the spied transport to have recorded the publish");
      }
      expect(publish.userIds).toEqual([recipient.id]);
      expect(publish.payload.v).toBe(1);
      expect(publish.payload.kind).toBe("notification");
      expect(publish.payload.data.id).toBe(result.id);
      expect(publish.payload.data.title).toBe(input.title);
      expect(publish.payload.data.createdAt).toEqual(result.createdAt);
      expect(Object.hasOwn(publish.payload.data, "userId")).toBe(false);

      // Happy path emits NOTHING to the domain log.
      expect(logs.entries).toEqual([]);
    } finally {
      logs.spy.mockRestore();
    }
  });

  test("emitForUsers commits the batch, stores the receipt, and publishes ONCE with the FULL recipient list", async () => {
    const recipientA = committedUsers.at(0);
    const recipientB = committedUsers.at(1);
    if (!recipientA || !recipientB) {
      throw new Error("expected both committed fixture recipients to exist");
    }
    const transportSpy = new SpiedFanoutTransport();
    const cache = new ScriptedClaimCache();
    const logs = recordDomainLogs();
    const beforeA = await countNotificationsFor(db, recipientA.id);
    const beforeB = await countNotificationsFor(db, recipientB.id);

    try {
      const input = batchInput([recipientA.id, recipientB.id], { idempotencyKey: `${CLAIM_KEY_FIXTURE}-own` });
      const receipt = await NotificationEngine.emitForUsers(input, "en", undefined, {
        transport: transportSpy,
        cache,
      });

      expect(receipt.notifications).toHaveLength(2);
      expect(receipt.recipientUserIds).toEqual([recipientA.id, recipientB.id]);
      // ONE timestamp per batch even across the real commit.
      expect(secondRow(receipt).createdAt.getTime()).toBe(firstRow(receipt).createdAt.getTime());
      // Durable: both rows visible outside any transaction.
      expect(await countNotificationsFor(db, recipientA.id)).toBe(beforeA + 1);
      expect(await countNotificationsFor(db, recipientB.id)).toBe(beforeB + 1);

      // ONE publish carrying BOTH ids (REQ-013), representative first row.
      expect(transportSpy.publishCount).toBe(1);
      const publish = transportSpy.lastCall;
      if (!publish) {
        throw new Error("expected the spied transport to have recorded the batch publish");
      }
      expect(publish.userIds).toHaveLength(2);
      expect(publish.userIds).toContain(recipientA.id);
      expect(publish.userIds).toContain(recipientB.id);
      const rowIds = receipt.notifications.map(row => row.id);
      expect(rowIds).toContain(publish.payload.data.id);

      // The completed receipt was STORED under the hashed claim key and
      // parses back to the same rows (Dates revived by the parser).
      const storedValue = cache.stored.get(buildEmitClaimKey(input.userIds, input.type, `${CLAIM_KEY_FIXTURE}-own`));
      expect(storedValue).toBeDefined();
      const revived = storedValue === undefined ? null : parseStoredEmitReceipt(storedValue);
      if (revived !== null) {
        expect(revived.notifications.map(row => row.id)).toEqual(rowIds);
        expect(revived.recipientUserIds).toEqual([recipientA.id, recipientB.id]);
      } else {
        throw new Error("expected the stored receipt to parse back");
      }
      expect(logs.entries).toEqual([]);
    } finally {
      logs.spy.mockRestore();
    }
  });

  test("same-key replay after a committed emit returns the PRIOR receipt with ZERO new rows and ZERO new publishes", async () => {
    const recipientA = committedUsers.at(0);
    const recipientB = committedUsers.at(1);
    if (!recipientA || !recipientB) {
      throw new Error("expected both committed fixture recipients to exist");
    }
    const transportSpy = new SpiedFanoutTransport();
    const cache = new ScriptedClaimCache();
    const input = batchInput([recipientA.id, recipientB.id], { idempotencyKey: `${CLAIM_KEY_FIXTURE}-replay` });
    const beforeA = await countNotificationsFor(db, recipientA.id);
    const beforeB = await countNotificationsFor(db, recipientB.id);

    const first = await NotificationEngine.emitForUsers(input, "en", undefined, { transport: transportSpy, cache });
    expect(transportSpy.publishCount).toBe(1);

    const replay = await NotificationEngine.emitForUsers(input, "en", undefined, { transport: transportSpy, cache });

    // The prior receipt comes back — same row ids, no fresh inserts.
    expect(replay.notifications).toHaveLength(2);
    const replayIds = replay.notifications.map(row => row.id);
    expect(replayIds).toContain(firstRow(first).id);
    expect(replayIds).toContain(secondRow(first).id);
    expect(firstRow(replay).createdAt).toBeInstanceOf(Date);
    expect(await countNotificationsFor(db, recipientA.id)).toBe(beforeA + 1);
    expect(await countNotificationsFor(db, recipientB.id)).toBe(beforeB + 1);
    // ZERO new publishes (still exactly the one from the first emit above).
    expect(transportSpy.publishCount).toBe(1);
  });

  test("tx-path keyed emit: publishReceipts stores the receipt, so a same-key replay returns the PRIOR receipt with ZERO new rows", async () => {
    const recipient = committedUsers.at(1);
    if (!recipient) {
      throw new Error("expected the second committed fixture recipient to exist");
    }
    const transportSpy = new SpiedFanoutTransport();
    const cache = new ScriptedClaimCache();
    const idempotencyKey = `${CLAIM_KEY_FIXTURE}-txpath`;
    const input = singleInput(recipient.id, { idempotencyKey });
    const claimKey = buildEmitClaimKey([recipient.id], input.type, idempotencyKey);
    const beforeCount = await countNotificationsFor(db, recipient.id);

    // (1) Emit inside a REAL committed caller transaction: the receipt comes
    // back carrying the hashed claim key, with NOTHING stored or published
    // yet (pre-commit store would ghost a rolled-back emission).
    const receipt = receiptOf(
      await db.transaction(async tx =>
        NotificationEngine.emitForUser(input, "en", tx, { transport: transportSpy, cache })
      )
    );
    expect(receipt.notifications).toHaveLength(1);
    expect(receipt.emitClaimKey).toBe(claimKey);
    expect(cache.stored.size).toBe(0);
    expect(transportSpy.publishCount).toBe(0);

    // (2) The caller's post-commit hook publishes AND stores the receipt.
    await NotificationEngine.publishReceipts([receipt], "en", { transport: transportSpy, cache });
    expect(transportSpy.publishCount).toBe(1);
    const storedValue = cache.stored.get(claimKey);
    expect(storedValue).toBeDefined();
    const revived = storedValue === undefined ? null : parseStoredEmitReceipt(storedValue);
    if (revived === null) {
      throw new Error("expected the publishReceipts-stored receipt to parse back");
    }
    expect(revived.notifications.map(row => row.id)).toEqual([firstRow(receipt).id]);
    expect(revived.recipientUserIds).toEqual([recipient.id]);
    expect(await countNotificationsFor(db, recipient.id)).toBe(beforeCount + 1);
    const countAfterStore = await countNotificationsFor(db, recipient.id);

    // (3) Same-key replay through the tx path returns the PRIOR receipt —
    // no insert happens even inside the replay's own transaction unit.
    await runInRollback(async tx => {
      const replay = receiptOf(
        await NotificationEngine.emitForUser(input, "en", tx, { transport: transportSpy, cache })
      );
      expect(replay.notifications).toHaveLength(1);
      expect(firstRow(replay).id).toBe(firstRow(receipt).id);
      expect(await countNotificationsFor(tx, recipient.id)).toBe(countAfterStore);
    });
    // Durable row count is unchanged by the replay; the replay published nothing.
    expect(await countNotificationsFor(db, recipient.id)).toBe(countAfterStore);
    expect(transportSpy.publishCount).toBe(1);
  });

  test("tx-path keyed emit: publishReceipts WITHOUT a cache still publishes and fires ONE unavailable-warn (skip-time mirror of the emit-side warn)", async () => {
    const recipient = committedUsers.at(1);
    if (!recipient) {
      throw new Error("expected the second committed fixture recipient to exist");
    }
    const transportSpy = new SpiedFanoutTransport();
    const cache = new ScriptedClaimCache();
    const idempotencyKey = `${CLAIM_KEY_FIXTURE}-txnocache`;
    const input = singleInput(recipient.id, { idempotencyKey });
    const beforeCount = await countNotificationsFor(db, recipient.id);
    const logs = recordDomainLogs();

    try {
      // (1) Emit WITH the claim cache inside a REAL committed caller tx: the
      // claim is consumed at emit time and the returned receipt carries the
      // hashed claim key (nothing stored or published yet).
      const receipt = receiptOf(
        await db.transaction(async tx =>
          NotificationEngine.emitForUser(input, "en", tx, { transport: transportSpy, cache })
        )
      );
      expect(receipt.emitClaimKey).toBe(buildEmitClaimKey([recipient.id], input.type, idempotencyKey));
      expect(cache.stored.size).toBe(0);
      expect(transportSpy.publishCount).toBe(0);
      expect(logs.entries).toEqual([]);

      // (2) The caller's post-commit hook runs WITHOUT a cache injected: the
      // receipt store is skipped (the consumed claim leaves replays
      // fail-open)…
      await NotificationEngine.publishReceipts([receipt], "en", { transport: transportSpy });
      expect(cache.stored.size).toBe(0);
      // …the publish STILL happened exactly once…
      expect(transportSpy.publishCount).toBe(1);
      expect(await countNotificationsFor(db, recipient.id)).toBe(beforeCount + 1);
      // …and exactly ONE structured unavailable-warn fired — no silent skip.
      expect(logs.entries).toEqual([{ code: "NOTIFICATION_IDEMPOTENCY_DEGRADED", entity: "notifications" }]);
    } finally {
      logs.spy.mockRestore();
    }
  });

  test("publish failure post-commit is swallowed WITH a degradation log; the rows stay committed", async () => {
    const recipient = committedUsers.at(0);
    if (!recipient) {
      throw new Error("expected the first committed fixture recipient to exist");
    }
    const failing = new FailingFanoutTransport();
    const logs = recordDomainLogs();
    const beforeCount = await countNotificationsFor(db, recipient.id);

    try {
      const result = await NotificationEngine.emitForUser(singleInput(recipient.id), "en", undefined, {
        transport: failing,
      });

      // The emit RESOLVED and returned the row…
      expect("notifications" in result).toBe(false);
      // …the row is durable…
      expect(await countNotificationsFor(db, recipient.id)).toBe(beforeCount + 1);
      // …the publish attempt happened exactly once…
      expect(failing.publishAttempts).toHaveLength(1);
      // …and exactly ONE degradation log fired (REQ-011/043).
      expect(logs.entries).toEqual([{ code: "NOTIFICATION_DELIVERY_DEGRADED", entity: "notifications" }]);
    } finally {
      logs.spy.mockRestore();
    }
  });

  test("receipt-store outage post-commit degrades to a warn; the publish still happens", async () => {
    const recipientA = committedUsers.at(0);
    const recipientB = committedUsers.at(1);
    if (!recipientA || !recipientB) {
      throw new Error("expected both committed fixture recipients to exist");
    }
    const transportSpy = new SpiedFanoutTransport();
    const cache = new ScriptedClaimCache();
    cache.storeThrows = true;
    const logs = recordDomainLogs();
    const beforeA = await countNotificationsFor(db, recipientA.id);
    const beforeB = await countNotificationsFor(db, recipientB.id);

    try {
      const receipt = await NotificationEngine.emitForUsers(
        batchInput([recipientA.id, recipientB.id], { idempotencyKey: `${CLAIM_KEY_FIXTURE}-storeout` }),
        "en",
        undefined,
        { transport: transportSpy, cache }
      );

      expect(receipt.notifications).toHaveLength(2);
      expect(cache.stored.size).toBe(0); // nothing was stored
      expect(await countNotificationsFor(db, recipientA.id)).toBe(beforeA + 1);
      expect(await countNotificationsFor(db, recipientB.id)).toBe(beforeB + 1);
      // The publish STILL happened after the store degradation.
      expect(transportSpy.publishCount).toBe(1);
      expect(logs.entries).toEqual([{ code: "NOTIFICATION_IDEMPOTENCY_DEGRADED", entity: "notifications" }]);
    } finally {
      logs.spy.mockRestore();
    }
  });

  test("omitted transport resolves through the env-keyed factory (hermetic in-process default)", async () => {
    const recipient = committedUsers.at(1);
    if (!recipient) {
      throw new Error("expected the second committed fixture recipient to exist");
    }
    // Hermetic env fixture (restored in finally): explicit in-process
    // selection, no Redis URL — the engine's default-transport memo resolves
    // the in-process tap exactly once.
    const envKeys = ["NOTIFICATION_FANOUT_TRANSPORT", "REDIS_URL"] as const;
    const originals: Record<string, string | undefined> = {};
    for (const key of envKeys) {
      originals[key] = process.env[key];
    }
    const logs = recordDomainLogs();
    const beforeCount = await countNotificationsFor(db, recipient.id);

    try {
      process.env.NOTIFICATION_FANOUT_TRANSPORT = "in-process";
      delete process.env.REDIS_URL;
      resetEnvironmentCache();

      const result = await NotificationEngine.emitForUser(singleInput(recipient.id), "en");

      // Resolved, committed, and — with the in-process tap publishing to zero
      // listeners — NO degradation fired.
      expect("notifications" in result).toBe(false);
      expect(await countNotificationsFor(db, recipient.id)).toBe(beforeCount + 1);
      expect(logs.entries).toEqual([]);
    } finally {
      logs.spy.mockRestore();
      for (const key of envKeys) {
        const value = originals[key];
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      }
      resetEnvironmentCache();
    }
  });
});

// ─── Tier 4: hostile ID-channel + key fuzz ───────────────────────────────────

describe("ID-channel guard + hostile key fuzz", () => {
  test("isPositiveSafeInt accepts only positive safe integers", () => {
    const accepted: unknown[] = [1, 42, Number.MAX_SAFE_INTEGER];
    const rejected: unknown[] = [
      0,
      -1,
      1.5,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
      2 ** 53,
      "5",
      "",
      null,
      undefined,
      true,
      false,
      {},
      [],
      [7],
      Symbol("7"),
      () => 7,
    ];

    for (const value of accepted) {
      expect(isPositiveSafeInt(value)).toBe(true);
    }
    for (const value of rejected) {
      expect(isPositiveSafeInt(value)).toBe(false);
    }
  });

  test("hostile idempotency keys emit successfully and only ever surface as hashed claim keys", async () => {
    await runInRollback(async tx => {
      const recipient = await createTestUser(tx);
      const transportSpy = new SpiedFanoutTransport();
      const cache = new ScriptedClaimCache();
      const hostileKeys = [
        "key-with-\u202E-rtl-override",
        "🎉-emoji-مفتاح",
        "key'; DROP TABLE notifications; --",
        "key-%_LIKE_wildcards",
        "key\twith\ttabs",
      ];

      // Sequential index-recursive sweep (one statement at a time on the
      // shared tx — no concurrent same-client queries).
      async function emitHostileKey(index: number): Promise<void> {
        const hostileKey = hostileKeys.at(index);
        if (hostileKey === undefined) {
          return;
        }
        const result = await NotificationEngine.emitForUser(
          singleInput(recipient.id, { idempotencyKey: hostileKey }),
          "en",
          tx,
          { transport: transportSpy, cache }
        );
        expect(receiptOf(result).notifications).toHaveLength(1);
        await emitHostileKey(index + 1);
      }

      await emitHostileKey(0);

      expect(await countNotificationsFor(tx, recipient.id)).toBe(hostileKeys.length);
      // Every claim key the engine produced is the hex-digest form — no raw
      // hostile content ever reaches the cache key surface.
      expect(cache.claimKeys).toHaveLength(hostileKeys.length);
      for (const key of cache.claimKeys) {
        expect(key).toMatch(/^notif:emit:[a-f0-9]{64}$/);
      }
    });
  });
});
