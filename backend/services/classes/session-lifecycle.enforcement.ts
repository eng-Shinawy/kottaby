/**
 * SessionLifecycleService — enforcement module: the canonical
 * session transition matrix plus the shared INV-S7/INV-S8/INV-A2-seam gate
 * functions future surfaces consume instead of re-implementing inline
 * status checks.
 *
 * `SESSION_TRANSITION_MATRIX` is the closed `from → to` vocabulary of the
 * session state machine (INV-S1: `completed` is terminal; INV-S2:
 * `cancelled` is terminal; `disputed` is exited ONLY by admin arbitration
 * into a terminal state — B.18):
 *
 *   scheduled → { started, cancelled, disputed }
 *   started   → { completed, cancelled, disputed }
 *   disputed  → { completed, cancelled }
 *   completed → { }
 *   cancelled → { }
 *
 * The matrix is a PURE module-level constant (no DB, no logging, O(1)
 * lookup, no per-call allocation) and is the single source of truth for
 * legal transitions: it is a consulted lookup — the enforcement suite's
 * truth-table tests (`session-lifecycle.enforcement.test.ts`) ask it what
 * is legal, pinning matrix↔guarded-writer consistency — rather than an
 * embedded switch re-declared inside every guarded writer (the writers
 * keep their own inline pre-state predicates, so shipped write paths are
 * untouched), which keeps every transition rule in one auditable place.
 *
 * The gates are the shared enforcement points:
 *  - `assertSessionCompletedForReport` (INV-S7) — reports may only be
 *    submitted for `completed` sessions (the report surface consumes it);
 *  - `assertReportSubmittedForHomework` (INV-S8) — homework may only be
 *    created for sessions whose report exists (the homework surface consumes it);
 *  - `assertTeacherNotInActiveSession` (the availability-toggle seam) —
 *    a teacher in a `started` session cannot be toggled available.
 *
 * Every gate executes on the CALLER's transaction (`tx` propagated, never
 * one of its own), reads only through repository surfaces, takes only
 * server-derived ids (never client payloads — BOPLA), and denies with the
 * localized `ConflictError` shapes of the lifecycle vocabulary (exactly
 * one `logger.logDomainError` per denial site; happy paths silent). The
 * denials are internal-only surfaces: participation/authorization checks
 * belong to the consuming caller BEFORE the gate — the gates widen no
 * existence oracle (a wrong-state row and an unknown id are
 * indistinguishable at this layer by design).
 *
 * Localization: the `t` parameter is OPTIONAL — callers that already hold
 * the request's `errorsTranslations` (the consuming service methods) pass
 * it through; omission falls back to the platform default locale through
 * the compile-time translation system (never a hardcoded string).
 *
 * @see docs/sessions/session-lifecycle.md §10 — the consumer table this
 *      module closes.
 * @see docs/specs/state-machine-invariants.md §1 — INV-S1..S8 vocabulary.
 */

import { ReportRepository, SessionRepository } from "@/backend/db/repo";
import { SessionStatus } from "@/backend/enum/scheduling/session-status.enum";
import { ConflictError } from "@/backend/lib/errors";
import { logger } from "@/backend/lib/logger";
import type { DBTransaction } from "@/backend/types";
import { defaultLocale } from "@/shared/locale/AppLocale";
import { getServerTranslations } from "@/shared/locale/server-graphql";

/** The localized-denial vocabulary type every flow resolves up front. */
type ErrorsTranslations = ReturnType<typeof getServerTranslations>["errorsTranslations"];

/**
 * The canonical transition matrix — the closed legal `from → to` map.
 * Keys are the `SessionStatus` members; values are the statuses the row
 * may legally move TO (an empty set marks a terminal state). Frozen
 * vocabulary: future writers extend THIS table, never private literals.
 */
export const SESSION_TRANSITION_MATRIX: Readonly<Record<SessionStatus, ReadonlySet<SessionStatus>>> = {
  [SessionStatus.Scheduled]: new Set<SessionStatus>([
    SessionStatus.Started,
    SessionStatus.Cancelled,
    SessionStatus.Disputed,
  ]),
  [SessionStatus.Started]: new Set<SessionStatus>([
    SessionStatus.Completed,
    SessionStatus.Cancelled,
    SessionStatus.Disputed,
  ]),
  [SessionStatus.Disputed]: new Set<SessionStatus>([SessionStatus.Completed, SessionStatus.Cancelled]),
  [SessionStatus.Completed]: new Set<SessionStatus>([]),
  [SessionStatus.Cancelled]: new Set<SessionStatus>([]),
};

/**
 * Answers whether the `from → to` move is a matrix member. Pure and
 * allocation-free: `true` ONLY for legal edges (INV-S1/S2 make every
 * `from` a terminal status `false`), `false` for every off-matrix pair —
 * including identical-status no-ops (a transition is a state CHANGE).
 */
export function isSessionTransitionAllowed(from: SessionStatus, to: SessionStatus): boolean {
  return SESSION_TRANSITION_MATRIX[from]?.has(to) ?? false;
}

