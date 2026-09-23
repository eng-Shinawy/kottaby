/**
 * ParentLinkProbeService — read-only parent↔student link-state
 * introspection for bootstrap surfaces (the demo seeders).
 *
 * Lives beside — deliberately outside — `parent-link-request.service.ts`:
 * that file sits exactly at its oxlint `max-lines` budget, and these
 * probes are pure reads (zero writes, zero notifications, zero audit
 * rows), so a dedicated read-only surface keeps the mutation service
 * within budget. Deliberately NOT re-exported by the services barrel;
 * consumers deep-import this module.
 *
 * Seeders must never import from `@/backend/db/**` (seeds/AGENTS.md
 * Service-Only Data Access rule) — these service reads are the sanctioned
 * replacement for the seeder's former direct repository reads.
 */
import { ParentLinkRequestRepository, StudentRepository } from "@/backend/db/repo";

export namespace ParentLinkProbeService {
  /**
   * The student's current link owner (`students.parent_id`), or `null`
   * when the row is missing or the student is unlinked. A missing row is
   * a first-class `null` (never a throw) — the caller decides whether a
   * missing prerequisite is fatal.
   */
  export async function findLinkedParentId(studentUserId: number): Promise<number | null> {
    const studentRow = await StudentRepository.findById(studentUserId);
    return studentRow?.parentId ?? null;
  }

  /**
   * The id of the live PENDING request between exactly (parent, student),
   * or `null`. Bootstrap reconciliation (e.g. a raced handshake in the
   * demo-linkage seeder) confirms through this id instead of
   * re-requesting. Only the id surfaces; the raw row never leaves the
   * service.
   */
  export async function findPendingRequestIdByPair(
    parentUserId: number,
    studentUserId: number
  ): Promise<number | null> {
    const pending = await ParentLinkRequestRepository.findPendingByPair(parentUserId, studentUserId);
    return pending?.id ?? null;
  }
}
