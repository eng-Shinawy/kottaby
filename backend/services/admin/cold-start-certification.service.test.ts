/**
 * ColdStartCertificationService tests — the cold-start certification
 * pipeline (gate → shape → target reads → teacher assembly → finalize →
 * audit → in-tx notification emit → post-commit publish → refreshed
 * detail) against the live PostgreSQL instance.
 *
 * Conventions (matching the sibling admin suites):
 *  - Every case runs inside `runInRollback`; `tx` is passed to the service
 *    call (as `outerTx`) and to every entity-setup / read-back oracle, so
 *    all fixtures and all service work share the rolled-back transaction.
 *  - Entities ONLY via `entity-setup.ts` helpers (`createTestUser`,
 *    `createTestApplicant`); the pre-certification `teacher` row is
 *    inserted by a local `createUncertifiedTeacher` helper (no teacher
 *    fixture exists in entity-setup).
 *  - All rejection assertions use `expectRepoError` (try/catch) —
 *    `expect(...).rejects.toThrow()` is prohibited and appears nowhere.
 *  - Translated-message assertions resolve via `getServerTranslations`
 *    property access — never raw keys, never hardcoded UI copy.
 *  - The publish boundary is SPIED, never delivered: a
 *    `SpiedFanoutTransport` rides the service's options seam so denial
 *    paths can assert ZERO publishes and success paths ONE publish.
 *
 * Coverage map:
 *  - Tier 1 (happy paths): row-absent create for BOTH `makeEvaluator`
 *    values; elevation of an existing unapproved row; applicant finalize
 *    across prior statuses (pending / in_evaluation / failed + active
 *    cooldown cleared); applicant-absent tolerance; exact 3-field audit
 *    details; verbatim en + ar notification copy; refreshed detail return.
 *  - Tier 2 (denials): every closed error-surface entry with its exact
 *    code + localized message, plus zero-write / zero-audit / zero-publish
 *    oracles on EVERY denial.
 *  - Tier 3 (ordering & rollback): multi-problem fixtures resolve in the
 *    mandated order; hostile `userId` fuzz rejects pre-DB; a forced
 *    mid-stage failure leaves zero residue and zero publishes.
 *  - Tier 4 (cross-entity purity): whole-table COUNT snapshots prove a
 *    successful certification moves ONLY the contracted tables
 *    (`teacher`, `applicants`, `audit_logs`, `notifications`) and leaves
 *    every other surface byte-count stable.
 */

import { describe, expect, spyOn, test } from "bun:test";
import { and, eq, sql } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import { ApplicantRepository, TeacherRepository, UserRepository } from "@/backend/db/repo";
import {
  applicants,
  plans,
  session,
  studentPayments,
  studentSubscriptions,
  subscriptions,
  teacherTransaction,
  wallet,
} from "@/backend/db/schema";
import { auditLogs } from "@/backend/db/schema/audit/audit-logs";
import { notifications } from "@/backend/db/schema/notifications/notifications";
import { teacher } from "@/backend/db/schema/teachers/teacher";
import { users } from "@/backend/db/schema/users/users";
import { createTestApplicant, createTestUser } from "@/backend/db/test/entity-setup";
import { expectRepoError, runInRollback } from "@/backend/db/test/test-utils";
import { AuditActionType } from "@/backend/enum/audit/audit-action-type.enum";
import { NotificationType } from "@/backend/enum/notifications/notification-type.enum";
import { ApplicantStatus } from "@/backend/enum/teachers/applicant-status.enum";
import {
  ConflictError,
  DomainError,
  ForbiddenError,
  NotFoundError,
  UnauthorizedError,
  ValidationError,
} from "@/backend/lib/errors";
import { logger } from "@/backend/lib/logger";
import { ColdStartCertificationService } from "@/backend/services/admin/cold-start-certification.service";
import type { DBTransaction, TeacherSelectType } from "@/backend/types";
import { getServerTranslations } from "@/shared/locale/server-graphql";
import { SpiedFanoutTransport } from "@/test/workflows/helpers";

