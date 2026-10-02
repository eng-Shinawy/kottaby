/**
 * UserRepository tests — the `users.locale` column surface plus the
 * credential-pair write (`updatePassword`) of the user repository.
 *
 * Per `backend/db/test/AGENTS.md` + `backend/db/test/logic/AGENTS.md`:
 *  - Write/transactional cases run inside `runInRollback`; `tx` is passed to
 *    EVERY repo call and direct Drizzle query (the non-tx `queryDb` fast path
 *    cannot see uncommitted rows of the rolled-back transaction).
 *  - The RAW-SQL read branch (`findByEmail` / `findById` / `findLocalesByIds`
 *    without `tx`) is exercised against a COMMITTED fixture created in
 *    `beforeAll` and hard-deleted in `afterAll` (Rule 9 — sanctioned for
 *    static fixture data). This is the branch the D2 trap lives on: the repo
 *    casts raw rows to `UserSelectType`, so a missing column in the explicit
 *    SELECT list would type-check while yielding `undefined` at runtime —
 *    these tests pin `locale` present on the wire.
 *  - Fixtures are created ONLY via `entity-setup.ts` (`createTestUser`) —
 *    never seed data, never the repository under test for setup.
 *
 * Coverage map:
 *  - Tier 1: updateLocale persists + returns the row (transactional branch);
 *    idempotent re-write; overwrite ar→en→ar; absent id → null.
 *  - Tier 1b: updatePassword persists the rotated hash + force-reset flag
 *    (both directions, idempotent re-write) and returns the FULL row
 *    (passwordHash included — the service layer strips it); absent id → null;
 *    optional `expectedCurrentHash` fence — matching hash writes, stale hash
 *    matches zero rows (null) and writes nothing (the self-service TOCTOU
 *    guard vs a concurrent admin rotation).
 *  - Tier 2: findLocalesByIds — mixed set (ar / en / unset / absent id) with
 *    every requested key present in the map; empty input → empty map, zero
 *    statements.
 *  - Tier 3 (raw-SQL branch, committed fixtures): findByEmail + findById +
 *    findLocalesByIds all surface `locale` for a user WITH a locale and
 *    `null` for a user WITHOUT one.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { eq, max } from "drizzle-orm";
import { db } from "@/backend/db";
import { UserRepository } from "@/backend/db/repo";
import { users } from "@/backend/db/schema/users/users";
import { createTestUser } from "@/backend/db/test/entity-setup";
import { runInRollback } from "@/backend/db/test/test-utils";
import type { DBTransaction, UserSelectType } from "@/backend/types";

/** Committed-fixture emails — unique per run so beforeAll never collides. */
const WITH_LOCALE_EMAIL = `locale-raw-${randomUUID()}@test.local`;
const WITHOUT_LOCALE_EMAIL = `locale-null-${randomUUID()}@test.local`;

/** Ids of the committed beforeAll fixtures (captured for afterAll cleanup). */
const committedFixtureIds: number[] = [];

/** Test bcrypt hash stub (never used for verification). */
const TEST_BCRYPT_STUB_HASH = "$2a$12$abcdefghijklmnopqrstuvABCDEFGHIJKLMNOPQRSTUV1234567890ABCDEFGHIJKLMNOPQRSTUV";

/** Rotated test bcrypt hash stub — distinct from the fixture default so a credential write is observable. */
const TEST_BCRYPT_STUB_HASH_ROTATED = "$2b$12$pqrstuvwxyzABCDEFghijklmnopqrstuvWXYZ0123456789abcdefghijklmnopqrstuv";

/**
 * Resolves an id above the identity maximum — no user row can carry it inside
 * the current transaction, making it the not-found probe for write paths.
 */
async function absentUserIdOf(tx: DBTransaction): Promise<number> {
  const [maxRow] = await tx.select({ maxId: max(users.id) }).from(users);
  return (maxRow?.maxId ?? 0) + 1_000_000;
}

/**
 * Inserts one committed user (with or without a locale) on the pool
 * connection — the sanctioned Rule-9 static-fixture path for exercising the
 * raw-SQL read branch.
 */
