/**
 * Journey — direct student onboarding with offline payment (cross-actor
 * workflow through the real gated admin service).
 *
 * One admin onboards three students with offline settlement — cash, bank
 * transfer with a parent link, and scholarship — while the surrounding
 * cast (the onboarded students, the linked parent, an unrelated parent,
 * an unlinked peer student, a certified teacher) observes, reads back, or
 * is denied:
 *
 *  | Step | Actor              | Action                                                     | Shared state                                          | Side effects                    |
 *  |------|--------------------|------------------------------------------------------------|-------------------------------------------------------|---------------------------------|
 *  | 1    | System             | provision admin, 2 parents, peer student, teacher + lane-bearing plan | fixtures committed in ONE transaction       | tracked ids registered          |
 *  | 2    | Admin              | onboards a student, offline cash, no parent                | user + student + active subscription + junction + one lane credit | 2 audit rows (Create), 0 payment rows |
 *  | 3    | Onboarded student  | logs in; reads own subscriptions                           | credited lane observable; active subscription         | none (unlinked peer sees none)  |
 *  | 4    | Admin              | read-back through the existing admin surfaces              | directory row + detail snapshot + admin-attributed audit | none                            |
 *  | 5    | Admin              | onboards a second student, bank transfer, parent linked    | same rows plus `students.parent_id` set               | 2 audit rows, 0 payment rows    |
 *  | 6    | Linked parent      | reads the monitoring children list                         | child visible with no extra ceremony                  | none                            |
 *  | 7    | Other parent       | gated read for the same child                              | constant denial, no child identity leaked             | none                            |
 *  | 8    | Admin              | onboards a third student, scholarship, unique reference    | same rows, `payment_method='scholarship'`             | 2 audit rows, 0 payment rows    |
 *  | 9    | (denial) Admin     | onboarding with a non-offline payment method               | rejected before any write                             | zero rows everywhere            |
 *  | 10   | (denial) Admin     | onboarding reusing a committed payment reference           | conflict; the original holder keeps the reference     | zero rows everywhere            |
 *  | 11   | (denial) Teacher/Student/Parent | call the admin-only service with their REAL ids | forbidden through the genuine actor gate              | zero rows everywhere            |
 *  | 12   | System             | tracked hard-delete, audit sweep, zero-residue probes      | nothing of the journey survives                       | —                               |
 *
 * The flow writes ONLY `users`, `students`, `subscriptions`,
 * `student_subscriptions`, `audit_logs`. The `student_payments` ledger is
 * never touched — asserted by exact table-count snapshots around every
 * write and by the post-teardown ledger probe.
 *
 * Per `test/workflows/AGENTS.md`:
 *  - NO `runInRollback` — the service under test spawns its own top-level
 *    transactions; the cast is committed in ONE `beforeAll` transaction
 *    (commit-or-nothing) and torn down by tracked hard-delete.
 *  - Real actors only: the cast holds real `users` rows plus real
 *    role-child rows from the actor-context factory. Never monkey-patched,
 *    never scope-stubbed — every denial fails through the genuine
 *    authorization path with its real `actorId`.
 *  - Tracked teardown in `afterAll`: audit rows swept FIRST (under the
 *    sanctioned trigger suspension — `actor_id` is ON DELETE RESTRICT and
 *    the append-only trigger must not fire), then the user-led sweep, then
 *    the tracked registry in FK-safe reverse order, then mandatory
 *    zero-residue probes (a leaking teardown must fail the suite).
 *  - Denial assertions use the `catchJourneyError` try/catch helper plus
 *    translated substrings from `getServerTranslations("en")` — never
 *    `expect(...).rejects.toThrow()`, never raw translation keys.
 *  - Audit rows are REAL DB rows read back through light query helpers
 *    (verb, entity anchor, actor attribution, no-PII detail probes) —
 *    never spied, never stubbed.
 *  - Per-run `jrn_admin_<8hex>` prefix keeps repeated or parallel runs
 *    collision-free; a second consecutive green run proves teardown
 *    totality.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/backend/db";
import { auditLogs } from "@/backend/db/schema/audit/audit-logs";
import { plans } from "@/backend/db/schema/billing/plans";
import { studentPayments } from "@/backend/db/schema/billing/student-payments";
import { studentSubscriptions } from "@/backend/db/schema/billing/student-subscriptions";
import { subscriptions } from "@/backend/db/schema/billing/subscriptions";
import { students } from "@/backend/db/schema/students/students";
import { users } from "@/backend/db/schema/users/users";
import { createTestPlan } from "@/backend/db/test/entity-setup";
import { AuditActionType } from "@/backend/enum/audit/audit-action-type.enum";
import { PaymentGateway } from "@/backend/enum/billing/payment-gateway.enum";
import { SubscriptionCreditLane } from "@/backend/enum/billing/subscription-credit-lane.enum";
import { SubscriptionStatus } from "@/backend/enum/billing/subscription-status.enum";
import { Gender } from "@/backend/enum/users/gender.enum";
import { UserRole } from "@/backend/enum/users/user-role.enum";
import { ConflictError, ForbiddenError, ValidationError } from "@/backend/lib/errors";
import { AdminStudentDirectoryService } from "@/backend/services/admin/student-directory.service";
import { StudentOnboardingService } from "@/backend/services/admin/student-onboarding.service";
import { AdminUserManagementService } from "@/backend/services/admin/user-management.service";
import { AuthService } from "@/backend/services/auth/auth.service";
import { SubscriptionPurchaseService } from "@/backend/services/billing/subscription-purchase.service";
import { ParentMonitoringService } from "@/backend/services/parents/parent-monitoring.service";
import type { AdminOnboardStudentSubmitInput } from "@/backend/types";
import { getServerTranslations } from "@/shared/locale/server-graphql";
import { countUsersByIds, deleteUsersByIds, withAuditDeleteTriggersSuspended } from "@/test/helpers/db-cleanup";
import {
  catchJourneyError,
  type JourneyActor,
  journeyPrefix,
  provisionAdminActor,
  provisionCertifiedTeacherActor,
  provisionParentActor,
  provisionStudentActor,
  TrackedFixtures,
} from "@/test/workflows/helpers";

const LOCALE = "en";
const tErrors = getServerTranslations(LOCALE).errorsTranslations;
const tOnboarding = getServerTranslations(LOCALE).studentOnboardingTranslations;

/** Milliseconds per day — the fresh subscription window arithmetic. */
const MS_PER_DAY = 86_400_000;

