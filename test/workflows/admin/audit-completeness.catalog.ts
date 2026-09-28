/**
 * Admin action census — the machine-readable inventory of every shipped
 * admin-gated GraphQL mutation and the exact audit-trail shape its service
 * path is expected to mint.
 *
 * The census is the single typed source of truth that binds three surfaces
 * together:
 *  - the shipped admin mutation inventory under `backend/graphql/mutation/**`,
 *    bound bijectively (both directions) by the static census-drift test
 *    (`backend/db/test/logic/audit/audit-census-drift.test.ts`) so an
 *    unaudited admin mutation cannot ship without a census row, and a census
 *    row cannot outlive its mutation;
 *  - the append-only `audit_logs` trail, whose per-row shape (action type +
 *    entity type) each `wired` row pins — the mutation may map to more than
 *    one action type when its direction decides the verb (e.g. delete vs
 *    reactivate, suspend vs reactivate);
 *  - the audit-completeness journey, which executes every `wired` row through
 *    the real service path and asserts the minted rows against this shape.
 *
 * `deferred` rows name admin-action categories whose producer is NOT yet
 * shipped; each carries the ledger id of its owning deferred item so the gap
 * stays traceable to an owner. When such a surface ships, the drift test
 * fails until its row is replaced by a `wired` entry.
 *
 * The exhaustive `ACTION_TYPE_COVERAGE` map accounts for every
 * `AuditActionType` member: `"wired"` = shipped producer exists, `"fixture"`
 * = exercised by a System fixture lane in the completeness journey, and
 * `"deferred"` = producer still pending. Because the map is a total
 * `Record` over the enum, adding a new enum member fails to compile here
 * until it is accounted for.
 */

import { AuditActionType } from "@/backend/enum/audit/audit-action-type.enum";

/**
 * Canonical ledger IDs of deferred audit producers for future admin surfaces that have not yet shipped.
 * Statically declared in TypeScript to keep anti-drift tests independent of markdown plan files.
 *
 * D-001's composite subscription row is REPLACED by the per-mutation wired
 * subscription rows above; the id itself stays reserved here (never
 * renumbered) so a future subscription-surface deferral can reference it again.
 */
export const DEFERRED_ADMIN_ACTION_IDS = ["D-001", "D-002", "D-003"] as const;
type DeferredAdminActionId = (typeof DEFERRED_ADMIN_ACTION_IDS)[number];

/** One census row: a shipped admin mutation (or a ledger-backed future surface) and its expected audit shape. */
export interface AdminActionCensusEntry {
  /** GraphQL mutation field name, e.g. "adminCreateUser". */
  readonly mutationField: string;
  /** Service entry for reference/documentation, e.g. "AdminUserManagementService.createUser". */
  readonly serviceEntry: string;
  /** Expected action types (a mutation may map to >1, e.g. setUserDeleted → Delete|Reactivate). */
  readonly expectedActionTypes: readonly AuditActionType[];
  /** Exact `audit_logs.entity_type` string the producer must stamp. */
  readonly expectedEntityType: string;
  /**
   * Optional secondary audit-row shapes for composite producers — mutations
   * whose single service path mints audit rows for MORE than one entity type
   * in one commit (e.g. a provisioning flow that mints a `user` row and a
   * `subscription` row together). Each member pins the exact
   * `audit_logs.entity_type` string and the action verbs that secondary row
   * must carry; the primary `expectedActionTypes`/`expectedEntityType` pair
   * above keeps anchoring the row minted for the primary entity. A secondary
   * entity type must differ from `expectedEntityType` — an extra same-entity
   * row is expressed by widening the primary `expectedActionTypes` instead.
   * Single-entity producers leave this undefined.
   */
  readonly secondaryExpectedAuditRows?: readonly {
    entityType: string;
    expectedActionTypes: readonly AuditActionType[];
  }[];
  /** wired = journey must execute it; deferred = no shipped producer (ledger row required). */
  readonly kind: "wired" | "deferred";
  /** deferred rows must name their deferred-items ledger id (e.g. "D-001"). */
  readonly deferredRef?: DeferredAdminActionId;
}

/**
 * The admin action census: one `wired` entry per shipped admin-gated mutation
 * field, plus `deferred` entries for categories whose producer is future work.
 * The drift test keeps this list in exact bijection with the shipped
 * `UserRole.Admin`-gated mutation fields, so it cannot rot silently.
 */
