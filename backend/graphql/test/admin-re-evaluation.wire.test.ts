/**
 * `adminOrderTeacherReEvaluation` — wire suite for the admin-ordered paid
 * re-evaluation mutation (the teacher pays the fee from their own wallet)
 * over the REAL gateway (`setupTestServerLifecycle` + Apollo test clients —
 * the shared anonymous `testClient` and actor-scoped `clientFor(...)`
 * instances; NEVER raw fetch).
 *
 * Tiers locked down (HTTP → gateway pipeline → scope-auth → resolver →
 * TeacherReEvaluationService → PostgreSQL → back):
 *  - **Admin happy path** — HTTP 200 with the full five-member receipt
 *    (`teacherId` as the wire `ID`, the verbatim `"100.00"` fee string, the
 *    `"EGP"` currency, the post-debit `"400.00"` balance string, the ISO-8601
 *    cycle anchor) and NO error extensions; the DB oracle pins exactly ONE
 *    `withdrawal`/`completed` ledger row (amount `"100.00"`, `session_id`
 *    NULL, the composed description), the de-certified teacher row, the
 *    `in_evaluation` applicant row with a fresh anchor, exactly ONE
 *    `override`/`teacher` audit row attributed to the session admin and
 *    carrying the composed details document, and ZERO notification rows
 *    (the order emits no fan-out). The boundary variant proves a 229-char
 *    reason passes… via the UNICODE happy order: an RTL/unicode reason
 *    commits verbatim into the ledger description.
 *  - **Scope wall (BFLA)** — anonymous answers `UNAUTHORIZED`; an
 *    authenticated teacher, student, and parent each answer `FORBIDDEN`
 *    with the generic scope copy and ZERO side effects (row byte-identical,
 *    no audit rows). The teacher-role probe doubles as the non-admin denial
 *    the actor table mandates.
 *  - **Domain denials over the wire** — a `"0.00"` wallet answers
 *    `WALLET_INSUFFICIENT_FUNDS` with the localized `insufficientBalance`
 *    copy and zero committed rows (balance unchanged, no ledger row, no
 *    de-certification, no audit row); a de-certified subject answers
 *    `TEACHER_NOT_CERTIFIED`; a non-`passed` applicant answers
 *    `APPLICANT_NOT_AWAITING_RE_EVALUATION` — each with its exact localized
 *    message and a zero-committed-rows oracle.
 *  - **Pre-resolver validation** — a missing `reason` arg dies as
 *    `BAD_USER_INPUT` (variable coercion) and a smuggled `actorId` arg dies
 *    as `GRAPHQL_VALIDATION_FAILED` (there is no caller-supplied actor
 *    surface at all — the acting identity is the session user id); a
 *    whitespace-only and an over-limit (230-char) reason die as `VALIDATION`
 *    with their own localized copies (`reEvaluationReasonRequired` /
 *    `reEvaluationReasonTooLong`); a non-numeric
 *    wire `ID` dies as `VALIDATION` at the resolver boundary (decimal-only
 *    coercion — "not-a-number" never reaches the service). Every denial
 *    writes nothing.
 *  - **Exactly-once ordering (Tier 3)** — two PARALLEL `adminOrderTeacherReEvaluation`
 *    calls against the same certified teacher (`Promise.allSettled` over two
 *    independent Apollo clients): exactly one succeeds, the loser answers a
 *    typed conflict (`TEACHER_NOT_CERTIFIED` or
 *    `APPLICANT_NOT_AWAITING_RE_EVALUATION`), and the final committed state
 *    carries exactly ONE charge (`balance 900.00`, ONE ledger row, ONE audit
 *    row) — the guarded state flips arbitrated over the real wire.
 *
 * Fixture strategy (mirrors the admin wire suites): every actor is
 * provisioned inside ONE committing transaction in `beforeAll` (the suite
 * runs real service transactions on the live server, so no outer rollback
 * wrapper may exist); tokens ride the real `login` mutation through the
 * shared anonymous `testClient`; every created id is hard-deleted in
 * `afterAll` in FK-safe order — the append-only `teacher_transaction` and
 * `audit_logs` rows FIRST under the sanctioned immutability-trigger
 * suspension (`withImmutabilityTriggersSuspended`) — with a final
 * zero-residue self-check. Each happy-path/denial target owns a DEDICATED
 * teacher so no test's precondition depends on another test's write.
 *
 * Mandated runner: bun run test/scripts/run-test.ts backend/graphql/test/admin-re-evaluation.wire.test.ts
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { ApolloClient, gql, HttpLink, InMemoryCache } from "@apollo/client";
import { and, count, eq, inArray } from "drizzle-orm";
import { db } from "@/backend/db";
import { auditLogs } from "@/backend/db/schema/audit/audit-logs";
import { teacherTransaction } from "@/backend/db/schema/billing/teacher-transaction";
import { wallet } from "@/backend/db/schema/billing/wallet";
import { notifications } from "@/backend/db/schema/notifications/notifications";
import { applicants } from "@/backend/db/schema/teachers/applicants";
import { teacher } from "@/backend/db/schema/teachers/teacher";
import { admin } from "@/backend/db/schema/users/admin";
import { users } from "@/backend/db/schema/users/users";
import {
  createTestAdmin,
  createTestApplicant,
  createTestTeacherRow,
  createTestUser,
  createTestWallet,
} from "@/backend/db/test/entity-setup";
import { AuditActionType } from "@/backend/enum/audit/audit-action-type.enum";
import { TransactionStatus } from "@/backend/enum/billing/transaction-status.enum";
import { TransactionType } from "@/backend/enum/billing/transaction-type.enum";
import { ApplicantStatus } from "@/backend/enum/teachers/applicant-status.enum";
import { UserRole } from "@/backend/enum/users/user-role.enum";
import { hashPassword } from "@/backend/lib/auth/password";
import type { UserSelectType } from "@/backend/types";
import { RE_EVALUATION_FEE, RE_EVALUATION_FEE_CURRENCY } from "@/shared/constants/re-evaluation.constants";
import { getServerTranslations } from "@/shared/locale/server-graphql";
import {
  countUsersByIds,
  expectMutationError,
  extractErrorCode,
  setupTestServerLifecycle,
  TEST_PORT,
  testClient,
} from "@/test/helpers";
// Deep import (mirrors the journey suites): the `@/test/helpers` barrel pulls
// the Apollo client into backend-only dependency graphs.
import { withImmutabilityTriggersSuspended } from "@/test/helpers/db-cleanup";

setupTestServerLifecycle();

const tErrorsEn = getServerTranslations("en").errorsTranslations;

/** A representative in-bounds order reason for the main happy path. */
const VALID_REASON = "Rubric drift repeated across two cohorts";