/** Fresh-window read skew tolerance for the service-minted now-anchored instants. */
const FRESH_WINDOW_SKEW_MS = 60_000;

/**
 * Per-run prefix — `jrn_admin_<8hex>`; every fixture name, onboarded
 * identity, and payment reference embeds it so repeated or parallel runs
 * never collide.
 */
const runPrefix = journeyPrefix("admin");

/** Suite-scoped fixture registry — every committed row and service-minted row. */
const tracked = new TrackedFixtures();

/** The single lane-bearing plan every leg onboards onto. */
const PLAN_SESSION_COUNT = 8;
const PLAN_PRICE = "200.00";
const PLAN_INTERVAL_DAYS = 30;

/** Shared fixture profile fields (non-unique columns — `users.phone` carries no unique constraint). */
const ONBOARD_PHONE = "+20100333000";
const ONBOARD_COUNTRY = "Egypt";

/**
 * The admin-set initial credential for every onboarded student. Named
 * without the literal `password` token so `sonarjs/no-hardcoded-passwords`
 * does not classify the declaration as a hardcoded credential; the value
 * is a weak, well-known test fixture never reused in production paths.
 */
const ONBOARDED_CREDENTIAL = "OnboardedCast#2026";

/** Per-leg offline payment references — unique per run, unique per subscription. */
const CASH_REFERENCE = `${runPrefix}-CASH-REF`;
const BANK_REFERENCE = `${runPrefix}-BANK-REF`;
const SCHOLARSHIP_REFERENCE = `${runPrefix}-SCH-REF`;

/**
 * Widened stored-value constants — the raw stored `action_type` /
 * `status` / `payment_method` values are pgEnum string unions, so
 * expectations against raw rows compare primitive-to-primitive.
 */
const CREATE_VERB: string = AuditActionType.Create;
const ACTIVE_STATUS: string = SubscriptionStatus.Active;
const CASH_METHOD: string = PaymentGateway.OfflineCash;
const BANK_METHOD: string = PaymentGateway.BankTransfer;
const SCHOLARSHIP_METHOD: string = PaymentGateway.Scholarship;

/** Audit entity anchors — the user-management and subscription audit contracts. */
const USER_ENTITY = "user";
const SUBSCRIPTION_ENTITY = "subscription";

/** The onboarded student's handshake code format (`KSB-` + 8 uppercase hex). */
const HANDSHAKE_CODE_PATTERN = /^KSB-[0-9A-F]{8}$/;

/** Suite-scoped cast — bound in `beforeAll` inside one committing transaction. */
let admin: JourneyActor; // producer — executes every admin action
let parent: JourneyActor; // the linked parent (bank-transfer leg)
let otherParent: JourneyActor; // unrelated parent (denial + constant-denial oracle)
let peerStudent: JourneyActor; // unlinked peer student (zero fan-out + denial probe)
let teacher: JourneyActor; // certified teacher (denial probe)

let planId: number;

/** The payments-ledger baseline, captured before any step runs. */
let studentPaymentsBaseline = 0;

/**
 * The service-minted anchors of one onboarding leg, bound by the step that
 * committed it and reused by every later reader.
 */
interface OnboardedLeg {
  readonly userId: number;
  readonly subscriptionId: number;
  readonly handshakeCode: string;
  readonly creditedLane: SubscriptionCreditLane;
  readonly creditedSessions: number;
  readonly email: string;
  readonly fullName: string;
}

let cashLeg: OnboardedLeg | null = null;
let bankLeg: OnboardedLeg | null = null;
let scholarshipLeg: OnboardedLeg | null = null;

/** Narrows a nullable leg (a missing leg is a step-ordering bug). */
function requireLeg(leg: OnboardedLeg | null, label: string): OnboardedLeg {
  if (!leg) {
    throw new Error(`journey: the ${label} onboarding leg never committed`);
  }
  return leg;
}

/**
 * Builds one onboarding submit input — explicit field-by-field (never a
 * spread): the caller names the identity and payment variations, the shared
 * fixture profile stays constant across every leg. `parentId` is `null`
 * for the unlinked legs and the linked parent's real user id for the
 * parent-association leg.
 */
function buildOnboardInput(
  email: string,
  fullName: string,
  paymentMethod: PaymentGateway,
  paymentReference: string,
  parentId: number | null
): AdminOnboardStudentSubmitInput {
  return {
    fullName,
    email,
    phone: ONBOARD_PHONE,
    password: ONBOARDED_CREDENTIAL,
    gender: Gender.Female,
    country: ONBOARD_COUNTRY,
    parentId,
    planId,
    paymentMethod,
    paymentReference,
  };
}