async function commitFixtureUser(email: string, locale: "ar" | "en" | null): Promise<void> {
  const created = await db.transaction(async (tx: DBTransaction) => {
    const [row] = await tx
      .insert(users)
      .values({
        fullName: `Locale Fixture ${randomUUID().slice(0, 8)}`,
        email,
        phone: "+10000000000",
        passwordHash: TEST_BCRYPT_STUB_HASH,
        role: "student",
        isDeleted: false,
        suspended: false,
        isBlocked: false,
        lastActiveAt: new Date(),
        ...(locale ? { locale } : {}),
      })
      .returning({ id: users.id });
    return row;
  });
  if (!created) {
    throw new Error(`commitFixtureUser: insert returned no rows for ${email}`);
  }
  committedFixtureIds.push(created.id);
}

beforeAll(async () => {
  await commitFixtureUser(WITH_LOCALE_EMAIL, "ar");
  await commitFixtureUser(WITHOUT_LOCALE_EMAIL, null);
});

afterAll(async () => {
  // Hard-delete ONLY the committed fixtures this file created (Rule 9).
  // Independent row deletes — parallel via Promise.all (no-await-in-loop).
  await Promise.all(committedFixtureIds.map(id => db.delete(users).where(eq(users.id, id))));
});

describe("UserRepository.updateLocale — transactional write branch", () => {
  test("persists the locale and returns the updated row", async () => {
    await runInRollback(async tx => {
      const user = await createTestUser(tx);
      const updated = await UserRepository.updateLocale(user.id, "ar", tx);
      if (!updated) throw new Error("expected the updated row");

      expect(updated.id).toBe(user.id);
      expect(updated.locale).toBe("ar");
      // Repo-level rows carry passwordHash (service strips it) — pin that
      // the returned row is the full DB row.
      expect(updated.passwordHash).toBe(user.passwordHash);

      // The write is visible to the sibling read on the SAME transaction.
      const reread = await UserRepository.findById(user.id, tx);
      expect(reread?.locale).toBe("ar");
    });
  });

  test("overwrites ar → en and is idempotent on re-write", async () => {
    await runInRollback(async tx => {
      const user = await createTestUser(tx);
      const first = await UserRepository.updateLocale(user.id, "ar", tx);
      const second = await UserRepository.updateLocale(user.id, "en", tx);
      const third = await UserRepository.updateLocale(user.id, "en", tx);

      expect(first?.locale).toBe("ar");
      expect(second?.locale).toBe("en");
      // Re-writing the same value matches the row again (no error, no drift).
      expect(third?.locale).toBe("en");
      expect(third?.id).toBe(user.id);
      const reread = await UserRepository.findById(user.id, tx);
      expect(reread?.locale).toBe("en");
    });
  });

  test("returns null for an id that matches no user", async () => {
    await runInRollback(async tx => {
      // Any id above the identity maximum cannot exist during this transaction.
      const [maxRow] = await tx.select({ maxId: max(users.id) }).from(users);
      const absentId = (maxRow?.maxId ?? 0) + 1_000_000;

      const updated = await UserRepository.updateLocale(absentId, "en", tx);
      expect(updated).toBeNull();
    });
  });

  test("re-stamps updated_at on the write ($onUpdate hook)", async () => {
    await runInRollback(async tx => {
      const user = await createTestUser(tx);
      const updated = await UserRepository.updateLocale(user.id, "en", tx);
      if (!updated) throw new Error("expected the updated row");

      // `updated_at` is $onUpdate-stamped — never older than the row the
      // fixture insert produced (tolerant >= comparison; equal timestamps are
      // legal when both happen within the same millisecond).
      expect(updated.updatedAt.getTime()).toBeGreaterThanOrEqual(user.updatedAt.getTime());
    });
  });
});

