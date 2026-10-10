/**
 * Applicant-queue CSV export — the pure client-side serialization of the
 * SERVER-SIDE export-all dump (the `adminTeacherApplicantsExport` query):
 * the rows arrive from the backend bounded to its EXPORT_MAX_ROWS cap, so
 * the export reflects the WHOLE filtered queue, not the current page.
 *
 * This module owns the COLUMN layout (localized caption handles) and the
 * per-row VALUE mapping (locale-neutral wire data); the FORMAT — RFC-4180
 * escaping, BOM prefix, record structure, filename stamp — lives in the
 * shared `directory-shared/directory-csv`.
 *
 * Honesty contract (mirrors the sibling directory builders):
 *  - the lifecycle status serializes as the raw lowercase wire string
 *    (`pending` / `in_evaluation` / `failed` / `passed`) — never a
 *    localized pill;
 *  - booleans serialize as lowercase `true`/`false` wire strings;
 *  - honest-null values (phone, country, lastAttemptAt, cooldownUntil)
 *    serialize as EMPTY cells (the `—` and the cooling-down chip are
 *    display affordances, not values);
 *  - `createdAt` / `lastAttemptAt` / `cooldownUntil` flow verbatim as the
 *    ISO wire strings.
 *
 * Content decision — labels are LOCALIZED: column captions come from the
 * same translation handles the queue table renders (headers,
 * applicantHeaders, statusPills, fields — zero new captions minted). All
 * VALUES stay locale-neutral wire data.
 *
 * Formula-injection posture: cells are built through the shared
 * `directory-csv` builder, whose `csvCell` routes every value through
 * the shared `neutralizeCsvFormulas` guard before quoting and joining —
 * a cell opening with a spreadsheet formula trigger (`=`, `+`, `-`,
 * `@`, TAB, CR) is defused with a leading single quote (CWE-1236), so
 * even if user-authored text ever reached a cell, it would export as
 * inert text rather than a live formula.
 */

import type { AdminTeacherApplicantsExportQuery } from "@/frontend/graphql/generated/gql/graphql";
import {
  buildDirectoryCsv,
  csvBoolCell,
  directoryCsvFilename,
} from "@/frontend/views/admin/directory-shared/directory-csv";
import type { AdminTeachersLabels } from "@/shared/locale/types/adminTeachers";

/** One export row as the export query delivered it (the extracted item type). */
type ApplicantDirectoryRow = AdminTeacherApplicantsExportQuery["adminTeacherApplicantsExport"]["rows"][number];

/**
 * Builds the full CSV document for the EXPORT-ALL dump: one localized
 * header record, then one record per filtered applicant — id, identity,
 * contact, lifecycle status, verification attempts, last-attempt and
 * cooldown stamps, governance booleans, and the joined stamp.
 */
export function buildApplicantsDirectoryCsv(
  items: readonly ApplicantDirectoryRow[],
  labels: AdminTeachersLabels
): string {
  return buildDirectoryCsv({
    headers: [
      labels.fields.id,
      labels.headers.name,
      labels.fields.email,
      labels.fields.phone,
      labels.fields.country,
      labels.headers.status,
      labels.applicantHeaders.attempts,
      labels.applicantHeaders.lastAttempt,
      labels.applicantHeaders.cooldown,
      labels.statusPills.deleted,
      labels.statusPills.suspended,
      labels.statusPills.blocked,
      labels.headers.joined,
    ],
    rows: items.map(applicant => [
      String(applicant.id),
      applicant.name,
      applicant.email,
      // Honest null → empty cell (the em-dash is a display-only affordance).
      applicant.phone ?? "",
      applicant.country ?? "",
      // Raw wire status — never the localized pill.
      applicant.status,
      String(applicant.verificationAttempts),
      applicant.lastAttemptAt ?? "",
      applicant.cooldownUntil ?? "",
      csvBoolCell(applicant.isDeleted),
      csvBoolCell(applicant.suspended),
      csvBoolCell(applicant.isBlocked),
      applicant.createdAt,
    ]),
  });
}

/**
 * Derives the download filename from the wall clock:
 * `applicants-directory-YYYY-MM-DD-HHmm.csv` (UTC, minute precision — the
 * same stamp recipe the sibling directory exports use). The clock is
 * injected so callers (and tests) can pin the stamp; production uses the
 * default.
 */
export function applicantsDirectoryCsvFilename(now: Date = new Date()): string {
  return directoryCsvFilename("applicants-directory", now);
}