const LOCALE_EN = "en";
const LOCALE_AR = "ar";
const tEn = getServerTranslations(LOCALE_EN);
const tAr = getServerTranslations(LOCALE_AR);

/** Sentinel `actorId` value expressing an anonymous caller. */
const ANONYMOUS_ACTOR_ID = 0;

/** Cooldown comfortably in the future — an ACTIVE cooldown at certify time. */
const FUTURE_COOLDOWN = new Date("2100-01-01T00:00:00.000Z");

/** Domain log spy family share this stubbed signature. */
type DomainLogSpy = ReturnType<typeof spyOn>;

/** Silences `logger.logDomainError` so test stdout stays compact. */
function silenceDomainLog(): DomainLogSpy {
  return spyOn(logger, "logDomainError").mockImplementation(() => {});
}

/** Asserts a caught error is a `DomainError` carrying the expected `code`. */
function assertErrorCode(error: Error, expectedCode: string): void {
  expect(error).toBeInstanceOf(DomainError);
  if (!(error instanceof DomainError)) throw new Error("expected a DomainError instance");
  expect(error.code).toBe(expectedCode);
}

/**
 * Inserts a pre-certification `teacher` row (schema defaults — unapproved,
 * non-evaluator). No teacher fixture exists in `entity-setup.ts`, so this
 * is the suite-local stand-in.
 */
async function createUncertifiedTeacher(tx: DBTransaction, userId: number): Promise<TeacherSelectType> {
  const [row] = await tx.insert(teacher).values({ id: userId }).returning();
  if (!row) {
    throw new Error("createUncertifiedTeacher: insert returned no rows");
  }
  return row;
}

/** Inserts an already-certified `teacher` row for the conflict paths. */
async function createCertifiedTeacher(tx: DBTransaction, userId: number): Promise<TeacherSelectType> {
  const [row] = await tx.insert(teacher).values({ id: userId, isApproved: true, isEvaluator: true }).returning();
  if (!row) {
    throw new Error("createCertifiedTeacher: insert returned no rows");
  }
  return row;
}

/** Returns an integer id guaranteed absent from `users` in this tx. */
async function absentUserId(tx: DBTransaction): Promise<number> {
  const [row] = await tx.select({ maxId: sql<number>`coalesce(max(${users.id}), 0)::int` }).from(users);
  return (row?.maxId ?? 0) + 1_000_000;
}

/** Counts `audit_logs` rows recorded about the certification target. */
async function countTargetAuditRows(tx: DBTransaction, targetId: number): Promise<number> {
  const result = await tx
    .select({ count: sql<number>`count(*)::int` })
    .from(auditLogs)
    .where(and(eq(auditLogs.entityType, "teacher"), eq(auditLogs.entityId, targetId)));
  return result[0]?.count ?? 0;
}

/** Reads back the `notifications` rows for the target recipient. */
async function listTargetNotifications(tx: DBTransaction, targetId: number) {
  return tx.select().from(notifications).where(eq(notifications.userId, targetId));
}

/** Reads back the `teacher` row for the target (independent oracle). */
async function readTeacherRow(tx: DBTransaction, targetId: number): Promise<TeacherSelectType | null> {
  const rows = await tx.select().from(teacher).where(eq(teacher.id, targetId));
  return rows[0] ?? null;
}

/**
 * The zero-side-effect oracle used on EVERY denial path: no audit rows for
 * the target, no notification rows for the recipient, and zero publishes
 * on the spied fan-out transport.
 */
async function expectZeroSideEffects(
  tx: DBTransaction,
  targetId: number,
  transport: SpiedFanoutTransport
): Promise<void> {
  expect(await countTargetAuditRows(tx, targetId)).toBe(0);
  expect(await listTargetNotifications(tx, targetId)).toHaveLength(0);
  expect(transport.publishCount).toBe(0);
}

/** Common call expression — service under test with the spied transport seam. */
async function callService(
  tx: DBTransaction,
  actorId: number,
  userId: number,
  makeEvaluator: boolean,
  transport: SpiedFanoutTransport,
  locale: string = LOCALE_EN
) {
  return ColdStartCertificationService.certifyTeacherColdStart(
    actorId,
    { userId, makeEvaluator },
    locale,
    { transport },
    tx
  );
}

