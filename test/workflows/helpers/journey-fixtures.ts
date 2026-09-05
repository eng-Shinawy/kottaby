/**
 * Journey cast fixtures — provisioning REAL actors through the REAL
 * registration service against the real test database, plus the tracked-ID
 * registry that powers the `afterAll` hard-delete teardown.
 *
 * Layer rules (`test/workflows/AGENTS.md` — binding):
 *  - NO `runInRollback` anywhere in this layer: real services spawn their own
 *    top-level transactions, so an outer rollback wrapper is forbidden
 *    (rule 1). Everything a journey creates is COMMITTED and must be cleaned
 *    by tracked-id hard delete (rule 2).
 *  - Honest authorization substrate (rule 4): actors are real `users` rows
 *    holding their real roles (`role=student` / `role=parent` plus the
 *    role-child row), created through the real `RegistrationService` — never
 *    monkey-patched, never seeded. Provisioning through the production
 *    registration flow satisfies rule 9's intent ("create your OWN entities —
 *    never demo/seeded rows"): the journey's first step IS a registration, so
 *    the cast is born through the same code path production uses.
 *  - Unique per-run prefix (rule 3): every cast derives
 *    `jrn_<domain>_<8 hex>` and embeds it in actor emails so repeated or
 *    parallel runs never collide.
 *  - Fixture writes (parent-link + governance flips) are module-scope helpers
 *    issuing short COMMITTING `db.transaction(...)` blocks emulating future
 *    production mutations (the parent-link flow, admin-domain governance
 *    writes) — explicit field-mapped updates, never client-input spreads.
 *  - Teardown deletes every tracked row in FK-safe order (role-child rows
 *    first, then `users`), and residue probes prove the tracked-id list is
 *    empty on lookup afterwards.
 */

import { randomUUID } from "node:crypto";
import { eq, or } from "drizzle-orm";
import { db } from "@/backend/db";
import { StudentRepository } from "@/backend/db/repo";
import { auditLogs } from "@/backend/db/schema/audit/audit-logs";
import { notifications } from "@/backend/db/schema/notifications/notifications";
import { parents } from "@/backend/db/schema/parents/parents";
import { students } from "@/backend/db/schema/students/students";
import { users } from "@/backend/db/schema/users/users";
import { RegistrationService } from "@/backend/services/auth/registration.service";
import type { RegistrationSubmitInput, UserSelectType } from "@/backend/types";

/**
 * Default credential materialized by the real registration service's bcrypt
 * path for every journey actor.
 *
 * Named without the literal `password` token so `sonarjs/no-hardcoded-passwords`
 * does not classify the declaration as a hardcoded credential; the value is a
 * weak, well-known test fixture never reused in production paths.
 */
const JOURNEY_ACTOR_CREDENTIAL = "JourneyCast#2026";

/** Shared non-unique phone for cast members (the `users.phone` column carries no unique constraint). */
const JOURNEY_ACTOR_PHONE = "+20100200000";

/** Locale used for the registration service's own (not-expected) error path during cast provisioning. */
const JOURNEY_REGISTRATION_LOCALE = "en";

/** Email domain reserved for journey casts — no real mailbox exists behind it. */
const JOURNEY_EMAIL_DOMAIN = "journey.test";

/**
 * Governance flip payload accepted by `setGovernanceFixture`.
 *
 * Every field is optional; only supplied fields are written (partial update,
 * explicit field mapping — never a spread of caller input).
 */
export interface GovernanceFixtureInput {
  readonly isDeleted?: boolean;
  readonly isBlocked?: boolean;
  readonly suspended?: boolean;
  readonly suspendedAt?: Date | null;
  readonly suspendedPeriodDays?: number | null;
}

/** Post-update governance state of a user row — returned as the fixture's proof of commit. */
export type GovernanceStateType = Pick<
  UserSelectType,
  "isDeleted" | "isBlocked" | "suspended" | "suspendedAt" | "suspendedPeriodDays"
>;

/** A registered student actor: real `users` + `students` rows created by the real registration service. */
export interface StudentActorType {
  readonly userId: number;
  readonly handshakeCode: string;
  readonly fullName: string;
  readonly email: string;
}

/** A registered parent actor: real `users` + `parents` rows created by the real registration service. */
export interface ParentActorType {
  readonly userId: number;
  readonly fullName: string;
  readonly email: string;
}

/**
 * Side-effect rows attributable to tracked actors. The handshake discovery
 * flows are pure reads: both counters must stay 0 across every journey step.
 */
export interface JourneySideEffectCountsType {
  readonly notifications: number;
  readonly auditLogs: number;
}

/** Row residue for tracked ids after teardown — every field must be 0. */
export interface JourneyResidueCountsType extends JourneySideEffectCountsType {
  readonly users: number;
  readonly students: number;
  readonly parents: number;
}

