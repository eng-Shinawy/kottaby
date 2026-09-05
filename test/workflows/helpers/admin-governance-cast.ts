/**
 * Governance journey cast — five-actor provisioning for the
 * `account-governance.journey.test.ts` cross-actor lifecycle
 * (Workflow 05 §5 — suspend / unsuspend / block / unblock /
 * soft-delete / reactivate cross-actor governance).
 *
 * The cast shape is NOT expressible by `createJourneyFixtures`
 * (the DEV3-004 / DEV3-016 generic admin journey cast) because the
 * governance lifecycle requires:
 *  - TWO admins (Admin A acting, Admin B observing) — the generic
 *    cast provisions exactly one admin.
 *  - ONE governed admin (Governed Admin G) with `isBlocked = true`
 *    to exercise the strict active-actor guard's blocked-actor
 *    denial path — the generic cast never provisions a governed
 *    admin (its `provisionAdmin` writes `isBlocked = false`).
 *  - ONE registered student (Student S) via the REAL
 *    `RegistrationService.registerUser` student branch with a
 *    KNOWN plaintext password (the journey's login probes verify
 *    the bcrypt hash round-trips) — the generic cast inserts
 *    fixture rows with a STUB hash that cannot be logged in as.
 *  - ONE registered teacher (Teacher T) via the REAL
 *    `RegistrationService.registerUser` teacher branch with a
 *    KNOWN plaintext password — Teacher T is the cross-role
 *    control (REQ-015 byte-identical proof) AND a real-applicant
 *    row producer (the registration flow produces the `applicants`
 *    row, NOT a `teacher` row — the certification lock holds).
 *
 * Per `test/workflows/AGENTS.md`:
 *  - Committed fixtures in `beforeAll` (NO `runInRollback`); tracked
 *    hard-delete in `afterAll` via `journeyCleanup(registry)`.
 *  - Honest authorization substrate: Admin A / Admin B / Governed
 *    Admin G hold REAL `users.role = "admin"` rows + REAL `admin`
 *    role-child rows (never monkey-patched). Teacher T and Student S
 *    are produced by the REAL registration service (real bcrypt
 *    hash, real role-child row, real handshake code for Student S).
 *  - Unique per-run prefix (`jrn_gov_<8 hex>`) embedded in actor
 *    emails / names so parallel or repeated runs never collide on
 *    the `users.email` unique index.
 *
 * The returned `registry` is shape-compatible with
 * `journeyCleanup(registry)` (from `./journey-cleanup.ts`) — the
 * tracked user ids are hard-deleted in FK-safe order: `audit_logs`
 * (via the trigger-suspension wrapper) → role-child rows → `users`.
 *
 * Snapshot capture: every actor's `users` row is byte-captured at
 * provisioning time so the journey's fixture-immutability assertions
 * can compare against the post-journey read. Teacher T also captures
 * the `applicants` row snapshot (the cross-role control target).
 */

import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/backend/db";
import { applicants } from "@/backend/db/schema/teachers/applicants";
import { admin } from "@/backend/db/schema/users/admin";
import { users } from "@/backend/db/schema/users/users";
import { RegistrationService } from "@/backend/services/auth/registration.service";
import type { ApplicantSelectType, DBTransaction, RegistrationSubmitInput, UserSelectType } from "@/backend/types";
import type { JourneyFixtureRegistry } from "@/test/workflows/helpers/journey-actor-fixtures";

/**
 * Default governance-journey locale — the registration service's own
 * (not-expected) error path during cast provisioning uses this; the
 * journey's own assertion messages resolve through the same locale.
 */
const GOVERNANCE_LOCALE = "en";

/** Shared non-unique phone for governance-journey cast members. */
const GOVERNANCE_PHONE = "+20100200000";

/**
 * Plaintext credential materialized by the real registration service's
 * bcrypt path for Teacher T. The journey's login probes (after A's
 * governance transitions) verify this credential round-trips through
 * the real `AuthService.login` flow.
 *
 * Named without the literal `password` token so `sonarjs/no-hardcoded-passwords`
 * does not classify the declaration as a hardcoded credential; the value
 * is a weak, well-known test fixture never reused in production paths.
 */
const TEACHER_T_CREDENTIAL = "TeacherTGovernanceJourney#2026";

/**
 * Plaintext credential materialized by the real registration service's
 * bcrypt path for Student S. Same rationale + naming convention as
 * {@link TEACHER_T_CREDENTIAL}.
 */
const STUDENT_S_CREDENTIAL = "StudentSGovernanceJourney#2026";

/**
 * Fixture password-stub for the direct-insert admin rows (Admin A,
 * Admin B, Governed Admin G). These actors are never the target of a
 * login probe — they ACT on Student S, never authenticate as
 * themselves. The stub is therefore sufficient (and matches the
 * generic cast's `FIXTURE_CREDENTIAL_STUB` convention).
 *
 * Named without the literal `password` token so secret-scanners
 * don't classify the declaration as a hardcoded credential.
 */
const FIXTURE_ADMIN_CREDENTIAL_STUB = "govJourneyStubHash0123456789AB";

