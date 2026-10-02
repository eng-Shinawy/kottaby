/**
 * TeacherReEvaluationService tests — the admin-ordered paid re-evaluation
 * (wallet fee debit + de-certification + loop re-entry + audit row) against
 * the live `kottaby_test` PostgreSQL instance on REAL repositories.
 *
 * Per `backend/db/test/AGENTS.md` + the sibling service-suite conventions:
 *  - Every transactional case runs inside `runInRollback`; the rollback tx is
 *    handed to the service as its outer transaction (the flow executes on a
 *    SAVEPOINT of the caller's transaction, so a denial leaves the outer tx
 *    usable for the zero-committed-rows assertions).
 *  - The concurrency tier uses COMMITTED fixtures (independent top-level
 *    transactions — genuine row-lock serialization on separate connections)
 *    with hard deletes in `afterAll`; the append-only `teacher_transaction`
 *    and `audit_logs` rows are deleted under the sanctioned immutability-
 *    trigger suspension (`test/helpers/db-cleanup.ts`).
 *  - Entities are created ONLY via `entity-setup.ts` helpers — never seed
 *    data.
 *  - NO `expect(...).rejects.toThrow()` — every denial goes through the
 *    `expectRepoError` try/catch; typed denials are asserted through the
 *    `DomainError.code` contract plus the exact translated message.
 *  - No external channel is touched by this flow (the order emits no
 *    notification dispatch — that surface is a separate deferred ticket), so
 *    no channel mock exists; the logger IS spied to pin the bounded
 *    denial-log contract, and the notification/engine seams are simply never
 *    reached.
 *
 * Coverage map (the four-tier contract):
 *  - Tier 1 (branch/statement): the happy order (fee verbatim, currency,
 *    decremented balance, UNTOUCHED `total_earning`, exactly ONE
 *    withdrawal/completed ledger row with `session_id NULL`, teacher
 *    de-certified, applicant `in_evaluation` with a fresh anchor, exactly
 *    ONE audit row with the param-sourced actor, ZERO domain logs) plus the
 *    full denial matrix (`UNAUTHORIZED`, `VALIDATION`, `TEACHER_NOT_FOUND`,
 *    `TEACHER_NOT_CERTIFIED`, `APPLICANT_NOT_AWAITING_RE_EVALUATION`,
 *    `WALLET_INSUFFICIENT_FUNDS`, `FORBIDDEN`) with zero committed rows on
 *    every denial.
 *  - Tier 2 (boundary): reason length edges (empty / whitespace-only / 229
 *    ok / 230 reject with the over-limit leaf), the unicode + RTL reason
 *    carried verbatim into the ledger description, and the wallet-less
 *    certified teacher (an honest zeroed wallet is ensured before the debit
 *    is attempted).
 *  - Tier 3 (concurrency): two concurrent orders on INDEPENDENT
 *    transactions over committed fixtures — the guarded state flips
 *    arbitrate, exactly one charge lands, and the loser's executed debit
 *    rolls back with its transaction (real-Postgres gated).
 *  - Tier 4 (security/abuse): non-admin and governed-admin actors are
 *    denied with zero rows; LIKE-wildcard characters in the reason are
 *    stored literally (parameterized SQL — no interpolation); the acting
 *    admin id is taken exclusively from the parameter (an impostor field on
 *    the input object cannot forge the audit actor); static source pins
 *    (single `withTransaction`, no forked ledger vocabulary, no
 *    plan-artifact text in comments).
 */

