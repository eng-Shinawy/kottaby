/**
 * AdminBroadcastService — service behavior matrix for `broadcast`.
 *
 * The composition core is exercised through the REAL service layer against
 * the real test database, with every external boundary either genuinely
 * transactional or honestly doubled:
 *  - every case runs inside `runInRollback` and passes the outer `tx` as the
 *    service's `outerTx` seam — reads and writes participate in the SAME
 *    rolled-back transaction (the tx-propagation rule), and the service's
 *    write unit opens a SAVEPOINT on it;
 *  - the fan-out transport is a `SpiedFanoutTransport` and the idempotency
 *    claim cache is a scripted in-memory double injected through the
 *    service's options seam — no Redis, no WebSocket frames, ever;
 *  - forced-failure scripts (an oversized scripted cohort, a failing claim
 *    cache, a throwing insert) are the ONLY behavior substitutions, each
 *    restored after its test;
 *  - all rejection assertions use `expectRepoError` (try/catch) —
 *    `expect(...).rejects.toThrow()` appears nowhere;
 *  - `logger.logDomainError` is silenced-and-recorded per test (tracked spy
 *    registry + file-level `afterEach` restore — bun reuses ONE mock per
 *    object+method pair), so happy paths can prove they log NOTHING.
 *
 * Coverage map (the full behavior matrix):
 *  - happy path per cohort kind (`all` / `role` / `country` / `plan`): rows
 *    + ONE metadata-only audit row + ONE full-list envelope + correct count
 *    + zero logs;
 *  - gate denials: anonymous → UNAUTHORIZED, non-admin / missing actor →
 *    FORBIDDEN — all pre-transaction with zero rows / audit / publish;
 *  - validation matrix: title defects, the full companion coherence matrix
 *    (missing / mismatched / on-`all` companions, malformed planIds, hostile
 *    kind + role strings) — every case pre-DB, zero state, and the plan
 *    existence read never consulted;
 *  - cohort guards: empty resolution and a >cap scripted resolution —
 *    localized rejections with zero state;
 *  - replay: same key + live cache → identical count, ZERO new rows /
 *    audit / publishes;
 *  - cache-claim outage: fail-open insert + exactly ONE engine warn, the
 *    audit row and the publish still happen;
 *  - forced insert failure: the whole unit rolls back — zero notifications,
 *    zero audit rows, no publish, and the outer transaction stays usable;
 *  - tx propagation: every repo/engine seam receives the expected executor
 *    (reads the outer tx, writes the ONE shared savepoint) and the engine
 *    batch input is mapped field-by-field (no spread of the submit input);
 *  - verbatim copy storage: unicode / RTL / injection-shaped strings stored
 *    byte-for-byte and inert (title passed through UNtrimmed);
 *  - second-admin gate probe: the seeded second admin passes the SAME real
 *    gate and lands its OWN audit row — audit rows are append-only with
 *    per-actor attribution, so no cross-admin alteration is possible;
 *  - concurrent same-key race: two SEQUENTIAL same-key submits yield ONE
 *    row-set (the deterministic guarantee), while the parallel loser of the
 *    claim (held, receipt not yet visible) takes the engine's documented
 *    fail-open ladder — insert + audit + publish with exactly ONE warn.
 */

import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { BroadcastAudienceRepository, NotificationRepository, PlanRepository, UserRepository } from "@/backend/db/repo";
import { auditLogs } from "@/backend/db/schema/audit/audit-logs";
import { subscriptions } from "@/backend/db/schema/billing/subscriptions";
import { notifications } from "@/backend/db/schema/notifications/notifications";
import { users } from "@/backend/db/schema/users/users";
import { createTestPlan, createTestUser } from "@/backend/db/test/entity-setup";
import { expectRepoError, runInRollback } from "@/backend/db/test/test-utils";
import { AuditActionType } from "@/backend/enum/audit/audit-action-type.enum";
import { BroadcastAudienceType } from "@/backend/enum/notifications/broadcast-audience-type.enum";
import { NotificationType } from "@/backend/enum/notifications/notification-type.enum";
import { UserRole } from "@/backend/enum/users/user-role.enum";
import { DomainError, ForbiddenError, UnauthorizedError, ValidationError } from "@/backend/lib/errors";
import { type DomainErrorContext, logger } from "@/backend/lib/logger";
import { AuditService } from "@/backend/services/admin/audit.service";
import {
  AdminBroadcastService,
  BROADCAST_MAX_RECIPIENTS,
} from "@/backend/services/notifications/admin-broadcast.service";
import type { NotificationIdempotencyClaimCache } from "@/backend/services/notifications/emit-idempotency";
import { NotificationEngine } from "@/backend/services/notifications/notification-engine.service";
import type { BroadcastNotificationSubmitInput, DBTransaction, UserSelectType } from "@/backend/types";
import { getServerTranslations } from "@/shared/locale/server-graphql";
import { SpiedFanoutTransport } from "@/test/workflows/helpers";

const LOCALE = "en";
const EN_ERRORS = getServerTranslations(LOCALE).errorsTranslations;

/** The audit entityType the service writes for every accepted broadcast. */
const AUDIT_ENTITY_TYPE = "notification_broadcast";

/** A user id that cannot exist in the test database. */
const NONEXISTENT_USER_ID = 2_000_000_000;

/** One pre-DB denial probe: the hostile input plus its exact expected contract. */
interface ValidationProbeCase {
  readonly input: BroadcastNotificationSubmitInput;
  readonly expectedCode: string;
  readonly expectedMessage: string;
}

/** The four-user cast every case provisions (roles only — the gate reads `users.role`). */
interface BroadcastCast {
  readonly admin: UserSelectType;
  readonly teacher: UserSelectType;
  readonly student: UserSelectType;
  readonly parent: UserSelectType;
}

/** The engine injection seam ({ transport, cache }) every call in this suite installs. */
interface BroadcastCallOptions {
  readonly transport: SpiedFanoutTransport;
  readonly cache?: NotificationIdempotencyClaimCache;
}

type DomainLogSpy = ReturnType<typeof spyOn>;

/**
 * Registry of every spy created during the currently running test. bun's
 * `spyOn` reuses ONE mock per object+method pair until it is restored, so
 * an unrestored mock keeps accumulating `mock.calls` across tests and
 * poisons later call-count assertions — every spy is registered here and
 * restored by the file-level `afterEach`.
 */