/**
 * Resolves the denial vocabulary when the caller did not supply one: the
 * compile-time translation system at the platform default locale (pure,
 * in-memory — no I/O). Called only on the denial path, so happy paths
 * never pay for it.
 */
function denialTranslations(t: ErrorsTranslations | undefined): ErrorsTranslations {
  return t ?? getServerTranslations(defaultLocale).errorsTranslations;
}

/**
 * INV-S7 gate — a report may be submitted ONLY for a `completed` session.
 *
 * Reads the session on the caller's transaction through the repository
 * and denies every non-`completed` row with the SAME localized
 * `SESSION_INVALID_TRANSITION` conflict the lifecycle transitions use —
 * an unknown id denies identically (the gates are internal-only; the
 * consuming caller applies participation checks first, so no existence
 * oracle is widened here).
 *
 * @param sessionId  The server-derived session id (never a client payload).
 * @param tx  The caller's transaction — propagated to the read; the gate
 *     never opens its own.
 * @param t  Optional pre-resolved denial vocabulary (the caller's request
 *     locale); defaults to the platform default locale.
 * @returns Nothing — the gate PASSES silently when the row is `completed`.
 * @throws ConflictError (`SESSION_INVALID_TRANSITION`) for every
 *     non-`completed` outcome.
 */
export async function assertSessionCompletedForReport(
  sessionId: number,
  tx: DBTransaction,
  t?: ErrorsTranslations
): Promise<void> {
  const row = await SessionRepository.findById(sessionId, tx);
  if (row?.status !== SessionStatus.Completed) {
    logger.logDomainError("Session report gate denied: session is not completed", {
      code: "SESSION_INVALID_TRANSITION",
      entity: "session",
      entityId: sessionId,
    });
    throw new ConflictError("SESSION_INVALID_TRANSITION", denialTranslations(t).sessionInvalidTransition);
  }
}

/**
 * INV-S8 gate — homework may be created ONLY for a session whose report
 * exists.
 *
 * Probes the `reports` table on the caller's transaction through the
 * repository's EXISTS-style read and denies every report-less session
 * with the localized `HOMEWORK_REQUIRES_REPORT` conflict. Session
 * completion is NOT re-checked here — the INV-S7 gate owns that
 * precondition and the homework flow composes both gates in order (report
 * submission already passed INV-S7, so the homework flow asserts the
 * report exists).
 *
 * @param sessionId  The server-derived session id (never a client payload).
 * @param tx  The caller's transaction — propagated to the read; the gate
 *     never opens its own.
 * @param t  Optional pre-resolved denial vocabulary (the caller's request
 *     locale); defaults to the platform default locale.
 * @returns Nothing — the gate PASSES silently when a report row exists.
 * @throws ConflictError (`HOMEWORK_REQUIRES_REPORT`) when no report row
 *     references the session.
 */
export async function assertReportSubmittedForHomework(
  sessionId: number,
  tx: DBTransaction,
  t?: ErrorsTranslations
): Promise<void> {
  const reportExists = await ReportRepository.existsReportForSession(sessionId, tx);
  if (!reportExists) {
    logger.logDomainError("Session homework gate denied: no report submitted for the session", {
      code: "HOMEWORK_REQUIRES_REPORT",
      entity: "session",
      entityId: sessionId,
    });
    throw new ConflictError("HOMEWORK_REQUIRES_REPORT", denialTranslations(t).homeworkRequiresReport);
  }
}

/**
 * The availability-toggle seam gate — a teacher currently in a
 * `started` session cannot be toggled available.
 *
 * Probes the teacher's own sessions on the caller's transaction for any
 * still-`started` row (window of one — the gate answers existence, never
 * enumerates). The denial is FORBIDDEN-class and carries NO session id:
 * the availability surface may learn only THAT the teacher is locked,
 * never which session holds the lock (oracle ruling).
 *
 * @param teacherId  The server-derived teacher id (the `teacher` row's
 *     shared PK).
 * @param tx  The caller's transaction — propagated to the read; the gate
 *     never opens its own.
 * @param t  Optional pre-resolved denial vocabulary (the caller's request
 *     locale); defaults to the platform default locale.
 * @returns Nothing — the gate PASSES silently when no session is active.
 * @throws ConflictError (`TEACHER_IN_ACTIVE_SESSION`) when a `started`
 *     session exists for the teacher.
 */
export async function assertTeacherNotInActiveSession(
  teacherId: number,
  tx: DBTransaction,
  t?: ErrorsTranslations
): Promise<void> {
  const activeSessions = await SessionRepository.listForTeacher(teacherId, { status: SessionStatus.Started }, 1, 0, tx);
  if (activeSessions.length > 0) {
    logger.logDomainError("Teacher availability gate denied: teacher is in an active session", {
      code: "TEACHER_IN_ACTIVE_SESSION",
      entity: "teacher",
      entityId: teacherId,
    });
    throw new ConflictError("TEACHER_IN_ACTIVE_SESSION", denialTranslations(t).teacherInActiveSession);
  }
}
