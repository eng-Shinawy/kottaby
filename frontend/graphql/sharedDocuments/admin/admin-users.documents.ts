/**
 * Admin user GraphQL documents — directory, detail, create, update,
 * credential set (with optional force-reset-on-next-login),
 * soft-delete/reactivate, applicant-cooldown extension, applicant
 * evaluation override.
 *
 * Per `frontend/graphql/sharedDocuments/AGENTS.md`:
 *  - All documents use `gql` + `TypedDocumentNode` (codegen types only).
 *  - `id` is selected FIRST in every object (Apollo cache normalization).
 *  - Hooks consumed from `@apollo/client/react` in views:
 *    `useQuery`/`useMutation` ONLY — NO `useLazyQuery`.
 *  - Variables are typed, never string-interpolated.
 *  - No sensitive field (`passwordHash`) is ever selected.
 */
import { gql, type TypedDocumentNode } from "@apollo/client";
import type {
  AdminApplicantCooldownStatsQuery,
  AdminCreateUserMutation,
  AdminExtendApplicantCooldownMutation,
  AdminExtendApplicantCooldownMutationVariables,
  AdminOverrideApplicantEvaluationMutation,
  AdminOverrideApplicantEvaluationMutationVariables,
  AdminSetUserBlockedMutation,
  AdminSetUserBlockedMutationVariables,
  AdminSetUserDeletedMutation,
  AdminSetUserPasswordMutation,
  AdminSetUserPasswordMutationVariables,
  AdminSetUserSuspendedMutation,
  AdminSetUserSuspendedMutationVariables,
  AdminUpdateUserMutation,
  AdminUserActivityQuery,
  AdminUserActivityQueryVariables,
  AdminUserCountryBreakdownQuery,
  AdminUserCountryBreakdownQueryVariables,
  AdminUserDetailQuery,
  AdminUserStatsQuery,
  AdminUsersQuery,
} from "@/frontend/graphql/generated/gql/graphql";

/** Shared list-item fragment for the directory + create/update/delete refetches. */
const ADMIN_USER_LIST_ITEM_FIELDS = gql`
  fragment AdminUserListItemFields on AdminUserListItem {
    id
    fullName
    email
    phone
    role
    gender
    dateOfBirth
    country
    isDeleted
    suspended
    isBlocked
    lastActiveAt
    createdAt
    applicantStatus
    cooldownState
    cooldownUntil
    teacherIsApproved
    teacherIsEvaluator
    studentHasParentLink
    studentHasActiveSubscription
    parentLinkedChildrenCount
  }
`;

/** Shared detail fragment for the detail page + post-mutation refetches. */
const ADMIN_USER_DETAIL_FIELDS = gql`
  fragment AdminUserDetailFields on AdminUserDetail {
    id
    fullName
    email
    phone
    role
    dateOfBirth
    gender
    country
    isDeleted
    deletedAt
    suspended
    suspendedAt
    suspendedPeriodDays
    isBlocked
    blockedAt
    mustChangePassword
    lastActiveAt
    createdAt
    updatedAt
    applicant {
      id
      status
      verificationAttempts
      lastAttemptAt
      cooldownUntil
      cooldownState
      cooldownActive
      canPurchaseVerification
    }
    teacher {
      isApproved
      isEvaluator
      isOnline
      averageRating
    }
    student {
      handshakeCode
      parentId
      primaryLanguage
      anotherLanguage
      hasParentLink
      hasActiveSubscription
      balanceHifz
      balanceTajweed
      balanceReviews
      balanceTrial
      trialGrantedAt
    }
    parent {
      linkedChildrenCount
    }
  }
`;

/**
 * Post-write applicant-profile shape for the cooldown-extension mutation —
 * the full read model the detail card renders (id FIRST for Apollo cache
 * normalization into the SAME `ApplicantProfile:<id>` entry the detail
 * query's `applicant` field links to, so the card re-renders WITHOUT a
 * refetch).
 */
const ADMIN_APPLICANT_PROFILE_FIELDS = gql`
  fragment AdminApplicantProfileFields on ApplicantProfile {
    id
    status
    verificationAttempts
    lastAttemptAt
    cooldownUntil
    cooldownState
    cooldownActive
    canPurchaseVerification
  }
`;

/** Directory query — paginated, filterable. */
export const adminUsersQueryDocument: TypedDocumentNode<AdminUsersQuery> = gql`
  ${ADMIN_USER_LIST_ITEM_FIELDS}
  query AdminUsers($filters: AdminUserFiltersInput, $page: Int, $pageSize: Int) {
    adminUsers(filters: $filters, page: $page, pageSize: $pageSize) {
      items {
        ...AdminUserListItemFields
      }
      totalCount
      page
      pageSize
    }
  }
`;