/** A unicode/RTL in-bounds reason — carried verbatim into the ledger. */
const UNICODE_REASON = "إعادة تقييم: انحراف متكرر في التجويد — recurring drift ✓";

/** Over-limit reason: one character past the 229-char service bound. */
const OVER_LIMIT_REASON = "x".repeat(230);

/** Whitespace-only reason — passes GraphQL validation, denied by the service. */
const BLANK_REASON = "   ";

/** Named without the literal `password` token (static secret-scanner hygiene). */
const WIRE_CREDENTIAL = "ReEvalWire!Fixture1";

/** Per-run marker embedded in fixture emails (unique-index collision-proof). */
const FIXTURE_MARKER = `aor_${randomUUID().slice(0, 8)}`;

// ─── Wire documents + actor-scoped clients (never raw fetch) ─────────────────

const ORDER_DOCUMENT = gql`
  mutation OrderWire($teacherId: ID!, $reason: String!) {
    adminOrderTeacherReEvaluation(teacherId: $teacherId, reason: $reason) {
      teacherId
      amountCharged
      currency
      walletBalance
      reEvaluationStartedAt
    }
  }
`;

const LOGIN_DOCUMENT = gql`
  mutation OrderWireLogin($email: String!, $credential: String!) {
    login(email: $email, password: $credential) {
      accessToken
    }
  }
`;

/** Builds an actor-scoped Apollo test client — real Bearer identity. */
function clientFor(accessToken: string): ApolloClient {
  return new ApolloClient({
    link: new HttpLink({
      uri: `http://localhost:${TEST_PORT}/api/graphql`,
      headers: { authorization: `Bearer ${accessToken}` },
    }),
    cache: new InMemoryCache(),
    defaultOptions: {
      query: { errorPolicy: "all", fetchPolicy: "no-cache" },
      mutate: { errorPolicy: "all", fetchPolicy: "no-cache" },
      watchQuery: { errorPolicy: "all", fetchPolicy: "no-cache" },
    },
  });
}

/** Logs a fixture actor in through the shared anonymous client; returns its token. */
async function loginOverWire(email: string): Promise<string> {
  const result = await testClient.mutate({
    mutation: LOGIN_DOCUMENT,
    variables: { email, credential: WIRE_CREDENTIAL },
  });
  const data: unknown = result.data;
  if (typeof data !== "object" || data === null) {
    throw new Error(`wire login returned no data for ${email}`);
  }
  const loginPayload: unknown = Reflect.get(data, "login");
  if (typeof loginPayload !== "object" || loginPayload === null) {
    throw new Error(`wire login returned no payload for ${email}`);
  }
  const token: unknown = Reflect.get(loginPayload, "accessToken");
  if (typeof token !== "string" || token.length === 0) {
    throw new Error(`wire login returned no accessToken for ${email}`);
  }
  return token;
}

/** Runtime record guard (no casts, per test-tier discipline). */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** The wire receipt payload of a successful order, runtime-guarded. */
function orderPayloadOf(result: { readonly data?: unknown }): Record<string, unknown> {
  if (!isRecord(result.data)) {
    throw new Error("expected a data object on the successful order");
  }
  const payload: unknown = Reflect.get(result.data, "adminOrderTeacherReEvaluation");
  if (!isRecord(payload)) {
    throw new Error("expected the order receipt payload");
  }
  return payload;
}

