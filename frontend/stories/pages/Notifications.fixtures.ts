import type { MockLink } from "@apollo/client/testing";
import {
  type MyNotificationsFilterInput,
  type MyNotificationsQuery_myNotifications_items,
  NotificationType,
} from "@/frontend/graphql/generated/gql/graphql";
import {
  markAllNotificationsReadMutationDocument,
  markNotificationReadMutationDocument,
  myNotificationsQueryDocument,
  myUnreadNotificationCountQueryDocument,
} from "@/frontend/graphql/sharedDocuments";
import { NOTIFICATIONS_PAGE_SIZE } from "@/frontend/views/notifications";

/**
 * Fixtures for the `Pages/Notifications` story — the `/notifications` inbox
 * feed page (`NotificationsFeedContainer`), NOT the app-bar drawer. Rewrites
 * the drawer-story fixture shapes (`NotificationDrawer.stories.tsx`) against
 * the page's own window: the feed queries `limit: NOTIFICATIONS_PAGE_SIZE`
 * (20) instead of the drawer's 5-row popover window, and reads the same
 * unread-count query the drawer badge drives.
 *
 * All mocks are `maxUsageCount: Infinity` — MockLink consumes mocks in order
 * by default, and both the 120s unread-count poll and the post-sweep
 * refetches reuse the same documents.
 */

/** Default feed window — mirrors the initial filter state of `useNotificationsFeedFilters`. */
const PAGE_WINDOW: MyNotificationsFilterInput = { isRead: null, type: null, limit: NOTIFICATIONS_PAGE_SIZE, offset: 0 };

type NotificationItemFixture = MyNotificationsQuery_myNotifications_items & {
  readonly __typename: "Notification";
};

/** Deterministic fixture row (all eight public fields + `__typename`). */
function feedRow(overrides: Partial<NotificationItemFixture>): NotificationItemFixture {
  return {
    __typename: "Notification",
    id: "301",
    type: NotificationType.SessionRequest,
    title: "New Session Request",
    body: "Yusuf A. requested a Tajweed evaluation session for tomorrow.",
    isRead: false,
    relatedEntityType: null,
    relatedEntityId: null,
    createdAt: "2026-08-30T12:00:00.000Z",
    ...overrides,
  };
}

/** Mixed read/unread inbox — six rows, three unread. */
const FEED_ROWS: readonly NotificationItemFixture[] = [
  feedRow({
    id: "301",
    type: NotificationType.SessionRequest,
    title: "New Session Request",
    body: "Yusuf A. requested a Tajweed evaluation session for tomorrow.",
    createdAt: "2026-08-30T12:00:00.000Z",
  }),
  feedRow({
    id: "302",
    type: NotificationType.PaymentConfirmation,
    title: "Payment Received",
    body: "Monthly tuition fee successfully processed for Aisha M. The receipt is attached to her account ledger for this billing cycle.",
    createdAt: "2026-08-30T09:30:00.000Z",
  }),
  feedRow({
    id: "303",
    type: NotificationType.SystemBroadcast,
    title: "Ramadan Schedule Update",
    body: "Admin posted new guidelines for managing classes during the holy month.",
    createdAt: "2026-08-29T18:15:00.000Z",
  }),
  feedRow({
    id: "304",
    type: NotificationType.EvaluationResult,
    title: "Evaluation Completed",
    body: "Fatima Z.'s recitation evaluation results are ready for review.",
    isRead: true,
    createdAt: "2026-08-28T14:45:00.000Z",
  }),
  feedRow({
    id: "305",
    type: NotificationType.SessionCompletion,
    title: "Session Completed",
    body: "Omar K.'s Tajweed mastery session was completed. Review the session notes and assign follow-up practice.",
    isRead: true,
    createdAt: "2026-08-27T11:00:00.000Z",
  }),
  feedRow({
    id: "306",
    type: NotificationType.SessionCancellation,
    title: "Session Cancelled",
    body: "The Hifz revision session scheduled for tonight was cancelled by the teacher.",
    isRead: true,
    createdAt: "2026-08-26T16:20:00.000Z",
  }),
];

/** Reusable list mock for the page window (tolerates poll/refetch replays). */
function listMock(rows: readonly NotificationItemFixture[]): MockLink.MockedResponse {
  return {
    request: { query: myNotificationsQueryDocument, variables: { filter: PAGE_WINDOW } },
    result: {
      data: {
        myNotifications: {
          __typename: "NotificationListPage",
          items: [...rows],
          totalCount: rows.length,
          hasMore: false,
        },
      },
    },
    maxUsageCount: Number.POSITIVE_INFINITY,
  };
}

/** Reusable unread-count mock (tolerates the 120s poll). */
function countMock(count: number): MockLink.MockedResponse {
  return {
    request: { query: myUnreadNotificationCountQueryDocument },
    result: { data: { myUnreadNotificationCount: count } },
    maxUsageCount: Number.POSITIVE_INFINITY,
  };
}

/** Mark-one mocks so row clicks stay interactive for every fixture row. */
function markOneMocks(): MockLink.MockedResponse[] {
  return FEED_ROWS.map(row => ({
    request: { query: markNotificationReadMutationDocument, variables: { id: row.id } },
    result: { data: { markNotificationRead: { ...row, isRead: true } } },
    maxUsageCount: Number.POSITIVE_INFINITY,
  }));
}

/** Default variant mocks: rows + badge count + mark-one + mark-all sweep. */
export function interactiveMocks(): MockLink.MockedResponse[] {
  return [
    countMock(3),
    listMock(FEED_ROWS),
    ...markOneMocks(),
    {
      request: { query: markAllNotificationsReadMutationDocument, variables: { type: null } },
      result: { data: { markAllNotificationsRead: 3 } },
      maxUsageCount: Number.POSITIVE_INFINITY,
    },
  ];
}

/** Empty-inbox mocks — the translated empty branch. */
export function emptyMocks(): MockLink.MockedResponse[] {
  return [countMock(0), listMock([])];
}

/** Loading mocks — the list query never resolves (skeleton branch). */
export function loadingMocks(): MockLink.MockedResponse[] {
  return [
    countMock(0),
    {
      request: { query: myNotificationsQueryDocument, variables: { filter: PAGE_WINDOW } },
      result: {
        data: { myNotifications: { __typename: "NotificationListPage", items: [], totalCount: 0, hasMore: false } },
      },
      delay: Number.POSITIVE_INFINITY,
      maxUsageCount: Number.POSITIVE_INFINITY,
    },
  ];
}