describe("Tier 1 — happy paths", () => {
  test("row-absent create with makeEvaluator=true: certified row, finalized applicant, exact audit JSON, en copy, one publish", async () => {
    await runInRollback(async tx => {
      const admin = await createTestUser(tx, { role: "admin" });
      const target = await createTestUser(tx, { role: "teacher" });
      await createTestApplicant(tx, target.id);
      const transport = new SpiedFanoutTransport();
      const logSpy = silenceDomainLog();
      const callsBefore = logSpy.mock.calls.length;

      const detail = await callService(tx, admin.id, target.id, true, transport);

      // Refreshed detail (REQ-018-shaped): certified snapshot visible.
      expect(detail.id).toBe(target.id);
      expect(detail.teacher?.isApproved).toBe(true);
      expect(detail.teacher?.isEvaluator).toBe(true);
      expect(detail.applicant?.status).toBe(ApplicantStatus.Passed);

      // Row oracle: insert honored the flags + schema defaults.
      const row = await readTeacherRow(tx, target.id);
      expect(row?.isApproved).toBe(true);
      expect(row?.isEvaluator).toBe(true);
      expect(row?.averageRating).toBeNull();
      expect(row?.isOnline).toBe(false);

      // Audit: exactly ONE row, exact 3-field JSON, PII-free.
      const auditRows = await tx
        .select()
        .from(auditLogs)
        .where(and(eq(auditLogs.entityType, "teacher"), eq(auditLogs.entityId, target.id)));
      expect(auditRows).toHaveLength(1);
      expect(auditRows[0]?.actorId).toBe(admin.id);
      expect(auditRows[0]?.actionType).toBe(AuditActionType.Override);
      expect(auditRows[0]?.entityType).toBe("teacher");
      expect(auditRows[0]?.entityId).toBe(target.id);
      expect(auditRows[0]?.details).toBe(
        JSON.stringify({ makeEvaluator: true, applicantRow: "finalized", elevation: "created" })
      );

      // Notification: exactly ONE in-tx row carrying the verbatim en copy.
      const note = await listTargetNotifications(tx, target.id);
      expect(note).toHaveLength(1);
      expect(note[0]?.type).toBe(NotificationType.EvaluationResult);
      expect(note[0]?.title).toBe(tEn.applicantTranslations.coldStartCertifiedTitle);
      expect(note[0]?.body).toBe(tEn.applicantTranslations.coldStartCertifiedBody);
      expect(note[0]?.relatedEntityType).toBe("teacher");
      expect(note[0]?.relatedEntityId).toBe(target.id);

      // Publish-after-commit: exactly ONE envelope, addressed to the target.
      expect(transport.publishCount).toBe(1);
      expect(transport.calls[0]?.userIds).toEqual([target.id]);

      // Silent happy path: ZERO domain logs emitted by the certification.
      expect(logSpy.mock.calls).toHaveLength(callsBefore);
      logSpy.mockRestore();
    });
  });

  test("row-absent create with makeEvaluator=false certifies WITHOUT evaluator capability", async () => {
    await runInRollback(async tx => {
      const admin = await createTestUser(tx, { role: "admin" });
      const target = await createTestUser(tx, { role: "teacher" });
      const transport = new SpiedFanoutTransport();
      silenceDomainLog();

      const detail = await callService(tx, admin.id, target.id, false, transport);

      expect(detail.teacher?.isApproved).toBe(true);
      expect(detail.teacher?.isEvaluator).toBe(false);

      const row = await readTeacherRow(tx, target.id);
      expect(row?.isApproved).toBe(true);
      expect(row?.isEvaluator).toBe(false);

      // Applicant row absent → tolerated, recorded as "absent".
      const auditRows = await tx
        .select()
        .from(auditLogs)
        .where(and(eq(auditLogs.entityType, "teacher"), eq(auditLogs.entityId, target.id)));
      expect(auditRows).toHaveLength(1);
      expect(auditRows[0]?.details).toBe(
        JSON.stringify({ makeEvaluator: false, applicantRow: "absent", elevation: "created" })
      );
      expect(detail.applicant).toBeNull();
      expect(transport.publishCount).toBe(1);
    });
  });

  test("elevation of an unapproved row: guarded UPDATE flips flags, audit records elevation", async () => {
    await runInRollback(async tx => {
      const admin = await createTestUser(tx, { role: "admin" });
      const target = await createTestUser(tx, { role: "teacher" });
      await createUncertifiedTeacher(tx, target.id);
      const transport = new SpiedFanoutTransport();
      silenceDomainLog();

      const detail = await callService(tx, admin.id, target.id, true, transport);

      expect(detail.teacher?.isApproved).toBe(true);
      expect(detail.teacher?.isEvaluator).toBe(true);

      const auditRows = await tx
        .select()
        .from(auditLogs)
        .where(and(eq(auditLogs.entityType, "teacher"), eq(auditLogs.entityId, target.id)));
      expect(auditRows).toHaveLength(1);
      expect(auditRows[0]?.details).toBe(
        JSON.stringify({ makeEvaluator: true, applicantRow: "absent", elevation: "elevated" })
      );
      expect(transport.publishCount).toBe(1);
    });
  });

  test("finalize supersedes an in_evaluation applicant", async () => {
    await runInRollback(async tx => {
      const admin = await createTestUser(tx, { role: "admin" });
      const target = await createTestUser(tx, { role: "teacher" });
      await createTestApplicant(tx, target.id, { status: ApplicantStatus.InEvaluation });
      const transport = new SpiedFanoutTransport();
      silenceDomainLog();

      const detail = await callService(tx, admin.id, target.id, true, transport);

      expect(detail.applicant?.status).toBe(ApplicantStatus.Passed);
    });
  });

  test("finalize clears an ACTIVE future cooldown on a failed applicant in the same transaction", async () => {
    await runInRollback(async tx => {
      const admin = await createTestUser(tx, { role: "admin" });
      const target = await createTestUser(tx, { role: "teacher" });
      await createTestApplicant(tx, target.id, {
        status: ApplicantStatus.Failed,
        cooldownUntil: FUTURE_COOLDOWN,
      });
      const transport = new SpiedFanoutTransport();
      silenceDomainLog();

      const detail = await callService(tx, admin.id, target.id, true, transport);

      expect(detail.applicant?.status).toBe(ApplicantStatus.Passed);
      expect(detail.applicant?.cooldownUntil).toBeNull();
    });
  });

  test("ar locale: notification copy is stored verbatim from the ar applicant namespace", async () => {
    await runInRollback(async tx => {
      const admin = await createTestUser(tx, { role: "admin" });
      const target = await createTestUser(tx, { role: "teacher" });
      const transport = new SpiedFanoutTransport();
      silenceDomainLog();

      await callService(tx, admin.id, target.id, true, transport, LOCALE_AR);

      const note = await listTargetNotifications(tx, target.id);
      expect(note).toHaveLength(1);
      expect(note[0]?.title).toBe(tAr.applicantTranslations.coldStartCertifiedTitle);
      expect(note[0]?.body).toBe(tAr.applicantTranslations.coldStartCertifiedBody);
    });
  });
});