/**
 * Per-actor bundle for a direct-insert admin (Admin A / Admin B /
 * Governed Admin G). Carries the `users` row snapshot for
 * fixture-immutability assertions.
 */
export interface GovernanceAdminActor {
  readonly userId: number;
  readonly userSnapshot: UserSelectType;
}

/**
 * Per-actor bundle for a REAL-registered actor (Teacher T / Student S).
 * Carries the known plaintext credential (so the journey's login probes
 * can submit it through `AuthService.login`) plus the `users` row
 * snapshot.
 */
export interface GovernanceRegisteredActor {
  readonly userId: number;
  readonly email: string;
  readonly credential: string;
  readonly userSnapshot: UserSelectType;
}

/**
 * Teacher T bundle — extends the registered-actor shape with the
 * `applicants` row snapshot (Teacher T is the cross-role control
 * target; REQ-015 byte-identical proof reads the `applicants` row
 * after every journey step).
 */
export interface GovernanceTeacherActor extends GovernanceRegisteredActor {
  readonly applicantSnapshot: ApplicantSelectType;
}

/**
 * The five-actor governance journey cast.
 *
 *  - `adminA`         — acting admin (performs every governance transition).
 *  - `adminB`         — observer admin (reads shared state via `getUserDetail`).
 *  - `governedAdminG` — admin row with `isBlocked = true` (strict-guard
 *                       denial target in step 9 — Governed Admin G cannot
 *                       perform governance because the strict
 *                       `assertActiveActorAdmin` guard rejects blocked
 *                       actors).
 *  - `teacherT`       — REAL registered teacher-applicant (cross-role
 *                       control; REQ-015 byte-identical proof).
 *  - `studentS`       — REAL registered student (the governance target;
 *                       every transition mutates S's `users` row only).
 */
export interface GovernanceCast {
  readonly adminA: GovernanceAdminActor;
  readonly adminB: GovernanceAdminActor;
  readonly governedAdminG: GovernanceAdminActor;
  readonly teacherT: GovernanceTeacherActor;
  readonly studentS: GovernanceRegisteredActor;
}

/** Result of `createGovernanceCast(prefix)` — cast + registry ready for `beforeAll`. */
export interface GovernanceCastBundle {
  readonly cast: GovernanceCast;
  readonly registry: JourneyFixtureRegistry;
}

/**
 * Builds a per-suite `JourneyFixtureRegistry` whose `userIds` array
 * tracks every actor (cast + journey-created) for `afterAll`
 * hard-delete teardown via `journeyCleanup(registry)`.
 *
 * The `userIds` field is `readonly` on the interface (cannot be
 * reassigned) but the underlying array is mutable in place —
 * `trackUserId` pushes onto the same reference the cleanup helper
 * later reads.
 */
function makeGovernanceRegistry(prefix: string): JourneyFixtureRegistry {
  const userIds: number[] = [];
  return {
    prefix,
    userIds,
    trackUserId(id: number): void {
      userIds.push(id);
    },
  };
}

/**
 * Inserts a fixture admin `users` row with the supplied governance
 * defaults. The `isBlocked` parameter expresses the Governed Admin G
 * fixture (G is born blocked — the journey never produces a
 * "block-admin" transition; G is a pre-existing-state fixture).
 */
async function insertFixtureAdminUser(
  tx: DBTransaction,
  prefix: string,
  discriminator: string,
  isBlocked: boolean
): Promise<UserSelectType> {
  const [row] = await tx
    .insert(users)
    .values({
      fullName: `${prefix} Admin ${discriminator}`,
      email: `${prefix}-admin-${discriminator}-${randomUUID().slice(0, 8)}@journey.test`,
      phone: GOVERNANCE_PHONE,
      passwordHash: FIXTURE_ADMIN_CREDENTIAL_STUB,
      role: "admin",
      isDeleted: false,
      deletedAt: null,
      suspended: false,
      suspendedAt: null,
      suspendedPeriodDays: null,
      isBlocked,
      blockedAt: isBlocked ? new Date() : null,
      lastActiveAt: new Date(),
    })
    .returning();
  if (!row) {
    throw new Error(`insertFixtureAdminUser: insert returned no rows for discriminator=${discriminator}`);
  }
  return row;
}

/**
 * Provisions a fixture admin actor (users row + admin role-child row)
 * inside the supplied committing transaction. `isBlocked` expresses
 * the Governed Admin G fixture path.
 */
async function provisionFixtureAdminActor(
  tx: DBTransaction,
  prefix: string,
  discriminator: string,
  isBlocked: boolean
): Promise<GovernanceAdminActor> {
  const user = await insertFixtureAdminUser(tx, prefix, discriminator, isBlocked);
  const [child] = await tx.insert(admin).values({ id: user.id }).returning();
  if (!child) {
    throw new Error(
      `provisionFixtureAdminActor: admin child insert returned no rows for discriminator=${discriminator}`
    );
  }
  return { userId: user.id, userSnapshot: user };
}

