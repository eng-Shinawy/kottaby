/**
 * StudentTrialService.grantFreeTrial tests — service-layer one-time trial grant
 * provisioning: delegates the atomic guarded UPDATE to the repository, logs
 * re-grant attempts as domain errors, and surfaces a localized ConflictError
 * when the grant-once marker is already set.
 *
 * Per `backend/db/test/AGENTS.md` (rules apply to the DB-backed assertions):
 *  - Every DB-backed case runs inside `runInRollback`; `tx` is propagated to
 *    EVERY repository / direct Drizzle query / entity-setup call.
 *  - Entities are created ONLY via `entity-setup.ts` helpers — never seed data.
 *  - Error assertions use `expectRepoError` (try/catch) —
 *    `expect(...).rejects.toThrow()` is prohibited inside `runInRollback`.
 *
 * Coverage map:
 *  - Tier 1 (happy + re-grant): fresh student → grantFreeTrial resolves
 *    silently, DB row shows `balanceTrial = FREE_TRIAL_SESSION_COUNT` and
 *    `trialGrantedAt IS NOT NULL`; second invocation → ConflictError, message
 *    contains the *translated* EN substring (NOT the raw key), balance remains
 *    exactly `1` (idempotent-grant invariant).
 *  - Tier 2 (locale parity + fallback): Arabic locale resolves the translated
 *    Arabic substring on re-grant; undefined locale falls back to the default
 *    locale (also documented).
 *  - Tier 3 (chaos — repo failure injected): `grantFreeTrialOnce` mocked to
 *    throw a non-grant error propagates WITHOUT ConflictError masking; no
 *    half-grant state is left behind (balance + marker untouched).
 *  - Tier 4 (logging contract): re-grant fires `logger.logDomainError` exactly
 *    once with structured context; happy path stays silent; the service file
 *    contains zero `console.*` calls.
 */

