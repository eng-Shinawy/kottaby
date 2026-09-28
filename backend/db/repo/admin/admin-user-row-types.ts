/**
 * Admin user row shapes — raw DB row and normalized-filter types for the
 * admin user directory repository (`./admin-user.repository.ts`).
 *
 * These interfaces describe the raw Drizzle row shapes the repository
 * returns; the service layer (`backend/services/admin/user-management.service.ts`)
 * maps them to the canonical return types. They live beside the repository
 * (not in `backend/types/`) because they are repo-internal projections —
 * one canonical escape/binding contract per the repository header.
 */
import type { ApplicantCooldownState } from "@/backend/enum/teachers/applicant-cooldown-state.enum";
import type { ApplicantStatus } from "@/backend/enum/teachers/applicant-status.enum";
import type { AdminUserGovernanceFilter } from "@/backend/enum/users/admin-user-governance-filter.enum";
import type { UserSelectType } from "@/backend/types";

/**
 * The raw pgEnum string union mirrored from `UserSelectType["role"]`. The
 * TS `UserRole` enum is a nominal type that the Drizzle-inferred row
 * (string-union) is not assignable to; the repo-internal row carries the
 * raw string union so the inferred Drizzle return type is structurally
 * assignable to the row interface without an `as` cast. The service layer
 * maps this raw string to the canonical `UserRole` enum via `toUserRole`
 * at projection time.
 */
type RawUserRole = UserSelectType["role"];

/**
 * The raw pgEnum string union mirrored from `UserSelectType["gender"]`.
 * Same nominal-vs-structural rationale as `RawUserRole`.
 */
type RawGender = UserSelectType["gender"];

/**
 * `NormalizedAdminUserFilters` — repo-internal filter shape.
 *
 * The service layer normalizes a transport-shape `AdminUserFiltersSubmitInput`
 * into this structure before calling the repo:
 *  - `role` / `governance` / `country` are passed through unchanged (the
 *    service has already rejected malformed enum members at the input
 *    boundary; absent members drop out per the forgiving read rule).
 *  - `applicantStatus` / `cooldownState` are passed through unchanged
 *    (enum members already validated at the GraphQL input boundary);
 *    absent members drop out per the forgiving read rule. The cooldown
 *    arm's predicates mirror the wire derivation EXACTLY — one captured
 *    `now` per chain build, strict `>` for the active arm — so a filtered
 *    result set can never disagree with the per-row chip the same query
 *    renders.
 *  - `searchPattern` is the search substring AFTER `escapeLikeWildcards`
 *    has been applied AND after the result has been wrapped as `%…%`.
 *    The repo binds this directly to its `ilike(column, pattern)`
 *    predicate — never re-escaping or re-wrapping. The structural
 *    contract (one canonical escape point at the service, one binding
 *    point at the repo) eliminates the wildcard-injection surface.
 *
 * Empty/absent members are skipped by the WHERE-chain builder (the
 * directory falls back to the unfiltered listing rather than erroring).
 */
export interface NormalizedAdminUserFilters {
  readonly role?: RawUserRole | null;
  readonly governance?: AdminUserGovernanceFilter | null;
  readonly country?: string | null;
  readonly searchPattern?: string | null;
  readonly applicantStatus?: ApplicantStatus | null;
  readonly cooldownState?: ApplicantCooldownState | null;
  /**
   * Time-window narrow for the cooldown lifecycle: `true` restricts the
   * result to applicants whose stamped cooldown expires WITHIN the
   * canonical "expiring soon" window (`COOLDOWN_EXPIRING_SOON_DAYS` —
   * strictly in the future AND at most 7 days out). Absent/`null`/`false`
   * drops out per the forgiving read rule. The window bounds reuse the
   * ONE captured `now` per chain build and the SAME constant the
   * lifecycle-stats aggregate counts with, so the dashboard KPI and the
   * filtered directory can never disagree about what "expiring soon"
   * means.
   */
  readonly cooldownExpiringSoon?: boolean | null;
}

/**
 * `AdminCooldownLifecycleRow` — raw aggregate row shape returned by
 * `getCooldownLifecycleStats`. Every member is a filtered count produced by
 * ONE aggregate query over `applicants INNER JOIN users` (shared-PK, 1:1 —
 * the join only carries the deleted-flag half of the directory's base
 * predicate). Rows with NO stamped cooldown (`cooldown_until IS NULL`) can
 * never match any arm — all three predicates are NULL-rejecting — so the
 * counts partition the cooling-applicant population exactly:
 *  - `activeCount`       — a stamped instant strictly in the future
 *                          (the shared strict-`>` boundary).
 *  - `expiringSoonCount` — the SLICE of `activeCount` that expires within
 *                          the canonical 7-day window (inclusive upper
 *                          bound, `lte`).
 *  - `expiredCount`      — a stamped instant at or before `now`.
 *
 * The service maps this row to `AdminCooldownLifecycleStatsReturnType`
 * verbatim (plain numbers; null-coalescing to `0` guards the impossible
 * empty-aggregate case).
 */
export interface AdminCooldownLifecycleRow {
  readonly activeCount: number;
  readonly expiringSoonCount: number;
  readonly expiredCount: number;
  /**
   * The canonical window length (in days) `expiringSoonCount` was measured
   * with — echoed verbatim from the SAME constant the window predicate
   * used, so the wire carries the window the count was measured with (no
   * shared-constant drift across the boundary).
   */
  readonly expiringSoonWindowDays: number;
}

