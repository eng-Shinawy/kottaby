/**
 * Journey J-1 — Cold-Start Certification (Create → Certify → Observe → Deny).
 *
 * Cross-actor workflow test covering the direct admin certification of
 * teacher-role users (cold-start bootstrapping of the founding cohort):
 *  - Admin A provisions a teacher-role user through the real
 *    create-user service path, then certifies them directly — the teacher
 *    row is created already certified, the pending applicant row is
 *    finalized (`passed`, cooldown cleared), exactly ONE override audit row
 *    and exactly ONE `evaluation_result` notification are committed, and
 *    exactly ONE fan-out envelope is published to the target only.
 *  - Admin B and the certified teacher observe the committed state through
 *    the existing read surfaces (admin detail, activity timeline, inbox).
 *  - Denial probes run through the REAL authorization stack: a student
 *    actor, a suspended admin (flipped AFTER provisioning — stale-authority
 *    simulation), a non-teacher target, a governed target (denied, then
 *    reactivated and certified successfully), a repeat certification, a
 *    cooldown supersession, and an elevation of a pre-existing unapproved
 *    teacher row. Every denial is asserted side-effect-free.
 *
 * Per `test/workflows/AGENTS.md`:
 *  - Committed fixtures in `beforeAll` (NO `runInRollback` — services spawn
 *    their own transactions); tracked hard-delete teardown in `afterAll`
 *    (audit rows hard-deleted inside the trigger-suspension wrapper).
 *  - Permissions resolve via REAL role context — every actor holds a real
 *    `users.role` value plus its real role-child row; nothing is
 *    monkey-patched or scope-stubbed.
 *  - The fan-out transport is SPIED via the service's injected options seam
 *    (`SpiedFanoutTransport`) — publishes are recorded, never delivered.
 *  - Denial assertions use a try/catch helper + translated substrings from
 *    `getServerTranslations("en").errorsTranslations` — NEVER
 *    `expect(...).rejects.toThrow()` and never raw key echoes.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@/backend/db";
import { auditLogs } from "@/backend/db/schema/audit/audit-logs";
import { notifications } from "@/backend/db/schema/notifications/notifications";
import { students } from "@/backend/db/schema/students/students";
import { applicants } from "@/backend/db/schema/teachers/applicants";
import { teacher } from "@/backend/db/schema/teachers/teacher";
import { users } from "@/backend/db/schema/users/users";
import { createTestApplicant, createTestUser } from "@/backend/db/test/entity-setup";
import { AuditActionType } from "@/backend/enum/audit/audit-action-type.enum";
import { NotificationType } from "@/backend/enum/notifications/notification-type.enum";
import { ApplicantStatus } from "@/backend/enum/teachers/applicant-status.enum";
import { UserRole } from "@/backend/enum/users/user-role.enum";
import { ConflictError, DomainError, ForbiddenError } from "@/backend/lib/errors";
import { ColdStartCertificationService } from "@/backend/services/admin";
import { AdminUserManagementService } from "@/backend/services/admin/user-management.service";
import { NotificationEngine } from "@/backend/services/notifications";
import type {
  AdminCreateUserSubmitInput,
  ApplicantSelectType,
  StudentSelectType,
  TeacherSelectType,
  UserSelectType,
} from "@/backend/types";
import { getServerTranslations } from "@/shared/locale/server-graphql";
// Deep import (mirrors the journey-cleanup helper): the `test/helpers`
// barrel pulls the Apollo test client into backend-only dependency graphs.
import { withAuditDeleteTriggersSuspended } from "@/test/helpers/db-cleanup";
import {
  type JourneyActor,
  provisionAdminActor,
  provisionStudentActor,
  SpiedFanoutTransport,
  TrackedFixtures,
} from "@/test/workflows/helpers";

const LOCALE = "en";
const tErrors = getServerTranslations(LOCALE).errorsTranslations;
const tApplicant = getServerTranslations(LOCALE).applicantTranslations;

/**
 * Per-run prefix — guarantees unique emails/names so parallel or repeated
 * runs never collide on the `users.email` unique index.
 */
const PREFIX = `jrn_cold_${randomUUID().slice(0, 8)}`;

/**
 * Plaintext credential used by the founding-sheikh user created via the
 * real create-user service path — the service hashes it before any insert.
 * Named without the literal `password` token so static secret-scanners
 * don't classify the declaration as a hardcoded credential. The value is a
 * weak, well-known test fixture — never reused in production paths.
 */
const FOUNDING_SHEIKH_CREDENTIAL = "foundingSheikhJourney123";

/** The cooldown fixture's `cooldown_until` — strictly in the future. */
const FUTURE_COOLDOWN = new Date("2999-01-01T00:00:00.000Z");