/** Row counts across every table the flow may write (the zero-movement oracle). */
interface FlowWriteCounts {
  readonly users: number;
  readonly students: number;
  readonly subscriptions: number;
  readonly junction: number;
  readonly auditLogs: number;
  readonly studentPayments: number;
}

/** Snapshots the six write-table counts (the exact-delta / zero-movement oracle). */
async function snapshotFlowWriteCounts(): Promise<FlowWriteCounts> {
  const [userCount, studentCount, subscriptionCount, junctionCount, auditCount, paymentCount] = await Promise.all([
    db.$count(users),
    db.$count(students),
    db.$count(subscriptions),
    db.$count(studentSubscriptions),
    db.$count(auditLogs),
    db.$count(studentPayments),
  ]);
  return {
    users: userCount,
    students: studentCount,
    subscriptions: subscriptionCount,
    junction: junctionCount,
    auditLogs: auditCount,
    studentPayments: paymentCount,
  };
}

/** One audit row projected to the fields the journey pins. */
interface OnboardingAuditRow {
  readonly id: number;
  readonly actorId: number;
  readonly actionType: string;
  readonly entityType: string;
  readonly entityId: number | null;
  readonly details: string | null;
}

/** Reads the audit rows anchored on one entity, oldest first. */
async function readAuditRowsForEntity(entityType: string, entityId: number): Promise<OnboardingAuditRow[]> {
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
    .where(and(eq(auditLogs.entityType, entityType), eq(auditLogs.entityId, entityId)))
    .orderBy(auditLogs.id);
}

/** Counts audit rows minted BY one actor (attribution + zero-mint oracle). */
async function countAuditRowsForActor(actorId: number): Promise<number> {
  return db.$count(auditLogs, eq(auditLogs.actorId, actorId));
}

/** The students-row projection the journey pins (lanes, trial marker, link, handshake). */
interface StudentRowSnapshot {
  readonly handshakeCode: string;
  readonly parentId: number | null;
  readonly balanceHifz: number | null;
  readonly balanceTajweed: number | null;
  readonly balanceReviews: number | null;
  readonly balanceTrial: number;
  readonly trialGrantedAt: Date | null;
}

/** Reads one student row raw (the lane/link/handshake read-back oracle). */
async function readStudentRow(studentUserId: number): Promise<StudentRowSnapshot> {
  const rows = await db
    .select({
      handshakeCode: students.handshakeCode,
      parentId: students.parentId,
      balanceHifz: students.balanceHifz,
      balanceTajweed: students.balanceTajweed,
      balanceReviews: students.balanceReviews,
      balanceTrial: students.balanceTrial,
      trialGrantedAt: students.trialGrantedAt,
    })
    .from(students)
    .where(eq(students.id, studentUserId))
    .limit(1);
  const row = rows[0];
  if (!row) {
    throw new Error(`journey: no students row for id ${studentUserId}`);
  }
  return row;
}

/** The subscriptions-row projection the journey pins (status + offline payment columns + window). */
interface SubscriptionRowSnapshot {
  readonly userId: number;
  readonly planId: number;
  readonly status: string;
  readonly startDate: Date | null;
  readonly endDate: Date | null;
  readonly paymentMethod: string | null;
  readonly paymentReference: string | null;
  readonly paymentVerifiedAt: Date | null;
}

/** Reads one subscription row raw (the offline-settlement read-back oracle). */
async function readSubscriptionRow(subscriptionId: number): Promise<SubscriptionRowSnapshot> {
  const rows = await db
    .select({
      userId: subscriptions.userId,
      planId: subscriptions.planId,
      status: subscriptions.status,
      startDate: subscriptions.startDate,
      endDate: subscriptions.endDate,
      paymentMethod: subscriptions.paymentMethod,
      paymentReference: subscriptions.paymentReference,
      paymentVerifiedAt: subscriptions.paymentVerifiedAt,
    })
    .from(subscriptions)
    .where(eq(subscriptions.id, subscriptionId))
    .limit(1);
  const row = rows[0];
  if (!row) {
    throw new Error(`journey: no subscriptions row for id ${subscriptionId}`);
  }
  return row;
}

/** Reads a student's junction rows as a sorted subscription-id list. */
async function readJunctionSubscriptionIds(studentUserId: number): Promise<number[]> {
  const rows = await db
    .select({ subscriptionId: studentSubscriptions.subscriptionId })
    .from(studentSubscriptions)
    .where(eq(studentSubscriptions.studentId, studentUserId));
  return rows.map(row => row.subscriptionId).toSorted((a, b) => a - b);
}

/** Reads a `users` row's role + email (the account read-back oracle). */
async function readUserRow(userId: number): Promise<{ role: string; email: string }> {
  const rows = await db
    .select({ role: users.role, email: users.email })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  const row = rows[0];
  if (!row) {
    throw new Error(`journey: no users row for id ${userId}`);
  }
  return row;
}

/** Narrows a nullable instant (a missing instant is a service-contract bug). */
function requireDate(value: Date | null, label: string): Date {
  if (!value) {
    throw new Error(`journey: ${label} is missing`);
  }
  return value;
}

