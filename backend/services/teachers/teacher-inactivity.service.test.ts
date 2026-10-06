/**
 * TeacherInactivityService tests — the inactivity sweep's composition,
 * environment resolution, and frozen-clock staleness boundaries against the
 * live `kottab_test` PostgreSQL instance.
 *
 * Per `backend/db/test/AGENTS.md`:
 *  - Transactional cases run inside `runInRollback` with `tx` propagated;
 *    the composition legs spy the repository seam (no rows are written),
 *    so their own-transaction arms open empty top-level transactions that
 *    commit nothing.
 *  - Entities are created ONLY via `entity-setup.ts` helpers; no seed data.
 *  - The service has no denial path (the sweep denies nobody), so there is
 *    nothing to assert via `expectRepoError` except failure propagation —
 *    the repo seam rejecting must roll the pass back and leave the caller's
 *    transaction usable (the body adds no catch).
 *  - Frozen clock via `setSystemTime` (restored in `finally` / the helper)
 *    for every cutoff-arithmetic and boundary leg — the service's internal
 *    clock capture becomes a caller-chosen instant, so the millisecond-exact
 *    staleness equality is provable here (and at the repository tier) even
 *    though the journey tier, which never fakes clocks, pins the
 *    second-resolution edges instead.
 *
 * Coverage map:
 *  - Composition: the guarded batch primitive receives
 *    `(now, cutoff, tx)` — ONE captured now, the cutoff derived from it;
 *    the caller's outer transaction is JOINED (the pass reads the caller's
 *    uncommitted state through a savepoint on it — the shared-connection
 *    visibility the join exists for) while the production arm opens the
 *    service's own (identity-distinct) handle; the honest count passes
 *    through untouched (zero stays zero); a repo failure propagates
 *    uncaught and the caller's transaction survives the SAVEPOINT
 *    rollback; the completion log fires exactly once with the count and
 *    the sweep emits no domain-error log on any arm.
 *  - Environment resolution: unset key → the 15-minute default drives the
 *    cutoff arithmetic; "20" widens it to exactly now − 20 minutes; garbage
 *    (zero, negative, fractional, text, empty, whitespace) falls back to
 *    the default — resolution never throws. Every leg stubs the raw
 *    environment key and resets the environment snapshot cache; the
 *    original environment is restored after every case.
 *  - Staleness boundary (real primitive, one captured now): activity
 *    14:59 old stays online; activity EXACTLY at the cutoff stays online
 *    (strict `<`); activity 15:01 old flips offline — one sweep pass
 *    evaluates all three against the same frozen instant, and the pass
 *    opens with a drain so pre-existing stale-online rows never inflate
 *    the honest count.
 */

import { afterAll, afterEach, beforeEach, describe, expect, setSystemTime, spyOn, test } from "bun:test";
import { eq } from "drizzle-orm";
import { TeacherRepository } from "@/backend/db/repo";
import { teacher } from "@/backend/db/schema/teachers/teacher";
import { createTestTeacherRow, createTestUser } from "@/backend/db/test/entity-setup";
import { type DBTransaction, expectRepoError, runInRollback } from "@/backend/db/test/test-utils";
import { getTeacherInactivityTimeoutMinutes, resetEnvironmentCache } from "@/backend/lib/env";
import { logger } from "@/backend/lib/logger";
import { TeacherInactivityService } from "@/backend/services/teachers/teacher-inactivity.service";

/**
 * A fixed, second-aligned frozen instant for the cutoff arithmetic: the
 * service's internal `new Date()` resolves to exactly this value under the
 * frozen clock, so the derived cutoff is byte-exact against expectation.
 */
const FROZEN_NOW_MS = 1_800_000_000_000;

/** The default inactivity window in milliseconds (15 minutes). */
const DEFAULT_WINDOW_MS = 15 * 60_000;

// ─── Environment fixture (restored after every case) ─────────────────────

/** The inactivity-window key the sweep's threshold getter resolves. */
const TEACHER_INACTIVITY_ENV_KEYS = ["TEACHER_INACTIVITY_TIMEOUT_MINUTES"] as const;

