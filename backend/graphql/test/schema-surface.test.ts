/**
 * GraphQL schema surface assertion suite — pinned-additions gate +
 * codegen-sync proof.
 *
 * What this locks down:
 *  - **Retyped probe** — `Query._health: HealthCheck!` (the legacy inline
 *    `String!` placeholder from `builder.ts` was deleted BEFORE the new
 *    registration landed — the duplicate-field crash regression is
 *    therefore covered here permanently).
 *  - **Shape closure** — `HealthCheck` exposes EXACTLY the four scalar
 *    fields (`status`, `service`, `version`, `timestamp`), each `String!`,
 *    and carries NO `id` field (embedded value object — proven both at
 *    the type level and behaviorally: selecting `id` fails validation).
 *  - **Surface freeze** — against the frozen baseline inventory (captured
 *    at HEAD `8e5ebb8`, since refreshed for the sanctioned baseline
 *    additions (applicant surface, the notifications engine — enum
 *    + inbox queries + read-latch mutations, the users-locale pair, the
 *    handshake surface, and the admin plan-catalog
 *    + user-management surfaces): every post-baseline addition is pinned by
 *    name — the mutation set grows ONLY by the lifecycle quartet
 *    (`createSession`, `startSession`, `completeSession`, `cancelSession`),
 *    the dispute pair (`openSessionDispute`, `resolveSessionDispute`),
 *    the dual-confirmation mutation (`confirmSessionCompletion`),
 *    the payout write (`requestWithdrawal`), the
 *    admin-governance pair (`adminSetUserBlocked`, `adminSetUserSuspended`),
 *    and the subscription-purchase write (`purchaseSubscription`);
 *    the query set grows ONLY by the participant-read trio
 *    (`sessionById`, `myStudentSessions`, `myTeacherSessions`), the
 *    admin arbitration listing (`adminDisputedSessions`), the
 *    wallet read (`myWallet`), and the subscription-purchase owner listing
 *    (`mySubscriptions`); the enum set grows ONLY by the
 *    scheduling trio (`SessionStatus`, `SessionType`, `SessionIntent`),
 *    the arbitration vocabulary (`DisputeResolution`), the
 *    ledger pair (`TransactionType`, `TransactionStatus`), and the
 *    subscription-purchase settlement quartet (`PaymentGateway`,
 *    `PaymentStatus`, `SubscriptionCreditLane`, `SubscriptionStatus`); the
 *    whole-schema named-type delta is exactly the session
 *    objects/inputs + arbitration + ledger enums + wallet surface + the
 *    subscription-purchase five (`PaymentCheckout`,
 *    `PurchaseSubscriptionInput`, `PurchaseSubscriptionPayload`,
 *    `StudentPayment`, `StudentSubscription`) on top of the refreshed
 *    baseline delta; and the 4.4 codegen reconcile pins the admin
 *    session-governance surface (2 queries + 4 mutations + 5 inputs, NO new
 *    object/enum) on top of the refreshed delta. The `RECONCILED_*`
 *    inventories re-anchor the surfaces prior rounds shipped without
 *    enumeration (admin audit trail, admin broadcast, teacher cold-start
 *    certification, parent-link lifecycle, the R1–R3 admin directory trio
 *    and the R5 export trio) to the live schema — the same documented
 *    one-time reconciliation idiom. The session-report
 *    surface then grows the sets ONLY by the `submitSessionReport` write, the
 *    `sessionReport` / `sessionHomework` read pair, the `SurahJuzRef`
 *    recitation enum, the four closed report/homework input whitelists, and
 *    the two report objects.
 *  - **admin-governance surface pins** — the two new
 *    admin-governance mutations carry the EXACT arg shapes
 *    (`adminSetUserBlocked(blocked: Boolean!, id: Int!): AdminUserDetail!` /
 *    `adminSetUserSuspended(id: Int!, periodDays: Int, suspended: Boolean!):
 *    AdminUserDetail!`), sit at their lexicographic sorted positions
 *    (`adminCreateUser` < `adminSetUserBlocked` < `adminSetUserDeleted` <
 *    `adminSetUserSuspended` < `adminUpdateUser`), and carry the load-bearing
 *    `authScopes: { $all: { authenticated: true, role: [UserRole.Admin] } }`
 *    conjunction verbatim (the `$all` is what makes the scope combine with
 *    AND semantics — a plain scope map would silently degrade to ANY).
 *  - **admin financial-auditing surface pins** — the three new
 *    financial-auditing queries and the three mutations carry the
 *    `$all` conjunction and sit at their lexicographic sorted positions
 *    (`approveWithdrawal` < `adjustTeacherWallet` < `rejectWithdrawal` on
 *    the mutation root; `adminPendingWithdrawals` < `adminStudentPayments`
 *    < `adminTeacherWallet` on the query root); the adjustment-direction
 *    enum exposes exactly the `Credit`/`Debit` wire vocabulary; and the
 *    three row objects (`AdminStudentPayment`, `AdminTeacherWallet`,
 *    `AdminWithdrawalQueueRow`) plus their page wrappers
 *    (`AdminStudentPaymentPage`, `AdminWithdrawalQueuePage`) disclose
 *    EXACTLY their pinned field sets with per-field types (the wrappers
 *    carry no `id` — embedded value objects).
 *  - **Allowlist agreement** — the scopeless `_health` field is present in
 *    the closed `PUBLIC_OPERATION_NAMES` tuple / `PUBLIC_OPERATIONS` set
 *    1:1 (schema↔allowlist agreement enforced as code).
 *  - **Anonymous reachability** — executing the probe document with an EMPTY
 *    context succeeds through the real production schema (public by design;
 *    also proves the resolver is delegation-only: no ctx/DB access exists
 *    on the path, otherwise this call could not succeed).
 *  - **Codegen sync (scripted)** — the checked-in
 *    `frontend/graphql/generated/schema.graphql` is BYTE-IDENTICAL to a
 *    fresh `printSchema(lexicographicSortSchema(graphQLSchema))` emission,
 *    i.e. generated artifacts are in lockstep with the code-first builder
 *    (read-only disk access; the suite writes NOTHING). Belt-and-braces
 *    pins assert the session surface is really inside the
 *    committed artifact (seven root operations + the two object types +
 *    the two input types) plus the dispute surface (the three
 *    new root operations, the arbitration enum, and the five nullable
 *    `Session` fields).
 *
 * Reconciliation note: the prior baseline drift — the
 * `PRE_3_1_*` inventories captured the admin-user-management
 * surface by name in the JSDoc but never enumerated its fields/types/enums
 * in the actual assertion arrays. The admin-user query quartet
 * (`adminUserActivity`, `adminUserDetail`, `adminUserStats`, `adminUsers`),
 * the admin-user mutation trio (`adminCreateUser`,
 * `adminSetUserDeleted`, `adminUpdateUser`), the admin enums
 * (`AdminUserGovernanceFilter`, `AuditActionType`), and the
 * admin-user named-type surface (11 object/input types) are now re-anchored
 * to the LIVE built schema via the new `ADMIN_USER_*` constants below
 * — captured via `printSchema(lexicographicSortSchema(graphQLSchema))` as
 * empirical evidence and documented here as a one-time reconciliation (not
 * a silent baseline flip). The admin-governance pair is then
 * pinned on top as the sanctioned post-reconciliation addition.
 *
 * Reconciliation note (4.4 codegen reconcile): the
 * admin session-governance surface (queries `adminSession`/`adminSessions`,
 * mutations `adminRescheduleSession`/`adminCancelSession`/
 * `adminReassignTeacher`/`adminJoinSession`, inputs
 * `AdminSessionRescheduleInput`/`AdminSessionCancelInput`/
 * `AdminSessionReassignInput`/`AdminSessionJoinInput`/
 * `AdminSessionListFilterInput`, plus the widened `Session.needsAttention:
 * Boolean!` badge field) is pinned on top as the sanctioned ticket
 * addition. The `RECONCILED*` constants below re-anchor the
 * merged-but-never-pinned surfaces (PR #49 parent-link workflow, PR #51
 * cold-start certification, PR #53 broadcast + audit trail) alongside the
 * R1–R3 admin directory trio and the R5 export trio — captured from the
 * LIVE built schema as empirical evidence, a documented
 * one-time reconciliation (not a silent baseline flip). The codegen-sync
 * pin (byte-identical committed SDL) was restored by the 4.4
 * `bun run generate:gqlSchema` regeneration.
 *
 * Reconciliation note: the same drift class had recurred — the
 * parent-link surface (2 listing reads + 3 participant mutations + the
 * `LinkStatus` enum + 2 request objects), the admin audit-trail surface
 * (`adminAuditLogs` + the `AdminAuditLog*` page/input types), the admin
 * broadcast surface (`adminBroadcastNotification` + `BroadcastAudienceInput`
 * + `BroadcastAudienceType` + `AdminBroadcastNotificationInput`), and the
 * admin teacher cold-start certification (`adminCertifyTeacherColdStart`)
 * were all committed to the schema (and inside the checked-in codegen
 * artifact at HEAD) but never enumerated in the assertion arrays. They are
 * re-anchored to the live built schema via the `RECONCILED*` constants
 * below — the same documented one-time reconciliation, not a silent
 * baseline flip — so the whole-schema freeze the additions ride
 * on is honest again.
 *
 *  - **session-recitation pair** — the write-once per-session
 *    record is pinned by name: the teacher-gated `setSessionRecitation`
 *    mutation (NON-nullable payload), the participant-scoped NULLABLE
 *    `sessionRecitation` query (the collapse channel), and the
 *    `SessionRecitation` / `SessionRecitationInput` named types. The
 *    broadcast-notification, audit-log, cold-start-certification, and
 *    parent-link surfaces that shipped on the live roots without inventory
 *    entries are re-anchored here as a documented one-time reconciliation
 *    (additions only — no historical pin altered).
 *
 * Pure unit tier — NO server boot, NO network, NO DB. Runs via the mandated
 * runner: `bun run test/scripts/run-test.ts backend/graphql/test/schema-surface.test.ts`.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  GraphQLEnumType,
  type GraphQLField,
  GraphQLInputObjectType,
  GraphQLObjectType,
  getNamedType,
  graphql,
  isSpecifiedScalarType,
  lexicographicSortSchema,
  parse,
  printSchema,
  validate,
} from "graphql";
import { NotificationType } from "@/backend/enum/notifications/notification-type.enum";
import { UserRole } from "@/backend/enum/users/user-role.enum";
import { graphQLSchema } from "@/backend/graphql/gqlSchema";
import { PUBLIC_OPERATION_NAMES, PUBLIC_OPERATIONS } from "@/backend/lib/gateway";

// ─── Frozen baseline inventory (captured @ HEAD 8e5ebb8; refreshed for the ────
// ─── sanctioned applicant + notifications + users-locale + handshake ─
// ─── + plan-catalog additions) ──────────────────────────────────────

/** Root query field names — the frozen baseline (probe re-registration excluded). */
const PRE_3_1_QUERY_FIELDS = [
  "adminPlans",
  "me",
  "myApplicantProfile",
  "myNotifications",
  "myUnreadNotificationCount",
  "planCatalog",
  "recitationReadings",
] as const;
/** Root mutation field names — the frozen baseline (auth quartet + notification read-latch pair + users-locale + plan-catalog CRUD). */
const PRE_3_1_MUTATION_FIELDS = [
  "createPlan",
  "login",
  "logout",
  "markAllNotificationsRead",
  "markNotificationRead",
  "refreshToken",
  "registerUser",
  "setPlanActiveStatus",
  "updateMyLocale",
  "updatePlan",
] as const;
/** GraphQL enum type names — the freeze forbids any new Pothos enum. */
const PRE_3_1_ENUMS = [
  "ApplicantStatus",
  "AppLocale",
  "Gender",
  "NotificationType",
  "RecitationReading",
  "RegisterPublicRole",
  "UserRole",
] as const;
/**
 * session lifecycle root fields — registered ONCE via the
 * side-effect barrels (`query|mutation/classes/index.ts` → top-level
 * barrel → `gqlSchema.ts`); role-gated/authenticated per REQ-032 and
 * therefore deliberately ABSENT from the public-operation allowlist
 * (`backend/lib/gateway/public-operations.ts` stays byte-unchanged).
 */
const SESSION_LIFECYCLE_QUERY_FIELDS = ["myStudentSessions", "myTeacherSessions", "sessionById"] as const;
/** admin arbitration listing — the admin-gated disputed queue. */
const DISPUTE_QUERY_FIELDS = ["adminDisputedSessions"] as const;
/** lifecycle mutation quartet (plan §3.1/§3.2 — REQ-060/061). */
const SESSION_LIFECYCLE_MUTATION_FIELDS = [
  "cancelSession",
  "completeSession",
  "createSession",
  "startSession",
] as const;
/** dispute mutation pair (R-102/R-104). */
const DISPUTE_MUTATION_FIELDS = ["openSessionDispute", "resolveSessionDispute"] as const;
/** post-confirmation dispute entry — the student-only consumed-escrow mutation. */
const ARBITRATION_MUTATION_FIELDS = ["openPostConfirmationDispute"] as const;
/** admin case-review read — the dispute evidence bundle query. */
const ARBITRATION_QUERY_FIELDS = ["adminDisputeCase", "adminDisputeAnalytics"] as const;
/** teacher case read — the own-teacher participant bundle query. */
const TEACHER_CASE_QUERY_FIELDS = ["teacherDisputeCase"] as const;
/** student case read — the own-student (filing party's) participant bundle query. */
const STUDENT_CASE_QUERY_FIELDS = ["studentDisputeCase"] as const;
/** the case-review envelope object (reuses the canonical entity objects). */
const ARBITRATION_TYPE_NAMES = [
  "AdminDisputeCase",
  "AdminDisputedSessionRow",
  "AdminDisputedSessionPage",
  "AdminDisputeAnalytics",
  "TeacherDisputeCase",
  "StudentDisputeCase",
] as const;
/** dual-confirmation mutation (R-201/R-202). */
const DUAL_CONFIRMATION_MUTATION_FIELDS = ["confirmSessionCompletion"] as const;
/** wallet read — the teacher-only wallet + ledger surface (R-301). */
const WALLET_QUERY_FIELDS = ["myWallet"] as const;
/** wallet payout write — the teacher-only withdrawal request (R-302). */
const WALLET_MUTATION_FIELDS = ["requestWithdrawal"] as const;
/** billing ledger vocabulary — registered ONCE in `shared/enum.pothos.ts`. */
const WALLET_ENUMS = ["TransactionStatus", "TransactionType"] as const;
/** arbitration outcome vocabulary — registered ONCE, no pgEnum backing. */
const DISPUTE_ENUMS = ["DisputeResolution"] as const;
/** nullable `Session` fields — the dispute + reason surface (R-105/R-107). */
const DISPUTE_SESSION_FIELDS = [
  "cancelReason",
  "disputeReason",
  "disputedAt",
  "resolutionNote",
  "resolutionOutcome",
  "resolvedAt",
] as const;
/** scheduling enum trio — registered ONCE in `shared/enum.pothos.ts`. */
const SESSION_LIFECYCLE_ENUMS = ["SessionIntent", "SessionStatus", "SessionType"] as const;
/**
 * admin-user-management query quartet — RECONCILED baseline drift
 * (these fields shipped on the live Mutation root as part of the
 * admin user-management surface but were never enumerated in the prior
 * `PRE_3_1_QUERY_FIELDS` inventory). Re-anchored to the live schema as a
 * documented one-time reconciliation ahead of pinning the
 * admin-governance pair.
 */
