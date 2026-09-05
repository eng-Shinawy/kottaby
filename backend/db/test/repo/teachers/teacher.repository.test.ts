/**
 * TeacherRepository tests — `lockForCertificationCheck` (certification lock)
 * against the live `kottaby_test_db` PostgreSQL instance.
 *
 * Per `backend/db/test/AGENTS.md`:
 *  - Rollback-isolated tests run inside `runInRollback`; `tx` is passed to
 *    EVERY repo call, entity-setup helper, and direct Drizzle query.
 *  - Entities are created ONLY via `entity-setup.ts` helpers plus a
 *    file-local shared-PK teacher-row helper — never seed data.
 *  - No `expect(...).rejects.toThrow()` — the method signals a missing row
 *    by returning `null`, so this suite has no throwing paths to probe.
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
 *    parameter, no non-tx executor branch, no i18n/logger imports, exactly
 *    one exported method, and a two-column projection.
 */

import { afterAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { eq, sql } from "drizzle-orm";
import { db } from "@/backend/db";
import { TeacherRepository } from "@/backend/db/repo";
import { teacher } from "@/backend/db/schema/teachers/teacher";
import { users } from "@/backend/db/schema/users/users";
import { createTestApplicant, createTestUser } from "@/backend/db/test/entity-setup";
import { runInRollback } from "@/backend/db/test/test-utils";
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
