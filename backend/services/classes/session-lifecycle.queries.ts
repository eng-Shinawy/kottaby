/**
 * Session lifecycle — read/query surface (behavior-identical extraction
 * from `session-lifecycle.service.ts` under the documented max-lines
 * sibling-module layout).
 *
 * Pure read surface: no writes, no governance re-checks, no localized
 * errors. Every function normalizes its paging/filter inputs BEFORE any
 * database work, scopes every read to its owning participant (or the
 * admin arbitration surface's pinned `disputed` scope), and echoes the
 * effective `page`/`pageSize` honestly — `totalCount` is always computed
 * under the SAME predicate as the items so the two can never diverge.
 * The admin role gate lives at the GraphQL scope (`$all { authenticated,
 * role: [Admin] }`); these reads take no caller identity beyond the
 * owner ids passed in and never raise.
 */

import { SessionRepository } from "@/backend/db/repo";
import { SessionStatus } from "@/backend/enum/scheduling/session-status.enum";
import {
  guardStatusFilter,
  isPositiveSafeSessionId,
  normalizeAdminListBounds,
  normalizePageBounds,
} from "@/backend/services/classes/session-lifecycle.guards";
import type { DBTransaction, SessionListFilterInput, SessionPageReturnType, SessionReturnType } from "@/backend/types";

export namespace SessionLifecycleQueries {
  /**
   * Reads one session for a participant (student or teacher) — or `null`.
   *
   * Oracle-safe malformed-id channel: anything that is not a
   * positive safe integer — the NaN/1.5/overflow shapes the boundary's
   * shape-only `Number` parse yields for garbage `ID` strings — resolves
   * to the SAME `null` as a nonexistent id, BEFORE any database read. No
   * error is raised (this read surface has no locale and never throws).
   *
   * @param callerUserId  The acting user's id (participant scoping).
   * @param sessionId  The target session id.
   * @param tx  Optional transaction — propagated to the read.
   */
  export async function getSessionById(
    callerUserId: number,
    sessionId: number,
    tx?: DBTransaction
  ): Promise<SessionReturnType | null> {
    if (!isPositiveSafeSessionId(sessionId)) {
      return null;
    }

    const row = await SessionRepository.findById(sessionId, tx);
    if (row === null) {
      return null;
    }
    if (row.studentId !== callerUserId && row.teacherId !== callerUserId) {
      return null;
    }
    return row;
  }

  /**
   * Lists the acting student's own sessions, newest first, paged.
   *
   * Page bounds are normalized before any database work: a page below 1
   * falls back to the first page and a page size outside 1..50 falls back to
   * the default (25) — the read surface never fabricates a window, and the
   * returned `page`/`pageSize` echo the effective values honestly. The
   * lifecycle filter is guarded against the closed status vocabulary (an
   * out-of-vocabulary value drops out — filters never error); the total
   * count is computed under the SAME filtered predicate as the list, so
   * `totalCount` can never diverge from the items.
   *
   * @param studentId  The acting student's id (owner-side scoping).
   * @param filter  Optional lifecycle filter (absent/null members drop out).
   * @param page  Requested page (≥ 1; invalid values normalize to 1).
   * @param pageSize  Requested page size (1..50; invalid values normalize
   *     to the default).
   * @param tx  Optional transaction — propagated to both reads.
   */
  export async function listMyStudentSessions(
    studentId: number,
    filter: SessionListFilterInput,
    page: number,
    pageSize: number,
    tx?: DBTransaction
  ): Promise<SessionPageReturnType> {
    const bounds = normalizePageBounds(page, pageSize);
    const guardedFilter = guardStatusFilter(filter);

    const items = await SessionRepository.listForStudent(
      studentId,
      guardedFilter,
      bounds.pageSize,
      (bounds.page - 1) * bounds.pageSize,
      tx
    );
    const totalCount = await SessionRepository.countForStudent(studentId, guardedFilter, tx);

    return { items, totalCount, page: bounds.page, pageSize: bounds.pageSize };
  }

  /**
   * Lists the acting teacher's own sessions — the teacher-side twin of
   * `listMyStudentSessions`, with identical paging, guarding, filtering,
   * and honest-echo semantics over the owning-teacher predicate.
   *
   * @param teacherId  The acting teacher's id (owner-side scoping).
   * @param filter  Optional lifecycle filter (absent/null members drop out).
   * @param page  Requested page (≥ 1; invalid values normalize to 1).
   * @param pageSize  Requested page size (1..50; invalid values normalize
   *     to the default).
   * @param tx  Optional transaction — propagated to both reads.
   */
  export async function listMyTeacherSessions(
    teacherId: number,
    filter: SessionListFilterInput,
    page: number,
    pageSize: number,
    tx?: DBTransaction
  ): Promise<SessionPageReturnType> {
    const bounds = normalizePageBounds(page, pageSize);
    const guardedFilter = guardStatusFilter(filter);

    const items = await SessionRepository.listForTeacher(
      teacherId,
      guardedFilter,
      bounds.pageSize,
      (bounds.page - 1) * bounds.pageSize,
      tx
    );
    const totalCount = await SessionRepository.countForTeacher(teacherId, guardedFilter, tx);

    return { items, totalCount, page: bounds.page, pageSize: bounds.pageSize };
  }

  /**
   * Lists the disputed sessions for the admin arbitration surface, newest
   * first, paged.
   *
   * The limit clamp mirrors the participant lists exactly (1..50, default
   * 25) and the offset floors at zero — both normalize pre-DB, never
   * error. The lifecycle filter is guarded against the closed status
   * vocabulary like every other read; the field's `disputed` scope is
   * PINNED, so an explicitly contradictory filter (any status other than
   * disputed) honestly resolves to an empty page without touching the
   * database, while an absent/whitespace-drop filter returns the full
   * arbitration queue. The total count is computed under the SAME pinned
   * predicate as the list, so `totalCount` can never diverge from the
   * items. The `limit`/`offset` window maps onto the page echo honestly:
   * `pageSize` is the clamped limit and `page` is the 1-based window index
   * that contains the requested offset.
   *
   * The admin role gate lives at the GraphQL scope (`$all { authenticated,
   * role: [Admin] }`); this read takes no caller identity and never raises
   * localized errors (the read-surface contract).
   *
   * @param filter  Optional lifecycle filter (absent/null members drop
   *     out; a non-disputed member contradicts the pinned scope).
   * @param limit  Requested page size (1..50; invalid values normalize to
   *     the default).
   * @param offset  Requested row offset (≥ 0; invalid values normalize to
   *     0).
   * @param tx  Optional transaction — propagated to both reads.
   */
  export async function listAdminDisputedSessions(
    filter: SessionListFilterInput,
    limit: number,
    offset: number,
    tx?: DBTransaction
  ): Promise<SessionPageReturnType> {
    const bounds = normalizeAdminListBounds(limit, offset);

    // A filter explicitly contradicting the pinned disputed scope (any
    // in-vocabulary status other than disputed) matches zero rows by
    // definition — the honest empty page, no database round-trip.
    const guardedStatus = guardStatusFilter(filter).status;
    if (guardedStatus !== null && guardedStatus !== SessionStatus.Disputed) {
      return { items: [], totalCount: 0, page: bounds.page, pageSize: bounds.safeLimit };
    }

    const items = await SessionRepository.listAdminDisputed(bounds.safeLimit, bounds.safeOffset, tx);
    const totalCount = await SessionRepository.countAdminDisputed(tx);

    return { items, totalCount, page: bounds.page, pageSize: bounds.safeLimit };
  }
}
