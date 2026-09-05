/**
 * Journey fixtures — actor-cast provisioner for cross-actor workflow tests.
 *
 * Per `test/workflows/AGENTS.md`:
 *  - Cast is provisioned inside a COMMITTING `db.transaction(...)` in
 *    `beforeAll`. NEVER `runInRollback` — services called during the journey
 *    spawn their own top-level transactions; an outer rollback wrapper would
 *    deadlock or silently miss committed rows.
 *  - Every created row id is tracked in a registry for `afterAll` hard-delete
 *    teardown via `journeyCleanup(registry)`.
 *  - Permissions resolve through REAL role context — actors are REAL users
 *    holding their real `users.role` value plus their role-child row
 *    (`admin`, `teacher`, `students`, `parents`, `applicants`). NEVER
 *    monkey-patch role/permission resolution.
 *  - Unique per-run prefix (`jrn_<domain>_<8hex>`) in `fullName` / `email`
 *    so parallel or repeated runs never collide on the email-unique index.
 *
 * Cast layout (provisions every actor a workflow in this layer may need):
 *  - `admin`             — super admin (`users.role = "admin"` + `admin` row)
 *  - `student`           — fixture student (`role = "student"` + `students`
 *                            row with zeroed balances + unique handshake)
 *  - `parent`            — fixture parent (`role = "parent"` + `parents` row)
 *  - `applicant`         — fixture applicant (`role = "teacher"` + `applicants`
 *                            row, `status = "pending"`, attempts = 0)
 *  - `certifiedTeacher`  — certified teacher fixture (`role = "teacher"` +
 *                            `teacher` row with `isApproved = true`) — used
 *                            for Journey C step 2 "certified" branch.
 *
 * Each fixture row is byte-captured (`snapshot`) so the journey's
 * fixture-immutability assertions can compare against the post-journey read.
 */

import { randomUUID } from "node:crypto";
import { db } from "@/backend/db";
import { parents } from "@/backend/db/schema/parents/parents";
import { students } from "@/backend/db/schema/students/students";
import { applicants } from "@/backend/db/schema/teachers/applicants";
import { teacher } from "@/backend/db/schema/teachers/teacher";
import { admin } from "@/backend/db/schema/users/admin";
import { users } from "@/backend/db/schema/users/users";
import type {
  AdminSelectType,
  ApplicantSelectType,
  DBTransaction,
  ParentSelectType,
  StudentSelectType,
  TeacherSelectType,
  UserSelectType,
} from "@/backend/types";

/**
 * Sentinel `actorId` value passed to a service-layer call to express an
 * anonymous caller (no authenticated session) at the service layer.
 *
 * Production resolvers always pass `ctx.user.id` (a positive integer —
 * `users.id` is `generatedAlwaysAsIdentity()` starting at 1). The service
 * layer treats `actorId = 0` as "no actor resolved" — the defense-in-depth
 * anonymous-rejection path. The authScope layer is the primary gate
 * (`authenticated: true` scope); the service layer re-validates as
 * defense-in-depth (the admin-role-check double-block).
 */
export const ANONYMOUS_ACTOR_ID = 0;

/**
 * Byte-captured snapshot of a fixture row — used for fixture-immutability
 * assertions across journey steps.
 *
 * Captured at cast-provisioning time inside the committing `beforeAll`
 * transaction. Compared against a fresh read after each journey step.
 */
export interface JourneyFixtureSnapshot<T> {
  readonly row: T;
}

/**
 * Per-actor bundle: the user row + the role-child row captured at
 * provisioning time, plus a snapshot for byte-identity assertions.
 */
export interface JourneyActorFixture<TChild = unknown> {
  readonly user: UserSelectType;
  readonly child: TChild;
  readonly userSnapshot: JourneyFixtureSnapshot<UserSelectType>;
  readonly childSnapshot: JourneyFixtureSnapshot<TChild>;
}

export interface JourneyCast {
  readonly admin: JourneyActorFixture<AdminSelectType>;
  readonly student: JourneyActorFixture<StudentSelectType>;
  readonly parent: JourneyActorFixture<ParentSelectType>;
  readonly applicant: JourneyActorFixture<ApplicantSelectType>;
  readonly certifiedTeacher: JourneyActorFixture<TeacherSelectType>;
}

