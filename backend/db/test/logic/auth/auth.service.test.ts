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
 *    policy; the length-ceiling boundary — a replacement at the exact
 *    shared ceiling (1024 chars) passes the policy and rotates the hash,
 *    while a 1025-char replacement rejects with the localized
 *    `PASSWORD_TOO_LONG` field entry and zero writes (set-time and
 *    verify-time bounds share one source, so an accepted replacement can
 *    never exceed the login-side argument limit); AR-locale denial copy;
 *    the returned payload NEVER carries
 *    `passwordHash`.
 *  - Tier 6 (changeMyPassword, credential fence): a concurrent admin
 *    rotation (production no-outerTx path, committed Rule-9 fixture) has
 *    TWO legitimate orderings, both asserted precisely: the rotation
 *    committing before the fenced write → the SAME single
 *    `CURRENT_PASSWORD_INVALID` shape with zero self rows touched; the
 *    rotation committing after the fenced write → the self-change
 *    succeeds against the credential current at its write (the
 *    happy-path return contract). Either way the admin's rotation
 *    survives as the final credential state byte-identical — a STALE
 *    self-change never clobbers it (the TOCTOU fence).
 *  - Tier 7 (changeMyPassword, mid-flight soft-delete): a governance
 *    deletion committing INSIDE the proof window — after the identity
 *    read, before the fenced write, exactly the interleaving the
 *    pre-compare fold cannot see (production no-outerTx path, committed
 *    Rule-9 fixture; `setDeletedOnce` never touches `password_hash`) —
 *    is denied by the in-transaction deleted-row guard with the SAME
 *    single `CURRENT_PASSWORD_INVALID` shape; the dead row is untouched
 *    (hash byte-identical, pending flag intact, zero audit rows).
 *  - Tier 8 (login, activity-stamp seam): login on a committed Rule-9
 *    fixture issues the fire-and-forget activity stamp through the
 *    `UserRepository.updateLastActiveAt(id, now)` primitive — the
 *    optional-executor form (no tx argument → the no-tx pool branch) —
 *    and a REJECTED stamp never fails login: the rejection is swallowed
 *    + logged via `logger.logDomainError` (`LOGIN_LAST_ACTIVE_UPDATE_FAILED`,
 *    the error NAME only — never the full error). A source-scan pin
 *    asserts the raw-db private touch helper is fully gone from the
 *    service file (zero occurrences, no raw `db.update` seam, the stamp
 *    flows through the repo primitive).
 *  - Tier 9 (recordMyActivity, heartbeat stamp): the service composes the
 *    stamp through the repo primitive INSIDE its own transaction — the spy
 *    receives (userId, Date within the test window, a DEFINED tx executor
 *    — the in-tx form, unlike login's fire-and-forget no-tx bump) — and the
 *    field returns `true` (the primitive's boolean miss is a no-op, never a
 *    failure); a repo rejection propagates uncaught (no swallow — the
 *    GraphQL error finalizer owns the wire failure).
 *  - Tier 10 (refreshToken, governance arms — committed fixtures): a
 *    still-valid refresh token minted via the real login path BEFORE any
 *    governance flip is denied by the `assertUserActive` gate once the
 *    account is blocked, soft-deleted, or under an ACTIVE suspension —
 *    each arm `ForbiddenError(accountBlocked)` — while the SAME token
 *    still refreshes for an un-governed control user (the denial is
 *    governance-driven, not token-shape-driven). `refreshToken` resolves
 *    its identity through the bare pool and rotates on its own top-level
 *    transaction, so these arms run on committed fixtures provisioned in
 *    `beforeAll` and removed via `deleteUsersByIds` in `afterAll` — NOT
 *    inside `runInRollback` (the sanctioned committed-credential pattern
 *    used by the sibling user-governance auth-consumption block).
 *  - Tier 11 (login, exact-match identity lookup — the resolver-side trim
 *    is load-bearing): on a committed Rule-9 fixture, the EXACT stored
 *    email + the correct credential authenticate, while the SAME
 *    credential with a whitespace-padded email rejects with the generic
 *    localized `invalidCredentials` UnauthorizedError — the service's
 *    `findByEmail` lookup is exact-match, so the login resolver's trim
 *    (not a service-side trim) is what makes a pasted-padded email
 *    authenticatable. No oracle: both denial shapes share the single
 *    generic copy.
 */
import { afterAll, beforeAll, describe, expect, spyOn, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { and, eq, max, sql } from "drizzle-orm";
import { db } from "@/backend/db";
import { UserRepository } from "@/backend/db/repo";
import { AdminUserRepository } from "@/backend/db/repo/admin/admin-user.repository";
import { auditLogs } from "@/backend/db/schema/audit/audit-logs";
import { users } from "@/backend/db/schema/users/users";
import { createTestAdmin, createTestUser } from "@/backend/db/test/entity-setup";
import { type DBTransaction, expectRepoError, runInRollback } from "@/backend/db/test/test-utils";
import { comparePassword, hashPassword } from "@/backend/lib/auth/password";
import { ForbiddenError, UnauthorizedError, ValidationError } from "@/backend/lib/errors";
import { logger } from "@/backend/lib/logger";
import { AdminUserManagementService } from "@/backend/services/admin/user-management.service";
import { AuthService } from "@/backend/services/auth/auth.service";
import { RegistrationService } from "@/backend/services/auth/registration.service";
import type { ChangeMyPasswordSubmitInput } from "@/backend/types";
import { getServerTranslations } from "@/shared/locale/server-graphql";
// Deep import (NOT the `@/test/helpers` barrel) — the barrel pulls the
// Apollo test client into a backend-suite module graph; the db-cleanup
// module itself only needs drizzle + the db handle.
import { countUsersByIds, deleteUsersByIds } from "@/test/helpers/db-cleanup";

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

  test("1025-char new password → PASSWORD_TOO_LONG (shared-policy ceiling; zero writes)", async () => {
    await runInRollback(async tx => {
      const user = await createCredentialedUser(tx);
      silenceDomainLog();

      const error = await expectRepoError(() =>
        AuthService.changeMyPassword(
          user.id,
          { currentPassword: FIXTURE_CURRENT_PASSWORD, newPassword: "b".repeat(1_025) },
          "en",
          tx
        )
      );

      expect(error).toBeInstanceOf(ValidationError);
      expect(error.message).toContain(EN_AUTH.passwordTooLong);
      const fields = asValidationError(error).fields;
      if (fields?.length !== 1) throw new Error("expected exactly one field entry");
      expect(fields[0].field).toBe("password");
      expect(fields[0].code).toBe("PASSWORD_TOO_LONG");

      // Zero writes: the stored hash still verifies the ORIGINAL credential.
      const [row] = await tx.select({ passwordHash: users.passwordHash }).from(users).where(eq(users.id, user.id));
      expect(await comparePassword(FIXTURE_CURRENT_PASSWORD, row?.passwordHash ?? "")).toBe(true);
      expect(await comparePassword("b".repeat(1_025), row?.passwordHash ?? "")).toBe(false);
    });
  });

  test("1024-char new password (the exact shared ceiling) passes the policy and rotates the hash", async () => {
    await runInRollback(async tx => {
      const user = await createCredentialedUser(tx);
      const ceilingCredential = "c".repeat(1_024);

      const result = await AuthService.changeMyPassword(
        user.id,
        { currentPassword: FIXTURE_CURRENT_PASSWORD, newPassword: ceilingCredential },
        "en",
        tx
      );

      // The flag clears and the new credential verifies (bcrypt truncates
      // at 72 bytes, so the full ceiling-length replacement round-trips).
      expect(result.mustChangePassword).toBe(false);
      const [row] = await tx.select({ passwordHash: users.passwordHash }).from(users).where(eq(users.id, user.id));
      expect(await comparePassword(ceilingCredential, row?.passwordHash ?? "")).toBe(true);
      expect(await comparePassword(FIXTURE_CURRENT_PASSWORD, row?.passwordHash ?? "")).toBe(false);
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

/**
 * Outcome-capture for the credential-fence leg: against a concurrent
 * admin rotation, `changeMyPassword` has TWO legitimate client contracts
 * (denial when the rotation commits before the fenced write — the compare
 * fails or the fenced `WHERE id AND password_hash = <observed>` matches
 * zero rows; success when the rotation commits after the fenced write),
 * so the test branches on the OBSERVED outcome with precise per-path
 * assertions instead of pinning one interleaving. The try/catch capture
 * extends the `expectRepoError` pattern to also carry the success payload
 * back — no `.rejects` assertion (deadlock discipline) and no retry loop.
 */
async function captureChangeMyPasswordOutcome(
  promise: Promise<Awaited<ReturnType<typeof AuthService.changeMyPassword>>>
): Promise<{
  denial: Error | null;
  success: Awaited<ReturnType<typeof AuthService.changeMyPassword>> | null;
}> {
  try {
    return { denial: null, success: await promise };
  } catch (error) {
    return { denial: error instanceof Error ? error : new Error(String(error)), success: null };
  }
}

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

  test("a concurrent admin rotation → denial if it beats the fenced write, success if it lands after — the admin's rotation survives as the final credential either way", async () => {
    silenceDomainLog();

    // Production shape: NO outerTx — bare pool identity read → bcrypt
    // compare (~250ms) → bcrypt hash (~250ms) → fenced write in a fresh
    // transaction. The concurrent rotation is dispatched right after the
    // service call; WHERE it commits is scheduler-dependent (bcryptjs's
    // chunked async work can delay the rotation's client-side dispatch
    // past the fenced write under event-loop/memory pressure), and BOTH
    // orderings are legitimate service behavior — the test asserts each
    // precisely instead of assuming one:
    //  - rotation commits before the fenced write → the compare fails
    //    (it landed before the identity read) or the fenced write matches
    //    zero rows → the SAME single CURRENT_PASSWORD_INVALID denial,
    //    zero self rows touched;
    //  - rotation commits after the fenced write → the self-change
    //    legitimately succeeded against the credential current at its
    //    write, and the rotation then supersedes it.
    const selfChangePromise = AuthService.changeMyPassword(
      fenceFixtureId,
      { currentPassword: FIXTURE_CURRENT_PASSWORD, newPassword: FIXTURE_NEW_PASSWORD },
      "en"
    );
    const rotationPromise = db
      .update(users)
      .set({ passwordHash: committedAdminRotationHash, mustChangePassword: true })
      .where(eq(users.id, fenceFixtureId));

    const outcome = await captureChangeMyPasswordOutcome(selfChangePromise);
    await rotationPromise;

    if (outcome.denial) {
      // The rotation beat the fenced write: the single denial shape —
      // ValidationError, the localized message, exactly one
      // `currentPassword` / `CURRENT_PASSWORD_INVALID` field entry.
      expect(outcome.denial).toBeInstanceOf(ValidationError);
      expect(outcome.denial.message).toContain(EN_ERRORS.currentPasswordInvalid);
      const fields = asValidationError(outcome.denial).fields;
      if (fields?.length !== 1) throw new Error("expected exactly one field entry");
      expect(fields[0].field).toBe("currentPassword");
      expect(fields[0].code).toBe("CURRENT_PASSWORD_INVALID");
    } else {
      // The rotation landed after the fenced write: the self-change
      // succeeded — the full happy-path return contract (the flag is
      // cleared in the payload, the hash is structurally absent, the
      // registration-contract metadata stays null).
      const result = outcome.success;
      if (!result) throw new Error("expected the success payload");
      expect(result.id).toBe(fenceFixtureId);
      expect(result.mustChangePassword).toBe(false);
      expect(Object.hasOwn(result, "passwordHash")).toBe(false);
      expect(result.preferredRecitation).toBeNull();
    }

    // BOTH orderings end in the admin's credential state: the concurrent
    // rotation's hash AND pending flag survive as the stored row — a
    // STALE self-change never clobbers them (a regression to the
    // unconditional write would, in the denial ordering).
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

/**
 * Rule-9 committed fixture for the login-stamp describe: `login` resolves
 * the identity through the GLOBAL `db` (`UserRepository.findByEmail` without
 * a tx — the production bare-pool read), which cannot observe an uncommitted
 * `runInRollback` row — so the fixture is committed in `beforeAll` and
 * hard-deleted in `afterAll` (the same sanctioned static-fixture pattern as
 * the sibling credential-fence describes above).
 */
let loginFixtureId = 0;

/** The committed fixture's email — the login credential's identity half. */
let loginFixtureEmail = "";

describe("AuthService.login — activity stamp (fire-and-forget repo seam)", () => {
  beforeAll(async () => {
    // Real bcrypt hash on the fixture credential so the login reaches the
    // token-issuing path through the genuine `comparePassword` seam.
    const created = await db.transaction(async (tx: DBTransaction) => {
      const storedHash = await hashPassword(FIXTURE_CURRENT_PASSWORD);
      return createTestUser(tx, { passwordHash: storedHash });
    });
    loginFixtureId = created.id;
    loginFixtureEmail = created.email;
  });

  afterAll(async () => {
    // Rule 9: hard-delete ONLY the committed fixture this describe created.
    await db.delete(users).where(eq(users.id, loginFixtureId));
  });

  test("login stamps through UserRepository.updateLastActiveAt(id, now) — the optional-executor form (no tx)", async () => {
    const stampSpy = spyOn(UserRepository, "updateLastActiveAt").mockResolvedValue(true);

    try {
      const session = await AuthService.login(loginFixtureEmail, FIXTURE_CURRENT_PASSWORD, "en");

      expect(session.user.id).toBe(loginFixtureId);
      expect(stampSpy).toHaveBeenCalledTimes(1);
      const [stampedId, stampedAt, stampedExecutor] = stampSpy.mock.calls[0] ?? [];
      expect(stampedId).toBe(loginFixtureId);
      expect(stampedAt).toBeInstanceOf(Date);
      // The fire-and-forget bump needs no transaction — the optional
      // executor stays undefined (the no-tx pool branch).
      expect(stampedExecutor).toBeUndefined();
    } finally {
      stampSpy.mockRestore();
    }
  });

  test("a rejected stamp never fails login — swallowed + logged via logDomainError", async () => {
    const domainLogSpy = silenceDomainLog();
    const stampSpy = spyOn(UserRepository, "updateLastActiveAt").mockRejectedValue(new Error("stamp seam down"));

    try {
      const session = await AuthService.login(loginFixtureEmail, FIXTURE_CURRENT_PASSWORD, "en");

      // Login succeeded — the stamp rejection must not propagate.
      expect(session.user.id).toBe(loginFixtureId);
      expect(stampSpy).toHaveBeenCalledTimes(1);

      // One macrotask turn drains the microtask the fire-and-forget
      // rejection queued before the swallow-and-log contract is asserted.
      await sleep(0);
      expect(domainLogSpy).toHaveBeenCalledWith(
        "Failed to update lastActiveAt on login",
        expect.objectContaining({
          code: "LOGIN_LAST_ACTIVE_UPDATE_FAILED",
          entity: "users",
          entityId: loginFixtureId,
          locale: "en",
          // Only the error NAME crosses the log boundary — never the
          // full error (DB internals stay out of the logs).
          errorName: "Error",
        })
      );
    } finally {
      stampSpy.mockRestore();
      domainLogSpy.mockRestore();
    }
  });
});

describe("AuthService.login — stamp consolidation dead-code sweep (source pin)", () => {
  test("the raw-db private touch helper is fully gone; the stamp flows through the repo primitive", () => {
    // Lexical source scan by design (the repo's static-assertion pin
    // style): the service file must carry ZERO occurrences of the deleted
    // raw-db helper and its raw `db.update` seam — the fire-and-forget
    // bump now delegates to the UserRepository primitive directly.
    const source = readFileSync(join(process.cwd(), "backend/services/auth/auth.service.ts"), "utf8");
    expect(source).not.toContain("touchLastActiveAt");
    expect(source).toContain("UserRepository.updateLastActiveAt(user.id, new Date())");
    expect(source).not.toContain("db.update(");
  });
});

/**
 * Probe id for the heartbeat describe — the repo seam is SPIED, so no row
 * is ever read or written and the id never reaches the database (a large
 * in-range integer, deliberately not a committed fixture).
 */
const HEARTBEAT_PROBE_ID = 4_242_424;

describe("AuthService.recordMyActivity — heartbeat stamp (one-tx repo seam)", () => {
  test("stamps through UserRepository.updateLastActiveAt(userId, now, tx) inside its own transaction and returns true", async () => {
    const stampSpy = spyOn(UserRepository, "updateLastActiveAt").mockResolvedValue(true);

    try {
      const windowStart = new Date();
      const result = await AuthService.recordMyActivity(HEARTBEAT_PROBE_ID);
      const windowEnd = new Date();

      // The wire contract is the plain success scalar — the primitive's
      // boolean miss (unknown id, already-fresh stamp) is a no-op, never a
      // failure.
      expect(result).toBe(true);

      expect(stampSpy).toHaveBeenCalledTimes(1);
      const [stampedId, stampedAt, stampedExecutor] = stampSpy.mock.calls[0] ?? [];
      expect(stampedId).toBe(HEARTBEAT_PROBE_ID);
      if (!(stampedAt instanceof Date)) throw new Error("expected a Date stamp instant");
      // ONE captured `now` — server-side, inside the call window.
      expect(stampedAt.getTime()).toBeGreaterThanOrEqual(windowStart.getTime());
      expect(stampedAt.getTime()).toBeLessThanOrEqual(windowEnd.getTime());
      // The DEFINED executor is the discriminator vs. login's
      // fire-and-forget bump (whose executor stays undefined): the
      // heartbeat composes the stamp INSIDE its own transaction.
      expect(stampedExecutor).toBeDefined();
    } finally {
      stampSpy.mockRestore();
    }
  });

  test("a repo failure propagates uncaught — the service adds no swallow (the error finalizer owns the wire failure)", async () => {
    const stampSpy = spyOn(UserRepository, "updateLastActiveAt").mockRejectedValue(new Error("stamp seam down"));

    try {
      const error = await expectRepoError(() => AuthService.recordMyActivity(HEARTBEAT_PROBE_ID));

      expect(stampSpy).toHaveBeenCalledTimes(1);
      expect(error.message).toContain("stamp seam down");
    } finally {
      stampSpy.mockRestore();
    }
  });
});

/**
 * Governance-arm fixtures for the refreshToken tier: `refreshToken` resolves
 * the caller through the bare pool (`UserRepository.findById`) and rotates the
 * pair inside its own top-level transaction, so it cannot observe an
 * uncommitted `runInRollback` row. The fixtures are therefore committed in
 * `beforeAll` and hard-deleted via `deleteUsersByIds` in `afterAll` — the
 * committed-credential pattern of the sibling user-governance
 * auth-consumption block. Each target is registered through the production
 * registration path (a REAL bcrypt credential) and its refresh token is
 * minted via the real `login` BEFORE the governance flips land, so the very
 * same token is provably still valid when governance denies it.
 */
interface RefreshGovernanceTarget {
  readonly id: number;
  readonly refreshToken: string;
}

interface RefreshGovernanceFixtures {
  readonly adminActorId: number;
  readonly control: RefreshGovernanceTarget;
  readonly blocked: RefreshGovernanceTarget;
  readonly deleted: RefreshGovernanceTarget;
  readonly suspended: RefreshGovernanceTarget;
}

let refreshGovernanceFixtures: RefreshGovernanceFixtures | null = null;
const refreshGovernanceFixtureIds: number[] = [];

/** Registers one governance target with a REAL credential on the supplied transaction. */
async function registerRefreshGovernanceTarget(
  tx: DBTransaction,
  fullName: string
): Promise<{ id: number; email: string }> {
  const email = `refresh-governance-${randomUUID()}@test.local`;
  const registered = await RegistrationService.registerUser(
    {
      fullName,
      email,
      phone: "+10000000000",
      password: FIXTURE_CURRENT_PASSWORD,
      country: "EG",
      role: "student",
    },
    "en",
    tx
  );
  return { id: registered.id, email: registered.email };
}

/** Logs a target in while its account is still active and keeps the minted refresh token. */
async function mintPreGovernanceRefreshToken(email: string): Promise<string> {
  const session = await AuthService.login(email, FIXTURE_CURRENT_PASSWORD, "en");
  return session.refreshToken;
}

describe("INV-U3: refreshToken denies a still-valid pre-block token with ForbiddenError(accountBlocked), plus deleted and active-suspension arms", () => {
  beforeAll(async () => {
    // Provisioning transaction (committed): the admin actor who will drive
    // the governance flips + the four registered targets.
    const provisioned = await db.transaction(async (tx: DBTransaction) => {
      const adminActor = await createTestUser(tx, { role: "admin" });
      await createTestAdmin(tx, adminActor.id);

      const control = await registerRefreshGovernanceTarget(tx, "Refresh Governance Control");
      const blocked = await registerRefreshGovernanceTarget(tx, "Refresh Governance Blocked");
      const deleted = await registerRefreshGovernanceTarget(tx, "Refresh Governance Deleted");
      const suspended = await registerRefreshGovernanceTarget(tx, "Refresh Governance Suspended");

      return { adminActorId: adminActor.id, control, blocked, deleted, suspended };
    });
    refreshGovernanceFixtureIds.push(
      provisioned.adminActorId,
      provisioned.control.id,
      provisioned.blocked.id,
      provisioned.deleted.id,
      provisioned.suspended.id
    );

    // Mint the pre-governance refresh tokens via the REAL login path while
    // every account is still active (independent calls — run concurrently).
    const [controlToken, blockedToken, deletedToken, suspendedToken] = await Promise.all([
      mintPreGovernanceRefreshToken(provisioned.control.email),
      mintPreGovernanceRefreshToken(provisioned.blocked.email),
      mintPreGovernanceRefreshToken(provisioned.deleted.email),
      mintPreGovernanceRefreshToken(provisioned.suspended.email),
    ]);

    // Governance transaction (committed): flip the three governed targets
    // through the real admin mutations — block, soft-delete, and an ACTIVE
    // 7-day suspension window.
    await db.transaction(async (tx: DBTransaction) => {
      await AdminUserManagementService.setUserBlocked(provisioned.blocked.id, true, provisioned.adminActorId, "en", tx);
      await AdminUserManagementService.setUserDeleted(provisioned.deleted.id, true, provisioned.adminActorId, "en", tx);
      await AdminUserManagementService.setUserSuspended(
        provisioned.suspended.id,
        true,
        7,
        provisioned.adminActorId,
        "en",
        tx
      );
    });

    refreshGovernanceFixtures = {
      adminActorId: provisioned.adminActorId,
      control: { id: provisioned.control.id, refreshToken: controlToken },
      blocked: { id: provisioned.blocked.id, refreshToken: blockedToken },
      deleted: { id: provisioned.deleted.id, refreshToken: deletedToken },
      suspended: { id: provisioned.suspended.id, refreshToken: suspendedToken },
    };
  });

  afterAll(async () => {
    if (refreshGovernanceFixtureIds.length === 0) return;
    const deleted = await deleteUsersByIds(refreshGovernanceFixtureIds);
    expect(deleted).toBe(refreshGovernanceFixtureIds.length);
    expect(await countUsersByIds(refreshGovernanceFixtureIds)).toBe(0);
  });

  test("control arm: the SAME still-valid token refreshes for the un-governed user (the denials are governance-driven)", async () => {
    const fixtures = refreshGovernanceFixtures;
    if (!fixtures) throw new Error("refresh governance fixtures not provisioned");

    const result = await AuthService.refreshToken(fixtures.control.refreshToken, "en");

    expect(result.accessToken).toBeTypeOf("string");
    expect(result.refreshToken).toBeTypeOf("string");
    expect(result.sessionId).toBeTypeOf("string");
  });

  test("blocked arm: ForbiddenError(accountBlocked) on the pre-block token", async () => {
    const fixtures = refreshGovernanceFixtures;
    if (!fixtures) throw new Error("refresh governance fixtures not provisioned");
    silenceDomainLog();

    const error = await expectRepoError(() => AuthService.refreshToken(fixtures.blocked.refreshToken, "en"));

    expect(error).toBeInstanceOf(ForbiddenError);
    expect(error.message).toContain(EN_AUTH.accountBlocked);
  });

  test("deleted arm: ForbiddenError(accountBlocked) on the pre-delete token", async () => {
    const fixtures = refreshGovernanceFixtures;
    if (!fixtures) throw new Error("refresh governance fixtures not provisioned");
    silenceDomainLog();

    const error = await expectRepoError(() => AuthService.refreshToken(fixtures.deleted.refreshToken, "en"));

    expect(error).toBeInstanceOf(ForbiddenError);
    expect(error.message).toContain(EN_AUTH.accountBlocked);
  });

  test("active-suspension arm: ForbiddenError(accountBlocked) on the pre-suspension token", async () => {
    const fixtures = refreshGovernanceFixtures;
    if (!fixtures) throw new Error("refresh governance fixtures not provisioned");
    silenceDomainLog();

    const error = await expectRepoError(() => AuthService.refreshToken(fixtures.suspended.refreshToken, "en"));

    expect(error).toBeInstanceOf(ForbiddenError);
    expect(error.message).toContain(EN_AUTH.accountBlocked);
  });
});

/**
 * Rule-9 committed fixture for the exact-match identity tier: `login`
 * resolves the identity through the bare pool (`UserRepository.findByEmail`
 * without a tx — an exact-match lookup), which cannot observe an uncommitted
 * `runInRollback` row — so the fixture is committed in `beforeAll` and
 * hard-deleted in `afterAll` (the same sanctioned static-fixture pattern as
 * the sibling login-stamp describe above).
 */
let exactMatchFixtureId = 0;

/** The committed fixture's email — the exact-match probe's identity half. */
let exactMatchFixtureEmail = "";

describe("AuthService.login — exact-match identity lookup (the resolver-side trim is load-bearing)", () => {
  beforeAll(async () => {
    const created = await db.transaction(async (tx: DBTransaction) => {
      const storedHash = await hashPassword(FIXTURE_CURRENT_PASSWORD);
      return createTestUser(tx, { passwordHash: storedHash });
    });
    exactMatchFixtureId = created.id;
    exactMatchFixtureEmail = created.email;
  });

  afterAll(async () => {
    // Rule 9: hard-delete ONLY the committed fixture this describe created.
    await db.delete(users).where(eq(users.id, exactMatchFixtureId));
  });

  test("the EXACT email authenticates; the whitespace-padded form of the SAME credential rejects invalid-credentials", async () => {
    // Control: the exact stored email + the correct credential → session.
    // (This is the shape the login resolver produces after its trim.)
    const session = await AuthService.login(exactMatchFixtureEmail, FIXTURE_CURRENT_PASSWORD, "en");
    expect(session.user.id).toBe(exactMatchFixtureId);

    // The SAME correct credential against a whitespace-padded email → the
    // generic localized invalid-credentials denial: the service's identity
    // lookup is exact-match (no service-side trim), so the resolver-side
    // trim is what makes a pasted-padded email authenticatable. The denial
    // is byte-identical to a wrong-password denial — no oracle.
    silenceDomainLog();
    const error = await expectRepoError(() =>
      AuthService.login(`  ${exactMatchFixtureEmail}  `, FIXTURE_CURRENT_PASSWORD, "en")
    );

    expect(error).toBeInstanceOf(UnauthorizedError);
    expect(error.message).toContain(EN_AUTH.invalidCredentials);
  });
});
