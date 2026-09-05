import type { MockLink } from "@apollo/client/testing";
import {
  type AdminUserActivityQuery_adminUserActivity,
  type AdminUserDetailFieldsFragment_applicant,
  type AdminUserDetailFieldsFragment_teacher,
  type AdminUserDetailQuery_adminUserDetail,
  ApplicantStatus,
  AuditActionType,
  Gender,
  UserRole,
} from "@/frontend/graphql/generated/gql/graphql";
import {
  adminCertifyTeacherColdStartMutationDocument,
  adminUserActivityQueryDocument,
  adminUserDetailQueryDocument,
} from "@/frontend/graphql/sharedDocuments/admin";
import { ACTIVITY_TIMELINE_LIMIT } from "@/frontend/views/admin/users/utils";

/**
 * Fixtures + MockLink factory functions for the `Pages/Admin/User Detail`
 * story (`AdminUserDetailContainer`). Shapes mirror the generated codegen
 * types (`AdminUserDetailQuery_adminUserDetail`,
 * `AdminUserActivityQuery_adminUserActivity`) with `__typename` on every
 * object so Apollo's MockLink responses normalize exactly like the real
 * gateway payloads (`AdminUserDetail` / `ApplicantProfile` /
 * `AdminTeacherSnapshot` / `AdminUserActivityEntry` are the real Pothos
 * object names).
 */

/** Story user id — the mock variables and the harness `userId` prop agree. */
export const DETAIL_USER_ID = 7;

type ApplicantFixture = AdminUserDetailFieldsFragment_applicant & {
  readonly __typename: "ApplicantProfile";
};

type TeacherFixture = AdminUserDetailFieldsFragment_teacher & {
  readonly __typename: "AdminTeacherSnapshot";
};

type DetailUserFixture = Omit<AdminUserDetailQuery_adminUserDetail, "applicant" | "teacher"> & {
  readonly __typename: "AdminUserDetail";
  readonly applicant: ApplicantFixture | null;
  readonly teacher: TeacherFixture | null;
};

type ActivityEntryFixture = AdminUserActivityQuery_adminUserActivity & {
  readonly __typename: "AdminUserActivityEntry";
};

/** Baseline identity + governance fields shared by both user variants. */
function detailUser(roleSlices: Pick<DetailUserFixture, "applicant" | "teacher">): DetailUserFixture {
  return {
    __typename: "AdminUserDetail",
    id: DETAIL_USER_ID,
    fullName: "Yusuf Al-Amin",
    email: "yusuf.alamin@example.com",
    phone: "+201001234567",
    role: UserRole.Teacher,
    dateOfBirth: "1990-04-12",
    gender: Gender.Male,
    country: "Egypt",
    isDeleted: false,
    deletedAt: null,
    suspended: false,
    suspendedAt: null,
    suspendedPeriodDays: null,
    isBlocked: false,
    blockedAt: null,
    lastActiveAt: "2026-08-30T09:41:00.000Z",
    createdAt: "2026-08-01T10:00:00.000Z",
    updatedAt: "2026-08-28T15:22:00.000Z",
    student: null,
    parent: null,
    ...roleSlices,
  };
}

/** Uncertified teacher applicant — the Certify hero button is visible. */
export const PENDING_TEACHER_USER: DetailUserFixture = detailUser({
  applicant: {
    __typename: "ApplicantProfile",
    id: 11,
    status: ApplicantStatus.Pending,
    verificationAttempts: 1,
    lastAttemptAt: "2026-08-12T14:05:00.000Z",
    cooldownUntil: null,
    cooldownActive: false,
    canPurchaseVerification: true,
  },
  teacher: {
    __typename: "AdminTeacherSnapshot",
    isApproved: false,
    isEvaluator: false,
    isOnline: false,
    averageRating: null,
  },
});

