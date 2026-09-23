import type { MockLink } from "@apollo/client/testing";
import { SessionStatus, SubscriptionStatus } from "@/frontend/graphql/generated/gql/graphql";
import {
  adminUserStatsQueryDocument,
  myLinkedChildrenQueryDocument,
  myStudentSessionsQueryDocument,
  mySubscriptionsQueryDocument,
  myTeacherSessionsQueryDocument,
  myUnreadNotificationCountQueryDocument,
  myWalletQueryDocument,
  parentChildReportsQueryDocument,
  parentChildSessionsQueryDocument,
} from "@/frontend/graphql/sharedDocuments";

/**
 * Story fixtures for the dashboard stat strip (`DashboardView`'s
 * `useDashboardStats` queries) — one builder per role, every mock
 * `maxUsageCount: Infinity` so React re-mounts stay green (the established
 * dashboard-story convention).
 *
 * Envelope fixtures carry `items: []` with an honest `totalCount`: the
 * stat hook reads ONLY the page envelope's count, and empty item lists
 * keep the fixtures minimal without weakening what the cards render.
 */

/** The `pageSize: 1` count window — must mirror the hook's variables exactly. */
const COUNT_PAGE_SIZE = 1;

/** Answers the shared unread-notification count the app-bar badge also observes. */
export function unreadCountMock(count: number): MockLink.MockedResponse {
  return {
    request: { query: myUnreadNotificationCountQueryDocument },
    result: { data: { myUnreadNotificationCount: count } },
    maxUsageCount: Number.POSITIVE_INFINITY,
  };
}

/** Answers one status-filtered own-sessions count envelope (student or teacher side). */
function sessionsCountMock(
  document: typeof myStudentSessionsQueryDocument | typeof myTeacherSessionsQueryDocument,
  fieldName: "myStudentSessions" | "myTeacherSessions",
  status: SessionStatus,
  totalCount: number
): MockLink.MockedResponse {
  return {
    request: { query: document, variables: { filter: { status }, page: 1, pageSize: COUNT_PAGE_SIZE } },
    result: {
      data: {
        [fieldName]: { __typename: "SessionPage", items: [], page: 1, pageSize: COUNT_PAGE_SIZE, totalCount },
      },
    },
    maxUsageCount: Number.POSITIVE_INFINITY,
  };
}

/** Full student stat mock set — completed/upcoming counts, subscription rows, unread count. */
export function studentStatsMocks(stats: {
  readonly completed: number;
  readonly upcoming: number;
  readonly activeSubscriptions: number;
  readonly unread: number;
}): MockLink.MockedResponse[] {
  return [
    sessionsCountMock(myStudentSessionsQueryDocument, "myStudentSessions", SessionStatus.Completed, stats.completed),
    sessionsCountMock(myStudentSessionsQueryDocument, "myStudentSessions", SessionStatus.Scheduled, stats.upcoming),
    {
      request: { query: mySubscriptionsQueryDocument },
      result: {
        data: {
          mySubscriptions: Array.from({ length: stats.activeSubscriptions }, (_value, index) => ({
            __typename: "StudentSubscription",
            id: index + 1,
            planId: 1,
            plan: { __typename: "Plan", id: 1, title: "Hifz Plan" },
            status: SubscriptionStatus.Active,
            startDate: "2026-01-01T00:00:00Z",
            endDate: "2026-02-01T00:00:00Z",
            paymentMethod: null,
            paymentReference: null,
            paymentVerifiedAt: null,
            createdAt: "2026-01-01T00:00:00Z",
            updatedAt: "2026-01-01T00:00:00Z",
          })),
        },
      },
      maxUsageCount: Number.POSITIVE_INFINITY,
    },
    unreadCountMock(stats.unread),
  ];
}

/** Full teacher stat mock set — completed/upcoming counts, wallet balance, unread count. */
export function teacherStatsMocks(stats: {
  readonly completed: number;
  readonly upcoming: number;
  readonly balance: string;
  readonly unread: number;
}): MockLink.MockedResponse[] {
  return [
    sessionsCountMock(myTeacherSessionsQueryDocument, "myTeacherSessions", SessionStatus.Completed, stats.completed),
    sessionsCountMock(myTeacherSessionsQueryDocument, "myTeacherSessions", SessionStatus.Scheduled, stats.upcoming),
    {
      request: { query: myWalletQueryDocument },
      result: {
        data: {
          myWallet: {
            __typename: "Wallet",
            id: 77,
            balance: stats.balance,
            totalEarning: stats.balance,
            currency: "EGP",
            createdAt: "2026-01-01T00:00:00Z",
            updatedAt: "2026-01-01T00:00:00Z",
            transactions: [],
          },
        },
      },
      maxUsageCount: Number.POSITIVE_INFINITY,
    },
    unreadCountMock(stats.unread),
  ];
}

/** One linked-child aggregate fixture — envelope counts per child. */
export interface ParentChildStatFixture {
  readonly id: number;
  readonly fullName: string;
  readonly reportsTotal: number;
  readonly sessionsTotal: number;
}

/** Full parent stat mock set — linked children, per-child envelope counts, unread count. */
export function parentStatsMocks(stats: {
  readonly children: readonly ParentChildStatFixture[];
  readonly unread: number;
}): MockLink.MockedResponse[] {
  return [
    {
      request: { query: myLinkedChildrenQueryDocument },
      result: {
        data: {
          myLinkedChildren: stats.children.map(child => ({
            __typename: "ParentLinkedChild",
            id: child.id,
            fullName: child.fullName,
            createdAt: "2026-01-01T00:00:00Z",
          })),
        },
      },
      maxUsageCount: Number.POSITIVE_INFINITY,
    },
    ...stats.children.flatMap(child => [
      {
        request: {
          query: parentChildReportsQueryDocument,
          variables: { studentId: child.id, page: 1, pageSize: COUNT_PAGE_SIZE },
        },
        result: {
          data: {
            parentChildReports: {
              __typename: "ParentReportPage",
              items: [],
              page: 1,
              pageSize: COUNT_PAGE_SIZE,
              totalCount: child.reportsTotal,
            },
          },
        },
        maxUsageCount: Number.POSITIVE_INFINITY,
      },
      {
        request: {
          query: parentChildSessionsQueryDocument,
          variables: { studentId: child.id, page: 1, pageSize: COUNT_PAGE_SIZE },
        },
        result: {
          data: {
            parentChildSessions: {
              __typename: "ParentAttendancePage",
              items: [],
              page: 1,
              pageSize: COUNT_PAGE_SIZE,
              totalCount: child.sessionsTotal,
            },
          },
        },
        maxUsageCount: Number.POSITIVE_INFINITY,
      },
    ]),
    unreadCountMock(stats.unread),
  ];
}

/** Full admin stat mock set — the platform account mix + unread count. */
export function adminStatsMocks(stats: {
  readonly totalUsers: number;
  readonly teachers: number;
  readonly students: number;
  readonly unread: number;
}): MockLink.MockedResponse[] {
  return [
    {
      request: { query: adminUserStatsQueryDocument },
      result: {
        data: {
          adminUserStats: {
            __typename: "AdminUserStats",
            totalCount: stats.totalUsers,
            activeCount: stats.totalUsers,
            suspendedCount: 0,
            blockedCount: 0,
            deletedCount: 0,
            adminsCount: 1,
            teachersCount: stats.teachers,
            studentsCount: stats.students,
            parentsCount: 0,
            newThisWeekCount: 0,
          },
        },
      },
      maxUsageCount: Number.POSITIVE_INFINITY,
    },
    unreadCountMock(stats.unread),
  ];
}