/**
 * `AdminUserDirectoryRow` — raw DB row shape returned by `listDirectory`.
 *
 * The role-child headline columns are nullable per role: only the columns
 * applicable to a given `role` carry non-null values; the others remain
 * `null` so a single row shape serves all four roles without per-role
 * variant unions. The service layer maps this raw row to
 * `AdminUserListItemReturnType` (null-coalescing governance booleans,
 * guard-validating stored applicant status, mapping raw role string to
 * `UserRole` via `toUserRole`).
 *
 * The governance booleans (`isDeleted`, `suspended`, `isBlocked`) preserve
 * the nullable-with-default schema shape — `$inferSelect` yields
 * `boolean | null` because the columns lack `notNull()`. The service
 * null-coalesces them to `false` when projecting to the directory shape.
 */
export interface AdminUserDirectoryRow {
  readonly id: number;
  readonly fullName: string;
  readonly email: string;
  readonly phone: string | null;
  readonly role: RawUserRole;
  readonly gender: RawGender | null;
  readonly dateOfBirth: string | null;
  readonly country: string | null;
  readonly isDeleted: boolean | null;
  readonly suspended: boolean | null;
  readonly isBlocked: boolean | null;
  readonly lastActiveAt: Date | null;
  readonly createdAt: Date;
  readonly applicantStatus: string | null;
  /** Raw stored cooldown instant from the row's `applicants` child (null when absent). */
  readonly applicantCooldownUntil: Date | null;
  readonly teacherIsApproved: boolean | null;
  readonly teacherIsEvaluator: boolean | null;
  readonly studentHasParentLink: boolean | null;
  readonly studentHasActiveSubscription: boolean | null;
  readonly parentLinkedChildrenCount: number | null;
}

/**
 * `AdminUserDetailRow` — raw DB row shape returned by `findDetailById`.
 *
 * Flat single-row projection that includes every safe `users` column plus
 * the full role-child columns (nullable per absent role-child row) plus
 * the two scalar subselects (`parentLinkedChildrenCount`,
 * `studentHasActiveSubscription`). The service layer assembles the
 * role-child snapshot objects (`AdminTeacherSnapshotReturnType`,
 * `AdminStudentSnapshotReturnType`, `AdminParentSnapshotReturnType`,
 * `ApplicantProfileReturnType`) from this flat row — the repo shape stays
 * flat so the query is single-round-trip and trivially EXPLAIN-able.
 *
 * `passwordHash` is structurally absent (the `SAFE_USER_SELECT` shape
 * omits it).
 */
export interface AdminUserDetailRow {
  readonly id: number;
  readonly fullName: string;
  readonly email: string;
  readonly phone: string | null;
  readonly role: RawUserRole;
  readonly dateOfBirth: string | null;
  readonly gender: RawGender;
  readonly country: string | null;
  readonly isDeleted: boolean | null;
  readonly deletedAt: Date | null;
  readonly suspended: boolean | null;
  readonly suspendedAt: Date | null;
  readonly suspendedPeriodDays: number | null;
  readonly isBlocked: boolean | null;
  readonly blockedAt: Date | null;
  readonly lastActiveAt: Date | null;
  readonly locale: UserSelectType["locale"];
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly applicantStatus: string | null;
  readonly applicantVerificationAttempts: number | null;
  readonly applicantLastAttemptAt: Date | null;
  readonly applicantCooldownUntil: Date | null;
  readonly teacherIsApproved: boolean | null;
  readonly teacherIsEvaluator: boolean | null;
  readonly teacherIsOnline: boolean | null;
  readonly teacherAverageRating: string | null;
  readonly studentHandshakeCode: string | null;
  readonly studentParentId: number | null;
  readonly studentPrimaryLanguage: string | null;
  readonly studentAnotherLanguage: string | null;
  readonly studentBalanceHifz: number | null;
  readonly studentBalanceTajweed: number | null;
  readonly studentBalanceReviews: number | null;
  readonly parentRowExists: boolean | null;
  readonly parentLinkedChildrenCount: number | null;
  readonly studentHasActiveSubscription: boolean | null;
}

/**
 * `AdminUserStatsRow` — raw aggregate row shape returned by `getStats`.
 * Every member is a filtered count produced by a single aggregate query
 * over `users` (no JOINs, no scalar subselects). The service layer maps
 * this row to `AdminUserStatsReturnType` verbatim (all members are
 * already plain numbers — null-coalescing to `0` guards the impossible
 * empty-aggregate case).
 */
export interface AdminUserStatsRow {
  readonly totalCount: number;
  readonly activeCount: number;
  readonly suspendedCount: number;
  readonly blockedCount: number;
  readonly deletedCount: number;
  readonly adminsCount: number;
  readonly teachersCount: number;
  readonly studentsCount: number;
  readonly parentsCount: number;
  readonly newThisWeekCount: number;
}

/**
 * `AdminUserActivityRow` — raw row shape returned by `getActivity`. The
 * `actionType` member carries the raw pgEnum string union (mirrors the
 * `RawUserRole` discipline above — the service maps it to the canonical
 * `AuditActionType` TS enum at projection time). `actorName` is resolved
 * via the INNER JOIN on `users.id = audit_logs.actor_id` (NOT NULL FK —
 * never null in practice; typed nullable for Drizzle inference parity).
 * `details` is the raw `varchar(2000)` JSON string, parsed defensively by
 * the service. `entityType` is the raw recorded entity discriminator
 * (`"user"` for account rows, `"applicant"` for the user's teacher-
 * applicant lifecycle rows — the two arms the timeline widens over).
 */
export interface AdminUserActivityRow {
  readonly id: number;
  readonly actionType: string;
  readonly entityType: string;
  readonly actorName: string | null;
  readonly details: string | null;
  readonly createdAt: Date;
}