import { describe, expect, spyOn, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { StudentRepository } from "@/backend/db/repo";
import { students } from "@/backend/db/schema/students/students";
import { createTestParent, createTestStudent, createTestUser } from "@/backend/db/test/entity-setup";
import { expectRepoError, runInRollback } from "@/backend/db/test/test-utils";
import { ConflictError, DomainError } from "@/backend/lib/errors";
import { logger } from "@/backend/lib/logger";
import { StudentTrialService } from "@/backend/services/students/student-trial.service";
import type { DBTransaction } from "@/backend/types";
import { FREE_TRIAL_SESSION_COUNT } from "@/shared/constants/free-trial.constants";
import { getServerTranslations } from "@/shared/locale/server-graphql";

/**
 * The whole domain log spy family share this stubbed signature.
 */
type DomainLogSpy = ReturnType<typeof spyOn>;

/**
 * Installs a recording stub over `logger.logDomainError` so domain-rejection
 * logs never reach test stdout AND can be counted by the logging-contract
 * assertions.
 */
function silenceDomainLog(): DomainLogSpy {
  return spyOn(logger, "logDomainError").mockImplementation(() => {});
}

/**
 * Independent read-back oracle — direct Drizzle select on the same tx, NOT
 * routed through the service / repository under test. Returns the live
 * student row so the test can assert on DB-side state after the grant.
 */
async function readStudentRow(tx: DBTransaction, studentId: number) {
  const rows = await tx.select().from(students).where(eq(students.id, studentId));
  return rows[0] ?? null;
}

describe("StudentTrialService.grantFreeTrial", () => {
  // ─── Tier 1: branch/statement ───────────────────────────────────────

  test("happy path: grants trial credits to a fresh student and resolves silently with the row marked", async () => {
    await runInRollback(async tx => {
      const user = await createTestUser(tx);
      await createTestStudent(tx, user.id);

      await StudentTrialService.grantFreeTrial(user.id, "en", tx);

      const persisted = await readStudentRow(tx, user.id);
      expect(persisted).not.toBeNull();
      expect(persisted?.balanceTrial).toBe(FREE_TRIAL_SESSION_COUNT);
      expect(persisted?.trialGrantedAt).toBeInstanceOf(Date);
    });
  });

  test("re-grant: second invocation throws ConflictError carrying the TRANSLATED en substring and leaves balance exactly 1", async () => {
    await runInRollback(async tx => {
      const user = await createTestUser(tx);
      await createTestStudent(tx, user.id);

      // First grant succeeds (no throw) and seeds the marker.
      await StudentTrialService.grantFreeTrial(user.id, "en", tx);

      const error = await expectRepoError(() => StudentTrialService.grantFreeTrial(user.id, "en", tx));

      expect(error).toBeInstanceOf(ConflictError);
      expect(error).toBeInstanceOf(DomainError);
      // Translated substring — never the raw key.
      const expectedSubstring = getServerTranslations("en").errorsTranslations.trialAlreadyGranted;
      expect(error.message).toBe(expectedSubstring);
      // Belt-and-braces: a stable, language-independent phrase fragment.
      expect(error.message).toContain("free trial credit has already been granted");
      // Raw key must NOT leak through.
      expect(error.message).not.toContain("trialAlreadyGranted");

      // Idempotent-grant invariant: balance unchanged after the rejected
      // re-grant attempt — the second UPDATE matched zero rows because the
      // predicate `trial_granted_at IS NULL` evaluated false.
      const persisted = await readStudentRow(tx, user.id);
      expect(persisted?.balanceTrial).toBe(FREE_TRIAL_SESSION_COUNT);
      expect(persisted?.trialGrantedAt).toBeInstanceOf(Date);
    });
  });

  // ─── Tier 2: locale parity + fallback ───────────────────────────────

  test("Arabic locale: re-grant denial message carries the TRANSLATED Arabic substring", async () => {
    await runInRollback(async tx => {
      const user = await createTestUser(tx);
      await createTestStudent(tx, user.id);

      await StudentTrialService.grantFreeTrial(user.id, "ar", tx);

      const error = await expectRepoError(() => StudentTrialService.grantFreeTrial(user.id, "ar", tx));

      expect(error).toBeInstanceOf(ConflictError);
      const expectedArabic = getServerTranslations("ar").errorsTranslations.trialAlreadyGranted;
      expect(error.message).toBe(expectedArabic);
      // Language-distinct fragment — the Arabic translation begins with this
      // verb phrase; never a raw key.
      expect(error.message).toContain("تم منح رصيد الجلسة التجريبية");
      // Cross-locale byte-distinctness — the EN and AR messages differ.
      expect(error.message).not.toBe(getServerTranslations("en").errorsTranslations.trialAlreadyGranted);
    });
  });

  test("empty locale: server-graphql harness falls back to the default locale (ar) and resolves the Arabic message", async () => {
    await runInRollback(async tx => {
      const user = await createTestUser(tx);
      await createTestStudent(tx, user.id);

      await StudentTrialService.grantFreeTrial(user.id, "en", tx);

      // The server-graphql harness resolves any non-`AppLocale` string (empty,
      // unrecognized, etc.) to `defaultLocale = "ar"` via its `isAppLocale`
      // guard, so the localized rejection message comes out in Arabic. The
      // service signature stays `string` (production callers always pass a
      // validated locale); the harness is still contracted to fail safe.
      const error = await expectRepoError(() => StudentTrialService.grantFreeTrial(user.id, "", tx));

      expect(error).toBeInstanceOf(ConflictError);
      const expectedArabic = getServerTranslations("ar").errorsTranslations.trialAlreadyGranted;
      expect(error.message).toBe(expectedArabic);
      expect(error.message).toContain("تم منح رصيد الجلسة التجريبية");
    });
  });

  // ─── Tier 3: chaos — repo failure injected ──────────────────────────

  test("repo failure: a non-grant error from grantFreeTrialOnce propagates WITHOUT ConflictError masking and leaves no half-grant", async () => {
    await runInRollback(async tx => {
      const user = await createTestUser(tx);
      await createTestStudent(tx, user.id);

      // The connection-error stand-in: a raw Error (NOT a DomainError) —
      // production callers must observe the underlying failure surface
      // unchanged, never silently mapped to a ConflictError.
      const injected = new Error("simulated connection failure");
      const repoSpy = spyOn(StudentRepository, "grantFreeTrialOnce").mockRejectedValue(injected);

      try {
        const error = await expectRepoError(() => StudentTrialService.grantFreeTrial(user.id, "en", tx));

        // No wrapping: the propagated error is the exact instance thrown by
        // the repo, NOT a ConflictError.
        expect(error).toBe(injected);
        expect(error).not.toBeInstanceOf(ConflictError);
        expect(error).not.toBeInstanceOf(DomainError);
        expect(error.message).toBe("simulated connection failure");
      } finally {
        repoSpy.mockRestore();
      }

      // No half-grant: because the repo threw before any UPDATE reached the
      // row, the persisted balance + marker are untouched.
      const persisted = await readStudentRow(tx, user.id);
      expect(persisted?.balanceTrial).toBe(0);
      expect(persisted?.trialGrantedAt).toBeNull();
    });
  });

  // ─── Tier 4: logging contract + no-console grep ─────────────────────

  test("logging contract: re-grant fires logDomainError EXACTLY ONCE with structured context; happy path stays silent", async () => {
    await runInRollback(async tx => {
      const user = await createTestUser(tx);
      await createTestStudent(tx, user.id);

      const logSpy = silenceDomainLog();
      try {
        // Happy path: first grant MUST stay silent (silent-path prohibition).
        await StudentTrialService.grantFreeTrial(user.id, "en", tx);
        expect(logSpy).toHaveBeenCalledTimes(0);

        // Re-grant: domain rejection MUST log exactly once with the canonical
        // structured context (entity, id, attempt, code).
        await expectRepoError(() => StudentTrialService.grantFreeTrial(user.id, "en", tx));

        expect(logSpy).toHaveBeenCalledTimes(1);
        const [messageArg, ctxArg] = logSpy.mock.calls[0] ?? [];
        expect(messageArg).toBe("Trial grant rejected: already granted");
        expect(ctxArg).toMatchObject({
          code: "TRIAL_ALREADY_GRANTED",
          entity: "students",
          entityId: user.id,
          attempt: "1",
        });
      } finally {
        logSpy.mockRestore();
      }
    });
  });

  test("static contract: the service file contains zero console.* calls (logger-only discipline)", () => {
    const servicePath = join(process.cwd(), "backend", "services", "students", "student-trial.service.ts");
    const source = readFileSync(servicePath, "utf8");
    // Word-boundary anchored prefix match — catches `console.log(`,
    // `console.error(`, `console.warn(`, etc. without any quantifier that
    // could exhibit super-linear backtracking. The service file ships no
    // comment prose mentioning `console.*`, so a raw source scan is
    // sufficient — no comment stripping required.
    expect(source).not.toMatch(/\bconsole\./);
  });
});

/**
 * StudentTrialService.findTrialGrantStateByEmail tests — read-only grant-state
 * resolver used by idempotent bootstrap paths (the demo student seed factory)
 * to decide whether to invoke the grant. The method resolves a user by login
 * email, then reads the student row's `trialGrantedAt` marker.
 *
 * Coverage map:
 *  - Happy path (marker null): fresh student row → returns
 *    `{ studentId, trialGrantedAt: null }` (grant still pending).
 *  - After grant (marker set): post-grant row → returns
 *    `{ studentId, trialGrantedAt: <Date> }` (grant already applied; the seed
 *    bootstrap path MUST skip re-granting on this branch).
 *  - Nonexistent email: no matching user row → returns `null` (no throw —
 *    the method is total on the absent-user branch).
 *  - Non-student user: parent (or any non-student role) has no `students` row
 *    → returns `null` even though the user exists, so the seed never attempts
 *    to grant on a role that is structurally ineligible.
 */
describe("StudentTrialService.findTrialGrantStateByEmail", () => {
  test("happy path: fresh student resolves with studentId and a null trialGrantedAt marker (grant still pending)", async () => {
    await runInRollback(async tx => {
      const user = await createTestUser(tx);
      await createTestStudent(tx, user.id);

      const state = await StudentTrialService.findTrialGrantStateByEmail(user.email, tx);

      expect(state).not.toBeNull();
      expect(state?.studentId).toBe(user.id);
      expect(state?.trialGrantedAt).toBeNull();
    });
  });

  test("after grant: marker is non-null and matches the persisted trialGrantedAt (seed bootstrap must skip on this branch)", async () => {
    await runInRollback(async tx => {
      const user = await createTestUser(tx);
      await createTestStudent(tx, user.id);

      // Apply the grant first so the marker flips from null to a Date.
      await StudentTrialService.grantFreeTrial(user.id, "en", tx);

      const state = await StudentTrialService.findTrialGrantStateByEmail(user.email, tx);

      expect(state).not.toBeNull();
      expect(state?.studentId).toBe(user.id);
      expect(state?.trialGrantedAt).toBeInstanceOf(Date);

      // Cross-check: the marker surfaced by the service MUST equal the live
      // row state read directly on the same transaction.
      const persisted = await readStudentRow(tx, user.id);
      expect(persisted?.trialGrantedAt).toBeInstanceOf(Date);
      expect(state?.trialGrantedAt).toEqual(persisted?.trialGrantedAt);
    });
  });

  test("nonexistent email: resolves to null without throwing (no matching user row)", async () => {
    await runInRollback(async tx => {
      // Unique-by-construction email — never matches a seeded demo user.
      const nonexistent = `nonexistent-${Date.now()}@example.com`;

      const state = await StudentTrialService.findTrialGrantStateByEmail(nonexistent, tx);

      expect(state).toBeNull();
    });
  });

  test("non-student user (parent): resolves to null because no students row exists for the user", async () => {
    await runInRollback(async tx => {
      const parentUser = await createTestUser(tx, { role: "parent" });
      await createTestParent(tx, parentUser.id);

      const state = await StudentTrialService.findTrialGrantStateByEmail(parentUser.email, tx);

      // User exists, but there is no `students` row — the resolver returns
      // null so the seed never attempts a grant on a role-ineligible user.
      expect(state).toBeNull();
    });
  });
});
