/**
 * Student-directory CSV export — the pure client-side serialization of the
 * CURRENT page the directory already holds (no second fetch, no backend
 * change: the export reflects EXACTLY the rows on screen, same honesty
 * contract as the platform-analytics export).
 *
 * This module owns the COLUMN layout (localized caption handles) and the
 * per-row VALUE mapping (locale-neutral wire data); the FORMAT — RFC-4180
 * escaping, BOM prefix, record structure, filename stamp — lives in the
 * shared `directory-shared/directory-csv`.
 *
 * Honesty contract (mirrors the render surface):
 *  - booleans serialize as lowercase `true`/`false` wire strings — never
 *    localized chips;
 *  - honest-null values (phone, country, trialGrantedAt, languages, parent
 *    identity) serialize as EMPTY cells (the `—` is a display affordance,
 *    not a value);
 *  - session balances serialize as raw integer strings (locale digit
 *    shaping is display-only);
 *  - `createdAt` / `trialGrantedAt` flow verbatim as the ISO wire strings.
 *
 * Content decision — labels are LOCALIZED: column captions come from the
 * same translation handles the on-screen table renders (existing header /
 * balance / parent keys reused wherever the concept exists; `fields.*`
 * captions minted for concepts the directory chrome never needed before).
 * EXCEPTION — the two TRIAL columns use the export-scoped
 * `export.columnTrialBalance` / `export.columnTrialGrantedAt` captions: the
 * shared `balances.trial` and `headers.trial` handles both resolve to
 * "Trial" (EN), which emitted the header caption TWICE (QA-verified) and
 * muddied the AR count column. All VALUES stay locale-neutral wire data.
 *
 * Formula-injection posture: cells are built through the shared
 * `directory-csv` builder, whose `csvCell` routes every value through
 * the shared `neutralizeCsvFormulas` guard before quoting and joining —
 * a cell opening with a spreadsheet formula trigger (`=`, `+`, `-`,
 * `@`, TAB, CR) is defused with a leading single quote (CWE-1236), so
 * even if user-authored text ever reached a cell, it would export as
 * inert text rather than a live formula.
 */

import type { AdminStudentsQuery } from "@/frontend/graphql/generated/gql/graphql";
import {
  buildDirectoryCsv,
  csvBoolCell,
  directoryCsvFilename,
} from "@/frontend/views/admin/directory-shared/directory-csv";
import type { AdminStudentsLabels } from "@/shared/locale/types/adminStudents";

/** One directory row as the query delivered it (the extracted item type). */
type StudentDirectoryRow = AdminStudentsQuery["adminStudents"]["items"][number];

/**
 * Builds the full CSV document for the CURRENT page: one localized header
 * record, then one record per on-screen student — id, identity, contact,
 * the four session balances, trial stamp, languages, parent placement, and
 * the joined stamp.
 */
export function buildStudentsDirectoryCsv(items: readonly StudentDirectoryRow[], labels: AdminStudentsLabels): string {
  return buildDirectoryCsv({
    headers: [
      labels.fields.id,
      labels.headers.name,
      labels.fields.email,
      labels.fields.phone,
      labels.fields.country,
      labels.balances.hifz,
      labels.balances.reviews,
      labels.balances.tajweed,
      // Export-scoped trial captions — the shared handles collide on
      // "Trial" (EN) and would duplicate the header record (see docblock).
      labels.export.columnTrialBalance,
      labels.export.columnTrialGrantedAt,
      labels.fields.primaryLanguage,
      labels.fields.anotherLanguage,
      labels.parentLabels.withParent,
      labels.headers.parent,
      labels.fields.parentEmail,
      labels.headers.joined,
    ],
    rows: items.map(student => [
      String(student.id),
      student.name,
      student.email,
      // Honest null → empty cell (the em-dash is a display-only affordance).
      student.phone ?? "",
      student.country ?? "",
      String(student.balanceHifz),
      String(student.balanceReviews),
      String(student.balanceTajweed),
      String(student.balanceTrial),
      student.trialGrantedAt ?? "",
      student.primaryLanguage ?? "",
      student.anotherLanguage ?? "",
      csvBoolCell(student.hasParent),
      student.parentName ?? "",
      student.parentEmail ?? "",
      student.createdAt,
    ]),
  });
}

/**
 * Derives the download filename from the wall clock:
 * `students-directory-YYYY-MM-DD-HHmm.csv` (UTC, minute precision — the
 * same stamp recipe the analytics export uses). The clock is injected so
 * callers (and tests) can pin the stamp; production uses the default.
 */
export function studentsDirectoryCsvFilename(now: Date = new Date()): string {
  return directoryCsvFilename("students-directory", now);
}