export const ADMIN_ACTION_CENSUS: readonly AdminActionCensusEntry[] = [
  // ── User lifecycle & governance (AdminUserManagementService) ───────────────
  {
    mutationField: "adminCreateUser",
    serviceEntry: "AdminUserManagementService.createUser",
    expectedActionTypes: [AuditActionType.Create],
    expectedEntityType: "user",
    kind: "wired",
  },
  {
    mutationField: "adminUpdateUser",
    serviceEntry: "AdminUserManagementService.updateUser",
    expectedActionTypes: [AuditActionType.Update],
    expectedEntityType: "user",
    kind: "wired",
  },
  {
    mutationField: "adminSetUserDeleted",
    serviceEntry: "AdminUserManagementService.setUserDeleted",
    expectedActionTypes: [AuditActionType.Delete, AuditActionType.Reactivate],
    expectedEntityType: "user",
    kind: "wired",
  },
  {
    mutationField: "adminSetUserSuspended",
    serviceEntry: "AdminUserManagementService.setUserSuspended",
    expectedActionTypes: [AuditActionType.Suspend, AuditActionType.Reactivate],
    expectedEntityType: "user",
    kind: "wired",
  },
  {
    mutationField: "adminSetUserBlocked",
    serviceEntry: "AdminUserManagementService.setUserBlocked",
    expectedActionTypes: [AuditActionType.Suspend, AuditActionType.Reactivate],
    expectedEntityType: "user",
    kind: "wired",
  },

  // ── Direct student onboarding (StudentOnboardingService) ───────────────────
  {
    mutationField: "adminOnboardStudentWithOfflinePayment",
    serviceEntry: "StudentOnboardingService.onboardStudentWithOfflinePayment",
    expectedActionTypes: [AuditActionType.Create],
    expectedEntityType: "user",
    secondaryExpectedAuditRows: [{ entityType: "subscription", expectedActionTypes: [AuditActionType.Create] }],
    kind: "wired",
  },

  // ── Teacher cold-start certification ───────────────────────────────────────
  {
    mutationField: "adminCertifyTeacherColdStart",
    serviceEntry: "ColdStartCertificationService.certifyTeacherColdStart",
    expectedActionTypes: [AuditActionType.Override],
    expectedEntityType: "teacher",
    kind: "wired",
  },

  // ── Announcement broadcast ─────────────────────────────────────────────────
  {
    mutationField: "adminBroadcastNotification",
    serviceEntry: "AdminBroadcastService.broadcast",
    expectedActionTypes: [AuditActionType.Create],
    expectedEntityType: "notification_broadcast",
    kind: "wired",
  },
  {
    mutationField: "adminStopBroadcast",
    serviceEntry: "AdminBroadcastService.stopBroadcast",
    expectedActionTypes: [AuditActionType.Suspend],
    expectedEntityType: "notification_broadcast",
    kind: "wired",
  },

  // ── Plan catalog ───────────────────────────────────────────────────────────
  {
    mutationField: "createPlan",
    serviceEntry: "PlanCatalogService.createPlan",
    expectedActionTypes: [AuditActionType.Create],
    expectedEntityType: "plan",
    kind: "wired",
  },
  {
    mutationField: "updatePlan",
    serviceEntry: "PlanCatalogService.updatePlan",
    expectedActionTypes: [AuditActionType.Update],
    expectedEntityType: "plan",
    kind: "wired",
  },
  {
    mutationField: "setPlanActiveStatus",
    serviceEntry: "PlanCatalogService.setPlanActiveStatus",
    expectedActionTypes: [AuditActionType.Suspend, AuditActionType.Reactivate],
    expectedEntityType: "plan",
    kind: "wired",
  },

  // ── Curriculum lessons (LessonService) ─────────────────────────────────────
  {
    mutationField: "createLesson",
    serviceEntry: "LessonService.createLesson",
    expectedActionTypes: [AuditActionType.Create],
    expectedEntityType: "lesson",
    kind: "wired",
  },
  {
    mutationField: "updateLesson",
    serviceEntry: "LessonService.updateLesson",
    expectedActionTypes: [AuditActionType.Update],
    expectedEntityType: "lesson",
    kind: "wired",
  },
  {
    mutationField: "deleteLesson",
    serviceEntry: "LessonService.deleteLesson",
    expectedActionTypes: [AuditActionType.Delete],
    expectedEntityType: "lesson",
    kind: "wired",
  },

  // ── Session dispute arbitration ────────────────────────────────────────────
  {
    mutationField: "resolveSessionDispute",
    serviceEntry: "SessionLifecycleService.resolveSessionDispute",
    expectedActionTypes: [AuditActionType.Override],
    expectedEntityType: "session",
    kind: "wired",
  },

  // ── Admin session governance (SessionAdminGovernanceService) ───────────────
  {
    mutationField: "adminRescheduleSession",
    serviceEntry: "SessionAdminGovernanceService.reschedule",
    expectedActionTypes: [AuditActionType.Override],
    expectedEntityType: "session",
    kind: "wired",
  },
  {
    mutationField: "adminCancelSession",
    serviceEntry: "SessionAdminGovernanceService.cancel",
    expectedActionTypes: [AuditActionType.Override],
    expectedEntityType: "session",
    kind: "wired",
  },
  {
    mutationField: "adminReassignTeacher",
    serviceEntry: "SessionAdminGovernanceService.reassignTeacher",
    expectedActionTypes: [AuditActionType.Override],
    expectedEntityType: "session",
    kind: "wired",
  },
  {
    mutationField: "adminJoinSession",
    serviceEntry: "SessionAdminGovernanceService.join",
    expectedActionTypes: [AuditActionType.Override],
    expectedEntityType: "session",
    kind: "wired",
  },

  // ── Admin financial auditing (AdminFinancialAuditingService) ───────────────
  {
    mutationField: "approveWithdrawal",
    serviceEntry: "AdminFinancialAuditingService.approveWithdrawal",
    expectedActionTypes: [AuditActionType.Override],
    expectedEntityType: "teacher_transaction",
    kind: "wired",
  },
  {
    mutationField: "rejectWithdrawal",
    serviceEntry: "AdminFinancialAuditingService.rejectWithdrawal",
    expectedActionTypes: [AuditActionType.Override],
    expectedEntityType: "teacher_transaction",
    kind: "wired",
  },
  {
    mutationField: "adjustTeacherWallet",
    serviceEntry: "AdminFinancialAuditingService.adjustTeacherWallet",
    expectedActionTypes: [AuditActionType.Adjust],
    expectedEntityType: "teacher_transaction",
    kind: "wired",
  },

  // ── Admin subscription lifecycle (SubscriptionAdminService) ────────────────
  {
    mutationField: "adminExtendSubscription",
    serviceEntry: "SubscriptionAdminService.extendSubscription",
    expectedActionTypes: [AuditActionType.Update],
    expectedEntityType: "subscription",
    kind: "wired",
  },
  {
    mutationField: "adminRenewSubscription",
    serviceEntry: "SubscriptionAdminService.renewSubscription",
    expectedActionTypes: [AuditActionType.Create],
    expectedEntityType: "subscription",
    kind: "wired",
  },
  {
    mutationField: "adminCancelSubscription",
    serviceEntry: "SubscriptionAdminService.cancelSubscription",
    expectedActionTypes: [AuditActionType.Suspend],
    expectedEntityType: "subscription",
    kind: "wired",
  },
  {
    mutationField: "adminChangeSubscriptionPlan",
    serviceEntry: "SubscriptionAdminService.changeSubscriptionPlan",
    expectedActionTypes: [AuditActionType.Override],
    expectedEntityType: "subscription",
    kind: "wired",
  },

  // ── Applicant cooldown governance (ApplicantLifecycleService) ──────────────
  {
    mutationField: "adminExtendApplicantCooldown",
    serviceEntry: "ApplicantLifecycleService.extendApplicantCooldown",
    expectedActionTypes: [AuditActionType.Adjust],
    expectedEntityType: "applicant",
    kind: "wired",
  },

  // ── Applicant evaluation override (ApplicantLifecycleService) ──────────────
  {
    mutationField: "adminOverrideApplicantEvaluation",
    serviceEntry: "ApplicantLifecycleService.overrideApplicantEvaluation",
    expectedActionTypes: [AuditActionType.Override],
    expectedEntityType: "applicant",
    kind: "wired",
  },

  // ── Deferred producers (ledger-backed future surfaces) ─────────────────────
  {
    mutationField: "(future) adminResetUserPassword",
    serviceEntry: "credential administration — unshipped",
    expectedActionTypes: [AuditActionType.Override],
    expectedEntityType: "user",
    kind: "deferred",
    deferredRef: "D-003",
  },
];

/**
 * Exhaustive accounting of every `AuditActionType` member. `"wired"` — a
 * shipped producer emits it; `"fixture"` — no shipped producer, exercised by
 * the completeness journey's System fixture lane; `"deferred"` — producer
 * pending on a ledger-backed future surface. Total over the enum: a new
 * member breaks compilation here until it is accounted for.
 */
export const ACTION_TYPE_COVERAGE: Record<AuditActionType, "wired" | "fixture" | "deferred"> = {
  [AuditActionType.Create]: "wired",
  [AuditActionType.Update]: "wired",
  [AuditActionType.Delete]: "wired",
  [AuditActionType.Override]: "wired",
  [AuditActionType.Suspend]: "wired",
  [AuditActionType.Reactivate]: "wired",
  [AuditActionType.Adjust]: "wired",
};