const originalInactivityEnv: Record<string, string | undefined> = {};
for (const key of TEACHER_INACTIVITY_ENV_KEYS) {
  originalInactivityEnv[key] = process.env[key];
}

/** Removes the inactivity key — the deterministic base for default probes. */
function clearInactivityEnv(): void {
  for (const key of TEACHER_INACTIVITY_ENV_KEYS) {
    delete process.env[key];
  }
}

function restoreInactivityEnv(): void {
  for (const key of TEACHER_INACTIVITY_ENV_KEYS) {
    const value = originalInactivityEnv[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  resetEnvironmentCache();
}

// ─── Shared helpers ──────────────────────────────────────────────────────

/**
 * An instant `minutes` before now — the composition fixtures' staleness
 * margin (minutes-deep, far past any realistic statement latency).
 */
function minutesAgo(minutes: number): Date {
  return new Date(Date.now() - minutes * 60_000);
}

/**
 * Freezes the process clock for the duration of `run` and always restores
 * it — the frozen-clock discipline for every cutoff-arithmetic and
 * boundary leg (the service's one captured now becomes caller-chosen).
 */
async function withFrozenClock<T>(atMs: number, run: () => Promise<T>): Promise<T> {
  setSystemTime(atMs);
  try {
    return await run();
  } finally {
    setSystemTime();
  }
}

/**
 * Online-teacher fixture with a controlled activity stamp: `lastActiveAt`
 * is caller-backdated (the sweep's staleness probe reads it through the
 * owning user row). Returns the teacher row id (shared PK with the user).
 */
async function createOnlineTeacher(tx: DBTransaction, lastActiveAt: Date): Promise<number> {
  const user = await createTestUser(tx, { role: "teacher", lastActiveAt });
  await createTestTeacherRow(tx, user.id, { isOnline: true });
  return user.id;
}

/** Read-back oracle — the persisted availability flag of one teacher row. */
async function isOnlineOf(tx: DBTransaction, teacherId: number): Promise<boolean | null> {
  const [row] = await tx.select({ isOnline: teacher.isOnline }).from(teacher).where(eq(teacher.id, teacherId));
  return row?.isOnline ?? null;
}

/**
 * Installs the repository-seam spy (the composition legs' only DB surface —
 * with the spy in place the sweep writes nothing, so its own-transaction
 * arm opens an empty top-level transaction that commits nothing).
 */
function spySweepPrimitive(mockedCount: number) {
  return spyOn(TeacherRepository, "sweepInactiveOnlineOnce").mockResolvedValue(mockedCount);
}

/**
 * Drains the garbage-value matrix sequentially via a recursive helper —
 * each probe needs its own env stub + reset + frozen-clock sweep cycle, so
 * the ordered, isolated per-probe discipline rules out a parallel loop.
 */
async function probeGarbageValues(
  values: readonly string[],
  index: number,
  sweepSpy: ReturnType<typeof spySweepPrimitive>
): Promise<void> {
  if (index >= values.length) {
    return;
  }
  const garbage = values.at(index);
  if (garbage === undefined) {
    return;
  }
  process.env.TEACHER_INACTIVITY_TIMEOUT_MINUTES = garbage;
  resetEnvironmentCache();

  // Resolution never throws: the value falls back to the safe default.
  expect(getTeacherInactivityTimeoutMinutes()).toBe(15);
  await withFrozenClock(FROZEN_NOW_MS, () => TeacherInactivityService.sweepInactiveTeachers());
  const [, cutoff] = sweepSpy.mock.calls.at(-1) ?? [];
  expect(cutoff?.getTime()).toBe(FROZEN_NOW_MS - DEFAULT_WINDOW_MS);

  await probeGarbageValues(values, index + 1, sweepSpy);
}

// ─── Composition (the repo seam spied) ───────────────────────────────────

describe("TeacherInactivityService.sweepInactiveTeachers — composition", () => {
  test("the guarded batch primitive receives (now, cutoff, tx): ONE captured now, the cutoff derived from it", async () => {
    const sweepSpy = spySweepPrimitive(3);
    try {
      clearInactivityEnv();
      resetEnvironmentCache();

      const result = await withFrozenClock(FROZEN_NOW_MS, () => TeacherInactivityService.sweepInactiveTeachers());

      expect(result).toEqual({ offlined: 3 });
      expect(sweepSpy).toHaveBeenCalledTimes(1);
      const [now, cutoff, tx] = sweepSpy.mock.calls.at(0) ?? [];
      expect(now?.getTime()).toBe(FROZEN_NOW_MS);
      expect(cutoff?.getTime()).toBe(FROZEN_NOW_MS - DEFAULT_WINDOW_MS);
      // The service opened its own transaction for the pass (production arm).
      expect(tx).toBeDefined();
    } finally {
      sweepSpy.mockRestore();
      restoreInactivityEnv();
    }
  });

  test("the caller's outer transaction is joined — the pass sees the caller's uncommitted state through a savepoint on it", async () => {
    await runInRollback(async tx => {
      // Drain inside the caller's unit first: the sweep predicate is global,
      // so pre-existing stale-online rows are transitioned before the fixture
      // lands.
      await TeacherInactivityService.sweepInactiveTeachers(tx);

      // An UNCOMMITTED stale-online fixture — visible ONLY through the
      // caller's transaction. The joined pass reads it and sweeps it; an
      // own-transaction pass could not (the join, not a parallel handle,
      // is what makes the composed unit atomic with the caller's work).
      const joinedVictim = await createOnlineTeacher(tx, minutesAgo(30));

      const swept = await TeacherInactivityService.sweepInactiveTeachers(tx);

      expect(swept).toEqual({ offlined: 1 });
      expect(await isOnlineOf(tx, joinedVictim)).toBe(false);
    });
  });

  test("no outer transaction opens the service's own — the received handle is a fresh, identity-distinct transaction", async () => {
    await runInRollback(async callerTx => {
      const sweepSpy = spySweepPrimitive(2);
      try {
        const result = await TeacherInactivityService.sweepInactiveTeachers();

        expect(result).toEqual({ offlined: 2 });
        expect(sweepSpy).toHaveBeenCalledTimes(1);
        const [, , receivedTx] = sweepSpy.mock.calls.at(0) ?? [];
        expect(receivedTx).toBeDefined();
        expect(receivedTx).not.toBe(callerTx);
      } finally {
        sweepSpy.mockRestore();
      }
    });
  });

  test("the honest count passes through untouched — zero stays zero, seven stays seven", async () => {
    const sweepSpy = spySweepPrimitive(0);
    try {
      const empty = await TeacherInactivityService.sweepInactiveTeachers();
      expect(empty).toEqual({ offlined: 0 });

      sweepSpy.mockResolvedValueOnce(7);
      const populated = await TeacherInactivityService.sweepInactiveTeachers();
      expect(populated).toEqual({ offlined: 7 });
    } finally {
      sweepSpy.mockRestore();
    }
  });

  test("a repo failure propagates uncaught — the pass rolls back and the caller's transaction stays usable", async () => {
    await runInRollback(async tx => {
      const sentinel = new Error("sweep primitive unavailable");
      const sweepSpy = spyOn(TeacherRepository, "sweepInactiveOnlineOnce").mockRejectedValue(sentinel);
      try {
        const caught = await expectRepoError(() => TeacherInactivityService.sweepInactiveTeachers(tx));
        expect(caught).toBe(sentinel);

        // The SAVEPOINT rolled back only the pass — the caller's unit of
        // work is still alive and usable for further statements.
        const probe = await tx.select({ id: teacher.id }).from(teacher).limit(0);
        expect(probe).toEqual([]);
      } finally {
        sweepSpy.mockRestore();
      }
    });
  });

  test("the completion log fires exactly once with the honest count; the sweep denies nobody (zero domain-error logs)", async () => {
    const sweepSpy = spySweepPrimitive(5);
    const infoSpy = spyOn(logger, "info").mockImplementation(() => {});
    const domainSpy = spyOn(logger, "logDomainError").mockImplementation(() => {});
    try {
      const result = await TeacherInactivityService.sweepInactiveTeachers();

      expect(result).toEqual({ offlined: 5 });
      expect(infoSpy).toHaveBeenCalledTimes(1);
      const [message, meta] = infoSpy.mock.calls.at(0) ?? [];
      expect(message).toBe("Teacher inactivity sweep completed");
      expect(meta).toEqual({ offlined: 5 });
      expect(domainSpy.mock.calls).toHaveLength(0);
    } finally {
      sweepSpy.mockRestore();
      infoSpy.mockRestore();
      domainSpy.mockRestore();
    }
  });
});

// ─── Environment resolution (the threshold getter through the snapshot) ──

describe("TeacherInactivityService.sweepInactiveTeachers — environment resolution", () => {
  beforeEach(() => {
    clearInactivityEnv();
    resetEnvironmentCache();
  });
  afterEach(restoreInactivityEnv);

  test("unset key → the 15-minute default drives the cutoff arithmetic", async () => {
    expect(getTeacherInactivityTimeoutMinutes()).toBe(15);

    const sweepSpy = spySweepPrimitive(0);
    try {
      await withFrozenClock(FROZEN_NOW_MS, () => TeacherInactivityService.sweepInactiveTeachers());
      const [, cutoff] = sweepSpy.mock.calls.at(0) ?? [];
      expect(cutoff?.getTime()).toBe(FROZEN_NOW_MS - DEFAULT_WINDOW_MS);
    } finally {
      sweepSpy.mockRestore();
    }
  });

  test("'20' widens the window — the cutoff moves to exactly now − 20 minutes", async () => {
    process.env.TEACHER_INACTIVITY_TIMEOUT_MINUTES = "20";
    resetEnvironmentCache();
    expect(getTeacherInactivityTimeoutMinutes()).toBe(20);

    const sweepSpy = spySweepPrimitive(0);
    try {
      await withFrozenClock(FROZEN_NOW_MS, () => TeacherInactivityService.sweepInactiveTeachers());
      const [, cutoff] = sweepSpy.mock.calls.at(0) ?? [];
      expect(cutoff?.getTime()).toBe(FROZEN_NOW_MS - 20 * 60_000);
    } finally {
      sweepSpy.mockRestore();
    }
  });

  test("garbage values fall back to the 15-minute default — resolution never throws", async () => {
    const sweepSpy = spySweepPrimitive(0);
    try {
      await probeGarbageValues(["0", "-3", "1.5", "abc", "", "   ", "15min", "+5"], 0, sweepSpy);
      expect(sweepSpy.mock.calls).toHaveLength(8);
    } finally {
      sweepSpy.mockRestore();
    }
  });
});

// ─── Frozen-clock staleness boundary (the real primitive) ────────────────

describe("TeacherInactivityService.sweepInactiveTeachers — staleness boundary", () => {
  afterAll(() => {
    setSystemTime();
  });

  test("14:59 and EXACTLY 15:00 stay online (strict <), 15:01 flips offline — one captured now for all three", async () => {
    await withFrozenClock(FROZEN_NOW_MS, async () => {
      await runInRollback(async tx => {
        // Drain first: the sweep predicate is global, so pre-existing
        // stale-online rows (committed by other suites) are transitioned
        // BEFORE the fixtures — the pass below counts only what it created.
        await TeacherInactivityService.sweepInactiveTeachers(tx);

        const cutoffMs = FROZEN_NOW_MS - DEFAULT_WINDOW_MS;
        const insideThreshold = await createOnlineTeacher(tx, new Date(cutoffMs + 1_000)); // 14:59 old
        const atCutoff = await createOnlineTeacher(tx, new Date(cutoffMs)); // exactly 15:00 old
        const pastThreshold = await createOnlineTeacher(tx, new Date(cutoffMs - 1_000)); // 15:01 old

        const swept = await TeacherInactivityService.sweepInactiveTeachers(tx);

        expect(swept).toEqual({ offlined: 1 });
        expect(await isOnlineOf(tx, insideThreshold)).toBe(true);
        expect(await isOnlineOf(tx, atCutoff)).toBe(true);
        expect(await isOnlineOf(tx, pastThreshold)).toBe(false);
      });
    });
  });
});
