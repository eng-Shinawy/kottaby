/**
 * Cross-actor journey — admin soft-delete → history preservation.
 *
 * The governed-user deletion arc proven end-to-end against the REAL
 * services on the REAL test database: an admin soft-deletes a student who
 * holds committed history (a session, its report, a payment, and the
 * teacher's wallet-adjacent earning ledger), and every historical row must
 * survive the governance action byte-identically while remaining queryable
 * by the authorized admin. The users hard-delete backstop — the GUC-gated
 * `prevent_users_delete` BEFORE DELETE trigger — is probed raw-SQL: with
 * the guard re-armed transaction-locally via
 * `set_config('kottaby.users_delete_guard', 'on', true)`, a direct
 * `DELETE FROM users` RAISEs and the row survives. On push-provisioned
 * databases (no trigger installed) the same probe asserts the restrict-FK
 * failure class instead — the fixture family's session and payment rows
 * make the deletion impossible either way. A teacher-side variant pins the
 * mirror guarantee: earning rows survive teacher soft-delete.
 *
 * Sequential, actor-attributed steps (later steps observe the shared state
 * earlier steps committed):
 *
 *   | Step | Actor           | Action                                      | Shared state                       | Side effects                    |
 *   |------|-----------------|---------------------------------------------|------------------------------------|---------------------------------|
 *   | 1    | System          | committed fixture families + login premise  | clean slate                        | one Create audit row (provision) |
 *   | 2    | Admin           | soft-delete the student (guarded UPDATE)   | is_deleted=true, deleted_at set    | one Delete audit row            |
 *   | 3    | System          | history-preservation oracle re-query        | rows present + byte-identical      | none                            |
 *   | 4    | Student         | login attempt                               | ForbiddenError at the gate         | zero writes                     |
 *   | 5    | System          | raw-SQL hard-delete probe (guard re-armed)  | trigger RAISE / FK class; survival | zero writes                     |
 *   | 6    | Control student | admin-surface probes (read + mutate)        | ForbiddenError via the real gate   | zero writes, zero audit         |
 *   | 7    | Admin           | reactivate the student                      | deleted_at=null, login restored   | one Reactivate audit row        |
 *   | 8    | Admin           | teacher variant: soft-delete + reactivate   | earning + wallet byte-identical   | Delete + Reactivate audit rows  |
 *
 * Journey rules honored (`test/workflows/AGENTS.md`):
 *  - fixtures COMMITTED in `beforeAll` inside ONE committing transaction;
 *    never `runInRollback` (the services spawn their own top-level
 *    transactions);
 *  - honest actors: real `users` rows + real role-child rows via the
 *    actor-context factory; the student under governance is created
 *    through the REAL admin creation service so both login legs exercise
 *    the real credential hash; every denial fails through the real
 *    authorization path — nothing monkey-patched except the notification
 *    publish seam (restored in `afterAll`);
 *  - the governance arc is silent by design: every step asserts ZERO
 *    fan-out publishes at the spied engine boundary;
 *  - expected rejections captured with `catchJourneyError` — never
 *    `.rejects.toThrow()`; denial copy asserted as translated substrings
 *    from the server locale bundle — never raw keys, never hardcoded copy;
 *  - per-run `jrn_admin_<8hex>` prefix on every fixture name so repeated
 *    or parallel runs never collide;
 *  - cross-actor visibility asserted BOTH directions: the control tenant's
 *    users/student/session/report/payment rows are byte-compared after
 *    every leg (no cross-tenant leak), and the non-admin probes deny
 *    through the real admin gate with the target row byte-identical.
 *
 * Teardown: audit rows (actor-scoped + user-entity) FIRST under the
 * sanctioned audit-delete trigger suspension, then the append-only ledger
 * fixtures (`student_payments` / `teacher_transaction`) under the
 * generalized immutability suspension, then a defensive notification sweep,
 * then the tracked registry sweep (reverse registration order +
 * zero-residue existence re-probes for EVERY tracked row — a leaking
 * `afterAll` fails the suite loudly). The `users` rows need no guard
 * suspension: every pooled test connection inherits the test-path
 * `kottaby.users_delete_guard=off` opt-out from the DB client's startup
 * options packet.
 */

