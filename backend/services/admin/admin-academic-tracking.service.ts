/**
 * AdminAcademicTrackingService — the read-only orchestration behind the
 * admin academic monitoring surface: the all-students academic dashboard
 * and the per-student academic drill-down.
 *
 * Pipeline (both methods, mirroring the platform-analytics snapshot
 * discipline):
 *
 *  1. Gate FIRST — `assertActorAdminActive` runs before validation, before
 *     any transaction opens, and before any read: anonymous callers receive
 *     `UnauthorizedError`; missing, non-admin, or governed actors receive
 *     localized `ForbiddenError`s in the deterministic deleted → blocked →
 *     suspended order (a soft-deleted admin must not read). The gate owns
 *     its translations and its single bounded domain log per denial — this
 *     file adds no denial logic of its own and threads `locale` through
 *     untouched.
 *  2. ONE read-only transaction (a savepoint join onto the caller's
 *     `outerTx` when supplied) captures a single `now` instant that is
 *     threaded to EVERY windowed read — stats, directory rows, attention
 *     signals, and history pages can never disagree with themselves across
 *     methods.
 *  3. Validation before reads — pagination bounds and the drill-down's
 *     `studentId` resolve through the shared academic helpers, which throw
 *     localized `ValidationError`s before the first repository call. An
 *     out-of-range-but-valid page is not an error: the listing returns
 *     empty `items` next to the honest `total`.
 *  4. Repository reads — the dashboard composes the directory listing, its
 *     honest total, the advancement statistics, and the per-student
 *     attention signals in one `Promise.all` over the SAME transaction;
 *     the drill-down resolves the student echo FIRST (soft-deleted
 *     students PROCEED — the governance banner is the caller's rendering
 *     concern — while a missing id is a localized `NotFoundError` for
 *     admin callers only, unreachable by non-admins behind the constant
 *     gate denial), then reuses the proven per-student readers for the
 *     homework history, the session-report history, and the honest
 *     progress count.
 *  5. Assembly through the academic mappers — position/summary/flag
 *     composition and the Date→ISO serialization seam live in the
 *     academic-tracking helpers and mappers; this file only orchestrates.
 *
 * Drill-down session context: the reused per-student readers return raw
 * homework/report rows without the human-facing session date and teacher
 * identity, so the service resolves the owning sessions (one primary-key
 * read per DISTINCT session id on the page — bounded by the page size, so
 * the read count scales with the window, never with the student's whole
 * history) and the teachers' display names (one batched id lookup), then
 * maps every entry field-by-field. A structurally impossible miss (an
 * owning session or teacher row absent for an existing entry — the foreign
 * keys forbid it) fails closed as a corruption signal rather than rendering
 * a fabricated identity.
 *
 * Purity: NO locks, NO mutations, NO audit rows, NO notifications, NO cache
 * writes — a successful read logs nothing and writes nothing. The only
 * bounded `logDomainError` this file emits is the drill-down's
 * missing-student denial; every actor denial is logged exactly once by the
 * gate itself.
 */