/** Certified teacher evaluator — the Certify hero button is hidden. */
export const CERTIFIED_TEACHER_USER: DetailUserFixture = detailUser({
  applicant: {
    __typename: "ApplicantProfile",
    id: 11,
    status: ApplicantStatus.Passed,
    verificationAttempts: 2,
    lastAttemptAt: "2026-08-10T09:00:00.000Z",
    cooldownUntil: null,
    cooldownActive: false,
    canPurchaseVerification: false,
  },
  teacher: {
    __typename: "AdminTeacherSnapshot",
    isApproved: true,
    isEvaluator: true,
    isOnline: true,
    averageRating: "4.9",
  },
});

/** Two-row activity timeline so `RecentActivityCard` renders populated. */
export const ACTIVITY_ENTRIES: readonly ActivityEntryFixture[] = [
  {
    __typename: "AdminUserActivityEntry",
    id: 502,
    actionType: AuditActionType.Update,
    actorName: "Amina Al-Rashid",
    changedFields: ["fullName", "phone"],
    createdAt: "2026-08-20T11:15:00.000Z",
  },
  {
    __typename: "AdminUserActivityEntry",
    id: 501,
    actionType: AuditActionType.Create,
    actorName: "Amina Al-Rashid",
    changedFields: null,
    createdAt: "2026-08-01T10:00:00.000Z",
  },
];

/** Resolving `adminUserDetail` mock for the given fixture row. */
export function detailMock(user: DetailUserFixture): MockLink.MockedResponse {
  return {
    request: { query: adminUserDetailQueryDocument, variables: { id: DETAIL_USER_ID } },
    result: { data: { adminUserDetail: user } },
    maxUsageCount: Number.POSITIVE_INFINITY,
  };
}

/** Resolving `adminUserActivity` mock with the populated two-row timeline. */
export function activityMock(): MockLink.MockedResponse {
  return {
    request: {
      query: adminUserActivityQueryDocument,
      variables: { id: DETAIL_USER_ID, limit: ACTIVITY_TIMELINE_LIMIT },
    },
    result: { data: { adminUserActivity: [...ACTIVITY_ENTRIES] } },
    maxUsageCount: Number.POSITIVE_INFINITY,
  };
}

/**
 * Successful cold-start certification against the PENDING_TEACHER_USER row
 * (`makeEvaluator: true` — the mutation default the dialog pre-checks). The
 * post-write payload merges into the `AdminUserDetail:7` normalized entity
 * in the story's cache, so confirming flips the hero without a refetch.
 */
export const CERTIFY_SUCCESS_MOCK: MockLink.MockedResponse = {
  request: {
    query: adminCertifyTeacherColdStartMutationDocument,
    variables: { userId: DETAIL_USER_ID, makeEvaluator: true },
  },
  result: {
    data: {
      adminCertifyTeacherColdStart: {
        __typename: "AdminUserDetail",
        id: DETAIL_USER_ID,
        role: UserRole.Teacher,
        isDeleted: false,
        suspended: false,
        isBlocked: false,
        applicant: { __typename: "ApplicantProfile", id: 11, status: ApplicantStatus.Passed },
        teacher: {
          __typename: "AdminTeacherSnapshot",
          isApproved: true,
          isEvaluator: true,
          isOnline: false,
          averageRating: null,
        },
      },
    },
  },
  maxUsageCount: Number.POSITIVE_INFINITY,
};

/** Never-resolving queries — the `UserDetailLoading` skeleton branch. */
export const LOADING_MOCKS: readonly MockLink.MockedResponse[] = [
  {
    request: { query: adminUserDetailQueryDocument, variables: { id: DETAIL_USER_ID } },
    result: { data: { adminUserDetail: null } },
    delay: Number.POSITIVE_INFINITY,
    maxUsageCount: Number.POSITIVE_INFINITY,
  },
  {
    request: {
      query: adminUserActivityQueryDocument,
      variables: { id: DETAIL_USER_ID, limit: ACTIVITY_TIMELINE_LIMIT },
    },
    result: { data: { adminUserActivity: [] } },
    delay: Number.POSITIVE_INFINITY,
    maxUsageCount: Number.POSITIVE_INFINITY,
  },
];