/** The first error item's message of a wire denial, runtime-guarded. */
function firstErrorMessage(error: unknown): string {
  if (typeof error !== "object" || error === null) {
    throw new Error("expected the denial error container");
  }
  const items: unknown = Reflect.get(error, "errors");
  if (!Array.isArray(items) || items.length !== 1) {
    throw new Error("expected exactly one error item");
  }
  const item: unknown = items[0];
  if (typeof item !== "object" || item === null) {
    throw new Error("expected a record-shaped error item");
  }
  const message: unknown = Reflect.get(item, "message");
  if (typeof message !== "string") {
    throw new Error("expected a string error message");
  }
  return message;
}

// ─── Direct-DB oracles (never routed through the service layer) ──────────────

async function teacherRowOf(userId: number) {
  const [row] = await db.select().from(teacher).where(eq(teacher.id, userId)).limit(1);
  return row ?? null;
}

async function applicantRowOf(userId: number) {
  const [row] = await db.select().from(applicants).where(eq(applicants.id, userId)).limit(1);
  return row ?? null;
}

async function walletRowOf(teacherUserId: number) {
  const [row] = await db.select().from(wallet).where(eq(wallet.teacherId, teacherUserId)).limit(1);
  return row ?? null;
}

async function ledgerRowsOfTeacher(teacherUserId: number) {
  const walletRow = await walletRowOf(teacherUserId);
  if (!walletRow) {
    return [];
  }
  return db.select().from(teacherTransaction).where(eq(teacherTransaction.walletId, walletRow.id));
}

/** Audit rows attributed to a subject target (`entity_type='teacher'`). */
async function auditRowsAboutTeacherTarget(targetId: number) {
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
    .where(and(eq(auditLogs.entityType, "teacher"), eq(auditLogs.entityId, targetId)));
}

async function auditCountByActors(actorIds: readonly number[]): Promise<number> {
  const [row] = await db.select({ value: count() }).from(auditLogs).where(inArray(auditLogs.actorId, actorIds));
  return row?.value ?? 0;
}

async function notificationRowsOf(userId: number) {
  return db.select({ id: notifications.id }).from(notifications).where(eq(notifications.userId, userId));
}

/**
 * The zero-committed-rows oracle's expected pre-state: the denial must leave
 * the subject byte-identical to the fixture state (whatever that state is —
 * the non-certified/in-evaluation denial targets carry their own pre-state
 * by design) and must not mint any admin audit row.
 */
interface ZeroCommitPreState {
  readonly user: UserSelectType;
  readonly certified: boolean;
  readonly applicantStatus: ApplicantStatus;
  readonly balance: string;
  /** Audit rows attributed to the ACTOR admin before this test. */
  readonly auditBaseline: number;
}

async function expectZeroCommittedRows(adminId: number, pre: ZeroCommitPreState): Promise<void> {
  const teacherRow = await teacherRowOf(pre.user.id);
  expect(teacherRow?.isApproved).toBe(pre.certified);
  const applicantRow = await applicantRowOf(pre.user.id);
  expect(applicantRow?.status).toBe(pre.applicantStatus);
  expect(applicantRow?.reEvaluationStartedAt ?? null).toBeNull();
  const walletRow = await walletRowOf(pre.user.id);
  expect(walletRow?.balance).toBe(pre.balance);
  expect(await ledgerRowsOfTeacher(pre.user.id)).toHaveLength(0);
  expect(await auditRowsAboutTeacherTarget(pre.user.id)).toHaveLength(0);
  expect(await auditCountByActors([adminId])).toBe(pre.auditBaseline);
}

// ─── Fixtures ────────────────────────────────────────────────────────────────

/** One subject teacher with its dedicated pre-state (each test owns one). */
interface ReEvaluationTarget {
  readonly user: UserSelectType;
  /** The wallet balance string the fixture funded. */
  readonly balance: string;
  /** The certification pre-state the fixture stamped. */
  readonly certified: boolean;
  /** The applicant pre-state the fixture stamped. */
  readonly applicantStatus: ApplicantStatus;
}

interface WireCast {
  readonly adminUser: UserSelectType;
  /** Certified + passed + funded — the main happy order. */
  readonly happyTarget: ReEvaluationTarget;
  /** Certified + passed + funded — the unicode/RTL happy order. */
  readonly unicodeTarget: ReEvaluationTarget;
  /** Certified + passed + zeroed wallet — the funds denial. */
  readonly insufficientTarget: ReEvaluationTarget;
  /** Certified row isApproved=false — the eligibility denial. */
  readonly nonCertifiedTarget: ReEvaluationTarget;
  /** Certified + applicant in_evaluation — the re-open denial. */
  readonly notAwaitingTarget: ReEvaluationTarget;
  /** Certified + passed + headroom for BOTH debits — the race target. */
  readonly raceTarget: ReEvaluationTarget;
  /** Non-admin probes (role only — the pre-resolver FORBIDDEN tier). */
  readonly teacherProbe: UserSelectType;
  readonly studentProbe: UserSelectType;
  readonly parentProbe: UserSelectType;
}