import { afterAll, beforeAll, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/backend/db";
import { WalletRepository } from "@/backend/db/repo";
import { auditLogs } from "@/backend/db/schema/audit/audit-logs";
import { teacherTransaction } from "@/backend/db/schema/billing/teacher-transaction";
import { wallet } from "@/backend/db/schema/billing/wallet";
import { applicants } from "@/backend/db/schema/teachers/applicants";
import { teacher } from "@/backend/db/schema/teachers/teacher";
import { users } from "@/backend/db/schema/users/users";
import {
  createTestApplicant,
  createTestTeacherRow,
  createTestUser,
  createTestWallet,
} from "@/backend/db/test/entity-setup";
import { expectRepoError, runInRollback } from "@/backend/db/test/test-utils";
import { AuditActionType } from "@/backend/enum/audit/audit-action-type.enum";
import { TransactionStatus } from "@/backend/enum/billing/transaction-status.enum";
import { TransactionType } from "@/backend/enum/billing/transaction-type.enum";
import { ApplicantStatus } from "@/backend/enum/teachers/applicant-status.enum";
import { ConflictError, DomainError, ForbiddenError, UnauthorizedError } from "@/backend/lib/errors";
import { logger } from "@/backend/lib/logger";
import { TeacherReEvaluationService } from "@/backend/services/teachers/teacher-re-evaluation.service";
import { composeReEvaluationDescription } from "@/backend/services/teachers/teacher-re-evaluation.service.helpers";
import type { DBTransaction, TeacherReEvaluationOrderReturnType, WalletSelectType } from "@/backend/types";
import { RE_EVALUATION_FEE, RE_EVALUATION_FEE_CURRENCY } from "@/shared/constants/re-evaluation.constants";
import { getServerTranslations } from "@/shared/locale/server-graphql";
import { withImmutabilityTriggersSuspended } from "@/test/helpers/db-cleanup";
import { isPgliteProvider } from "@/test/helpers/skip-when-pglite";

const testOnRealPostgres = isPgliteProvider() ? test.skip : test;

/** The tests run on the default locale throughout. */
const LOCALE = "en";

/** A representative in-bounds order reason. */
const VALID_REASON = "Rubric drift repeated across two cohorts";

/** An actor id far outside every sequence's range yet inside the safe-integer guard. */
const ABSENT_USER_ID = 2_000_000_000;

// ─── Assertion helpers (sibling-suite conventions) ───────────────────────

/** The errors-namespace translations for the default test locale. */
function t() {
  return getServerTranslations(LOCALE).errorsTranslations;
}

/** Type-guard read of a caught rejection's `extensions.code` contract. */
function rejectionCode(error: unknown): string {
  return error instanceof DomainError ? error.code : "";
}

/**
 * Asserts a caught error is a `DomainError` carrying EXACTLY the expected
 * `extensions.code` and the exact translated message (never the raw
 * translation key, never the code echoed into the copy).
 */
function expectDomainDenial(error: Error, code: string, message: string): void {
  expect(error).toBeInstanceOf(DomainError);
  expect(rejectionCode(error)).toBe(code);
  expect(error.message).toBe(message);
  expect(error.message).not.toContain(code);
}

// ─── Log-spy machinery (the bounded denial-log contract) ─────────────────

/** The ONLY context keys a bounded denial log may carry. */
const BOUNDED_LOG_CONTEXT_KEYS: ReadonlySet<string> = new Set(["code", "entity", "entityId"]);

/** One recorded `logDomainError` call (message + context). */
interface RecordedLogCall {
  readonly message: string;
  readonly ctx: unknown;
}

/** Log-spy box: ONE passthrough spy installed per describe block. */
const logSpyBox: { spy?: ReturnType<typeof installLogSpy> } = {};

function installLogSpy() {
  return spyOn(logger, "logDomainError");
}

/** The installed log spy (setup-integrity failure if absent). */
function requireLogSpy() {
  if (!logSpyBox.spy) {
    throw new Error("log spy not installed (fixture integrity failure)");
  }
  return logSpyBox.spy;
}

/** The log calls recorded in the current test's window. */
function logCalls(): readonly RecordedLogCall[] {
  return requireLogSpy().mock.calls.map(args => ({ message: args[0], ctx: args[1] }));
}

/** Runtime guard for a recorded log-context object (no narrowing casts). */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Asserts every recorded call context carries ONLY bounded keys. */
function expectBoundedContextKeys(ctx: Record<string, unknown>): void {
  for (const key of Object.keys(ctx)) {
    expect(BOUNDED_LOG_CONTEXT_KEYS.has(key)).toBe(true);
  }
}

/**
 * Asserts EXACTLY ONE denial log fired in the current window, carrying the
 * expected code inside a BOUNDED context (no payload, no PII, no extra
 * keys) and the given entity id when supplied.
 */
function expectSingleBoundedDenialLog(code: string, entityId?: number): void {
  const calls = logCalls();
  expect(calls).toHaveLength(1);
  const ctx = calls[0]?.ctx;
  expect(isRecord(ctx)).toBe(true);
  if (isRecord(ctx)) {
    expect(ctx.code).toBe(code);
    if (entityId !== undefined) {
      expect(ctx.entityId).toBe(entityId);
    }
    expectBoundedContextKeys(ctx);
  }
}

/** Asserts the current window recorded ZERO log calls (silent success). */
function expectZeroLogCalls(): void {
  expect(logCalls()).toHaveLength(0);
}

// ─── File-local fixtures (mirror the sibling-suite helpers) ──────────────

/** The subject side of one order: the teacher user id plus its wallet (when created). */
interface SubjectFixtures {
  readonly teacherUserId: number;
  readonly walletId: number | null;
}

/** Option bag for the subject fixture builder (all legs optional). */
interface SubjectOptions {
  /** Wallet overrides — presence of the key provisions a wallet row. */
  readonly wallet?: Partial<WalletSelectType>;
  /** Applicant status (default `passed` — the back-orderable pre-state). */
  readonly applicantStatus?: ApplicantStatus;
  /** Whether an `applicants` row exists at all (default true). */
  readonly withApplicant?: boolean;
  /** Teacher certification flag (default true). */
  readonly teacherApproved?: boolean;
}

/** A governance-clean admin actor (the order's authority). */
async function createGovernanceAdmin(tx: DBTransaction): Promise<number> {
  const admin = await createTestUser(tx, { role: "admin" });
  return admin.id;
}

/**
 * One re-evaluation subject: a teacher-role user with a teacher row plus an
 * `applicants` row and (optionally) a funded wallet. Defaults model the
 * exactly-orderable pre-state: certified teacher, `passed` applicant.
 */
async function createReEvaluationSubject(tx: DBTransaction, options: SubjectOptions = {}): Promise<SubjectFixtures> {
  const user = await createTestUser(tx, { role: "teacher" });
  await createTestTeacherRow(tx, user.id, { isApproved: options.teacherApproved ?? true });
  if (options.withApplicant !== false) {
    await createTestApplicant(tx, user.id, { status: options.applicantStatus ?? ApplicantStatus.Passed });
  }
  if (options.wallet) {
    const created = await createTestWallet(tx, user.id, { balance: "0.00", totalEarning: "0.00", ...options.wallet });
    return { teacherUserId: user.id, walletId: created.id };
  }
  return { teacherUserId: user.id, walletId: null };
}

/** The service's order call, pinned to the test transaction + locale. */
function order(
  tx: DBTransaction,
  actorUserId: number,
  teacherId: number,
  reason: string
): Promise<TeacherReEvaluationOrderReturnType> {
  return TeacherReEvaluationService.orderReEvaluation(actorUserId, { teacherId, reason }, LOCALE, tx);
}

/** A funded subject + admin pair, ready for a happy order. */
async function createFundedSubject(tx: DBTransaction): Promise<{ adminId: number; subject: SubjectFixtures }> {
  const adminId = await createGovernanceAdmin(tx);
  const subject = await createReEvaluationSubject(tx, { wallet: { balance: "500.00", totalEarning: "500.00" } });
  return { adminId, subject };
}

// ─── Read-back oracles (direct Drizzle, NOT via the service) ─────────────

async function readTeacherRow(tx: DBTransaction, teacherUserId: number) {
  const [row] = await tx.select().from(teacher).where(eq(teacher.id, teacherUserId));
  return row ?? null;
}

async function readApplicantRow(tx: DBTransaction, teacherUserId: number) {
  const [row] = await tx.select().from(applicants).where(eq(applicants.id, teacherUserId));
  return row ?? null;
}

async function readWalletRow(tx: DBTransaction, teacherUserId: number) {
  const [row] = await tx.select().from(wallet).where(eq(wallet.teacherId, teacherUserId));
  return row ?? null;
}

async function ledgerRowsForWallet(tx: DBTransaction, walletId: number) {
  return tx.select().from(teacherTransaction).where(eq(teacherTransaction.walletId, walletId));
}

async function auditRowsForTeacher(tx: DBTransaction, teacherUserId: number) {
  return tx
    .select()
    .from(auditLogs)
    .where(and(eq(auditLogs.entityType, "teacher"), eq(auditLogs.entityId, teacherUserId)));
}

/** The pre-state a zero-committed-rows oracle re-asserts (fixture-shaped). */
interface SubjectPreState {
  readonly teacherApproved: boolean;
  /** The expected applicant status — `null` when no applicant row exists. */
  readonly applicantStatus: ApplicantStatus | null;
}

/** The default (funded, orderable) pre-state. */
const ORDERABLE_PRE_STATE: SubjectPreState = { teacherApproved: true, applicantStatus: ApplicantStatus.Passed };

/**
 * The zero-committed-rows oracle: the subject's pre-state is untouched
 * (certification flag, applicant status + NULL anchor) and NO ledger row and
 * NO audit row exist for the subject.
 */
async function expectZeroOrderRows(
  tx: DBTransaction,
  subject: SubjectFixtures,
  preState: SubjectPreState = ORDERABLE_PRE_STATE
): Promise<void> {
  expect((await readTeacherRow(tx, subject.teacherUserId))?.isApproved).toBe(preState.teacherApproved);
  const applicantRow = await readApplicantRow(tx, subject.teacherUserId);
  if (preState.applicantStatus === null) {
    expect(applicantRow).toBeNull();
  } else {
    expect(applicantRow?.status).toBe(preState.applicantStatus);
    expect(applicantRow?.reEvaluationStartedAt ?? null).toBeNull();
  }
  if (subject.walletId !== null) {
    expect(await ledgerRowsForWallet(tx, subject.walletId)).toHaveLength(0);
  }
  expect(await auditRowsForTeacher(tx, subject.teacherUserId)).toHaveLength(0);
}

// ─── Transactional order pipeline (runInRollback) ─────────────────────────

describe("TeacherReEvaluationService — the order pipeline (runInRollback)", () => {
  beforeAll(() => {
    logSpyBox.spy = installLogSpy();
  });

  beforeEach(() => {
    logSpyBox.spy?.mockClear();
  });

  afterAll(() => {
    logSpyBox.spy?.mockRestore();
  });

  // ─── Tier 1: branch/statement ────────────────────────────────────────

  test("happy order: fee verbatim, balance decremented, total_earning UNTOUCHED, one withdrawal/completed ledger row, de-certified, re-opened, ONE audit row, silent success", async () => {
    await runInRollback(async tx => {
      const { adminId, subject } = await createFundedSubject(tx);
      expect(subject.walletId).not.toBeNull();
      if (subject.walletId === null) throw new Error("funded subject must carry a wallet");

      const result = await order(tx, adminId, subject.teacherUserId, VALID_REASON);

      // Return shape — money carried as verbatim decimal strings.
      expect(result.teacherId).toBe(subject.teacherUserId);
      expect(result.amountCharged).toBe(RE_EVALUATION_FEE);
      expect(typeof result.amountCharged).toBe("string");
      expect(result.currency).toBe(RE_EVALUATION_FEE_CURRENCY);
      expect(result.walletBalance).toBe("400.00");
      expect(result.reEvaluationStartedAt).toBeInstanceOf(Date);

      // Wallet oracle: balance decremented by the fee, total_earning UNCHANGED.
      const walletRow = await readWalletRow(tx, subject.teacherUserId);
      expect(walletRow?.balance).toBe("400.00");
      expect(walletRow?.totalEarning).toBe("500.00");

      // Ledger oracle: exactly ONE withdrawal/completed row, session NULL.
      const ledgerRows = await ledgerRowsForWallet(tx, subject.walletId);
      expect(ledgerRows).toHaveLength(1);
      const ledgerRow = ledgerRows[0];
      expect(ledgerRow?.type).toBe(TransactionType.Withdrawal);
      expect(ledgerRow?.status).toBe(TransactionStatus.Completed);
      expect(ledgerRow?.amount).toBe(RE_EVALUATION_FEE);
      expect(ledgerRow?.sessionId).toBeNull();
      expect(ledgerRow?.description).toBe(composeReEvaluationDescription(VALID_REASON));

      // Teacher oracle: de-certified.
      expect((await readTeacherRow(tx, subject.teacherUserId))?.isApproved).toBe(false);

      // Applicant oracle: re-opened into the loop with a fresh anchor.
      const applicantRow = await readApplicantRow(tx, subject.teacherUserId);
      expect(applicantRow?.status).toBe(ApplicantStatus.InEvaluation);
      expect(applicantRow?.reEvaluationStartedAt).not.toBeNull();
      expect(applicantRow?.reEvaluationStartedAt?.getTime()).toBe(result.reEvaluationStartedAt.getTime());

      // Audit oracle: exactly ONE row, override/teacher, actor from the param.
      const auditRows = await auditRowsForTeacher(tx, subject.teacherUserId);
      expect(auditRows).toHaveLength(1);
      const auditRow = auditRows[0];
      expect(auditRow?.actionType).toBe(AuditActionType.Override);
      expect(auditRow?.actorId).toBe(adminId);
      const parsedDetails: unknown = JSON.parse(auditRow?.details ?? "{}");
      expect(isRecord(parsedDetails)).toBe(true);
      if (!isRecord(parsedDetails)) throw new Error("audit details should be a JSON object");
      const details = parsedDetails;
      expect(details.action).toBe("re_evaluation_ordered");
      expect(details.amount).toBe(RE_EVALUATION_FEE);
      expect(details.walletId).toBe(subject.walletId);
      expect(details.balanceAfter).toBe("400.00");
      expect(details.reEvaluationStartedAt).toBe(result.reEvaluationStartedAt.toISOString());

      // Silent success: the happy path logs nothing.
      expectZeroLogCalls();
    });
  });

  test("insufficient balance: funds denial, ZERO committed rows, ONE bounded wallet-keyed log", async () => {
    await runInRollback(async tx => {
      const adminId = await createGovernanceAdmin(tx);
      const subject = await createReEvaluationSubject(tx, { wallet: { balance: "50.00", totalEarning: "500.00" } });
      if (subject.walletId === null) throw new Error("fixture must carry a wallet");

      const error = await expectRepoError(() => order(tx, adminId, subject.teacherUserId, VALID_REASON));

      expectDomainDenial(error, "WALLET_INSUFFICIENT_FUNDS", t().insufficientBalance);
      await expectZeroOrderRows(tx, subject);
      const walletRow = await readWalletRow(tx, subject.teacherUserId);
      expect(walletRow?.balance).toBe("50.00");
      expect(walletRow?.totalEarning).toBe("500.00");

      // The bounded denial log carries the wallet id ONLY — never an amount.
      // The log message is a FIXED English literal (like every sibling
      // denial log) — the localized copy stays on the thrown error only.
      expectSingleBoundedDenialLog("WALLET_INSUFFICIENT_FUNDS", subject.walletId);
      const call = logCalls()[0];
      expect(call?.message).toBe("Re-evaluation order denied: wallet insufficient funds");
      expect(call?.message.includes(RE_EVALUATION_FEE)).toBe(false);
    });
  });

  test("absent teacher: TEACHER_NOT_FOUND with the localized copy", async () => {
    await runInRollback(async tx => {
      const adminId = await createGovernanceAdmin(tx);

      const error = await expectRepoError(() => order(tx, adminId, ABSENT_USER_ID, VALID_REASON));

      expectDomainDenial(error, "TEACHER_NOT_FOUND", t().teacherNotFound);
      expectSingleBoundedDenialLog("TEACHER_NOT_FOUND", ABSENT_USER_ID);
    });
  });

  test("non-certified teacher: TEACHER_NOT_CERTIFIED and zero committed rows", async () => {
    await runInRollback(async tx => {
      const adminId = await createGovernanceAdmin(tx);
      const subject = await createReEvaluationSubject(tx, { teacherApproved: false });

      const error = await expectRepoError(() => order(tx, adminId, subject.teacherUserId, VALID_REASON));

      expectDomainDenial(error, "TEACHER_NOT_CERTIFIED", t().teacherNotCertified);
      await expectZeroOrderRows(tx, subject, { teacherApproved: false, applicantStatus: ApplicantStatus.Passed });
      expectSingleBoundedDenialLog("TEACHER_NOT_CERTIFIED", subject.teacherUserId);
    });
  });

  test("absent applicant: APPLICANT_NOT_AWAITING_RE_EVALUATION and zero committed rows", async () => {
    await runInRollback(async tx => {
      const adminId = await createGovernanceAdmin(tx);
      const subject = await createReEvaluationSubject(tx, { withApplicant: false });

      const error = await expectRepoError(() => order(tx, adminId, subject.teacherUserId, VALID_REASON));

      expectDomainDenial(error, "APPLICANT_NOT_AWAITING_RE_EVALUATION", t().applicantNotAwaitingReEvaluation);
      await expectZeroOrderRows(tx, subject, { teacherApproved: true, applicantStatus: null });
      expectSingleBoundedDenialLog("APPLICANT_NOT_AWAITING_RE_EVALUATION", subject.teacherUserId);
    });
  });

  // The applicant must be `passed` to re-enter the loop — every other
  // lifecycle state denies with the same back-orderable conflict.
  function testApplicantStatusDenial(status: ApplicantStatus): void {
    test(`applicant ${status}: APPLICANT_NOT_AWAITING_RE_EVALUATION and zero committed rows`, async () => {
      await runInRollback(async tx => {
        const adminId = await createGovernanceAdmin(tx);
        const subject = await createReEvaluationSubject(tx, { applicantStatus: status });

        const error = await expectRepoError(() => order(tx, adminId, subject.teacherUserId, VALID_REASON));

        expectDomainDenial(error, "APPLICANT_NOT_AWAITING_RE_EVALUATION", t().applicantNotAwaitingReEvaluation);
        await expectZeroOrderRows(tx, subject, { teacherApproved: true, applicantStatus: status });
        expectSingleBoundedDenialLog("APPLICANT_NOT_AWAITING_RE_EVALUATION", subject.teacherUserId);
      });
    });
  }
  testApplicantStatusDenial(ApplicantStatus.InEvaluation);
  testApplicantStatusDenial(ApplicantStatus.Failed);
  testApplicantStatusDenial(ApplicantStatus.Pending);

  // The actor gate runs BEFORE any input shape validation — an anonymous
  // actor receives the unauthenticated denial before any shape check (the
  // sibling admin services' gate-first posture).
  test("anonymous actor (id 0) → UNAUTHORIZED before any shape validation", async () => {
    await runInRollback(async tx => {
      const error = await expectRepoError(() => order(tx, 0, 1, VALID_REASON));

      expect(error).toBeInstanceOf(UnauthorizedError);
      expectDomainDenial(error, "UNAUTHORIZED", t().unauthorized);
      // The gate's own bounded denial log — never a VALIDATION entry.
      expectSingleBoundedDenialLog("UNAUTHORIZED", 0);
    });
  });

  // Pre-DB shape guards — a malformed subject id never reaches the domain's
  // own SQL (a governance-active admin is required to reach this guard, so
  // the malformed-id denial logs the sentinel entity id 0).
  function testTeacherIdValidation(name: string, teacherId: number): void {
    test(name, async () => {
      await runInRollback(async tx => {
        const adminId = await createGovernanceAdmin(tx);
        const error = await expectRepoError(() => order(tx, adminId, teacherId, VALID_REASON));
        expectDomainDenial(error, "VALIDATION", t().validation);
        expectSingleBoundedDenialLog("VALIDATION", 0);
      });
    });
  }
  testTeacherIdValidation("teacher id 0 → VALIDATION", 0);
  testTeacherIdValidation("NaN teacher id → VALIDATION", Number.NaN);
  testTeacherIdValidation("fractional teacher id → VALIDATION", 1.5);

  // ─── Tier 2: boundaries ──────────────────────────────────────────────

  test("reason boundary: empty and whitespace-only reasons reject with the localized reason denial", async () => {
    await runInRollback(async tx => {
      const adminId = await createGovernanceAdmin(tx);
      const emptyError = await expectRepoError(() => order(tx, adminId, 1, ""));
      expectDomainDenial(emptyError, "VALIDATION", t().reEvaluationReasonRequired);
      expectSingleBoundedDenialLog("VALIDATION", 1);

      requireLogSpy().mockClear();

      const whitespaceError = await expectRepoError(() => order(tx, adminId, 1, "   \t\n  "));
      expectDomainDenial(whitespaceError, "VALIDATION", t().reEvaluationReasonRequired);
      expectSingleBoundedDenialLog("VALIDATION", 1);
    });
  });

  test("reason boundary: 229 characters pass verbatim into the ledger description (inside the column cap), 230 reject with the over-limit leaf", async () => {
    await runInRollback(async tx => {
      const maxReason = "r".repeat(229);
      const gateAdminId = await createGovernanceAdmin(tx);

      // 230 chars → pre-DB VALIDATION denial carrying the over-limit copy.
      const overlongError = await expectRepoError(() => order(tx, gateAdminId, 1, `${maxReason}r`));
      expectDomainDenial(overlongError, "VALIDATION", t().reEvaluationReasonTooLong);

      // 229 chars → the full order commits; the composed description stays
      // inside the `teacher_transaction.description` capacity.
      const { adminId, subject } = await createFundedSubject(tx);
      expect(subject.walletId).not.toBeNull();
      if (subject.walletId === null) throw new Error("funded subject must carry a wallet");
      const result = await order(tx, adminId, subject.teacherUserId, maxReason);
      expect(result.amountCharged).toBe(RE_EVALUATION_FEE);

      const ledgerRows = await ledgerRowsForWallet(tx, subject.walletId);
      const description = ledgerRows[0]?.description ?? "";
      expect(description).toBe(composeReEvaluationDescription(maxReason));
      expect(description.length).toBeLessThanOrEqual(255);
      expect(description.endsWith(maxReason)).toBe(true);
    });
  });

  test("unicode + RTL reason is carried verbatim into the ledger description", async () => {
    await runInRollback(async tx => {
      const rtlReason = "تدنٍ متكرر في جودة التلاوة — يحتاج إعادة تقييم كاملة";
      const { adminId, subject } = await createFundedSubject(tx);
      expect(subject.walletId).not.toBeNull();
      if (subject.walletId === null) throw new Error("funded subject must carry a wallet");

      const result = await order(tx, adminId, subject.teacherUserId, rtlReason);

      expect(result.amountCharged).toBe(RE_EVALUATION_FEE);
      const ledgerRows = await ledgerRowsForWallet(tx, subject.walletId);
      expect(ledgerRows[0]?.description).toBe(composeReEvaluationDescription(rtlReason));
    });
  });

  test("wallet-less certified teacher: an honest zeroed wallet is ensured before the debit is attempted", async () => {
    await runInRollback(async tx => {
      const adminId = await createGovernanceAdmin(tx);
      const subject = await createReEvaluationSubject(tx);
      expect(subject.walletId).toBeNull();

      // Passthrough spy: the REAL ensureWalletOnce runs (real DB write); the
      // spy only records the ensured row so the zeroed pre-debit state is
      // observable even though the denial later rolls it back.
      const ensuredWallets: WalletSelectType[] = [];
      const originalEnsure = WalletRepository.ensureWalletOnce;
      const ensureSpy = spyOn(WalletRepository, "ensureWalletOnce").mockImplementation(async (teacherId, innerTx) => {
        const walletRow = await originalEnsure(teacherId, innerTx);
        ensuredWallets.push(walletRow);
        return walletRow;
      });
      let error: Error;
      try {
        error = await expectRepoError(() => order(tx, adminId, subject.teacherUserId, VALID_REASON));
      } finally {
        ensureSpy.mockRestore();
      }

      // The debit WAS attempted against the fresh zeroed wallet — the denial
      // is the honest funds conflict, never a missing-wallet error.
      expectDomainDenial(error, "WALLET_INSUFFICIENT_FUNDS", t().insufficientBalance);
      expect(ensuredWallets).toHaveLength(1);
      const ensured = ensuredWallets[0];
      expect(ensured?.teacherId).toBe(subject.teacherUserId);
      expect(ensured?.balance).toBe("0.00");
      expect(ensured?.totalEarning).toBe("0.00");
      expectSingleBoundedDenialLog("WALLET_INSUFFICIENT_FUNDS", ensured?.id);
    });
  });

  // ─── Tier 4: security / abuse ────────────────────────────────────────

  test("non-admin actor: FORBIDDEN and zero committed rows", async () => {
    await runInRollback(async tx => {
      const impostor = await createTestUser(tx, { role: "teacher" });
      const subject = await createReEvaluationSubject(tx, { wallet: { balance: "500.00", totalEarning: "500.00" } });

      const error = await expectRepoError(() => order(tx, impostor.id, subject.teacherUserId, VALID_REASON));

      expect(error).toBeInstanceOf(ForbiddenError);
      expectDomainDenial(error, "FORBIDDEN", t().forbidden);
      await expectZeroOrderRows(tx, subject);
    });
  });

  test("governed admin (deleted / blocked / suspended): FORBIDDEN and zero committed rows", async () => {
    await runInRollback(async tx => {
      const deletedAdmin = await createTestUser(tx, { role: "admin", isDeleted: true });
      const blockedAdmin = await createTestUser(tx, { role: "admin", isBlocked: true });
      const suspendedAdmin = await createTestUser(tx, { role: "admin", suspended: true });
      const subject = await createReEvaluationSubject(tx, { wallet: { balance: "500.00", totalEarning: "500.00" } });

      const deletedError = await expectRepoError(() => order(tx, deletedAdmin.id, subject.teacherUserId, VALID_REASON));
      expectDomainDenial(deletedError, "FORBIDDEN", t().accountDeleted);

      const blockedError = await expectRepoError(() => order(tx, blockedAdmin.id, subject.teacherUserId, VALID_REASON));
      expectDomainDenial(blockedError, "FORBIDDEN", t().accountBlocked);

      const suspendedError = await expectRepoError(() =>
        order(tx, suspendedAdmin.id, subject.teacherUserId, VALID_REASON)
      );
      expectDomainDenial(suspendedError, "FORBIDDEN", t().accountSuspended);

      await expectZeroOrderRows(tx, subject);
    });
  });

  test("LIKE-wildcard characters in the reason are stored literally (parameterized, no SQL interpolation)", async () => {
    await runInRollback(async tx => {
      const wildcardReason = "100% of sessions _late \\escapes %twice_";
      const { adminId, subject } = await createFundedSubject(tx);
      expect(subject.walletId).not.toBeNull();
      if (subject.walletId === null) throw new Error("funded subject must carry a wallet");

      const result = await order(tx, adminId, subject.teacherUserId, wildcardReason);

      expect(result.amountCharged).toBe(RE_EVALUATION_FEE);
      const ledgerRows = await ledgerRowsForWallet(tx, subject.walletId);
      expect(ledgerRows[0]?.description).toBe(composeReEvaluationDescription(wildcardReason));
    });
  });

  test("the acting admin id comes exclusively from the parameter (an impostor field on the input object cannot forge the audit actor)", async () => {
    await runInRollback(async tx => {
      const adminId = await createGovernanceAdmin(tx);
      const subject = await createReEvaluationSubject(tx, { wallet: { balance: "500.00", totalEarning: "500.00" } });
      // Extra property on a WIDER object type — structurally assignable, so
      // a caller trying to smuggle an actor id through the input payload
      // cannot widen the contract.
      const impostorInput = {
        teacherId: subject.teacherUserId,
        reason: VALID_REASON,
        actorUserId: subject.teacherUserId,
      };

      const result = await TeacherReEvaluationService.orderReEvaluation(adminId, impostorInput, LOCALE, tx);

      expect(result.teacherId).toBe(subject.teacherUserId);
      const auditRows = await auditRowsForTeacher(tx, subject.teacherUserId);
      expect(auditRows).toHaveLength(1);
      expect(auditRows[0]?.actorId).toBe(adminId);
    });
  });

  // ─── Tier 4: static source pins ──────────────────────────────────────

  const SERVICE_FILE = join(import.meta.dir, "teacher-re-evaluation.service.ts");
  const serviceSource = readFileSync(SERVICE_FILE, "utf8");

  test("source: one withTransaction, no forked ledger vocabulary, no hand-rolled SQL in the service", () => {
    expect(serviceSource.split("withTransaction(").length - 1).toBe(1);
    expect(serviceSource.includes("TransactionType")).toBe(false);
    expect(serviceSource.includes("TransactionStatus")).toBe(false);
    expect(serviceSource.includes(".update(")).toBe(false);
    expect(serviceSource.includes(".insert(")).toBe(false);
  });

  test("source: enums imported as VALUES, actor id flows from the parameter only", () => {
    expect(serviceSource.includes("import { AuditActionType }")).toBe(true);
    expect(serviceSource.includes("import { ApplicantStatus }")).toBe(true);
    expect(serviceSource.includes("import type { AuditActionType }")).toBe(false);
    expect(serviceSource.includes("import type { ApplicantStatus }")).toBe(false);
    // The audit builder receives the actor as a parameter and the pipeline
    // passes the `actorUserId` PARAM — no input field can reach the audit row.
    expect(serviceSource.includes("actorId: number")).toBe(true);
    expect(serviceSource.includes("appendOrderAudit(actorUserId")).toBe(true);
    expect(serviceSource.includes("input.actorUserId")).toBe(false);
  });

  test("source: comments describe domain behavior only (no plan-artifact references, no console)", () => {
    expect(/REQ-\d|DEV2|DEV3|Phase \d|Task \d|plan\.md|tasks\.md|specs\.md/.test(serviceSource)).toBe(false);
    expect(serviceSource.includes("console.")).toBe(false);
  });
});

// ─── Committed concurrency tier (real Postgres) ───────────────────────────

describe("TeacherReEvaluationService — exactly-once ordering (committed fixtures, real Postgres)", () => {
  /** Committed fixture user ids (admin + subject) — hard-deleted in `afterAll`. */
  const committedUserIds: number[] = [];
  /** Committed subject (teacher) user ids — cleanup parents for the ledger/audit sweep. */
  const committedTeacherUserIds: number[] = [];

  afterAll(async () => {
    if (committedUserIds.length === 0) {
      return;
    }
    // Append-only tables first, under the sanctioned trigger suspension:
    // the winner's ledger row (wallet FK restrict) and audit rows (actor FK
    // restrict) must die before the users delete cascades the rest.
    const walletIds = await db
      .select({ id: wallet.id })
      .from(wallet)
      .where(inArray(wallet.teacherId, committedTeacherUserIds));
    await withImmutabilityTriggersSuspended(["teacher_transaction", "audit_logs"], async () => {
      if (walletIds.length > 0) {
        await db.delete(teacherTransaction).where(
          inArray(
            teacherTransaction.walletId,
            walletIds.map(row => row.id)
          )
        );
      }
      await db.delete(auditLogs).where(inArray(auditLogs.actorId, committedUserIds));
      await db
        .delete(auditLogs)
        .where(and(eq(auditLogs.entityType, "teacher"), inArray(auditLogs.entityId, committedTeacherUserIds)));
    });
    await db.delete(applicants).where(inArray(applicants.id, committedTeacherUserIds));
    await db.delete(users).where(inArray(users.id, committedUserIds));
    committedUserIds.length = 0;
    committedTeacherUserIds.length = 0;
  });

  testOnRealPostgres(
    "two concurrent orders on the same teacher: exactly one charge — the loser's debit rolls back with its transaction",
    async () => {
      // Committed fixtures with headroom for BOTH debits, so the funds guard
      // is NOT the arbiter — the guarded state flips are.
      const ids = await db.transaction(async tx => {
        const admin = await createTestUser(tx, { role: "admin" });
        const subject = await createTestUser(tx, { role: "teacher" });
        await createTestTeacherRow(tx, subject.id, { isApproved: true });
        await createTestApplicant(tx, subject.id, { status: ApplicantStatus.Passed });
        await createTestWallet(tx, subject.id, { balance: "1000.00", totalEarning: "1000.00" });
        committedUserIds.push(admin.id, subject.id);
        committedTeacherUserIds.push(subject.id);
        return { adminId: admin.id, teacherUserId: subject.id };
      });

      const settled = await Promise.allSettled([
        db.transaction(outerTx =>
          TeacherReEvaluationService.orderReEvaluation(
            ids.adminId,
            { teacherId: ids.teacherUserId, reason: VALID_REASON },
            LOCALE,
            outerTx
          )
        ),
        db.transaction(outerTx =>
          TeacherReEvaluationService.orderReEvaluation(
            ids.adminId,
            { teacherId: ids.teacherUserId, reason: VALID_REASON },
            LOCALE,
            outerTx
          )
        ),
      ]);

      const winnerOutcome = settled.find(
        (outcome): outcome is PromiseFulfilledResult<TeacherReEvaluationOrderReturnType> =>
          outcome.status === "fulfilled"
      );
      const loserOutcome = settled.find((outcome): outcome is PromiseRejectedResult => outcome.status === "rejected");
      expect(winnerOutcome).toBeDefined();
      expect(loserOutcome).toBeDefined();
      if (!winnerOutcome || !loserOutcome) {
        throw new Error("expected exactly one fulfilled and one rejected order");
      }

      // The winner's receipt carries the honest single-charge state.
      const winner = winnerOutcome.value;
      expect(winner.amountCharged).toBe(RE_EVALUATION_FEE);
      expect(winner.currency).toBe(RE_EVALUATION_FEE_CURRENCY);
      expect(winner.walletBalance).toBe("900.00");

      // The loser lost the state arbitration (either guarded flip consumed)
      // and its executed debit died with its transaction.
      const loserError = loserOutcome.reason;
      expect(loserError).toBeInstanceOf(ConflictError);
      const loserCode = rejectionCode(loserError);
      expect(["TEACHER_NOT_CERTIFIED", "APPLICANT_NOT_AWAITING_RE_EVALUATION"]).toContain(loserCode);

      // Final committed state: exactly ONE charge, ONE ledger row, ONE audit row.
      const walletRow = await readWalletCommitted(ids.teacherUserId);
      expect(walletRow?.balance).toBe("900.00");
      expect(walletRow?.totalEarning).toBe("1000.00");
      if (walletRow) {
        const ledgerRows = await db
          .select()
          .from(teacherTransaction)
          .where(eq(teacherTransaction.walletId, walletRow.id));
        expect(ledgerRows).toHaveLength(1);
        expect(ledgerRows[0]?.type).toBe(TransactionType.Withdrawal);
        expect(ledgerRows[0]?.status).toBe(TransactionStatus.Completed);
        expect(ledgerRows[0]?.amount).toBe(RE_EVALUATION_FEE);
        expect(ledgerRows[0]?.sessionId).toBeNull();
      }
      const auditRows = await db
        .select()
        .from(auditLogs)
        .where(and(eq(auditLogs.entityType, "teacher"), eq(auditLogs.entityId, ids.teacherUserId)));
      expect(auditRows).toHaveLength(1);
      expect(auditRows[0]?.actorId).toBe(ids.adminId);
      expect(auditRows[0]?.actionType).toBe(AuditActionType.Override);

      const teacherRow = await db.select().from(teacher).where(eq(teacher.id, ids.teacherUserId));
      expect(teacherRow[0]?.isApproved).toBe(false);
      const applicantRow = await db.select().from(applicants).where(eq(applicants.id, ids.teacherUserId));
      expect(applicantRow[0]?.status).toBe(ApplicantStatus.InEvaluation);
      expect(applicantRow[0]?.reEvaluationStartedAt).not.toBeNull();
    }
  );
});

/** Committed-state read-back oracle (own connection — outside runInRollback). */
async function readWalletCommitted(teacherUserId: number): Promise<WalletSelectType | null> {
  const [row] = await db.select().from(wallet).where(eq(wallet.teacherId, teacherUserId));
  return row ?? null;
}
