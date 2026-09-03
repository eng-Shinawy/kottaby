/**
 * Journey — Admin broadcast cross-actor workflow (`adminBroadcastNotification`
 * emitter, specs §2.9 steps 1–10).
 *
 * Cross-actor journey through the REAL service layer against the real test
 * database: Admin A composes broadcasts over every cohort kind (`all`,
 * `role:teacher`, a run-unique country cohort, `plan:P`), a same-key replay is absorbed,
 * validation/BFLA denials change nothing, a governed (soft-deleted) cast
 * member appears in NO cohort, and every recipient observes the broadcast in
 * HIS OWN self-scoped inbox via `NotificationEngine.listMyNotifications`.
 * Authored TEST-FIRST — the suite is written against the service's PLANNED
 * API surface and stays RED (module-not-found) until task 2.4 lands
 * `AdminBroadcastService`; the import surface it pins is BINDING for 2.4:
 *
 *   import { AdminBroadcastService } from
 *     "@/backend/services/notifications/admin-broadcast.service";
 *
 *   AdminBroadcastService.broadcast(
 *     input: BroadcastNotificationSubmitInput,  // { title, body, audience }
 *     actorId: number,                          // real `users.id` (0 = anonymous)
 *     locale: string,                           // actor locale ("en")
 *   ): Promise<number>                          // persisted recipient count
 *
 * with the optional trailing parameters from plan §4.1 —
 * `idempotencyKey?: string` (gateway-captured UUID v4 compose-session key),
 * `options?: { transport?, cache? }` (REQ-024 injection seam) and
 * `outerTx?` (NOT passed by committed-fixture journeys — the service owns
 * its transactions).
 *
 * Step map (specs §2.9 ordered steps 1–10 — binding 1:1):
 *   0. System: committed fixture cast (A/T/S/Pa/S2/SX/G + plan P +
 *      active/expired subscriptions); every inbox empty
 *   1. Admin A fires `all` → rows for A/T/S/Pa/S2/SX, ZERO for G, ONE audit
 *      row (entityId=null, metadata only), ONE spied envelope (full id list)
 *   2. SAME-key replay → identical count, ZERO new rows/audit/publish
 *   3. `role:teacher` → only T gains a row (S/Pa/S2/SX byte-identical)
 *   4. targeted country cohort → only S gains a row (exact match, no LIKE semantics)
 *   5. `plan:P` → only the active-window subscriber S; EXPIRED-P student excluded
 *   6. Validation-family denials (title/coherence/hostile discriminants/
 *      empty cohort/unknown plan) → zero state change
 *   7. Teacher/Student/Parent + nonexistent actor → honest FORBIDDEN
 *   8. Anonymous (actorId=0) → UNAUTHORIZED
 *   9. Governed G is present in NO cohort result of ANY fired broadcast
 *  10. Post-hoc observers read their OWN inbox: type=system_broadcast,
 *      verbatim copy (Arabic/script-tag copy stored inertly),
 *      relatedEntityType/Id=null, isRead=false, no cross-cohort leakage
 *
 * Journey rules (test/workflows/AGENTS.md) honored:
 * - fixtures COMMITTED in `beforeAll` inside one committing transaction
 *   (commit-or-nothing) and hard-deleted in `afterAll` via `TrackedFixtures`
 *   (INCLUDING side-effect `notifications` + `audit_logs` rows, the plan, and
 *   the subscriptions, under `withAuditDeleteTriggersSuspended` for the audit
 *   deletes) with post-teardown existence checks; never `runInRollback`;
 * - actors provisioned by the actor-context factory — REAL `users` rows plus
 *   REAL role-child rows, so the service's admin gate and every denial
 *   resolve through the genuine authorization path (never monkey-patched
 *   permission resolution);
 * - the fan-out transport is SPIED at the service's REQ-024 injection seam
 *   (`SpiedFanoutTransport` as `options.transport`) and the idempotency claim
 *   cache is a scripted in-memory stand-in injected as `options.cache` —
 *   no Redis, no WebSocket frames, no email/SMS/push, ever;
 * - sequential actor-attributed steps in declaration order; every service
 *   call carries the acting user's real id;
 * - cross-actor visibility asserted both ways: every intended recipient sees
 *   the broadcast, every non-member's inbox stays byte-identical, and denial
 *   probes fail oracle-safely through the real authorization path.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db } from "@/backend/db";
import { auditLogs } from "@/backend/db/schema/audit/audit-logs";
import { plans } from "@/backend/db/schema/billing/plans";
import { subscriptions } from "@/backend/db/schema/billing/subscriptions";
import { notifications } from "@/backend/db/schema/notifications/notifications";
import { users } from "@/backend/db/schema/users/users";
import { createTestPlan } from "@/backend/db/test/entity-setup";
import { AuditActionType } from "@/backend/enum/audit/audit-action-type.enum";
import { BroadcastAudienceType } from "@/backend/enum/notifications/broadcast-audience-type.enum";
import { NotificationType } from "@/backend/enum/notifications/notification-type.enum";
import { UserRole } from "@/backend/enum/users/user-role.enum";
import { ForbiddenError, NotFoundError, UnauthorizedError, ValidationError } from "@/backend/lib/errors";
// RED until task 2.4 lands the composition core (intended test-first failure):
import { AdminBroadcastService } from "@/backend/services/notifications/admin-broadcast.service";
import type { NotificationIdempotencyClaimCache } from "@/backend/services/notifications/emit-idempotency";
import { NotificationEngine } from "@/backend/services/notifications/notification-engine.service";
import type { BroadcastNotificationSubmitInput, NotificationListFilterInput, PlanSelectType } from "@/backend/types";
import { getServerTranslations } from "@/shared/locale/server-graphql";
// Deep import (same rationale as journey-cleanup — the test/helpers barrel
// pulls the Apollo test client into backend-only graphs).
import { withAuditDeleteTriggersSuspended } from "@/test/helpers/db-cleanup";
import {
  type JourneyActor,
  provisionAdminActor,
  provisionCertifiedTeacherActor,
  provisionParentActor,
  provisionStudentActor,
  SpiedFanoutTransport,
  TrackedFixtures,
} from "@/test/workflows/helpers";

/** Per-run unique prefix so repeated or parallel runs never collide. */
const runPrefix = `jrn_broadcast_${randomUUID().slice(0, 8)}`;

