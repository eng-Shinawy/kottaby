/**
 * AuthService tests — `updateMyLocale` (the users.locale persistence
 * vertical) + `changeMyPassword` (the self-service credential change).
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
 *  - Tier 1 (updateMyLocale): happy path persists the locale and returns the
 *    `RegistrationReturnType` shape (locale set, `passwordHash` structurally
 *    absent, `preferredRecitation` null); idempotent re-write.
 *  - Tier 2 (updateMyLocale): invalid locale strings ("fr", "", case-mangled
 *    "AR") reject with the localized `invalidLocale` ValidationError — in
 *    BOTH request locales (en + ar copy).
 *  - Tier 3 (updateMyLocale): a caller whose user row no longer exists
 *    rejects with the localized `unauthorized` UnauthorizedError (no
 *    existence oracle).
 *  - Tier 4 (updateMyLocale, security): the returned payload NEVER carries
 *    `passwordHash`.
 *  - Tier 5 (changeMyPassword): happy path verifies the current password via
 *    the constant-time `comparePassword` seam, rotates the stored hash, and
 *    clears the force-reset flag in the return AND the DB; wrong current →
 *    the single `CURRENT_PASSWORD_INVALID` field shape with ZERO writes;
 *    vanished id → the SAME shape (no existence oracle); soft-deleted
 *    caller → the SAME shape (governance folded into the one denial, zero
 *    writes — the dead row's credential is never rewritten); same-as-current
 *    → `NEW_PASSWORD_SAME_AS_CURRENT` (including the bcrypt 72-byte
 *    boundary look-alike: a replacement differing solely past the effective
 *    input limit still verifies against the stored hash, so the effective
 *    no-op guard must catch it — the temporary credential must never stay
 *    live after the flag clears); empty / whitespace-only / 7-char
 *    replacement → `PASSWORD_REQUIRED` / `PASSWORD_TOO_SHORT` via the shared
 *    policy; AR-locale denial copy; the returned payload NEVER carries
 *    `passwordHash`.
 *  - Tier 6 (changeMyPassword, credential fence): a concurrent admin
 *    rotation landing inside the current-password proof window (production
 *    no-outerTx path, committed Rule-9 fixture) is denied with the SAME
 *    single `CURRENT_PASSWORD_INVALID` shape and the admin's rotation
 *    survives byte-identical (zero self writes — no TOCTOU clobber).
 *  - Tier 7 (changeMyPassword, mid-flight soft-delete): a governance
 *    deletion committing INSIDE the proof window — after the identity
 *    read, before the fenced write, exactly the interleaving the
 *    pre-compare fold cannot see (production no-outerTx path, committed
 *    Rule-9 fixture; `setDeletedOnce` never touches `password_hash`) —
 *    is denied by the in-transaction deleted-row guard with the SAME
 *    single `CURRENT_PASSWORD_INVALID` shape; the dead row is untouched
 *    (hash byte-identical, pending flag intact, zero audit rows).
 */
import { afterAll, beforeAll, describe, expect, spyOn, test } from "bun:test";
import { and, eq, max, sql } from "drizzle-orm";
import { db } from "@/backend/db";
import { AdminUserRepository } from "@/backend/db/repo/admin/admin-user.repository";
import { auditLogs } from "@/backend/db/schema/audit/audit-logs";
import { users } from "@/backend/db/schema/users/users";
import { createTestUser } from "@/backend/db/test/entity-setup";
import { type DBTransaction, expectRepoError, runInRollback } from "@/backend/db/test/test-utils";
import { comparePassword, hashPassword } from "@/backend/lib/auth/password";
import { UnauthorizedError, ValidationError } from "@/backend/lib/errors";
import { logger } from "@/backend/lib/logger";
import { AuthService } from "@/backend/services/auth/auth.service";
import type { ChangeMyPasswordSubmitInput } from "@/backend/types";
import { getServerTranslations } from "@/shared/locale/server-graphql";

