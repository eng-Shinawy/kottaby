/**
 * Session-domain cast builders for journey tests (scheduling).
 *
 * Every builder sits on the `backend/db/test/entity-setup.ts` factories and
 * provisions REAL authorization state only: a real `users` row with its real
 * `users.role` value plus its real role-child row(s). Nothing is ever
 * monkey-patched — when a journey's negative step fails, it fails through
 * the same role/ownership checks production uses (AGENTS.md rule 4).
 *
 * Consumers call builders inside their committed `beforeAll` transaction:
 *
 * ```ts
 * const registry = createSessionFixtureRegistry();
 * let cast: SessionJourneyCast;
 * beforeAll(async () => {
 *   await db.transaction(async tx => {
 *     cast = await buildSessionJourneyCast(tx, registry, { prefix });
 *   });
 * });
 * afterAll(() => registry.cleanup());
 * ```
 *
 * Builder contract:
 *  - `tx` is the FIRST parameter and is passed to every underlying
 *    entity-setup/Drizzle call (journeys commit; there is no rollback here).
 *  - The registry is the SECOND parameter — builders register every row they
 *    create, so `afterAll` hard-deletes the whole cast in FK-safe order.
 *  - Rows the SERVICES create during a journey (sessions, idempotency
 *    claims) are tracked by the journey itself via `registry.track(...)`.
 *
 * Booking impossibility by construction: the teacher-applicant builder
 * provisions a real teacher-role user and a REAL `applicants` row and
 * deliberately NO `teacher` row — no teachable id exists, so booking that
 * user as a teacher fails for the honest reason, never because a test double
 * said so.
 *
 * Zero business logic: builders only assemble fixture rows; every behavioral
 * expectation is asserted by the journeys.
 */
import { randomUUID } from "node:crypto";
import { teacher } from "@/backend/db/schema/teachers/teacher";
import {
  createTestAdmin,
  createTestApplicant,
  createTestParent,
  createTestStudent,
  createTestUser,
} from "@/backend/db/test/entity-setup";
import { HeldBalanceLane } from "@/backend/enum/scheduling/held-balance-lane.enum";
import type {
  AdminSelectType,
  ApplicantSelectType,
  DBTransaction,
  ParentSelectType,
  StudentSelectType,
  TeacherSelectType,
  UserSelectType,
} from "@/backend/types";
import type { SessionFixtureRegistry } from "@/test/workflows/helpers/journey-fixture-registry";

/**
 * Student balance-lane profile — units per lane (0/omitted = lane empty).
 * `reviews` exists on the schema (CHECK-guarded) but is NOT part of the
 * escrow lane vocabulary (trial|hifz|tajweed); it is profiled only so a
 * fixture can mirror any students row.
 */
export interface StudentLaneProfile {
  readonly trial?: number;
  readonly hifz?: number;
  readonly tajweed?: number;
  readonly reviews?: number;
}

/**
 * A paid (non-trial) booking lane. `trial` is deliberately excluded — a
 * "paid lane" fixture always carries zero trial units so the debit ladder
 * cannot take the trial branch.
 */
export type PaidSessionLane = Exclude<HeldBalanceLane, HeldBalanceLane.Trial>;

/** A student actor: real `users` row (role=student) + real `students` row. */
export interface StudentCastMember {
  readonly user: UserSelectType;
  readonly student: StudentSelectType;
  readonly userId: number;
}

/** A teacher actor: real `users` row (role=teacher) + real `teacher` row. */
export interface TeacherCastMember {
  readonly user: UserSelectType;
  readonly teacher: TeacherSelectType;
  readonly userId: number;
}

/**
 * A teacher applicant actor: real `users` row (role=teacher) + REAL
 * `applicants` row and NO `teacher` row (booking impossibility by
 * construction).
 */
export interface ApplicantCastMember {
  readonly user: UserSelectType;
  readonly applicant: ApplicantSelectType;
  readonly userId: number;
}

/** A parent actor: real `users` row (role=parent) + real `parents` row. */
export interface ParentCastMember {
  readonly user: UserSelectType;
  readonly parent: ParentSelectType;
  readonly userId: number;
}

/** An admin actor: real `users` row (role=admin) + real `admin` row. */
export interface AdminCastMember {
  readonly user: UserSelectType;
  readonly admin: AdminSelectType;
  readonly userId: number;
}

/**
 * The canonical cross-actor session-journey cast: a funded primary student,
 * a second student (zero-balance by default — the zero-balance and
 * cross-participant-probe actor), a certified teacher plus a second
 * certified teacher (the non-participant teacher observer), a teacher
 * applicant, a parent, and an admin. All rows are committed by the
 * consumer's `beforeAll` transaction and tracked for hard-delete cleanup.
 */
export interface SessionJourneyCast {
  readonly primaryStudent: StudentCastMember;
  readonly secondStudent: StudentCastMember;
  readonly teacher: TeacherCastMember;
  readonly secondTeacher: TeacherCastMember;
  readonly applicant: ApplicantCastMember;
  readonly parent: ParentCastMember;
  readonly admin: AdminCastMember;
}