const trackedSpies: DomainLogSpy[] = [];

/** Registers a spy for automatic restoration after the current test. */
function trackSpy<T extends DomainLogSpy>(spy: T): T {
  trackedSpies.push(spy);
  return spy;
}

afterEach(() => {
  while (trackedSpies.length > 0) {
    trackedSpies.pop()?.mockRestore();
  }
});

/**
 * Installs a recording stub over `logger.logDomainError`: domain logs never
 * reach test stdout AND every call's code/entity pair becomes assertable.
 * Registered with the tracked-spy registry (restored by `afterEach`).
 */
function recordDomainLogs(): { spy: DomainLogSpy; entries: Array<{ code?: string; entity?: string }> } {
  const entries: Array<{ code?: string; entity?: string }> = [];
  const spy = trackSpy(
    spyOn(logger, "logDomainError").mockImplementation((_message: string, ctx?: DomainErrorContext) => {
      entries.push({ code: ctx?.code, entity: ctx?.entity });
    })
  );
  return { spy, entries };
}

/**
 * Scripted claim-cache double mirroring SET-NX-EX semantics with real
 * held-key tracking: the first claim for a key wins, later claims for the
 * same key report held, and every operation can be toggled into an outage —
 * while `store()`/`get()` keep working so a claim-only outage isolates the
 * ONE expected degrade warn.
 */
class ScriptedClaimCache implements NotificationIdempotencyClaimCache {
  claimThrows = false;
  getThrows = false;
  storeThrows = false;
  private readonly heldKeys = new Set<string>();
  private readonly stored = new Map<string, string>();