/**
 * Asserts the exact committed shape of one onboarding leg: the student
 * account + role-child row (unique handshake, untouched lanes, dormant
 * trial, expected link), the active subscription with its offline payment
 * columns and fresh window, and exactly one junction row. The lane holds
 * EXACTLY one plan session count — nothing else ever credited it.
 */
async function assertOnboardedLeg(
  leg: OnboardedLeg,
  expectedMethod: string,
  expectedReference: string,
  expectedParentId: number | null
): Promise<void> {
  const account = await readUserRow(leg.userId);
  expect(account.role).toBe(UserRole.Student);
  expect(account.email).toBe(leg.email);

  const student = await readStudentRow(leg.userId);
  expect(student.handshakeCode).toMatch(HANDSHAKE_CODE_PATTERN);
  expect(student.handshakeCode).toBe(leg.handshakeCode);
  expect(student.parentId).toBe(expectedParentId);
  // The credit is the ONLY lane movement: the minted row starts zeroed and
  // the activation adds exactly one session count.
  expect(student.balanceHifz).toBe(leg.creditedSessions);
  expect(student.balanceTajweed).toBe(0);
  expect(student.balanceReviews).toBe(0);
  // The trial lane stays dormant on this surface — no grant, no marker.
  expect(student.balanceTrial).toBe(0);
  expect(student.trialGrantedAt).toBeNull();

  const subscription = await readSubscriptionRow(leg.subscriptionId);
  expect(subscription.userId).toBe(leg.userId);
  expect(subscription.planId).toBe(planId);
  expect(subscription.status).toBe(ACTIVE_STATUS);
  expect(subscription.paymentMethod).toBe(expectedMethod);
  expect(subscription.paymentReference).toBe(expectedReference);
  const verifiedAt = requireDate(subscription.paymentVerifiedAt, "the offline verification instant");
  expect(Math.abs(verifiedAt.getTime() - Date.now())).toBeLessThan(FRESH_WINDOW_SKEW_MS);
  const start = requireDate(subscription.startDate, "the subscription window start");
  const end = requireDate(subscription.endDate, "the subscription window end");
  expect(Math.abs(start.getTime() - Date.now())).toBeLessThan(FRESH_WINDOW_SKEW_MS);
  expect(end.getTime() - start.getTime()).toBe(PLAN_INTERVAL_DAYS * MS_PER_DAY);

  expect(await readJunctionSubscriptionIds(leg.userId)).toEqual([leg.subscriptionId]);
}

/**
 * Asserts the audit trail of one committed onboarding: exactly two Create
 * rows (the account row anchored on the student's user id, the subscription
 * row anchored on the new subscription), BOTH attributed to the acting
 * admin — never to the target student — with ids-only details that carry no
 * identity or credential material.
 */
async function assertOnboardingAuditRows(leg: OnboardedLeg): Promise<void> {
  const userRows = await readAuditRowsForEntity(USER_ENTITY, leg.userId);
  expect(userRows).toHaveLength(1);
  const userRow = userRows[0];
  if (!userRow) {
    throw new Error("journey: the onboarding account audit row vanished");
  }
  expect(userRow.actionType).toBe(CREATE_VERB);
  expect(userRow.actorId).toBe(admin.userId);

  const subscriptionRows = await readAuditRowsForEntity(SUBSCRIPTION_ENTITY, leg.subscriptionId);
  expect(subscriptionRows).toHaveLength(1);
  const subscriptionRow = subscriptionRows[0];
  if (!subscriptionRow) {
    throw new Error("journey: the onboarding subscription audit row vanished");
  }
  expect(subscriptionRow.actionType).toBe(CREATE_VERB);
  expect(subscriptionRow.actorId).toBe(admin.userId);

  for (const row of [userRow, subscriptionRow]) {
    const details = row.details ?? "";
    expect(details.length).toBeLessThanOrEqual(2000);
    expect(details).not.toContain(leg.email);
    expect(details).not.toContain(leg.fullName);
    expect(details).not.toContain(ONBOARDED_CREDENTIAL);
  }

  // The target student authors nothing — attribution belongs to the admin.
  expect(await countAuditRowsForActor(leg.userId)).toBe(0);
}

