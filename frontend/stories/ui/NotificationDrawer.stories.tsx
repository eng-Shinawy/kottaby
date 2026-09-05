import { ApolloClient } from "@apollo/client";
import { ApolloProvider } from "@apollo/client/react";
import { MockLink } from "@apollo/client/testing";
import { NotificationsOutlined } from "@mui/icons-material";
import { Badge, Box, IconButton } from "@mui/material";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { type ReactNode, useState } from "react";
import { NotificationDrawer } from "@/frontend/components/ui/NotificationDrawer";
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
import { createApolloCache } from "@/frontend/providers/apollo/apolloCache";

/**
 * Storybook surface for `NotificationDrawer` — the app-bar bell popover.
 *
 * First GraphQL-backed story in this repo: mocks ride a real `ApolloClient`
 * on `MockLink` + the production `createApolloCache()` (the component-test
 * pattern), so the drawer exercises its real query/mutation/cache behavior.
 * All mocks are `maxUsageCount: Infinity` — MockLink consumes mocks in order
 * by default, and every drawer re-open (skip → watch) fetches again.
 */

/** Drawer inbox window — mirrors `DRAWER_PAGE_SIZE` in the component. */
const DRAWER_WINDOW: MyNotificationsFilterInput = { isRead: null, type: null, limit: 5, offset: 0 };

type NotificationItemFixture = MyNotificationsQuery_myNotifications_items & {
  readonly __typename: "Notification";
};