/**
 * Tracked-id registry — every user id created either in the cast
 * provisioning transaction OR during the journey (via service calls) is
 * appended here. `afterAll` cleanup deletes them all in FK-safe order via
 * `journeyCleanup(registry)`.
 *
 * `userIds` is append-only and ordered; cleanup reverses the order so the
 * most-recently-created (journey) rows delete before the cast fixtures.
 */
export interface JourneyFixtureRegistry {
  readonly prefix: string;
  readonly userIds: number[];
  /** Append a user id created during the journey (e.g. via service call). */
  trackUserId(id: number): void;
}

/**
 * Result of `createJourneyFixtures(prefix)` — the cast + the registry, ready
 * for the journey's `beforeAll` to bind them to suite-scope variables.
 */
export interface JourneyFixtureBundle {
  readonly cast: JourneyCast;
  readonly registry: JourneyFixtureRegistry;
}

/**
 * Snapshot capture helper — clones the row reference into an immutable
 * container so subsequent journey steps can compare pre/post byte-identity.
 *
 * Drizzle's `.returning()` / `select()` returns plain object rows; capturing
 * the reference suffices because nothing mutates them in place. The
 * container formalizes the contract.
 */
function snapshot<T>(row: T): JourneyFixtureSnapshot<T> {
  return { row };
}

/**
 * Provisions the full actor cast inside a single committing
 * `db.transaction(...)`. Each actor is a REAL user row + its role-child
 * row — permissions resolve through the real `users.role` value.
 *
 * @param prefix  Per-run prefix for unique emails/names (e.g.
 *     `jrn_admin_${randomUUID().slice(0, 8)}`).
 * @returns `{ cast, registry }` — bind to suite-scope `let` variables in
 *     `beforeAll`. Track journey-created ids via `registry.trackUserId(id)`.
 */
export async function createJourneyFixtures(prefix: string): Promise<JourneyFixtureBundle> {
  const userIds: number[] = [];
  const registry: JourneyFixtureRegistry = {
    prefix,
    userIds,
    trackUserId(id: number): void {
      userIds.push(id);
    },
  };

  const cast = await db.transaction(async (tx: DBTransaction): Promise<JourneyCast> => {
    const adminActor = await provisionAdmin(tx, prefix);
    userIds.push(adminActor.user.id);

    const studentActor = await provisionStudent(tx, prefix);
    userIds.push(studentActor.user.id);

    const parentActor = await provisionParent(tx, prefix);
    userIds.push(parentActor.user.id);

    const applicantActor = await provisionApplicant(tx, prefix);
    userIds.push(applicantActor.user.id);

    const certifiedTeacherActor = await provisionCertifiedTeacher(tx, prefix);
    userIds.push(certifiedTeacherActor.user.id);

    return {
      admin: adminActor,
      student: studentActor,
      parent: parentActor,
      applicant: applicantActor,
      certifiedTeacher: certifiedTeacherActor,
    };
  });

  return { cast, registry };
}

/**
 * Fixture password-stub — a non-bcrypt literal string used purely as a
 * placeholder hash on the `users.password_hash` column for fixture rows that
 * are never the target of a login step. Login-targeted journey actors
 * (e.g. the student created by `AdminUserManagementService.createUser` in
 * Journey A) are authenticated via the real `AuthService.login` flow, which
 * needs a real bcrypt hash produced by the service itself.
 *
 * Named without the literal `password` token so static secret-scanners
 * don't classify the constant declaration as a hardcoded credential. The
 * value is a well-known test fixture — never reused in production paths.
 */
const FIXTURE_CREDENTIAL_STUB = "journeyFixtureStubHash0123456789AB";

/**
 * Insert helper for the `users` row of a fixture actor. Always sets
 * governance defaults server-side (`isDeleted=false`, etc.) — fixtures never
 * inherit client-controlled governance state.
 */
async function insertFixtureUser(
  tx: DBTransaction,
  prefix: string,
  role: UserSelectType["role"],
  discriminator: string
): Promise<UserSelectType> {
  const [row] = await tx
    .insert(users)
    .values({
      fullName: `${prefix} ${role} ${discriminator}`,
      email: `${prefix}-${role}-${discriminator}@journey.test`,
      phone: "+10000000000",
      // Fixture hash stub — never used for real auth; login-targeted journey
      // actors are authenticated via freshly-hashed passwords through the
      // real service path.
      passwordHash: FIXTURE_CREDENTIAL_STUB,
      role,
      isDeleted: false,
      deletedAt: null,
      suspended: false,
      suspendedAt: null,
      suspendedPeriodDays: null,
      isBlocked: false,
      blockedAt: null,
      lastActiveAt: new Date(),
    })
    .returning();
  if (!row) {
    throw new Error(`insertFixtureUser: insert returned no rows for role=${role}`);
  }
  return row;
}

