/**
 * Journey — cross-actor adversarial financial-safety verification (billing).
 *
 * The money paths of the platform exercised SEQUENTIALLY through the real
 * `SessionLifecycleService`, `WalletService`, and `WalletRepository`
 * (production transaction paths — no outer tx) on the real test database,
 * with every step attributed to a real actor from one committed fixture
 * cast (real `users.role` values + real role-child rows; authorization and
 * ownership resolve through the same row-side predicates production uses —
 * never monkey-patched):
 *
 *   1. double-spend race — N concurrent bookings, each under its OWN
 *      idempotency key, race over one funded escrow unit: exactly one
 *      attempt wins the hold, the losers roll back to zero writes, and
 *      every rejection is honestly classified (insufficient balance or
 *      duplicate request).
 *   2. escrow cancel release — the winner cancels: the held unit returns
 *      to its recorded provenance lane exactly once, the lane never
 *      rewritten, no teacher-side financial movement, and a re-cancel is a
 *      zero-write oracle-safe conflict.
 *   3. dual-confirm credit — re-book, teacher completes (exactly one
 *      confirm prompt reaches the student), student confirms: exactly one
 *      earning-ledger row, the wallet credited exactly the session fee
 *      once.
 *   4. withdrawal drain race — two concurrent payout requests over a
 *      single-fee balance: exactly one debit lands, the loser rolls back
 *      to zero writes, and the wallet identity (balance = earnings −
 *      withdrawals) holds on exact decimal strings.
 *   5. input fuzz — the withdrawal amount matrix (empty, whitespace,
 *      non-numeric, zero, negative, exponent, over-precise, over-long,
 *      thousands-separated) is rejected pre-DB with zero writes.
 *   6. wallet-first-earning race — two credits race over a
 *      pre-ensured wallet: both land, exactly one wallet row exists, and
 *      the totals sum exactly.
 *   7. adversarial immutability — a direct UPDATE against the earning
 *      ledger is blocked by the append-only trigger; the row reads back
 *      byte-identical.
 *   8. denials — a non-participant student's confirm/cancel attempts and
 *      a parent's wallet read fail oracle-safely through the real
 *      authorization path while the owner's rows stay byte-identical.
 *
 * Layer contract (`test/workflows/AGENTS.md`):
 *  - NO `runInRollback` — fixtures commit in `beforeAll`; every row
 *    (fixtures AND service-created sessions/claims/wallets) is registered
 *    in a `TrackedFixtures` registry and hard-deleted FK-safely in
 *    `afterAll`.
 *  - Per-run `jrn_billing_finsec_<8hex>` prefix on user labels, idempotency
 *    keys, and fixture descriptions — repeated or parallel runs never
 *    collide.
 *  - The notification publication boundary is SPIED (recording no-op over
 *    the engine's publish contract) — no realtime channel is ever touched;
 *    each dispatch is asserted together with the recipient ids it targeted.
 *  - The earning-ledger rows (`teacher_transaction`) are REAL financial
 *    side effects of the journey: they are asserted (exactly once, fee
 *    verbatim) and removed in `afterAll` under the sanctioned append-only
 *    trigger suspension — teardown must still leave zero residue.
 *  - Negative steps fail through the REAL service denials, asserted by
 *    `DomainError.code` + the exact translated message (try/catch helper —
 *    never `expect(...).rejects.toThrow()`).
 *
 * Run:
 *   bun run test/scripts/run-test.ts test/workflows/billing/financial-safety-verification.journey.test.ts
 *   bun run test/scripts/run-test.ts test/workflows
 */

import { afterAll, beforeAll, describe, expect, spyOn, test } from "bun:test";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/backend/db";
import { WalletRepository } from "@/backend/db/repo/billing/wallet.repository";
import { teacherTransaction } from "@/backend/db/schema/billing/teacher-transaction";
import { wallet } from "@/backend/db/schema/billing/wallet";
import { session } from "@/backend/db/schema/classes/session";
import { sessionRequestIdempotency } from "@/backend/db/schema/classes/session-request-idempotency";
import { students } from "@/backend/db/schema/students/students";
import { TransactionStatus } from "@/backend/enum/billing/transaction-status.enum";
import { TransactionType } from "@/backend/enum/billing/transaction-type.enum";
import { HeldBalanceLane } from "@/backend/enum/scheduling/held-balance-lane.enum";
import { SessionIntent } from "@/backend/enum/scheduling/session-intent.enum";
import { SessionStatus } from "@/backend/enum/scheduling/session-status.enum";
import { ConflictError, DomainError } from "@/backend/lib/errors";
import { WalletService } from "@/backend/services/billing/wallet.service";
import { SessionLifecycleService } from "@/backend/services/classes/session-lifecycle.service";
import * as NotificationServices from "@/backend/services/notifications";
import type {
  NotificationDeliveryReceipt,
  SessionReturnType,
  SessionSubmitInput,
  TeacherTransactionSelectType,
  WalletSelectType,
} from "@/backend/types";
import { SESSION_FEE_HIFZ } from "@/shared/constants/session-fees.constants";
import { getServerTranslations } from "@/shared/locale/server-graphql";
import { withImmutabilityTriggersSuspended } from "@/test/helpers/db-cleanup";
import {
  catchJourneyError,
  countNotificationsForUser,
  countTeacherTransactionsForTeacher,
  countWalletsForTeacher,
  type JourneyActor,
  journeyPrefix,
  provisionAdminActor,
  provisionCertifiedTeacherActor,
  provisionParentActor,
  provisionStudentActor,
  TrackedFixtures,
} from "@/test/workflows/helpers";

