/**
 * TeacherRepository tests — `lockForCertificationCheck` (certification lock)
 * and `updateAverageRating` (the cached-rating write) against the live
 * `kottaby_test_db` PostgreSQL instance.
 *
 * Per `backend/db/test/AGENTS.md`:
 *  - Rollback-isolated tests run inside `runInRollback`; `tx` is passed to
 *    EVERY repo call, entity-setup helper, and direct Drizzle query.
 *  - Entities are created ONLY via `entity-setup.ts` helpers plus a
 *    file-local shared-PK teacher-row helper — never seed data.
 *  - No `expect(...).rejects.toThrow()` — the lock signals a missing row by
 *    returning `null`, and the cached-rating write's one error path (the
 *    raw CHECK violation) is probed through `expectRepoError` inside an
 *    explicit SAVEPOINT bracket so the outer transaction stays queryable.
 *  - The concurrency tier must commit its fixtures (a row lock held across
 *    two independent transactions cannot live inside one rolled-back tx);
 *    those fixtures are registered and hard-deleted in `afterAll`.
 *
 * Coverage map:
 *  - Tier 1 (branch/stmt): approved row returns the id with `isApproved:true`;
 *    unapproved row returns `isApproved:false`; nonexistent id returns null.
 *    The projection is minimal (exactly the two mandated keys).
 *  - Tier 2 (boundary/honest failure): a teacher-applicant user (role=teacher
 *    + applicants row, NO teacher row) resolves to null; a row whose
 *    `is_approved` is DB-level NULL surfaces the flag verbatim as null; the
 *    lock is idempotently re-taken inside ONE transaction.
 *  - Tier 3 (concurrency — the lock is observable):
 *      (a) an uncommitted holder blocks a second FOR UPDATE read (probe
 *          window shows the waiter still pending) while a PLAIN MVCC read
 *          does not block and still sees the pre-commit value; once the
 *          holder commits a certification flip, the waiter's locking read
 *          resolves with the POST-commit value (serialized read-after-commit).
 *      (b) when the holder ROLLS BACK (having changed nothing), the lock is
 *          released and the waiter acquires it, reading the durable committed
 *          certification value — a rolled-back holder leaves no trace.
 *  - Tier 4 (security/static): the id reaches the query only as a bound
 *    parameter — the repository source has no raw-SQL string building, no
 *    `--` sequences, no prepared statements, a REQUIRED (non-optional) tx
 *    parameter, no non-tx executor branch, no i18n/logger imports, and a
 *    two-column projection.
 *  - findForEvaluationGateById: the certification AND evaluator flags plus
 *    the owning account's governance flags ride the same FOR UPDATE lock
 *    (the teacher row INNER JOINed to its users row) — the six-column
 *    projection under lock, DB-level NULL flags surfaced verbatim, an
 *    applicant's users.id resolving to null (an applicants row never
 *    mints certification), a governed account's flags surfaced verbatim,
 *    and idempotent re-locking inside one transaction.
 *
 * updateAverageRating tier (the cached-rating write, runInRollback):
 *  - Tier 1: the exact decimal string is stored and returned; the write
 *    refreshes `updated_at`; a recompute overwrites the prior value.
 *  - Tier 2: an unknown id returns null and writes nothing; the payload
 *    touches nothing beyond `average_rating` and `updated_at`.
 *  - Tier 4: a rating beyond the 0-5 clamp raises the raw
 *    `teacher_average_rating_check` violation (untranslated, savepoint
 *    probe), and static pins assert the guarded REQUIRED-tx write shape.
 *
 * acquireInSessionLock tier (the capture-and-lock write, runInRollback):
 *  - Tier 1: an online teacher is captured true and locked (marker true,
 *    is_online false); an offline teacher seeds the never-resurrect marker
 *    (false); a missing row returns the fail-closed null.
 *  - Tier 2: a NULL is_online column captures NULL; a second acquire
 *    preserves the first marker (first-lock-wins); re-acquiring while the
 *    marker is set is idempotent.
 *  - Tier 3: a 20-way same-transaction acquire storm converges to the
 *    first-captured marker with is_online=false.
 *  - Tier 4: hostile in-domain ids (0, -1, far-beyond-sequence) are null
 *    misses writing nothing; ids beyond the integer domain (NaN, 2^53) die
 *    at the driver's type gate as raw data exceptions (nothing executes),
 *    and static pins assert the guarded REQUIRED-tx single-statement shape.
 *
 * releaseInSessionLock tier (the marker-gated last-exit release,
 * runInRollback):
 *  - Tier 1: a true marker restores is_online=true; a false marker keeps
 *    is_online false (never-resurrect); the marker is consumed to NULL; a
 *    missing row returns null; one row walks all three outcomes in exact
 *    sequence (active_sessions_remain → released → no_lock_held).
 *  - Tier 2: no_lock_held on a NULL marker (including a scheduled row with
 *    a reschedule-polluted startedAt — the classifier is never read);
 *    active_sessions_remain while a started row exists; a deferred attempt
 *    writes NOTHING (flag, marker and the pinned-epoch updated_at intact).
 *  - Tier 3: two exits race one teacher's final release (exactly one
 *    "released", one "active_sessions_remain", one restore per the
 *    ORIGINAL marker); a two-teacher control releases BOTH (no
 *    cross-teacher interference); a 20-way same-transaction release storm
 *    converges to exactly one restore.
 *  - Tier 3 cross-connection races (real PostgreSQL, committed fixtures):
 *    the double-complete interleave serializes on the release preamble's
 *    teacher-row lock (exactly one "released" — the both-defer strand
 *    stays closed, the marker consumed, zero started sessions, and the
 *    deferred exit's redundancy probe degrades to "no_lock_held"); with
 *    both completions durable first, the serialized re-read degrades the
 *    losing release to "no_lock_held".
 *  - Tier 4: hostile in-domain ids (0, -1, far-beyond-sequence) are null
 *    misses writing nothing; ids beyond the integer domain (NaN, 2^53) die
 *    at the driver's type gate as raw data exceptions (nothing executes);
 *    an EXPLAIN capture pins the NOT EXISTS probe's plan shape (no index
 *    added); static pins assert the guarded REQUIRED-tx classified shape.
 *
 * setAvailabilityIntent tier (the direction-guarded toggle writer,
 * runInRollback):
 *  - Tier 1: the Unavailable direction writes is_online=false and leaves a
 *    NULL marker NULL (the toggle never mints a marker) while overwriting a
 *    held marker to false (deliberate intent re-arms the restore); a
 *    missing row is null in BOTH directions.
 *  - Tier 2: the Available direction succeeds when no started session
 *    exists and is race-blocked to zero rows (writing NOTHING — flag,
 *    marker and the pinned-epoch updated_at intact) while one does; the
 *    marker CASE applies on both directions (a held marker is re-stamped
 *    with the intent value — true stays true on the Available toggle, false
 *    stays false on the Unavailable toggle — never consumed).
 *  - Tier 3: a 20-way sequential rapid-toggle storm within ONE tx
 *    converges to the LAST toggle's value (no lost update, no minted
 *    marker); toggle-vs-release interleavings converge to a consistent
 *    final state in BOTH orders (toggle-first: the deliberate intent
 *    survives the release; release-first: the restore lands before the
 *    toggle re-applies the intent without re-minting).
 *  - Retired-writer migration (the deleted legacy toggle writer's
 *    surviving cases, re-expressed against this primitive): a redundant
 *    same-value Available toggle returns the row (idempotent under
 *    retry); a NULL is_online column writes cleanly in BOTH directions
 *    (the marker stays NULL); certification plays no part (an unapproved
 *    row toggles identically); a 25-way cross-connection mixed-toggle
 *    storm (real PostgreSQL, committed fixture) converges to a total
 *    boolean with the marker never minted.
 *  - Tier 4: hostile in-domain ids (0, -1, far-beyond-sequence) are null
 *    misses writing nothing in both directions; ids beyond the integer
 *    domain (NaN, 2^53) die at the driver's type gate as raw data
 *    exceptions (nothing executes); static pins assert the
 *    direction-guarded REQUIRED-tx shape and that the repo trusts the
 *    typed boolean (no runtime type coercion — guarding stays in the
 *    service layer).
 * sweepInactiveOnlineOnce tier (the inactivity auto-offline batch,
 * runInRollback):
 *  - Tier 1: the guarded predicate legs — a stale online teacher is swept;
 *    NULL activity counts as expired; fresh activity, already-offline, and
 *    started-session rows are skipped; a merely scheduled session does NOT
 *    exempt.
 *  - Tier 2: the strict `<` boundary — activity exactly at the cutoff and
 *    14:59 old stays online, 15:01 old is swept; `updated_at` is stamped
 *    with the caller-captured now (one clock read per pass).
 *  - Tier 3: a replay after the sweep is a zero-row no-op; the count is
 *    honest across mixed states (drain pass first — never assume an empty
 *    table).
 *  - Tier 4: static pins — REQUIRED tx, predicate-only victim selection,
 *    enum-member binding (never a string literal), no prepared statements,
 *    and the lock-then-recheck shape (candidates pinned FOR UPDATE, the
 *    UPDATE re-running the same predicates scoped to the pinned ids).
 *
 * INV-A2 writer-closure battery (the in-session availability invariant,
 * runInRollback — docs/specs/state-machine-invariants.md §3): one shared
 * fixture — a teacher captured online (marker=true), locked offline,
 * holding ONE started session — and EVERY `is_online` writer fired
 * against it as its own cell with a re-read oracle: the Available-direction
 * toggle is guard-blocked to a null no-op, the marker-gated release is
 * deferred (active_sessions_remain), a mid-session re-acquire writes only
 * false (first-captured marker preserved), and the inactivity sweep
 * demonstrably runs (a stale-online control is flipped) yet leaves the
 * in-session teacher offline. No writer ever produces is_online=true
 * while a started session exists; the per-writer deep semantics stay in
 * their own suites above.
 *
 * listMatchingCandidates suite (the student-facing matching read):
 *  - Eligibility matrix: online + certified fail-closed, governance via
 *    IS DISTINCT FROM true (legacy NULL rows kept), in-session exclusion
 *    (NOT EXISTS) incl. the stale-`true` is_online compose rule, and the
 *    non-`started` session states that must NOT hide a teacher.
 *  - Token filters: recitation/subject/language quoted-token matches (the
 *    `"hifz"` vs `"hifz_jadid"` boundary), null language pattern dropping
 *    out of the chain, corrupt-JSON payloads matching on raw tokens.
 *  - Country tiering: code arm, legacy free-text arm (case-insensitive),
 *    one-tier fallback — soft ordering that never excludes a row.
 *  - Ordering + pagination: rating DESC NULLS LAST, id-DESC tiebreak,
 *    honest total across mid-page, beyond-last, and empty pages.
 *  - Extended browse filters (the post-tier sort choice era): the
 *    name-search pattern matches the display name case-insensitively with
 *    `%`/`_` bound literally (the service escapes; the repo binds), the
 *    minimum-rating floor is the honest SQL `>=` (unrated NULL excluded),
 *    the nullable recitation/subject token patterns drop their `ilike`
 *    predicates from the WHERE chain when null (browse-all eligibility —
 *    the same null-drop shape as `languagePattern`/`namePattern`/`minRating`)
 *    while concrete quoted-token patterns narrow to the matching rows, and
 *    the post-tier ordering keys — RATING_DESC byte-identical to the
 *    legacy order, NAME_ASC alphabetical, NEWEST id-first — always tiered
 *    first and tiebroken by id DESC.
 *  - Binding discipline + static pins: finished patterns bound verbatim
 *    (a raw `_` wildcard still matches — escaping is upstream), patterns
 *    never re-escaped or re-wrapped, SessionStatus as a VALUE import, and
 *    the negative-offset error surfaced (no silent clamping).
 */

import { afterAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/backend/db";
import { TeacherRepository } from "@/backend/db/repo";
import type { NormalizedTeacherMatchingFilters } from "@/backend/db/repo/teachers/teacher.repository";
import { session } from "@/backend/db/schema/classes/session";
import { teacher } from "@/backend/db/schema/teachers/teacher";
import { users } from "@/backend/db/schema/users/users";
import {
  createTestTeacherRow as createTeacherRowFixture,
  createTestApplicant,
  createTestSession,
  createTestUser,
} from "@/backend/db/test/entity-setup";
import { hasPostgresErrorCode } from "@/backend/db/test/pg-error";
import { constraintNameOf, expectRepoError, runInRollback } from "@/backend/db/test/test-utils";
import { SessionStatus } from "@/backend/enum/scheduling/session-status.enum";
import { TeacherMatchingSort } from "@/backend/enum/teachers/teacher-matching-sort.enum";
import type { DBTransaction, SessionInsertType, TeacherSelectType, UserSelectType } from "@/backend/types";
import { isPgliteProvider } from "@/test/helpers/skip-when-pglite";

/** How long to observe a supposedly-blocked waiter before concluding it is stuck. */
const LOCK_PROBE_MS = 500;

interface Gate {
  promise: Promise<void>;
  open: () => void;
}

/** One-shot gate — `open()` releases the `promise` awaiter (idempotent). */
function createGate(): Gate {
  const { promise, resolve } = Promise.withResolvers<void>();
  return { promise, open: resolve };
}

/**
 * Shared-PK `teacher` row insert for a previously-created user — mirrors the
 * entity-setup role-child factory pattern (PK = users.id, FK cascade).
 */
async function createTestTeacherRow(tx: DBTransaction, userId: number, isApproved: boolean | null): Promise<void> {
  await tx.insert(teacher).values({ id: userId, isApproved });
}

/**
 * Returns an integer id that cannot exist as a `teacher` row during this
 * transaction: teacher rows share their PK with `users.id`, so anything
 * above the current max (plus an offset no sequence reaches mid-test) is
 * guaranteed absent.
 */
async function absentTeacherId(tx: DBTransaction): Promise<number> {
  const [row] = await tx.select({ maxId: sql<number>`coalesce(max(${teacher.id}), 0)::int` }).from(teacher);
  return (row?.maxId ?? 0) + 1_000_000;
}

/** Finished filter patterns in the service-normalized shape: escaped, quoted, `%…%`-wrapped (the repo binds, never builds). */
function matchingFilters(overrides: Partial<NormalizedTeacherMatchingFilters> = {}): NormalizedTeacherMatchingFilters {
  return {
    recitationPattern: '%"hafs_an_asim"%',
    subjectPattern: '%"hifz"%',
    languagePattern: null,
    namePattern: null,
    minRating: null,
    sort: TeacherMatchingSort.RatingDesc,
    studentCountryCode: null,
    studentCountryText: null,
    ...overrides,
  };
}

/** Pre-fixture total for the given filters — the suite never assumes an empty table (assert `baseline + delta`). */
async function baselineTotal(tx: DBTransaction, filters: NormalizedTeacherMatchingFilters): Promise<number> {
  const { total } = await TeacherRepository.listMatchingCandidates(filters, 1, 0, tx);
  return total;
}

/** Teacher rows committed OUTSIDE `runInRollback` (concurrency tier) — hard-deleted in `afterAll`. */
const committedTeacherUserIds: number[] = [];

/**
 * Teacher fixtures whose `session` rows (and the bare student `users` rows
 * behind them) were committed OUTSIDE `runInRollback` for the
 * cross-connection release races — hard-deleted in `afterAll` (sessions
 * first: the restrict FKs block deleting a teacher or user that still has
 * sessions).
 */
const committedRaceTeacherUserIds: number[] = [];

/**
 * Inserts a `session` row for a teacher fixture (the student leg is a bare
 * `users.id` — every session requires one). `overrides` carries the fixture
 * variance (e.g. a reschedule-polluted `startedAt` on a scheduled row).
 */
async function createTeacherSession(
  tx: DBTransaction,
  teacherId: number,
  status: SessionStatus,
  overrides: Partial<SessionInsertType> = {}
): Promise<number> {
  const student = await createTestUser(tx, { role: "student" });
  const [row] = await tx
    .insert(session)
    .values({ teacherId, studentId: student.id, status, ...overrides })
    .returning({ id: session.id });
  if (!row) {
    throw new Error("createTeacherSession: insert returned no rows");
  }
  return row.id;
}

/**
 * Sequential-by-recursion toggle storm — fires `count` alternating
 * `setAvailabilityIntent` calls on ONE teacher row inside the caller's
 * transaction. Recursion (not a loop) satisfies the `no-await-in-loop`
 * rule; the single connection serializes the statements behind the row
 * lock, so no update is lost and the final persisted value is the LAST
 * toggle's input (returned for the convergence assertion).
 */
async function toggleStorm(
  tx: DBTransaction,
  teacherId: number,
  count: number,
  index = 0,
  lastInput = false
): Promise<boolean> {
  if (index >= count) {
    return lastInput;
  }
  const nextInput = index % 2 === 0;
  await TeacherRepository.setAvailabilityIntent(teacherId, nextInput, tx);
  return toggleStorm(tx, teacherId, count, index + 1, nextInput);
}

/** Commits a teacher fixture outside the rollback tx and registers it for cleanup. */
async function createCommittedTeacher(isApproved: boolean | null): Promise<number> {
  const teacherUserId = await db.transaction(async tx => {
    const user = await createTestUser(tx, { role: "teacher" });
    await createTestTeacherRow(tx, user.id, isApproved);
    return user.id;
  });
  committedTeacherUserIds.push(teacherUserId);
  return teacherUserId;
}

afterAll(async () => {
  // Hard-delete every committed session-race fixture: the student ids are
  // read off the sessions first, then the sessions go (the restrict FKs
  // block deleting a teacher or user that still has sessions), then the
  // bare student users — all before the teacher fixtures below.
  await Promise.all(
    committedRaceTeacherUserIds.map(async teacherUserId => {
      const committedSessions = await db
        .select({ studentId: session.studentId })
        .from(session)
        .where(eq(session.teacherId, teacherUserId));
      const studentIds = committedSessions.map(row => row.studentId);
      await db.delete(session).where(eq(session.teacherId, teacherUserId));
      await Promise.all(studentIds.map(studentId => db.delete(users).where(eq(users.id, studentId))));
    })
  );
  // Hard-delete every committed fixture (teacher row first, then its owning
  // user — same direction as the cascade) so nothing leaks across suites.
  await Promise.all(
    committedTeacherUserIds.map(async teacherUserId => {
      await db.delete(teacher).where(eq(teacher.id, teacherUserId));
      await db.delete(users).where(eq(users.id, teacherUserId));
    })
  );
  committedTeacherUserIds.length = 0;
  committedRaceTeacherUserIds.length = 0;
});

/**
 * The page rows limited to the supplied fixture ids, in the read's order.
 * Module-scope helper (shared by the browse-pipeline suites below).
 */
function orderedFixtureIds(rows: readonly { readonly id: number }[], ids: readonly number[]): number[] {
  return rows.map(row => row.id).filter(id => ids.includes(id));
}

describe("TeacherRepository.lockForCertificationCheck", () => {
  // ─── Tier 1: branch/statement ───────────────────────────────────────

  test("returns {id, isApproved:true} for an existing approved teacher row", async () => {
    await runInRollback(async tx => {
      const user = await createTestUser(tx, { role: "teacher" });
      await createTestTeacherRow(tx, user.id, true);

      const locked = await TeacherRepository.lockForCertificationCheck(user.id, tx);

      expect(locked).not.toBeNull();
      if (!locked) throw new Error("expected locked teacher row");
      expect(locked.id).toBe(user.id);
      expect(locked.isApproved).toBe(true);
      // Minimal projection — exactly the two mandated columns, nothing else.
      expect(Object.keys(locked).toSorted((a, b) => a.localeCompare(b))).toEqual(["id", "isApproved"]);
    });
  });

  test("returns isApproved:false for an existing unapproved teacher row", async () => {
    await runInRollback(async tx => {
      const user = await createTestUser(tx, { role: "teacher" });
      await createTestTeacherRow(tx, user.id, false);

      const locked = await TeacherRepository.lockForCertificationCheck(user.id, tx);

      expect(locked?.id).toBe(user.id);
      expect(locked?.isApproved).toBe(false);
    });
  });

  test("returns null for a nonexistent teacher id", async () => {
    await runInRollback(async tx => {
      const missingId = await absentTeacherId(tx);

      const locked = await TeacherRepository.lockForCertificationCheck(missingId, tx);

      expect(locked).toBeNull();
    });
  });

  // ─── Tier 2: boundary / honest failure ──────────────────────────────

  test("resolves to null for a teacher-applicant user (applicants row, NO teacher row)", async () => {
    await runInRollback(async tx => {
      // role=teacher user + applicants row only — the verification pipeline
      // never minted a teacher row for this id.
      const applicantUser = await createTestUser(tx, { role: "teacher" });
      await createTestApplicant(tx, applicantUser.id);

      const locked = await TeacherRepository.lockForCertificationCheck(applicantUser.id, tx);

      // Honest failure: an applicant's users.id is not a teachable id, and
      // owning an applicant row never resolves to certification state.
      expect(locked).toBeNull();
    });
  });

  test("surfaces a DB-level NULL is_approved verbatim as null (never coerced)", async () => {
    await runInRollback(async tx => {
      const user = await createTestUser(tx, { role: "teacher" });
      await createTestTeacherRow(tx, user.id, null);

      const locked = await TeacherRepository.lockForCertificationCheck(user.id, tx);

      expect(locked?.id).toBe(user.id);
      expect(locked?.isApproved).toBeNull();
    });
  });

  test("re-locking the same row inside ONE transaction is idempotent (tx-scoped lock)", async () => {
    await runInRollback(async tx => {
      const user = await createTestUser(tx, { role: "teacher" });
      await createTestTeacherRow(tx, user.id, true);

      const first = await TeacherRepository.lockForCertificationCheck(user.id, tx);
      const second = await TeacherRepository.lockForCertificationCheck(user.id, tx);

      expect(first).toEqual(second);
    });
  });

  // ─── Tier 3: the lock is observable (concurrent tx pair) ────────────
  // These tests require real PostgreSQL (multi-connection FOR UPDATE row-level
  // locking). PGlite is single-connection WASM and cannot observe cross-tx locks.
  const testOnRealPostgres = isPgliteProvider() ? test.skip : test;

  testOnRealPostgres(
    "a second FOR UPDATE read blocks until the holder commits, then reads the committed value",
    async () => {
      const teacherUserId = await createCommittedTeacher(false);

      const lockAcquired = createGate(); // holder signals: row lock taken
      const finishHolder = createGate(); // test signals: holder may flip + commit

      const holder = db.transaction(async txHolder => {
        const held = await TeacherRepository.lockForCertificationCheck(teacherUserId, txHolder);
        expect(held?.isApproved).toBe(false); // pre-commit certification state
        lockAcquired.open();
        await finishHolder.promise; // hold the lock across the probe window
        await txHolder.update(teacher).set({ isApproved: true }).where(eq(teacher.id, teacherUserId));
      });
      // Never leave the holder's rejection unhandled; the outcome is asserted below.
      const holderSettled = holder.then(
        () => "committed" as const,
        error => (error instanceof Error ? error : new Error(String(error)))
      );

      await lockAcquired.promise;

      // Waiter: the SAME locking read from an independent transaction.
      const waiter = db.transaction(txWaiter => TeacherRepository.lockForCertificationCheck(teacherUserId, txWaiter));
      const waiterSettled = waiter.then(
        value => ({ ok: true as const, value }),
        error => ({ ok: false as const, error })
      );

      let probeTimer: ReturnType<typeof setTimeout> | undefined;
      try {
        const probe = await Promise.race([
          waiterSettled.then(() => "resolved" as const),
          new Promise<"blocked">(resolve => {
            probeTimer = setTimeout(() => resolve("blocked"), LOCK_PROBE_MS);
          }),
        ]);
        // The holder's uncommitted lock keeps the waiter from resolving.
        expect(probe).toBe("blocked");

        // Contrast probe: a PLAIN (non-locking) MVCC read does NOT block and
        // still sees the pre-commit value — the serialization above is the
        // FOR UPDATE lock, not ordinary read behavior.
        const plain = await db.transaction(async txPlain => {
          const rows = await txPlain
            .select({ isApproved: teacher.isApproved })
            .from(teacher)
            .where(eq(teacher.id, teacherUserId));
          return rows[0]?.isApproved;
        });
        expect(plain).toBe(false);
      } finally {
        if (probeTimer) clearTimeout(probeTimer);
        finishHolder.open(); // idempotent — always let the holder finish
      }

      const holderOutcome = await holderSettled;
      expect(holderOutcome).toBe("committed");

      const waiterOutcome = await waiterSettled;
      expect(waiterOutcome.ok).toBe(true);
      if (!waiterOutcome.ok) throw new Error("expected the waiter to resolve");
      // The waiter reads as of ITS lock acquisition — i.e. after the holder's
      // commit — so the certification value it hands back is the committed one.
      expect(waiterOutcome.value?.id).toBe(teacherUserId);
      expect(waiterOutcome.value?.isApproved).toBe(true);
    }
  );

  testOnRealPostgres(
    "a holder's ROLLBACK releases the lock: the waiter acquires it and reads the durable value",
    async () => {
      const teacherUserId = await createCommittedTeacher(false);

      const lockAcquired = createGate();
      const releaseHolder = createGate();

      const holder = runInRollback(async txHolder => {
        const held = await TeacherRepository.lockForCertificationCheck(teacherUserId, txHolder);
        expect(held?.isApproved).toBe(false);
        lockAcquired.open();
        await releaseHolder.promise; // hold the committed row's lock, then roll back
      });
      const holderSettled = holder.then(
        () => "rolled-back" as const,
        error => (error instanceof Error ? error : new Error(String(error)))
      );

      await lockAcquired.promise;

      // Waiter: the SAME locking read from an independent transaction.
      const waiter = db.transaction(txWaiter => TeacherRepository.lockForCertificationCheck(teacherUserId, txWaiter));
      const waiterSettled = waiter.then(
        value => ({ ok: true as const, value }),
        error => ({ ok: false as const, error })
      );

      let probeTimer: ReturnType<typeof setTimeout> | undefined;
      try {
        const probe = await Promise.race([
          waiterSettled.then(() => "resolved" as const),
          new Promise<"blocked">(resolve => {
            probeTimer = setTimeout(() => resolve("blocked"), LOCK_PROBE_MS);
          }),
        ]);
        expect(probe).toBe("blocked");
      } finally {
        if (probeTimer) clearTimeout(probeTimer);
        releaseHolder.open(); // holder returns → runInRollback forces ROLLBACK → lock released
      }

      const holderOutcome = await holderSettled;
      expect(holderOutcome).toBe("rolled-back");

      const waiterOutcome = await waiterSettled;
      expect(waiterOutcome.ok).toBe(true);
      if (!waiterOutcome.ok) throw new Error("expected the waiter to resolve");
      // The rolled-back holder changed nothing: the waiter acquires the
      // released lock and reads the durable committed certification state.
      expect(waiterOutcome.value?.id).toBe(teacherUserId);
      expect(waiterOutcome.value?.isApproved).toBe(false);
    }
  );

  // ─── Tier 4: security / injection surface (static) ──────────────────

  const REPO_FILE = join(import.meta.dir, "../../../repo/teachers/teacher.repository.ts");
  const repoSource = readFileSync(REPO_FILE, "utf8");
  // The directory + matching reads live in their extraction-convention
  // helper modules (the namespace method delegates one-to-one); the
  // interpolation drift pin spans ALL THREE sources as one union.
  const REPO_DIRECTORY_HELPERS_FILE = join(
    import.meta.dir,
    "../../../repo/teachers/teacher.repository.directory.helpers.ts"
  );
  const REPO_MATCHING_HELPERS_FILE = join(
    import.meta.dir,
    "../../../repo/teachers/teacher.repository.matching.helpers.ts"
  );
  const matchingHelpersSource = readFileSync(REPO_MATCHING_HELPERS_FILE, "utf8");

  /**
   * The lockForCertificationCheck slice — the injection-surface pin target.
   * The no-interpolation ban is scoped to this slice: the lock query is a
   * pure bound-parameter read, while the file's OTHER reads (incl. the
   * batch sweep's parameterized EXISTS probes) legitimately interpolate
   * Drizzle column references / enum values inside `sql` templates — which
   * renders as bound parameters, not SQL text.
   */
  function lockSource(): string {
    const start = repoSource.indexOf("export async function lockForCertificationCheck(");
    return repoSource.slice(start, repoSource.indexOf("\n  }", start));
  }

  test("source: the lock's id reaches the query only as a bound parameter (no injection surface)", () => {
    // Whole-file: no SQL comment markers anywhere in the repository. The
    // `${` probe is scoped to the lock read: the batch sweep's parameterized
    // EXISTS probes interpolate schema columns by design, and every one of
    // those reaches the driver as a bound value or a quoted identifier —
    // never a concatenated string.
    expect(repoSource.includes("--")).toBe(false);
    // The lock/release/toggle primitives carry the file's ONLY sanctioned
    // template interpolations — the acquire statement's COALESCE capture
    // (two column references reading the row's own pre-update values), the
    // release statement's restore assignment over the row's own marker
    // column plus the release probe's session table + its teacher_id/status
    // column references, and the toggle statement's marker CASE (the row's
    // own marker column + the bound intent value) plus the toggle guard's
    // bound direction leg + session table + its teacher_id/status column
    // references — every interpolated byte is row/server-owned; caller
    // data never interpolates.
    // plus the inactivity sweep's lock-then-recheck probes (both
    // statements re-run the same two EXISTS legs — the users-row staleness
    // probe and the started-session exemption — over Drizzle column
    // references, the caller-captured cutoff instant rendered as a bound
    // parameter, and the pinned-ids re-check), and the matching read's
    // ORDER-BY templates (country tier asc, the
    // post-tier sort keys — country tier asc + rating desc nulls last +
    // name asc + the governance DISTINCT-FROM chain columns — Drizzle
    // column references rendered as bound SQL).
    const interpolatedFragmentCount = [
      repoSource,
      readFileSync(REPO_DIRECTORY_HELPERS_FILE, "utf8"),
      matchingHelpersSource,
    ].reduce((sum, source) => sum + source.split("${").length - 1, 0);
    expect(interpolatedFragmentCount).toBe(49);
    expect(repoSource.includes(`COALESCE(\${teacher.wasOnlineBeforeLock}, \${teacher.isOnline})`)).toBe(true);
    // The certification lock read remains a pure bound-parameter read: the
    // no-interpolation ban is scoped to its slice (the file's other reads
    // legitimately interpolate Drizzle column references / enum values,
    // which render as bound parameters, not SQL text).
    expect(lockSource().includes("${")).toBe(false);
  });

  test("source: no prepared statements and no module-level query state", () => {
    expect(repoSource.includes(".prepare(")).toBe(false);
    expect(repoSource.includes("sql.placeholder")).toBe(false);
  });

  test("source: lockForCertificationCheck requires tx: DBTransaction", () => {
    expect(repoSource.includes("lockForCertificationCheck(\n    teacherId: number,\n    tx: DBTransaction\n  )")).toBe(
      true
    );
  });

  test("source: no i18n, no logger, no console, no business logic", () => {
    expect(repoSource.includes("getServerTranslations")).toBe(false);
    expect(repoSource.includes("logger")).toBe(false);
    expect(repoSource.includes("console.")).toBe(false);
  });

  test("source: locking read uses .for('update') with a two-column projection", () => {
    expect(repoSource.includes("export namespace TeacherRepository")).toBe(true);
    expect(repoSource.includes('.for("update")')).toBe(true);
    expect(repoSource.includes("id: teacher.id")).toBe(true);
    expect(repoSource.includes("isApproved: teacher.isApproved")).toBe(true);
  });

  test("source: comments describe domain behavior only (no plan-artifact references)", () => {
    expect(/REQ-\d|DEV3|Phase \d|Task \d|plan\.md|tasks\.md|specs\.md/.test(repoSource)).toBe(false);
  });
});

/** The acquireInSessionLock slice of the repository source (the static pin target). */
function repoAcquireInSessionLockSource(): string {
  const source = readFileSync(join(import.meta.dir, "../../../repo/teachers/teacher.repository.ts"), "utf8");
  const start = source.indexOf("export async function acquireInSessionLock(");
  return source.slice(start, source.indexOf("\n  }", start));
}

describe("TeacherRepository.acquireInSessionLock (the capture-and-lock primitive)", () => {
  // ─── Tier 1: branch/statement ───────────────────────────────────────

  test("captures true and locks: an online teacher leaves with marker true and is_online false", async () => {
    await runInRollback(async tx => {
      const user = await createTestUser(tx, { role: "teacher" });
      await createTestTeacherRow(tx, user.id, true);
      // The fixture default is isOnline=false; force the online state first.
      await tx.update(teacher).set({ isOnline: true }).where(eq(teacher.id, user.id));

      const row = await TeacherRepository.acquireInSessionLock(user.id, tx);

      expect(row).not.toBeNull();
      if (!row) throw new Error("expected the updated teacher row");
      expect(row.id).toBe(user.id);
      expect(row.wasOnlineBeforeLock).toBe(true);
      expect(row.isOnline).toBe(false);
      // Independent read-back oracle (same tx — read-your-writes).
      const [reread] = await tx.select().from(teacher).where(eq(teacher.id, user.id));
      expect(reread?.wasOnlineBeforeLock).toBe(true);
      expect(reread?.isOnline).toBe(false);
    });
  });

  test("captures false and locks: an offline teacher seeds the never-resurrect marker (stays false)", async () => {
    await runInRollback(async tx => {
      const user = await createTestUser(tx, { role: "teacher" });
      await createTestTeacherRow(tx, user.id, true); // fixture default: isOnline=false

      const row = await TeacherRepository.acquireInSessionLock(user.id, tx);

      expect(row).not.toBeNull();
      expect(row?.wasOnlineBeforeLock).toBe(false);
      expect(row?.isOnline).toBe(false);
      // Independent read-back oracle.
      const [reread] = await tx.select().from(teacher).where(eq(teacher.id, user.id));
      expect(reread?.wasOnlineBeforeLock).toBe(false);
      expect(reread?.isOnline).toBe(false);
    });
  });

  test("returns null for a missing teacher row (fail-closed — nothing was written)", async () => {
    await runInRollback(async tx => {
      const absentId = await absentTeacherId(tx);

      const row = await TeacherRepository.acquireInSessionLock(absentId, tx);

      expect(row).toBeNull();
      // Zero writes: no row appeared for the absent id.
      const [absent] = await tx.select().from(teacher).where(eq(teacher.id, absentId));
      expect(absent).toBeUndefined();
    });
  });

  // ─── Tier 2: boundary / honest failure ──────────────────────────────

  test("a row with is_online = NULL captures NULL (COALESCE reads the unknown state verbatim)", async () => {
    await runInRollback(async tx => {
      const user = await createTestUser(tx, { role: "teacher" });
      await createTestTeacherRow(tx, user.id, true);
      // Force the column to NULL — the schema permits it (no notNull).
      await tx.update(teacher).set({ isOnline: null }).where(eq(teacher.id, user.id));

      const row = await TeacherRepository.acquireInSessionLock(user.id, tx);

      expect(row).not.toBeNull();
      // The pinned capture semantics: COALESCE over a NULL marker and a
      // NULL is_online yields NULL — no availability intent is invented
      // for unknown state — while the lock itself still applies.
      expect(row?.wasOnlineBeforeLock).toBeNull();
      expect(row?.isOnline).toBe(false);
      const [reread] = await tx.select().from(teacher).where(eq(teacher.id, user.id));
      expect(reread?.wasOnlineBeforeLock).toBeNull();
      expect(reread?.isOnline).toBe(false);
    });
  });

  test("a second acquire preserves the first marker (first-lock-wins — not clobbered by the now-false is_online)", async () => {
    await runInRollback(async tx => {
      const user = await createTestUser(tx, { role: "teacher" });
      await createTestTeacherRow(tx, user.id, true);
      await tx.update(teacher).set({ isOnline: true }).where(eq(teacher.id, user.id));

      const first = await TeacherRepository.acquireInSessionLock(user.id, tx);
      // Without the COALESCE guard this second acquire would capture the
      // row's CURRENT is_online (false) and destroy the first capture —
      // the pinned statement must keep the first marker instead.
      const second = await TeacherRepository.acquireInSessionLock(user.id, tx);

      expect(first?.wasOnlineBeforeLock).toBe(true);
      expect(second).not.toBeNull();
      expect(second?.wasOnlineBeforeLock).toBe(true);
      expect(second?.isOnline).toBe(false);
      const [reread] = await tx.select().from(teacher).where(eq(teacher.id, user.id));
      expect(reread?.wasOnlineBeforeLock).toBe(true);
      expect(reread?.isOnline).toBe(false);
    });
  });

  test("re-acquiring while the marker is set is idempotent (same-value write, stable state)", async () => {
    await runInRollback(async tx => {
      const user = await createTestUser(tx, { role: "teacher" });
      await createTestTeacherRow(tx, user.id, true);

      await TeacherRepository.acquireInSessionLock(user.id, tx);
      const again = await TeacherRepository.acquireInSessionLock(user.id, tx);

      expect(again).not.toBeNull();
      expect(again?.wasOnlineBeforeLock).toBe(false);
      expect(again?.isOnline).toBe(false);
      const [reread] = await tx.select().from(teacher).where(eq(teacher.id, user.id));
      expect(reread?.wasOnlineBeforeLock).toBe(false);
      expect(reread?.isOnline).toBe(false);
    });
  });

  // ─── Tier 3: acquire chaos (concurrent acquires, ONE row, one tx) ───

  test("20-way Promise.allSettled acquire storm on ONE row ⇒ marker = first-captured value, is_online false", async () => {
    await runInRollback(async tx => {
      const user = await createTestUser(tx, { role: "teacher" });
      await createTestTeacherRow(tx, user.id, true);
      await tx.update(teacher).set({ isOnline: true }).where(eq(teacher.id, user.id));

      // Twenty concurrent acquires ride the SAME transaction: the single
      // connection serializes them behind the row's lock, so the FIRST
      // statement captures is_online=true and every later statement keeps
      // it via the COALESCE guard (first-lock-wins).
      const results = await Promise.allSettled(
        Array.from({ length: 20 }, () => TeacherRepository.acquireInSessionLock(user.id, tx))
      );

      const rows = results.map(outcome => {
        if (outcome.status !== "fulfilled") {
          throw new Error("expected every racing acquire to resolve without error");
        }
        return outcome.value;
      });
      expect(rows).toHaveLength(20);
      // Every statement's RETURNING row reports the SAME first-captured
      // marker and the locked flag — no acquire clobbered another.
      for (const row of rows) {
        expect(row?.wasOnlineBeforeLock).toBe(true);
        expect(row?.isOnline).toBe(false);
      }

      // Converged persisted state: marker = the first-captured value.
      const [reread] = await tx.select().from(teacher).where(eq(teacher.id, user.id));
      expect(reread?.wasOnlineBeforeLock).toBe(true);
      expect(reread?.isOnline).toBe(false);
    });
  });

  // ─── Tier 4: hostile ids ────────────────────────────────────────────

  test("hostile in-domain ids are equality misses — 0, -1, and far-beyond-sequence return null, writing nothing", async () => {
    await runInRollback(async tx => {
      const absentId = await absentTeacherId(tx);
      const [before] = await tx.select({ count: sql<number>`count(*)::int` }).from(teacher);

      expect(await TeacherRepository.acquireInSessionLock(0, tx)).toBeNull();
      expect(await TeacherRepository.acquireInSessionLock(-1, tx)).toBeNull();
      expect(await TeacherRepository.acquireInSessionLock(absentId, tx)).toBeNull();

      // Zero side effects: the row population is unchanged.
      const [after] = await tx.select({ count: sql<number>`count(*)::int` }).from(teacher);
      expect(after?.count).toBe(before?.count);
    });
  });

  test("ids beyond the integer domain fail LOUD at the driver gate — nothing executes, zero side effects", async () => {
    await runInRollback(async tx => {
      const [before] = await tx.select({ count: sql<number>`count(*)::int` }).from(teacher);

      // NaN cannot parse as an integer: the statement dies at the driver's
      // type gate as the RAW data exception (untranslated, cause-chained).
      await tx.execute(sql`savepoint acquire_hostile_nan_probe`);
      const nanError = await expectRepoError(() => TeacherRepository.acquireInSessionLock(Number.NaN, tx));
      await tx.execute(sql`rollback to savepoint acquire_hostile_nan_probe`);
      expect(hasPostgresErrorCode(nanError, "22P02")).toBe(true);

      // 2^53 overflows the id column's int4 domain: the RAW range exception.
      await tx.execute(sql`savepoint acquire_hostile_overflow_probe`);
      const overflowError = await expectRepoError(() => TeacherRepository.acquireInSessionLock(2 ** 53, tx));
      await tx.execute(sql`rollback to savepoint acquire_hostile_overflow_probe`);
      expect(hasPostgresErrorCode(overflowError, "22003")).toBe(true);

      // Zero side effects: neither failed statement wrote anything.
      const [after] = await tx.select({ count: sql<number>`count(*)::int` }).from(teacher);
      expect(after?.count).toBe(before?.count);
    });
  });

  // ─── Tier 4: static surface pins ────────────────────────────────────

  test("source: acquireInSessionLock is a REQUIRED-tx guarded write returning the row or null", () => {
    const source = repoAcquireInSessionLockSource();
    expect(source).toContain("export async function acquireInSessionLock(");
    expect(source).toContain("id: number");
    expect(source).toContain("tx: DBTransaction");
    // Required tx — the parameter is not optional (calling without one is
    // a compile error, the type-level pin).
    expect(source).not.toContain("tx?:");
    expect(source).toContain(".returning()");
    // The pinned capture expression over the row's own columns.
    expect(source).toContain(`COALESCE(\${teacher.wasOnlineBeforeLock}, \${teacher.isOnline})`);
    expect(source).toContain("isOnline: false");
    expect(source).toContain("updatedAt: sql`now()`");
  });

  test("source: the id reaches the WHERE clause only as a bound parameter; no scan surface, no template comments", () => {
    const source = repoAcquireInSessionLockSource();
    expect(source).toContain("eq(teacher.id, id)");
    expect(source).not.toMatch(/\b(ilike|like)\s*\(/i);
    expect(source.includes(".prepare(")).toBe(false);
    // No inline `--` comments inside the sql template (parameter-shift hazard).
    expect(source.includes("--")).toBe(false);
  });
});

describe("TeacherRepository.releaseInSessionLock (the marker-gated last-exit release)", () => {
  // ─── Tier 1: branch/statement ───────────────────────────────────────

  test("restores true: a marker of true returns is_online to true and consumes the marker (released)", async () => {
    await runInRollback(async tx => {
      const user = await createTestUser(tx, { role: "teacher" });
      await createTestTeacherRow(tx, user.id, true);
      await tx.update(teacher).set({ isOnline: true }).where(eq(teacher.id, user.id));
      await TeacherRepository.acquireInSessionLock(user.id, tx);

      const result = await TeacherRepository.releaseInSessionLock(user.id, tx);

      expect(result?.outcome).toBe("released");
      expect(result?.teacher.id).toBe(user.id);
      expect(result?.teacher.isOnline).toBe(true);
      expect(result?.teacher.wasOnlineBeforeLock).toBeNull();
      // Independent read-back oracle (same tx — read-your-writes).
      const [reread] = await tx.select().from(teacher).where(eq(teacher.id, user.id));
      expect(reread?.isOnline).toBe(true);
      expect(reread?.wasOnlineBeforeLock).toBeNull();
    });
  });

  test("restores false (never-resurrect): a marker of false keeps is_online false and consumes the marker", async () => {
    await runInRollback(async tx => {
      const user = await createTestUser(tx, { role: "teacher" });
      await createTestTeacherRow(tx, user.id, true); // fixture default: isOnline=false
      await TeacherRepository.acquireInSessionLock(user.id, tx); // captures the false intent

      const result = await TeacherRepository.releaseInSessionLock(user.id, tx);

      // The pre-lock intent was offline: the release must NOT resurrect.
      expect(result?.outcome).toBe("released");
      expect(result?.teacher.isOnline).toBe(false);
      expect(result?.teacher.wasOnlineBeforeLock).toBeNull();
      const [reread] = await tx.select().from(teacher).where(eq(teacher.id, user.id));
      expect(reread?.isOnline).toBe(false);
      expect(reread?.wasOnlineBeforeLock).toBeNull();
    });
  });

  test("three-outcome disambiguation exactness: one row walks active_sessions_remain → released → no_lock_held", async () => {
    await runInRollback(async tx => {
      const user = await createTestUser(tx, { role: "teacher" });
      await createTestTeacherRow(tx, user.id, true);
      await tx.update(teacher).set({ isOnline: true }).where(eq(teacher.id, user.id));
      await TeacherRepository.acquireInSessionLock(user.id, tx);
      const sessionAId = await createTeacherSession(tx, user.id, SessionStatus.Started);
      const sessionBId = await createTeacherSession(tx, user.id, SessionStatus.Started);

      // Session A's exit lands while session B is still started: the
      // guarded statement matches ZERO rows (the probe sees B) and the
      // miss classifies as active_sessions_remain — nothing was restored.
      await tx.delete(session).where(eq(session.id, sessionAId));
      const deferred = await TeacherRepository.releaseInSessionLock(user.id, tx);
      expect(deferred?.outcome).toBe("active_sessions_remain");
      expect(deferred?.teacher.wasOnlineBeforeLock).toBe(true);
      expect(deferred?.teacher.isOnline).toBe(false);

      // The final exit restores the ORIGINAL pre-lock intent exactly once.
      await tx.delete(session).where(eq(session.id, sessionBId));
      const released = await TeacherRepository.releaseInSessionLock(user.id, tx);
      expect(released?.outcome).toBe("released");
      expect(released?.teacher.isOnline).toBe(true);
      expect(released?.teacher.wasOnlineBeforeLock).toBeNull();

      // A redundant attempt is the third outcome: classified, side-effect-free.
      const redundant = await TeacherRepository.releaseInSessionLock(user.id, tx);
      expect(redundant?.outcome).toBe("no_lock_held");
      expect(redundant?.teacher.isOnline).toBe(true);
      expect(redundant?.teacher.wasOnlineBeforeLock).toBeNull();
    });
  });

  test("returns null for a missing teacher row (fail-closed — nothing was written)", async () => {
    await runInRollback(async tx => {
      const absentId = await absentTeacherId(tx);

      const result = await TeacherRepository.releaseInSessionLock(absentId, tx);

      expect(result).toBeNull();
      // Zero writes: no row appeared for the absent id.
      const [absent] = await tx.select().from(teacher).where(eq(teacher.id, absentId));
      expect(absent).toBeUndefined();
    });
  });

  // ─── Tier 2: boundary / honest failure ──────────────────────────────

  test("no_lock_held on a NULL marker — including a scheduled row with a reschedule-polluted startedAt", async () => {
    await runInRollback(async tx => {
      const user = await createTestUser(tx, { role: "teacher" });
      // Pinned-epoch stamp: if the release wrote ANYTHING, updated_at moves.
      await createTeacherRowFixture(tx, user.id, { updatedAt: new Date(0) });
      // The admin-reschedule pollution: a scheduled row stamped with a
      // non-null startedAt. The release classifier never reads startedAt —
      // only the marker decides, and the marker is NULL.
      await createTeacherSession(tx, user.id, SessionStatus.Scheduled, { startedAt: new Date() });

      const result = await TeacherRepository.releaseInSessionLock(user.id, tx);

      expect(result?.outcome).toBe("no_lock_held");
      expect(result?.teacher.id).toBe(user.id);
      // No-op writes NOTHING: flag, marker and the pinned stamp are intact.
      const [reread] = await tx.select().from(teacher).where(eq(teacher.id, user.id));
      expect(reread?.isOnline).toBe(false);
      expect(reread?.wasOnlineBeforeLock).toBeNull();
      expect(reread?.updatedAt.getTime()).toBe(0);
    });
  });

  test("active_sessions_remain while a started session exists — and the deferred attempt writes NOTHING", async () => {
    await runInRollback(async tx => {
      const user = await createTestUser(tx, { role: "teacher" });
      // The exact post-acquire persisted state, seeded directly so the
      // updated_at stamp stays pinned to the epoch for the no-op proof.
      await createTeacherRowFixture(tx, user.id, { wasOnlineBeforeLock: true, updatedAt: new Date(0) });
      await createTeacherSession(tx, user.id, SessionStatus.Started);

      const result = await TeacherRepository.releaseInSessionLock(user.id, tx);

      expect(result?.outcome).toBe("active_sessions_remain");
      expect(result?.teacher.isOnline).toBe(false);
      expect(result?.teacher.wasOnlineBeforeLock).toBe(true);
      // The deferred path restored NOTHING: marker still set, is_online
      // still false, updated_at still the pinned epoch.
      const [reread] = await tx.select().from(teacher).where(eq(teacher.id, user.id));
      expect(reread?.isOnline).toBe(false);
      expect(reread?.wasOnlineBeforeLock).toBe(true);
      expect(reread?.updatedAt.getTime()).toBe(0);
    });
  });

  // ─── Tier 3: concurrency (racing exits, cross-teacher control, storm)

  test("two exits race one teacher's final release: exactly one released, one active_sessions_remain, ONE restore", async () => {
    await runInRollback(async tx => {
      const user = await createTestUser(tx, { role: "teacher" });
      await createTestTeacherRow(tx, user.id, true);
      await tx.update(teacher).set({ isOnline: true }).where(eq(teacher.id, user.id));
      await TeacherRepository.acquireInSessionLock(user.id, tx);
      const sessionAId = await createTeacherSession(tx, user.id, SessionStatus.Started);
      const sessionBId = await createTeacherSession(tx, user.id, SessionStatus.Started);

      // Two terminal exits race under Promise.allSettled (each exit: its
      // own session transition, then the release attempt). The gate holds
      // the second transition until the first release attempt has RUN —
      // the overlapping-exits interleaving: the first attempt must see the
      // other session still started and defer; the final attempt restores
      // the ORIGINAL captured intent exactly once. Nothing blocks the
      // single connection while the gate is open (pure JS wait).
      const finalExitMayLand = createGate();
      const settled = await Promise.allSettled([
        (async () => {
          await tx.delete(session).where(eq(session.id, sessionAId));
          const deferred = await TeacherRepository.releaseInSessionLock(user.id, tx);
          finalExitMayLand.open();
          return deferred;
        })(),
        (async () => {
          await finalExitMayLand.promise;
          await tx.delete(session).where(eq(session.id, sessionBId));
          return TeacherRepository.releaseInSessionLock(user.id, tx);
        })(),
      ]);

      const outcomes = settled.map(entry => {
        if (entry.status !== "fulfilled") {
          throw new Error("expected both racing exits to resolve without error");
        }
        return entry.value?.outcome;
      });
      expect(outcomes).toStrictEqual(["active_sessions_remain", "released"]);
      // Converged state: one restore, per the ORIGINAL pre-lock intent.
      const [reread] = await tx.select().from(teacher).where(eq(teacher.id, user.id));
      expect(reread?.isOnline).toBe(true);
      expect(reread?.wasOnlineBeforeLock).toBeNull();
    });
  });

  test("two teachers racing their own releases BOTH restore (no cross-teacher interference)", async () => {
    await runInRollback(async tx => {
      const onlineTeacher = await createTestUser(tx, { role: "teacher" });
      await createTestTeacherRow(tx, onlineTeacher.id, true);
      await tx.update(teacher).set({ isOnline: true }).where(eq(teacher.id, onlineTeacher.id));
      const offlineTeacher = await createTestUser(tx, { role: "teacher" });
      await createTestTeacherRow(tx, offlineTeacher.id, true); // default isOnline=false
      // Sequential fixture setup on the ONE transaction (each acquire +
      // started session is a statement on the same connection — the two
      // teachers' locked states are independent, so no interleaving is
      // modeled here; the releases below are the racing part).
      await TeacherRepository.acquireInSessionLock(onlineTeacher.id, tx);
      await createTeacherSession(tx, onlineTeacher.id, SessionStatus.Started);
      await TeacherRepository.acquireInSessionLock(offlineTeacher.id, tx);
      await createTeacherSession(tx, offlineTeacher.id, SessionStatus.Started);
      // Both exits land first (each teacher's own probe is teacher_id-
      // scoped), then the two releases race — order-independent.
      await tx.delete(session).where(eq(session.teacherId, onlineTeacher.id));
      await tx.delete(session).where(eq(session.teacherId, offlineTeacher.id));

      const settled = await Promise.allSettled([
        TeacherRepository.releaseInSessionLock(onlineTeacher.id, tx),
        TeacherRepository.releaseInSessionLock(offlineTeacher.id, tx),
      ]);
      const results = settled.map(entry => {
        if (entry.status !== "fulfilled") {
          throw new Error("expected both racing releases to resolve without error");
        }
        return entry.value;
      });
      // BOTH release — each teacher restores its OWN pre-lock intent.
      expect(results.map(result => result?.outcome)).toStrictEqual(["released", "released"]);
      const [onlineRow] = await tx.select().from(teacher).where(eq(teacher.id, onlineTeacher.id));
      const [offlineRow] = await tx.select().from(teacher).where(eq(teacher.id, offlineTeacher.id));
      expect(onlineRow?.isOnline).toBe(true);
      expect(onlineRow?.wasOnlineBeforeLock).toBeNull();
      expect(offlineRow?.isOnline).toBe(false);
      expect(offlineRow?.wasOnlineBeforeLock).toBeNull();
    });
  });

  test("20-way Promise.allSettled release storm on ONE row ⇒ exactly one released, nineteen classified no-ops", async () => {
    await runInRollback(async tx => {
      const user = await createTestUser(tx, { role: "teacher" });
      await createTestTeacherRow(tx, user.id, true);
      await tx.update(teacher).set({ isOnline: true }).where(eq(teacher.id, user.id));
      await TeacherRepository.acquireInSessionLock(user.id, tx);

      // Twenty concurrent releases ride the SAME transaction (no started
      // rows remain, so none is deferred): the single connection serializes
      // them behind the row's lock — the FIRST release restores the
      // captured intent and consumes the marker; every later release
      // degrades to the classified no-op. The storm pins restore-ONCE.
      const results = await Promise.allSettled(
        Array.from({ length: 20 }, () => TeacherRepository.releaseInSessionLock(user.id, tx))
      );

      const outcomes = results.map(entry => {
        if (entry.status !== "fulfilled") {
          throw new Error("expected every racing release to resolve without error");
        }
        return entry.value?.outcome;
      });
      expect(outcomes.filter(outcome => outcome === "released")).toHaveLength(1);
      expect(outcomes.filter(outcome => outcome === "no_lock_held")).toHaveLength(19);
      expect(outcomes.filter(outcome => outcome === "active_sessions_remain")).toHaveLength(0);
      // Converged persisted state: restored exactly once, marker consumed.
      const [reread] = await tx.select().from(teacher).where(eq(teacher.id, user.id));
      expect(reread?.isOnline).toBe(true);
      expect(reread?.wasOnlineBeforeLock).toBeNull();
    });
  });

  // ─── Tier 3: cross-connection racing releases (real PostgreSQL) ──────
  // The racing releases serialize on a REAL row lock held across
  // independent connections (PGlite is single-connection WASM and cannot
  // observe cross-transaction lock waits); the committed fixtures are
  // hard-deleted in `afterAll`.
  const testOnRealPostgres = isPgliteProvider() ? test.skip : test;

  testOnRealPostgres(
    "double-complete interleave across two connections: exactly ONE release (the both-defer strand is closed)",
    async () => {
      const teacherUserId = await createCommittedTeacher(true);
      committedRaceTeacherUserIds.push(teacherUserId);
      // Committed in-session state: online teacher locked (marker true,
      // is_online false) with TWO started sessions — two concurrent
      // terminal exits about to race their releases.
      const [sessionAId, sessionBId] = await db.transaction(async txSetup => {
        await txSetup.update(teacher).set({ isOnline: true }).where(eq(teacher.id, teacherUserId));
        await TeacherRepository.acquireInSessionLock(teacherUserId, txSetup);
        const startedSessionA = await createTeacherSession(txSetup, teacherUserId, SessionStatus.Started);
        const startedSessionB = await createTeacherSession(txSetup, teacherUserId, SessionStatus.Started);
        return [startedSessionA, startedSessionB] as const;
      });

      // The double-complete interleave, mirrored exactly: each connection
      // completes its OWN started row, BOTH completions land un-committed
      // before either release starts (the two-gate barrier), and the two
      // releases then race.
      const exitACompleted = createGate();
      const exitBCompleted = createGate();
      const settled = await Promise.allSettled([
        db.transaction(async txExitA => {
          await txExitA.update(session).set({ status: SessionStatus.Completed }).where(eq(session.id, sessionAId));
          exitACompleted.open();
          await exitBCompleted.promise;
          return TeacherRepository.releaseInSessionLock(teacherUserId, txExitA);
        }),
        db.transaction(async txExitB => {
          await txExitB.update(session).set({ status: SessionStatus.Completed }).where(eq(session.id, sessionBId));
          exitBCompleted.open();
          await exitACompleted.promise;
          return TeacherRepository.releaseInSessionLock(teacherUserId, txExitB);
        }),
      ]);

      const outcomes = settled.map(entry => {
        if (entry.status !== "fulfilled") {
          throw new Error("expected both racing exits to resolve without error");
        }
        return entry.value?.outcome;
      });
      // Exactly ONE exit restores the lock: the serialization preamble
      // takes the teacher-row write lock BEFORE the last-exit probe, so the
      // later release re-reads the committed state (the earlier exit's
      // completion now visible) instead of deferring on its own pre-lock
      // snapshot. Without that serialization BOTH exits see the other's
      // un-committed completion, BOTH defer, and the lock strands (marker
      // set, zero started sessions).
      expect(outcomes.filter(outcome => outcome === "released")).toHaveLength(1);
      expect(outcomes.filter(outcome => outcome === "active_sessions_remain")).toHaveLength(1);
      expect(outcomes.filter(outcome => outcome === "no_lock_held")).toHaveLength(0);

      // Converged committed state: the ORIGINAL pre-lock intent restored,
      // the marker consumed, zero started sessions — the strand is closed.
      const [finalRow] = await db.select().from(teacher).where(eq(teacher.id, teacherUserId));
      expect(finalRow?.isOnline).toBe(true);
      expect(finalRow?.wasOnlineBeforeLock).toBeNull();
      const [startedLeft] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(session)
        .where(and(eq(session.teacherId, teacherUserId), eq(session.status, SessionStatus.Started)));
      expect(startedLeft?.count).toBe(0);

      // The redundancy probe the deferred exit promised: the marker is now
      // NULL, so a further cross-connection release is the classified
      // no-lock-held no-op.
      const redundant = await db.transaction(txProbe => TeacherRepository.releaseInSessionLock(teacherUserId, txProbe));
      expect(redundant?.outcome).toBe("no_lock_held");
    }
  );

  testOnRealPostgres(
    "releases race after both exits committed: one released, the serialized re-read degrades to no_lock_held",
    async () => {
      const teacherUserId = await createCommittedTeacher(true);
      committedRaceTeacherUserIds.push(teacherUserId);
      const [sessionAId, sessionBId] = await db.transaction(async txSetup => {
        await txSetup.update(teacher).set({ isOnline: true }).where(eq(teacher.id, teacherUserId));
        await TeacherRepository.acquireInSessionLock(teacherUserId, txSetup);
        const startedSessionA = await createTeacherSession(txSetup, teacherUserId, SessionStatus.Started);
        const startedSessionB = await createTeacherSession(txSetup, teacherUserId, SessionStatus.Started);
        return [startedSessionA, startedSessionB] as const;
      });

      // Each terminal exit completes its own started row on its OWN
      // connection (both completions committed and durable), then two fresh
      // connections race the release itself.
      await db.transaction(async txExitA => {
        await txExitA.update(session).set({ status: SessionStatus.Completed }).where(eq(session.id, sessionAId));
      });
      await db.transaction(async txExitB => {
        await txExitB.update(session).set({ status: SessionStatus.Completed }).where(eq(session.id, sessionBId));
      });

      const settled = await Promise.allSettled([
        db.transaction(txReleaseA => TeacherRepository.releaseInSessionLock(teacherUserId, txReleaseA)),
        db.transaction(txReleaseB => TeacherRepository.releaseInSessionLock(teacherUserId, txReleaseB)),
      ]);

      const outcomes = settled.map(entry => {
        if (entry.status !== "fulfilled") {
          throw new Error("expected both racing releases to resolve without error");
        }
        return entry.value?.outcome;
      });
      // The winner restores per the ORIGINAL pre-lock intent; the loser's
      // preamble waits out the winner's transaction, and its re-read finds
      // the marker NULL — the classified no-lock-held no-op.
      expect(outcomes.filter(outcome => outcome === "released")).toHaveLength(1);
      expect(outcomes.filter(outcome => outcome === "no_lock_held")).toHaveLength(1);
      expect(outcomes.filter(outcome => outcome === "active_sessions_remain")).toHaveLength(0);

      // Converged committed state: one restore, marker consumed, zero
      // started sessions.
      const [finalRow] = await db.select().from(teacher).where(eq(teacher.id, teacherUserId));
      expect(finalRow?.isOnline).toBe(true);
      expect(finalRow?.wasOnlineBeforeLock).toBeNull();
      const [startedLeft] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(session)
        .where(and(eq(session.teacherId, teacherUserId), eq(session.status, SessionStatus.Started)));
      expect(startedLeft?.count).toBe(0);
    }
  );

  // ─── Tier 4: hostile ids + plan capture ─────────────────────────────

  test("hostile in-domain ids are equality misses — 0, -1, and far-beyond-sequence return null, writing nothing", async () => {
    await runInRollback(async tx => {
      const absentId = await absentTeacherId(tx);
      const [before] = await tx.select({ count: sql<number>`count(*)::int` }).from(teacher);

      expect(await TeacherRepository.releaseInSessionLock(0, tx)).toBeNull();
      expect(await TeacherRepository.releaseInSessionLock(-1, tx)).toBeNull();
      expect(await TeacherRepository.releaseInSessionLock(absentId, tx)).toBeNull();

      // Zero side effects: the row population is unchanged.
      const [after] = await tx.select({ count: sql<number>`count(*)::int` }).from(teacher);
      expect(after?.count).toBe(before?.count);
    });
  });

  test("ids beyond the integer domain fail LOUD at the driver gate — nothing executes, zero side effects", async () => {
    await runInRollback(async tx => {
      const [before] = await tx.select({ count: sql<number>`count(*)::int` }).from(teacher);

      // NaN cannot parse as an integer: the guarded statement dies at the
      // driver's type gate as the RAW data exception (untranslated,
      // cause-chained) — the disambiguation read never runs.
      await tx.execute(sql`savepoint release_hostile_nan_probe`);
      const nanError = await expectRepoError(() => TeacherRepository.releaseInSessionLock(Number.NaN, tx));
      await tx.execute(sql`rollback to savepoint release_hostile_nan_probe`);
      expect(hasPostgresErrorCode(nanError, "22P02")).toBe(true);

      // 2^53 overflows the id column's int4 domain: the RAW range exception.
      await tx.execute(sql`savepoint release_hostile_overflow_probe`);
      const overflowError = await expectRepoError(() => TeacherRepository.releaseInSessionLock(2 ** 53, tx));
      await tx.execute(sql`rollback to savepoint release_hostile_overflow_probe`);
      expect(hasPostgresErrorCode(overflowError, "22003")).toBe(true);

      // Zero side effects: neither failed statement wrote anything.
      const [after] = await tx.select({ count: sql<number>`count(*)::int` }).from(teacher);
      expect(after?.count).toBe(before?.count);
    });
  });

  test("EXPLAIN capture: the last-exit probe plans as a teacher-row-guarded NOT EXISTS over session (no index added)", async () => {
    await runInRollback(async tx => {
      // The guard-shaped read the release's WHERE clause evaluates: the
      // marker predicate on the locked teacher row plus the NOT EXISTS
      // probe over that teacher's own started sessions. EXPLAIN executes
      // nothing — a pure plan capture (no index added; the plan text is
      // asserted, the cost summary is recorded in the task outcome).
      const explained = await tx.execute<{ "QUERY PLAN": string }>(sql`
        EXPLAIN SELECT 1
        FROM teacher
        WHERE teacher.id = ${1}
          AND teacher.was_online_before_lock IS NOT NULL
          AND NOT EXISTS (
            SELECT 1 FROM session
            WHERE session.teacher_id = ${1} AND session.status = ${SessionStatus.Started}
          )
      `);
      const plan = explained.rows.map(row => row["QUERY PLAN"]).join("\n");
      expect(plan).toContain("cost=");
      expect(plan.toLowerCase()).toContain("session");
      expect(plan.toLowerCase()).toContain("was_online_before_lock");
    });
  });

  // ─── Tier 4: static surface pins ────────────────────────────────────

  const RELEASE_REPO_FILE = join(import.meta.dir, "../../../repo/teachers/teacher.repository.ts");
  const releaseRepoSource = readFileSync(RELEASE_REPO_FILE, "utf8");

  /** The releaseInSessionLock slice of the repository source (the static pin target). */
  function repoReleaseInSessionLockSource(): string {
    const start = releaseRepoSource.indexOf("export async function releaseInSessionLock(");
    return releaseRepoSource.slice(start, releaseRepoSource.indexOf("\n  }", start));
  }

  test("source: releaseInSessionLock is a REQUIRED-tx guarded write returning the classified outcome", () => {
    const source = repoReleaseInSessionLockSource();
    expect(source).toContain("export async function releaseInSessionLock(");
    expect(source).toContain("teacherId: number");
    expect(source).toContain("tx: DBTransaction");
    // Required tx — the parameter is not optional (calling without one is
    // a compile error, the type-level pin).
    expect(source).not.toContain("tx?:");
    expect(source).toContain(".returning()");
    // The pinned restore assignment over the row's own pre-update marker.
    expect(source).toContain(`isOnline: sql\`\${teacher.wasOnlineBeforeLock}\``);
    expect(source).toContain("wasOnlineBeforeLock: null");
    expect(source).toContain("updatedAt: sql`now()`");
    // The last-exit guard rides the WHERE clause (marker + NOT EXISTS probe).
    expect(source).toContain("isNotNull(teacher.wasOnlineBeforeLock)");
    // The cold-path disambiguation: ONE adjacent read classifies the miss
    // into exactly the three outcome members (+ the null miss signal).
    expect(source).toContain("findById(teacherId, tx)");
    expect(source).toContain('"released"');
    expect(source).toContain('"no_lock_held"');
    expect(source).toContain('"active_sessions_remain"');
  });

  test("source: bound id, value-imported SessionStatus, no scan surface, no template comments", () => {
    const source = repoReleaseInSessionLockSource();
    expect(source).toContain("eq(teacher.id, teacherId)");
    expect(source).toContain("eq(session.teacherId, teacherId)");
    expect(source).toContain(
      `NOT EXISTS (SELECT 1 FROM \${session} WHERE \${eq(session.teacherId, teacherId)} AND \${eq(session.status, SessionStatus.Started)})`
    );
    // The status predicate rides the enum member, never a string literal.
    expect(source).toContain("eq(session.status, SessionStatus.Started)");
    expect(source).not.toMatch(/\b(ilike|like)\s*\(/i);
    expect(source.includes(".prepare(")).toBe(false);
    expect(source.includes("--")).toBe(false);
    // The enum is a VALUE import at the file level (it binds as a statement
    // parameter) — never a type-only import.
    expect(releaseRepoSource).toContain(
      'import { SessionStatus } from "@/backend/enum/scheduling/session-status.enum";'
    );
    expect(releaseRepoSource.includes("import type { SessionStatus")).toBe(false);
  });
});

/** The setAvailabilityIntent slice of the repository source (the static pin target). */
function repoSetAvailabilityIntentSource(): string {
  const source = readFileSync(join(import.meta.dir, "../../../repo/teachers/teacher.repository.ts"), "utf8");
  const start = source.indexOf("export async function setAvailabilityIntent(");
  return source.slice(start, source.indexOf("\n  }", start));
}

describe("TeacherRepository.setAvailabilityIntent (the direction-guarded toggle writer)", () => {
  // ─── Tier 1: branch/statement ───────────────────────────────────────

  test("Unavailable direction writes false and leaves a NULL marker NULL (the toggle never mints a marker)", async () => {
    await runInRollback(async tx => {
      const user = await createTestUser(tx, { role: "teacher" });
      // Seeded online WITHOUT a marker: a plain availability toggle on an
      // unlocked row must not fabricate lock bookkeeping.
      await createTeacherRowFixture(tx, user.id, { isOnline: true });

      const row = await TeacherRepository.setAvailabilityIntent(user.id, false, tx);

      expect(row).not.toBeNull();
      if (!row) throw new Error("expected the updated teacher row");
      expect(row.id).toBe(user.id);
      expect(row.isOnline).toBe(false);
      expect(row.wasOnlineBeforeLock).toBeNull();
      // Independent read-back oracle (same tx — read-your-writes).
      const [reread] = await tx.select().from(teacher).where(eq(teacher.id, user.id));
      expect(reread?.isOnline).toBe(false);
      expect(reread?.wasOnlineBeforeLock).toBeNull();
    });
  });

  test("Unavailable direction overwrites a HELD marker to false (deliberate intent re-arms the restore)", async () => {
    await runInRollback(async tx => {
      const user = await createTestUser(tx, { role: "teacher" });
      await createTestTeacherRow(tx, user.id, true);
      await tx.update(teacher).set({ isOnline: true }).where(eq(teacher.id, user.id));
      await TeacherRepository.acquireInSessionLock(user.id, tx); // marker=true, is_online=false

      const row = await TeacherRepository.setAvailabilityIntent(user.id, false, tx);

      expect(row).not.toBeNull();
      // The in-session toggle IS the pre-lock intent now: the held marker
      // is re-stamped to false so the eventual release cannot resurrect
      // availability the teacher explicitly withdrew.
      expect(row?.isOnline).toBe(false);
      expect(row?.wasOnlineBeforeLock).toBe(false);
      const [reread] = await tx.select().from(teacher).where(eq(teacher.id, user.id));
      expect(reread?.isOnline).toBe(false);
      expect(reread?.wasOnlineBeforeLock).toBe(false);
    });
  });

  test("zero-row null in BOTH directions for a missing teacher row (fail-closed, nothing written)", async () => {
    await runInRollback(async tx => {
      const absentId = await absentTeacherId(tx);

      expect(await TeacherRepository.setAvailabilityIntent(absentId, false, tx)).toBeNull();
      expect(await TeacherRepository.setAvailabilityIntent(absentId, true, tx)).toBeNull();

      // Zero writes: no row appeared for the absent id.
      const [absent] = await tx.select().from(teacher).where(eq(teacher.id, absentId));
      expect(absent).toBeUndefined();
    });
  });

  // ─── Tier 2: boundary / honest failure ──────────────────────────────

  test("Available direction succeeds when no started session exists (NULL marker stays NULL)", async () => {
    await runInRollback(async tx => {
      const user = await createTestUser(tx, { role: "teacher" });
      await createTestTeacherRow(tx, user.id, true); // default isOnline=false, no sessions

      const row = await TeacherRepository.setAvailabilityIntent(user.id, true, tx);

      expect(row).not.toBeNull();
      expect(row?.isOnline).toBe(true);
      expect(row?.wasOnlineBeforeLock).toBeNull();
      const [reread] = await tx.select().from(teacher).where(eq(teacher.id, user.id));
      expect(reread?.isOnline).toBe(true);
      expect(reread?.wasOnlineBeforeLock).toBeNull();
    });
  });

  test("Available direction is race-blocked to zero rows while a started session exists — and writes NOTHING", async () => {
    await runInRollback(async tx => {
      const user = await createTestUser(tx, { role: "teacher" });
      // The exact post-acquire persisted state, seeded directly so the
      // updated_at stamp stays pinned to the epoch for the no-op proof.
      await createTeacherRowFixture(tx, user.id, { wasOnlineBeforeLock: true, updatedAt: new Date(0) });
      await createTeacherSession(tx, user.id, SessionStatus.Started);

      const row = await TeacherRepository.setAvailabilityIntent(user.id, true, tx);

      // The race-closed write: a started session exists, so the guard
      // matches ZERO rows — the toggle cannot flip a locked teacher back
      // online.
      expect(row).toBeNull();
      // NO write applied: flag, marker and the pinned stamp are untouched.
      const [reread] = await tx.select().from(teacher).where(eq(teacher.id, user.id));
      expect(reread?.isOnline).toBe(false);
      expect(reread?.wasOnlineBeforeLock).toBe(true);
      expect(reread?.updatedAt.getTime()).toBe(0);
    });
  });

  test("marker CASE applies on the true direction: an allowed Available toggle re-stamps the held marker to true", async () => {
    await runInRollback(async tx => {
      const user = await createTestUser(tx, { role: "teacher" });
      await createTestTeacherRow(tx, user.id, true);
      await tx.update(teacher).set({ isOnline: true }).where(eq(teacher.id, user.id));
      await TeacherRepository.acquireInSessionLock(user.id, tx); // marker=true, is_online=false

      const row = await TeacherRepository.setAvailabilityIntent(user.id, true, tx);

      expect(row).not.toBeNull();
      // The toggle goes through (no started session) and the held marker
      // is re-stamped with the SAME intent — never consumed, never flipped
      // to NULL: the disputed-window intent survives for the release.
      expect(row?.isOnline).toBe(true);
      expect(row?.wasOnlineBeforeLock).toBe(true);
      const [reread] = await tx.select().from(teacher).where(eq(teacher.id, user.id));
      expect(reread?.isOnline).toBe(true);
      expect(reread?.wasOnlineBeforeLock).toBe(true);
    });
  });

  test("marker CASE applies on the false direction: a held false marker stays false under the Unavailable toggle", async () => {
    await runInRollback(async tx => {
      const user = await createTestUser(tx, { role: "teacher" });
      await createTestTeacherRow(tx, user.id, true); // default isOnline=false
      await TeacherRepository.acquireInSessionLock(user.id, tx); // captures the false never-resurrect intent

      const row = await TeacherRepository.setAvailabilityIntent(user.id, false, tx);

      expect(row).not.toBeNull();
      expect(row?.isOnline).toBe(false);
      expect(row?.wasOnlineBeforeLock).toBe(false);
      const [reread] = await tx.select().from(teacher).where(eq(teacher.id, user.id));
      expect(reread?.isOnline).toBe(false);
      expect(reread?.wasOnlineBeforeLock).toBe(false);
    });
  });

  // ─── Tier 3: convergence (toggle storm + toggle-vs-release interleave)

  test("20-way sequential rapid-toggle storm within ONE tx ⇒ deterministic final value, no minted marker", async () => {
    await runInRollback(async tx => {
      const user = await createTestUser(tx, { role: "teacher" });
      await createTestTeacherRow(tx, user.id, true); // default isOnline=false, marker NULL

      // Twenty rapid toggles alternate directions inside ONE transaction —
      // the same discipline as the service-tier toggle storm. The single
      // connection serializes them behind the row lock, so no update is
      // lost: every call observes the prior call's write, and the final
      // persisted value is the LAST toggle's input. The TRUE legs pass the
      // Available-direction guard (no started session exists), and the
      // storm must never mint a marker.
      const lastInput = await toggleStorm(tx, user.id, 20);

      const [reread] = await tx.select().from(teacher).where(eq(teacher.id, user.id));
      expect(reread?.isOnline).toBe(lastInput);
      expect(reread?.wasOnlineBeforeLock).toBeNull();
      // The certification flag is unchanged by the storm.
      expect(reread?.isApproved).toBe(true);
    });
  });

  test("toggle-vs-release interleave, toggle first: the deliberate intent survives the release (converged)", async () => {
    await runInRollback(async tx => {
      const user = await createTestUser(tx, { role: "teacher" });
      await createTestTeacherRow(tx, user.id, true);
      await tx.update(teacher).set({ isOnline: true }).where(eq(teacher.id, user.id));
      await TeacherRepository.acquireInSessionLock(user.id, tx); // marker=true, is_online=false
      const sessionId = await createTeacherSession(tx, user.id, SessionStatus.Started);

      // The terminal exit lands first (the started row is removed), then
      // the two writers race over the HELD marker. The gate pins the
      // TOGGLE-FIRST order: the in-session Available toggle re-stamps the
      // held marker to true (the disputed-window intent) and flips
      // is_online true; the release then restores that SAME deliberate
      // intent and consumes the marker. Nothing blocks the single
      // connection while the gate is open (pure JS wait).
      await tx.delete(session).where(eq(session.id, sessionId));
      const releaseMayLand = createGate();
      const settled = await Promise.allSettled([
        (async () => {
          try {
            const toggled = await TeacherRepository.setAvailabilityIntent(user.id, true, tx);
            return { writer: "toggle" as const, toggled };
          } finally {
            // Open the gate even on rejection so the racing writer can
            // never hang on a failed premise.
            releaseMayLand.open();
          }
        })(),
        (async () => {
          await releaseMayLand.promise;
          const released = await TeacherRepository.releaseInSessionLock(user.id, tx);
          return { writer: "release" as const, released };
        })(),
      ]);

      const results = settled.map(entry => {
        if (entry.status !== "fulfilled") {
          throw new Error("expected both racing writers to resolve without error");
        }
        return entry.value;
      });
      const [toggleFirst, releaseSecond] = results;
      // Toggle-first order (pinned by the gate): the toggle's RETURNING row
      // already carries the re-stamped marker.
      if (!toggleFirst || !releaseSecond || toggleFirst.writer !== "toggle" || releaseSecond.writer !== "release") {
        throw new Error("expected the gate-pinned toggle-then-release order");
      }
      expect(toggleFirst.toggled?.isOnline).toBe(true);
      expect(toggleFirst.toggled?.wasOnlineBeforeLock).toBe(true);
      expect(releaseSecond.released?.outcome).toBe("released");
      expect(releaseSecond.released?.teacher.isOnline).toBe(true);
      // Converged state: the deliberate intent persisted, marker consumed.
      const [reread] = await tx.select().from(teacher).where(eq(teacher.id, user.id));
      expect(reread?.isOnline).toBe(true);
      expect(reread?.wasOnlineBeforeLock).toBeNull();
    });
  });

  test("toggle-vs-release interleave, release first: the restore lands before the toggle re-applies the intent", async () => {
    await runInRollback(async tx => {
      const user = await createTestUser(tx, { role: "teacher" });
      await createTestTeacherRow(tx, user.id, true);
      await tx.update(teacher).set({ isOnline: true }).where(eq(teacher.id, user.id));
      await TeacherRepository.acquireInSessionLock(user.id, tx); // marker=true, is_online=false
      const sessionId = await createTeacherSession(tx, user.id, SessionStatus.Started);

      // The terminal exit lands first, then the two writers race over the
      // row. The gate pins the RELEASE-FIRST order: the release restores
      // the ORIGINAL captured intent and consumes the marker; the Available
      // toggle then re-applies the intent onto the marker-less row — and
      // must NOT re-mint a marker. Both orders of the interleave converge
      // to the same final state.
      await tx.delete(session).where(eq(session.id, sessionId));
      const toggleMayLand = createGate();
      const settled = await Promise.allSettled([
        (async () => {
          try {
            const released = await TeacherRepository.releaseInSessionLock(user.id, tx);
            return { writer: "release" as const, released };
          } finally {
            // Open the gate even on rejection so the racing writer can
            // never hang on a failed premise.
            toggleMayLand.open();
          }
        })(),
        (async () => {
          await toggleMayLand.promise;
          const toggled = await TeacherRepository.setAvailabilityIntent(user.id, true, tx);
          return { writer: "toggle" as const, toggled };
        })(),
      ]);

      const results = settled.map(entry => {
        if (entry.status !== "fulfilled") {
          throw new Error("expected both racing writers to resolve without error");
        }
        return entry.value;
      });
      const [releaseFirst, toggleSecond] = results;
      // Release-first order (pinned by the gate): the restore carries the
      // consumed marker.
      if (!releaseFirst || !toggleSecond || releaseFirst.writer !== "release" || toggleSecond.writer !== "toggle") {
        throw new Error("expected the gate-pinned release-then-toggle order");
      }
      expect(releaseFirst.released?.outcome).toBe("released");
      expect(releaseFirst.released?.teacher.isOnline).toBe(true);
      expect(releaseFirst.released?.teacher.wasOnlineBeforeLock).toBeNull();
      expect(toggleSecond.toggled?.isOnline).toBe(true);
      expect(toggleSecond.toggled?.wasOnlineBeforeLock).toBeNull();
      // Converged state — identical to the toggle-first order.
      const [reread] = await tx.select().from(teacher).where(eq(teacher.id, user.id));
      expect(reread?.isOnline).toBe(true);
      expect(reread?.wasOnlineBeforeLock).toBeNull();
    });
  });

  // ─── Retired-writer migration (the deleted legacy toggle writer's
  // ─── surviving cases, re-expressed against this primitive — ledger D8)

  test("a redundant same-value Available toggle returns the row unchanged (idempotent under retry)", async () => {
    await runInRollback(async tx => {
      const user = await createTestUser(tx, { role: "teacher" });
      await createTestTeacherRow(tx, user.id, true);
      // Drive the row online first so the re-toggle writes the SAME value.
      await tx.update(teacher).set({ isOnline: true }).where(eq(teacher.id, user.id));

      const first = await TeacherRepository.setAvailabilityIntent(user.id, true, tx);
      const again = await TeacherRepository.setAvailabilityIntent(user.id, true, tx);

      expect(again).not.toBeNull();
      expect(again?.id).toBe(user.id);
      expect(again?.isOnline).toBe(first?.isOnline);
      // Independent read-back oracle — the persisted value is stable.
      const [reread] = await tx.select().from(teacher).where(eq(teacher.id, user.id));
      expect(reread?.isOnline).toBe(true);
    });
  });

  test("a row forced is_online = NULL writes cleanly in BOTH directions (null-column coercion, marker stays NULL)", async () => {
    await runInRollback(async tx => {
      const user = await createTestUser(tx, { role: "teacher" });
      await createTestTeacherRow(tx, user.id, true);
      // Force the column to NULL — the schema permits it (no notNull).
      await tx.update(teacher).set({ isOnline: null }).where(eq(teacher.id, user.id));

      const offline = await TeacherRepository.setAvailabilityIntent(user.id, false, tx);
      expect(offline).not.toBeNull();
      expect(offline?.isOnline).toBe(false);
      expect(offline?.wasOnlineBeforeLock).toBeNull();

      // The Available leg passes the direction guard (no started session).
      const online = await TeacherRepository.setAvailabilityIntent(user.id, true, tx);
      expect(online).not.toBeNull();
      expect(online?.isOnline).toBe(true);
      expect(online?.wasOnlineBeforeLock).toBeNull();

      // Independent read-back oracle.
      const [reread] = await tx.select().from(teacher).where(eq(teacher.id, user.id));
      expect(reread?.isOnline).toBe(true);
      expect(reread?.wasOnlineBeforeLock).toBeNull();
    });
  });

  test("certification plays no part: an unapproved teacher row toggles identically in BOTH directions", async () => {
    await runInRollback(async tx => {
      const user = await createTestUser(tx, { role: "teacher" });
      await createTestTeacherRow(tx, user.id, false);

      const offline = await TeacherRepository.setAvailabilityIntent(user.id, false, tx);
      const online = await TeacherRepository.setAvailabilityIntent(user.id, true, tx);

      expect(offline?.isOnline).toBe(false);
      expect(online?.isOnline).toBe(true);
    });
  });

  // Cross-connection chaos requires real PostgreSQL (multi-connection
  // row-level locking); PGlite is single-connection WASM and cannot
  // observe cross-tx lock serialization, so the storm is skipped there.
  const testOnRealPostgres = isPgliteProvider() ? test.skip : test;

  testOnRealPostgres(
    "25-way Promise.allSettled mixed-toggle storm ⇒ deterministic final is_online, marker never minted (no partial writes)",
    async () => {
      const teacherUserId = await createCommittedTeacher(true);

      // Fire 25 parallel mixed toggles (alternating true/false) — each
      // opens its own top-level transaction. The row lock serializes
      // them; the final committed value is the LAST write that acquired
      // the lock. None rejects — the Available legs pass the direction
      // guard (the fixture holds no started session) and the Unavailable
      // legs are ungated by construction.
      const results = await Promise.allSettled(
        Array.from({ length: 25 }, (_, index) =>
          db.transaction(async tx => TeacherRepository.setAvailabilityIntent(teacherUserId, index % 2 === 0, tx))
        )
      );

      const fulfilled = results.filter(r => r.status === "fulfilled");
      const rejected = results.filter(r => r.status === "rejected");
      expect(fulfilled).toHaveLength(25);
      expect(rejected).toHaveLength(0);

      // Deterministic final state — the final committed is_online is a
      // total boolean (no partial write, no corruption); the marker is
      // NEVER minted by a toggle on a marker-less row (order-independent:
      // the CASE preserves NULL in every interleaving); the certification
      // flag is unchanged by the storm.
      const [finalRow] = await db.select().from(teacher).where(eq(teacher.id, teacherUserId));
      expect(finalRow?.isOnline).toBeTypeOf("boolean");
      expect(finalRow?.wasOnlineBeforeLock).toBeNull();
      expect(finalRow?.isApproved).toBe(true);
    }
  );

  // ─── Tier 4: hostile ids ────────────────────────────────────────────

  test("hostile in-domain ids are equality misses — 0, -1, and far-beyond-sequence return null in both directions, writing nothing", async () => {
    await runInRollback(async tx => {
      const absentId = await absentTeacherId(tx);
      const [before] = await tx.select({ count: sql<number>`count(*)::int` }).from(teacher);

      expect(await TeacherRepository.setAvailabilityIntent(0, false, tx)).toBeNull();
      expect(await TeacherRepository.setAvailabilityIntent(-1, false, tx)).toBeNull();
      expect(await TeacherRepository.setAvailabilityIntent(absentId, false, tx)).toBeNull();
      expect(await TeacherRepository.setAvailabilityIntent(0, true, tx)).toBeNull();
      expect(await TeacherRepository.setAvailabilityIntent(-1, true, tx)).toBeNull();
      expect(await TeacherRepository.setAvailabilityIntent(absentId, true, tx)).toBeNull();

      // Zero side effects: the row population is unchanged.
      const [after] = await tx.select({ count: sql<number>`count(*)::int` }).from(teacher);
      expect(after?.count).toBe(before?.count);
    });
  });

  test("ids beyond the integer domain fail LOUD at the driver gate — nothing executes, zero side effects", async () => {
    await runInRollback(async tx => {
      const [before] = await tx.select({ count: sql<number>`count(*)::int` }).from(teacher);

      // NaN cannot parse as an integer: the guarded statement dies at the
      // driver's type gate as the RAW data exception (untranslated,
      // cause-chained) — probed in BOTH directions (the Available direction
      // binds the id into the probe too; the gate still kills both binds
      // before anything executes).
      await tx.execute(sql`savepoint toggle_hostile_nan_probe`);
      const nanError = await expectRepoError(() => TeacherRepository.setAvailabilityIntent(Number.NaN, false, tx));
      await tx.execute(sql`rollback to savepoint toggle_hostile_nan_probe`);
      expect(hasPostgresErrorCode(nanError, "22P02")).toBe(true);

      await tx.execute(sql`savepoint toggle_hostile_nan_available_probe`);
      const nanAvailableError = await expectRepoError(() =>
        TeacherRepository.setAvailabilityIntent(Number.NaN, true, tx)
      );
      await tx.execute(sql`rollback to savepoint toggle_hostile_nan_available_probe`);
      expect(hasPostgresErrorCode(nanAvailableError, "22P02")).toBe(true);

      // 2^53 overflows the id column's int4 domain: the RAW range exception.
      await tx.execute(sql`savepoint toggle_hostile_overflow_probe`);
      const overflowError = await expectRepoError(() => TeacherRepository.setAvailabilityIntent(2 ** 53, true, tx));
      await tx.execute(sql`rollback to savepoint toggle_hostile_overflow_probe`);
      expect(hasPostgresErrorCode(overflowError, "22003")).toBe(true);

      // Zero side effects: no failed statement wrote anything.
      const [after] = await tx.select({ count: sql<number>`count(*)::int` }).from(teacher);
      expect(after?.count).toBe(before?.count);
    });
  });

  // ─── Tier 4: static surface pins ────────────────────────────────────

  const TOGGLE_REPO_FILE = join(import.meta.dir, "../../../repo/teachers/teacher.repository.ts");
  const toggleRepoSource = readFileSync(TOGGLE_REPO_FILE, "utf8");

  test("source: setAvailabilityIntent is a REQUIRED-tx direction-guarded write returning the row or null", () => {
    const source = repoSetAvailabilityIntentSource();
    expect(source).toContain("export async function setAvailabilityIntent(");
    expect(source).toContain("id: number");
    expect(source).toContain("isOnline: boolean");
    expect(source).toContain("tx: DBTransaction");
    // Required tx — the parameter is not optional (calling without one is
    // a compile error, the type-level pin).
    expect(source).not.toContain("tx?:");
    expect(source).toContain(".returning()");
    // The pinned marker CASE: a NULL marker is untouched (never minted), a
    // held marker is re-stamped with the bound intent value (explicitly
    // cast — an all-untyped CASE resolves to text and cannot assign into
    // the boolean column).
    expect(source).toContain(
      `CASE WHEN \${teacher.wasOnlineBeforeLock} IS NULL THEN NULL ELSE \${isOnline}::boolean END`
    );
    expect(source).toContain("updatedAt: sql`now()`");
  });

  test("source: the direction guard rides ONE pinned predicate — the bound direction OR the teacher_id-scoped NOT EXISTS probe", () => {
    const source = repoSetAvailabilityIntentSource();
    expect(source).toContain("eq(teacher.id, id)");
    expect(source).toContain("eq(session.teacherId, id)");
    // The pinned guard predicate: the Unavailable leg short-circuits the
    // probe via the BOUND direction (the statement text never varies and
    // the guard is evaluated atomically with the write); the Available leg
    // fires at write time when a started session exists — zero rows signal
    // the guard fired, and the caller maps the miss to the conflict denial.
    expect(source).toContain(
      `(\${isOnline} = false OR NOT EXISTS (SELECT 1 FROM \${session} WHERE \${eq(session.teacherId, id)} AND \${eq(session.status, SessionStatus.Started)}))`
    );
    // The status predicate rides the enum member, never a string literal.
    expect(source).toContain("eq(session.status, SessionStatus.Started)");
    // Exactly ONE NOT EXISTS probe in the slice — the guard is one
    // predicate bound with the statement, not a per-direction statement
    // fork (the direction is a bound parameter, never a JS branch).
    expect(source.split("NOT EXISTS")).toHaveLength(2);
    expect(source).not.toMatch(/\b(ilike|like)\s*\(/i);
    expect(source.includes(".prepare(")).toBe(false);
    expect(source.includes("--")).toBe(false);
    // The repo trusts the typed boolean: boolean type-guarding of
    // untrusted input stays in the service layer — no runtime coercion
    // exists in this writer.
    expect(source.includes("typeof isOnline")).toBe(false);
    // The enum is a VALUE import at the file level (it binds as a statement
    // parameter) — never a type-only import.
    expect(toggleRepoSource).toContain(
      'import { SessionStatus } from "@/backend/enum/scheduling/session-status.enum";'
    );
    expect(toggleRepoSource.includes("import type { SessionStatus")).toBe(false);
  });
});

/** The 15-minute inactivity threshold the sweep tests derive their cutoffs from. */
const FIFTEEN_MINUTES_MS = 15 * 60_000;

/**
 * Second-precision instant — the resolution the boundary legs stay provable
 * at through a write/read round-trip (sweeper fixtures build every stamp and
 * sweep instant from this so the strict `<` comparison has no sub-second
 * ambiguity).
 */
function secondPrecisionInstant(ms: number): Date {
  return new Date(Math.floor(ms / 1000) * 1000);
}

/** An instant `minutes` before the given one (second-precision preserved). */
function minutesBefore(instant: Date, minutes: number): Date {
  return new Date(instant.getTime() - minutes * 60_000);
}

/**
 * Online-teacher fixture with a controlled activity stamp: `lastActiveAt` is
 * caller-backdated (NULL = never active). Returns the teacher row id (shared
 * PK with the owning user).
 */
async function createOnlineTeacher(tx: DBTransaction, lastActiveAt: Date | null): Promise<number> {
  const user = await createTestUser(tx, { role: "teacher", lastActiveAt });
  await createTeacherRowFixture(tx, user.id, { isOnline: true });
  return user.id;
}

/** Stale-OFFLINE control fixture — the `is_online` victim gate never matches it. */
async function createStaleOfflineTeacher(tx: DBTransaction, lastActiveAt: Date): Promise<number> {
  const user = await createTestUser(tx, { role: "teacher", lastActiveAt });
  await createTeacherRowFixture(tx, user.id);
  return user.id;
}

/** Attaches a session in the given status to the teacher (the in-session exemption fixture). */
async function attachSession(tx: DBTransaction, teacherId: number, status: SessionStatus): Promise<void> {
  const student = await createTestUser(tx);
  await createTestSession(tx, teacherId, student.id, { status });
}

/** Read-back oracle — the persisted availability flag of one teacher row. */
async function isOnlineOf(tx: DBTransaction, teacherId: number): Promise<boolean | null> {
  const [row] = await tx.select({ isOnline: teacher.isOnline }).from(teacher).where(eq(teacher.id, teacherId));
  return row?.isOnline ?? null;
}

/** The sweep slice of the repository source (the static pin target). */
function repoSweepSource(): string {
  const source = readFileSync(join(import.meta.dir, "../../../repo/teachers/teacher.repository.ts"), "utf8");
  const start = source.indexOf("export async function sweepInactiveOnlineOnce(");
  return source.slice(start, source.indexOf("\n  }", start));
}

describe("TeacherRepository.sweepInactiveOnlineOnce (the inactivity auto-offline batch)", () => {
  // Every count-asserting test opens with a DRAIN pass: the sweep's
  // predicate is global (unlike row-scoped writes), so any pre-existing
  // stale-online row — seed residue or a leaked fixture — is transitioned
  // BEFORE the fixtures are created, and the fixture pass below counts only
  // what the test itself created (never assume an empty table). All instants
  // are second-precision so the strict `<` boundary is provable at stored
  // resolution, and fixtures are BACKDATED rows — no fake timers.

  // ─── Tier 1: branch/statement (the guarded predicate legs) ──────────

  test("sweeps a stale online teacher and flips is_online to false", async () => {
    await runInRollback(async tx => {
      const now = secondPrecisionInstant(Date.now());
      const cutoff = new Date(now.getTime() - FIFTEEN_MINUTES_MS);
      await TeacherRepository.sweepInactiveOnlineOnce(now, cutoff, tx);
      const teacherId = await createOnlineTeacher(tx, minutesBefore(now, 30));

      const offlined = await TeacherRepository.sweepInactiveOnlineOnce(now, cutoff, tx);

      expect(offlined).toBe(1);
      expect(await isOnlineOf(tx, teacherId)).toBe(false);
    });
  });

  test("sweeps an online teacher whose activity is NULL (never active counts as expired)", async () => {
    await runInRollback(async tx => {
      const now = secondPrecisionInstant(Date.now());
      const cutoff = new Date(now.getTime() - FIFTEEN_MINUTES_MS);
      await TeacherRepository.sweepInactiveOnlineOnce(now, cutoff, tx);
      const teacherId = await createOnlineTeacher(tx, null);

      const offlined = await TeacherRepository.sweepInactiveOnlineOnce(now, cutoff, tx);

      expect(offlined).toBe(1);
      expect(await isOnlineOf(tx, teacherId)).toBe(false);
    });
  });

  test("skips a fresh-activity online teacher (the staleness probe fails)", async () => {
    await runInRollback(async tx => {
      const now = secondPrecisionInstant(Date.now());
      const cutoff = new Date(now.getTime() - FIFTEEN_MINUTES_MS);
      await TeacherRepository.sweepInactiveOnlineOnce(now, cutoff, tx);
      const teacherId = await createOnlineTeacher(tx, minutesBefore(now, 1));

      const offlined = await TeacherRepository.sweepInactiveOnlineOnce(now, cutoff, tx);

      expect(offlined).toBe(0);
      expect(await isOnlineOf(tx, teacherId)).toBe(true);
    });
  });

  test("skips an already-offline teacher even with stale activity (the victim gate fails)", async () => {
    await runInRollback(async tx => {
      const now = secondPrecisionInstant(Date.now());
      const cutoff = new Date(now.getTime() - FIFTEEN_MINUTES_MS);
      await TeacherRepository.sweepInactiveOnlineOnce(now, cutoff, tx);
      const teacherId = await createStaleOfflineTeacher(tx, minutesBefore(now, 30));

      const offlined = await TeacherRepository.sweepInactiveOnlineOnce(now, cutoff, tx);

      expect(offlined).toBe(0);
      expect(await isOnlineOf(tx, teacherId)).toBe(false);
    });
  });

  test("skips an online stale teacher holding a STARTED session (the lock takes priority)", async () => {
    await runInRollback(async tx => {
      const now = secondPrecisionInstant(Date.now());
      const cutoff = new Date(now.getTime() - FIFTEEN_MINUTES_MS);
      await TeacherRepository.sweepInactiveOnlineOnce(now, cutoff, tx);
      const teacherId = await createOnlineTeacher(tx, minutesBefore(now, 30));
      await attachSession(tx, teacherId, SessionStatus.Started);

      const offlined = await TeacherRepository.sweepInactiveOnlineOnce(now, cutoff, tx);

      expect(offlined).toBe(0);
      expect(await isOnlineOf(tx, teacherId)).toBe(true);
    });
  });

  test("a merely SCHEDULED session does not exempt an otherwise stale online teacher", async () => {
    await runInRollback(async tx => {
      const now = secondPrecisionInstant(Date.now());
      const cutoff = new Date(now.getTime() - FIFTEEN_MINUTES_MS);
      await TeacherRepository.sweepInactiveOnlineOnce(now, cutoff, tx);
      const teacherId = await createOnlineTeacher(tx, minutesBefore(now, 30));
      await attachSession(tx, teacherId, SessionStatus.Scheduled);

      const offlined = await TeacherRepository.sweepInactiveOnlineOnce(now, cutoff, tx);

      expect(offlined).toBe(1);
      expect(await isOnlineOf(tx, teacherId)).toBe(false);
    });
  });

  // ─── Tier 2: the strict `<` boundary ─────────────────────────────────

  test("activity EXACTLY at the cutoff is NOT swept; one second older is (strict <)", async () => {
    await runInRollback(async tx => {
      const now = secondPrecisionInstant(Date.now());
      const cutoff = new Date(now.getTime() - FIFTEEN_MINUTES_MS);
      await TeacherRepository.sweepInactiveOnlineOnce(now, cutoff, tx);
      const atCutoff = await createOnlineTeacher(tx, cutoff);
      const oneSecondOlder = await createOnlineTeacher(tx, new Date(cutoff.getTime() - 1_000));

      const offlined = await TeacherRepository.sweepInactiveOnlineOnce(now, cutoff, tx);

      expect(offlined).toBe(1);
      expect(await isOnlineOf(tx, atCutoff)).toBe(true);
      expect(await isOnlineOf(tx, oneSecondOlder)).toBe(false);
    });
  });

  test("activity 14:59 old is NOT swept (inside the threshold stays online)", async () => {
    await runInRollback(async tx => {
      const now = secondPrecisionInstant(Date.now());
      const cutoff = new Date(now.getTime() - FIFTEEN_MINUTES_MS);
      await TeacherRepository.sweepInactiveOnlineOnce(now, cutoff, tx);
      const teacherId = await createOnlineTeacher(tx, new Date(cutoff.getTime() + 1_000));

      const offlined = await TeacherRepository.sweepInactiveOnlineOnce(now, cutoff, tx);

      expect(offlined).toBe(0);
      expect(await isOnlineOf(tx, teacherId)).toBe(true);
    });
  });

  test("activity 15:01 old IS swept (past the threshold flips offline)", async () => {
    await runInRollback(async tx => {
      const now = secondPrecisionInstant(Date.now());
      const cutoff = new Date(now.getTime() - FIFTEEN_MINUTES_MS);
      await TeacherRepository.sweepInactiveOnlineOnce(now, cutoff, tx);
      const teacherId = await createOnlineTeacher(tx, new Date(cutoff.getTime() - 1_000));

      const offlined = await TeacherRepository.sweepInactiveOnlineOnce(now, cutoff, tx);

      expect(offlined).toBe(1);
      expect(await isOnlineOf(tx, teacherId)).toBe(false);
    });
  });

  test("updated_at is bumped to the caller-captured now on every swept row (one clock read)", async () => {
    await runInRollback(async tx => {
      const now = secondPrecisionInstant(Date.now());
      const cutoff = new Date(now.getTime() - FIFTEEN_MINUTES_MS);
      await TeacherRepository.sweepInactiveOnlineOnce(now, cutoff, tx);
      // The row's stamp is pinned to the epoch so the refresh is unambiguous.
      const user = await createTestUser(tx, { role: "teacher", lastActiveAt: minutesBefore(now, 30) });
      await createTeacherRowFixture(tx, user.id, { isOnline: true, updatedAt: new Date(0) });

      const offlined = await TeacherRepository.sweepInactiveOnlineOnce(now, cutoff, tx);

      expect(offlined).toBe(1);
      const [reread] = await tx.select().from(teacher).where(eq(teacher.id, user.id));
      expect(reread?.isOnline).toBe(false);
      // The write stamps the CALLER's captured instant — not a fresh clock
      // read inside the primitive.
      expect(reread?.updatedAt.getTime()).toBe(now.getTime());
    });
  });

  // ─── Tier 3: replay + honest counts ─────────────────────────────────

  test("a replay immediately after the sweep is a zero-row no-op (the victim gate never re-matches)", async () => {
    await runInRollback(async tx => {
      const now = secondPrecisionInstant(Date.now());
      const cutoff = new Date(now.getTime() - FIFTEEN_MINUTES_MS);
      await TeacherRepository.sweepInactiveOnlineOnce(now, cutoff, tx);
      const teacherId = await createOnlineTeacher(tx, minutesBefore(now, 30));

      const first = await TeacherRepository.sweepInactiveOnlineOnce(now, cutoff, tx);
      const replay = await TeacherRepository.sweepInactiveOnlineOnce(now, cutoff, tx);

      expect(first).toBe(1);
      expect(replay).toBe(0);
      expect(await isOnlineOf(tx, teacherId)).toBe(false);
    });
  });

  test("the returned count is honest across mixed teacher states", async () => {
    await runInRollback(async tx => {
      const now = secondPrecisionInstant(Date.now());
      const cutoff = new Date(now.getTime() - FIFTEEN_MINUTES_MS);
      await TeacherRepository.sweepInactiveOnlineOnce(now, cutoff, tx);

      const staleOnline = await createOnlineTeacher(tx, minutesBefore(now, 30));
      const neverActive = await createOnlineTeacher(tx, null);
      const freshOnline = await createOnlineTeacher(tx, minutesBefore(now, 1));
      const staleOffline = await createStaleOfflineTeacher(tx, minutesBefore(now, 30));
      const inSession = await createOnlineTeacher(tx, minutesBefore(now, 30));
      await attachSession(tx, inSession, SessionStatus.Started);

      const offlined = await TeacherRepository.sweepInactiveOnlineOnce(now, cutoff, tx);

      // Exactly the two stale-or-expired ONLINE teachers not in session.
      expect(offlined).toBe(2);
      expect(await isOnlineOf(tx, staleOnline)).toBe(false);
      expect(await isOnlineOf(tx, neverActive)).toBe(false);
      expect(await isOnlineOf(tx, freshOnline)).toBe(true);
      expect(await isOnlineOf(tx, staleOffline)).toBe(false);
      expect(await isOnlineOf(tx, inSession)).toBe(true);
    });
  });

  // ─── Tier 4: static surface pins ────────────────────────────────────

  test("source: REQUIRED-tx guarded batch write stamping the caller-captured now", () => {
    const source = repoSweepSource();
    expect(source).toContain(
      "export async function sweepInactiveOnlineOnce(now: Date, cutoff: Date, tx: DBTransaction)"
    );
    expect(source).toContain(": Promise<number>");
    expect(source).toContain("isOnline: false");
    expect(source).toContain("updatedAt: now");
    expect(source).toContain(".returning(");
    // One-now discipline: the primitive never reads the clock itself.
    expect(source.includes("new Date(")).toBe(false);
  });

  test("source: victim selection is predicate-only (no row-identity or client parameters)", () => {
    const source = repoSweepSource();
    expect(source).toContain("eq(teacher.isOnline, true)");
    // The staleness probe EXISTS-joins the owning users row; the exemption
    // NOT-EXISTS-probes the session table (both parameterized schema
    // interpolation — bound values and quoted identifiers, never strings).
    expect(/EXISTS \(SELECT 1 FROM \$\{users\}/.test(source)).toBe(true);
    expect(source).toContain("users.lastActiveAt");
    expect(/NOT EXISTS \(SELECT 1 FROM \$\{session\}/.test(source)).toBe(true);
    expect(source).toContain("session.status");
    expect(source.includes("id: number")).toBe(false);
  });

  test("source: the in-session exemption binds the SessionStatus enum member, never a string literal", () => {
    const source = repoSweepSource();
    expect(source).toContain("SessionStatus.Started");
    expect(source.includes("'started'")).toBe(false);
  });

  test("source: no prepared statements, no placeholder batching in the sweep", () => {
    const source = repoSweepSource();
    expect(source.includes(".prepare(")).toBe(false);
    expect(source.includes("sql.placeholder")).toBe(false);
  });

  test("source: lock-then-recheck — candidates pinned FOR UPDATE, then re-checked under a fresh snapshot", () => {
    const source = repoSweepSource();
    // Statement 1 pins the candidates under row locks held to the caller's
    // commit; statement 2 re-runs the SAME predicates scoped to the pinned
    // ids, under the fresh READ COMMITTED snapshot its own start captures —
    // a confirmation stamp that committed while the locks were acquired is
    // then visible and spares the row (the EvalPlanQual staleness hole a
    // single-statement form cannot close). Both probes therefore appear
    // exactly TWICE: once per statement.
    expect(source).toContain('.for("update")');
    expect(source).toContain("inArray(");
    expect(source.match(/EXISTS \(SELECT 1 FROM \$\{users\}/g)?.length).toBe(2);
    expect(source.match(/NOT EXISTS \(SELECT 1 FROM \$\{session\}/g)?.length).toBe(2);
    expect(source.match(/eq\(teacher\.isOnline, true\)/g)?.length).toBe(2);
    // One-now discipline survives the two-statement form: the primitive
    // never reads the clock itself.
    expect(source.includes("new Date(")).toBe(false);
  });
});

describe("INV-A2 — no writer can produce is_online=true while a started session exists", () => {
  /**
   * The shared in-session fixture: a certified teacher captured online
   * (marker=true), locked offline, holding ONE started session — the
   * exact persisted state a live session start leaves behind. The
   * pinned-epoch stamp exposes any writer that fires a statement it
   * must not: the guard-blocked legs write nothing.
   */
  async function createInSessionTeacher(tx: DBTransaction): Promise<number> {
    const user = await createTestUser(tx, { role: "teacher" });
    await createTeacherRowFixture(tx, user.id, { wasOnlineBeforeLock: true, updatedAt: new Date(0) });
    await createTeacherSession(tx, user.id, SessionStatus.Started);
    return user.id;
  }

  test("the toggle writer: the Available direction is guard-blocked to a null no-op — the row stays untouched", async () => {
    await runInRollback(async tx => {
      const teacherId = await createInSessionTeacher(tx);

      const row = await TeacherRepository.setAvailabilityIntent(teacherId, true, tx);

      // The direction guard fired at write time: zero rows matched, so
      // the toggle cannot flip a locked teacher back online.
      expect(row).toBeNull();
      const [reread] = await tx.select().from(teacher).where(eq(teacher.id, teacherId));
      expect(reread?.isOnline).toBe(false);
      expect(reread?.wasOnlineBeforeLock).toBe(true);
      expect(reread?.updatedAt.getTime()).toBe(0);
    });
  });

  test("the release writer: the marker-gated restore is deferred — nothing is restored while the session runs", async () => {
    await runInRollback(async tx => {
      const teacherId = await createInSessionTeacher(tx);

      const result = await TeacherRepository.releaseInSessionLock(teacherId, tx);

      // The last-exit guard refused the restore: the started session
      // still holds the lock, and the row is unchanged.
      expect(result?.outcome).toBe("active_sessions_remain");
      const [reread] = await tx.select().from(teacher).where(eq(teacher.id, teacherId));
      expect(reread?.isOnline).toBe(false);
      expect(reread?.wasOnlineBeforeLock).toBe(true);
      expect(reread?.updatedAt.getTime()).toBe(0);
    });
  });

  test("the capture-and-lock writer: a mid-session re-acquire writes only false and preserves the first-captured marker", async () => {
    await runInRollback(async tx => {
      const teacherId = await createInSessionTeacher(tx);

      const row = await TeacherRepository.acquireInSessionLock(teacherId, tx);

      // The lock primitive's only is_online value is false — even a
      // concurrent session's re-acquire cannot produce true, and the
      // COALESCE capture keeps the FIRST marker (never re-captured from
      // the now-false flag).
      expect(row).not.toBeNull();
      expect(row?.isOnline).toBe(false);
      expect(row?.wasOnlineBeforeLock).toBe(true);
      expect(await isOnlineOf(tx, teacherId)).toBe(false);
    });
  });

  test("the inactivity sweep writer: the offline-only batch demonstrably runs yet leaves the in-session teacher offline", async () => {
    await runInRollback(async tx => {
      const now = secondPrecisionInstant(Date.now());
      const cutoff = minutesBefore(now, 15);
      // Drain pass: the sweep predicate is global, so any pre-existing
      // stale-online row leaves BEFORE the fixtures are created — the
      // counted pass below transitions only what this cell created.
      await TeacherRepository.sweepInactiveOnlineOnce(now, cutoff, tx);
      const teacherId = await createInSessionTeacher(tx);
      const staleOnline = await createOnlineTeacher(tx, minutesBefore(now, 30));

      const offlined = await TeacherRepository.sweepInactiveOnlineOnce(now, cutoff, tx);

      // The pass demonstrably ran and wrote its only possible value
      // (false) on the control — while the in-session teacher stays
      // exactly as the session lock left them.
      expect(offlined).toBe(1);
      expect(await isOnlineOf(tx, staleOnline)).toBe(false);
      expect(await isOnlineOf(tx, teacherId)).toBe(false);
    });
  });
});

describe("TeacherRepository.findForEvaluationGateById", () => {
  // ─── Tier 1: branch/statement ───────────────────────────────────────

  test("returns {id, isApproved, isEvaluator} under lock for an existing evaluator row", async () => {
    await runInRollback(async tx => {
      const user = await createTestUser(tx, { role: "teacher" });
      await createTestTeacherRow(tx, user.id, true);
      await tx.update(teacher).set({ isEvaluator: true }).where(eq(teacher.id, user.id));

      const locked = await TeacherRepository.findForEvaluationGateById(user.id, tx);

      expect(locked).not.toBeNull();
      if (!locked) throw new Error("expected locked teacher row");
      expect(locked.id).toBe(user.id);
      expect(locked.isApproved).toBe(true);
      expect(locked.isEvaluator).toBe(true);
      // The governance-clean account defaults surface verbatim (false).
      expect(locked.isDeleted).toBe(false);
      expect(locked.isBlocked).toBe(false);
      expect(locked.suspended).toBe(false);
      // Minimal projection — exactly the six mandated columns.
      expect(Object.keys(locked).toSorted((a, b) => a.localeCompare(b))).toEqual([
        "id",
        "isApproved",
        "isBlocked",
        "isDeleted",
        "isEvaluator",
        "suspended",
      ]);
    });
  });

  test("returns isEvaluator:false for a certified teacher who is not an evaluator", async () => {
    await runInRollback(async tx => {
      const user = await createTestUser(tx, { role: "teacher" });
      await createTestTeacherRow(tx, user.id, true);

      const locked = await TeacherRepository.findForEvaluationGateById(user.id, tx);

      expect(locked?.id).toBe(user.id);
      expect(locked?.isApproved).toBe(true);
      // The fixture default rides through: a certified non-evaluator is a
      // real row the booking gate must reject on the evaluator leg.
      expect(locked?.isEvaluator).toBe(false);
    });
  });

  test("returns null for a nonexistent teacher id", async () => {
    await runInRollback(async tx => {
      const missingId = await absentTeacherId(tx);

      const locked = await TeacherRepository.findForEvaluationGateById(missingId, tx);

      expect(locked).toBeNull();
    });
  });

  // ─── Tier 2: boundary / honest failure ──────────────────────────────

  test("resolves to null for a teacher-applicant user (applicants row, NO teacher row)", async () => {
    await runInRollback(async tx => {
      const applicantUser = await createTestUser(tx, { role: "teacher" });
      await createTestApplicant(tx, applicantUser.id);

      const locked = await TeacherRepository.findForEvaluationGateById(applicantUser.id, tx);

      // Honest failure: holding an applicants row never mints certification —
      // an applicant's users.id is not an evaluator id either.
      expect(locked).toBeNull();
    });
  });

  test("surfaces DB-level NULL flags verbatim as null (never coerced)", async () => {
    await runInRollback(async tx => {
      const user = await createTestUser(tx, { role: "teacher" });
      await tx.insert(teacher).values({ id: user.id, isApproved: null, isEvaluator: null });

      const locked = await TeacherRepository.findForEvaluationGateById(user.id, tx);

      expect(locked?.id).toBe(user.id);
      expect(locked?.isApproved).toBeNull();
      expect(locked?.isEvaluator).toBeNull();
    });
  });

  test("surfaces a governed account's flags verbatim (deleted, blocked, suspended — still one row)", async () => {
    await runInRollback(async tx => {
      const user = await createTestUser(tx, { role: "teacher" });
      await createTestTeacherRow(tx, user.id, true);
      await tx.update(teacher).set({ isEvaluator: true }).where(eq(teacher.id, user.id));
      await tx.update(users).set({ isDeleted: true, isBlocked: true, suspended: true }).where(eq(users.id, user.id));

      const locked = await TeacherRepository.findForEvaluationGateById(user.id, tx);

      // The governance projection is honest: a certified evaluator whose
      // account is governed still resolves as a row — the caller owns the
      // denial decision.
      expect(locked?.id).toBe(user.id);
      expect(locked?.isApproved).toBe(true);
      expect(locked?.isEvaluator).toBe(true);
      expect(locked?.isDeleted).toBe(true);
      expect(locked?.isBlocked).toBe(true);
      expect(locked?.suspended).toBe(true);
    });
  });

  test("re-locking the same row inside ONE transaction is idempotent (tx-scoped lock)", async () => {
    await runInRollback(async tx => {
      const user = await createTestUser(tx, { role: "teacher" });
      await createTestTeacherRow(tx, user.id, true);
      await tx.update(teacher).set({ isEvaluator: true }).where(eq(teacher.id, user.id));

      const first = await TeacherRepository.findForEvaluationGateById(user.id, tx);
      const second = await TeacherRepository.findForEvaluationGateById(user.id, tx);

      expect(first).toEqual(second);
    });
  });

  // ─── Tier 4: static surface pins ────────────────────────────────────

  const EVALUATION_GATE_REPO_FILE = join(import.meta.dir, "../../../repo/teachers/teacher.repository.ts");
  const evaluationGateRepoSource = readFileSync(EVALUATION_GATE_REPO_FILE, "utf8");

  /** The findForEvaluationGateById slice of the repository source (the static pin target). */
  function repoFindForEvaluationGateSource(): string {
    const start = evaluationGateRepoSource.indexOf("export async function findForEvaluationGateById(");
    return evaluationGateRepoSource.slice(start, evaluationGateRepoSource.indexOf("\n  }\n", start));
  }

  test("source: REQUIRED-tx lock read with a six-column projection under .for('update')", () => {
    expect(repoFindForEvaluationGateSource()).toContain("teacherId: number");
    expect(repoFindForEvaluationGateSource()).toContain("tx: DBTransaction");
    expect(repoFindForEvaluationGateSource()).toContain('.for("update")');
    expect(repoFindForEvaluationGateSource()).toContain("id: teacher.id");
    expect(repoFindForEvaluationGateSource()).toContain("isApproved: teacher.isApproved");
    expect(repoFindForEvaluationGateSource()).toContain("isEvaluator: teacher.isEvaluator");
    expect(repoFindForEvaluationGateSource()).toContain("isDeleted: users.isDeleted");
    expect(repoFindForEvaluationGateSource()).toContain("isBlocked: users.isBlocked");
    expect(repoFindForEvaluationGateSource()).toContain("suspended: users.suspended");
    expect(repoFindForEvaluationGateSource()).toContain("innerJoin(users, eq(users.id, teacher.id))");
  });

  test("source: no template interpolation, no prepared statements in the evaluation lock read", () => {
    expect(repoFindForEvaluationGateSource().includes("${")).toBe(false);
    expect(repoFindForEvaluationGateSource().includes(".prepare(")).toBe(false);
  });
});

/** The updateAverageRating slice of the repository source (the static pin target). */
function repoUpdateAverageRatingSource(): string {
  const source = readFileSync(join(import.meta.dir, "../../../repo/teachers/teacher.repository.ts"), "utf8");
  const start = source.indexOf("export async function updateAverageRating(");
  return source.slice(start, source.indexOf("\n  }", start));
}

describe("TeacherRepository.updateAverageRating (the cached-rating write)", () => {
  // ─── Tier 1: branch/statement ───────────────────────────────────────

  test("stores the exact decimal string, refreshes updatedAt, and returns the updated row", async () => {
    await runInRollback(async tx => {
      const user = await createTestUser(tx, { role: "teacher" });
      // The fixture stamp is pinned to the epoch so the refresh is
      // unambiguous: now() is strictly later.
      await createTeacherRowFixture(tx, user.id, { updatedAt: new Date(0) });

      const row = await TeacherRepository.updateAverageRating(user.id, "4.25", tx);

      expect(row).not.toBeNull();
      if (!row) throw new Error("expected the updated teacher row");
      expect(row.id).toBe(user.id);
      // Drizzle numeric mode: the rating round-trips as the exact string.
      expect(row.averageRating).toBe("4.25");
      expect(row.updatedAt.getTime()).toBeGreaterThan(0);
      // Independent read-back oracle (same tx — read-your-writes).
      const [reread] = await tx.select().from(teacher).where(eq(teacher.id, user.id));
      expect(reread?.averageRating).toBe("4.25");
      expect(reread?.updatedAt.getTime()).toBeGreaterThan(0);
    });
  });

  test("a recompute overwrites the prior value in place (never merged or incremented)", async () => {
    await runInRollback(async tx => {
      const user = await createTestUser(tx, { role: "teacher" });
      await createTeacherRowFixture(tx, user.id, { averageRating: "4.25" });

      const row = await TeacherRepository.updateAverageRating(user.id, "3.00", tx);

      expect(row?.averageRating).toBe("3.00");
    });
  });

  // ─── Tier 2: boundary / honest failure ──────────────────────────────

  test("returns null for an unknown teacher id and writes nothing", async () => {
    await runInRollback(async tx => {
      const absentId = await absentTeacherId(tx);

      const row = await TeacherRepository.updateAverageRating(absentId, "4.25", tx);

      expect(row).toBeNull();
      // Zero writes: no row appeared for the absent id.
      const [absent] = await tx.select().from(teacher).where(eq(teacher.id, absentId));
      expect(absent).toBeUndefined();
    });
  });

  test("the payload touches nothing beyond average_rating and updated_at", async () => {
    await runInRollback(async tx => {
      const user = await createTestUser(tx, { role: "teacher" });
      await createTeacherRowFixture(tx, user.id, { isEvaluator: true, subjects: '["quran"]' });
      const [prior] = await tx.select().from(teacher).where(eq(teacher.id, user.id));

      await TeacherRepository.updateAverageRating(user.id, "2.50", tx);

      const [after] = await tx.select().from(teacher).where(eq(teacher.id, user.id));
      expect(after?.isApproved).toBe(prior?.isApproved);
      expect(after?.isEvaluator).toBe(prior?.isEvaluator);
      expect(after?.isOnline).toBe(prior?.isOnline);
      expect(after?.subjects).toBe(prior?.subjects);
      expect(after?.requestPreference).toBe(prior?.requestPreference);
      expect(after?.createdAt).toEqual(prior?.createdAt);
    });
  });

  // ─── Tier 4: the CHECK violation surfaces untranslated (savepoint probe)

  test("a rating beyond the 0-5 clamp raises the RAW teacher_average_rating_check violation", async () => {
    await runInRollback(async tx => {
      const user = await createTestUser(tx, { role: "teacher" });
      await createTeacherRowFixture(tx, user.id, { averageRating: "4.25" });

      await tx.execute(sql`savepoint teacher_average_rating_check_probe`);
      const checkError = await expectRepoError(() => TeacherRepository.updateAverageRating(user.id, "9.99", tx));
      await tx.execute(sql`rollback to savepoint teacher_average_rating_check_probe`);

      expect(constraintNameOf(checkError)).toBe("teacher_average_rating_check");
      // The repository surfaces the raw driver error untouched — no domain
      // error class, no translated message (the service layer owns both).
      expect(checkError.constructor.name).not.toBe("ConflictError");
      expect(checkError.constructor.name).not.toBe("DomainError");
      // The savepoint bracket kept the transaction queryable and the prior
      // rating intact — the failed statement left no residue.
      const [reread] = await tx.select().from(teacher).where(eq(teacher.id, user.id));
      expect(reread?.averageRating).toBe("4.25");
    });
  });

  // ─── Tier 4: static surface pins ────────────────────────────────────

  test("source: updateAverageRating is a REQUIRED-tx guarded write returning the row or null", () => {
    expect(repoUpdateAverageRatingSource()).toContain("export async function updateAverageRating(");
    expect(repoUpdateAverageRatingSource()).toContain("teacherId: number");
    expect(repoUpdateAverageRatingSource()).toContain("averageRating: string");
    expect(repoUpdateAverageRatingSource()).toContain("tx: DBTransaction");
    expect(repoUpdateAverageRatingSource()).toContain(".returning()");
  });
});

describe("TeacherRepository.decertifyOnce (the paid re-evaluation de-certification)", () => {
  // The de-certification arbiter signals a miss by returning `null` (the
  // guarded UPDATE's zero-row miss signal), so this suite has no throwing
  // paths to probe — `expectRepoError` is reserved for the raw-CHECK probe
  // pattern and there is never a `rejects.toThrow` inside `runInRollback`.

  // ─── Tier 1: branch/statement ───────────────────────────────────────

  test("flips a certified teacher to de-certified and returns the FULL updated row", async () => {
    await runInRollback(async tx => {
      const user = await createTestUser(tx, { role: "teacher" });
      await createTestTeacherRow(tx, user.id, true);

      const row = await TeacherRepository.decertifyOnce(user.id, tx);

      expect(row).not.toBeNull();
      if (!row) throw new Error("expected the updated teacher row");
      expect(row.id).toBe(user.id);
      expect(row.isApproved).toBe(false);
      // Independent persisted-state oracle (same tx — read-your-writes).
      const [persisted] = await tx.select().from(teacher).where(eq(teacher.id, user.id));
      expect(persisted?.isApproved).toBe(false);
    });
  });

  test("returns null for a nonexistent teacher id", async () => {
    await runInRollback(async tx => {
      const missingId = await absentTeacherId(tx);

      const row = await TeacherRepository.decertifyOnce(missingId, tx);

      expect(row).toBeNull();
    });
  });

  // ─── Tier 2: boundary / honest failure ──────────────────────────────

  test("matches ZERO rows for an already-decertified teacher (a rival order won, nothing changes)", async () => {
    await runInRollback(async tx => {
      const user = await createTestUser(tx, { role: "teacher" });
      await createTestTeacherRow(tx, user.id, false);

      const row = await TeacherRepository.decertifyOnce(user.id, tx);

      expect(row).toBeNull();
      const [persisted] = await tx.select().from(teacher).where(eq(teacher.id, user.id));
      expect(persisted?.isApproved).toBe(false);
    });
  });

  test("matches ZERO rows for a DB-level NULL is_approved row (NULL never satisfies the certified guard)", async () => {
    await runInRollback(async tx => {
      const user = await createTestUser(tx, { role: "teacher" });
      await createTestTeacherRow(tx, user.id, null);

      const row = await TeacherRepository.decertifyOnce(user.id, tx);

      expect(row).toBeNull();
      const [persisted] = await tx.select().from(teacher).where(eq(teacher.id, user.id));
      expect(persisted?.isApproved).toBeNull();
    });
  });

  test("the flip withdraws the approval only (isEvaluator and the rating survive untouched)", async () => {
    await runInRollback(async tx => {
      const user = await createTestUser(tx, { role: "teacher" });
      await createTeacherRowFixture(tx, user.id, { isEvaluator: true, averageRating: "4.25" });

      const row = await TeacherRepository.decertifyOnce(user.id, tx);

      expect(row?.isApproved).toBe(false);
      expect(row?.isEvaluator).toBe(true);
      expect(row?.averageRating).toBe("4.25");
    });
  });

  // ─── Tier 3: concurrent de-certification (the arbiter) ──────────────
  // Real-Postgres gated: the guarded UPDATE's row lock is only observable
  // across independent connections (PGlite is single-connection WASM).
  const testOnRealPostgres = isPgliteProvider() ? test.skip : test;

  testOnRealPostgres(
    "two concurrent orders de-certify the same certified teacher: exactly one winner, one zero-row loser",
    async () => {
      const teacherUserId = await createCommittedTeacher(true);

      // Two INDEPENDENT transactions race the same guarded UPDATE. The row
      // lock serializes them: the loser re-evaluates the WHERE predicate on
      // the committed post-flip row, matches zero rows, and resolves null.
      const settled = await Promise.allSettled([
        db.transaction(tx => TeacherRepository.decertifyOnce(teacherUserId, tx)),
        db.transaction(tx => TeacherRepository.decertifyOnce(teacherUserId, tx)),
      ]);

      expect(settled).toHaveLength(2);
      const rows = settled.map(outcome => {
        if (outcome.status !== "fulfilled") {
          throw new Error("expected both racing transactions to resolve without error");
        }
        return outcome.value;
      });
      // Order-independent: exactly one winner, exactly one zero-row loser.
      expect(rows.filter(row => row !== null)).toHaveLength(1);
      expect(rows.filter(row => row === null)).toHaveLength(1);
      const winner = rows.find(row => row !== null);
      expect(winner?.id).toBe(teacherUserId);
      expect(winner?.isApproved).toBe(false);

      // Final committed state is consistent — flipped exactly once.
      const [final] = await db.select().from(teacher).where(eq(teacher.id, teacherUserId));
      expect(final?.isApproved).toBe(false);
    }
  );

  // ─── Tier 4: static surface pins ────────────────────────────────────

  const DECERTIFY_REPO_FILE = join(import.meta.dir, "../../../repo/teachers/teacher.repository.ts");
  const decertifyRepoSource = readFileSync(DECERTIFY_REPO_FILE, "utf8");

  /** The decertifyOnce slice of the repository source (the static pin target). */
  function decertifySource(): string {
    const start = decertifyRepoSource.indexOf("export async function decertifyOnce(");
    return decertifyRepoSource.slice(start, decertifyRepoSource.indexOf("\n  }\n", start));
  }

  test("source: REQUIRED-tx writer riding the ONE guarded is_approved=true→false statement", () => {
    expect(decertifySource()).toContain("export async function decertifyOnce(");
    expect(decertifySource()).toContain("id: number");
    expect(decertifySource()).toContain("tx: DBTransaction");
    // Single-writer discipline: the re-evaluation entry point shares the
    // existing guarded statement instead of minting a second one.
    expect(decertifySource()).toContain("return demoteToUncertified(id, tx);");
    expect(decertifySource().includes("db.update")).toBe(false);
    // Exactly ONE `is_approved = false` write target exists in the repo.
    expect(decertifyRepoSource.match(/isApproved: false/g)).toHaveLength(1);
  });

  test("source: no i18n, no logger, no console, no plan-artifact references", () => {
    expect(decertifySource().includes("getServerTranslations")).toBe(false);
    expect(decertifySource().includes("logger")).toBe(false);
    expect(decertifySource().includes("console.")).toBe(false);
    expect(/REQ-\d|DEV2|DEV3|Phase \d|Task \d|plan\.md|tasks\.md|specs\.md/.test(decertifyRepoSource)).toBe(false);
  });
});

describe("TeacherRepository.listMatchingCandidates", () => {
  // ─── Fixtures ────────────────────────────────────────────────────────

  /** Raw stored token payloads an eligible teacher carries (all match the default patterns). */
  const ELIGIBLE_TOKENS = {
    recitations: '["hafs_an_asim"]',
    subjects: '["hifz","tajweed"]',
    languages: '["english","french"]',
  } as const;

  /** Fixture override shape — users-row overrides plus shared-PK teacher-row overrides. */
  interface MatchingFixtureOverrides {
    user?: Partial<UserSelectType>;
    teacher?: Partial<TeacherSelectType>;
  }

  /**
   * Creates a users row (role=teacher) plus its shared-PK teacher row on an
   * eligible, ungoverned baseline: online + certified + token payloads that
   * match the default patterns. Overrides win per field.
   */
  async function createMatchingTeacher(tx: DBTransaction, overrides: MatchingFixtureOverrides = {}): Promise<number> {
    const user = await createTestUser(tx, { role: "teacher", ...overrides.user });
    await createTeacherRowFixture(tx, user.id, {
      isOnline: true,
      ...ELIGIBLE_TOKENS,
      ...overrides.teacher,
    });
    return user.id;
  }

  /**
   * Membership probe: captures the pre-fixture baseline, creates ONE
   * eligible-baseline fixture with overrides, runs the read, and reports
   * whether the fixture surfaced. Compresses the eligibility matrix to a
   * few lines per case.
   */
  async function probeMembership(
    tx: DBTransaction,
    filters: NormalizedTeacherMatchingFilters,
    overrides: MatchingFixtureOverrides = {}
  ): Promise<{ included: boolean; baseline: number; total: number }> {
    const baseline = await baselineTotal(tx, filters);
    const fixtureId = await createMatchingTeacher(tx, overrides);
    const page = await TeacherRepository.listMatchingCandidates(filters, 100, 0, tx);
    return {
      included: page.rows.some(row => row.id === fixtureId),
      baseline,
      total: page.total,
    };
  }

  // ─── Tier 1: eligibility matrix (branch/statement) ───────────────────

  test("returns an online, certified, ungoverned teacher whose raw payloads match the patterns", async () => {
    await runInRollback(async tx => {
      const probe = await probeMembership(tx, matchingFilters());

      expect(probe.included).toBe(true);
      expect(probe.total).toBe(probe.baseline + 1);
    });
  });

  test("surfaces the raw row shape: exactly the nine projected columns, payloads unparsed", async () => {
    await runInRollback(async tx => {
      const id = await createMatchingTeacher(tx, { teacher: { averageRating: "4.50" } });

      const page = await TeacherRepository.listMatchingCandidates(matchingFilters(), 100, 0, tx);

      const row = page.rows.find(item => item.id === id);
      if (!row) throw new Error("expected the eligible fixture row");
      expect(Object.keys(row).toSorted((a, b) => a.localeCompare(b))).toEqual([
        "averageRating",
        "country",
        "countryCode",
        "fullName",
        "id",
        "isOnline",
        "languages",
        "recitations",
        "subjects",
      ]);
      expect(row.recitations).toBe('["hafs_an_asim"]');
      expect(row.averageRating).toBe("4.50");
      expect(row.isOnline).toBe(true);
    });
  });

  test("excludes an offline teacher (is_online = true is fail-closed: unknown availability is never shown)", async () => {
    await runInRollback(async tx => {
      const probe = await probeMembership(tx, matchingFilters(), { teacher: { isOnline: false } });

      expect(probe.included).toBe(false);
      expect(probe.total).toBe(probe.baseline);
    });
  });

  test("excludes an uncertified teacher (is_approved = false)", async () => {
    await runInRollback(async tx => {
      const probe = await probeMembership(tx, matchingFilters(), { teacher: { isApproved: false } });

      expect(probe.included).toBe(false);
      expect(probe.total).toBe(probe.baseline);
    });
  });

  test("excludes an uncertifiable NULL is_approved row (eq(col, true) never admits unknown)", async () => {
    await runInRollback(async tx => {
      const probe = await probeMembership(tx, matchingFilters(), { teacher: { isApproved: null } });

      expect(probe.included).toBe(false);
      expect(probe.total).toBe(probe.baseline);
    });
  });

  test.each([
    ["is_deleted", { isDeleted: true }],
    ["suspended", { suspended: true }],
    ["is_blocked", { isBlocked: true }],
  ] as const)("excludes a governed account (%s = true) — IS DISTINCT FROM true", async (_flag, userOverrides) => {
    await runInRollback(async tx => {
      const probe = await probeMembership(tx, matchingFilters(), { user: userOverrides });

      expect(probe.included).toBe(false);
      expect(probe.total).toBe(probe.baseline);
    });
  });

  test("keeps legacy rows whose governance flags are DB-level NULL (IS DISTINCT FROM, not eq(col, false))", async () => {
    await runInRollback(async tx => {
      const probe = await probeMembership(tx, matchingFilters(), {
        user: { isDeleted: null, suspended: null, isBlocked: null },
      });

      expect(probe.included).toBe(true);
      expect(probe.total).toBe(probe.baseline + 1);
    });
  });

  // ─── Tier 2: in-session exclusion + the compose rule (boundary) ──────

  test("excludes a teacher that owns a started session (bulk NOT EXISTS over session(teacher_id, status))", async () => {
    await runInRollback(async tx => {
      const baseline = await baselineTotal(tx, matchingFilters());
      const teacherId = await createMatchingTeacher(tx);
      await createTeacherSession(tx, teacherId, SessionStatus.Started);

      const page = await TeacherRepository.listMatchingCandidates(matchingFilters(), 100, 0, tx);

      expect(page.total).toBe(baseline);
      expect(page.rows.some(row => row.id === teacherId)).toBe(false);
    });
  });

  test("excludes a stale-true is_online teacher that owns a started session (compose rule: the flag alone never re-admits)", async () => {
    await runInRollback(async tx => {
      const baseline = await baselineTotal(tx, matchingFilters());
      // The fixture baseline IS is_online = true — the started session is
      // the only disqualifier, proving the two predicates compose.
      const teacherId = await createMatchingTeacher(tx, { teacher: { isOnline: true } });
      await createTeacherSession(tx, teacherId, SessionStatus.Started);

      const page = await TeacherRepository.listMatchingCandidates(matchingFilters(), 100, 0, tx);

      expect(page.total).toBe(baseline);
      expect(page.rows.some(row => row.id === teacherId)).toBe(false);
    });
  });

  test.each([
    ["scheduled", SessionStatus.Scheduled],
    ["completed", SessionStatus.Completed],
  ] as const)(
    "does not exclude a teacher whose only session is %s (only the started state hides)",
    async (_label, status) => {
      await runInRollback(async tx => {
        const baseline = await baselineTotal(tx, matchingFilters());
        const teacherId = await createMatchingTeacher(tx);
        await createTeacherSession(tx, teacherId, status);

        const page = await TeacherRepository.listMatchingCandidates(matchingFilters(), 100, 0, tx);

        expect(page.total).toBe(baseline + 1);
        expect(page.rows.some(row => row.id === teacherId)).toBe(true);
      });
    }
  );

  // ─── Tier 2: token filters (quoted-token anchors) ────────────────────

  test.each([
    ['["warsh"]', false],
    ['["warsh","hafs_an_asim"]', true],
  ] as const)(
    "recitation token filter over payload %s (member match, not whole-string)",
    async (recitations, shouldMatch) => {
      await runInRollback(async tx => {
        const probe = await probeMembership(tx, matchingFilters(), { teacher: { recitations } });

        expect(probe.included).toBe(shouldMatch);
        expect(probe.total).toBe(probe.baseline + (shouldMatch ? 1 : 0));
      });
    }
  );

  test.each([
    ['["hifz"]', true],
    ['["tajweed","hifz"]', true],
    ['["hifz_jadid"]', false],
    ['["tajweed"]', false],
  ] as const)(
    "subject token boundary over payload %s (the quote anchors the exact token)",
    async (subjects, shouldMatch) => {
      await runInRollback(async tx => {
        const probe = await probeMembership(tx, matchingFilters(), { teacher: { subjects } });

        expect(probe.included).toBe(shouldMatch);
        expect(probe.total).toBe(probe.baseline + (shouldMatch ? 1 : 0));
      });
    }
  );

  test("applies no language predicate when languagePattern is null (empty languages stay eligible)", async () => {
    await runInRollback(async tx => {
      const probe = await probeMembership(tx, matchingFilters(), { teacher: { languages: null } });

      expect(probe.included).toBe(true);
      expect(probe.total).toBe(probe.baseline + 1);
    });
  });

  test.each([
    ['["english"]', true],
    ['["french"]', false],
    [null, false],
  ] as const)(
    "language hard filter over payload %s is fail-closed (unconfirmed fluency never matches)",
    async (languages, shouldMatch) => {
      await runInRollback(async tx => {
        const probe = await probeMembership(tx, matchingFilters({ languagePattern: '%"english"%' }), {
          teacher: { languages },
        });

        expect(probe.included).toBe(shouldMatch);
        expect(probe.total).toBe(probe.baseline + (shouldMatch ? 1 : 0));
      });
    }
  );

  // ─── Tier 4: binding discipline (the repo never builds patterns) ─────

  test("binds the finished pattern verbatim — a raw _ wildcard still matches (escaping is upstream)", async () => {
    await runInRollback(async tx => {
      // The UNESCAPED single-char wildcard matches the stored "hifz" token;
      // a repo that re-escaped or re-wrapped would receive the pattern in
      // its escaped form and match nothing.
      const probe = await probeMembership(tx, matchingFilters({ subjectPattern: '%"h_fz"%' }));

      expect(probe.included).toBe(true);
      expect(probe.total).toBe(probe.baseline + 1);
    });
  });

  test("matches a corrupt unclosed JSON payload on its raw tokens (eligibility precedes parsing)", async () => {
    await runInRollback(async tx => {
      const probe = await probeMembership(tx, matchingFilters(), {
        teacher: { recitations: '["hafs_an_asim","hifz"' },
      });

      expect(probe.included).toBe(true);
      expect(probe.total).toBe(probe.baseline + 1);
    });
  });

  // ─── Tier 1: country tiering (soft, never an exclusion) ──────────────

  test("tiers the same-country teacher ahead of a better-rated foreign teacher (code arm)", async () => {
    await runInRollback(async tx => {
      const filters = matchingFilters({ studentCountryCode: "EG" });
      const baseline = await baselineTotal(tx, filters);
      const localId = await createMatchingTeacher(tx, {
        user: { country: "Egypt", countryCode: "EG" },
        teacher: { averageRating: "3.00" },
      });
      const foreignId = await createMatchingTeacher(tx, {
        user: { country: "Canada", countryCode: "CA" },
        teacher: { averageRating: "5.00" },
      });

      const page = await TeacherRepository.listMatchingCandidates(filters, 100, 0, tx);

      expect(page.total).toBe(baseline + 2);
      const mine = page.rows.filter(row => row.id === localId || row.id === foreignId);
      expect(mine.map(row => row.id)).toEqual([localId, foreignId]);
    });
  });

  test("falls back to the legacy free-text country, case-insensitively (text arm)", async () => {
    await runInRollback(async tx => {
      const filters = matchingFilters({ studentCountryCode: null, studentCountryText: "egypt" });
      const baseline = await baselineTotal(tx, filters);
      const localId = await createMatchingTeacher(tx, {
        user: { country: "Egypt", countryCode: null },
        teacher: { averageRating: "3.00" },
      });
      const foreignId = await createMatchingTeacher(tx, {
        user: { country: "Canada", countryCode: null },
        teacher: { averageRating: "5.00" },
      });

      const page = await TeacherRepository.listMatchingCandidates(filters, 100, 0, tx);

      expect(page.total).toBe(baseline + 2);
      const mine = page.rows.filter(row => row.id === localId || row.id === foreignId);
      expect(mine.map(row => row.id)).toEqual([localId, foreignId]);
    });
  });

  test("collapses every candidate into one tier when the caller has neither code nor text (rating order only)", async () => {
    await runInRollback(async tx => {
      const filters = matchingFilters();
      const baseline = await baselineTotal(tx, filters);
      const lowerRatedId = await createMatchingTeacher(tx, { teacher: { averageRating: "3.00" } });
      const higherRatedId = await createMatchingTeacher(tx, { teacher: { averageRating: "5.00" } });

      const page = await TeacherRepository.listMatchingCandidates(filters, 100, 0, tx);

      expect(page.total).toBe(baseline + 2);
      const mine = page.rows.filter(row => row.id === lowerRatedId || row.id === higherRatedId);
      expect(mine.map(row => row.id)).toEqual([higherRatedId, lowerRatedId]);
    });
  });

  test("never excludes by country: a country-less teacher still surfaces in the fallback tier", async () => {
    await runInRollback(async tx => {
      const filters = matchingFilters({ studentCountryCode: "EG" });
      const baseline = await baselineTotal(tx, filters);
      const countryLessId = await createMatchingTeacher(tx, {
        user: { country: null, countryCode: null },
        teacher: { averageRating: "5.00" },
      });
      const localId = await createMatchingTeacher(tx, {
        user: { country: "Egypt", countryCode: "EG" },
        teacher: { averageRating: "1.00" },
      });

      const page = await TeacherRepository.listMatchingCandidates(filters, 100, 0, tx);

      expect(page.total).toBe(baseline + 2);
      const mine = page.rows.filter(row => row.id === localId || row.id === countryLessId);
      expect(mine.map(row => row.id)).toEqual([localId, countryLessId]);
    });
  });

  // ─── Tier 2: rating order, NULLS LAST, tiebreak, pagination ──────────

  test("sorts rating DESC within a tier and reads the exact decimal string", async () => {
    await runInRollback(async tx => {
      const filters = matchingFilters();
      const baseline = await baselineTotal(tx, filters);
      const unratedId = await createMatchingTeacher(tx, { teacher: { averageRating: null } });
      const midId = await createMatchingTeacher(tx, { teacher: { averageRating: "3.25" } });
      const topId = await createMatchingTeacher(tx, { teacher: { averageRating: "4.50" } });

      const page = await TeacherRepository.listMatchingCandidates(filters, 100, 0, tx);

      expect(page.total).toBe(baseline + 3);
      const mine = page.rows.filter(row => [unratedId, midId, topId].includes(row.id));
      expect(mine.map(row => row.id)).toEqual([topId, midId, unratedId]);
      const top = page.rows.find(row => row.id === topId);
      expect(top?.averageRating).toBe("4.50");
    });
  });

  test("sorts unrated teachers AFTER every rated one (NULLS LAST: honest null, not zero)", async () => {
    await runInRollback(async tx => {
      const filters = matchingFilters();
      const baseline = await baselineTotal(tx, filters);
      const unratedId = await createMatchingTeacher(tx, { teacher: { averageRating: null } });
      const floorRatedId = await createMatchingTeacher(tx, { teacher: { averageRating: "0.00" } });

      const page = await TeacherRepository.listMatchingCandidates(filters, 100, 0, tx);

      expect(page.total).toBe(baseline + 2);
      const mine = page.rows.filter(row => row.id === unratedId || row.id === floorRatedId);
      expect(mine.map(row => row.id)).toEqual([floorRatedId, unratedId]);
    });
  });

  test("tiebreaks equal ratings by id DESC (deterministic pagination)", async () => {
    await runInRollback(async tx => {
      const filters = matchingFilters();
      const baseline = await baselineTotal(tx, filters);
      const earlierId = await createMatchingTeacher(tx, { teacher: { averageRating: "4.00" } });
      const laterId = await createMatchingTeacher(tx, { teacher: { averageRating: "4.00" } });
      expect(laterId).toBeGreaterThan(earlierId);

      const page = await TeacherRepository.listMatchingCandidates(filters, 100, 0, tx);

      expect(page.total).toBe(baseline + 2);
      const mine = page.rows.filter(row => row.id === earlierId || row.id === laterId);
      expect(mine.map(row => row.id)).toEqual([laterId, earlierId]);
    });
  });

  test("windows the page and keeps the total honest (mid-page and beyond-last)", async () => {
    await runInRollback(async tx => {
      const filters = matchingFilters();
      const baseline = await baselineTotal(tx, filters);
      const createdIds = await Promise.all([0, 1, 2].map(() => createMatchingTeacher(tx)));

      const pageOne = await TeacherRepository.listMatchingCandidates(filters, 2, 0, tx);
      expect(pageOne.total).toBe(baseline + 3);
      expect(pageOne.rows.filter(row => createdIds.includes(row.id))).toHaveLength(2);

      const pageTwo = await TeacherRepository.listMatchingCandidates(filters, 2, 2, tx);
      expect(pageTwo.total).toBe(baseline + 3);
      expect(pageTwo.rows.filter(row => createdIds.includes(row.id))).toHaveLength(1);

      const beyond = await TeacherRepository.listMatchingCandidates(filters, 2, 10, tx);
      expect(beyond.rows).toEqual([]);
      expect(beyond.total).toBe(baseline + 3);
    });
  });

  test("returns an empty page with an honest total when nothing satisfies the filters", async () => {
    await runInRollback(async tx => {
      const filters = matchingFilters({ recitationPattern: '%"no_such_token_here"%' });
      const baseline = await baselineTotal(tx, filters);
      await createMatchingTeacher(tx);

      const page = await TeacherRepository.listMatchingCandidates(filters, 100, 0, tx);

      expect(page.rows).toEqual([]);
      expect(page.total).toBe(baseline);
    });
  });

  // ─── Tier 2: bounds are the caller's contract (error path) ───────────

  test("surfaces the driver error for a negative offset (no silent clamping in the repo)", async () => {
    await runInRollback(async tx => {
      await createMatchingTeacher(tx);

      const error = await expectRepoError(() =>
        TeacherRepository.listMatchingCandidates(matchingFilters(), 10, -1, tx)
      );

      // Drizzle wraps the failed statement ("Failed query: …"); the driver's
      // own reason rides the cause chain — the bounds are the caller's
      // contract and the repo does not clamp them silently.
      expect(error.message).toContain("Failed query");
      const cause = error.cause instanceof Error ? error.cause : error;
      expect(cause.message).toContain("must not be negative");
    });
  });

  // ─── Tier 4: static surface pins ─────────────────────────────────────

  const MATCHING_REPO_FILE = join(import.meta.dir, "../../../repo/teachers/teacher.repository.matching.helpers.ts");
  const matchingRepoSource = readFileSync(MATCHING_REPO_FILE, "utf8");
  // The matching WHERE-chain builders live in the sibling helpers module
  // (`teacher.repository.helpers.ts`, extracted under the oxlint max-lines
  // budget) — the builder pins below read THAT file's source.
  const MATCHING_HELPERS_FILE = join(import.meta.dir, "../../../repo/teachers/teacher.repository.matching.helpers.ts");
  const matchingHelpersSource = readFileSync(MATCHING_HELPERS_FILE, "utf8");

  /** Reads the source slice that starts at `anchor` and ends at its two-space closing brace. */
  function sourceSlice(anchor: string, endAnchor?: string): string {
    const start = matchingRepoSource.indexOf(anchor);
    const end = endAnchor ?? "\n  }\n";
    return matchingRepoSource.slice(start, matchingRepoSource.indexOf(end, start));
  }

  test("source: patterns are bound, never re-escaped or re-wrapped (one escape point at the service)", () => {
    const chain = matchingHelpersSource.slice(
      matchingHelpersSource.indexOf("function buildTeacherMatchingFilterChain("),
      matchingHelpersSource.indexOf("function buildTeacherMatchingCountryTier(")
    );
    expect(chain).toContain("ilike(teacher.recitations, filters.recitationPattern)");
    expect(chain).toContain("ilike(teacher.subjects, filters.subjectPattern)");
    expect(chain).toContain("ilike(teacher.languages, filters.languagePattern)");
    // No layer of the repo re-escapes or re-wraps: neither the namespace file
    // nor the helpers module may own an escape point.
    expect(matchingRepoSource.includes("escape-like-wildcards")).toBe(false);
    expect(matchingRepoSource.includes('"%')).toBe(false);
    expect(matchingHelpersSource.includes("escape-like-wildcards")).toBe(false);
    expect(matchingHelpersSource.includes('"%')).toBe(false);
  });

  test("source: the eligibility chain is online+approved, IS DISTINCT FROM governance, started-session NOT EXISTS", () => {
    const chain = matchingHelpersSource.slice(
      matchingHelpersSource.indexOf("function buildTeacherMatchingFilterChain("),
      matchingHelpersSource.indexOf("function buildTeacherMatchingCountryTier(")
    );
    expect(chain).toContain("eq(teacher.isOnline, true)");
    expect(chain).toContain("eq(teacher.isApproved, true)");
    expect(chain).toContain(`\${users.isDeleted} is distinct from true`);
    expect(chain).toContain(`\${users.suspended} is distinct from true`);
    expect(chain).toContain(`\${users.isBlocked} is distinct from true`);
    expect(chain).toContain(`not exists (select 1 from \${session}`);
    expect(chain).toContain(`\${SessionStatus.Started}`);
  });

  test("source: the country tier is a soft case-expression arm per caller shape (code, text, constant)", () => {
    const tier = sourceSlice("function buildTeacherMatchingCountryTier(", "const POST_TIER_SORT_KEY_BY_SORT");
    expect(tier).toContain(`case when \${users.countryCode} = \${filters.studentCountryCode} then 0 else 1 end`);
    expect(tier).toContain(
      `case when lower(\${users.country}) = lower(\${filters.studentCountryText}) then 0 else 1 end`
    );
    expect(tier).toContain("1 = 1");
  });

  test("source: SessionStatus is a VALUE import (runtime predicate), never type-only", () => {
    expect(
      matchingRepoSource.includes('import { SessionStatus } from "@/backend/enum/scheduling/session-status.enum"')
    ).toBe(true);
    expect(matchingRepoSource.includes("import type { SessionStatus")).toBe(false);
  });

  test("source: the projection is exactly the nine raw columns; ordering delegates to the tier-first helper", () => {
    const method = sourceSlice("export async function listMatchingCandidates(");
    for (const column of [
      "id: teacher.id",
      "fullName: users.fullName",
      "country: users.country",
      "countryCode: users.countryCode",
      "subjects: teacher.subjects",
      "recitations: teacher.recitations",
      "languages: teacher.languages",
      "averageRating: teacher.averageRating",
      "isOnline: teacher.isOnline",
    ]) {
      expect(method).toContain(column);
    }
    // The ORDER BY is the shared helper — the tier expression first, then
    // the caller-selected post-tier key, then the deterministic tiebreak.
    expect(method).toContain("buildTeacherMatchingOrderBy(filters, countryTier)");
    expect(method).toContain(".orderBy(...orderBy)");
    const orderHelper = sourceSlice(
      "function buildTeacherMatchingOrderBy(",
      "export async function listMatchingCandidates("
    );
    expect(orderHelper).toContain(`sql\`\${countryTier} asc\``);
    expect(orderHelper).toContain("desc(teacher.id)");
    const sortKeys = sourceSlice("const POST_TIER_SORT_KEY_BY_SORT", "function buildTeacherMatchingOrderBy");
    expect(sortKeys).toContain("desc nulls last");
    expect(sortKeys).toContain("users.fullName} asc");
    expect(sortKeys).toContain("[TeacherMatchingSort.Newest]: () => desc(teacher.id)");
  });

  test("source: no prepared statements, no i18n, no logger, no console, no plan-artifact references", () => {
    expect(matchingRepoSource.includes(".prepare(")).toBe(false);
    expect(matchingRepoSource.includes("sql.placeholder")).toBe(false);
    expect(matchingRepoSource.includes("getServerTranslations")).toBe(false);
    expect(matchingRepoSource.includes("logger")).toBe(false);
    expect(matchingRepoSource.includes("console.")).toBe(false);
    expect(/REQ-\d|DEV2|DEV3|Phase \d|Task \d|plan\.md|tasks\.md|specs\.md/.test(matchingRepoSource)).toBe(false);
  });
});

/**
 * The EXTENDED browse filters — the name-search pattern, the minimum-rating
 * floor, the nullable recitation/subject token patterns (null drops the
 * `ilike` predicate from the WHERE chain — the browse-all arm), and the
 * post-tier ordering choice. Self-contained fixtures in a
 * DEDICATED country tier (callers key `studentCountryCode` on "ZA", the
 * fixtures carry the same code): every ordering assertion therefore lives
 * in a tier of its own and cannot collide with the unrated window fixtures
 * of the legacy ordering suite above — no rated teacher created here can
 * ever re-sort another suite's window. All fixtures ride `runInRollback`
 * (nothing survives the transaction), preserving the live-table
 * window-safety contract the file's header records.
 */
describe("TeacherRepository.listMatchingCandidates — extended browse filters", () => {
  /** Raw stored token payloads an eligible teacher carries (match the default patterns). */
  const ELIGIBLE_TOKENS = {
    recitations: '["hafs_an_asim"]',
    subjects: '["hifz"]',
    languages: '["english"]',
  } as const;

  /**
   * The dedicated tier: caller + fixtures share the "ZA" country code, so
   * every created teacher lands in tier 0 while live/legacy rows stay in
   * tier 1 — the assertions read only the tier-0 slice of the page.
   */
  const TIERED_FILTERS = {
    studentCountryCode: "ZA",
    studentCountryText: null,
  } as const;

  /**
   * Creates one online, certified, ZA-tiered teacher with overridable
   * name/rating/token payloads. Omitted fields keep the eligible defaults
   * (the payloads matching the default filter patterns), so a fixture can
   * diverge on exactly ONE axis for null-drop vs concrete-pattern probes.
   */
  async function createZATeacher(
    tx: DBTransaction,
    profile: {
      readonly fullName?: string;
      readonly averageRating?: string | null;
      readonly recitations?: string;
      readonly subjects?: string;
    } = {}
  ): Promise<number> {
    const user = await createTestUser(tx, {
      role: "teacher",
      country: "South Africa",
      countryCode: "ZA",
      ...(profile.fullName === undefined ? {} : { fullName: profile.fullName }),
    });
    await createTeacherRowFixture(tx, user.id, {
      isOnline: true,
      ...ELIGIBLE_TOKENS,
      ...(profile.averageRating === undefined ? {} : { averageRating: profile.averageRating }),
      ...(profile.recitations === undefined ? {} : { recitations: profile.recitations }),
      ...(profile.subjects === undefined ? {} : { subjects: profile.subjects }),
    });
    return user.id;
  }

  // ─── Minimum rating: the honest SQL >= (NULL never qualifies) ────────

  test("minRating excludes the unrated and the below-threshold, includes at/above", async () => {
    await runInRollback(async tx => {
      const filters = matchingFilters({ ...TIERED_FILTERS, minRating: 3 });
      const baseline = await baselineTotal(tx, filters);
      const lowId = await createZATeacher(tx, { averageRating: "2.50" });
      const atId = await createZATeacher(tx, { averageRating: "3.00" });
      const aboveId = await createZATeacher(tx, { averageRating: "4.75" });
      const unratedId = await createZATeacher(tx, { averageRating: null });

      const page = await TeacherRepository.listMatchingCandidates(filters, 100, 0, tx);

      // The floor is inclusive at the bound (`>=`): the 3.00 fixture stays.
      const mine = orderedFixtureIds(page.rows, [lowId, atId, aboveId, unratedId]);
      expect(mine).toEqual([aboveId, atId]);
      expect(page.total).toBe(baseline + 2);
    });
  });

  test("minRating null drops the predicate (unrated teachers stay eligible)", async () => {
    await runInRollback(async tx => {
      const filters = matchingFilters(TIERED_FILTERS);
      const baseline = await baselineTotal(tx, filters);
      const unratedId = await createZATeacher(tx, { averageRating: null });

      const page = await TeacherRepository.listMatchingCandidates(filters, 100, 0, tx);

      expect(page.rows.some(row => row.id === unratedId)).toBe(true);
      expect(page.total).toBe(baseline + 1);
    });
  });

  // ─── Optional token patterns: null drops the predicate (browse-all) ──

  test("recitationPattern null drops the predicate — a concrete pattern narrows to the matching reading", async () => {
    await runInRollback(async tx => {
      const nullFilters = matchingFilters({ ...TIERED_FILTERS, recitationPattern: null });
      // The concrete arm rides the default quoted-token pattern
      // (`%"hafs_an_asim"%`) — the service-normalized shape the repo binds.
      const concreteFilters = matchingFilters(TIERED_FILTERS);
      const nullBaseline = await baselineTotal(tx, nullFilters);
      const concreteBaseline = await baselineTotal(tx, concreteFilters);
      const hafsId = await createZATeacher(tx); // the default '["hafs_an_asim"]' payload
      const warshId = await createZATeacher(tx, { recitations: '["warsh"]' });

      // Null arm: the recitation ilike predicate drops out of the WHERE
      // chain, so teachers certified for DIFFERENT readings both stay
      // eligible (same null-drop shape as languagePattern/minRating).
      const nullPage = await TeacherRepository.listMatchingCandidates(nullFilters, 100, 0, tx);
      expect(nullPage.rows.some(row => row.id === hafsId)).toBe(true);
      expect(nullPage.rows.some(row => row.id === warshId)).toBe(true);
      expect(nullPage.total).toBe(nullBaseline + 2);

      // Concrete arm: the quoted-token pattern binds verbatim and narrows
      // to the matching reading only.
      const concretePage = await TeacherRepository.listMatchingCandidates(concreteFilters, 100, 0, tx);
      expect(concretePage.rows.some(row => row.id === hafsId)).toBe(true);
      expect(concretePage.rows.some(row => row.id === warshId)).toBe(false);
      expect(concretePage.total).toBe(concreteBaseline + 1);
    });
  });

  test("subjectPattern null drops the predicate — a concrete pattern narrows to the matching subject", async () => {
    await runInRollback(async tx => {
      const nullFilters = matchingFilters({ ...TIERED_FILTERS, subjectPattern: null });
      // The concrete arm rides the default quoted-token pattern
      // (`%"hifz"%`) — the service-normalized shape the repo binds.
      const concreteFilters = matchingFilters(TIERED_FILTERS);
      const nullBaseline = await baselineTotal(tx, nullFilters);
      const concreteBaseline = await baselineTotal(tx, concreteFilters);
      const hifzId = await createZATeacher(tx); // the default '["hifz"]' payload
      const tajweedId = await createZATeacher(tx, { subjects: '["tajweed"]' });

      // Null arm: the subject ilike predicate drops out of the WHERE chain,
      // so teachers teaching DIFFERENT subjects both stay eligible.
      const nullPage = await TeacherRepository.listMatchingCandidates(nullFilters, 100, 0, tx);
      expect(nullPage.rows.some(row => row.id === hifzId)).toBe(true);
      expect(nullPage.rows.some(row => row.id === tajweedId)).toBe(true);
      expect(nullPage.total).toBe(nullBaseline + 2);

      // Concrete arm: the quoted-token pattern narrows to the matching
      // subject only.
      const concretePage = await TeacherRepository.listMatchingCandidates(concreteFilters, 100, 0, tx);
      expect(concretePage.rows.some(row => row.id === hifzId)).toBe(true);
      expect(concretePage.rows.some(row => row.id === tajweedId)).toBe(false);
      expect(concretePage.total).toBe(concreteBaseline + 1);
    });
  });

  test("both token patterns null matches the no-filter eligibility baseline (online, approved, ungoverned, session-free)", async () => {
    await runInRollback(async tx => {
      const filters = matchingFilters({ ...TIERED_FILTERS, recitationPattern: null, subjectPattern: null });
      const baseline = await baselineTotal(tx, filters);
      // The fixture matches NEITHER default token pattern — only a chain
      // with both predicates dropped can admit it, and it still satisfies
      // every remaining eligibility leg (online, certified, ungoverned, no
      // started session) by construction.
      const alienId = await createZATeacher(tx, { recitations: '["warsh"]', subjects: '["tajweed"]' });

      const page = await TeacherRepository.listMatchingCandidates(filters, 100, 0, tx);

      expect(page.rows.some(row => row.id === alienId)).toBe(true);
      expect(page.total).toBe(baseline + 1);
    });
  });

  // ─── Name search: case-insensitive substring, literal wildcards ──────

  test("namePattern matches the display name case-insensitively", async () => {
    await runInRollback(async tx => {
      const filters = matchingFilters({
        ...TIERED_FILTERS,
        namePattern: `%${"sheikh za".toUpperCase()}%`,
      });
      const baseline = await baselineTotal(tx, filters);
      const matchId = await createZATeacher(tx, { fullName: "Sheikh Zayed" });
      const missId = await createZATeacher(tx, { fullName: "Uthman" });

      const page = await TeacherRepository.listMatchingCandidates(filters, 100, 0, tx);

      expect(page.rows.some(row => row.id === matchId)).toBe(true);
      expect(page.rows.some(row => row.id === missId)).toBe(false);
      expect(page.total).toBe(baseline + 1);
    });
  });

  test("namePattern treats % and _ as LITERAL characters (the service escapes; the repo binds)", async () => {
    await runInRollback(async tx => {
      // The escaped `%`/`_` patterns are received finished — a repo that
      // re-wrapped or unescaped them would widen the match to every row.
      const literalUnderscoreId = await createZATeacher(tx, { fullName: "A_B Teacher" });
      const decoyId = await createZATeacher(tx, { fullName: "AXB Teacher" });
      const filters = matchingFilters({ ...TIERED_FILTERS, namePattern: "%A\\_B%" });

      const page = await TeacherRepository.listMatchingCandidates(filters, 100, 0, tx);

      // `A\_B` (escaped underscore) matches only the literal "A_B" row —
      // an unescaped `_` would match the "AXB" decoy too.
      expect(page.rows.some(row => row.id === literalUnderscoreId)).toBe(true);
      expect(page.rows.some(row => row.id === decoyId)).toBe(false);
    });
  });

  // ─── Ordering choice: tier ALWAYS first, sort key second, id tiebreak ─

  test("sort NAME_ASC orders alphabetically within the tier (rating is ignored as a key)", async () => {
    await runInRollback(async tx => {
      const filters = matchingFilters({ ...TIERED_FILTERS, sort: TeacherMatchingSort.NameAsc });
      const zakiId = await createZATeacher(tx, { fullName: "Zaki", averageRating: "5.00" });
      const amirId = await createZATeacher(tx, { fullName: "Amir", averageRating: "1.00" });
      const basmId = await createZATeacher(tx, { fullName: "Basim", averageRating: "3.00" });

      const page = await TeacherRepository.listMatchingCandidates(filters, 100, 0, tx);

      // Alphabetical despite the ratings: NAME_ASC is the post-tier key.
      expect(orderedFixtureIds(page.rows, [zakiId, amirId, basmId])).toEqual([amirId, basmId, zakiId]);
    });
  });

  test("sort NEWEST orders id DESC within the tier (name and rating are ignored as keys)", async () => {
    await runInRollback(async tx => {
      const filters = matchingFilters({ ...TIERED_FILTERS, sort: TeacherMatchingSort.Newest });
      const earlyId = await createZATeacher(tx, { fullName: "Early", averageRating: "5.00" });
      const laterId = await createZATeacher(tx, { fullName: "Aardvark", averageRating: "1.00" });
      expect(laterId).toBeGreaterThan(earlyId);

      const page = await TeacherRepository.listMatchingCandidates(filters, 100, 0, tx);

      expect(orderedFixtureIds(page.rows, [earlyId, laterId])).toEqual([laterId, earlyId]);
    });
  });

  test("the default RATING_DESC keeps the legacy order byte-identical (rating desc nulls last, id tiebreak)", async () => {
    await runInRollback(async tx => {
      const explicit = matchingFilters({ ...TIERED_FILTERS, sort: TeacherMatchingSort.RatingDesc });
      const implicit = matchingFilters({ ...TIERED_FILTERS });
      expect(implicit.sort).toBe(TeacherMatchingSort.RatingDesc);

      const unratedId = await createZATeacher(tx, { fullName: "Unrated", averageRating: null });
      const midId = await createZATeacher(tx, { fullName: "Mid", averageRating: "3.25" });
      const topId = await createZATeacher(tx, { fullName: "Top", averageRating: "4.50" });
      const equalA = await createZATeacher(tx, { fullName: "Equal A", averageRating: "3.25" });
      const equalB = await createZATeacher(tx, { fullName: "Equal B", averageRating: "3.25" });
      expect(equalB).toBeGreaterThan(equalA);

      const page = await TeacherRepository.listMatchingCandidates(explicit, 100, 0, tx);
      const implicitPage = await TeacherRepository.listMatchingCandidates(implicit, 100, 0, tx);

      const expected = [topId, equalB, equalA, midId, unratedId];
      expect(orderedFixtureIds(page.rows, expected)).toEqual(expected);
      // Explicit default == implicit default: the SDL default re-orders
      // NOTHING relative to the pre-sort-choice read.
      expect(orderedFixtureIds(implicitPage.rows, expected)).toEqual(expected);
    });
  });
});