const ADMIN_USER_USER_QUERY_FIELDS = ["adminUserActivity", "adminUserDetail", "adminUserStats", "adminUsers"] as const;
/**
 * admin-user-management mutation trio — RECONCILED baseline drift
 * (the prior `PRE_3_1_MUTATION_FIELDS` inventory listed plan-catalog CRUD
 * but omitted the three admin-user writes that landed alongside it). The
 * admin-governance pair is pinned separately below.
 */
const ADMIN_USER_USER_MUTATION_FIELDS = ["adminCreateUser", "adminSetUserDeleted", "adminUpdateUser"] as const;
/**
 * admin-user-management vocabulary — RECONCILED baseline drift
 * (the governance-filter enum and the audit-action enum were never pinned
 * in the prior `PRE_3_1_ENUMS` inventory). Both enums are referenced by
 * the admin-user surface (filter input + activity feed).
 */
const ADMIN_USER_ENUMS = ["AdminUserGovernanceFilter", "AuditActionType"] as const;
/**
 * admin-governance mutation pair — the sanctioned
 * post-reconciliation addition. Both mutations carry the
 * `authScopes: { $all: { authenticated: true, role: [UserRole.Admin] } }`
 * conjunction (the `$all` is load-bearing — see the dedicated describe
 * block below). The live sorted Mutation root inventory carries them at
 * the positions `adminCreateUser` < `adminSetUserBlocked` <
 * `adminSetUserDeleted` < `adminSetUserSuspended` < `adminUpdateUser`.
 */
const ADMIN_GOVERNANCE_MUTATION_FIELDS = ["adminSetUserBlocked", "adminSetUserSuspended"] as const;
/** Non-root object/enum/scalar SDL type names in the baseline (introspection `__*` and spec scalars excluded). */
const PRE_3_1_TYPE_NAMES = [
  "AppLocale",
  "ApplicantProfile",
  "ApplicantStatus",
  "CreatePlanInput",
  "Gender",
  "LoginPayload",
  "LogoutPayload",
  "Mutation",
  "MyNotificationsFilterInput",
  "Notification",
  "NotificationListPage",
  "NotificationType",
  "Plan",
  "Query",
  "RecitationReading",
  "RefreshTokenPayload",
  "RegisterPublicRole",
  "RegisterUserInput",
  "UpdatePlanInput",
  "User",
  "UserRole",
] as const;
/**
 * session surface — objects + inputs that enter the named-type
 * map when the resolver modules register the root fields (plan §3.1 SDL).
 * The scheduling enum trio is pinned separately (see `SESSION_LIFECYCLE_ENUMS`).
 */
const SESSION_LIFECYCLE_TYPE_NAMES = [
  "CreateSessionInput",
  "Session",
  "SessionListFilterInput",
  "SessionPage",
] as const;
/** billing objects + input (R-301/R-302) — the wallet surface types. */
const WALLET_TYPE_NAMES = ["RequestWithdrawalInput", "TeacherTransaction", "Wallet"] as const;
/**
 * admin-user-management named-type surface — RECONCILED baseline
 * drift (the prior `PRE_3_1_TYPE_NAMES` inventory listed plan-catalog
 * objects/inputs but omitted the eleven admin-user objects/inputs that
 * landed alongside it). The two enum names (`AdminUserGovernanceFilter`,
 * `AuditActionType`) are pinned separately via `ADMIN_USER_ENUMS`.
 */
const ADMIN_USER_TYPE_NAMES = [
  "AdminCreateUserInput",
  "AdminParentSnapshot",
  "AdminStudentSnapshot",
  "AdminTeacherSnapshot",
  "AdminUpdateUserInput",
  "AdminUserActivityEntry",
  "AdminUserDetail",
  "AdminUserFiltersInput",
  "AdminUserListItem",
  "AdminUserPage",
  "AdminUserStats",
] as const;
// ─── Whole-platform analytics read — ONE admin root query (zero arguments, ──
// ─── `$all`-gated; no anonymous surface, the allowlist stays byte-unchanged)─
const PLATFORM_ANALYTICS_QUERY_FIELDS = ["adminPlatformAnalytics"] as const;
/** Analytics embedded value objects — root snapshot + ten sections/trend points; NO `id` anywhere, NO new enum, NO input, NO mutation. */
const PLATFORM_ANALYTICS_TYPE_NAMES = [
  "PlatformAnalytics",
  "PlatformAnalyticsCurrencyRevenue",
  "PlatformAnalyticsHealth",
  "PlatformAnalyticsRatings",
  "PlatformAnalyticsRevenue",
  "PlatformAnalyticsRevenueTrendPoint",
  "PlatformAnalyticsSessionTrendPoint",
  "PlatformAnalyticsSessions",
  "PlatformAnalyticsSubscriptions",
  "PlatformAnalyticsTeachers",
  "PlatformAnalyticsUsers",
] as const;
/**
 * Subscription purchase settlement vocabulary — registered ONCE in
 * `shared/enum.pothos.ts` from the canonical `backend/enum/billing/*` enum
 * objects. `PaymentGateway` carries the full nine-member channel set (incl.
 * the mock-provider member); the surface's root fields are the student
 * purchase write and the caller-scoped subscription read below.
 */
const SUBSCRIPTION_PURCHASE_ENUMS = [
  "PaymentGateway",
  "PaymentStatus",
  "SubscriptionCreditLane",
  "SubscriptionStatus",
] as const;
/**
 * Subscription purchase surface root fields — the student-only purchase
 * write and the caller-scoped subscription list (zero arguments; the read
 * scope IS the verified context identity). Auth-gated on both (`$all`
 * conjunction); none is allowlist material.
 */
const SUBSCRIPTION_QUERY_FIELDS = ["mySubscriptions"] as const;
const SUBSCRIPTION_PURCHASE_MUTATION_FIELDS = ["purchaseSubscription"] as const;
/**
 * Subscription purchase surface named types — the canonical student
 * subscription and payment objects, the purchase wrapper pair
 * (payload + checkout descriptor), and the purchase input whitelist. The
 * entity object is named `StudentSubscription` on the wire:
 * `Subscription` is reserved by GraphQL default-root naming (a bare object
 * with that name is auto-adopted as the schema's subscription root, which
 * the realtime sidecar contract forbids — see the dedicated root check
 * below and `sdl-static-assertions.test.ts`).
 */
const SUBSCRIPTION_PURCHASE_TYPE_NAMES = [
  "PaymentCheckout",
  "PurchaseSubscriptionInput",
  "PurchaseSubscriptionPayload",
  "StudentPayment",
  "StudentSubscription",
] as const;

/** participant session-report read pair — nullable root reads, `sessionId: ID!` single-arg. */
const SESSION_REPORT_QUERY_FIELDS = ["sessionHomework", "sessionReport"] as const;
/** teacher report submission write — `$all`-gated (authenticated Teacher) per plan §3.2. */
const SESSION_REPORT_MUTATION_FIELDS = ["submitSessionReport"] as const;
/** recitation-location vocabulary — registered ONCE in `shared/enum.pothos.ts` (enum-object form). */
const SESSION_REPORT_ENUMS = ["SurahJuzRef"] as const;
/**
 * session-report/homework surface — the two report objects plus the
 * four closed input whitelists (plan §3.1 SDL; `SurahJuzRef` is pinned
 * separately via `SESSION_REPORT_ENUMS`).
 */
const SESSION_REPORT_TYPE_NAMES = [
  "HomeWorkAssignmentInput",
  "HomeWorkBlockInput",
  "HomeWorkGradeInput",
  "SessionHomeWork",
  "SessionReport",
  "SubmitSessionReportInput",
] as const;

/**
 * admin session-governance root fields — the sanctioned addition
 * pinned by the 4.4 codegen reconcile. Two admin-only queries (directory +
 * any-state detail) and four admin-only mutations (reschedule / cancel /
 * reassign / join), each carrying the
 * `authScopes: { $all: { authenticated: true, role: [UserRole.Admin] } }`
 * conjunction.
 */
const ADMIN_SESSION_GOVERNANCE_QUERY_FIELDS = ["adminSession", "adminSessions"] as const;
const ADMIN_SESSION_GOVERNANCE_MUTATION_FIELDS = [
  "adminCancelSession",
  "adminJoinSession",
  "adminReassignTeacher",
  "adminRescheduleSession",
] as const;
/**
 * named-type surface — the four mutation inputs + the directory
 * filter input. NO new object/enum: the canonical `Session`/`SessionPage`
 * objects are reused (`Session` widened with `needsAttention: Boolean!`).
 */
const ADMIN_SESSION_GOVERNANCE_TYPE_NAMES = [
  "AdminSessionCancelInput",
  "AdminSessionJoinInput",
  "AdminSessionListFilterInput",
  "AdminSessionReassignInput",
  "AdminSessionRescheduleInput",
] as const;
/**
 * session-recitation pair — the sanctioned post-reconciliation
 * addition. The mutation is teacher-gated
 * (`$all { authenticated: true, role: [UserRole.Teacher] }`) with a
 * NON-nullable payload; the query is participant-scoped
 * (`{ authenticated: true }` only, tenancy service-owned) with a NULLABLE
 * payload (the collapse channel). Both are authScopes-gated — neither is
 * allowlist material; the public-operation registry stays byte-unchanged.
 */
const RECITATION_RECORD_MUTATION_FIELDS = ["setSessionRecitation"] as const;
/** participant read — the nullable collapse-channel query. */
const RECITATION_RECORD_QUERY_FIELDS = ["sessionRecitation"] as const;
/** record object + its closed two-member input (name + optional description). */
const RECITATION_RECORD_TYPE_NAMES = ["SessionRecitation", "SessionRecitationInput"] as const;
/**
 * student-evaluation rating pair — the sanctioned student→teacher rating
 * surface addition. The mutation is student-gated
 * (`$all { authenticated: true, role: [UserRole.Student] }`) with a
 * NON-nullable payload; the query is caller-scoped (rater id server-bound,
 * zero arguments) with a NON-nullable list payload. Both are authScopes-gated
 * — neither is allowlist material; the public-operation registry stays
 * byte-unchanged.
 */
const STUDENT_EVALUATION_MUTATION_FIELDS = ["submitTeacherEvaluation"] as const;
/** caller-scoped read — the non-paginated own-ratings list. */
const STUDENT_EVALUATION_QUERY_FIELDS = ["myTeacherEvaluations"] as const;
/** record object + its closed one-member input (whole-star rating). */
const STUDENT_EVALUATION_TYPE_NAMES = ["Evaluation", "SubmitTeacherEvaluationInput"] as const;

/**
 * Admin financial-auditing surface — the sanctioned addition. Three
 * admin-only queries (payments audit listing, wallet inspector,
 * pending-withdrawal queue) and three admin-only mutations (approve /
 * reject withdrawal, manual wallet adjustment), each carrying the
 * `authScopes: { $all: { authenticated: true, role: [UserRole.Admin] } }`
 * conjunction (`adminOnlyAuthScopes` from `backend/graphql/shared`).
 */
const ADMIN_FINANCE_QUERY_FIELDS = ["adminPendingWithdrawals", "adminStudentPayments", "adminTeacherWallet"] as const;
const ADMIN_FINANCE_MUTATION_FIELDS = ["adjustTeacherWallet", "approveWithdrawal", "rejectWithdrawal"] as const;
/** The adjustment-direction vocabulary — registered ONCE, no pgEnum backing. */
const ADMIN_FINANCE_ENUMS = ["WalletAdjustmentDirection"] as const;
/**
 * Named-type surface — the two row objects (`AdminStudentPayment` in
 * `pothos/billing/`, `AdminWithdrawalQueueRow` next to its domain), the
 * three page/wrapper envelopes, and the three closed input whitelists.
 * The canonical `TeacherTransaction` object is REUSED for the mutation
 * payloads and the wallet ledger rows (single canonical object rule).
 */
const ADMIN_FINANCE_TYPE_NAMES = [
  "AdminStudentPayment",
  "AdminStudentPaymentPage",
  "AdminStudentPaymentsFilterInput",
  "AdminTeacherWallet",
  "AdminWalletTransactionFilterInput",
  "AdminWithdrawalQueuePage",
  "AdminWithdrawalQueueRow",
  "AdjustTeacherWalletInput",
] as const;

/**
 * Parent read-only monitoring portal — RECONCILED baseline drift. The five
 * caller-scoped reads (linked-children root + the four per-child paged
 * surfaces) and their page/entry value objects shipped on the parent-portal
 * branch but were never enumerated in the Query-root additions pin or the
 * whole-schema named-type delta. Re-anchored to the live schema as a
 * documented one-time reconciliation. (The behavioral pins for this surface
 * live in `parent-monitoring.wire.test.ts`.)
 */
