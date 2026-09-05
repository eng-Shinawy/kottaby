/**
 * AuthService.updateMyLocale tests — the service tier of the DEV3-010 D2
 * backend vertical (users.locale persistence).
 *
 * Per `backend/db/test/AGENTS.md` (same conventions as the sibling
 * `registration.service.test.ts`):
 *  - Every test runs inside `runInRollback` — passes `tx` to every repo call
 *    AND to the service (via the optional `outerTx` param) so the service
 *    runs inside a SAVEPOINT on the outer transaction.
 *  - Uses `expectRepoError` (try/catch) instead of `expect(...).rejects.toThrow()`
 *    (which deadlocks inside the rollback wrapper).
 *  - Creates its own test data via `entity-setup.ts` helpers — never queries
 *    pre-existing seed data.
 *  - Rejection assertions pin TRANSLATED substrings resolved through
 *    `getServerTranslations("en" | "ar").errorsTranslations` (the inbox-suite
 *    precedent) — never hardcoded English, never raw translation keys.
 *
 * Coverage map:
 *  - Tier 1: happy path persists the locale and returns the
 *    `RegistrationReturnType` shape (locale set, `passwordHash` structurally
 *    absent, `preferredRecitation` null); idempotent re-write.
 *  - Tier 2: invalid locale strings ("fr", "", case-mangled "AR") reject
 *    with the localized `invalidLocale` ValidationError — in BOTH request
 *    locales (en + ar copy).
 *  - Tier 3: a caller whose user row no longer exists rejects with the
 *    localized `unauthorized` UnauthorizedError (no existence oracle —
 *    mirrors `getMe`'s contract).
 *  - Tier 4 (security): the returned payload NEVER carries `passwordHash`.
 */
import { describe, expect, test } from "bun:test";
import { eq, max } from "drizzle-orm";
import { users } from "@/backend/db/schema/users/users";
import { createTestUser } from "@/backend/db/test/entity-setup";
import { expectRepoError, runInRollback } from "@/backend/db/test/test-utils";
import { UnauthorizedError, ValidationError } from "@/backend/lib/errors";
import { AuthService } from "@/backend/services/auth/auth.service";
import { getServerTranslations } from "@/shared/locale/server-graphql";

/** English translated error copy — assertions pin translated substrings. */
const EN_ERRORS = getServerTranslations("en").errorsTranslations;

/** Arabic translated error copy (localized-rejection tier). */
const AR_ERRORS = getServerTranslations("ar").errorsTranslations;

describe("AuthService.updateMyLocale — happy path", () => {
  test("persists the locale and returns the RegistrationReturnType shape", async () => {
    await runInRollback(async tx => {
      const user = await createTestUser(tx);
      const result = await AuthService.updateMyLocale(user.id, "ar", "en", tx);

      expect(result.id).toBe(user.id);
      expect(result.locale).toBe("ar");
      // The service-return contract: passwordHash structurally absent,
      // preferredRecitation null (only registration echoes it).
      expect(Object.hasOwn(result, "passwordHash")).toBe(false);
      expect(result.preferredRecitation).toBeNull();

      // Persisted on the SAME transaction (SAVEPOINT write, outer-tx read).
      const [row] = await tx.select({ locale: users.locale }).from(users).where(eq(users.id, user.id));
      expect(row?.locale).toBe("ar");
    });
  });

  test("overwrites en → ar and is idempotent on re-write", async () => {
    await runInRollback(async tx => {
      const user = await createTestUser(tx);
      const first = await AuthService.updateMyLocale(user.id, "en", "en", tx);
      const second = await AuthService.updateMyLocale(user.id, "ar", "en", tx);
      const third = await AuthService.updateMyLocale(user.id, "ar", "en", tx);

      expect(first.locale).toBe("en");
      expect(second.locale).toBe("ar");
      expect(third.locale).toBe("ar");
      expect(third.id).toBe(user.id);
    });
  });
});

describe("AuthService.updateMyLocale — invalid locale rejection (closed set)", () => {
  test('"fr" rejects with the localized invalidLocale ValidationError (en request locale)', async () => {
    await runInRollback(async tx => {
      const user = await createTestUser(tx);
      const error = await expectRepoError(() => AuthService.updateMyLocale(user.id, "fr", "en", tx));

      expect(error).toBeInstanceOf(ValidationError);
      expect(error.message).toContain(EN_ERRORS.invalidLocale);
      // Nothing was written.
      const [row] = await tx.select({ locale: users.locale }).from(users).where(eq(users.id, user.id));
      expect(row?.locale).toBeNull();
    });
  });

  test('"AR" (case-mangled) and "" reject too — the guard is exact-match', async () => {
    await runInRollback(async tx => {
      const user = await createTestUser(tx);
      const mangled = await expectRepoError(() => AuthService.updateMyLocale(user.id, "AR", "en", tx));
      const empty = await expectRepoError(() => AuthService.updateMyLocale(user.id, "", "en", tx));

      expect(mangled).toBeInstanceOf(ValidationError);
      expect(empty).toBeInstanceOf(ValidationError);
    });
  });

  test('"fr" rejects with the ARABIC invalidLocale copy under an ar request locale', async () => {
    await runInRollback(async tx => {
      const user = await createTestUser(tx);
      const error = await expectRepoError(() => AuthService.updateMyLocale(user.id, "fr", "ar", tx));

      expect(error).toBeInstanceOf(ValidationError);
      expect(error.message).toContain(AR_ERRORS.invalidLocale);
    });
  });
});

describe("AuthService.updateMyLocale — vanished-caller rejection", () => {
  test("an id matching no user rejects with the localized unauthorized error (no existence oracle)", async () => {
    await runInRollback(async tx => {
      const [maxRow] = await tx.select({ maxId: max(users.id) }).from(users);
      const absentId = (maxRow?.maxId ?? 0) + 1_000_000;

      const error = await expectRepoError(() => AuthService.updateMyLocale(absentId, "ar", "en", tx));

      expect(error).toBeInstanceOf(UnauthorizedError);
      expect(error.message).toContain(EN_ERRORS.unauthorized);
    });
  });
});