describe("Tier 2 — denial matrix (exact codes + zero-side-effect oracles)", () => {
  test("anonymous actor (id=0) → UNAUTHORIZED, zero side effects", async () => {
    await runInRollback(async tx => {
      const target = await createTestUser(tx, { role: "teacher" });
      const transport = new SpiedFanoutTransport();
      silenceDomainLog();

      const error = await expectRepoError(() => callService(tx, ANONYMOUS_ACTOR_ID, target.id, true, transport));
      expect(error).toBeInstanceOf(UnauthorizedError);
      assertErrorCode(error, "UNAUTHORIZED");
      expect(error.message).toContain(tEn.errorsTranslations.unauthorized);
      await expectZeroSideEffects(tx, target.id, transport);
      expect(await readTeacherRow(tx, target.id)).toBeNull();
    });
  });

  test("non-admin actor → FORBIDDEN, zero side effects", async () => {
    await runInRollback(async tx => {
      const actor = await createTestUser(tx, { role: "student" });
      const target = await createTestUser(tx, { role: "teacher" });
      const transport = new SpiedFanoutTransport();
      silenceDomainLog();

      const error = await expectRepoError(() => callService(tx, actor.id, target.id, true, transport));
      expect(error).toBeInstanceOf(ForbiddenError);
      assertErrorCode(error, "FORBIDDEN");
      expect(error.message).toContain(tEn.errorsTranslations.forbidden);
      await expectZeroSideEffects(tx, target.id, transport);
      expect(await readTeacherRow(tx, target.id)).toBeNull();
    });
  });

  test("governed admin actor (suspended) → FORBIDDEN with the suspended deny", async () => {
    await runInRollback(async tx => {
      const actor = await createTestUser(tx, { role: "admin", suspended: true });
      const target = await createTestUser(tx, { role: "teacher" });
      const transport = new SpiedFanoutTransport();
      silenceDomainLog();

      const error = await expectRepoError(() => callService(tx, actor.id, target.id, true, transport));
      expect(error).toBeInstanceOf(ForbiddenError);
      assertErrorCode(error, "FORBIDDEN");
      expect(error.message).toContain(tEn.errorsTranslations.accountSuspended);
      await expectZeroSideEffects(tx, target.id, transport);
    });
  });

  const FUZZ_VALUES: ReadonlyArray<[name: string, value: number]> = [
    ["zero", 0],
    ["negative", -1],
    ["fractional", 1.5],
    ["NaN", Number.NaN],
    ["beyond MAX_SAFE_INTEGER", 2 ** 53],
  ];
  for (const [name, value] of FUZZ_VALUES) {
    test(`userId fuzz (${name}) → VALIDATION pre-DB, zero side effects`, async () => {
      await runInRollback(async tx => {
        const admin = await createTestUser(tx, { role: "admin" });
        const transport = new SpiedFanoutTransport();
        silenceDomainLog();

        const error = await expectRepoError(() => callService(tx, admin.id, value, true, transport));
        expect(error).toBeInstanceOf(ValidationError);
        assertErrorCode(error, "VALIDATION");
        expect(error.message).toContain(tEn.errorsTranslations.validation);
      });
    });
  }

  test("absent target → USER_NOT_FOUND, zero side effects", async () => {
    await runInRollback(async tx => {
      const admin = await createTestUser(tx, { role: "admin" });
      const ghostId = await absentUserId(tx);
      const transport = new SpiedFanoutTransport();
      silenceDomainLog();

      const error = await expectRepoError(() => callService(tx, admin.id, ghostId, true, transport));
      expect(error).toBeInstanceOf(NotFoundError);
      assertErrorCode(error, "USER_NOT_FOUND");
      expect(error.message).toContain(tEn.errorsTranslations.adminUsers.userNotFound);
      await expectZeroSideEffects(tx, ghostId, transport);
    });
  });

  test("non-teacher target (student) → TEACHER_ROLE_REQUIRED, zero side effects", async () => {
    await runInRollback(async tx => {
      const admin = await createTestUser(tx, { role: "admin" });
      const target = await createTestUser(tx, { role: "student" });
      const transport = new SpiedFanoutTransport();
      silenceDomainLog();

      const error = await expectRepoError(() => callService(tx, admin.id, target.id, true, transport));
      expect(error).toBeInstanceOf(ConflictError);
      assertErrorCode(error, "TEACHER_ROLE_REQUIRED");
      expect(error.message).toContain(tEn.errorsTranslations.teacherRoleRequired);
      await expectZeroSideEffects(tx, target.id, transport);
    });
  });

  test("governed teacher target (blocked) → TEACHER_ACCOUNT_GOVERNED, zero side effects", async () => {
    await runInRollback(async tx => {
      const admin = await createTestUser(tx, { role: "admin" });
      const target = await createTestUser(tx, { role: "teacher", isBlocked: true });
      const transport = new SpiedFanoutTransport();
      silenceDomainLog();

      const error = await expectRepoError(() => callService(tx, admin.id, target.id, true, transport));
      expect(error).toBeInstanceOf(ConflictError);
      assertErrorCode(error, "TEACHER_ACCOUNT_GOVERNED");
      expect(error.message).toContain(tEn.errorsTranslations.teacherAccountGoverned);
      await expectZeroSideEffects(tx, target.id, transport);
      expect(await readTeacherRow(tx, target.id)).toBeNull();
    });
  });

  test("already-certified target (approved row present) → TEACHER_ALREADY_CERTIFIED, zero new writes", async () => {
    await runInRollback(async tx => {
      const admin = await createTestUser(tx, { role: "admin" });
      const target = await createTestUser(tx, { role: "teacher" });
      await createCertifiedTeacher(tx, target.id);
      const transport = new SpiedFanoutTransport();
      silenceDomainLog();

      const error = await expectRepoError(() => callService(tx, admin.id, target.id, true, transport));
      expect(error).toBeInstanceOf(ConflictError);
      assertErrorCode(error, "TEACHER_ALREADY_CERTIFIED");
      expect(error.message).toContain(tEn.errorsTranslations.teacherAlreadyCertified);
      await expectZeroSideEffects(tx, target.id, transport);
    });
  });

  test("insert-path 23505 (concurrent certifier) → TEACHER_ALREADY_CERTIFIED via cause-chain", async () => {
    await runInRollback(async tx => {
      const admin = await createTestUser(tx, { role: "admin" });
      const target = await createTestUser(tx, { role: "teacher" });
      const transport = new SpiedFanoutTransport();
      silenceDomainLog();
      // Simulate a concurrent certifier winning the insert: the repo write
      // throws a raw driver error whose cause chain carries code 23505.
      const insertSpy = spyOn(TeacherRepository, "insertColdStartCertified").mockImplementation(() => {
        const driverError = Object.assign(new Error("duplicate key value violates unique constraint"), {
          code: "23505",
        });
        return Promise.reject(driverError);
      });

      const error = await expectRepoError(() => callService(tx, admin.id, target.id, true, transport));
      insertSpy.mockRestore();
      expect(error).toBeInstanceOf(ConflictError);
      assertErrorCode(error, "TEACHER_ALREADY_CERTIFIED");
      expect(error.message).toContain(tEn.errorsTranslations.teacherAlreadyCertified);
      await expectZeroSideEffects(tx, target.id, transport);
    });
  });

  test("insert-path non-unique failure RETHROWS untouched (no conflict transformation)", async () => {
    await runInRollback(async tx => {
      const admin = await createTestUser(tx, { role: "admin" });
      const target = await createTestUser(tx, { role: "teacher" });
      const transport = new SpiedFanoutTransport();
      silenceDomainLog();
      const insertSpy = spyOn(TeacherRepository, "insertColdStartCertified").mockImplementation(() =>
        Promise.reject(new Error("connection blown mid-statement"))
      );

      const error = await expectRepoError(() => callService(tx, admin.id, target.id, true, transport));
      insertSpy.mockRestore();
      expect(error).not.toBeInstanceOf(ConflictError);
      expect(error).not.toBeInstanceOf(DomainError);
      expect(error.message).toContain("connection blown mid-statement");
      await expectZeroSideEffects(tx, target.id, transport);
    });
  });

  test("each denial emits exactly ONE bounded domain log (localized exists path)", async () => {
    await runInRollback(async tx => {
      const admin = await createTestUser(tx, { role: "admin" });
      const target = await createTestUser(tx, { role: "teacher", isBlocked: true });
      const transport = new SpiedFanoutTransport();
      const logSpy = silenceDomainLog();
      const callsBefore = logSpy.mock.calls.length;

      await expectRepoError(() => callService(tx, admin.id, target.id, true, transport));

      expect(logSpy.mock.calls).toHaveLength(callsBefore + 1);
      const context = logSpy.mock.calls.at(-1)?.[1];
      expect(context?.code).toBe("TEACHER_ACCOUNT_GOVERNED");
      expect(context?.entity).toBe("user");
      expect(context?.entityId).toBe(target.id);
      expect(context?.locale).toBe(LOCALE_EN);
      // PII hygiene: the context carries ids/code/locale only.
      expect(new Set(Object.keys(context ?? {}))).toEqual(new Set(["code", "entity", "entityId", "locale"]));
      logSpy.mockRestore();
    });
  });
});