const PARENT_MONITORING_QUERY_FIELDS = [
  "myLinkedChildren",
  "parentChildHomework",
  "parentChildProgress",
  "parentChildReports",
  "parentChildSessions",
] as const;
/** The portal's page/entry/track value objects — no closed inputs (argless + paged reads). */
const PARENT_MONITORING_TYPE_NAMES = [
  "ParentAttendanceEntry",
  "ParentAttendancePage",
  "ParentChildProgress",
  "ParentHomeworkEntry",
  "ParentHomeworkPage",
  "ParentHomeworkPosition",
  "ParentHomeworkTrack",
  "ParentLinkedChild",
  "ParentReportEntry",
  "ParentReportPage",
] as const;

/**
 * R1–R3 admin directory query trio — RECONCILED baseline drift (the
 * teacher/student/applicant directory read surfaces shipped across the
 * admin-directory rounds but were never enumerated in the Query-root
 * additions pin). Re-anchored to the live schema as a documented one-time
 * reconciliation ahead of the R4 `statusCounts` aggregate addition.
 */
const R4R_ADMIN_DIRECTORY_QUERY_FIELDS = ["adminStudents", "adminTeacherApplicants", "adminTeachers"] as const;
/**
 * R5 admin directory export trio — RECONCILED baseline drift (the
 * export-all read surfaces behind the admin directories' EXPORT CSV
 * affordance: the three listing queries' filter arguments with NO
 * pagination, first-1000-row bounded payloads with the honest `truncated`
 * cap flag). Re-anchored in the 77adb9f reconciliation convention.
 */
const R5_ADMIN_EXPORT_QUERY_FIELDS = [
  "adminStudentsExport",
  "adminTeacherApplicantsExport",
  "adminTeachersExport",
] as const;
/**
 * Parent-link read pair — RECONCILED baseline drift (the REQ-061 extend
 * step shipped the incoming/outgoing request listings but the Query-root
 * additions pin was never refreshed). Re-anchored as a documented
 * one-time reconciliation (NOT a silent baseline flip).
 */
const RECONCILED_PARENT_LINK_QUERY_FIELDS = ["myIncomingParentLinkRequests", "myOutgoingParentLinkRequests"] as const;
/** Admin audit-trail listing — RECONCILED baseline drift (shipped with the audit surface, never pinned). */
const RECONCILED_ADMIN_AUDIT_QUERY_FIELDS = ["adminAuditLogs"] as const;
/**
 * Parent-link lifecycle mutation trio — RECONCILED baseline drift (the
 * REQ-061 extend step shipped the request/respond/cancel writes but the
 * Mutation-root additions pin was never refreshed). Re-anchored as a
 * documented one-time reconciliation (NOT a silent baseline flip).
 */
const RECONCILED_PARENT_LINK_MUTATION_FIELDS = [
  "cancelParentLinkRequest",
  "requestParentChildLink",
  "respondToParentLinkRequest",
] as const;
/**
 * Admin broadcast + cold-start certification mutation pair — RECONCILED
 * baseline drift (both shipped alongside the notification/audit and
 * directory-governance surfaces but were never enumerated in the
 * Mutation-root additions pin). Re-anchored as a documented one-time
 * reconciliation (NOT a silent baseline flip).
 */
const RECONCILED_ADMIN_BROADCAST_CERTIFY_MUTATION_FIELDS = [
  "adminBroadcastNotification",
  "adminCertifyTeacherColdStart",
] as const;
/**
 * Reconciled enum drift: the parent-link lifecycle vocabulary
 * (`LinkStatus`) and the broadcast-audience vocabulary
 * (`BroadcastAudienceType`) shipped without being pinned in the enum
 * freeze. Re-anchored as a documented one-time reconciliation — the
 * freeze still forbids any FUTURE enum growth.
 */
const RECONCILED_ENUMS = ["BroadcastAudienceType", "LinkStatus"] as const;
/** Parent-link extend-step named types (REQ-061) — RECONCILED baseline drift. */
const RECONCILED_PARENT_LINK_TYPE_NAMES = [
  "IncomingParentLinkRequest",
  "LinkStatus",
  "OutgoingParentLinkRequest",
] as const;
/** Admin audit-trail surface named types — RECONCILED baseline drift. */
const RECONCILED_ADMIN_AUDIT_TYPE_NAMES = [
  "AdminAuditLogEntry",
  "AdminAuditLogFiltersInput",
  "AdminAuditLogPage",
] as const;
/** Admin broadcast surface named types — RECONCILED baseline drift. */
const RECONCILED_ADMIN_BROADCAST_TYPE_NAMES = [
  "AdminBroadcastNotificationInput",
  "BroadcastAudienceInput",
  "BroadcastAudienceType",
] as const;
/**
 * R1–R3 admin directory surface named types — RECONCILED baseline drift
 * (the teacher/student/applicant directory objects + filter inputs, plus
 * the R4 `AdminApplicantStatusCounts` embedded counts object).
 */
const R4R_ADMIN_DIRECTORY_TYPE_NAMES = [
  "AdminApplicantFiltersInput",
  "AdminApplicantItem",
  "AdminApplicantPage",
  "AdminApplicantStatusCounts",
  "AdminStudentFiltersInput",
  "AdminStudentItem",
  "AdminStudentPage",
  "AdminTeacherFiltersInput",
  "AdminTeacherItem",
  "AdminTeacherPage",
] as const;
/**
 * R5 admin directory export envelope objects — RECONCILED baseline drift
 * (the three export-all envelopes; each reuses its directory's EXISTING
 * item object for `rows`, so the ONLY new named types are the envelopes
 * themselves).
 */
const R5_ADMIN_EXPORT_TYPE_NAMES = [
  "AdminApplicantExportEnvelope",
  "AdminStudentExportEnvelope",
  "AdminTeacherExportEnvelope",
] as const;

// ─── Schema walk helpers ─────────────────────────────────────────────────────

/** All named SDL type names, introspection builtins + spec scalars excluded, sorted deterministically. */
function sdlTypeNames(): string[] {
  return Object.values(graphQLSchema.getTypeMap())
    .filter(type => !type.name.startsWith("__") && !isSpecifiedScalarType(type))
    .map(type => type.name)
    .toSorted((a, b) => a.localeCompare(b));
}

/** Runtime record guard (no casts, per test-tier discipline). */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * Reads a root field's `authScopes` snapshot off the Pothos extensions
 * (no casts). Shared by the users-locale surface describe below; the
 * notification-mutation describe keeps its own closure-scoped twins.
 */
function authScopesSnapshot(field: { readonly extensions?: unknown }): Record<string, unknown> {
  const extensions: unknown = field.extensions;
  if (!isRecord(extensions)) throw new Error("expected record-shaped extensions");
  const pothosOptions: unknown = Reflect.get(extensions, "pothosOptions");
  if (!isRecord(pothosOptions)) throw new Error("expected record-shaped pothosOptions");
  const authScopes: unknown = Reflect.get(pothosOptions, "authScopes");
  if (!isRecord(authScopes)) throw new Error("expected record-shaped authScopes");
  return authScopes;
}

/**
 * Fail-fast root Mutation field lookup — shared by the notification,
 * users-locale, and admin-governance describe blocks below (each also
 * captures its own `mutationType` narrowing guard at describe setup, so
 * the field dereference inside this helper is guaranteed safe).
 */
function mutationField(name: string): GraphQLField<unknown, unknown> {
  const mutationType = graphQLSchema.getMutationType();
  if (!mutationType) {
    throw new Error("Schema must define a root Mutation type");
  }
  const field = mutationType.getFields()[name];
  if (!field) {
    throw new Error(`Mutation must register the \`${name}\` root field`);
  }
  return field;
}

describe("Query._health — retyped probe surface", () => {
  const queryType = graphQLSchema.getQueryType();

  if (!queryType) {
    throw new Error("Schema must define a root Query type");
  }

  test("root query retains EXACTLY the baseline fields plus the pinned additions", () => {
    expect(queryType).toBeDefined();
    const fieldNames = Object.keys(queryType.getFields());
    // Baseline survivors intact…
    for (const name of PRE_3_1_QUERY_FIELDS) {
      expect(fieldNames).toContain(name);
    }
    // …and the ONLY additions beyond them are the explicitly enumerated
    // sanctioned surfaces: the probe, the student-handshake
    // queries, the participant-read trio, the admin
    // arbitration listing, the wallet read, the RECONCILED
    // admin-user-management query quartet (shipped but never
    // pinned — re-anchored ahead of the admin-governance
    // mutation pair), the whole-platform analytics snapshot, the
    // session-report read pair, the admin session-governance pair
    // (4.4 reconcile), the subscription-purchase owner listing
    // (`mySubscriptions`), the RECONCILED admin audit listing +
    // parent-link read pair + R1–R3 admin directory trio (shipped but never
    // pinned — re-anchored alongside the R4 statusCounts aggregate), the
    // R5 admin directory export trio (the sanctioned export-all read
    // surface), and the admin financial-auditing read trio
    // (payments audit listing, wallet inspector, pending-withdrawal queue).
    // surface) + the student-evaluation caller-scoped read
    // (`myTeacherEvaluations`).
    const additions = fieldNames.filter(name => !(PRE_3_1_QUERY_FIELDS as readonly string[]).includes(name));
    expect(additions.toSorted((a, b) => a.localeCompare(b))).toEqual(
      [
        "_health",
        "findStudentByHandshakeCode",
        "myHandshakeCode",
        ...SESSION_LIFECYCLE_QUERY_FIELDS,
        ...DISPUTE_QUERY_FIELDS,
        ...ARBITRATION_QUERY_FIELDS,
        ...TEACHER_CASE_QUERY_FIELDS,
        ...STUDENT_CASE_QUERY_FIELDS,
        ...SESSION_REPORT_QUERY_FIELDS,
        ...WALLET_QUERY_FIELDS,
        ...ADMIN_USER_USER_QUERY_FIELDS,
        ...ADMIN_SESSION_GOVERNANCE_QUERY_FIELDS,
        ...PLATFORM_ANALYTICS_QUERY_FIELDS,
        ...SUBSCRIPTION_QUERY_FIELDS,
        ...R4R_ADMIN_DIRECTORY_QUERY_FIELDS,
        ...R5_ADMIN_EXPORT_QUERY_FIELDS,
        ...RECONCILED_PARENT_LINK_QUERY_FIELDS,
        ...RECONCILED_ADMIN_AUDIT_QUERY_FIELDS,
        ...RECITATION_RECORD_QUERY_FIELDS,
        ...ADMIN_FINANCE_QUERY_FIELDS,
        ...STUDENT_EVALUATION_QUERY_FIELDS,
        ...PARENT_MONITORING_QUERY_FIELDS,
      ].toSorted((a, b) => a.localeCompare(b))
    );
  });

  test("`_health` is NON-NULLABLE `HealthCheck!` (retyped from the String! placeholder)", () => {
    // Field lookup via values+name comparison — keeps `_health` out of member-
    // access position entirely (`no-underscore-dangle` clean by construction).
    const healthField = Object.values(queryType.getFields()).find(field => field.name === "_health");

    if (!healthField) {
      throw new Error("Query must register a `_health` root field");
    }
    expect(healthField).toBeDefined();
    expect(getNamedType(healthField.type).name).toBe("HealthCheck");
    expect(getNamedType(healthField.type).toString()).toBe("HealthCheck");
    // v3 defaults: no explicit nullable opt-out ⇒ strict NonNull wrapping.
    expect(healthField.type.toString()).toBe("HealthCheck!");
  });
});

describe("HealthCheck object shape — four scalar fields, no id", () => {
  const healthType = graphQLSchema.getType("HealthCheck");

  if (!(healthType instanceof GraphQLObjectType)) {
    throw new Error("HealthCheck must be registered as a GraphQL object type");
  }

  test("is registered exactly once as an object type backed by the canonical ref", () => {
    expect(healthType).toBeInstanceOf(GraphQLObjectType);
  });

  test("discloses EXACTLY the four canonical fields, each `String!`", () => {
    const fields = healthType.getFields();

    expect(Object.keys(fields).toSorted((a, b) => a.localeCompare(b))).toEqual([
      "service",
      "status",
      "timestamp",
      "version",
    ]);
    for (const field of Object.values(fields)) {
      expect(field.type.toString()).toBe("String!");
    }
  });

  test("carries NO `id` field — embedded value object", () => {
    const fields = healthType.getFields();

    expect(Object.hasOwn(fields, "id")).toBe(false);
  });

  test("selecting `id` on the probe FAILS validation (behavioral no-id proof)", () => {
    const document = parse("{ _health { id } }");
    const errors = validate(graphQLSchema, document);

    expect(errors).toHaveLength(1);
    expect(errors[0]?.message).toContain('Cannot query field "id" on type "HealthCheck"');
  });
});

