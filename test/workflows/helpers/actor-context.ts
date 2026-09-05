/**
 * Actor-context factory — provisions REAL actors for journey suites.
 *
 * Every actor is a real `users` row carrying its real `role` plus the matching
 * role-child row (`students` / `teacher` / `parents` / `admin`), so every
 * authorization decision inside the services under test resolves through the
 * genuine role-membership code path. Journey suites must NEVER monkey-patch
 * role/permission resolution — denial steps only prove anything when they fail
 * through the real checks (that is the whole point of this layer).
 *
 * The factory wraps the `backend/db/test/entity-setup.ts` builders: journeys
 * never hand-roll raw user inserts and never touch demo/seeded rows. Pass a
 * `TrackedFixtures` registry via the options so the created rows are tracked
 * for the suite's `afterAll` teardown automatically (user row first, role-child
 * row second — teardown deletes the child before the user).
 */
import type { PgTable } from "drizzle-orm/pg-core";
import { parents } from "@/backend/db/schema/parents/parents";
import { students } from "@/backend/db/schema/students/students";
import { teacher } from "@/backend/db/schema/teachers/teacher";
import { admin } from "@/backend/db/schema/users/admin";
import { users } from "@/backend/db/schema/users/users";
import { createTestAdmin, createTestParent, createTestStudent, createTestUser } from "@/backend/db/test/entity-setup";
import type { DBTransaction, UserSelectType } from "@/backend/types";
import type { AppLocale } from "@/shared/locale";
import type { TrackedFixtures } from "@/test/workflows/helpers/tracked-fixtures";

/**
 * Default actor locale for journey suites. Journey error assertions pin
 * English translated substrings, so actors default to `"en"`; override per
 * actor when a journey deliberately exercises locale-specific behavior.
 */
const DEFAULT_ACTOR_LOCALE: AppLocale = "en";

/**
 * A journey actor: the real identity a service call is attributed to.
 *
 * `userId` is the actor's real `users.id`; `locale` is the locale the actor's
 * service calls resolve localized copy for (there is no per-user locale column
 * yet, so the locale is an explicit per-actor property of the journey, never
 * read from the database); `role` mirrors the actor's real `users.role`.
 */
export interface JourneyActor {
  readonly userId: number;
  readonly locale: AppLocale;
  readonly role: UserSelectType["role"];
}

/** Options for every actor provisioning helper. */
export interface ActorProvisionOptions {
  /** Locale the actor's service calls resolve copy for (default `"en"`). */
  readonly locale?: AppLocale;
  /**
   * Fixture registry to track the created `users` + role-child rows in. When
   * omitted the rows are still committed, but the suite takes over tracking
   * them itself.
   */
  readonly tracked?: TrackedFixtures;
}

/** Builds the actor record for a freshly created user. */
function buildActor(user: UserSelectType, options: ActorProvisionOptions): JourneyActor {
  return {
    userId: user.id,
    locale: options.locale ?? DEFAULT_ACTOR_LOCALE,
    role: user.role,
  };
}

/** Registers the owning user row followed by the role-child row (FK-safe teardown order). */
function registerActorRows(
  tracked: TrackedFixtures | undefined,
  userId: number,
  childTable: PgTable,
  childId: number
): void {
  if (!tracked) {
    return;
  }
  tracked.register(users, userId);
  tracked.register(childTable, childId);
}

/**
 * Provisions a student actor: a real `users` row with `role="student"` plus
 * its `students` role-child row.
 */
export async function provisionStudentActor(
  tx: DBTransaction,
  options: ActorProvisionOptions = {}
): Promise<JourneyActor> {
  const user = await createTestUser(tx, { role: "student" });
  const student = await createTestStudent(tx, user.id);
  registerActorRows(options.tracked, user.id, students, student.id);
  return buildActor(user, options);
}

/**
 * Provisions a certified teacher actor: a real `users` row with
 * `role="teacher"` plus an approved `teacher` role-child row
 * (`isApproved = true` — the row only exists for teachers who passed
 * verification, so this actor exercises the certified-teacher permission
 * path honestly).
 */
export async function provisionCertifiedTeacherActor(
  tx: DBTransaction,
  options: ActorProvisionOptions = {}
): Promise<JourneyActor> {
  const user = await createTestUser(tx, { role: "teacher" });
  const [teacherRow] = await tx.insert(teacher).values({ id: user.id, isApproved: true }).returning();
  if (!teacherRow) {
    throw new Error("provisionCertifiedTeacherActor: teacher insert returned no rows");
  }
  registerActorRows(options.tracked, user.id, teacher, teacherRow.id);
  return buildActor(user, options);
}

/**
 * Provisions a parent actor: a real `users` row with `role="parent"` plus its
 * `parents` role-child row.
 */
export async function provisionParentActor(
  tx: DBTransaction,
  options: ActorProvisionOptions = {}
): Promise<JourneyActor> {
  const user = await createTestUser(tx, { role: "parent" });
  const parent = await createTestParent(tx, user.id);
  registerActorRows(options.tracked, user.id, parents, parent.id);
  return buildActor(user, options);
}

/**
 * Provisions an admin actor: a real `users` row with `role="admin"` plus its
 * `admin` role-child row.
 */
export async function provisionAdminActor(
  tx: DBTransaction,
  options: ActorProvisionOptions = {}
): Promise<JourneyActor> {
  const user = await createTestUser(tx, { role: "admin" });
  const adminRow = await createTestAdmin(tx, user.id);
  registerActorRows(options.tracked, user.id, admin, adminRow.id);
  return buildActor(user, options);
}