describe("Tier 3 — deterministic denial ordering & rollback integrity", () => {
  test("actor role beats input shape: non-admin actor + invalid userId → FORBIDDEN", async () => {
    await runInRollback(async tx => {
      const actor = await createTestUser(tx, { role: "student" });
      const transport = new SpiedFanoutTransport();
      silenceDomainLog();

      const error = await expectRepoError(() => callService(tx, actor.id, 0, true, transport));
      expect(error).toBeInstanceOf(ForbiddenError);
      assertErrorCode(error, "FORBIDDEN");
    });
  });

  test("actor governance beats input shape: suspended admin + invalid userId → FORBIDDEN", async () => {
    await runInRollback(async tx => {
      const actor = await createTestUser(tx, { role: "admin", suspended: true });
      const transport = new SpiedFanoutTransport();
      silenceDomainLog();

      const error = await expectRepoError(() => callService(tx, actor.id, -1, true, transport));
      expect(error).toBeInstanceOf(ForbiddenError);
      expect(error.message).toContain(tEn.errorsTranslations.accountSuspended);
    });
  });

  test("shape beats target existence: invalid userId never reaches a target read", async () => {
    await runInRollback(async tx => {
      const admin = await createTestUser(tx, { role: "admin" });
      const transport = new SpiedFanoutTransport();
      silenceDomainLog();
      const invalidId = 1.5;
      const findSpy = spyOn(UserRepository, "findById");

      const error = await expectRepoError(() => callService(tx, admin.id, invalidId, true, transport));
      expect(error).toBeInstanceOf(ValidationError);
      assertErrorCode(error, "VALIDATION");
      // The gate's actor read is fine; NO read must ever probe the invalid id.
      for (const call of findSpy.mock.calls) {
        expect(call[0]).not.toBe(invalidId);
      }
      findSpy.mockRestore();
    });
  });

  test("target role beats target governance: deleted student → TEACHER_ROLE_REQUIRED", async () => {
    await runInRollback(async tx => {
      const admin = await createTestUser(tx, { role: "admin" });
      const target = await createTestUser(tx, { role: "student", isDeleted: true });
      const transport = new SpiedFanoutTransport();
      silenceDomainLog();

      const error = await expectRepoError(() => callService(tx, admin.id, target.id, true, transport));
      expect(error).toBeInstanceOf(ConflictError);
      assertErrorCode(error, "TEACHER_ROLE_REQUIRED");
      await expectZeroSideEffects(tx, target.id, transport);
    });
  });

  test("target governance beats already-certified: suspended teacher with approved row → TEACHER_ACCOUNT_GOVERNED", async () => {
    await runInRollback(async tx => {
      const admin = await createTestUser(tx, { role: "admin" });
      const target = await createTestUser(tx, { role: "teacher", suspended: true });
      await createCertifiedTeacher(tx, target.id);
      const transport = new SpiedFanoutTransport();
      silenceDomainLog();

      const error = await expectRepoError(() => callService(tx, admin.id, target.id, true, transport));
      expect(error).toBeInstanceOf(ConflictError);
      assertErrorCode(error, "TEACHER_ACCOUNT_GOVERNED");
      await expectZeroSideEffects(tx, target.id, transport);
    });
  });

  test("forced mid-stage failure (finalize) leaves zero residue across all four tables and zero publishes", async () => {
    await runInRollback(async tx => {
      const admin = await createTestUser(tx, { role: "admin" });
      const target = await createTestUser(tx, { role: "teacher" });
      await createTestApplicant(tx, target.id);
      const transport = new SpiedFanoutTransport();
      silenceDomainLog();
      const finalizeSpy = spyOn(ApplicantRepository, "finalizeOnCertification").mockImplementation(() =>
        Promise.reject(new Error("forced finalize failure"))
      );

      const error = await expectRepoError(() => callService(tx, admin.id, target.id, true, transport));
      finalizeSpy.mockRestore();
      expect(error.message).toContain("forced finalize failure");

      // The transaction aborted: no certified row, no audit, no notification.
      expect(await readTeacherRow(tx, target.id)).toBeNull();
      await expectZeroSideEffects(tx, target.id, transport);
    });
  });
});

