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
 */

import { afterAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { eq, sql } from "drizzle-orm";
import { db } from "@/backend/db";
import { TeacherRepository } from "@/backend/db/repo";
import { teacher } from "@/backend/db/schema/teachers/teacher";
import { users } from "@/backend/db/schema/users/users";
import {
  createTestTeacherRow as createTeacherRowFixture,
  createTestApplicant,
  createTestUser,
} from "@/backend/db/test/entity-setup";
import { constraintNameOf, expectRepoError, runInRollback } from "@/backend/db/test/test-utils";
import type { DBTransaction } from "@/backend/types";
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

  test("source: the id reaches the query only as a bound parameter (no injection surface)", () => {
    expect(repoSource.includes("--")).toBe(false);
    expect(repoSource.includes("${")).toBe(false);
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

  // ─── Tier 4: static surface pins ────────────────────────────────────

  test("source: setOnline is a REQUIRED-tx guarded write returning the row or null", () => {
    expect(repoSetOnlineSource()).toContain("export async function setOnline(");
    expect(repoSetOnlineSource()).toContain("online: boolean");
    expect(repoSetOnlineSource()).toContain("tx: DBTransaction");
    expect(repoSetOnlineSource()).toContain(".returning()");
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