/** English translated error copy — assertions pin translated substrings. */
const EN_ERRORS = getServerTranslations("en").errorsTranslations;

/** Arabic translated error copy (localized-rejection tier). */
const AR_ERRORS = getServerTranslations("ar").errorsTranslations;

/** English translated auth copy — password-policy denial messages. */
const EN_AUTH = getServerTranslations("en").authTranslations;

/** Fixture credential — weak test-only plaintext, seeded as a REAL bcrypt hash. */
const FIXTURE_CURRENT_PASSWORD = "CurrentPass1";

/** Replacement credential for the happy path (≥ 8 chars, ≠ current). */
const FIXTURE_NEW_PASSWORD = "NewSecret99";

/** Silences `logger.logDomainError` so test stdout stays compact. */
function silenceDomainLog(): ReturnType<typeof spyOn> {
  return spyOn(logger, "logDomainError").mockImplementation(() => {});
}

/**
 * Type-guard: narrows a caught `Error` to `ValidationError` via a real
 * `instanceof` runtime check. The assertion-free alternative to casting —
 * throws when the runtime value is not a `ValidationError` so `.fields`
 * probes fail with a clear message instead of silently reading an
 * unrelated error.
 */
function asValidationError(error: Error): ValidationError {
  if (!(error instanceof ValidationError)) {
    throw new Error(
      `expected a ValidationError instance, got ${error.constructor?.name ?? "unknown"}: ${error.message}`
    );
  }
  return error;
}

/** Returns an integer id guaranteed absent from `users` this tx. */
async function absentUserIdOf(tx: DBTransaction): Promise<number> {
  const [row] = await tx.select({ maxId: max(users.id) }).from(users);
  return (row?.maxId ?? 0) + 1_000_000;
}

/**
 * Resolves after `ms` milliseconds — the deterministic interleaving priming
 * delay for the mid-flight-deletion race (the identity read completes in
 * single-digit ms; the delay parks the concurrent delete inside the ~500ms
 * bcrypt proof window).
 */
const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(() => resolve(), ms));

/**
 * Provisions the change-password fixture: a user row whose stored hash is a
 * REAL bcrypt hash of `FIXTURE_CURRENT_PASSWORD` (the entity-setup stub hash
 * cannot satisfy a bcrypt compare) carrying a pending force-reset flag — so
 * `changeMyPassword`'s current-password verification is exercised against a
 * genuine hash and the flag clearing is observable in both directions.
 */
async function createCredentialedUser(tx: DBTransaction, mustChangePassword = true) {
  const storedHash = await hashPassword(FIXTURE_CURRENT_PASSWORD);
  return createTestUser(tx, { passwordHash: storedHash, mustChangePassword });
}

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

describe("AuthService.changeMyPassword — happy path", () => {
  test("verifies the current password, rotates the hash, and clears the force-reset flag", async () => {
    await runInRollback(async tx => {
      const user = await createCredentialedUser(tx);
      const input: ChangeMyPasswordSubmitInput = {
        currentPassword: FIXTURE_CURRENT_PASSWORD,
        newPassword: FIXTURE_NEW_PASSWORD,
      };

      const result = await AuthService.changeMyPassword(user.id, input, "en", tx);

      // Return contract: the flag is cleared in the payload, the hash is
      // structurally absent, and the registration-contract metadata stays null.
      expect(result.id).toBe(user.id);
      expect(result.mustChangePassword).toBe(false);
      expect(Object.hasOwn(result, "passwordHash")).toBe(false);
      expect(result.preferredRecitation).toBeNull();

      // Persisted on the SAME transaction (SAVEPOINT write, outer-tx read):
      // the new hash verifies through the constant-time `comparePassword`
      // seam (the correct current authorizes, the old credential fails) and
      // the force-reset flag is cleared in the DB.
      const [row] = await tx.select().from(users).where(eq(users.id, user.id));
      if (!row) throw new Error("expected the user row to exist");
      expect(row.mustChangePassword).toBe(false);
      expect(await comparePassword(FIXTURE_NEW_PASSWORD, row.passwordHash)).toBe(true);
      expect(await comparePassword(FIXTURE_CURRENT_PASSWORD, row.passwordHash)).toBe(false);
    });
  });
});