describe("Surface freeze — pinned additions vs the baseline inventory", () => {
  test("mutation set grows ONLY by the sanctioned additions (quartet + dispute pair + confirm + payout + admin-user trio + admin-governance pair + session-governance quartet + session-report write + the subscription purchase write + the reconciled parent-link trio + broadcast/certify pair + the session-recitation write + the financial-auditing trio + the student-evaluation rating write)", () => {
    const mutationFields = graphQLSchema.getMutationType()?.getFields() ?? {};
    const names = Object.keys(mutationFields).toSorted((a, b) => a.localeCompare(b));

    // Baseline survivors intact…
    for (const name of PRE_3_1_MUTATION_FIELDS) {
      expect(names).toContain(name);
    }
    // …and the ONLY additions are the quartet, the
    // dispute pair, the dual-confirmation mutation, the
    // payout write, the RECONCILED admin-user-management trio
    // (shipped but never pinned — re-anchored here as a documented
    // one-time reconciliation), the admin-governance pair (the
    // sanctioned post-reconciliation addition), the
    // session-governance quartet (4.4 reconcile), the
    // session-report write, the subscription purchase write, the
    // RECONCILED parent-link trio + admin broadcast/certify pair (shipped
    // but never pinned — re-anchored alongside the R4 statusCounts
    // aggregate), the session-recitation write
    // (`setSessionRecitation`), and the admin financial-auditing trio
    // (`approveWithdrawal` / `rejectWithdrawal` / `adjustTeacherWallet`).
    // All authScopes-gated — none is allowlist material; the
    // public-operation registry stays byte-unchanged.
    // (`setSessionRecitation`), and the student-evaluation rating write
    // (`submitTeacherEvaluation`). All authScopes-gated — none is allowlist
    // material; the public-operation registry stays byte-unchanged.
    expect(names).toEqual(
      [
        ...PRE_3_1_MUTATION_FIELDS,
        ...SESSION_LIFECYCLE_MUTATION_FIELDS,
        ...DISPUTE_MUTATION_FIELDS,
        ...ARBITRATION_MUTATION_FIELDS,
        ...SESSION_REPORT_MUTATION_FIELDS,
        ...DUAL_CONFIRMATION_MUTATION_FIELDS,
        ...WALLET_MUTATION_FIELDS,
        ...ADMIN_USER_USER_MUTATION_FIELDS,
        ...ADMIN_GOVERNANCE_MUTATION_FIELDS,
        ...ADMIN_SESSION_GOVERNANCE_MUTATION_FIELDS,
        ...SUBSCRIPTION_PURCHASE_MUTATION_FIELDS,
        ...RECONCILED_PARENT_LINK_MUTATION_FIELDS,
        ...RECONCILED_ADMIN_BROADCAST_CERTIFY_MUTATION_FIELDS,
        ...RECITATION_RECORD_MUTATION_FIELDS,
        ...ADMIN_FINANCE_MUTATION_FIELDS,
        ...STUDENT_EVALUATION_MUTATION_FIELDS,
      ].toSorted((a, b) => a.localeCompare(b))
    );
    expect(names).not.toContain("_health");
  });

  test("admin mutations sit at their SORTED positions as ONE contiguous block in the Mutation root inventory", () => {
    // The eleven admin-root mutations must appear in this exact
    // lexicographic order as ONE contiguous slice in the sorted Mutation
    // root inventory:
    //   adminBroadcastNotification < adminCancelSession <
    //   adminCertifyTeacherColdStart < adminCreateUser <
    //   adminJoinSession < adminReassignTeacher <
    //   adminRescheduleSession < adminSetUserBlocked <
    //   adminSetUserDeleted < adminSetUserSuspended < adminUpdateUser
    // — the session-governance quartet (4.4 reconcile)
    // interleaves the prior five-field admin-USER block between
    // adminCreateUser and adminSetUserBlocked, so the contiguity pin is
    // re-anchored to the whole admin block, exactly as the sorted live
    // schema emits them.
    const names = Object.keys(graphQLSchema.getMutationType()?.getFields() ?? {}).toSorted((a, b) =>
      a.localeCompare(b)
    );
    const adminMutationNames = [
      "adminBroadcastNotification",
      "adminCancelSession",
      "adminCertifyTeacherColdStart",
      "adminCreateUser",
      "adminJoinSession",
      "adminReassignTeacher",
      "adminRescheduleSession",
      "adminSetUserBlocked",
      "adminSetUserDeleted",
      "adminSetUserSuspended",
      "adminUpdateUser",
    ];
    // Contiguous slice: the eleven admin mutations MUST be adjacent in
    // the sorted Mutation root inventory (no non-admin field interleaves
    // between them).
    const firstIndex = names.indexOf(adminMutationNames[0] ?? "");
    expect(firstIndex).toBeGreaterThanOrEqual(0);
    const slice = names.slice(firstIndex, firstIndex + adminMutationNames.length);
    expect(slice).toEqual(adminMutationNames);
  });

  test("enum set is pinned (every new enum named explicitly; LinkStatus + BroadcastAudienceType re-anchored as documented drift)", () => {
    const enumNames = Object.values(graphQLSchema.getTypeMap())
      .filter(type => type instanceof GraphQLEnumType && !type.name.startsWith("__"))
      .map(type => type.name)
      .toSorted((a, b) => a.localeCompare(b));

    // adds NO new enum (the governance surface reuses the
    // registered SessionStatus/SessionType vocabularies);
    // BroadcastAudienceType + LinkStatus arrive from the merged PRs #53
    // and #49 respectively (4.4 re-anchor); the `SurahJuzRef` recitation
    // enum is the sanctioned addition; the subscription-purchase
    // settlement quartet (`PaymentGateway`, `PaymentStatus`,
    // `SubscriptionCreditLane`, `SubscriptionStatus`) is the
    // sanctioned addition; the `WalletAdjustmentDirection`
    // financial-auditing vocabulary is the sanctioned addition.
    expect(enumNames).toEqual(
      [
        ...PRE_3_1_ENUMS,
        ...SESSION_LIFECYCLE_ENUMS,
        ...DISPUTE_ENUMS,
        ...SESSION_REPORT_ENUMS,
        ...WALLET_ENUMS,
        ...ADMIN_USER_ENUMS,
        ...SUBSCRIPTION_PURCHASE_ENUMS,
        ...RECONCILED_ENUMS,
        ...ADMIN_FINANCE_ENUMS,
      ].toSorted((a, b) => a.localeCompare(b))
    );
  });

  test("NO GraphQL subscription root exists — realtime delivery stays on the WebSocket sidecar (`Subscription` is reserved; the entity ships as `StudentSubscription`)", () => {
    // The subscription-purchase entity is named `StudentSubscription` on the
    // wire: `Subscription` is reserved by GraphQL default-root naming (a
    // bare object with that name would be auto-adopted as the schema's
    // subscription root, which the realtime sidecar contract forbids — see
    // the surface pins above and `sdl-static-assertions.test.ts`). The
    // ROOT slot is only decidable on the built schema (with default root
    // naming the artifact text cannot distinguish a plain object from a
    // root — the artifact tier pins the schema-definition half in
    // `sdl-static-assertions.test.ts`): the built schema must expose NO
    // subscription root at all.
    expect(graphQLSchema.getSubscriptionType() ?? null).toBeNull();
  });

  test("DisputeResolution exposes exactly the arbitration vocabulary (Cancel | Complete | Refund | PartialRefund | Uphold)", () => {
    const disputeEnum = graphQLSchema.getType("DisputeResolution");

    if (!(disputeEnum instanceof GraphQLEnumType)) {
      throw new Error("DisputeResolution must be registered as a GraphQL enum type");
    }
    expect(
      disputeEnum
        .getValues()
        .map(value => value.name)
        .toSorted((a, b) => a.localeCompare(b))
    ).toEqual(["Cancel", "Complete", "PartialRefund", "Refund", "Uphold"]);
  });

  test("Session exposes EXACTLY the field set plus the five nullable dispute fields", () => {
    const sessionType = graphQLSchema.getType("Session");

    if (!(sessionType instanceof GraphQLObjectType)) {
      throw new Error("Session must be registered as a GraphQL object type");
    }
    const fields = sessionType.getFields();
    for (const name of DISPUTE_SESSION_FIELDS) {
      expect(Object.hasOwn(fields, name)).toBe(true);
    }
    // All five are nullable (no `!` wrapping) — the dispute/reason data is
    // optional on every row (rows cancelled/disputed/resolved before this
    // ticket carry NULL).
    for (const name of ["cancelReason", "disputeReason", "resolutionNote"]) {
      expect(fields[name]?.type.toString()).toBe("String");
    }
    // The formal outcome is the DisputeResolution vocabulary, nullable (rows
    // resolved before the column shipped carry NULL).
    expect(fields.resolutionOutcome?.type.toString()).toBe("DisputeResolution");
    for (const name of ["disputedAt", "resolvedAt"]) {
      expect(fields[name]?.type.toString()).toBe("DateTime");
    }
  });

  test("whole-schema named-type delta is pinned: refreshed baseline delta (DateTime scalar + HealthCheck probe + handshake surface) + session objects/inputs + scheduling/arbitration/ledger enums + wallet surface + admin-user-management surface + the parent-link objects (extend step) + the eleven analytics value objects + the governance inputs + the subscription purchase surface (objects, input, root operations) + the reconciled audit/broadcast/directory surfaces + the R5 export envelopes + the session-report surface (2 objects + 4 inputs + the recitation enum) + the recitation record pair + the student-evaluation record object + input", () => {
    const post = new Set(sdlTypeNames());

    for (const name of PRE_3_1_TYPE_NAMES) {
      expect(post.has(name)).toBe(true);
    }
    const additions = sdlTypeNames().filter(name => !(PRE_3_1_TYPE_NAMES as readonly string[]).includes(name));
    expect(additions).toEqual(
      [
        "DateTime",
        "HandshakeCodeLookup",
        "HealthCheck",
        ...SESSION_LIFECYCLE_TYPE_NAMES,
        ...SESSION_LIFECYCLE_ENUMS,
        ...DISPUTE_ENUMS,
        ...ARBITRATION_TYPE_NAMES,
        ...SESSION_REPORT_TYPE_NAMES,
        ...SESSION_REPORT_ENUMS,
        ...WALLET_TYPE_NAMES,
        ...WALLET_ENUMS,
        ...ADMIN_USER_TYPE_NAMES,
        ...ADMIN_USER_ENUMS,
        ...ADMIN_SESSION_GOVERNANCE_TYPE_NAMES,
        ...PLATFORM_ANALYTICS_TYPE_NAMES,
        ...SUBSCRIPTION_PURCHASE_ENUMS,
        ...SUBSCRIPTION_PURCHASE_TYPE_NAMES,
        ...RECONCILED_PARENT_LINK_TYPE_NAMES,
        ...RECONCILED_ADMIN_AUDIT_TYPE_NAMES,
        ...RECONCILED_ADMIN_BROADCAST_TYPE_NAMES,
        ...R4R_ADMIN_DIRECTORY_TYPE_NAMES,
        ...R5_ADMIN_EXPORT_TYPE_NAMES,
        ...RECITATION_RECORD_TYPE_NAMES,
        ...ADMIN_FINANCE_TYPE_NAMES,
        ...PARENT_MONITORING_TYPE_NAMES,
        ...ADMIN_FINANCE_ENUMS,
        ...STUDENT_EVALUATION_TYPE_NAMES,
      ].toSorted((a, b) => a.localeCompare(b))
    );
  });
});

/**
 * Reads one argument's SDL type off a root field (no casts). Module scope
 * per the function-scope discipline — the helper captures nothing.
 */
function argShapeOf(field: GraphQLField<unknown, unknown>, name: string): string {
  const arg = field.args.find(candidate => candidate.name === name);
  if (!arg) {
    throw new Error(`\`${field.name}\` must declare the \`${name}\` argument`);
  }
  return arg.type.toString();
}

