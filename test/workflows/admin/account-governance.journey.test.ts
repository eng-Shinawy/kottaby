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
import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@/backend/db";
import { auditLogs } from "@/backend/db/schema/audit/audit-logs";
import { notifications } from "@/backend/db/schema/notifications/notifications";
import { students } from "@/backend/db/schema/students/students";
import { applicants } from "@/backend/db/schema/teachers/applicants";
import { users } from "@/backend/db/schema/users/users";
import { AuditActionType } from "@/backend/enum/audit/audit-action-type.enum";
import { UserRole } from "@/backend/enum/users/user-role.enum";
import { ConflictError, DomainError, ForbiddenError, UnauthorizedError } from "@/backend/lib/errors";
// TEST-FIRST: the import below resolves (the module exists), but the
// method calls `AdminUserManagementService.setUserSuspended` and
// `setUserBlocked` do NOT exist at authoring time — they are the
// task 2.4 deliverable. The suite is RED by design (TypeScript +
// runtime) until task 2.4 lands the surface.
import { AdminUserManagementService } from "@/backend/services/admin/user-management.service";
import { AuthService } from "@/backend/services/auth/auth.service";
import type { AdminUserDetailReturnType } from "@/backend/types";
import { getServerTranslations } from "@/shared/locale/server-graphql";
import { countUsersByIds, deleteUsersByIds } from "@/test/helpers/db-cleanup";
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
  test("step 7: A soft-deletes S (DEV3-016) → login denied; suspend on DELETED S → USER_ALREADY_DELETED + ZERO audit; reactivate S → login succeeds", async () => {
    // 7a. A soft-deletes S via the EXISTING DEV3-016 path (consumed, never forked).
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

    // 7d. A reactivates S via the EXISTING DEV3-016 path (existing path, consumed).
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

    // 8c. Columns BYTE-IDENTICAL before/after login — REQ-019 zero-write
    //     proof. Login MUST NOT mutate S's governance columns.
    const userRowAfterLogin = await readUserRow(cast.studentS.userId);
    expect(userRowAfterLogin).toEqual(userRowBeforeLogin);

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
    expect(err9e.message).toContain(tAuth.accountBlocked);
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