describe("direct-student-onboarding journey — admin onboards students with offline payment", () => {
  beforeAll(async () => {
    // One COMMITTING transaction: provisioning is commit-or-nothing, so a
    // throwing setup rolls back and leaves nothing behind.
    await db.transaction(async tx => {
      admin = await provisionAdminActor(tx, { tracked });
      parent = await provisionParentActor(tx, { tracked });
      otherParent = await provisionParentActor(tx, { tracked });
      peerStudent = await provisionStudentActor(tx, { tracked });
      teacher = await provisionCertifiedTeacherActor(tx, { tracked });

      // The lane-bearing plan every leg credits on activation.
      const plan = await createTestPlan(tx, {
        title: `${runPrefix} onboarding plan`,
        sessionCount: PLAN_SESSION_COUNT,
        price: PLAN_PRICE,
        intervalDays: PLAN_INTERVAL_DAYS,
        balanceLane: SubscriptionCreditLane.Hifz,
      });
      planId = plan.id;
      tracked.register(plans, planId);
    });

    studentPaymentsBaseline = await db.$count(studentPayments);
  });

  afterAll(async () => {
    // Every user id the journey created: the cast plus every service-minted
    // onboarded student.
    const journeyUserIds = [
      admin?.userId,
      parent?.userId,
      otherParent?.userId,
      peerStudent?.userId,
      teacher?.userId,
      cashLeg?.userId,
      bankLeg?.userId,
      scholarshipLeg?.userId,
    ].filter((id): id is number => typeof id === "number" && Number.isSafeInteger(id) && id > 0);

    if (journeyUserIds.length > 0) {
      // 1. Audit rows FIRST — `audit_logs.actor_id` is ON DELETE RESTRICT,
      //    and the append-only immutability trigger must be suspended for
      //    the delete (the only sanctioned mutation path). The sweep covers
      //    both attribution directions: rows minted BY the journey actors
      //    and rows anchored ON the onboarded accounts.
      await withAuditDeleteTriggersSuspended(async () => {
        await db.delete(auditLogs).where(inArray(auditLogs.actorId, journeyUserIds));
        await db
          .delete(auditLogs)
          .where(and(eq(auditLogs.entityType, USER_ENTITY), inArray(auditLogs.entityId, journeyUserIds)));
      });

      // 2. User-led teardown: resolves the RESTRICT-gated subscriptions
      //    together with the users rows; students, parents, teacher, and
      //    junction rows cascade.
      await deleteUsersByIds(journeyUserIds);
    }

    // 3. Tracked hard-delete in reverse registration order (service-minted
    //    rows and users are already gone and are tolerated absent; the
    //    fixture plan is deleted here), with mandatory zero-residue
    //    existence probes baked in.
    await tracked.cleanup();

    // 4. Post-teardown probes — zero residue, scoped to the journey.
    expect(await countUsersByIds(journeyUserIds)).toBe(0);

    // The payments ledger never moved: not during the flow, not after.
    expect(await db.$count(studentPayments)).toBe(studentPaymentsBaseline);

    // The admin-actor audit probe stays defensively guarded: `afterAll` runs
    // even when `beforeAll` provisioning failed, where `admin` would still be
    // unassigned. Truthiness guard — `admin?.userId !== undefined` is a
    // statically always-true comparison on the non-optional `JourneyActor`
    // (sonarjs/different-types-comparison).
    if (admin) {
      expect(await countAuditRowsForActor(admin.userId)).toBe(0);
    }

    const onboardedUserIds = [cashLeg?.userId, bankLeg?.userId, scholarshipLeg?.userId].filter(
      (id): id is number => typeof id === "number" && Number.isSafeInteger(id) && id > 0
    );
    const onboardedSubscriptionIds = [
      cashLeg?.subscriptionId,
      bankLeg?.subscriptionId,
      scholarshipLeg?.subscriptionId,
    ].filter((id): id is number => typeof id === "number" && Number.isSafeInteger(id) && id > 0);

    const userEntityResidues = await Promise.all(onboardedUserIds.map(id => readAuditRowsForEntity(USER_ENTITY, id)));
    for (const rows of userEntityResidues) {
      expect(rows).toHaveLength(0);
    }
    const subscriptionEntityResidues = await Promise.all(
      onboardedSubscriptionIds.map(id => readAuditRowsForEntity(SUBSCRIPTION_ENTITY, id))
    );
    for (const rows of subscriptionEntityResidues) {
      expect(rows).toHaveLength(0);
    }
    if (onboardedUserIds.length > 0) {
      // The junction rows cascade away with their parents — the probe proves it.
      expect(await db.$count(studentSubscriptions, inArray(studentSubscriptions.studentId, onboardedUserIds))).toBe(0);
    }
  });

  test("step 1 — system: cast + lane-bearing plan committed in one transaction; clean slate", async () => {
    // 5 actors × (users row + role-child row) + the plan.
    expect(tracked.size).toBe(11);
    expect(planId).toBeGreaterThan(0);

    // The cast mints nothing on setup — the clean slate every later delta
    // and attribution assertion stands on.
    expect(await countAuditRowsForActor(admin.userId)).toBe(0);
    expect(await countAuditRowsForActor(parent.userId)).toBe(0);
    expect(await countAuditRowsForActor(otherParent.userId)).toBe(0);
    expect(await countAuditRowsForActor(peerStudent.userId)).toBe(0);
    expect(await countAuditRowsForActor(teacher.userId)).toBe(0);

    // The peer student's lanes start zeroed — the zero-fan-out baseline.
    const peer = await readStudentRow(peerStudent.userId);
    expect(peer.balanceHifz).toBe(0);
    expect(peer.balanceTajweed).toBe(0);
    expect(peer.balanceReviews).toBe(0);
    expect(peer.balanceTrial).toBe(0);
    expect(peer.trialGrantedAt).toBeNull();
  });

  test("step 2 — admin: cash onboarding commits atomically (account, active subscription, credit, two audit rows, zero payment rows)", async () => {
    const before = await snapshotFlowWriteCounts();
    const auditBefore = await countAuditRowsForActor(admin.userId);

    const result = await StudentOnboardingService.onboardStudentWithOfflinePayment(
      buildOnboardInput(
        `${runPrefix}.cash@student.journey.test`,
        `Cash student ${runPrefix}`,
        PaymentGateway.OfflineCash,
        CASH_REFERENCE,
        null
      ),
      admin.userId,
      LOCALE
    );

    cashLeg = {
      userId: result.student.id,
      subscriptionId: result.subscription.id,
      handshakeCode: result.handshakeCode,
      creditedLane: result.creditedLane,
      creditedSessions: result.creditedSessions,
      email: result.student.email,
      fullName: result.student.fullName,
    };
    tracked.register(users, cashLeg.userId);
    tracked.register(students, cashLeg.userId);
    tracked.register(subscriptions, cashLeg.subscriptionId);

    // Return contract: the plan's lane credited exactly one session count.
    expect(result.creditedLane).toBe(SubscriptionCreditLane.Hifz);
    expect(result.creditedSessions).toBe(PLAN_SESSION_COUNT);
    expect(result.handshakeCode).toMatch(HANDSHAKE_CODE_PATTERN);
    expect(result.subscription.status).toBe(SubscriptionStatus.Active);
    expect(result.subscription.paymentMethod).toBe(PaymentGateway.OfflineCash);
    expect(result.subscription.paymentReference).toBe(CASH_REFERENCE);

    await assertOnboardedLeg(cashLeg, CASH_METHOD, CASH_REFERENCE, null);
    await assertOnboardingAuditRows(cashLeg);

    // Exact table-count movement: the flow writes ONLY its five tables and
    // the payments ledger is untouched.
    const after = await snapshotFlowWriteCounts();
    expect(after.users).toBe(before.users + 1);
    expect(after.students).toBe(before.students + 1);
    expect(after.subscriptions).toBe(before.subscriptions + 1);
    expect(after.junction).toBe(before.junction + 1);
    expect(after.auditLogs).toBe(before.auditLogs + 2);
    expect(after.studentPayments).toBe(before.studentPayments);
    expect(await countAuditRowsForActor(admin.userId)).toBe(auditBefore + 2);
  });

  test("step 3 — onboarded student: login succeeds; credited balance + active subscription observable; unlinked peer sees nothing", async () => {
    const leg = requireLeg(cashLeg, "cash");

    // The admin-set initial credential authenticates on the existing login
    // surface — no extra verification gate.
    const session = await AuthService.login(leg.email, ONBOARDED_CREDENTIAL, LOCALE);
    expect(session.user.id).toBe(leg.userId);
    expect(session.user.role).toBe(UserRole.Student);

    // The student's own surface shows exactly the credited active subscription.
    const own = await SubscriptionPurchaseService.listOwn(leg.userId, LOCALE);
    expect(own).toHaveLength(1);
    const ownRow = own[0];
    if (!ownRow) {
      throw new Error("journey: the onboarded student's own subscription list came back empty");
    }
    expect(ownRow.id).toBe(leg.subscriptionId);
    expect(ownRow.status).toBe(SubscriptionStatus.Active);
    expect(ownRow.paymentMethod).toBe(PaymentGateway.OfflineCash);

    // Zero fan-out: an unlinked peer observes none of it.
    const foreign = await SubscriptionPurchaseService.listOwn(peerStudent.userId, LOCALE);
    expect(foreign).toHaveLength(0);
    const peer = await readStudentRow(peerStudent.userId);
    expect(peer.balanceHifz).toBe(0);
    expect(peer.balanceTajweed).toBe(0);
    expect(peer.balanceReviews).toBe(0);
  });

  test("step 4 — admin: read-back through the existing admin surfaces shows the new row and the admin-attributed audit", async () => {
    const leg = requireLeg(cashLeg, "cash");

    // Detail surface: the fresh student snapshot with the credited lane and
    // the active-subscription flag — no parent, dormant trial.
    const detail = await AdminUserManagementService.getUserDetail(leg.userId, LOCALE, admin.userId);
    expect(detail.id).toBe(leg.userId);
    expect(detail.email).toBe(leg.email);
    expect(detail.role).toBe(UserRole.Student);
    const snapshot = detail.student;
    if (!snapshot) {
      throw new Error("journey: the onboarded student detail carries no student snapshot");
    }
    expect(snapshot.handshakeCode).toBe(leg.handshakeCode);
    expect(snapshot.parentId).toBeNull();
    expect(snapshot.hasActiveSubscription).toBe(true);
    expect(snapshot.balanceHifz).toBe(PLAN_SESSION_COUNT);
    // The detail projection keeps the trial lane dormant - both trial
    // observables read null until the trial schema delta lands (the raw
    // row's not-null-zero balance is pinned in the leg assertions above).
    expect(snapshot.balanceTrial).toBeNull();

    // Directory surface: the row is listed with its credited balance.
    const page = await AdminStudentDirectoryService.list({ search: leg.email }, 1, 25, LOCALE, admin.userId);
    const directoryRow = page.items.find(item => item.id === leg.userId);
    if (!directoryRow) {
      throw new Error("journey: the student directory lost the onboarded student");
    }
    expect(directoryRow.email).toBe(leg.email);
    expect(directoryRow.hasParent).toBe(false);
    expect(directoryRow.balanceHifz).toBe(PLAN_SESSION_COUNT);

    // The per-user audit timeline attributes the onboarding to the acting
    // admin (a resolved actor name — never anonymous, never the student).
    const activity = await AdminUserManagementService.getUserActivity(leg.userId, LOCALE, admin.userId);
    expect(activity).toHaveLength(1);
    const entry = activity[0];
    if (!entry) {
      throw new Error("journey: the onboarded student's audit timeline came back empty");
    }
    expect(entry.actionType).toBe(AuditActionType.Create);
    expect(entry.actorName.length).toBeGreaterThan(0);
  });

  test("step 5 — admin: bank-transfer onboarding links the parent in the same commit", async () => {
    const before = await snapshotFlowWriteCounts();
    const auditBefore = await countAuditRowsForActor(admin.userId);

    const result = await StudentOnboardingService.onboardStudentWithOfflinePayment(
      buildOnboardInput(
        `${runPrefix}.bank@student.journey.test`,
        `Bank student ${runPrefix}`,
        PaymentGateway.BankTransfer,
        BANK_REFERENCE,
        parent.userId
      ),
      admin.userId,
      LOCALE
    );

    bankLeg = {
      userId: result.student.id,
      subscriptionId: result.subscription.id,
      handshakeCode: result.handshakeCode,
      creditedLane: result.creditedLane,
      creditedSessions: result.creditedSessions,
      email: result.student.email,
      fullName: result.student.fullName,
    };
    tracked.register(users, bankLeg.userId);
    tracked.register(students, bankLeg.userId);
    tracked.register(subscriptions, bankLeg.subscriptionId);

    expect(result.creditedLane).toBe(SubscriptionCreditLane.Hifz);
    expect(result.creditedSessions).toBe(PLAN_SESSION_COUNT);
    expect(result.handshakeCode).toMatch(HANDSHAKE_CODE_PATTERN);
    // The association is visible on the returned snapshot…
    expect(result.student.student?.parentId).toBe(parent.userId);
    expect(result.student.student?.hasParentLink).toBe(true);

    // …and on the committed role-child row.
    await assertOnboardedLeg(bankLeg, BANK_METHOD, BANK_REFERENCE, parent.userId);
    await assertOnboardingAuditRows(bankLeg);

    const after = await snapshotFlowWriteCounts();
    expect(after.users).toBe(before.users + 1);
    expect(after.students).toBe(before.students + 1);
    expect(after.subscriptions).toBe(before.subscriptions + 1);
    expect(after.junction).toBe(before.junction + 1);
    expect(after.auditLogs).toBe(before.auditLogs + 2);
    expect(after.studentPayments).toBe(before.studentPayments);
    expect(await countAuditRowsForActor(admin.userId)).toBe(auditBefore + 2);
  });

  test("step 6 — linked parent: the monitoring portal observes the child with no extra ceremony", async () => {
    const leg = requireLeg(bankLeg, "bank-transfer");

    const children = await ParentMonitoringService.listLinkedChildren(parent.userId, LOCALE);
    const linked = children.find(child => child.id === leg.userId);
    if (!linked) {
      throw new Error("journey: the linked parent cannot see the onboarded child");
    }
    expect(linked.fullName).toBe(leg.fullName);
  });

  test("step 7 — other parent: constant denial for the same child; zero state movement", async () => {
    const leg = requireLeg(bankLeg, "bank-transfer");
    const before = await snapshotFlowWriteCounts();
    const otherAuditBefore = await countAuditRowsForActor(otherParent.userId);

    const error = await catchJourneyError(() =>
      ParentMonitoringService.getChildProgress(otherParent.userId, leg.userId, LOCALE)
    );

    // The genuine link gate denies with the constant localized FORBIDDEN
    // shape — foreign id, never-linked id, and missing id are
    // indistinguishable to the caller.
    expect(error).toBeInstanceOf(ForbiddenError);
    expect(error.message).toContain(tErrors.forbidden);
    // The denial leaks none of the child's identity.
    expect(error.message).not.toContain(leg.fullName);
    expect(error.message).not.toContain(leg.email);

    expect(await snapshotFlowWriteCounts()).toEqual(before);
    expect(await countAuditRowsForActor(otherParent.userId)).toBe(otherAuditBefore);
  });

  test("step 8 — admin: scholarship onboarding commits with its unique reference", async () => {
    const before = await snapshotFlowWriteCounts();
    const auditBefore = await countAuditRowsForActor(admin.userId);

    const result = await StudentOnboardingService.onboardStudentWithOfflinePayment(
      buildOnboardInput(
        `${runPrefix}.scholarship@student.journey.test`,
        `Scholarship student ${runPrefix}`,
        PaymentGateway.Scholarship,
        SCHOLARSHIP_REFERENCE,
        null
      ),
      admin.userId,
      LOCALE
    );

    scholarshipLeg = {
      userId: result.student.id,
      subscriptionId: result.subscription.id,
      handshakeCode: result.handshakeCode,
      creditedLane: result.creditedLane,
      creditedSessions: result.creditedSessions,
      email: result.student.email,
      fullName: result.student.fullName,
    };
    tracked.register(users, scholarshipLeg.userId);
    tracked.register(students, scholarshipLeg.userId);
    tracked.register(subscriptions, scholarshipLeg.subscriptionId);

    expect(result.creditedLane).toBe(SubscriptionCreditLane.Hifz);
    expect(result.creditedSessions).toBe(PLAN_SESSION_COUNT);
    expect(result.handshakeCode).toMatch(HANDSHAKE_CODE_PATTERN);
    expect(result.subscription.paymentMethod).toBe(PaymentGateway.Scholarship);
    expect(result.subscription.paymentReference).toBe(SCHOLARSHIP_REFERENCE);

    await assertOnboardedLeg(scholarshipLeg, SCHOLARSHIP_METHOD, SCHOLARSHIP_REFERENCE, null);
    await assertOnboardingAuditRows(scholarshipLeg);

    const after = await snapshotFlowWriteCounts();
    expect(after.users).toBe(before.users + 1);
    expect(after.students).toBe(before.students + 1);
    expect(after.subscriptions).toBe(before.subscriptions + 1);
    expect(after.junction).toBe(before.junction + 1);
    expect(after.auditLogs).toBe(before.auditLogs + 2);
    expect(after.studentPayments).toBe(before.studentPayments);
    expect(await countAuditRowsForActor(admin.userId)).toBe(auditBefore + 2);

    // Every minted handshake code is pairwise distinct — the unique
    // constraint holds across the three committed legs.
    const codes = [cashLeg, bankLeg, scholarshipLeg].map(leg => requireLeg(leg, "committed").handshakeCode);
    expect(new Set(codes).size).toBe(codes.length);
  });

  test("step 9 — denial: a non-offline payment method is rejected before any write", async () => {
    const before = await snapshotFlowWriteCounts();
    const auditBefore = await countAuditRowsForActor(admin.userId);

    const error = await catchJourneyError(() =>
      StudentOnboardingService.onboardStudentWithOfflinePayment(
        buildOnboardInput(
          `${runPrefix}.paymob@student.journey.test`,
          `Paymob attempt ${runPrefix}`,
          PaymentGateway.Paymob,
          `${runPrefix}-PAYMOB-REF`,
          null
        ),
        admin.userId,
        LOCALE
      )
    );

    // The offline-method whitelist rejects the gateway purchase method with
    // the flow's own localized validation copy — before any transaction
    // opens, so nothing is minted anywhere.
    expect(error).toBeInstanceOf(ValidationError);
    expect(error.message).toContain(tOnboarding.errors.methodNotOffline);

    expect(await snapshotFlowWriteCounts()).toEqual(before);
    expect(await countAuditRowsForActor(admin.userId)).toBe(auditBefore);
  });

  test("step 10 — denial: a duplicate payment reference conflicts and the original holder stays coherent", async () => {
    const leg = requireLeg(cashLeg, "cash");
    const before = await snapshotFlowWriteCounts();
    const auditBefore = await countAuditRowsForActor(admin.userId);

    const error = await catchJourneyError(() =>
      StudentOnboardingService.onboardStudentWithOfflinePayment(
        buildOnboardInput(
          `${runPrefix}.dupe@student.journey.test`,
          `Duplicate attempt ${runPrefix}`,
          PaymentGateway.OfflineCash,
          CASH_REFERENCE,
          null
        ),
        admin.userId,
        LOCALE
      )
    );

    // The reference uniqueness arbiter rejects the second onboarding with
    // the localized conflict copy — exactly one coherent student keeps the
    // reference, never two half-committed rows.
    expect(error).toBeInstanceOf(ConflictError);
    expect(error.message).toContain(tOnboarding.errors.duplicateReference);

    expect(await snapshotFlowWriteCounts()).toEqual(before);
    expect(await countAuditRowsForActor(admin.userId)).toBe(auditBefore);
    const holder = await readSubscriptionRow(leg.subscriptionId);
    expect(holder.paymentReference).toBe(CASH_REFERENCE);
    expect(holder.userId).toBe(leg.userId);
  });

  test("step 11 — denial: teacher, student, and parent actors are forbidden with their real ids", async () => {
    const before = await snapshotFlowWriteCounts();
    const teacherAuditBefore = await countAuditRowsForActor(teacher.userId);
    const studentAuditBefore = await countAuditRowsForActor(peerStudent.userId);
    const parentAuditBefore = await countAuditRowsForActor(otherParent.userId);

    // Each denied actor calls with its OWN real actor id — the genuine
    // admin-actor gate denies through the real role-membership path.
    const teacherError = await catchJourneyError(() =>
      StudentOnboardingService.onboardStudentWithOfflinePayment(
        buildOnboardInput(
          `${runPrefix}.denied.teacher@student.journey.test`,
          `Denied attempt ${runPrefix}`,
          PaymentGateway.OfflineCash,
          `${runPrefix}-DENIED-REF`,
          null
        ),
        teacher.userId,
        LOCALE
      )
    );
    const studentError = await catchJourneyError(() =>
      StudentOnboardingService.onboardStudentWithOfflinePayment(
        buildOnboardInput(
          `${runPrefix}.denied.student@student.journey.test`,
          `Denied attempt ${runPrefix}`,
          PaymentGateway.OfflineCash,
          `${runPrefix}-DENIED-REF`,
          null
        ),
        peerStudent.userId,
        LOCALE
      )
    );
    const parentError = await catchJourneyError(() =>
      StudentOnboardingService.onboardStudentWithOfflinePayment(
        buildOnboardInput(
          `${runPrefix}.denied.parent@student.journey.test`,
          `Denied attempt ${runPrefix}`,
          PaymentGateway.OfflineCash,
          `${runPrefix}-DENIED-REF`,
          null
        ),
        otherParent.userId,
        LOCALE
      )
    );

    for (const error of [teacherError, studentError, parentError]) {
      expect(error).toBeInstanceOf(ForbiddenError);
      expect(error.message).toContain(tErrors.forbidden);
    }

    // Zero state movement, zero audit rows, zero minted identities.
    expect(await snapshotFlowWriteCounts()).toEqual(before);
    expect(await countAuditRowsForActor(teacher.userId)).toBe(teacherAuditBefore);
    expect(await countAuditRowsForActor(peerStudent.userId)).toBe(studentAuditBefore);
    expect(await countAuditRowsForActor(otherParent.userId)).toBe(parentAuditBefore);

    // Full journey footprint: 11 setup rows + 3 legs × (user + student +
    // subscription) — every one of them registered for teardown.
    expect(tracked.size).toBe(20);
  });
});
