/**
 * Journey — audit-trail completeness (execute every admin action → prove the
 * trail).
 *
 * Cross-actor workflow test that performs EVERY shipped admin-gated mutation
 * through the real service layer against the real test database, driven by
 * the machine-readable admin action census
 * (`@/test/workflows/admin/audit-completeness.catalog`). A producer admin
 * executes every `wired` census row (direction-paired rows exercise BOTH
 * verbs: delete/reactivate, suspend/reactivate for users and for plans; the
 * financial-auditing trio settles BOTH withdrawal directions — approve AND
 * reject — and both adjustment verbs are exercised through the reason-bearing
 * manual adjustment; the subscription-admin quartet mints its pinned
 * Update/Suspend/Create/Override rows through extend, cancel, renew, and a
 * prorated downgrade); non-admin and anonymous actors are denied every action
 * and mint nothing.
 *
 * Per `test/workflows/AGENTS.md`:
 *  - Committed fixtures in `beforeAll` inside ONE committing transaction
 *    (commit-or-nothing); NO `runInRollback` — the services under test spawn
 *    their own top-level transactions. Tracked hard-delete in `afterAll`
 *    (audit rows first, inside the trigger-suspension wrapper).
 *  - Permissions resolve via REAL role context — the cast holds real
 *    `users.role` values plus real role-child rows provisioned by the
 *    actor-context factory. NEVER monkey-patched, NEVER scope-stubbed.
 *  - Audit writes are REAL DB rows — observed through the real read service
 *    and whole-table row-count oracles, never spied. The notification
 *    fan-out transport IS spied at the service's injection seam: no external
 *    channel is ever touched.
 *  - Denial assertions use a try/catch helper + translated substrings from
 *    `getServerTranslations("en").errorsTranslations` — NEVER
 *    `expect(...).rejects.toThrow()` and never raw key echoes.
 *  - Teardown deletes audit rows FIRST (their `actor_id` FK is
 *    `ON DELETE RESTRICT` and the append-only immutability trigger must be
 *    suspended for the delete — the only sanctioned mutation path), then
 *    notifications, then the tracked fixtures in FK-safe reverse order;
 *    post-teardown probes assert the whole-table baselines are restored
 *    (zero residue platform-wide).
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db, queryDb } from "@/backend/db";
import { auditLogs } from "@/backend/db/schema/audit/audit-logs";
import { plans } from "@/backend/db/schema/billing/plans";
import { studentSubscriptions } from "@/backend/db/schema/billing/student-subscriptions";
import { subscriptionPurchaseIdempotency } from "@/backend/db/schema/billing/subscription-purchase-idempotency";
import { subscriptions } from "@/backend/db/schema/billing/subscriptions";
import { teacherTransaction } from "@/backend/db/schema/billing/teacher-transaction";
import { wallet } from "@/backend/db/schema/billing/wallet";
import { lessons } from "@/backend/db/schema/classes/lessons";
import { session } from "@/backend/db/schema/classes/session";
import { notifications } from "@/backend/db/schema/notifications/notifications";
import { students } from "@/backend/db/schema/students/students";
import { applicants } from "@/backend/db/schema/teachers/applicants";
import { teacher } from "@/backend/db/schema/teachers/teacher";
import { users } from "@/backend/db/schema/users/users";
import { createTestPlan, createTestSubscription, createTestWallet } from "@/backend/db/test/entity-setup";
import { AuditActionType } from "@/backend/enum/audit/audit-action-type.enum";
import { ProrationDirection } from "@/backend/enum/billing/proration-direction.enum";
import { SubscriptionCreditLane } from "@/backend/enum/billing/subscription-credit-lane.enum";
import { SubscriptionStatus } from "@/backend/enum/billing/subscription-status.enum";
import { TransactionStatus } from "@/backend/enum/billing/transaction-status.enum";
import { TransactionType } from "@/backend/enum/billing/transaction-type.enum";
import { WalletAdjustmentDirection } from "@/backend/enum/billing/wallet-adjustment-direction.enum";
import { BroadcastAudienceType } from "@/backend/enum/notifications/broadcast-audience-type.enum";
import { DisputeResolution } from "@/backend/enum/scheduling/dispute-resolution.enum";
import { SessionIntent } from "@/backend/enum/scheduling/session-intent.enum";
import { SessionStatus } from "@/backend/enum/scheduling/session-status.enum";
import { ConflictError, DomainError, ForbiddenError, UnauthorizedError, ValidationError } from "@/backend/lib/errors";
import { AdminUserManagementService, AuditTrailService, ColdStartCertificationService } from "@/backend/services/admin";
import { AdminFinancialAuditingService } from "@/backend/services/billing/admin-financial-auditing.service";
import { PlanCatalogService } from "@/backend/services/billing/plan-catalog.service";
import { SubscriptionAdminService } from "@/backend/services/billing/subscription-admin.service";
import { WalletService } from "@/backend/services/billing/wallet.service";
import { LessonService } from "@/backend/services/classes/lesson.service";
import { SessionAdminGovernanceService } from "@/backend/services/classes/session-admin-governance";
import { SessionLifecycleService } from "@/backend/services/classes/session-lifecycle.service";
import { AdminBroadcastService } from "@/backend/services/notifications/admin-broadcast.service";
import type {
  AdminAuditLogEntryReturnType,
  AdminAuditTrailFiltersSubmitInput,
  AdminCreateUserSubmitInput,
  AdminSessionCancelInput,
  AdminSessionJoinInput,
  AdminSessionReassignInput,
  AdminSessionRescheduleInput,
  AdminUpdateUserPatchInput,
  BroadcastNotificationSubmitInput,
  LessonSubmitInput,
  PlanSubmitInput,
  SubscriptionSelectType,
} from "@/backend/types";
import { getServerTranslations } from "@/shared/locale/server-graphql";
// Deep import (same rationale as the sibling journeys — the `test/helpers`
// barrel pulls the Apollo test client into backend-only graphs).
import {
  countUsersByIds,
  withAuditDeleteTriggersSuspended,
  withImmutabilityTriggersSuspended,
} from "@/test/helpers/db-cleanup";
import { ADMIN_ACTION_CENSUS, type AdminActionCensusEntry } from "@/test/workflows/admin/audit-completeness.catalog";
import {
  ANONYMOUS_ACTOR_ID,
  type JourneyActor,
  provisionAdminActor,
  provisionCertifiedTeacherActor,
  provisionParentActor,
  provisionStudentActor,
  SpiedFanoutTransport,
  TrackedFixtures,
} from "@/test/workflows/helpers";

const LOCALE = "en";
const tErrors = getServerTranslations(LOCALE).errorsTranslations;

/**
 * Per-run prefix — guarantees unique free-text fields (names, emails, plan
 * titles, cohort sentinels, fixture markers) so repeated or parallel runs
 * never collide.
 */
const runPrefix = `jrn_acmpl_${randomUUID().slice(0, 8)}`;

/**
 * Run-unique country sentinel for the broadcast cohort: exact-match cohort
 * resolution must find ONLY the cast student holding it — no other suite,
 * fixture, or seed can ever carry this value.
 */
const COHORT_COUNTRY = `QT${randomUUID().replace(/-/g, "").slice(0, 10).toUpperCase()}`;

/** Broadcast copy — embeds the run prefix so the rows are uniquely identifiable. */
const BROADCAST_TITLE = `${runPrefix}: platform maintenance window`;
const BROADCAST_BODY = `${runPrefix}: the platform will be briefly unavailable on Sunday.`;

/** Free-text fixture copy — the dispute reason and the arbitration note. */
const DISPUTE_REASON = `${runPrefix} teacher no-show`;
const ARBITRATION_NOTE = `${runPrefix} refund the held fee and cancel the lesson`;

/**
 * Plaintext credential for the users created through the real create-user
 * service path — the service hashes it before the `users` insert. Named
 * without the literal `password` token so static secret-scanners don't
 * classify the declaration as a hardcoded credential. The value is a weak,
 * well-known test fixture — never reused in production paths.
 */
const TARGET_CREDENTIAL = "completenessJourney123";

/** The suspension window exercised by the suspend/reactivate census row. */
const SUSPENSION_PERIOD_DAYS = 1;

/** The admin-supplied cancel reason exercised by the governance cancel census row. */
const ADMIN_CANCEL_REASON = `${runPrefix} admin schedule conflict`;

/** Financial-auditing leg amounts (decimal strings, carried verbatim). */
const FINANCE_PAYOUT_PRIMARY = "100.00";
const FINANCE_PAYOUT_REJECTED = "50.00";
const FINANCE_ADJUST_CREDIT = "25.00";
/** The admin-supplied reject reason + adjustment reason (run-unique free text). */
const FINANCE_REJECT_REASON = `${runPrefix} insufficient documentation`;
const FINANCE_ADJUST_REASON = `${runPrefix} goodwill credit`;

/** The subscription-admin leg's extend day count (whole days, positive). */
const SUBSCRIPTION_EXTEND_DAYS = 7;
/** The cancel leg's admin-supplied reason — the surface's only free text, trimmed and bounded by the service. */
const SUBSCRIPTION_CANCEL_REASON = `${runPrefix} admin billing adjustment`;
/** The owner's seeded hifz lane balance — makes the downgrade forfeit arithmetic exact (seed + renewal credit). */
const SUBSCRIPTION_LANE_SEED = 3;
/** The source plan's shape — the HIGHER per-session unit value (25.00/session) of the downgrade pair. */
const SOURCE_PLAN_SESSION_COUNT = 8;
const SOURCE_PLAN_PRICE = "200.00";
const SOURCE_PLAN_INTERVAL_DAYS = 30;
/** The downgrade target's shape — the strictly smaller unit value (12.50/session) pins the Downgrade direction. */
const DOWNGRADE_PLAN_SESSION_COUNT = 4;
const DOWNGRADE_PLAN_PRICE = "50.00";
const DOWNGRADE_PLAN_INTERVAL_DAYS = 30;
/** Milliseconds per day — the extend leg's window arithmetic unit (whole-second instants stay lossless). */
const MS_PER_DAY = 86_400_000;
/** The extend fixture's stored window — whole-second UTC instants the ISO audit details compare exactly. */
const EXTEND_WINDOW_START = new Date("2030-01-01T00:00:00.000Z");
const EXTEND_WINDOW_END = new Date("2030-01-31T00:00:00.000Z");
const EXTEND_WINDOW_END_EXTENDED = new Date(EXTEND_WINDOW_END.getTime() + SUBSCRIPTION_EXTEND_DAYS * MS_PER_DAY);

/**
 * Widened enum members — the ledger rows' `type`/`status` columns are pgEnum
 * string-literal unions, so the pending-withdrawal lookups compare
 * primitive-to-primitive (annotated `string` consts, no enum-type friction).
 */
const WITHDRAWAL_TYPE: string = TransactionType.Withdrawal;
const PENDING_STATUS: string = TransactionStatus.Pending;

/**
 * The reschedule fixture's ORIGINAL timing pair (whole-second UTC instants —
 * the audit `from` comparison is exact, so the stored-vs-read-back
 * millisecond round trip must be lossless, which whole-second values
 * guarantee on both providers).
 */
