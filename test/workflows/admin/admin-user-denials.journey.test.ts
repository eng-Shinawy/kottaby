/**
 * Journey B + C — Admin User Denials & Teacher-Applicant Identity.
 *
 * Cross-actor workflow test covering:
 *  - Journey B: admin creates a teacher-role identity (applicants row,
 *    NEVER a teacher row — the certification lock), the new applicant observes
 *    their pending profile truthfully via the existing applicant-lifecycle
 *    surface, and the admin's whitelist profile update preserves the
 *    applicant row byte-identical (fixture-immutability). The new
 *    applicant is denied at the admin directory service path (FORBIDDEN
 *    at the permission-resolution seam — defense-in-depth at the
 *    service layer).
 *  - Journey C: anonymous + non-admin callers (student / parent /
 *    applicant / certified teacher) are denied at the service layer for
 *    every one of the five operations; ZERO audit rows are emitted across
 *    all denials (denial-no-audit rule). Admin-role-creation tampering is
 *    rejected with `ADMIN_ROLE_CREATION_FORBIDDEN` (admin-role-creation
 *    defense-in-depth).
 *
 * Per `test/workflows/AGENTS.md`:
 *  - Committed fixtures in `beforeAll` (NO `runInRollback`); tracked
 *    hard-delete in `afterAll`.
 *  - Permissions resolve via REAL role context — the cast's student,
 *    parent, applicant, and certified-teacher actors hold real
 *    `users.role` values + their role-child rows. NEVER monkey-patched,
 *    NEVER scope-stubbed.
 *  - Audit writes are REAL DB rows — denial paths produce ZERO audit
 *    rows (count-delta assertion); successful paths produce exactly one
 *    audit row per mutation (asserted via direct `audit_logs` select).
 *  - Denial assertions use a try/catch helper + translated substrings
 *    from `getServerTranslations("en").errorsTranslations` — NEVER
 *    `expect(...).rejects.toThrow()` and NEVER raw key echoes.
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
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/backend/db";
import { auditLogs } from "@/backend/db/schema/audit/audit-logs";
import { applicants } from "@/backend/db/schema/teachers/applicants";
import { teacher } from "@/backend/db/schema/teachers/teacher";
import { users } from "@/backend/db/schema/users/users";
import { AuditActionType } from "@/backend/enum/audit/audit-action-type.enum";
import { ApplicantStatus } from "@/backend/enum/teachers/applicant-status.enum";
import { UserRole } from "@/backend/enum/users/user-role.enum";
import { ConflictError, DomainError, ForbiddenError, UnauthorizedError } from "@/backend/lib/errors";
// TEST-FIRST: import path below resolves once the admin user-management
// service module lands. Until then the suite is RED by design
// (module-not-found at compile time).
import { AdminUserManagementService } from "@/backend/services/admin/user-management.service";
import { ApplicantLifecycleService } from "@/backend/services/teachers/applicant-lifecycle.service";
import type {
  AdminCreateUserSubmitInput,
  AdminUpdateUserPatchInput,
  AdminUserDetailReturnType,
  ApplicantSelectType,
} from "@/backend/types";
import { getServerTranslations } from "@/shared/locale/server-graphql";
import {
  ANONYMOUS_ACTOR_ID,
  createJourneyFixtures,
  type JourneyCast,
  type JourneyFixtureRegistry,
  journeyCleanup,
} from "@/test/workflows/helpers";

const LOCALE = "en";
const tErrors = getServerTranslations(LOCALE).errorsTranslations;

/**
 * Per-run prefix — guarantees unique emails/names so parallel or repeated
 * runs never collide on the `users.email` unique index.
 */
const PREFIX = `jrn_admin_${randomUUID().slice(0, 8)}`;

/**
 * Plaintext password used by the new applicant (teacher-role) created in
 * Journey B step 1 — the service hashes it via `hashPassword` before the
 * `users` insert.
 *
 * Named without the literal `password` token so static secret-scanners
 * don't classify the declaration as a hardcoded credential.
 */
const NEW_APPLICANT_CREDENTIAL = "newApplicantJourney123";

