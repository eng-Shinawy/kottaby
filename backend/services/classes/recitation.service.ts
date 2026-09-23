/**
 * RecitationRecordService — the write-once recitation record of a session
 * and its participant-scoped read.
 *
 * The `recitation` row is the 1:1 companion of a `session`: the owning
 * `session_id` is NOT NULL, cascades on session deletion, and is UNIQUE —
 * one record per session, enforced by the database itself. This service is
 * the single write/read seam over that contract:
 *
 *  - `setSessionRecitation` records the recitation of a HAPPENED session
 *    as its owning teacher. The pipeline order is the contract: pre-DB
 *    shape guards (target id + submission payload) fail before any
 *    database read; the actor's governance state is re-asserted before
 *    the transaction opens (defense in depth for still-valid tokens);
 *    then ONE transaction resolves the session by id, collapses a miss
 *    or a non-owner onto the identical session-not-found denial (a
 *    foreign id is byte-indistinguishable from one that never was), and
 *    rejects a session that never happened (`scheduled`/`cancelled`).
 *    The insert is the pipeline's only write; the per-session unique
 *    constraint is the arbiter of the write-once rule — a duplicate
 *    surfaces as the typed conflict, and the stored record is never
 *    updated or replaced (no such surface exists).
 *  - `getSessionRecitation` is the oracle-safe read: a malformed id, an
 *    id beyond the int4 session-id ceiling, an unknown session, and a
 *    non-participant caller all collapse to the same `null`, and a
 *    participant receives the row when it exists and `null` when the
 *    session is not yet recorded. No read path raises.
 *
 * Cross-surface purity: the service writes to the `recitation` table
 * ONLY — zero notification, audit, wallet, ledger, or session-row writes
 * (the session lifecycle owns the session row exclusively), and it never
 * imports the notification or audit surfaces.
 *
 * All user-facing messages resolve through `getServerTranslations(locale)`;
 * every denial logs exactly ONE bounded `logger.logDomainError` entry
 * (code, entity, entity id, locale — never the submitted payload, never a
 * counterparty value), while happy paths and collapse-to-null reads log
 * nothing. No module-level mutable state; every repository call inside the
 * write flow receives the SAME transaction.
 */

import { RecitationRepository, SessionRepository } from "@/backend/db/repo";
import { SessionStatus } from "@/backend/enum/scheduling/session-status.enum";
import { withTransaction } from "@/backend/lib/db/with-transaction";
import { ConflictError, NotFoundError, ValidationError } from "@/backend/lib/errors";
import { logger } from "@/backend/lib/logger";
import { assertActorGovernanceClean } from "@/backend/services/classes/session-lifecycle.governance";
import {
  assertPositiveSafeSessionId,
  isPositiveSafeSessionId,
} from "@/backend/services/classes/session-lifecycle.guards";
import { isUniqueViolation } from "@/backend/services/shared";
import type {
  ApiFieldErrorType,
  DBQueryExecutor,
  DBTransaction,
  RecitationReturnType,
  SessionRecitationSubmitInput,
} from "@/backend/types";
import { getServerTranslations } from "@/shared/locale/server-graphql";

/** Ceiling of the record's `name` column (`varchar(255)`). */
const RECORD_NAME_MAX_LENGTH = 255;

/** Ceiling of the record's free-form `description` notes. */
const RECORD_DESCRIPTION_MAX_LENGTH = 2000;

/**
 * Highest value the session table's int4 primary key can store (2^31 − 1).
 * A read of any id beyond it collapses to `null` BEFORE the database read:
 * such an id can never match a row, and a query that carried one would die
 * as a driver-level out-of-range failure instead of the answer `null`.
 */
const SESSION_ID_INT4_CEILING = 2_147_483_647;

/**
 * The two non-recordable lifecycle states widened to plain strings: the
 * session row's `status` is the raw pg-enum string union, so the writeability
 * comparison needs the enum members' string identity without a runtime
 * conversion — the vocabulary still flows from the enum, never from bare
 * literals (the guards-module widening idiom).
 */
const SESSION_SCHEDULED_STATUS: string = SessionStatus.Scheduled;
const SESSION_CANCELLED_STATUS: string = SessionStatus.Cancelled;

/**
 * Type guard — narrows the read executor to a Drizzle transaction.
 *
 * `DBTransaction` exposes the `.select()` builder API; raw `Pool` /
 * `PoolClient` do not. The presence of `.select` distinguishes the two at
 * runtime without an unsafe cast (the repo-layer guard idiom). The session
 * lookup is transaction-aware only — a pool executor falls back to that
 * repository's parameterized cold read, which resolves the same row.
 */
function isTransactionExecutor(tx: DBQueryExecutor): tx is DBTransaction {
  return typeof tx === "object" && "select" in tx;
}