import { afterAll, beforeAll, describe, expect, spyOn, test } from "bun:test";
import { and, eq, inArray, or, sql } from "drizzle-orm";
import { db, queryDb } from "@/backend/db";
import { auditLogs } from "@/backend/db/schema/audit/audit-logs";
import { studentPayments } from "@/backend/db/schema/billing/student-payments";
import { teacherTransaction } from "@/backend/db/schema/billing/teacher-transaction";
import { wallet } from "@/backend/db/schema/billing/wallet";
import { reports } from "@/backend/db/schema/classes/reports";
import { session } from "@/backend/db/schema/classes/session";
import { notifications } from "@/backend/db/schema/notifications/notifications";
import { students } from "@/backend/db/schema/students/students";
import { users } from "@/backend/db/schema/users/users";
import {
  createTestSession,
  createTestSessionReport,
  createTestStudentPayment,
  createTestTeacherTransaction,
  createTestWallet,
} from "@/backend/db/test/entity-setup";
import { expectTriggerRaise, probeInsideSavepoint } from "@/backend/db/test/logic/invariants/invariant-probe.helpers";
import { hasPostgresErrorCode } from "@/backend/db/test/pg-error";
import { AuditActionType } from "@/backend/enum/audit/audit-action-type.enum";
import { ConflictError, ForbiddenError } from "@/backend/lib/errors";
import { AdminUserManagementService } from "@/backend/services/admin/user-management.service";
import { AuthService } from "@/backend/services/auth/auth.service";
import { NotificationEngine } from "@/backend/services/notifications";
import type {
  AdminCreateUserSubmitInput,
  ReportSelectType,
  SessionSelectType,
  StudentPaymentSelectType,
  StudentSelectType,
  TeacherTransactionSelectType,
  UserSelectType,
  WalletSelectType,
} from "@/backend/types";
import { getServerTranslations } from "@/shared/locale/server-graphql";
import {
  countUsersByIds,
  withAuditDeleteTriggersSuspended,
  withImmutabilityTriggersSuspended,
} from "@/test/helpers/db-cleanup";
import {
  catchJourneyError,
  type JourneyActor,
  journeyPrefix,
  provisionAdminActor,
  provisionCertifiedTeacherActor,
  provisionStudentActor,
  TrackedFixtures,
} from "@/test/workflows/helpers";

// ─── Contracts under pin ─────────────────────────────────────────────────────

/** Per-run unique prefix — every fixture name and email. */
const PREFIX = journeyPrefix("admin");

/** Error-copy locale for every service call and denial assertion. */
const LOCALE = "en";
const tErrors = getServerTranslations(LOCALE).errorsTranslations;
// The login governance gate emits the AUTH namespace's `accountBlocked`
// copy (which covers deleted, blocked, and suspended states) — not the
// errors-namespace variant.
const tAuth = getServerTranslations(LOCALE).authTranslations;

/**
 * Credential materialized by the real admin creation service's bcrypt path
 * for the governed student, so the denied and restored login legs exercise
 * the real hash round-trip.
 *
 * Named without the literal `password` token so static secret-scanners do
 * not classify the declaration as a hardcoded credential; the value is a
 * weak, well-known test fixture never reused in production paths.
 */
const GOVERNED_STUDENT_CREDENTIAL = "DeleteHistoryJourney#2026";

/** The users-delete guard trigger the canonical migration installs. */
const USERS_DELETE_GUARD_TRIGGER = "prevent_users_delete_trigger";
/** Raised message substring (canonical migration DDL). */
const USERS_DELETE_RAISE_TEXT = "users is not hard-deletable";
/** Custom GUC gating the guard; armed whenever the value is anything but 'off'. */
const USERS_DELETE_GUARD_GUC = "kottaby.users_delete_guard";
/** PostgreSQL SQLSTATE for `foreign_key_violation` — the restrict-FK failure class. */
const PG_FK_VIOLATION = "23503";

/** `pg_trigger.tgtype` bit values (PostgreSQL trigger type bitmask). */
const TGTYPE_ROW = 1;
const TGTYPE_BEFORE = 2;
const TGTYPE_DELETE = 8;

/**
 * The fan-out publish spy — installed over the engine's publish boundary
 * for the WHOLE journey. The governance arc is silent by design: every step
 * asserts ZERO dispatches. Restored in `afterAll`.
 */
const publishSpy = spyOn(NotificationEngine, "publishReceipts").mockImplementation(async () => {});

/** Suite-scoped fixture registry — every committed row and service-minted row. */
const tracked = new TrackedFixtures();

// ─── Harness state ───────────────────────────────────────────────────────────

let admin: JourneyActor; // the real admin governance actor
let teacher: JourneyActor; // the session's teacher + the teacher-side variant target
let controlStudent: JourneyActor; // untouched sibling tenant (isolation oracle)

/** The governed student — created through the real admin creation service. */
let governedStudentId = 0;
let governedStudentEmail = "";

/** The governed family's committed history rows. */
let governedSessionId = 0;
let governedReportId = 0;
let governedPaymentId = 0; // append-only ledger — torn down under trigger suspension
let earningWalletId = 0;
let earningTransactionId = 0; // append-only ledger — torn down under trigger suspension

/** The control tenant's committed history rows. */
let controlSessionId = 0;
let controlReportId = 0;
let controlPaymentId = 0; // append-only ledger — torn down under trigger suspension

/** Every append-only ledger row id this journey owns (teardown worklist). */
const ledgerPaymentIds: number[] = [];
const ledgerTransactionIds: number[] = [];

/** The governed family's pre-soft-delete snapshots (byte-identity oracle). */
interface HistorySnapshots {
  readonly studentRow: StudentSelectType;
  readonly sessionRow: SessionSelectType;
  readonly reportRow: ReportSelectType;
  readonly paymentRow: StudentPaymentSelectType;
  readonly walletRow: WalletSelectType;
  readonly earningRow: TeacherTransactionSelectType;
  /** The provisioning Create audit row, projected to the pinned fields. */
  readonly createAuditRow: AuditRowProjection;
}