describe("AuthService.changeMyPassword — denials", () => {
  test("wrong current password → CURRENT_PASSWORD_INVALID with the field payload; zero writes", async () => {
    await runInRollback(async tx => {
      const user = await createCredentialedUser(tx);
      const storedHash = user.passwordHash;
      silenceDomainLog();

      const error = await expectRepoError(() =>
        AuthService.changeMyPassword(
          user.id,
          { currentPassword: "WrongPass9!", newPassword: FIXTURE_NEW_PASSWORD },
          "en",
          tx
        )
      );

      expect(error).toBeInstanceOf(ValidationError);
      expect(error.message).toContain(EN_ERRORS.currentPasswordInvalid);
      const fields = asValidationError(error).fields;
      if (fields?.length !== 1) throw new Error("expected exactly one field entry");
      expect(fields[0].field).toBe("currentPassword");
      expect(fields[0].code).toBe("CURRENT_PASSWORD_INVALID");

      // Zero writes: the stored hash + flag are byte-identical to the fixture.
      const [row] = await tx
        .select({ passwordHash: users.passwordHash, flag: users.mustChangePassword })
        .from(users)
        .where(eq(users.id, user.id));
      expect(row?.passwordHash).toBe(storedHash);
      expect(row?.flag).toBe(true);
    });
  });

  test("soft-deleted caller → the SAME CURRENT_PASSWORD_INVALID shape; zero writes (hash + flag unchanged)", async () => {
    await runInRollback(async tx => {
      const user = await createCredentialedUser(tx);
      // Governance state: the principal is soft-deleted while the session is
      // still live (the admin soft-delete landed post-login). The CORRECT
      // current password is offered — the denial must therefore come from
      // the governance fold, not from a credential mismatch.
      await tx.update(users).set({ isDeleted: true, deletedAt: new Date() }).where(eq(users.id, user.id));
      const storedHash = user.passwordHash;
      silenceDomainLog();

      const error = await expectRepoError(() =>
        AuthService.changeMyPassword(
          user.id,
          { currentPassword: FIXTURE_CURRENT_PASSWORD, newPassword: FIXTURE_NEW_PASSWORD },
          "en",
          tx
        )
      );

      // The single denial shape — identical to the wrong-password case
      // (no governance oracle; identity is always the caller itself).
      expect(error).toBeInstanceOf(ValidationError);
      expect(error.message).toContain(EN_ERRORS.currentPasswordInvalid);
      const fields = asValidationError(error).fields;
      if (fields?.length !== 1) throw new Error("expected exactly one field entry");
      expect(fields[0].field).toBe("currentPassword");
      expect(fields[0].code).toBe("CURRENT_PASSWORD_INVALID");

      // Zero writes: the dead row's credential + pending flag are untouched
      // (a deleted user has no live credential to replace — same ground as
      // the admin path's deleted-target denial).
      const [row] = await tx
        .select({ passwordHash: users.passwordHash, flag: users.mustChangePassword })
        .from(users)
        .where(eq(users.id, user.id));
      expect(row?.passwordHash).toBe(storedHash);
      expect(row?.flag).toBe(true);
    });
  });

  test("vanished identity (id matching no user) → the SAME CURRENT_PASSWORD_INVALID shape (no existence oracle)", async () => {
    await runInRollback(async tx => {
      const absentId = await absentUserIdOf(tx);
      silenceDomainLog();

      const error = await expectRepoError(() =>
        AuthService.changeMyPassword(
          absentId,
          { currentPassword: FIXTURE_CURRENT_PASSWORD, newPassword: FIXTURE_NEW_PASSWORD },
          "en",
          tx
        )
      );

      expect(error).toBeInstanceOf(ValidationError);
      expect(error.message).toContain(EN_ERRORS.currentPasswordInvalid);
      const fields = asValidationError(error).fields;
      if (fields?.length !== 1) throw new Error("expected exactly one field entry");
      expect(fields[0].field).toBe("currentPassword");
      expect(fields[0].code).toBe("CURRENT_PASSWORD_INVALID");
    });
  });

  test("new === current → NEW_PASSWORD_SAME_AS_CURRENT; zero writes", async () => {
    await runInRollback(async tx => {
      const user = await createCredentialedUser(tx);
      silenceDomainLog();

      const error = await expectRepoError(() =>
        AuthService.changeMyPassword(
          user.id,
          { currentPassword: FIXTURE_CURRENT_PASSWORD, newPassword: FIXTURE_CURRENT_PASSWORD },
          "en",
          tx
        )
      );

      expect(error).toBeInstanceOf(ValidationError);
      expect(error.message).toContain(EN_ERRORS.newPasswordSameAsCurrent);
      const fields = asValidationError(error).fields;
      if (fields?.length !== 1) throw new Error("expected exactly one field entry");
      expect(fields[0].field).toBe("newPassword");
      expect(fields[0].code).toBe("NEW_PASSWORD_SAME_AS_CURRENT");

      // Zero writes: the flag is still pending and the stored hash still
      // verifies the current plaintext.
      const [row] = await tx
        .select({ passwordHash: users.passwordHash, flag: users.mustChangePassword })
        .from(users)
        .where(eq(users.id, user.id));
      expect(row?.flag).toBe(true);
      expect(await comparePassword(FIXTURE_CURRENT_PASSWORD, row?.passwordHash ?? "")).toBe(true);
    });
  });

  test("new differs from current only beyond bcrypt's 72-byte boundary → NEW_PASSWORD_SAME_AS_CURRENT; zero writes", async () => {
    await runInRollback(async tx => {
      // The temporary credential exceeds bcrypt's 72-byte effective-input
      // limit; the "replacement" shares its exact first 72 bytes and
      // diverges only beyond the boundary — plaintext inequality, but the
      // SAME live credential once hashed (bcrypt truncates input at 72
      // bytes). The effective no-op guard must reject it: releasing the
      // flag here would leave the temporary credential authenticating.
      const boundaryCurrent = "B".repeat(72) + "legacy-suffix";
      const lookalikeNew = "B".repeat(72) + "reset-suffix";
      const storedHash = await hashPassword(boundaryCurrent);
      const user = await createTestUser(tx, { passwordHash: storedHash, mustChangePassword: true });
      silenceDomainLog();

      const error = await expectRepoError(() =>
        AuthService.changeMyPassword(user.id, { currentPassword: boundaryCurrent, newPassword: lookalikeNew }, "en", tx)
      );

      expect(error).toBeInstanceOf(ValidationError);
      expect(error.message).toContain(EN_ERRORS.newPasswordSameAsCurrent);
      const fields = asValidationError(error).fields;
      if (fields?.length !== 1) throw new Error("expected exactly one field entry");
      expect(fields[0].field).toBe("newPassword");
      expect(fields[0].code).toBe("NEW_PASSWORD_SAME_AS_CURRENT");

      // Zero writes: the flag is still pending, the stored hash still
      // verifies the ORIGINAL temporary credential, and the look-alike
      // remains effectively identical to it (the pre-guard hole — it would
      // have authenticated had the flag been released).
      const [row] = await tx
        .select({ passwordHash: users.passwordHash, flag: users.mustChangePassword })
        .from(users)
        .where(eq(users.id, user.id));
      expect(row?.flag).toBe(true);
      expect(await comparePassword(boundaryCurrent, row?.passwordHash ?? "")).toBe(true);
      expect(await comparePassword(lookalikeNew, row?.passwordHash ?? "")).toBe(true);
    });
  });

  test("empty new password → PASSWORD_REQUIRED", async () => {
    await runInRollback(async tx => {
      const user = await createCredentialedUser(tx);
      silenceDomainLog();

      const error = await expectRepoError(() =>
        AuthService.changeMyPassword(user.id, { currentPassword: FIXTURE_CURRENT_PASSWORD, newPassword: "" }, "en", tx)
      );

      expect(error).toBeInstanceOf(ValidationError);
      expect(error.message).toContain(EN_AUTH.passwordRequired);
      const fields = asValidationError(error).fields;
      if (fields?.length !== 1) throw new Error("expected exactly one field entry");
      expect(fields[0].field).toBe("password");
      expect(fields[0].code).toBe("PASSWORD_REQUIRED");
    });
  });

  test("whitespace-only new password → PASSWORD_REQUIRED (shared-policy trim branch)", async () => {
    await runInRollback(async tx => {
      const user = await createCredentialedUser(tx);
      silenceDomainLog();

      const error = await expectRepoError(() =>
        AuthService.changeMyPassword(
          user.id,
          { currentPassword: FIXTURE_CURRENT_PASSWORD, newPassword: "   " },
          "en",
          tx
        )
      );

      expect(error).toBeInstanceOf(ValidationError);
      const fields = asValidationError(error).fields;
      if (fields?.length !== 1) throw new Error("expected exactly one field entry");
      expect(fields[0].code).toBe("PASSWORD_REQUIRED");
    });
  });

  test("7-char new password → PASSWORD_TOO_SHORT", async () => {
    await runInRollback(async tx => {
      const user = await createCredentialedUser(tx);
      silenceDomainLog();

      const error = await expectRepoError(() =>
        AuthService.changeMyPassword(
          user.id,
          { currentPassword: FIXTURE_CURRENT_PASSWORD, newPassword: "Passw0r" },
          "en",
          tx
        )
      );

      expect(error).toBeInstanceOf(ValidationError);
      expect(error.message).toContain(EN_AUTH.passwordTooShort);
      const fields = asValidationError(error).fields;
      if (fields?.length !== 1) throw new Error("expected exactly one field entry");
      expect(fields[0].field).toBe("password");
      expect(fields[0].code).toBe("PASSWORD_TOO_SHORT");

      // Zero writes: no hash of the rejected plaintext ever landed.
      const [row] = await tx.select({ passwordHash: users.passwordHash }).from(users).where(eq(users.id, user.id));
      expect(await comparePassword("Passw0r", row?.passwordHash ?? "")).toBe(false);
    });
  });

  test("wrong current password rejects with the ARABIC currentPasswordInvalid copy under an ar request locale", async () => {
    await runInRollback(async tx => {
      const user = await createCredentialedUser(tx);
      silenceDomainLog();

      const error = await expectRepoError(() =>
        AuthService.changeMyPassword(
          user.id,
          { currentPassword: "WrongPass9!", newPassword: FIXTURE_NEW_PASSWORD },
          "ar",
          tx
        )
      );

      expect(error).toBeInstanceOf(ValidationError);
      expect(error.message).toContain(AR_ERRORS.currentPasswordInvalid);
    });
  });
});