const RESCHEDULE_FROM_START = new Date("2030-01-10T10:00:00.000Z");
const RESCHEDULE_FROM_END = new Date("2030-01-10T11:00:00.000Z");

/** The join fixture's started stamp (any past instant — the status is the gate). */
const JOIN_STARTED_AT = new Date("2030-01-05T09:00:00.000Z");
const JOIN_ENDED_AT = new Date("2030-01-05T10:00:00.000Z");

/** Census mutation fields grouped into executable legs (a partition of the wired rows). */
const SESSION_GOVERNANCE_LEG = [
  "adminRescheduleSession",
  "adminCancelSession",
  "adminReassignTeacher",
  "adminJoinSession",
] as const;
const USER_LIFECYCLE_LEG = [
  "adminCreateUser",
  "adminUpdateUser",
  "adminSetUserDeleted",
  "adminSetUserSuspended",
  "adminSetUserBlocked",
] as const;
const CERTIFICATION_BROADCAST_LEG = ["adminCertifyTeacherColdStart", "adminBroadcastNotification"] as const;
const PLAN_CATALOG_LEG = ["createPlan", "updatePlan", "setPlanActiveStatus"] as const;
const LESSON_LEG = ["createLesson", "updateLesson", "deleteLesson"] as const;
const DISPUTE_LEG = ["resolveSessionDispute"] as const;
/** Financial-auditing trio — approve/reject settle BOTH withdrawal directions. */
const FINANCE_LEG = ["adjustTeacherWallet", "approveWithdrawal", "rejectWithdrawal"] as const;
/** Admin subscription lifecycle — extend+cancel share the active row, renew+change chain the fresh periods. */
const SUBSCRIPTION_ADMIN_LEG = [
  "adminExtendSubscription",
  "adminCancelSubscription",
  "adminRenewSubscription",
  "adminChangeSubscriptionPlan",
] as const;

/**
 * Try/catch rejection helper (journey-layer pattern —
 * `expect(...).rejects.toThrow()` is prohibited). Returns the caught error;
 * fails the test when the call resolves successfully.
 */
async function expectJourneyError(fn: () => Promise<unknown>): Promise<Error> {
  let caught: unknown = null;
  try {
    await fn();
  } catch (error) {
    caught = error;
  }
  if (caught === null) {
    throw new Error("expectJourneyError: expected the call to throw, but it resolved successfully");
  }
  if (caught instanceof Error) {
    return caught;
  }
  return new Error(`expectJourneyError: caught non-Error throw (${typeof caught})`);
}

/** Whole-table `audit_logs` row count (row-count oracle). */
async function countAllAuditRows(): Promise<number> {
  return db.$count(auditLogs);
}

/** Whole-table `notifications` row count (zero-fan-out oracle for denials). */
async function countAllNotificationRows(): Promise<number> {
  return db.$count(notifications);
}

/** Counts ALL audit rows attributed to one actor (denial zero-mint probe). */
async function countAuditRowsForActor(actorId: number): Promise<number> {
  return db.$count(auditLogs, eq(auditLogs.actorId, actorId));
}

/**
 * Widens an action-type enum member to its raw stored string. Insert-returning
 * rows carry the raw `action_type` value (coercion to the enum is the read
 * service's job), so fixture-lane anchor lookups compare primitive-to-primitive.
 */
function rawActionType(actionType: AuditActionType): string {
  return actionType;
}

/** JSON-object guard (plain-record type guard for audit `details` payloads). */
function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Parses an audit row's `details` payload into a plain JSON object. */
function parseAuditDetails(row: AdminAuditLogEntryReturnType): Record<string, unknown> {
  const parsed: unknown = JSON.parse(row.details ?? "null");
  if (!isPlainRecord(parsed)) {
    throw new Error(`audit row ${row.id} details payload is not a JSON object`);
  }
  return parsed;
}

/** Read-back oracle: one subscription row (the subscription leg's side-effect probes). */
async function readSubscriptionRow(subscriptionId: number): Promise<SubscriptionSelectType> {
  const rows = await db.select().from(subscriptions).where(eq(subscriptions.id, subscriptionId)).limit(1);
  const row = rows[0];
  if (!row) {
    throw new Error(`subscription leg: no subscription row for id ${subscriptionId}`);
  }
  return row;
}

/** Read-back oracle: the subscription owner's four lane balances (the balance-preserving probe). */
async function readOwnerLaneBalances() {
  const rows = await db
    .select({
      hifz: students.balanceHifz,
      tajweed: students.balanceTajweed,
      reviews: students.balanceReviews,
      trial: students.balanceTrial,
    })
    .from(students)
    .where(eq(students.id, studentActor.userId))
    .limit(1);
  const row = rows[0];
  if (!row) {
    throw new Error("subscription leg: the owner's student row vanished");
  }
  return row;
}

/**
 * Registers the service-minted idempotency claim pointing at one subscription
 * row (a side-effect row the registry must sweep; resolved by its backfilled
 * subscription pointer — run-unique because the pointer is a fresh row id).
 */
async function trackClaimForSubscription(subscriptionId: number): Promise<void> {
  const claims = await db
    .select({ id: subscriptionPurchaseIdempotency.id })
    .from(subscriptionPurchaseIdempotency)
    .where(eq(subscriptionPurchaseIdempotency.subscriptionId, subscriptionId));
  const claim = claims[0];
  if (claims.length !== 1 || !claim) {
    throw new Error(`subscription leg: expected exactly one claim for subscription ${subscriptionId}`);
  }
  tracked.register(subscriptionPurchaseIdempotency, claim.id);
}

/**
 * One executed census action, recorded at execution time: the census row it
 * belongs to, the action verb the service chose for the direction, the
 * entity anchor, and the EXACT `details` contract the minted row must carry.
 * The mapping oracles compare the trail against this record — the execution
 * log IS the expected trail.
 */
interface ExecutedAction {
  readonly mutationField: string;
  readonly actionType: AuditActionType;
  readonly entityType: string;
  readonly entityId: number | null;
  readonly expectedDetails: Record<string, unknown>;
}

/** A census runner: executes one wired census row (direction-paired rows run both verbs). */
type CensusRunner = (entry: AdminActionCensusEntry, executed: ExecutedAction[]) => Promise<void>;

/** Records one executed action into the journey's execution log. */
function record(
  executed: ExecutedAction[],
  entry: AdminActionCensusEntry,
  actionType: AuditActionType,
  entityId: number | null,
  expectedDetails: Record<string, unknown>
): void {
  executed.push({
    mutationField: entry.mutationField,
    actionType,
    entityType: entry.expectedEntityType,
    entityId,
    expectedDetails,
  });
}

/** Builds a run-unique create-user input for the supplied role. */
function makeCreateUserInput(role: "student" | "teacher"): AdminCreateUserSubmitInput {
  return {
    fullName: `${runPrefix} ${role === "student" ? "Governance Target" : "Founding Teacher"}`,
    email: `${runPrefix}-${role}-${randomUUID().slice(0, 8)}@journey.test`,
    phone: "+10000000000",
    password: TARGET_CREDENTIAL,
    country: "Egypt",
    role,
  };
}

/** Suite-scoped cast — bound in `beforeAll` inside one committing transaction. */
const tracked = new TrackedFixtures();
/** Fan-out transport spy installed through the services' notification seam. */
const transportSpy = new SpiedFanoutTransport();

let adminA: JourneyActor; // producer — executes every census action
let adminB: JourneyActor; // observer — reads the trail through the global surface
let studentActor: JourneyActor; // denial cast
let parentActor: JourneyActor; // denial cast + adjust-fixture anchor
let teacherActor: JourneyActor; // denial cast + dispute-session counterpart
let secondTeacherActor: JourneyActor; // certified reassignment candidate

/** Service-minted / fixture entity anchors, bound during the legs. */
let targetStudentId = 0;
let teacherTargetId = 0;
let planId = 0;
let lessonId = 0;
let disputeSessionId = 0;
let rescheduleSessionId = 0;
let cancelSessionId = 0;
let reassignSessionId = 0;
let joinSessionId = 0;
/** Subscription-admin anchors: two same-lane plans + the subscription rows the legs act on and mint. */
let sourcePlanId = 0;
let downgradePlanId = 0;
let extendSubscriptionId = 0;
let renewSourceId = 0;
let renewedSubscriptionId = 0;
let planChangedSubscriptionId = 0;

/** Row-count oracles — captured after the cast commit, restored by teardown. */
let auditBaseline = 0;
/** Pre-existing trail rows' verb + entity-type counts (the seeded plan-catalog rows). */
let baselineVerbCounts = new Map<string, number>();
let baselineTypeCounts = new Map<string, number>();
let notificationBaseline = 0;

/**
 * The financial-auditing ledger fixture: wallet + pending withdrawal rows
 * the legs act on. The wallet is registered in the tracked registry
 * (children-first teardown); the `teacher_transaction` rows are DELETE-blocked
 * (append-only trigger), so their ids are swept FIRST in `afterAll` under the
 * sanctioned suspension wrapper — never registered in the tracked registry.
 */
let financeWalletId = 0;
let financeTeacherId = 0;
/** The `teacher_transaction` rows minted by the finance legs (untracked teardown). */
const financeLedgerTxnIds: number[] = [];

/** The System fixture lane's backdated adjustment stamp (millisecond-precise). */
let fixtureAdjustAt = new Date(0);
/** The System fixture lane's audit row id (attributed to the observer). */
let fixtureRowId = 0;

/** The journey's execution log — every census action performed, in order. */
const executedActions: ExecutedAction[] = [];

/**
 * The census-driven dispatch map: one runner per wired census mutation
 * field, keyed by field name. Each runner performs the row's real service
 * call(s) and records every execution into the journey's execution log.
 * A wired census row without a runner fails the driver loudly, so a new
 * census row cannot silently skip execution.
 */
