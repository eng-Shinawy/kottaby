/**
 * Journey — Account-Governance Cross-Actor Lifecycle (Workflow 05 §5).
 *
 * Cross-actor journey test covering the full suspend / unsuspend /
 * block / unblock / soft-delete / reactivate lifecycle of a single
 * target student (Student S) as observed by the acting admin (Admin A),
 * the observing admin (Admin B), the governed admin (Governed Admin G),
 * the registered teacher (Teacher T, cross-role control), and the
 * target student themselves (via the REAL `AuthService.login` flow).
 *
 * Each step is attributed to one named actor; shared state transitions
 * are asserted after every step. Per `test/workflows/AGENTS.md`:
 *  - Committed fixtures in `beforeAll` (NO `runInRollback` — services
 *    spawn their own transactions); tracked hard-delete in `afterAll`.
 *  - Permissions resolve via REAL role context — Admin A/B hold real
 *    `users.role = "admin"` rows + real `admin` role-child rows;
 *    Teacher T and Student S are produced by the REAL
 *    `RegistrationService.registerUser` (real bcrypt hash, real
 *    role-child row, real handshake code for Student S). NEVER
 *    monkey-patched, NEVER scope-stubbed.
 *  - Audit writes are REAL DB rows — asserted by direct `audit_logs`
 *    select (action_type, entity_type, entity_id, actor_id), never
 *    spied.
 *  - Side-effect channel: ROW-COUNT oracles ONLY — this surface emits
 *    ZERO notifications (D12 deferred decision); NO `SpiedFanoutTransport`
 *    wiring.
 *  - Denial assertions use a try/catch helper + translated substrings
 *    from `getServerTranslations("en").errorsTranslations` — NEVER
 *    `expect(...).rejects.toThrow()` and NEVER raw key echoes.
 *  - Fixture-immutability: Teacher T's `users` + `applicants` rows
 *    remain byte-identical across every governance transition
 *    (cross-role containment, REQ-015).
 *
 * Appended ladder leg (second describe below): the ordered
 * student-governance ladder — (1) Student S books a baseline session and
 * a real history set is snapshotted (session + report + settled payment
 * row); (2) S logs in and a control refresh proves the token still
 * valid; (3) Admin A suspends S and S's next booking is denied FORBIDDEN
 * with zero writes and byte-identical balances; (4) A blocks S and S's
 * still-valid refresh token is denied `accountBlocked`; (5) A
 * soft-deletes S — history rows stay byte-identical to every observer
 * and S's login is denied; (6) A restores S (reactivate → unblock →
 * unsuspend) and S books again successfully. Registered through the REAL
 * `RegistrationService`, booked/lifecycled through the REAL
 * `SessionLifecycleService`/report service, governed through the REAL
 * `AdminUserManagementService`, authenticated through the REAL
 * `AuthService`. Committed fixtures + tracked `afterAll` teardown
 * (payments first under the immutability-trigger suspension, then
 * sessions, then `deleteUsersByIds`).
 *
 * TEST-FIRST EXPECTATION: This file calls
 * `AdminUserManagementService.setUserSuspended` and
 * `AdminUserManagementService.setUserBlocked` (task 2.4),
 * `AdminUserRepository.setSuspendedOnce` / `setBlockedOnce` /
 * `findGovernanceState` (task 2.3), and `assertActiveActorAdmin`
 * (task 2.2). NONE of these symbols exist at authoring time. The
 * suite is RED by design:
 *  - tsgo emits `Property 'setUserSuspended' does not exist on type
 *    'typeof AdminUserManagementService'` (and analogs).
 *  - The runtime call fails with `TypeError:
 *    AdminUserManagementService.setUserSuspended is not a function`.
 * The suite goes GREEN once tasks 2.2 + 2.3 + 2.4 + 3.2 land (the
 * lapsed-suspension login success in step 8 specifically requires
 * `AuthService.assertUserActive` to consume `isSuspensionActive`
 * — task 3.2).
 *
 * Run:
 *   bun run test/scripts/run-test.ts test/workflows/admin/account-governance.journey.test.ts
 *   bun run test/scripts/run-test.ts test/workflows
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/backend/db";
import { auditLogs } from "@/backend/db/schema/audit/audit-logs";
import { studentPayments } from "@/backend/db/schema/billing/student-payments";
import { reports } from "@/backend/db/schema/classes/reports";
// Aliased: the pre-existing describe declares `session` locals for login
// results, and the layer's no-shadow rule forbids shadowing them.
import { session as sessionTable } from "@/backend/db/schema/classes/session";
import { sessionRequestIdempotency } from "@/backend/db/schema/classes/session-request-idempotency";
import { notifications } from "@/backend/db/schema/notifications/notifications";
import { students } from "@/backend/db/schema/students/students";
import { applicants } from "@/backend/db/schema/teachers/applicants";
import { users } from "@/backend/db/schema/users/users";
import { createTestStudentPayment } from "@/backend/db/test/entity-setup";
import { AuditActionType } from "@/backend/enum/audit/audit-action-type.enum";
import { HeldBalanceLane } from "@/backend/enum/scheduling/held-balance-lane.enum";
import { SessionIntent } from "@/backend/enum/scheduling/session-intent.enum";
import { SessionStatus } from "@/backend/enum/scheduling/session-status.enum";
import { UserRole } from "@/backend/enum/users/user-role.enum";
import { ConflictError, DomainError, ForbiddenError, UnauthorizedError } from "@/backend/lib/errors";
// TEST-FIRST: the import below resolves (the module exists), but the
// method calls `AdminUserManagementService.setUserSuspended` and
// `setUserBlocked` do NOT exist at authoring time — they are the
// task 2.4 deliverable. The suite is RED by design (TypeScript +
// runtime) until task 2.4 lands the surface.
import { AdminUserManagementService } from "@/backend/services/admin/user-management.service";
import { AuthService } from "@/backend/services/auth/auth.service";
import { RegistrationService } from "@/backend/services/auth/registration.service";
import { SessionLifecycleService } from "@/backend/services/classes/session-lifecycle.service";
import * as SessionReportService from "@/backend/services/classes/session-report.service";
import type { NotificationEngineCallOptions } from "@/backend/services/notifications";
import type {
  AdminUserDetailReturnType,
  RegistrationSubmitInput,
  ReportSelectType,
  SessionSelectType,
  StudentPaymentSelectType,
  StudentSelectType,
} from "@/backend/types";
import { SESSION_FEE_HIFZ } from "@/shared/constants/session-fees.constants";
import { getServerTranslations } from "@/shared/locale/server-graphql";
import {
  countUsersByIds,
  deleteSessionsByParticipantUserIds,
  deleteUsersByIds,
  withImmutabilityTriggersSuspended,
} from "@/test/helpers/db-cleanup";
import {
  countNotificationsForUser,
  InMemoryClaimCache,
  provisionAdminActor,
  provisionCertifiedTeacherActor,
  SpiedFanoutTransport,
} from "@/test/workflows/helpers";
import {
  createGovernanceCast,
  type GovernanceCast,
  type GovernanceCastBundle,
} from "@/test/workflows/helpers/admin-governance-cast";
import type { JourneyFixtureRegistry } from "@/test/workflows/helpers/journey-actor-fixtures";
import { setGovernanceFixture } from "@/test/workflows/helpers/journey-fixtures";

const LOCALE = "en";
const tErrors = getServerTranslations(LOCALE).errorsTranslations;
// Auth-locale governance message — `AuthService.login` emits the
// `authTranslations.accountBlocked` copy (the canonical governance
// denial message at the login boundary — covers suspended, blocked,
// and deleted states uniformly). The errors-namespace
// `accountBlocked` variant is a separate, narrower copy and is NOT
// what login throws.
const tAuth = getServerTranslations(LOCALE).authTranslations;

/**
 * Per-run prefix — guarantees unique emails/names so parallel or
 * repeated runs never collide on the `users.email` unique index.
 * Per `test/workflows/AGENTS.md` rule 3, the domain token is `gov`
 * (matching `test/workflows/admin/` subdirectory naming).
 */
