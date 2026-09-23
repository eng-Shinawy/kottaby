/**
 * StudentHomeworkService — the student's own homework history read.
 *
 * `listMyHomework` backs the `/homework` surface (the student nav's
 * homework entry): the caller's OWN homework rows — each carrying the two
 * parallel Jadid/Madi track blocks — newest-session-first, paged.
 *
 * Identity discipline:
 *  - The student identity is the verified context id handed over by the
 *    GraphQL resolver (`ctx.user.id` — the same zero-caller-input pattern
 *    as `myStudentSessions` / `myHandshakeCode`). There is NO
 *    caller-supplied id surface of any kind: the tenancy predicate
 *    (`session.student_id = actor`) is fused into the repository's JOIN
 *    condition, so a cross-student row can never surface (BOLA).
 *  - Role gating is the GraphQL field's `authScopes` `$all { authenticated,
 *    role: [Student] }` conjunction — the service trusts the verified id
 *    exactly like the other student self-read services.
 *
 * Pagination: the caller-supplied window is clamped (never thrown) by the
 * portal-agnostic clamp shared with the parent-monitoring reads; the
 * effective values are echoed in the page payload — an out-of-range page
 * yields an empty `items` array next to the true `totalCount`, never a
 * fabricated window.
 *
 * Row projection: the canonical homework row mapper (the parent portal's
 * `mapHomeWorkRowToEntry` — the single source of truth for the
 * Jadid/Madi block split, shared verbatim per the duplication-elimination
 * discipline). Track composition preserves per-field nullability — a null
 * grade stays null, a fully-null track block collapses to `null`, never
 * fabricated zeros.
 *
 * Read-only posture: zero writes, zero notifications, zero module-level
 * state, and NO localized domain errors on any path (clamped inputs and
 * empty pages are first-class UI states, not anomalies) — unexpected
 * internals bubble up unswallowed to the GraphQL masking boundary, which
 * owns the single correlated error line. Zero logging by the same
 * discipline: every terminal state here is an honest payload, never an
 * anomaly worth a `logDomainError`.
 */
import { HomeWorkRepository } from "@/backend/db/repo";
import { withTransaction } from "@/backend/lib/db/with-transaction";
import { clampPageInput, mapHomeWorkRowToEntry } from "@/backend/services/parents/parent-monitoring.helpers";
import type { DBTransaction, ParentHomeworkPageReturnType, ParentPageInput } from "@/backend/types";

export namespace StudentHomeworkService {
  /**
   * Lists the caller's own homework rows (each carrying the two parallel
   * Jadid/Madi track blocks), newest-session-first, paged.
   *
   * @returns The paginated homework window with the EFFECTIVE page echo.
   *     An out-of-range page yields empty `items` next to the true
   *     `totalCount`.
   */
  export async function listMyHomework(
    studentActorId: number,
    page: ParentPageInput | undefined,
    outerTx?: DBTransaction
  ): Promise<ParentHomeworkPageReturnType> {
    const effective = clampPageInput(page);
    return withTransaction(outerTx, async tx => {
      const [rows, totalCount] = await Promise.all([
        HomeWorkRepository.listForStudent(studentActorId, effective.pageSize, effective.offset, tx),
        HomeWorkRepository.countForStudent(studentActorId, tx),
      ]);
      return {
        items: rows.map(mapHomeWorkRowToEntry),
        totalCount,
        page: effective.page,
        pageSize: effective.pageSize,
      };
    });
  }
}