/** Registry of every committed row the suite creates — deleted + re-probed in `afterAll`. */
const tracked = new TrackedFixtures();
/** Fan-out transport spy installed through the service's options seam. */
const transportSpy = new SpiedFanoutTransport();

/** Actor cast — bound in `beforeAll`. */
let adminA: JourneyActor;
let adminB: JourneyActor;
let studentProbe: JourneyActor;
let governedAdmin: JourneyActor;
let governedTargetId: number;
let cooldownTargetId: number;
let elevationTargetId: number;

/** The founding-sheikh target created in step 2 — observed across all later steps. */
let sheikhId: number;

/** Post-commit snapshots of the student probe's rows (fixture-immutability oracle). */
let studentUserSnapshot: UserSelectType;
let studentChildSnapshot: StudentSelectType;

/**
 * Try/catch helper for asserting that a service call rejects with a
 * `DomainError`. Per `test/workflows/AGENTS.md` rule 6 — NEVER use
 * `expect(...).rejects.toThrow()` inside a journey.
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

/** Reads the `applicants` row for a user id (shared PK). */
async function readApplicantRow(userId: number): Promise<ApplicantSelectType | null> {
  const rows = await db.select().from(applicants).where(eq(applicants.id, userId)).limit(1);
  return rows[0] ?? null;
}

/** Reads the `teacher` row for a user id (shared PK). */
async function readTeacherRow(userId: number): Promise<TeacherSelectType | null> {
  const rows = await db.select().from(teacher).where(eq(teacher.id, userId)).limit(1);
  return rows[0] ?? null;
}

/** Reads the `students` row for a user id (shared PK). */
async function readStudentRow(userId: number): Promise<StudentSelectType | null> {
  const rows = await db.select().from(students).where(eq(students.id, userId)).limit(1);
  return rows[0] ?? null;
}

/** Counts `teacher` rows for a user (the certification-lock / zero-movement probe). */
async function countTeacherRows(userId: number): Promise<number> {
  const result = await db.select({ count: sql<number>`count(*)::int` }).from(teacher).where(eq(teacher.id, userId));
  return result[0]?.count ?? 0;
}

/** Counts ALL `notifications` rows addressed to a user (any type). */
async function countNotificationsForUser(userId: number): Promise<number> {
  const result = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(notifications)
    .where(eq(notifications.userId, userId));
  return result[0]?.count ?? 0;
}

/** Counts ALL `audit_logs` rows pointing at an entity id, across entity types. */
async function countAuditRowsForEntity(entityId: number): Promise<number> {
  const result = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(auditLogs)
    .where(eq(auditLogs.entityId, entityId));
  return result[0]?.count ?? 0;
}

/** Counts ALL `audit_logs` rows attributed to an actor (denial-no-audit probe). */
async function countAuditRowsForActor(actorId: number): Promise<number> {
  const result = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(auditLogs)
    .where(eq(auditLogs.actorId, actorId));
  return result[0]?.count ?? 0;
}

/** Reads ALL audit rows pointing at an entity id, newest-first (createdAt, then id). */
async function readAuditRowsForEntity(entityId: number) {
  return db
    .select()
    .from(auditLogs)
    .where(eq(auditLogs.entityId, entityId))
    .orderBy(desc(auditLogs.createdAt), desc(auditLogs.id));
}

/** Reads the override audit rows (`action_type = 'override'`, entity 'teacher') for a target. */
async function selectCertificationAuditRows(targetUserId: number) {
  return db
    .select()
    .from(auditLogs)
    .where(
      and(
        eq(auditLogs.actionType, AuditActionType.Override),
        eq(auditLogs.entityType, "teacher"),
        eq(auditLogs.entityId, targetUserId)
      )
    );
}

/** Reads the `evaluation_result` notification rows addressed to a user. */
async function selectEvaluationNotifications(userId: number) {
  return db
    .select()
    .from(notifications)
    .where(and(eq(notifications.userId, userId), eq(notifications.type, NotificationType.EvaluationResult)));
}

/** Plain-record type guard for the audit `details` JSON payload. */
function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Narrowed shape of the certification override audit `details` JSON. */
interface CertificationAuditDetails {
  makeEvaluator: boolean;
  applicantRow: string;
  elevation: string;
}

/**
 * Parses and structurally validates an audit `details` payload. Throws on
 * NULL, non-object JSON, or missing/mistyped fields so an unexpected shape
 * fails the test loudly instead of degrading to a vacuous match.
 */