const PREFIX = `jrn_gov_${randomUUID().slice(0, 8)}`;

/** Suite-scoped cast + registry — bound in `beforeAll`. */
let cast: GovernanceCast;
let registry: JourneyFixtureRegistry;
let governanceBundle: GovernanceCastBundle;

/**
 * Baseline notification counts per tracked actor — captured after
 * provisioning so the journey's side-effect-absence assertion
 * (this surface emits ZERO notifications — D12) can compare the
 * post-journey count against the pre-journey count per actor.
 */
let baselineNotifications: ReadonlyMap<number, number>;

/**
 * Try/catch helper for asserting that a service call rejects with a
 * `DomainError`. Per `test/workflows/AGENTS.md` rule 6 — NEVER use
 * `expect(...).rejects.toThrow()` inside a journey (deadlocks the
 * outer-rollback pattern and obscures the failure mode).
 *
 * @returns The caught error (asserted non-null). Caller can do
 *          `instanceof` / `.code` / `.message` checks on it.
 */
async function expectJourneyError(fn: () => Promise<unknown>): Promise<DomainError> {
  let caught: unknown = null;
  try {
    await fn();
  } catch (error) {
    caught = error;
  }
  if (caught === null) {
    throw new Error("expectJourneyError: expected the call to throw, but it resolved successfully");
  }
  if (caught instanceof DomainError) {
    return caught;
  }
  // Narrow `caught` to a string-safe primitive before stringifying —
  // `String(caught)` on an `unknown` triggers the TS `no-base-to-string`
  // rule (objects may serialize as `[object Object]`). Primitive guards
  // cover the realistic non-Error throw shapes; objects fall back to a
  // JSON shape dump so the failure message stays actionable.
  let message: string;
  if (caught instanceof Error) {
    message = caught.message;
  } else if (typeof caught === "string" || typeof caught === "number" || typeof caught === "boolean") {
    message = String(caught);
  } else {
    message = JSON.stringify(caught);
  }
  throw new Error(`expectJourneyError: caught non-DomainError: ${message}`);
}

/** Reads a `users` row by id via the global `db` (post-commit read). */
async function readUserRow(id: number) {
  const rows = await db.select().from(users).where(eq(users.id, id)).limit(1);
  return rows[0] ?? null;
}

/** Reads the `applicants` row for a user id (shared PK). */
async function readApplicantRow(userId: number) {
  const rows = await db.select().from(applicants).where(eq(applicants.id, userId)).limit(1);
  return rows[0] ?? null;
}

/** Reads the `students` row for a user id (shared PK). */
async function readStudentRow(userId: number) {
  const rows = await db.select().from(students).where(eq(students.id, userId)).limit(1);
  return rows[0] ?? null;
}

/** Counts `audit_logs` rows matching the supplied actor + action + entity. */
async function countAuditForEntity(actorId: number, actionType: AuditActionType, entityId: number): Promise<number> {
  const result = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(auditLogs)
    .where(and(eq(auditLogs.actorId, actorId), eq(auditLogs.actionType, actionType), eq(auditLogs.entityId, entityId)));
  return result[0]?.count ?? 0;
}

/** Counts ALL audit rows for an actor (denial-no-audit assertion helper). */
async function countAllAuditForActor(actorId: number): Promise<number> {
  const result = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(auditLogs)
    .where(eq(auditLogs.actorId, actorId));
  return result[0]?.count ?? 0;
}

/** Counts ALL audit rows in the table (denial-no-audit delta assertion). */
async function countAllAuditRows(): Promise<number> {
  const result = await db.select({ count: sql<number>`count(*)::int` }).from(auditLogs);
  return result[0]?.count ?? 0;
}

/** Counts audit rows for an entity (cross-actor visibility oracle). */
async function countAuditForEntityAllActions(entityId: number): Promise<number> {
  const result = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(auditLogs)
    .where(eq(auditLogs.entityId, entityId));
  return result[0]?.count ?? 0;
}