/**
 * Rule-9 committed fixture for the credential-fence describe: the fence
 * race runs on the PRODUCTION no-`outerTx` path (bare pool identity read →
 * fresh `db.transaction` write), which cannot observe an uncommitted
 * `runInRollback` row — so the fixture must be committed in `beforeAll` and
 * is hard-deleted in `afterAll` (the sanctioned static-fixture pattern of
 * the sibling user.repository.test.ts).
 */
let fenceFixtureId = 0;

/** The committed concurrent-rotation hash (resolved from the pre-computed promise). */
let committedAdminRotationHash = "";

/** The concurrent rotation's hash — a REAL bcrypt hash of a distinct secret (pre-computed). */
const ADMIN_ROTATED_HASH_PROMISE = hashPassword("AdminTemp99!");

describe("AuthService.changeMyPassword — credential fence (concurrent admin rotation)", () => {
  beforeAll(async () => {
    // Real bcrypt hashes on both sides: the fixture credential must verify
    // through `comparePassword`, and the concurrent rotation must present a
    // stored hash the fenced WHERE clause can observe as "no longer the
    // observed one".
    const adminRotatedHash = await ADMIN_ROTATED_HASH_PROMISE;
    const created = await db.transaction(async (tx: DBTransaction) => {
      const storedHash = await hashPassword(FIXTURE_CURRENT_PASSWORD);
      return createTestUser(tx, { passwordHash: storedHash, mustChangePassword: true });
    });
    fenceFixtureId = created.id;
    committedAdminRotationHash = adminRotatedHash;
  });

  afterAll(async () => {
    // Rule 9: hard-delete ONLY the committed fixture this describe created.
    await db.delete(users).where(eq(users.id, fenceFixtureId));
  });

  test("a concurrent admin rotation inside the proof window → the SAME CURRENT_PASSWORD_INVALID denial; the admin's write survives untouched", async () => {
    silenceDomainLog();

    // Production shape: NO outerTx — bare pool identity read → bcrypt
    // compare (~250ms) → bcrypt hash (~250ms) → fenced write in a fresh
    // transaction. The concurrent rotation is issued right after the
    // identity read is dispatched and commits deep inside that ~500ms
    // bcrypt proof window.
    const selfChange = AuthService.changeMyPassword(
      fenceFixtureId,
      { currentPassword: FIXTURE_CURRENT_PASSWORD, newPassword: FIXTURE_NEW_PASSWORD },
      "en"
    );
    await db
      .update(users)
      .set({ passwordHash: committedAdminRotationHash, mustChangePassword: true })
      .where(eq(users.id, fenceFixtureId));

    // Every interleaving produces the identical client contract: wherever
    // the rotation lands (before the identity read, during the compare, or
    // during the hash), the write either matches zero fenced rows or the
    // compare fails — the SAME single CURRENT_PASSWORD_INVALID denial
    // either way. That stage-indistinguishability IS the invariant.
    const error = await expectRepoError(() => selfChange);

    expect(error).toBeInstanceOf(ValidationError);
    expect(error.message).toContain(EN_ERRORS.currentPasswordInvalid);
    const fields = asValidationError(error).fields;
    if (fields?.length !== 1) throw new Error("expected exactly one field entry");
    expect(fields[0].field).toBe("currentPassword");
    expect(fields[0].code).toBe("CURRENT_PASSWORD_INVALID");

    // Zero self writes: the concurrent rotation's state survives
    // byte-identical — the temporary hash AND the pending flag. A
    // regression to the unconditional write would clobber both.
    const [row] = await db
      .select({ passwordHash: users.passwordHash, flag: users.mustChangePassword })
      .from(users)
      .where(eq(users.id, fenceFixtureId));
    expect(row?.passwordHash).toBe(committedAdminRotationHash);
    expect(row?.flag).toBe(true);
  });
});