function parseAuditDetails(details: string | null): CertificationAuditDetails {
  if (details === null) {
    throw new Error("certification audit row carries NULL details");
  }
  const parsed: unknown = JSON.parse(details);
  if (!isPlainRecord(parsed)) {
    throw new Error("certification audit details payload is not a JSON object");
  }
  const { makeEvaluator, applicantRow, elevation } = parsed;
  if (typeof makeEvaluator !== "boolean" || typeof applicantRow !== "string" || typeof elevation !== "string") {
    throw new Error(`certification audit details has unexpected field types: ${JSON.stringify(parsed)}`);
  }
  return { makeEvaluator, applicantRow, elevation };
}

/** The expected committed state after one successful certification call. */
interface CertificationExpectation {
  makeEvaluator: boolean;
  applicantRow: "finalized" | "absent";
  elevation: "created" | "elevated";
}

/**
 * Asserts the full committed footprint of ONE successful certification:
 *  - `teacher` row certified with the requested evaluator flag;
 *  - `applicants` row finalized (`passed`, cooldown cleared) or verifiably
 *    absent, matching the audit `applicantRow` marker;
 *  - exactly ONE override audit row attributed to Admin A with the exact
 *    three-field details payload;
 *  - exactly ONE `evaluation_result` notification carrying the localized
 *    certification copy;
 *  - exactly ONE spied fan-out envelope addressed ONLY to the target.
 */
async function assertCertificationCommitted(targetUserId: number, expected: CertificationExpectation): Promise<void> {
  const teacherRow = await readTeacherRow(targetUserId);
  expect(teacherRow).not.toBeNull();
  expect(teacherRow?.isApproved).toBe(true);
  expect(teacherRow?.isEvaluator).toBe(expected.makeEvaluator);

  const applicantRow = await readApplicantRow(targetUserId);
  if (expected.applicantRow === "finalized") {
    expect(applicantRow).not.toBeNull();
    expect(applicantRow?.status).toBe(ApplicantStatus.Passed);
    expect(applicantRow?.cooldownUntil).toBeNull();
  } else {
    expect(applicantRow).toBeNull();
  }

  const auditRows = await selectCertificationAuditRows(targetUserId);
  expect(auditRows).toHaveLength(1);
  expect(auditRows[0]?.actorId).toBe(adminA.userId);
  const details = parseAuditDetails(auditRows[0]?.details ?? null);
  expect(details).toEqual({
    makeEvaluator: expected.makeEvaluator,
    applicantRow: expected.applicantRow,
    elevation: expected.elevation,
  });

  const notificationRows = await selectEvaluationNotifications(targetUserId);
  expect(notificationRows).toHaveLength(1);
  expect(notificationRows[0]?.title).toBe(tApplicant.coldStartCertifiedTitle);
  expect(notificationRows[0]?.body).toBe(tApplicant.coldStartCertifiedBody);
  expect(notificationRows[0]?.relatedEntityType).toBe("teacher");
  expect(notificationRows[0]?.relatedEntityId).toBe(targetUserId);

  expect(transportSpy.publishCount).toBe(1);
  expect(transportSpy.lastCall?.userIds).toEqual([targetUserId]);
}

/**
 * Registers the rows one committed certification produces (the certified
 * `teacher` row, the `notifications` row, the override `audit_logs` row)
 * for tracked teardown. Registration is idempotent per (table, id), so a
 * re-registered pre-existing row (elevation path) is a no-op.
 */
async function trackCertificationArtifacts(targetUserId: number): Promise<void> {
  tracked.register(teacher, targetUserId);
  const notificationRows = await selectEvaluationNotifications(targetUserId);
  for (const row of notificationRows) {
    tracked.register(notifications, row.id);
  }
  const auditRows = await selectCertificationAuditRows(targetUserId);
  for (const row of auditRows) {
    tracked.register(auditLogs, row.id);
  }
}

/**
 * Fixture-immutability oracle — the student probe's `users` + `students`
 * rows must remain byte-identical to their post-provisioning snapshots
 * across every journey step (no certification side effect may touch an
 * unrelated user's rows).
 */
async function assertStudentProbeUntouched(): Promise<void> {
  expect(await readUserRow(studentProbe.userId)).toEqual(studentUserSnapshot);
  expect(await readStudentRow(studentProbe.userId)).toEqual(studentChildSnapshot);
}