describe("Post-confirmation dispute arbitration surface — SDL pins", () => {
  const queryType = graphQLSchema.getQueryType();
  const mutationType = graphQLSchema.getMutationType();

  if (!queryType) {
    throw new Error("Schema must define a root Query type");
  }
  if (!mutationType) {
    throw new Error("Schema must define a root Mutation type");
  }

  const queryField = (name: string) => {
    const field = queryType.getFields()[name];
    if (!field) {
      throw new Error(`Query must register the \`${name}\` root field`);
    }
    return field;
  };

  test("`openPostConfirmationDispute` carries the exact student-entry shape (`id: ID!, reason: String!): Session!` with the authenticated-only scope", () => {
    const field = mutationField("openPostConfirmationDispute");
    expect(getNamedType(field.type).name).toBe("Session");
    expect(field.type.toString()).toBe("Session!");
    expect(field.args.map(arg => arg.name).toSorted((a, b) => a.localeCompare(b))).toEqual(["id", "reason"]);
    expect(argShapeOf(field, "id")).toBe("ID!");
    expect(argShapeOf(field, "reason")).toBe("String!");
    // The student predicate is SERVICE-side: the scope is the plain
    // `{ authenticated: true }` map (no role leg to force into `$all`).
    expect(authScopesSnapshot(field)).toEqual({ authenticated: true });
  });

  test("`resolveSessionDispute` APPENDS `partialAmount: String` to the untouched shipped input", () => {
    const field = mutationField("resolveSessionDispute");
    expect(field.type.toString()).toBe("Session!");
    expect(field.args.map(arg => arg.name).toSorted((a, b) => a.localeCompare(b))).toEqual([
      "id",
      "note",
      "partialAmount",
      "resolution",
    ]);
    // The shipped arg shapes are byte-stable; the appended amount is the
    // OPTIONAL decimal string.
    expect(argShapeOf(field, "id")).toBe("ID!");
    expect(argShapeOf(field, "resolution")).toBe("DisputeResolution!");
    expect(argShapeOf(field, "note")).toBe("String");
    expect(argShapeOf(field, "partialAmount")).toBe("String");
    // The admin `$all` conjunction is unchanged by the extension.
    expect(authScopesSnapshot(field)).toEqual({
      $all: { authenticated: true, role: [UserRole.Admin] },
    });
  });

  test("`adminDisputeCase` is the admin-gated case read returning the non-null envelope", () => {
    const field = queryField("adminDisputeCase");
    expect(getNamedType(field.type).name).toBe("AdminDisputeCase");
    expect(field.type.toString()).toBe("AdminDisputeCase!");
    expect(field.args.map(arg => arg.name)).toEqual(["id"]);
    expect(argShapeOf(field, "id")).toBe("ID!");
    expect(authScopesSnapshot(field)).toEqual({
      $all: { authenticated: true, role: [UserRole.Admin] },
    });
  });

  test("`AdminDisputeCase` discloses EXACTLY the case bundle with the honest-null artifact fields", () => {
    const caseType = graphQLSchema.getType("AdminDisputeCase");

    if (!(caseType instanceof GraphQLObjectType)) {
      throw new Error("AdminDisputeCase must be registered as a GraphQL object type");
    }
    const fields = caseType.getFields();
    expect(Object.keys(fields).toSorted((a, b) => a.localeCompare(b))).toEqual([
      "auditTrail",
      "homework",
      "recitation",
      "report",
      "session",
      "studentName",
      "teacherName",
    ]);
    // The disputed row through the canonical Session object; the artifacts
    // nullable (never fabricated); the trail a non-nullable list of the
    // canonical AdminAuditLogEntry rows.
    expect(fields.session?.type.toString()).toBe("Session!");
    expect(fields.report?.type.toString()).toBe("SessionReport");
    expect(fields.homework?.type.toString()).toBe("SessionHomeWork");
    expect(fields.recitation?.type.toString()).toBe("SessionRecitation");
    expect(fields.auditTrail?.type.toString()).toBe("[AdminAuditLogEntry!]!");
    // The participant display names resolve server-side; an unreachable
    // user row is the honest null the view replaces with the numeric id.
    expect(fields.studentName?.type.toString()).toBe("String");
    expect(fields.teacherName?.type.toString()).toBe("String");
  });

  test("`adminDisputeAnalytics` is the admin-gated argument-free aggregate read", () => {
    const field = queryField("adminDisputeAnalytics");
    expect(getNamedType(field.type).name).toBe("AdminDisputeAnalytics");
    expect(field.type.toString()).toBe("AdminDisputeAnalytics!");
    // Zero arguments by design: the snapshot is the unfiltered all-time
    // aggregate — the wire surface carries nothing to misuse.
    expect(field.args).toHaveLength(0);
    expect(authScopesSnapshot(field)).toEqual({
      $all: { authenticated: true, role: [UserRole.Admin] },
    });
  });

  test("`AdminDisputeAnalytics` discloses EXACTLY the seven honest counts", () => {
    const analyticsType = graphQLSchema.getType("AdminDisputeAnalytics");

    if (!(analyticsType instanceof GraphQLObjectType)) {
      throw new Error("AdminDisputeAnalytics must be registered as a GraphQL object type");
    }
    const fields = analyticsType.getFields();
    expect(Object.keys(fields).toSorted((a, b) => a.localeCompare(b))).toEqual([
      "cancelCount",
      "completeCount",
      "openDisputes",
      "partialRefundCount",
      "refundCount",
      "resolvedDisputes",
      "upholdCount",
    ]);
    // Every member is a NON-NULLABLE Int — zero is the honest empty state,
    // never a null.
    for (const field of Object.values(fields)) {
      expect(field.type.toString()).toBe("Int!");
    }
  });

  test("`teacherDisputeCase` is the teacher-role-gated case read returning the non-null envelope", () => {
    const field = queryField("teacherDisputeCase");
    expect(getNamedType(field.type).name).toBe("TeacherDisputeCase");
    expect(field.type.toString()).toBe("TeacherDisputeCase!");
    expect(field.args.map(arg => arg.name)).toEqual(["id"]);
    expect(argShapeOf(field, "id")).toBe("ID!");
    // The scope pins the Teacher ROLE; the service predicate narrows it to
    // THE teacher of THIS session (the same two-layer shape as the admin
    // case read).
    expect(authScopesSnapshot(field)).toEqual({
      $all: { authenticated: true, role: [UserRole.Teacher] },
    });
  });

  test("`TeacherDisputeCase` discloses EXACTLY the participant bundle — NO audit trail, NO teacherName", () => {
    const caseType = graphQLSchema.getType("TeacherDisputeCase");

    if (!(caseType instanceof GraphQLObjectType)) {
      throw new Error("TeacherDisputeCase must be registered as a GraphQL object type");
    }
    const fields = caseType.getFields();
    expect(Object.keys(fields).toSorted((a, b) => a.localeCompare(b))).toEqual([
      "homework",
      "recitation",
      "report",
      "session",
      "studentName",
    ]);
    // The disputed row through the canonical Session object; the artifacts
    // nullable (never fabricated). The audit trail is deliberately ABSENT
    // (the admin governance surface) and the caller's own name (teacherName)
    // is equally absent — the teacher knows who they are.
    expect(fields.session?.type.toString()).toBe("Session!");
    expect(fields.report?.type.toString()).toBe("SessionReport");
    expect(fields.homework?.type.toString()).toBe("SessionHomeWork");
    expect(fields.recitation?.type.toString()).toBe("SessionRecitation");
    expect(fields.studentName?.type.toString()).toBe("String");
  });

  test("`studentDisputeCase` is the student-role-gated case read returning the non-null envelope", () => {
    const field = queryField("studentDisputeCase");
    expect(getNamedType(field.type).name).toBe("StudentDisputeCase");
    expect(field.type.toString()).toBe("StudentDisputeCase!");
    expect(field.args.map(arg => arg.name)).toEqual(["id"]);
    expect(argShapeOf(field, "id")).toBe("ID!");
    // The scope pins the Student ROLE; the service predicate narrows it to
    // THE student of THIS session (the filing participant on the
    // post-confirmation path) — the teacher read's exact mirror.
    expect(authScopesSnapshot(field)).toEqual({
      $all: { authenticated: true, role: [UserRole.Student] },
    });
  });

  test("`StudentDisputeCase` discloses EXACTLY the participant bundle — NO audit trail, NO studentName", () => {
    const caseType = graphQLSchema.getType("StudentDisputeCase");

    if (!(caseType instanceof GraphQLObjectType)) {
      throw new Error("StudentDisputeCase must be registered as a GraphQL object type");
    }
    const fields = caseType.getFields();
    expect(Object.keys(fields).toSorted((a, b) => a.localeCompare(b))).toEqual([
      "homework",
      "recitation",
      "report",
      "session",
      "teacherName",
    ]);
    // The disputed row through the canonical Session object; the artifacts
    // nullable (never fabricated). The audit trail is deliberately ABSENT
    // (the admin governance surface) and the caller's own name (studentName)
    // is equally absent — the student knows who they are.
    expect(fields.session?.type.toString()).toBe("Session!");
    expect(fields.report?.type.toString()).toBe("SessionReport");
    expect(fields.homework?.type.toString()).toBe("SessionHomeWork");
    expect(fields.recitation?.type.toString()).toBe("SessionRecitation");
    expect(fields.teacherName?.type.toString()).toBe("String");
  });
});

describe("Notification surface — enum + canonical objects", () => {
  /** Field names in canonical definition order (drives the `id`-FIRST source pin). */
  const CANONICAL_NOTIFICATION_FIELDS = [
    "id",
    "type",
    "title",
    "body",
    "isRead",
    "relatedEntityType",
    "relatedEntityId",
    "createdAt",
  ] as const;

  test("NotificationType enum carries EXACTLY the 9 canonical values (keys on the wire, snake_case runtime values)", () => {
    const enumType = graphQLSchema.getType("NotificationType");

    if (!(enumType instanceof GraphQLEnumType)) {
      throw new Error("NotificationType must be registered as a GraphQL enum type");
    }

    const values = enumType.getValues();
    expect(values).toHaveLength(9);
    // The built schema is lexicographically sorted (enum-value order carries
    // no GraphQL semantics), so the pins compare as sorted sets:
    expect(values.map(value => value.name).toSorted((a, b) => a.localeCompare(b))).toEqual(
      [
        "SessionRequest",
        "SessionCompletion",
        "SessionCancellation",
        "ParentLinkRequest",
        "SystemBroadcast",
        "PaymentConfirmation",
        "EvaluationResult",
        "SessionDisputeOpened",
        "SessionDisputeResolved",
      ].toSorted((a, b) => a.localeCompare(b))
    );
    // Runtime values stay the canonical snake_case strings — byte-identical
    // to the pgEnum / TS enum single source of truth.
    expect(values.map(value => value.value).toSorted((a, b) => a.localeCompare(b))).toEqual(
      [
        "session_request",
        "session_completion",
        "session_cancellation",
        "parent_link_request",
        "system_broadcast",
        "payment_confirmation",
        "evaluation_result",
        "session_dispute_opened",
        "session_dispute_resolved",
      ].toSorted((a, b) => a.localeCompare(b))
    );
    // Single-source agreement with the canonical TS enum itself.
    expect(values.map(value => value.name).toSorted((a, b) => a.localeCompare(b))).toEqual(
      Object.keys(NotificationType).toSorted((a, b) => a.localeCompare(b))
    );
    expect(values.map(value => value.value).toSorted((a, b) => a.localeCompare(b))).toEqual(
      Object.values(NotificationType).toSorted((a, b) => a.localeCompare(b))
    );
  });

  test("Notification object exposes `id` and EXACTLY the eight inbox fields (structurally NO `userId`)", () => {
    const notificationType = graphQLSchema.getType("Notification");

    if (!(notificationType instanceof GraphQLObjectType)) {
      throw new Error("Notification must be registered as a GraphQL object type");
    }

    const fields = notificationType.getFields();
    const field = (name: string) => {
      const candidate = fields[name];
      if (!candidate) {
        throw new Error(`Notification must register the \`${name}\` field`);
      }
      return candidate;
    };

    expect(Object.keys(fields).toSorted((a, b) => a.localeCompare(b))).toEqual(
      [...CANONICAL_NOTIFICATION_FIELDS].toSorted((a, b) => a.localeCompare(b))
    );
    // Exact field types per the contract (the inbox deliberately keeps the
    // ISO-8601 string convention for timestamps — NOT the `DateTime` scalar
    // now registered in `shared/scalar.pothos.ts`).
    expect(field("id").type.toString()).toBe("ID!");
    expect(field("type").type.toString()).toBe("NotificationType!");
    expect(field("title").type.toString()).toBe("String!");
    expect(field("body").type.toString()).toBe("String");
    expect(field("isRead").type.toString()).toBe("Boolean!");
    expect(field("relatedEntityType").type.toString()).toBe("String");
    expect(field("relatedEntityId").type.toString()).toBe("Int");
    expect(field("createdAt").type.toString()).toBe("String!");
    // SEC: the recipient `userId` is structurally absent from the surface —
    // the recipient is implied by the self-scoped caller, never disclosed.
    expect(Object.hasOwn(fields, "userId")).toBe(false);
  });

  test("`id` is the FIRST field defined on the canonical object source (Apollo normalization convention)", () => {
    // The built schema is lexicographically sorted (field order carries no
    // GraphQL semantics), so the id-FIRST convention is pinned at the
    // source level — lexical scan by design, like the gateway static gates.
    const source = readFileSync(
      resolve(process.cwd(), "backend/graphql/pothos/notifications/notification.pothos.ts"),
      "utf8"
    );
    const fieldsBlock = source.slice(source.indexOf("fields: t => ({"));
    const positions = CANONICAL_NOTIFICATION_FIELDS.map(name => ({
      name,
      at: fieldsBlock.indexOf(`${name}: `),
    }));
    for (const { at } of positions) {
      expect(at).toBeGreaterThanOrEqual(0);
    }
    const idPosition = positions.find(position => position.name === "id")?.at ?? -1;
    for (const { name, at } of positions) {
      if (name !== "id") {
        expect(idPosition).toBeLessThan(at);
      }
    }
  });

  test("NotificationListPage wrapper exposes EXACTLY items/totalCount/hasMore", () => {
    const pageType = graphQLSchema.getType("NotificationListPage");

    if (!(pageType instanceof GraphQLObjectType)) {
      throw new Error("NotificationListPage must be registered as a GraphQL object type");
    }

    const fields = pageType.getFields();
    expect(Object.keys(fields).toSorted((a, b) => a.localeCompare(b))).toEqual(["hasMore", "items", "totalCount"]);
    expect(fields.items?.type.toString()).toBe("[Notification!]!");
    expect(fields.totalCount?.type.toString()).toBe("Int!");
    expect(fields.hasMore?.type.toString()).toBe("Boolean!");
    // Wrapper is an embedded value object — no `id` (rows inside `items`
    // are the normalizable entities).
    expect(Object.hasOwn(fields, "id")).toBe(false);
  });
});

describe("Notification query surface — self-scoped inbox reads", () => {
  const queryType = graphQLSchema.getQueryType();

  if (!queryType) {
    throw new Error("Schema must define a root Query type");
  }

  // Captured ONCE after the narrowing guard so the hoisted `queryField`
  // helper below never re-dereferences a possibly-null root type.
  const rootFields = queryType.getFields();

  function queryField(name: string) {
    const field = rootFields[name];
    if (!field) {
      throw new Error(`Query must register the \`${name}\` root field`);
    }
    return field;
  }

  /** Reads one root field's `authScopes` snapshot off the Pothos extensions (no casts). */
  function authScopesOf(fieldName: string): Record<string, unknown> {
    const extensions: unknown = queryField(fieldName).extensions;
    if (!isRecord(extensions)) throw new Error("expected record-shaped extensions");
    const pothosOptions: unknown = Reflect.get(extensions, "pothosOptions");
    if (!isRecord(pothosOptions)) throw new Error("expected record-shaped pothosOptions");
    const authScopes: unknown = Reflect.get(pothosOptions, "authScopes");
    if (!isRecord(authScopes)) throw new Error("expected record-shaped authScopes");
    return authScopes;
  }

  test("`myNotifications` returns NotificationListPage! with ONE optional filter arg", () => {
    const field = queryField("myNotifications");
    expect(field.type.toString()).toBe("NotificationListPage!");
    const argNames = field.args.map(arg => arg.name).toSorted((a, b) => a.localeCompare(b));
    expect(argNames).toEqual(["filter"]);
    const filterArg = field.args[0];
    if (!filterArg) throw new Error("expected the filter argument");
    // Optional + nullable input — exactly the SDL contract's
    // `(filter: MyNotificationsFilterInput)`.
    expect(filterArg.type.toString()).toBe("MyNotificationsFilterInput");
  });

  test("`myUnreadNotificationCount` returns Int! with ZERO arguments", () => {
    const field = queryField("myUnreadNotificationCount");
    expect(field.type.toString()).toBe("Int!");
    expect(field.args).toHaveLength(0);
  });

  test("BOTH inbox queries carry EXACTLY the `authenticated` scope (no role/permission/superAdmin)", () => {
    for (const name of ["myNotifications", "myUnreadNotificationCount"]) {
      const scopes = authScopesOf(name);
      expect(Object.keys(scopes).toSorted((a, b) => a.localeCompare(b))).toEqual(["authenticated"]);
      expect(scopes.authenticated).toBe(true);
      // SEC: every authenticated role owns an inbox — no role material may
      // participate in the scope decision.
      expect("role" in scopes).toBe(false);
      expect("permission" in scopes).toBe(false);
      expect("superAdmin" in scopes).toBe(false);
    }
  });

  test("MyNotificationsFilterInput exposes EXACTLY the 4 filter fields, all nullable, ZERO identity fields", () => {
    const inputType = graphQLSchema.getType("MyNotificationsFilterInput");
    if (!(inputType instanceof GraphQLInputObjectType)) {
      throw new Error("MyNotificationsFilterInput must be registered as a GraphQL input type");
    }
    const fields = inputType.getFields();
    expect(Object.keys(fields).toSorted((a, b) => a.localeCompare(b))).toEqual(["isRead", "limit", "offset", "type"]);
    expect(fields.type?.type.toString()).toBe("NotificationType");
    expect(fields.isRead?.type.toString()).toBe("Boolean");
    expect(fields.limit?.type.toString()).toBe("Int");
    expect(fields.offset?.type.toString()).toBe("Int");
    // SEC (BOPLA): no identity field of any kind — the inbox is addressed
    // exclusively by the verified caller context.
    expect(Object.hasOwn(fields, "userId")).toBe(false);
    expect(Object.hasOwn(fields, "user")).toBe(false);
    expect(Object.hasOwn(fields, "id")).toBe(false);
    expect(Object.hasOwn(fields, "recipientId")).toBe(false);
  });

  test("anonymous (context-free) in-process execution of BOTH inbox queries yields UNAUTHORIZED", async () => {
    // Each op asserted in its OWN document: both fields are non-null at the
    // root, so a combined document would null-propagate the first failure
    // over its sibling (one error, second field never resolved).
    const documents = [
      { source: "{ myNotifications { totalCount } }", path: "myNotifications" },
      { source: "{ myUnreadNotificationCount }", path: "myUnreadNotificationCount" },
    ] as const;
    const results = await Promise.all(
      documents.map(async document => graphql({ schema: graphQLSchema, source: document.source, contextValue: {} }))
    );
    for (const [index, result] of results.entries()) {
      const errors = result.errors;
      if (!errors) throw new Error("expected the anonymous inbox query to fail");
      expect(errors).toHaveLength(1);
      expect(errors[0]?.extensions?.code).toBe("UNAUTHORIZED");
      expect(errors[0]?.path).toEqual([documents[index]?.path]);
    }
  });

  test("smuggled identity args die at validation BEFORE any resolver runs (zero identity-arg surface)", () => {
    const unknownRootArg = validate(graphQLSchema, parse("{ myNotifications(userId: 123) { totalCount } }"));
    expect(unknownRootArg).toHaveLength(1);
    expect(unknownRootArg[0]?.message).toContain('Unknown argument "userId"');

    const smuggledFilterField = validate(
      graphQLSchema,
      parse("{ myNotifications(filter: { userId: 123 }) { totalCount } }")
    );
    expect(smuggledFilterField).toHaveLength(1);
    expect(smuggledFilterField[0]?.message).toContain('unknown field "userId"');

    const unknownCountArg = validate(graphQLSchema, parse("{ myUnreadNotificationCount(userId: 123) }"));
    expect(unknownCountArg).toHaveLength(1);
    expect(unknownCountArg[0]?.message).toContain('Unknown argument "userId"');
  });
});

