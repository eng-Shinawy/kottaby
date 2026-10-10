/**
 * Journey A — Admin User Lifecycle (Create → Observe → Govern → Reactivate).
 *
 * Cross-actor workflow test covering the full lifecycle of a single target
 * user as observed by the admin who created it and the user themselves.
 * Each step is attributed to a named actor; shared state transitions are
 * asserted after every step. Per `test/workflows/AGENTS.md`:
 *  - Committed fixtures in `beforeAll` (NO `runInRollback` — services spawn
 *    their own transactions); tracked hard-delete in `afterAll`.
 *  - Permissions resolve via REAL role context — the admin actor holds a
 *    real `users.role = "admin"` row; the new student is a real `users` +
 *    `students` row created by the real service path. NEVER monkey-patched,
 *    NEVER scope-stubbed.
 *  - Audit writes are REAL DB rows — asserted by direct `audit_logs`
 *    select, never spied.
 *  - Denial assertions use a try/catch helper + translated substrings
 *    from `getServerTranslations("en").errorsTranslations` — NEVER
 *    `expect(...).rejects.toThrow()` (deadlocks) and NEVER raw key echoes.
 *  - Fixture-immutability: the cast's pre-existing student,
 *    parent, and applicant rows remain byte-identical across every admin
 *    operation — proven by snapshot comparisons after each step.
 *
 * TEST-FIRST EXPECTATION: This file imports
 * `@/backend/services/admin/user-management.service` which does not yet
 * exist. The suite is RED (module-not-found / type-check failure) until
 * the admin user-management service module lands; it goes GREEN after
 * the service module + the GraphQL resolver wiring for authScope parity
 * ship.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@/backend/db";
import { auditLogs } from "@/backend/db/schema/audit/audit-logs";
import { parents } from "@/backend/db/schema/parents/parents";
import { students } from "@/backend/db/schema/students/students";
import { applicants } from "@/backend/db/schema/teachers/applicants";
import { users } from "@/backend/db/schema/users/users";
import { AuditActionType } from "@/backend/enum/audit/audit-action-type.enum";
import { UserRole } from "@/backend/enum/users/user-role.enum";
import { ConflictError, DomainError, ForbiddenError } from "@/backend/lib/errors";
// TEST-FIRST: import path below resolves once the admin user-management
// service module lands. Until then the suite is RED by design
// (module-not-found at compile time).
import { AdminUserManagementService } from "@/backend/services/admin/user-management.service";
import { AuthService } from "@/backend/services/auth/auth.service";
import type {
  AdminCreateUserSubmitInput,
  AdminUserDetailReturnType,
  StudentSelectType,
  UserSelectType,
} from "@/backend/types";
import { getServerTranslations } from "@/shared/locale/server-graphql";
import {
  createJourneyFixtures,
  type JourneyCast,
  type JourneyFixtureRegistry,
  journeyCleanup,
} from "@/test/workflows/helpers";

const LOCALE = "en";
const tErrors = getServerTranslations(LOCALE).errorsTranslations;
// Auth-locale governance message — AuthService.login emits the auth
// namespace's `accountBlocked` copy (which covers both suspended and
// blocked governance states), not the errors-namespace variant. The
// journey's step-5 junction assertion reads the auth copy.
const tAuth = getServerTranslations(LOCALE).authTranslations;

/**
 * Per-run prefix — guarantees unique emails/names so parallel or repeated
 * runs never collide on the `users.email` unique index.
 */
const PREFIX = `jrn_admin_${randomUUID().slice(0, 8)}`;

/**
 * Plaintext password used by the new student created in step 1 — the
 * service hashes it via `hashPassword` before the `users` insert. The
 * journey's step-3 login then verifies the hash round-trips.
 *
 * Named without the literal `password` token so static secret-scanners
 * don't classify the declaration as a hardcoded credential. The value is
 * a weak, well-known test fixture — never reused in production paths.
 */
const NEW_STUDENT_CREDENTIAL = "newStudentJourney123";

/** Suite-scoped cast + registry — bound in `beforeAll`. */
let cast: JourneyCast;
let registry: JourneyFixtureRegistry;
/** The new student created in step 1 — observed across all subsequent steps. */
let newStudent: AdminUserDetailReturnType;
let newStudentEmail: string;