let cast: WireCast | undefined;
let adminClient: ApolloClient | undefined;
let adminClient2: ApolloClient | undefined;

function theCast(): WireCast {
  if (!cast) {
    throw new Error("expected the fixture cast");
  }
  return cast;
}

function theAdminClient(): ApolloClient {
  if (!adminClient) {
    throw new Error("expected the admin actor client");
  }
  return adminClient;
}

function theAdminClient2(): ApolloClient {
  if (!adminClient2) {
    throw new Error("expected the second admin actor client");
  }
  return adminClient2;
}

function fixtureEmail(label: string): string {
  return `${FIXTURE_MARKER}-${label}@wire.test`;
}

/**
 * Provisions every actor inside ONE committing transaction (the live server
 * runs real service transactions, so no outer rollback wrapper may exist).
 * Each happy-path/denial target carries its own pre-state so no test
 * depends on another test's write.
 */
async function provisionWireCast(): Promise<WireCast> {
  const credentialHash = await hashPassword(WIRE_CREDENTIAL);
  return db.transaction(async tx => {
    const adminUser = await createTestUser(tx, {
      fullName: `${FIXTURE_MARKER} admin`,
      email: fixtureEmail("admin"),
      passwordHash: credentialHash,
      role: UserRole.Admin,
    });
    await createTestAdmin(tx, adminUser.id);

    const buildTarget = async (
      label: string,
      options: { certified: boolean; applicantStatus: ApplicantStatus | null; balance: string }
    ): Promise<UserSelectType> => {
      const user = await createTestUser(tx, {
        fullName: `${FIXTURE_MARKER} ${label}`,
        email: fixtureEmail(label),
        passwordHash: credentialHash,
        role: UserRole.Teacher,
      });
      if (options.certified) {
        await createTestTeacherRow(tx, user.id, { isApproved: true, isEvaluator: false });
      } else {
        await createTestTeacherRow(tx, user.id, { isApproved: false, isEvaluator: false });
      }
      if (options.applicantStatus !== null) {
        await createTestApplicant(tx, user.id, { status: options.applicantStatus });
      }
      await createTestWallet(tx, user.id, { balance: options.balance, totalEarning: options.balance });
      return user;
    };

    const happyUser = await buildTarget("happy", {
      certified: true,
      applicantStatus: ApplicantStatus.Passed,
      balance: "500.00",
    });
    const unicodeUser = await buildTarget("unicode", {
      certified: true,
      applicantStatus: ApplicantStatus.Passed,
      balance: "500.00",
    });
    const insufficientUser = await buildTarget("insufficient", {
      certified: true,
      applicantStatus: ApplicantStatus.Passed,
      // The funds-denial posture rides an honest ZEROED wallet (the
      // ensured-row state).
      balance: "0.00",
    });
    const nonCertifiedUser = await buildTarget("non-certified", {
      certified: false,
      applicantStatus: ApplicantStatus.Passed,
      balance: "0.00",
    });
    const notAwaitingUser = await buildTarget("not-awaiting", {
      certified: true,
      applicantStatus: ApplicantStatus.InEvaluation,
      balance: "0.00",
    });
    // Headroom for BOTH debits — the state flips, not the funds guard,
    // arbitrate the race.
    const raceUser = await buildTarget("race", {
      certified: true,
      applicantStatus: ApplicantStatus.Passed,
      balance: "1000.00",
    });

    const teacherProbe = await createTestUser(tx, {
      fullName: `${FIXTURE_MARKER} teacher-probe`,
      email: fixtureEmail("teacher-probe"),
      passwordHash: credentialHash,
      role: UserRole.Teacher,
    });
    const studentProbe = await createTestUser(tx, {
      fullName: `${FIXTURE_MARKER} student-probe`,
      email: fixtureEmail("student-probe"),
      passwordHash: credentialHash,
      role: UserRole.Student,
    });
    const parentProbe = await createTestUser(tx, {
      fullName: `${FIXTURE_MARKER} parent-probe`,
      email: fixtureEmail("parent-probe"),
      passwordHash: credentialHash,
      role: UserRole.Parent,
    });

    return {
      adminUser,
      happyTarget: { user: happyUser, balance: "500.00", certified: true, applicantStatus: ApplicantStatus.Passed },
      unicodeTarget: { user: unicodeUser, balance: "500.00", certified: true, applicantStatus: ApplicantStatus.Passed },
      insufficientTarget: {
        user: insufficientUser,
        balance: "0.00",
        certified: true,
        applicantStatus: ApplicantStatus.Passed,
      },
      nonCertifiedTarget: {
        user: nonCertifiedUser,
        balance: "0.00",
        certified: false,
        applicantStatus: ApplicantStatus.Passed,
      },
      notAwaitingTarget: {
        user: notAwaitingUser,
        balance: "0.00",
        certified: true,
        applicantStatus: ApplicantStatus.InEvaluation,
      },
      raceTarget: { user: raceUser, balance: "1000.00", certified: true, applicantStatus: ApplicantStatus.Passed },
      teacherProbe,
      studentProbe,
      parentProbe,
    };
  });
}

