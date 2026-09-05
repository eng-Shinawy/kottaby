import type { AuditActionType } from "@/backend/enum/audit/audit-action-type.enum";
import type { AdminUserGovernanceFilter } from "@/backend/enum/users/admin-user-governance-filter.enum";
import type { Gender } from "@/backend/enum/users/gender.enum";
import type { UserRole } from "@/backend/enum/users/user-role.enum";
import type { ApplicantProfileReturnType } from "@/backend/types/teachers/applicant.types";
import type { RegisterPublicRole } from "@/backend/types/users/registration.types";
import type { UserSelectType } from "@/backend/types/users/user.types";

/**
 * `AdminUserSafeSelect` — `users` row projection with `passwordHash`
 * structurally absent from every admin surface. Composed via `Omit` so the
 * forbidden-field discipline is enforced at the type level: no resolver or
 * service that consumes this shape can ever read or leak the hash. The
 * underlying column remains in the database and in `UserSelectType` (it is
 * required for authentication); this alias is the canonical
 * never-touch-this-field view for admin surfaces.
 */
export type AdminUserSafeSelect = Omit<UserSelectType, "passwordHash">;

/**
 * `AdminUserListItemReturnType` — directory row projection. One `users` row
 * plus a role-child status headline. Every field is a pure read; no
 * server-controlled field is mutable through this shape.
 *
 * The role-child headline columns are nullable per-role: only the columns
 * applicable to a given `role` carry non-null values; the others remain
 * `null` so a single row shape serves all four roles without per-role
 * variant unions. The service layer populates the matching slot per row
 * and leaves the others `null`.
 *
 * `role` is re-applied as the `UserRole` TS enum over the raw pgEnum
 * string via `toUserRole` at map time (fail-closed on corrupt stored
 * values). The governance booleans are null-coalesced from the nullable
 * schema columns so a missing value reads as `false`.
 */
export interface AdminUserListItemReturnType {
  readonly id: number;
  readonly fullName: string;
  readonly email: string;
  readonly phone: string | null;
  readonly role: UserRole;
  readonly gender: Gender | null;
  readonly dateOfBirth: string | null;
  readonly country: string | null;
  readonly isDeleted: boolean;
  readonly suspended: boolean;
  readonly isBlocked: boolean;
  readonly lastActiveAt: Date | null;
  readonly createdAt: Date;
  readonly applicantStatus: ApplicantProfileReturnType["status"] | null;
  readonly teacherIsApproved: boolean | null;
  readonly teacherIsEvaluator: boolean | null;
  readonly studentHasParentLink: boolean | null;
  readonly studentHasActiveSubscription: boolean | null;
  readonly parentLinkedChildrenCount: number | null;
}

/**
 * `AdminUserPageReturnType` — paginated directory result envelope. An
 * out-of-range page yields an empty `items` array with the honest
 * `totalCount` (never clamped, never an error). `page` and `pageSize` are
 * echoed back so callers can normalize client-side pagination state.
 */
export interface AdminUserPageReturnType {
  readonly items: AdminUserListItemReturnType[];
  readonly totalCount: number;
  readonly page: number;
  readonly pageSize: number;
}

/**
 * `AdminUserStatsReturnType` — directory-wide aggregate counters for the
 * admin overview strip. Pure read: one aggregate round-trip over `users`
 * (no per-role JOINs, no pagination). Governance counters follow the SAME
 * null-safe resolution as the directory governance filter — a legacy
 * NULL-state column reads as "active" (never deleted/suspended/blocked):
 *  - `activeCount`   — not deleted AND not suspended AND not blocked
 *                      (NULL-state columns coalesce to "not set").
 *  - `suspendedCount`— `suspended = true`.
 *  - `blockedCount`  — `is_blocked = true`.
 *  - `deletedCount`  — `is_deleted = true`.
 *
 * Role counters partition `totalCount` exactly (each user carries exactly
 * one role). `newThisWeekCount` counts rows whose `created_at` is within
 * the trailing 7-day window — the cutoff is computed server-side and
 * bound as a parameter (never `now() - interval` SQL so the query stays
 * engine-portable). The governance counters may overlap by design
 * (a suspended-but-deleted user counts in BOTH buckets) — they are
 * FILTERED counts, not a partition.
 */