/**
 * Rule-9 committed fixture for the mid-flight-deletion describe: the race
 * runs on the PRODUCTION no-`outerTx` path (bare pool identity read →
 * fresh `db.transaction` fenced write), which cannot observe an
 * uncommitted `runInRollback` row — so the fixture is committed in
 * `beforeAll` and hard-deleted in `afterAll` (the same sanctioned
 * static-fixture pattern as the sibling credential-fence describe above).
 */
let midFlightFixtureId = 0;

/** The committed fixture's real bcrypt hash — the byte-identity baseline. */
let committedFixtureHash = "";

describe("AuthService.changeMyPassword — mid-flight soft-delete (in-tx deleted-row guard)", () => {
  beforeAll(async () => {
    // Real bcrypt hash on the fixture credential so the proof window runs
    // at production cost (~250ms compare + ~250ms hash) and the CORRECT
    // current password is genuinely verified — the denial below can only
    // come from the governance fold, never a credential mismatch.
    committedFixtureHash = await hashPassword(FIXTURE_CURRENT_PASSWORD);
    const created = await db.transaction(async (tx: DBTransaction) =>
      createTestUser(tx, { passwordHash: committedFixtureHash, mustChangePassword: true })
    );
    midFlightFixtureId = created.id;
  });

  afterAll(async () => {
    // Rule 9: hard-delete ONLY the committed fixture this describe created.
    await db.delete(users).where(eq(users.id, midFlightFixtureId));
  });

  test("a governance deletion committing inside the proof window → the SAME CURRENT_PASSWORD_INVALID denial; the dead row is untouched", async () => {
    silenceDomainLog();

    // Production shape: NO outerTx — the identity read + proof window run
    // on the bare pool and the fenced write opens a fresh transaction.
    // The soft delete is issued through the SAME governance seam the admin
    // path uses (`AdminUserRepository.setDeletedOnce` — a single guarded
    // UPDATE that commits ONLY is_deleted / deleted_at / updated_at and
    // never touches password_hash, so the fenced WHERE stays satisfied).
    // A 100ms priming delay parks the delete INSIDE the mid-flight window:
    // the identity read completes in single-digit ms (delete lands AFTER
    // it — the pre-compare fold cannot see this interleaving) while the
    // fenced write is ~500ms of bcrypt away (delete lands BEFORE it). This
    // is the deterministic technique of the sibling true-race fence test
    // (fast concurrent commit vs. the bcrypt-sized window), tightened by
    // the delay so the deleted-row-guard branch is exercised, not merely
    // possible.
    const selfChange = AuthService.changeMyPassword(
      midFlightFixtureId,
      { currentPassword: FIXTURE_CURRENT_PASSWORD, newPassword: FIXTURE_NEW_PASSWORD },
      "en"
    );
    await sleep(100);
    const deleted = await AdminUserRepository.setDeletedOnce(midFlightFixtureId, true);
    if (!deleted) throw new Error("fixture soft-delete unexpectedly matched zero rows");

    // The single denial shape — identical to the wrong-password and
    // steady-state deleted-caller cases (no governance oracle; a
    // mid-flight deletion is indistinguishable from a wrong password).
    const error = await expectRepoError(() => selfChange);

    expect(error).toBeInstanceOf(ValidationError);
    expect(error.message).toContain(EN_ERRORS.currentPasswordInvalid);
    const fields = asValidationError(error).fields;
    if (fields?.length !== 1) throw new Error("expected exactly one field entry");
    expect(fields[0].field).toBe("currentPassword");
    expect(fields[0].code).toBe("CURRENT_PASSWORD_INVALID");

    // Zero writes: the dead row's credential + pending flag are byte-
    // identical to the committed fixture (the delete itself touched only
    // the governance columns — a regression to an unguarded write would
    // rewrite the hash and clear the flag on a principal with no live
    // credential to replace). The governance columns confirm the delete
    // genuinely committed inside the window.
    const [row] = await db
      .select({
        passwordHash: users.passwordHash,
        flag: users.mustChangePassword,
        isDeleted: users.isDeleted,
        deletedAt: users.deletedAt,
      })
      .from(users)
      .where(eq(users.id, midFlightFixtureId));
    expect(row?.passwordHash).toBe(committedFixtureHash);
    expect(row?.flag).toBe(true);
    expect(row?.isDeleted).toBe(true);
    expect(row?.deletedAt).not.toBeNull();

    // Zero audit rows: the self path is unaudited by design — the denial
    // must not have introduced one (same zero-write-on-denial ground as
    // the sibling admin-path tests pin).
    const [auditCount] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(auditLogs)
      .where(and(eq(auditLogs.entityType, "user"), eq(auditLogs.entityId, midFlightFixtureId)));
    expect(auditCount?.count).toBe(0);
  });
});