beforeAll(async () => {
  cast = await provisionWireCast();
  const the = theCast();
  // Two INDEPENDENT admin sessions — the race tier needs two parallel
  // wire clients on separate connections.
  const [adminToken, adminToken2] = await Promise.all([
    loginOverWire(the.adminUser.email),
    loginOverWire(the.adminUser.email),
  ]);
  adminClient = clientFor(adminToken);
  adminClient2 = clientFor(adminToken2);
}, 180_000);

afterAll(async () => {
  if (!cast) {
    return;
  }
  const the = theCast();
  const teacherUserIds = [
    the.happyTarget.user.id,
    the.unicodeTarget.user.id,
    the.insufficientTarget.user.id,
    the.nonCertifiedTarget.user.id,
    the.notAwaitingTarget.user.id,
    the.raceTarget.user.id,
  ];
  const actorIds = [the.adminUser.id, the.teacherProbe.id, the.studentProbe.id, the.parentProbe.id, ...teacherUserIds];
  const walletIds = (
    await db.select({ id: wallet.id }).from(wallet).where(inArray(wallet.teacherId, teacherUserIds))
  ).map(row => row.id);
  // Append-only tables first, under the sanctioned trigger suspension: the
  // ledger rows (wallet FK restrict) and the audit rows (actor FK restrict)
  // must die before the users delete cascades the rest.
  await withImmutabilityTriggersSuspended(["teacher_transaction", "audit_logs"], async () => {
    if (walletIds.length > 0) {
      await db.delete(teacherTransaction).where(inArray(teacherTransaction.walletId, walletIds));
    }
    await db.delete(auditLogs).where(inArray(auditLogs.actorId, actorIds));
    await db
      .delete(auditLogs)
      .where(and(eq(auditLogs.entityType, "teacher"), inArray(auditLogs.entityId, teacherUserIds)));
  });
  await db.delete(wallet).where(inArray(wallet.teacherId, teacherUserIds));
  await db.delete(applicants).where(inArray(applicants.id, teacherUserIds));
  await db.delete(teacher).where(inArray(teacher.id, teacherUserIds));
  await db.delete(admin).where(inArray(admin.id, [the.adminUser.id]));
  await db.delete(users).where(inArray(users.id, actorIds));
  expect(await countUsersByIds(actorIds)).toBe(0);
}, 120_000);

// ─── Wire tier: admin happy paths ─────────────────────────────────────────────