describe("Notification mutation surface — self-scoped read latch", () => {
  test("`markNotificationRead` returns Notification! with EXACTLY ONE required `id: ID!` arg", () => {
    const field = mutationField("markNotificationRead");
    expect(field.type.toString()).toBe("Notification!");
    const argNames = field.args.map(arg => arg.name).toSorted((a, b) => a.localeCompare(b));
    expect(argNames).toEqual(["id"]);
    const idArg = field.args[0];
    if (!idArg) throw new Error("expected the id argument");
    // Required + non-null — exactly the SDL contract's `(id: ID!)`.
    expect(idArg.type.toString()).toBe("ID!");
  });

  test("`markAllNotificationsRead` returns Int! with EXACTLY ONE optional `type: NotificationType` arg", () => {
    const field = mutationField("markAllNotificationsRead");
    expect(field.type.toString()).toBe("Int!");
    const argNames = field.args.map(arg => arg.name).toSorted((a, b) => a.localeCompare(b));
    expect(argNames).toEqual(["type"]);
    const typeArg = field.args[0];
    if (!typeArg) throw new Error("expected the type argument");
    // Optional + nullable — exactly the SDL contract's `(type: NotificationType)`.
    expect(typeArg.type.toString()).toBe("NotificationType");
  });

  test("BOTH inbox mutations carry EXACTLY the `authenticated` scope (no role/permission/superAdmin)", () => {
    for (const name of ["markNotificationRead", "markAllNotificationsRead"]) {
      const scopes = authScopesSnapshot(mutationField(name));
      expect(Object.keys(scopes).toSorted((a, b) => a.localeCompare(b))).toEqual(["authenticated"]);
      expect(scopes.authenticated).toBe(true);
      // SEC: every authenticated role owns an inbox — no role material may
      // participate in the scope decision.
      expect("role" in scopes).toBe(false);
      expect("permission" in scopes).toBe(false);
      expect("superAdmin" in scopes).toBe(false);
    }
  });

  test("anonymous (context-free) in-process execution of BOTH inbox mutations yields UNAUTHORIZED", async () => {
    // Each op asserted in its OWN document: both fields are non-null at the
    // root, so a combined document would null-propagate the first failure
    // over its sibling (one error, second field never resolved).
    const documents = [
      { source: 'mutation { markNotificationRead(id: "1") { id } }', path: "markNotificationRead" },
      { source: "mutation { markAllNotificationsRead }", path: "markAllNotificationsRead" },
    ] as const;
    const results = await Promise.all(
      documents.map(async document => graphql({ schema: graphQLSchema, source: document.source, contextValue: {} }))
    );
    for (const [index, result] of results.entries()) {
      const errors = result.errors;
      if (!errors) throw new Error("expected the anonymous inbox mutation to fail");
      expect(errors).toHaveLength(1);
      expect(errors[0]?.extensions?.code).toBe("UNAUTHORIZED");
      expect(errors[0]?.path).toEqual([documents[index]?.path]);
    }
  });

  test("smuggled identity args die at validation BEFORE any resolver runs (zero identity-arg surface)", () => {
    const smuggledMarkOne = validate(
      graphQLSchema,
      parse('mutation { markNotificationRead(id: "1", userId: 123) { id } }')
    );
    expect(smuggledMarkOne).toHaveLength(1);
    expect(smuggledMarkOne[0]?.message).toContain('Unknown argument "userId"');

    const smuggledMarkAll = validate(graphQLSchema, parse("mutation { markAllNotificationsRead(userId: 123) }"));
    expect(smuggledMarkAll).toHaveLength(1);
    expect(smuggledMarkAll[0]?.message).toContain('Unknown argument "userId"');
  });
});

describe("Users-locale surface (D2 backend vertical) — self-scoped locale preference", () => {
  const mutationType = graphQLSchema.getMutationType();

  if (!mutationType) {
    throw new Error("Schema must define a root Mutation type");
  }

  // Captured ONCE after the narrowing guard — direct lookups below never
  // re-dereference a possibly-null root type.
  const rootFields = mutationType.getFields();

  /** Fail-fast field lookup for the users-locale root field. */
  function updateMyLocaleField() {
    const field = rootFields.updateMyLocale;
    if (!field) {
      throw new Error("Mutation must register the `updateMyLocale` root field");
    }
    return field;
  }

  test("`updateMyLocale` returns User! with EXACTLY ONE required `locale: AppLocale!` arg", () => {
    const field = updateMyLocaleField();
    expect(field.type.toString()).toBe("User!");
    const argNames = field.args.map(arg => arg.name).toSorted((a, b) => a.localeCompare(b));
    expect(argNames).toEqual(["locale"]);
    const localeArg = field.args[0];
    if (!localeArg) throw new Error("expected the locale argument");
    // Required + non-null — exactly the SDL contract's `(locale: AppLocale!)`.
    expect(localeArg.type.toString()).toBe("AppLocale!");
  });

  test("`updateMyLocale` carries EXACTLY the `authenticated` scope (no role/permission/superAdmin)", () => {
    const scopes = authScopesSnapshot(updateMyLocaleField());
    expect(Object.keys(scopes).toSorted((a, b) => a.localeCompare(b))).toEqual(["authenticated"]);
    expect(scopes.authenticated).toBe(true);
    // SEC: every authenticated role owns a locale preference — no role
    // material may participate in the scope decision.
    expect("role" in scopes).toBe(false);
    expect("permission" in scopes).toBe(false);
    expect("superAdmin" in scopes).toBe(false);
  });

  test("AppLocale enum carries EXACTLY the 2 canonical values (keys on the wire, lowercase runtime values)", () => {
    const enumType = graphQLSchema.getType("AppLocale");

    if (!(enumType instanceof GraphQLEnumType)) {
      throw new Error("AppLocale must be registered as a GraphQL enum type");
    }

    const values = enumType.getValues();
    expect(values).toHaveLength(2);
    expect(values.map(value => value.name).toSorted((a, b) => a.localeCompare(b))).toEqual(["Ar", "En"]);
    // Runtime values stay the canonical lowercase locale strings —
    // byte-identical to the pgEnum / TS enum / shared `locales` list.
    expect(values.map(value => value.value).toSorted((a, b) => a.localeCompare(b))).toEqual(["ar", "en"]);
  });

  test("`User.locale` is the NULLABLE AppLocale enum (unset until the user picks one)", () => {
    const userType = graphQLSchema.getType("User");

    if (!(userType instanceof GraphQLObjectType)) {
      throw new Error("User must be registered as a GraphQL object type");
    }

    const localeField = userType.getFields().locale;
    if (!localeField) {
      throw new Error("User must register the `locale` field");
    }
    expect(localeField.type.toString()).toBe("AppLocale");
  });

  test("anonymous (context-free) in-process execution of updateMyLocale yields UNAUTHORIZED", async () => {
    const result = await graphql({
      schema: graphQLSchema,
      source: "mutation { updateMyLocale(locale: Ar) { id } }",
      contextValue: {},
    });
    const errors = result.errors;
    if (!errors) throw new Error("expected the anonymous locale mutation to fail");
    expect(errors).toHaveLength(1);
    expect(errors[0]?.extensions?.code).toBe("UNAUTHORIZED");
    expect(errors[0]?.path).toEqual(["updateMyLocale"]);
  });

  test("smuggled identity args die at validation BEFORE any resolver runs (zero identity-arg surface)", () => {
    const smuggledUserId = validate(
      graphQLSchema,
      parse("mutation { updateMyLocale(locale: Ar, userId: 123) { id } }")
    );
    expect(smuggledUserId).toHaveLength(1);
    expect(smuggledUserId[0]?.message).toContain('Unknown argument "userId"');

    // The closed enum rejects non-locale literals at validation time too.
    const invalidLiteral = validate(graphQLSchema, parse("mutation { updateMyLocale(locale: fr) { id } }"));
    expect(invalidLiteral).toHaveLength(1);
    expect(invalidLiteral[0]?.message).toContain('Value "fr" does not exist in "AppLocale" enum');
  });
});

describe("admin-governance mutations — exact arg shapes + `$all` scope pins", () => {
  test("`adminSetUserBlocked` returns AdminUserDetail! with EXACTLY the two required args (blocked: Boolean!, id: Int!)", () => {
    const field = mutationField("adminSetUserBlocked");
    expect(field.type.toString()).toBe("AdminUserDetail!");
    // The live sorted SDL emits args alphabetically — `blocked` precedes
    // `id`. Both are required (NonNull) — the resolver never has to
    // defend against a NULL flag (a NULL `blocked` would be a
    // GRAPHQL_VALIDATION_FAILED before the resolver body runs).
    const argsByName = new Map(field.args.map(arg => [arg.name, arg.type.toString()]));
    expect(argsByName.get("blocked")).toBe("Boolean!");
    expect(argsByName.get("id")).toBe("Int!");
    // No third arg smuggled in (BOPLA defense — the schema layer rejects
    // any undeclared field argument before the resolver runs).
    expect(field.args).toHaveLength(2);
  });

  test("`adminSetUserSuspended` returns AdminUserDetail! with EXACTLY three args (id: Int!, periodDays: Int, suspended: Boolean!)", () => {
    const field = mutationField("adminSetUserSuspended");
    expect(field.type.toString()).toBe("AdminUserDetail!");
    // The live sorted SDL emits args alphabetically — `id`, `periodDays`,
    // `suspended`. `periodDays` is the ONLY nullable arg (the optional
    // window length); `id` and `suspended` are required (NonNull).
    const argsByName = new Map(field.args.map(arg => [arg.name, arg.type.toString()]));
    expect(argsByName.get("id")).toBe("Int!");
    expect(argsByName.get("periodDays")).toBe("Int");
    expect(argsByName.get("suspended")).toBe("Boolean!");
    expect(field.args).toHaveLength(3);
  });

  test("BOTH governance mutations carry the EXACT `$all` conjunction — `{ authenticated: true, role: [UserRole.Admin] }`", () => {
    // The `$all` key is load-bearing: a plain `{ authenticated, role }` map
    // would combine the two scope checks with ANY semantics (either-or),
    // silently allowing a non-admin authenticated caller through. The
    // `$all` conjunction makes the combine AND — both scope checks must
    // pass for the resolver body to run. Cross-referenced from the
    // admin-governance wire-tier matrix (`admin-governance.matrix.test.ts`
    // Tier 0), which pins the same declaration via the same introspection
    // substrate and asserts the live FORBIDDEN / UNAUTHORIZED verdicts
    // over real HTTP.
    for (const name of ADMIN_GOVERNANCE_MUTATION_FIELDS) {
      const scopes = authScopesSnapshot(mutationField(name));
      expect(scopes).toEqual({
        $all: { authenticated: true, role: [UserRole.Admin] },
      });
      // SEC: the scope keys are EXACTLY `["authenticated", "role"]` —
      // no permission / superAdmin / fallback bypass.
      expect(Object.keys(scopes).toSorted((a, b) => a.localeCompare(b))).toEqual(["$all"]);
      // Reflect.get keeps the read off the member-access position (no
      // unsafe type assertion, no `any`).
      const allScope: unknown = Reflect.get(scopes, "$all");
      if (!isRecord(allScope)) throw new Error("expected record-shaped $all scope conjunction");
      expect(Object.keys(allScope).toSorted((a, b) => a.localeCompare(b))).toEqual(["authenticated", "role"]);
      // SEC: the role set is EXACTLY `[UserRole.Admin]` — no sibling /
      // teacher / parent / student read override silently smuggled in.
      const roleSet: unknown = Reflect.get(allScope, "role");
      expect(Array.isArray(roleSet)).toBe(true);
      expect(roleSet).toEqual([UserRole.Admin]);
    }
  });

  test("BOTH governance mutations reject smuggled identity args at validation (zero identity-arg surface)", () => {
    // A smuggled `actorId` / `userId` / `targetId` must die as
    // `Unknown argument` BEFORE the resolver body runs — `actorId` is
    // sourced exclusively from `ctx.user.id` (BOLA-safe by construction).
    const smuggledBlock = validate(
      graphQLSchema,
      parse("mutation { adminSetUserBlocked(id: 1, blocked: true, actorId: 42) { id } }")
    );
    expect(smuggledBlock).toHaveLength(1);
    expect(smuggledBlock[0]?.message).toContain('Unknown argument "actorId"');

    const smuggledSuspend = validate(
      graphQLSchema,
      parse("mutation { adminSetUserSuspended(id: 1, suspended: true, periodDays: 7, userId: 42) { id } }")
    );
    expect(smuggledSuspend).toHaveLength(1);
    expect(smuggledSuspend[0]?.message).toContain('Unknown argument "userId"');
  });

  test("anonymous (context-free) in-process execution of BOTH governance mutations yields UNAUTHORIZED", async () => {
    // Each op asserted in its OWN document: both fields are non-null at
    // the root, so a combined document would null-propagate the first
    // failure over its sibling.
    const documents = [
      {
        source: "mutation { adminSetUserBlocked(id: 1, blocked: true) { id } }",
        path: "adminSetUserBlocked",
      },
      {
        source: "mutation { adminSetUserSuspended(id: 1, suspended: true, periodDays: 7) { id } }",
        path: "adminSetUserSuspended",
      },
    ] as const;
    const results = await Promise.all(
      documents.map(async document => graphql({ schema: graphQLSchema, source: document.source, contextValue: {} }))
    );
    for (const [index, result] of results.entries()) {
      const errors = result.errors;
      if (!errors) throw new Error("expected the anonymous governance mutation to fail");
      expect(errors).toHaveLength(1);
      expect(errors[0]?.extensions?.code).toBe("UNAUTHORIZED");
      expect(errors[0]?.path).toEqual([documents[index]?.path]);
    }
  });
});