export interface AdminUserStatsReturnType {
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
 * `AdminUserActivityEntryReturnType` — one audit-trail entry in the
 * per-user "recent activity" timeline on the admin detail page. Scoped
 * read-back of the append-only `audit_logs` table: rows WHERE
 * `entity_type = 'user' AND entity_id = :userId` (actions performed ON
 * this account), newest-first.
 *
 *  - `actionType` is re-applied as the `AuditActionType` TS enum over the
 *    raw pgEnum string at map time (fail-closed on corrupt stored values).
 *  - `actorName` is the acting admin's display name, resolved via an
 *    INNER JOIN on `users.id = audit_logs.actor_id` (the FK is NOT NULL
 *    RESTRICT, so the join never drops rows and never nulls the name).
 *  - `changedFields` is the defensive projection of the `details` JSON
 *    payload's `changedFields` array (audit rows written by the admin
 *    user-management mutations carry `{"changedFields":[…]}` for updates).
 *    Malformed/truncated/unparseable payloads degrade to `null` — the
 *    timeline renders the action + actor + timestamp regardless. Only
 *    STRING array members survive; anything else is filtered out (BOPLA
 *    discipline on read-back: never echo unvalidated payload shapes).
 *  - `createdAt` is the audit row's immutable insert timestamp.
 *
 * This is a deliberately SCOPED read-back (one user's governance
 * timeline), NOT the global audit-trail browsing surface — that remains
 * owned by DEV3-020 per the deferred-items ledger (D1).
 */
export interface AdminUserActivityEntryReturnType {
  readonly id: number;
  readonly actionType: AuditActionType;
  readonly actorName: string;
  readonly changedFields: readonly string[] | null;
  readonly createdAt: Date;
}

/**
 * `AdminTeacherSnapshotReturnType` — read-only projection of the `teacher`
 * child row when one exists for the detail view. Mirrors the certified
 * teacher state only; teacher-applicants (no `teacher` row yet) yield
 * `null` at the detail composition site rather than this shape. The
 * `averageRating` column is `decimal(3,2)` and is surfaced as a string to
 * preserve precision (Drizzle's default numeric mode).
 */
export interface AdminTeacherSnapshotReturnType {
  readonly isApproved: boolean;
  readonly isEvaluator: boolean;
  readonly isOnline: boolean;
  readonly averageRating: string | null;
}

/**
 * `AdminStudentSnapshotReturnType` — read-only projection of the
 * `students` child row when one exists for the detail view. Balance
 * fields are exposed as pure reads; this surface ships NO mutation that
 * touches them. `balanceTrial` and `trialGrantedAt` are nullable against
 * a future schema delta that adds the trial lane; until then they are
 * returned as `null` (dormant).
 */
export interface AdminStudentSnapshotReturnType {
  readonly handshakeCode: string;
  readonly parentId: number | null;
  readonly primaryLanguage: string | null;
  readonly anotherLanguage: string | null;
  readonly hasParentLink: boolean;
  readonly hasActiveSubscription: boolean;
  readonly balanceHifz: number | null;
  readonly balanceTajweed: number | null;
  readonly balanceReviews: number | null;
  readonly balanceTrial: number | null;
  readonly trialGrantedAt: Date | null;
}

/**
 * `AdminParentSnapshotReturnType` — read-only projection of the `parents`
 * child row when one exists for the detail view. The parent headline is
 * the linked-children count (a server-side aggregate of `students.parent_id`
 * for the row's user id, never mirrored from client input).
 */
export interface AdminParentSnapshotReturnType {
  readonly linkedChildrenCount: number;
}

/**
 * `AdminUserDetailReturnType` — full profile plus resolved role-child
 * state. Extends `AdminUserSafeSelect` so `passwordHash` remains
 * structurally absent. The role-child slots are independently nullable:
 * only the slot matching the user's role is populated; the others remain
 * `null`. The `applicant` slot reuses the canonical
 * `ApplicantProfileReturnType` (composition-only — never re-declared).
 */
export interface AdminUserDetailReturnType extends AdminUserSafeSelect {
  readonly applicant: ApplicantProfileReturnType | null;
  readonly teacher: AdminTeacherSnapshotReturnType | null;
  readonly student: AdminStudentSnapshotReturnType | null;
  readonly parent: AdminParentSnapshotReturnType | null;
}