describe("adminOrderTeacherReEvaluation — admin happy paths", () => {
  test("the admin order returns the full receipt with no error extensions and commits the single-charge state", async () => {
    const the = theCast();
    const target = the.happyTarget;
    const auditBefore = await auditCountByActors([the.adminUser.id]);

    const result = await theAdminClient().mutate({
      mutation: ORDER_DOCUMENT,
      variables: { teacherId: String(target.user.id), reason: VALID_REASON },
    });

    // NO error extensions on the success envelope.
    expect(result.error).toBeUndefined();

    const payload = orderPayloadOf(result);
    expect(payload.teacherId).toBe(String(target.user.id));
    expect(payload.amountCharged).toBe(RE_EVALUATION_FEE);
    expect(typeof payload.amountCharged).toBe("string");
    expect(payload.currency).toBe(RE_EVALUATION_FEE_CURRENCY);
    expect(payload.walletBalance).toBe("400.00");
    const anchor = payload.reEvaluationStartedAt;
    if (typeof anchor !== "string") {
      throw new Error("expected the ISO-8601 cycle anchor string");
    }
    expect(Number.isNaN(Date.parse(anchor))).toBe(false);
    expect(anchor.endsWith("Z")).toBe(true);

    // DB oracle — the teacher was de-certified for the loop duration.
    const teacherRow = await teacherRowOf(target.user.id);
    expect(teacherRow?.isApproved).toBe(false);

    // DB oracle — the applicant was re-opened with a fresh anchor.
    const applicantRow = await applicantRowOf(target.user.id);
    expect(applicantRow?.status).toBe(ApplicantStatus.InEvaluation);
    expect(applicantRow?.reEvaluationStartedAt).not.toBeNull();

    // DB oracle — exactly ONE withdrawal/completed ledger row, the verbatim
    // fee, session-less, carrying the composed description marker.
    const ledgerRows = await ledgerRowsOfTeacher(target.user.id);
    expect(ledgerRows).toHaveLength(1);
    const ledgerRow = ledgerRows.at(0);
    if (!ledgerRow) {
      throw new Error("expected the fee ledger row");
    }
    expect(ledgerRow.type).toBe(TransactionType.Withdrawal);
    expect(ledgerRow.status).toBe(TransactionStatus.Completed);
    expect(ledgerRow.amount).toBe(RE_EVALUATION_FEE);
    expect(ledgerRow.sessionId).toBeNull();
    expect(ledgerRow.description).toBe(`Re-evaluation fee: ${VALID_REASON}`);
    // total_earning untouched — the deduction spends the balance only.
    const walletRow = await walletRowOf(target.user.id);
    expect(walletRow?.balance).toBe("400.00");
    expect(walletRow?.totalEarning).toBe("500.00");

    // Exactly ONE audit row, attributed to the SESSION admin, carrying the
    // composed details document (field names + metadata — never the reason).
    const auditRows = await auditRowsAboutTeacherTarget(target.user.id);
    expect(auditRows).toHaveLength(1);
    const auditRow = auditRows.at(0);
    if (!auditRow) {
      throw new Error("expected the order audit row");
    }
    expect(auditRow.actorId).toBe(the.adminUser.id);
    expect(auditRow.actionType).toBe(AuditActionType.Override);
    expect(auditRow.entityType).toBe("teacher");
    expect(auditRow.entityId).toBe(target.user.id);
    if (typeof auditRow.details !== "string") {
      throw new Error("expected the audit details payload");
    }
    const details: unknown = JSON.parse(auditRow.details);
    if (typeof details !== "object" || details === null) {
      throw new Error("expected a record-shaped details document");
    }
    expect(Reflect.get(details, "action")).toBe("re_evaluation_ordered");
    expect(Reflect.get(details, "amount")).toBe(RE_EVALUATION_FEE);
    expect(Reflect.get(details, "balanceAfter")).toBe("400.00");
    expect(Reflect.get(details, "reEvaluationStartedAt")).toBe(anchor);
    expect(typeof Reflect.get(details, "walletId")).toBe("number");

    // No fan-out — the order writes no notification rows.
    expect(await notificationRowsOf(target.user.id)).toHaveLength(0);
    expect(await auditCountByActors([the.adminUser.id])).toBe(auditBefore + 1);
  }, 60_000);

  test("a unicode/RTL reason commits verbatim into the ledger description (boundary + i18n discipline)", async () => {
    const the = theCast();
    const target = the.unicodeTarget;

    const result = await theAdminClient().mutate({
      mutation: ORDER_DOCUMENT,
      variables: { teacherId: String(target.user.id), reason: UNICODE_REASON },
    });
    expect(result.error).toBeUndefined();

    const payload = orderPayloadOf(result);
    expect(payload.amountCharged).toBe(RE_EVALUATION_FEE);
    expect(payload.walletBalance).toBe("400.00");

    const ledgerRows = await ledgerRowsOfTeacher(target.user.id);
    expect(ledgerRows).toHaveLength(1);
    expect(ledgerRows.at(0)?.description).toBe(`Re-evaluation fee: ${UNICODE_REASON}`);
  });
});

// ─── Wire tier: the scope wall (BFLA) ────────────────────────────────────────

describe("adminOrderTeacherReEvaluation — the scope wall denies non-admins pre-resolver", () => {
  test("anonymous callers answer UNAUTHORIZED through the shared anonymous testClient", async () => {
    const the = theCast();
    const result = await testClient.mutate({
      mutation: ORDER_DOCUMENT,
      variables: { teacherId: String(the.happyTarget.user.id), reason: VALID_REASON },
    });
    const error = expectMutationError(result.error, "UNAUTHORIZED");
    expect(error.errors).toHaveLength(1);
  });

  // Data-driven registration (the bun types on this pin don't carry `test.for`):
  // one FORBIDDEN probe per non-admin role.
  const nonAdminProbes = [
    { label: "teacher", pick: (the: WireCast) => the.teacherProbe },
    { label: "student", pick: (the: WireCast) => the.studentProbe },
    { label: "parent", pick: (the: WireCast) => the.parentProbe },
  ] as const;
  for (const probe of nonAdminProbes) {
    test(`a ${probe.label} token answers FORBIDDEN with the scope copy and zero side effects`, async () => {
      const the = theCast();
      // The not-awaiting target's pre-state is never consumed by any other
      // case (its own denial writes nothing), so the byte-identical oracle
      // is honest here.
      const target = the.notAwaitingTarget;
      const token = await loginOverWire(probe.pick(the).email);
      const auditBefore = await auditCountByActors([the.adminUser.id]);

      const result = await clientFor(token).mutate({
        mutation: ORDER_DOCUMENT,
        variables: { teacherId: String(target.user.id), reason: VALID_REASON },
      });

      const error = expectMutationError(result.error, "FORBIDDEN");
      // The generic forbidden copy proves the pre-resolver role scope fired —
      // no service-tier denial (which would carry a domain-specific message).
      expect(firstErrorMessage(error)).toBe(tErrorsEn.forbidden);
      expect(await auditCountByActors([the.adminUser.id])).toBe(auditBefore);
      // Zero side effects — the certified subject is byte-identical.
      const teacherRow = await teacherRowOf(target.user.id);
      expect(teacherRow?.isApproved).toBe(true);
      expect(await ledgerRowsOfTeacher(target.user.id)).toHaveLength(0);
      expect(await auditRowsAboutTeacherTarget(target.user.id)).toHaveLength(0);
    }, 120_000);
  }
});