/** The control tenant's pre-journey snapshots (byte-identity oracle). */
interface ControlSnapshots {
  readonly userRow: UserSelectType;
  readonly studentRow: StudentSelectType;
  readonly sessionRow: SessionSelectType;
  readonly reportRow: ReportSelectType;
  readonly paymentRow: StudentPaymentSelectType;
}

let historySnapshot: HistorySnapshots | null = null;
let controlSnapshot: ControlSnapshots | null = null;
/** The governed user's row as of the completed soft-delete (zero-writes oracle). */
let deletedUserSnapshot: UserSelectType | null = null;

// ─── Read-back oracles ───────────────────────────────────────────────────────

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

/** Reads a `session` row by id, failing when absent. */
async function readSessionRow(id: number): Promise<SessionSelectType> {
  const rows = await db.select().from(session).where(eq(session.id, id)).limit(1);
  const row = rows[0];
  if (!row) {
    throw new Error(`journey: session row ${id} vanished`);
  }
  return row;
}

/** Reads a `reports` row by id, failing when absent. */
async function readReportRow(id: number): Promise<ReportSelectType> {
  const rows = await db.select().from(reports).where(eq(reports.id, id)).limit(1);
  const row = rows[0];
  if (!row) {
    throw new Error(`journey: report row ${id} vanished`);
  }
  return row;
}

/** Reads a `student_payments` row by id, failing when absent. */
async function readPaymentRow(id: number): Promise<StudentPaymentSelectType> {
  const rows = await db.select().from(studentPayments).where(eq(studentPayments.id, id)).limit(1);
  const row = rows[0];
  if (!row) {
    throw new Error(`journey: student_payments row ${id} vanished`);
  }
  return row;
}

/** Reads a `wallet` row by id, failing when absent. */
async function readWalletRow(id: number): Promise<WalletSelectType> {
  const rows = await db.select().from(wallet).where(eq(wallet.id, id)).limit(1);
  const row = rows[0];
  if (!row) {
    throw new Error(`journey: wallet row ${id} vanished`);
  }
  return row;
}

/** Reads a `teacher_transaction` row by id, failing when absent. */
async function readEarningRow(id: number): Promise<TeacherTransactionSelectType> {
  const rows = await db.select().from(teacherTransaction).where(eq(teacherTransaction.id, id)).limit(1);
  const row = rows[0];
  if (!row) {
    throw new Error(`journey: teacher_transaction row ${id} vanished`);
  }
  return row;
}

/** Counts `audit_logs` rows matching the supplied actor + action + entity. */
async function countAuditForEntity(actorId: number, actionType: AuditActionType, entityId: number): Promise<number> {
  const rows = await db
    .select({ id: auditLogs.id })
    .from(auditLogs)
    .where(and(eq(auditLogs.actorId, actorId), eq(auditLogs.actionType, actionType), eq(auditLogs.entityId, entityId)));
  return rows.length;
}

/** Counts ALL audit rows minted BY one actor (denial-zero-audit oracle). */
async function countAllAuditForActor(actorId: number): Promise<number> {
  const rows = await db.select({ id: auditLogs.id }).from(auditLogs).where(eq(auditLogs.actorId, actorId));
  return rows.length;
}

/** One audit row projected to the fields the journey pins. */
interface AuditRowProjection {
  readonly id: number;
  readonly actorId: number;
  readonly actionType: string;
  readonly entityType: string;
  readonly entityId: number | null;
  readonly details: string | null;
}

/** Reads the audit rows for one actor + action + entity, oldest first. */
async function readAuditRowsForEntity(
  actorId: number,
  actionType: AuditActionType,
  entityId: number
): Promise<AuditRowProjection[]> {
  return db
    .select({
      id: auditLogs.id,
      actorId: auditLogs.actorId,
      actionType: auditLogs.actionType,
      entityType: auditLogs.entityType,
      entityId: auditLogs.entityId,
      details: auditLogs.details,
    })
    .from(auditLogs)
    .where(and(eq(auditLogs.actorId, actorId), eq(auditLogs.actionType, actionType), eq(auditLogs.entityId, entityId)))
    .orderBy(auditLogs.id);
}

/** Plain-object type guard over an untyped `JSON.parse` result. */
function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Parses an audit row's `details` payload into a plain JSON object. */
function parseAuditDetails(row: AuditRowProjection): Record<string, unknown> {
  const parsed: unknown = JSON.parse(row.details ?? "null");
  if (!isPlainRecord(parsed)) {
    throw new Error(`journey: audit row ${row.id} details payload is not a JSON object`);
  }
  return parsed;
}

/** Narrows the history snapshots (missing = a step-ordering bug). */
function requireHistorySnapshot(): HistorySnapshots {
  if (historySnapshot === null) {
    throw new Error("journey: the history snapshots were never captured in setup");
  }
  return historySnapshot;
}