import {
  AdminAcademicTrackingRepository,
  HomeWorkRepository,
  ProgressRepository,
  type ReportForStudentRow,
  ReportRepository,
  SessionRepository,
  UserRepository,
} from "@/backend/db/repo";
import { isSurahJuzRef, type SurahJuzRef } from "@/backend/enum/shared/surah-juz-ref.enum";
import { escapeLikeWildcards } from "@/backend/lib/db/escape-like-wildcards";
import { withTransaction } from "@/backend/lib/db/with-transaction";
import { NotFoundError } from "@/backend/lib/errors";
import { logger } from "@/backend/lib/logger";
import {
  assertAcademicStudentId,
  composeAcademicAttentionFlag,
  resolveAcademicTrackingPageBounds,
} from "@/backend/services/admin/admin-academic-tracking.helpers";
import {
  composeAcademicPageEnvelope,
  mapAcademicStats,
  mapAcademicStudentEcho,
  mapAcademicStudentRow,
} from "@/backend/services/admin/admin-academic-tracking.mappers";
import { assertActorAdminActive } from "@/backend/services/admin/admin-gate.helpers";
import type {
  AdminAcademicAttentionFlagReturnType,
  AdminAcademicDashboardFiltersSelectType,
  AdminAcademicDashboardFiltersSubmitInput,
  AdminAcademicDashboardPageReturnType,
  AdminAcademicHomeworkEntryReturnType,
  AdminAcademicHomeworkTrackReturnType,
  AdminAcademicReportEntryReturnType,
  AdminStudentAcademicDetailReturnType,
  DBTransaction,
  HomeWorkSelectType,
  SessionSelectType,
} from "@/backend/types";
import { getServerTranslations } from "@/shared/locale/server-graphql";

/** The `NotFoundError` entity slug for an unresolvable drill-down student. */
const STUDENT_ENTITY = "STUDENT";

/** The resolved owning-session context every drill-down history entry renders. */
interface AcademicSessionContext {
  readonly startedAt: Date | null;
  readonly teacherName: string;
}

/**
 * Normalizes the transport-shape dashboard filters into the repo-layer
 * select shape. The `search` substring is trimmed, escaped through the
 * canonical LIKE-wildcard sanitizer, and wrapped as `%…%` HERE — the repo
 * binds the final pattern verbatim to its `ilike` predicates and never
 * re-escapes (one canonical escape point at the service, one binding point
 * at the repo). Absent, null, or whitespace-only search drops the filter
 * entirely (the unfiltered listing, never an error).
 */
function normalizeDashboardFilters(
  filters: AdminAcademicDashboardFiltersSubmitInput
): AdminAcademicDashboardFiltersSelectType {
  const rawSearch = filters.search;
  if (typeof rawSearch === "string" && rawSearch.trim().length > 0) {
    return { searchPattern: `%${escapeLikeWildcards(rawSearch.trim())}%` };
  }
  return {};
}

/**
 * Narrows a stored `surah_juz_ref` value onto the canonical vocabulary via
 * the fail-closed enum guard. The pgEnum makes out-of-vocabulary values
 * unreachable; a hit is a corruption signal, so the call throws instead of
 * carrying an unvalidated string into the projection.
 */
function narrowEntrySurahJuz(raw: string): SurahJuzRef {
  if (isSurahJuzRef(raw)) {
    return raw;
  }
  throw new Error("AdminAcademicTrackingService: corrupt surah_juz_ref value");
}

/**
 * Composes one homework track (Jadid from the `current_*` columns, Madi
 * from the `revision_*` columns) for a drill-down history entry. A
 * fully-null block collapses to `null` — "no assignment on this track" —
 * while a present block carries its own per-field nullability: a null
 * grade stays null (write-once grading, never a fabricated zero), a null
 * ayah span stays null, and a null reference stays null inside an otherwise
 * present block.
 */
function composeHomeworkEntryTrack(
  surahJuz: HomeWorkSelectType["currentSurahJuz"],
  fromAyah: HomeWorkSelectType["currentFromAyah"],
  toAyah: HomeWorkSelectType["currentToAyah"],
  grade: HomeWorkSelectType["currentGrade"]
): AdminAcademicHomeworkTrackReturnType | null {
  if (surahJuz === null && fromAyah === null && toAyah === null && grade === null) {
    return null;
  }
  return {
    surahJuz: surahJuz === null ? null : narrowEntrySurahJuz(surahJuz),
    fromAyah,
    toAyah,
    grade,
  };
}

/**
 * Resolves the owning-session rows for every DISTINCT session id referenced
 * by a drill-down page (homework + report entries share one lookup pass).
 * The foreign keys guarantee every existing entry's session exists, so a
 * miss fails closed as a corruption signal instead of degrading silently.
 */