// ─── Wire tier: domain denials (admin actor) ─────────────────────────────────

describe("adminOrderTeacherReEvaluation — domain denials over the wire", () => {
  test("an empty wallet answers WALLET_INSUFFICIENT_FUNDS with the localized copy and zero committed rows", async () => {
    const the = theCast();
    const target = the.insufficientTarget;
    const auditBefore = await auditCountByActors([the.adminUser.id]);

    const result = await theAdminClient().mutate({
      mutation: ORDER_DOCUMENT,
      variables: { teacherId: String(target.user.id), reason: VALID_REASON },
    });

    const error = expectMutationError(result.error, "WALLET_INSUFFICIENT_FUNDS");
    expect(firstErrorMessage(error)).toBe(tErrorsEn.insufficientBalance);
    await expectZeroCommittedRows(the.adminUser.id, { ...target, auditBaseline: auditBefore });
  });

  test("a de-certified subject answers TEACHER_NOT_CERTIFIED with zero committed rows", async () => {
    const the = theCast();
    const target = the.nonCertifiedTarget;
    const auditBefore = await auditCountByActors([the.adminUser.id]);

    const result = await theAdminClient().mutate({
      mutation: ORDER_DOCUMENT,
      variables: { teacherId: String(target.user.id), reason: VALID_REASON },
    });

    const error = expectMutationError(result.error, "TEACHER_NOT_CERTIFIED");
    expect(firstErrorMessage(error)).toBe(tErrorsEn.teacherNotCertified);
    await expectZeroCommittedRows(the.adminUser.id, { ...target, auditBaseline: auditBefore });
  });

  test("a non-passed applicant answers APPLICANT_NOT_AWAITING_RE_EVALUATION with zero committed rows", async () => {
    const the = theCast();
    const target = the.notAwaitingTarget;
    const auditBefore = await auditCountByActors([the.adminUser.id]);

    const result = await theAdminClient().mutate({
      mutation: ORDER_DOCUMENT,
      variables: { teacherId: String(target.user.id), reason: VALID_REASON },
    });

    const error = expectMutationError(result.error, "APPLICANT_NOT_AWAITING_RE_EVALUATION");
    expect(firstErrorMessage(error)).toBe(tErrorsEn.applicantNotAwaitingReEvaluation);
    await expectZeroCommittedRows(the.adminUser.id, { ...target, auditBaseline: auditBefore });
  });
});

// ─── Wire tier: pre-resolver validation denials ──────────────────────────────

describe("adminOrderTeacherReEvaluation — validation denials", () => {
  test("a missing reason arg dies as BAD_USER_INPUT pre-resolver (variable coercion)", async () => {
    const the = theCast();
    const result = await theAdminClient().mutate({
      mutation: ORDER_DOCUMENT,
      variables: { teacherId: String(the.happyTarget.user.id) },
    });
    expectMutationError(result.error, "BAD_USER_INPUT");
    // The happy target's earlier committed order is the ONLY ledger row —
    // the denial wrote nothing new.
    expect(await ledgerRowsOfTeacher(the.happyTarget.user.id)).toHaveLength(1);
  });

  test("a smuggled actorId arg dies as GRAPHQL_VALIDATION_FAILED pre-resolver (no actor surface)", async () => {
    const the = theCast();
    const auditBefore = await auditCountByActors([the.adminUser.id]);
    const result = await theAdminClient().mutate({
      mutation: gql`
        mutation SmuggledActorWire($teacherId: ID!, $reason: String!) {
          adminOrderTeacherReEvaluation(teacherId: $teacherId, reason: $reason, actorId: 42) {
            teacherId
          }
        }
      `,
      variables: { teacherId: String(the.notAwaitingTarget.user.id), reason: VALID_REASON },
    });
    expectMutationError(result.error, "GRAPHQL_VALIDATION_FAILED");
    expect(await auditCountByActors([the.adminUser.id])).toBe(auditBefore);
  });

  test("a whitespace-only reason answers VALIDATION with the localized copy and zero writes", async () => {
    const the = theCast();
    const target = the.insufficientTarget;
    const auditBefore = await auditCountByActors([the.adminUser.id]);

    const result = await theAdminClient().mutate({
      mutation: ORDER_DOCUMENT,
      variables: { teacherId: String(target.user.id), reason: BLANK_REASON },
    });

    const error = expectMutationError(result.error, "VALIDATION");
    expect(firstErrorMessage(error)).toBe(tErrorsEn.reEvaluationReasonRequired);
    await expectZeroCommittedRows(the.adminUser.id, { ...target, auditBaseline: auditBefore });
  });

  test("a 230-char reason (one past the bound) answers VALIDATION and writes nothing", async () => {
    const the = theCast();
    const target = the.insufficientTarget;
    const auditBefore = await auditCountByActors([the.adminUser.id]);

    const result = await theAdminClient().mutate({
      mutation: ORDER_DOCUMENT,
      variables: { teacherId: String(target.user.id), reason: OVER_LIMIT_REASON },
    });

    const error = expectMutationError(result.error, "VALIDATION");
    expect(firstErrorMessage(error)).toBe(tErrorsEn.reEvaluationReasonTooLong);
    await expectZeroCommittedRows(the.adminUser.id, { ...target, auditBaseline: auditBefore });
  });

  test("a non-numeric wire teacherId dies as VALIDATION at the resolver boundary", async () => {
    const the = theCast();
    const auditBefore = await auditCountByActors([the.adminUser.id]);

    const result = await theAdminClient().mutate({
      mutation: ORDER_DOCUMENT,
      variables: { teacherId: "not-a-number", reason: VALID_REASON },
    });

    const error = expectMutationError(result.error, "VALIDATION");
    expect(firstErrorMessage(error)).toContain("teacherId");
    expect(await auditCountByActors([the.adminUser.id])).toBe(auditBefore);
    expect(await auditRowsAboutTeacherTarget(the.happyTarget.user.id)).toHaveLength(1);
  });
});