/**
 * Broadcast copy — every title embeds the run prefix, so each fired broadcast
 * is uniquely identifiable in the shared `notifications` table (other suites
 * and seeded rows can never collide with it) and the DB serves as the
 * row-level oracle for "exactly the rows this broadcast created".
 */
const ALL_TITLE = `${runPrefix}: Platform maintenance window on Sunday`;
const ALL_BODY = `${runPrefix}: The platform will be briefly unavailable on Sunday at 02:00 UTC.`;
const TEACHER_TITLE = `${runPrefix}: New timetable tools for teachers`;
const TEACHER_BODY = `${runPrefix}: Timetable export and bulk-shift tools ship this week.`;
const EG_TITLE = `${runPrefix}: Egypt cohort announcement`;
/**
 * Run-unique country sentinel for the targeted-country cohort: exact `eq`
 * matching must resolve ONLY the rows sharing this value, so a value no
 * other suite, fixture, or seed can hold keeps the cohort deterministic in
 * the shared database (any literal like "EG" collides with committed rows).
 */
const COHORT_COUNTRY = `QT${randomUUID().replace(/-/g, "").slice(0, 10).toUpperCase()}`;
const PLAN_TITLE = `${runPrefix}: إعلان تحديث خطة الاشتراك`;
const PLAN_BODY = `<script>alert("broadcast")</script> ${runPrefix}: subscription update stored inertly.`;

/** Idempotency keys — UUID v4 per compose-session, mirroring the gateway header. */
const ALL_KEY = randomUUID();
const TEACHER_KEY = randomUUID();
const EG_KEY = randomUUID();
const PLAN_KEY = randomUUID();

/** The audit entityType the service writes for every accepted broadcast (REQ-021). */
const AUDIT_ENTITY_TYPE = "notification_broadcast";

/** Shared inbox window — every observer list read uses the same first page. */
const INBOX_PAGE: NotificationListFilterInput = { limit: 50, offset: 0 };

/** English translated copy — denial assertions pin translated substrings, never hardcoded English. */
const EN_ERRORS = getServerTranslations("en").errorsTranslations;

/** A user id that cannot exist in the test database (positive safe int, far beyond any sequence). */
const NONEXISTENT_USER_ID = 2_000_000_000;

/** A plan id that cannot exist in the test database (admin-surface oracle probe). */
const NONEXISTENT_PLAN_ID = 2_000_000_000;

/** One persisted broadcast audit row, as the journey reads it back. */
interface BroadcastAuditRow {
  readonly id: number;
  readonly actionType: string;
  readonly entityId: number | null;
  readonly details: string | null;
}

/** One pre-DB denial probe: the hostile input plus its exact expected contract. */
interface ValidationProbeCase {
  readonly input: BroadcastNotificationSubmitInput;
  readonly expectedCode: string;
  readonly expectedMessage: string;
}

/** One claim-cache entry: the claimed/stored value plus its wall-clock expiry. */
interface ClaimEntry {
  readonly expiresAt: number;
  readonly value: string;
}

/**
 * Scripted in-memory SET-NX-EX claim cache — the journey's stand-in for the
 * engine's injected idempotency-claim port, passed to every broadcast call
 * through the REQ-024 seam's `cache` slot:
 *  - `claim(key, ttlSeconds)` mirrors atomic SET NX EX — `true` when this
 *    caller won the claim, `false` when the key is already held;
 *  - `store(key, value, ttlSeconds)` mirrors SET-with-TTL — the engine
 *    attaches the delivery receipt after the insert commits;
 *  - `get(key)` mirrors GET — the prior receipt for an already-claimed key.
 * TTL is honored via wall-clock expiry; no Redis is ever touched.
 */
class InMemoryClaimCache implements NotificationIdempotencyClaimCache {
  private readonly entries = new Map<string, ClaimEntry>();

  async claim(key: string, ttlSeconds: number): Promise<boolean> {
    const entry = this.entries.get(key);
    if (entry !== undefined && entry.expiresAt > Date.now()) {
      return false; // already claimed — duplicate emission
    }
    this.entries.set(key, { expiresAt: Date.now() + ttlSeconds * 1000, value: "" });
    return true; // claim won — proceed with the write
  }

  async store(key: string, value: string, ttlSeconds: number): Promise<void> {
    this.entries.set(key, { expiresAt: Date.now() + ttlSeconds * 1000, value });
  }

  async get(key: string): Promise<string | null> {
    const entry = this.entries.get(key);
    if (entry === undefined || entry.expiresAt <= Date.now()) {
      return null;
    }
    return entry.value;
  }
}

