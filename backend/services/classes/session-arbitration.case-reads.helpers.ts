/**
 * SessionArbitrationService case-read helpers — the dispute family's three
 * case-READ bundles (the admin evidence read, the teacher participant read,
 * and the student filing-party mirror), extracted verbatim from the
 * `SessionArbitrationService` namespace (the function-size tier split; the
 * wallet repository's admin-helpers convention). The namespace keeps
 * one-to-one delegation wrappers so the public surface (names, signatures,
 * behavior) is unchanged.
 *
 * Every read performs ZERO writes of any kind; artifacts that were never
 * produced surface as honest `null`s — never fabricated placeholders.
 */
import {
  HomeWorkRepository,
  RecitationRepository,
  ReportRepository,
  SessionRepository,
  UserRepository,
} from "@/backend/db/repo";
import { NotFoundError } from "@/backend/lib/errors";
import { logger } from "@/backend/lib/logger";
import { AuditTrailService } from "@/backend/services/admin/audit-trail.service";
import { SessionAdminGovernanceService } from "@/backend/services/classes/session-admin-governance";
import { assertAdminGovernanceClean } from "@/backend/services/classes/session-lifecycle.governance";
import type {
  AdminDisputeCaseReturnType,
  DBTransaction,
  StudentDisputeCaseReturnType,
  TeacherDisputeCaseReturnType,
} from "@/backend/types";
import { getServerTranslations } from "@/shared/locale/server-graphql";

/** The audit-trail read's entity label (the short lowercase entity label). */
const SESSION_ENTITY_TYPE = "session";

/** The case-read audit-trail page size (the trail service's largest single page). */
const CASE_AUDIT_PAGE_SIZE = 100;

/**
 * Reads the full dispute case for one session, as an ADMIN — the
 * evidence bundle behind the arbitration decision.
 *
 * The admin gate is re-asserted first (defense in depth over the scope
 * gate), then the session detail is read through the admin
 * browse/detail service (the same any-state read the governance console
 * uses; its own gate re-run is the same belt). An unknown or malformed
 * id surfaces as the localized not-found denial — the admin surface
 * distinguishes state, never oracle details. The remaining artifacts are
 * composed as concurrent independent reads on the caller's transaction:
 * the session report, the homework row, the recitation record, and the
 * session-scoped audit trail (single largest page — a session's
 * arbitration history is bounded by its own lifecycle). Artifacts that
 * were never produced surface as honest `null`s / an empty trail — never
 * fabricated placeholders. The read performs ZERO writes of any kind.
 *
 * @param adminId  The acting admin's id (never client input).
 * @param sessionId  The target session id.
 * @param locale  Active request locale (for the localized error messages).
 * @param tx  Optional transaction — propagated to every read so a
 *     caller-owned atomic flow stays atomic.
 * @returns The case bundle: the session detail plus each artifact (or an
 *     honest `null`) and the session-scoped trail entries.
 */
export async function getAdminDisputeCase(
  adminId: number,
  sessionId: number,
  locale: string,
  tx?: DBTransaction
): Promise<AdminDisputeCaseReturnType> {
  const t = getServerTranslations(locale).errorsTranslations;

  // The service-side governance-clean admin gate — the FIRST statement.
  await assertAdminGovernanceClean(adminId, t, tx);

  // The admin browse/detail service is the session-detail source; its
  // oracle-safe null (unknown or malformed id) surfaces here as the
  // localized not-found denial.
  const detail = await SessionAdminGovernanceService.getDetail(adminId, sessionId, locale, tx);
  if (detail === null) {
    logger.logDomainError("Admin dispute case denied: session not found", {
      code: "SESSION_NOT_FOUND",
      entity: "session",
      entityId: sessionId,
    });
    throw new NotFoundError("SESSION", t.sessionNotFound);
  }

  // Concurrent independent reads — the artifacts share no write path and
  // no ordering requirement; the executor serializes them on the
  // caller's connection. The participant display names ride the same
  // batch so the case bundle composes in one round of reads.
  const [report, homework, recitation, auditTrailPage, studentUser, teacherUser] = await Promise.all([
    ReportRepository.findBySessionId(sessionId, tx),
    HomeWorkRepository.findBySessionId(sessionId, tx),
    RecitationRepository.findBySessionId(sessionId, tx),
    AuditTrailService.listAuditTrail(
      { entityType: SESSION_ENTITY_TYPE, entityId: sessionId },
      1,
      CASE_AUDIT_PAGE_SIZE,
      locale,
      adminId,
      tx
    ),
    UserRepository.findById(detail.studentId, tx),
    UserRepository.findById(detail.teacherId, tx),
  ]);

  return {
    session: detail,
    report,
    homework,
    recitation,
    auditTrail: auditTrailPage.items,
    studentName: studentUser?.fullName ?? null,
    teacherName: teacherUser?.fullName ?? null,
  };
}