/**
 * The journey runs on the default test locale throughout.
 */
const LOCALE = "en";

/**
 * Per-run unique prefix — user labels, idempotency keys, and fixture
 * descriptions all carry it so repeated or parallel runs never collide.
 */
const JOURNEY_PREFIX = journeyPrefix("billing_finsec");

/** Idempotency keys for the double-spend race — one OWN key per attempt. */
const RACE_ATTEMPTS = 4;
const KEY_A: string[] = Array.from(
  { length: RACE_ATTEMPTS },
  (_, index) => `${JOURNEY_PREFIX}-studentA-race-${String(index)}`
);

/** Idempotency key for the re-booking the dual-confirm credit runs on. */
const KEY_C = `${JOURNEY_PREFIX}-studentC-dual-confirm`;

/** The fixture registry — the hard-delete worklist drained by `afterAll`. */
const registry = new TrackedFixtures();

/** The committed actor cast (assigned once by `beforeAll`). */
let student: JourneyActor;
let nonParticipant: JourneyActor;
let teacher: JourneyActor;
let teacher2: JourneyActor;
let parent: JourneyActor;
let admin: JourneyActor;

/** Session W — won by Student A out of the double-spend race, then cancelled. */
let sessionW: SessionReturnType;

/** The idempotency claim row of the race winner (losers' claims rolled back). */
let winningClaimId: number;

/** Session C — the re-booked session the dual-confirm credit runs on. */
let sessionC: SessionReturnType;

/** Session C's earning-ledger row (created by the student confirmation). */
let stepCEarningRow: TeacherTransactionSelectType;

/** The teacher's wallet row (assigned by the dual-confirm credit step). */
let teacherWallet: WalletSelectType;

/**
 * The append-only earning/withdrawal ledger row ids the journey created.
 * The registry's plain deletes cannot drain a trigger-locked table, so
 * these rows are hard-deleted by EXPLICIT id in `afterAll` under the
 * sanctioned immutability-trigger suspension — the zero-count re-probes
 * afterwards still fail loudly on any untracked row.
 */
const trackedLedgerRowIds: number[] = [];

/** The exact translated denial messages for the default test locale. */
function errorTexts() {
  return getServerTranslations(LOCALE).errorsTranslations;
}

/** Type-guard read of a caught rejection's `extensions.code`. */
function denialCode(error: unknown): string {
  return error instanceof DomainError ? error.code : "";
}

/** Type-guard read of a caught rejection's message (pairs with the instanceof assertions upstream). */
function rejectionMessage(error: unknown): string {
  return error instanceof DomainError ? error.message : "";
}

/**
 * Runs a denial through the real service and asserts the typed-denial
 * contract: a `DomainError` carrying EXACTLY `code` and EXACTLY the
 * translated message (never the raw key). Returns the caught error so a
 * call site can assert the concrete subclass (e.g. `ConflictError`).
 * Fails the test when the action resolves instead of rejecting.
 */
async function expectServiceDenial(code: string, message: string, action: () => Promise<unknown>): Promise<unknown> {
  const caught = await catchJourneyError(action);
  expect(caught).toBeInstanceOf(DomainError);
  expect(denialCode(caught)).toBe(code);
  expect(caught.message).toBe(message);
  return caught;
}

/** Narrows a nullable wallet read to a row, failing loudly when null. */
function requiredWalletRow(value: WalletSelectType | null, label: string): WalletSelectType {
  if (value === null) {
    throw new Error(`journey: expected a wallet row for ${label}`);
  }
  return value;
}

/**
 * Parses a two-fraction decimal string into exact cents (money
 * discipline: never `Number()` on an amount).
 */