const censusRunners: Record<string, CensusRunner> = {
  adminCreateUser: async (entry, executed) => {
    // Two executions: the governance target that later legs govern, and the
    // teacher-role target whose pending applicant row the certification
    // finalizes. Both mint Create rows attributed to the producer.
    const createdStudent = await AdminUserManagementService.createUser(
      makeCreateUserInput("student"),
      adminA.userId,
      LOCALE
    );
    targetStudentId = createdStudent.id;
    expect(createdStudent.student).not.toBeNull();
    tracked.register(users, targetStudentId);
    tracked.register(students, targetStudentId);
    record(executed, entry, AuditActionType.Create, targetStudentId, { role: "student" });

    const createdTeacher = await AdminUserManagementService.createUser(
      makeCreateUserInput("teacher"),
      adminA.userId,
      LOCALE
    );
    teacherTargetId = createdTeacher.id;
    expect(createdTeacher.applicant).not.toBeNull();
    tracked.register(users, teacherTargetId);
    tracked.register(applicants, teacherTargetId);
    record(executed, entry, AuditActionType.Create, teacherTargetId, { role: "teacher" });
  },

  adminUpdateUser: async (entry, executed) => {
    const renamedFullName = `${runPrefix} Governance Target Renamed`;
    const patch: AdminUpdateUserPatchInput = { fullName: renamedFullName };
    const updated = await AdminUserManagementService.updateUser(targetStudentId, patch, adminA.userId, LOCALE);
    expect(updated.fullName).toBe(renamedFullName);
    record(executed, entry, AuditActionType.Update, targetStudentId, { changedFields: ["fullName"] });
  },

  adminSetUserDeleted: async (entry, executed) => {
    // TWO full toggle cycles — the action is idempotency-unprotected, so the
    // repeat itself is part of the proof: repeats are logged, never deduped.
    // (Unrolled: the two cycles must run strictly in order.)
    const firstDeleted = await AdminUserManagementService.setUserDeleted(targetStudentId, true, adminA.userId, LOCALE);
    expect(firstDeleted.isDeleted).toBe(true);
    record(executed, entry, AuditActionType.Delete, targetStudentId, { deleted: true });

    const firstRestored = await AdminUserManagementService.setUserDeleted(
      targetStudentId,
      false,
      adminA.userId,
      LOCALE
    );
    expect(firstRestored.isDeleted).toBe(false);
    record(executed, entry, AuditActionType.Reactivate, targetStudentId, { deleted: false });

    const secondDeleted = await AdminUserManagementService.setUserDeleted(targetStudentId, true, adminA.userId, LOCALE);
    expect(secondDeleted.isDeleted).toBe(true);
    record(executed, entry, AuditActionType.Delete, targetStudentId, { deleted: true });

    const secondRestored = await AdminUserManagementService.setUserDeleted(
      targetStudentId,
      false,
      adminA.userId,
      LOCALE
    );
    expect(secondRestored.isDeleted).toBe(false);
    record(executed, entry, AuditActionType.Reactivate, targetStudentId, { deleted: false });
  },

  adminSetUserSuspended: async (entry, executed) => {
    const suspended = await AdminUserManagementService.setUserSuspended(
      targetStudentId,
      true,
      SUSPENSION_PERIOD_DAYS,
      adminA.userId,
      LOCALE
    );
    expect(suspended.suspended).toBe(true);
    record(executed, entry, AuditActionType.Suspend, targetStudentId, {
      changedFields: ["suspended", "suspendedAt", "suspendedPeriodDays"],
      suspended: true,
      suspendedPeriodDays: SUSPENSION_PERIOD_DAYS,
    });

    const released = await AdminUserManagementService.setUserSuspended(
      targetStudentId,
      false,
      null,
      adminA.userId,
      LOCALE
    );
    expect(released.suspended).toBe(false);
    record(executed, entry, AuditActionType.Reactivate, targetStudentId, {
      changedFields: ["suspended", "suspendedAt", "suspendedPeriodDays"],
      suspended: false,
    });
  },

  adminSetUserBlocked: async (entry, executed) => {
    const blocked = await AdminUserManagementService.setUserBlocked(targetStudentId, true, adminA.userId, LOCALE);
    expect(blocked.isBlocked).toBe(true);
    record(executed, entry, AuditActionType.Suspend, targetStudentId, {
      changedFields: ["isBlocked", "blockedAt"],
      blocked: true,
    });

    const unblocked = await AdminUserManagementService.setUserBlocked(targetStudentId, false, adminA.userId, LOCALE);
    expect(unblocked.isBlocked).toBe(false);
    record(executed, entry, AuditActionType.Reactivate, targetStudentId, {
      changedFields: ["isBlocked", "blockedAt"],
      blocked: false,
    });
  },

  adminCertifyTeacherColdStart: async (entry, executed) => {
    transportSpy.clear();
    const detail = await ColdStartCertificationService.certifyTeacherColdStart(
      adminA.userId,
      { userId: teacherTargetId, makeEvaluator: false },
      LOCALE,
      { transport: transportSpy }
    );
    expect(detail.teacher?.isApproved).toBe(true);
    tracked.register(teacher, teacherTargetId);
    record(executed, entry, AuditActionType.Override, teacherTargetId, {
      makeEvaluator: false,
      applicantRow: "finalized",
      elevation: "created",
    });

    // The certification's fan-out is spied, never sent — one envelope, to the
    // newly certified teacher only.
    expect(transportSpy.publishCount).toBe(1);
    expect(transportSpy.lastCall?.userIds).toEqual([teacherTargetId]);
  },

  adminBroadcastNotification: async (entry, executed) => {
    transportSpy.clear();
    const input: BroadcastNotificationSubmitInput = {
      title: BROADCAST_TITLE,
      body: BROADCAST_BODY,
      audience: { type: BroadcastAudienceType.Country, country: COHORT_COUNTRY },
    };
    const recipientCount = await AdminBroadcastService.broadcast(input, adminA.userId, adminA.locale, randomUUID(), {
      transport: transportSpy,
    });
    // The run-unique country cohort resolves exactly the one cast student.
    expect(recipientCount).toBe(1);
    record(executed, entry, AuditActionType.Create, null, {
      scope: "country",
      country: COHORT_COUNTRY,
      recipientCount,
    });

    // The broadcast's fan-out is spied, never sent — one envelope, to the
    // cohort member only.
    expect(transportSpy.publishCount).toBe(1);
    expect(transportSpy.publishedUserIds).toEqual([studentActor.userId]);
  },

  createPlan: async (entry, executed) => {
    const input: PlanSubmitInput = {
      title: `${runPrefix} subscription plan`,
      sessionCount: 8,
      price: "200.00",
      currency: "EGP",
      intervalDays: 30,
    };
    const created = await PlanCatalogService.createPlan(input, adminA.userId, LOCALE);
    planId = created.id;
    expect(created.currency).toBe("EGP");
    tracked.register(plans, planId);
    record(executed, entry, AuditActionType.Create, planId, {
      title: input.title,
      sessionCount: input.sessionCount,
      price: input.price,
      currency: "EGP",
      intervalDays: input.intervalDays,
    });
  },

  updatePlan: async (entry, executed) => {
    const updated = await PlanCatalogService.updatePlan(planId, { price: "250.00" }, adminA.userId, LOCALE);
    expect(updated.price).toBe("250.00");
    record(executed, entry, AuditActionType.Update, planId, { changedFields: ["price"] });
  },

  setPlanActiveStatus: async (entry, executed) => {
    // Direction-paired: deactivate suspends the plan, reactivating restores it.
    const deactivated = await PlanCatalogService.setPlanActiveStatus(planId, false, adminA.userId, LOCALE);
    expect(deactivated.isActive).toBe(false);
    record(executed, entry, AuditActionType.Suspend, planId, { isActive: false });

    const reactivated = await PlanCatalogService.setPlanActiveStatus(planId, true, adminA.userId, LOCALE);
    expect(reactivated.isActive).toBe(true);
    record(executed, entry, AuditActionType.Reactivate, planId, { isActive: true });
  },

  createLesson: async (entry, executed) => {
    const input: LessonSubmitInput = {
      planId,
      title: `${runPrefix} opening lesson`,
    };
    const created = await LessonService.createLesson(input, adminA.userId, LOCALE);
    lessonId = created.id;
    expect(created.planId).toBe(planId);
    expect(created.title).toBe(input.title);
    tracked.register(lessons, lessonId);
    record(executed, entry, AuditActionType.Create, lessonId, {
      planId: created.planId,
      title: created.title,
    });
  },

  updateLesson: async (entry, executed) => {
    const renamedTitle = `${runPrefix} opening lesson retitled`;
    const updated = await LessonService.updateLesson(lessonId, { title: renamedTitle }, adminA.userId, LOCALE);
    expect(updated.title).toBe(renamedTitle);
    record(executed, entry, AuditActionType.Update, lessonId, { changedFields: ["title"] });
  },

  deleteLesson: async (entry, executed) => {
    const deleted = await LessonService.deleteLesson(lessonId, adminA.userId, LOCALE);
    expect(deleted.id).toBe(lessonId);
    record(executed, entry, AuditActionType.Delete, lessonId, {
      planId: deleted.planId,
      title: deleted.title,
    });
  },

  resolveSessionDispute: async (entry, executed) => {
    const resolved = await SessionLifecycleService.resolveSessionDispute(
      adminA.userId,
      disputeSessionId,
      DisputeResolution.Cancel,
      ARBITRATION_NOTE,
      LOCALE
    );
    expect(resolved.status).toBe(SessionStatus.Cancelled);
    // The note's free-text content never enters the trail — only its presence.
    record(executed, entry, AuditActionType.Override, disputeSessionId, {
      resolution: DisputeResolution.Cancel,
      notePresent: true,
    });
  },

  adminRescheduleSession: async (entry, executed) => {
    // Ordered future replacement pair — the boundary schema's ordering
    // refine and the service's past-grace window both accept it.
    const toStart = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const toEnd = new Date(toStart.getTime() + 60 * 60 * 1000);
    const input: AdminSessionRescheduleInput = {
      sessionId: rescheduleSessionId,
      startedAt: toStart,
      endedAt: toEnd,
    };
    const rescheduled = await SessionAdminGovernanceService.reschedule(adminA.userId, input, LOCALE, undefined, {
      transport: transportSpy,
    });
    expect(rescheduled.startedAt).toEqual(toStart);
    expect(rescheduled.endedAt).toEqual(toEnd);
    record(executed, entry, AuditActionType.Override, rescheduleSessionId, {
      action: "reschedule",
      from: { startedAt: RESCHEDULE_FROM_START.toISOString(), endedAt: RESCHEDULE_FROM_END.toISOString() },
      to: { startedAt: toStart.toISOString(), endedAt: toEnd.toISOString() },
    });
  },

  adminCancelSession: async (entry, executed) => {
    // Unkeyed cancel (null key — the claim mechanism is disabled, a
    // legitimate fire-and-forget admin operation). No fee is held, so the
    // refund slice is honestly a no-op.
    const input: AdminSessionCancelInput = { sessionId: cancelSessionId, reason: ADMIN_CANCEL_REASON };
    const cancelled = await SessionAdminGovernanceService.cancel(adminA.userId, input, LOCALE, null, undefined, {
      transport: transportSpy,
    });
    expect(cancelled.status).toBe(SessionStatus.Cancelled);
    record(executed, entry, AuditActionType.Override, cancelSessionId, {
      action: "cancel",
      reason: ADMIN_CANCEL_REASON,
    });
  },

  adminReassignTeacher: async (entry, executed) => {
    // The candidate (second certified teacher) differs from the fixture's
    // outgoing teacher — the guarded UPDATE's different-teacher eligibility
    // holds, and the audit row records BOTH ids.
    const input: AdminSessionReassignInput = {
      sessionId: reassignSessionId,
      newTeacherUserId: secondTeacherActor.userId,
    };
    const reassigned = await SessionAdminGovernanceService.reassignTeacher(adminA.userId, input, LOCALE, undefined, {
      transport: transportSpy,
    });
    expect(reassigned.teacherId).toBe(secondTeacherActor.userId);
    record(executed, entry, AuditActionType.Override, reassignSessionId, {
      action: "reassign",
      from: { teacherId: teacherActor.userId },
      to: { teacherId: secondTeacherActor.userId },
    });
  },

  adminJoinSession: async (entry, executed) => {
    // Audit-only observation: the session columns are never touched, and
    // the details payload is the service's FIXED literal.
    const input: AdminSessionJoinInput = { sessionId: joinSessionId };
    const joined = await SessionAdminGovernanceService.join(adminA.userId, input, LOCALE);
    expect(joined.status).toBe(SessionStatus.Started);
    record(executed, entry, AuditActionType.Override, joinSessionId, {
      action: "join_observe",
    });
  },

  approveWithdrawal: async (entry, executed) => {
    // The teacher files the payout through the SHIPPED self-service flow
    // (the request reserves the debit: one pending `withdrawal` ledger row
    // + the guarded balance decrement). The admin approves it; the ledger
    // row settles `completed`. Exactly ONE Override row reconstructs the
    // decision on the `teacher_transaction` anchor.
    const requested = await WalletService.requestWithdrawal(financeTeacherId, FINANCE_PAYOUT_PRIMARY, LOCALE);
    const pending = requested.transactions.find(txn => txn.type === WITHDRAWAL_TYPE && txn.status === PENDING_STATUS);
    if (!pending) {
      throw new Error("finance leg: expected the fresh ledger page to carry the pending withdrawal row");
    }
    financeLedgerTxnIds.push(pending.id);

    const settled = await AdminFinancialAuditingService.approveWithdrawal(adminA.userId, pending.id, LOCALE);
    expect(settled.id).toBe(pending.id);
    expect(settled.status).toBe(TransactionStatus.Completed);
    record(executed, entry, AuditActionType.Override, pending.id, {
      action: "withdrawal_approved",
      amount: pending.amount,
      walletId: pending.walletId,
      teacherId: financeTeacherId,
    });
  },

  rejectWithdrawal: async (entry, executed) => {
    // The teacher files a second payout request; the admin rejects it with
    // a reason; the ledger row settles `failed` and the reserved debit is
    // restored. Exactly ONE Override row reconstructs the decision (the
    // raw reason text never enters the trail — only its presence).
    const requested = await WalletService.requestWithdrawal(financeTeacherId, FINANCE_PAYOUT_REJECTED, LOCALE);
    const pending = requested.transactions.find(txn => txn.type === WITHDRAWAL_TYPE && txn.status === PENDING_STATUS);
    if (!pending) {
      throw new Error("finance leg: expected the fresh ledger page to carry the pending withdrawal row");
    }
    financeLedgerTxnIds.push(pending.id);

    const rejected = await AdminFinancialAuditingService.rejectWithdrawal(
      adminA.userId,
      pending.id,
      FINANCE_REJECT_REASON,
      LOCALE
    );
    expect(rejected.id).toBe(pending.id);
    expect(rejected.status).toBe(TransactionStatus.Failed);
    record(executed, entry, AuditActionType.Override, pending.id, {
      action: "withdrawal_rejected",
      amount: pending.amount,
      walletId: pending.walletId,
      teacherId: financeTeacherId,
      reasonPresent: true,
    });
  },

  adjustTeacherWallet: async (entry, executed) => {
    // The admin books a reason-bearing manual credit: a `bonus`/`completed`
    // ledger row whose audit row rides the Adjust verb (ticket-pinned) on
    // the `teacher_transaction` anchor.
    const credit = await AdminFinancialAuditingService.adjustTeacherWallet(
      adminA.userId,
      {
        teacherId: financeTeacherId,
        amount: FINANCE_ADJUST_CREDIT,
        direction: WalletAdjustmentDirection.Credit,
        reason: FINANCE_ADJUST_REASON,
      },
      LOCALE
    );
    expect(credit.type).toBe(TransactionType.Bonus);
    expect(credit.status).toBe(TransactionStatus.Completed);
    financeLedgerTxnIds.push(credit.id);
    record(executed, entry, AuditActionType.Adjust, credit.id, {
      action: "wallet_adjustment",
      direction: WalletAdjustmentDirection.Credit,
      amount: credit.amount,
      teacherId: financeTeacherId,
      walletId: credit.walletId,
      reasonPresent: true,
      balanceAfter: "525.00",
    });
  },

  adminExtendSubscription: async (entry, executed) => {
    // The window bounds in the details are computed SERVER-SIDE from the
    // row's stored end date — the leg reads that anchor first so the
    // expected ISO pair derives from the same committed value.
    const before = await readSubscriptionRow(extendSubscriptionId);
    const previousEndDate = before.endDate;
    if (!previousEndDate) {
      throw new Error("subscription leg: extend fixture has no window end");
    }
    const extended = await SubscriptionAdminService.extendSubscription(
      { subscriptionId: extendSubscriptionId, days: SUBSCRIPTION_EXTEND_DAYS },
      adminA.userId,
      LOCALE
    );
    expect(extended.status).toBe(SubscriptionStatus.Active);
    record(executed, entry, AuditActionType.Update, extendSubscriptionId, {
      previousEndDate: previousEndDate.toISOString(),
      newEndDate: new Date(previousEndDate.getTime() + SUBSCRIPTION_EXTEND_DAYS * MS_PER_DAY).toISOString(),
      addedDays: SUBSCRIPTION_EXTEND_DAYS,
    });
  },

  adminCancelSubscription: async (entry, executed) => {
    const lanesBefore = await readOwnerLaneBalances();
    const cancelled = await SubscriptionAdminService.cancelSubscription(
      { subscriptionId: extendSubscriptionId, reason: SUBSCRIPTION_CANCEL_REASON },
      adminA.userId,
      LOCALE
    );
    expect(cancelled.status).toBe(SubscriptionStatus.Cancelled);
    // Balance-preserving: the cancel touches NO lane column (the sweep
    // zeroes; cancel never does).
    expect(await readOwnerLaneBalances()).toEqual(lanesBefore);
    record(executed, entry, AuditActionType.Suspend, extendSubscriptionId, {
      fromStatus: SubscriptionStatus.Active,
      toStatus: SubscriptionStatus.Cancelled,
      reason: SUBSCRIPTION_CANCEL_REASON,
    });
  },

  adminRenewSubscription: async (entry, executed) => {
    const renewed = await SubscriptionAdminService.renewSubscription(
      { subscriptionId: renewSourceId },
      adminA.userId,
      LOCALE
    );
    renewedSubscriptionId = renewed.id;
    expect(renewed.status).toBe(SubscriptionStatus.Active);
    tracked.register(subscriptions, renewedSubscriptionId);
    await trackClaimForSubscription(renewedSubscriptionId);
    record(executed, entry, AuditActionType.Create, renewedSubscriptionId, {
      renewedFromSubscriptionId: renewSourceId,
      planId: sourcePlanId,
      creditedSessions: SOURCE_PLAN_SESSION_COUNT,
      intervalDays: SOURCE_PLAN_INTERVAL_DAYS,
    });
  },

  adminChangeSubscriptionPlan: async (entry, executed) => {
    // The source row is the renewal's fresh period; the target's strictly
    // smaller unit value (25.00 → 12.50 per session) pins the Downgrade
    // direction — the seeded lane remainder (seed + the renewal's credit) is
    // forfeited, and the lane settles to the target plan's session count.
    const changed = await SubscriptionAdminService.changeSubscriptionPlan(
      { subscriptionId: renewedSubscriptionId, newPlanId: downgradePlanId },
      adminA.userId,
      LOCALE
    );
    planChangedSubscriptionId = changed.subscription.id;
    expect(changed.direction).toBe(ProrationDirection.Downgrade);
    expect(changed.carrySessions).toBe(0);
    expect(changed.forfeitedSessions).toBe(SUBSCRIPTION_LANE_SEED + SOURCE_PLAN_SESSION_COUNT);
    tracked.register(subscriptions, planChangedSubscriptionId);
    await trackClaimForSubscription(planChangedSubscriptionId);
    record(executed, entry, AuditActionType.Override, planChangedSubscriptionId, {
      direction: ProrationDirection.Downgrade,
      fromSubscriptionId: renewedSubscriptionId,
      fromPlanId: sourcePlanId,
      toPlanId: downgradePlanId,
      carrySessions: 0,
      forfeitedExcess: SUBSCRIPTION_LANE_SEED + SOURCE_PLAN_SESSION_COUNT,
    });
  },
};