/**
 * Reads the dispute case for one session, as the session's OWN TEACHER —
 * the teacher-side transparency bundle behind the arbitration story.
 *
 * The participant predicate is the security boundary: the session row is
 * read first and a missing row OR a row owned by a different teacher
 * surfaces as the SAME localized not-found denial — non-participants and
 * nonexistent ids are indistinguishable (the dispute family's oracle-safe
 * collapse; no existence leak to a non-party). The scope gate already
 * pinned the caller to the Teacher role; this predicate narrows it to THE
 * teacher of THIS session. The remaining artifacts are composed as
 * concurrent independent reads on the caller's transaction: the session
 * report, the homework row and the recitation record (all
 * participant-owned artifacts the teacher authored or owns), plus the
 * student display name. The session-scoped audit trail is deliberately
 * NOT part of this bundle — the trail read asserts an ADMIN actor, and
 * widening it for participants would change the governance surface's
 * authorization story; the teacher's transparency comes from the dispute
 * evidence itself. Artifacts that were never produced surface as honest
 * `null`s — never fabricated placeholders. The read performs ZERO writes
 * of any kind.
 *
 * @param teacherId  The acting teacher's id (never client input).
 * @param sessionId  The target session id.
 * @param locale  Active request locale (for the localized error messages).
 * @param tx  Optional transaction — propagated to every read so a
 *     caller-owned atomic flow stays atomic.
 * @returns The case bundle: the session detail plus each participant-owned
 *     artifact (or an honest `null`) and the student display name.
 */
export async function getTeacherDisputeCase(
  teacherId: number,
  sessionId: number,
  locale: string,
  tx?: DBTransaction
): Promise<TeacherDisputeCaseReturnType> {
  const t = getServerTranslations(locale).errorsTranslations;

  // The wire-shape guard FIRST: a malformed `ID` arrives as a non-finite
  // number (the shared decimal-coercion at the resolver), and feeding it
  // to the driver would surface as a masked transport error instead of
  // the documented denial. It collapses into the SAME oracle-safe
  // not-found as a non-participant hit — no DB round-trip spent.
  if (!Number.isSafeInteger(sessionId) || sessionId <= 0) {
    logger.logDomainError("Teacher dispute case denied: malformed session id", {
      code: "SESSION_NOT_FOUND",
      entity: "session",
      entityId: sessionId,
    });
    throw new NotFoundError("SESSION", t.sessionNotFound);
  }

  // The session row next — it is BOTH the existence check and the
  // participant predicate.
  const session = await SessionRepository.findById(sessionId, tx);
  if (session?.teacherId !== teacherId) {
    logger.logDomainError("Teacher dispute case denied: session not found or not owned", {
      code: "SESSION_NOT_FOUND",
      entity: "session",
      entityId: sessionId,
    });
    throw new NotFoundError("SESSION", t.sessionNotFound);
  }

  // Concurrent independent reads — the artifacts share no write path and
  // no ordering requirement; the executor serializes them on the
  // caller's connection. The student display name rides the same batch.
  const [report, homework, recitation, studentUser] = await Promise.all([
    ReportRepository.findBySessionId(sessionId, tx),
    HomeWorkRepository.findBySessionId(sessionId, tx),
    RecitationRepository.findBySessionId(sessionId, tx),
    UserRepository.findById(session.studentId, tx),
  ]);

  return {
    session,
    report,
    homework,
    recitation,
    studentName: studentUser?.fullName ?? null,
  };
}