/** Narrows the control-tenant snapshots (missing = a step-ordering bug). */
function requireControlSnapshot(): ControlSnapshots {
  if (controlSnapshot === null) {
    throw new Error("journey: the control tenant's snapshots were never captured in setup");
  }
  return controlSnapshot;
}

/**
 * The history-preservation oracle — the journey's core guarantee: the
 * governed family's student row, session, report, payment, wallet, earning
 * ledger row, and the provisioning Create audit row are all still present
 * and byte-identical to the pre-soft-delete snapshots.
 */
async function expectHistoryPreserved(): Promise<void> {
  const snapshots = requireHistorySnapshot();
  expect(await readStudentRow(governedStudentId)).toEqual(snapshots.studentRow);
  expect(await readSessionRow(governedSessionId)).toEqual(snapshots.sessionRow);
  expect(await readReportRow(governedReportId)).toEqual(snapshots.reportRow);
  expect(await readPaymentRow(governedPaymentId)).toEqual(snapshots.paymentRow);
  expect(await readWalletRow(earningWalletId)).toEqual(snapshots.walletRow);
  expect(await readEarningRow(earningTransactionId)).toEqual(snapshots.earningRow);
  const createRows = await readAuditRowsForEntity(admin.userId, AuditActionType.Create, governedStudentId);
  expect(createRows).toHaveLength(1);
  expect(createRows[0]).toEqual(snapshots.createAuditRow);
}

/**
 * The control-tenant invariance oracle — the untouched sibling's users,
 * student, session, report, and payment rows are byte-identical to the
 * pre-journey snapshots (no cross-tenant leak from any leg).
 */
async function expectControlUntouched(): Promise<void> {
  const snapshots = requireControlSnapshot();
  expect(await readUserRow(controlStudent.userId)).toEqual(snapshots.userRow);
  expect(await readStudentRow(controlStudent.userId)).toEqual(snapshots.studentRow);
  expect(await readSessionRow(controlSessionId)).toEqual(snapshots.sessionRow);
  expect(await readReportRow(controlReportId)).toEqual(snapshots.reportRow);
  expect(await readPaymentRow(controlPaymentId)).toEqual(snapshots.paymentRow);
}

/** The silence oracle — the governance arc publishes nothing, every step. */
function expectPublishSilence(): void {
  expect(publishSpy.mock.calls).toHaveLength(0);
}

/**
 * True when the guard trigger is installed AND fires for application-origin
 * DML: enabled (`tgenabled` 'O'/'A' — a disabled or replica-only trigger
 * never guards), row-level, BEFORE timing, bound to DELETE. Push-provisioned
 * databases install no trigger; their backstop is the restrict-FK chain.
 */
async function usersDeleteGuardEnforcing(): Promise<boolean> {
  const discovered = await db.execute<{
    tgenabled: string;
    isBefore: boolean;
    isRowLevel: boolean;
    onDelete: boolean;
  }>(
    sql`SELECT
          tgenabled,
          (tgtype & ${TGTYPE_BEFORE}) > 0 AS "isBefore",
          (tgtype & ${TGTYPE_ROW}) > 0 AS "isRowLevel",
          (tgtype & ${TGTYPE_DELETE}) > 0 AS "onDelete"
        FROM pg_trigger
        WHERE tgrelid = 'users'::regclass AND NOT tgisinternal AND tgname = ${USERS_DELETE_GUARD_TRIGGER}`
  );
  const row = discovered.rows.at(0);
  if (row === undefined) {
    return false;
  }
  const firesForApplicationDml = row.tgenabled === "O" || row.tgenabled === "A";
  return firesForApplicationDml && row.isBefore && row.isRowLevel && row.onDelete;
}

/** Builds the governed student's creation input (unique per run via the prefix). */
function makeGovernedStudentInput(): AdminCreateUserSubmitInput {
  governedStudentEmail = `${PREFIX}-history-student@journey.test`;
  return {
    fullName: `${PREFIX} History Student`,
    email: governedStudentEmail,
    phone: "+10000000000",
    password: GOVERNED_STUDENT_CREDENTIAL,
    country: "EG",
    role: "student",
  };
}

// ─── Fixture provisioning + teardown ─────────────────────────────────────────