async function resolveSessionRows(
  sessionIds: readonly number[],
  tx: DBTransaction
): Promise<Map<number, SessionSelectType>> {
  const sessionRows = await Promise.all(sessionIds.map(sessionId => SessionRepository.findById(sessionId, tx)));
  const rowsById = new Map<number, SessionSelectType>();
  for (const sessionRow of sessionRows) {
    if (sessionRow === null) {
      throw new Error("AdminAcademicTrackingService: owning session row missing for a history entry");
    }
    rowsById.set(sessionRow.id, sessionRow);
  }
  return rowsById;
}

/**
 * Resolves the owning-session context (human-facing session date + teacher
 * display identity) for every DISTINCT session id across a drill-down's
 * homework and report windows: one primary-key read per session on the
 * caller's transaction, then ONE batched name lookup for the referenced
 * teachers. The teacher foreign key guarantees every referenced teacher
 * row exists, so a name miss fails closed as a corruption signal.
 */
async function resolveSessionContexts(
  rows: readonly {
    readonly sessionId: number;
  }[],
  tx: DBTransaction
): Promise<Map<number, AcademicSessionContext>> {
  const sessionIds = [...new Set(rows.map(row => row.sessionId))];
  const rowsById = await resolveSessionRows(sessionIds, tx);
  const teacherIds = [...new Set([...rowsById.values()].map(sessionRow => sessionRow.teacherId))];
  const teacherNames = await UserRepository.findNamesByIds(teacherIds, tx);

  const contexts = new Map<number, AcademicSessionContext>();
  for (const [sessionId, sessionRow] of rowsById) {
    const teacherName = teacherNames.get(sessionRow.teacherId);
    if (teacherName === null || teacherName === undefined) {
      throw new Error("AdminAcademicTrackingService: owning teacher row missing for a history entry");
    }
    contexts.set(sessionId, { startedAt: sessionRow.startedAt, teacherName });
  }
  return contexts;
}

/**
 * The fail-closed context lookup for one history entry. The context map is
 * built from the entry page's own DISTINCT session ids, so a miss is a
 * corruption signal rather than a reachable state — the call throws instead
 * of fabricating an identity.
 */
function requireSessionContext(
  contexts: Map<number, AcademicSessionContext>,
  sessionId: number
): AcademicSessionContext {
  const context = contexts.get(sessionId);
  if (context === undefined) {
    throw new Error("AdminAcademicTrackingService: owning session row missing for a history entry");
  }
  return context;
}

/**
 * Maps one raw homework row onto the drill-down history entry: the two
 * track blocks composed independently (either may be null), the owning
 * session's start stamp serialized to its ISO string (null when the
 * session has not started — display falls back to the row's creation
 * stamp), and the owning teacher's display identity resolved through the
 * session context.
 */
