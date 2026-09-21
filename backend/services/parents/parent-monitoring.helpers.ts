/**
 * Module-private helpers for `ParentMonitoringService`.
 *
 * Co-locates the parent-portal read gate (`requireLinkedChild`) with the
 * pure projection mappers that turn raw repository rows into the
 * parent-facing read shapes. The gate is the single authorization spine
 * every per-student read in the service funnels through, run inside ONE
 * transaction with the data reads so the link grant and the row scan
 * share a single READ COMMITTED snapshot — there is no time-of-check to
 * time-of-use window between gate and read.
 *
 * Disciplines enforced here mirror the same-domain sibling
 * `parent-link-request.helpers.ts`:
 *  - Identity and tenancy decisions NEVER log child fields — the denial
 *    context bag is exactly `{ code, entity, entityId: <studentId>,
 *    locale }`. A missing id, a foreign id, a never-linked id, a severed
 *    child, and a malformed id all produce the SAME constant
 *    `ForbiddenError` byte-shape and exactly ONE bounded
 *    `logDomainError` (oracle posture — the caller cannot distinguish
 *    the denial cause).
 *  - Projection mappers are pure (no I/O, no side effects); they NEVER
 *    fabricate zeros for absent fields — a null grade stays null, a null
 *    surah/juz reference stays null, a fully-null homework track is
 *    emitted as `null` (no assignment on that track).
 *  - Cross-layer imports only via `@/backend/db/repo` (repos),
 *    `@/backend/enum/...`, `@/backend/lib/...`, `@/backend/types` —
 *    never raw schema access from the service layer.
 *
 * The actor re-check helper (`requireActor`) is the SAME gate used by
 * `ParentLinkRequestService`; the service imports it directly from the
 * same-domain sibling `./parent-link-request.helpers` — it is NOT
 * duplicated here.
 */
import { type ReportForStudentRow, StudentRepository, UserRepository } from "@/backend/db/repo";
import { SessionStatus } from "@/backend/enum/scheduling/session-status.enum";
import { isSurahJuzRef, type SurahJuzRef } from "@/backend/enum/shared/surah-juz-ref.enum";
import { ForbiddenError } from "@/backend/lib/errors";
import { logger } from "@/backend/lib/logger";
import type {
  DBQueryExecutor,
  HomeWorkSelectType,
  ParentAttendanceEntryReturnType,
  ParentChildProgressReturnType,
  ParentChildUpcomingSessionReturnType,
  ParentHomeworkEntryReturnType,
  ParentHomeworkPositionReturnType,
  ParentHomeworkTrackReturnType,
  ParentLinkedChildReturnType,
  ParentPageInput,
  ParentReportEntryReturnType,
  SessionSelectType,
  StudentSelectType,
  UserSelectType,
} from "@/backend/types";
import { getServerTranslations } from "@/shared/locale/server-graphql";

/** Hard cap on the page window a parent-portal list read can request. */
const MAX_PAGE_SIZE = 50;

/** Default page size when the caller omits `pageSize` or supplies an out-of-range value. */
const DEFAULT_PAGE_SIZE = 25;

/** Default page number when the caller omits `page` or supplies an out-of-range value. */
const DEFAULT_PAGE = 1;

/**
 * Type guard — narrows `unknown` to a positive safe integer. Used by the
 * pagination clamp to validate caller-supplied `page` / `pageSize`
 * values without unsafe type assertions.
 */
function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 1;
}

/**
 * Normalizes a caller-supplied pagination request into the effective
 * `(page, pageSize, offset)` triple the repository read consumes. Both
 * members are clamped (never thrown): a missing or non-positive `page`
 * resolves to `1`; a missing or out-of-range `pageSize` resolves to the
 * default. The effective values are echoed back to the caller in the
 * page payload — an out-of-range page yields an empty `items` array next
 * to the true `totalCount`, never a fabricated window.
 */