/**
 * `AdminCreateUserSubmitInput` — closed whitelist for the admin user
 * creation surface. Mirrors the public registration shape minus
 * server-controlled fields (`id`, governance flags, timestamps, balances,
 * handshake code). `role` is the public registration role enum
 * (`student | teacher | parent`) — `admin` is structurally excluded here;
 * privileged admin-onboarding remains the sole producer of admin child
 * rows. Any transport-tampered extra field is ignored by explicit
 * field-by-field mapping at the service boundary (BOPLA).
 */
export interface AdminCreateUserSubmitInput {
  readonly fullName: string;
  readonly email: string;
  readonly phone: string;
  readonly password: string;
  readonly gender?: Gender;
  readonly country: string;
  readonly role: RegisterPublicRole;
}

/**
 * `AdminUpdateUserPatchInput` — closed whitelist for the admin profile
 * patch surface. Exactly these five keys are accepted; any
 * transport-tampered extra field is ignored by explicit field-by-field
 * mapping at the service boundary (BOPLA). `email`, `role`,
 * `passwordHash`, governance fields, `parentId`, handshake code,
 * balances, and timestamps are structurally unreachable through this
 * shape.
 *
 * `dateOfBirth` is typed as `string | null` to mirror the underlying
 * Drizzle `date("date_of_birth")` column's inferred select type (Drizzle
 * returns ISO-8601 calendar strings by default for `date` columns without
 * `mode: "date"`). A `null` value signals "clear the stored date".
 */
export interface AdminUpdateUserPatchInput {
  readonly fullName?: string;
  readonly phone?: string;
  readonly country?: string;
  readonly gender?: Gender;
  readonly dateOfBirth?: string | null;
}

/**
 * `AdminUserFiltersSubmitInput` — independent ANDed filters for the
 * directory listing. Absent or `null` members drop out at the service
 * layer (the directory falls back to the unfiltered listing rather than
 * erroring); a transport-tampered `governance` value that is not a
 * recognized enum member fails input validation before any DB read.
 * `search` is a free-text substring applied case-insensitively over
 * `fullName` and `email`; the caller MUST escape LIKE wildcards before
 * composing the pattern (the service layer enforces this).
 */
export interface AdminUserFiltersSubmitInput {
  readonly role?: UserRole | null;
  readonly governance?: AdminUserGovernanceFilter | null;
  readonly country?: string | null;
  readonly search?: string | null;
}

/**
 * `AdminUserUpdateDbPatch` — repo-internal whitelisted patch shape for
 * the guarded profile update. The field set is the same as the input
 * patch whitelist; the service layer builds this shape field-by-field
 * (never via spread) and the repo applies it as the `SET` clause of a
 * guarded `UPDATE ... RETURNING`. `Partial` lets the service omit
 * unchanged fields so only touched columns are written.
 */
export type AdminUserUpdateDbPatch = Partial<
  Pick<UserSelectType, "fullName" | "phone" | "country" | "gender" | "dateOfBirth">
>;

/**
 * `GovernanceProbeRowType` — focused probe-row shape carrying the five
 * `users` governance columns consumed by the governance-state classifier
 * (deleted flag, suspension flag + window, block flag). Repositories expose
 * a dedicated probe read that returns EXACTLY these columns — never the
 * full row, never `passwordHash`, never any PII column — so the classifier
 * runs against the minimal-cost read for state disambiguation.
 *
 * All five members preserve the nullable-with-default schema shape
 * (Drizzle `$inferSelect` yields `boolean | null` for columns that lack
 * `notNull()`); the probe deliberately does NOT null-coalesce to `false`
 * so the suspension-window predicate can distinguish "explicitly set to
 * false" from "legacy NULL state" when deciding fail-closed behavior.
 *
 * The shape is `readonly` end-to-end: probe rows are immutable snapshots
 * consumed by the service layer for read-only state classification. Any
 * mutation path goes through the dedicated guarded repository transitions
 * rather than mutating a probe instance in place.
 */
export type GovernanceProbeRowType = {
  readonly isDeleted: boolean | null;
  readonly suspended: boolean | null;
  readonly suspendedAt: Date | null;
  readonly suspendedPeriodDays: number | null;
  readonly isBlocked: boolean | null;
};