/**
 * Reads the dispute case for one session, as the session's OWN STUDENT —
 * the filing participant's mirror of `getTeacherDisputeCase` behind the
 * arbitration story. The participant predicate is the security boundary,
 * identical in shape to the teacher read: the session row is read first
 * and a missing row OR a row owned by a different student surfaces as the
 * SAME localized not-found denial — non-participants and nonexistent ids
 * are indistinguishable (the dispute family's oracle-safe collapse; no
 * existence leak to a non-party). The scope gate pins the caller to the
 * Student role; this predicate narrows it to THE student of THIS session
 * (the dispute's filing party on the post-confirmation path). The
 * artifacts compose as concurrent independent reads on the caller's
 * transaction — the session report (the teacher's authored evidence the
 * student has a stake in seeing), the homework row and the recitation
 * record — plus the TEACHER display name (the counterparty the student
 * filed against; the caller's own name is equally absent — the student
 * knows who they are). The admin-only audit trail is deliberately NOT
 * part of this bundle (same rationale as the teacher read). Absent
 * artifacts surface as honest `null`s — never fabricated placeholders.
 * The read performs ZERO writes of any kind.
 *
 * @param studentId  The acting student's id (never client input).
 * @param sessionId  The target session id.
 * @param locale  Active request locale (for the localized error messages).
 * @param tx  Optional transaction — propagated to every read so a
 *     caller-owned atomic flow stays atomic.
 * @returns The case bundle: the session detail plus each participant-owned
 *     artifact (or an honest `null`) and the teacher display name.
 */
export async function getStudentDisputeCase(
  studentId: number,
  sessionId: number,
  locale: string,
  tx?: DBTransaction
): Promise<StudentDisputeCaseReturnType> {
  const t = getServerTranslations(locale).errorsTranslations;

  // The wire-shape guard FIRST (the teacher read's identical oracle): a
  // malformed `ID` arrives as a non-finite number (the shared
  // decimal-coercion at the resolver), and feeding it to the driver would
  // surface as a masked transport error instead of the documented denial.
  // It collapses into the SAME oracle-safe not-found as a non-participant
  // hit — no DB round-trip spent.
  if (!Number.isSafeInteger(sessionId) || sessionId <= 0) {
    logger.logDomainError("Student dispute case denied: malformed session id", {
      code: "SESSION_NOT_FOUND",
      entity: "session",
      entityId: sessionId,
    });
    throw new NotFoundError("SESSION", t.sessionNotFound);
  }

  // The session row next — it is BOTH the existence check and the
  // participant predicate.
  const session = await SessionRepository.findById(sessionId, tx);
  if (session?.studentId !== studentId) {
    logger.logDomainError("Student dispute case denied: session not found or not owned", {
      code: "SESSION_NOT_FOUND",
      entity: "session",
      entityId: sessionId,
    });
    throw new NotFoundError("SESSION", t.sessionNotFound);
  }

  // Concurrent independent reads — the artifacts share no write path and
  // no ordering requirement; the executor serializes them on the
  // caller's connection. The teacher display name rides the same batch.
  const [report, homework, recitation, teacherUser] = await Promise.all([
    ReportRepository.findBySessionId(sessionId, tx),
    HomeWorkRepository.findBySessionId(sessionId, tx),
    RecitationRepository.findBySessionId(sessionId, tx),
    UserRepository.findById(session.teacherId, tx),
  ]);

  return {
    session,
    report,
    homework,
    recitation,
    teacherName: teacherUser?.fullName ?? null,
  };
}