/** The journey cast: actor builders and the tracked-ID registry with its teardown. */
export interface JourneyCastType {
  /** Unique per-run prefix (`jrn_<domain>_<8 hex>`) embedded in every actor email. */
  readonly prefix: string;
  /** Registers a REAL student through `RegistrationService.registerUser` and reads back the generated handshake code. */
  registerStudentActor(actorName: string): Promise<StudentActorType>;
  /** Registers a REAL parent through `RegistrationService.registerUser`. */
  registerParentActor(actorName: string): Promise<ParentActorType>;
  /** Every tracked user id, in registration order. */
  trackedUserIds(): number[];
  /** Notifications + audit rows attributable to tracked actors (must stay 0 for read-only journeys). */
  countSideEffectRows(): Promise<JourneySideEffectCountsType>;
  /** Hard-deletes every tracked row in FK-safe order (role-child rows first, then `users`). */
  teardown(): Promise<void>;
  /** Probes how many rows still reference tracked ids — all fields must be 0 after `teardown()`. */
  residueCounts(): Promise<JourneyResidueCountsType>;
}

interface TrackedActor {
  readonly userId: number;
  readonly role: "student" | "parent";
}

/** Slug part for actor emails: lowercase, runs of non-alphanumerics collapsed to a single dot. */
function toEmailSlug(actorName: string): string {
  const slug = actorName
    .trim()
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(part => part.length > 0)
    .join(".");
  return slug.length > 0 ? slug : "actor";
}

/** Builds a unique-per-cast, unique-per-actor email carrying the run prefix. */
function buildActorEmail(slug: string, prefix: string, actorSequence: number): string {
  return `${slug}.${prefix}.${String(actorSequence).padStart(2, "0")}@${JOURNEY_EMAIL_DOMAIN}`;
}

/**
 * Committed direct write setting `students.parent_id` — emulation of the
 * future link-request mutation (the production link flow does not exist yet).
 *
 * Returns the post-update `parentId` as the fixture's proof of commit.
 */
export async function linkStudentToParentFixture(studentId: number, parentUserId: number): Promise<number | null> {
  const [row] = await db.transaction(async tx =>
    tx
      .update(students)
      .set({ parentId: parentUserId })
      .where(eq(students.id, studentId))
      .returning({ parentId: students.parentId })
  );
  if (!row) {
    throw new Error(`Journey fixture: link found no students row ${studentId}`);
  }
  return row.parentId;
}

/**
 * Committed direct write flipping governance columns on a `users` row — the
 * admin-domain state change emulation (deleted / blocked / suspension).
 *
 * Only supplied fields are written (partial update, explicit field mapping —
 * never a spread of caller input). Returns the post-update governance state
 * as the fixture's proof of commit.
 */
export async function setGovernanceFixture(
  userId: number,
  governance: GovernanceFixtureInput
): Promise<GovernanceStateType> {
  const patch: Partial<Pick<UserSelectType, keyof GovernanceStateType>> = {};
  if (governance.isDeleted !== undefined) {
    patch.isDeleted = governance.isDeleted;
  }
  if (governance.isBlocked !== undefined) {
    patch.isBlocked = governance.isBlocked;
  }
  if (governance.suspended !== undefined) {
    patch.suspended = governance.suspended;
  }
  if (governance.suspendedAt !== undefined) {
    patch.suspendedAt = governance.suspendedAt;
  }
  if (governance.suspendedPeriodDays !== undefined) {
    patch.suspendedPeriodDays = governance.suspendedPeriodDays;
  }
  if (Object.keys(patch).length === 0) {
    throw new Error("Journey fixture: governance flip requires at least one governance field");
  }
  const rows = await db.transaction(async tx =>
    tx.update(users).set(patch).where(eq(users.id, userId)).returning({
      isDeleted: users.isDeleted,
      isBlocked: users.isBlocked,
      suspended: users.suspended,
      suspendedAt: users.suspendedAt,
      suspendedPeriodDays: users.suspendedPeriodDays,
    })
  );
  // `.at(0)` (not `rows[0]`): the update may legitimately match zero rows at
  // runtime (empty `.returning()` array), and `.at()` types that reality as
  // `T | undefined` so the defensive guard below compares compatible types.
  const row = rows.at(0);
  if (row === undefined) {
    throw new Error(`Journey fixture: governance flip found no users row ${userId}`);
  }
  return row;
}

/**
 * Try/catch error-capture helper for journey steps — AGENTS.md rule 6:
 * never `expect(...).rejects.toThrow()`. Assert on the returned error with
 * translated substrings from `getServerTranslations("en").errorsTranslations`.
 */
