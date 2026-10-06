/**
 * UserRepository tests — the `users.country_code` column surface of the
 * canonical ISO 3166-1 alpha-2 country-code persistence, plus the
 * activity-stamp primitives (`updateLastActiveAt` / `updateLastActiveAtIfStale`)
 * that own every `last_active_at` write.
 *
 * Per `backend/db/test/AGENTS.md`:
 *  - Write/transactional cases run inside `runInRollback`; `tx` is passed to
 *    EVERY repo call and direct Drizzle query. The raw-SQL read branch
 *    (`findByEmail` / `findById` WITHOUT `tx`) cannot see uncommitted rows,
 *    so it is exercised against COMMITTED fixtures created in `beforeAll`
 *    and hard-deleted in `afterAll` (Rule 9) with a zero-residue probe.
 *  - Fixtures are created ONLY via `entity-setup.ts` / explicit field-by-field
 *    inserts — never seed data.
 *  - Expected DB-layer rejections use the `expectRepoError` try/catch helper
 *    (never `expect(...).rejects.toThrow()`) and run as the LAST statement of
 *    their own rollback transaction (a failed INSERT aborts its tx).
 *
 * Coverage map:
 *  - Tier 1 (contract): `create` persists `countryCode` next to the legacy
 *    `country` display value; the round-trip returns both via the
 *    transactional Drizzle read path.
 *  - Tier 2 (boundary): legacy-shape rows (no code) read back `null` on every
 *    executor path; the raw-SQL read branch surfaces `country_code` for a
 *    coded row and `null` for a legacy row (the explicit-SELECT-list trap:
 *    a missing column would type-check while yielding `undefined`);
 *    `varchar(2)` is character-counted — 2 chars (incl. multibyte) fit,
 *    3 chars are rejected at the database layer.
 *  - Tier 3 (concurrency): concurrent `create` calls via `Promise.allSettled`
 *    inside the rollback tx all succeed and each row keeps its own code.
 *  - Tier 4 (abuse): oversized and injected code strings are rejected by the
 *    column's length boundary; the `users` table is untouched afterwards.
 *  - Activity stamps (Tier 1 contract / Tier 2 boundary): the guarded
 *    single-statement identity writes on `last_active_at` — monotonic
 *    advance, NULL-flip, zero-row no-regress on an older or equal instant
 *    (strict `<`), coalesce-window throttle hit/miss, unknown-id zero-row
 *    miss, and the no-tx pool executor branch (zero-row probe — nothing
 *    written). The stamp tests are backdated-fixture driven; the throttled
 *    variant freezes the clock (`setSystemTime`, restored in `finally`) to
 *    pin the window arithmetic to deterministic instants.
 */