describe("UserRepository.updatePassword — transactional write branch", () => {
  test("persists the new hash + flag and returns the full updated row", async () => {
    await runInRollback(async tx => {
      const user = await createTestUser(tx);
      const updated = await UserRepository.updatePassword(user.id, TEST_BCRYPT_STUB_HASH_ROTATED, true, tx);
      if (!updated) throw new Error("expected the updated row");

      expect(updated.id).toBe(user.id);
      expect(updated.passwordHash).toBe(TEST_BCRYPT_STUB_HASH_ROTATED);
      expect(updated.mustChangePassword).toBe(true);
      // Repo-level rows carry passwordHash (service strips it) — pin that
      // the returned row is the full DB row, not a safe projection.
      expect(updated.passwordHash).not.toBe(user.passwordHash);

      // The write is visible to the sibling read on the SAME transaction.
      const reread = await UserRepository.findById(user.id, tx);
      expect(reread?.passwordHash).toBe(TEST_BCRYPT_STUB_HASH_ROTATED);
      expect(reread?.mustChangePassword).toBe(true);
    });
  });

  test("persists the flag in both directions and is idempotent on re-write", async () => {
    await runInRollback(async tx => {
      const user = await createTestUser(tx);
      const flagged = await UserRepository.updatePassword(user.id, TEST_BCRYPT_STUB_HASH_ROTATED, true, tx);
      const cleared = await UserRepository.updatePassword(user.id, TEST_BCRYPT_STUB_HASH_ROTATED, false, tx);
      const again = await UserRepository.updatePassword(user.id, TEST_BCRYPT_STUB_HASH_ROTATED, false, tx);

      expect(flagged?.mustChangePassword).toBe(true);
      // The second call flips the flag true → false (the self-service path).
      expect(cleared?.mustChangePassword).toBe(false);
      // Re-writing the same flag matches the row again (no error, no drift).
      expect(again?.mustChangePassword).toBe(false);
      expect(again?.id).toBe(user.id);
      const reread = await UserRepository.findById(user.id, tx);
      expect(reread?.mustChangePassword).toBe(false);
    });
  });

  test("returns null for an id that matches no user", async () => {
    await runInRollback(async tx => {
      const absentId = await absentUserIdOf(tx);
      const updated = await UserRepository.updatePassword(absentId, TEST_BCRYPT_STUB_HASH_ROTATED, true, tx);
      expect(updated).toBeNull();
    });
  });

  test("fenced write succeeds when the expected current hash matches (fence re-arms to the rotated hash)", async () => {
    await runInRollback(async tx => {
      const user = await createTestUser(tx);

      // The observed hash is still the stored one — the guarded UPDATE
      // (`WHERE id = ? AND password_hash = ?`) matches and returns the FULL
      // updated row.
      const updated = await UserRepository.updatePassword(
        user.id,
        TEST_BCRYPT_STUB_HASH_ROTATED,
        false,
        tx,
        user.passwordHash
      );
      if (!updated) throw new Error("expected the fenced write to match");
      expect(updated.id).toBe(user.id);
      expect(updated.passwordHash).toBe(TEST_BCRYPT_STUB_HASH_ROTATED);
      expect(updated.mustChangePassword).toBe(false);

      // The fence re-arms: the NEXT conditional write must now expect the
      // ROTATED hash (the old one no longer matches), and it succeeds too.
      const again = await UserRepository.updatePassword(
        user.id,
        TEST_BCRYPT_STUB_HASH,
        true,
        tx,
        TEST_BCRYPT_STUB_HASH_ROTATED
      );
      if (!again) throw new Error("expected the re-armed fenced write to match");
      expect(again.passwordHash).toBe(TEST_BCRYPT_STUB_HASH);
      expect(again.mustChangePassword).toBe(true);
    });
  });

  test("fenced write with a STALE expected hash returns null and writes nothing", async () => {
    await runInRollback(async tx => {
      const user = await createTestUser(tx);

      // A hash that cannot match the stored credential (the signature of a
      // concurrent rotation between the caller's read and the write):
      // zero rows match → null, the same miss signal as an absent id.
      const staleHash = "$2y$12$stalehashstalehashstalehashstalehashstalehashstalehashstaleha";
      expect(staleHash).not.toBe(user.passwordHash);
      const missed = await UserRepository.updatePassword(user.id, TEST_BCRYPT_STUB_HASH_ROTATED, false, tx, staleHash);
      expect(missed).toBeNull();

      // Zero writes: the stored credential + flag are byte-identical to the
      // fixture — the fenced miss rolled back before touching the row.
      const [row] = await tx
        .select({ passwordHash: users.passwordHash, flag: users.mustChangePassword })
        .from(users)
        .where(eq(users.id, user.id));
      expect(row?.passwordHash).toBe(user.passwordHash);
      expect(row?.flag).toBe(false);
    });
  });
});