function toCents(value: string): bigint {
  const negative = value.startsWith("-");
  const unsigned = negative ? value.slice(1) : value;
  const [whole, fraction = ""] = unsigned.split(".");
  const fraction2 = `${fraction}00`.slice(0, 2);
  const cents = BigInt(whole) * 100n + BigInt(fraction2);
  return negative ? -cents : cents;
}

/**
 * Exact decimal-string subtraction at two fraction digits (money
 * discipline: never `Number()` on an amount).
 */
function subtractMoney(minuend: string, subtrahend: string): string {
  const delta = toCents(minuend) - toCents(subtrahend);
  const negative = delta < 0n;
  const absolute = negative ? -delta : delta;
  const rendered = `${absolute / 100n}.${(absolute % 100n).toString().padStart(2, "0")}`;
  return negative ? `-${rendered}` : rendered;
}

/** Reads the session row straight off the table (read-back oracle). */
async function readSessionRow(id: number): Promise<SessionReturnType> {
  const rows = await db.select().from(session).where(eq(session.id, id)).limit(1);
  const row = rows[0];
  if (!row) {
    throw new Error(`journey: session row ${String(id)} vanished (fixture integrity failure)`);
  }
  return row;
}

/** Reads the student's escrow-lane balances straight from the row. */
async function readStudentLanes(
  studentId: number
): Promise<{ trial: number; hifz: number | null; tajweed: number | null }> {
  const rows = await db
    .select({
      trial: students.balanceTrial,
      hifz: students.balanceHifz,
      tajweed: students.balanceTajweed,
    })
    .from(students)
    .where(eq(students.id, studentId));
  const row = rows[0];
  if (!row) {
    throw new Error(`journey: students row ${String(studentId)} vanished (fixture integrity failure)`);
  }
  return row;
}

/** Reads the teacher's wallet row, or `null` before the first credit. */
async function readTeacherWalletRow(teacherUserId: number): Promise<WalletSelectType | null> {
  const rows = await db.select().from(wallet).where(eq(wallet.teacherId, teacherUserId)).limit(1);
  return rows[0] ?? null;
}

/** The earning-ledger rows tied to one wallet (exactly-once oracle). */
async function readLedgerRowsForWallet(walletId: number): Promise<TeacherTransactionSelectType[]> {
  return db.select().from(teacherTransaction).where(eq(teacherTransaction.walletId, walletId));
}

/** Registers one service-created idempotency claim (by key) for cleanup. */
async function trackIdempotencyClaim(key: string, label: string): Promise<void> {
  const rows = await db
    .select({ id: sessionRequestIdempotency.id })
    .from(sessionRequestIdempotency)
    .where(eq(sessionRequestIdempotency.idempotencyKey, key));
  const claim = rows[0];
  if (!claim) {
    throw new Error(`journey: idempotency claim for ${label} not found (fixture tracking failure)`);
  }
  registry.register(sessionRequestIdempotency, claim.id);
}

/**
 * Installs a recording no-op over the engine's publish contract: no
 * realtime channel is ever touched, and each dispatch is logged together
 * with the receipts (and their recipient ids) so a step can assert both
 * THAT a publish happened and WHICH users it targeted. The spy rides the
 * namespace import of the notifications module (the dispatched boundary
 * seam per `test/workflows/AGENTS.md` rule 5), is installed once in
 * `beforeAll`, and is restored in `afterAll`.
 */
function spyPublication(): { calls: NotificationDeliveryReceipt[][]; stop: () => void } {
  const calls: NotificationDeliveryReceipt[][] = [];
  const spy = spyOn(NotificationServices.NotificationEngine, "publishReceipts").mockImplementation(async receipts => {
    calls.push([...receipts]);
  });
  return { calls, stop: () => spy.mockRestore() };
}

let publication: ReturnType<typeof spyPublication> | undefined;

/** How many publish dispatches the spy has recorded so far. */
function publicationCallCount(): number {
  return publication?.calls.length ?? 0;
}

/** Registers the two fixture sessions the wallet-first-earning race needs. */
async function insertFixtureSession(
  teacherUserId: number,
  studentUserId: number,
  fee: string,
  label: string
): Promise<number> {
  const inserted = await db
    .insert(session)
    .values({
      teacherId: teacherUserId,
      studentId: studentUserId,
      status: SessionStatus.Completed,
      feeHeld: false,
      fee,
    })
    .returning({ id: session.id });
  const row = inserted[0];
  if (!row) {
    throw new Error(`journey: fixture session insert for ${label} returned no rows`);
  }
  registry.register(session, row.id);
  return row.id;
}

