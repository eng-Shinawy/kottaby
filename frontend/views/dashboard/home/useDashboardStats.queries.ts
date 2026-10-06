"use client";

import { skipToken, useQuery } from "@apollo/client/react";
import { useMemo } from "react";
import { SessionStatus } from "@/frontend/graphql/generated/gql/graphql";
import {
  adminUserStatsQueryDocument,
  myLinkedChildrenQueryDocument,
  mySessionBalanceQueryDocument,
  myStudentSessionsQueryDocument,
  mySubscriptionsQueryDocument,
  myTeacherSessionsQueryDocument,
  myUnreadNotificationCountQueryDocument,
  myWalletQueryDocument,
} from "@/frontend/graphql/sharedDocuments";
import {
  type ParentAggregateState,
  useParentChildAggregates,
} from "@/frontend/views/dashboard/home/useDashboardStats.parts";

/**
 * `pageSize: 1` window for the status-filtered session count queries and
 * the per-child parent pages — the page ENVELOPE carries the honest
 * `totalCount`, so the single row is throwaway payload kept only because
 * the shared documents select it.
 */
export const COUNT_PAGE_SIZE = 1;

/**
 * The role-scoped stat observers, bundled — wiring extracted from the
 * main hook so each role's queries stay grouped and the main hook reads
 * as composition only. Every observer skips unless the viewer's role owns
 * it, so a role change activates its own queries and retires the others.
 */
export interface RoleStatQueries {
  readonly unread: MyUnreadNotificationCountQueryResult;
  readonly studentCompleted: MyStudentSessionsQueryResult;
  readonly studentUpcoming: MyStudentSessionsQueryResult;
  readonly studentSubscriptions: MySubscriptionsQueryResult;
  readonly studentSessionBalance: MySessionBalanceQueryResult;
  readonly teacherCompleted: MyTeacherSessionsQueryResult;
  readonly teacherUpcoming: MyTeacherSessionsQueryResult;
  readonly teacherWallet: MyWalletQueryResult;
  readonly parentChildren: MyLinkedChildrenQueryResult;
  readonly parentAggregate: ParentAggregateState;
  readonly adminUserStats: AdminUserStatsQueryResult;
}

// Apollo v4 result types — the bundle is typed per observer so the pure
// role builders in the main hook keep their exact input shapes.
type MyUnreadNotificationCountQueryResult = ReturnType<typeof useUnreadCount>;
type MyStudentSessionsQueryResult = ReturnType<typeof useStudentSessionCount>;
type MySubscriptionsQueryResult = ReturnType<typeof useStudentSubscriptions>;
type MySessionBalanceQueryResult = ReturnType<typeof useStudentSessionBalance>;
type MyTeacherSessionsQueryResult = ReturnType<typeof useTeacherSessionCount>;
type MyWalletQueryResult = ReturnType<typeof useTeacherWallet>;
type MyLinkedChildrenQueryResult = ReturnType<typeof useParentChildren>;
type AdminUserStatsQueryResult = ReturnType<typeof useAdminUserStats>;

function useUnreadCount() {
  // Shared unread-count observer — the same cache field the app-bar badge
  // polls and the realtime socket maintains, so this adds no independent
  // network traffic beyond query deduplication with the badge's in-flight
  // request. Types are inferred from the shared TypedDocumentNode (manual
  // generics on useQuery are deprecated in Apollo v4).
  return useQuery(myUnreadNotificationCountQueryDocument);
}

function useStudentSessionCount(status: SessionStatus, skip: boolean) {
  // `skipToken` (NOT `skip: boolean`) — the Apollo v4 non-deprecated form;
  // a skipped observer parks in the `standby` fetch policy with the same
  // no-request, undefined-data observable outcome as `skip: true`.
  return useQuery(
    myStudentSessionsQueryDocument,
    skip ? skipToken : { variables: { filter: { status }, page: 1, pageSize: COUNT_PAGE_SIZE } }
  );
}

function useStudentSubscriptions(skip: boolean) {
  return useQuery(mySubscriptionsQueryDocument, skip ? skipToken : {});
}

function useStudentSessionBalance(skip: boolean) {
  // The caller's own prepaid session-credit lanes (zero-argument read —
  // the identity is exclusively the token's user id). Feeds the student
  // balance stat card; the same cache field the request dialog's credits
  // strip observes.
  return useQuery(mySessionBalanceQueryDocument, skip ? skipToken : {});
}

function useTeacherSessionCount(status: SessionStatus, skip: boolean) {
  return useQuery(
    myTeacherSessionsQueryDocument,
    skip ? skipToken : { variables: { filter: { status }, page: 1, pageSize: COUNT_PAGE_SIZE } }
  );
}

function useTeacherWallet(skip: boolean) {
  return useQuery(myWalletQueryDocument, skip ? skipToken : {});
}

function useParentChildren(skip: boolean) {
  return useQuery(myLinkedChildrenQueryDocument, skip ? skipToken : {});
}

function useAdminUserStats(skip: boolean) {
  return useQuery(adminUserStatsQueryDocument, skip ? skipToken : {});
}

/**
 * Wires the viewer's role to its stat queries and resolves the parent
 * per-child aggregates from the linked-children list.
 */
export function useRoleStatQueries(role: string | null): RoleStatQueries {
  const unread = useUnreadCount();

  const studentCompleted = useStudentSessionCount(SessionStatus.Completed, role !== "Student");
  const studentUpcoming = useStudentSessionCount(SessionStatus.Scheduled, role !== "Student");
  const studentSubscriptions = useStudentSubscriptions(role !== "Student");
  const studentSessionBalance = useStudentSessionBalance(role !== "Student");

  const teacherCompleted = useTeacherSessionCount(SessionStatus.Completed, role !== "Teacher");
  const teacherUpcoming = useTeacherSessionCount(SessionStatus.Scheduled, role !== "Teacher");
  const teacherWallet = useTeacherWallet(role !== "Teacher");

  const parentChildren = useParentChildren(role !== "Parent");
  const parentChildIds = useMemo(() => {
    if (role !== "Parent") return undefined;
    const children = parentChildren.data?.myLinkedChildren;
    return children === undefined ? undefined : children.map(child => Number(child.id));
  }, [role, parentChildren.data]);
  const parentAggregate = useParentChildAggregates(parentChildIds);

  const adminUserStats = useAdminUserStats(role !== "Admin");

  return {
    unread,
    studentCompleted,
    studentUpcoming,
    studentSubscriptions,
    studentSessionBalance,
    teacherCompleted,
    teacherUpcoming,
    teacherWallet,
    parentChildren,
    parentAggregate,
    adminUserStats,
  };
}