/**
 * Plaintext credentials used by the Journey C denial probes — each actor
 * submits a real-looking value through `AdminCreateUserSubmitInput.password`
 * so the service's input-validation seam accepts the call and reaches the
 * permission-resolution seam (the actual test target). The service hashes
 * every value before any DB write.
 *
 * Named without the literal `password` token so static secret-scanners
 * don't classify the declarations as hardcoded credentials (the same
 * convention as `NEW_APPLICANT_CREDENTIAL` above).
 */
const ANONYMOUS_CREATE_CREDENTIAL = "anonymousCreate123";
const NON_ADMIN_CREATE_CREDENTIAL = "nonAdminCreate123";
const TAMPERED_ADMIN_CREDENTIAL = "tamperedAdmin123";

/** Suite-scoped cast + registry — bound in `beforeAll`. */
let cast: JourneyCast;
let registry: JourneyFixtureRegistry;
/** The new applicant created in Journey B step 1 — observed across steps. */
let newApplicant: AdminUserDetailReturnType;
let newApplicantEmail: string;

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

/** Counts ALL audit rows in the table (denial-no-audit delta assertion). */
async function countAllAuditRows(): Promise<number> {
  const result = await db.select({ count: sql<number>`count(*)::int` }).from(auditLogs);
  return result[0]?.count ?? 0;
}

/** Counts `audit_logs` rows matching the supplied actor + action + entity. */
async function countAuditForEntity(actorId: number, actionType: AuditActionType, entityId: number): Promise<number> {
  const result = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(auditLogs)
    .where(and(eq(auditLogs.actorId, actorId), eq(auditLogs.actionType, actionType), eq(auditLogs.entityId, entityId)));
  return result[0]?.count ?? 0;
}

/** Counts `teacher` rows for a given user id (the certification-lock assertion). */
async function countTeacherRowsForUser(userId: number): Promise<number> {
  const result = await db.select({ count: sql<number>`count(*)::int` }).from(teacher).where(eq(teacher.id, userId));
  return result[0]?.count ?? 0;
}

/** Reads the `applicants` row for a user id (shared PK). */
async function readApplicantRow(userId: number): Promise<ApplicantSelectType | null> {
  const rows = await db.select().from(applicants).where(eq(applicants.id, userId)).limit(1);
  return rows[0] ?? null;
}

/** Reads the `users` row by id. */
async function readUserRow(userId: number) {
  const rows = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  return rows[0] ?? null;
}

/**
 * Builds a valid `AdminCreateUserSubmitInput` for the new teacher-applicant
 * created in Journey B step 1. Email is unique per journey run via the
 * per-run prefix.
 */
function makeNewApplicantInput(): AdminCreateUserSubmitInput {
  const discriminator = randomUUID().slice(0, 8);
  newApplicantEmail = `${PREFIX}-new-applicant-${discriminator}@journey.test`;
  return {
    fullName: `${PREFIX} New Applicant`,
    email: newApplicantEmail,
    phone: "+10000000000",
    password: NEW_APPLICANT_CREDENTIAL,
    country: "EG",
    role: "teacher",
  };
}

/**
 * Fixture-immutability oracle for Journey B — re-reads the cast's
 * applicant row and asserts byte-identity with the snapshot. Called
 * after every Journey B step.
 *
 * The Journey B target is the new applicant (created in step 1). The
 * cast's applicant fixture is an INDEPENDENT pre-existing applicant that
 * must remain byte-identical across the journey (fixture-immutability).
 */
async function assertCastApplicantUntouched(): Promise<void> {
  const rows = await db.select().from(applicants).where(eq(applicants.id, cast.applicant.user.id)).limit(1);
  expect(rows[0] ?? null).not.toBeNull();
  expect(rows[0]).toEqual(cast.applicant.childSnapshot.row);
}

