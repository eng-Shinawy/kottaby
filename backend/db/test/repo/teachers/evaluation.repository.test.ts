/**
 * EvaluationRepository tests — the `evaluations` table's data-access layer
 * (`insertOnce`, `listByEvaluator`, `aggregateLiveRatings`) against the live
 * test database.
 *
 * Per `backend/db/test/AGENTS.md`:
 *  - Rollback-isolated tests run inside `runInRollback`; `tx` is passed to
 *    EVERY repo call, entity-setup helper, and direct Drizzle query (on
 *    every method under test `tx` is the LAST parameter).
 *  - Entities are created ONLY via `entity-setup.ts` helpers plus the
 *    file-local actor helper — never seed data.
 *  - No `expect(...).rejects.toThrow()` — constraint probes go through
 *    `expectRepoError` inside an explicit SAVEPOINT bracket so the outer
 *    transaction stays queryable.
 *  - A separate committed-fixture group covers the STANDALONE executor
 *    branches (the `queryDb` read and the raw pool executor that falls
 *    through to it). Those branches by definition run without a
 *    transaction, so their fixtures must be committed (an uncommitted row
 *    is invisible outside the tx); they are registered and hard-deleted in
 *    `afterAll` (rule 9), keeping the repo/ directory's 100%-coverage
 *    mandate (rule 14) honest.
 *  - The concurrency tier commits its fixtures too (two independent
 *    transactions racing for the same unique key cannot live inside one
 *    rolled-back tx); those fixtures are registered and hard-deleted in
 *    `afterAll` as well.
 *
 * Coverage map:
 *  - Tier 1 (branch/stmt): happy insert returns the exact RETURNING shape
 *    and persists the four supplied columns; the list hit returns the
 *    evaluator's rows, the miss returns an empty list (never null); the
 *    standalone `queryDb` read and the raw-pool executor fall-through run
 *    the same live-row filter.
 *  - Tier 2 (boundary): nullable `session_id` (the applicant-evaluation
 *    shape) stores null and two NULL-session rows from the same evaluator
 *    coexist (PostgreSQL treats NULLs as distinct — the unique arbiter
 *    never fires); the `is_deleted` tri-state (false / null / true) —
 *    only an explicit deleted flag excludes a row, and another evaluator's
 *    row never leaks; score boundaries 0 and 100 are accepted raw (the
 *    table CHECK is the backstop); newest-first ordering with the id DESC
 *    tiebreak between rows created in the same instant.
 *  - Tier 3 (chaos): a duplicate insert inside one transaction raises the
 *    RAW `23505` unique violation naming
 *    `evaluations_session_evaluator_unique` (the repository does NOT
 *    translate it — mapping into a domain conflict is the service's job);
 *    two independent transactions racing `insertOnce` for the same
 *    (session, evaluator) pair under `Promise.allSettled` produce exactly
 *    one winner and one loser (raw 23505), and the loser's transaction
 *    inserts zero rows.
 *  - Tier 4 (security/static): enormous and absurd ids — an enormous or
 *    negative evaluator id lists empty, a nonexistent rated subject is
 *    rejected by the FK (raw `23503`, no translation); static source pins —
 *    bound parameters only, no wildcard select, no prepared statements, no
 *    SQL line-comment sequences, a REQUIRED (non-optional) tx on the
 *    write, no global-handle fallback, caller-scoped read (no rated-subject
 *    filter parameter), no i18n/logger/console, one namespace, no
 *    plan-artifact references.
 *  - Invariant residual tier (runInRollback, savepoint-bracketed): the
 *    score CHECK trips RAW `23514` on `evaluations_score_check` for the
 *    concrete out-of-range integers 101 and -1 (the column is nullable —
 *    NULL passes a CHECK, so only concrete integers can trip it); an
 *    orphan evaluator id trips the restrict FK (RAW `23503` on
 *    `evaluations_evaluator_id_users_id_fkey`). Both probes leave the
 *    evaluator's history empty.
 *  - Retention tier (committed fixtures): the session set-null survival
 *    pin — a committed session-linked evaluation survives its session
 *    row's hard-delete with `session_id` NULL and every scored column
 *    intact (the schema's ON DELETE SET NULL is the entire retention
 *    story; the table carries no delete guard).
 *  - The Tier 4 source pins include the surface-absence pin: no
 *    `.delete(` call, no DELETE statement, and no exported member named
 *    for delete/softDelete/update — the "not hard-deleted" half of the
 *    soft-delete invariant is enforced solely by this absence.
 *  - aggregateLiveRatings tier (runInRollback): the live family mean is
 *    the exact JS-number average with the honest sample count; applicant
 *    rows (NULL session), soft-deleted rows, and NULL-score rows are each
 *    excluded from BOTH the mean and the count; an empty family and a
 *    fully-excluded family yield the honest `{ averageScore: null,
 *    ratingCount: 0 }`; scale boundaries 20/100 arrive as exact JS
 *    numbers (the float8 cast guarantee); absurd subject ids are
 *    bound-parameter safe — no match, and an id beyond the int4 domain is
 *    rejected loudly by the parameter typing (raw 22003).
 *  - Rubric payload tier (runInRollback): `insertOnce` persists the two
 *    rubric-only members — notes plus the failing score's weakness area —
 *    and the NULL-weakness passing shape; a duplicate rubric insert still
 *    raises the RAW 23505 on `evaluations_session_evaluator_unique` (the
 *    widened payload changes nothing about the arbiter).
 *  - findBySessionAndEvaluator tier (runInRollback): the pair read hits
 *    for its own (session, evaluator) — including a SOFT-DELETED row (the
 *    unique arbiter's slot view, which the pre-check must not filter) —
 *    observes the caller transaction's own uncommitted insert, misses for
 *    a foreign evaluator / unknown session / absurd ids.
 *  - listCycleRubricSubmissions tier (runInRollback): the quorum read
 *    counts scored submissions across DISTINCT completed evaluation
 *    sessions of one applicant, earliest first, with the mapped weakness
 *    members; unscored rows, non-completed sessions, mistyped sessions,
 *    and other applicants' rows never join; a hostile scored row joined
 *    through the applicant's own session but evaluated for someone else
 *    (the row's evaluated-subject leg ≠ the applicant) never joins either;
 *    the half-open created_at
 *    window bounds the cycle; absurd applicant ids are bound-parameter
 *    safe (raw 22003 beyond the int4 domain).
 *  - tx propagation: an insert made with the explicit `tx` inside
 *    `runInRollback` is absent afterwards, observed via a fresh executor
 *    read against the table.
 */

import { afterAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { and, eq, sql } from "drizzle-orm";
import { Pool } from "pg";
import { db } from "@/backend/db";
import { EvaluationRepository, SessionRepository } from "@/backend/db/repo";
import { session } from "@/backend/db/schema/classes/session";
import { students } from "@/backend/db/schema/students/students";
import { evaluations } from "@/backend/db/schema/teachers/evaluations";
import { teacher } from "@/backend/db/schema/teachers/teacher";
import { users } from "@/backend/db/schema/users/users";
import {
  createTestApplicant,
  createTestEvaluation,
  createTestPlan,
  createTestSession,
  createTestStudent,
  createTestSubscription,
  createTestTeacherRow,
  createTestUser,
} from "@/backend/db/test/entity-setup";
import {
  expectCheckViolation,
  expectFkViolation,
  probeInsideSavepoint,
} from "@/backend/db/test/logic/invariants/invariant-probe.helpers";
import { constraintNameOf, expectRepoError, runInRollback } from "@/backend/db/test/test-utils";
import { SubscriptionStatus } from "@/backend/enum/billing/subscription-status.enum";
import { SessionStatus } from "@/backend/enum/scheduling/session-status.enum";
import { SessionType } from "@/backend/enum/scheduling/session-type.enum";
import { ApplicantStatus } from "@/backend/enum/teachers/applicant-status.enum";
import { RubricWeaknessArea } from "@/backend/enum/teachers/rubric-weakness-area.enum";
import type {
  DBTransaction,
  EvaluationRatingAggregateType,
  EvaluationSelectType,
  SessionSelectType,
} from "@/backend/types";
import { VERIFICATION_PLAN_TITLE } from "@/shared/constants/verification-plan.constants";
import { isPgliteProvider } from "@/test/helpers/skip-when-pglite";

/** PostgreSQL error code for `unique_violation`. */
const PG_UNIQUE_VIOLATION = "23505";

/** PostgreSQL error code for `foreign_key_violation`. */
const PG_FOREIGN_KEY_VIOLATION = "23503";

/** PostgreSQL error code for `numeric_value_out_of_range`. */
const PG_NUMERIC_VALUE_OUT_OF_RANGE = "22003";

/** The `evaluations` select-shape keys (TS property names), locale-sorted. */
const EVALUATION_ROW_KEYS = [
  "createdAt",
  "deletedAt",
  "evaluatedId",
  "evaluatorId",
  "id",
  "isDeleted",
  "notes",
  "score",
  "sessionId",
  "updatedAt",
  "weaknessArea",
] as const;

/** Shared-PK ids for one rating cast (evaluated subject, rater, session). */
interface RatingCast {
  evaluatedId: number;
  evaluatorId: number;
  sessionId: number;
}

/** Creates one rated subject (teacher) + one rater (student) pair with shared-PK rows. */
async function createRatingCast(tx: DBTransaction): Promise<Omit<RatingCast, "sessionId">> {
  const teacherUser = await createTestUser(tx, { role: "teacher" });
  await createTestTeacherRow(tx, teacherUser.id);
  const studentUser = await createTestUser(tx, { role: "student" });
  await createTestStudent(tx, studentUser.id);
  return { evaluatedId: teacherUser.id, evaluatorId: studentUser.id };
}

/** Creates a completed, dual-confirmed session for the cast (ratings hang off those). */
async function createConfirmedSession(tx: DBTransaction, cast: Omit<RatingCast, "sessionId">) {
  return createTestSession(tx, cast.evaluatedId, cast.evaluatorId, {
    status: SessionStatus.Completed,
    startedAt: new Date(),
    endedAt: new Date(),
    confirmedByTeacherAt: new Date(),
    confirmedByStudentAt: new Date(),
  });
}

/** Creates one extra rater (user + student role-child row) beyond the primary cast. */
async function createExtraRater(tx: DBTransaction): Promise<number> {
  const raterUser = await createTestUser(tx, { role: "student" });
  await createTestStudent(tx, raterUser.id);
  return raterUser.id;
}

/** Shared instant for the rubric fixtures' session/evaluation timestamps. */
const RUBRIC_NOW = new Date();

/**
 * Creates one rubric cast: an applicant (bare user — the evaluated leg) and
 * a certified-evaluator-shaped user (teacher row on the shared PK — the
 * session's teacher leg FK targets `teacher.id`).
 */
async function createRubricCast(tx: DBTransaction): Promise<{ applicantId: number; evaluatorId: number }> {
  const applicant = await createTestUser(tx, { role: "teacher" });
  const evaluator = await createTestUser(tx, { role: "teacher" });
  await createTestTeacherRow(tx, evaluator.id);
  return { applicantId: applicant.id, evaluatorId: evaluator.id };
}

/** Creates one extra evaluator (user + teacher role-child row) beyond the primary cast. */
async function createExtraEvaluator(tx: DBTransaction): Promise<number> {
  const evaluatorUser = await createTestUser(tx, { role: "teacher" });
  await createTestTeacherRow(tx, evaluatorUser.id);
  return evaluatorUser.id;
}

/** Books one completed `teacher_evaluation` session for the cast. */
async function createCompletedEvaluationSession(
  tx: DBTransaction,
  applicantId: number,
  evaluatorId: number,
  overrides: Partial<SessionSelectType> = {}
) {
  return createTestSession(tx, evaluatorId, applicantId, {
    sessionType: SessionType.TeacherEvaluation,
    status: SessionStatus.Completed,
    startedAt: RUBRIC_NOW,
    endedAt: RUBRIC_NOW,
    createdAt: RUBRIC_NOW,
    ...overrides,
  });
}

/** Inserts one rubric submission: session-linked, scored, notes, optional weakness. */
async function insertRubricSubmission(
  tx: DBTransaction,
  applicantId: number,
  evaluatorId: number,
  sessionId: number,
  score: number,
  weaknessArea: RubricWeaknessArea | null,
  notes = "qualitative observations"
) {
  return EvaluationRepository.insertOnce(
    { evaluatedId: applicantId, evaluatorId, sessionId, score, notes, weaknessArea },
    tx
  );
}

/**
 * Walks the Drizzle `DrizzleQueryError.cause` chain to find whether the
 * original PostgreSQL error carries the given SQLSTATE code — Drizzle wraps
 * driver errors behind its own generic "failed query" message.
 */
function hasPostgresErrorCode(error: unknown, pgCode: string): boolean {
  let current: unknown = error;
  const seen = new Set<unknown>();
  while (current instanceof Error && !seen.has(current)) {
    seen.add(current);
    if ("code" in current && current.code === pgCode) {
      return true;
    }
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

/** Reads one evaluation row straight off the table (read-back oracle). */
async function readEvaluationRow(tx: DBTransaction, id: number): Promise<EvaluationSelectType> {
  const [row] = await tx.select().from(evaluations).where(eq(evaluations.id, id)).limit(1);
  if (!row) {
    throw new Error("readEvaluationRow: expected the evaluation row to exist");
  }
  return row;
}

/**
 * Committed fixtures (standalone executor + concurrency tiers) — every id
 * registered here is hard-deleted in `afterAll` in FK-dependency order:
 * evaluations first, then sessions (the session FK is SET NULL but the
 * participants' FKs are restrict-bound), then the role-child rows, then
 * the users.
 */
const committedEvaluationIds: number[] = [];
const committedSessionIds: number[] = [];
const committedUserIds: number[] = [];

/** Commits one rating cast (subject, rater, dual-confirmed session) outside any rollback tx. */
async function createCommittedCast(): Promise<RatingCast> {
  return db.transaction(async tx => {
    const cast = await createRatingCast(tx);
    const ratedSession = await createConfirmedSession(tx, cast);
    committedUserIds.push(cast.evaluatedId, cast.evaluatorId);
    committedSessionIds.push(ratedSession.id);
    return { ...cast, sessionId: ratedSession.id };
  });
}

afterAll(async () => {
  await Promise.all(committedEvaluationIds.map(id => db.delete(evaluations).where(eq(evaluations.id, id))));
  committedEvaluationIds.length = 0;
  await Promise.all(committedSessionIds.map(id => db.delete(session).where(eq(session.id, id))));
  committedSessionIds.length = 0;
  await Promise.all(
    committedUserIds.map(async userId => {
      await db.delete(teacher).where(eq(teacher.id, userId));
      await db.delete(students).where(eq(students.id, userId));
      await db.delete(users).where(eq(users.id, userId));
    })
  );
  committedUserIds.length = 0;
});

describe("EvaluationRepository — transactional paths (runInRollback)", () => {
  // ─── Tier 1: branch/statement ───────────────────────────────────────

  test("insertOnce returns the inserted row with every server-generated column populated", async () => {
    await runInRollback(async tx => {
      const cast = await createRatingCast(tx);
      const ratedSession = await createConfirmedSession(tx, cast);

      const inserted = await EvaluationRepository.insertOnce(
        { evaluatedId: cast.evaluatedId, evaluatorId: cast.evaluatorId, sessionId: ratedSession.id, score: 80 },
        tx
      );

      expect(inserted.id).toBeGreaterThan(0);
      expect(inserted.evaluatedId).toBe(cast.evaluatedId);
      expect(inserted.evaluatorId).toBe(cast.evaluatorId);
      expect(inserted.sessionId).toBe(ratedSession.id);
      expect(inserted.score).toBe(80);
      // Schema defaults filled the rest of the row.
      expect(inserted.isDeleted).toBe(false);
      expect(inserted.deletedAt).toBeNull();
      expect(inserted.notes).toBeNull();
      expect(inserted.createdAt).not.toBeNull();
      expect(inserted.updatedAt).not.toBeNull();
      // RETURNING mirrors the $inferSelect shape 1:1 — exactly the ten
      // table columns, nothing added, nothing dropped.
      expect(Object.keys(inserted).toSorted((a, b) => a.localeCompare(b))).toEqual([...EVALUATION_ROW_KEYS]);
    });
  });

  test("listByEvaluator returns the evaluator's own rows on the caller's transaction", async () => {
    await runInRollback(async tx => {
      const cast = await createRatingCast(tx);
      const ratedSession = await createConfirmedSession(tx, cast);
      const first = await EvaluationRepository.insertOnce(
        { evaluatedId: cast.evaluatedId, evaluatorId: cast.evaluatorId, sessionId: ratedSession.id, score: 80 },
        tx
      );

      const rows = await EvaluationRepository.listByEvaluator(cast.evaluatorId, tx);

      expect(rows).toHaveLength(1);
      expect(rows[0]?.id).toBe(first.id);
      expect(rows[0]?.sessionId).toBe(ratedSession.id);
      expect(Object.keys(rows[0] ?? {}).toSorted((a, b) => a.localeCompare(b))).toEqual([...EVALUATION_ROW_KEYS]);
    });
  });

  test("listByEvaluator returns an empty list (never null) for an evaluator with no rows", async () => {
    await runInRollback(async tx => {
      const cast = await createRatingCast(tx);

      const rows = await EvaluationRepository.listByEvaluator(cast.evaluatorId, tx);

      expect(rows).toEqual([]);
    });
  });

  // ─── Tier 2: boundary / tri-state ───────────────────────────────────

  test("a NULL session_id stores null and two NULL-session rows from the same evaluator coexist", async () => {
    await runInRollback(async tx => {
      const cast = await createRatingCast(tx);

      const applicant = await EvaluationRepository.insertOnce(
        { evaluatedId: cast.evaluatedId, evaluatorId: cast.evaluatorId, sessionId: null, score: 90 },
        tx
      );
      const secondApplicant = await EvaluationRepository.insertOnce(
        { evaluatedId: cast.evaluatedId, evaluatorId: cast.evaluatorId, sessionId: null, score: 70 },
        tx
      );

      // PostgreSQL unique semantics treat NULLs as distinct: the second
      // NULL-session insert for the SAME evaluator never collides.
      expect(secondApplicant.id).not.toBe(applicant.id);
      const rows = await EvaluationRepository.listByEvaluator(cast.evaluatorId, tx);
      expect(rows.map(row => row.sessionId)).toEqual([null, null]);
      expect(rows.map(row => row.score).toSorted((a, b) => (a ?? 0) - (b ?? 0))).toEqual([70, 90]);
    });
  });

  test("only an explicit deleted flag excludes a row; another evaluator's row never leaks", async () => {
    await runInRollback(async tx => {
      const cast = await createRatingCast(tx);
      const otherStudent = await createTestUser(tx, { role: "student" });
      await createTestStudent(tx, otherStudent.id);
      const live = await createTestEvaluation(tx, cast.evaluatedId, cast.evaluatorId, null, {
        isDeleted: false,
        score: 60,
      });
      const nullFlag = await createTestEvaluation(tx, cast.evaluatedId, cast.evaluatorId, null, {
        isDeleted: null,
        score: 70,
      });
      const softDeleted = await createTestEvaluation(tx, cast.evaluatedId, cast.evaluatorId, null, {
        isDeleted: true,
        deletedAt: new Date(),
        score: 80,
      });
      const foreign = await createTestEvaluation(tx, cast.evaluatedId, otherStudent.id, null, { score: 90 });

      const rows = await EvaluationRepository.listByEvaluator(cast.evaluatorId, tx);

      // The explicit soft-delete is excluded; the NULL flag is live; the
      // other evaluator's row is outside the caller's scope.
      expect(rows.map(row => row.id)).toEqual([nullFlag.id, live.id]);
      expect(rows.map(row => row.isDeleted)).toEqual([null, false]);
      const listedIds = new Set(rows.map(row => row.id));
      expect(listedIds.has(softDeleted.id)).toBe(false);
      expect(listedIds.has(foreign.id)).toBe(false);
    });
  });

  test("score boundaries 0 and 100 are accepted raw (the table CHECK is the backstop)", async () => {
    await runInRollback(async tx => {
      const cast = await createRatingCast(tx);

      const floor = await EvaluationRepository.insertOnce(
        { evaluatedId: cast.evaluatedId, evaluatorId: cast.evaluatorId, sessionId: null, score: 0 },
        tx
      );
      const ceiling = await EvaluationRepository.insertOnce(
        { evaluatedId: cast.evaluatedId, evaluatorId: cast.evaluatorId, sessionId: null, score: 100 },
        tx
      );

      expect(floor.score).toBe(0);
      expect(ceiling.score).toBe(100);
      expect((await readEvaluationRow(tx, floor.id)).score).toBe(0);
      expect((await readEvaluationRow(tx, ceiling.id)).score).toBe(100);
    });
  });

  test("orders newest first with the id DESC tiebreak between rows created in the same instant", async () => {
    await runInRollback(async tx => {
      const cast = await createRatingCast(tx);
      const earlier = new Date(1_700_000_000_000);
      const instant = new Date(1_700_000_060_000);
      // Insert order A, B, C: A and B share the later instant (A gets the
      // LOWER id), C carries the earlier instant.
      const a = await createTestEvaluation(tx, cast.evaluatedId, cast.evaluatorId, null, { createdAt: instant });
      const b = await createTestEvaluation(tx, cast.evaluatedId, cast.evaluatorId, null, { createdAt: instant });
      const c = await createTestEvaluation(tx, cast.evaluatedId, cast.evaluatorId, null, { createdAt: earlier });

      const rows = await EvaluationRepository.listByEvaluator(cast.evaluatorId, tx);

      expect(rows.map(row => row.id)).toEqual([b.id, a.id, c.id]);
      expect(rows.map(row => row.createdAt)).toEqual([instant, instant, earlier]);
    });
  });

  // ─── Tier 3: chaos — the unique arbiter fires untranslated ──────────

  test("a duplicate (session, evaluator) insert raises the RAW 23505 on evaluations_session_evaluator_unique", async () => {
    await runInRollback(async tx => {
      const cast = await createRatingCast(tx);
      const ratedSession = await createConfirmedSession(tx, cast);
      const first = await EvaluationRepository.insertOnce(
        { evaluatedId: cast.evaluatedId, evaluatorId: cast.evaluatorId, sessionId: ratedSession.id, score: 80 },
        tx
      );

      await tx.execute(sql`savepoint evaluations_unique_probe`);
      const duplicateError = await expectRepoError(() =>
        EvaluationRepository.insertOnce(
          { evaluatedId: cast.evaluatedId, evaluatorId: cast.evaluatorId, sessionId: ratedSession.id, score: 60 },
          tx
        )
      );
      await tx.execute(sql`rollback to savepoint evaluations_unique_probe`);

      expect(hasPostgresErrorCode(duplicateError, PG_UNIQUE_VIOLATION)).toBe(true);
      expect(constraintNameOf(duplicateError)).toBe("evaluations_session_evaluator_unique");
      // The repository surfaces the raw driver error untouched — no domain
      // error class, no translated message (the service layer owns both).
      expect(duplicateError.constructor.name).not.toBe("ConflictError");
      expect(duplicateError.constructor.name).not.toBe("DomainError");
      expect(constraintNameOf(duplicateError)).not.toBe("");

      // The savepoint bracket kept the transaction queryable and the
      // winner's row intact.
      const winner = await readEvaluationRow(tx, first.id);
      expect(winner.score).toBe(80);
      const rows = await EvaluationRepository.listByEvaluator(cast.evaluatorId, tx);
      expect(rows.map(row => row.id)).toEqual([first.id]);
    });
  });

  test("INV-E1: insertOnce with concrete 101/-1 raises raw 23514 on evaluations_score_check (savepoint; column nullable — concrete integers)", async () => {
    await runInRollback(async tx => {
      const cast = await createRatingCast(tx);
      const ratedSession = await createConfirmedSession(tx, cast);

      // The score column is nullable, so NULL sails past the CHECK — the
      // probes use concrete out-of-range integers on both sides of the
      // 0-100 window, each in the session-linked production shape.
      const aboveError = await probeInsideSavepoint(tx, "evaluations score ceiling probe", () =>
        EvaluationRepository.insertOnce(
          { evaluatedId: cast.evaluatedId, evaluatorId: cast.evaluatorId, sessionId: ratedSession.id, score: 101 },
          tx
        )
      );
      expectCheckViolation(aboveError, "evaluations_score_check");
      // The raw driver error reaches the caller untouched — the
      // service-level score guards are upstream and absent here.
      expect(aboveError.constructor.name).not.toBe("ConflictError");
      expect(aboveError.constructor.name).not.toBe("DomainError");

      const belowError = await probeInsideSavepoint(tx, "evaluations score floor probe", () =>
        EvaluationRepository.insertOnce(
          { evaluatedId: cast.evaluatedId, evaluatorId: cast.evaluatorId, sessionId: ratedSession.id, score: -1 },
          tx
        )
      );
      expectCheckViolation(belowError, "evaluations_score_check");

      // Both savepoint brackets rolled back — the evaluator's history
      // carries no residue from either rejected insert.
      expect(await EvaluationRepository.listByEvaluator(cast.evaluatorId, tx)).toEqual([]);
    });
  });

  // ─── tx propagation ─────────────────────────────────────────────────

  test("an insert made with the explicit tx inside runInRollback rolls back with the block", async () => {
    let doomedEvaluatorId = 0;
    let doomedSessionId: number | null = 0;
    await runInRollback(async tx => {
      const cast = await createRatingCast(tx);
      const ratedSession = await createConfirmedSession(tx, cast);
      const inserted = await EvaluationRepository.insertOnce(
        { evaluatedId: cast.evaluatedId, evaluatorId: cast.evaluatorId, sessionId: ratedSession.id, score: 40 },
        tx
      );
      doomedEvaluatorId = inserted.evaluatorId;
      doomedSessionId = inserted.sessionId;
      expect(inserted.id).toBeGreaterThan(0);
    });

    // Fresh executor read — the forced rollback removed the row.
    const absent = await db
      .select()
      .from(evaluations)
      .where(and(eq(evaluations.evaluatorId, doomedEvaluatorId), eq(evaluations.sessionId, doomedSessionId)));
    expect(absent).toHaveLength(0);
  });

  // ─── Tier 4: enormous / absurd ids ──────────────────────────────────

  test("an enormous evaluator id lists empty; an absurd negative id lists empty too", async () => {
    await runInRollback(async tx => {
      // The id column is int4, so the enormous probe stays inside the
      // column's domain — far past any real sequential id, still bindable.
      expect(await EvaluationRepository.listByEvaluator(2_147_483_647, tx)).toEqual([]);
      expect(await EvaluationRepository.listByEvaluator(-1, tx)).toEqual([]);
    });
  });

  test("a nonexistent rated subject is rejected by the FK — the raw 23503 surfaces untranslated", async () => {
    await runInRollback(async tx => {
      const cast = await createRatingCast(tx);
      const [absentUser] = await tx.select({ maxId: sql<number>`coalesce(max(${users.id}), 0)::int` }).from(users);
      const enormousSubjectId = (absentUser?.maxId ?? 0) + 1_000_000;

      const fkError = await expectRepoError(() =>
        EvaluationRepository.insertOnce(
          { evaluatedId: enormousSubjectId, evaluatorId: cast.evaluatorId, sessionId: null, score: 80 },
          tx
        )
      );

      expect(hasPostgresErrorCode(fkError, PG_FOREIGN_KEY_VIOLATION)).toBe(true);
      expect(constraintNameOf(fkError)).not.toBe("");
      // No domain translation: the raw driver error reaches the caller.
      expect(fkError.constructor.name).not.toBe("NotFoundError");
      expect(fkError.constructor.name).not.toBe("ConflictError");
    });
  });

  test("INV-E3: an orphan evaluator id raises 23503 on evaluations_evaluator_id_users_id_fkey (savepoint)", async () => {
    await runInRollback(async tx => {
      const cast = await createRatingCast(tx);
      const [absentUser] = await tx.select({ maxId: sql<number>`coalesce(max(${users.id}), 0)::int` }).from(users);
      const enormousEvaluatorId = (absentUser?.maxId ?? 0) + 1_000_000;

      // The evaluator leg is restrict-bound: a rater that does not exist
      // can never own an evaluation row. The probe is savepoint-bracketed
      // so the outer transaction stays queryable after the rejection.
      const fkError = await probeInsideSavepoint(tx, "evaluations evaluator fk probe", () =>
        EvaluationRepository.insertOnce(
          { evaluatedId: cast.evaluatedId, evaluatorId: enormousEvaluatorId, sessionId: null, score: 80 },
          tx
        )
      );
      expectFkViolation(fkError, "evaluations_evaluator_id_users_id_fkey");

      // The bracket rolled back — the real evaluator's history is empty.
      expect(await EvaluationRepository.listByEvaluator(cast.evaluatorId, tx)).toEqual([]);
    });
  });
});

describe("EvaluationRepository.insertOnce — the rubric payload (runInRollback)", () => {
  // ─── Tier 1: branch/statement ───────────────────────────────────────

  test("stores the rubric payload: notes plus the failing score's weakness area", async () => {
    await runInRollback(async tx => {
      const cast = await createRubricCast(tx);
      const evalSession = await createCompletedEvaluationSession(tx, cast.applicantId, cast.evaluatorId);

      const inserted = await insertRubricSubmission(
        tx,
        cast.applicantId,
        cast.evaluatorId,
        evalSession.id,
        65,
        RubricWeaknessArea.Tajweed,
        "needs madd work"
      );

      expect(inserted.id).toBeGreaterThan(0);
      expect(inserted.evaluatedId).toBe(cast.applicantId);
      expect(inserted.sessionId).toBe(evalSession.id);
      expect(inserted.score).toBe(65);
      expect(inserted.notes).toBe("needs madd work");
      expect(inserted.weaknessArea).toBe(RubricWeaknessArea.Tajweed);
      // Read-back oracle: the stored row carries the same members.
      const persisted = await readEvaluationRow(tx, inserted.id);
      expect(persisted.notes).toBe("needs madd work");
      expect(persisted.weaknessArea).toBe(RubricWeaknessArea.Tajweed);
    });
  });

  test("stores a NULL weakness area for a passing score (the rating flow's shape)", async () => {
    await runInRollback(async tx => {
      const cast = await createRubricCast(tx);
      const evalSession = await createCompletedEvaluationSession(tx, cast.applicantId, cast.evaluatorId);

      const inserted = await insertRubricSubmission(
        tx,
        cast.applicantId,
        cast.evaluatorId,
        evalSession.id,
        80,
        null,
        "strong recitation"
      );

      expect(inserted.score).toBe(80);
      expect(inserted.notes).toBe("strong recitation");
      expect(inserted.weaknessArea).toBeNull();
    });
  });

  // ─── Tier 3: the widened payload changes nothing about the arbiter ──

  test("a duplicate rubric insert (notes + weakness) still raises the RAW 23505 on the unique arbiter", async () => {
    await runInRollback(async tx => {
      const cast = await createRubricCast(tx);
      const evalSession = await createCompletedEvaluationSession(tx, cast.applicantId, cast.evaluatorId);
      const first = await insertRubricSubmission(
        tx,
        cast.applicantId,
        cast.evaluatorId,
        evalSession.id,
        65,
        RubricWeaknessArea.Tajweed
      );

      await tx.execute(sql`savepoint rubric_duplicate_probe`);
      const duplicateError = await expectRepoError(() =>
        insertRubricSubmission(tx, cast.applicantId, cast.evaluatorId, evalSession.id, 70, RubricWeaknessArea.Hifz)
      );
      await tx.execute(sql`rollback to savepoint rubric_duplicate_probe`);

      expect(hasPostgresErrorCode(duplicateError, PG_UNIQUE_VIOLATION)).toBe(true);
      expect(constraintNameOf(duplicateError)).toBe("evaluations_session_evaluator_unique");
      // The savepoint bracket kept the transaction queryable and the
      // winner's row intact — exactly one row for the pair.
      const rows = await EvaluationRepository.listByEvaluator(cast.evaluatorId, tx);
      expect(rows.map(row => row.id)).toEqual([first.id]);
    });
  });
});

describe("EvaluationRepository.findBySessionAndEvaluator — the pair pre-check read (runInRollback)", () => {
  // ─── Tier 1: branch/statement ───────────────────────────────────────

  test("returns the pair's row for its own (session, evaluator) and observes same-tx inserts", async () => {
    await runInRollback(async tx => {
      const cast = await createRubricCast(tx);
      const evalSession = await createCompletedEvaluationSession(tx, cast.applicantId, cast.evaluatorId);
      expect(await EvaluationRepository.findBySessionAndEvaluator(evalSession.id, cast.evaluatorId, tx)).toBeNull();

      const inserted = await insertRubricSubmission(
        tx,
        cast.applicantId,
        cast.evaluatorId,
        evalSession.id,
        72,
        RubricWeaknessArea.Hifz
      );

      const found = await EvaluationRepository.findBySessionAndEvaluator(evalSession.id, cast.evaluatorId, tx);
      expect(found?.id).toBe(inserted.id);
      expect(found?.score).toBe(72);
      expect(found?.weaknessArea).toBe(RubricWeaknessArea.Hifz);
    });
  });

  // ─── Tier 2: the slot view includes soft-deleted rows ───────────────

  test("sees a soft-deleted row — the unique arbiter's slot, which the pre-check must not filter", async () => {
    await runInRollback(async tx => {
      const cast = await createRubricCast(tx);
      const evalSession = await createCompletedEvaluationSession(tx, cast.applicantId, cast.evaluatorId);
      const deleted = await createTestEvaluation(tx, cast.applicantId, cast.evaluatorId, evalSession.id, {
        isDeleted: true,
        deletedAt: new Date(),
        score: 60,
      });

      const found = await EvaluationRepository.findBySessionAndEvaluator(evalSession.id, cast.evaluatorId, tx);

      expect(found?.id).toBe(deleted.id);
      expect(found?.isDeleted).toBe(true);
    });
  });

  test("returns null for a foreign evaluator, an unknown session, and absurd ids", async () => {
    await runInRollback(async tx => {
      const cast = await createRubricCast(tx);
      const otherEvaluator = await createExtraEvaluator(tx);
      const evalSession = await createCompletedEvaluationSession(tx, cast.applicantId, cast.evaluatorId);
      await insertRubricSubmission(tx, cast.applicantId, cast.evaluatorId, evalSession.id, 80, null);

      expect(await EvaluationRepository.findBySessionAndEvaluator(evalSession.id, otherEvaluator, tx)).toBeNull();
      expect(await EvaluationRepository.findBySessionAndEvaluator(2_147_483_647, cast.evaluatorId, tx)).toBeNull();
      expect(await EvaluationRepository.findBySessionAndEvaluator(0, cast.evaluatorId, tx)).toBeNull();
      expect(await EvaluationRepository.findBySessionAndEvaluator(-1, cast.evaluatorId, tx)).toBeNull();
    });
  });
});

describe("EvaluationRepository.listCycleRubricSubmissions — the quorum read (runInRollback)", () => {
  // ─── Tier 1: branch/statement ───────────────────────────────────────

  test("returns the scored submissions across DISTINCT completed evaluation sessions, earliest first", async () => {
    await runInRollback(async tx => {
      const cast = await createRubricCast(tx);
      const secondEvaluator = await createExtraEvaluator(tx);
      const cycleStart = new Date(RUBRIC_NOW.getTime() - 10_000);
      const sessionA = await createCompletedEvaluationSession(tx, cast.applicantId, cast.evaluatorId, {
        createdAt: new Date(RUBRIC_NOW.getTime() - 2_000),
      });
      const sessionB = await createCompletedEvaluationSession(tx, cast.applicantId, secondEvaluator, {
        createdAt: new Date(RUBRIC_NOW.getTime() - 1_000),
      });
      // The submission instants are pinned explicitly: within one
      // transaction PostgreSQL's now() is a single instant, so the read's
      // `created_at ASC, id ASC` order is only observable with distinct
      // stamps.
      await createTestEvaluation(tx, cast.applicantId, cast.evaluatorId, sessionA.id, {
        score: 82,
        createdAt: new Date(RUBRIC_NOW.getTime() - 1_500),
      });
      await createTestEvaluation(tx, cast.applicantId, secondEvaluator, sessionB.id, {
        score: 77,
        weaknessArea: RubricWeaknessArea.Hifz,
        createdAt: new Date(RUBRIC_NOW.getTime() - 500),
      });

      const rows = await EvaluationRepository.listCycleRubricSubmissions(cast.applicantId, cycleStart, tx);

      // Every row is a distinct (session, evaluator) pair by the unique
      // arbiter; the order is earliest submission first.
      expect(rows.map(row => row.sessionId)).toEqual([sessionA.id, sessionB.id]);
      expect(rows.map(row => row.evaluatorId).toSorted((a, b) => a - b)).toEqual(
        [cast.evaluatorId, secondEvaluator].toSorted((a, b) => a - b)
      );
      expect(new Set(rows.map(row => row.evaluatorId)).size).toBe(2);
      expect(rows.map(row => row.score)).toEqual([82, 77]);
      // The sealed projection — exactly the quorum-read keys.
      expect(Object.keys(rows[0] ?? {}).toSorted((a, b) => a.localeCompare(b))).toEqual([
        "createdAt",
        "evaluatorId",
        "id",
        "score",
        "sessionId",
        "weaknessArea",
      ]);
    });
  });

  test("projects the mapped weakness members onto the canonical enum vocabulary", async () => {
    await runInRollback(async tx => {
      const cast = await createRubricCast(tx);
      const cycleStart = new Date(RUBRIC_NOW.getTime() - 10_000);
      const first = await createCompletedEvaluationSession(tx, cast.applicantId, cast.evaluatorId, {
        createdAt: new Date(RUBRIC_NOW.getTime() - 1_000),
      });
      const second = await createCompletedEvaluationSession(tx, cast.applicantId, cast.evaluatorId, {
        createdAt: RUBRIC_NOW,
      });
      await insertRubricSubmission(tx, cast.applicantId, cast.evaluatorId, first.id, 65, RubricWeaknessArea.Tajweed);
      await insertRubricSubmission(tx, cast.applicantId, cast.evaluatorId, second.id, 79, RubricWeaknessArea.Hifz);
      // Distinct submission instants pin the earliest-first order (same-tx
      // now() is one instant — see the distinctness test above).
      await tx
        .update(evaluations)
        .set({ createdAt: new Date(RUBRIC_NOW.getTime() - 1_500) })
        .where(eq(evaluations.sessionId, first.id));
      await tx
        .update(evaluations)
        .set({ createdAt: new Date(RUBRIC_NOW.getTime() - 500) })
        .where(eq(evaluations.sessionId, second.id));

      const rows = await EvaluationRepository.listCycleRubricSubmissions(cast.applicantId, cycleStart, tx);

      expect(rows.map(row => row.weaknessArea)).toEqual([RubricWeaknessArea.Tajweed, RubricWeaknessArea.Hifz]);
      expect(rows.map(row => row.sessionId)).toEqual([first.id, second.id]);
    });
  });

  // ─── Tier 2: the exclusion matrix + cycle window ────────────────────

  test("unscored rows, non-completed and mistyped sessions never join the quorum", async () => {
    await runInRollback(async tx => {
      const cast = await createRubricCast(tx);
      const scored = await createCompletedEvaluationSession(tx, cast.applicantId, cast.evaluatorId);
      await insertRubricSubmission(tx, cast.applicantId, cast.evaluatorId, scored.id, 84, null);

      // Unscored submission on another completed session — not aggregable.
      const unscored = await createCompletedEvaluationSession(tx, cast.applicantId, cast.evaluatorId, {
        createdAt: new Date(RUBRIC_NOW.getTime() + 1_000),
      });
      await createTestEvaluation(tx, cast.applicantId, cast.evaluatorId, unscored.id, { score: null });
      // A scheduled (non-completed) evaluation session with a scored row.
      const scheduled = await createCompletedEvaluationSession(tx, cast.applicantId, cast.evaluatorId, {
        status: SessionStatus.Scheduled,
        startedAt: null,
        endedAt: null,
        createdAt: new Date(RUBRIC_NOW.getTime() + 2_000),
      });
      await createTestEvaluation(tx, cast.applicantId, cast.evaluatorId, scheduled.id, { score: 90 });
      // A mistyped session: a regular student session carrying a scored row.
      await createTestStudent(tx, cast.applicantId);
      const studentSession = await createTestSession(tx, cast.evaluatorId, cast.applicantId, {
        createdAt: new Date(RUBRIC_NOW.getTime() + 3_000),
      });
      await createTestEvaluation(tx, cast.applicantId, cast.evaluatorId, studentSession.id, { score: 95 });
      // A hostile row: joined through the applicant's OWN completed
      // evaluation session (the session's student leg matches) but evaluated
      // for a DIFFERENT user — the row's own evaluated-subject leg fails, so
      // the row is never aggregable for this applicant.
      const foreignSubject = await createTestUser(tx, { role: "teacher" });
      const hostileSession = await createCompletedEvaluationSession(tx, cast.applicantId, cast.evaluatorId, {
        createdAt: new Date(RUBRIC_NOW.getTime() + 4_000),
      });
      await createTestEvaluation(tx, foreignSubject.id, cast.evaluatorId, hostileSession.id, { score: 99 });

      const rows = await EvaluationRepository.listCycleRubricSubmissions(
        cast.applicantId,
        new Date(RUBRIC_NOW.getTime() - 10_000),
        tx
      );

      expect(rows.map(row => row.sessionId)).toEqual([scored.id]);
      expect(rows.map(row => row.score)).toEqual([84]);
    });
  });

  test("other applicants' evaluation sessions never join, and the half-open window bounds the cycle", async () => {
    await runInRollback(async tx => {
      const cast = await createRubricCast(tx);
      const otherApplicant = await createTestUser(tx, { role: "teacher" });
      const cycleStart = new Date(RUBRIC_NOW.getTime() + 10_000);

      // Another applicant's completed, scored evaluation session.
      const foreignSession = await createCompletedEvaluationSession(tx, otherApplicant.id, cast.evaluatorId, {
        createdAt: new Date(cycleStart.getTime() + 1_000),
      });
      await insertRubricSubmission(tx, otherApplicant.id, cast.evaluatorId, foreignSession.id, 90, null);
      // A prior-cycle session for THIS applicant (created before cycleStart).
      const priorSession = await createCompletedEvaluationSession(tx, cast.applicantId, cast.evaluatorId, {
        createdAt: new Date(cycleStart.getTime() - 60_000),
      });
      await insertRubricSubmission(
        tx,
        cast.applicantId,
        cast.evaluatorId,
        priorSession.id,
        70,
        RubricWeaknessArea.Hifz
      );
      // The current-cycle session (created after cycleStart).
      const currentSession = await createCompletedEvaluationSession(tx, cast.applicantId, cast.evaluatorId, {
        createdAt: new Date(cycleStart.getTime() + 1_000),
      });
      await insertRubricSubmission(tx, cast.applicantId, cast.evaluatorId, currentSession.id, 88, null);
      // The exact boundary instant: session.created_at === cycleStart IS
      // included (the window is half-open — `created_at >= cycleStart`).
      const boundarySession = await createCompletedEvaluationSession(tx, cast.applicantId, cast.evaluatorId, {
        createdAt: cycleStart,
      });
      await insertRubricSubmission(tx, cast.applicantId, cast.evaluatorId, boundarySession.id, 75, null);
      // Distinct submission instants pin the earliest-first order (same-tx
      // now() is one instant — see the distinctness test above).
      await tx.update(evaluations).set({ createdAt: cycleStart }).where(eq(evaluations.sessionId, boundarySession.id));
      await tx
        .update(evaluations)
        .set({ createdAt: new Date(cycleStart.getTime() + 1_000) })
        .where(eq(evaluations.sessionId, currentSession.id));

      const rows = await EvaluationRepository.listCycleRubricSubmissions(cast.applicantId, cycleStart, tx);

      // Earliest first: the boundary instant (session.created_at ===
      // cycleStart) joins the quorum and sorts before the +1s current-cycle
      // session; the prior-cycle and foreign sessions stay excluded.
      expect(rows.map(row => row.sessionId)).toEqual([boundarySession.id, currentSession.id]);
      expect(rows.map(row => row.createdAt)).toEqual([cycleStart, new Date(cycleStart.getTime() + 1_000)]);
    });
  });

  // ─── Tier 4: absurd applicant ids ───────────────────────────────────

  test("absurd applicant ids are bound-parameter safe: zero and negative match nothing, out-of-domain is rejected loudly", async () => {
    await runInRollback(async tx => {
      expect(await EvaluationRepository.listCycleRubricSubmissions(0, RUBRIC_NOW, tx)).toEqual([]);
      expect(await EvaluationRepository.listCycleRubricSubmissions(-7, RUBRIC_NOW, tx)).toEqual([]);
      const rangeError = await expectRepoError(() =>
        EvaluationRepository.listCycleRubricSubmissions(Number.MAX_SAFE_INTEGER + 1, RUBRIC_NOW, tx)
      );
      expect(hasPostgresErrorCode(rangeError, PG_NUMERIC_VALUE_OUT_OF_RANGE)).toBe(true);
    });
  });
});

describe("EvaluationRepository.aggregateLiveRatings — the live-family aggregate (runInRollback)", () => {
  // ─── Tier 1: branch/statement ───────────────────────────────────────

  test("the live family mean is the exact JS-number average with the honest sample count", async () => {
    await runInRollback(async tx => {
      const cast = await createRatingCast(tx);
      const ratedSession = await createConfirmedSession(tx, cast);
      const raterTwo = await createExtraRater(tx);
      const raterThree = await createExtraRater(tx);
      await createTestEvaluation(tx, cast.evaluatedId, raterTwo, ratedSession.id, { score: 60 });
      await createTestEvaluation(tx, cast.evaluatedId, cast.evaluatorId, ratedSession.id, { score: 80 });
      await createTestEvaluation(tx, cast.evaluatedId, raterThree, ratedSession.id, { score: 100 });

      const aggregate = await EvaluationRepository.aggregateLiveRatings(cast.evaluatedId, tx);

      expect(aggregate.averageScore).toBe(80);
      expect(aggregate.ratingCount).toBe(3);
      // The float8 cast is the guarantee: both values arrive as JS
      // numbers, never the strings a bare numeric would produce.
      expect(typeof aggregate.averageScore).toBe("number");
      expect(typeof aggregate.ratingCount).toBe("number");
    });
  });

  // ─── Tier 2: boundary / exclusion matrix ────────────────────────────

  test("applicant rows (NULL session_id) are excluded from both the mean and the count", async () => {
    await runInRollback(async tx => {
      const cast = await createRatingCast(tx);
      const ratedSession = await createConfirmedSession(tx, cast);
      await createTestEvaluation(tx, cast.evaluatedId, cast.evaluatorId, ratedSession.id, { score: 60 });
      // The applicant shape: the same rated subject, no session, score 90.
      await createTestEvaluation(tx, cast.evaluatedId, cast.evaluatorId, null, { score: 90 });

      const aggregate = await EvaluationRepository.aggregateLiveRatings(cast.evaluatedId, tx);

      expect(aggregate).toEqual({ averageScore: 60, ratingCount: 1 });
    });
  });

  test("soft-deleted rating rows are excluded from both the mean and the count", async () => {
    await runInRollback(async tx => {
      const cast = await createRatingCast(tx);
      const ratedSession = await createConfirmedSession(tx, cast);
      const deletedRater = await createExtraRater(tx);
      await createTestEvaluation(tx, cast.evaluatedId, cast.evaluatorId, ratedSession.id, { score: 60 });
      await createTestEvaluation(tx, cast.evaluatedId, deletedRater, ratedSession.id, {
        isDeleted: true,
        deletedAt: new Date(),
        score: 100,
      });

      const aggregate = await EvaluationRepository.aggregateLiveRatings(cast.evaluatedId, tx);

      expect(aggregate).toEqual({ averageScore: 60, ratingCount: 1 });
    });
  });

  test("NULL-score rows are excluded from both the mean and the count", async () => {
    await runInRollback(async tx => {
      const cast = await createRatingCast(tx);
      const ratedSession = await createConfirmedSession(tx, cast);
      const unscoredRater = await createExtraRater(tx);
      await createTestEvaluation(tx, cast.evaluatedId, cast.evaluatorId, ratedSession.id, { score: 60 });
      await createTestEvaluation(tx, cast.evaluatedId, unscoredRater, ratedSession.id, { score: null });

      const aggregate = await EvaluationRepository.aggregateLiveRatings(cast.evaluatedId, tx);

      expect(aggregate).toEqual({ averageScore: 60, ratingCount: 1 });
    });
  });

  test("an empty family yields the honest null aggregate (never a fabricated zero)", async () => {
    await runInRollback(async tx => {
      const cast = await createRatingCast(tx);

      const aggregate = await EvaluationRepository.aggregateLiveRatings(cast.evaluatedId, tx);

      expect(aggregate).toEqual({ averageScore: null, ratingCount: 0 });
    });
  });

  test("a rated subject whose rows are ALL excluded (only applicant rows) yields the honest null too", async () => {
    await runInRollback(async tx => {
      const cast = await createRatingCast(tx);
      await createTestEvaluation(tx, cast.evaluatedId, cast.evaluatorId, null, { score: 90 });

      const aggregate = await EvaluationRepository.aggregateLiveRatings(cast.evaluatedId, tx);

      expect(aggregate).toEqual({ averageScore: null, ratingCount: 0 });
    });
  });

  test("the 0-100 scale floor: a single score-20 rating aggregates as the exact JS number 20", async () => {
    await runInRollback(async tx => {
      const cast = await createRatingCast(tx);
      const ratedSession = await createConfirmedSession(tx, cast);
      await createTestEvaluation(tx, cast.evaluatedId, cast.evaluatorId, ratedSession.id, { score: 20 });

      const aggregate = await EvaluationRepository.aggregateLiveRatings(cast.evaluatedId, tx);

      expect(aggregate.averageScore).toBe(20);
      expect(aggregate.ratingCount).toBe(1);
    });
  });

  test("the 0-100 scale ceiling: a single score-100 rating aggregates as the exact JS number 100", async () => {
    await runInRollback(async tx => {
      const cast = await createRatingCast(tx);
      const ratedSession = await createConfirmedSession(tx, cast);
      await createTestEvaluation(tx, cast.evaluatedId, cast.evaluatorId, ratedSession.id, { score: 100 });

      const aggregate = await EvaluationRepository.aggregateLiveRatings(cast.evaluatedId, tx);

      expect(aggregate.averageScore).toBe(100);
      expect(aggregate.ratingCount).toBe(1);
    });
  });

  // ─── Tier 4: absurd ids ─────────────────────────────────────

  test("absurd rated-subject ids are bound-parameter safe: no match, and an unrepresentable id is rejected loudly", async () => {
    await runInRollback(async tx => {
      // Zero and negative ids bind fine and match nothing.
      expect(await EvaluationRepository.aggregateLiveRatings(0, tx)).toEqual({ averageScore: null, ratingCount: 0 });
      expect(await EvaluationRepository.aggregateLiveRatings(-7, tx)).toEqual({ averageScore: null, ratingCount: 0 });
      // An id beyond the int4 column's domain cannot silently coerce into
      // a match: the parameter typing itself rejects it with the raw
      // numeric-out-of-range violation, untranslated.
      const rangeError = await expectRepoError(() =>
        EvaluationRepository.aggregateLiveRatings(Number.MAX_SAFE_INTEGER + 1, tx)
      );
      expect(hasPostgresErrorCode(rangeError, PG_NUMERIC_VALUE_OUT_OF_RANGE)).toBe(true);
    });
  });
});

describe("EvaluationRepository — concurrency tier (committed fixtures, independent transactions)", () => {
  // Two transactions racing for the same unique key need real PostgreSQL's
  // cross-connection index-entry serialization. PGlite is single-connection
  // WASM and cannot host the race.
  const testOnRealPostgres = isPgliteProvider() ? test.skip : test;

  testOnRealPostgres(
    "two concurrent insertOnce calls for the same (session, evaluator) pair yield exactly one winner",
    async () => {
      const cast = await createCommittedCast();

      const outcomes = await Promise.allSettled([
        db.transaction(tx =>
          EvaluationRepository.insertOnce(
            { evaluatedId: cast.evaluatedId, evaluatorId: cast.evaluatorId, sessionId: cast.sessionId, score: 80 },
            tx
          )
        ),
        db.transaction(tx =>
          EvaluationRepository.insertOnce(
            { evaluatedId: cast.evaluatedId, evaluatorId: cast.evaluatorId, sessionId: cast.sessionId, score: 60 },
            tx
          )
        ),
      ]);

      const fulfilled = outcomes.filter(outcome => outcome.status === "fulfilled");
      const rejected = outcomes.filter(outcome => outcome.status === "rejected");
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);

      // The winner's row is the only one for the pair — the loser's
      // transaction inserted zero rows before rolling back.
      const rows = await db
        .select()
        .from(evaluations)
        .where(and(eq(evaluations.evaluatorId, cast.evaluatorId), eq(evaluations.sessionId, cast.sessionId)));
      expect(rows).toHaveLength(1);
      committedEvaluationIds.push(rows[0]?.id ?? 0);

      // The loser received the RAW 23505 naming the write-once arbiter.
      const rejection = rejected[0];
      if (rejection?.status !== "rejected") throw new Error("expected one rejected outcome");
      expect(hasPostgresErrorCode(rejection.reason, PG_UNIQUE_VIOLATION)).toBe(true);
      expect(constraintNameOf(rejection.reason)).toBe("evaluations_session_evaluator_unique");
    }
  );

  testOnRealPostgres(
    "two concurrent aggregateLiveRatings reads of one committed family agree on a stable aggregate",
    async () => {
      const cast = await createCommittedCast();
      const secondRaterId = await db.transaction(async tx => {
        const rater = await createTestUser(tx, { role: "student" });
        await createTestStudent(tx, rater.id);
        committedUserIds.push(rater.id);
        return rater.id;
      });
      const first = await db.transaction(tx =>
        createTestEvaluation(tx, cast.evaluatedId, cast.evaluatorId, cast.sessionId, { score: 80 })
      );
      const second = await db.transaction(tx =>
        createTestEvaluation(tx, cast.evaluatedId, secondRaterId, cast.sessionId, { score: 60 })
      );
      committedEvaluationIds.push(first.id, second.id);

      const outcomes = await Promise.allSettled([
        db.transaction(tx => EvaluationRepository.aggregateLiveRatings(cast.evaluatedId, tx)),
        db.transaction(tx => EvaluationRepository.aggregateLiveRatings(cast.evaluatedId, tx)),
      ]);

      const aggregates: EvaluationRatingAggregateType[] = [];
      for (const outcome of outcomes) {
        if (outcome.status !== "fulfilled") throw new Error("expected both concurrent reads to resolve");
        aggregates.push(outcome.value);
      }
      // Both readers of the same committed family agree on the full mean —
      // a read cannot corrupt the family and cannot double-count.
      expect(aggregates[0]).toEqual({ averageScore: 70, ratingCount: 2 });
      expect(aggregates[1]).toEqual(aggregates[0]);
    }
  );
});

describe("EvaluationRepository — standalone executor paths (committed fixtures)", () => {
  test("listByEvaluator runs standalone via the queryDb read path (live-row filter, newest first)", async () => {
    const cast = await createCommittedCast();
    const earlier = new Date(1_700_000_000_000);
    const later = new Date(1_700_000_060_000);
    // The three fixtures share one evaluator but carry NULL session ids:
    // NULLs are distinct under the unique arbiter, so several rows for the
    // same evaluator can coexist without colliding (the applicant shape).
    const live = await db.transaction(tx =>
      createTestEvaluation(tx, cast.evaluatedId, cast.evaluatorId, null, {
        isDeleted: false,
        score: 60,
        createdAt: earlier,
      })
    );
    const nullFlag = await db.transaction(tx =>
      createTestEvaluation(tx, cast.evaluatedId, cast.evaluatorId, null, {
        isDeleted: null,
        score: 70,
        createdAt: later,
      })
    );
    const softDeleted = await db.transaction(tx =>
      createTestEvaluation(tx, cast.evaluatedId, cast.evaluatorId, null, {
        isDeleted: true,
        deletedAt: new Date(),
        score: 80,
        createdAt: new Date(1_700_000_120_000),
      })
    );
    committedEvaluationIds.push(live.id, nullFlag.id, softDeleted.id);

    const rows = await EvaluationRepository.listByEvaluator(cast.evaluatorId);

    // The explicit soft-delete is excluded; the NULL flag is live; the
    // order is newest first; the raw-SQL column aliases round-trip the
    // full $inferSelect shape.
    expect(rows.map(row => row.id)).toEqual([nullFlag.id, live.id]);
    expect(rows.map(row => row.isDeleted)).toEqual([null, false]);
    expect(Object.keys(rows[0] ?? {}).toSorted((a, b) => a.localeCompare(b))).toEqual([...EVALUATION_ROW_KEYS]);

    // Miss on the same standalone path (int4-domain enormous id).
    const miss = await EvaluationRepository.listByEvaluator(2_147_483_647);
    expect(miss).toEqual([]);
  });

  test("listByEvaluator falls through to the queryDb read on a raw pool executor", async () => {
    const cast = await createCommittedCast();
    const live = await db.transaction(tx =>
      createTestEvaluation(tx, cast.evaluatedId, cast.evaluatorId, cast.sessionId, { score: 65 })
    );
    committedEvaluationIds.push(live.id);

    // A checked-out raw pool is a non-transaction executor: the read must
    // fall through to the standalone parameterized-SQL path.
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    try {
      const rows = await EvaluationRepository.listByEvaluator(cast.evaluatorId, pool);
      expect(rows.map(row => row.id)).toEqual([live.id]);
    } finally {
      await pool.end();
    }
  });

  // ─── Static source pins (Tier 4) ────────────────────────────────────

  const repoSource = readFileSync(join(import.meta.dir, "../../../repo/teachers/evaluation.repository.ts"), "utf8");

  test("source: executor discipline — REQUIRED tx on the write and same-tx reads, two-branch list read, tx last on every signature", () => {
    expect(repoSource.includes("const executor = tx ?? db;")).toBe(false);
    expect(repoSource.match(/queryDb</g) ?? []).toHaveLength(1);
    // Slice each `export async function` signature out up to its parameter
    // list's closing paren (linear scan — no backtracking-prone regex over
    // the whole source).
    const signatures: string[] = [];
    let start = repoSource.indexOf("export async function ");
    while (start !== -1) {
      const close = repoSource.indexOf(")", start);
      if (close === -1) {
        break;
      }
      signatures.push(repoSource.slice(start, close));
      start = repoSource.indexOf("export async function ", close);
    }
    expect(signatures).toHaveLength(5);
    expect(signatures[0]?.startsWith("export async function insertOnce(")).toBe(true);
    // The write's tx is REQUIRED and is the LAST parameter.
    expect(signatures[0]?.trimEnd().endsWith("tx: DBTransaction")).toBe(true);
    expect(signatures[1]?.startsWith("export async function listByEvaluator(")).toBe(true);
    // The read's executor is OPTIONAL and is the LAST parameter.
    expect(signatures[1]?.trimEnd().endsWith("tx?: DBQueryExecutor")).toBe(true);
    expect(signatures[2]?.startsWith("export async function aggregateLiveRatings(")).toBe(true);
    // The aggregate's tx is REQUIRED and is the LAST parameter — it is a
    // same-transaction read whose result feeds a write on that tx.
    expect(signatures[2]?.trimEnd().endsWith("tx: DBTransaction")).toBe(true);
    expect(signatures[3]?.startsWith("export async function findBySessionAndEvaluator(")).toBe(true);
    // The pair pre-check runs inside the caller's submission transaction.
    expect(signatures[3]?.trimEnd().endsWith("tx: DBTransaction")).toBe(true);
    expect(signatures[4]?.startsWith("export async function listCycleRubricSubmissions(")).toBe(true);
    // The quorum read runs under the caller's applicant row lock.
    expect(signatures[4]?.trimEnd().endsWith("tx: DBTransaction")).toBe(true);
  });

  test("source: bound parameters only, no wildcard select, no prepared statements, no SQL line comments", () => {
    expect(repoSource.includes("evaluator_id = $1")).toBe(true);
    expect(repoSource.includes("SELECT *")).toBe(false);
    expect(repoSource.includes(".prepare(")).toBe(false);
    expect(repoSource.includes("sql.placeholder")).toBe(false);
    expect(repoSource.includes("inArray")).toBe(false);
    expect(repoSource.includes("sql.raw")).toBe(false);
    expect(repoSource.includes("--")).toBe(false);
    // The ONLY template interpolations are the Drizzle schema-column refs
    // inside the sql fragments (the aggregate's mean and the quorum read's
    // score projection — bound, parameterized, never a JS value
    // concatenated into SQL text).
    const interpolations = repoSource.match(/\$\{[^}]*\}/g) ?? [];
    expect(interpolations).toHaveLength(2);
    expect(interpolations.every(fragment => fragment.includes("evaluations.score"))).toBe(true);
  });

  test("source: soft-delete exclusion is NULL-safe on both read paths", () => {
    expect(repoSource.includes("or(eq(evaluations.isDeleted, false), isNull(evaluations.isDeleted))")).toBe(true);
    expect(repoSource.includes("coalesce(is_deleted, false) = $2")).toBe(true);
  });

  test("source: caller-scoped read, database-owned arbiter, no i18n/logger/console, one namespace", () => {
    // The list read stays caller-scoped: the evaluator id is its only
    // filter. The aggregate is keyed BY the rated subject, so its single
    // `evaluatedId` parameter is the family's key, not a widening knob; the
    // pair read binds both legs of the unique arbiter.
    expect(repoSource.match(/evaluatorId: number/g) ?? []).toHaveLength(2);
    expect(repoSource.match(/evaluatedId: number/g) ?? []).toHaveLength(1);
    // The write-once arbiter is the database's — no SELECT-then-INSERT
    // guard, no error translation in the repository.
    expect(repoSource.includes("evaluations_session_evaluator_unique")).toBe(true);
    expect(repoSource.includes("ConflictError")).toBe(false);
    expect(repoSource.includes("getServerTranslations")).toBe(false);
    expect(repoSource.includes("logger")).toBe(false);
    expect(repoSource.includes("console.")).toBe(false);
    expect(repoSource.includes("export namespace EvaluationRepository")).toBe(true);
    expect(/REQ-\d|DEV3|Phase \d|Task \d|plan\.md|tasks\.md|specs\.md/.test(repoSource)).toBe(false);
  });

  test("INV-E2: EvaluationRepository exposes no .delete( call and no delete/softDelete/update symbol (surface-absence source pins)", () => {
    // The "not hard-deleted" half of the soft-delete invariant is
    // enforced solely by surface absence: the repository offers no
    // hard-delete path at all — no builder delete call, no DELETE
    // statement on the raw-SQL branch.
    expect(repoSource.includes(".delete(")).toBe(false);
    expect(/delete\s+from\s+evaluations/i.test(repoSource)).toBe(false);
    // The exported surface is exactly the five write-once/read members —
    // no symbol speaks of deleting, soft-deleting, or updating.
    const memberNames = [...repoSource.matchAll(/export async function (\w+)/g)].map(match => match[1]);
    expect(memberNames).toEqual([
      "insertOnce",
      "listByEvaluator",
      "aggregateLiveRatings",
      "findBySessionAndEvaluator",
      "listCycleRubricSubmissions",
    ]);
    expect(memberNames.filter(name => /delete|update/i.test(name))).toEqual([]);
  });
});

describe("EvaluationRepository — retention tier (committed fixtures): the session set-null survival pin", () => {
  // The session DELETE must actually COMMIT for the FK's ON DELETE SET
  // NULL to be observable, so this tier cannot live inside runInRollback.
  // Every fixture id is registered for the module-level afterAll
  // hard-delete (evaluations first, then sessions, then the role-child
  // rows and users).
  test("INV-E3: a session hard-deleted on a committed fixture ⇒ the evaluation survives with sessionId === null (set-null)", async () => {
    const cast = await createCommittedCast();
    const rated = await db.transaction(tx =>
      EvaluationRepository.insertOnce(
        { evaluatedId: cast.evaluatedId, evaluatorId: cast.evaluatorId, sessionId: cast.sessionId, score: 80 },
        tx
      )
    );
    committedEvaluationIds.push(rated.id);

    await db.delete(session).where(eq(session.id, cast.sessionId));

    const [survivor] = await db.select().from(evaluations).where(eq(evaluations.id, rated.id)).limit(1);
    if (!survivor) {
      throw new Error("expected the evaluation row to survive the session delete");
    }
    // The record outlives its referenced session: the FK's SET NULL
    // cleared the link and nothing else about the row changed — the
    // dispute-resolution/re-evaluation history stays on file.
    expect(survivor.sessionId).toBeNull();
    expect(survivor.score).toBe(80);
    expect(survivor.evaluatedId).toBe(cast.evaluatedId);
    expect(survivor.evaluatorId).toBe(cast.evaluatorId);
  });
});

/**
 * Creates the pinned-title verification plan the resolver's primary arm
 * matches on (`plans.title` is not unique — the title IS the pin).
 */
function createVerificationPlanRow(tx: DBTransaction) {
  return createTestPlan(tx, { title: VERIFICATION_PLAN_TITLE });
}

/**
 * Creates an applicant user + `applicants` row in the given lifecycle
 * shape (status + optional re-evaluation anchor) and returns the user id.
 */
async function createApplicantFixture(
  tx: DBTransaction,
  status: ApplicantStatus,
  reEvaluationStartedAt: Date | null
): Promise<number> {
  const user = await createTestUser(tx, { role: "teacher" });
  await createTestApplicant(tx, user.id, { status, reEvaluationStartedAt });
  return user.id;
}

describe("SessionRepository.resolveCurrentEvaluationCycle — the cycle arms", () => {
  // ─── Tier 1: branch/statement ───────────────────────────────────────

  test("a re-evaluating applicant (no active subscription, non-null anchor) resolves the anchor as the cycle start", async () => {
    await runInRollback(async tx => {
      const anchor = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
      const applicantId = await createApplicantFixture(tx, ApplicantStatus.InEvaluation, anchor);

      const window = await SessionRepository.resolveCurrentEvaluationCycle(applicantId, tx);

      // The re-evaluation cycle is backed by NO subscription purchase.
      expect(window.activeSubscriptionId).toBeNull();
      expect(window.cycleStart).not.toBeNull();
      expect(window.cycleStart?.getTime()).toBe(anchor.getTime());
    });
  });

  test("an un-anchored in_evaluation applicant still resolves via the active verification subscription (the subscription arm)", async () => {
    await runInRollback(async tx => {
      // The fresh-loop entry shape: in_evaluation with a NULL anchor (a
      // normal lifecycle entry always clears the anchor), holding an active
      // verification purchase.
      const applicantId = await createApplicantFixture(tx, ApplicantStatus.InEvaluation, null);
      const plan = await createVerificationPlanRow(tx);
      const startedAt = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const subscription = await createTestSubscription(tx, applicantId, plan.id, { startDate: startedAt });

      const window = await SessionRepository.resolveCurrentEvaluationCycle(applicantId, tx);

      expect(window.activeSubscriptionId).toBe(subscription.id);
      expect(window.cycleStart?.getTime()).toBe(startedAt.getTime());
    });
  });

  test("the anchor arm wins precedence: a stamped anchor resolves the paid re-evaluation cycle even WITH an active verification subscription", async () => {
    await runInRollback(async tx => {
      const anchor = new Date(Date.now() - 48 * 60 * 60 * 1000);
      const applicantId = await createApplicantFixture(tx, ApplicantStatus.InEvaluation, anchor);
      const plan = await createVerificationPlanRow(tx);
      const startedAt = new Date(Date.now() - 60 * 60 * 1000);
      await createTestSubscription(tx, applicantId, plan.id, { startDate: startedAt });

      const window = await SessionRepository.resolveCurrentEvaluationCycle(applicantId, tx);

      // The paid re-evaluation loop resolves ITS OWN anchored cycle — a
      // still-active verification subscription from the applicant's original
      // loop must never shadow the anchor and re-open the previous cycle's
      // bookings (that would strand the new loop EVALUATION_LOOP_COMPLETE).
      expect(window.activeSubscriptionId).toBeNull();
      expect(window.cycleStart?.getTime()).toBe(anchor.getTime());
      expect(window.cycleStart?.getTime()).not.toBe(startedAt.getTime());
    });
  });

  // ─── Tier 2: boundary / fall-through edges ──────────────────────────

  test("an anchor-NULL in_evaluation applicant with no subscription resolves to the closed loop", async () => {
    await runInRollback(async tx => {
      const applicantId = await createApplicantFixture(tx, ApplicantStatus.InEvaluation, null);

      const window = await SessionRepository.resolveCurrentEvaluationCycle(applicantId, tx);

      expect(window.cycleStart).toBeNull();
      expect(window.activeSubscriptionId).toBeNull();
    });
  });

  test("an expired verification subscription never shadows the re-evaluation anchor", async () => {
    await runInRollback(async tx => {
      const anchor = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const applicantId = await createApplicantFixture(tx, ApplicantStatus.InEvaluation, anchor);
      const plan = await createVerificationPlanRow(tx);
      await createTestSubscription(tx, applicantId, plan.id, {
        status: SubscriptionStatus.Expired,
        startDate: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000),
        endDate: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
      });

      const window = await SessionRepository.resolveCurrentEvaluationCycle(applicantId, tx);

      // Only an ACTIVE verification subscription opens a subscription-arm
      // cycle; the expired purchase leaves the re-evaluation anchor in force.
      expect(window.activeSubscriptionId).toBeNull();
      expect(window.cycleStart?.getTime()).toBe(anchor.getTime());
    });
  });

  test("an active subscription on a non-verification plan is not a verification cycle", async () => {
    await runInRollback(async tx => {
      const anchor = new Date(Date.now() - 12 * 60 * 60 * 1000);
      const applicantId = await createApplicantFixture(tx, ApplicantStatus.InEvaluation, anchor);
      const genericPlan = await createTestPlan(tx, { title: `Student Plan ${randomUUID().slice(0, 8)}` });
      await createTestSubscription(tx, applicantId, genericPlan.id);

      const window = await SessionRepository.resolveCurrentEvaluationCycle(applicantId, tx);

      // The plan-title pin holds: a live subscription that is not the
      // verification plan never opens a cycle of its own.
      expect(window.activeSubscriptionId).toBeNull();
      expect(window.cycleStart?.getTime()).toBe(anchor.getTime());
    });
  });

  test("a resolved re-evaluation cycle bounds the aggregate: a booking created exactly at the anchor counts, a prior-cycle booking does not", async () => {
    await runInRollback(async tx => {
      const anchor = new Date(Date.now() - 6 * 60 * 60 * 1000);
      const applicantId = await createApplicantFixture(tx, ApplicantStatus.InEvaluation, anchor);
      const evaluatorId = await createExtraEvaluator(tx);

      // Boundary equality: created_at == cycleStart is INSIDE the half-open
      // window (>=); a pre-anchor row is prior-cycle history.
      const boundaryBooking = await createTestSession(tx, evaluatorId, applicantId, {
        sessionType: SessionType.TeacherEvaluation,
        status: SessionStatus.Completed,
        createdAt: new Date(anchor.getTime()),
      });
      await createTestSession(tx, evaluatorId, applicantId, {
        sessionType: SessionType.TeacherEvaluation,
        status: SessionStatus.Completed,
        createdAt: new Date(anchor.getTime() - 60 * 60 * 1000),
      });

      const counts = await SessionRepository.countEvaluationBookingsInCycle(applicantId, anchor, tx);

      expect(counts.booked).toBe(1);
      expect(counts.completed).toBe(1);
      expect(counts.evaluators).toEqual([evaluatorId]);
      expect(boundaryBooking.createdAt.getTime()).toBe(anchor.getTime());
    });
  });

  // ─── Tier 3: parallel booking inserts (committed fixtures) ──────────
  // Real-Postgres gated: two independent transactions inserting against the
  // same aggregate need multi-connection concurrency (PGlite is
  // single-connection WASM). Fixtures are committed and registered for the
  // module-level `afterAll` hard-delete (sessions → role-children → users;
  // the applicant row cascades with its user).
  const testOnRealPostgres = isPgliteProvider() ? test.skip : test;

  testOnRealPostgres("the cycle aggregate stays stable under parallel booking inserts", async () => {
    const fixture = await db.transaction(async tx => {
      const anchor = new Date(Date.now() - 60 * 60 * 1000);
      const applicantId = await createApplicantFixture(tx, ApplicantStatus.InEvaluation, anchor);
      const evaluatorId = await createExtraEvaluator(tx);
      committedUserIds.push(applicantId, evaluatorId);
      return { applicantId, evaluatorId, anchor };
    });

    // Two INDEPENDENT transactions book evaluation sessions inside the same
    // re-evaluation cycle; neither conflicts with the other's insert.
    const settled = await Promise.allSettled([
      db.transaction(tx =>
        createTestSession(tx, fixture.evaluatorId, fixture.applicantId, {
          sessionType: SessionType.TeacherEvaluation,
          createdAt: new Date(fixture.anchor.getTime() + 1_000),
        })
      ),
      db.transaction(tx =>
        createTestSession(tx, fixture.evaluatorId, fixture.applicantId, {
          sessionType: SessionType.TeacherEvaluation,
          createdAt: new Date(fixture.anchor.getTime() + 2_000),
        })
      ),
    ]);
    for (const outcome of settled) {
      if (outcome.status === "rejected") {
        throw outcome.reason;
      }
    }
    settled.forEach(outcome => {
      if (outcome.status === "fulfilled") {
        committedSessionIds.push(outcome.value.id);
      }
    });

    // The post-commit aggregate over the anchor window counts BOTH rows
    // exactly once each — no lost insert, no double count.
    const counts = await db.transaction(tx =>
      SessionRepository.countEvaluationBookingsInCycle(fixture.applicantId, fixture.anchor, tx)
    );
    expect(counts.booked).toBe(2);
    expect(counts.completed).toBe(0);
    expect(counts.evaluators).toEqual([fixture.evaluatorId]);
  });

  // ─── Tier 4: static surface pins ────────────────────────────────────

  const HELPERS_FILE = join(import.meta.dir, "../../../repo/classes/session.repository.evaluation.helpers.ts");
  const helpersSource = readFileSync(HELPERS_FILE, "utf8");

  /** The resolveCurrentEvaluationCycle slice of the helpers source (the static pin target). */
  function resolverSource(): string {
    const start = helpersSource.indexOf("export async function resolveCurrentEvaluationCycle(");
    return helpersSource.slice(start, helpersSource.indexOf("\n}\n", start));
  }

  /** The countEvaluationBookingsInCycle slice of the helpers source (the static pin target). */
  function aggregateSource(): string {
    const start = helpersSource.indexOf("export async function countEvaluationBookingsInCycle(");
    return helpersSource.slice(start, helpersSource.indexOf("\n}\n", start));
  }

  test("source: the re-evaluation anchor arm is probed FIRST and the verification-subscription arm follows", () => {
    const source = resolverSource();
    const reEvaluationArmAt = source.indexOf(".from(applicants)");
    const subscriptionArmAt = source.indexOf(".from(subscriptions)");
    expect(reEvaluationArmAt).toBeGreaterThan(-1);
    expect(subscriptionArmAt).toBeGreaterThan(reEvaluationArmAt);
  });

  test("source: the re-evaluation arm requires in_evaluation AND a non-null anchor, returning the anchor with no subscription", () => {
    const source = resolverSource();
    expect(source).toContain("eq(plans.title, VERIFICATION_PLAN_TITLE)");
    expect(source).toContain("eq(subscriptions.status, SubscriptionStatus.Active)");
    expect(source).toContain("eq(applicants.status, ApplicantStatus.InEvaluation)");
    expect(source).toContain("isNotNull(applicants.reEvaluationStartedAt)");
    expect(source).toContain("{ cycleStart: reEvaluationStartedAt, activeSubscriptionId: null }");
    // Enum members only — no hardcoded vocabulary.
    expect(/'(in_evaluation|active|teacher_evaluation)'/.test(source)).toBe(false);
  });

  test("source: the aggregate keeps counting teacher_evaluation bookings from the cycle start, unchanged", () => {
    const source = aggregateSource();
    expect(source).toContain("eq(session.sessionType, SessionType.TeacherEvaluation)");
    expect(source).toContain("gte(session.createdAt, cycleStart)");
    expect(source).toContain("tx: DBTransaction");
  });

  test("source: the helper observes the caller tx and carries no i18n/logger/console or plan-artifact references", () => {
    expect(resolverSource()).toContain("tx: DBTransaction");
    expect(helpersSource.includes(".prepare(")).toBe(false);
    expect(helpersSource.includes("getServerTranslations")).toBe(false);
    expect(helpersSource.includes("logger")).toBe(false);
    expect(helpersSource.includes("console.")).toBe(false);
    expect(/REQ-\d|DEV2|DEV3|Phase \d|Task \d|plan\.md|tasks\.md|specs\.md/.test(helpersSource)).toBe(false);
  });
});