/** Reads the latest audit row for an entity+action (post-mutation assertion). */
async function readLatestAuditForEntity(entityId: number, actionType: AuditActionType) {
  const rows = await db
    .select()
    .from(auditLogs)
    .where(and(eq(auditLogs.entityId, entityId), eq(auditLogs.actionType, actionType)))
    .orderBy(desc(auditLogs.createdAt))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Fixture-immutability oracle — Teacher T's `users` + `applicants`
 * rows remain byte-identical across every governance transition
 * (cross-role containment, REQ-015). Called after every step.
 *
 * A governance mutation on Student S MUST NOT touch Teacher T's
 * `users` row, `applicants` row, or any other role-child row.
 */
async function assertTeacherTUntouched(): Promise<void> {
  const userRowNow = await readUserRow(cast.teacherT.userId);
  expect(userRowNow).not.toBeNull();
  expect(userRowNow).toEqual(cast.teacherT.userSnapshot);

  const applicantRowNow = await readApplicantRow(cast.teacherT.userId);
  expect(applicantRowNow).not.toBeNull();
  expect(applicantRowNow).toEqual(cast.teacherT.applicantSnapshot);
}

/**
 * Cross-actor visibility oracle — Admin B observes S's current
 * governance state via `AdminUserManagementService.getUserDetail`.
 * Returned detail's governance fields MUST mirror the `users(S)`
 * row's state.
 */
async function adminBObservesSGovernanceState(): Promise<AdminUserDetailReturnType> {
  return AdminUserManagementService.getUserDetail(cast.studentS.userId, LOCALE, cast.adminB.userId);
}

describe("Journey — Account-Governance Cross-Actor Lifecycle (Workflow 05 §5)", () => {
  beforeAll(async () => {
    governanceBundle = await createGovernanceCast(PREFIX);
    cast = governanceBundle.cast;
    registry = governanceBundle.registry;

    // Capture baseline notification counts per tracked actor — this
    // surface emits ZERO notifications (D12 deferred decision). The
    // afterAll assertion compares the post-journey counts against
    // these baselines. `db.$count(table, where)` is Drizzle's
    // canonical count-by-predicate helper.
    const trackedIds = [...registry.userIds];
    const entries = await Promise.all(
      trackedIds.map(async id => {
        const count = await db.$count(notifications, eq(notifications.userId, id));
        return [id, count] as const;
      })
    );
    baselineNotifications = new Map<number, number>(entries);
  });

  // afterAll: hard-delete every tracked row in FK-safe order via
  // `deleteUsersByIds` (wraps `withAuditDeleteTriggersSuspended`
  // internally — handles the `audit_logs` RESTRICT FK + the
  // append-only immutability trigger). Residue re-probe = 0.
  afterAll(async () => {
    if (!registry) return;
    const ids = [...registry.userIds];
    if (ids.length === 0) return;
    await deleteUsersByIds(ids);
    const residue = await countUsersByIds(ids);
    expect(residue).toBe(0);
  });

  // ─── Step 1: fixtures committed ────────────────────────────────────
  test("step 1: fixtures committed — Admin A, Admin B, Governed Admin G, Teacher T, Student S", async () => {
    // All five actors committed by `createGovernanceCast`.
    expect(cast.adminA.userId).toBeGreaterThan(0);
    expect(cast.adminB.userId).toBeGreaterThan(0);
    expect(cast.governedAdminG.userId).toBeGreaterThan(0);
    expect(cast.teacherT.userId).toBeGreaterThan(0);
    expect(cast.studentS.userId).toBeGreaterThan(0);

    // Admin A — real `admin` role-child row.
    const adminARow = await readUserRow(cast.adminA.userId);
    expect(adminARow?.role).toBe(UserRole.Admin);
    expect(adminARow?.isBlocked).toBe(false);
    expect(adminARow?.isDeleted).toBe(false);

    // Admin B — real `admin` role-child row.
    const adminBRow = await readUserRow(cast.adminB.userId);
    expect(adminBRow?.role).toBe(UserRole.Admin);

    // Governed Admin G — real `admin` role-child row + isBlocked=true.
    const governedAdminGRow = await readUserRow(cast.governedAdminG.userId);
    expect(governedAdminGRow?.role).toBe(UserRole.Admin);
    expect(governedAdminGRow?.isBlocked).toBe(true);
    expect(governedAdminGRow?.blockedAt).not.toBeNull();

    // Teacher T — real registered teacher-applicant (applicants row,
    // NO teacher row — certification lock).
    const teacherTRow = await readUserRow(cast.teacherT.userId);
    expect(teacherTRow?.role).toBe(UserRole.Teacher);
    const teacherTApplicant = await readApplicantRow(cast.teacherT.userId);
    expect(teacherTApplicant).not.toBeNull();
    expect(teacherTApplicant?.status).toBe("pending");

    // Student S — real registered student (students row with zeroed
    // balances + unique handshake code).
    const studentSRow = await readUserRow(cast.studentS.userId);
    expect(studentSRow?.role).toBe(UserRole.Student);
    const studentSChild = await readStudentRow(cast.studentS.userId);
    expect(studentSChild).not.toBeNull();
    expect(studentSChild?.handshakeCode).toMatch(/^KSB-/);

    // Registry tracks all five ids.
    expect(registry.userIds).toHaveLength(5);

    // Teacher T control byte-identical at fixture provisioning time.
    await assertTeacherTUntouched();
  });

  // ─── Step 2: A suspends S (7 days) ─────────────────────────────────
  test("step 2: A suspends S (7 days) → users(S) columns set; ONE audit(Suspend, user, S, A)", async () => {
    const auditBefore = await countAuditForEntity(cast.adminA.userId, AuditActionType.Suspend, cast.studentS.userId);
    expect(auditBefore).toBe(0);

    // TEST-FIRST: `setUserSuspended` does not exist at authoring time —
    // task 2.4 lands it. The call is the contract.
    const result = await AdminUserManagementService.setUserSuspended(
      cast.studentS.userId,
      true,
      7,
      cast.adminA.userId,
      LOCALE
    );

    // Returned detail reflects the suspended state.
    expect(result.suspended).toBe(true);
    expect(result.suspendedAt).not.toBeNull();
    expect(result.suspendedPeriodDays).toBe(7);

    // users(S) columns set.
    const userRow = await readUserRow(cast.studentS.userId);
    expect(userRow?.suspended).toBe(true);
    expect(userRow?.suspendedAt).not.toBeNull();
    expect(userRow?.suspendedPeriodDays).toBe(7);

    // EXACTLY ONE audit_logs(Suspend, entityType="user", entityId=S.id, actorId=A).
    const auditAfter = await countAuditForEntity(cast.adminA.userId, AuditActionType.Suspend, cast.studentS.userId);
    expect(auditAfter).toBe(1);

    // Audit row's entityType is "user" (cross-actor visibility contract).
    const latestAudit = await readLatestAuditForEntity(cast.studentS.userId, AuditActionType.Suspend);
    expect(latestAudit?.entityType).toBe("user");
    expect(latestAudit?.entityId).toBe(cast.studentS.userId);
    expect(latestAudit?.actorId).toBe(cast.adminA.userId);

    // Teacher T control byte-identical.
    await assertTeacherTUntouched();
  });

  // ─── Step 3: S login → ForbiddenError (active suspension denies) ───
  test("step 3: S login → ForbiddenError (active suspension denies); B observes detail + audit row", async () => {
    // Active suspension denies login (the suspension window is still
    // open — 7 days from step 2's `suspendedAt`).
    const error = await expectJourneyError(() =>
      AuthService.login(cast.studentS.email, cast.studentS.credential, LOCALE)
    );

    expect(error).toBeInstanceOf(ForbiddenError);
    // Auth-locale governance denial copy (covers suspended + blocked + deleted).
    expect(error.message).toContain(tAuth.accountBlocked);

    // B observes S's suspended state via getUserDetail.
    const detail = await adminBObservesSGovernanceState();
    expect(detail.suspended).toBe(true);
    expect(detail.suspendedAt).not.toBeNull();
    expect(detail.suspendedPeriodDays).toBe(7);

    // B observes the ONE audit row attributed to A.
    const auditForA = await countAuditForEntity(cast.adminA.userId, AuditActionType.Suspend, cast.studentS.userId);
    expect(auditForA).toBe(1);

    // Teacher T control byte-identical.
    await assertTeacherTUntouched();
  });

  // ─── Step 4: A unsuspends S → 3 columns cleared; ONE Reactivate audit row; login SUCCEEDS
  test("step 4: A unsuspends S → 3 columns cleared; ONE Reactivate audit row; S's login SUCCEEDS", async () => {
    const auditBefore = await countAuditForEntity(cast.adminA.userId, AuditActionType.Reactivate, cast.studentS.userId);
    expect(auditBefore).toBe(0);

    const result = await AdminUserManagementService.setUserSuspended(
      cast.studentS.userId,
      false,
      null,
      cast.adminA.userId,
      LOCALE
    );

    expect(result.suspended).toBe(false);
    expect(result.suspendedAt).toBeNull();
    expect(result.suspendedPeriodDays).toBeNull();

    // Three columns cleared (suspended=false, suspendedAt=null, suspendedPeriodDays=null).
    const userRow = await readUserRow(cast.studentS.userId);
    expect(userRow?.suspended).toBe(false);
    expect(userRow?.suspendedAt).toBeNull();
    expect(userRow?.suspendedPeriodDays).toBeNull();

    // ONE Reactivate audit row.
    const auditAfter = await countAuditForEntity(cast.adminA.userId, AuditActionType.Reactivate, cast.studentS.userId);
    expect(auditAfter).toBe(1);

    // S's login SUCCEEDS — governance cleared.
    const session = await AuthService.login(cast.studentS.email, cast.studentS.credential, LOCALE);
    expect(session.user.id).toBe(cast.studentS.userId);

    // Teacher T control byte-identical.
    await assertTeacherTUntouched();
  });

  // ─── Step 5: A blocks S → isBlocked/blockedAt set; ONE Suspend audit row
  test("step 5: A blocks S → isBlocked/blockedAt set; ONE Suspend-mapped audit row; S's login → ForbiddenError", async () => {
    const auditBefore = await countAuditForEntity(cast.adminA.userId, AuditActionType.Suspend, cast.studentS.userId);
    expect(auditBefore).toBe(1); // the step-2 Suspend row

    // TEST-FIRST: `setUserBlocked` does not exist at authoring time —
    // task 2.4 lands it. The call is the contract.
    const result = await AdminUserManagementService.setUserBlocked(
      cast.studentS.userId,
      true,
      cast.adminA.userId,
      LOCALE
    );

    expect(result.isBlocked).toBe(true);
    expect(result.blockedAt).not.toBeNull();

    // users(S) isBlocked/blockedAt set.
    const userRow = await readUserRow(cast.studentS.userId);
    expect(userRow?.isBlocked).toBe(true);
    expect(userRow?.blockedAt).not.toBeNull();

    // ONE additional Suspend-mapped audit row (REQ-011 mapping:
    // block → Suspend actionType). Total = 2 (step 2 + step 5).
    const auditAfter = await countAuditForEntity(cast.adminA.userId, AuditActionType.Suspend, cast.studentS.userId);
    expect(auditAfter).toBe(2);

    // Audit row's changedFields payload names isBlocked + blockedAt
    // (REQ-011 mapping — block/unblock both write the same two-column
    // axis). The details column is JSON-encoded varchar(2000).
    const latestAudit = await readLatestAuditForEntity(cast.studentS.userId, AuditActionType.Suspend);
    expect(latestAudit?.entityType).toBe("user");
    expect(latestAudit?.entityId).toBe(cast.studentS.userId);
    expect(latestAudit?.actorId).toBe(cast.adminA.userId);
    expect(latestAudit).not.toBeNull();
    expect(latestAudit?.details).not.toBeNull();
    if (!latestAudit?.details) {
      throw new Error("Expected block audit details to be present");
    }
    {
      const parsed = JSON.parse(latestAudit.details) as unknown;
      const details =
        parsed && typeof parsed === "object" && "changedFields" in parsed
          ? { changedFields: (parsed as { changedFields?: unknown }).changedFields }
          : { changedFields: undefined };
      const changedFields = Array.isArray(details.changedFields) ? details.changedFields : [];
      expect(changedFields).toEqual(expect.arrayContaining(["isBlocked", "blockedAt"]));
    }

    // S's login → ForbiddenError (block NEVER lapses — NO lapse semantics).
    const error = await expectJourneyError(() =>
      AuthService.login(cast.studentS.email, cast.studentS.credential, LOCALE)
    );
    expect(error).toBeInstanceOf(ForbiddenError);
    expect(error.message).toContain(tAuth.accountBlocked);

    // Teacher T control byte-identical.
    await assertTeacherTUntouched();
  });

  // ─── Step 6: A unblocks S → ONE Reactivate audit row; login succeeds
  test("step 6: A unblocks S → ONE Reactivate audit row; login succeeds", async () => {
    const auditBefore = await countAuditForEntity(cast.adminA.userId, AuditActionType.Reactivate, cast.studentS.userId);
    expect(auditBefore).toBe(1); // the step-4 Reactivate row

    const result = await AdminUserManagementService.setUserBlocked(
      cast.studentS.userId,
      false,
      cast.adminA.userId,
      LOCALE
    );

    expect(result.isBlocked).toBe(false);
    expect(result.blockedAt).toBeNull();

    const userRow = await readUserRow(cast.studentS.userId);
    expect(userRow?.isBlocked).toBe(false);
    expect(userRow?.blockedAt).toBeNull();

    // ONE additional Reactivate audit row (total = 2: step 4 + step 6).
    const auditAfter = await countAuditForEntity(cast.adminA.userId, AuditActionType.Reactivate, cast.studentS.userId);
    expect(auditAfter).toBe(2);

    // Login succeeds again.
    const session = await AuthService.login(cast.studentS.email, cast.studentS.credential, LOCALE);
    expect(session.user.id).toBe(cast.studentS.userId);

    // Teacher T control byte-identical.
    await assertTeacherTUntouched();
  });

  // ─── Step 7: A soft-deletes S; suspend on DELETED S → USER_ALREADY_DELETED; reactivate S; login succeeds
  test("step 7: A soft-deletes S → login denied; suspend on DELETED S → USER_ALREADY_DELETED + ZERO audit; reactivate S → login succeeds", async () => {
    // 7a. A soft-deletes S via the existing soft-delete path (consumed, never forked).
    const deleteResult = await AdminUserManagementService.setUserDeleted(
      cast.studentS.userId,
      true,
      cast.adminA.userId,
      LOCALE
    );
    expect(deleteResult.isDeleted).toBe(true);

    // 7b. S's login → ForbiddenError (deleted denies — never lapses).
    const loginErr = await expectJourneyError(() =>
      AuthService.login(cast.studentS.email, cast.studentS.credential, LOCALE)
    );
    expect(loginErr).toBeInstanceOf(ForbiddenError);
    expect(loginErr.message).toContain(tAuth.accountBlocked);

    // 7c. A attempts suspend on DELETED S → USER_ALREADY_DELETED + ZERO new audit rows.
    const auditForSuspendBefore = await countAuditForEntity(
      cast.adminA.userId,
      AuditActionType.Suspend,
      cast.studentS.userId
    );
    const allAuditForABefore = await countAllAuditForActor(cast.adminA.userId);

    const suspendOnDeletedErr = await expectJourneyError(() =>
      AdminUserManagementService.setUserSuspended(cast.studentS.userId, true, 7, cast.adminA.userId, LOCALE)
    );
    expect(suspendOnDeletedErr).toBeInstanceOf(ConflictError);
    expect(suspendOnDeletedErr.code).toBe("USER_ALREADY_DELETED");
    expect(suspendOnDeletedErr.message).toContain(tErrors.adminUsers.userAlreadyDeleted);

    // ZERO new audit rows for the denial (JR-C-1 — denials emit no audit).
    const auditForSuspendAfter = await countAuditForEntity(
      cast.adminA.userId,
      AuditActionType.Suspend,
      cast.studentS.userId
    );
    expect(auditForSuspendAfter).toBe(auditForSuspendBefore);
    const allAuditForAAfter = await countAllAuditForActor(cast.adminA.userId);
    expect(allAuditForAAfter).toBe(allAuditForABefore);

    // 7d. A reactivates S via the existing soft-delete path (consumed, never forked).
    const reactivateResult = await AdminUserManagementService.setUserDeleted(
      cast.studentS.userId,
      false,
      cast.adminA.userId,
      LOCALE
    );
    expect(reactivateResult.isDeleted).toBe(false);

    // 7e. S's login SUCCEEDS — full lifecycle loop closed cross-feature.
    const session = await AuthService.login(cast.studentS.email, cast.studentS.credential, LOCALE);
    expect(session.user.id).toBe(cast.studentS.userId);

    // Teacher T control byte-identical.
    await assertTeacherTUntouched();
  });

  // ─── Step 8: LAPSED suspension fixture-write → login SUCCEEDS; columns BYTE-IDENTICAL (REQ-019 zero-write proof)
  test("step 8: lapsed suspension fixture-write → S's login SUCCEEDS; columns BYTE-IDENTICAL before/after (REQ-019); B observes window fields; A unsuspends S → columns cleared under audit", async () => {
    // 8a. Fixture-write S into a LAPSED suspension: suspended=true,
    //     suspendedAt = now − 10 days, periodDays = 7. The 7-day
    //     window has fully lapsed (10 > 7) — `isSuspensionActive`
    //     returns false (lapsed).
    const tenDaysAgo = new Date(Date.now() - 10 * 86_400_000);
    const governanceWrite = await setGovernanceFixture(cast.studentS.userId, {
      suspended: true,
      suspendedAt: tenDaysAgo,
      suspendedPeriodDays: 7,
    });
    expect(governanceWrite.suspended).toBe(true);
    expect(governanceWrite.suspendedAt).not.toBeNull();
    expect(governanceWrite.suspendedPeriodDays).toBe(7);

    // Capture users(S) columns IMMEDIATELY before login.
    const userRowBeforeLogin = await readUserRow(cast.studentS.userId);

    // 8b. S's login SUCCEEDS — lapsed suspension allows login.
    //     NOTE: this assertion currently REQUIRES task 3.2 to land
    //     (`assertUserActive` consuming `isSuspensionActive`); until
    //     then, `assertUserActive` treats `suspended` as a plain
    //     boolean flag and DENIES login regardless of window. This is
    //     the documented RED state at authoring time.
    const session = await AuthService.login(cast.studentS.email, cast.studentS.credential, LOCALE);
    expect(session.user.id).toBe(cast.studentS.userId);

    // 8c. Governance columns BYTE-IDENTICAL before/after login — REQ-019
    //     zero-write proof. Login MUST NOT mutate S's governance columns.
    //
    //     The oracle is scoped to the governance set on purpose: login's
    //     documented fire-and-forget `touchLastActiveAt` (dashboard
    //     last-seen) legitimately bumps `last_active_at` and, through the
    //     `users.updated_at` `$onUpdate` hook, `updated_at`. Those are NOT
    //     governance columns. The whole-row compare used to pass only by
    //     accident (the second-truncation bug in the PGlite timestamp path
    //     collapsed both reads into the same wall-clock second).
    const GOVERNANCE_COLUMNS = [
      "suspended",
      "suspendedAt",
      "suspendedPeriodDays",
      "isBlocked",
      "blockedAt",
      "isDeleted",
      "deletedAt",
    ] as const;
    const userRowAfterLogin = await readUserRow(cast.studentS.userId);
    expect(Object.fromEntries(GOVERNANCE_COLUMNS.map(c => [c, userRowAfterLogin?.[c]]))).toEqual(
      Object.fromEntries(GOVERNANCE_COLUMNS.map(c => [c, userRowBeforeLogin?.[c]]))
    );

    // 8d. B's detail read still shows the suspended window fields
    //     until A's audited release (window fields persist until
    //     audited clear — REQ-091).
    const detail = await adminBObservesSGovernanceState();
    expect(detail.suspended).toBe(true);
    expect(detail.suspendedAt).not.toBeNull();
    expect(detail.suspendedPeriodDays).toBe(7);

    // 8e. A unsuspends S → columns cleared under audit.
    const auditBefore = await countAuditForEntity(cast.adminA.userId, AuditActionType.Reactivate, cast.studentS.userId);
    const result = await AdminUserManagementService.setUserSuspended(
      cast.studentS.userId,
      false,
      null,
      cast.adminA.userId,
      LOCALE
    );
    expect(result.suspended).toBe(false);
    expect(result.suspendedAt).toBeNull();
    expect(result.suspendedPeriodDays).toBeNull();

    const auditAfter = await countAuditForEntity(cast.adminA.userId, AuditActionType.Reactivate, cast.studentS.userId);
    expect(auditAfter).toBe(auditBefore + 1);

    // Teacher T control byte-identical.
    await assertTeacherTUntouched();
  });

  // ─── Step 9: Denial battery ───────────────────────────────────────
  test("step 9: denial battery — non-admin / self-target / re-suspend active / unsuspend clean / governed admin G / anonymous", async () => {
    // 9a. S (non-admin) calls setUserSuspended → ForbiddenError, zero writes.
    const auditBefore9a = await countAllAuditRows();
    const userSRowBefore9a = await readUserRow(cast.studentS.userId);
    const err9a = await expectJourneyError(() =>
      AdminUserManagementService.setUserSuspended(
        cast.studentS.userId,
        true,
        7,
        cast.studentS.userId, // S as actor — non-admin.
        LOCALE
      )
    );
    expect(err9a).toBeInstanceOf(ForbiddenError);
    expect(err9a.message).toContain(tErrors.forbidden);
    const userSRowAfter9a = await readUserRow(cast.studentS.userId);
    expect(userSRowAfter9a).toEqual(userSRowBefore9a); // zero writes
    const auditAfter9a = await countAllAuditRows();
    expect(auditAfter9a).toBe(auditBefore9a); // zero audit

    // 9b. A self-targets suspend → USER_SELF_SUSPENSION_FORBIDDEN, zero writes, zero audit.
    const adminARowBefore9b = await readUserRow(cast.adminA.userId);
    const auditBefore9b = await countAllAuditForActor(cast.adminA.userId);
    const err9b = await expectJourneyError(() =>
      AdminUserManagementService.setUserSuspended(cast.adminA.userId, true, 7, cast.adminA.userId, LOCALE)
    );
    expect(err9b).toBeInstanceOf(ConflictError);
    expect(err9b.code).toBe("USER_SELF_SUSPENSION_FORBIDDEN");
    expect(err9b.message).toContain(tErrors.adminUsers.userSelfSuspensionForbidden);
    const adminARowAfter9b = await readUserRow(cast.adminA.userId);
    expect(adminARowAfter9b).toEqual(adminARowBefore9b); // zero writes
    const auditAfter9b = await countAllAuditForActor(cast.adminA.userId);
    expect(auditAfter9b).toBe(auditBefore9b); // zero audit

    // 9c. A re-suspends active S — first Suspend S so it's active, then attempt re-suspend.
    //     But step 8e cleared S to clean state. Suspend S first:
    await AdminUserManagementService.setUserSuspended(cast.studentS.userId, true, 7, cast.adminA.userId, LOCALE);
    const auditForSuspendBefore9c = await countAuditForEntity(
      cast.adminA.userId,
      AuditActionType.Suspend,
      cast.studentS.userId
    );
    const err9c = await expectJourneyError(() =>
      AdminUserManagementService.setUserSuspended(cast.studentS.userId, true, 7, cast.adminA.userId, LOCALE)
    );
    expect(err9c).toBeInstanceOf(ConflictError);
    expect(err9c.code).toBe("USER_ALREADY_SUSPENDED");
    expect(err9c.message).toContain(tErrors.adminUsers.userAlreadySuspended);
    // ZERO new audit row for the denial.
    const auditForSuspendAfter9c = await countAuditForEntity(
      cast.adminA.userId,
      AuditActionType.Suspend,
      cast.studentS.userId
    );
    expect(auditForSuspendAfter9c).toBe(auditForSuspendBefore9c);

    // 9d. A unsuspends a clean user — first Suspend→Reactivate to get
    //     a clean state, then attempt unsuspend on already-clean S.
    await AdminUserManagementService.setUserSuspended(cast.studentS.userId, false, null, cast.adminA.userId, LOCALE);
    const auditForReactivateBefore9d = await countAuditForEntity(
      cast.adminA.userId,
      AuditActionType.Reactivate,
      cast.studentS.userId
    );
    const err9d = await expectJourneyError(() =>
      AdminUserManagementService.setUserSuspended(cast.studentS.userId, false, null, cast.adminA.userId, LOCALE)
    );
    expect(err9d).toBeInstanceOf(ConflictError);
    expect(err9d.code).toBe("USER_NOT_SUSPENDED");
    expect(err9d.message).toContain(tErrors.adminUsers.userNotSuspended);
    const auditForReactivateAfter9d = await countAuditForEntity(
      cast.adminA.userId,
      AuditActionType.Reactivate,
      cast.studentS.userId
    );
    expect(auditForReactivateAfter9d).toBe(auditForReactivateBefore9d); // zero new audit

    // 9e. Governed Admin G calls governance → strict-guard ForbiddenError.
    //     G holds a real `admin` role-child row BUT `isBlocked = true`.
    //     The strict `assertActiveActorAdmin` guard (task 2.2)
    //     evaluates G's governance state and rejects blocked actors
    //     BEFORE any work — zero writes, zero audit.
    const auditBefore9e = await countAllAuditRows();
    const userSRowBefore9e = await readUserRow(cast.studentS.userId);
    const err9e = await expectJourneyError(() =>
      AdminUserManagementService.setUserSuspended(
        cast.studentS.userId,
        true,
        7,
        cast.governedAdminG.userId, // G as actor — strict-guard denial target.
        LOCALE
      )
    );
    expect(err9e).toBeInstanceOf(ForbiddenError);
    // Strict admin-guard surface (not the login flow): the guard throws the
    // errors-locale copy — see admin-guards.helpers.ts assertActiveActorAdmin.
    expect(err9e.message).toContain(tErrors.accountBlocked);
    const userSRowAfter9e = await readUserRow(cast.studentS.userId);
    expect(userSRowAfter9e).toEqual(userSRowBefore9e); // zero writes
    const auditAfter9e = await countAllAuditRows();
    expect(auditAfter9e).toBe(auditBefore9e); // zero audit

    // 9f. Anonymous (actorId = 0) → UnauthorizedError.
    const err9f = await expectJourneyError(() =>
      AdminUserManagementService.setUserSuspended(cast.studentS.userId, true, 7, 0, LOCALE)
    );
    expect(err9f).toBeInstanceOf(UnauthorizedError);
    expect(err9f.message).toContain(tErrors.unauthorized);

    // Teacher T control byte-identical.
    await assertTeacherTUntouched();
  });

  // ─── Step 10: Teacher T control ────────────────────────────────────
  test("step 10: Teacher T control — users(T) + applicants(T) byte-identical across the whole journey (REQ-015)", async () => {
    // The Teacher T control assertion runs after EVERY step via
    // `assertTeacherTUntouched`. This step is the consolidated
    // post-journey proof: the cumulative governance transitions on
    // Student S did NOT touch Teacher T's `users` row or `applicants`
    // row (cross-role containment).
    await assertTeacherTUntouched();

    // Sanity — Teacher T's role is still `teacher` (not tampered with).
    const teacherTRow = await readUserRow(cast.teacherT.userId);
    expect(teacherTRow?.role).toBe(UserRole.Teacher);

    // Teacher T's governance state is clean (never targeted).
    expect(teacherTRow?.suspended).toBe(false);
    expect(teacherTRow?.isBlocked).toBe(false);
    expect(teacherTRow?.isDeleted).toBe(false);

    // Total audit rows attributable to S's entity across the journey
    // — count is non-zero (the journey wrote multiple audit rows
    // ABOUT S) but Teacher T's entity has ZERO audit rows (the
    // journey never touched T).
    const auditForS = await countAuditForEntityAllActions(cast.studentS.userId);
    expect(auditForS).toBeGreaterThan(0);
    const auditForT = await countAuditForEntityAllActions(cast.teacherT.userId);
    expect(auditForT).toBe(0);
  });

  // ─── Step 11: Teardown ─────────────────────────────────────────────
  test("step 11: teardown — tracked hard-delete in FK-safe order; notifications row counts unchanged; residue re-probes = 0", async () => {
    // Side-effect-absence oracle: this surface emits ZERO notifications
    // (D12 deferred decision). Every tracked actor's `notifications`
    // count MUST equal its baseline captured at provisioning time.
    const trackedIds = [...registry.userIds];
    // Recursive probe to satisfy no-await-in-loop (sequential assertions across committed fixtures).
    async function probeNotifications(idx: number): Promise<void> {
      if (idx >= trackedIds.length) return;
      const id = trackedIds[idx];
      const count = await db.$count(notifications, eq(notifications.userId, id));
      const baseline = baselineNotifications.get(id) ?? 0;
      expect(count).toBe(baseline);
      await probeNotifications(idx + 1);
    }
    await probeNotifications(0);

    // The `afterAll` hook performs the actual hard-delete (via
    // `deleteUsersByIds` — wraps `withAuditDeleteTriggersSuspended`
    // + handles the `audit_logs` RESTRICT FK + the append-only
    // immutability trigger). This step is the PRE-teardown
    // side-effect-absence proof; the residue re-probe = 0 is
    // asserted in `afterAll` itself.

    // Audit rows attributed to A exist (the journey wrote them) —
    // the afterAll teardown WILL hard-delete them via the
    // trigger-suspension wrapper (audit_logs.actor_id is ON DELETE
    // RESTRICT, so the wrapper is mandatory).
    const auditForA = await countAllAuditForActor(cast.adminA.userId);
    expect(auditForA).toBeGreaterThan(0);
  });
});

/**
 * Independent read-back oracles for the governance-ladder leg — full rows
 * straight off the tables (never service-mediated), so the byte-identity
 * assertions compare exactly what any observer would read.
 */

/** Reads one `session` row by id — throws when the fixture row has vanished. */
async function readSessionRowById(sessionId: number): Promise<SessionSelectType> {
  const [row] = await db.select().from(sessionTable).where(eq(sessionTable.id, sessionId));
  if (!row) {
    throw new Error(`journey: session row ${String(sessionId)} vanished (fixture integrity failure)`);
  }
  return row;
}

/** Reads every `reports` row for one session (the report-history oracle). */
async function readReportRowsForSession(sessionId: number): Promise<ReportSelectType[]> {
  return db.select().from(reports).where(eq(reports.sessionId, sessionId));
}

/** Reads one `student_payments` row by id — throws when the fixture row has vanished. */
async function readPaymentRowById(paymentId: number): Promise<StudentPaymentSelectType> {
  const [row] = await db.select().from(studentPayments).where(eq(studentPayments.id, paymentId));
  if (!row) {
    throw new Error(`journey: student_payments row ${String(paymentId)} vanished (fixture integrity failure)`);
  }
  return row;
}

describe("Journey — student-governance ladder (ordered cross-actor INV-U1/U2/U3/U5 leg)", () => {
  /** Per-run prefix (rule 3) — unique emails, labels, and idempotency keys. */
  const LADDER_PREFIX = `jrn_gov_${randomUUID().slice(0, 8)}`;

  /** Student S's REAL plaintext credential — registration hashes it itself. */
  const LADDER_CREDENTIAL = `Ladder-${randomUUID()}`;

  /** Teacher notes recorded on the baseline report row. */
  const LADDER_REPORT_NOTES = `${LADDER_PREFIX} governance-ladder baseline report`;

  /** Report-wave publish boundary — recorded, never delivered. */
  const ladderTransportSpy = new SpiedFanoutTransport();
  const ladderEngineOptions: NotificationEngineCallOptions = {
    transport: ladderTransportSpy,
    cache: new InMemoryClaimCache(),
  };

  /** Tracked committed rows — the afterAll hard-delete worklist. */
  const ladderCastUserIds: number[] = [];
  const ladderSessionIds: number[] = [];
  const ladderPaymentIds: number[] = [];

  let ladderStudentEmail = "";
  let ladderStudentId = 0;
  let ladderTeacherId = 0;
  let ladderAdminAId = 0;
  let ladderAdminBId = 0;
  /** Still-valid refresh token minted BEFORE any governance flip lands. */
  let ladderRefreshToken = "";

  /** History baseline snapshots — the byte-identity oracles for steps 2–6. */
  let baselineStudentRow: StudentSelectType | null = null;
  let baselineSessionRow: SessionSelectType | null = null;
  let baselineReportRows: ReportSelectType[] = [];
  let baselinePaymentRow: StudentPaymentSelectType | null = null;

  /** Notification-count baselines per tracked actor (captured after provisioning). */
  let baselineStudentNotifications = 0;
  let baselineTeacherNotifications = 0;
  let baselineAdminANotifications = 0;
  let baselineAdminBNotifications = 0;

  /**
   * Ordering guard — the byte-identity oracle only makes sense against a
   * captured baseline; a step that runs before the baseline step must fail
   * loudly instead of comparing against empty snapshots.
   */
  function requireLadderBaseline(): {
    studentRow: StudentSelectType;
    sessionRow: SessionSelectType;
    reportRows: ReportSelectType[];
    paymentRow: StudentPaymentSelectType;
  } {
    if (baselineStudentRow === null || baselineSessionRow === null || baselinePaymentRow === null) {
      throw new Error("journey: governance-ladder baseline not captured before a byte-identity step");
    }
    return {
      studentRow: baselineStudentRow,
      sessionRow: baselineSessionRow,
      reportRows: baselineReportRows,
      paymentRow: baselinePaymentRow,
    };
  }

  /**
   * Byte-identity oracle for the history TABLES only (session + report +
   * payment rows) — used after the post-restoration booking, which
   * legitimately debits a balance lane on the students row while never
   * touching the earlier history rows.
   */
  async function assertLadderHistoryRowsByteIdentical(): Promise<void> {
    const baseline = requireLadderBaseline();
    expect(await readSessionRowById(baseline.sessionRow.id)).toEqual(baseline.sessionRow);
    expect(await readReportRowsForSession(baseline.sessionRow.id)).toEqual(baseline.reportRows);
    expect(await readPaymentRowById(baseline.paymentRow.id)).toEqual(baseline.paymentRow);
  }

  /**
   * Byte-identity oracle for the governance steps: the student's OWN row
   * (all four balance lanes + the trial marker) and every history row
   * (session, report, payment) are unchanged across a governance mutation.
   */
  async function assertLadderHistoryByteIdentical(): Promise<void> {
    const baseline = requireLadderBaseline();
    expect(await readStudentRow(ladderStudentId)).toEqual(baseline.studentRow);
    await assertLadderHistoryRowsByteIdentical();
  }

  beforeAll(async () => {
    // Student S — REAL registration (real bcrypt credential, real students
    // row, real handshake code, real one-time trial grant). The committed
    // tier is structural: AuthService.login/refreshToken resolve identity
    // through the bare pool and cannot observe uncommitted rows.
    const discriminator = randomUUID().slice(0, 8);
    ladderStudentEmail = `${LADDER_PREFIX}-student-${discriminator}@journey.test`;
    const registrationInput: RegistrationSubmitInput = {
      fullName: `${LADDER_PREFIX} Ladder Student S`,
      email: ladderStudentEmail,
      phone: `+2010${String(Date.now()).slice(-8)}`,
      password: LADDER_CREDENTIAL,
      country: "EG",
      role: "student",
    };
    const registered = await RegistrationService.registerUser(registrationInput, LOCALE);
    ladderStudentId = registered.id;
    ladderCastUserIds.push(ladderStudentId);

    // ONE committing transaction: the certified teacher (the bookable
    // target), the two admins (A governs, B observes), and Student S's
    // non-trial lane funding (the balances themselves are the invariant's
    // subject — the trial lane carries the registration grant only).
    await db.transaction(async tx => {
      const teacherActor = await provisionCertifiedTeacherActor(tx);
      ladderTeacherId = teacherActor.userId;
      const adminAActor = await provisionAdminActor(tx);
      ladderAdminAId = adminAActor.userId;
      const adminBActor = await provisionAdminActor(tx);
      ladderAdminBId = adminBActor.userId;
      await tx
        .update(students)
        .set({ balanceHifz: 1, balanceTajweed: 1, balanceReviews: 1 })
        .where(eq(students.id, ladderStudentId));
    });
    ladderCastUserIds.push(ladderTeacherId, ladderAdminAId, ladderAdminBId);

    // Notification baselines AFTER provisioning, BEFORE any journey step.
    baselineStudentNotifications = await countNotificationsForUser(ladderStudentId);
    baselineTeacherNotifications = await countNotificationsForUser(ladderTeacherId);
    baselineAdminANotifications = await countNotificationsForUser(ladderAdminAId);
    baselineAdminBNotifications = await countNotificationsForUser(ladderAdminBId);
  });

  afterAll(async () => {
    if (ladderCastUserIds.length === 0) return;
    // 1. Append-only payment ledger FIRST (immutability trigger blocks its
    //    DELETE and it restrict-deletes into the students rows).
    if (ladderPaymentIds.length > 0) {
      await withImmutabilityTriggersSuspended(["student_payments"], async () => {
        await db.delete(studentPayments).where(inArray(studentPayments.id, ladderPaymentIds));
      });
    }
    // 2. Booked sessions (the report rows cascade with them) — sessions
    //    restrict-delete into both participant users.
    await deleteSessionsByParticipantUserIds(ladderCastUserIds);
    // 3. Governance audit rows + users (role children, notifications, and
    //    idempotency claims cascade) via the sanctioned users sweeper.
    const deleted = await deleteUsersByIds(ladderCastUserIds);
    expect(deleted).toBe(ladderCastUserIds.length);

    // Mandatory zero-residue probes.
    expect(await countUsersByIds(ladderCastUserIds)).toBe(0);
    if (ladderSessionIds.length > 0) {
      expect(await db.$count(sessionTable, inArray(sessionTable.id, ladderSessionIds))).toBe(0);
      expect(await db.$count(reports, inArray(reports.sessionId, ladderSessionIds))).toBe(0);
    }
    if (ladderPaymentIds.length > 0) {
      expect(await db.$count(studentPayments, inArray(studentPayments.id, ladderPaymentIds))).toBe(0);
    }
  });

  // ─── Step 1: history baseline ──────────────────────────────────────
  test("step 1: S books the baseline session; T completes + reports it; the history baseline (session + report + payment) is snapshotted", async () => {
    const bookingKey = `${LADDER_PREFIX}-baseline-booking`;
    const booked = await SessionLifecycleService.createSession(
      ladderStudentId,
      { teacherId: ladderTeacherId, intent: SessionIntent.Hifz },
      bookingKey,
      LOCALE
    );
    expect(booked.status).toBe(SessionStatus.Scheduled);
    expect(booked.heldBalanceLane).toBe(HeldBalanceLane.Trial);
    expect(booked.fee).toBe(SESSION_FEE_HIFZ);
    ladderSessionIds.push(booked.id);

    // T drives the booked session through the REAL lifecycle to a REAL report.
    await SessionLifecycleService.startSession(ladderTeacherId, booked.id, LOCALE);
    const completed = await SessionLifecycleService.completeSession(ladderTeacherId, booked.id, LOCALE);
    expect(completed.status).toBe(SessionStatus.Completed);
    const report = await SessionReportService.submitSessionReport(
      ladderTeacherId,
      booked.id,
      { teacherNotes: LADDER_REPORT_NOTES, studentRatingByTeacher: 5 },
      LOCALE,
      undefined,
      ladderEngineOptions
    );
    expect(report.teacherNotes).toBe(LADDER_REPORT_NOTES);

    // The settled financial-transaction row — a fixture insert (the gateway
    // purchase channel is out of this leg's scope), production-shaped.
    const payment = await db.transaction(async tx => createTestStudentPayment(tx, ladderStudentId, null));
    ladderPaymentIds.push(payment.id);

    // Baseline snapshots — every later governance step re-reads these rows
    // and asserts them byte-identical.
    baselineStudentRow = await readStudentRow(ladderStudentId);
    baselineSessionRow = await readSessionRowById(booked.id);
    baselineReportRows = await readReportRowsForSession(booked.id);
    baselinePaymentRow = await readPaymentRowById(payment.id);

    // The booking burned the registration trial unit; the funded lanes are intact.
    expect(baselineStudentRow?.balanceTrial).toBe(0);
    expect(baselineStudentRow?.balanceHifz).toBe(1);
    expect(baselineStudentRow?.balanceTajweed).toBe(1);
    expect(baselineStudentRow?.balanceReviews).toBe(1);
    expect(baselineStudentRow?.trialGrantedAt).not.toBeNull();

    // Cross-actor side-effect visibility: exactly ONE teacher intake wave
    // for the booking; the student holds the completion prompt + the report
    // wave; the admins received nothing.
    expect(await countNotificationsForUser(ladderTeacherId)).toBe(baselineTeacherNotifications + 1);
    expect(await countNotificationsForUser(ladderStudentId)).toBe(baselineStudentNotifications + 2);
    expect(await countNotificationsForUser(ladderAdminAId)).toBe(baselineAdminANotifications);
    expect(await countNotificationsForUser(ladderAdminBId)).toBe(baselineAdminBNotifications);
  });

  // ─── Step 2: still-valid refresh pair minted while S is clean ──────
  test("step 2: S's login mints a credential pair and a control refresh proves the token still valid (pre-governance)", async () => {
    expect((await readUserRow(ladderStudentId))?.suspended).toBe(false);
    expect((await readUserRow(ladderStudentId))?.isBlocked).toBe(false);
    expect((await readUserRow(ladderStudentId))?.isDeleted).toBe(false);

    const loginSession = await AuthService.login(ladderStudentEmail, LADDER_CREDENTIAL, LOCALE);
    expect(loginSession.user.id).toBe(ladderStudentId);

    // Control refresh SUCCEEDS while S is governance-clean — proving the
    // token's shape and validity. Its ROTATED successor is the still-valid
    // token the block step later denies (there is no server-side session
    // store yet, so rotation does not revoke the predecessor's payload —
    // the rotated token is itself freshly signed and verifiable).
    const refreshed = await AuthService.refreshToken(loginSession.refreshToken, LOCALE);
    expect(refreshed.accessToken.length).toBeGreaterThan(0);
    ladderRefreshToken = refreshed.refreshToken;

    // Baseline history untouched by the login/refresh round-trips except
    // the users liveness columns — the students row and history rows are
    // byte-identical to the step-1 snapshots.
    await assertLadderHistoryByteIdentical();
  });

  // ─── Step 3: A suspends → booking denied, zero writes (U2/U5) ───────
  test("step 3: A suspends S → S's booking denied FORBIDDEN with zero writes; balances byte-identical (INV-U2, INV-U5)", async () => {
    const suspendedDetail = await AdminUserManagementService.setUserSuspended(
      ladderStudentId,
      true,
      7,
      ladderAdminAId,
      LOCALE
    );
    expect(suspendedDetail.suspended).toBe(true);
    expect(suspendedDetail.suspendedPeriodDays).toBe(7);

    const userRowAfterSuspension = await readUserRow(ladderStudentId);
    expect(userRowAfterSuspension?.suspended).toBe(true);
    expect(userRowAfterSuspension?.suspendedAt).not.toBeNull();

    // ORDER: the denial is asserted BEFORE the ladder advances — while
    // suspended, S's booking must fail through the REAL governance gate.
    const sessionCountBefore = await db.$count(sessionTable, eq(sessionTable.studentId, ladderStudentId));
    const deniedKey = `${LADDER_PREFIX}-denied-while-suspended`;
    const denial = await expectJourneyError(() =>
      SessionLifecycleService.createSession(
        ladderStudentId,
        { teacherId: ladderTeacherId, intent: SessionIntent.Hifz },
        deniedKey,
        LOCALE
      )
    );
    expect(denial).toBeInstanceOf(ForbiddenError);
    expect(denial.message).toContain(tErrors.forbidden);

    // Zero writes: no new session row, no idempotency claim consumed, the
    // users row untouched by the denial, and every history row (including
    // all four balance lanes) byte-identical.
    expect(await db.$count(sessionTable, eq(sessionTable.studentId, ladderStudentId))).toBe(sessionCountBefore);
    expect(await db.$count(sessionRequestIdempotency, eq(sessionRequestIdempotency.idempotencyKey, deniedKey))).toBe(0);
    expect(await readUserRow(ladderStudentId)).toEqual(userRowAfterSuspension);
    await assertLadderHistoryByteIdentical();

    // No teacher intake wave for a denied booking.
    expect(await countNotificationsForUser(ladderTeacherId)).toBe(baselineTeacherNotifications + 1);
  });

  // ─── Step 4: A blocks → still-valid refresh denied (U3) ────────────
  test("step 4: A blocks S → S's still-valid refresh token is denied accountBlocked (INV-U3 cross-actor arm)", async () => {
    // ORDER: S must still be suspended (and not yet blocked) when the block lands.
    const preBlockRow = await readUserRow(ladderStudentId);
    expect(preBlockRow?.suspended).toBe(true);
    expect(preBlockRow?.isBlocked).toBe(false);

    const blockedDetail = await AdminUserManagementService.setUserBlocked(
      ladderStudentId,
      true,
      ladderAdminAId,
      LOCALE
    );
    expect(blockedDetail.isBlocked).toBe(true);
    expect((await readUserRow(ladderStudentId))?.blockedAt).not.toBeNull();

    // The still-valid token minted at step 2 is denied by the governance
    // gate — the cross-actor arm (the unit arms live at the logic tier).
    const denial = await expectJourneyError(() => AuthService.refreshToken(ladderRefreshToken, LOCALE));
    expect(denial).toBeInstanceOf(ForbiddenError);
    expect(denial.message).toContain(tAuth.accountBlocked);

    await assertLadderHistoryByteIdentical();
  });

  // ─── Step 5: A soft-deletes → history preserved, login denied (U1) ─
  test("step 5: A soft-deletes S → history rows byte-identical to every observer; S's login denied (INV-U1)", async () => {
    // ORDER: S must still be suspended + blocked when the soft-delete lands.
    const preDeleteRow = await readUserRow(ladderStudentId);
    expect(preDeleteRow?.suspended).toBe(true);
    expect(preDeleteRow?.isBlocked).toBe(true);
    expect(preDeleteRow?.isDeleted).toBe(false);

    const deletedDetail = await AdminUserManagementService.setUserDeleted(
      ladderStudentId,
      true,
      ladderAdminAId,
      LOCALE
    );
    expect(deletedDetail.isDeleted).toBe(true);
    expect((await readUserRow(ladderStudentId))?.deletedAt).not.toBeNull();

    // Login denied while soft-deleted (deleted never lapses).
    const loginDenial = await expectJourneyError(() =>
      AuthService.login(ladderStudentEmail, LADDER_CREDENTIAL, LOCALE)
    );
    expect(loginDenial).toBeInstanceOf(ForbiddenError);
    expect(loginDenial.message).toContain(tAuth.accountBlocked);

    // History preserved byte-identical — soft-delete is a narrow
    // users-column write; no history row moved for any observer.
    await assertLadderHistoryByteIdentical();

    // Cross-actor observer: Admin B reads S's detail through the real
    // service — the stacked governance state is fully visible, and the
    // history reads above are what any observer would see on the tables.
    const observed = await AdminUserManagementService.getUserDetail(ladderStudentId, LOCALE, ladderAdminBId);
    expect(observed.isDeleted).toBe(true);
    expect(observed.isBlocked).toBe(true);
    expect(observed.suspended).toBe(true);
  });

  // ─── Step 6: A restores → history intact, S books again ────────────
  test("step 6: A restores S (reactivate → unblock → unsuspend) → history intact; S books again successfully", async () => {
    // ORDER: S must still be soft-deleted when the restoration ladder starts.
    expect((await readUserRow(ladderStudentId))?.isDeleted).toBe(true);

    // Full restoration in the only order the guarded predicates allow:
    // undelete first (the unblock/unsuspend predicates exclude deleted
    // rows), then unblock, then unsuspend.
    const reactivated = await AdminUserManagementService.setUserDeleted(ladderStudentId, false, ladderAdminAId, LOCALE);
    expect(reactivated.isDeleted).toBe(false);
    const unblocked = await AdminUserManagementService.setUserBlocked(ladderStudentId, false, ladderAdminAId, LOCALE);
    expect(unblocked.isBlocked).toBe(false);
    const unsuspended = await AdminUserManagementService.setUserSuspended(
      ladderStudentId,
      false,
      null,
      ladderAdminAId,
      LOCALE
    );
    expect(unsuspended.suspended).toBe(false);

    // History intact after the FULL ladder (suspend → block → soft-delete
    // → reactivate → unblock → unsuspend).
    await assertLadderHistoryByteIdentical();

    // Login restored through the real credential.
    const loginSession = await AuthService.login(ladderStudentEmail, LADDER_CREDENTIAL, LOCALE);
    expect(loginSession.user.id).toBe(ladderStudentId);

    // Booking SUCCEEDS again — on the hifz lane now (the trial unit was
    // spent by the baseline booking), proving the funded lane survived
    // the whole governance ladder.
    const secondKey = `${LADDER_PREFIX}-post-restoration-booking`;
    const rebooked = await SessionLifecycleService.createSession(
      ladderStudentId,
      { teacherId: ladderTeacherId, intent: SessionIntent.Hifz },
      secondKey,
      LOCALE
    );
    expect(rebooked.status).toBe(SessionStatus.Scheduled);
    expect(rebooked.heldBalanceLane).toBe(HeldBalanceLane.Hifz);
    ladderSessionIds.push(rebooked.id);

    // The debit landed on the hifz lane; the never-funded lanes (trial
    // already spent) and the credit-only reviews lane are untouched.
    const studentRowAfterRebook = await readStudentRow(ladderStudentId);
    expect(studentRowAfterRebook?.balanceTrial).toBe(0);
    expect(studentRowAfterRebook?.balanceHifz).toBe(0);
    expect(studentRowAfterRebook?.balanceTajweed).toBe(1);
    expect(studentRowAfterRebook?.balanceReviews).toBe(1);

    // Exactly ONE more teacher intake wave for the second booking; the
    // admins' inboxes stay untouched across the whole ladder.
    expect(await countNotificationsForUser(ladderTeacherId)).toBe(baselineTeacherNotifications + 2);
    expect(await countNotificationsForUser(ladderAdminAId)).toBe(baselineAdminANotifications);
    expect(await countNotificationsForUser(ladderAdminBId)).toBe(baselineAdminBNotifications);
  });

  // ─── Step 7: side-effect accounting + teardown handoff ────────────
  test("step 7: side-effect accounting — the report wave targeted only S; admin inboxes untouched; governance audit rows exist for teardown", async () => {
    // The spied report wave published exactly once, targeting ONLY the student.
    expect(ladderTransportSpy.publishCount).toBe(1);
    const wave = ladderTransportSpy.lastCall;
    expect(wave?.userIds).toEqual([ladderStudentId]);

    // The governance mutations appended real audit rows attributed to A —
    // the afterAll sweep removes them together with the users rows.
    const auditRowsForA = await countAllAuditForActor(ladderAdminAId);
    expect(auditRowsForA).toBeGreaterThan(0);

    // Final history read-back: the baseline rows are STILL byte-identical
    // after the whole ordered ladder (the second booking created a NEW
    // session row and debited the hifz lane; it never touched the
    // baseline history rows).
    await assertLadderHistoryRowsByteIdentical();
  });
});
