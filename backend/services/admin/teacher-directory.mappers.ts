/**
 * Admin teacher-directory mappers — raw DB row → canonical return-shape
 * projections for the `adminTeachers` directory surface. Mirrors the
 * `user-management.mappers.ts` discipline: pure functions, fail-safe
 * payload parsing, null-coalesced governance booleans — a corrupt stored
 * value degrades its own field, never the whole directory read.
 */
import type { AdminTeacherDirectoryRow } from "@/backend/db/repo/teachers/teacher.repository";
import { parseAverageRating, parseSubjectsJson } from "@/backend/services/teachers/teacher-profile.mappers";
import type { AdminTeacherItemReturnType } from "@/backend/types";

/**
 * Maps a raw teacher-directory DB row to the canonical directory item
 * shape. Governance/certification booleans are null-coalesced (`?? false`)
 * per the missing-value-reads-as-false discipline; `subjects` and
 * `averageRating` ride their shared defensive parsers from the canonical
 * teacher-profile mapper home.
 */
export function mapTeacherDirectoryRow(row: AdminTeacherDirectoryRow): AdminTeacherItemReturnType {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    phone: row.phone,
    country: row.country,
    isApproved: row.isApproved ?? false,
    isEvaluator: row.isEvaluator ?? false,
    averageRating: parseAverageRating(row.averageRating),
    isOnline: row.isOnline ?? false,
    subjects: parseSubjectsJson(row.subjects),
    isDeleted: row.isDeleted ?? false,
    suspended: row.suspended ?? false,
    isBlocked: row.isBlocked ?? false,
    createdAt: row.createdAt,
  };
}