export function clampPageInput(input: ParentPageInput | undefined): {
  readonly page: number;
  readonly pageSize: number;
  readonly offset: number;
} {
  const rawPage = input?.page;
  const rawPageSize = input?.pageSize;
  const page = isPositiveSafeInteger(rawPage) ? rawPage : DEFAULT_PAGE;
  const pageSize = isPositiveSafeInteger(rawPageSize) && rawPageSize <= MAX_PAGE_SIZE ? rawPageSize : DEFAULT_PAGE_SIZE;
  return { page, pageSize, offset: (page - 1) * pageSize };
}

/**
 * Fail-closed runtime type-guard for a raw `session_status` pgEnum value
 * (a string union on the wire). Returns `true` only for an exact
 * `SessionStatus` member string; fails closed on any other input
 * (wrong type, case mismatch, foreign value).
 */
function isSessionStatus(value: unknown): value is SessionStatus {
  return typeof value === "string" && (Object.values(SessionStatus) as string[]).includes(value);
}

/**
 * Narrows a raw stored `session_status` pgEnum value onto the canonical
 * `SessionStatus` TS enum via the fail-closed {@link isSessionStatus}
 * guard. A corrupt stored value is an internal invariant violation — it
 * NEVER carries the unvalidated string to the wire: the corruption is
 * logged as ONE bounded `logDomainError` (no row fields beyond the
 * entity name) and the call throws fail-closed. Mirrors the
 * `toCanonicalLinkStatus` discipline already established by the
 * parent-link-request helpers.
 */
function toSessionStatus(raw: SessionSelectType["status"]): SessionStatus {
  if (isSessionStatus(raw)) {
    return raw;
  }
  logger.logDomainError("Parent portal read rejected: stored session status failed the enum guard", {
    code: "PARENT_PORTAL_SESSION_STATUS_CORRUPT",
    entity: "session",
    locale: "en",
  });
  throw new Error("ParentMonitoringService: corrupt session_status value");
}

/**
 * Narrows a NON-NULL raw stored `surah_juz_ref` pgEnum value onto the
 * canonical `SurahJuzRef` TS enum via the fail-closed `isSurahJuzRef`
 * guard. Callers MUST null-check the input before calling — the helper
 * treats its input as already-resolved-non-null. A corrupt non-null
 * value is logged as ONE bounded `logDomainError` and the call throws
 * fail-closed (same discipline as {@link toSessionStatus}). The null
 * arm is handled at each call site so the projection preserves the
 * schema's per-field nullability without surprises.
 */
function toSurahJuzRef(raw: NonNullable<HomeWorkSelectType["currentSurahJuz"]>): SurahJuzRef {
  if (isSurahJuzRef(raw)) {
    return raw;
  }
  logger.logDomainError("Parent portal read rejected: stored surah/juz reference failed the enum guard", {
    code: "PARENT_PORTAL_SURAH_JUZ_CORRUPT",
    entity: "home_work",
    locale: "en",
  });
  throw new Error("ParentMonitoringService: corrupt surah_juz_ref value");
}

/**
 * The parent-portal read gate — ONE helper every per-student read in
 * `ParentMonitoringService` funnels through.
 *
 * Resolves the grant by reading the student row (whose `parentId`
 * foreign key IS the grant — nothing else participates) and re-checks
 * the child's `users.isDeleted` flag for soft-delete severance. Denials
 * are constant-shaped: a malformed id, a missing row, a foreign id, a
 * never-linked id, and a severed child all produce the SAME constant
 * `ForbiddenError` (one localized copy from `errorsTranslations.forbidden`)
 * and exactly ONE bounded `logDomainError` whose context bag is exactly
 * `{ code: "FORBIDDEN", entity: "students", entityId: <studentId>,
 * locale }` — never the row's stored fields, never the parent's
 * identity beyond the bound parameter.
 *
 * Child suspended/blocked flags are INTENTIONALLY not consulted here:
 * suspension governs the child's LOGIN posture, not the parent's
 * monitoring posture. Only soft-delete severs a parent's read access.
 *
 * Run inside the caller's transaction so the grant check and the data
 * reads share one READ COMMITTED snapshot — a severance that lands
 * mid-flight cannot extend a returned payload.
 *
 * @returns The matched student row (the grant) when the link is in
 *     force and the child is not soft-deleted.
 * @throws ForbiddenError  Constant denial shape for every other case.
 */