/** Deterministic fixture row (all eight public fields + `__typename`). */
function drawerRow(overrides?: Partial<NotificationItemFixture>): NotificationItemFixture {
  return {
    __typename: "Notification",
    id: "201",
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

const POPULATED_ROWS: readonly NotificationItemFixture[] = [
  drawerRow(),
  drawerRow({
    id: "202",
    type: NotificationType.PaymentConfirmation,
    title: "Payment Received",
    body: "Monthly tuition fee successfully processed for Aisha M. The receipt is attached to her account ledger for this billing cycle.",
  }),
  drawerRow({
    id: "203",
    type: NotificationType.SystemBroadcast,
    title: "Ramadan Schedule Update",
    body: "Admin posted new guidelines for managing classes during the holy month.",
  }),
  drawerRow({
    id: "204",
    type: NotificationType.SessionCancellation,
    title: "Session Cancelled",
    body: null,
    isRead: true,
  }),
];

/** Reusable mock — the drawer re-fetches on every open. */
function listMock(rows: readonly NotificationItemFixture[]): MockLink.MockedResponse {
  return {
    request: { query: myNotificationsQueryDocument, variables: { filter: DRAWER_WINDOW } },
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

/** Reusable unread-count mock. */
function countMock(count: number): MockLink.MockedResponse {
  return {
    request: { query: myUnreadNotificationCountQueryDocument },
    result: { data: { myUnreadNotificationCount: count } },
    maxUsageCount: Number.POSITIVE_INFINITY,
  };
}

/** Mark-one mocks so row clicks stay interactive for every fixture row (isRead read-back flips). */
function markOneMocks(): MockLink.MockedResponse[] {
  return POPULATED_ROWS.map(row => ({
    request: { query: markNotificationReadMutationDocument, variables: { id: row.id } },
    result: { data: { markNotificationRead: { ...row, isRead: true } } },
    maxUsageCount: Number.POSITIVE_INFINITY,
  }));
}

/** Interactive mocks: rows + count + mark-one + mark-all (read-back keeps the refetches green). */
function interactiveMocks(): MockLink.MockedResponse[] {
  return [
    countMock(3),
    listMock(POPULATED_ROWS),
    ...markOneMocks(),
    {
      request: { query: markAllNotificationsReadMutationDocument, variables: { type: null } },
      result: { data: { markAllNotificationsRead: 3 } },
      maxUsageCount: Number.POSITIVE_INFINITY,
    },
  ];
}

/**
 * Mock app-bar strip with the bell as the popover anchor, open by default —
 * mirrors how `NotificationUnreadBadge` hosts the drawer in the real shell:
 * the strip pins to the canvas TOP-EDGE full width and the bell sits at the
 * end side (right in LTR, left in RTL), so the popover hangs beneath it
 * exactly like the real app bar. Click the bell to re-open after close;
 * click-away / Escape closes.
 */
function DrawerHarness({
  mocks,
  badgeCount,
}: Readonly<{ mocks: MockLink.MockedResponse[]; badgeCount: number }>): ReactNode {
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const [open, setOpen] = useState(true);
  const [client] = useState(
    () =>
      new ApolloClient({
        link: new MockLink([...mocks]),
        cache: createApolloCache(),
        defaultOptions: { query: { errorPolicy: "none" } },
      })
  );

  return (
    <ApolloProvider client={client}>
      <Box
        sx={theme => ({
          position: "fixed",
          top: 0,
          insetInline: 0,
          display: "flex",
          justifyContent: "flex-end",
          alignItems: "center",
          backgroundColor: theme.palette.background.paper,
          borderBottom: `1px solid ${theme.palette.divider}`,
          px: 2,
          py: 1,
        })}
      >
        <IconButton aria-label="Toggle notification drawer" onClick={() => setOpen(true)} ref={setAnchorEl}>
          <Badge badgeContent={badgeCount} color="error" max={99}>
            <NotificationsOutlined />
          </Badge>
        </IconButton>
        {/* Stand-in for the real app bar's user chip — keeps the panel from
            kissing the canvas edge exactly like the production layout. */}
        <Box
          aria-hidden
          sx={theme => ({
            width: 32,
            height: 32,
            borderRadius: "50%",
            bgcolor: theme.palette.action.selected,
            mx: 0.5,
          })}
        />
      </Box>
      <NotificationDrawer anchorEl={anchorEl} open={open} onClose={() => setOpen(false)} />
    </ApolloProvider>
  );
}

const meta = {
  title: "UI/NotificationDrawer",
  component: DrawerHarness,
  parameters: {
    layout: "fullscreen",
    controls: { exclude: ["mocks", "badgeCount"] },
  },
  tags: ["autodocs"],
} satisfies Meta<typeof DrawerHarness>;

export default meta;
type Story = StoryObj<typeof meta>;

// All-read variant — Object.assign per oxlint `no-map-spread` (no per-row spread).
const ALL_READ_ROWS: readonly NotificationItemFixture[] = POPULATED_ROWS.map(row =>
  Object.assign({}, row, { isRead: true })
);

/** Mixed read/unread inbox — the primary surface (bell badge 3, one read row). */
export const Populated: Story = {
  args: { mocks: interactiveMocks(), badgeCount: 3 },
};

/** Every row read — no unread dots, mark-all affordance disabled. */
export const AllRead: Story = {
  args: { badgeCount: 0, mocks: [countMock(0), listMock(ALL_READ_ROWS)] },
};

/** Empty inbox — translated empty title/body. */
export const Empty: Story = {
  args: { badgeCount: 0, mocks: [countMock(0), listMock([])] },
};

/** Never-resolving list fetch — the skeleton branch. */
export const Loading: Story = {
  args: {
    badgeCount: 0,
    mocks: [
      countMock(0),
      {
        request: { query: myNotificationsQueryDocument, variables: { filter: DRAWER_WINDOW } },
        result: {
          data: { myNotifications: { __typename: "NotificationListPage", items: [], totalCount: 0, hasMore: false } },
        },
        delay: Number.POSITIVE_INFINITY,
        maxUsageCount: Number.POSITIVE_INFINITY,
      },
    ],
  },
};

/** Transport failure — the translated error + retry branch. */
export const LoadError: Story = {
  args: {
    badgeCount: 0,
    mocks: [
      countMock(0),
      {
        request: { query: myNotificationsQueryDocument, variables: { filter: DRAWER_WINDOW } },
        error: new Error("mocked transport failure"),
        maxUsageCount: Number.POSITIVE_INFINITY,
      },
    ],
  },
};