/**
 * Overview-stats query — directory-wide aggregate counters (governance +
 * role + trailing-7-day signups) powering the clickable stat cards above
 * the directory table. Scalar-only envelope: no object selections, so no
 * `id` normalization requirement applies.
 */
export const adminUserStatsQueryDocument: TypedDocumentNode<AdminUserStatsQuery> = gql`
  query AdminUserStats {
    adminUserStats {
      totalCount
      activeCount
      suspendedCount
      blockedCount
      deletedCount
      adminsCount
      teachersCount
      studentsCount
      parentsCount
      newThisWeekCount
    }
  }
`;

/**
 * Applicant-cooldown lifecycle stats query — the admin dashboard lifecycle
 * panel's data source (`adminApplicantCooldownStats`). Scalar-only envelope:
 * no object selections, so no `id` normalization requirement applies. The
 * three counters share the server's canonical expiring-soon window with the
 * directory's `cooldownExpiringSoon` filter arm — the KPI and its
 * deep-linked listing cannot disagree.
 */
export const adminApplicantCooldownStatsQueryDocument: TypedDocumentNode<AdminApplicantCooldownStatsQuery> = gql`
  query AdminApplicantCooldownStats {
    adminApplicantCooldownStats {
      activeCount
      expiringSoonCount
      expiredCount
      expiringSoonWindowDays
    }
  }
`;

/**
 * "Users by country" distribution query — the admin directory facet's
 * data source (`adminUserCountryBreakdown`). The server resolves each
 * bucket's LOCALE display label + flag from the shared dataset and owns
 * the top-N window (`limit` clamps server-side 1..12, default 6), so the
 * client renders chips whose copy matches the directory's country chips
 * and the broadcast audience summary. `unresolvedCount` is the honest
 * remainder (NULL-code legacy/never-set rows + out-of-vocabulary codes).
 * Scalar-only envelope: no `id` normalization requirement applies.
 */
export const adminUserCountryBreakdownQueryDocument: TypedDocumentNode<
  AdminUserCountryBreakdownQuery,
  AdminUserCountryBreakdownQueryVariables
> = gql`
  query AdminUserCountryBreakdown($limit: Int) {
    adminUserCountryBreakdown(limit: $limit) {
      buckets {
        code
        label
        flag
        count
      }
      unresolvedCount
    }
  }
`;

/** Single-user detail query. */
export const adminUserDetailQueryDocument: TypedDocumentNode<AdminUserDetailQuery> = gql`
  ${ADMIN_USER_DETAIL_FIELDS}
  query AdminUserDetail($id: Int!) {
    adminUserDetail(id: $id) {
      ...AdminUserDetailFields
    }
  }
`;

/**
 * Per-user activity-timeline query — scoped `audit_logs` read-back
 * (actions recorded ABOUT this user — account rows plus the user's
 * teacher-applicant lifecycle rows — newest-first). `entityType`
 * discriminates the mixed feed so the timeline can tag applicant entries;
 * `caption` is the server-composed localized payload rendering for those
 * rows. `id` selected FIRST per the Apollo cache-normalization rule; the
 * raw `details` JSON is never selected — only the defensively projected
 * `changedFields` list and the composed caption.
 */
export const adminUserActivityQueryDocument: TypedDocumentNode<
  AdminUserActivityQuery,
  AdminUserActivityQueryVariables
> = gql`
  query AdminUserActivity($id: Int!, $limit: Int) {
    adminUserActivity(id: $id, limit: $limit) {
      id
      actionType
      entityType
      caption
      actorName
      changedFields
      createdAt
    }
  }
`;

/** Create-user mutation — returns the new user's detail. */
export const adminCreateUserMutationDocument: TypedDocumentNode<AdminCreateUserMutation> = gql`
  ${ADMIN_USER_DETAIL_FIELDS}
  mutation AdminCreateUser($input: AdminCreateUserInput!) {
    adminCreateUser(input: $input) {
      ...AdminUserDetailFields
    }
  }
`;

/** Whitelist profile-patch mutation — returns the post-write detail. */
export const adminUpdateUserMutationDocument: TypedDocumentNode<AdminUpdateUserMutation> = gql`
  ${ADMIN_USER_DETAIL_FIELDS}
  mutation AdminUpdateUser($id: Int!, $input: AdminUpdateUserInput!) {
    adminUpdateUser(id: $id, input: $input) {
      ...AdminUserDetailFields
    }
  }
`;