export async function requireLinkedChild(
  parentActorId: number,
  studentId: number,
  locale: string,
  tx: DBQueryExecutor | undefined
): Promise<StudentSelectType> {
  const t = getServerTranslations(locale).errorsTranslations;

  const deny = (): never => {
    logger.logDomainError("Parent portal read denied: link not in force", {
      code: "FORBIDDEN",
      entity: "students",
      entityId: studentId,
      locale,
    });
    throw new ForbiddenError(t.forbidden);
  };

  if (!Number.isSafeInteger(studentId) || studentId <= 0) {
    return deny();
  }

  const student = await StudentRepository.findById(studentId, tx);
  if (student?.parentId !== parentActorId) {
    return deny();
  }

  const childUser = await UserRepository.findById(studentId, tx);
  if (childUser === null || childUser.isDeleted) {
    return deny();
  }

  return student;
}

/**
 * Maps a raw `session` row onto the parent-facing attendance projection.
 *
 * Attendance is a DERIVED surface — there is no dedicated attendance
 * table. Each session row's lifecycle `status` (narrowed fail-closed
 * onto the `SessionStatus` enum) plus the nullable started/ended
 * timestamps ARE the attendance entry. The UI classifies each row from
 * `status`: `completed` renders as attended, `cancelled` as cancelled,
 * `disputed` is surfaced (not hidden), `scheduled`/`started` as
 * upcoming/in-progress.
 */
export function mapSessionToAttendanceEntry(row: SessionSelectType): ParentAttendanceEntryReturnType {
  return {
    id: row.id,
    status: toSessionStatus(row.status),
    startedAt: row.startedAt,
    endedAt: row.endedAt,
    createdAt: row.createdAt,
  };
}

/**
 * Maps a raw `session` row onto the parent-facing upcoming-session glance
 * projection (the parent dashboard's "What's next" card row shape).
 *
 * The projection is only ever fed rows the repository already narrowed to
 * the `scheduled` lifecycle state, so no status column crosses the
 * boundary (the glance card never invents lifecycle semantics — it
 * renders what the read guarantees). `fee` passes through VERBATIM (a
 * nullable decimal rendered on the wire as its string form — the money
 * discipline: no arithmetic, no re-formatting, a null fee stays null)
 * and `createdAt` is the booking stamp the row renders.
 */
export function mapSessionToUpcomingEntry(row: SessionSelectType): ParentChildUpcomingSessionReturnType {
  return {
    sessionId: row.id,
    fee: row.fee,
    createdAt: row.createdAt,
  };
}

/**
 * Maps a raw report+session joined row onto the parent-facing report
 * projection. Both `teacherNotes` and `studentRatingByTeacher` pass
 * through unchanged (already nullable on the row) — an absent rating
 * never becomes a fabricated 0; absent notes never become an empty
 * string. The `sessionStatus` pgEnum string is narrowed fail-closed
 * onto the `SessionStatus` enum; the `sessionStartedAt` nullable date
 * passes through unchanged.
 */
export function mapReportRowToEntry(row: ReportForStudentRow): ParentReportEntryReturnType {
  return {
    id: row.id,
    sessionId: row.sessionId,
    sessionStatus: toSessionStatus(row.sessionStatus),
    sessionStartedAt: row.sessionStartedAt,
    teacherNotes: row.teacherNotes,
    studentRatingByTeacher: row.studentRatingByTeacher,
    createdAt: row.createdAt,
  };
}

/**
 * Composes a single homework track (Jadid or Madi) projection from the
 * four raw columns of one track block.
 *
 * A fully-null block (all four columns null) collapses to `null` — "no
 * assignment on this track". A non-null block carries its own per-field
 * nullability: a row may record a surah/juz reference without an ayah
 * range, or carry an ayah range before grading records the grade. The
 * surah/juz pgEnum string is narrowed fail-closed onto the `SurahJuzRef`
 * enum; ayah and grade pass through unchanged (already nullable).
 *
 * NEVER fabricates zeros — a null grade stays null, a null ayah range
 * stays null. The presence of a single non-null field is enough to keep
 * the block non-null (the projection is honest about partial data).
 */