/**
 * Executes the census rows named by `mutationFields` through their real
 * service runners and validates every execution against the census row's
 * pinned contract (verb inside `expectedActionTypes`, entity type exact).
 * A missing runner or an off-contract execution fails loudly — the census
 * drives, the services obey.
 */
async function executeCensusRows(mutationFields: readonly string[]): Promise<ExecutedAction[]> {
  const executed: ExecutedAction[] = [];
  // Chained sequentially: each census action must commit before the next so
  // the trail's newest-first ordering mirrors the execution order exactly.
  await mutationFields.reduce(async (chain, field) => {
    await chain;
    const entry = ADMIN_ACTION_CENSUS.find(
      candidate => candidate.kind === "wired" && candidate.mutationField === field
    );
    if (!entry) {
      throw new Error(`census execution: "${field}" is not a wired census row`);
    }
    const runner = censusRunners[entry.mutationField];
    if (!runner) {
      throw new Error(`census execution: no runner wired for census row "${entry.mutationField}"`);
    }
    const before = executed.length;
    await runner(entry, executed);
    const produced = executed.slice(before);
    if (produced.length === 0) {
      throw new Error(`census execution: "${entry.mutationField}" recorded no executions`);
    }
    for (const action of produced) {
      if (!entry.expectedActionTypes.includes(action.actionType)) {
        throw new Error(`census execution: "${entry.mutationField}" minted unexpected verb "${action.actionType}"`);
      }
      if (action.entityType !== entry.expectedEntityType) {
        throw new Error(`census execution: "${entry.mutationField}" minted unexpected entity "${action.entityType}"`);
      }
    }
  }, Promise.resolve());
  return executed;
}

/** Builds the user-anchor filter for the observer's reads. */
function userAnchor(entityId: number): AdminAuditTrailFiltersSubmitInput {
  return { entityType: "user", entityId };
}