describe("admin financial-auditing surface — exact arg shapes + `$all` scope pins + enum vocabulary", () => {
  const queryType = graphQLSchema.getQueryType();

  if (!queryType) {
    throw new Error("Schema must define a root Query type");
  }

  /** Fail-fast query field lookup (mirrors the notification describe's helper). */
  function adminQueryField(name: string): GraphQLField<unknown, unknown> {
    const fields = queryType?.getFields();
    const field = fields?.[name];
    if (!field) {
      throw new Error(`Query must register the \`${name}\` root field`);
    }
    return field;
  }

  test("`adminStudentPayments` returns AdminStudentPaymentPage! with the filter + pagination args", () => {
    const field = adminQueryField("adminStudentPayments");
    expect(field.type.toString()).toBe("AdminStudentPaymentPage!");
    const argsByName = new Map(field.args.map(arg => [arg.name, arg.type.toString()]));
    expect(argsByName.get("filters")).toBe("AdminStudentPaymentsFilterInput");
    expect(argsByName.get("page")).toBe("Int");
    expect(argsByName.get("pageSize")).toBe("Int");
    expect(field.args).toHaveLength(3);
  });

  test("`adminTeacherWallet` returns AdminTeacherWallet! with the required teacherId arg", () => {
    const field = adminQueryField("adminTeacherWallet");
    expect(field.type.toString()).toBe("AdminTeacherWallet!");
    const argsByName = new Map(field.args.map(arg => [arg.name, arg.type.toString()]));
    expect(argsByName.get("teacherId")).toBe("ID!");
    expect(argsByName.get("filters")).toBe("AdminWalletTransactionFilterInput");
    expect(argsByName.get("page")).toBe("Int");
    expect(argsByName.get("pageSize")).toBe("Int");
    expect(field.args).toHaveLength(4);
  });

  test("`adminPendingWithdrawals` returns AdminWithdrawalQueuePage! with pagination args only", () => {
    const field = adminQueryField("adminPendingWithdrawals");
    expect(field.type.toString()).toBe("AdminWithdrawalQueuePage!");
    const argsByName = new Map(field.args.map(arg => [arg.name, arg.type.toString()]));
    expect(argsByName.get("page")).toBe("Int");
    expect(argsByName.get("pageSize")).toBe("Int");
    expect(field.args).toHaveLength(2);
  });

  test("`approveWithdrawal` returns TeacherTransaction! with EXACTLY ONE required `transactionId: ID!` arg", () => {
    const field = mutationField("approveWithdrawal");
    expect(field.type.toString()).toBe("TeacherTransaction!");
    const argNames = field.args.map(arg => arg.name).toSorted((a, b) => a.localeCompare(b));
    expect(argNames).toEqual(["transactionId"]);
    const idArg = field.args[0];
    if (!idArg) throw new Error("expected the transactionId argument");
    expect(idArg.type.toString()).toBe("ID!");
  });

  test("`rejectWithdrawal` returns TeacherTransaction! with EXACTLY the two required args", () => {
    const field = mutationField("rejectWithdrawal");
    expect(field.type.toString()).toBe("TeacherTransaction!");
    const argsByName = new Map(field.args.map(arg => [arg.name, arg.type.toString()]));
    expect(argsByName.get("transactionId")).toBe("ID!");
    expect(argsByName.get("reason")).toBe("String!");
    expect(field.args).toHaveLength(2);
  });

  test("`adjustTeacherWallet` returns TeacherTransaction! with EXACTLY ONE required `input` arg", () => {
    const field = mutationField("adjustTeacherWallet");
    expect(field.type.toString()).toBe("TeacherTransaction!");
    const argNames = field.args.map(arg => arg.name).toSorted((a, b) => a.localeCompare(b));
    expect(argNames).toEqual(["input"]);
    const inputArg = field.args[0];
    if (!inputArg) throw new Error("expected the input argument");
    expect(inputArg.type.toString()).toBe("AdjustTeacherWalletInput!");
  });

  test("ALL SIX financial-auditing root fields carry the EXACT `$all` conjunction", () => {
    for (const name of [...ADMIN_FINANCE_QUERY_FIELDS, ...ADMIN_FINANCE_MUTATION_FIELDS]) {
      const field = graphQLSchema.getMutationType()?.getFields()[name] ?? queryType.getFields()[name];
      if (!field) throw new Error(`expected the \`${name}\` root field`);
      const scopes = authScopesSnapshot(field);
      expect(scopes).toEqual({
        $all: { authenticated: true, role: [UserRole.Admin] },
      });
      expect(Object.keys(scopes).toSorted((a, b) => a.localeCompare(b))).toEqual(["$all"]);
      const allScope: unknown = Reflect.get(scopes, "$all");
      if (!isRecord(allScope)) throw new Error("expected record-shaped $all scope conjunction");
      const roleSet: unknown = Reflect.get(allScope, "role");
      expect(roleSet).toEqual([UserRole.Admin]);
    }
  });

  test("anonymous (context-free) in-process execution of ALL SIX financial-auditing fields yields UNAUTHORIZED", async () => {
    // Each op asserted in its OWN document: all six are non-null at the
    // root, so a combined document would null-propagate the first failure
    // over its siblings.
    const documents = [
      { source: "{ adminStudentPayments { totalCount } }", path: "adminStudentPayments" },
      { source: '{ adminTeacherWallet(teacherId: "1") { teacherId } }', path: "adminTeacherWallet" },
      { source: "{ adminPendingWithdrawals { totalCount } }", path: "adminPendingWithdrawals" },
      { source: 'mutation { approveWithdrawal(transactionId: "1") { id } }', path: "approveWithdrawal" },
      {
        source: 'mutation { rejectWithdrawal(transactionId: "1", reason: "x") { id } }',
        path: "rejectWithdrawal",
      },
      {
        source:
          'mutation { adjustTeacherWallet(input: { teacherId: "1", amount: "1.00", direction: Credit, reason: "x" }) { id } }',
        path: "adjustTeacherWallet",
      },
    ] as const;
    const results = await Promise.all(
      documents.map(async document => graphql({ schema: graphQLSchema, source: document.source, contextValue: {} }))
    );
    for (const [index, result] of results.entries()) {
      const errors = result.errors;
      if (!errors) throw new Error("expected the anonymous financial-auditing call to fail");
      expect(errors).toHaveLength(1);
      expect(errors[0]?.extensions?.code).toBe("UNAUTHORIZED");
      expect(errors[0]?.path).toEqual([documents[index]?.path]);
    }
  });

  test("WalletAdjustmentDirection exposes exactly the Credit | Debit wire vocabulary", () => {
    const enumType = graphQLSchema.getType("WalletAdjustmentDirection");

    if (!(enumType instanceof GraphQLEnumType)) {
      throw new Error("WalletAdjustmentDirection must be registered as a GraphQL enum type");
    }
    expect(
      enumType
        .getValues()
        .map(value => value.name)
        .toSorted((a, b) => a.localeCompare(b))
    ).toEqual(["Credit", "Debit"]);
  });

  test("smuggled identity args die at validation BEFORE any resolver runs (zero identity-arg surface)", () => {
    // The actor identity is sourced exclusively from `ctx.user.id` — a
    // smuggled `actorId` must die as `Unknown argument` BEFORE the resolver
    // body runs.
    const smuggledApprove = validate(
      graphQLSchema,
      parse('mutation { approveWithdrawal(transactionId: "1", actorId: 42) { id } }')
    );
    expect(smuggledApprove).toHaveLength(1);
    expect(smuggledApprove[0]?.message).toContain('Unknown argument "actorId"');

    const smuggledAdjust = validate(
      graphQLSchema,
      parse(
        'mutation { adjustTeacherWallet(input: { teacherId: "1", amount: "1.00", direction: Credit, reason: "x", actorId: 42 }) { id } }'
      )
    );
    expect(smuggledAdjust).toHaveLength(1);
    expect(smuggledAdjust[0]?.message).toContain('unknown field "actorId"');
  });

  test("the closed filter inputs reject smuggled fields at validation (BOPLA boundary)", () => {
    const smuggledPaymentFilters = validate(
      graphQLSchema,
      parse("{ adminStudentPayments(filters: { userId: 42 }) { totalCount } }")
    );
    expect(smuggledPaymentFilters).toHaveLength(1);
    expect(smuggledPaymentFilters[0]?.message).toContain('unknown field "userId"');

    const smuggledWalletFilters = validate(
      graphQLSchema,
      parse('{ adminTeacherWallet(teacherId: "1", filters: { userId: 42 }) { teacherId } }')
    );
    expect(smuggledWalletFilters).toHaveLength(1);
    expect(smuggledWalletFilters[0]?.message).toContain('unknown field "userId"');
  });
});