/** Options for {@link buildSessionJourneyCast}. */
export interface SessionJourneyCastOptions {
  /**
   * Per-run prefix used in row labels so repeated or parallel runs never
   * collide (AGENTS.md rule 3 — the suite derives
   * `const prefix = \`jrn_<domain>_${randomUUID().slice(0, 8)}\``).
   */
  readonly prefix: string;
  /** Lane units for the primary student (default: 1 trial + 1 hifz unit). */
  readonly primaryStudent?: StudentLaneProfile;
  /** Lane units for the second student (default: all lanes empty). */
  readonly secondStudent?: StudentLaneProfile;
}

/** Maps a lane profile onto `createTestStudent` column overrides. */
function studentOverridesFromProfile(profile: StudentLaneProfile): Partial<StudentSelectType> {
  return {
    balanceTrial: profile.trial ?? 0,
    balanceHifz: profile.hifz ?? 0,
    balanceTajweed: profile.tajweed ?? 0,
    balanceReviews: profile.reviews ?? 0,
    // Mirror the registration grant: a student holding trial units carries
    // the grant timestamp (fixture realism only — booking eligibility is
    // the balance itself).
    ...(profile.trial ? { trialGrantedAt: new Date() } : {}),
  };
}

/** Creates the shared `users` row for a cast member (optionally labeled). */
async function createCastUser(
  tx: DBTransaction,
  role: UserSelectType["role"],
  label?: string
): Promise<UserSelectType> {
  return createTestUser(tx, {
    role,
    ...(label ? { fullName: label.slice(0, 255) } : {}),
  });
}

/** Builds any student cast member from a lane profile and tracks both rows. */
async function buildStudentCastMember(
  tx: DBTransaction,
  registry: SessionFixtureRegistry,
  profile: StudentLaneProfile,
  label?: string
): Promise<StudentCastMember> {
  const user = await createCastUser(tx, "student", label);
  const student = await createTestStudent(tx, user.id, studentOverridesFromProfile(profile));
  registry.track("users", user.id);
  registry.track("students", student.id);
  return { user, student, userId: user.id };
}

/** Builds a teacher-role cast member with an explicit `teacher` row shape. */
async function buildTeacherCastMember(
  tx: DBTransaction,
  registry: SessionFixtureRegistry,
  isApproved: boolean,
  label?: string
): Promise<TeacherCastMember> {
  const user = await createCastUser(tx, "teacher", label);
  // The `teacher` row has no entity-setup factory — single shared-PK insert
  // (same pattern as the DB logic suites; see the teacher schema header:
  // created only for a users row with role 'teacher').
  const [teacherRow] = await tx.insert(teacher).values({ id: user.id, isApproved }).returning();
  if (!teacherRow) {
    throw new Error("buildTeacherCastMember: teacher insert returned no rows");
  }
  registry.track("users", user.id);
  registry.track("teacher", teacherRow.id);
  return { user, teacher: teacherRow, userId: user.id };
}

/**
 * Student holding exactly `units` trial unit(s) and empty paid lanes — the
 * free-trial booker (the debit ladder resolves on the trial lane: trial
 * units are consumed before any paid lane).
 */
export async function buildStudentWithTrial(
  tx: DBTransaction,
  registry: SessionFixtureRegistry,
  units = 1,
  label?: string
): Promise<StudentCastMember> {
  return buildStudentCastMember(tx, registry, { trial: units }, label);
}

/**
 * Student holding exactly `units` unit(s) of ONE paid lane (`hifz` or
 * `tajweed`) and zero trial units — proves the debit ladder skips the empty
 * trial lane and binds the paid lane.
 */
export async function buildStudentWithPaidLane(
  tx: DBTransaction,
  registry: SessionFixtureRegistry,
  lane: PaidSessionLane,
  units = 1,
  label?: string
): Promise<StudentCastMember> {
  const profile: StudentLaneProfile = lane === HeldBalanceLane.Hifz ? { hifz: units } : { tajweed: units };
  return buildStudentCastMember(tx, registry, profile, label);
}

/**
 * Student holding trial AND paid units simultaneously — proves trial-first
 * ordering across repeated bookings (the trial lane is consumed before any
 * paid lane).
 */
export async function buildStudentWithBoth(
  tx: DBTransaction,
  registry: SessionFixtureRegistry,
  options: { trial?: number; paidLane?: PaidSessionLane; paidUnits?: number } = {},
  label?: string
): Promise<StudentCastMember> {
  const trialUnits = options.trial ?? 1;
  const paidUnits = options.paidUnits ?? 1;
  const profile: StudentLaneProfile =
    (options.paidLane ?? HeldBalanceLane.Hifz) === HeldBalanceLane.Hifz
      ? { trial: trialUnits, hifz: paidUnits }
      : { trial: trialUnits, tajweed: paidUnits };
  return buildStudentCastMember(tx, registry, profile, label);
}