  async claim(key: string, _ttlSeconds: number): Promise<boolean> {
    if (this.claimThrows) {
      throw new Error("scripted claim outage");
    }
    if (this.heldKeys.has(key)) {
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

/**
 * Claim cache scripted for the same-key race: the FIRST claimant wins, and a
 * receipt only becomes storable after the held loser's cache miss has been
 * observed — the loser therefore reads NO receipt and deterministically takes
 * the engine's fail-open path (mirrors SET-NX-EX with a real in-flight
 * emission still holding the key).
 */
class RaceWindowClaimCache implements NotificationIdempotencyClaimCache {
  private claims = 0;
  private readonly stored = new Map<string, string>();
  private releaseStore: (() => void) | undefined;
  private readonly loserMissObserved: Promise<void> = new Promise(resolve => {
    this.releaseStore = resolve;
  });

  async claim(_key: string, _ttlSeconds: number): Promise<boolean> {
    this.claims += 1;
    return this.claims === 1;
  }

  async get(key: string): Promise<string | null> {
    if (this.claims >= 2) {
      this.releaseStore?.();
    }
    return this.stored.get(key) ?? null;
  }

  async store(key: string, value: string, _ttlSeconds: number): Promise<void> {
    await this.loserMissObserved;
    this.stored.set(key, value);
  }
}

/** Provisions the four-user cast (admin + the three non-admin roles). */
async function provisionCast(tx: DBTransaction): Promise<BroadcastCast> {
  const admin = await createTestUser(tx, { role: "admin" });
  const teacher = await createTestUser(tx, { role: "teacher" });
  const student = await createTestUser(tx, { role: "student" });
  const parent = await createTestUser(tx, { role: "parent" });
  return { admin, teacher, student, parent };
}

/** Calls the service with the suite's locale and the caller's outer tx. */
function callBroadcast(
  tx: DBTransaction,
  input: BroadcastNotificationSubmitInput,
  actorId: number,
  options: BroadcastCallOptions,
  idempotencyKey?: string
): Promise<number> {
  return AdminBroadcastService.broadcast(input, actorId, LOCALE, idempotencyKey, options, tx);
}

/** The broadcast audit rows attributed to one actor (fresh fixtures → zero baseline). */
async function broadcastAuditRowsFor(tx: DBTransaction, actorId: number) {
  return tx
    .select({
      id: auditLogs.id,
      actionType: auditLogs.actionType,
      entityId: auditLogs.entityId,
      details: auditLogs.details,
    })
    .from(auditLogs)
    .where(and(eq(auditLogs.actorId, actorId), eq(auditLogs.entityType, AUDIT_ENTITY_TYPE)));
}

/** The persisted broadcast rows created under one run-unique title. */
async function rowsByTitle(tx: DBTransaction, title: string) {
  return tx.select().from(notifications).where(eq(notifications.title, title));
}

/** Asserts a caught error is a `DomainError` carrying the expected `code`. */
function assertDomainCode(error: Error, expectedCode: string): void {
  expect(error).toBeInstanceOf(DomainError);
  if (!(error instanceof DomainError)) {
    throw new Error("expected a DomainError instance");
  }
  expect(error.code).toBe(expectedCode);
}

/**
 * Recursively probes the pre-DB denial matrix without await-in-loop: every
 * case must reject as a `ValidationError` carrying its documented custom
 * code and the localized English substring.
 */
async function probeValidationCases(
  tx: DBTransaction,
  actorId: number,
  options: BroadcastCallOptions,
  cases: readonly ValidationProbeCase[],
  index: number
): Promise<void> {
  if (index >= cases.length) {
    return;
  }
  const probeCase = cases[index];
  if (!probeCase) {
    throw new Error(`validation probe case ${index} is missing`);
  }
  const error = await expectRepoError(() => callBroadcast(tx, probeCase.input, actorId, options, randomUUID()));
  expect(error).toBeInstanceOf(ValidationError);
  assertDomainCode(error, probeCase.expectedCode);
  expect(error.message).toContain(probeCase.expectedMessage);
  await probeValidationCases(tx, actorId, options, cases, index + 1);
}

describe("AdminBroadcastService.broadcast — service behavior matrix", () => {
  test("all cohort — one row per governed user, ONE metadata-only audit row, ONE full-list envelope, zero logs", async () => {
    await runInRollback(async tx => {
      const cast = await provisionCast(tx);
      const transportSpy = new SpiedFanoutTransport();
      const options = { transport: transportSpy, cache: new ScriptedClaimCache() };
      const logs = recordDomainLogs();
      const title = `svc_all_${randomUUID()}`;
      const body = `svc_all_body_${randomUUID()}`;

      try {
        const broadcastCount = await callBroadcast(
          tx,
          { title, body, audience: { type: BroadcastAudienceType.All } },
          cast.admin.id,
          options,
          randomUUID()
        );

        const rows = await rowsByTitle(tx, title);
        expect(broadcastCount).toBe(rows.length);
        expect(rows.length).toBeGreaterThanOrEqual(4);
        const recipientIds = rows.map(row => row.userId);
        for (const member of [cast.admin, cast.teacher, cast.student, cast.parent]) {
          expect(recipientIds).toContain(member.id);
        }
        for (const row of rows) {
          expect(row.type).toBe(NotificationType.SystemBroadcast);
          expect(row.relatedEntityType).toBeNull();
          expect(row.relatedEntityId).toBeNull();
          expect(row.isRead).toBe(false);
          expect(row.title).toBe(title);
          expect(row.body).toBe(body);
        }

        const auditRows = await broadcastAuditRowsFor(tx, cast.admin.id);
        expect(auditRows).toHaveLength(1);
        const auditRow = auditRows[0];
        if (!auditRow) {
          throw new Error("expected exactly one audit row for the fresh broadcast");
        }
        expect(auditRow.actionType).toBe(AuditActionType.Create);
        expect(auditRow.entityId).toBeNull();
        const metadata: unknown = JSON.parse(auditRow.details ?? "{}");
        expect(metadata).toEqual({ scope: "all", recipientCount: broadcastCount });
        expect(JSON.stringify(metadata)).not.toContain(title);
        expect(JSON.stringify(metadata)).not.toContain(body);

        expect(transportSpy.publishCount).toBe(1);
        const publish = transportSpy.lastCall;
        if (!publish) {
          throw new Error("expected the spied transport to record the broadcast publish");
        }
        expect([...publish.userIds].toSorted((a, b) => a - b)).toEqual([...recipientIds].toSorted((a, b) => a - b));
        expect(publish.payload.data.type).toBe(NotificationType.SystemBroadcast);
        expect(publish.payload.data.title).toBe(title);

        // Happy paths log NOTHING (including the engine's seams).
        expect(logs.entries).toEqual([]);
      } finally {
        logs.spy.mockRestore();
      }
    });
  });

  test("role cohort — only the teacher role gains rows; audit metadata carries the role", async () => {
    await runInRollback(async tx => {
      const cast = await provisionCast(tx);
      const transportSpy = new SpiedFanoutTransport();
      const options = { transport: transportSpy, cache: new ScriptedClaimCache() };
      const logs = recordDomainLogs();
      const title = `svc_role_${randomUUID()}`;

      try {
        const broadcastCount = await callBroadcast(
          tx,
          {
            title,
            body: null,
            audience: { type: BroadcastAudienceType.Role, role: UserRole.Teacher },
          },
          cast.admin.id,
          options,
          randomUUID()
        );

        const rows = await rowsByTitle(tx, title);
        expect(broadcastCount).toBe(rows.length);
        const recipientIds = rows.map(row => row.userId);
        expect(recipientIds).toContain(cast.teacher.id);
        for (const outsider of [cast.student, cast.parent]) {
          expect(recipientIds).not.toContain(outsider.id);
        }

        const auditRows = await broadcastAuditRowsFor(tx, cast.admin.id);
        expect(auditRows).toHaveLength(1);
        const metadata: unknown = JSON.parse(auditRows[0]?.details ?? "{}");
        expect(metadata).toEqual({ scope: "role", role: UserRole.Teacher, recipientCount: broadcastCount });

        expect(transportSpy.publishCount).toBe(1);
        expect(logs.entries).toEqual([]);
      } finally {
        logs.spy.mockRestore();
      }
    });
  });

  test("country cohort — exact match on the trimmed country; the trimmed value is what resolves", async () => {
    await runInRollback(async tx => {
      const cast = await provisionCast(tx);
      // A run-unique country sentinel keeps the exact-match cohort disjoint
      // from any committed rows in the shared database.
      const country = `QT${randomUUID().replace(/-/g, "").slice(0, 10).toUpperCase()}`;
      await tx.update(users).set({ country }).where(eq(users.id, cast.student.id));
      const transportSpy = new SpiedFanoutTransport();
      const options = { transport: transportSpy, cache: new ScriptedClaimCache() };
      const logs = recordDomainLogs();
      const title = `svc_country_${randomUUID()}`;

      try {
        const broadcastCount = await callBroadcast(
          tx,
          {
            title,
            body: null,
            audience: { type: BroadcastAudienceType.Country, country },
          },
          cast.admin.id,
          options,
          randomUUID()
        );

        const rows = await rowsByTitle(tx, title);
        expect(rows.map(row => row.userId)).toEqual([cast.student.id]);
        expect(broadcastCount).toBe(1);

        const metadata: unknown = JSON.parse((await broadcastAuditRowsFor(tx, cast.admin.id))[0]?.details ?? "{}");
        expect(metadata).toEqual({ scope: "country", country, recipientCount: broadcastCount });

        // The same cohort resolves from a padded country — the service
        // validates and resolves the TRIMMED value.
        const paddedTitle = `${title}_padded`;
        const paddedCount = await callBroadcast(
          tx,
          {
            title: paddedTitle,
            body: null,
            audience: { type: BroadcastAudienceType.Country, country: `  ${country}  ` },
          },
          cast.admin.id,
          options,
          randomUUID()
        );
        expect(paddedCount).toBe(1);
        expect((await rowsByTitle(tx, paddedTitle)).map(row => row.userId)).toEqual([cast.student.id]);

        expect(transportSpy.publishCount).toBe(2);
        expect(logs.entries).toEqual([]);
      } finally {
        logs.spy.mockRestore();
      }
    });
  });

  test("plan cohort — the active-window subscriber receives; the expired-window subscriber does not", async () => {
    await runInRollback(async tx => {
      const cast = await provisionCast(tx);
      const expiredStudent = await createTestUser(tx, { role: "student" });
      const plan = await createTestPlan(tx);

      const [activeSub] = await tx
        .insert(subscriptions)
        .values({
          userId: cast.student.id,
          planId: plan.id,
          status: "active",
          startDate: new Date(Date.now() - 24 * 60 * 60 * 1000),
          endDate: null,
        })
        .returning();
      const [expiredSub] = await tx
        .insert(subscriptions)
        .values({
          userId: expiredStudent.id,
          planId: plan.id,
          status: "active",
          startDate: new Date(Date.now() - 48 * 60 * 60 * 1000),
          endDate: new Date(Date.now() - 24 * 60 * 60 * 1000),
        })
        .returning();
      if (!activeSub || !expiredSub) {
        throw new Error("fixture: subscription insert returned no rows");
      }

      const transportSpy = new SpiedFanoutTransport();
      const options = { transport: transportSpy, cache: new ScriptedClaimCache() };
      const logs = recordDomainLogs();
      const title = `svc_plan_${randomUUID()}`;

      try {
        const broadcastCount = await callBroadcast(
          tx,
          {
            title,
            body: null,
            audience: { type: BroadcastAudienceType.Plan, planId: plan.id },
          },
          cast.admin.id,
          options,
          randomUUID()
        );

        const rows = await rowsByTitle(tx, title);
        expect(rows.map(row => row.userId)).toEqual([cast.student.id]);
        expect(broadcastCount).toBe(1);

        const metadata: unknown = JSON.parse((await broadcastAuditRowsFor(tx, cast.admin.id))[0]?.details ?? "{}");
        expect(metadata).toEqual({ scope: "plan", planId: plan.id, recipientCount: broadcastCount });

        expect(transportSpy.publishCount).toBe(1);
        expect(logs.entries).toEqual([]);
      } finally {
        logs.spy.mockRestore();
      }
    });
  });

  test("anonymous caller (actorId=0) → UNAUTHORIZED, pre-transaction, zero rows / audit / publish", async () => {
    await runInRollback(async tx => {
      const cast = await provisionCast(tx);
      const transportSpy = new SpiedFanoutTransport();
      const options = { transport: transportSpy };
      const title = `svc_anon_${randomUUID()}`;
      const input: BroadcastNotificationSubmitInput = {
        title,
        body: null,
        audience: { type: BroadcastAudienceType.All },
      };

      const auditBefore = (await broadcastAuditRowsFor(tx, cast.admin.id)).length;

      const error = await expectRepoError(() => callBroadcast(tx, input, 0, options, randomUUID()));

      expect(error).toBeInstanceOf(UnauthorizedError);
      assertDomainCode(error, "UNAUTHORIZED");
      expect(error.message).toContain(EN_ERRORS.unauthorized);

      expect(await broadcastAuditRowsFor(tx, cast.admin.id)).toHaveLength(auditBefore);
      expect(transportSpy.publishCount).toBe(0);
      expect(await rowsByTitle(tx, title)).toHaveLength(0);
    });
  });

  test("non-admin and missing actor → FORBIDDEN through the real gate, zero rows / audit / publish", async () => {
    await runInRollback(async tx => {
      const cast = await provisionCast(tx);
      const transportSpy = new SpiedFanoutTransport();
      const options = { transport: transportSpy };
      const title = `svc_denied_${randomUUID()}`;
      const input: BroadcastNotificationSubmitInput = {
        title,
        body: null,
        audience: { type: BroadcastAudienceType.Role, role: UserRole.Teacher },
      };

      const auditBefore = (await broadcastAuditRowsFor(tx, cast.admin.id)).length;

      const teacherError = await expectRepoError(() =>
        callBroadcast(tx, input, cast.teacher.id, options, randomUUID())
      );
      expect(teacherError).toBeInstanceOf(ForbiddenError);
      assertDomainCode(teacherError, "FORBIDDEN");
      expect(teacherError.message).toContain(EN_ERRORS.forbidden);

      const studentError = await expectRepoError(() =>
        callBroadcast(tx, input, cast.student.id, options, randomUUID())
      );
      assertDomainCode(studentError, "FORBIDDEN");

      const parentError = await expectRepoError(() => callBroadcast(tx, input, cast.parent.id, options, randomUUID()));
      assertDomainCode(parentError, "FORBIDDEN");

      // A well-formed id resolving to NO row denies identically.
      const missingError = await expectRepoError(() =>
        callBroadcast(tx, input, NONEXISTENT_USER_ID, options, randomUUID())
      );
      expect(missingError).toBeInstanceOf(ForbiddenError);
      assertDomainCode(missingError, "FORBIDDEN");

      expect(await broadcastAuditRowsFor(tx, cast.admin.id)).toHaveLength(auditBefore);
      expect(transportSpy.publishCount).toBe(0);
      expect(await rowsByTitle(tx, title)).toHaveLength(0);
    });
  });

  test("validation matrix — title defects, the full coherence matrix, hostile strings: pre-DB, zero state", async () => {
    await runInRollback(async tx => {
      const cast = await provisionCast(tx);
      const transportSpy = new SpiedFanoutTransport();
      const options = { transport: transportSpy, cache: new ScriptedClaimCache() };
      const validTitle = `svc_matrix_${randomUUID()}`;

      // Hostile role string injected through a widened alias — the service
      // must fail the role coercion closed, never trust the raw value.
      const hostileRoleInput: BroadcastNotificationSubmitInput = {
        title: validTitle,
        body: null,
        audience: { type: BroadcastAudienceType.Role },
      };
      (hostileRoleInput.audience as { role?: unknown }).role = "wizard";

      // Hostile audience-kind string — never an enum member. The kind is
      // swapped behind a widened alias (no narrowing assertion) so the probe
      // carries the runtime shape an unvalidated wire payload would produce.
      const hostileKindInput: BroadcastNotificationSubmitInput = {
        title: validTitle,
        body: null,
        audience: { type: BroadcastAudienceType.All },
      };
      (hostileKindInput.audience as { type: string }).type = "role; DROP TABLE users";

      const cases: readonly ValidationProbeCase[] = [
        {
          input: {
            title: "   ",
            body: null,
            audience: { type: BroadcastAudienceType.Role, role: UserRole.Teacher },
          },
          expectedCode: "BROADCAST_TITLE_INVALID",
          expectedMessage: EN_ERRORS.broadcastTitleInvalid,
        },
        {
          input: {
            title: "T".repeat(256),
            body: null,
            audience: { type: BroadcastAudienceType.Role, role: UserRole.Teacher },
          },
          expectedCode: "BROADCAST_TITLE_INVALID",
          expectedMessage: EN_ERRORS.broadcastTitleInvalid,
        },
        {
          input: { title: validTitle, body: null, audience: { type: BroadcastAudienceType.Role } },
          expectedCode: "BROADCAST_AUDIENCE_INVALID",
          expectedMessage: EN_ERRORS.broadcastAudienceInvalid,
        },
        {
          input: {
            title: validTitle,
            body: null,
            audience: { type: BroadcastAudienceType.Role, role: UserRole.Teacher, country: "EG" },
          },
          expectedCode: "BROADCAST_AUDIENCE_INVALID",
          expectedMessage: EN_ERRORS.broadcastAudienceInvalid,
        },
        {
          input: {
            title: validTitle,
            body: null,
            audience: { type: BroadcastAudienceType.Role, role: UserRole.Teacher, planId: 7 },
          },
          expectedCode: "BROADCAST_AUDIENCE_INVALID",
          expectedMessage: EN_ERRORS.broadcastAudienceInvalid,
        },
        {
          input: {
            title: validTitle,
            body: null,
            audience: { type: BroadcastAudienceType.All, role: UserRole.Admin },
          },
          expectedCode: "BROADCAST_AUDIENCE_INVALID",
          expectedMessage: EN_ERRORS.broadcastAudienceInvalid,
        },
        {
          input: {
            title: validTitle,
            body: null,
            audience: { type: BroadcastAudienceType.All, planId: 7 },
          },
          expectedCode: "BROADCAST_AUDIENCE_INVALID",
          expectedMessage: EN_ERRORS.broadcastAudienceInvalid,
        },
        {
          input: {
            title: validTitle,
            body: null,
            audience: { type: BroadcastAudienceType.Country, country: "   " },
          },
          expectedCode: "BROADCAST_AUDIENCE_INVALID",
          expectedMessage: EN_ERRORS.broadcastAudienceInvalid,
        },
        {
          input: {
            title: validTitle,
            body: null,
            audience: { type: BroadcastAudienceType.Country, country: "C".repeat(101) },
          },
          expectedCode: "BROADCAST_AUDIENCE_INVALID",
          expectedMessage: EN_ERRORS.broadcastAudienceInvalid,
        },
        {
          input: {
            title: validTitle,
            body: null,
            audience: { type: BroadcastAudienceType.Country, country: "EG", role: UserRole.Teacher },
          },
          expectedCode: "BROADCAST_AUDIENCE_INVALID",
          expectedMessage: EN_ERRORS.broadcastAudienceInvalid,
        },
        {
          input: { title: validTitle, body: null, audience: { type: BroadcastAudienceType.Plan, planId: 0 } },
          expectedCode: "BROADCAST_AUDIENCE_INVALID",
          expectedMessage: EN_ERRORS.broadcastAudienceInvalid,
        },
        {
          input: { title: validTitle, body: null, audience: { type: BroadcastAudienceType.Plan, planId: 1.5 } },
          expectedCode: "BROADCAST_AUDIENCE_INVALID",
          expectedMessage: EN_ERRORS.broadcastAudienceInvalid,
        },
        {
          input: { title: validTitle, body: null, audience: { type: BroadcastAudienceType.Plan, planId: null } },
          expectedCode: "BROADCAST_AUDIENCE_INVALID",
          expectedMessage: EN_ERRORS.broadcastAudienceInvalid,
        },
        {
          input: hostileKindInput,
          expectedCode: "BROADCAST_AUDIENCE_INVALID",
          expectedMessage: EN_ERRORS.broadcastAudienceInvalid,
        },
        {
          input: hostileRoleInput,
          expectedCode: "BROADCAST_AUDIENCE_INVALID",
          expectedMessage: EN_ERRORS.broadcastAudienceInvalid,
        },
      ];

      // The plan-existence read must NEVER be consulted by a coherence
      // rejection — validation strictly precedes resolution.
      const existsSpy = trackSpy(spyOn(PlanRepository, "existsById"));
      const auditBefore = (await broadcastAuditRowsFor(tx, cast.admin.id)).length;
      const publishBefore = transportSpy.publishCount;

      await probeValidationCases(tx, cast.admin.id, options, cases, 0);

      expect(existsSpy).not.toHaveBeenCalled();
      expect(await rowsByTitle(tx, validTitle)).toHaveLength(0);
      expect(await broadcastAuditRowsFor(tx, cast.admin.id)).toHaveLength(auditBefore);
      expect(transportSpy.publishCount).toBe(publishBefore);
    });
  });

  test("empty cohort — coherent selector resolving to nobody rejects localized with zero state", async () => {
    await runInRollback(async tx => {
      const cast = await provisionCast(tx);
      const transportSpy = new SpiedFanoutTransport();
      const options = { transport: transportSpy, cache: new ScriptedClaimCache() };
      const title = `svc_empty_${randomUUID()}`;
      const input: BroadcastNotificationSubmitInput = {
        title,
        body: null,
        audience: { type: BroadcastAudienceType.Country, country: `EMPTY-${randomUUID()}` },
      };

      const auditBefore = (await broadcastAuditRowsFor(tx, cast.admin.id)).length;

      const error = await expectRepoError(() => callBroadcast(tx, input, cast.admin.id, options, randomUUID()));

      expect(error).toBeInstanceOf(ValidationError);
      assertDomainCode(error, "BROADCAST_AUDIENCE_EMPTY");
      expect(error.message).toContain(EN_ERRORS.broadcastAudienceEmpty);

      expect(await rowsByTitle(tx, title)).toHaveLength(0);
      expect(await broadcastAuditRowsFor(tx, cast.admin.id)).toHaveLength(auditBefore);
      expect(transportSpy.publishCount).toBe(0);
    });
  });

  test("oversized cohort — a scripted resolution beyond the cap rejects localized with zero state", async () => {
    await runInRollback(async tx => {
      const cast = await provisionCast(tx);
      const transportSpy = new SpiedFanoutTransport();
      const options = { transport: transportSpy, cache: new ScriptedClaimCache() };
      const title = `svc_too_large_${randomUUID()}`;
      const input: BroadcastNotificationSubmitInput = {
        title,
        body: null,
        audience: { type: BroadcastAudienceType.Role, role: UserRole.Teacher },
      };

      const oversizedIds = Array.from({ length: BROADCAST_MAX_RECIPIENTS + 1 }, (_value, index) => index + 1);
      const resolveSpy = trackSpy(
        spyOn(BroadcastAudienceRepository, "resolveAudienceIds").mockImplementation(async () => oversizedIds)
      );
      const auditBefore = (await broadcastAuditRowsFor(tx, cast.admin.id)).length;

      try {
        const error = await expectRepoError(() => callBroadcast(tx, input, cast.admin.id, options, randomUUID()));

        expect(error).toBeInstanceOf(ValidationError);
        assertDomainCode(error, "BROADCAST_AUDIENCE_TOO_LARGE");
        expect(error.message).toContain(EN_ERRORS.broadcastAudienceTooLarge);
        expect(resolveSpy).toHaveBeenCalledTimes(1);

        // Zero writes: no inserts, no audit, no publish — the cap fires
        // before the transaction ever opens.
        expect(await rowsByTitle(tx, title)).toHaveLength(0);
        expect(await broadcastAuditRowsFor(tx, cast.admin.id)).toHaveLength(auditBefore);
        expect(transportSpy.publishCount).toBe(0);
      } finally {
        resolveSpy.mockRestore();
      }
    });
  });

  test("replay — same key + live cache returns the PRIOR count with zero new rows / audit / publishes", async () => {
    await runInRollback(async tx => {
      const cast = await provisionCast(tx);
      const transportSpy = new SpiedFanoutTransport();
      const cache = new ScriptedClaimCache();
      const options = { transport: transportSpy, cache };
      const title = `svc_replay_${randomUUID()}`;
      const input: BroadcastNotificationSubmitInput = {
        title,
        body: null,
        audience: { type: BroadcastAudienceType.Role, role: UserRole.Teacher },
      };
      const key = randomUUID();

      const freshCount = await callBroadcast(tx, input, cast.admin.id, options, key);
      const freshRows = await rowsByTitle(tx, title);
      const auditAfterFresh = await broadcastAuditRowsFor(tx, cast.admin.id);
      expect(freshRows).toHaveLength(freshCount);
      expect(auditAfterFresh).toHaveLength(1);
      expect(transportSpy.publishCount).toBe(1);

      const replayCount = await callBroadcast(tx, input, cast.admin.id, options, key);

      expect(replayCount).toBe(freshCount);
      expect(await rowsByTitle(tx, title)).toHaveLength(freshRows.length);
      expect(await broadcastAuditRowsFor(tx, cast.admin.id)).toHaveLength(auditAfterFresh.length);
      expect(transportSpy.publishCount).toBe(1);
    });
  });

  test("a seeded second admin may broadcast — audit rows stay append-only and actor-attributed (no cross-admin alteration)", async () => {
    await runInRollback(async tx => {
      const cast = await provisionCast(tx);
      const seededAdmin = await createTestUser(tx, { role: "admin" });
      expect(seededAdmin.role).toBe(UserRole.Admin);

      // The shared database may already hold committed broadcast audits for
      // the seeded admin from other suites — assert on the DELTA this tx adds.
      const seededAuditBefore = await broadcastAuditRowsFor(tx, seededAdmin.id);
      const seededAuditBeforeIds = new Set(seededAuditBefore.map(row => row.id));

      const transportSpy = new SpiedFanoutTransport();
      const options = { transport: transportSpy, cache: new ScriptedClaimCache() };

      // The first admin fires an accepted broadcast — exactly ONE audit row
      // attributed to them.
      const firstTitle = `svc_admin1_${randomUUID()}`;
      const firstCount = await callBroadcast(
        tx,
        { title: firstTitle, body: null, audience: { type: BroadcastAudienceType.Role, role: UserRole.Teacher } },
        cast.admin.id,
        options,
        randomUUID()
      );
      expect(firstCount).toBe((await rowsByTitle(tx, firstTitle)).length);
      expect(firstCount).toBeGreaterThanOrEqual(1);
      const firstAdminAuditBefore = await broadcastAuditRowsFor(tx, cast.admin.id);
      expect(firstAdminAuditBefore).toHaveLength(1);

      // The seeded second admin passes the SAME real gate (live role read)
      // and lands its OWN audit row — never a mutation of the first row.
      const secondTitle = `svc_admin2_${randomUUID()}`;
      const secondCount = await callBroadcast(
        tx,
        { title: secondTitle, body: null, audience: { type: BroadcastAudienceType.Role, role: UserRole.Teacher } },
        seededAdmin.id,
        options,
        randomUUID()
      );
      expect(secondCount).toBe((await rowsByTitle(tx, secondTitle)).length);
      expect(secondCount).toBeGreaterThanOrEqual(1);

      const seededAuditAfter = await broadcastAuditRowsFor(tx, seededAdmin.id);
      const secondAdminNewRows = seededAuditAfter.filter(row => !seededAuditBeforeIds.has(row.id));
      expect(secondAdminNewRows).toHaveLength(1);
      const secondRow = secondAdminNewRows[0];
      expect(secondRow?.entityId).toBeNull();
      const secondMetadata: unknown = JSON.parse(secondRow?.details ?? "{}");
      expect(secondMetadata).toEqual({ scope: "role", role: "teacher", recipientCount: secondCount });

      // Append-only audit: the first admin's row is byte-identical after the
      // second admin's accepted broadcast — no cross-admin alteration.
      expect(await broadcastAuditRowsFor(tx, cast.admin.id)).toEqual(firstAdminAuditBefore);
    });
  });

  test("concurrent same-key race — sequential same-key submits yield ONE row-set; the parallel claim loser fails OPEN", async () => {
    await runInRollback(async tx => {
      const cast = await provisionCast(tx);
      const transportSpy = new SpiedFanoutTransport();
      const logs = recordDomainLogs();

      try {
        // Sequential leg (deterministic guarantee): the same key submitted
        // twice through a live cache collapses to ONE row-set — the second
        // submit replays the prior count with zero new rows / audit / publish.
        const sequentialCache = new ScriptedClaimCache();
        const seqTitle = `svc_race_seq_${randomUUID()}`;
        const seqInput: BroadcastNotificationSubmitInput = {
          title: seqTitle,
          body: null,
          audience: { type: BroadcastAudienceType.Role, role: UserRole.Teacher },
        };
        const seqKey = randomUUID();
        const seqFirst = await callBroadcast(
          tx,
          seqInput,
          cast.admin.id,
          { transport: transportSpy, cache: sequentialCache },
          seqKey
        );
        const seqSecond = await callBroadcast(
          tx,
          seqInput,
          cast.admin.id,
          { transport: transportSpy, cache: sequentialCache },
          seqKey
        );
        expect(seqSecond).toBe(seqFirst);
        expect(await rowsByTitle(tx, seqTitle)).toHaveLength(seqFirst);
        expect(seqFirst).toBeGreaterThanOrEqual(1);

        // Parallel leg: two concurrent submits race ONE key. The scripted
        // cache makes the in-flight window deterministic — the first claimant
        // wins; receipts only become storable after the held loser's cache
        // miss, so the loser reads NO receipt and takes the engine's
        // documented fail-open ladder (insert + audit + publish + ONE warn).
        const raceCache = new RaceWindowClaimCache();
        const raceTitle = `svc_race_par_${randomUUID()}`;
        const raceInput: BroadcastNotificationSubmitInput = {
          title: raceTitle,
          body: null,
          audience: { type: BroadcastAudienceType.Role, role: UserRole.Teacher },
        };
        const raceKey = randomUUID();
        const raceOutcomes = await Promise.allSettled([
          callBroadcast(tx, raceInput, cast.admin.id, { transport: transportSpy, cache: raceCache }, raceKey),
          callBroadcast(tx, raceInput, cast.admin.id, { transport: transportSpy, cache: raceCache }, raceKey),
        ]);
        for (const outcome of raceOutcomes) {
          expect(outcome.status).toBe("fulfilled");
        }
        const raceCounts = raceOutcomes.flatMap(outcome => (outcome.status === "fulfilled" ? [outcome.value] : []));
        // Every accepted emission landed EXACTLY one full cohort — the two
        // counts match the sequential cohort, and the title holds both
        // row-sets whole (never a partial or silent write).
        expect(raceCounts).toHaveLength(2);
        expect(raceCounts[0]).toBe(seqFirst);
        expect(raceCounts[1]).toBe(seqFirst);
        expect(await rowsByTitle(tx, raceTitle)).toHaveLength(2 * seqFirst);

        // The race produced two fresh emissions: two audit rows (one per
        // accepted emission, both attributed to the calling admin) and two
        // publish envelopes, on top of the sequential leg's one-of-each.
        expect(await broadcastAuditRowsFor(tx, cast.admin.id)).toHaveLength(3);
        expect(transportSpy.publishCount).toBe(3);

        // Exactly ONE degrade warn across the WHOLE test — the parallel
        // loser's documented fail-open posture; the sequential replay and the
        // winner log nothing.
        expect(logs.entries).toEqual([{ code: "NOTIFICATION_IDEMPOTENCY_DEGRADED", entity: "notifications" }]);
      } finally {
        logs.spy.mockRestore();
      }
    });
  });

  test("cache-claim outage fails OPEN — the broadcast still inserts, audits, publishes, with exactly ONE engine warn", async () => {
    await runInRollback(async tx => {
      const cast = await provisionCast(tx);
      const transportSpy = new SpiedFanoutTransport();
      const cache = new ScriptedClaimCache();
      cache.claimThrows = true;
      const options = { transport: transportSpy, cache };
      const logs = recordDomainLogs();
      const title = `svc_outage_${randomUUID()}`;

      try {
        const broadcastCount = await callBroadcast(
          tx,
          {
            title,
            body: null,
            audience: { type: BroadcastAudienceType.Role, role: UserRole.Teacher },
          },
          cast.admin.id,
          options,
          randomUUID()
        );

        const rows = await rowsByTitle(tx, title);
        expect(broadcastCount).toBe(rows.length);
        expect(rows.length).toBeGreaterThanOrEqual(1);
        expect(await broadcastAuditRowsFor(tx, cast.admin.id)).toHaveLength(1);
        expect(transportSpy.publishCount).toBe(1);

        // Exactly ONE degrade warn — the engine's own fail-open posture; the
        // broadcast surface itself still logs nothing.
        expect(logs.entries).toEqual([{ code: "NOTIFICATION_IDEMPOTENCY_DEGRADED", entity: "notifications" }]);
      } finally {
        logs.spy.mockRestore();
      }
    });
  });

  test("forced insert failure rolls the WHOLE unit back — zero notifications, zero audit, no publish", async () => {
    await runInRollback(async tx => {
      const cast = await provisionCast(tx);
      const transportSpy = new SpiedFanoutTransport();
      const options = { transport: transportSpy };
      const title = `svc_rollback_${randomUUID()}`;
      const input: BroadcastNotificationSubmitInput = {
        title,
        body: null,
        audience: { type: BroadcastAudienceType.Role, role: UserRole.Teacher },
      };

      const insertSpy = trackSpy(
        spyOn(NotificationRepository, "createManyReturning").mockImplementation(async () => {
          throw new Error("forced insert failure");
        })
      );
      const castNotificationsBefore = (
        await tx.select().from(notifications).where(eq(notifications.userId, cast.teacher.id))
      ).length;

      const error = await expectRepoError(() => callBroadcast(tx, input, cast.admin.id, options));

      expect(error).toBeInstanceOf(Error);
      expect(insertSpy).toHaveBeenCalledTimes(1);
      expect(await rowsByTitle(tx, title)).toHaveLength(0);
      expect(await broadcastAuditRowsFor(tx, cast.admin.id)).toHaveLength(0);
      expect(transportSpy.publishCount).toBe(0);

      // The SAVEPOINT rolled back — the outer transaction is still usable
      // (row total for cast is byte-identical to the pre-call snapshot).
      expect(await tx.select().from(notifications).where(eq(notifications.userId, cast.teacher.id))).toHaveLength(
        castNotificationsBefore
      );
    });
  });

  test("tx propagation + field-by-field mapping — reads ride the outer tx, writes share ONE savepoint, no spread", async () => {
    await runInRollback(async tx => {
      const cast = await provisionCast(tx);
      const plan = await createTestPlan(tx);
      const [activeSub] = await tx
        .insert(subscriptions)
        .values({
          userId: cast.student.id,
          planId: plan.id,
          status: "active",
          startDate: new Date(Date.now() - 24 * 60 * 60 * 1000),
          endDate: null,
        })
        .returning();
      if (!activeSub) {
        throw new Error("fixture: subscription insert returned no rows");
      }

      const transportSpy = new SpiedFanoutTransport();
      const options = { transport: transportSpy, cache: new ScriptedClaimCache() };
      const title = `svc_tx_${randomUUID()}`;
      const body = `svc_tx_body_${randomUUID()}`;
      const key = randomUUID();
      const input: BroadcastNotificationSubmitInput = {
        title,
        body,
        audience: { type: BroadcastAudienceType.Plan, planId: plan.id },
      };

      const gateSpy = trackSpy(spyOn(UserRepository, "findById"));
      const existsSpy = trackSpy(spyOn(PlanRepository, "existsById"));
      const resolveSpy = trackSpy(spyOn(BroadcastAudienceRepository, "resolveAudienceIds"));
      const emitSpy = trackSpy(spyOn(NotificationEngine, "emitForUsers"));
      const insertSpy = trackSpy(spyOn(NotificationRepository, "createManyReturning"));
      const auditSpy = trackSpy(spyOn(AuditService, "createAuditLog"));
      const publishSpy = trackSpy(spyOn(NotificationEngine, "publishReceipts"));

      const broadcastCount = await callBroadcast(tx, input, cast.admin.id, options, key);
      expect(broadcastCount).toBe(1);

      // Gate read: the CALLER's tx.
      expect(gateSpy).toHaveBeenCalledTimes(1);
      expect(gateSpy.mock.calls[0]?.[0]).toBe(cast.admin.id);
      expect(gateSpy.mock.calls[0]?.[1]).toBe(tx);

      // Plan-existence read: the CALLER's tx, the validated planId.
      expect(existsSpy).toHaveBeenCalledTimes(1);
      expect(existsSpy.mock.calls[0]?.[0]).toBe(plan.id);
      expect(existsSpy.mock.calls[0]?.[1]).toBe(tx);

      // Cohort read: the CALLER's tx, and a NORMALIZED selector — never the
      // raw input object passed through.
      expect(resolveSpy).toHaveBeenCalledTimes(1);
      const [resolvedSelector, resolveTx] = resolveSpy.mock.calls[0] ?? [];
      expect(resolveTx).toBe(tx);
      expect(resolvedSelector).toEqual({ type: BroadcastAudienceType.Plan, planId: plan.id });
      expect(resolvedSelector).not.toBe(input.audience);

      // Engine emit: field-by-field mapping, the SAVEPOINT tx, the options.
      expect(emitSpy).toHaveBeenCalledTimes(1);
      const [emitInput, emitLocale, emitTx, emitOptions] = emitSpy.mock.calls[0] ?? [];
      expect(emitInput).toEqual({
        userIds: [cast.student.id],
        type: NotificationType.SystemBroadcast,
        title,
        body,
        relatedEntityType: null,
        relatedEntityId: null,
        idempotencyKey: key,
      });
      expect(emitLocale).toBe(LOCALE);
      if (emitTx === undefined) {
        throw new Error("expected the engine emit to receive the service savepoint");
      }
      expect(emitTx).not.toBe(tx);
      expect(emitOptions).toBe(options);

      // Insert + audit: the SAME savepoint tx (one shared write unit).
      expect(insertSpy).toHaveBeenCalledTimes(1);
      const [inserts, insertTx] = insertSpy.mock.calls[0] ?? [];
      expect(inserts).toHaveLength(1);
      expect(insertTx).not.toBe(tx);

      expect(auditSpy).toHaveBeenCalledTimes(1);
      const [auditContract, auditTx] = auditSpy.mock.calls[0] ?? [];
      expect(auditContract).toEqual({
        actorId: cast.admin.id,
        actionType: AuditActionType.Create,
        entityType: AUDIT_ENTITY_TYPE,
        entityId: null,
        details: JSON.stringify({ scope: "plan", planId: plan.id, recipientCount: 1 }),
      });
      expect(auditTx).not.toBe(tx);
      // The audit row joins the SAME write unit the engine was handed — the
      // service's single savepoint transaction. The engine savepoints its
      // batch insert one level deeper inside that unit (its own documented
      // withTransaction nesting — consumed by reference, never bypassed);
      // unit atomicity is proven behaviorally by the forced-rollback test.
      expect(auditTx).toBe(emitTx);
      expect(insertTx).not.toBe(emitTx);

      // Publish-after-commit: the fresh receipt with the FULL recipient list.
      expect(publishSpy).toHaveBeenCalledTimes(1);
      const [publishedReceipts, publishLocale, publishOptions] = publishSpy.mock.calls[0] ?? [];
      expect(publishLocale).toBe(LOCALE);
      expect(publishOptions).toBe(options);
      const publishedReceipt = publishedReceipts?.[0];
      if (!publishedReceipt) {
        throw new Error("expected the post-commit publish to carry the fresh receipt");
      }
      expect(publishedReceipt.recipientUserIds).toEqual([cast.student.id]);
    });
  });

  test("verbatim copy storage — unicode / RTL / injection-shaped copy stored byte-for-byte and inert", async () => {
    await runInRollback(async tx => {
      const cast = await provisionCast(tx);
      const transportSpy = new SpiedFanoutTransport();
      const options = { transport: transportSpy, cache: new ScriptedClaimCache() };
      const unique = randomUUID();
      // Padded (leading/trailing spaces survive — validation is never
      // transformation) + Arabic RTL + emoji + zero-width joiner.
      const title = `  إعلان ${unique} — مرحباً 🌍\u200f  `;
      const body = `<script>alert("broadcast")</script> '; DROP TABLE users; -- % _ ${unique}`;

      const broadcastCount = await callBroadcast(
        tx,
        {
          title,
          body,
          audience: { type: BroadcastAudienceType.Role, role: UserRole.Student },
        },
        cast.admin.id,
        options,
        randomUUID()
      );

      const rows = await rowsByTitle(tx, title);
      expect(broadcastCount).toBe(rows.length);
      expect(rows.length).toBeGreaterThanOrEqual(1);
      for (const row of rows) {
        expect(row.title).toBe(title);
        expect(row.body).toBe(body);
        expect(row.type).toBe(NotificationType.SystemBroadcast);
      }

      // The injection-shaped copy changed nothing: the cast user rows remain intact.
      expect(await tx.select().from(users).where(eq(users.id, cast.student.id))).toHaveLength(1);
      expect(await tx.select().from(users).where(eq(users.id, cast.admin.id))).toHaveLength(1);
      expect(transportSpy.publishCount).toBe(1);
    });
  });
});