describe("Admin financial row/page object shapes — exact field sets + per-field types", () => {
  test("AdminStudentPayment row exposes `id` and EXACTLY the nine audit fields (structurally NO `userId`)", () => {
    const rowType = graphQLSchema.getType("AdminStudentPayment");

    if (!(rowType instanceof GraphQLObjectType)) {
      throw new Error("AdminStudentPayment must be registered as a GraphQL object type");
    }

    const fields = rowType.getFields();
    const field = (name: string) => {
      const candidate = fields[name];
      if (!candidate) {
        throw new Error(`AdminStudentPayment must register the \`${name}\` field`);
      }
      return candidate;
    };

    expect(Object.keys(fields).toSorted((a, b) => a.localeCompare(b))).toEqual([
      "amount",
      "createdAt",
      "currency",
      "id",
      "paymentGateway",
      "status",
      "studentId",
      "studentName",
      "subscriptionId",
    ]);
    // Exact field types per the contract (the audit row keeps the `DateTime`
    // scalar for the payment instant and the settlement enums for the
    // gateway/status vocabulary; the money amount/currency stay strings).
    expect(field("id").type.toString()).toBe("ID!");
    expect(field("amount").type.toString()).toBe("String!");
    expect(field("currency").type.toString()).toBe("String!");
    expect(field("paymentGateway").type.toString()).toBe("PaymentGateway!");
    expect(field("status").type.toString()).toBe("PaymentStatus!");
    expect(field("studentId").type.toString()).toBe("ID!");
    expect(field("studentName").type.toString()).toBe("String!");
    expect(field("subscriptionId").type.toString()).toBe("ID");
    expect(field("createdAt").type.toString()).toBe("DateTime!");
    // SEC: no owner-envelope field on the row — the audited student is
    // disclosed via `studentId` only (no `userId`/`user` bypass field).
    expect(Object.hasOwn(fields, "userId")).toBe(false);
  });

  test("AdminTeacherWallet inspector exposes `teacherId` and EXACTLY the nine wallet fields (structurally NO `userId`)", () => {
    const walletType = graphQLSchema.getType("AdminTeacherWallet");

    if (!(walletType instanceof GraphQLObjectType)) {
      throw new Error("AdminTeacherWallet must be registered as a GraphQL object type");
    }

    const fields = walletType.getFields();
    const field = (name: string) => {
      const candidate = fields[name];
      if (!candidate) {
        throw new Error(`AdminTeacherWallet must register the \`${name}\` field`);
      }
      return candidate;
    };

    expect(Object.keys(fields).toSorted((a, b) => a.localeCompare(b))).toEqual([
      "balance",
      "currency",
      "page",
      "pageSize",
      "teacherId",
      "teacherName",
      "totalCount",
      "totalEarning",
      "transactions",
    ]);
    // Exact field types per the contract (the money aggregates are nullable
    // strings; the ledger page reuses the canonical `TeacherTransaction`
    // object — single canonical object rule).
    expect(field("teacherId").type.toString()).toBe("ID!");
    expect(field("teacherName").type.toString()).toBe("String!");
    expect(field("currency").type.toString()).toBe("String!");
    expect(field("balance").type.toString()).toBe("String");
    expect(field("totalEarning").type.toString()).toBe("String");
    expect(field("page").type.toString()).toBe("Int!");
    expect(field("pageSize").type.toString()).toBe("Int!");
    expect(field("totalCount").type.toString()).toBe("Int!");
    expect(field("transactions").type.toString()).toBe("[TeacherTransaction!]!");
    // SEC: no owner-envelope field — the inspected teacher is disclosed via
    // `teacherId` only (no `userId`/`user` bypass field).
    expect(Object.hasOwn(fields, "userId")).toBe(false);
  });

  test("AdminWithdrawalQueueRow exposes EXACTLY the three queue fields (structurally NO `userId`)", () => {
    const rowType = graphQLSchema.getType("AdminWithdrawalQueueRow");

    if (!(rowType instanceof GraphQLObjectType)) {
      throw new Error("AdminWithdrawalQueueRow must be registered as a GraphQL object type");
    }

    const fields = rowType.getFields();
    const field = (name: string) => {
      const candidate = fields[name];
      if (!candidate) {
        throw new Error(`AdminWithdrawalQueueRow must register the \`${name}\` field`);
      }
      return candidate;
    };

    expect(Object.keys(fields).toSorted((a, b) => a.localeCompare(b))).toEqual([
      "teacherName",
      "transaction",
      "walletBalance",
    ]);
    // Exact field types per the contract (the queue row reuses the canonical
    // `TeacherTransaction` object for the pending transaction; the balance
    // snapshot is a NON-nullable string).
    expect(field("teacherName").type.toString()).toBe("String!");
    expect(field("transaction").type.toString()).toBe("TeacherTransaction!");
    expect(field("walletBalance").type.toString()).toBe("String!");
    // SEC: no owner-envelope field — the queue row discloses the teacher via
    // `teacherName` only (no `userId`/`user` bypass field).
    expect(Object.hasOwn(fields, "userId")).toBe(false);
  });

  test("AdminStudentPaymentPage wrapper exposes EXACTLY items/page/pageSize/totalCount", () => {
    const pageType = graphQLSchema.getType("AdminStudentPaymentPage");

    if (!(pageType instanceof GraphQLObjectType)) {
      throw new Error("AdminStudentPaymentPage must be registered as a GraphQL object type");
    }

    const fields = pageType.getFields();
    expect(Object.keys(fields).toSorted((a, b) => a.localeCompare(b))).toEqual([
      "items",
      "page",
      "pageSize",
      "totalCount",
    ]);
    expect(fields.items?.type.toString()).toBe("[AdminStudentPayment!]!");
    expect(fields.page?.type.toString()).toBe("Int!");
    expect(fields.pageSize?.type.toString()).toBe("Int!");
    expect(fields.totalCount?.type.toString()).toBe("Int!");
    // Wrapper is an embedded value object — no `id` (rows inside `items`
    // are the normalizable entities).
    expect(Object.hasOwn(fields, "id")).toBe(false);
  });

  test("AdminWithdrawalQueuePage wrapper exposes EXACTLY items/page/pageSize/totalCount/totalAmount", () => {
    const pageType = graphQLSchema.getType("AdminWithdrawalQueuePage");

    if (!(pageType instanceof GraphQLObjectType)) {
      throw new Error("AdminWithdrawalQueuePage must be registered as a GraphQL object type");
    }

    const fields = pageType.getFields();
    expect(Object.keys(fields).toSorted((a, b) => a.localeCompare(b))).toEqual([
      "items",
      "page",
      "pageSize",
      "totalAmount",
      "totalCount",
    ]);
    expect(fields.items?.type.toString()).toBe("[AdminWithdrawalQueueRow!]!");
    expect(fields.page?.type.toString()).toBe("Int!");
    expect(fields.pageSize?.type.toString()).toBe("Int!");
    expect(fields.totalCount?.type.toString()).toBe("Int!");
    expect(fields.totalAmount?.type.toString()).toBe("String!");
    // Wrapper is an embedded value object — no `id` (rows inside `items`
    // are the normalizable entities).
    expect(Object.hasOwn(fields, "id")).toBe(false);
  });
});

describe("Public-operation allowlist agreement", () => {
  test("`_health` is a member of the closed allowlist 1:1 with its scopeless schema posture", () => {
    expect(PUBLIC_OPERATION_NAMES).toContain("_health");
    expect(PUBLIC_OPERATIONS.has("_health")).toBe(true);
    // The field genuinely ships WITHOUT authScopes: anonymous execution below
    // would otherwise raise an UNAUTHORIZED error through the scope-auth plugin.
  });

  test("anonymous (context-free) execution of the probe succeeds end-to-end", async () => {
    const result = await graphql({
      schema: graphQLSchema,
      source: "{ _health { status service version timestamp } }",
      contextValue: {},
    });

    expect(result.errors).toBeUndefined();
    // Wire-shape assertion over the serialized data map (timestamp varies per
    // call — matched structurally). This proves the delegation-only resolver:
    // the exact four-field payload of the shared producer surfaces verbatim,
    // nothing more.
    const serializedProbe = JSON.stringify(result.data);
    const probeShape =
      /^\{"_health":\{"status":"ok","service":"kottaby","version":"([^"]*)","timestamp":"([^"]+)"\}\}$/;
    const match = probeShape.exec(serializedProbe);

    expect(match).not.toBeNull();
    // Delegation-only proof: version flows out of the shared service producer
    // (non-empty here, since npm_package_version exists in this workspace).
    expect(match?.[1]?.length ?? 0).toBeGreaterThan(0);
    // …and the timestamp is a parseable ISO-8601 instant (never cached).
    expect(Number.isNaN(Date.parse(match?.[2] ?? "invalid"))).toBe(false);
  });
});

describe("Codegen sync — committed SDL is byte-identical to the built schema", () => {
  test("frontend/graphql/generated/schema.graphql matches a fresh deterministic emission", () => {
    const sdlPath = resolve(process.cwd(), "frontend/graphql/generated/schema.graphql");
    const committedSdl = readFileSync(sdlPath, "utf8");
    const freshlyPrinted = printSchema(lexicographicSortSchema(graphQLSchema));

    expect(committedSdl).toBe(freshlyPrinted);
    // Belt-and-braces: the synced artifact really contains the retyped probe.
    expect(committedSdl).toContain("_health: HealthCheck!");
    expect(committedSdl).toContain("type HealthCheck {");
    // …and the session surface (7 root operations + 2 object
    // types + 2 input types) is really inside the committed artifact.
    expect(committedSdl).toContain("sessionById(id: ID!): Session");
    expect(committedSdl).toContain(
      "myStudentSessions(filter: SessionListFilterInput, page: Int = 1, pageSize: Int = 25): SessionPage!"
    );
    expect(committedSdl).toContain(
      "myTeacherSessions(filter: SessionListFilterInput, page: Int = 1, pageSize: Int = 25): SessionPage!"
    );
    expect(committedSdl).toContain("createSession(input: CreateSessionInput!): Session!");
    expect(committedSdl).toContain("startSession(id: ID!): Session!");
    expect(committedSdl).toContain("completeSession(id: ID!): Session!");
    expect(committedSdl).toContain("cancelSession(id: ID!, reason: String): Session!");
    expect(committedSdl).toContain("type Session {");
    expect(committedSdl).toContain("type SessionPage {");
    expect(committedSdl).toContain("input CreateSessionInput {");
    expect(committedSdl).toContain("input SessionListFilterInput {");
    // …and the dispute surface (3 root operations + the
    // arbitration enum + the five nullable Session fields) is really
    // inside the committed artifact.
    expect(committedSdl).toContain("openSessionDispute(id: ID!, reason: String!): Session!");
    expect(committedSdl).toContain(
      "resolveSessionDispute(id: ID!, note: String, partialAmount: String, resolution: DisputeResolution!): Session!"
    );
    expect(committedSdl).toContain(
      "adminDisputedSessions(filter: SessionListFilterInput, limit: Int = 25, offset: Int = 0): AdminDisputedSessionPage!"
    );
    expect(committedSdl).toContain("enum DisputeResolution {");
    for (const field of DISPUTE_SESSION_FIELDS) {
      expect(committedSdl).toContain(field);
    }
    // …and the post-confirmation arbitration surface (the student
    // dispute entry, the admin case-review query, and the case envelope
    // object) is really inside the committed artifact — at the exact arg
    // shapes the resolvers bind.
    expect(committedSdl).toContain("openPostConfirmationDispute(id: ID!, reason: String!): Session!");
    expect(committedSdl).toContain("adminDisputeCase(id: ID!): AdminDisputeCase!");
    expect(committedSdl).toContain("type AdminDisputeCase {");
    // …and the dispute-analytics snapshot (the argument-free admin
    // aggregate + its seven-count object) is really inside the committed
    // artifact.
    expect(committedSdl).toContain("adminDisputeAnalytics: AdminDisputeAnalytics!");
    expect(committedSdl).toContain("type AdminDisputeAnalytics {");
    // …and the dual-confirmation mutation is really inside the
    // committed artifact.
    expect(committedSdl).toContain("confirmSessionCompletion(id: ID!): Session!");
    // …and the wallet surface (2 root operations + the payout
    // input + the two ledger enums) is really inside the committed artifact.
    expect(committedSdl).toContain("myWallet: Wallet!");
    expect(committedSdl).toContain("requestWithdrawal(input: RequestWithdrawalInput!): Wallet!");
    expect(committedSdl).toContain("input RequestWithdrawalInput {");
    expect(committedSdl).toContain("enum TransactionType {");
    expect(committedSdl).toContain("enum TransactionStatus {");
    // …and the admin-governance mutation pair (the sanctioned
    // post-reconciliation addition) is really inside the committed
    // artifact — at the sorted positions, with the exact arg shapes.
    expect(committedSdl).toContain("adminSetUserBlocked(blocked: Boolean!, id: Int!): AdminUserDetail!");
    expect(committedSdl).toContain(
      "adminSetUserSuspended(id: Int!, periodDays: Int, suspended: Boolean!): AdminUserDetail!"
    );
    // …and the reconciled admin-user-management surface (3
    // mutations + 4 queries + 11 named types + 2 enums) is really inside
    // the committed artifact (the reconciliation targets the same byte
    // stream the live builder emits).
    expect(committedSdl).toContain("adminCreateUser(input: AdminCreateUserInput!): AdminUserDetail!");
    expect(committedSdl).toContain("adminSetUserDeleted(deleted: Boolean!, id: Int!): AdminUserDetail!");
    expect(committedSdl).toContain("adminUpdateUser(id: Int!, input: AdminUpdateUserInput!): AdminUserDetail!");
    expect(committedSdl).toContain("adminUserActivity(id: Int!, limit: Int): [AdminUserActivityEntry!]!");
    expect(committedSdl).toContain("adminUserDetail(id: Int!): AdminUserDetail!");
    expect(committedSdl).toContain("adminUserStats: AdminUserStats!");
    expect(committedSdl).toContain(
      "adminUsers(filters: AdminUserFiltersInput, page: Int, pageSize: Int): AdminUserPage!"
    );
    expect(committedSdl).toContain("type AdminUserDetail {");
    expect(committedSdl).toContain("type AdminUserStats {");
    expect(committedSdl).toContain("enum AdminUserGovernanceFilter {");
    expect(committedSdl).toContain("enum AuditActionType {");
    // …and the session-report surface (1 mutation + 2 queries +
    // the two report objects + the four closed input whitelists + the
    // recitation enum) is really inside the committed artifact.
    expect(committedSdl).toContain("submitSessionReport(id: ID!, input: SubmitSessionReportInput!): SessionReport!");
    expect(committedSdl).toContain("sessionReport(sessionId: ID!): SessionReport");
    expect(committedSdl).toContain("sessionHomework(sessionId: ID!): SessionHomeWork");
    expect(committedSdl).toContain("type SessionReport {");
    expect(committedSdl).toContain("type SessionHomeWork {");
    expect(committedSdl).toContain("input SubmitSessionReportInput {");
    expect(committedSdl).toContain("input HomeWorkAssignmentInput {");
    expect(committedSdl).toContain("input HomeWorkBlockInput {");
    expect(committedSdl).toContain("input HomeWorkGradeInput {");
    expect(committedSdl).toContain("enum SurahJuzRef {");
    // …and the session-recitation pair (the write-once per-session record)
    // is really inside the committed artifact — at the sorted positions,
    // with the exact arg shapes and both type-block headers.
    expect(committedSdl).toContain(
      "setSessionRecitation(input: SessionRecitationInput!, sessionId: ID!): SessionRecitation!"
    );
    expect(committedSdl).toContain("sessionRecitation(sessionId: ID!): SessionRecitation");
    expect(committedSdl).toContain("type SessionRecitation {");
    expect(committedSdl).toContain("input SessionRecitationInput {");
    // …and the admin financial-auditing surface (3 queries + 3 mutations
    // + the adjustment-direction enum + the 8 named types) is really
    // inside the committed artifact.
    expect(committedSdl).toContain(
      "adminStudentPayments(filters: AdminStudentPaymentsFilterInput, page: Int, pageSize: Int): AdminStudentPaymentPage!"
    );
    expect(committedSdl).toContain(
      "adminTeacherWallet(filters: AdminWalletTransactionFilterInput, page: Int, pageSize: Int, teacherId: ID!): AdminTeacherWallet!"
    );
    expect(committedSdl).toContain("adminPendingWithdrawals(page: Int, pageSize: Int): AdminWithdrawalQueuePage!");
    expect(committedSdl).toContain("approveWithdrawal(transactionId: ID!): TeacherTransaction!");
    expect(committedSdl).toContain("rejectWithdrawal(reason: String!, transactionId: ID!): TeacherTransaction!");
    expect(committedSdl).toContain("adjustTeacherWallet(input: AdjustTeacherWalletInput!): TeacherTransaction!");
    expect(committedSdl).toContain("enum WalletAdjustmentDirection {");
    expect(committedSdl).toContain("type AdminStudentPaymentPage {");
    expect(committedSdl).toContain("type AdminTeacherWallet {");
    expect(committedSdl).toContain("type AdminWithdrawalQueuePage {");
    expect(committedSdl).toContain("input AdminStudentPaymentsFilterInput {");
    expect(committedSdl).toContain("input AdminWalletTransactionFilterInput {");
    expect(committedSdl).toContain("input AdjustTeacherWalletInput {");
  });
});
