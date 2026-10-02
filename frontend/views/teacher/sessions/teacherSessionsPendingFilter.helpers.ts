"use client";

/**
 * Pure client-side filter for the teacher sessions surface — the
 * pending-rubric banner's "show only these" lane. The status filter chips
 * resolve server-side through the query variables; the pending-only filter
 * is a CLIENT-side membership pass over the settled page rows, keyed by the
 * same pending-id set that gates the rows' submit CTA and the rows' pill
 * (one source of truth — filter, pill, and affordance can never drift).
 */

import type { MyTeacherSessionsQuery_myTeacherSessions_items } from "@/frontend/graphql/generated/gql/graphql";

/**
 * Rows whose id sits in the evaluator's pending read — the settled page's
 * still-owed rubric submissions, in the list's original order.
 */
export function filterSessionsAwaitingRubric(
  sessions: readonly MyTeacherSessionsQuery_myTeacherSessions_items[],
  pendingRubricSessionIds: ReadonlySet<string>
): readonly MyTeacherSessionsQuery_myTeacherSessions_items[] {
  return sessions.filter(session => pendingRubricSessionIds.has(session.id));
}