/**
 * Try/catch rejection helper (journey-layer pattern —
 * `expect(...).rejects.toThrow()` is prohibited). Returns the caught error;
 * fails the test when the call resolves successfully.
 */
async function expectJourneyError(fn: () => Promise<unknown>): Promise<Error> {
  let errorCaught: unknown = null;
  try {
    await fn();
  } catch (error) {
    errorCaught = error;
  }
  if (errorCaught === null) {
    throw new Error("expected the call to throw, but it resolved successfully");
  }
  if (errorCaught instanceof Error) {
    return errorCaught;
  }
  return new Error(`[non-Error throw: ${typeof errorCaught}]`);
}

/**
 * Assertion + type-guard in one step: narrows `value` to the constructor's
 * instance type after the bun:test instanceof check (type-guard discipline
 * per docs/quality/linting-rules.md — no unsafe `as` narrowing).
 */
function expectInstanceOf<T extends abstract new (...args: never) => object>(
  value: unknown,
  ctor: T
): asserts value is InstanceType<T> {
  expect(value).toBeInstanceOf(ctor);
}

/** JSON-object guard (docs/quality/linting-rules.md — no-unsafe-type-assertion). */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Direct repo-less inbox row count for one recipient. */
async function inboxRowCount(userId: number): Promise<number> {
  return db.$count(notifications, eq(notifications.userId, userId));
}

/** The persisted broadcast rows (id + recipient) created under one run-unique title. */
async function broadcastRowsByTitle(title: string): Promise<readonly { id: number; userId: number }[]> {
  return db
    .select({ id: notifications.id, userId: notifications.userId })
    .from(notifications)
    .where(eq(notifications.title, title));
}

/**
 * The audit rows written so far for broadcast-entity actions by one actor.
 * Callers keep a known-id set and treat only the diff as "new" — robust
 * against any pre-existing broadcast audit rows in the shared test database.
 */
async function broadcastAuditRows(actorId: number): Promise<readonly BroadcastAuditRow[]> {
  return db
    .select({
      id: auditLogs.id,
      actionType: auditLogs.actionType,
      entityId: auditLogs.entityId,
      details: auditLogs.details,
    })
    .from(auditLogs)
    .where(and(eq(auditLogs.actorId, actorId), eq(auditLogs.entityType, AUDIT_ENTITY_TYPE)));
}