describe("UserRepository.findLocalesByIds — transactional batch branch", () => {
  test("returns one entry per requested id: ar / en / unset / absent → null", async () => {
    await runInRollback(async tx => {
      const withAr = await createTestUser(tx);
      const withEn = await createTestUser(tx);
      const withoutLocale = await createTestUser(tx);
      await UserRepository.updateLocale(withAr.id, "ar", tx);
      await UserRepository.updateLocale(withEn.id, "en", tx);

      const [maxRow] = await tx.select({ maxId: users.id }).from(users);
      const absentId = (maxRow?.maxId ?? 0) + 1_000_000;

      const locales = await UserRepository.findLocalesByIds([withAr.id, withEn.id, withoutLocale.id, absentId], tx);

      // Exactly one entry per requested key — the pre-initialized map shape.
      expect(locales.size).toBe(4);
      expect(locales.get(withAr.id)).toBe("ar");
      expect(locales.get(withEn.id)).toBe("en");
      // Unset locale and absent user are BOTH null (emitter fallback applies).
      expect(locales.get(withoutLocale.id)).toBeNull();
      expect(locales.get(absentId)).toBeNull();
    });
  });

  test("empty input returns an EMPTY map without executing a statement", async () => {
    await runInRollback(async tx => {
      const locales = await UserRepository.findLocalesByIds([], tx);
      expect(locales.size).toBe(0);
    });
  });

  test("a nonexistent-only batch still answers every key with null", async () => {
    await runInRollback(async tx => {
      const [maxRow] = await tx.select({ maxId: users.id }).from(users);
      const absentA = (maxRow?.maxId ?? 0) + 1_000_001;
      const absentB = (maxRow?.maxId ?? 0) + 1_000_002;

      const locales = await UserRepository.findLocalesByIds([absentA, absentB], tx);
      expect(locales.size).toBe(2);
      expect(locales.get(absentA)).toBeNull();
      expect(locales.get(absentB)).toBeNull();
    });
  });
});

describe("UserRepository raw-SQL read branch — locale must ride the explicit SELECT list (D2 trap guard)", () => {
  test("findByEmail surfaces the committed locale ('ar')", async () => {
    const found: UserSelectType | null = await UserRepository.findByEmail(WITH_LOCALE_EMAIL);
    if (!found) throw new Error("expected the committed fixture user");
    expect(found.locale).toBe("ar");
  });

  test("findById surfaces the committed locale ('ar')", async () => {
    const byEmail = await UserRepository.findByEmail(WITH_LOCALE_EMAIL);
    if (!byEmail) throw new Error("expected the committed fixture user");
    const found = await UserRepository.findById(byEmail.id);
    if (!found) throw new Error("expected the committed fixture user by id");
    expect(found.locale).toBe("ar");
  });

  test("findByEmail + findById surface NULL for a user with no locale set", async () => {
    const byEmail = await UserRepository.findByEmail(WITHOUT_LOCALE_EMAIL);
    if (!byEmail) throw new Error("expected the committed locale-less fixture");
    expect(byEmail.locale).toBeNull();

    const byId = await UserRepository.findById(byEmail.id);
    if (!byId) throw new Error("expected the committed locale-less fixture by id");
    expect(byId.locale).toBeNull();
  });

  test("findLocalesByIds (no tx) surfaces the committed locales incl. null", async () => {
    const withLocale = await UserRepository.findByEmail(WITH_LOCALE_EMAIL);
    const withoutLocale = await UserRepository.findByEmail(WITHOUT_LOCALE_EMAIL);
    if (!withLocale || !withoutLocale) throw new Error("expected both committed fixtures");

    const locales = await UserRepository.findLocalesByIds([withLocale.id, withoutLocale.id]);
    expect(locales.size).toBe(2);
    expect(locales.get(withLocale.id)).toBe("ar");
    expect(locales.get(withoutLocale.id)).toBeNull();
  });
});