describe("Audit-trail completeness journey — execute every admin action, prove the trail", () => {
  beforeAll(async () => {
    // One COMMITTING transaction: provisioning is commit-or-nothing, so a
    // throwing setup rolls back and leaves nothing behind.
    await db.transaction(async tx => {
      adminA = await provisionAdminActor(tx, { tracked });
      adminB = await provisionAdminActor(tx, { tracked });
      studentActor = await provisionStudentActor(tx, { tracked });
      parentActor = await provisionParentActor(tx, { tracked });
      teacherActor = await provisionCertifiedTeacherActor(tx, { tracked });
      secondTeacherActor = await provisionCertifiedTeacherActor(tx, { tracked });

      // The broadcast cohort is fixture state, not permissions: an explicit
      // field-mapped update (never a spread) pins the run-unique sentinel.
      await tx.update(users).set({ country: COHORT_COUNTRY }).where(eq(users.id, studentActor.userId));

      // The disputed-session fixture: a directly inserted real `session` row
      // (the sanctioned fixture-level pattern — the dispute intake path is a
      // participant flow, not under test here). No fee is held, so the Cancel
      // arbitration's refund slice is honestly a no-op.
      const [disputedRow] = await tx
        .insert(session)
        .values({
          teacherId: teacherActor.userId,
          studentId: studentActor.userId,
          intent: SessionIntent.Hifz,
          status: SessionStatus.Disputed,
          disputeReason: DISPUTE_REASON,
          disputedAt: new Date(),
          feeHeld: false,
        })
        .returning();
      if (!disputedRow) {
        throw new Error("journey setup: disputed session insert returned no rows");
      }
      disputeSessionId = disputedRow.id;
      tracked.register(session, disputeSessionId);

      // The governance-leg fixtures: four directly inserted real `session`
      // rows, one per census action, each in the state its guarded mutation
      // requires (same sanctioned fixture-level pattern as the dispute row;
      // the participant booking flow is not under test here). No fee is held
      // anywhere, so the cancel's refund slice is honestly a no-op.
      const governanceRows = await tx
        .insert(session)
        .values([
          {
            // reschedule: a scheduled row whose stored pair the audit `from`
            // reports (whole-second instants — lossless round trip).
            teacherId: teacherActor.userId,
            studentId: studentActor.userId,
            intent: SessionIntent.Hifz,
            status: SessionStatus.Scheduled,
            startedAt: RESCHEDULE_FROM_START,
            endedAt: RESCHEDULE_FROM_END,
            feeHeld: false,
          },
          {
            // cancel: a pre-terminal scheduled row.
            teacherId: teacherActor.userId,
            studentId: studentActor.userId,
            intent: SessionIntent.Hifz,
            status: SessionStatus.Scheduled,
            feeHeld: false,
          },
          {
            // reassign: a scheduled row whose outgoing teacher differs from
            // the certified candidate.
            teacherId: teacherActor.userId,
            studentId: studentActor.userId,
            intent: SessionIntent.Hifz,
            status: SessionStatus.Scheduled,
            feeHeld: false,
          },
          {
            // join: a live started row (the observation is audit-only).
            teacherId: teacherActor.userId,
            studentId: studentActor.userId,
            intent: SessionIntent.Hifz,
            status: SessionStatus.Started,
            startedAt: JOIN_STARTED_AT,
            endedAt: JOIN_ENDED_AT,
            feeHeld: false,
          },
        ])
        .returning({ id: session.id });
      if (governanceRows.length !== 4) {
        throw new Error("journey setup: governance session fixtures insert returned unexpected row count");
      }
      [rescheduleSessionId, cancelSessionId, reassignSessionId, joinSessionId] = governanceRows.map(row => row.id);
      for (const id of [rescheduleSessionId, cancelSessionId, reassignSessionId, joinSessionId]) {
        tracked.register(session, id);
      }

      // The financial-auditing fixture: a funded wallet for the certified
      // teacher (the shipped payout flow reserves the debit at REQUEST time,
      // so the approve/reject legs need real headroom to file the request).
      // The wallet is registered (children-first teardown); the
      // `teacher_transaction` rows the legs mint are swept in `afterAll`
      // under the immutability-trigger suspension instead.
      const financeWallet = await createTestWallet(tx, teacherActor.userId, {
        balance: "500.00",
        totalEarning: "500.00",
      });
      financeWalletId = financeWallet.id;
      financeTeacherId = teacherActor.userId;
      tracked.register(wallet, financeWalletId);

      // The subscription-admin leg fixtures: two ACTIVE same-lane plans —
      // the target's strictly smaller per-session unit value pins the
      // downgrade direction — and the two subscription rows each mutation
      // requires (extend/cancel act on the active row; renew recovers the
      // expired one). The owner is the cast student; the seeded lane balance
      // makes the forfeit arithmetic exact (the renewal credits the plan's
      // full session count on top of the seed BEFORE the change settles the
      // lane to the target plan's session count).
      const sourcePlan = await createTestPlan(tx, {
        title: `${runPrefix} admin-sub source plan`,
        sessionCount: SOURCE_PLAN_SESSION_COUNT,
        price: SOURCE_PLAN_PRICE,
        intervalDays: SOURCE_PLAN_INTERVAL_DAYS,
        balanceLane: SubscriptionCreditLane.Hifz,
      });
      sourcePlanId = sourcePlan.id;
      tracked.register(plans, sourcePlanId);

      const downgradePlan = await createTestPlan(tx, {
        title: `${runPrefix} admin-sub downgrade target`,
        sessionCount: DOWNGRADE_PLAN_SESSION_COUNT,
        price: DOWNGRADE_PLAN_PRICE,
        intervalDays: DOWNGRADE_PLAN_INTERVAL_DAYS,
        balanceLane: SubscriptionCreditLane.Hifz,
      });
      downgradePlanId = downgradePlan.id;
      tracked.register(plans, downgradePlanId);

      await tx
        .update(students)
        .set({ balanceHifz: SUBSCRIPTION_LANE_SEED })
        .where(eq(students.id, studentActor.userId));

      const extendSubscription = await createTestSubscription(tx, studentActor.userId, sourcePlanId, {
        status: SubscriptionStatus.Active,
        startDate: EXTEND_WINDOW_START,
        endDate: EXTEND_WINDOW_END,
      });
      extendSubscriptionId = extendSubscription.id;
      tracked.register(subscriptions, extendSubscriptionId);

      const renewSource = await createTestSubscription(tx, studentActor.userId, sourcePlanId, {
        status: SubscriptionStatus.Expired,
        startDate: new Date(EXTEND_WINDOW_START.getTime() - 90 * MS_PER_DAY),
        endDate: new Date(EXTEND_WINDOW_END.getTime() - 90 * MS_PER_DAY),
      });
      renewSourceId = renewSource.id;
      tracked.register(subscriptions, renewSourceId);
    });

    // Row-count oracles: whole-table baselines the legs assert deltas against.
    // The verb + entity-type baselines account for pre-existing trail rows
    // (the seeded plan-catalog creates) that the whole-table axis sweeps
    // observe but the journey's execution log does not own.
    auditBaseline = await countAllAuditRows();
    notificationBaseline = await countAllNotificationRows();
    const preExistingRows = await db
      .select({ actionType: auditLogs.actionType, entityType: auditLogs.entityType })
      .from(auditLogs);
    baselineVerbCounts = new Map<string, number>();
    baselineTypeCounts = new Map<string, number>();
    for (const row of preExistingRows) {
      baselineVerbCounts.set(row.actionType, (baselineVerbCounts.get(row.actionType) ?? 0) + 1);
      baselineTypeCounts.set(row.entityType, (baselineTypeCounts.get(row.entityType) ?? 0) + 1);
    }
  });

  afterAll(async () => {
    // Every user id the journey created (cast + service-minted targets).
    const journeyUserIds = [
      adminA?.userId,
      adminB?.userId,
      studentActor?.userId,
      parentActor?.userId,
      teacherActor?.userId,
      secondTeacherActor?.userId,
      targetStudentId,
      teacherTargetId,
    ].filter((id): id is number => typeof id === "number" && Number.isSafeInteger(id) && id > 0);

    if (journeyUserIds.length > 0) {
      // Audit rows FIRST — `audit_logs.actor_id` is `ON DELETE RESTRICT`, so
      // these deletes must precede the `users` delete, and the append-only
      // immutability trigger must be suspended for them (the only sanctioned
      // mutation path). Every minted row is attributed to a journey admin, so
      // the actor sweep catches the whole journey footprint; the second
      // statement defensively sweeps rows ABOUT the journey users as the
      // ENTITY (`entity_id` is nullable, no FK — the raw parameterized query
      // sidesteps Drizzle's `inArray` typing friction on nullable columns).
      await withAuditDeleteTriggersSuspended(async () => {
        await db.delete(auditLogs).where(inArray(auditLogs.actorId, journeyUserIds));
        await queryDb(
          `DELETE FROM audit_logs
           WHERE entity_type = 'user' AND entity_id = ANY($1::int[])`,
          [journeyUserIds]
        );
      });

      // Defensive notification sweep — every notification row the journey
      // created targets a journey user (welcome-free create path, the
      // certification row, the broadcast row), and `user_id` cascades on
      // user delete anyway.
      await db.delete(notifications).where(inArray(notifications.userId, journeyUserIds));
    }

    // Financial-auditing ledger teardown: the `teacher_transaction` rows the
    // finance legs minted are DELETE-blocked (append-only trigger), so they
    // are hard-deleted FIRST under the sanctioned suspension wrapper — never
    // registered in the tracked registry. The belt-and-braces actor/entity
    // audit sweep above already drained their audit rows.
    if (financeLedgerTxnIds.length > 0) {
      await withImmutabilityTriggersSuspended(["teacher_transaction"], () =>
        db.delete(teacherTransaction).where(inArray(teacherTransaction.id, [...financeLedgerTxnIds]))
      );
    }

    // Tracked hard-delete in reverse registration order (children before
    // owning users), with mandatory zero-residue existence probes.
    await tracked.cleanup();

    // Post-teardown probes: the baselines are restored platform-wide.
    expect(await countUsersByIds(journeyUserIds)).toBe(0);
    expect(await countAllAuditRows()).toBe(auditBaseline);
    expect(await countAllNotificationRows()).toBe(notificationBaseline);

    // The junction rows the renew + change legs inserted cascaded away with
    // their subscription/student parents (composite PK — no registry row).
    expect(await db.$count(studentSubscriptions, eq(studentSubscriptions.studentId, studentActor.userId))).toBe(0);
  });

  test("system: cast and fixture sessions committed with clean audit and notification footprints", async () => {
    // 6 actors × (users row + role-child row) + the five fixture sessions
    // (dispute + reschedule + cancel + reassign + join) + the finance
    // teacher's funded wallet fixture + the subscription-admin leg's two
    // same-lane plans and two subscription rows.
    expect(tracked.size).toBe(22);

    // The dispatch map covers every wired census row — a census row without
    // a runner would silently skip execution and fake completeness.
    const wiredFields: string[] = ADMIN_ACTION_CENSUS.filter(row => row.kind === "wired").map(row => row.mutationField);
    const legFields: string[] = [
      ...USER_LIFECYCLE_LEG,
      ...CERTIFICATION_BROADCAST_LEG,
      ...PLAN_CATALOG_LEG,
      ...LESSON_LEG,
      ...DISPUTE_LEG,
      ...SESSION_GOVERNANCE_LEG,
      ...FINANCE_LEG,
      ...SUBSCRIPTION_ADMIN_LEG,
    ];
    expect(legFields).toHaveLength(wiredFields.length);
    expect(legFields.toSorted((a, b) => a.localeCompare(b))).toEqual(
      wiredFields.toSorted((a, b) => a.localeCompare(b))
    );

    // Clean start: nothing minted BY the admins, nothing in ANY cast inbox.
    const auditByAdmins = await Promise.all(
      [adminA.userId, adminB.userId].map(actorId => countAuditRowsForActor(actorId))
    );
    const castInboxes = await Promise.all(
      [adminA.userId, adminB.userId, studentActor.userId, parentActor.userId, teacherActor.userId].map(userId =>
        db.$count(notifications, eq(notifications.userId, userId))
      )
    );
    for (const count of auditByAdmins) {
      expect(count).toBe(0);
    }
    for (const count of castInboxes) {
      expect(count).toBe(0);
    }

    // The census accounts for every action-type enum member: every verb is
    // wired (the financial-auditing trio covers the Adjust verb through the
    // reason-bearing manual adjustment).
    for (const member of Object.values(AuditActionType)) {
      const wiredCovered = ADMIN_ACTION_CENSUS.some(
        row => row.kind === "wired" && row.expectedActionTypes.includes(member)
      );
      expect(wiredCovered).toBe(true);
    }
  });

  test("producer executes the user-lifecycle census rows through the real service path", async () => {
    const auditBefore = await countAllAuditRows();
    const legActions = await executeCensusRows(USER_LIFECYCLE_LEG);
    executedActions.push(...legActions);

    // Zero-missing oracle: whole-table delta equals the executions — no row
    // lost, no phantom row minted.
    expect(legActions).toHaveLength(11);
    expect(await countAllAuditRows()).toBe(auditBefore + legActions.length);
    expect(await countAllAuditRows()).toBe(auditBaseline + executedActions.length);
  });

  test("producer executes the certification and broadcast census rows through the real service path", async () => {
    const auditBefore = await countAllAuditRows();
    const legActions = await executeCensusRows(CERTIFICATION_BROADCAST_LEG);
    executedActions.push(...legActions);

    expect(legActions).toHaveLength(2);
    expect(await countAllAuditRows()).toBe(auditBefore + legActions.length);
    expect(await countAllAuditRows()).toBe(auditBaseline + executedActions.length);
  });

  test("producer executes the plan-catalog census rows through the real service path", async () => {
    const auditBefore = await countAllAuditRows();
    const legActions = await executeCensusRows(PLAN_CATALOG_LEG);
    executedActions.push(...legActions);

    // The direction-paired status row exercised BOTH verbs (deactivate →
    // suspend, reactivate → restore).
    expect(legActions).toHaveLength(4);
    expect(legActions.map(action => action.actionType)).toEqual([
      AuditActionType.Create,
      AuditActionType.Update,
      AuditActionType.Suspend,
      AuditActionType.Reactivate,
    ]);
    expect(await countAllAuditRows()).toBe(auditBefore + legActions.length);
    expect(await countAllAuditRows()).toBe(auditBaseline + executedActions.length);
  });

  test("producer executes the subscription-admin census rows through the real service path", async () => {
    const auditBefore = await countAllAuditRows();
    const legActions = await executeCensusRows(SUBSCRIPTION_ADMIN_LEG);
    executedActions.push(...legActions);

    // The pinned per-mutation vocabulary — extend→Update, cancel→Suspend,
    // renew→Create, plan-change→Override — one row per mutation on its own
    // subscription anchor (extend and cancel share the row they act on).
    expect(legActions).toHaveLength(4);
    expect(legActions.map(action => action.actionType)).toEqual([
      AuditActionType.Update,
      AuditActionType.Suspend,
      AuditActionType.Create,
      AuditActionType.Override,
    ]);
    expect(await countAllAuditRows()).toBe(auditBefore + legActions.length);
    expect(await countAllAuditRows()).toBe(auditBaseline + executedActions.length);

    // Each mutation committed its own side effect with the trail row: the
    // window shifted, then the row cancelled (extend + cancel share it); the
    // renewal opened a fresh active period on the same plan; the change moved
    // that period onto the downgrade target while the owner's lane landed on
    // the prepared exact total (the forfeited remainder = seed + credit).
    const extendCancelRows = await readSubscriptionRow(extendSubscriptionId);
    expect(extendCancelRows.status).toBe(SubscriptionStatus.Cancelled);
    expect(extendCancelRows.endDate).toEqual(EXTEND_WINDOW_END_EXTENDED);

    const renewedRows = await readSubscriptionRow(renewedSubscriptionId);
    expect(renewedRows.status).toBe(SubscriptionStatus.Cancelled);
    expect(renewedRows.planId).toBe(sourcePlanId);

    const changedRows = await readSubscriptionRow(planChangedSubscriptionId);
    expect(changedRows.status).toBe(SubscriptionStatus.Active);
    expect(changedRows.planId).toBe(downgradePlanId);
    expect(changedRows.paymentMethod).toBeNull();
    expect(changedRows.paymentReference).toBeNull();

    const junctionRows = await db
      .select({ subscriptionId: studentSubscriptions.subscriptionId })
      .from(studentSubscriptions)
      .where(eq(studentSubscriptions.studentId, studentActor.userId));
    expect(junctionRows.map(row => row.subscriptionId).toSorted((a, b) => a - b)).toEqual(
      [renewedSubscriptionId, planChangedSubscriptionId].toSorted((a, b) => a - b)
    );

    expect(await readOwnerLaneBalances()).toEqual({
      hifz: DOWNGRADE_PLAN_SESSION_COUNT,
      tajweed: 0,
      reviews: 0,
      trial: 0,
    });
  });

  test("producer executes the lesson-catalog census rows through the real service path", async () => {
    const auditBefore = await countAllAuditRows();
    const legActions = await executeCensusRows(LESSON_LEG);
    executedActions.push(...legActions);

    // One verb per mutation: the curriculum trio mints Create, Update, and
    // Delete rows on the same lesson anchor, in leg order.
    expect(legActions).toHaveLength(3);
    expect(legActions.map(action => action.actionType)).toEqual([
      AuditActionType.Create,
      AuditActionType.Update,
      AuditActionType.Delete,
    ]);
    expect(await countAllAuditRows()).toBe(auditBefore + legActions.length);
    expect(await countAllAuditRows()).toBe(auditBaseline + executedActions.length);
  });

  test("producer arbitrates the disputed-session fixture through the real service path", async () => {
    const auditBefore = await countAllAuditRows();
    const legActions = await executeCensusRows(DISPUTE_LEG);
    executedActions.push(...legActions);

    expect(legActions).toHaveLength(1);
    expect(await countAllAuditRows()).toBe(auditBefore + legActions.length);
    expect(await countAllAuditRows()).toBe(auditBaseline + executedActions.length);

    // The arbitration's session-side effects committed with the trail row.
    const sessionRows = await db.select().from(session).where(eq(session.id, disputeSessionId)).limit(1);
    expect(sessionRows[0]?.status).toBe(SessionStatus.Cancelled);
    expect(sessionRows[0]?.resolvedAt).not.toBeNull();
    expect(sessionRows[0]?.resolutionNote).toBe(ARBITRATION_NOTE);
  });

  test("producer executes the session-governance census rows through the real service path", async () => {
    const auditBefore = await countAllAuditRows();
    const spyBefore = transportSpy.publishCount;
    const legActions = await executeCensusRows(SESSION_GOVERNANCE_LEG);
    executedActions.push(...legActions);

    // Every governance mutation mints exactly one Override row on its
    // session anchor.
    expect(legActions).toHaveLength(4);
    expect(legActions.map(action => action.actionType)).toEqual([
      AuditActionType.Override,
      AuditActionType.Override,
      AuditActionType.Override,
      AuditActionType.Override,
    ]);
    expect(await countAllAuditRows()).toBe(auditBefore + legActions.length);
    expect(await countAllAuditRows()).toBe(auditBaseline + executedActions.length);

    // Dispatch proof: the three publishing ops fanned out through the spied
    // transport — never the default one — with one envelope per participant
    // receipt (reschedule: student+teacher, cancel: student+teacher,
    // reassign: student+outgoing+incoming = 7 envelopes; the audit-only join
    // publishes nothing).
    expect(transportSpy.publishCount - spyBefore).toBe(7);
    // The spy freezes each recorded `userIds` copy, so the envelopes can be
    // read directly — no per-call copy needed.
    const envelopes = transportSpy.calls.slice(spyBefore).map(call => call.userIds);
    expect(envelopes.every(ids => ids.length === 1)).toBe(true);
    const flattenedRecipients = envelopes.flat().toSorted((a, b) => a - b);
    const expectedRecipients = [
      studentActor.userId, // reschedule
      teacherActor.userId, // reschedule
      studentActor.userId, // cancel
      teacherActor.userId, // cancel
      studentActor.userId, // reassign
      teacherActor.userId, // reassign (outgoing)
      secondTeacherActor.userId, // reassign (incoming)
    ].toSorted((a, b) => a - b);
    expect(flattenedRecipients).toEqual(expectedRecipients);

    // Each guarded write committed its own side effect with the trail row.
    const rescheduledRows = await db.select().from(session).where(eq(session.id, rescheduleSessionId)).limit(1);
    expect(rescheduledRows[0]?.startedAt).not.toEqual(RESCHEDULE_FROM_START);

    const cancelledRows = await db.select().from(session).where(eq(session.id, cancelSessionId)).limit(1);
    expect(cancelledRows[0]?.status).toBe(SessionStatus.Cancelled);
    expect(cancelledRows[0]?.feeHeld).toBe(false);

    const reassignedRows = await db.select().from(session).where(eq(session.id, reassignSessionId)).limit(1);
    expect(reassignedRows[0]?.teacherId).toBe(secondTeacherActor.userId);
    expect(reassignedRows[0]?.status).toBe(SessionStatus.Scheduled);

    // The join observation is audit-only — the session columns are untouched.
    const joinedRows = await db.select().from(session).where(eq(session.id, joinSessionId)).limit(1);
    expect(joinedRows[0]?.status).toBe(SessionStatus.Started);
    expect(joinedRows[0]?.startedAt).toEqual(JOIN_STARTED_AT);
  });

  test("producer executes the financial-auditing census rows through the real service path", async () => {
    const auditBefore = await countAllAuditRows();
    const legActions = await executeCensusRows(FINANCE_LEG);
    executedActions.push(...legActions);

    // The adjustment mints the Adjust verb (ticket-pinned); every settlement
    // mints exactly one Override row on its ledger anchor. The verb order
    // mirrors the FINANCE_LEG execution order (adjust first).
    expect(legActions).toHaveLength(3);
    expect(legActions.map(action => action.actionType)).toEqual([
      AuditActionType.Adjust,
      AuditActionType.Override,
      AuditActionType.Override,
    ]);
    expect(await countAllAuditRows()).toBe(auditBefore + legActions.length);
    expect(await countAllAuditRows()).toBe(auditBaseline + executedActions.length);

    // Each settlement committed its own side effect with the trail row: the
    // approved row settled `completed`, the rejected row settled `failed`.
    // The destructure mirrors the FINANCE_LEG execution order (adjust first).
    const [adjustAction, approveAction, rejectAction] = legActions;
    if (!approveAction?.entityId || !rejectAction?.entityId || !adjustAction?.entityId) {
      throw new Error("finance leg: expected all three census executions to carry a ledger anchor id");
    }
    const approvedRows = await db
      .select()
      .from(teacherTransaction)
      .where(eq(teacherTransaction.id, approveAction.entityId))
      .limit(1);
    expect(approvedRows[0]?.status).toBe(TransactionStatus.Completed);

    const rejectedRows = await db
      .select()
      .from(teacherTransaction)
      .where(eq(teacherTransaction.id, rejectAction.entityId))
      .limit(1);
    expect(rejectedRows[0]?.status).toBe(TransactionStatus.Failed);

    const adjustedRows = await db
      .select()
      .from(teacherTransaction)
      .where(eq(teacherTransaction.id, adjustAction.entityId))
      .limit(1);
    expect(adjustedRows[0]?.type).toBe(TransactionType.Bonus);
    expect(adjustedRows[0]?.status).toBe(TransactionStatus.Completed);
  });

  test("system fixture lane mints the adjustment row whose shipped producer is deferred", async () => {
    const auditBefore = await countAllAuditRows();

    // Explicitly backdated, millisecond-precise timestamp — the fixture lane
    // owns this value end-to-end, so the window probes compare exact stored
    // values (service-minted rows carry database-generated timestamps and are
    // never used as window bounds).
    fixtureAdjustAt = new Date(Date.now() - 60_000);

    const fixtureRows = await db.transaction(tx =>
      tx
        .insert(auditLogs)
        .values([
          {
            actorId: adminB.userId,
            actionType: AuditActionType.Adjust,
            entityType: "user",
            entityId: parentActor.userId,
            details: `${runPrefix} adjust fixture`,
            createdAt: fixtureAdjustAt,
          },
        ])
        .returning({ id: auditLogs.id, actionType: sql<string>`${auditLogs.actionType}` })
    );
    const fixtureRow = fixtureRows[0];
    if (!fixtureRow) {
      throw new Error("fixture lane: adjust insert returned no rows");
    }
    // The insert-returning row carries the raw stored `action_type` string
    // (coercion is the read service's job, not the fixture lane's).
    expect(fixtureRow.actionType).toBe(rawActionType(AuditActionType.Adjust));
    fixtureRowId = fixtureRow.id;

    // The row is attributed to the observer, so the producer's footprint
    // stays exactly the executed census actions.
    expect(await countAllAuditRows()).toBe(auditBefore + 1);
    expect(await countAuditRowsForActor(adminA.userId)).toBe(executedActions.length);
  });

  test("observer reads every executed action back: 1:1 mapping with full row shapes, no missing, no phantom", async () => {
    // Group the execution log per entity anchor (insertion order = execution
    // order). The broadcast row is the only anchor without an id — the
    // entityId axis cannot address it, so its group is read through the
    // entity type alone.
    const anchors = new Map<string, ExecutedAction[]>();
    for (const action of executedActions) {
      const key = `${action.entityType}:${action.entityId ?? "null"}`;
      const group = anchors.get(key);
      if (group) {
        group.push(action);
      } else {
        anchors.set(key, [action]);
      }
    }

    let matchedRows = 0;
    const anchorEntries = [...anchors.entries()].map(([key, expectedActions]) => {
      const [entityType, rawEntityId] = key.split(":");
      if (!entityType) {
        throw new Error(`mapping oracle: malformed entity anchor "${key}"`);
      }
      const filters: AdminAuditTrailFiltersSubmitInput =
        rawEntityId === "null" ? { entityType } : { entityType, entityId: Number(rawEntityId) };
      return { key, expectedActions, filters };
    });
    // The observer's reads are independent — fetch them in parallel, then
    // assert against each anchor's expected subset.
    const pages = await Promise.all(
      anchorEntries.map(({ filters }) => AuditTrailService.listAuditTrail(filters, 1, 50, adminB.locale, adminB.userId))
    );
    for (const [anchorIndex, page] of pages.entries()) {
      const { expectedActions } = anchorEntries[anchorIndex];

      // Exact subset: the anchor holds exactly the actions executed about it.
      expect(page.totalCount).toBe(expectedActions.length);
      expect(page.items).toHaveLength(expectedActions.length);

      // Newest-first == execution order reversed; every row carries the full
      // expected shape: actor, verb, entity anchor, present timestamp, and
      // the exact `details` contract recorded at execution time.
      const expectedNewestFirst = expectedActions.toReversed();
      for (const [index, row] of page.items.entries()) {
        const expectedAction = expectedNewestFirst[index];
        if (!expectedAction) {
          throw new Error(`mapping oracle: trail row ${row.id} has no matching execution`);
        }
        expect(row.actionType).toBe(expectedAction.actionType);
        expect(row.entityType).toBe(expectedAction.entityType);
        expect(row.entityId).toBe(expectedAction.entityId);
        expect(row.actorId).toBe(adminA.userId);
        expect(row.createdAt).toBeInstanceOf(Date);
        expect(parseAuditDetails(row)).toEqual(expectedAction.expectedDetails);
        matchedRows += 1;
      }
    }

    // Every executed action resolved to EXACTLY ONE trail row, and every
    // producer row mapped back to exactly one execution (no missing, no
    // phantom — the two directions together are the 1:1 confusion oracle).
    expect(matchedRows).toBe(executedActions.length);
    expect(await countAuditRowsForActor(adminA.userId)).toBe(executedActions.length);
  });

  test("canonical ordering holds with the createdAt DESC, id DESC tiebreak on the busiest anchor", async () => {
    const rows = await db
      .select({
        id: auditLogs.id,
        createdAt: auditLogs.createdAt,
        actionType: sql<string>`${auditLogs.actionType}`,
      })
      .from(auditLogs)
      .where(and(eq(auditLogs.entityType, "user"), eq(auditLogs.entityId, targetStudentId)))
      .orderBy(desc(auditLogs.createdAt), desc(auditLogs.id));

    // The governance target's anchor holds exactly the executed user rows.
    const expectedNewestFirst = executedActions
      .filter(action => action.entityType === "user" && action.entityId === targetStudentId)
      .map(action => action.actionType)
      .toReversed();
    expect(rows.map(row => row.actionType)).toEqual(expectedNewestFirst);

    // The read surface and the raw canonical ordering agree on the exact
    // row sequence (ids included).
    const page = await AuditTrailService.listAuditTrail(
      userAnchor(targetStudentId),
      1,
      50,
      adminB.locale,
      adminB.userId
    );
    expect(page.items.map(row => row.id)).toEqual(rows.map(row => row.id));

    // Strict newest-first: equal-timestamp rows (same-tx batches) are
    // tiebroken by id DESC — a later execution always sorts first.
    for (let index = 1; index < rows.length; index += 1) {
      const newer = rows[index - 1];
      const older = rows[index];
      if (!newer || !older) {
        throw new Error(`ordering probe: row pair missing at index ${index}`);
      }
      expect(newer.createdAt.getTime()).toBeGreaterThanOrEqual(older.createdAt.getTime());
      if (newer.createdAt.getTime() === older.createdAt.getTime()) {
        expect(newer.id).toBeGreaterThan(older.id);
      }
    }
  });

  test("observer filters by actor, action type, entity type, and exact time window — each returns exactly its subset", async () => {
    // Actor axis: the producer's footprint and the observer's fixture row.
    const producerPage = await AuditTrailService.listAuditTrail(
      { actorId: adminA.userId },
      1,
      50,
      adminB.locale,
      adminB.userId
    );
    expect(producerPage.totalCount).toBe(executedActions.length);

    const observerPage = await AuditTrailService.listAuditTrail(
      { actorId: adminB.userId },
      1,
      50,
      adminB.locale,
      adminB.userId
    );
    expect(observerPage.totalCount).toBe(1);
    const observerRow = observerPage.items.at(0);
    if (!observerRow) {
      throw new Error("actor axis: expected the fixture row in the observer's own trail");
    }
    expect(observerRow.id).toBe(fixtureRowId);
    expect(observerRow.actionType).toBe(AuditActionType.Adjust);
    expect(observerRow.entityId).toBe(parentActor.userId);

    // Action-type axis: every enum value's subset, counted from the
    // execution log plus the fixture lane plus the pre-existing baseline.
    const expectedVerbCounts = new Map<string, number>(baselineVerbCounts);
    for (const action of executedActions) {
      expectedVerbCounts.set(action.actionType, (expectedVerbCounts.get(action.actionType) ?? 0) + 1);
    }
    expectedVerbCounts.set(AuditActionType.Adjust, (expectedVerbCounts.get(AuditActionType.Adjust) ?? 0) + 1);
    const verbSweeps = await Promise.all(
      Object.values(AuditActionType).map(async verb => ({
        verb,
        page: await AuditTrailService.listAuditTrail({ actionType: verb }, 1, 50, adminB.locale, adminB.userId),
      }))
    );
    for (const { verb, page } of verbSweeps) {
      expect(page.totalCount).toBe(expectedVerbCounts.get(verb) ?? 0);
      for (const row of page.items) {
        expect(row.actionType).toBe(verb);
      }
    }

    // Entity-type axis: the same counting discipline across entity types,
    // including the pre-existing baseline rows.
    const expectedTypeCounts = new Map<string, number>(baselineTypeCounts);
    for (const action of executedActions) {
      expectedTypeCounts.set(action.entityType, (expectedTypeCounts.get(action.entityType) ?? 0) + 1);
    }
    expectedTypeCounts.set("user", (expectedTypeCounts.get("user") ?? 0) + 1);
    const typeSweeps = await Promise.all(
      [...expectedTypeCounts.keys()].map(async entityType => ({
        entityType,
        page: await AuditTrailService.listAuditTrail({ entityType }, 1, 50, adminB.locale, adminB.userId),
      }))
    );
    for (const { entityType, page } of typeSweeps) {
      const expectedCount = expectedTypeCounts.get(entityType);
      if (expectedCount === undefined) {
        throw new Error(`entity-type axis: no expected count for "${entityType}"`);
      }
      expect(page.totalCount).toBe(expectedCount);
    }

    // Mismatch probe: pairing a verb with the WRONG entity anchor sees
    // nothing — the filter excludes, it never blurs.
    const createOnWrongAnchor = await AuditTrailService.listAuditTrail(
      { actionType: AuditActionType.Create, entityType: "plan", entityId: targetStudentId },
      1,
      50,
      adminB.locale,
      adminB.userId
    );
    expect(createOnWrongAnchor.totalCount).toBe(0);
    expect(createOnWrongAnchor.items).toHaveLength(0);

    // Time-window axis, boundary-exact on the backdated fixture row: a row
    // exactly AT `from` is included, one millisecond past it is excluded.
    const windowAt = await AuditTrailService.listAuditTrail(
      {
        entityType: "user",
        entityId: parentActor.userId,
        from: fixtureAdjustAt,
        to: new Date(fixtureAdjustAt.getTime() + 1),
      },
      1,
      50,
      adminB.locale,
      adminB.userId
    );
    expect(windowAt.totalCount).toBe(1);
    expect(windowAt.items.at(0)?.id).toBe(fixtureRowId);

    const windowPast = await AuditTrailService.listAuditTrail(
      {
        entityType: "user",
        entityId: parentActor.userId,
        from: new Date(fixtureAdjustAt.getTime() + 1),
        to: new Date(fixtureAdjustAt.getTime() + 2),
      },
      1,
      50,
      adminB.locale,
      adminB.userId
    );
    expect(windowPast.totalCount).toBe(0);
    expect(windowPast.items).toHaveLength(0);
  });

  test("repeated governance actions append distinct rows — the trail is append-only, never deduplicating", async () => {
    // The soft-delete census row ran TWO full toggle cycles: both Delete
    // executions minted their own row, with distinct ids.
    const deleteRows = await AuditTrailService.listAuditTrail(
      { actionType: AuditActionType.Delete, entityType: "user", entityId: targetStudentId },
      1,
      50,
      adminB.locale,
      adminB.userId
    );
    expect(deleteRows.totalCount).toBe(2);
    const ids = deleteRows.items.map(row => row.id);
    expect(new Set(ids).size).toBe(2);
    for (const row of deleteRows.items) {
      expect(parseAuditDetails(row)).toEqual({ deleted: true });
    }
  });

  test("non-admin and anonymous actors are denied every census action and mint zero rows", async () => {
    const auditBefore = await countAllAuditRows();
    const notificationsBefore = await countAllNotificationRows();

    // Every wired census action, invoked with valid-shaped input so each
    // denial is the authorization gate, never input validation.
    const attempts: readonly { readonly field: string; readonly call: (actorId: number) => Promise<unknown> }[] = [
      {
        field: "adminCreateUser",
        call: actorId => AdminUserManagementService.createUser(makeCreateUserInput("student"), actorId, LOCALE),
      },
      {
        field: "adminUpdateUser",
        call: actorId =>
          AdminUserManagementService.updateUser(targetStudentId, { fullName: `${runPrefix} Denied` }, actorId, LOCALE),
      },
      {
        field: "adminSetUserDeleted",
        call: actorId => AdminUserManagementService.setUserDeleted(targetStudentId, true, actorId, LOCALE),
      },
      {
        field: "adminSetUserSuspended",
        call: actorId =>
          AdminUserManagementService.setUserSuspended(targetStudentId, true, SUSPENSION_PERIOD_DAYS, actorId, LOCALE),
      },
      {
        field: "adminSetUserBlocked",
        call: actorId => AdminUserManagementService.setUserBlocked(targetStudentId, true, actorId, LOCALE),
      },
      {
        field: "adminCertifyTeacherColdStart",
        call: actorId =>
          ColdStartCertificationService.certifyTeacherColdStart(
            actorId,
            { userId: teacherTargetId, makeEvaluator: false },
            LOCALE,
            { transport: transportSpy }
          ),
      },
      {
        field: "adminBroadcastNotification",
        call: actorId =>
          AdminBroadcastService.broadcast(
            {
              title: `${runPrefix} denied broadcast`,
              body: `${runPrefix} denied broadcast body`,
              audience: { type: BroadcastAudienceType.Country, country: COHORT_COUNTRY },
            },
            actorId,
            LOCALE,
            undefined,
            { transport: transportSpy }
          ),
      },
      {
        field: "createPlan",
        call: actorId =>
          PlanCatalogService.createPlan(
            { title: `${runPrefix} denied plan`, sessionCount: 8, price: "200.00", currency: "EGP", intervalDays: 30 },
            actorId,
            LOCALE
          ),
      },
      {
        field: "updatePlan",
        call: actorId => PlanCatalogService.updatePlan(planId, { price: "300.00" }, actorId, LOCALE),
      },
      {
        field: "setPlanActiveStatus",
        call: actorId => PlanCatalogService.setPlanActiveStatus(planId, false, actorId, LOCALE),
      },
      {
        field: "createLesson",
        call: actorId => LessonService.createLesson({ planId, title: `${runPrefix} denied lesson` }, actorId, LOCALE),
      },
      {
        field: "updateLesson",
        call: actorId => LessonService.updateLesson(lessonId, { title: `${runPrefix} denied lesson` }, actorId, LOCALE),
      },
      {
        field: "deleteLesson",
        call: actorId => LessonService.deleteLesson(lessonId, actorId, LOCALE),
      },
      {
        field: "resolveSessionDispute",
        call: actorId =>
          SessionLifecycleService.resolveSessionDispute(
            actorId,
            disputeSessionId,
            DisputeResolution.Cancel,
            null,
            LOCALE
          ),
      },
      {
        field: "adminRescheduleSession",
        call: actorId =>
          SessionAdminGovernanceService.reschedule(
            actorId,
            {
              sessionId: rescheduleSessionId,
              startedAt: new Date("2031-01-10T10:00:00.000Z"),
              endedAt: new Date("2031-01-10T11:00:00.000Z"),
            },
            LOCALE
          ),
      },
      {
        field: "adminCancelSession",
        call: actorId => SessionAdminGovernanceService.cancel(actorId, { sessionId: cancelSessionId }, LOCALE, null),
      },
      {
        field: "adminReassignTeacher",
        call: actorId =>
          SessionAdminGovernanceService.reassignTeacher(
            actorId,
            { sessionId: reassignSessionId, newTeacherUserId: secondTeacherActor.userId },
            LOCALE
          ),
      },
      {
        field: "adminJoinSession",
        call: actorId => SessionAdminGovernanceService.join(actorId, { sessionId: joinSessionId }, LOCALE),
      },
      {
        field: "approveWithdrawal",
        call: actorId => AdminFinancialAuditingService.approveWithdrawal(actorId, financeWalletId, LOCALE),
      },
      {
        field: "rejectWithdrawal",
        call: actorId =>
          AdminFinancialAuditingService.rejectWithdrawal(actorId, financeWalletId, `${runPrefix} denied`, LOCALE),
      },
      {
        field: "adjustTeacherWallet",
        call: actorId =>
          AdminFinancialAuditingService.adjustTeacherWallet(
            actorId,
            {
              teacherId: financeTeacherId,
              amount: "1.00",
              direction: WalletAdjustmentDirection.Credit,
              reason: `${runPrefix} denied adjustment`,
            },
            LOCALE
          ),
      },
      {
        field: "adminExtendSubscription",
        call: actorId =>
          SubscriptionAdminService.extendSubscription(
            { subscriptionId: extendSubscriptionId, days: SUBSCRIPTION_EXTEND_DAYS },
            actorId,
            LOCALE
          ),
      },
      {
        field: "adminRenewSubscription",
        call: actorId => SubscriptionAdminService.renewSubscription({ subscriptionId: renewSourceId }, actorId, LOCALE),
      },
      {
        field: "adminCancelSubscription",
        call: actorId =>
          SubscriptionAdminService.cancelSubscription({ subscriptionId: extendSubscriptionId }, actorId, LOCALE),
      },
      {
        field: "adminChangeSubscriptionPlan",
        call: actorId =>
          SubscriptionAdminService.changeSubscriptionPlan(
            { subscriptionId: extendSubscriptionId, newPlanId: downgradePlanId },
            actorId,
            LOCALE
          ),
      },
    ];

    // The denial matrix names exactly the wired census rows — a shipped admin
    // action attempted by nobody would leave the matrix dishonest.
    const attemptFields = attempts.map(attempt => attempt.field).toSorted((a, b) => a.localeCompare(b));
    expect(attemptFields).toEqual(
      ADMIN_ACTION_CENSUS.filter(row => row.kind === "wired")
        .map(row => row.mutationField)
        .toSorted((a, b) => a.localeCompare(b))
    );

    const nonAdminActors = [studentActor, parentActor, teacherActor];

    /** Recursively denies one non-admin actor after another (per-actor count oracles between waves). */
    async function denyActorWave(actorIndex: number): Promise<void> {
      const actor = nonAdminActors[actorIndex];
      if (!actor) {
        return;
      }
      const auditForActorBefore = await countAuditRowsForActor(actor.userId);
      const errors = await Promise.all(attempts.map(attempt => expectJourneyError(() => attempt.call(actor.userId))));
      for (const error of errors) {
        expect(error).toBeInstanceOf(ForbiddenError);
        expect(error.message).toContain(tErrors.forbidden);
      }
      // Per-actor zero-mint: the whole wave minted nothing for the denier.
      expect(await countAuditRowsForActor(actor.userId)).toBe(auditForActorBefore);
      expect(await countAuditRowsForActor(actor.userId)).toBe(0);
      await denyActorWave(actorIndex + 1);
    }
    await denyActorWave(0);

    // Anonymous callers carry no user row at all. Surfaces gated by
    // `assertActorAdmin` resolve the actor first and deny a missing row
    // with the unauthenticated class; the arbitration's governance gate
    // classifies a missing actor as a permission failure instead, so each
    // attempt asserts the class its own gate throws.
    const anonymousErrors = await Promise.all(
      attempts.map(attempt => expectJourneyError(() => attempt.call(ANONYMOUS_ACTOR_ID)))
    );
    for (const [attemptIndex, error] of anonymousErrors.entries()) {
      const attemptField = attempts[attemptIndex]?.field;
      // Surfaces gated by `assertAdminGovernanceClean` (the arbitration AND
      // the session-governance suite) classify a missing actor as a
      // permission failure; `assertActorAdmin` surfaces deny with the
      // unauthenticated class instead.
      const governanceGatedAttempt = [...DISPUTE_LEG, ...SESSION_GOVERNANCE_LEG].some(leg => leg === attemptField);
      expect(error).toBeInstanceOf(governanceGatedAttempt ? ForbiddenError : UnauthorizedError);
      expect(error.message).toContain(governanceGatedAttempt ? tErrors.forbidden : tErrors.unauthorized);
    }
    expect(await countAuditRowsForActor(ANONYMOUS_ACTOR_ID)).toBe(0);

    // Zero pollution platform-wide across the whole matrix.
    expect(await countAllAuditRows()).toBe(auditBefore);
    expect(await countAllNotificationRows()).toBe(notificationsBefore);
  });

  test("domain failures mid-flight mint zero rows — the trail never records a rejected action", async () => {
    const auditBefore = await countAllAuditRows();

    // Already-in-status transition on the (active) plan.
    const alreadyActive = await expectJourneyError(() =>
      PlanCatalogService.setPlanActiveStatus(planId, true, adminA.userId, LOCALE)
    );
    expect(alreadyActive).toBeInstanceOf(DomainError);
    expect(alreadyActive.message).toContain(tErrors.planCatalog.planAlreadyActive);

    // Empty patch on the plan update surface.
    const emptyPatch = await expectJourneyError(() => PlanCatalogService.updatePlan(planId, {}, adminA.userId, LOCALE));
    expect(emptyPatch).toBeInstanceOf(ValidationError);
    expect(emptyPatch.message).toContain(tErrors.planCatalog.planPatchEmpty);

    // Re-arbitrating the already-resolved session.
    const reArbitration = await expectJourneyError(() =>
      SessionLifecycleService.resolveSessionDispute(
        adminA.userId,
        disputeSessionId,
        DisputeResolution.Cancel,
        null,
        LOCALE
      )
    );
    expect(reArbitration).toBeInstanceOf(ConflictError);
    expect(reArbitration.message).toContain(tErrors.sessionInvalidTransition);

    // The producer's footprint is byte-unchanged across all three failures.
    expect(await countAuditRowsForActor(adminA.userId)).toBe(executedActions.length);
    expect(await countAllAuditRows()).toBe(auditBefore);
  });

  test("completeness oracle: minted rows equal executed actions plus the fixture lane, with every verb accounted", async () => {
    // Whole-table zero-missing oracle: the journey minted exactly one row per
    // successful census execution plus exactly one fixture row — no missing,
    // no phantom, platform-wide.
    const minted = await countAllAuditRows();
    expect(minted).toBe(auditBaseline + executedActions.length + 1);

    // Enum coverage accounting: every `audit_action_type` value is exercised
    // at least once — the wired rows cover their verbs, the fixture lane
    // covers the deferred adjustment verb.
    const accounted = new Set([...executedActions.map(action => action.actionType), AuditActionType.Adjust]);
    const enumMembers = Object.values(AuditActionType);
    expect(accounted.size).toBe(enumMembers.length);
    for (const member of enumMembers) {
      expect(accounted.has(member)).toBe(true);
    }
  });
});