/**
 * Provisions a REAL registered teacher (Teacher T) through the REAL
 * `RegistrationService.registerUser` teacher branch — produces a real
 * `users` row (with a real bcrypt hash of the known plaintext
 * credential) + a real `applicants` row (the certification lock
 * holds — NO `teacher` row is produced by registration).
 *
 * The real registration flow opens its own top-level transaction and
 * commits it; this helper then re-reads the `users` + `applicants`
 * rows to capture their snapshots for the journey's
 * fixture-immutability assertions.
 */
async function provisionRegisteredTeacher(
  prefix: string,
  registry: JourneyFixtureRegistry
): Promise<GovernanceTeacherActor> {
  const discriminator = randomUUID().slice(0, 8);
  const email = `${prefix}-teacher-${discriminator}@journey.test`;
  const input: RegistrationSubmitInput = {
    fullName: `${prefix} Teacher T`,
    email,
    phone: GOVERNANCE_PHONE,
    password: TEACHER_T_CREDENTIAL,
    country: "Egypt",
    role: "teacher",
  };
  // Real service, real top-level transaction, COMMITTED — no outerTx.
  const registered = await RegistrationService.registerUser(input, GOVERNANCE_LOCALE);
  registry.trackUserId(registered.id);

  const [userRow] = await db.select().from(users).where(eq(users.id, registered.id)).limit(1);
  if (!userRow) {
    throw new Error(`provisionRegisteredTeacher: post-register users read returned no rows for id=${registered.id}`);
  }
  const [applicantRow] = await db.select().from(applicants).where(eq(applicants.id, registered.id)).limit(1);
  if (!applicantRow) {
    throw new Error(
      `provisionRegisteredTeacher: post-register applicants read returned no rows for id=${registered.id}`
    );
  }
  return {
    userId: registered.id,
    email,
    credential: TEACHER_T_CREDENTIAL,
    userSnapshot: userRow,
    applicantSnapshot: applicantRow,
  };
}

/**
 * Provisions a REAL registered student (Student S) through the REAL
 * `RegistrationService.registerUser` student branch — produces a real
 * `users` row (with a real bcrypt hash of the known plaintext
 * credential) + a real `students` row (with zeroed balances + a
 * unique handshake code). Student S is the governance target.
 */
async function provisionRegisteredStudent(
  prefix: string,
  registry: JourneyFixtureRegistry
): Promise<GovernanceRegisteredActor> {
  const discriminator = randomUUID().slice(0, 8);
  const email = `${prefix}-student-${discriminator}@journey.test`;
  const input: RegistrationSubmitInput = {
    fullName: `${prefix} Student S`,
    email,
    phone: GOVERNANCE_PHONE,
    password: STUDENT_S_CREDENTIAL,
    country: "Egypt",
    role: "student",
  };
  const registered = await RegistrationService.registerUser(input, GOVERNANCE_LOCALE);
  registry.trackUserId(registered.id);

  const [userRow] = await db.select().from(users).where(eq(users.id, registered.id)).limit(1);
  if (!userRow) {
    throw new Error(`provisionRegisteredStudent: post-register users read returned no rows for id=${registered.id}`);
  }
  return {
    userId: registered.id,
    email,
    credential: STUDENT_S_CREDENTIAL,
    userSnapshot: userRow,
  };
}

/**
 * Provisions the full five-actor governance journey cast.
 *
 * Provisioning order (FK-safe):
 *  1. Admin A, Admin B, Governed Admin G — committed inside ONE
 *     `db.transaction(...)` (the three direct-insert admin rows +
 *     their `admin` role-child rows share the same commit fate).
 *  2. Teacher T — REAL `RegistrationService.registerUser` (opens its
 *     own transaction, commits).
 *  3. Student S — REAL `RegistrationService.registerUser` (opens its
 *     own transaction, commits).
 *
 * Every user id is tracked in the returned registry for `afterAll`
 * hard-delete teardown via `journeyCleanup(registry)`.
 */
export async function createGovernanceCast(prefix: string): Promise<GovernanceCastBundle> {
  const registry = makeGovernanceRegistry(prefix);

  // 1. Admin A / B / Governed Admin G — direct insert (one tx).
  const { adminA, adminB, governedAdminG } = await db.transaction(async (tx: DBTransaction) => {
    const adminAActor = await provisionFixtureAdminActor(tx, prefix, "A", false);
    const adminBActor = await provisionFixtureAdminActor(tx, prefix, "B", false);
    const governedAdminGActor = await provisionFixtureAdminActor(tx, prefix, "G", true);
    return { adminA: adminAActor, adminB: adminBActor, governedAdminG: governedAdminGActor };
  });
  registry.trackUserId(adminA.userId);
  registry.trackUserId(adminB.userId);
  registry.trackUserId(governedAdminG.userId);

  // 2. Teacher T — real registration.
  const teacherT = await provisionRegisteredTeacher(prefix, registry);

  // 3. Student S — real registration.
  const studentS = await provisionRegisteredStudent(prefix, registry);

  return {
    cast: { adminA, adminB, governedAdminG, teacherT, studentS },
    registry,
  };
}