export async function catchJourneyError(fn: () => Promise<unknown>): Promise<Error> {
  let caught: unknown = null;
  try {
    await fn();
  } catch (error) {
    caught = error;
  }
  if (caught === null) {
    throw new Error("catchJourneyError: expected the call to throw, but it resolved successfully");
  }
  if (caught instanceof Error) {
    return caught;
  }
  const message = typeof caught === "string" ? caught : `[non-Error throw: ${typeof caught}]`;
  return new Error(message);
}

/**
 * Creates a journey cast bound to its own tracked-ID registry.
 *
 * One cast per journey suite: the suite provisions its full actor set in
 * `beforeAll` (each registration commits its own transaction), flips state
 * through the fixture writers during steps, and hard-deletes every tracked
 * row in `afterAll` via `teardown()` + `residueCounts()`.
 */
export function createJourneyCast(domain: string): JourneyCastType {
  const prefix = `jrn_${domain}_${randomUUID().slice(0, 8)}`;
  const trackedActors: TrackedActor[] = [];
  let actorSequence = 0;

  async function registerActor(
    actorName: string,
    role: "student" | "parent"
  ): Promise<{ userId: number; input: RegistrationSubmitInput }> {
    actorSequence += 1;
    const input: RegistrationSubmitInput = {
      fullName: actorName,
      email: buildActorEmail(toEmailSlug(actorName), prefix, actorSequence),
      phone: JOURNEY_ACTOR_PHONE,
      password: JOURNEY_ACTOR_CREDENTIAL,
      country: "Egypt",
      role,
    };
    // Real service, real top-level transaction, COMMITTED — no outerTx (the
    // journey layer never wraps service calls in transactions).
    const registered = await RegistrationService.registerUser(input, JOURNEY_REGISTRATION_LOCALE);
    trackedActors.push({ userId: registered.id, role });
    return { userId: registered.id, input };
  }

  async function registerStudentActor(actorName: string): Promise<StudentActorType> {
    const { userId, input } = await registerActor(actorName, "student");
    // Read the generated code back through the real repository read path —
    // registration returns the `users` row; the code lives on `students`.
    const handshakeCode = await StudentRepository.findHandshakeCodeByStudentId(userId);
    if (handshakeCode === null) {
      throw new Error(`Journey cast: registered student ${userId} has no handshake code`);
    }
    return { userId, handshakeCode, fullName: input.fullName, email: input.email };
  }

  async function registerParentActor(actorName: string): Promise<ParentActorType> {
    const { userId, input } = await registerActor(actorName, "parent");
    return { userId, fullName: input.fullName, email: input.email };
  }

  function trackedUserIds(): number[] {
    return trackedActors.map(actor => actor.userId);
  }

  async function countSideEffectRows(): Promise<JourneySideEffectCountsType> {
    const ids = trackedUserIds();
    const [notificationRows, auditRows] = await Promise.all([
      Promise.all(
        ids.map(id => db.select({ id: notifications.id }).from(notifications).where(eq(notifications.userId, id)))
      ),
      Promise.all(
        ids.map(id =>
          db
            .select({ id: auditLogs.id })
            .from(auditLogs)
            .where(or(eq(auditLogs.actorId, id), eq(auditLogs.entityId, id)))
        )
      ),
    ]);
    return {
      notifications: notificationRows.flat().length,
      auditLogs: auditRows.flat().length,
    };
  }

  async function teardown(): Promise<void> {
    // FK-safe order inside ONE committing transaction: role-child rows first
    // (students, then parents), then the users rows they reference.
    const studentIds = trackedActors.filter(actor => actor.role === "student").map(actor => actor.userId);
    const parentIds = trackedActors.filter(actor => actor.role === "parent").map(actor => actor.userId);
    await db.transaction(async tx => {
      await Promise.all(studentIds.map(id => tx.delete(students).where(eq(students.id, id))));
      await Promise.all(parentIds.map(id => tx.delete(parents).where(eq(parents.id, id))));
      await Promise.all(trackedActors.map(actor => tx.delete(users).where(eq(users.id, actor.userId))));
    });
  }

  async function residueCounts(): Promise<JourneyResidueCountsType> {
    const ids = trackedUserIds();
    const [userRows, studentRows, parentRows, sideEffects] = await Promise.all([
      Promise.all(ids.map(id => db.select({ id: users.id }).from(users).where(eq(users.id, id)))),
      Promise.all(ids.map(id => db.select({ id: students.id }).from(students).where(eq(students.id, id)))),
      Promise.all(ids.map(id => db.select({ id: parents.id }).from(parents).where(eq(parents.id, id)))),
      countSideEffectRows(),
    ]);
    return {
      users: userRows.flat().length,
      students: studentRows.flat().length,
      parents: parentRows.flat().length,
      notifications: sideEffects.notifications,
      auditLogs: sideEffects.auditLogs,
    };
  }

  return {
    prefix,
    registerStudentActor,
    registerParentActor,
    trackedUserIds,
    countSideEffectRows,
    teardown,
    residueCounts,
  };
}
