/**
 * ApplicantLifecycleService tests — profile shaping,
 * cooldown guard, and the re-application contract against the live
 * `kottab_test` PostgreSQL instance.
 *
 * Per `backend/db/test/AGENTS.md`:
 *  - 4-Tier mixed suite. Every case runs inside `runInRollback`; `tx` is
 *    passed to EVERY service/repo/entity-setup call. The "pure tier" is
 *    exercised through the real repository (mocked-repo tier rejected:
 *    `mock.module` pollutes the bun module registry shared by the parallel
 *    services runner's workers; DB-backed rows reach every branch
 *    deterministically).
 *  - Entities ONLY via `entity-setup.ts` helpers (randomized-UUID emails);
 *    corrupt/junk statuses are seeded via `createTestApplicant` overrides.
 *  - All rejection assertions use `expectRepoError` (try/catch) —
 *    `expect(...).rejects.toThrow()` is prohibited and appears nowhere.
 *  - Translated-message assertions use template anchors / formatter clones /
 *    translated literals computed in-file — NEVER raw keys, never hardcoded
 *    UI copy (each suite is self-contained).
 *
 * Coverage map:
 *  - Tier 1 (branch/stmt, full-branch coverage on new logic): profile null path +
 *    pending / in_evaluation / failed(active|expired|null) / passed shapes;
 *    guard allow / block / missing-row / already-certified; reapplication
 *    success / missing-row; cooldown-state derivation (null/future/past) at
 *    every arm; extension happy/expired-base/null-base/certified/missing
 *    arms; bounds rejection; the guarded-write miss arm; the post-write
 *    profile re-read fail-closed arm.
 *  - Tier 2 (boundary): cooldownUntil NULL ⇒ allowed; future ⇒ blocked with
 *    code APPLICANT_COOLDOWN_ACTIVE and message asserted against the
 *    TRANSLATED template (anchor prefix/suffix + formatted timestamp
 *    substring); EXACTLY now ⇒ ALLOWED (strict `>`); past ⇒
 *    allowed; missing applicant ⇒ APPLICANT_NOT_FOUND; extension lengths 1
 *    and 3650 accepted, 0 / 3651 / negative rejected.
 *  - Tier 3 (chaos/concurrency): stored status junk ("hacked", "%", RTL)
 *    fail closed with APPLICANT_STATUS_CORRUPT; rapid repeated guard calls
 *    deterministic across a captured-now boundary; concurrent
 *    recordReapplication ×2 via Promise.allSettled ⇒ attempts = 2;
 *    concurrent admin-extension vs rubric-finalize and vs certification
 *    (Promise.allSettled — guarded predicates compose / the typed conflict
 *    surfaces, no partial writes); audit-insert failure rolls the extension
 *    write back with it.
 *  - Tier 4 (security/i18n): identity only via the userId argument
 *    (signatures expose no other channel — by-construction note +
 *    runtime cross-subject leak probe); error messages carry no foreign-user
 *    data; localized denials resolve distinctly in BOTH "ar" and "en";
 *    the domain-rejection logging contract is verified via a logDomainError
 *    spy, and happy-path silence is verified as ZERO log calls; the admin
 *    extension attributes the audit row to the actor identity passed in
 *    (the resolver's session user id — never a client field) and provably
 *    leaves the account row's governance flags untouched (two-source
 *    split — read back via a direct test query, never via the service);
 *    the admin evaluation-override block covers all three directions —
 *    certify (cold insert certified / elevate preserving the evaluator
 *    flag / terminal / missing-row), reject (demote + guarded flip +
 *    stamped cooldown / best-effort no-op demote / non-passed deny /
 *    bounds deny), grant re-evaluation (guarded clearance / no-cooldown
 *    deny / terminal deny), the non-admin BFLA denial with zero writes,
 *    and the bilingual denial surface.
 */

import { describe, expect, spyOn, test } from "bun:test";
import { and, eq, sql } from "drizzle-orm";
import { ApplicantRepository } from "@/backend/db/repo";
import { auditLogs } from "@/backend/db/schema/audit/audit-logs";
import { notifications } from "@/backend/db/schema/notifications/notifications";
import { applicants } from "@/backend/db/schema/teachers/applicants";
import { teacher } from "@/backend/db/schema/teachers/teacher";
import { users } from "@/backend/db/schema/users/users";
import { createTestApplicant, createTestTeacherRow, createTestUser } from "@/backend/db/test/entity-setup";
import { expectRepoError, runInRollback } from "@/backend/db/test/test-utils";
import { AuditActionType } from "@/backend/enum/audit/audit-action-type.enum";
import { NotificationType } from "@/backend/enum/notifications/notification-type.enum";
import { ApplicantCooldownState } from "@/backend/enum/teachers/applicant-cooldown-state.enum";
import { AdminApplicantOverrideAction } from "@/backend/enum/teachers/applicant-override-action.enum";
import { ApplicantStatus } from "@/backend/enum/teachers/applicant-status.enum";
import { DomainError, ForbiddenError, NotFoundError, ValidationError } from "@/backend/lib/errors";
import { logger } from "@/backend/lib/logger";
import { NotificationEngine } from "@/backend/services/notifications/notification-engine.service";
import {
  ApplicantLifecycleService,
  deriveCooldownState,
} from "@/backend/services/teachers/applicant-lifecycle.service";
import type { DBTransaction, UserSelectType } from "@/backend/types";
import { getServerTranslations } from "@/shared/locale/server-graphql";

/** The whole domain log spy family share this stubbed signature. */
type DomainLogSpy = ReturnType<typeof spyOn>;

const FUTURE_COOLDOWN_OFFSET_MS = 7 * 24 * 60 * 60 * 1000;
const PAST_COOLDOWN_OFFSET_MS = -7 * 24 * 60 * 60 * 1000;

/** Day-count → millisecond conversion for the extension length math (byte-parity with the service's module-private constant). */
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Byte-parity clone of the service module's deterministic UTC formatter
 * options (both suites stay self-contained). Because the
 * fixed option set matches exactly, this renders any given instant to the
 * identical string the service interpolates into `{cooldownUntil}`.
 */