/**
 * Credential-set mutation — the admin sets a user's password and may flag it
 * for a forced change on next login. Returns the post-write detail (the
 * `mustChangePassword` selection rides the shared detail fragment), which
 * Apollo merges into the `AdminUserDetail:<id>` normalized entity so the
 * detail surface re-renders the pending-reset state without a refetch.
 */
export const adminSetUserPasswordMutationDocument: TypedDocumentNode<
  AdminSetUserPasswordMutation,
  AdminSetUserPasswordMutationVariables
> = gql`
  ${ADMIN_USER_DETAIL_FIELDS}
  mutation AdminSetUserPassword($id: Int!, $input: AdminSetUserPasswordInput!) {
    adminSetUserPassword(id: $id, input: $input) {
      ...AdminUserDetailFields
    }
  }
`;

/** Soft-delete / reactivate mutation — returns the post-write detail. */
export const adminSetUserDeletedMutationDocument: TypedDocumentNode<AdminSetUserDeletedMutation> = gql`
  ${ADMIN_USER_DETAIL_FIELDS}
  mutation AdminSetUserDeleted($id: Int!, $deleted: Boolean!) {
    adminSetUserDeleted(id: $id, deleted: $deleted) {
      ...AdminUserDetailFields
    }
  }
`;

/** Suspend / unsuspend mutation — returns the post-write detail. */
export const adminSetUserSuspendedMutationDocument: TypedDocumentNode<
  AdminSetUserSuspendedMutation,
  AdminSetUserSuspendedMutationVariables
> = gql`
  ${ADMIN_USER_DETAIL_FIELDS}
  mutation AdminSetUserSuspended($id: Int!, $suspended: Boolean!, $periodDays: Int) {
    adminSetUserSuspended(id: $id, suspended: $suspended, periodDays: $periodDays) {
      ...AdminUserDetailFields
    }
  }
`;

/**
 * Applicant-cooldown extension mutation — returns the post-write applicant
 * profile (lengthen-only expiry recomputed server-side; the actor is derived
 * from the authenticated caller, never threaded from the client).
 */
export const adminExtendApplicantCooldownMutationDocument: TypedDocumentNode<
  AdminExtendApplicantCooldownMutation,
  AdminExtendApplicantCooldownMutationVariables
> = gql`
  ${ADMIN_APPLICANT_PROFILE_FIELDS}
  mutation AdminExtendApplicantCooldown($applicantId: Int!, $additionalDays: Int!) {
    adminExtendApplicantCooldown(applicantId: $applicantId, additionalDays: $additionalDays) {
      ...AdminApplicantProfileFields
    }
  }
`;

/**
 * Applicant-evaluation override mutation — the admin composition of the
 * three override directions (certify / grant re-evaluation / reject) over
 * one wire enum. Returns the post-write applicant profile (same shape as
 * the cooldown-extension mutation, same id-first cache-merge discipline).
 * `cooldownDays` is REQUIRED for the reject direction only — validated
 * server-side; certify / grant_re_evaluation ignore it, so it is declared
 * OPTIONAL here (the `adminSetUserSuspended` `periodDays` precedent).
 * The actor is always derived server-side from the authenticated caller.
 */
export const adminOverrideApplicantEvaluationMutationDocument: TypedDocumentNode<
  AdminOverrideApplicantEvaluationMutation,
  AdminOverrideApplicantEvaluationMutationVariables
> = gql`
  ${ADMIN_APPLICANT_PROFILE_FIELDS}
  mutation AdminOverrideApplicantEvaluation(
    $applicantId: Int!
    $action: AdminApplicantOverrideAction!
    $cooldownDays: Int
  ) {
    adminOverrideApplicantEvaluation(applicantId: $applicantId, action: $action, cooldownDays: $cooldownDays) {
      ...AdminApplicantProfileFields
    }
  }
`;

/** Block / unblock mutation — returns the post-write detail. */
export const adminSetUserBlockedMutationDocument: TypedDocumentNode<
  AdminSetUserBlockedMutation,
  AdminSetUserBlockedMutationVariables
> = gql`
  ${ADMIN_USER_DETAIL_FIELDS}
  mutation AdminSetUserBlocked($id: Int!, $blocked: Boolean!) {
    adminSetUserBlocked(id: $id, blocked: $blocked) {
      ...AdminUserDetailFields
    }
  }
`;