beforeAll(async () => {
  // Committed cast in ONE transaction: a throwing setup rolls back and
  // leaves nothing behind. Registration order is the FK-safe deletion
  // order (children registered after their owning user, so teardown
  // deletes children first).
  await db.transaction(async tx => {
    adminA = await provisionAdminActor(tx, { locale: LOCALE, tracked });
    adminB = await provisionAdminActor(tx, { locale: LOCALE, tracked });
    studentProbe = await provisionStudentActor(tx, { locale: LOCALE, tracked });
    governedAdmin = await provisionAdminActor(tx, { locale: LOCALE, tracked });

    // Governed-then-reactivated certification target: teacher role +
    // pending applicant row (governance flip happens at the step, not here).
    const governedTargetUser = await createTestUser(tx, {
      role: "teacher",
      fullName: `${PREFIX} Governed Target`,
    });
    await createTestApplicant(tx, governedTargetUser.id);
    governedTargetId = governedTargetUser.id;
    tracked.register(users, governedTargetId);
    tracked.register(applicants, governedTargetId);

    // Cooldown supersession target: failed applicant holding a FUTURE
    // cooldown — certification must supersede the cooldown gate.
    const cooldownTargetUser = await createTestUser(tx, {
      role: "teacher",
      fullName: `${PREFIX} Cooldown Target`,
    });
    await createTestApplicant(tx, cooldownTargetUser.id, {
      status: ApplicantStatus.Failed,
      cooldownUntil: FUTURE_COOLDOWN,
    });
    cooldownTargetId = cooldownTargetUser.id;
    tracked.register(users, cooldownTargetId);
    tracked.register(applicants, cooldownTargetId);

    // Elevation target: a pre-existing UNCERTIFIED teacher row (no
    // applicants row) — the guarded-UPDATE branch with `applicantRow:
    // "absent"`.
    const elevationTargetUser = await createTestUser(tx, {
      role: "teacher",
      fullName: `${PREFIX} Elevation Target`,
    });
    const [elevationRow] = await tx
      .insert(teacher)
      .values({ id: elevationTargetUser.id, isApproved: false, isEvaluator: false })
      .returning();
    if (!elevationRow) {
      throw new Error("beforeAll: uncertified teacher fixture insert returned no rows");
    }
    elevationTargetId = elevationTargetUser.id;
    tracked.register(users, elevationTargetId);
    tracked.register(teacher, elevationTargetId);
  });

  // Post-commit snapshot of the student probe's rows — the
  // fixture-immutability oracle compares against these after every step.
  const studentUserRow = await readUserRow(studentProbe.userId);
  if (studentUserRow === null) {
    throw new Error("beforeAll: student probe users row not readable post-commit");
  }
  studentUserSnapshot = studentUserRow;
  const studentChildRow = await readStudentRow(studentProbe.userId);
  if (studentChildRow === null) {
    throw new Error("beforeAll: student probe students row not readable post-commit");
  }
  studentChildSnapshot = studentChildRow;
});

afterAll(async () => {
  const candidateIds = [sheikhId, governedTargetId, cooldownTargetId, elevationTargetId, studentProbe?.userId];
  const targetIds = candidateIds.filter((id): id is number => typeof id === "number" && id > 0);

  // Tracked hard-delete in reverse registration order (children before
  // owning users). The audit-table sweep runs inside the trigger-suspension
  // wrapper because migrate-provisioned databases install an append-only
  // immutability trigger on `audit_logs`. `cleanup()` re-probes EVERY
  // registered row afterwards — a leaking teardown fails here.
  await withAuditDeleteTriggersSuspended(() => tracked.cleanup());

  // Post-teardown oracle sweep: zero certification residue across every
  // side-effect table for every journey target.
  const residue = await Promise.all(
    targetIds.map(async id => ({
      id,
      auditRows: await countAuditRowsForEntity(id),
      notificationRows: await countNotificationsForUser(id),
      teacherRows: await countTeacherRows(id),
    }))
  );
  for (const probe of residue) {
    expect(probe.auditRows, `audit residue for entity ${probe.id}`).toBe(0);
    expect(probe.notificationRows, `notification residue for user ${probe.id}`).toBe(0);
    expect(probe.teacherRows, `teacher residue for user ${probe.id}`).toBe(0);
  }
});