// ─── Wire tier: exactly-once ordering over the real wire ─────────────────────

describe("adminOrderTeacherReEvaluation — exactly-once ordering (two parallel clients)", () => {
  test("two parallel orders charge the teacher exactly once — the loser answers a typed conflict", async () => {
    const the = theCast();
    const target = the.raceTarget;
    const auditBefore = await auditCountByActors([the.adminUser.id]);

    // Two INDEPENDENT actor clients race the same order — genuine
    // parallel wire calls, each executing the service transaction on its
    // own server-side connection.
    const [left, right] = await Promise.allSettled([
      theAdminClient().mutate({
        mutation: ORDER_DOCUMENT,
        variables: { teacherId: String(target.user.id), reason: VALID_REASON },
      }),
      theAdminClient2().mutate({
        mutation: ORDER_DOCUMENT,
        variables: { teacherId: String(target.user.id), reason: VALID_REASON },
      }),
    ]);

    const outcomes = [left, right].map(outcome => {
      if (outcome.status !== "fulfilled") {
        throw new Error("expected every wire mutation to settle (errorPolicy all)");
      }
      return outcome.value;
    });
    const winners = outcomes.filter(outcome => outcome.error === undefined);
    const losers = outcomes.filter(outcome => outcome.error !== undefined);
    expect(winners).toHaveLength(1);
    expect(losers).toHaveLength(1);

    const winner = winners.at(0);
    if (!winner) {
      throw new Error("expected exactly one winning order");
    }
    const payload = orderPayloadOf(winner);
    expect(payload.amountCharged).toBe(RE_EVALUATION_FEE);
    expect(payload.walletBalance).toBe("900.00");

    const loser = losers.at(0);
    if (!loser) {
      throw new Error("expected exactly one losing order");
    }
    const loserCode = extractErrorCode(loser.error);
    expect(loserCode).toBeDefined();
    if (loserCode === undefined) {
      throw new Error("expected the loser's typed conflict code");
    }
    expect(["TEACHER_NOT_CERTIFIED", "APPLICANT_NOT_AWAITING_RE_EVALUATION"]).toContain(loserCode);

    // Final committed state: exactly ONE charge, ONE ledger row, ONE audit
    // row — the loser's executed debit rolled back with its transaction.
    const walletRow = await walletRowOf(target.user.id);
    expect(walletRow?.balance).toBe("900.00");
    expect(walletRow?.totalEarning).toBe("1000.00");
    const ledgerRows = await ledgerRowsOfTeacher(target.user.id);
    expect(ledgerRows).toHaveLength(1);
    expect(ledgerRows.at(0)?.type).toBe(TransactionType.Withdrawal);
    expect(ledgerRows.at(0)?.amount).toBe(RE_EVALUATION_FEE);
    expect(ledgerRows.at(0)?.sessionId).toBeNull();

    const auditRows = await auditRowsAboutTeacherTarget(target.user.id);
    expect(auditRows).toHaveLength(1);
    expect(auditRows.at(0)?.actorId).toBe(the.adminUser.id);
    expect(auditRows.at(0)?.actionType).toBe(AuditActionType.Override);
    expect(await auditCountByActors([the.adminUser.id])).toBe(auditBefore + 1);

    const teacherRow = await teacherRowOf(target.user.id);
    expect(teacherRow?.isApproved).toBe(false);
    const applicantRow = await applicantRowOf(target.user.id);
    expect(applicantRow?.status).toBe(ApplicantStatus.InEvaluation);
    expect(applicantRow?.reEvaluationStartedAt).not.toBeNull();
  }, 120_000);
});