/** Student with every lane empty — the zero-balance booking denial leg. */
export async function buildZeroBalanceStudent(
  tx: DBTransaction,
  registry: SessionFixtureRegistry,
  label?: string
): Promise<StudentCastMember> {
  return buildStudentCastMember(tx, registry, {}, label);
}

/**
 * The SECOND student of a cast — a real non-primary student used for
 * cross-participant probes (cancel/read another participant's session and
 * observe nothing). Defaults to zero balance; pass a profile to fund it.
 */
export async function buildSecondStudent(
  tx: DBTransaction,
  registry: SessionFixtureRegistry,
  profile: StudentLaneProfile = {},
  label?: string
): Promise<StudentCastMember> {
  return buildStudentCastMember(tx, registry, profile, label);
}

/**
 * Certified teacher: real teacher-role user + `teacher` row with
 * `isApproved = true` — the only teacher shape that can host a session.
 */
export async function buildCertifiedTeacher(
  tx: DBTransaction,
  registry: SessionFixtureRegistry,
  label?: string
): Promise<TeacherCastMember> {
  return buildTeacherCastMember(tx, registry, true, label);
}

/**
 * Second certified teacher of a cast — the non-participant teacher observer
 * for the oracle-safety legs (must see NOTHING of others' sessions).
 */
export async function buildSecondCertifiedTeacher(
  tx: DBTransaction,
  registry: SessionFixtureRegistry,
  label?: string
): Promise<TeacherCastMember> {
  return buildTeacherCastMember(tx, registry, true, label);
}

/**
 * Teacher applicant: real teacher-role user + REAL `applicants` row and NO
 * `teacher` row — booking impossibility by construction (nothing here mints
 * certification; this user simply has no teachable id).
 */
export async function buildTeacherApplicant(
  tx: DBTransaction,
  registry: SessionFixtureRegistry,
  label?: string
): Promise<ApplicantCastMember> {
  const user = await createCastUser(tx, "teacher", label);
  const applicant = await createTestApplicant(tx, user.id);
  registry.track("users", user.id);
  registry.track("applicants", applicant.id);
  return { user, applicant, userId: user.id };
}

/** Parent actor: real parent-role user + real `parents` row. */
export async function buildParent(
  tx: DBTransaction,
  registry: SessionFixtureRegistry,
  label?: string
): Promise<ParentCastMember> {
  const user = await createCastUser(tx, "parent", label);
  const parent = await createTestParent(tx, user.id);
  registry.track("users", user.id);
  registry.track("parents", parent.id);
  return { user, parent, userId: user.id };
}

/** Admin actor: real admin-role user + real `admin` row (NO bypass is implied). */
export async function buildAdmin(
  tx: DBTransaction,
  registry: SessionFixtureRegistry,
  label?: string
): Promise<AdminCastMember> {
  const user = await createCastUser(tx, "admin", label);
  const adminRow = await createTestAdmin(tx, user.id);
  registry.track("users", user.id);
  registry.track("admin", adminRow.id);
  return { user, admin: adminRow, userId: user.id };
}

/**
 * Builds the canonical session-journey cast in the consumer's committed
 * `beforeAll` transaction and registers every created row for cleanup.
 *
 * Default lane profiles: primary student = 1 trial + 1 hifz unit (the funded
 * booker of the happy-path journey); second student = all lanes empty (the
 * zero-balance / cross-participant-probe actor). Override either via
 * {@link SessionJourneyCastOptions}.
 */
export async function buildSessionJourneyCast(
  tx: DBTransaction,
  registry: SessionFixtureRegistry,
  options: SessionJourneyCastOptions
): Promise<SessionJourneyCast> {
  const prefix = options.prefix;
  const primaryStudent = await buildStudentCastMember(
    tx,
    registry,
    options.primaryStudent ?? { trial: 1, hifz: 1 },
    `${prefix}-studentA`
  );
  const secondStudent = await buildStudentCastMember(tx, registry, options.secondStudent ?? {}, `${prefix}-studentB`);
  const certifiedTeacher = await buildCertifiedTeacher(tx, registry, `${prefix}-teacherT`);
  const secondTeacher = await buildSecondCertifiedTeacher(tx, registry, `${prefix}-teacher2`);
  const applicant = await buildTeacherApplicant(tx, registry, `${prefix}-applicant`);
  const parent = await buildParent(tx, registry, `${prefix}-parent`);
  const admin = await buildAdmin(tx, registry, `${prefix}-admin`);
  return {
    primaryStudent,
    secondStudent,
    teacher: certifiedTeacher,
    secondTeacher,
    applicant,
    parent,
    admin,
  };
}

/**
 * Derives a fresh per-run journey prefix per AGENTS.md rule 3:
 * `jrn_<domain>_<8-hex>` — call once per suite
 * (`const prefix = journeyPrefix("sessions")`).
 */
export function journeyPrefix(domain: string): string {
  return `jrn_${domain}_${randomUUID().slice(0, 8)}`;
}