function mapHomeworkEntry(
  row: HomeWorkSelectType,
  contexts: Map<number, AcademicSessionContext>
): AdminAcademicHomeworkEntryReturnType {
  const sessionContext = requireSessionContext(contexts, row.sessionId);
  return {
    id: row.id,
    sessionId: row.sessionId,
    sessionStartedAt: sessionContext.startedAt === null ? null : sessionContext.startedAt.toISOString(),
    teacherName: sessionContext.teacherName,
    jadid: composeHomeworkEntryTrack(row.currentSurahJuz, row.currentFromAyah, row.currentToAyah, row.currentGrade),
    madi: composeHomeworkEntryTrack(row.revisionSurahJuz, row.revisionFromAyah, row.revisionToAyah, row.revisionGrade),
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * Maps one raw joined report row onto the drill-down report entry: the
 * joined session start stamp serializes to its ISO string (null when the
 * session has not started), the teacher identity rides the shared session
 * context, and the nullable notes/rating pass through unchanged — absent
 * values are never coerced into zeros or empty strings.
 */
function mapReportEntry(
  row: ReportForStudentRow,
  contexts: Map<number, AcademicSessionContext>
): AdminAcademicReportEntryReturnType {
  const sessionContext = requireSessionContext(contexts, row.sessionId);
  return {
    id: row.id,
    sessionId: row.sessionId,
    sessionStartedAt: row.sessionStartedAt === null ? null : row.sessionStartedAt.toISOString(),
    teacherName: sessionContext.teacherName,
    teacherNotes: row.teacherNotes,
    studentRatingByTeacher: row.studentRatingByTeacher,
    createdAt: row.createdAt.toISOString(),
  };
}

export namespace AdminAcademicTrackingService {
  /**
   * Resolves the admin academic dashboard: one paged window of the
   * all-students academic directory plus the aggregate advancement
   * statistics and per-row attention flags, all computed over the SAME
   * snapshot instant.
   *
   * The student lane is hard-sealed repository-side (student role, not
   * soft-deleted) and the optional `search` filter matches
   * case-insensitively over name OR email as a pre-escaped `%…%` pattern —
   * client wildcards can never widen the match. An out-of-range-but-valid
   * page yields empty `items` next to the honest `total`. The
   * needing-attention statistic is composed from the WHOLE student lane's
   * attention signals (not just the page window), so the count stays
   * correct on every page.
   *
   * @param actorId The calling admin's user id (`0` = anonymous sentinel).
   * @param filters Transport-shape filter whitelist (`search` only).
   * @param page    Page bound (integer ≥ 1, default 1 — validated pre-read).
   * @param pageSize Page size (integer 1..100, default 25 — validated pre-read).
   * @param locale  Locale every localized denial resolves through.
   * @param outerTx Optional outer transaction (test path) — the snapshot
   *                reads join it via a savepoint when supplied.
   */
  export async function getAcademicDashboard(
    actorId: number,
    filters: AdminAcademicDashboardFiltersSubmitInput,
    page: number,
    pageSize: number,
    locale: string,
    outerTx?: DBTransaction
  ): Promise<AdminAcademicDashboardPageReturnType> {
    await assertActorAdminActive(actorId, locale, outerTx);

    return withTransaction(outerTx, async tx => {
      const now = new Date();
      const bounds = resolveAcademicTrackingPageBounds(page, pageSize, locale);
      const selectFilters = normalizeDashboardFilters(filters);

      const [rows, total, stats, signals] = await Promise.all([
        AdminAcademicTrackingRepository.listStudentAcademicRows(selectFilters, now, bounds.pageSize, bounds.offset, tx),
        AdminAcademicTrackingRepository.countStudentAcademicRows(selectFilters, tx),
        AdminAcademicTrackingRepository.getAcademicStats(now, tx),
        AdminAcademicTrackingRepository.listAttentionSignals(now, tx),
      ]);

      const flagByStudentId = new Map<number, AdminAcademicAttentionFlagReturnType | null>();
      let needingAttentionCount = 0;
      for (const signal of signals) {
        const flag = composeAcademicAttentionFlag(signal, now);
        flagByStudentId.set(signal.studentId, flag);
        if (flag !== null) {
          needingAttentionCount += 1;
        }
      }

      const items = rows.map(row => mapAcademicStudentRow(row, flagByStudentId.get(row.id) ?? null));
      const envelope = composeAcademicPageEnvelope(items, total, bounds.page, bounds.pageSize);

      return {
        items: envelope.items,
        total: envelope.total,
        page: envelope.page,
        pageSize: envelope.pageSize,
        pageCount: envelope.pageCount,
        stats: mapAcademicStats(stats, needingAttentionCount),
      };
    });
  }

  /**
   * Resolves one student's academic drill-down: the identity echo (with the
   * soft-delete marker the governance banner renders), the paginated
   * homework history, the paginated session-report history, the honest
   * progress row count, and the student's attention flag — all sub-reads
   * sharing one snapshot so the header and both pages stay mutually
   * consistent.
   *
   * The echo resolves FIRST: a soft-deleted student PROCEEDS (the academic
   * history survives soft delete and the header banners it), while a
   * missing id throws a localized `NotFoundError` for admin callers —
   * non-admins never reach this branch because the gate denies them first,
   * so no existence oracle leaks. A structurally impossible context miss
   * (an owning session or teacher row absent for an existing entry) fails
   * closed as a corruption signal.
   *
   * @param actorId  The calling admin's user id (`0` = anonymous sentinel).
   * @param studentId The student id to drill into (positive integer —
   *                  validated pre-read; the ONLY client-supplied scoping
   *                  argument on this surface).
   * @param page     Page bound (integer ≥ 1, default 1 — validated pre-read).
   * @param pageSize Page size (integer 1..100, default 25 — validated pre-read).
   * @param locale   Locale every localized denial resolves through.
   * @param outerTx  Optional outer transaction (test path) — the snapshot
   *                 reads join it via a savepoint when supplied.
   */
  export async function getStudentAcademicDetail(
    actorId: number,
    studentId: number,
    page: number,
    pageSize: number,
    locale: string,
    outerTx?: DBTransaction
  ): Promise<AdminStudentAcademicDetailReturnType> {
    await assertActorAdminActive(actorId, locale, outerTx);

    return withTransaction(outerTx, async tx => {
      const now = new Date();

      const bounds = resolveAcademicTrackingPageBounds(page, pageSize, locale);
      assertAcademicStudentId(studentId, locale);

      const echo = await AdminAcademicTrackingRepository.getStudentEchoById(studentId, tx);
      if (echo === null) {
        logger.logDomainError("Admin academic drill-down denied: student id does not resolve", {
          code: "STUDENT_NOT_FOUND",
          entity: "students",
          entityId: studentId,
          locale,
        });
        throw new NotFoundError(STUDENT_ENTITY, getServerTranslations(locale).errorsTranslations.notFound);
      }

      const [homeworkRows, homeworkTotal, reportRows, reportTotal, progressRowCount, signal] = await Promise.all([
        HomeWorkRepository.listForStudent(studentId, bounds.pageSize, bounds.offset, tx),
        HomeWorkRepository.countForStudent(studentId, tx),
        ReportRepository.listForStudent(studentId, bounds.pageSize, bounds.offset, tx),
        ReportRepository.countForStudent(studentId, tx),
        ProgressRepository.countForStudent(studentId, tx),
        AdminAcademicTrackingRepository.getAttentionSignalForStudent(studentId, now, tx),
      ]);

      const sessionContexts = await resolveSessionContexts([...homeworkRows, ...reportRows], tx);
      const needsAttention = composeAcademicAttentionFlag(signal ?? undefined, now);

      const homeworkItems = homeworkRows.map(row => mapHomeworkEntry(row, sessionContexts));
      const reportItems = reportRows.map(row => mapReportEntry(row, sessionContexts));

      const homeworkEnvelope = composeAcademicPageEnvelope(homeworkItems, homeworkTotal, bounds.page, bounds.pageSize);
      const reportEnvelope = composeAcademicPageEnvelope(reportItems, reportTotal, bounds.page, bounds.pageSize);

      return {
        student: mapAcademicStudentEcho(echo),
        homeworkPage: {
          items: homeworkEnvelope.items,
          total: homeworkEnvelope.total,
          page: homeworkEnvelope.page,
          pageSize: homeworkEnvelope.pageSize,
          pageCount: homeworkEnvelope.pageCount,
        },
        reportPage: {
          items: reportEnvelope.items,
          total: reportEnvelope.total,
          page: reportEnvelope.page,
          pageSize: reportEnvelope.pageSize,
          pageCount: reportEnvelope.pageCount,
        },
        progressRowCount,
        needsAttention,
      };
    });
  }
}