/**
 * Normalizes the submission whitelist BEFORE any database work: the name is
 * trimmed and kept non-empty within the column ceiling, the notes are
 * trimmed, emptied to `null`, and capped. Every offending field is
 * projected by NAME — never the submitted content — so the denial's field
 * payload can name the offending input without ever carrying it.
 */
function normalizeSubmission(
  input: SessionRecitationSubmitInput,
  t: ReturnType<typeof getServerTranslations>["errorsTranslations"]
): { readonly name: string; readonly description: string | null; readonly fieldErrors: readonly ApiFieldErrorType[] } {
  const fieldErrors: ApiFieldErrorType[] = [];
  const name = input.name.trim();
  if (name.length === 0) {
    fieldErrors.push({ field: "name", code: "NAME_REQUIRED", message: t.validation });
  } else if (name.length > RECORD_NAME_MAX_LENGTH) {
    fieldErrors.push({ field: "name", code: "NAME_TOO_LONG", message: t.validation });
  }
  let description: string | null = null;
  if (input.description !== null) {
    const trimmedDescription = input.description.trim();
    if (trimmedDescription.length > RECORD_DESCRIPTION_MAX_LENGTH) {
      fieldErrors.push({ field: "description", code: "DESCRIPTION_TOO_LONG", message: t.validation });
    } else if (trimmedDescription.length > 0) {
      description = trimmedDescription;
    }
  }
  return { name, description, fieldErrors };
}

/**
 * Collapses an id beyond the session table's int4 ceiling to the canonical
 * session-not-found denial BEFORE any database read: such an id can never
 * match a row, and SQL would answer a write carrying one with a
 * driver-level out-of-range failure instead of the uniform denial.
 * Byte-identical to the foreign/nonexistent denial (existence is never an
 * oracle) — the SAME bounded denial log and the SAME localized message.
 */
function assertSessionIdWithinInt4Ceiling(
  sessionId: number,
  t: ReturnType<typeof getServerTranslations>["errorsTranslations"],
  locale: string
): void {
  if (sessionId <= SESSION_ID_INT4_CEILING) {
    return;
  }
  logger.logDomainError("Recitation record denied: session not found for the owning teacher", {
    code: "SESSION_NOT_FOUND",
    entity: "session",
    entityId: sessionId,
    locale,
  });
  throw new NotFoundError("SESSION", t.sessionNotFound);
}