beforeAll(async () => {
  // No realtime delivery for the whole suite: every publish is recorded.
  publication = spyPublication();

  await db.transaction(async tx => {
    student = await provisionStudentActor(tx, { locale: LOCALE, tracked: registry });
    nonParticipant = await provisionStudentActor(tx, { locale: LOCALE, tracked: registry });
    teacher = await provisionCertifiedTeacherActor(tx, { locale: LOCALE, tracked: registry });
    teacher2 = await provisionCertifiedTeacherActor(tx, { locale: LOCALE, tracked: registry });
    parent = await provisionParentActor(tx, { locale: LOCALE, tracked: registry });
    admin = await provisionAdminActor(tx, { locale: LOCALE, tracked: registry });

    // Fund Student A with EXACTLY one hifz unit — the single escrow unit
    // the double-spend race contends over (the trial lane stays empty, so
    // the booking ladder debits the hifz lane).
    const studentUserId = student.userId;
    await tx.update(students).set({ balanceHifz: 1 }).where(eq(students.id, studentUserId));
  });
});

afterAll(async () => {
  publication?.stop();

  // The earning-ledger rows the journey created are append-only
  // (DELETE-blocked): they are hard-deleted FIRST, by their explicitly
  // tracked ids, under the sanctioned append-only trigger suspension —
  // the registry's plain deletes could never drain a trigger-locked
  // table. The wallets and every other committed row are then drained by
  // the registry itself, in reverse-registration (FK-safe) order.
  if (trackedLedgerRowIds.length > 0) {
    await withImmutabilityTriggersSuspended(["teacher_transaction"], () =>
      db.delete(teacherTransaction).where(inArray(teacherTransaction.id, trackedLedgerRowIds))
    );
  }

  await registry.cleanup();

  // Zero-residue self-check: the suite's session rows, both wallets, both
  // ledgers, and the students' inboxes are gone with the tracked rows.
  await Promise.all(
    registry.records.map(async record => {
      if (record.key === "session") {
        expect(await db.$count(session, eq(session.id, record.id))).toBe(0);
      }
    })
  );
  expect(await countWalletsForTeacher(teacher.userId)).toBe(0);
  expect(await countWalletsForTeacher(teacher2.userId)).toBe(0);
  expect(await countTeacherTransactionsForTeacher(teacher.userId)).toBe(0);
  expect(await countTeacherTransactionsForTeacher(teacher2.userId)).toBe(0);
  expect(await countNotificationsForUser(student.userId)).toBe(0);
  expect(await countNotificationsForUser(nonParticipant.userId)).toBe(0);
});