function formatCooldownExpectation(cooldownUntil: Date, locale: string): string {
  return new Intl.DateTimeFormat(locale === "en" ? "en" : "ar", {
    timeZone: "UTC",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(cooldownUntil);
}

/**
 * Returns the [prefix, suffix] anchors around the single ICU
 * `{cooldownUntil}` placeholder of the TRANSLATED cooldown template — used
 * to assert messages are fully translated without ever naming a raw key or
 * hardcoding copy.
 */
function cooldownTemplateAnchors(locale: string): readonly [string, string] {
  const parts = getServerTranslations(locale).errorsTranslations.applicantCooldownActive.split("{cooldownUntil}");
  // Single-placeholder contract is mechanically pinned by the locale parity suite.
  expect(parts).toHaveLength(2);
  const [prefix = "", suffix = ""] = parts;
  expect(prefix.length + suffix.length).toBeGreaterThan(0);
  return [prefix, suffix];
}

/**
 * Installs a recording stub over `logger.logDomainError` so domain-rejection
 * logs never reach test stdout AND can be counted by the logging-contract
 * assertions.
 */
function silenceDomainLog(): DomainLogSpy {
  return spyOn(logger, "logDomainError").mockImplementation(() => {});
}

/** Returns an integer id guaranteed absent as an applicants row this tx. */
async function absentApplicantId(tx: DBTransaction): Promise<number> {
  const [row] = await tx.select({ maxId: sql<number>`coalesce(max(${applicants.id}), 0)::int` }).from(applicants);
  return (row?.maxId ?? 0) + 1_000_000;
}

/** Independent read-back oracle — direct Drizzle select, not via the service. */
async function readApplicantRow(tx: DBTransaction, userId: number) {
  const rows = await tx.select().from(applicants).where(eq(applicants.id, userId));
  return rows[0] ?? null;
}

/** Reads the account row DIRECTLY (never via the service) for governance-flag probes. */
async function readUserRow(tx: DBTransaction, userId: number) {
  const rows = await tx.select().from(users).where(eq(users.id, userId));
  return rows[0] ?? null;
}

/**
 * Parses an audit `details` JSON payload defensively — a non-object payload
 * degrades to `null` instead of crashing an assertion.
 */
function isRecordObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseAuditDetails(raw: string | null): Record<string, unknown> | null {
  if (raw === null) {
    return null;
  }
  const parsed: unknown = JSON.parse(raw);
  return isRecordObject(parsed) ? parsed : null;
}

/** Reads the applicant's cooldown-extension audit history straight from the append-only table. */
async function readExtensionAuditRows(tx: DBTransaction, applicantId: number) {
  return tx
    .select()
    .from(auditLogs)
    .where(and(eq(auditLogs.entityType, "applicant"), eq(auditLogs.entityId, applicantId)));
}

/** Reads the applicant's outcome-notification rows straight from the table. */
async function readOutcomeNotificationRows(tx: DBTransaction, recipientId: number) {
  return tx
    .select()
    .from(notifications)
    .where(and(eq(notifications.userId, recipientId), eq(notifications.type, NotificationType.ApplicantOutcome)));
}

/** Asserts that a caught error carries a DomainError extensions.code value. */
function assertErrorCode(error: Error, expectedCode: string): void {
  expect(error).toBeInstanceOf(DomainError);
  if (!(error instanceof DomainError)) throw new Error("expected a DomainError instance");
  expect(error.code).toBe(expectedCode);
}

describe("ApplicantLifecycleService.getMyApplicantProfile", () => {
  // ─── Tier 1: branch/statement ───────────────────────────────────────

  test("returns null for a user without an applicants row (never-applied and certified share ONE null answer)", async () => {
    await runInRollback(async tx => {
      const userWithoutApplicant = await createTestUser(tx);
      const absentId = await absentApplicantId(tx);

      const forBareUser = await ApplicantLifecycleService.getMyApplicantProfile(userWithoutApplicant.id, "ar", tx);
      const forAbsentId = await ApplicantLifecycleService.getMyApplicantProfile(absentId, "ar", tx);

      expect(forBareUser).toBeNull();
      expect(forAbsentId).toBeNull();
    });
  });

  test("shapes the pending profile with correct server-computed booleans", async () => {
    await runInRollback(async tx => {
      const user = await createTestUser(tx);
      const seeded = await createTestApplicant(tx, user.id);

      const profile = await ApplicantLifecycleService.getMyApplicantProfile(user.id, "en", tx);

      expect(profile).not.toBeNull();
      if (!profile) throw new Error("expected shaped profile");
      // Closed-shape check — EXACTLY the canonical eight keys.
      expect(Object.keys(profile).toSorted((a, b) => a.localeCompare(b))).toEqual([
        "canPurchaseVerification",
        "cooldownActive",
        "cooldownState",
        "cooldownUntil",
        "id",
        "lastAttemptAt",
        "status",
        "verificationAttempts",
      ]);
      expect(profile.id).toBe(seeded.id);
      expect(seeded.status).toBe(ApplicantStatus.Pending);
      expect(profile.status).toBe(ApplicantStatus.Pending);
      expect(profile.verificationAttempts).toBe(0);
      expect(profile.lastAttemptAt).toBeNull();
      expect(profile.cooldownUntil).toBeNull();
      expect(profile.cooldownActive).toBe(false);
      expect(profile.canPurchaseVerification).toBe(true);
    });
  });

  test("shapes in_evaluation as purchasable", async () => {
    await runInRollback(async tx => {
      const user = await createTestUser(tx);
      await createTestApplicant(tx, user.id, { status: "in_evaluation" });

      const profile = await ApplicantLifecycleService.getMyApplicantProfile(user.id, "en", tx);

      expect(profile?.status).toBe(ApplicantStatus.InEvaluation);
      expect(profile?.cooldownActive).toBe(false);
      expect(profile?.canPurchaseVerification).toBe(true);
    });
  });

  test("failed with a FUTURE cooldown reports cooldownActive and blocks purchase", async () => {
    await runInRollback(async tx => {
      const user = await createTestUser(tx);
      const cooldownUntil = new Date(Date.now() + FUTURE_COOLDOWN_OFFSET_MS);
      await createTestApplicant(tx, user.id, { status: "failed", cooldownUntil });

      const profile = await ApplicantLifecycleService.getMyApplicantProfile(user.id, "en", tx);

      expect(profile?.status).toBe(ApplicantStatus.Failed);
      expect(profile?.cooldownActive).toBe(true);
      expect(profile?.canPurchaseVerification).toBe(false);
    });
  });

  test("failed with an EXPIRED cooldown reports eligible purchase (past)", async () => {
    await runInRollback(async tx => {
      const user = await createTestUser(tx);
      const cooldownUntil = new Date(Date.now() + PAST_COOLDOWN_OFFSET_MS);
      await createTestApplicant(tx, user.id, { status: "failed", cooldownUntil });

      const profile = await ApplicantLifecycleService.getMyApplicantProfile(user.id, "en", tx);

      expect(profile?.status).toBe(ApplicantStatus.Failed);
      expect(profile?.cooldownActive).toBe(false);
      expect(profile?.canPurchaseVerification).toBe(true);
    });
  });

  test("failed with a NULL cooldown is purchasable — null is never an active cooldown", async () => {
    await runInRollback(async tx => {
      const user = await createTestUser(tx);
      await createTestApplicant(tx, user.id, { status: "failed", cooldownUntil: null });

      const profile = await ApplicantLifecycleService.getMyApplicantProfile(user.id, "en", tx);

      expect(profile?.cooldownActive).toBe(false);
      expect(profile?.canPurchaseVerification).toBe(true);
    });
  });

  test("passed blocks purchase even with no cooldown present", async () => {
    await runInRollback(async tx => {
      const user = await createTestUser(tx);
      await createTestApplicant(tx, user.id, { status: "passed" });

      const profile = await ApplicantLifecycleService.getMyApplicantProfile(user.id, "en", tx);

      expect(profile?.status).toBe(ApplicantStatus.Passed);
      expect(profile?.cooldownActive).toBe(false);
      expect(profile?.canPurchaseVerification).toBe(false);
    });
  });

  // ─── Tier 3: chaos — corrupt stored statuses fail CLOSED ────────────

  test("corrupt ASCII-token status fails closed with APPLICANT_STATUS_CORRUPT", async () => {
    await runInRollback(async tx => {
      const user = await createTestUser(tx);
      await createTestApplicant(tx, user.id, { status: "hacked" });

      const error = await expectRepoError(() => ApplicantLifecycleService.getMyApplicantProfile(user.id, "en", tx));

      assertErrorCode(error, "APPLICANT_STATUS_CORRUPT");
    });
  });

  test("corrupt punctuation-only status fails closed", async () => {
    await runInRollback(async tx => {
      const user = await createTestUser(tx);
      await createTestApplicant(tx, user.id, { status: "%" });

      const error = await expectRepoError(() => ApplicantLifecycleService.getMyApplicantProfile(user.id, "ar", tx));

      assertErrorCode(error, "APPLICANT_STATUS_CORRUPT");
    });
  });

  test("corrupt RTL-string status fails closed", async () => {
    await runInRollback(async tx => {
      const user = await createTestUser(tx);
      await createTestApplicant(tx, user.id, { status: "مخترق" });

      const error = await expectRepoError(() => ApplicantLifecycleService.getMyApplicantProfile(user.id, "ar", tx));

      assertErrorCode(error, "APPLICANT_STATUS_CORRUPT");
    });
  });

  test("corrupt-status denial resolves localized and DISTINCTLY in both ar and en", async () => {
    await runInRollback(async tx => {
      const arUser = await createTestUser(tx);
      const enUser = await createTestUser(tx);
      await createTestApplicant(tx, arUser.id, { status: "hacked" });
      await createTestApplicant(tx, enUser.id, { status: "hacked" });

      const arError = await expectRepoError(() => ApplicantLifecycleService.getMyApplicantProfile(arUser.id, "ar", tx));
      const enError = await expectRepoError(() => ApplicantLifecycleService.getMyApplicantProfile(enUser.id, "en", tx));

      assertErrorCode(arError, "APPLICANT_STATUS_CORRUPT");
      assertErrorCode(enError, "APPLICANT_STATUS_CORRUPT");
      // Byte-equality with the TRANSLATED literals — never the key names.
      expect(arError.message).toBe(getServerTranslations("ar").errorsTranslations.applicantStatusCorrupt);
      expect(enError.message).toBe(getServerTranslations("en").errorsTranslations.applicantStatusCorrupt);
      expect(arError.message).not.toBe(enError.message);
    });
  });

  // ─── Tier 4: the whole function stays silent on the log ──────────────

  test("profile paths emit NOTHING to the domain log (null, shaped happy path, corrupt throw)", async () => {
    await runInRollback(async tx => {
      const pendingUser = await createTestUser(tx);
      const corruptUser = await createTestUser(tx);
      await createTestApplicant(tx, pendingUser.id, { status: "pending" });
      await createTestApplicant(tx, corruptUser.id, { status: "hacked" });
      const absentId = await absentApplicantId(tx);

      const logSpy = silenceDomainLog();
      try {
        expect(await ApplicantLifecycleService.getMyApplicantProfile(absentId, "ar", tx)).toBeNull();

        const shaped = await ApplicantLifecycleService.getMyApplicantProfile(pendingUser.id, "ar", tx);
        expect(shaped?.canPurchaseVerification).toBe(true);

        await expectRepoError(() => ApplicantLifecycleService.getMyApplicantProfile(corruptUser.id, "ar", tx));

        expect(logSpy).toHaveBeenCalledTimes(0);
      } finally {
        logSpy.mockRestore();
      }
    });
  });
});

describe("ApplicantLifecycleService.assertCanPurchaseVerification", () => {
  // ─── Tier 1: allow arm — silent no-op ──────────────────────────────

  test("resolves silently for an eligible failed applicant whose cooldown expired", async () => {
    await runInRollback(async tx => {
      const user = await createTestUser(tx);
      const expired = new Date(Date.now() + PAST_COOLDOWN_OFFSET_MS);
      await createTestApplicant(tx, user.id, { status: "failed", cooldownUntil: expired });

      const logSpy = silenceDomainLog();
      try {
        await ApplicantLifecycleService.assertCanPurchaseVerification(user.id, "ar", tx);
        expect(logSpy).toHaveBeenCalledTimes(0);
      } finally {
        logSpy.mockRestore();
      }
    });
  });

  // ─── Tier 2: boundaries around the strict `>` comparison ────────────

  test("allows when cooldownUntil is NULL", async () => {
    await runInRollback(async tx => {
      const user = await createTestUser(tx);
      await createTestApplicant(tx, user.id, { status: "pending", cooldownUntil: null });

      const allowed = await ApplicantLifecycleService.assertCanPurchaseVerification(user.id, "en", tx);

      // Void no-op contract + allow arm reached without any rejection.
      expect(allowed).toBeUndefined();
    });
  });

  test("ALLOWS when cooldown expires EXACTLY now (strict > comparator)", async () => {
    await runInRollback(async tx => {
      const user = await createTestUser(tx);
      // Seeded instant == wall clock captured immediately before the call;
      // the guard's own captured `now` lands at-or-after it, so strict `>`
      // must evaluate false ⇒ allowed (micro-clock is monotonic within one
      // statement sequence — no jump-backs occur between these awaits).
      await createTestApplicant(tx, user.id, { status: "failed", cooldownUntil: new Date() });

      const allowed = await ApplicantLifecycleService.assertCanPurchaseVerification(user.id, "en", tx);
      expect(allowed).toBeUndefined();
    });
  });

  test("blocks a FUTURE cooldown with APPLICANT_COOLDOWN_ACTIVE + fully-translated interpolated message", async () => {
    await runInRollback(async tx => {
      const user = await createTestUser(tx);
      const locale = "en";
      const cooldownUntil = new Date(Date.now() + FUTURE_COOLDOWN_OFFSET_MS);
      await createTestApplicant(tx, user.id, { status: "failed", cooldownUntil });

      const logSpy = silenceDomainLog();
      try {
        const error = await expectRepoError(() =>
          ApplicantLifecycleService.assertCanPurchaseVerification(user.id, locale, tx)
        );

        assertErrorCode(error, "APPLICANT_COOLDOWN_ACTIVE");
        expect(error).toBeInstanceOf(ValidationError);

        // Fully-translated assertion via template anchors + formatter clone —
        // never a raw key, never hardcoded copy.
        const [prefix, suffix] = cooldownTemplateAnchors(locale);
        const expectedStamp = formatCooldownExpectation(cooldownUntil, locale);
        expect(error.message.startsWith(prefix)).toBe(true);
        expect(error.message.endsWith(suffix)).toBe(true);
        expect(error.message.includes(expectedStamp)).toBe(true);
        expect(error.message.includes("{cooldownUntil}")).toBe(false);

        // This domain rejection WAS logged, with canonical context.
        expect(logSpy).toHaveBeenCalledTimes(1);
        const [, ctxArg] = logSpy.mock.calls[0] ?? [];
        expect(ctxArg).toMatchObject({
          code: "APPLICANT_COOLDOWN_ACTIVE",
          entity: "applicants",
          entityId: user.id,
          locale,
        });
      } finally {
        logSpy.mockRestore();
      }
    });
  });

  test("throws APPLICANT_NOT_FOUND (localized byte-equal) for a missing applicant row + logs once", async () => {
    await runInRollback(async tx => {
      const locale = "ar";
      const missingId = await absentApplicantId(tx);

      const logSpy = silenceDomainLog();
      try {
        const error = await expectRepoError(() =>
          ApplicantLifecycleService.assertCanPurchaseVerification(missingId, locale, tx)
        );

        expect(error).toBeInstanceOf(NotFoundError);
        assertErrorCode(error, "APPLICANT_NOT_FOUND");
        // No interpolation slot on this template — literal equality holds.
        expect(error.message).toBe(getServerTranslations(locale).errorsTranslations.applicantNotFound);

        expect(logSpy).toHaveBeenCalledTimes(1);
        const [, ctxArg] = logSpy.mock.calls[0] ?? [];
        expect(ctxArg).toMatchObject({
          code: "APPLICANT_NOT_FOUND",
          entity: "applicants",
          entityId: missingId,
          locale,
        });
      } finally {
        logSpy.mockRestore();
      }
    });
  });

  // ─── Tier 3: chaos — determinism across a captured-now boundary ─────

  test("rapid repeated guard calls are deterministic (12 parallel denies share one message; eligible storm all resolves)", async () => {
    await runInRollback(async tx => {
      const blockedUser = await createTestUser(tx);
      const eligibleUser = await createTestUser(tx);
      const future = new Date(Date.now() + FUTURE_COOLDOWN_OFFSET_MS);
      await createTestApplicant(tx, blockedUser.id, { status: "failed", cooldownUntil: future });
      await createTestApplicant(tx, eligibleUser.id, { status: "failed", cooldownUntil: null });

      const denyOutcomes = await Promise.allSettled(
        Array.from({ length: 12 }, () =>
          ApplicantLifecycleService.assertCanPurchaseVerification(blockedUser.id, "en", tx)
        )
      );
      const allowOutcomes = await Promise.allSettled(
        Array.from({ length: 12 }, () =>
          ApplicantLifecycleService.assertCanPurchaseVerification(eligibleUser.id, "en", tx)
        )
      );

      const deniedMessages = denyOutcomes.map(outcome => {
        if (outcome.status !== "rejected") throw new Error(`expected rejection, got ${outcome.status}`);
        const reason = outcome.reason;
        if (!(reason instanceof ValidationError)) throw new Error("expected a ValidationError denial");
        assertErrorCode(reason, "APPLICANT_COOLDOWN_ACTIVE");
        return reason.message;
      });
      expect(deniedMessages).toHaveLength(12);
      // Deterministic: identical locale+row ⇒ byte-identical messages, and
      // no `{cooldownUntil}` residue leaks through any of them.
      expect(new Set(deniedMessages).size).toBe(1);
      expect(deniedMessages[0]?.includes("{cooldownUntil}")).toBe(false);
      for (const outcome of allowOutcomes) {
        expect(outcome.status).toBe("fulfilled");
      }

      // A pure read+compute guard never mutated either row.
      expect((await readApplicantRow(tx, blockedUser.id))?.verificationAttempts).toBe(0);
      expect((await readApplicantRow(tx, eligibleUser.id))?.verificationAttempts).toBe(0);
    });
  });

  // ─── Tier 4: identity surface — userId arg is the ONLY channel ─────

  test("denial content discloses nothing about OTHER applicants (userId-arg identity probe)", async () => {
    await runInRollback(async tx => {
      // Distinct users, distinct secret-ish markers (randomized UUID emails).
      const userA = await createTestUser(tx);
      const userB = await createTestUser(tx);
      const futureA = new Date(Date.now() + FUTURE_COOLDOWN_OFFSET_MS);
      const futureB = new Date(Date.now() + 2 * FUTURE_COOLDOWN_OFFSET_MS);
      await createTestApplicant(tx, userA.id, { status: "failed", cooldownUntil: futureA });
      await createTestApplicant(tx, userB.id, { status: "failed", cooldownUntil: futureB });

      const errorA = await expectRepoError(() =>
        ApplicantLifecycleService.assertCanPurchaseVerification(userA.id, "en", tx)
      );
      const errorB = await expectRepoError(() =>
        ApplicantLifecycleService.assertCanPurchaseVerification(userB.id, "en", tx)
      );
      const markerA = extractEmailUniqueFragment(userA);
      const markerB = extractEmailUniqueFragment(userB);
      // Sanity — the leak probe below is only meaningful with real markers.
      expect(markerA.length).toBeGreaterThan(0);
      expect(markerB.length).toBeGreaterThan(0);
      expect(markerA).not.toBe(markerB);

      assertErrorCode(errorA, "APPLICANT_COOLDOWN_ACTIVE");
      assertErrorCode(errorB, "APPLICANT_COOLDOWN_ACTIVE");

      // Each subject's own id may appear in ITS server-side log context, but
      // NEITHER message embeds anyone else's identifiers or e-mail material.
      expect(errorA.message.includes(markerB)).toBe(false);
      expect(errorB.message.includes(markerA)).toBe(false);
      expect(errorA.message.includes("@test.local")).toBe(false);
      expect(errorB.message.includes("@test.local")).toBe(false);
    });
  });
});

describe("ApplicantLifecycleService.assertCanPurchaseVerification — certified rejection (APPLICANT_ALREADY_CERTIFIED)", () => {
  // ─── Tier 1: branch/statement ───────────────────────────────────────

  test("rejects a passed applicant with ValidationError APPLICANT_ALREADY_CERTIFIED + byte-equal localized message + one log", async () => {
    await runInRollback(async tx => {
      const locale = "en";
      const user = await createTestUser(tx, { role: "teacher" });
      await createTestApplicant(tx, user.id, { status: ApplicantStatus.Passed });

      const logSpy = silenceDomainLog();
      try {
        const error = await expectRepoError(() =>
          ApplicantLifecycleService.assertCanPurchaseVerification(user.id, locale, tx)
        );

        expect(error).toBeInstanceOf(ValidationError);
        assertErrorCode(error, "APPLICANT_ALREADY_CERTIFIED");
        // Byte-equality with the TRANSLATED literal — never the key name.
        expect(error.message).toBe(getServerTranslations(locale).errorsTranslations.applicantAlreadyCertified);

        // This domain rejection WAS logged, with canonical context.
        expect(logSpy).toHaveBeenCalledTimes(1);
        const [, ctxArg] = logSpy.mock.calls[0] ?? [];
        expect(ctxArg).toMatchObject({
          code: "APPLICANT_ALREADY_CERTIFIED",
          entity: "applicants",
          entityId: user.id,
          locale,
        });
      } finally {
        logSpy.mockRestore();
      }
    });
  });

  test("an in_evaluation applicant still resolves silently — only `passed` is terminal for the surface", async () => {
    await runInRollback(async tx => {
      const user = await createTestUser(tx, { role: "teacher" });
      await createTestApplicant(tx, user.id, { status: ApplicantStatus.InEvaluation, cooldownUntil: null });

      const logSpy = silenceDomainLog();
      try {
        const allowed = await ApplicantLifecycleService.assertCanPurchaseVerification(user.id, "en", tx);
        expect(allowed).toBeUndefined();
        expect(logSpy).toHaveBeenCalledTimes(0);
      } finally {
        logSpy.mockRestore();
      }
    });
  });

  // ─── Tier 2: boundary — branch order + unicode identity ────────────

  test("a passed applicant with an ACTIVE cooldown is denied by the cooldown arm (time-gated deny wins)", async () => {
    await runInRollback(async tx => {
      const user = await createTestUser(tx, { role: "teacher" });
      const future = new Date(Date.now() + FUTURE_COOLDOWN_OFFSET_MS);
      await createTestApplicant(tx, user.id, { status: ApplicantStatus.Passed, cooldownUntil: future });

      const logSpy = silenceDomainLog();
      try {
        const error = await expectRepoError(() =>
          ApplicantLifecycleService.assertCanPurchaseVerification(user.id, "en", tx)
        );

        // The certified arm sits AFTER the cooldown arm — the active
        // cooldown fires first and carries the re-apply moment.
        assertErrorCode(error, "APPLICANT_COOLDOWN_ACTIVE");
        expect(logSpy).toHaveBeenCalledTimes(1);
      } finally {
        logSpy.mockRestore();
      }
    });
  });

  test("certified denial resolves distinctly per locale with zero identity leakage for a unicode-named applicant", async () => {
    await runInRollback(async tx => {
      const unicodeName = "أحمد بن عبد الله 🌙 世界";
      const arUser = await createTestUser(tx, { role: "teacher", fullName: unicodeName });
      const enUser = await createTestUser(tx, { role: "teacher", fullName: unicodeName });
      await createTestApplicant(tx, arUser.id, { status: ApplicantStatus.Passed });
      await createTestApplicant(tx, enUser.id, { status: ApplicantStatus.Passed });

      const arError = await expectRepoError(() =>
        ApplicantLifecycleService.assertCanPurchaseVerification(arUser.id, "ar", tx)
      );
      const enError = await expectRepoError(() =>
        ApplicantLifecycleService.assertCanPurchaseVerification(enUser.id, "en", tx)
      );

      assertErrorCode(arError, "APPLICANT_ALREADY_CERTIFIED");
      assertErrorCode(enError, "APPLICANT_ALREADY_CERTIFIED");
      expect(arError.message).toBe(getServerTranslations("ar").errorsTranslations.applicantAlreadyCertified);
      expect(enError.message).toBe(getServerTranslations("en").errorsTranslations.applicantAlreadyCertified);
      expect(arError.message).not.toBe(enError.message);

      // The unicode name is user data — it must never leak into the denial.
      expect(arError.message.includes(unicodeName)).toBe(false);
      expect(enError.message.includes(unicodeName)).toBe(false);
    });
  });

  // ─── Tier 3: chaos — determinism across repeated denials ──────────

  test("rapid repeated certified denials are deterministic (12 parallel rejects share ONE message)", async () => {
    await runInRollback(async tx => {
      const user = await createTestUser(tx, { role: "teacher" });
      await createTestApplicant(tx, user.id, { status: ApplicantStatus.Passed });

      const settled = await Promise.allSettled(
        Array.from({ length: 12 }, () => ApplicantLifecycleService.assertCanPurchaseVerification(user.id, "en", tx))
      );

      const deniedMessages = settled.map(outcome => {
        if (outcome.status !== "rejected") throw new Error(`expected rejection, got ${outcome.status}`);
        const reason = outcome.reason;
        if (!(reason instanceof ValidationError)) throw new Error("expected a ValidationError denial");
        assertErrorCode(reason, "APPLICANT_ALREADY_CERTIFIED");
        return reason.message;
      });
      expect(deniedMessages).toHaveLength(12);
      // Deterministic: identical locale+row ⇒ byte-identical messages.
      expect(new Set(deniedMessages).size).toBe(1);
      expect(deniedMessages[0]).toBe(getServerTranslations("en").errorsTranslations.applicantAlreadyCertified);
    });
  });
});

describe("ApplicantLifecycleService.recordReapplication", () => {
  // ─── Tier 1: delegate success + missing-row mapping ─────────────────

  test("delegates the atomic increment and returns the updated audit row (0→1)", async () => {
    await runInRollback(async tx => {
      const user = await createTestUser(tx);
      await createTestApplicant(tx, user.id);

      const row = await ApplicantLifecycleService.recordReapplication(user.id, "en", tx);

      expect(row.id).toBe(user.id);
      expect(row.verificationAttempts).toBe(1);
      expect(row.lastAttemptAt).not.toBeNull();

      // Independent persisted-state oracle.
      const persisted = await readApplicantRow(tx, user.id);
      expect(persisted?.verificationAttempts).toBe(1);
      expect(persisted?.lastAttemptAt).not.toBeNull();
    });
  });

  test("maps a missing applicants row onto APPLICANT_NOT_FOUND (byte-equal localized message + logged domain rejection)", async () => {
    await runInRollback(async tx => {
      const locale = "en";
      const missingId = await absentApplicantId(tx);

      const logSpy = silenceDomainLog();
      try {
        const error = await expectRepoError(() => ApplicantLifecycleService.recordReapplication(missingId, locale, tx));

        expect(error).toBeInstanceOf(NotFoundError);
        assertErrorCode(error, "APPLICANT_NOT_FOUND");
        expect(error.message).toBe(getServerTranslations(locale).errorsTranslations.applicantNotFound);

        expect(logSpy).toHaveBeenCalledTimes(1);
        const [, ctxArg] = logSpy.mock.calls[0] ?? [];
        expect(ctxArg).toMatchObject({
          code: "APPLICANT_NOT_FOUND",
          entity: "applicants",
          entityId: missingId,
          locale,
        });
      } finally {
        logSpy.mockRestore();
      }
    });
  });

  // ─── Tier 3: repeat accumulation + concurrency ──────────────────────

  test("repeat re-applications accumulate deterministically (0→1→2)", async () => {
    await runInRollback(async tx => {
      const user = await createTestUser(tx);
      await createTestApplicant(tx, user.id);

      const first = await ApplicantLifecycleService.recordReapplication(user.id, "ar", tx);
      const second = await ApplicantLifecycleService.recordReapplication(user.id, "ar", tx);

      expect(first.verificationAttempts).toBe(1);
      expect(second.verificationAttempts).toBe(2);
      expect((await readApplicantRow(tx, user.id))?.verificationAttempts).toBe(2);
    });
  });

  test("concurrent re-application ×2 via Promise.allSettled lands both increments (attempts = 2, no lost update)", async () => {
    await runInRollback(async tx => {
      const user = await createTestUser(tx);
      await createTestApplicant(tx, user.id);

      const settled = await Promise.allSettled([
        ApplicantLifecycleService.recordReapplication(user.id, "ar", tx),
        ApplicantLifecycleService.recordReapplication(user.id, "en", tx),
      ]);

      expect(settled).toHaveLength(2);
      for (const outcome of settled) {
        expect(outcome.status).toBe("fulfilled");
      }
      const firstRow = settled[0]?.status === "fulfilled" ? settled[0].value : null;
      const secondRow = settled[1]?.status === "fulfilled" ? settled[1].value : null;
      expect(firstRow).not.toBeNull();
      expect(secondRow).not.toBeNull();

      // Serialized atomic increments each observe the other's effect.
      const counters = [firstRow?.verificationAttempts ?? 0, secondRow?.verificationAttempts ?? 0].toSorted(
        (a, b) => a - b
      );
      expect(counters).toEqual([1, 2]);
      expect((await readApplicantRow(tx, user.id))?.verificationAttempts).toBe(2);
    });
  });
});

describe("ApplicantLifecycleService bilingual deny surface (ar/en)", () => {
  // ─── Tier 4: both locales resolve, distinctly, without residue ───────

  test("cooldown denial interpolates the FORMATTED stamp per locale with zero placeholder residue", async () => {
    await runInRollback(async tx => {
      const arUser = await createTestUser(tx);
      const enUser = await createTestUser(tx);
      const sharedFuture = new Date(Date.now() + FUTURE_COOLDOWN_OFFSET_MS);
      await createTestApplicant(tx, arUser.id, { status: "failed", cooldownUntil: sharedFuture });
      await createTestApplicant(tx, enUser.id, { status: "failed", cooldownUntil: sharedFuture });

      const arError = await expectRepoError(() =>
        ApplicantLifecycleService.assertCanPurchaseVerification(arUser.id, "ar", tx)
      );
      const enError = await expectRepoError(() =>
        ApplicantLifecycleService.assertCanPurchaseVerification(enUser.id, "en", tx)
      );

      const [arPrefix, arSuffix] = cooldownTemplateAnchors("ar");
      const [enPrefix, enSuffix] = cooldownTemplateAnchors("en");

      expect(arError.message.startsWith(arPrefix)).toBe(true);
      expect(arError.message.endsWith(arSuffix)).toBe(true);
      expect(enError.message.startsWith(enPrefix)).toBe(true);
      expect(enError.message.endsWith(enSuffix)).toBe(true);

      // Locales are distinct languages ⇒ byte-distinct denials.
      expect(arError.message).not.toBe(enError.message);

      // Both interpolated stamps derive from the SAME sharedFuture instant.
      expect(arError.message.includes(formatCooldownExpectation(sharedFuture, "ar"))).toBe(true);
      expect(enError.message.includes(formatCooldownExpectation(sharedFuture, "en"))).toBe(true);

      // Neither leaves raw ICU braces behind.
      expect(arError.message.includes("{cooldownUntil}")).toBe(false);
      expect(enError.message.includes("{cooldownUntil}")).toBe(false);
    });
  });

  test("NotFound denial resolves byte-equal per locale and DIFFERS across them", async () => {
    await runInRollback(async tx => {
      const missingAr = await absentApplicantId(tx);
      const missingEn = await absentApplicantId(tx);

      const arError = await expectRepoError(() =>
        ApplicantLifecycleService.assertCanPurchaseVerification(missingAr, "ar", tx)
      );
      const enError = await expectRepoError(() => ApplicantLifecycleService.recordReapplication(missingEn, "en", tx));

      expect(arError.message).toBe(getServerTranslations("ar").errorsTranslations.applicantNotFound);
      expect(enError.message).toBe(getServerTranslations("en").errorsTranslations.applicantNotFound);
      expect(arError.message).not.toBe(enError.message);
      assertErrorCode(arError, "APPLICANT_NOT_FOUND");
      assertErrorCode(enError, "APPLICANT_NOT_FOUND");
    });
  });
});

describe("ApplicantLifecycleService.deriveCooldownState", () => {
  // Pure compute — no database surface. Fixed instants keep every case
  // deterministic regardless of host clock or time zone.

  const capturedNow = new Date("2026-01-01T00:00:00.000Z");
  const DAY_MS = 24 * 60 * 60 * 1000;

  test("a NULL cooldown instant derives None (no cooldown was ever stamped)", () => {
    expect(deriveCooldownState(null, capturedNow)).toBe(ApplicantCooldownState.None);
  });

  test("a future instant derives Active", () => {
    const future = new Date(capturedNow.getTime() + 30 * DAY_MS);
    expect(deriveCooldownState(future, capturedNow)).toBe(ApplicantCooldownState.Active);
  });

  test("a past instant derives Expired", () => {
    const past = new Date(capturedNow.getTime() - 30 * DAY_MS);
    expect(deriveCooldownState(past, capturedNow)).toBe(ApplicantCooldownState.Expired);
  });

  test("EXACTLY-now boundary: a cooldown expiring at the captured instant is already Expired (strict >)", () => {
    expect(deriveCooldownState(capturedNow, capturedNow)).toBe(ApplicantCooldownState.Expired);
  });
});

describe("ApplicantLifecycleService.getMyApplicantProfile — derived cooldownState", () => {
  // ─── Tier 1: the three states + mutual consistency ─────────────────

  test("no cooldown stamped → None, not active, purchasable", async () => {
    await runInRollback(async tx => {
      const user = await createTestUser(tx);
      await createTestApplicant(tx, user.id, { status: "failed", cooldownUntil: null });

      const profile = await ApplicantLifecycleService.getMyApplicantProfile(user.id, "en", tx);

      expect(profile?.cooldownState).toBe(ApplicantCooldownState.None);
      expect(profile?.cooldownActive).toBe(false);
      expect(profile?.canPurchaseVerification).toBe(true);
    });
  });

  test("future cooldown → Active, active, NOT purchasable (the three fields stay mutually consistent)", async () => {
    await runInRollback(async tx => {
      const user = await createTestUser(tx);
      const cooldownUntil = new Date(Date.now() + FUTURE_COOLDOWN_OFFSET_MS);
      await createTestApplicant(tx, user.id, { status: "failed", cooldownUntil });

      const profile = await ApplicantLifecycleService.getMyApplicantProfile(user.id, "en", tx);

      expect(profile?.cooldownState).toBe(ApplicantCooldownState.Active);
      expect(profile?.cooldownActive).toBe(true);
      expect(profile?.canPurchaseVerification).toBe(false);
    });
  });

  test("past cooldown → Expired, not active, purchasable (the re-apply affordance without inferring)", async () => {
    await runInRollback(async tx => {
      const user = await createTestUser(tx);
      const cooldownUntil = new Date(Date.now() + PAST_COOLDOWN_OFFSET_MS);
      await createTestApplicant(tx, user.id, { status: "failed", cooldownUntil });

      const profile = await ApplicantLifecycleService.getMyApplicantProfile(user.id, "en", tx);

      expect(profile?.cooldownState).toBe(ApplicantCooldownState.Expired);
      expect(profile?.cooldownActive).toBe(false);
      expect(profile?.canPurchaseVerification).toBe(true);
    });
  });

  // ─── Tier 2: strict-`>` boundary on the live read path ─────────────

  test("a cooldown expiring EXACTLY now reads Expired on the profile (strict >, same boundary as the guard)", async () => {
    await runInRollback(async tx => {
      const user = await createTestUser(tx);
      // Seeded instant == wall clock captured immediately before the call;
      // the shaper's own captured `now` lands at-or-after it, so the strict
      // `>` predicate must classify it Expired (no jump-backs occur between
      // these awaits).
      await createTestApplicant(tx, user.id, { status: "failed", cooldownUntil: new Date() });

      const profile = await ApplicantLifecycleService.getMyApplicantProfile(user.id, "en", tx);

      expect(profile?.cooldownState).toBe(ApplicantCooldownState.Expired);
      expect(profile?.cooldownActive).toBe(false);
      expect(profile?.canPurchaseVerification).toBe(true);
    });
  });

  test("certified with no cooldown → None but NOT purchasable (consistency holds per status)", async () => {
    await runInRollback(async tx => {
      const user = await createTestUser(tx);
      await createTestApplicant(tx, user.id, { status: "passed", cooldownUntil: null });

      const profile = await ApplicantLifecycleService.getMyApplicantProfile(user.id, "en", tx);

      expect(profile?.status).toBe(ApplicantStatus.Passed);
      expect(profile?.cooldownState).toBe(ApplicantCooldownState.None);
      expect(profile?.cooldownActive).toBe(false);
      expect(profile?.canPurchaseVerification).toBe(false);
    });
  });
});

describe("ApplicantLifecycleService.extendApplicantCooldown", () => {
  // ─── Tier 1: happy path — failed + active base, lengthened + audited ─

  test("lengthens an ACTIVE cooldown verbatim from the stored instant, returns the extended profile, appends ONE audit row", async () => {
    await runInRollback(async tx => {
      const applicant = await createTestUser(tx, { role: "teacher" });
      const admin = await createTestUser(tx, { role: "admin" });
      const oldExpiry = new Date(Date.now() + FUTURE_COOLDOWN_OFFSET_MS);
      await createTestApplicant(tx, applicant.id, { status: "failed", cooldownUntil: oldExpiry });

      const additionalDays = 60;
      const expectedExpiryMs = oldExpiry.getTime() + additionalDays * MS_PER_DAY;

      const logSpy = silenceDomainLog();
      try {
        const profile = await ApplicantLifecycleService.extendApplicantCooldown(
          applicant.id,
          additionalDays,
          admin.id,
          "en",
          tx
        );

        // Returned profile reflects the extension (no re-fetch needed).
        expect(profile.status).toBe(ApplicantStatus.Failed);
        expect(profile.cooldownUntil?.getTime()).toBe(expectedExpiryMs);
        expect(profile.cooldownState).toBe(ApplicantCooldownState.Active);
        expect(profile.cooldownActive).toBe(true);
        expect(profile.canPurchaseVerification).toBe(false);

        // The post-commit domain event fired exactly once with canonical context —
        // including the machine-readable `code` member the structured-log
        // contract pins (entity ids + instants only, never PII).
        expect(logSpy).toHaveBeenCalledTimes(1);
        const [message, ctxArg] = logSpy.mock.calls[0] ?? [];
        expect(message).toBe("APPLICANT_COOLDOWN_EXTENDED");
        expect(ctxArg).toMatchObject({
          code: "APPLICANT_COOLDOWN_EXTENDED",
          applicantId: applicant.id,
          additionalDays,
        });
      } finally {
        logSpy.mockRestore();
      }

      // Independent persisted-state oracle — the new instant stored verbatim.
      const persisted = await readApplicantRow(tx, applicant.id);
      expect(persisted?.cooldownUntil?.getTime()).toBe(expectedExpiryMs);
      expect(persisted?.status).toBe(ApplicantStatus.Failed);

      // Exactly ONE audit row, sharing the write's commit.
      const auditRows = await readExtensionAuditRows(tx, applicant.id);
      expect(auditRows).toHaveLength(1);
      const audit = auditRows[0];
      expect(audit?.actionType).toBe(AuditActionType.Adjust);
      expect(audit?.entityType).toBe("applicant");
      expect(audit?.entityId).toBe(applicant.id);
      expect(audit?.actorId).toBe(admin.id);
      const details = parseAuditDetails(audit?.details ?? null);
      expect(details).not.toBeNull();
      expect(details?.field).toBe("cooldown_until");
      expect(details?.from).toBe(oldExpiry.toISOString());
      expect(details?.to).toBe(new Date(expectedExpiryMs).toISOString());
      expect(details?.additionalDays).toBe(additionalDays);
    });
  });

  // ─── Tier 1: expired / absent base re-arms from the captured now ────

  test("an EXPIRED cooldown base starts the fresh window from now (never from the stale instant)", async () => {
    await runInRollback(async tx => {
      const applicant = await createTestUser(tx, { role: "teacher" });
      const admin = await createTestUser(tx, { role: "admin" });
      const staleExpiry = new Date(Date.now() + PAST_COOLDOWN_OFFSET_MS);
      await createTestApplicant(tx, applicant.id, { status: "failed", cooldownUntil: staleExpiry });

      const additionalDays = 30;
      const before = Date.now();
      const profile = await ApplicantLifecycleService.extendApplicantCooldown(
        applicant.id,
        additionalDays,
        admin.id,
        "en",
        tx
      );
      const after = Date.now();

      const persistedMs = (await readApplicantRow(tx, applicant.id))?.cooldownUntil?.getTime();
      expect(persistedMs).toBeGreaterThanOrEqual(before + additionalDays * MS_PER_DAY);
      expect(persistedMs).toBeLessThanOrEqual(after + additionalDays * MS_PER_DAY);
      expect(profile.cooldownState).toBe(ApplicantCooldownState.Active);
      expect(profile.cooldownUntil?.getTime()).toBe(persistedMs);

      // The audit trail records the STALE instant as `from` and the fresh one as `to`.
      const auditRows = await readExtensionAuditRows(tx, applicant.id);
      expect(auditRows).toHaveLength(1);
      const details = parseAuditDetails(auditRows[0]?.details ?? null);
      expect(details?.from).toBe(staleExpiry.toISOString());
      expect(details?.to).toBe(new Date(persistedMs ?? 0).toISOString());
    });
  });

  test("a NULL cooldown base starts the fresh window from now (extending an unstamped applicant is legal)", async () => {
    await runInRollback(async tx => {
      const applicant = await createTestUser(tx, { role: "teacher" });
      const admin = await createTestUser(tx, { role: "admin" });
      await createTestApplicant(tx, applicant.id, { status: "pending", cooldownUntil: null });

      const additionalDays = 45;
      const before = Date.now();
      const profile = await ApplicantLifecycleService.extendApplicantCooldown(
        applicant.id,
        additionalDays,
        admin.id,
        "en",
        tx
      );
      const after = Date.now();

      const persistedMs = (await readApplicantRow(tx, applicant.id))?.cooldownUntil?.getTime();
      expect(persistedMs).toBeGreaterThanOrEqual(before + additionalDays * MS_PER_DAY);
      expect(persistedMs).toBeLessThanOrEqual(after + additionalDays * MS_PER_DAY);
      expect(profile.cooldownState).toBe(ApplicantCooldownState.Active);

      // The audit `from` carries null — no instant existed before.
      const auditRows = await readExtensionAuditRows(tx, applicant.id);
      expect(auditRows).toHaveLength(1);
      const details = parseAuditDetails(auditRows[0]?.details ?? null);
      expect(details?.from).toBeNull();
      expect(details?.additionalDays).toBe(additionalDays);
    });
  });

  // ─── Tier 2: bounds + boundary lengths, terminal + missing arms ─────

  test("rejects additionalDays = 0 with APPLICANT_COOLDOWN_EXTENSION_INVALID BEFORE any database read", async () => {
    await runInRollback(async tx => {
      const absentId = await absentApplicantId(tx);
      const admin = await createTestUser(tx, { role: "admin" });

      // An ABSENT applicant + out-of-bounds length ⇒ the BOUNDS code must
      // win — proving the validation runs before the existence read.
      const logSpy = silenceDomainLog();
      try {
        const error = await expectRepoError(() =>
          ApplicantLifecycleService.extendApplicantCooldown(absentId, 0, admin.id, "en", tx)
        );

        expect(error).toBeInstanceOf(ValidationError);
        assertErrorCode(error, "APPLICANT_COOLDOWN_EXTENSION_INVALID");
        // The leaf is a static zero-placeholder copy — byte-equality holds.
        expect(error.message).toBe(getServerTranslations("en").errorsTranslations.applicantCooldownExtensionInvalid);
        // Pure input validation — not an enumerated domain rejection, stays silent.
        expect(logSpy).toHaveBeenCalledTimes(0);
      } finally {
        logSpy.mockRestore();
      }
    });
  });

  test("rejects additionalDays = 3651 (above the ceiling) with the same bounds code", async () => {
    await runInRollback(async tx => {
      const applicant = await createTestUser(tx, { role: "teacher" });
      const admin = await createTestUser(tx, { role: "admin" });
      await createTestApplicant(tx, applicant.id, { status: "failed" });

      const error = await expectRepoError(() =>
        ApplicantLifecycleService.extendApplicantCooldown(applicant.id, 3651, admin.id, "ar", tx)
      );

      assertErrorCode(error, "APPLICANT_COOLDOWN_EXTENSION_INVALID");
      expect(error.message).toBe(getServerTranslations("ar").errorsTranslations.applicantCooldownExtensionInvalid);
      expect(await readExtensionAuditRows(tx, applicant.id)).toHaveLength(0);
    });
  });

  test("rejects a NEGATIVE additionalDays with the bounds code and writes nothing", async () => {
    await runInRollback(async tx => {
      const applicant = await createTestUser(tx, { role: "teacher" });
      const admin = await createTestUser(tx, { role: "admin" });
      await createTestApplicant(tx, applicant.id, { status: "failed", cooldownUntil: null });

      const error = await expectRepoError(() =>
        ApplicantLifecycleService.extendApplicantCooldown(applicant.id, -5, admin.id, "en", tx)
      );

      assertErrorCode(error, "APPLICANT_COOLDOWN_EXTENSION_INVALID");
      expect((await readApplicantRow(tx, applicant.id))?.cooldownUntil).toBeNull();
      expect(await readExtensionAuditRows(tx, applicant.id)).toHaveLength(0);
    });
  });

  test("rejects a NON-INTEGER additionalDays (fractional) with the bounds code before any database contact", async () => {
    await runInRollback(async tx => {
      const absentId = await absentApplicantId(tx);
      const admin = await createTestUser(tx, { role: "admin" });

      // The Number.isInteger arm of the bounds guard — a fractional day
      // count is rejected by the SAME code and message, ahead of the
      // existence read (the ABSENT applicant id proves the denial fired
      // before any row contact, exactly as the zero-day probe does).
      const logSpy = silenceDomainLog();
      try {
        const error = await expectRepoError(() =>
          ApplicantLifecycleService.extendApplicantCooldown(absentId, 2.5, admin.id, "en", tx)
        );

        expect(error).toBeInstanceOf(ValidationError);
        assertErrorCode(error, "APPLICANT_COOLDOWN_EXTENSION_INVALID");
        expect(error.message).toBe(getServerTranslations("en").errorsTranslations.applicantCooldownExtensionInvalid);
        // Pure input validation — not an enumerated domain rejection, stays silent.
        expect(logSpy).toHaveBeenCalledTimes(0);
      } finally {
        logSpy.mockRestore();
      }
    });
  });

  test("accepts the boundary lengths 1 and 3650 (both are valid extension windows)", async () => {
    await runInRollback(async tx => {
      const applicantOne = await createTestUser(tx, { role: "teacher" });
      const applicantMax = await createTestUser(tx, { role: "teacher" });
      const admin = await createTestUser(tx, { role: "admin" });
      const baseOne = new Date(Date.now() + FUTURE_COOLDOWN_OFFSET_MS);
      const baseMax = new Date(Date.now() + FUTURE_COOLDOWN_OFFSET_MS);
      await createTestApplicant(tx, applicantOne.id, { status: "failed", cooldownUntil: baseOne });
      await createTestApplicant(tx, applicantMax.id, { status: "failed", cooldownUntil: baseMax });

      await ApplicantLifecycleService.extendApplicantCooldown(applicantOne.id, 1, admin.id, "en", tx);
      await ApplicantLifecycleService.extendApplicantCooldown(applicantMax.id, 3650, admin.id, "en", tx);

      expect((await readApplicantRow(tx, applicantOne.id))?.cooldownUntil?.getTime()).toBe(
        baseOne.getTime() + 1 * MS_PER_DAY
      );
      expect((await readApplicantRow(tx, applicantMax.id))?.cooldownUntil?.getTime()).toBe(
        baseMax.getTime() + 3650 * MS_PER_DAY
      );
    });
  });

  test("rejects a passed (certified) applicant with APPLICANT_ALREADY_CERTIFIED — terminal, nothing written", async () => {
    await runInRollback(async tx => {
      const applicant = await createTestUser(tx, { role: "teacher" });
      const admin = await createTestUser(tx, { role: "admin" });
      await createTestApplicant(tx, applicant.id, { status: "passed", cooldownUntil: null });

      const logSpy = silenceDomainLog();
      try {
        const error = await expectRepoError(() =>
          ApplicantLifecycleService.extendApplicantCooldown(applicant.id, 30, admin.id, "en", tx)
        );

        expect(error).toBeInstanceOf(ValidationError);
        assertErrorCode(error, "APPLICANT_ALREADY_CERTIFIED");
        expect(error.message).toBe(getServerTranslations("en").errorsTranslations.applicantAlreadyCertified);
        expect(logSpy).toHaveBeenCalledTimes(1);
      } finally {
        logSpy.mockRestore();
      }

      // The terminal denial left no write and no trail.
      expect((await readApplicantRow(tx, applicant.id))?.cooldownUntil).toBeNull();
      expect(await readExtensionAuditRows(tx, applicant.id)).toHaveLength(0);
    });
  });

  test("rejects a missing applicant with APPLICANT_NOT_FOUND (byte-equal localized) and appends no audit row", async () => {
    await runInRollback(async tx => {
      const admin = await createTestUser(tx, { role: "admin" });
      const missingId = await absentApplicantId(tx);

      const logSpy = silenceDomainLog();
      try {
        const error = await expectRepoError(() =>
          ApplicantLifecycleService.extendApplicantCooldown(missingId, 30, admin.id, "ar", tx)
        );

        expect(error).toBeInstanceOf(NotFoundError);
        assertErrorCode(error, "APPLICANT_NOT_FOUND");
        expect(error.message).toBe(getServerTranslations("ar").errorsTranslations.applicantNotFound);
        expect(logSpy).toHaveBeenCalledTimes(1);
        const [, ctxArg] = logSpy.mock.calls[0] ?? [];
        expect(ctxArg).toMatchObject({ code: "APPLICANT_NOT_FOUND", entity: "applicants", entityId: missingId });
      } finally {
        logSpy.mockRestore();
      }
    });
  });

  // ─── Tier 3: concurrency + atomicity ───────────────────────────────

  test("concurrent admin-extension vs rubric-finalize: both guarded predicates compose — status flips AND the cooldown lengthens, no partial writes", async () => {
    await runInRollback(async tx => {
      const applicant = await createTestUser(tx, { role: "teacher" });
      const admin = await createTestUser(tx, { role: "admin" });
      await createTestApplicant(tx, applicant.id, { status: "in_evaluation", cooldownUntil: null });

      const before = Date.now();
      const settled = await Promise.allSettled([
        ApplicantLifecycleService.extendApplicantCooldown(applicant.id, 30, admin.id, "en", tx),
        ApplicantRepository.transitionToFailed(applicant.id, new Date(Date.now() + FUTURE_COOLDOWN_OFFSET_MS), tx),
      ]);

      expect(settled).toHaveLength(2);
      for (const outcome of settled) {
        expect(outcome.status).toBe("fulfilled");
      }

      // The finalize consumed its in_evaluation pre-state; the extension
      // admitted the failed status too — the final row carries BOTH effects.
      // The cooldown base depends on the serialized order (extension first ⇒
      // re-arms from now; finalize first ⇒ the freshly stamped instant is
      // honored verbatim as the base) — either way it only LENGTHENS.
      const persisted = await readApplicantRow(tx, applicant.id);
      expect(persisted?.status).toBe(ApplicantStatus.Failed);
      const persistedMs = persisted?.cooldownUntil?.getTime();
      expect(persistedMs).toBeGreaterThanOrEqual(before + 30 * MS_PER_DAY);
      expect(persistedMs).toBeLessThanOrEqual(Date.now() + FUTURE_COOLDOWN_OFFSET_MS + 30 * MS_PER_DAY);

      // Exactly ONE audit row — the extension's, not the finalize's.
      expect(await readExtensionAuditRows(tx, applicant.id)).toHaveLength(1);
    });
  });

  test("concurrent admin-extension vs certification: the guarded write re-evaluates the terminal status — typed conflict or supersede, never an illegal extension", async () => {
    await runInRollback(async tx => {
      const applicant = await createTestUser(tx, { role: "teacher" });
      const admin = await createTestUser(tx, { role: "admin" });
      await createTestApplicant(tx, applicant.id, { status: "in_evaluation", cooldownUntil: null });

      const settled = await Promise.allSettled([
        ApplicantLifecycleService.extendApplicantCooldown(applicant.id, 30, admin.id, "en", tx),
        ApplicantRepository.finalizeOnCertification(applicant.id, tx),
      ]);

      // Certification is terminal and unguarded — its promise never rejects.
      expect(settled[1]?.status).toBe("fulfilled");

      // Either the extension landed BEFORE the supersede (one audit row, then
      // the terminal write cleared the cooldown) or its guarded write matched
      // zero rows and surfaced the typed certified rejection (no trail).
      const auditRows = await readExtensionAuditRows(tx, applicant.id);
      const persisted = await readApplicantRow(tx, applicant.id);
      if (settled[0]?.status === "fulfilled") {
        expect(auditRows).toHaveLength(1);
        expect(persisted?.status).toBe(ApplicantStatus.Passed);
      } else if (settled[0]?.status === "rejected") {
        const reason: unknown = settled[0].reason;
        expect(reason).toBeInstanceOf(ValidationError);
        if (!(reason instanceof Error)) throw new Error("expected an Error rejection");
        assertErrorCode(reason, "APPLICANT_ALREADY_CERTIFIED");
        expect(auditRows).toHaveLength(0);
        // Harness note: both flows share ONE connection here, so a rejection
        // rolls the whole savepoint window back — the interleaved terminal
        // write swallowed with it. On distinct connections (the production
        // shape) the certification's own transaction is untouched.
      }

      // The invariant BOTH orders guarantee: a certification race can never
      // leave an EXTENDED cooldown behind — the supersede cleared it or the
      // extension's rollback removed it.
      expect(persisted?.cooldownUntil).toBeNull();
    });
  });

  test("an unresolvable actor id is denied by the service-side admin gate — zero writes, zero audit rows", async () => {
    await runInRollback(async tx => {
      const applicant = await createTestUser(tx, { role: "teacher" });
      // An actor id with no users row cannot pass the strict active-admin
      // actor gate — the BFLA denial fires BEFORE the extension transaction
      // opens, so neither the cooldown write nor the audit append is ever
      // attempted. (The gate's denial ladder is the subsuming case of the
      // audit-actor-FK seam this probe previously rode.)
      const ghostActorId = await absentApplicantId(tx);
      const oldExpiry = new Date(Date.now() + FUTURE_COOLDOWN_OFFSET_MS);
      await createTestApplicant(tx, applicant.id, { status: "failed", cooldownUntil: oldExpiry });

      const error = await expectRepoError(() =>
        ApplicantLifecycleService.extendApplicantCooldown(applicant.id, 30, ghostActorId, "en", tx)
      );

      expect(error).toBeInstanceOf(ForbiddenError);
      expect(error.message).toContain(getServerTranslations("en").errorsTranslations.forbidden);

      // Nothing ran — the cooldown kept its ORIGINAL instant and no audit
      // row survived.
      expect((await readApplicantRow(tx, applicant.id))?.cooldownUntil?.getTime()).toBe(oldExpiry.getTime());
      expect(await readExtensionAuditRows(tx, applicant.id)).toHaveLength(0);
    });
  });

  test("a guarded-write miss between the read and the write collapses onto the typed certified rejection (chaos probe)", async () => {
    await runInRollback(async tx => {
      const applicant = await createTestUser(tx, { role: "teacher" });
      const admin = await createTestUser(tx, { role: "admin" });
      await createTestApplicant(tx, applicant.id, { status: "in_evaluation", cooldownUntil: null });

      // Force the guarded UPDATE to match zero rows despite the passing guard
      // read — the interleaved-certification shape — by stubbing the repo
      // primitive for exactly this call.
      const repoSpy = spyOn(ApplicantRepository, "extendCooldownOnce").mockImplementation(async () => null);
      const logSpy = silenceDomainLog();
      try {
        const error = await expectRepoError(() =>
          ApplicantLifecycleService.extendApplicantCooldown(applicant.id, 30, admin.id, "en", tx)
        );

        expect(error).toBeInstanceOf(ValidationError);
        assertErrorCode(error, "APPLICANT_ALREADY_CERTIFIED");

        // The savepoint rolled back — nothing was written, no trail exists.
        const persisted = await readApplicantRow(tx, applicant.id);
        expect(persisted?.status).toBe(ApplicantStatus.InEvaluation);
        expect(persisted?.cooldownUntil).toBeNull();
        expect(await readExtensionAuditRows(tx, applicant.id)).toHaveLength(0);
      } finally {
        repoSpy.mockRestore();
        logSpy.mockRestore();
      }
    });
  });

  // ─── Tier 4: actor attribution + the two-source split ───────────────

  test("the audit row attributes the extension to the actor identity argument (the resolver's session user id), never to the applicant or any other row", async () => {
    await runInRollback(async tx => {
      const applicant = await createTestUser(tx, { role: "teacher" });
      const adminA = await createTestUser(tx, { role: "admin" });
      const adminB = await createTestUser(tx, { role: "admin" });
      await createTestApplicant(tx, applicant.id, { status: "failed" });

      await ApplicantLifecycleService.extendApplicantCooldown(applicant.id, 30, adminA.id, "en", tx);

      const auditRows = await readExtensionAuditRows(tx, applicant.id);
      expect(auditRows).toHaveLength(1);
      // The acting admin is EXACTLY the identity handed in as the 3rd
      // positional argument — the signature has no input object to forge.
      expect(auditRows[0]?.actorId).toBe(adminA.id);
      expect(auditRows[0]?.actorId).not.toBe(applicant.id);
      expect(auditRows[0]?.actorId).not.toBe(adminB.id);
    });
  });

  test("two-source split: after the extension the account row's governance flags are untouched (read back DIRECTLY, never via the service)", async () => {
    await runInRollback(async tx => {
      const applicant = await createTestUser(tx, { role: "teacher" });
      const admin = await createTestUser(tx, { role: "admin" });
      await createTestApplicant(tx, applicant.id, { status: "failed" });

      await ApplicantLifecycleService.extendApplicantCooldown(applicant.id, 30, admin.id, "en", tx);

      // The cooldown moved...
      expect((await readApplicantRow(tx, applicant.id))?.cooldownUntil).not.toBeNull();

      // ...but the account row's governance triple is byte-identical to the
      // seeded defaults — the extension wrote ONLY the applicant cooldown.
      const userRow = await readUserRow(tx, applicant.id);
      expect(userRow?.suspended).toBe(false);
      expect(userRow?.suspendedAt).toBeNull();
      expect(userRow?.suspendedPeriodDays).toBeNull();
      expect(userRow?.isBlocked).toBe(false);
      expect(userRow?.isDeleted).toBe(false);
    });
  });

  test("the post-write profile re-read cannot legitimately miss — the fail-closed arm surfaces the localized not-found instead of a widened null (chaos probe)", async () => {
    await runInRollback(async tx => {
      const applicant = await createTestUser(tx, { role: "teacher" });
      const admin = await createTestUser(tx, { role: "admin" });
      await createTestApplicant(tx, applicant.id, { status: "failed" });

      // Force ONLY the post-write re-read to miss: the first call (the
      // guard read) passes through to the real repository, the second (the
      // shaper's read inside the same transaction) is made to return null.
      const realFindByUserId = ApplicantRepository.findByUserId.bind(ApplicantRepository);
      let calls = 0;
      const repoSpy = spyOn(ApplicantRepository, "findByUserId").mockImplementation((userId, executor) => {
        calls += 1;
        return calls === 1 ? realFindByUserId(userId, executor) : Promise.resolve(null);
      });
      const logSpy = silenceDomainLog();
      try {
        const error = await expectRepoError(() =>
          ApplicantLifecycleService.extendApplicantCooldown(applicant.id, 30, admin.id, "en", tx)
        );

        expect(error).toBeInstanceOf(NotFoundError);
        assertErrorCode(error, "APPLICANT_NOT_FOUND");

        // The thrown error rolled the whole savepoint back — no write, no trail.
        expect((await readApplicantRow(tx, applicant.id))?.cooldownUntil).toBeNull();
        expect(await readExtensionAuditRows(tx, applicant.id)).toHaveLength(0);
      } finally {
        repoSpy.mockRestore();
        logSpy.mockRestore();
      }
    });
  });

  // ─── Bilingual: the bounds leaf resolves per locale, without residue ─

  test("bounds denial resolves byte-equal per locale and DIFFERS across them", async () => {
    await runInRollback(async tx => {
      const applicant = await createTestUser(tx, { role: "teacher" });
      const admin = await createTestUser(tx, { role: "admin" });
      await createTestApplicant(tx, applicant.id, { status: "failed" });

      const arError = await expectRepoError(() =>
        ApplicantLifecycleService.extendApplicantCooldown(applicant.id, 0, admin.id, "ar", tx)
      );
      const enError = await expectRepoError(() =>
        ApplicantLifecycleService.extendApplicantCooldown(applicant.id, 0, admin.id, "en", tx)
      );

      assertErrorCode(arError, "APPLICANT_COOLDOWN_EXTENSION_INVALID");
      assertErrorCode(enError, "APPLICANT_COOLDOWN_EXTENSION_INVALID");
      expect(arError.message).toBe(getServerTranslations("ar").errorsTranslations.applicantCooldownExtensionInvalid);
      expect(enError.message).toBe(getServerTranslations("en").errorsTranslations.applicantCooldownExtensionInvalid);
      expect(arError.message).not.toBe(enError.message);
    });
  });
});

/** Extracts the leading UUID chunk of a helper-generated email (stable unique marker). */
function extractEmailUniqueFragment(user: UserSelectType): string {
  return user.email.replace(/^test-/, "").split("@")[0] ?? "";
}

/** Independent teacher-row read-back oracle — direct Drizzle select, not via the service. */
async function readTeacherRow(tx: DBTransaction, userId: number) {
  const rows = await tx.select().from(teacher).where(eq(teacher.id, userId));
  return rows[0] ?? null;
}

describe("ApplicantLifecycleService.overrideApplicantEvaluation", () => {
  // ─── Tier 1: certify — cold insert, elevate, terminal, bounds ─────

  test("certify a FAILED applicant inserts the teacher row certified (is_approved=true, is_evaluator=false), finalizes the applicant, clears the cooldown, and appends exactly ONE override audit row", async () => {
    await runInRollback(async tx => {
      const applicant = await createTestUser(tx, { role: "teacher" });
      const admin = await createTestUser(tx, { role: "admin" });
      const activeCooldown = new Date(Date.now() + FUTURE_COOLDOWN_OFFSET_MS);
      await createTestApplicant(tx, applicant.id, { status: "failed", cooldownUntil: activeCooldown });

      const logSpy = silenceDomainLog();
      try {
        const profile = await ApplicantLifecycleService.overrideApplicantEvaluation(
          applicant.id,
          AdminApplicantOverrideAction.Certify,
          null,
          admin.id,
          "en",
          tx
        );

        // Returned profile is the post-override shape.
        expect(profile.status).toBe(ApplicantStatus.Passed);
        expect(profile.cooldownUntil).toBeNull();
        expect(profile.cooldownActive).toBe(false);
        expect(profile.cooldownState).toBe(ApplicantCooldownState.None);
        expect(profile.canPurchaseVerification).toBe(false);

        // The post-commit domain event fired exactly once with the
        // machine-readable `code` member (ids + direction only — never PII).
        expect(logSpy).toHaveBeenCalledTimes(1);
        const [message, ctxArg] = logSpy.mock.calls[0] ?? [];
        expect(message).toBe("APPLICANT_OVERRIDE_APPLIED");
        expect(ctxArg).toMatchObject({
          code: "APPLICANT_OVERRIDE_APPLIED",
          applicantId: applicant.id,
          action: AdminApplicantOverrideAction.Certify,
          actorId: admin.id,
        });
      } finally {
        logSpy.mockRestore();
      }

      // Independent persisted-state oracles.
      const teacherRow = await readTeacherRow(tx, applicant.id);
      expect(teacherRow).not.toBeNull();
      expect(teacherRow?.isApproved).toBe(true);
      expect(teacherRow?.isEvaluator).toBe(false);

      const persisted = await readApplicantRow(tx, applicant.id);
      expect(persisted?.status).toBe(ApplicantStatus.Passed);
      expect(persisted?.cooldownUntil).toBeNull();

      // Exactly ONE audit row, action_type='override', composed details.
      const auditRows = await readExtensionAuditRows(tx, applicant.id);
      expect(auditRows).toHaveLength(1);
      const audit = auditRows[0];
      expect(audit?.actionType).toBe(AuditActionType.Override);
      expect(audit?.entityType).toBe("applicant");
      expect(audit?.entityId).toBe(applicant.id);
      expect(audit?.actorId).toBe(admin.id);
      const details = parseAuditDetails(audit?.details ?? null);
      expect(details).toEqual({
        action: "certify",
        field: "status",
        from: ApplicantStatus.Failed,
        to: ApplicantStatus.Passed,
      });
    });
  });

  test("certify ELEVATES a pre-existing unapproved teacher row preserving its evaluator flag (never a blind demote-to-non-evaluator)", async () => {
    await runInRollback(async tx => {
      const applicant = await createTestUser(tx, { role: "teacher" });
      const admin = await createTestUser(tx, { role: "admin" });
      await createTestApplicant(tx, applicant.id, { status: "in_evaluation" });
      await createTestTeacherRow(tx, applicant.id, { isApproved: false, isEvaluator: true });

      await ApplicantLifecycleService.overrideApplicantEvaluation(
        applicant.id,
        AdminApplicantOverrideAction.Certify,
        null,
        admin.id,
        "en",
        tx
      );

      // The locked read's OWN evaluator flag rode the elevation.
      const teacherRow = await readTeacherRow(tx, applicant.id);
      expect(teacherRow?.isApproved).toBe(true);
      expect(teacherRow?.isEvaluator).toBe(true);
      expect((await readApplicantRow(tx, applicant.id))?.status).toBe(ApplicantStatus.Passed);
    });
  });

  test("certify an already-PASSED applicant denies with APPLICANT_ALREADY_CERTIFIED and performs ZERO writes", async () => {
    await runInRollback(async tx => {
      const applicant = await createTestUser(tx, { role: "teacher" });
      const admin = await createTestUser(tx, { role: "admin" });
      await createTestApplicant(tx, applicant.id, { status: "passed", cooldownUntil: null });

      const logSpy = silenceDomainLog();
      try {
        const error = await expectRepoError(() =>
          ApplicantLifecycleService.overrideApplicantEvaluation(
            applicant.id,
            AdminApplicantOverrideAction.Certify,
            null,
            admin.id,
            "en",
            tx
          )
        );

        expect(error).toBeInstanceOf(ValidationError);
        assertErrorCode(error, "APPLICANT_ALREADY_CERTIFIED");
        expect(error.message).toBe(getServerTranslations("en").errorsTranslations.applicantAlreadyCertified);
        expect(logSpy).toHaveBeenCalledTimes(1);
      } finally {
        logSpy.mockRestore();
      }

      // Terminal denial left no write and no trail — and no teacher row was minted.
      const persisted = await readApplicantRow(tx, applicant.id);
      expect(persisted?.status).toBe(ApplicantStatus.Passed);
      expect(persisted?.cooldownUntil).toBeNull();
      expect(await readTeacherRow(tx, applicant.id)).toBeNull();
      expect(await readExtensionAuditRows(tx, applicant.id)).toHaveLength(0);
    });
  });

  test("certify a missing applicant answers APPLICANT_NOT_FOUND", async () => {
    await runInRollback(async tx => {
      const admin = await createTestUser(tx, { role: "admin" });
      const missingId = await absentApplicantId(tx);

      const logSpy = silenceDomainLog();
      try {
        const error = await expectRepoError(() =>
          ApplicantLifecycleService.overrideApplicantEvaluation(
            missingId,
            AdminApplicantOverrideAction.Certify,
            null,
            admin.id,
            "ar",
            tx
          )
        );

        expect(error).toBeInstanceOf(NotFoundError);
        assertErrorCode(error, "APPLICANT_NOT_FOUND");
        expect(error.message).toBe(getServerTranslations("ar").errorsTranslations.applicantNotFound);
      } finally {
        logSpy.mockRestore();
      }
    });
  });

  // ─── Tier 1: reject — demote + guarded flip + stamped cooldown ─────

  test("reject a PASSED applicant demotes the teacher row, flips the applicant to failed with the stamped cooldown, and the audit details carry the cooldown members", async () => {
    await runInRollback(async tx => {
      const applicant = await createTestUser(tx, { role: "teacher" });
      const admin = await createTestUser(tx, { role: "admin" });
      await createTestApplicant(tx, applicant.id, { status: "passed", cooldownUntil: null });
      await createTestTeacherRow(tx, applicant.id, { isApproved: true, isEvaluator: false });

      const cooldownDays = 14;
      const before = Date.now();
      await ApplicantLifecycleService.overrideApplicantEvaluation(
        applicant.id,
        AdminApplicantOverrideAction.Reject,
        cooldownDays,
        admin.id,
        "en",
        tx
      );
      const after = Date.now();

      // Teacher row demoted — certification withdrawn, evaluator flag untouched.
      const teacherRow = await readTeacherRow(tx, applicant.id);
      expect(teacherRow?.isApproved).toBe(false);
      expect(teacherRow?.isEvaluator).toBe(false);

      // Applicant flipped to failed with the captured-now + days cooldown.
      const persisted = await readApplicantRow(tx, applicant.id);
      expect(persisted?.status).toBe(ApplicantStatus.Failed);
      const stampedMs = persisted?.cooldownUntil?.getTime();
      expect(stampedMs).toBeGreaterThanOrEqual(before + cooldownDays * MS_PER_DAY);
      expect(stampedMs).toBeLessThanOrEqual(after + cooldownDays * MS_PER_DAY);

      // Exactly ONE override audit row carrying the stamped instant + length.
      const auditRows = await readExtensionAuditRows(tx, applicant.id);
      expect(auditRows).toHaveLength(1);
      const audit = auditRows[0];
      expect(audit?.actionType).toBe(AuditActionType.Override);
      expect(audit?.actorId).toBe(admin.id);
      const details = parseAuditDetails(audit?.details ?? null);
      expect(details?.action).toBe("reject");
      expect(details?.field).toBe("status");
      expect(details?.from).toBe(ApplicantStatus.Passed);
      expect(details?.to).toBe(ApplicantStatus.Failed);
      expect(details?.cooldownDays).toBe(cooldownDays);
      const auditedMs = Date.parse(typeof details?.cooldownUntil === "string" ? details.cooldownUntil : "");
      expect(auditedMs).toBeGreaterThanOrEqual(before + cooldownDays * MS_PER_DAY);
      expect(auditedMs).toBeLessThanOrEqual(after + cooldownDays * MS_PER_DAY);
    });
  });

  test("reject with NO pre-existing teacher row treats the demotion as a best-effort no-op (the rejection still lands)", async () => {
    await runInRollback(async tx => {
      const applicant = await createTestUser(tx, { role: "teacher" });
      const admin = await createTestUser(tx, { role: "admin" });
      await createTestApplicant(tx, applicant.id, { status: "passed", cooldownUntil: null });

      await ApplicantLifecycleService.overrideApplicantEvaluation(
        applicant.id,
        AdminApplicantOverrideAction.Reject,
        30,
        admin.id,
        "en",
        tx
      );

      expect((await readApplicantRow(tx, applicant.id))?.status).toBe(ApplicantStatus.Failed);
      expect((await readApplicantRow(tx, applicant.id))?.cooldownUntil).not.toBeNull();
      expect(await readTeacherRow(tx, applicant.id)).toBeNull();
      expect(await readExtensionAuditRows(tx, applicant.id)).toHaveLength(1);
    });
  });

  test("reject a NON-passed applicant denies with APPLICANT_OVERRIDE_NOT_PASSED and writes nothing", async () => {
    await runInRollback(async tx => {
      const applicant = await createTestUser(tx, { role: "teacher" });
      const admin = await createTestUser(tx, { role: "admin" });
      await createTestApplicant(tx, applicant.id, { status: "failed", cooldownUntil: null });

      const logSpy = silenceDomainLog();
      try {
        const error = await expectRepoError(() =>
          ApplicantLifecycleService.overrideApplicantEvaluation(
            applicant.id,
            AdminApplicantOverrideAction.Reject,
            30,
            admin.id,
            "en",
            tx
          )
        );

        expect(error).toBeInstanceOf(ValidationError);
        assertErrorCode(error, "APPLICANT_OVERRIDE_NOT_PASSED");
        expect(error.message).toBe(getServerTranslations("en").errorsTranslations.applicantOverrideNotPassed);
        expect(logSpy).toHaveBeenCalledTimes(1);
      } finally {
        logSpy.mockRestore();
      }

      const persisted = await readApplicantRow(tx, applicant.id);
      expect(persisted?.status).toBe(ApplicantStatus.Failed);
      expect(persisted?.cooldownUntil).toBeNull();
      expect(await readExtensionAuditRows(tx, applicant.id)).toHaveLength(0);
    });
  });

  test("reject with an out-of-bounds cooldownDays (0 / 9999 / fractional / null) denies with APPLICANT_OVERRIDE_COOLDOWN_INVALID before any write", async () => {
    await runInRollback(async tx => {
      const applicant = await createTestUser(tx, { role: "teacher" });
      const admin = await createTestUser(tx, { role: "admin" });
      await createTestApplicant(tx, applicant.id, { status: "passed", cooldownUntil: null });

      // All four day-window denials are pre-write validation rejections
      // (order-independent), so the calls are BATCHED instead of awaited
      // sequentially inside a loop; each thunk resolves to its caught error.
      const errors = await Promise.all(
        [0, 9999, 2.5, null].map(invalidDays =>
          expectRepoError(() =>
            ApplicantLifecycleService.overrideApplicantEvaluation(
              applicant.id,
              AdminApplicantOverrideAction.Reject,
              invalidDays,
              admin.id,
              "en",
              tx
            )
          )
        )
      );
      for (const error of errors) {
        expect(error).toBeInstanceOf(ValidationError);
        assertErrorCode(error, "APPLICANT_OVERRIDE_COOLDOWN_INVALID");
        expect(error.message).toBe(getServerTranslations("en").errorsTranslations.applicantOverrideCooldownInvalid);
      }

      // The certified row never moved and no audit trail exists.
      expect((await readApplicantRow(tx, applicant.id))?.status).toBe(ApplicantStatus.Passed);
      expect(await readExtensionAuditRows(tx, applicant.id)).toHaveLength(0);
    });
  });

  // ─── Tier 1: grant re-evaluation — guarded clearance ─────────────

  test("grant re-evaluation CLEARS an active cooldown without touching the status (purchasability flips true) and the audit records the cleared instant", async () => {
    await runInRollback(async tx => {
      const applicant = await createTestUser(tx, { role: "teacher" });
      const admin = await createTestUser(tx, { role: "admin" });
      const activeCooldown = new Date(Date.now() + FUTURE_COOLDOWN_OFFSET_MS);
      await createTestApplicant(tx, applicant.id, { status: "failed", cooldownUntil: activeCooldown });

      const logSpy = silenceDomainLog();
      try {
        const profile = await ApplicantLifecycleService.overrideApplicantEvaluation(
          applicant.id,
          AdminApplicantOverrideAction.GrantReEvaluation,
          null,
          admin.id,
          "en",
          tx
        );

        // Status untouched; the waiting period is gone — the applicant may
        // re-purchase verification without waiting for expiry.
        expect(profile.status).toBe(ApplicantStatus.Failed);
        expect(profile.cooldownUntil).toBeNull();
        expect(profile.cooldownActive).toBe(false);
        expect(profile.cooldownState).toBe(ApplicantCooldownState.None);
        expect(profile.canPurchaseVerification).toBe(true);
      } finally {
        logSpy.mockRestore();
      }

      const persisted = await readApplicantRow(tx, applicant.id);
      expect(persisted?.status).toBe(ApplicantStatus.Failed);
      expect(persisted?.cooldownUntil).toBeNull();

      const auditRows = await readExtensionAuditRows(tx, applicant.id);
      expect(auditRows).toHaveLength(1);
      const audit = auditRows[0];
      expect(audit?.actionType).toBe(AuditActionType.Override);
      expect(audit?.actorId).toBe(admin.id);
      const details = parseAuditDetails(audit?.details ?? null);
      expect(details).toEqual({
        action: "grant_re_evaluation",
        field: "cooldown_until",
        from: activeCooldown.toISOString(),
        to: null,
      });
    });
  });

  test("grant with NO stamped cooldown denies with APPLICANT_NO_ACTIVE_COOLDOWN and writes nothing", async () => {
    await runInRollback(async tx => {
      const applicant = await createTestUser(tx, { role: "teacher" });
      const admin = await createTestUser(tx, { role: "admin" });
      await createTestApplicant(tx, applicant.id, { status: "failed", cooldownUntil: null });

      const logSpy = silenceDomainLog();
      try {
        const error = await expectRepoError(() =>
          ApplicantLifecycleService.overrideApplicantEvaluation(
            applicant.id,
            AdminApplicantOverrideAction.GrantReEvaluation,
            null,
            admin.id,
            "en",
            tx
          )
        );

        expect(error).toBeInstanceOf(ValidationError);
        assertErrorCode(error, "APPLICANT_NO_ACTIVE_COOLDOWN");
        expect(error.message).toBe(getServerTranslations("en").errorsTranslations.applicantNoActiveCooldown);
        expect(logSpy).toHaveBeenCalledTimes(1);
      } finally {
        logSpy.mockRestore();
      }

      const persisted = await readApplicantRow(tx, applicant.id);
      expect(persisted?.status).toBe(ApplicantStatus.Failed);
      expect(persisted?.cooldownUntil).toBeNull();
      expect(await readExtensionAuditRows(tx, applicant.id)).toHaveLength(0);
    });
  });

  test("grant on a PASSED applicant denies with APPLICANT_ALREADY_CERTIFIED (terminal beats the no-cooldown check)", async () => {
    await runInRollback(async tx => {
      const applicant = await createTestUser(tx, { role: "teacher" });
      const admin = await createTestUser(tx, { role: "admin" });
      await createTestApplicant(tx, applicant.id, { status: "passed", cooldownUntil: null });

      const error = await expectRepoError(() =>
        ApplicantLifecycleService.overrideApplicantEvaluation(
          applicant.id,
          AdminApplicantOverrideAction.GrantReEvaluation,
          null,
          admin.id,
          "en",
          tx
        )
      );

      assertErrorCode(error, "APPLICANT_ALREADY_CERTIFIED");
      expect(await readExtensionAuditRows(tx, applicant.id)).toHaveLength(0);
    });
  });

  // ─── Tier 4: the actor gate — zero writes, zero audit rows ─────

  test("a NON-ADMIN actor is denied by the service-side admin gate with zero writes and zero audit rows", async () => {
    await runInRollback(async tx => {
      const applicant = await createTestUser(tx, { role: "teacher" });
      const nonAdminActor = await createTestUser(tx, { role: "teacher" });
      const oldExpiry = new Date(Date.now() + FUTURE_COOLDOWN_OFFSET_MS);
      await createTestApplicant(tx, applicant.id, { status: "failed", cooldownUntil: oldExpiry });

      const error = await expectRepoError(() =>
        ApplicantLifecycleService.overrideApplicantEvaluation(
          applicant.id,
          AdminApplicantOverrideAction.GrantReEvaluation,
          null,
          nonAdminActor.id,
          "en",
          tx
        )
      );

      expect(error).toBeInstanceOf(ForbiddenError);
      expect(error.message).toContain(getServerTranslations("en").errorsTranslations.forbidden);

      // The gate runs BEFORE the override transaction opens — nothing moved.
      const persisted = await readApplicantRow(tx, applicant.id);
      expect(persisted?.cooldownUntil?.getTime()).toBe(oldExpiry.getTime());
      expect(await readExtensionAuditRows(tx, applicant.id)).toHaveLength(0);
    });
  });

  // ─── Bilingual: the override leaves resolve per locale ─────

  test("override denials resolve byte-equal per locale and DIFFER across them", async () => {
    await runInRollback(async tx => {
      const applicant = await createTestUser(tx, { role: "teacher" });
      const admin = await createTestUser(tx, { role: "admin" });
      await createTestApplicant(tx, applicant.id, { status: "pending", cooldownUntil: null });

      const arError = await expectRepoError(() =>
        ApplicantLifecycleService.overrideApplicantEvaluation(
          applicant.id,
          AdminApplicantOverrideAction.Reject,
          30,
          admin.id,
          "ar",
          tx
        )
      );
      const enError = await expectRepoError(() =>
        ApplicantLifecycleService.overrideApplicantEvaluation(
          applicant.id,
          AdminApplicantOverrideAction.Reject,
          30,
          admin.id,
          "en",
          tx
        )
      );

      assertErrorCode(arError, "APPLICANT_OVERRIDE_NOT_PASSED");
      assertErrorCode(enError, "APPLICANT_OVERRIDE_NOT_PASSED");
      expect(arError.message).toBe(getServerTranslations("ar").errorsTranslations.applicantOverrideNotPassed);
      expect(enError.message).toBe(getServerTranslations("en").errorsTranslations.applicantOverrideNotPassed);
      expect(arError.message).not.toBe(enError.message);
    });
  });
});

/**
 * Recipient-notification coverage for the override — every applied
 * direction persists exactly ONE `applicant_outcome` notification composed
 * in the APPLICANT's persisted locale (never the acting admin's), pointed
 * at the applicants row, and NEVER publishes on the caller-owned-tx path
 * (the publish belongs to the post-commit boundary). Denials persist zero
 * notification rows.
 */
describe("ApplicantLifecycleService.overrideApplicantEvaluation — recipient notifications", () => {
  test("certify persists exactly ONE applicant_outcome notification composed in the recipient's persisted locale with the applicants pointer", async () => {
    await runInRollback(async tx => {
      const applicant = await createTestUser(tx, { role: "teacher", locale: "en" });
      const admin = await createTestUser(tx, { role: "admin" });
      await createTestApplicant(tx, applicant.id, { status: "in_evaluation" });

      const logSpy = silenceDomainLog();
      try {
        await ApplicantLifecycleService.overrideApplicantEvaluation(
          applicant.id,
          AdminApplicantOverrideAction.Certify,
          null,
          admin.id,
          "ar",
          tx
        );
      } finally {
        logSpy.mockRestore();
      }

      const rows = await readOutcomeNotificationRows(tx, applicant.id);
      expect(rows).toHaveLength(1);
      const row = rows[0];
      const enCopy = getServerTranslations("en").notificationsTranslations;
      expect(row?.title).toBe(enCopy.eventApplicantOverrideCertifiedTitle);
      expect(row?.body).toBe(enCopy.eventApplicantOverrideCertifiedBody);
      expect(row?.isRead).toBe(false);
      expect(row?.relatedEntityType).toBe("applicants");
      expect(row?.relatedEntityId).toBe(applicant.id);
    });
  });

  test("reject body threads the validated day window through the recipient's locale grammar (en + ar rows resolved per recipient)", async () => {
    await runInRollback(async tx => {
      const enApplicant = await createTestUser(tx, { role: "teacher", locale: "en" });
      const arApplicant = await createTestUser(tx, { role: "teacher", locale: "ar" });
      const admin = await createTestUser(tx, { role: "admin" });
      await createTestApplicant(tx, enApplicant.id, { status: "passed", cooldownUntil: null });
      await createTestApplicant(tx, arApplicant.id, { status: "passed", cooldownUntil: null });

      const logSpy = silenceDomainLog();
      try {
        await ApplicantLifecycleService.overrideApplicantEvaluation(
          enApplicant.id,
          AdminApplicantOverrideAction.Reject,
          30,
          admin.id,
          "ar",
          tx
        );
        await ApplicantLifecycleService.overrideApplicantEvaluation(
          arApplicant.id,
          AdminApplicantOverrideAction.Reject,
          30,
          admin.id,
          "en",
          tx
        );
      } finally {
        logSpy.mockRestore();
      }

      // Each recipient got HIS OWN locale's copy — the caller's locale is
      // irrelevant (both calls above pass the opposite locale on purpose).
      const enRows = await readOutcomeNotificationRows(tx, enApplicant.id);
      expect(enRows).toHaveLength(1);
      const enCopy = getServerTranslations("en").notificationsTranslations;
      expect(enRows[0]?.title).toBe(enCopy.eventApplicantOverrideRejectedTitle);
      expect(enRows[0]?.body).toBe(enCopy.eventApplicantOverrideRejectedBody(30));
      expect(enRows[0]?.body).toContain("30 days");

      const arRows = await readOutcomeNotificationRows(tx, arApplicant.id);
      expect(arRows).toHaveLength(1);
      const arCopy = getServerTranslations("ar").notificationsTranslations;
      expect(arRows[0]?.title).toBe(arCopy.eventApplicantOverrideRejectedTitle);
      expect(arRows[0]?.body).toBe(arCopy.eventApplicantOverrideRejectedBody(30));
    });
  });

  test("grant re-evaluation persists exactly ONE applicant_outcome notification and the row is unread", async () => {
    await runInRollback(async tx => {
      const applicant = await createTestUser(tx, { role: "teacher", locale: "ar" });
      const admin = await createTestUser(tx, { role: "admin" });
      const activeCooldown = new Date(Date.now() + FUTURE_COOLDOWN_OFFSET_MS);
      await createTestApplicant(tx, applicant.id, { status: "failed", cooldownUntil: activeCooldown });

      const logSpy = silenceDomainLog();
      try {
        await ApplicantLifecycleService.overrideApplicantEvaluation(
          applicant.id,
          AdminApplicantOverrideAction.GrantReEvaluation,
          null,
          admin.id,
          "en",
          tx
        );
      } finally {
        logSpy.mockRestore();
      }

      const rows = await readOutcomeNotificationRows(tx, applicant.id);
      expect(rows).toHaveLength(1);
      const arCopy = getServerTranslations("ar").notificationsTranslations;
      expect(rows[0]?.title).toBe(arCopy.eventApplicantOverrideReEvaluationTitle);
      expect(rows[0]?.body).toBe(arCopy.eventApplicantOverrideReEvaluationBody);
      expect(rows[0]?.isRead).toBe(false);
    });
  });

  test("the caller-owned-tx path NEVER publishes (zero publishReceipts calls — the publish belongs to the post-commit boundary)", async () => {
    await runInRollback(async tx => {
      const applicant = await createTestUser(tx, { role: "teacher" });
      const admin = await createTestUser(tx, { role: "admin" });
      await createTestApplicant(tx, applicant.id, { status: "in_evaluation" });

      const publishSpy = spyOn(NotificationEngine, "publishReceipts").mockImplementation(async () => {});
      const logSpy = silenceDomainLog();
      try {
        await ApplicantLifecycleService.overrideApplicantEvaluation(
          applicant.id,
          AdminApplicantOverrideAction.Certify,
          null,
          admin.id,
          "en",
          tx
        );
        // The notification persisted (the emit is in-tx)…
        expect(await readOutcomeNotificationRows(tx, applicant.id)).toHaveLength(1);
        // …but nothing was pushed to any channel on the caller-owned path.
        expect(publishSpy).not.toHaveBeenCalled();
      } finally {
        logSpy.mockRestore();
        publishSpy.mockRestore();
      }
    });
  });

  test("a denied override (already-certified) persists ZERO notification rows", async () => {
    await runInRollback(async tx => {
      const applicant = await createTestUser(tx, { role: "teacher" });
      const admin = await createTestUser(tx, { role: "admin" });
      await createTestApplicant(tx, applicant.id, { status: "passed", cooldownUntil: null });

      const logSpy = silenceDomainLog();
      try {
        const error = await expectRepoError(() =>
          ApplicantLifecycleService.overrideApplicantEvaluation(
            applicant.id,
            AdminApplicantOverrideAction.Certify,
            null,
            admin.id,
            "en",
            tx
          )
        );
        assertErrorCode(error, "APPLICANT_ALREADY_CERTIFIED");
        expect(await readOutcomeNotificationRows(tx, applicant.id)).toHaveLength(0);
      } finally {
        logSpy.mockRestore();
      }
    });
  });
});