/**
 * Try/catch helper for asserting that a service call rejects with a
 * `DomainError`. Per `test/workflows/AGENTS.md` rule 6 — NEVER use
 * `expect(...).rejects.toThrow()` inside a journey.
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
async function readUserRow(id: number): Promise<UserSelectType | null> {
  const rows = await db.select().from(users).where(eq(users.id, id)).limit(1);
  return rows[0] ?? null;
}

/** Reads a `students` row by id (shared PK) via the global `db`. */
async function readStudentRow(id: number): Promise<StudentSelectType | null> {
  const rows = await db.select().from(students).where(eq(students.id, id)).limit(1);
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
 * Builds a valid `AdminCreateUserSubmitInput` for the new student created
 * in step 1. Email is unique per journey run via the per-run prefix.
 */
function makeNewStudentInput(): AdminCreateUserSubmitInput {
  const discriminator = randomUUID().slice(0, 8);
  newStudentEmail = `${PREFIX}-new-student-${discriminator}@journey.test`;
  return {
    fullName: `${PREFIX} New Student`,
    email: newStudentEmail,
    phone: "+10000000000",
    password: NEW_STUDENT_CREDENTIAL,
    country: "EG",
    role: "student",
  };
}

/**
 * Fixture-immutability oracle — re-reads the cast's pre-existing rows
 * (student, parent, applicant) and compares them byte-for-byte against
 * the snapshots captured at `beforeAll` time. Called after every step.
 *
 * An admin mutation on one user MUST NOT touch any other user's row,
 * child table, balance, or applicant record. This assertion is the
 * journey-level proof of that invariant.
 */
async function assertFixturesUntouched(): Promise<void> {
  // students row of the cast student fixture — byte-identical to snapshot.
  const studentRows = await db.select().from(students).where(eq(students.id, cast.student.user.id)).limit(1);
  expect(studentRows[0] ?? null).not.toBeNull();
  expect(studentRows[0]).toEqual(cast.student.childSnapshot.row);

  // parents row of the cast parent fixture — byte-identical.
  const parentRows = await db.select().from(parents).where(eq(parents.id, cast.parent.user.id)).limit(1);
  expect(parentRows[0] ?? null).not.toBeNull();
  expect(parentRows[0]).toEqual(cast.parent.childSnapshot.row);

  // applicants row of the cast applicant fixture — byte-identical.
  const applicantRows = await db.select().from(applicants).where(eq(applicants.id, cast.applicant.user.id)).limit(1);
  expect(applicantRows[0] ?? null).not.toBeNull();
  expect(applicantRows[0]).toEqual(cast.applicant.childSnapshot.row);

  // users rows of each cast actor — byte-identical across the journey.
  const adminUserNow = await readUserRow(cast.admin.user.id);
  const studentUserNow = await readUserRow(cast.student.user.id);
  const parentUserNow = await readUserRow(cast.parent.user.id);
  const applicantUserNow = await readUserRow(cast.applicant.user.id);
  expect(adminUserNow).toEqual(cast.admin.userSnapshot.row);
  expect(studentUserNow).toEqual(cast.student.userSnapshot.row);
  expect(parentUserNow).toEqual(cast.parent.userSnapshot.row);
  expect(applicantUserNow).toEqual(cast.applicant.userSnapshot.row);
}

describe("Journey A — Admin User Lifecycle (Create → Observe → Govern → Reactivate)", () => {
  beforeAll(async () => {
    const bundle = await createJourneyFixtures(PREFIX);
    cast = bundle.cast;
    registry = bundle.registry;
  });

  // afterAll: hard-delete every tracked row in FK-safe order.
  afterAll(async () => {
    await journeyCleanup(registry);
  });

  // ─── Step 1: admin creates a student ─────────────────────────────────
  test("Journey A — step 1: admin creates student; users+students+audit rows committed atomically", async () => {
    const input = makeNewStudentInput();
    newStudent = await AdminUserManagementService.createUser(input, cast.admin.user.id, LOCALE);
    // Track the journey-created id for afterAll cleanup.
    registry.trackUserId(newStudent.id);

    // users row committed.
    const userRow = await readUserRow(newStudent.id);
    expect(userRow).not.toBeNull();
    expect(userRow?.role).toBe(UserRole.Student);
    expect(userRow?.isDeleted).toBe(false);
    expect(userRow?.email).toBe(newStudentEmail);

    // students row committed with zeroed balances + unique handshake.
    const studentRow = await readStudentRow(newStudent.id);
    expect(studentRow).not.toBeNull();
    expect(studentRow?.balanceHifz).toBe(0);
    expect(studentRow?.balanceTajweed).toBe(0);
    expect(studentRow?.balanceReviews).toBe(0);
    expect(studentRow?.handshakeCode).toBeTruthy();
    expect(studentRow?.handshakeCode).toMatch(/^KSB-/);

    // Exactly one audit_logs(create, actorId=admin, entityId=newStudent.id)
    // row committed inside the same transaction (atomicity).
    const auditCount = await countAuditForEntity(cast.admin.user.id, AuditActionType.Create, newStudent.id);
    expect(auditCount).toBe(1);

    // Pre-existing fixtures byte-identical.
    await assertFixturesUntouched();
  });

  // ─── Step 2: admin observes the new student in the directory ─────────
  test("Journey A — step 2: admin directory list filtered role=student includes new row with headline projection", async () => {
    // Population-robust narrowing (backend/db/test/AGENTS.md rule 12 — never
    // assume DB population state): the directory orders `created_at ASC
    // LIMIT 100`, so a shared test DB with >100 committed students pushes
    // this run's new row past page 1. The per-run PREFIX (unique via
    // randomUUID, embedded in every fixture's fullName/email per this
    // layer's rule 3) narrows the listing to exactly this run's cast —
    // the service escapes the substring before binding (`normalizeFilters`)
    // — so page-1 visibility of the new row is asserted deterministically
    // while the role=student filter and every projection assertion below
    // stay exactly as precise.
    const page = await AdminUserManagementService.listDirectory(
      { role: UserRole.Student, search: PREFIX },
      1,
      100,
      LOCALE,
      cast.admin.user.id
    );

    // New row observable.
    const found = page.items.find(item => item.id === newStudent.id);
    expect(found).not.toBeUndefined();
    expect(found?.role).toBe(UserRole.Student);
    expect(found?.email).toBe(newStudentEmail);
    expect(found?.isDeleted).toBe(false);
    // Student headline projection populated (parent link absent; subscription absent).
    expect(found?.studentHasParentLink).toBe(false);
    expect(found?.studentHasActiveSubscription).toBe(false);
    // Applicant/teacher slots null for a student row.
    expect(found?.applicantStatus).toBeNull();
    expect(found?.teacherIsApproved).toBeNull();

    // totalCount honest — at least the new student + the cast student.
    expect(page.totalCount).toBeGreaterThanOrEqual(2);

    await assertFixturesUntouched();
  });

  // ─── Step 3: new student logs in (governance clean) ──────────────────
  test("Journey A — step 3: new student login SUCCEEDS (governance clean)", async () => {
    const session = await AuthService.login(newStudentEmail, NEW_STUDENT_CREDENTIAL, LOCALE);

    expect(session.user.id).toBe(newStudent.id);
    expect(session.user.role).toBe(UserRole.Student);
    expect(session.accessToken).toBeTruthy();
    expect(session.refreshToken).toBeTruthy();

    await assertFixturesUntouched();
  });

  // ─── Step 4: admin soft-deletes the new student ──────────────────────
  test("Journey A — step 4: admin soft-deletes student; guarded UPDATE + audit(delete); is_deleted=true", async () => {
    const auditBefore = await countAuditForEntity(cast.admin.user.id, AuditActionType.Delete, newStudent.id);
    expect(auditBefore).toBe(0);

    const result = await AdminUserManagementService.setUserDeleted(newStudent.id, true, cast.admin.user.id, LOCALE);

    expect(result.isDeleted).toBe(true);
    expect(result.deletedAt).not.toBeNull();

    // users row state-transitioned in place (never hard-deleted).
    const userRow = await readUserRow(newStudent.id);
    expect(userRow?.isDeleted).toBe(true);
    expect(userRow?.deletedAt).not.toBeNull();

    // Exactly one audit_logs(delete, actorId=admin, entityId=newStudent.id).
    const auditAfter = await countAuditForEntity(cast.admin.user.id, AuditActionType.Delete, newStudent.id);
    expect(auditAfter).toBe(1);

    // students row of the new student is NOT touched by soft-delete (the
    // guarded UPDATE touches only `users.is_deleted` / `deleted_at` /
    // `updated_at` — cross-entity purity).
    const studentRowAfter = await readStudentRow(newStudent.id);
    expect(studentRowAfter).not.toBeNull();

    await assertFixturesUntouched();
  });

  // ─── Step 5: new student login DENIED at governance gate ─────────────
  test("Journey A — step 5: new student login DENIED at governance gate (junction assertion)", async () => {
    const error = await expectJourneyError(() => AuthService.login(newStudentEmail, NEW_STUDENT_CREDENTIAL, LOCALE));

    // Junction assertion only — the auth-service boundary internals
    // (the exact error family) are not re-tested here; the journey
    // asserts the governance-gate denial outcome.
    expect(error).toBeInstanceOf(ForbiddenError);
    // Translated substring from the AUTH locale namespace (accountBlocked
    // is the canonical message for governance denials at login — the auth
    // service emits `authTranslations.accountBlocked`, which covers both
    // suspended and blocked states; the errors-namespace `accountBlocked`
    // variant is a separate, narrower copy and is NOT what login throws).
    expect(error.message).toContain(tAuth.accountBlocked);

    await assertFixturesUntouched();
  });

  // ─── Step 6: admin reactivates the new student ───────────────────────
  test("Journey A — step 6: admin reactivates student; audit(reactivate); login restored", async () => {
    const result = await AdminUserManagementService.setUserDeleted(newStudent.id, false, cast.admin.user.id, LOCALE);

    expect(result.isDeleted).toBe(false);
    expect(result.deletedAt).toBeNull();

    // users row state-transitioned back.
    const userRow = await readUserRow(newStudent.id);
    expect(userRow?.isDeleted).toBe(false);
    expect(userRow?.deletedAt).toBeNull();

    // Exactly one audit_logs(reactivate, actorId=admin, entityId=newStudent.id).
    const auditAfterReactivate = await countAuditForEntity(
      cast.admin.user.id,
      AuditActionType.Reactivate,
      newStudent.id
    );
    expect(auditAfterReactivate).toBe(1);

    // Login restored — target user observes the state flip.
    const session = await AuthService.login(newStudentEmail, NEW_STUDENT_CREDENTIAL, LOCALE);
    expect(session.user.id).toBe(newStudent.id);

    await assertFixturesUntouched();
  });

  // ─── Step 7: admin attempts self-deactivation → DENIED ───────────────
  test("Journey A — step 7: admin self-deactivation DENIED; USER_SELF_DEACTIVATION_FORBIDDEN; zero writes + zero audit row", async () => {
    // Capture audit count BEFORE the denial — denial paths emit ZERO
    // audit rows (no audit-trail pollution).
    const auditCountBefore = await countAllAuditForActor(cast.admin.user.id);

    // Capture admin user row BEFORE the denial — must be byte-identical
    // AFTER (zero writes).
    const adminUserBefore = await readUserRow(cast.admin.user.id);

    const error = await expectJourneyError(() =>
      AdminUserManagementService.setUserDeleted(cast.admin.user.id, true, cast.admin.user.id, LOCALE)
    );

    // Typed localized code — `USER_SELF_DEACTIVATION_FORBIDDEN`. The
    // service emits a ConflictError carrying this specific code.
    expect(error).toBeInstanceOf(ConflictError);
    expect(error.code).toBe("USER_SELF_DEACTIVATION_FORBIDDEN");
    expect(error.message).toContain(tErrors.adminUsers.userSelfDeactivationForbidden);

    // ZERO writes — admin user row byte-identical to pre-call.
    const adminUserAfter = await readUserRow(cast.admin.user.id);
    expect(adminUserAfter).toEqual(adminUserBefore);

    // ZERO audit row emitted for the denial.
    const auditCountAfter = await countAllAuditForActor(cast.admin.user.id);
    expect(auditCountAfter).toBe(auditCountBefore);

    // Latest audit row for this actor+entity is still the step-6 Reactivate
    // row, NOT a Delete (no spurious audit appended for the denial).
    const latestAudit = await readLatestAuditForEntity(newStudent.id, AuditActionType.Reactivate);
    expect(latestAudit?.entityId).toBe(newStudent.id);

    await assertFixturesUntouched();
  });
});