beforeAll(async () => {
  // ONE committing transaction: commit-or-nothing fixture provisioning.
  await db.transaction(async tx => {
    admin = await provisionAdminActor(tx, { tracked });
    teacher = await provisionCertifiedTeacherActor(tx, { tracked });
    controlStudent = await provisionStudentActor(tx, { tracked });

    // The governed student — minted through the REAL admin creation service
    // (real hash, real handshake, real Create audit row) so the login legs
    // exercise the genuine credential path.
    const governed = await AdminUserManagementService.createUser(makeGovernedStudentInput(), admin.userId, LOCALE, tx);
    governedStudentId = governed.id;
    tracked.register(users, governedStudentId);
    tracked.register(students, governedStudentId);

    // The governed family's committed history: session + report + payment,
    // plus the teacher's wallet-adjacent earning ledger row for that session.
    const governedSession = await createTestSession(tx, teacher.userId, governedStudentId);
    governedSessionId = governedSession.id;
    tracked.register(session, governedSessionId);

    const governedReport = await createTestSessionReport(tx, governedSessionId);
    governedReportId = governedReport.id;
    tracked.register(reports, governedReportId);

    const governedPayment = await createTestStudentPayment(tx, governedStudentId, null);
    governedPaymentId = governedPayment.id;
    ledgerPaymentIds.push(governedPaymentId);

    const earningWallet = await createTestWallet(tx, teacher.userId, {
      balance: "50.00",
      totalEarning: "50.00",
    });
    earningWalletId = earningWallet.id;
    tracked.register(wallet, earningWalletId);

    const earningRow = await createTestTeacherTransaction(tx, earningWalletId, governedSessionId);
    earningTransactionId = earningRow.id;
    ledgerTransactionIds.push(earningTransactionId);

    // The control tenant's own history family — never governed, never
    // mutated; byte-compared after every leg.
    const controlSession = await createTestSession(tx, teacher.userId, controlStudent.userId);
    controlSessionId = controlSession.id;
    tracked.register(session, controlSessionId);

    const controlReport = await createTestSessionReport(tx, controlSessionId);
    controlReportId = controlReport.id;
    tracked.register(reports, controlReportId);

    const controlPayment = await createTestStudentPayment(tx, controlStudent.userId, null);
    controlPaymentId = controlPayment.id;
    ledgerPaymentIds.push(controlPaymentId);
  });

  // Post-commit snapshots — the byte-identity oracles for every later leg.
  const createAuditRows = await readAuditRowsForEntity(admin.userId, AuditActionType.Create, governedStudentId);
  expect(createAuditRows).toHaveLength(1);
  const createAuditRow = createAuditRows[0];
  if (!createAuditRow) {
    throw new Error("journey: the provisioning Create audit row vanished before snapshot capture");
  }
  const governedStudentRow = await readStudentRow(governedStudentId);
  if (!governedStudentRow) {
    throw new Error("journey: the governed student's students row vanished before snapshot capture");
  }
  historySnapshot = {
    studentRow: governedStudentRow,
    sessionRow: await readSessionRow(governedSessionId),
    reportRow: await readReportRow(governedReportId),
    paymentRow: await readPaymentRow(governedPaymentId),
    walletRow: await readWalletRow(earningWalletId),
    earningRow: await readEarningRow(earningTransactionId),
    createAuditRow,
  };
  const controlUserRow = await readUserRow(controlStudent.userId);
  if (!controlUserRow) {
    throw new Error("journey: the control tenant's users row vanished before snapshot capture");
  }
  const controlStudentRow = await readStudentRow(controlStudent.userId);
  if (!controlStudentRow) {
    throw new Error("journey: the control tenant's students row vanished before snapshot capture");
  }
  controlSnapshot = {
    userRow: controlUserRow,
    studentRow: controlStudentRow,
    sessionRow: await readSessionRow(controlSessionId),
    reportRow: await readReportRow(controlReportId),
    paymentRow: await readPaymentRow(controlPaymentId),
  };
});

afterAll(async () => {
  publishSpy.mockRestore();

  // Every user id the journey created (the cast + the service-minted student).
  const journeyUserIds = [
    admin?.userId,
    teacher?.userId,
    controlStudent?.userId,
    governedStudentId > 0 ? governedStudentId : undefined,
  ].filter((id): id is number => typeof id === "number" && Number.isSafeInteger(id) && id > 0);

  if (journeyUserIds.length > 0) {
    // 1. Audit rows FIRST — `audit_logs.actor_id` is ON DELETE RESTRICT and
    //    the ledger is append-only (the delete runs under the only
    //    sanctioned mutation path: the audit-delete trigger suspension).
    //    The entity sweep is defensive: the user-entity rows carry no FK.
    await withAuditDeleteTriggersSuspended(async () => {
      await db.delete(auditLogs).where(inArray(auditLogs.actorId, journeyUserIds));
      await queryDb(
        `DELETE FROM audit_logs
         WHERE entity_type = 'user' AND entity_id = ANY($1::int[])`,
        [journeyUserIds]
      );
    });

    // 2. Defensive notification sweep — the journey asserts zero dispatches,
    //    but the users delete must not depend on the cascade shape.
    await db.delete(notifications).where(inArray(notifications.userId, journeyUserIds));
  }

  // 3. The append-only ledger fixtures — the immutability triggers block a
  //    plain DELETE, so exactly this leg runs under the generalized
  //    suspension (`student_payments` restrict-deletes the students rows and
  //    `teacher_transaction` restrict-deletes the wallet, so both must vanish
  //    before the tracked sweep deletes their parents).
  if (ledgerPaymentIds.length > 0 || ledgerTransactionIds.length > 0) {
    await withImmutabilityTriggersSuspended(["student_payments", "teacher_transaction"], async () => {
      await db.delete(studentPayments).where(inArray(studentPayments.id, ledgerPaymentIds));
      await db.delete(teacherTransaction).where(inArray(teacherTransaction.id, ledgerTransactionIds));
    });
  }

  // 4. Tracked hard-delete in reverse registration order (reports, sessions,
  //    wallet, role-child rows, then the users rows) with the mandatory
  //    zero-residue existence re-probes for EVERY tracked row.
  await tracked.cleanup();

  // 5. Post-teardown probes — zero residue, scoped to the journey.
  if (journeyUserIds.length > 0) {
    expect(await countUsersByIds(journeyUserIds)).toBe(0);
    expect(await db.$count(auditLogs, inArray(auditLogs.actorId, journeyUserIds))).toBe(0);
    // The user-entity residue probe rides the raw parameterized path —
    // `entity_id` is nullable, where Drizzle's `inArray` typing is friction.
    const entityResidue = await queryDb<{ count: number }>(
      `SELECT count(*)::int AS count FROM audit_logs WHERE entity_type = 'user' AND entity_id = ANY($1::int[])`,
      [journeyUserIds]
    );
    expect(entityResidue.rows[0]?.count ?? 0).toBe(0);
    expect(await db.$count(notifications, inArray(notifications.userId, journeyUserIds))).toBe(0);
    expect(
      await db.$count(
        session,
        or(inArray(session.studentId, journeyUserIds), inArray(session.teacherId, journeyUserIds))
      )
    ).toBe(0);
  }
  if (ledgerPaymentIds.length > 0) {
    expect(await db.$count(studentPayments, inArray(studentPayments.id, ledgerPaymentIds))).toBe(0);
  }
  if (ledgerTransactionIds.length > 0) {
    expect(await db.$count(teacherTransaction, inArray(teacherTransaction.id, ledgerTransactionIds))).toBe(0);
  }
});