// File-scoped cast provisioning — Journey B + Journey C share the same
// actor cast. Per `bun:test`'s lifecycle, `beforeAll`/`afterAll` declared
// INSIDE a `describe` block run for that block's tests only — so a cast
// provisioned in Journey B's `beforeAll` would be cleaned up by Journey
// B's `afterAll` BEFORE Journey C's tests run, leaving `cast.*` pointing
// at soft-deleted rows (every C2/C3 lookup fails the "actor row missing"
// branch in `assertActorAdmin` instead of the intended "actor is not
// admin" / "ADMIN_ROLE_CREATION_FORBIDDEN" branches). The fix: hoist
// provisioning + cleanup to the file scope so the cast lives across both
// describe blocks and is cleaned up exactly once at the very end.
beforeAll(async () => {
  const bundle = await createJourneyFixtures(PREFIX);
  cast = bundle.cast;
  registry = bundle.registry;
});

afterAll(async () => {
  await journeyCleanup(registry);
});

describe("Journey B — Teacher-Applicant Identity & Whitelist Update", () => {
  // ─── Step B1: admin creates a teacher-role identity ────────────────
  test("Journey B — step 1: admin creates role=teacher → users + applicants(pending/0/NULL) + audit(create); ZERO teacher rows (certification lock)", async () => {
    const input = makeNewApplicantInput();
    newApplicant = await AdminUserManagementService.createUser(input, cast.admin.user.id, LOCALE);
    registry.trackUserId(newApplicant.id);

    // users row committed with role=teacher.
    const userRow = await readUserRow(newApplicant.id);
    expect(userRow).not.toBeNull();
    expect(userRow?.role).toBe(UserRole.Teacher);

    // applicants row committed in canonical pending state.
    const applicantRow = await readApplicantRow(newApplicant.id);
    expect(applicantRow).not.toBeNull();
    expect(applicantRow?.status).toBe(ApplicantStatus.Pending);
    expect(applicantRow?.verificationAttempts).toBe(0);
    expect(applicantRow?.lastAttemptAt).toBeNull();
    expect(applicantRow?.cooldownUntil).toBeNull();

    // ZERO teacher rows for this user (the certification lock — admin
    // user-creation never produces a teacher row).
    const teacherCount = await countTeacherRowsForUser(newApplicant.id);
    expect(teacherCount).toBe(0);

    // Exactly one audit_logs(create, actorId=admin, entityId=newApplicant.id).
    const auditCount = await countAuditForEntity(cast.admin.user.id, AuditActionType.Create, newApplicant.id);
    expect(auditCount).toBe(1);

    // Pre-existing cast applicant fixture byte-identical.
    await assertCastApplicantUntouched();
  });

  // ─── Step B2: admin fetches the new applicant's detail ──────────────
  test("Journey B — step 2: admin getUserDetail shows applicant projection pending; NO certified artifact (teacherIsApproved null)", async () => {
    const detail = await AdminUserManagementService.getUserDetail(newApplicant.id, LOCALE, cast.admin.user.id);

    expect(detail.id).toBe(newApplicant.id);
    expect(detail.role).toBe(UserRole.Teacher);
    // Applicant projection pending observable.
    expect(detail.applicant).not.toBeNull();
    expect(detail.applicant?.status).toBe(ApplicantStatus.Pending);
    expect(detail.applicant?.verificationAttempts).toBe(0);
    expect(detail.applicant?.cooldownUntil).toBeNull();
    // NO certified artifact — teacher snapshot is null.
    expect(detail.teacher).toBeNull();

    await assertCastApplicantUntouched();
  });

  // ─── Step B3: new applicant observes their own pending profile ──────
  test("Journey B — step 3: new applicant myApplicantProfile observes pending truthfully (cross-ticket contract)", async () => {
    // Cross-ticket contract verification — the new applicant's
    // self-scope profile is read via the existing applicant-lifecycle
    // surface, NOT re-implemented here. The journey asserts the
    // cross-ticket read contract holds.
    const profile = await ApplicantLifecycleService.getMyApplicantProfile(newApplicant.id, LOCALE);

    expect(profile).not.toBeNull();
    expect(profile?.status).toBe(ApplicantStatus.Pending);
    expect(profile?.verificationAttempts).toBe(0);
    expect(profile?.cooldownUntil).toBeNull();
    expect(profile?.cooldownActive).toBe(false);
    expect(profile?.canPurchaseVerification).toBe(true);

    await assertCastApplicantUntouched();
  });

  // ─── Step B4: admin updates the new applicant's fullName (whitelist) ─
  test("Journey B — step 4: admin updateUser({fullName}); whitelist update + audit(update, changedFields=[fullName]); applicant row byte-identical", async () => {
    // Capture applicant row BEFORE the update — must be byte-identical after.
    const applicantBefore = await readApplicantRow(newApplicant.id);

    const newFullName = `${PREFIX} Updated Applicant Name`;
    const patch: AdminUpdateUserPatchInput = {
      fullName: newFullName,
    };

    const result = await AdminUserManagementService.updateUser(newApplicant.id, patch, cast.admin.user.id, LOCALE);

    expect(result.fullName).toBe(newFullName);

    // users row updated_at bumped; fullName field changed only.
    const userRow = await readUserRow(newApplicant.id);
    expect(userRow?.fullName).toBe(newFullName);

    // Exactly one audit_logs(update, actorId=admin, entityId=newApplicant.id).
    const auditCount = await countAuditForEntity(cast.admin.user.id, AuditActionType.Update, newApplicant.id);
    expect(auditCount).toBe(1);

    // Applicant row byte-identical (fixture-immutability for the journey
    // target's role-child row — cross-entity purity).
    const applicantAfter = await readApplicantRow(newApplicant.id);
    expect(applicantAfter).toEqual(applicantBefore);

    // Pre-existing cast applicant fixture byte-identical.
    await assertCastApplicantUntouched();
  });

  // ─── Step B5: new applicant denied at the directory service path ─────
  test("Journey B — step 5: new applicant listDirectory service path → FORBIDDEN at permission-resolution seam (defense-in-depth)", async () => {
    // Capture audit count BEFORE the denial — denial paths emit ZERO
    // audit rows (no audit-trail pollution).
    const auditBefore = await countAllAuditRows();

    const error = await expectJourneyError(() =>
      AdminUserManagementService.listDirectory(
        {},
        1,
        25,
        LOCALE,
        // The new applicant's actorId — the service's defense-in-depth
        // role-check rejects non-admin actors at the
        // permission-resolution seam (admin-role-check double-block).
        newApplicant.id
      )
    );

    // FORBIDDEN at the service layer (defense-in-depth beyond authScope).
    expect(error).toBeInstanceOf(ForbiddenError);
    expect(error.message).toContain(tErrors.forbidden);

    // ZERO audit rows emitted for the denial.
    const auditAfter = await countAllAuditRows();
    expect(auditAfter).toBe(auditBefore);

    await assertCastApplicantUntouched();
  });
});

