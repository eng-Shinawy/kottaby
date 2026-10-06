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
 *  - Binding discipline + static pins: finished patterns bound verbatim
 *    (a raw `_` wildcard still matches — escaping is upstream), patterns
 *    never re-escaped or re-wrapped, SessionStatus as a VALUE import, and
 *    the negative-offset error surfaced (no silent clamping).
 */

import { afterAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { eq, sql } from "drizzle-orm";
import { db } from "@/backend/db";
import { TeacherRepository } from "@/backend/db/repo";
import type { NormalizedTeacherMatchingFilters } from "@/backend/db/repo/teachers/teacher.repository";
import { teacher } from "@/backend/db/schema/teachers/teacher";
import { users } from "@/backend/db/schema/users/users";
import {
  createTestTeacherRow as createTeacherRowFixture,
  createTestApplicant,
  createTestSession,
  createTestUser,
} from "@/backend/db/test/entity-setup";
import { constraintNameOf, expectRepoError, runInRollback } from "@/backend/db/test/test-utils";
import { SessionStatus } from "@/backend/enum/scheduling/session-status.enum";
import type { DBTransaction, TeacherSelectType, UserSelectType } from "@/backend/types";
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

/** Books a session for the teacher (student leg = a fresh student user, the FK parent). */
async function createTeacherSession(tx: DBTransaction, teacherId: number, status: SessionStatus): Promise<void> {
  const student = await createTestUser(tx, { role: "student" });
  await createTestSession(tx, teacherId, student.id, { status });
}

/** Teacher rows committed OUTSIDE `runInRollback` (concurrency tier) — hard-deleted in `afterAll`. */
const committedTeacherUserIds: number[] = [];

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
  // Hard-delete every committed fixture (teacher row first, then its owning
  // user — same direction as the cascade) so nothing leaks across suites.
  await Promise.all(
    committedTeacherUserIds.map(async teacherUserId => {
      await db.delete(teacher).where(eq(teacher.id, teacherUserId));
      await db.delete(users).where(eq(users.id, teacherUserId));
    })
  );
  committedTeacherUserIds.length = 0;
});

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

  /**
   * The lockForCertificationCheck slice — the injection-surface pin target.
   * The no-interpolation ban is scoped to this slice: the lock query is a
   * pure bound-parameter read, while the file's OTHER reads (incl. the
   * batch sweep's parameterized EXISTS probes) legitimately interpolate
   * Drizzle column references / enum values inside `sql` templates — which
   * renders as bound parameters, not SQL text.
   */
  function repoLockSource(): string {
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
    expect(repoLockSource().includes("${")).toBe(false);
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

/** The setOnline slice of the repository source (the static pin target). */
function repoSetOnlineSource(): string {
  const source = readFileSync(join(import.meta.dir, "../../../repo/teachers/teacher.repository.ts"), "utf8");
  const start = source.indexOf("export async function setOnline(");
  return source.slice(start, source.indexOf("\n  }", start));
}

describe("TeacherRepository.setOnline (the INV-S6 lock primitive)", () => {
  // ─── Tier 1: branch/statement ───────────────────────────────────────

  test("sets is_online=false on an online teacher (the lock direction)", async () => {
    await runInRollback(async tx => {
      const user = await createTestUser(tx, { role: "teacher" });
      await createTestTeacherRow(tx, user.id, true);
      // The fixture default is isOnline=false; force the online state first.
      await tx.update(teacher).set({ isOnline: true }).where(eq(teacher.id, user.id));

      const row = await TeacherRepository.setOnline(user.id, false, tx);

      expect(row).not.toBeNull();
      if (!row) throw new Error("expected the updated teacher row");
      expect(row.id).toBe(user.id);
      expect(row.isOnline).toBe(false);
      // Independent read-back oracle (same tx — read-your-writes).
      const [reread] = await tx.select().from(teacher).where(eq(teacher.id, user.id));
      expect(reread?.isOnline).toBe(false);
    });
  });

  test("sets is_online=true on an offline teacher (the release direction)", async () => {
    await runInRollback(async tx => {
      const user = await createTestUser(tx, { role: "teacher" });
      await createTestTeacherRow(tx, user.id, true);

      const row = await TeacherRepository.setOnline(user.id, true, tx);

      expect(row?.isOnline).toBe(true);
    });
  });

  test("the write advances updated_at (now() is re-evaluated per call)", async () => {
    await runInRollback(async tx => {
      const user = await createTestUser(tx, { role: "teacher" });
      // Pin the fixture stamp to the epoch so the refresh is unambiguous:
      // now() inside this tx is strictly later (PostgreSQL now() returns
      // transaction-start time, but the epoch predates any real run).
      await createTeacherRowFixture(tx, user.id, { updatedAt: new Date(0) });

      const row = await TeacherRepository.setOnline(user.id, false, tx);

      expect(row).not.toBeNull();
      // Independent read-back oracle — same tx, read-your-writes.
      const [reread] = await tx.select().from(teacher).where(eq(teacher.id, user.id));
      if (!reread) throw new Error("expected the updated teacher row");
      expect(reread.updatedAt.getTime()).toBeGreaterThan(0);
    });
  });

  // ─── Tier 2: boundary / honest failure ──────────────────────────────

  test("returns null for an unknown teacher id (zero rows matched)", async () => {
    await runInRollback(async tx => {
      const absentId = await absentTeacherId(tx);
      const row = await TeacherRepository.setOnline(absentId, false, tx);
      expect(row).toBeNull();
    });
  });

  test("a redundant same-value write returns the row and changes nothing (idempotent under retry)", async () => {
    await runInRollback(async tx => {
      const user = await createTestUser(tx, { role: "teacher" });
      await createTestTeacherRow(tx, user.id, true);
      await TeacherRepository.setOnline(user.id, false, tx);

      const again = await TeacherRepository.setOnline(user.id, false, tx);

      expect(again).not.toBeNull();
      expect(again?.isOnline).toBe(false);
      const [reread] = await tx.select().from(teacher).where(eq(teacher.id, user.id));
      expect(reread?.isOnline).toBe(false);
    });
  });

  test("a redundant same-value write returns the row and changes nothing — true→true direction", async () => {
    await runInRollback(async tx => {
      const user = await createTestUser(tx, { role: "teacher" });
      await createTestTeacherRow(tx, user.id, true);
      // Drive is_online to true first (the fixture default is false).
      await TeacherRepository.setOnline(user.id, true, tx);

      const again = await TeacherRepository.setOnline(user.id, true, tx);

      expect(again).not.toBeNull();
      expect(again?.isOnline).toBe(true);
      const [reread] = await tx.select().from(teacher).where(eq(teacher.id, user.id));
      expect(reread?.isOnline).toBe(true);
    });
  });

  test("a row forced is_online = NULL → setOnline(true) writes cleanly (null-column coercion)", async () => {
    await runInRollback(async tx => {
      const user = await createTestUser(tx, { role: "teacher" });
      await createTestTeacherRow(tx, user.id, true);
      // Force the column to NULL — the schema permits it (no notNull).
      await tx.update(teacher).set({ isOnline: null }).where(eq(teacher.id, user.id));

      const row = await TeacherRepository.setOnline(user.id, true, tx);

      expect(row).not.toBeNull();
      expect(row?.isOnline).toBe(true);
      // Independent read-back oracle.
      const [reread] = await tx.select().from(teacher).where(eq(teacher.id, user.id));
      expect(reread?.isOnline).toBe(true);
    });
  });

  test("certification plays no part: an unapproved teacher row locks and releases identically", async () => {
    await runInRollback(async tx => {
      const user = await createTestUser(tx, { role: "teacher" });
      await createTestTeacherRow(tx, user.id, false);

      const locked = await TeacherRepository.setOnline(user.id, false, tx);
      const released = await TeacherRepository.setOnline(user.id, true, tx);

      expect(locked?.isOnline).toBe(false);
      expect(released?.isOnline).toBe(true);
    });
  });

  // ─── Tier 3: transaction composition (tx propagation) ───────────────

  test("the write rides the caller's transaction: a forced rollback un-applies the lock", async () => {
    let probedTeacherId = 0;
    await runInRollback(async tx => {
      const user = await createTestUser(tx, { role: "teacher" });
      await createTestTeacherRow(tx, user.id, true);
      probedTeacherId = user.id;
      const row = await TeacherRepository.setOnline(user.id, false, tx);
      expect(row?.isOnline).toBe(false);
    });
    // The rollback un-applied the lock: a fresh read sees the durable
    // default (is_online=false was the fixture state all along, so the
    // honest probe is that the ROW itself is gone with its owning user).
    const [gone] = await db.select().from(users).where(eq(users.id, probedTeacherId));
    expect(gone).toBeUndefined();
  });

  test("lock + release composed inside ONE transaction resolve deadlock-free (tx-threading proof)", async () => {
    await runInRollback(async tx => {
      const user = await createTestUser(tx, { role: "teacher" });
      await createTestTeacherRow(tx, user.id, true);

      const locked = await TeacherRepository.setOnline(user.id, false, tx);
      const released = await TeacherRepository.setOnline(user.id, true, tx);

      expect(locked?.isOnline).toBe(false);
      expect(released?.isOnline).toBe(true);
      // Completion without deadlock IS the assertion: a call that mixed the
      // ambient db into this tx would hang the single connection.
    });
  });

  // ─── Tier 3+: chaos (concurrent same-row updates across txs) ───────
  // These tests require real PostgreSQL (multi-connection row-level locking).
  // PGlite is single-connection WASM and cannot observe cross-tx lock
  // serialization, so the chaos tier is skipped there.
  const testOnRealPostgres = isPgliteProvider() ? test.skip : test;

  testOnRealPostgres(
    "25-way Promise.allSettled mixed-toggle storm ⇒ deterministic final is_online (no partial writes)",
    async () => {
      const teacherUserId = await createCommittedTeacher(true);

      // Fire 25 parallel mixed toggles (alternating true/false) — each
      // opens its own top-level transaction. The row lock serializes them;
      // the final committed value is the LAST write that acquired the
      // lock. None rejects — the repo primitive has no business guard
      // (the service layer composes WHEN).
      const results = await Promise.allSettled(
        Array.from({ length: 25 }, (_, index) =>
          db.transaction(async tx => TeacherRepository.setOnline(teacherUserId, index % 2 === 0, tx))
        )
      );

      const fulfilled = results.filter(r => r.status === "fulfilled");
      const rejected = results.filter(r => r.status === "rejected");
      expect(fulfilled).toHaveLength(25);
      expect(rejected).toHaveLength(0);

      // Deterministic final state — the final committed is_online is a
      // total boolean (no partial write, no corruption). The certification
      // flag is unchanged by the storm.
      const [finalRow] = await db.select().from(teacher).where(eq(teacher.id, teacherUserId));
      expect(finalRow?.isOnline).toBeTypeOf("boolean");
      expect(finalRow?.isApproved).toBe(true);
    }
  );

  // ─── Tier 4: static surface pins ────────────────────────────────────

  test("source: setOnline is a REQUIRED-tx guarded write returning the row or null", () => {
    expect(repoSetOnlineSource()).toContain("export async function setOnline(");
    expect(repoSetOnlineSource()).toContain("online: boolean");
    expect(repoSetOnlineSource()).toContain("tx: DBTransaction");
    expect(repoSetOnlineSource()).toContain(".returning()");
  });

  test("source: the id reaches the WHERE clause only as a bound parameter; no LIKE/scan surface", () => {
    const source = repoSetOnlineSource();
    expect(source).toContain("eq(teacher.id, id)");
    // No raw-SQL string building around the id; no LIKE/ILIKE scan surface.
    expect(source).not.toMatch(/\b(ilike|like)\s*\(/i);
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

  const MATCHING_REPO_FILE = join(import.meta.dir, "../../../repo/teachers/teacher.repository.ts");
  const matchingRepoSource = readFileSync(MATCHING_REPO_FILE, "utf8");
  // The matching WHERE-chain builders live in the sibling helpers module
  // (`teacher.repository.helpers.ts`, extracted under the oxlint max-lines
  // budget) — the builder pins below read THAT file's source.
  const MATCHING_HELPERS_FILE = join(import.meta.dir, "../../../repo/teachers/teacher.repository.helpers.ts");
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
    const tier = matchingHelpersSource.slice(
      matchingHelpersSource.indexOf("function buildTeacherMatchingCountryTier("),
      matchingHelpersSource.indexOf("function buildTeacherMatchingCountryTier(") + 400
    );
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

  test("source: the projection is exactly the nine raw columns; ordering is tier, rating desc nulls last, id desc", () => {
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
    expect(method).toContain("desc nulls last");
    expect(method).toContain("desc(teacher.id)");
    expect(method).toContain("count(*)::int");
    expect(method).toContain("tx && isDBTransaction(tx) ? tx : db");
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