function composeHomeworkTrack(
  surahJuz: HomeWorkSelectType["currentSurahJuz"],
  fromAyah: HomeWorkSelectType["currentFromAyah"],
  toAyah: HomeWorkSelectType["currentToAyah"],
  grade: HomeWorkSelectType["currentGrade"]
): ParentHomeworkTrackReturnType | null {
  if (surahJuz === null && fromAyah === null && toAyah === null && grade === null) {
    return null;
  }
  return {
    surahJuz: surahJuz === null ? null : toSurahJuzRef(surahJuz),
    fromAyah,
    toAyah,
    grade,
  };
}

/**
 * Maps a raw `home_work` row onto the parent-facing homework projection,
 * splitting the two parallel track blocks (Jadid from the `current_*`
 * columns, Madi from the `revision_*` columns). Each block is composed
 * independently — either, both, or neither may be null.
 */
export function mapHomeWorkRowToEntry(row: HomeWorkSelectType): ParentHomeworkEntryReturnType {
  return {
    id: row.id,
    sessionId: row.sessionId,
    jadid: composeHomeworkTrack(row.currentSurahJuz, row.currentFromAyah, row.currentToAyah, row.currentGrade),
    madi: composeHomeworkTrack(row.revisionSurahJuz, row.revisionFromAyah, row.revisionToAyah, row.revisionGrade),
    createdAt: row.createdAt,
  };
}

/**
 * Derives a single curriculum position slot (Jadid or Madi) from the
 * newest homework row's track block.
 *
 * A position is emitted ONLY when the row carries a surah/juz reference
 * on that track — `surahJuz` is non-null by construction on the
 * returned shape (the position is the curriculum locator). When the row
 * is null (no homework rows at all) or the track's surah/juz reference
 * is null, the position is `null` (the curriculum has not yet reached
 * this track). The ayah range stays nullable because a track may
 * record a surah/juz reference without a numeric range.
 */
function composeHomeworkPosition(
  row: HomeWorkSelectType | null,
  surahJuz: HomeWorkSelectType["currentSurahJuz"] | null,
  fromAyah: HomeWorkSelectType["currentFromAyah"] | null,
  toAyah: HomeWorkSelectType["currentToAyah"] | null
): ParentHomeworkPositionReturnType | null {
  if (row === null || surahJuz === null) {
    return null;
  }
  return {
    surahJuz: toSurahJuzRef(surahJuz),
    fromAyah,
    toAyah,
  };
}

/**
 * Composes the parent-facing child-progress payload from the gated
 * child echo, the honest progress row count, and the newest homework
 * row. The child header (id, fullName, createdAt) and the progress
 * signals (count + latest positions per track) ride ONE payload — fewer
 * authorization seams than a separate overview surface.
 *
 * The `child` echo is composed from the student row's `id`/`createdAt`
 * and the user row's `fullName` (the shared primary key lets the gate
 * resolve both in one transaction snapshot). `progressRowCount` is the
 * honest COUNT — zero means "no recorded progress yet" (never a
 * fabricated percentage). Each `latest*Position` is `null` when the
 * newest homework row carries no surah/juz reference on that track.
 */
export function composeChildProgress(
  student: StudentSelectType,
  childUser: UserSelectType,
  progressRowCount: number,
  latestHomeWork: HomeWorkSelectType | null
): ParentChildProgressReturnType {
  const child: ParentLinkedChildReturnType = {
    id: student.id,
    fullName: childUser.fullName,
    createdAt: student.createdAt,
  };
  return {
    child,
    progressRowCount,
    latestJadidPosition: composeHomeworkPosition(
      latestHomeWork,
      latestHomeWork?.currentSurahJuz ?? null,
      latestHomeWork?.currentFromAyah ?? null,
      latestHomeWork?.currentToAyah ?? null
    ),
    latestMadiPosition: composeHomeworkPosition(
      latestHomeWork,
      latestHomeWork?.revisionSurahJuz ?? null,
      latestHomeWork?.revisionFromAyah ?? null,
      latestHomeWork?.revisionToAyah ?? null
    ),
  };
}