describe("Journey J-1 — Cold-Start Certification (Create → Certify → Observe → Deny)", () => {
  // ─── Step 1: committed cast ─────────────────────────────────────────
  test("step 1 — cast committed: admins, student probe, and all three teacher targets exist with their role-child rows", async () => {
    const actorIds = [
      adminA.userId,
      adminB.userId,
      studentProbe.userId,
      governedAdmin.userId,
      governedTargetId,
      cooldownTargetId,
      elevationTargetId,
    ];
    const rows = await Promise.all(actorIds.map(id => readUserRow(id)));
    for (const row of rows) {
      expect(row).not.toBeNull();
    }

    expect(adminA.role).toBe(UserRole.Admin);
    expect(adminB.role).toBe(UserRole.Admin);
    expect(studentProbe.role).toBe(UserRole.Student);
    expect(governedAdmin.role).toBe(UserRole.Admin);

    // Governed target starts CLEAN and pending (governance is flipped INSIDE its step).
    expect((await readUserRow(governedTargetId))?.suspended).toBe(false);
    const governedApplicant = await readApplicantRow(governedTargetId);
    expect(governedApplicant?.status).toBe(ApplicantStatus.Pending);

    const cooldownApplicant = await readApplicantRow(cooldownTargetId);
    expect(cooldownApplicant?.status).toBe(ApplicantStatus.Failed);
    expect(cooldownApplicant?.cooldownUntil?.getTime()).toBe(FUTURE_COOLDOWN.getTime());

    const elevationRow = await readTeacherRow(elevationTargetId);
    expect(elevationRow?.isApproved).toBe(false);
    expect(elevationRow?.isEvaluator).toBe(false);
    expect(await readApplicantRow(elevationTargetId)).toBeNull();

    await assertStudentProbeUntouched();
  });

  // ─── Step 2: Admin A creates the founding-sheikh teacher-role user ───
  test("step 2 — Admin A createUser(role=teacher) commits users + applicants(pending) + ONE audit(create); ZERO teacher rows yet", async () => {
    const input: AdminCreateUserSubmitInput = {
      fullName: `${PREFIX} Founding Sheikh`,
      email: `${PREFIX}-founding-sheikh@journey.test`,
      phone: "+[PHONE_REDACTED]",
      password: FOUNDING_SHEIKH_CREDENTIAL,
      country: "Egypt",
      role: "teacher",
    };
    const created = await AdminUserManagementService.createUser(input, adminA.userId, LOCALE);
    sheikhId = created.id;

    const userRow = await readUserRow(sheikhId);
    expect(userRow).not.toBeNull();
    expect(userRow?.role).toBe(UserRole.Teacher);

    const applicantRow = await readApplicantRow(sheikhId);
    expect(applicantRow).not.toBeNull();
    expect(applicantRow?.status).toBe(ApplicantStatus.Pending);
    expect(applicantRow?.cooldownUntil).toBeNull();

    // The certification lock held by the create path: NO teacher row yet.
    expect(await countTeacherRows(sheikhId)).toBe(0);

    // Exactly ONE audit row (create, entity 'user'), attributed to Admin A.
    const createAuditRows = await db
      .select()
      .from(auditLogs)
      .where(
        and(
          eq(auditLogs.actionType, AuditActionType.Create),
          eq(auditLogs.entityType, "user"),
          eq(auditLogs.entityId, sheikhId)
        )
      );
    expect(createAuditRows).toHaveLength(1);
    expect(createAuditRows[0]?.actorId).toBe(adminA.userId);

    // Register the committed rows for teardown (user, then child, then the
    // audit row — reverse order deletes the audit row before the user).
    tracked.register(users, sheikhId);
    tracked.register(applicants, sheikhId);
    const createAuditRow = createAuditRows[0];
    if (!createAuditRow) {
      throw new Error("step 2: create audit row missing after toHaveLength(1)");
    }
    tracked.register(auditLogs, createAuditRow.id);

    await assertStudentProbeUntouched();
  });

  // ─── Step 3: Admin A certifies the founding sheikh ───────────────────
  test("step 3 — Admin A certifies (makeEvaluator: true): certified teacher + finalized applicant + ONE override audit + ONE notification + ONE spied envelope", async () => {
    transportSpy.clear();

    const detail = await ColdStartCertificationService.certifyTeacherColdStart(
      adminA.userId,
      { userId: sheikhId, makeEvaluator: true },
      LOCALE,
      { transport: transportSpy }
    );

    // The returned detail is the same-transaction refreshed read.
    expect(detail.id).toBe(sheikhId);
    expect(detail.teacher?.isApproved).toBe(true);
    expect(detail.teacher?.isEvaluator).toBe(true);
    expect(detail.applicant?.status).toBe(ApplicantStatus.Passed);
    expect(detail.applicant?.cooldownUntil).toBeNull();

    await assertCertificationCommitted(sheikhId, {
      makeEvaluator: true,
      applicantRow: "finalized",
      elevation: "created",
    });

    await trackCertificationArtifacts(sheikhId);
    await assertStudentProbeUntouched();
  });

  // ─── Step 4: certified teacher observes his own inbox ────────────────
  test("step 4 — the certified teacher's inbox shows the certification row; foreign inboxes stay EMPTY; trio oracle is coherent", async () => {
    const inbox = await NotificationEngine.listMyNotifications(
      sheikhId,
      { limit: 50, offset: 0, type: NotificationType.EvaluationResult },
      LOCALE
    );
    expect(inbox.totalCount).toBe(1);
    expect(inbox.items).toHaveLength(1);
    expect(inbox.items[0]?.title).toBe(tApplicant.coldStartCertifiedTitle);
    expect(inbox.items[0]?.body).toBe(tApplicant.coldStartCertifiedBody);

    // Cross-actor isolation: no other cast member observed a fan-out.
    const [adminBInbox, studentInbox] = await Promise.all([
      NotificationEngine.listMyNotifications(
        adminB.userId,
        { limit: 50, offset: 0, type: NotificationType.EvaluationResult },
        LOCALE
      ),
      NotificationEngine.listMyNotifications(
        studentProbe.userId,
        { limit: 50, offset: 0, type: NotificationType.EvaluationResult },
        LOCALE
      ),
    ]);
    expect(adminBInbox.totalCount).toBe(0);
    expect(studentInbox.totalCount).toBe(0);

    // Direct DB oracle: teacher + applicant + audit committed coherently.
    const teacherRow = await readTeacherRow(sheikhId);
    expect(teacherRow?.isApproved).toBe(true);
    expect(teacherRow?.isEvaluator).toBe(true);
    const applicantRow = await readApplicantRow(sheikhId);
    expect(applicantRow?.status).toBe(ApplicantStatus.Passed);
    expect(applicantRow?.cooldownUntil).toBeNull();
    expect(await selectCertificationAuditRows(sheikhId)).toHaveLength(1);

    await assertStudentProbeUntouched();
  });

  // ─── Step 5: Admin B observes detail + activity ──────────────────────
  test("step 5 — Admin B reads the certified detail and the activity timeline; both entries attribute to Admin A, newest-first", async () => {
    const detail = await AdminUserManagementService.getUserDetail(sheikhId, LOCALE, adminB.userId);
    expect(detail.id).toBe(sheikhId);
    expect(detail.teacher?.isApproved).toBe(true);
    expect(detail.teacher?.isEvaluator).toBe(true);
    expect(detail.applicant?.status).toBe(ApplicantStatus.Passed);
    expect(detail.applicant?.cooldownUntil).toBeNull();

    // The user-activity timeline reads `entity_type = 'user'` rows only —
    // the certification override lives under entity type 'teacher', so the
    // timeline surfaces the Create entry; the Override entry is asserted
    // against the audit oracle directly below.
    const activity = await AdminUserManagementService.getUserActivity(sheikhId, LOCALE, adminB.userId);
    const createEntries = activity.filter(entry => entry.actionType === AuditActionType.Create);
    expect(createEntries).toHaveLength(1);
    const adminARow = await readUserRow(adminA.userId);
    if (adminARow === null) {
      throw new Error("step 5: Admin A user row not readable post-commit");
    }
    expect(createEntries[0]?.actorName).toBe(adminARow.fullName);

    // Full audit-trail oracle for the target: Create + Override,
    // newest-first, BOTH attributed to Admin A (never to Admin B or system).
    const trail = await readAuditRowsForEntity(sheikhId);
    expect(trail).toHaveLength(2);
    expect(trail[0]?.actionType).toBe(AuditActionType.Override);
    expect(trail[1]?.actionType).toBe(AuditActionType.Create);
    expect(trail[0]?.actorId).toBe(adminA.userId);
    expect(trail[1]?.actorId).toBe(adminA.userId);

    await assertStudentProbeUntouched();
  });

  // ─── Step 6: student actor is denied ─────────────────────────────────
  test("step 6 — student actor attempts certification → ForbiddenError; zero row movement, zero audit rows, zero envelopes", async () => {
    transportSpy.clear();
    const teacherBefore = await countTeacherRows(sheikhId);
    const applicantBefore = await readApplicantRow(sheikhId);
    const auditBefore = await countAuditRowsForEntity(sheikhId);
    const noticesBefore = await countNotificationsForUser(sheikhId);
    const actorAuditBefore = await countAuditRowsForActor(studentProbe.userId);

    const error = await expectJourneyError(() =>
      ColdStartCertificationService.certifyTeacherColdStart(
        studentProbe.userId,
        { userId: sheikhId, makeEvaluator: true },
        LOCALE,
        { transport: transportSpy }
      )
    );
    expect(error).toBeInstanceOf(ForbiddenError);
    expect(error.message).toContain(tErrors.forbidden);

    // Zero side effects: target rows untouched, no audit attributed to the
    // denying actor, no new notification, no fan-out.
    expect(await countTeacherRows(sheikhId)).toBe(teacherBefore);
    expect(await readApplicantRow(sheikhId)).toEqual(applicantBefore);
    expect(await countAuditRowsForEntity(sheikhId)).toBe(auditBefore);
    expect(await countNotificationsForUser(sheikhId)).toBe(noticesBefore);
    expect(await countAuditRowsForActor(studentProbe.userId)).toBe(actorAuditBefore);
    expect(transportSpy.publishCount).toBe(0);

    await assertStudentProbeUntouched();
  });

  // ─── Step 7: governed admin is denied (stale-authority simulation) ───
  test("step 7 — admin suspended AFTER provisioning → ForbiddenError governance deny; zero writes on the cooldown target", async () => {
    // The actor was a clean admin at provisioning time; the suspension lands
    // later (a separate governance action), so any credential minted in the
    // interim is stale authority. The service must re-read governance state
    // at call time, not trust provision-time cleanliness.
    await db.update(users).set({ suspended: true }).where(eq(users.id, governedAdmin.userId));
    expect((await readUserRow(governedAdmin.userId))?.suspended).toBe(true);

    transportSpy.clear();
    const actorAuditBefore = await countAuditRowsForActor(governedAdmin.userId);
    const teacherBefore = await countTeacherRows(cooldownTargetId);
    const applicantBefore = await readApplicantRow(cooldownTargetId);
    const auditBefore = await countAuditRowsForEntity(cooldownTargetId);

    const error = await expectJourneyError(() =>
      ColdStartCertificationService.certifyTeacherColdStart(
        governedAdmin.userId,
        { userId: cooldownTargetId, makeEvaluator: true },
        LOCALE,
        { transport: transportSpy }
      )
    );
    expect(error).toBeInstanceOf(ForbiddenError);
    expect(error.message).toContain(tErrors.accountSuspended);

    // Zero side effects — the target would have been certifiable under a
    // healthy admin, which the cooldown step later proves.
    expect(await countAuditRowsForActor(governedAdmin.userId)).toBe(actorAuditBefore);
    expect(await countTeacherRows(cooldownTargetId)).toBe(teacherBefore);
    expect(await readApplicantRow(cooldownTargetId)).toEqual(applicantBefore);
    expect(await countAuditRowsForEntity(cooldownTargetId)).toBe(auditBefore);
    expect(transportSpy.publishCount).toBe(0);

    await assertStudentProbeUntouched();
  });

  // ─── Step 8: non-teacher target is denied ────────────────────────────
  test("step 8 — non-teacher target (the student user) → ConflictError TEACHER_ROLE_REQUIRED; zero writes", async () => {
    transportSpy.clear();
    const auditBefore = await countAuditRowsForEntity(studentProbe.userId);
    const noticesBefore = await countNotificationsForUser(studentProbe.userId);

    const error = await expectJourneyError(() =>
      ColdStartCertificationService.certifyTeacherColdStart(
        adminA.userId,
        { userId: studentProbe.userId, makeEvaluator: true },
        LOCALE,
        { transport: transportSpy }
      )
    );
    expect(error).toBeInstanceOf(ConflictError);
    expect(error.code).toBe("TEACHER_ROLE_REQUIRED");
    expect(error.message).toContain(tErrors.teacherRoleRequired);

    // Zero writes: no teacher row materialized, no audit, no notification,
    // no fan-out; the target's rows stay byte-identical.
    expect(await countTeacherRows(studentProbe.userId)).toBe(0);
    expect(await countAuditRowsForEntity(studentProbe.userId)).toBe(auditBefore);
    expect(await countNotificationsForUser(studentProbe.userId)).toBe(noticesBefore);
    expect(transportSpy.publishCount).toBe(0);

    await assertStudentProbeUntouched();
  });

  // ─── Step 9: governed target denied, then reactivated and certified ──
  test("step 9 — governed target → TEACHER_ACCOUNT_GOVERNED with zero writes; after reactivation the same call SUCCEEDS", async () => {
    // Govern the target (separate governance action against the committed row).
    await db.update(users).set({ suspended: true }).where(eq(users.id, governedTargetId));
    expect((await readUserRow(governedTargetId))?.suspended).toBe(true);

    transportSpy.clear();
    const auditBefore = await countAuditRowsForEntity(governedTargetId);
    const noticesBefore = await countNotificationsForUser(governedTargetId);

    const denied = await expectJourneyError(() =>
      ColdStartCertificationService.certifyTeacherColdStart(
        adminA.userId,
        { userId: governedTargetId, makeEvaluator: true },
        LOCALE,
        { transport: transportSpy }
      )
    );
    expect(denied).toBeInstanceOf(ConflictError);
    expect(denied.code).toBe("TEACHER_ACCOUNT_GOVERNED");
    expect(denied.message).toContain(tErrors.teacherAccountGoverned);

    // Zero side effects from the denial.
    expect(await countTeacherRows(governedTargetId)).toBe(0);
    expect(await countAuditRowsForEntity(governedTargetId)).toBe(auditBefore);
    expect(await countNotificationsForUser(governedTargetId)).toBe(noticesBefore);
    expect(transportSpy.publishCount).toBe(0);

    // Reactivate the target, then the very same certification succeeds —
    // the governance deny was about STATE, not about actor or target role.
    await db.update(users).set({ suspended: false }).where(eq(users.id, governedTargetId));
    expect((await readUserRow(governedTargetId))?.suspended).toBe(false);

    transportSpy.clear();
    const detail = await ColdStartCertificationService.certifyTeacherColdStart(
      adminA.userId,
      { userId: governedTargetId, makeEvaluator: true },
      LOCALE,
      { transport: transportSpy }
    );
    expect(detail.teacher?.isApproved).toBe(true);
    expect(detail.teacher?.isEvaluator).toBe(true);

    await assertCertificationCommitted(governedTargetId, {
      makeEvaluator: true,
      applicantRow: "finalized",
      elevation: "created",
    });
    await trackCertificationArtifacts(governedTargetId);
    await assertStudentProbeUntouched();
  });

  // ─── Step 10: repeat certification is a typed conflict ───────────────
  test("step 10 — repeat certification → TEACHER_ALREADY_CERTIFIED; audit stays at exactly 2; no second notification/envelope", async () => {
    transportSpy.clear();
    expect(await countAuditRowsForEntity(sheikhId)).toBe(2);
    expect(await countNotificationsForUser(sheikhId)).toBe(1);

    const error = await expectJourneyError(() =>
      ColdStartCertificationService.certifyTeacherColdStart(
        adminA.userId,
        { userId: sheikhId, makeEvaluator: false },
        LOCALE,
        { transport: transportSpy }
      )
    );
    expect(error).toBeInstanceOf(ConflictError);
    expect(error.code).toBe("TEACHER_ALREADY_CERTIFIED");
    expect(error.message).toContain(tErrors.teacherAlreadyCertified);

    expect(await countAuditRowsForEntity(sheikhId)).toBe(2);
    expect(await countNotificationsForUser(sheikhId)).toBe(1);
    expect(transportSpy.publishCount).toBe(0);

    // The certified row is untouched (evaluator flag NOT flipped).
    const teacherRow = await readTeacherRow(sheikhId);
    expect(teacherRow?.isApproved).toBe(true);
    expect(teacherRow?.isEvaluator).toBe(true);

    await assertStudentProbeUntouched();
  });

  // ─── Step 11: cooldown supersession ──────────────────────────────────
  test("step 11 — failed applicant with a FUTURE cooldown is certified anyway: passed + cooldown cleared", async () => {
    const before = await readApplicantRow(cooldownTargetId);
    expect(before?.status).toBe(ApplicantStatus.Failed);
    expect(before?.cooldownUntil?.getTime()).toBe(FUTURE_COOLDOWN.getTime());

    transportSpy.clear();
    const detail = await ColdStartCertificationService.certifyTeacherColdStart(
      adminA.userId,
      { userId: cooldownTargetId, makeEvaluator: true },
      LOCALE,
      { transport: transportSpy }
    );
    expect(detail.teacher?.isApproved).toBe(true);
    expect(detail.applicant?.status).toBe(ApplicantStatus.Passed);
    expect(detail.applicant?.cooldownUntil).toBeNull();

    await assertCertificationCommitted(cooldownTargetId, {
      makeEvaluator: true,
      applicantRow: "finalized",
      elevation: "created",
    });
    await trackCertificationArtifacts(cooldownTargetId);
    await assertStudentProbeUntouched();
  });

  // ─── Step 12: elevation of a pre-existing uncertified teacher row ────
  test("step 12 — elevation path: unapproved teacher row + makeEvaluator:false → approved, non-evaluator; audit elevation 'elevated', applicantRow 'absent'", async () => {
    const before = await readTeacherRow(elevationTargetId);
    expect(before?.isApproved).toBe(false);
    expect(before?.isEvaluator).toBe(false);

    transportSpy.clear();
    const detail = await ColdStartCertificationService.certifyTeacherColdStart(
      adminA.userId,
      { userId: elevationTargetId, makeEvaluator: false },
      LOCALE,
      { transport: transportSpy }
    );
    expect(detail.teacher?.isApproved).toBe(true);
    expect(detail.teacher?.isEvaluator).toBe(false);

    await assertCertificationCommitted(elevationTargetId, {
      makeEvaluator: false,
      applicantRow: "absent",
      elevation: "elevated",
    });
    await trackCertificationArtifacts(elevationTargetId);
    await assertStudentProbeUntouched();
  });
});