describe("Journey — cross-actor adversarial financial-safety verification (real services)", () => {
  test("step A — double-spend race: exactly one booking wins the funded unit, every loser rolls back to zero writes", async () => {
    const outcomes = await Promise.allSettled(
      KEY_A.map(
        (key): Promise<SessionReturnType> =>
          SessionLifecycleService.createSession(
            student.userId,
            { teacherId: teacher.userId, intent: SessionIntent.Hifz },
            key,
            LOCALE
          ).then(booked => {
            registry.register(session, booked.id);
            return booked;
          })
      )
    );

    // Exactly ONE attempt fulfills; the rest reject honestly.
    const fulfilled: PromiseFulfilledResult<SessionReturnType>[] = [];
    const rejectedReasons: unknown[] = [];
    for (const outcome of outcomes) {
      if (outcome.status === "fulfilled") {
        fulfilled.push(outcome);
      } else {
        rejectedReasons.push(outcome.reason);
      }
    }
    expect(fulfilled).toHaveLength(1);
    expect(rejectedReasons).toHaveLength(RACE_ATTEMPTS - 1);
    for (const reason of rejectedReasons) {
      expect(reason).toBeInstanceOf(DomainError);
      const code = denialCode(reason);
      expect(["INSUFFICIENT_BALANCE", "DUPLICATE_REQUEST"]).toContain(code);
      // The winner is unknown up front, so the expected translated copy
      // follows the ACTUAL denial code each loser carried.
      const expectedMessage =
        code === "INSUFFICIENT_BALANCE" ? errorTexts().insufficientBalance : errorTexts().duplicateRequest;
      expect(rejectionMessage(reason)).toBe(expectedMessage);
    }

    // The funded unit was consumed exactly once — never twice.
    const lanes = await readStudentLanes(student.userId);
    expect(lanes.trial).toBe(0);
    expect(lanes.hifz).toBe(0);

    // Exactly ONE held session row exists for this student+teacher pair.
    const studentId = student.userId;
    const heldCount = await db.$count(
      session,
      and(eq(session.studentId, studentId), eq(session.teacherId, teacher.userId), eq(session.feeHeld, true))
    );
    expect(heldCount).toBe(1);

    // The won row pins the escrow shape: hifz provenance, platform fee.
    const won = fulfilled[0]?.value;
    if (!won) {
      throw new Error("journey: the double-spend race produced no fulfilled booking");
    }
    const row = await readSessionRow(won.id);
    expect(row.heldBalanceLane).toBe(HeldBalanceLane.Hifz);
    expect(row.fee).toBe(SESSION_FEE_HIFZ);
    sessionW = won;

    // Only the winner's idempotency claim survived: the losers' claim
    // inserts rolled back with their transactions.
    const claims = await db
      .select({ id: sessionRequestIdempotency.id })
      .from(sessionRequestIdempotency)
      .where(inArray(sessionRequestIdempotency.idempotencyKey, KEY_A));
    expect(claims).toHaveLength(1);
    winningClaimId = claims[0]?.id ?? -1;
    expect(winningClaimId).toBeGreaterThan(0);
    registry.register(sessionRequestIdempotency, winningClaimId);
  });

  test("step B — escrow cancel release: the held unit returns to its provenance lane exactly once; a re-cancel is a zero-write conflict", async () => {
    const publishesBefore = publicationCallCount();

    const cancelled = await SessionLifecycleService.cancelSession(
      student.userId,
      sessionW.id,
      `${JOURNEY_PREFIX} escrow release step`,
      LOCALE
    );

    // Terminal cancelled state; the escrow hold is released.
    expect(cancelled.id).toBe(sessionW.id);
    expect(cancelled.status).toBe(SessionStatus.Cancelled);
    expect(cancelled.feeHeld).toBe(false);

    // The unit returned to the SAME lane that funded the hold — exactly
    // once (0 → 1) — and the recorded provenance lane was never rewritten.
    const lanes = await readStudentLanes(student.userId);
    expect(lanes.trial).toBe(0);
    expect(lanes.hifz).toBe(1);
    const row = await readSessionRow(sessionW.id);
    expect(row.heldBalanceLane).toBe(HeldBalanceLane.Hifz);

    // No teacher-side financial movement: the release is escrow-only.
    expect(await countTeacherTransactionsForTeacher(teacher.userId)).toBe(0);
    expect(await countWalletsForTeacher(teacher.userId)).toBe(0);

    // The cancel is notification-free on this surface.
    expect(publicationCallCount()).toBe(publishesBefore);

    // A re-cancel cannot double-release: the terminal row is structurally
    // unreachable through the cancellable predicate.
    const reCancel = await catchJourneyError(() =>
      SessionLifecycleService.cancelSession(student.userId, sessionW.id, `${JOURNEY_PREFIX} re-cancel probe`, LOCALE)
    );
    expect(reCancel).toBeInstanceOf(DomainError);
    expect(denialCode(reCancel)).toBe("SESSION_INVALID_TRANSITION");
    expect(reCancel.message).toBe(errorTexts().sessionInvalidTransition);
    expect(reCancel).toBeInstanceOf(ConflictError);

    // The re-cancel wrote nothing: the lane refund did not repeat.
    expect(await readStudentLanes(student.userId).then(l => l.hifz)).toBe(1);
  });

  test("step C — dual-confirm credit: re-book, teacher completes, student confirms — exactly ONE earning row and the wallet credited the fee once", async () => {
    // Re-book under a fresh key — the restored unit funds the hold again.
    const booking: SessionSubmitInput = { teacherId: teacher.userId, intent: SessionIntent.Hifz };
    sessionC = await SessionLifecycleService.createSession(student.userId, booking, KEY_C, LOCALE);
    registry.register(session, sessionC.id);
    await trackIdempotencyClaim(KEY_C, "key C (dual confirm)");
    expect(sessionC.feeHeld).toBe(true);
    expect(sessionC.heldBalanceLane).toBe(HeldBalanceLane.Hifz);
    expect(await readStudentLanes(student.userId).then(l => l.hifz)).toBe(0);

    // The teacher completes the STARTED session: the completion predicate
    // requires the started pre-state, so the start stamp is written first.
    const started = await SessionLifecycleService.startSession(teacher.userId, sessionC.id, LOCALE);
    expect(started.status).toBe(SessionStatus.Started);
    sessionC = started;

    const publishesBefore = publicationCallCount();
    const completed = await SessionLifecycleService.completeSession(teacher.userId, sessionC.id, LOCALE);
    expect(completed.id).toBe(sessionC.id);
    expect(completed.status).toBe(SessionStatus.Completed);
    expect(completed.confirmedByTeacherAt).not.toBeNull();
    sessionC = completed;

    // Exactly ONE confirm prompt was published AFTER the completion's
    // commit, targeting exactly the student — nobody else.
    expect(publicationCallCount()).toBe(publishesBefore + 1);
    const promptCalls = publication?.calls ?? [];
    const lastCall = promptCalls[promptCalls.length - 1];
    expect(lastCall).toBeDefined();
    expect(lastCall?.map(receipt => receipt.recipientUserIds.concat())).toEqual([[student.userId]]);

    // The student confirms: the escrow hold is consumed by the credit.
    const confirmed = await SessionLifecycleService.confirmSessionCompletion(student.userId, sessionC.id, LOCALE);
    expect(confirmed.id).toBe(sessionC.id);
    expect(confirmed.confirmedByStudentAt).not.toBeNull();
    expect(confirmed.feeHeld).toBe(false);
    sessionC = confirmed;

    // Exactly ONE ledger row: earning, completed, the fee verbatim,
    // pointing back at this session.
    teacherWallet = requiredWalletRow(
      await readTeacherWalletRow(teacher.userId),
      "teacher wallet after the confirm credit"
    );
    registry.register(wallet, teacherWallet.id);
    const ledgerRows = await readLedgerRowsForWallet(teacherWallet.id);
    expect(ledgerRows).toHaveLength(1);
    const earningRow = ledgerRows[0];
    expect(earningRow?.type).toBe(TransactionType.Earning);
    expect(earningRow?.status).toBe(TransactionStatus.Completed);
    expect(earningRow?.amount).toBe(SESSION_FEE_HIFZ);
    expect(earningRow?.sessionId).toBe(sessionC.id);
    stepCEarningRow = earningRow;
    trackedLedgerRowIds.push(stepCEarningRow.id);

    // The wallet was credited by EXACTLY the session fee once.
    expect(teacherWallet.balance).toBe(SESSION_FEE_HIFZ);
    expect(teacherWallet.totalEarning).toBe(SESSION_FEE_HIFZ);

    // The hold is consumed, not refunded: the lane stays empty.
    expect(await readStudentLanes(student.userId).then(l => l.hifz)).toBe(0);
  });

  test("step D — withdrawal drain race: exactly one payout debit lands; the wallet identity holds on exact decimal strings", async () => {
    type WalletViewResult = Awaited<ReturnType<typeof WalletService.requestWithdrawal>>;
    const outcomes = await Promise.allSettled([
      WalletService.requestWithdrawal(teacher.userId, SESSION_FEE_HIFZ, LOCALE),
      WalletService.requestWithdrawal(teacher.userId, SESSION_FEE_HIFZ, LOCALE),
    ]);

    // Exactly ONE request fulfills; the loser rejects with the funds
    // conflict — a denied request commits zero rows.
    const fulfilled: PromiseFulfilledResult<WalletViewResult>[] = [];
    const rejectedReasons: unknown[] = [];
    for (const outcome of outcomes) {
      if (outcome.status === "fulfilled") {
        fulfilled.push(outcome);
      } else {
        rejectedReasons.push(outcome.reason);
      }
    }
    expect(fulfilled).toHaveLength(1);
    expect(rejectedReasons).toHaveLength(1);
    const reason = rejectedReasons[0];
    expect(reason).toBeInstanceOf(DomainError);
    expect(denialCode(reason)).toBe("WALLET_INSUFFICIENT_FUNDS");
    expect(rejectionMessage(reason)).toBe(errorTexts().insufficientBalance);
    expect(reason).toBeInstanceOf(ConflictError);
    // The wallet is drained to EXACTLY zero.
    const drained = requiredWalletRow(await readTeacherWalletRow(teacher.userId), "teacher wallet after the drain");
    expect(drained.balance).toBe("0.00");
    expect(drained.totalEarning).toBe(SESSION_FEE_HIFZ);

    // The ledger now holds exactly two rows: the earning and the ONE
    // pending withdrawal.
    const ledgerRows = await readLedgerRowsForWallet(teacherWallet.id);
    expect(ledgerRows).toHaveLength(2);
    const earnings = ledgerRows.filter(row => row.type === "earning");
    const withdrawals = ledgerRows.filter(row => row.type === "withdrawal");
    expect(earnings).toHaveLength(1);
    expect(withdrawals).toHaveLength(1);
    expect(withdrawals[0]?.status).toBe(TransactionStatus.Pending);
    expect(withdrawals[0]?.amount).toBe(SESSION_FEE_HIFZ);
    const withdrawalRowId = withdrawals[0]?.id ?? -1;
    expect(withdrawalRowId).toBeGreaterThan(0);
    trackedLedgerRowIds.push(withdrawalRowId);

    // The wallet identity on exact decimal strings: balance = earnings −
    // withdrawals (never `Number()` on an amount).
    const identity = subtractMoney(SESSION_FEE_HIFZ, SESSION_FEE_HIFZ);
    expect(identity).toBe("0.00");
    expect(drained.balance).toBe(identity);
  });

  test("step D2 — input fuzz: the withdrawal amount matrix is rejected pre-DB with zero writes", async () => {
    const invalidAmounts = ["", " ", "abc", "0.00", "-5", "1e9", "12.345", "99999999.00", "1,000"];

    // Each invalid amount is denied through the real service with the
    // typed pre-DB validation code and the exact translated copy.
    const denials = await Promise.all(
      invalidAmounts.map(async amount => {
        const denied = await catchJourneyError(() => WalletService.requestWithdrawal(teacher.userId, amount, LOCALE));
        return { amount, denied };
      })
    );
    expect(denials).toHaveLength(invalidAmounts.length);
    for (const { denied } of denials) {
      expect(denied).toBeInstanceOf(DomainError);
      expect(denialCode(denied)).toBe("WALLET_INVALID_AMOUNT");
      expect(denied.message).toBe(errorTexts().walletInvalidAmount);
    }

    // Zero writes: the balance survives every rejected request, and the
    // fuzz inserted nothing into the ledger either.
    const walletRow = await readTeacherWalletRow(teacher.userId);
    expect(walletRow?.balance).toBe("0.00");
    expect(await countTeacherTransactionsForTeacher(teacher.userId)).toBe(2);
  });

  test("step E — wallet-first-earning race: two concurrent credits over a pre-ensured wallet both land exactly", async () => {
    // TEACHER2's wallet row exists BEFORE the credits race.
    const ensured = await db.transaction(tx => WalletRepository.ensureWalletOnce(teacher2.userId, tx));
    const wallet2 = requiredWalletRow(ensured, "teacher2 pre-ensured wallet");
    registry.register(wallet, wallet2.id);
    expect(await countWalletsForTeacher(teacher2.userId)).toBe(1);

    // Two completed fixture sessions for the teacher — the credits'
    // required session rows (the ledger's session FK is NOT NULL for
    // earnings).
    const fixtureFeeOne = "10.00";
    const fixtureFeeTwo = "15.00";
    const sessionOne = await insertFixtureSession(
      teacher2.userId,
      student.userId,
      fixtureFeeOne,
      `${JOURNEY_PREFIX} earning fixture one`
    );
    const sessionTwo = await insertFixtureSession(
      teacher2.userId,
      student.userId,
      fixtureFeeTwo,
      `${JOURNEY_PREFIX} earning fixture two`
    );

    // Both credits race concurrently on the production path — each opens
    // its own top-level transaction.
    const outcomes = await Promise.allSettled([
      db.transaction(tx =>
        WalletRepository.creditEarningOnce(
          {
            walletId: wallet2.id,
            sessionId: sessionOne,
            amount: fixtureFeeOne,
            description: `${JOURNEY_PREFIX} race credit one`,
          },
          tx
        )
      ),
      db.transaction(tx =>
        WalletRepository.creditEarningOnce(
          {
            walletId: wallet2.id,
            sessionId: sessionTwo,
            amount: fixtureFeeTwo,
            description: `${JOURNEY_PREFIX} race credit two`,
          },
          tx
        )
      ),
    ]);

    // Both credits land — the ensure step is concurrency-safe and the
    // increments are strictly additive.
    expect(outcomes[0]?.status).toBe("fulfilled");
    expect(outcomes[1]?.status).toBe("fulfilled");

    // Exactly ONE wallet row exists for the teacher, with the exact sum.
    expect(await countWalletsForTeacher(teacher2.userId)).toBe(1);
    const after = requiredWalletRow(await readTeacherWalletRow(teacher2.userId), "teacher2 wallet after the race");
    expect(after.balance).toBe(subtractMoney(subtractMoney("0.00", "25.00").replace("-", ""), "0.00"));
    expect(after.balance).toBe("25.00");
    expect(after.totalEarning).toBe("25.00");

    // Exactly TWO earning ledger rows back the totals.
    const ledgerRows = await readLedgerRowsForWallet(after.id);
    expect(ledgerRows).toHaveLength(2);
    expect(ledgerRows.every(row => row.type === "earning")).toBe(true);
    for (const ledgerRow of ledgerRows) {
      trackedLedgerRowIds.push(ledgerRow.id);
    }
  });

  test("step F — adversarial immutability: a direct ledger UPDATE is blocked by the append-only trigger; the row reads back byte-identical", async () => {
    const rowBefore = (
      await db.select().from(teacherTransaction).where(eq(teacherTransaction.id, stepCEarningRow.id))
    )[0];
    expect(rowBefore).toBeDefined();

    // The tamper attempt runs in its own transaction — the trigger aborts
    // it, and the catch happens OUTSIDE the transaction scope so the
    // aborted unit rolls back cleanly.
    let tamperCaught: unknown = null;
    try {
      await db.transaction(async tx => {
        await tx
          .update(teacherTransaction)
          .set({ description: `${JOURNEY_PREFIX} tamper attempt` })
          .where(eq(teacherTransaction.id, stepCEarningRow.id));
      });
    } catch (error) {
      tamperCaught = error;
    }
    expect(tamperCaught).not.toBeNull();
    // Drizzle wraps driver errors: the trigger's RAISE message lives in
    // the caught error's cause chain, so walk it before asserting.
    const messageParts: string[] = [tamperCaught instanceof Error ? tamperCaught.message : String(tamperCaught)];
    let cause: unknown = tamperCaught instanceof Error ? tamperCaught.cause : undefined;
    while (cause instanceof Error) {
      messageParts.push(cause.message);
      cause = cause.cause;
    }
    expect(messageParts.join(" | ")).toContain("teacher_transaction is immutable");

    // The row reads back byte-identical: the trigger is load-bearing.
    const rowsAfter = await db.select().from(teacherTransaction).where(eq(teacherTransaction.id, stepCEarningRow.id));
    const rowAfter = rowsAfter[0];
    expect(rowAfter).toBeDefined();
    expect(rowAfter?.amount).toBe(SESSION_FEE_HIFZ);
    expect(rowAfter?.description).toBe(rowBefore?.description);
    expect(rowAfter?.type).toBe(TransactionType.Earning);
  });

  test("step G — denials: non-participant mutations and a foreign wallet read fail oracle-safely while owner rows stay byte-identical", async () => {
    const ownerRowBefore = await readSessionRow(sessionC.id);
    expect(ownerRowBefore.status).toBe(SessionStatus.Completed);
    expect(ownerRowBefore.confirmedByStudentAt).not.toBeNull();

    // The non-participant student's confirm attempt: the ownership
    // predicate is participant-owned, so a mismatch is answered by the
    // oracle-safe not-found error (foreign ≡ nonexistent).
    await expectServiceDenial("SESSION_NOT_FOUND", errorTexts().sessionNotFound, () =>
      SessionLifecycleService.confirmSessionCompletion(nonParticipant.userId, sessionC.id, LOCALE)
    );

    // The non-participant student's cancel attempt: the same oracle-safe
    // denial through the real authorization path.
    await expectServiceDenial("SESSION_NOT_FOUND", errorTexts().sessionNotFound, () =>
      SessionLifecycleService.cancelSession(
        nonParticipant.userId,
        sessionC.id,
        `${JOURNEY_PREFIX} denial probe`,
        LOCALE
      )
    );

    // The owner's row is byte-identical after both denials.
    const ownerRowAfter = await readSessionRow(sessionC.id);
    expect(ownerRowAfter.status).toBe(ownerRowBefore.status);
    expect(ownerRowAfter.confirmedByStudentAt?.getTime()).toBe(ownerRowBefore.confirmedByStudentAt?.getTime());
    expect(ownerRowAfter.confirmedByTeacherAt?.getTime()).toBe(ownerRowBefore.confirmedByTeacherAt?.getTime());

    // The parent has no teacher profile row: the wallet read is denied
    // with the typed profile-missing code and the exact translated copy.
    await expectServiceDenial("WALLET_TEACHER_PROFILE_MISSING", errorTexts().walletTeacherProfileMissing, () =>
      WalletService.getMyWallet(parent.userId, LOCALE)
    );
  });

  test("step H — teardown worklist is complete: every service-created row is tracked for the afterAll hard-delete", () => {
    // 12 fixture rows (6 users + 6 role-children) + 4 sessions + 2
    // idempotency claims + 2 wallets — all on the registry; the 4
    // append-only ledger rows live on the explicit trackedLedgerRowIds
    // worklist (their DELETE is trigger-blocked outside the suspension
    // window, so the registry cannot drain them).
    expect(registry.size).toBe(20);
    expect(registry.records.filter(record => record.table === session)).toHaveLength(4);
    expect(registry.records.filter(record => record.table === sessionRequestIdempotency)).toHaveLength(2);
    expect(registry.records.filter(record => record.table === wallet)).toHaveLength(2);
    expect(trackedLedgerRowIds).toHaveLength(4);
    expect(admin.userId).toBeGreaterThan(0);
  });
});