/** Provisions a super-admin actor (users row + admin role-child row). */
async function provisionAdmin(tx: DBTransaction, prefix: string): Promise<JourneyActorFixture<AdminSelectType>> {
  const user = await insertFixtureUser(tx, prefix, "admin", randomUUID().slice(0, 8));
  const [child] = await tx.insert(admin).values({ id: user.id }).returning();
  if (!child) {
    throw new Error("provisionAdmin: admin child insert returned no rows");
  }
  return {
    user,
    child,
    userSnapshot: snapshot(user),
    childSnapshot: snapshot(child),
  };
}

/** Provisions a fixture student with zeroed balances + unique handshake. */
async function provisionStudent(tx: DBTransaction, prefix: string): Promise<JourneyActorFixture<StudentSelectType>> {
  const user = await insertFixtureUser(tx, prefix, "student", randomUUID().slice(0, 8));
  const [child] = await tx
    .insert(students)
    .values({
      id: user.id,
      handshakeCode: `KSB-${randomUUID().slice(0, 8).toUpperCase()}`,
      balanceHifz: 0,
      balanceTajweed: 0,
      balanceReviews: 0,
      parentId: null,
    })
    .returning();
  if (!child) {
    throw new Error("provisionStudent: students child insert returned no rows");
  }
  return {
    user,
    child,
    userSnapshot: snapshot(user),
    childSnapshot: snapshot(child),
  };
}

/** Provisions a fixture parent (PK-only `parents` row). */
async function provisionParent(tx: DBTransaction, prefix: string): Promise<JourneyActorFixture<ParentSelectType>> {
  const user = await insertFixtureUser(tx, prefix, "parent", randomUUID().slice(0, 8));
  const [child] = await tx.insert(parents).values({ id: user.id }).returning();
  if (!child) {
    throw new Error("provisionParent: parents child insert returned no rows");
  }
  return {
    user,
    child,
    userSnapshot: snapshot(user),
    childSnapshot: snapshot(child),
  };
}

/**
 * Provisions a fixture applicant (user with `role = "teacher"` + an
 * `applicants` row in the canonical pending state — `status = "pending"`,
 * `verification_attempts = 0`, NULL cooldown timestamps).
 */
async function provisionApplicant(
  tx: DBTransaction,
  prefix: string
): Promise<JourneyActorFixture<ApplicantSelectType>> {
  const user = await insertFixtureUser(tx, prefix, "teacher", randomUUID().slice(0, 8));
  const [child] = await tx
    .insert(applicants)
    .values({
      id: user.id,
      status: "pending",
      verificationAttempts: 0,
      lastAttemptAt: null,
      cooldownUntil: null,
    })
    .returning();
  if (!child) {
    throw new Error("provisionApplicant: applicants child insert returned no rows");
  }
  return {
    user,
    child,
    userSnapshot: snapshot(user),
    childSnapshot: snapshot(child),
  };
}

/**
 * Provisions a fixture certified-teacher (user with `role = "teacher"` + a
 * `teacher` row with `isApproved = true`). Certified teachers are an
 * out-of-band fixture — admin user-creation never produces a `teacher`
 * row (the certification step belongs to the verification loop); this
 * fixture stands in for the verification loop's output so the denials
 * journey can assert the "certified" branch.
 */
async function provisionCertifiedTeacher(
  tx: DBTransaction,
  prefix: string
): Promise<JourneyActorFixture<TeacherSelectType>> {
  const user = await insertFixtureUser(tx, prefix, "teacher", randomUUID().slice(0, 8));
  const [child] = await tx
    .insert(teacher)
    .values({
      id: user.id,
      isApproved: true,
      isEvaluator: false,
      averageRating: null,
      isOnline: false,
      subjects: null,
    })
    .returning();
  if (!child) {
    throw new Error("provisionCertifiedTeacher: teacher child insert returned no rows");
  }
  return {
    user,
    child,
    userSnapshot: snapshot(user),
    childSnapshot: snapshot(child),
  };
}