export namespace RecitationRecordService {
  /**
   * Records the recitation of a session exactly once, as its owning teacher.
   *
   * The target session id is guarded as a positive safe integer — an id
   * beyond the session table's int4 ceiling collapses to the byte-identical
   * session-not-found denial before any database read — and the submission
   * payload is normalized (the name trimmed and kept non-empty
   * within the column ceiling; the notes trimmed, emptied to `null`, and
   * capped) BEFORE any database work — a malformed shape is the canonical
   * `VALIDATION` denial whose field projection names every offending field,
   * so a garbage id can never reach SQL and no payload byte is ever sent
   * to the database. The teacher's governance state is re-asserted next
   * (deleted/blocked/suspended callers are denied before the transaction
   * opens). Inside ONE transaction the session row is resolved by id: a
   * miss and a non-owning teacher surface the identical session-not-found
   * denial (existence is never an oracle), a session that never happened
   * (`scheduled`/`cancelled`) is a typed conflict, and otherwise the
   * record is inserted. A session already carrying its record surfaces the
   * typed write-once conflict — the unique constraint is the arbiter, the
   * stored record stays byte-identical, and every other failure inside the
   * transaction is rethrown untouched (the transaction rolls back with
   * zero residual rows).
   *
   * @param teacherUserId  The acting teacher's id (shared PK — the value
   *     stored in the session row's teacher column).
   * @param sessionId  The target session id.
   * @param input  The client-controlled submission whitelist (record name
   *     + optional notes — every other column is server-owned).
   * @param locale  Active request locale (for the localized error messages).
   * @param outerTx  Optional outer transaction. When provided, the flow
   *     runs inside a SAVEPOINT on it; production callers omit it and the
   *     service opens its own transaction.
   * @returns The created record row.
   */
  export async function setSessionRecitation(
    teacherUserId: number,
    sessionId: number,
    input: SessionRecitationSubmitInput,
    locale: string,
    outerTx?: DBTransaction
  ): Promise<RecitationReturnType> {
    const t = getServerTranslations(locale).errorsTranslations;

    // Pre-DB shape guards — fail before any database read, in order.
    //
    // The target id is denied by the shared assertion helper (the canonical
    // VALIDATION throw); the bounded denial log fires once on that path,
    // before the shared guard raises.
    if (!isPositiveSafeSessionId(sessionId)) {
      logger.logDomainError("Recitation record denied: malformed session id", {
        code: "VALIDATION",
        entity: "session",
        entityId: sessionId,
        locale,
      });
    }
    assertPositiveSafeSessionId(sessionId, t);
    assertSessionIdWithinInt4Ceiling(sessionId, t, locale);

    // Payload guard: every offending field is projected into the error
    // payload by NAME — never the submitted content.
    const submission = normalizeSubmission(input, t);
    if (submission.fieldErrors.length > 0) {
      logger.logDomainError("Recitation record denied: invalid submission payload", {
        code: "VALIDATION",
        entity: "recitation",
        entityId: sessionId,
        locale,
      });
      throw new ValidationError(t.validation, submission.fieldErrors);
    }

    // Governance re-check — the acting teacher must be governance-clean.
    // The shared helper emits this path's single bounded FORBIDDEN log.
    await assertActorGovernanceClean(teacherUserId, t, outerTx);

    try {
      return await withTransaction(outerTx, async tx => {
        const sessionRow = await SessionRepository.findById(sessionId, tx);
        if (sessionRow?.teacherId !== teacherUserId) {
          // Foreign ≡ nonexistent — one byte-identical denial, so session
          // existence is never an oracle.
          logger.logDomainError("Recitation record denied: session not found for the owning teacher", {
            code: "SESSION_NOT_FOUND",
            entity: "session",
            entityId: sessionId,
            locale,
          });
          throw new NotFoundError("SESSION", t.sessionNotFound);
        }
        // A recitation records what HAPPENED: only a session that left the
        // booking state admits a record.
        if (sessionRow.status === SESSION_SCHEDULED_STATUS || sessionRow.status === SESSION_CANCELLED_STATUS) {
          logger.logDomainError("Recitation record denied: session state cannot receive a record", {
            code: "RECITATION_SESSION_NOT_WRITEABLE",
            entity: "session",
            entityId: sessionId,
            locale,
          });
          throw new ConflictError("RECITATION_SESSION_NOT_WRITEABLE", t.recitationSessionNotWriteable);
        }
        return RecitationRepository.insertOnce(
          { sessionId, name: submission.name, description: submission.description },
          tx
        );
      });
    } catch (error) {
      // The per-session unique constraint is the write-once arbiter: ONLY
      // a `23505` on the cause chain maps to the typed conflict — every
      // other failure is rethrown untouched (no masked catch).
      if (isUniqueViolation(error)) {
        logger.logDomainError("Recitation record denied: the session already carries a record", {
          code: "RECITATION_ALREADY_EXISTS",
          entity: "recitation",
          entityId: sessionId,
          locale,
        });
        throw new ConflictError("RECITATION_ALREADY_EXISTS", t.recitationAlreadyExists);
      }
      throw error;
    }
  }

  /**
   * Reads the recitation record of a session for one caller.
   *
   * Oracle-safe by construction: a malformed session id (anything but a
   * positive safe integer — the NaN/fractional/overflow shapes a
   * shape-only parse yields for garbage `ID` strings) and an id beyond
   * the int4 session-id ceiling (a positive safe integer the session
   * table cannot represent) resolve to `null` before any database read;
   * an unknown session and a non-participant
   * caller (the participant predicate reads the DB row's teacher and
   * student columns — no caller-supplied identity exists beyond the two
   * arguments) collapse to the SAME `null`; a participant receives the
   * row when the session carries its record and `null` when it does not
   * yet. No read path raises, and nothing is logged: this surface's only
   * answer shapes are the row and `null`.
   *
   * @param callerUserId  The calling user's id.
   * @param sessionId  The target session id.
   * @param tx  Optional read executor — propagated so a caller-owned
   *     atomic flow stays atomic (a pool executor falls back to the
   *     repositories' parameterized cold reads).
   */
  export async function getSessionRecitation(
    callerUserId: number,
    sessionId: number,
    tx?: DBQueryExecutor
  ): Promise<RecitationReturnType | null> {
    // Oracle-safe malformed-id channel: the SAME `null` as a nonexistent
    // id, BEFORE any database read. No error is raised. The int4 ceiling
    // is part of the same channel — an id the session column cannot
    // represent is unmatchable, and SQL would answer a query carrying one
    // with a driver-level failure, never the answer `null`.
    if (!isPositiveSafeSessionId(sessionId) || sessionId > SESSION_ID_INT4_CEILING) {
      return null;
    }

    const sessionRow = await SessionRepository.findById(sessionId, tx && isTransactionExecutor(tx) ? tx : undefined);
    if (sessionRow?.teacherId !== callerUserId && sessionRow?.studentId !== callerUserId) {
      return null;
    }
    return RecitationRepository.findBySessionId(sessionId, tx);
  }
}