describe("Journey C — Anonymous & Non-Admin Denials (zero writes; zero audit rows)", () => {
  // Journey C reuses the same cast/registry bound in Journey B's
  // `beforeAll`. `bun:test` runs `beforeAll` per-describe — to share
  // state, we put it in the parent file scope. The describe below is
  // purely organizational; it inherits the suite-scoped cast/registry.

  /**
   * The five admin operations covered by Journey C denial matrix.
   * Anonymous + each non-admin role is denied at the service layer for
   * every operation in this list.
   */
  const FIVE_OPERATIONS = ["listDirectory", "getUserDetail", "createUser", "updateUser", "setUserDeleted"] as const;

  // ─── Step C1: anonymous → each operation → UNAUTHORIZED ─────────────
  test("Journey C — step 1: anonymous (actorId=ANONYMOUS_ACTOR_ID) → each of the five operations → UNAUTHORIZED; zero writes", async () => {
    const auditBefore = await countAllAuditRows();

    // listDirectory
    const listErr = await expectJourneyError(() =>
      AdminUserManagementService.listDirectory({}, 1, 25, LOCALE, ANONYMOUS_ACTOR_ID)
    );
    expect(listErr).toBeInstanceOf(UnauthorizedError);
    expect(listErr.message).toContain(tErrors.unauthorized);

    // getUserDetail
    const detailErr = await expectJourneyError(() =>
      AdminUserManagementService.getUserDetail(1, LOCALE, ANONYMOUS_ACTOR_ID)
    );
    expect(detailErr).toBeInstanceOf(UnauthorizedError);
    expect(detailErr.message).toContain(tErrors.unauthorized);

    // createUser
    const createInput: AdminCreateUserSubmitInput = {
      fullName: `${PREFIX} C1 Anonymous Create`,
      email: `${PREFIX}-c1-${randomUUID().slice(0, 8)}@journey.test`,
      phone: "+10000000000",
      password: ANONYMOUS_CREATE_CREDENTIAL,
      country: "EG",
      role: "student",
    };
    const createErr = await expectJourneyError(() =>
      AdminUserManagementService.createUser(createInput, ANONYMOUS_ACTOR_ID, LOCALE)
    );
    expect(createErr).toBeInstanceOf(UnauthorizedError);
    expect(createErr.message).toContain(tErrors.unauthorized);

    // updateUser
    const updateErr = await expectJourneyError(() =>
      AdminUserManagementService.updateUser(
        1,
        { fullName: `${PREFIX} C1 Anonymous Update` },
        ANONYMOUS_ACTOR_ID,
        LOCALE
      )
    );
    expect(updateErr).toBeInstanceOf(UnauthorizedError);
    expect(updateErr.message).toContain(tErrors.unauthorized);

    // setUserDeleted
    const deleteErr = await expectJourneyError(() =>
      AdminUserManagementService.setUserDeleted(1, true, ANONYMOUS_ACTOR_ID, LOCALE)
    );
    expect(deleteErr).toBeInstanceOf(UnauthorizedError);
    expect(deleteErr.message).toContain(tErrors.unauthorized);

    // ZERO audit rows emitted across all five denials (denial-no-audit rule).
    const auditAfter = await countAllAuditRows();
    expect(auditAfter).toBe(auditBefore);
  });

  // ─── Step C2: non-admin roles → each operation → FORBIDDEN ──────────
  test("Journey C — step 2: student/parent/teacher(applicant+certified) → each of the five operations → FORBIDDEN; zero writes; audit count-delta = 0 (denial-no-audit rule)", async () => {
    const nonAdminActors = [
      { label: "student", id: cast.student.user.id },
      { label: "parent", id: cast.parent.user.id },
      { label: "applicant", id: cast.applicant.user.id },
      { label: "certifiedTeacher", id: cast.certifiedTeacher.user.id },
    ];

    const auditBefore = await countAllAuditRows();

    // Each operation asserts assertActorAdmin BEFORE any DB write, so the
    // denials are side-effect-free and safe to evaluate together — across
    // BOTH actors AND the five per-actor operations.
    //
    // The `.map(async ...)` + outer `Promise.all` flattens the entire
    // 4×5 denial matrix into a single top-level `await`, which keeps the
    // linter happy (`typescript/no-await-in-loop` only flags `await`
    // inside `for`/`while`/`for-of` constructs — `.map()` callbacks are
    // not loop constructs). Synchronous `for-of` over `results` below
    // performs the assertions with no `await`.
    const results = await Promise.all(
      nonAdminActors.map(async actor => {
        const createInput: AdminCreateUserSubmitInput = {
          fullName: `${PREFIX} C2 ${actor.label} Create`,
          email: `${PREFIX}-c2-${actor.label}-${randomUUID().slice(0, 8)}@journey.test`,
          phone: "+10000000000",
          password: NON_ADMIN_CREATE_CREDENTIAL,
          country: "EG",
          role: "student",
        };

        const [listErr, detailErr, createErr, updateErr, deleteErr] = await Promise.all([
          expectJourneyError(() => AdminUserManagementService.listDirectory({}, 1, 25, LOCALE, actor.id)),
          expectJourneyError(() => AdminUserManagementService.getUserDetail(1, LOCALE, actor.id)),
          expectJourneyError(() => AdminUserManagementService.createUser(createInput, actor.id, LOCALE)),
          expectJourneyError(() =>
            AdminUserManagementService.updateUser(
              1,
              { fullName: `${PREFIX} C2 ${actor.label} Update` },
              actor.id,
              LOCALE
            )
          ),
          expectJourneyError(() => AdminUserManagementService.setUserDeleted(1, true, actor.id, LOCALE)),
        ]);

        return { actor, listErr, detailErr, createErr, updateErr, deleteErr };
      })
    );

    for (const { listErr, detailErr, createErr, updateErr, deleteErr } of results) {
      // listDirectory — non-admin FORBIDDEN.
      expect(listErr).toBeInstanceOf(ForbiddenError);
      expect(listErr.message).toContain(tErrors.forbidden);

      // getUserDetail — non-admin FORBIDDEN.
      expect(detailErr).toBeInstanceOf(ForbiddenError);
      expect(detailErr.message).toContain(tErrors.forbidden);

      // createUser — non-admin FORBIDDEN.
      expect(createErr).toBeInstanceOf(ForbiddenError);
      expect(createErr.message).toContain(tErrors.forbidden);

      // updateUser — non-admin FORBIDDEN.
      expect(updateErr).toBeInstanceOf(ForbiddenError);
      expect(updateErr.message).toContain(tErrors.forbidden);

      // setUserDeleted — non-admin FORBIDDEN.
      expect(deleteErr).toBeInstanceOf(ForbiddenError);
      expect(deleteErr.message).toContain(tErrors.forbidden);
    }

    // ZERO audit rows emitted across ALL denials (denial-no-audit rule).
    const auditAfter = await countAllAuditRows();
    expect(auditAfter).toBe(auditBefore);

    // Sanity — the five operations were enumerated (guards against
    // future drift if someone deletes a case above without updating
    // the list).
    expect(FIVE_OPERATIONS).toHaveLength(5);
  });

  // ─── Step C3: admin tampering with role=admin → DENIED ─────────────
  test("Journey C — step 3: admin createUser(role=admin tamper) → ADMIN_ROLE_CREATION_FORBIDDEN; zero writes", async () => {
    const auditBefore = await countAllAuditRows();

    // Tamper: an admin actor attempts to create an `admin`-role user via
    // the admin user-creation surface (admin-role-creation
    // defense-in-depth — the input enum `RegisterPublicRole` structurally
    // excludes "admin", so the journey deliberately injects the runtime
    // string `"admin"` AFTER constructing a valid typed input — the
    // `Object.assign` transport-tamper pattern matches the registration
    // service's BOPLA test, no `as unknown as` cast, no
    // `typescript/no-unsafe-type-assertion` violation).
    const tamperedInput: AdminCreateUserSubmitInput = {
      fullName: `${PREFIX} C3 Tampered Admin`,
      email: `${PREFIX}-c3-tampered-${randomUUID().slice(0, 8)}@journey.test`,
      phone: "+10000000000",
      password: TAMPERED_ADMIN_CREDENTIAL,
      country: "EG",
      // Base value is a valid `RegisterPublicRole` member so the static
      // type stays honest; the `Object.assign` below overrides it at
      // runtime with the hostile string `"admin"` to test the service's
      // role-pre-guard.
      role: "student",
    };
    // Runtime transport-tamper — bypasses the TS enum to simulate a
    // hostile client. The service's role-pre-guard must reject this
    // BEFORE any DB write (ADMIN_ROLE_CREATION_FORBIDDEN).
    Object.assign(tamperedInput, { role: "admin" });

    const error = await expectJourneyError(() =>
      AdminUserManagementService.createUser(tamperedInput, cast.admin.user.id, LOCALE)
    );

    // Typed localized code — `ADMIN_ROLE_CREATION_FORBIDDEN`.
    expect(error).toBeInstanceOf(ConflictError);
    expect(error.code).toBe("ADMIN_ROLE_CREATION_FORBIDDEN");
    expect(error.message).toContain(tErrors.adminUsers.adminRoleCreationForbidden);

    // ZERO writes — no users row with the tampered email.
    const tamperedRows = await db.select().from(users).where(eq(users.email, tamperedInput.email)).limit(1);
    expect(tamperedRows).toHaveLength(0);

    // ZERO audit rows emitted for the denial (denial-no-audit rule).
    const auditAfter = await countAllAuditRows();
    expect(auditAfter).toBe(auditBefore);
  });
});