describe("Journey — Admin broadcast cross-actor workflow (specs §2.9 steps 1–10)", () => {
  const tracked = new TrackedFixtures();
  const transportSpy = new SpiedFanoutTransport();
  const claimCache = new InMemoryClaimCache();

  /** REQ-024 injection seam installed on every service call in this journey. */
  const callOptions = { transport: transportSpy, cache: claimCache };

  /** Audit row ids already attributed to this journey (baseline + captured). */
  const knownAuditIds = new Set<number>();

  /**
   * Recursively probes the pre-DB denial matrix without await-in-loop: every
   * case must reject as a `ValidationError` carrying its documented custom
   * code and the localized English substring.
   */
  async function probeValidationCases(cases: readonly ValidationProbeCase[], index: number): Promise<void> {
    if (index >= cases.length) {
      return;
    }
    const probeCase = cases[index];
    if (!probeCase) {
      throw new Error(`validation probe case ${index} is missing`);
    }
    const error = await expectJourneyError(() =>
      AdminBroadcastService.broadcast(probeCase.input, adminA.userId, adminA.locale, randomUUID(), callOptions)
    );
    expectInstanceOf(error, ValidationError);
    expect(error.code).toBe(probeCase.expectedCode);
    expect(error.message).toContain(probeCase.expectedMessage);
    await probeValidationCases(cases, index + 1);
  }

  let adminA: JourneyActor;
  let teacherT: JourneyActor;
  let studentS: JourneyActor;
  let parentPa: JourneyActor;
  let studentS2: JourneyActor;
  let studentExpired: JourneyActor;
  let governedG: JourneyActor;
  let planP: PlanSelectType;

  /** Count returned by the step-1 `all` broadcast (the replay must match it exactly). */
  let allBroadcastCount = 0;

  beforeAll(async () => {
    // One COMMITTING transaction: provisioning is commit-or-nothing, so a
    // throwing setup rolls back and leaves nothing behind.
    await db.transaction(async tx => {
      adminA = await provisionAdminActor(tx, { tracked });
      teacherT = await provisionCertifiedTeacherActor(tx, { tracked });
      studentS = await provisionStudentActor(tx, { tracked });
      parentPa = await provisionParentActor(tx, { tracked });
      studentS2 = await provisionStudentActor(tx, { tracked });
      studentExpired = await provisionStudentActor(tx, { tracked });
      governedG = await provisionParentActor(tx, { tracked });

      // Cohort attributes are fixture state, not permissions: explicit
      // field-mapped updates (never a spread), still inside the one setup tx.
      await tx.update(users).set({ country: COHORT_COUNTRY }).where(eq(users.id, studentS.userId));
      await tx.update(users).set({ country: "US" }).where(eq(users.id, studentS2.userId));
      await tx.update(users).set({ country: "US" }).where(eq(users.id, studentExpired.userId));
      // The governed cast member: soft-deleted AND holding the cohort country,
      // so the targeted-country cohort proves governance exclusion WITHIN a
      // targeted cohort, not just in the widest `all` cohort (step 9).
      await tx.update(users).set({ country: COHORT_COUNTRY, isDeleted: true }).where(eq(users.id, governedG.userId));

      planP = await createTestPlan(tx);
      tracked.register(plans, planP.id);

      // Active-window subscriber: status active, start in the past, open end.
      const [activeSub] = await tx
        .insert(subscriptions)
        .values({
          userId: studentS.userId,
          planId: planP.id,
          status: "active",
          startDate: new Date(Date.now() - 24 * 60 * 60 * 1000),
          endDate: null,
        })
        .returning();
      if (!activeSub) {
        throw new Error("fixture: active subscription insert returned no rows");
      }
      tracked.register(subscriptions, activeSub.id);

      // EXPIRED subscriber: status still active but the WINDOW has lapsed —
      // this isolates the strict `now() < end_date` predicate (step 5).
      const [expiredSub] = await tx
        .insert(subscriptions)
        .values({
          userId: studentExpired.userId,
          planId: planP.id,
          status: "active",
          startDate: new Date(Date.now() - 48 * 60 * 60 * 1000),
          endDate: new Date(Date.now() - 24 * 60 * 60 * 1000),
        })
        .returning();
      if (!expiredSub) {
        throw new Error("fixture: expired subscription insert returned no rows");
      }
      tracked.register(subscriptions, expiredSub.id);
    });
  });

  afterAll(async () => {
    // Audit-row deletes run under the trigger-suspension wrapper (migrate-
    // provisioned databases install an append-only immutability trigger on
    // audit_logs); the wrapper restores every trigger's exact prior state.
    // TrackedFixtures then hard-deletes in REVERSE registration order —
    // notifications/audit rows first, subscriptions → plan → role-children →
    // users last (FK-safe by construction) — and re-probes EVERY registered
    // row so zero residue is load-bearing, not advisory.
    await withAuditDeleteTriggersSuspended(async () => {
      const registered = [...tracked.records];
      const report = await tracked.cleanup();
      expect(report.deletedCount).toBe(registered.length);
      expect(report.verifiedAbsentCount).toBe(registered.length);
      const stillPresent = await Promise.all(registered.map(record => tracked.exists(record)));
      expect(stillPresent.every(present => !present)).toBe(true);
    });
  });

  /** Registers every notification row created under `title` for teardown. */
  async function trackBroadcastRows(title: string): Promise<void> {
    const rows = await broadcastRowsByTitle(title);
    for (const row of rows) {
      tracked.register(notifications, row.id);
    }
  }

  /**
   * Captures the audit rows the service just wrote (diff against the
   * known-id baseline) and registers them for teardown.
   */
  async function captureNewAuditRows(): Promise<readonly BroadcastAuditRow[]> {
    const rows = await broadcastAuditRows(adminA.userId);
    const fresh = rows.filter(row => !knownAuditIds.has(row.id));
    for (const row of fresh) {
      knownAuditIds.add(row.id);
      tracked.register(auditLogs, row.id);
    }
    return fresh;
  }

  /** Asserts one accepted broadcast produced EXACTLY ONE honest audit row. */
  async function expectOneAuditRow(
    title: string,
    scope: string,
    count: number,
    companions: Record<string, unknown>
  ): Promise<void> {
    const fresh = await captureNewAuditRows();
    expect(fresh).toHaveLength(1);
    const row = fresh[0];
    if (!row) {
      throw new Error("expected exactly one audit row for the fresh broadcast");
    }
    const expectedActionType: string = AuditActionType.Create;
    expect(row.actionType).toBe(expectedActionType);
    // A broadcast has no single backing entity — DB-5's null entityId.
    expect(row.entityId).toBeNull();
    // Metadata only: scope + companions + recipient count, NEVER copy text.
    const parsed: unknown = JSON.parse(row.details ?? "{}");
    if (!isRecord(parsed)) {
      throw new Error("audit details must be a JSON object");
    }
    const metadata = parsed;
    expect(metadata.scope).toBe(scope);
    expect(metadata.recipientCount).toBe(count);
    for (const key of Object.keys(companions)) {
      expect(metadata[key]).toEqual(companions[key]);
    }
    expect(JSON.stringify(parsed)).not.toContain(title);
  }

  /** Asserts the per-actor inbox row counts in one parallel sweep. */
  async function expectInboxCounts(expectations: readonly (readonly [JourneyActor, number])[]): Promise<void> {
    const counts = await Promise.all(expectations.map(([actor]) => inboxRowCount(actor.userId)));
    for (const [index, [actor, expected]] of expectations.entries()) {
      const count = counts[index];
      expect(count).toBe(expected);
      if (count !== expected) {
        throw new Error(`inbox count mismatch for actor ${actor.userId}`);
      }
    }
  }

  test("step 0 — System: committed fixture cast, plan P and subscriptions; every inbox empty", async () => {
    // 7 actors × (users row + role-child row) + plan + 2 subscriptions.
    expect(tracked.size).toBe(17);

    // The governed cast member is honestly soft-deleted (real column state).
    const governed = await db
      .select({ isDeleted: users.isDeleted, country: users.country })
      .from(users)
      .where(eq(users.id, governedG.userId));
    expect(governed[0]?.isDeleted).toBe(true);
    expect(governed[0]?.country).toBe(COHORT_COUNTRY);

    await expectInboxCounts([
      [adminA, 0],
      [teacherT, 0],
      [studentS, 0],
      [parentPa, 0],
      [studentS2, 0],
      [studentExpired, 0],
      [governedG, 0],
    ]);
    expect(transportSpy.publishCount).toBe(0);
  });

  test("step 1 — Admin A fires `all`: every governed cast member gains a row, G excluded, ONE audit row, ONE envelope", async () => {
    const input: BroadcastNotificationSubmitInput = {
      title: ALL_TITLE,
      body: ALL_BODY,
      audience: { type: BroadcastAudienceType.All },
    };

    allBroadcastCount = await AdminBroadcastService.broadcast(
      input,
      adminA.userId,
      adminA.locale,
      ALL_KEY,
      callOptions
    );
    await trackBroadcastRows(ALL_TITLE);

    // The returned count is the persisted recipient count — exactly the rows
    // the broadcast created (run-unique title = DB oracle), at least the six
    // governed cast members (A/T/S/Pa/S2/SX).
    const rows = await broadcastRowsByTitle(ALL_TITLE);
    expect(allBroadcastCount).toBe(rows.length);
    expect(rows.length).toBeGreaterThanOrEqual(6);
    const recipientIds = new Set(rows.map(row => row.userId));
    for (const actor of [adminA, teacherT, studentS, parentPa, studentS2, studentExpired]) {
      expect(recipientIds.has(actor.userId)).toBe(true);
    }
    // Governed exclusion (REQ-015): the soft-deleted cast member got NOTHING.
    expect(recipientIds.has(governedG.userId)).toBe(false);

    await expectInboxCounts([
      [adminA, 1],
      [teacherT, 1],
      [studentS, 1],
      [parentPa, 1],
      [studentS2, 1],
      [studentExpired, 1],
      [governedG, 0],
    ]);

    // Exactly ONE audit row: create / null entity / metadata only.
    await expectOneAuditRow(ALL_TITLE, "all", allBroadcastCount, {});

    // Exactly ONE spied fan-out envelope carrying the FULL recipient list.
    expect(transportSpy.publishCount).toBe(1);
    const publish = transportSpy.lastCall;
    if (!publish) {
      throw new Error("expected the spied transport to record the broadcast publish");
    }
    expect([...publish.userIds].toSorted((a, b) => a - b)).toEqual(
      rows.map(row => row.userId).toSorted((a, b) => a - b)
    );
    expect(publish.userIds).not.toContain(governedG.userId);
    expect(publish.payload.v).toBe(1);
    expect(publish.payload.kind).toBe("notification");
    expect(publish.payload.data.type).toBe(NotificationType.SystemBroadcast);
    expect(publish.payload.data.title).toBe(ALL_TITLE);
    expect(publish.payload.data.relatedEntityType).toBeNull();
    expect(publish.payload.data.relatedEntityId).toBeNull();
  });

  test("step 2 — SAME-key replay: identical count, ZERO new rows / audit rows / publishes", async () => {
    const input: BroadcastNotificationSubmitInput = {
      title: ALL_TITLE,
      body: ALL_BODY,
      audience: { type: BroadcastAudienceType.All },
    };

    const replayCount = await AdminBroadcastService.broadcast(
      input,
      adminA.userId,
      adminA.locale,
      ALL_KEY,
      callOptions
    );

    // Identical count — the stored prior receipt is returned structurally.
    expect(replayCount).toBe(allBroadcastCount);

    // Inbox rows unchanged everywhere (the replay wrote nothing).
    await expectInboxCounts([
      [adminA, 1],
      [teacherT, 1],
      [studentS, 1],
      [parentPa, 1],
      [studentS2, 1],
      [studentExpired, 1],
      [governedG, 0],
    ]);
    const rows = await broadcastRowsByTitle(ALL_TITLE);
    expect(rows).toHaveLength(allBroadcastCount);

    // Zero new audit rows and zero new fan-out envelopes.
    const freshAudit = await captureNewAuditRows();
    expect(freshAudit).toHaveLength(0);
    expect(transportSpy.publishCount).toBe(1);
  });

  test("step 3 — Admin A fires `role:teacher`: only T gains a row; S/Pa/S2/SX stay byte-identical", async () => {
    const input: BroadcastNotificationSubmitInput = {
      title: TEACHER_TITLE,
      body: TEACHER_BODY,
      audience: { type: BroadcastAudienceType.Role, role: UserRole.Teacher },
    };

    const count = await AdminBroadcastService.broadcast(input, adminA.userId, adminA.locale, TEACHER_KEY, callOptions);
    await trackBroadcastRows(TEACHER_TITLE);

    const rows = await broadcastRowsByTitle(TEACHER_TITLE);
    expect(count).toBe(rows.length);
    const recipientIds = new Set(rows.map(row => row.userId));
    expect(recipientIds.has(teacherT.userId)).toBe(true);
    for (const outsider of [studentS, parentPa, studentS2, studentExpired]) {
      expect(recipientIds.has(outsider.userId)).toBe(false);
    }
    expect(recipientIds.has(governedG.userId)).toBe(false);

    await expectInboxCounts([
      [adminA, 1],
      [teacherT, 2],
      [studentS, 1],
      [parentPa, 1],
      [studentS2, 1],
      [studentExpired, 1],
      [governedG, 0],
    ]);

    await expectOneAuditRow(TEACHER_TITLE, "role", count, { role: UserRole.Teacher });

    // Exactly one NEW envelope, targeted at the role cohort (T + any seeded
    // teachers — asserted against the DB oracle, not a hardcoded list).
    expect(transportSpy.publishCount).toBe(2);
    const publish = transportSpy.lastCall;
    if (!publish) {
      throw new Error("expected the spied transport to record the role-cohort publish");
    }
    expect([...publish.userIds].toSorted((a, b) => a - b)).toEqual(
      rows.map(row => row.userId).toSorted((a, b) => a - b)
    );
    expect(publish.payload.data.title).toBe(TEACHER_TITLE);
  });

  test("step 4 — Admin A fires a targeted country cohort: only S gains a row (exact equality; committed foreign-country rows unaffected)", async () => {
    const input: BroadcastNotificationSubmitInput = {
      title: EG_TITLE,
      body: null,
      audience: { type: BroadcastAudienceType.Country, country: COHORT_COUNTRY },
    };

    const count = await AdminBroadcastService.broadcast(input, adminA.userId, adminA.locale, EG_KEY, callOptions);
    await trackBroadcastRows(EG_TITLE);

    const rows = await broadcastRowsByTitle(EG_TITLE);
    expect(count).toBe(rows.length);
    // The cohort is exactly student S: exact `eq` matching means every
    // committed row holding any other country (seeded or fixture) is outside,
    // and the governed same-country cast member is governance-excluded.
    expect(rows.map(row => row.userId)).toEqual([studentS.userId]);
    expect(count).toBe(1);

    await expectInboxCounts([
      [adminA, 1],
      [teacherT, 2],
      [studentS, 2],
      [parentPa, 1],
      [studentS2, 1],
      [studentExpired, 1],
      [governedG, 0],
    ]);

    await expectOneAuditRow(EG_TITLE, "country", count, { country: COHORT_COUNTRY });

    expect(transportSpy.publishCount).toBe(3);
    const publish = transportSpy.lastCall;
    if (!publish) {
      throw new Error("expected the spied transport to record the country-cohort publish");
    }
    expect(publish.userIds).toEqual([studentS.userId]);
    expect(publish.payload.data.title).toBe(EG_TITLE);
  });

  test("step 5 — Admin A fires `plan:P`: only the active-window subscriber S; the EXPIRED-P student excluded", async () => {
    const input: BroadcastNotificationSubmitInput = {
      title: PLAN_TITLE,
      body: PLAN_BODY,
      audience: { type: BroadcastAudienceType.Plan, planId: planP.id },
    };

    const count = await AdminBroadcastService.broadcast(input, adminA.userId, adminA.locale, PLAN_KEY, callOptions);
    await trackBroadcastRows(PLAN_TITLE);

    const rows = await broadcastRowsByTitle(PLAN_TITLE);
    expect(count).toBe(rows.length);
    // Active-window predicate (canonical, strict `now() < end_date`): the
    // expired-window subscriber is NOT resolved even though its status row
    // still says active.
    expect(rows.map(row => row.userId)).toEqual([studentS.userId]);
    expect(count).toBe(1);

    await expectInboxCounts([
      [adminA, 1],
      [teacherT, 2],
      [studentS, 3],
      [parentPa, 1],
      [studentS2, 1],
      [studentExpired, 1],
      [governedG, 0],
    ]);

    await expectOneAuditRow(PLAN_TITLE, "plan", count, { planId: planP.id });

    expect(transportSpy.publishCount).toBe(4);
    const publish = transportSpy.lastCall;
    if (!publish) {
      throw new Error("expected the spied transport to record the plan-cohort publish");
    }
    expect(publish.userIds).toEqual([studentS.userId]);
    expect(publish.payload.data.title).toBe(PLAN_TITLE);
  });

  test("step 6 — validation-family denials + hostile discriminants + empty cohort + unknown plan: DB untouched", async () => {
    const rowsBefore = await broadcastRowsByTitle(ALL_TITLE);
    const auditBefore = (await broadcastAuditRows(adminA.userId)).length;
    const publishCountBefore = transportSpy.publishCount;

    // Hostile audience discriminant: a string that is NOT an enum member is
    // rejected by the fail-closed coherence check (the JSON-decoded probe
    // documents the raw transport wire — the service must never trust it).
    const hostileType: BroadcastAudienceType = JSON.parse('"role; DROP TABLE users"');

    const cases: readonly ValidationProbeCase[] = [
      // Title defects (REQ-020): empty after trim, and over the 255 ceiling.
      {
        input: { title: "   ", body: ALL_BODY, audience: { type: BroadcastAudienceType.Role, role: UserRole.Teacher } },
        expectedCode: "BROADCAST_TITLE_INVALID",
        expectedMessage: EN_ERRORS.broadcastTitleInvalid,
      },
      {
        input: {
          title: "T".repeat(256),
          body: ALL_BODY,
          audience: { type: BroadcastAudienceType.Role, role: UserRole.Teacher },
        },
        expectedCode: "BROADCAST_TITLE_INVALID",
        expectedMessage: EN_ERRORS.broadcastTitleInvalid,
      },
      // Coherence matrix (REQ-010): companion missing / mismatched / on `all`.
      {
        input: { title: TEACHER_TITLE, body: ALL_BODY, audience: { type: BroadcastAudienceType.Role } },
        expectedCode: "BROADCAST_AUDIENCE_INVALID",
        expectedMessage: EN_ERRORS.broadcastAudienceInvalid,
      },
      {
        input: {
          title: TEACHER_TITLE,
          body: ALL_BODY,
          audience: { type: BroadcastAudienceType.Role, role: UserRole.Teacher, country: "EG" },
        },
        expectedCode: "BROADCAST_AUDIENCE_INVALID",
        expectedMessage: EN_ERRORS.broadcastAudienceInvalid,
      },
      {
        input: {
          title: TEACHER_TITLE,
          body: ALL_BODY,
          audience: { type: BroadcastAudienceType.All, role: UserRole.Admin },
        },
        expectedCode: "BROADCAST_AUDIENCE_INVALID",
        expectedMessage: EN_ERRORS.broadcastAudienceInvalid,
      },
      {
        input: { title: EG_TITLE, body: ALL_BODY, audience: { type: BroadcastAudienceType.Country, country: "   " } },
        expectedCode: "BROADCAST_AUDIENCE_INVALID",
        expectedMessage: EN_ERRORS.broadcastAudienceInvalid,
      },
      // Malformed planId (REQ-014): zero is not a positive safe integer.
      {
        input: { title: PLAN_TITLE, body: PLAN_BODY, audience: { type: BroadcastAudienceType.Plan, planId: 0 } },
        expectedCode: "BROADCAST_AUDIENCE_INVALID",
        expectedMessage: EN_ERRORS.broadcastAudienceInvalid,
      },
      // Hostile discriminant (fail-closed guard, never string-trusted).
      {
        input: { title: TEACHER_TITLE, body: ALL_BODY, audience: { type: hostileType } },
        expectedCode: "BROADCAST_AUDIENCE_INVALID",
        expectedMessage: EN_ERRORS.broadcastAudienceInvalid,
      },
    ];

    await probeValidationCases(cases, 0);

    // The empty-cohort probe is validated coherently, then rejected post-
    // resolution with its own localized code and ZERO writes (REQ-018).
    const emptyError = await expectJourneyError(() =>
      AdminBroadcastService.broadcast(
        {
          title: EG_TITLE,
          body: ALL_BODY,
          audience: { type: BroadcastAudienceType.Country, country: `EMPTY-${randomUUID()}` },
        },
        adminA.userId,
        adminA.locale,
        randomUUID(),
        callOptions
      )
    );
    expectInstanceOf(emptyError, ValidationError);
    expect(emptyError.code).toBe("BROADCAST_AUDIENCE_EMPTY");
    expect(emptyError.message).toContain(EN_ERRORS.broadcastAudienceEmpty);

    // Unknown planId on an admin-gated surface → PLAN_NOT_FOUND (REQ-033
    // admin-oracle ruling), still zero writes.
    const planError = await expectJourneyError(() =>
      AdminBroadcastService.broadcast(
        {
          title: PLAN_TITLE,
          body: PLAN_BODY,
          audience: { type: BroadcastAudienceType.Plan, planId: NONEXISTENT_PLAN_ID },
        },
        adminA.userId,
        adminA.locale,
        randomUUID(),
        callOptions
      )
    );
    expectInstanceOf(planError, NotFoundError);
    expect(planError.code).toBe("PLAN_NOT_FOUND");
    expect(planError.message).toContain(EN_ERRORS.planCatalog.planNotFound);

    // Denials append ZERO rows, ZERO audit entries, ZERO publishes (JR-C-1).
    const rowsAfter = await broadcastRowsByTitle(ALL_TITLE);
    expect(rowsAfter).toHaveLength(rowsBefore.length);
    expect(await broadcastAuditRows(adminA.userId)).toHaveLength(auditBefore);
    expect(transportSpy.publishCount).toBe(publishCountBefore);
  });

  test("step 7 — Teacher/Student/Parent (and a nonexistent actor) hit the real admin gate: FORBIDDEN, zero state", async () => {
    const input: BroadcastNotificationSubmitInput = {
      title: TEACHER_TITLE,
      body: TEACHER_BODY,
      audience: { type: BroadcastAudienceType.Role, role: UserRole.Teacher },
    };
    const rowsBefore = await broadcastRowsByTitle(TEACHER_TITLE);
    const auditBefore = (await broadcastAuditRows(adminA.userId)).length;
    const publishCountBefore = transportSpy.publishCount;

    // The attempt flows through the REAL authorization path: the service's
    // admin gate resolves the actor's real `users` row (never monkey-patched)
    // and denies pre-transaction with the honest FORBIDDEN contract. The
    // denials are write-free, so the three probes run as one parallel wave.
    const denials = await Promise.all(
      [teacherT, studentS, parentPa].map(actor =>
        expectJourneyError(() =>
          AdminBroadcastService.broadcast(input, actor.userId, actor.locale, randomUUID(), callOptions)
        )
      )
    );
    for (const error of denials) {
      expectInstanceOf(error, ForbiddenError);
      expect(error.code).toBe("FORBIDDEN");
      expect(error.message).toContain(EN_ERRORS.forbidden);
    }

    // A well-formed actor id that resolves to NO row denies identically
    // (missing row → ForbiddenError per the assertActorAdmin discipline).
    const missingActorError = await expectJourneyError(() =>
      AdminBroadcastService.broadcast(input, NONEXISTENT_USER_ID, adminA.locale, randomUUID(), callOptions)
    );
    expectInstanceOf(missingActorError, ForbiddenError);
    expect(missingActorError.code).toBe("FORBIDDEN");

    // Zero shared state changed: no rows, no audit, no publish.
    expect(await broadcastRowsByTitle(TEACHER_TITLE)).toHaveLength(rowsBefore.length);
    expect(await broadcastAuditRows(adminA.userId)).toHaveLength(auditBefore);
    expect(transportSpy.publishCount).toBe(publishCountBefore);
    await expectInboxCounts([
      [teacherT, 2],
      [studentS, 3],
      [parentPa, 1],
    ]);
  });

  test("step 8 — Anonymous caller (actorId=0): UNAUTHORIZED, zero state", async () => {
    const input: BroadcastNotificationSubmitInput = {
      title: ALL_TITLE,
      body: ALL_BODY,
      audience: { type: BroadcastAudienceType.All },
    };
    const auditBefore = (await broadcastAuditRows(adminA.userId)).length;

    const error = await expectJourneyError(() =>
      AdminBroadcastService.broadcast(input, 0, adminA.locale, randomUUID(), callOptions)
    );
    expectInstanceOf(error, UnauthorizedError);
    expect(error.code).toBe("UNAUTHORIZED");
    expect(error.message).toContain(EN_ERRORS.unauthorized);

    // Zero writes, zero audit, zero publish on the anonymous denial.
    expect(await broadcastAuditRows(adminA.userId)).toHaveLength(auditBefore);
    expect(transportSpy.publishCount).toBe(4);
    await expectInboxCounts([
      [adminA, 1],
      [governedG, 0],
    ]);
  });

  test("step 9 — Governed G appears in NO cohort result of ANY broadcast fired above", async () => {
    // G holds the cohort country and a parent role-child row, so the
    // targeted-country cohort (step 4) proves governance exclusion INSIDE a
    // targeted cohort, while `all` (step 1) proves it for the widest cohort.
    // The plan cohort never resolved G (no subscription) and the role cohort
    // never resolved G (parent role-child). Every envelope is checked.
    for (const publish of transportSpy.calls) {
      expect(publish.userIds).not.toContain(governedG.userId);
    }
    const governedRowSets = await Promise.all(
      [ALL_TITLE, TEACHER_TITLE, EG_TITLE, PLAN_TITLE].map(title => broadcastRowsByTitle(title))
    );
    for (const rows of governedRowSets) {
      expect(rows.some(row => row.userId === governedG.userId)).toBe(false);
    }
    // G's inbox stayed byte-identical (EMPTY) across the whole journey.
    expect(await inboxRowCount(governedG.userId)).toBe(0);

    // Whole-journey side-effect ledger: exactly ONE audit row and ONE
    // envelope per FRESH broadcast (4), nothing for replays or denials.
    expect(await broadcastAuditRows(adminA.userId)).toHaveLength(4);
    expect(transportSpy.publishCount).toBe(4);
  });

  test("step 10 — Post-hoc observers read their OWN inbox: system_broadcast, verbatim copy, null entity ref, unread", async () => {
    const expectedBodyByTitle = new Map<string, string | null>([
      [ALL_TITLE, ALL_BODY],
      [TEACHER_TITLE, TEACHER_BODY],
      [EG_TITLE, null],
      [PLAN_TITLE, PLAN_BODY],
    ]);
    const expectedTitles: readonly (readonly [JourneyActor, readonly string[]])[] = [
      [adminA, [ALL_TITLE]],
      [teacherT, [ALL_TITLE, TEACHER_TITLE]],
      [studentS, [ALL_TITLE, EG_TITLE, PLAN_TITLE]],
      [parentPa, [ALL_TITLE]],
      [studentS2, [ALL_TITLE]],
      [studentExpired, [ALL_TITLE]],
      [governedG, []],
    ];

    const pages = await Promise.all(
      expectedTitles.map(([actor]) => NotificationEngine.listMyNotifications(actor.userId, INBOX_PAGE, actor.locale))
    );

    for (const [index, [actor, expectedTitlesForActor]] of expectedTitles.entries()) {
      const page = pages[index];
      if (!page) {
        throw new Error(`expected an inbox page for actor ${actor.userId}`);
      }
      // Exactly the cohorts this actor belongs to — no cross-cohort leakage.
      expect(page.totalCount).toBe(expectedTitlesForActor.length);
      expect(page.hasMore).toBe(false);
      expect(page.items.map(item => item.title).toSorted((a, b) => a.localeCompare(b))).toEqual(
        [...expectedTitlesForActor].toSorted((a, b) => a.localeCompare(b))
      );

      for (const item of page.items) {
        // The broadcast row contract (REQ-019): the canonical notification
        // type, verbatim admin-authored copy (Arabic/script-tag copy stored
        // inertly, byte-for-byte), NO related entity, and unread.
        expect(item.type).toBe(NotificationType.SystemBroadcast);
        expect(expectedBodyByTitle.has(item.title)).toBe(true);
        expect(item.body).toBe(expectedBodyByTitle.get(item.title) ?? null);
        expect(item.relatedEntityType).toBeNull();
        expect(item.relatedEntityId).toBeNull();
        expect(item.isRead).toBe(false);
      }
    }

    // The teacher observer sees the ROLE-cohort broadcast in his own read
    // (REQ-073's cross-actor core) while S2's inbox stayed pinned to the
    // `all`-only set.
    const teacherPage = pages[1];
    if (!teacherPage) {
      throw new Error("expected the teacher inbox page");
    }
    expect(teacherPage.items.some(item => item.title === TEACHER_TITLE)).toBe(true);
    const s2Page = pages[4];
    if (!s2Page) {
      throw new Error("expected the S2 inbox page");
    }
    expect(s2Page.items.some(item => item.title === TEACHER_TITLE)).toBe(false);
  });
});
