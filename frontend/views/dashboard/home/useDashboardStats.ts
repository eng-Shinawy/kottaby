"use client";

import { useMemo } from "react";
import { useAuth } from "@/frontend/hooks/auth";
import { type DashboardStatDraft, resolveStatDrafts } from "@/frontend/views/dashboard/home/useDashboardStats.helpers";
import { useRoleStatQueries } from "@/frontend/views/dashboard/home/useDashboardStats.queries";
import { buildStatsData } from "@/frontend/views/dashboard/home/useDashboardStats.roleData";

/**
 * The role-aware dashboard stats hook.
 *
 * Reads ONLY the viewer's own already-authorized identity-scoped documents
 * (no admin surfaces for non-admins, no cross-user targeting arguments
 * anywhere):
 *
 *  - Student → two status-filtered `myStudentSessions` count envelopes,
 *    `mySubscriptions` (active rows counted client-side), and the shared
 *    `myUnreadNotificationCount` cache field the app-bar badge maintains.
 *  - Teacher → the two `myTeacherSessions` count envelopes, `myWallet`
 *    (the balance decimal string verbatim), and the unread count.
 *  - Parent → `myLinkedChildren` plus a per-child aggregate loop (reports
 *    received + total sessions, one `pageSize: 1` envelope per child) run
 *    imperatively against the Apollo client — Apollo v4 has no
 *    `useQueries`, and a fixed-length hook ladder would silently DROP
 *    children in larger families, so the aggregate waits for EVERY child
 *    envelope and re-runs whenever the linked-children list changes.
 *  - Admin → `adminUserStats` (the platform account mix) + the unread count.
 *
 * Query wiring lives in `useDashboardStats.queries` (role-scoped
 * observers); the aggregate runner and value resolvers live in
 * `useDashboardStats.parts`; the per-role payload builder lives in
 * `useDashboardStats.roleData`.
 *
 * Cache posture: every value observes the same cache fields the feature
 * views write (badge socket, mark-read actions, wallet payouts), so a stat
 * re-renders from cache without its own polling — the 120s badge poll
 * remains the unread-count freshness floor. The parent aggregate uses
 * `network-only` reads: page-envelope counts are tiny and the loop runs
 * only when the linked-children list changes, so cache-normalization of
 * the single-row envelopes (shared `Session`/`Report` ids across children)
 * can never poison the sums.
 *
 * Error posture: a failed query degrades ITS OWN stat to `null` (the card
 * renders the localized unavailable marker); sibling stats are unaffected.
 * While loading, the stat stays `undefined` (the card renders a skeleton).
 */
export interface UseDashboardStatsResult {
  /** Role-resolved stat drafts — empty only for an unrecognized role. */
  readonly drafts: readonly DashboardStatDraft[];
  /** True while ANY of the role's stat values is still resolving. */
  readonly isLoading: boolean;
}

/**
 * Resolves the rendered stat drafts: compose the role's payload from the
 * wired observers, run the pure draft builders in
 * `useDashboardStats.helpers`, and derive the loading marker — a draft
 * with an empty value is the helpers' loading sentinel, so any such draft
 * means at least one of the role's stats is still resolving.
 */
function buildRoleDrafts(role: string | null, queries: ReturnType<typeof useRoleStatQueries>) {
  const data = buildStatsData(role, queries, queries.parentAggregate);
  const drafts = resolveStatDrafts(role, data);
  const isLoading = drafts.some(entry => entry.value === "");
  return { drafts, isLoading };
}

/**
 * The role-aware dashboard stats hook — composition only: wire the role's
 * observers, resolve the role's payload, derive the drafts.
 */
export function useDashboardStats(): UseDashboardStatsResult {
  const { user } = useAuth();
  const role = user?.role ?? null;
  const queries = useRoleStatQueries(role);

  return useMemo(() => buildRoleDrafts(role, queries), [role, queries]);
}