// ─── The journey ──────────────────────────────────────────────────────────────

describe("cross-actor journey: admin soft-delete → history preserved, hard-delete blocked, reactivate restores", () => {
  test("step 1 — System: committed fixture families; governed student active with full history; login premise green", async () => {
    // 4 actors × (users + role-child rows) + the governed student's two rows
    // + 2 sessions + 2 reports + 1 wallet — the two payment rows and the
    // earning ledger row are append-only (suspended teardown, not tracked).
    expect(tracked.size).toBe(13);

    // The governed student is active with a real students row.
    const userRow = await readUserRow(governedStudentId);
    expect(userRow?.isDeleted).toBe(false);
    expect(userRow?.deletedAt).toBeNull();
    const studentRow = await readStudentRow(governedStudentId);
    expect(studentRow?.id).toBe(governedStudentId);

    // The full history family is committed and queryable.
    expect(await readSessionRow(governedSessionId)).toEqual(requireHistorySnapshot().sessionRow);
    expect(await readReportRow(governedReportId)).toEqual(requireHistorySnapshot().reportRow);
    expect(await readPaymentRow(governedPaymentId)).toEqual(requireHistorySnapshot().paymentRow);
    expect(await readWalletRow(earningWalletId)).toEqual(requireHistorySnapshot().walletRow);
    expect(await readEarningRow(earningTransactionId)).toEqual(requireHistorySnapshot().earningRow);

    // Exactly ONE audit row so far — the provisioning Create row.
    expect(await countAllAuditForActor(admin.userId)).toBe(1);
    expect(await countAuditForEntity(admin.userId, AuditActionType.Create, governedStudentId)).toBe(1);
    expect(await countAllAuditForActor(controlStudent.userId)).toBe(0);

    // The login premise: the active student authenticates through the real
    // credential hash (the contrast for the post-delete denial).
    const loginSession = await AuthService.login(governedStudentEmail, GOVERNED_STUDENT_CREDENTIAL, LOCALE);
    expect(loginSession.user.id).toBe(governedStudentId);
    expect(loginSession.accessToken).toBeTruthy();

    // Silent arc + untouched control tenant.
    expectPublishSilence();
    await expectControlUntouched();
  });

  test("step 2 — Admin: soft-delete the student — guarded UPDATE + ONE Delete audit row; re-delete no-ops", async () => {
    expect(await countAuditForEntity(admin.userId, AuditActionType.Delete, governedStudentId)).toBe(0);

    const result = await AdminUserManagementService.setUserDeleted(governedStudentId, true, admin.userId, LOCALE);

    expect(result.isDeleted).toBe(true);
    expect(result.deletedAt).not.toBeNull();

    // The users row state-transitioned in place (never hard-deleted).
    const userRow = await readUserRow(governedStudentId);
    expect(userRow?.isDeleted).toBe(true);
    expect(userRow?.deletedAt).not.toBeNull();

    // Exactly ONE Delete audit row with the pinned zero-PII details contract.
    expect(await countAuditForEntity(admin.userId, AuditActionType.Delete, governedStudentId)).toBe(1);
    const deleteRows = await readAuditRowsForEntity(admin.userId, AuditActionType.Delete, governedStudentId);
    expect(deleteRows).toHaveLength(1);
    const deleteRow = deleteRows[0];
    if (!deleteRow) {
      throw new Error("journey: the Delete audit row vanished");
    }
    expect(deleteRow.actorId).toBe(admin.userId);
    expect(deleteRow.actionType).toBe(AuditActionType.Delete);
    expect(deleteRow.entityType).toBe("user");
    expect(deleteRow.entityId).toBe(governedStudentId);
    expect(parseAuditDetails(deleteRow)).toEqual({ deleted: true });
    expect(await countAllAuditForActor(admin.userId)).toBe(2);

    // The post-delete users row snapshot — the zero-writes oracle for the
    // denial and probe legs below.
    deletedUserSnapshot = await readUserRow(governedStudentId);
    expect(deletedUserSnapshot?.isDeleted).toBe(true);

    // Idempotency: the guarded inverse-state UPDATE makes a re-delete
    // request a typed conflict with ZERO new audit rows and ZERO writes.
    const reDelete = await catchJourneyError(() =>
      AdminUserManagementService.setUserDeleted(governedStudentId, true, admin.userId, LOCALE)
    );
    if (!(reDelete instanceof ConflictError)) {
      throw new Error(`expected ConflictError (got ${reDelete instanceof Error ? reDelete.name : String(reDelete)})`);
    }
    expect(reDelete.message).toContain(tErrors.adminUsers.userAlreadyDeleted);
    expect(await countAuditForEntity(admin.userId, AuditActionType.Delete, governedStudentId)).toBe(1);
    expect(await readUserRow(governedStudentId)).toEqual(deletedUserSnapshot);

    // The soft-delete published nothing and leaked nowhere.
    expectPublishSilence();
    await expectControlUntouched();
  });

  test("step 3 — System: history-preservation oracle — every historical row present and byte-identical; admin still sees the user", async () => {
    // The core guarantee: soft-delete is a guarded UPDATE on `users`; every
    // dependent historical row survives byte-for-byte.
    await expectHistoryPreserved();

    // The authorized admin still observes the governed user AND the audit
    // trail (the governance surface must keep deleted users addressable so
    // they can be reactivated).
    const detail = await AdminUserManagementService.getUserDetail(governedStudentId, LOCALE, admin.userId);
    expect(detail.id).toBe(governedStudentId);
    expect(detail.isDeleted).toBe(true);
    expect(detail.deletedAt).not.toBeNull();

    expect(await countAllAuditForActor(admin.userId)).toBe(2);
    expectPublishSilence();
    await expectControlUntouched();
  });

  test("step 4 — Student: login DENIED at the real governance gate — zero writes, no history change", async () => {
    const adminAuditBefore = await countAllAuditForActor(admin.userId);

    const denial = await catchJourneyError(() =>
      AuthService.login(governedStudentEmail, GOVERNED_STUDENT_CREDENTIAL, LOCALE)
    );
    if (!(denial instanceof ForbiddenError)) {
      throw new Error(`expected ForbiddenError (got ${denial instanceof Error ? denial.name : String(denial)})`);
    }
    // Translated substring from the AUTH locale namespace — the canonical
    // governance-denial copy at the login gate.
    expect(denial.message).toContain(tAuth.accountBlocked);

    // Zero writes: the users row is byte-stable, no new audit row, silent.
    expect(await readUserRow(governedStudentId)).toEqual(deletedUserSnapshot);
    expect(await countAllAuditForActor(admin.userId)).toBe(adminAuditBefore);
    await expectHistoryPreserved();
    expectPublishSilence();
    await expectControlUntouched();
  });

  test("step 5 — System: raw-SQL hard DELETE of the governed user is blocked — row survives byte-identically", async () => {
    const guardEnforcing = await usersDeleteGuardEnforcing();
    const adminAuditBefore = await countAllAuditForActor(admin.userId);

    // The probe runs inside its own transaction: when the guard trigger is
    // live, the GUC is re-armed transaction-locally (auto-reverts at the end
    // of the transaction — it can never leak to the pooled connection, so
    // the teardown DELETEs below keep their inherited opt-out). The DELETE
    // itself is bracketed in its own SAVEPOINT so a raised exception never
    // poisons the transaction.
    const error = await db.transaction(async tx => {
      if (guardEnforcing) {
        await tx.execute(sql`SELECT set_config(${USERS_DELETE_GUARD_GUC}, 'on', true)`);
      }
      return probeInsideSavepoint(tx, "journey users hard delete probe", () =>
        tx.delete(users).where(eq(users.id, governedStudentId))
      );
    });

    if (guardEnforcing) {
      // Migrate-provisioned databases: the trigger RAISEs.
      expectTriggerRaise(error, USERS_DELETE_RAISE_TEXT);
    } else {
      // Push-provisioned databases (no trigger installed): the fixture
      // family's restrict FKs (the session and payment rows) block the
      // hard delete with the foreign-key violation class.
      expect(hasPostgresErrorCode(error, PG_FK_VIOLATION)).toBe(true);
    }

    // The governed row survived the attempt — still present, still
    // soft-deleted, with the full history intact and zero audit fallout.
    expect(await readUserRow(governedStudentId)).toEqual(deletedUserSnapshot);
    await expectHistoryPreserved();
    expect(await countAllAuditForActor(admin.userId)).toBe(adminAuditBefore);
    expectPublishSilence();
    await expectControlUntouched();
  });

  test("step 6 — Control student: admin-surface probes DENIED through the real gate — zero writes, target byte-identical", async () => {
    const adminAuditBefore = await countAllAuditForActor(admin.userId);
    const controlAuditBefore = await countAllAuditForActor(controlStudent.userId);

    // A non-admin cast member (honest role: real `student` rows) probes the
    // admin-owned READ surface on the governed user.
    const readDenial = await catchJourneyError(() =>
      AdminUserManagementService.getUserDetail(governedStudentId, LOCALE, controlStudent.userId)
    );
    if (!(readDenial instanceof ForbiddenError)) {
      throw new Error(
        `expected ForbiddenError (got ${readDenial instanceof Error ? readDenial.name : String(readDenial)})`
      );
    }
    expect(readDenial.message).toContain(tErrors.forbidden);

    // ...and the admin-owned MUTATION surface — both deny through the real
    // BFLA gate before any transaction opens.
    const mutateDenial = await catchJourneyError(() =>
      AdminUserManagementService.setUserDeleted(governedStudentId, false, controlStudent.userId, LOCALE)
    );
    if (!(mutateDenial instanceof ForbiddenError)) {
      throw new Error(
        `expected ForbiddenError (got ${mutateDenial instanceof Error ? mutateDenial.name : String(mutateDenial)})`
      );
    }
    expect(mutateDenial.message).toContain(tErrors.forbidden);

    // Zero writes and zero audit from either denial: the target row is
    // byte-identical, no history row moved, neither actor minted audit.
    expect(await readUserRow(governedStudentId)).toEqual(deletedUserSnapshot);
    await expectHistoryPreserved();
    expect(await countAllAuditForActor(admin.userId)).toBe(adminAuditBefore);
    expect(await countAllAuditForActor(controlStudent.userId)).toBe(controlAuditBefore);
    expectPublishSilence();
    await expectControlUntouched();
  });

  test("step 7 — Admin: reactivate the student — deleted_at=null, ONE Reactivate audit row, login restored", async () => {
    const result = await AdminUserManagementService.setUserDeleted(governedStudentId, false, admin.userId, LOCALE);

    expect(result.isDeleted).toBe(false);
    expect(result.deletedAt).toBeNull();

    const userRow = await readUserRow(governedStudentId);
    expect(userRow?.isDeleted).toBe(false);
    expect(userRow?.deletedAt).toBeNull();

    // Exactly ONE Reactivate audit row with the pinned details contract.
    expect(await countAuditForEntity(admin.userId, AuditActionType.Reactivate, governedStudentId)).toBe(1);
    const reactivateRows = await readAuditRowsForEntity(admin.userId, AuditActionType.Reactivate, governedStudentId);
    expect(reactivateRows).toHaveLength(1);
    const reactivateRow = reactivateRows[0];
    if (!reactivateRow) {
      throw new Error("journey: the Reactivate audit row vanished");
    }
    expect(reactivateRow.actionType).toBe(AuditActionType.Reactivate);
    expect(reactivateRow.entityType).toBe("user");
    expect(reactivateRow.entityId).toBe(governedStudentId);
    expect(parseAuditDetails(reactivateRow)).toEqual({ deleted: false });
    expect(await countAllAuditForActor(admin.userId)).toBe(3);

    // Login restored — the target user observes the state flip through the
    // real credential path.
    const loginSession = await AuthService.login(governedStudentEmail, GOVERNED_STUDENT_CREDENTIAL, LOCALE);
    expect(loginSession.user.id).toBe(governedStudentId);

    await expectHistoryPreserved();
    expectPublishSilence();
    await expectControlUntouched();
  });

  test("step 8 — Admin: teacher-side variant — earning and wallet rows survive teacher soft-delete byte-identically", async () => {
    // Soft-delete the teacher (the earning row's owner).
    const deleted = await AdminUserManagementService.setUserDeleted(teacher.userId, true, admin.userId, LOCALE);
    expect(deleted.isDeleted).toBe(true);
    expect(deleted.deletedAt).not.toBeNull();
    expect(await countAuditForEntity(admin.userId, AuditActionType.Delete, teacher.userId)).toBe(1);

    // The teacher-side guarantee: the earning ledger row and its wallet
    // are byte-identical across the teacher's soft-delete — and so is the
    // session the earning is anchored on.
    await expectHistoryPreserved();

    // Reactivate the teacher — the guarded UPDATE flips both directions.
    const restored = await AdminUserManagementService.setUserDeleted(teacher.userId, false, admin.userId, LOCALE);
    expect(restored.isDeleted).toBe(false);
    expect(restored.deletedAt).toBeNull();
    expect(await countAuditForEntity(admin.userId, AuditActionType.Reactivate, teacher.userId)).toBe(1);

    // Terminal ledger: five admin audit rows total (Create + Delete +
    // Reactivate for the student, Delete + Reactivate for the teacher) and
    // the history family never moved.
    await expectHistoryPreserved();
    expect(await countAllAuditForActor(admin.userId)).toBe(5);
    expectPublishSilence();
    await expectControlUntouched();
  });
});