import { afterAll, beforeAll, describe, expect, setSystemTime, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/backend/db";
import { USER_ACTIVITY_COALESCE_WINDOW_MS, UserRepository } from "@/backend/db/repo";
import { users } from "@/backend/db/schema/users/users";
import { createTestUser } from "@/backend/db/test/entity-setup";
import { expectRepoError, runInRollback } from "@/backend/db/test/test-utils";
import type { DBTransaction, UserInsertType } from "@/backend/types";

/** Test bcrypt hash stub (placeholder — never used for verification). */
const TEST_BCRYPT_STUB_HASH = "$2a$12$abcdefghijklmnopqrstuvABCDEFGHIJKLMNOPQRSTUV1234567890ABCDEFGHIJKLMNOPQRSTUV";

/** Committed-fixture emails — unique per run so beforeAll never collides. */
const WITH_CODE_EMAIL = `country-code-raw-${randomUUID()}@test.local`;
const LEGACY_EMAIL = `country-legacy-raw-${randomUUID()}@test.local`;

/** Ids of the committed beforeAll fixtures (captured for afterAll cleanup). */
const committedFixtureIds: number[] = [];

/** Id far beyond the identity sequence's reach — guaranteed nonexistent. */
const NONEXISTENT_USER_ID = 2_000_000_000;

/**
 * Inserts one committed user on the pool connection — the sanctioned Rule-9
 * static-fixture path for exercising the raw-SQL read branch.
 */
async function commitFixtureUser(values: Pick<UserInsertType, "email" | "country" | "countryCode">): Promise<void> {
  const created = await db.transaction(async (tx: DBTransaction) => {
    const [row] = await tx
      .insert(users)
      .values({
        fullName: `Country Fixture ${randomUUID().slice(0, 8)}`,
        email: values.email,
        phone: "+10000000000",
        passwordHash: TEST_BCRYPT_STUB_HASH,
        role: "student",
        country: values.country,
        ...(values.countryCode ? { countryCode: values.countryCode } : {}),
        isDeleted: false,
        suspended: false,
        isBlocked: false,
        lastActiveAt: new Date(),
      })
      .returning({ id: users.id });
    return row;
  });
  if (!created) {
    throw new Error(`commitFixtureUser: insert returned no rows for ${values.email}`);
  }
  committedFixtureIds.push(created.id);
}

/**
 * Builds a field-by-field `UserInsertType` payload (BOPLA — no spreads from
 * untrusted shapes) with a unique email and the requested country surface.
 */
function buildInsert(countryCode: string | null, country: string | null): UserInsertType {
  return {
    fullName: `Country Repo Test ${randomUUID().slice(0, 8)}`,
    email: `country-repo-${randomUUID()}@test.local`,
    phone: "+10000000000",
    passwordHash: TEST_BCRYPT_STUB_HASH,
    role: "student",
    country,
    countryCode,
  };
}

/**
 * Walks the driver wrapping (DrizzleError → pg error) down to the root
 * PostgreSQL error and returns its SQLSTATE code + message, so assertions
 * pin the database-level failure instead of the generic "Failed query"
 * envelope Drizzle puts on top.
 */
function pgErrorOf(err: unknown): { code?: string; message: string } {
  let current: unknown = err;
  while (current instanceof Error) {
    if ("code" in current && typeof current.code === "string") {
      return { code: current.code, message: current.message };
    }
    current = current.cause;
  }
  return { message: err instanceof Error ? err.message : String(err) };
}

beforeAll(async () => {
  await commitFixtureUser({ email: WITH_CODE_EMAIL, country: "Egypt", countryCode: "EG" });
  await commitFixtureUser({ email: LEGACY_EMAIL, country: "Egypt", countryCode: null });
});

afterAll(async () => {
  // Hard-delete ONLY the committed fixtures this file created (Rule 9).
  await Promise.all(committedFixtureIds.map(id => db.delete(users).where(eq(users.id, id))));
  // Zero-residue probe: both fixtures are fully gone.
  const residues = await Promise.all(committedFixtureIds.map(id => UserRepository.findById(id)));
  for (const residue of residues) {
    expect(residue).toBeNull();
  }
});

describe("UserRepository.create — country_code round-trip (transactional paths)", () => {
  test("Tier 1 — create persists the ISO code next to the legacy display country and both read it back", async () => {
    await runInRollback(async tx => {
      const insert = buildInsert("EG", "Egypt");
      const created = await UserRepository.create(insert, tx);
      expect(created.countryCode).toBe("EG");
      expect(created.country).toBe("Egypt");

      const byEmail = await UserRepository.findByEmail(insert.email, tx);
      const byId = await UserRepository.findById(created.id, tx);
      expect(byEmail?.countryCode).toBe("EG");
      expect(byEmail?.country).toBe("Egypt");
      expect(byId?.countryCode).toBe("EG");
      expect(byId?.country).toBe("Egypt");
    });
  });

  test("Tier 2 — a legacy-shape row (no code) reads back countryCode null via the tx path", async () => {
    await runInRollback(async tx => {
      const created = await UserRepository.create(buildInsert(null, "Egypt"), tx);
      expect(created.countryCode).toBeNull();
      expect(created.country).toBe("Egypt");

      const byEmail = await UserRepository.findByEmail(created.email, tx);
      const byId = await UserRepository.findById(created.id, tx);
      expect(byEmail?.countryCode).toBeNull();
      expect(byId?.countryCode).toBeNull();
    });
  });

  test("Tier 2 — varchar(2) counts characters: a 2-char multibyte value fits", async () => {
    await runInRollback(async tx => {
      const created = await UserRepository.create(buildInsert("ΩΩ", null), tx);
      const byId = await UserRepository.findById(created.id, tx);
      expect(byId?.countryCode).toBe("ΩΩ");
    });
  });
});

describe("UserRepository raw-SQL read branch — country_code must ride the explicit SELECT list", () => {
  test("Tier 1 — findByEmail (no tx) surfaces the committed ISO code", async () => {
    const found = await UserRepository.findByEmail(WITH_CODE_EMAIL);
    if (!found) throw new Error("expected the committed coded fixture user");
    expect(found.countryCode).toBe("EG");
    expect(found.country).toBe("Egypt");
  });

  test("Tier 1 — findById (no tx) surfaces the committed ISO code", async () => {
    const byEmail = await UserRepository.findByEmail(WITH_CODE_EMAIL);
    if (!byEmail) throw new Error("expected the committed coded fixture user");
    const found = await UserRepository.findById(byEmail.id);
    if (!found) throw new Error("expected the committed coded fixture user by id");
    expect(found.countryCode).toBe("EG");
    expect(found.country).toBe("Egypt");
  });

  test("Tier 2 — both raw-SQL reads surface NULL for the committed legacy-shape row", async () => {
    const byEmail = await UserRepository.findByEmail(LEGACY_EMAIL);
    if (!byEmail) throw new Error("expected the committed legacy fixture user");
    expect(byEmail.countryCode).toBeNull();
    expect(byEmail.country).toBe("Egypt");

    const byId = await UserRepository.findById(byEmail.id);
    if (!byId) throw new Error("expected the committed legacy fixture user by id");
    expect(byId.countryCode).toBeNull();
  });
});

describe("UserRepository.create — concurrent inserts inside the rollback tx", () => {
  test("Tier 3 — Promise.allSettled creates distinct coded users, each keeping its own code", async () => {
    await runInRollback(async tx => {
      const codes = ["EG", "US", "SA", "AE", "PS"] as const;
      const results = await Promise.allSettled(codes.map(code => UserRepository.create(buildInsert(code, null), tx)));

      const rejected = results.filter(r => r.status === "rejected");
      expect(rejected).toEqual([]);

      const createdRows = results.flatMap(result => (result.status === "fulfilled" ? [result.value] : []));
      expect(createdRows.map(row => row.countryCode)).toEqual([...codes]);
      const rereads = await Promise.all(createdRows.map(row => UserRepository.findById(row.id, tx)));
      expect(rereads.map(row => row?.countryCode)).toEqual([...codes]);
    });
  });
});

describe("UserRepository.create — DB-layer rejection of oversized and injected codes", () => {
  test("Tier 2 — a 3-char code exceeds varchar(2) and is rejected by the database", async () => {
    await runInRollback(async tx => {
      const error = await expectRepoError(() => UserRepository.create(buildInsert("EGY", "Egypt"), tx));
      const pg = pgErrorOf(error);
      expect(pg.code).toBe("22001");
      expect(pg.message).toContain("value too long");
    });
  });

  test("Tier 4 — an injected code string is rejected and the users table stays intact", async () => {
    await runInRollback(async tx => {
      const injected = "'); DROP TABLE users; --";
      const error = await expectRepoError(() => UserRepository.create(buildInsert(injected, injected), tx));
      const pg = pgErrorOf(error);
      expect(pg.code).toBe("22001");
      expect(pg.message).toContain("value too long");
    });
    // Fresh transaction — the aborted one rolled back with its failed insert.
    await runInRollback(async tx => {
      const probe = await createTestUser(tx);
      const row = await UserRepository.findById(probe.id, tx);
      expect(row?.id).toBe(probe.id);
    });
  });
});

describe("UserRepository.updateLastActiveAt — monotonic activity stamp", () => {
  test("Tier 1 — a stale stored stamp is advanced to the caller's now", async () => {
    await runInRollback(async tx => {
      const now = new Date();
      const user = await createTestUser(tx, { lastActiveAt: new Date(now.getTime() - 60 * 60_000) });

      expect(await UserRepository.updateLastActiveAt(user.id, now, tx)).toBe(true);

      const reread = await UserRepository.findById(user.id, tx);
      expect(reread?.lastActiveAt?.getTime()).toBe(now.getTime());
    });
  });

  test("Tier 1 — a NULL stamp is flipped to the caller's now", async () => {
    await runInRollback(async tx => {
      const now = new Date();
      const user = await createTestUser(tx, { lastActiveAt: null });

      expect(await UserRepository.updateLastActiveAt(user.id, now, tx)).toBe(true);

      const reread = await UserRepository.findById(user.id, tx);
      expect(reread?.lastActiveAt?.getTime()).toBe(now.getTime());
    });
  });

  test("Tier 2 — a newer stored stamp wins: an older now is a zero-row no-op", async () => {
    await runInRollback(async tx => {
      const fresh = new Date("2026-03-01T12:00:00.000Z");
      const user = await createTestUser(tx, { lastActiveAt: fresh });
      const older = new Date(fresh.getTime() - 60 * 60_000);

      expect(await UserRepository.updateLastActiveAt(user.id, older, tx)).toBe(false);

      // The stored stamp must not have regressed.
      const reread = await UserRepository.findById(user.id, tx);
      expect(reread?.lastActiveAt?.getTime()).toBe(fresh.getTime());
    });
  });

  test("Tier 2 — an equal timestamp is a miss (strict <): the stamp is left untouched", async () => {
    await runInRollback(async tx => {
      const stamp = new Date("2026-03-01T12:00:00.123Z");
      const user = await createTestUser(tx, { lastActiveAt: stamp });

      // The SAME instant as the stored stamp — the monotonic guard rejects it.
      expect(await UserRepository.updateLastActiveAt(user.id, stamp, tx)).toBe(false);

      const reread = await UserRepository.findById(user.id, tx);
      expect(reread?.lastActiveAt?.getTime()).toBe(stamp.getTime());
    });
  });

  test("Tier 2 — an unknown id matches zero rows and returns false", async () => {
    await runInRollback(async tx => {
      expect(await UserRepository.updateLastActiveAt(NONEXISTENT_USER_ID, new Date(), tx)).toBe(false);
    });
  });

  test("Tier 2 — the no-tx pool executor branch runs the same guarded statement", async () => {
    // Outside runInRollback DELIBERATELY — this covers the optional-executor
    // fallback branch that fire-and-forget callers use. The UPDATE pins an id
    // beyond the identity sequence's reach, matches zero rows, and
    // autocommits without writing anything, so no state escapes the test.
    expect(await UserRepository.updateLastActiveAt(NONEXISTENT_USER_ID, new Date())).toBe(false);
  });
});

describe("UserRepository.updateLastActiveAtIfStale — coalesced activity stamp", () => {
  /** The frozen instant every throttled-stamp test is anchored to. */
  const FROZEN = new Date("2026-03-01T12:00:00.000Z");

  /**
   * Freezes the clock at FROZEN for the body and restores real time in
   * `finally` (the repo clock-discipline convention). The primitives take
   * `now` as a parameter (no internal clock reads), so the freeze pins the
   * coalesce-window arithmetic to deterministic instants.
   */
  async function withFrozenClock(fn: (now: Date) => Promise<void>): Promise<void> {
    setSystemTime(FROZEN);
    try {
      await fn(new Date());
    } finally {
      setSystemTime();
    }
  }

  test("Tier 1 — a stamp older than the coalesce boundary is written", async () => {
    await withFrozenClock(async now => {
      await runInRollback(async tx => {
        const staleBefore = new Date(now.getTime() - USER_ACTIVITY_COALESCE_WINDOW_MS);
        const user = await createTestUser(tx, {
          lastActiveAt: new Date(staleBefore.getTime() - 1_000), // one second past the boundary
        });

        expect(await UserRepository.updateLastActiveAtIfStale(user.id, staleBefore, now, tx)).toBe(true);

        const reread = await UserRepository.findById(user.id, tx);
        expect(reread?.lastActiveAt?.getTime()).toBe(now.getTime());
      });
    });
  });

  test("Tier 1 — a NULL stamp passes the throttle and is written", async () => {
    await withFrozenClock(async now => {
      await runInRollback(async tx => {
        const staleBefore = new Date(now.getTime() - USER_ACTIVITY_COALESCE_WINDOW_MS);
        const user = await createTestUser(tx, { lastActiveAt: null });

        expect(await UserRepository.updateLastActiveAtIfStale(user.id, staleBefore, now, tx)).toBe(true);

        const reread = await UserRepository.findById(user.id, tx);
        expect(reread?.lastActiveAt?.getTime()).toBe(now.getTime());
      });
    });
  });

  test("Tier 2 — a stamp fresher than the boundary is a zero-row miss (throttle folded into the WHERE)", async () => {
    await withFrozenClock(async now => {
      await runInRollback(async tx => {
        const staleBefore = new Date(now.getTime() - USER_ACTIVITY_COALESCE_WINDOW_MS);
        // Thirty seconds INSIDE the window: older than `now` (the monotonic
        // guard alone would pass) but fresher than `staleBefore` — only the
        // throttle conjunct can reject this write.
        const fresh = new Date(staleBefore.getTime() + 30_000);
        const user = await createTestUser(tx, { lastActiveAt: fresh });

        expect(await UserRepository.updateLastActiveAtIfStale(user.id, staleBefore, now, tx)).toBe(false);

        const reread = await UserRepository.findById(user.id, tx);
        expect(reread?.lastActiveAt?.getTime()).toBe(fresh.getTime());
      });
    });
  });

  test("Tier 2 — a stamp exactly at the boundary is a miss (strict <)", async () => {
    await withFrozenClock(async now => {
      await runInRollback(async tx => {
        const staleBefore = new Date(now.getTime() - USER_ACTIVITY_COALESCE_WINDOW_MS);
        const user = await createTestUser(tx, { lastActiveAt: staleBefore });

        expect(await UserRepository.updateLastActiveAtIfStale(user.id, staleBefore, now, tx)).toBe(false);

        const reread = await UserRepository.findById(user.id, tx);
        expect(reread?.lastActiveAt?.getTime()).toBe(staleBefore.getTime());
      });
    });
  });

  test("Tier 2 — an unknown id matches zero rows and returns false", async () => {
    await withFrozenClock(async now => {
      await runInRollback(async tx => {
        const staleBefore = new Date(now.getTime() - USER_ACTIVITY_COALESCE_WINDOW_MS);
        expect(await UserRepository.updateLastActiveAtIfStale(NONEXISTENT_USER_ID, staleBefore, now, tx)).toBe(false);
      });
    });
  });
});