// ─── Tier 4: cross-entity purity oracle ─────────────────────────────────────

/** Counts ALL rows of a table inside the test transaction. */
async function countRows(tx: DBTransaction, table: PgTable): Promise<number> {
  const result = await tx.select({ count: sql<number>`count(*)::int` }).from(table);
  return result[0]?.count ?? 0;
}

/**
 * Whole-table count snapshot of every surface the certification flow must
 * NEVER write to. Fixtures are created BEFORE the first snapshot, so any
 * delta observed across the service call is attributable to the service.
 */
async function snapshotUntouchedCounts(tx: DBTransaction): Promise<Record<string, number>> {
  const tables: ReadonlyArray<readonly [name: string, table: PgTable]> = [
    ["users", users],
    ["wallet", wallet],
    ["subscriptions", subscriptions],
    ["plans", plans],
    ["session", session],
    ["teacher_transaction", teacherTransaction],
    ["student_payments", studentPayments],
    ["student_subscriptions", studentSubscriptions],
  ];
  const entries = await Promise.all(tables.map(async ([name, table]) => [name, await countRows(tx, table)] as const));
  return Object.fromEntries(entries);
}

describe("Tier 4 — cross-entity purity oracle", () => {
  test("a successful certification moves ONLY the contracted tables; all others are count-stable", async () => {
    await runInRollback(async tx => {
      // Repeatable read ensures table-wide count snapshots are isolated from
      // concurrent transactions run by parallel test suites.
      await tx.execute(sql`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ`);
      const admin = await createTestUser(tx, { role: "admin" });
      const target = await createTestUser(tx, { role: "teacher" });
      // An in-flight application so the finalize stage has real work: the
      // mover assertion then proves `applicants` changed by UPDATE alone.
      await createTestApplicant(tx, target.id, { status: ApplicantStatus.InEvaluation });
      const transport = new SpiedFanoutTransport();
      silenceDomainLog();

      const untouchedBefore = await snapshotUntouchedCounts(tx);
      const moversBefore = {
        teacher: await countRows(tx, teacher),
        applicants: await countRows(tx, applicants),
        auditLogs: await countRows(tx, auditLogs),
        notifications: await countRows(tx, notifications),
      };
      const applicantBefore = (await tx.select().from(applicants).where(eq(applicants.id, target.id)))[0];
      expect(applicantBefore?.status).toBe(ApplicantStatus.InEvaluation);

      const detail = await callService(tx, admin.id, target.id, true, transport);
      expect(detail.teacher?.isApproved).toBe(true);

      // Every untouched surface is whole-table count-stable — zero reads
      // through the pipeline may have become writes anywhere else.
      expect(await snapshotUntouchedCounts(tx)).toEqual(untouchedBefore);

      // Contracted movers, exact deltas:
      //  - teacher: one certified row inserted (+1).
      expect(await countRows(tx, teacher)).toBe(moversBefore.teacher + 1);
      //  - audit_logs: exactly one certification audit row (+1).
      expect(await countRows(tx, auditLogs)).toBe(moversBefore.auditLogs + 1);
      //  - notifications: exactly one in-tx notification row (+1).
      expect(await countRows(tx, notifications)).toBe(moversBefore.notifications + 1);
      //  - applicants: moves by in-place UPDATE only — the row count is
      //    stable while the status flips to Passed.
      expect(await countRows(tx, applicants)).toBe(moversBefore.applicants);
      const applicantAfter = (await tx.select().from(applicants).where(eq(applicants.id, target.id)))[0];
      expect(applicantAfter?.status).toBe(ApplicantStatus.Passed);
    });
  });
});
