/**
 * Admin user-management helpers — phone-gate wiring suite for
 * `validateCreateInput` / `validateUpdatePatch` (plus the `buildUpdatePatch`
 * whitelist they feed). See `docs/admin/user-management.md`.
 *
 * WHAT THIS LOCKS
 *   1. BRANCH COMPLETENESS — the create path validates its phone through the
 *      shared backend gate (`validatePhoneField`), so missing / malformed /
 *      over-length numbers reject with the same localized field errors the
 *      public registration surface emits; the update path keeps its
 *      skip / write-through semantics (absent, `undefined`, `null`, and
 *      empty / whitespace-only strings all skip validation — the wire
 *      normalizes an explicit `null` to absent before the patch is built,
 *      and an empty / whitespace-only string is stored verbatim, NOT
 *      cleared) and validates only non-empty values.
 *   2. BOUNDARIES — the 16/17-character E.164 ceiling through BOTH
 *      validators, whitespace-only shapes on each side of the create/update
 *      asymmetry, and the explicit-`undefined` patch member.
 *   3. FUZZ / CONCURRENCY — a deterministic hostile corpus must produce
 *      EXACTLY the shared gate's verdict on every path (single source of
 *      truth), and concurrent probes (pure and DB-backed, via
 *      `Promise.allSettled`) agree with sequential execution.
 *   4. SECURITY — the patch whitelist drops smuggled fields (`role`, `id`,
 *      `isBlocked`) before any write; invalid phones write NOTHING; a valid
 *      phone persists verbatim; student onboarding inherits the gate through
 *      `createUser` with zero onboarding code (both the malformed and the
 *      required branches — create semantics, not the update path's
 *      verbatim-empty handling);
 *      the admin create/update surface stays admin-only for real
 *      (non-fabricated) actors.
 *   5. LOCALE THREADING — the ar locale reaches the DB-backed service
 *      rejections (this file's pure tiers already pin the en×ar mapping
 *      matrix on both validators; `registration.service.test.ts` owns the
 *      registration-side ar tier).
 *
 * Pure tiers run with no DB. DB-touching tiers run inside `runInRollback`
 * with the `tx` propagated to every service call, and every induced
 * rejection is captured through a try/catch helper — never a pinned
 * `.rejects.toThrow()` inside the rollback wrapper. No external channel is
 * reachable on any path here: validation precedes every write, so a denied
 * call touches nothing but the rolled-back transaction.
 *
 * Runs via the mandated runner:
 * `bun run test/scripts/run-test.ts backend/services/admin/user-management.helpers.test.ts`. *
 * COUNTRY BRIDGE COVERAGE (merged from the country-selector plan) — the pure update-path country bridge
 * (`buildUpdatePatch`) plus the defense-in-depth `validateUpdatePatch` guard
 * for the service-derived `countryCode` twin.
 *
 * Why a dedicated pure tier: the admin EDIT dialog now submits the shared
 * `CountrySelector`'s ISO code, while the `AdminUpdateUserInput.country`
 * wire field stays legacy nullable `String` (pinned by
 * `country-input-retype.wire.test.ts`). The bridge is the contract that
 * keeps every write path on ONE row shape — `countryCode` non-null ⟺
 * `country` is a dataset display name — for every historical spelling the
 * surface has ever accepted:
 *  - canonical codes ("EG") and padded/lowercase variants (" eg ") resolve
 *    onto the code + English display-name pair,
 *  - legacy display text ("Egypt" — what the free-text edit field and older
 *    consumers sent) resolves through the same case-insensitive index the
 *    directory-filter URL seed uses, so a legacy patch UPDATES the twin
 *    instead of erasing it,
 *  - truly unresolvable free text keeps its legacy shape (raw text +
 *    `countryCode: null`) rather than persisting an unmapped code,
 *  - the audit `changedFields` projection therefore includes `countryCode`
 *    whenever a country value is patched (pinned through the service suite).
 *
 * The create path is intentionally NOT bridged here — its wire input is
 * already the `CountryCode` scalar and `buildCreateUserInsert` pins the
 * strict normalize→membership pipeline (covered by the service suite).
 *
 * Pure unit tier — NO DB, NO server boot, NO disk writes. Runs via the
 * mandated runner:
 *   bun run test/scripts/run-test.ts backend/services/admin/user-management.helpers.test.ts
 */

/**
/**
 * Admin user-management helpers tests — the pure update-path country bridge
 * (`buildUpdatePatch`) plus the defense-in-depth `validateUpdatePatch` guard
 * for the service-derived `countryCode` twin.
 *
 * Why a dedicated pure tier: the admin EDIT dialog now submits the shared
 * `CountrySelector`'s ISO code, while the `AdminUpdateUserInput.country`
 * wire field stays legacy nullable `String` (pinned by
 * `country-input-retype.wire.test.ts`). The bridge is the contract that
 * keeps every write path on ONE row shape — `countryCode` non-null ⟺
 * `country` is a dataset display name — for every historical spelling the
 * surface has ever accepted:
 *  - canonical codes ("EG") and padded/lowercase variants (" eg ") resolve
 *    onto the code + English display-name pair,
 *  - legacy display text ("Egypt" — what the free-text edit field and older
 *    consumers sent) resolves through the same case-insensitive index the
 *    directory-filter URL seed uses, so a legacy patch UPDATES the twin
 *    instead of erasing it,
 *  - truly unresolvable free text keeps its legacy shape (raw text +
 *    `countryCode: null`) rather than persisting an unmapped code,
 *  - the audit `changedFields` projection therefore includes `countryCode`
 *    whenever a country value is patched (pinned through the service suite).
 *
 * The create path is intentionally NOT bridged here — its wire input is
 * already the `CountryCode` scalar and `buildCreateUserInsert` pins the
 * strict normalize→membership pipeline (covered by the service suite).
 *
 * Pure unit tier — NO DB, NO server boot, NO disk writes. Runs via the
 * mandated runner:
 *   bun run test/scripts/run-test.ts backend/services/admin/user-management.helpers.test.ts
 */

import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { auditLogs } from "@/backend/db/schema/audit/audit-logs";
import { users } from "@/backend/db/schema/users/users";
import { createTestPlan, createTestStudent, createTestUser } from "@/backend/db/test/entity-setup";
import { expectRepoError, runInRollback } from "@/backend/db/test/test-utils";
import { PaymentGateway } from "@/backend/enum/billing/payment-gateway.enum";
import { SubscriptionCreditLane } from "@/backend/enum/billing/subscription-credit-lane.enum";
import { Gender } from "@/backend/enum/users/gender.enum";
import { UserRole } from "@/backend/enum/users/user-role.enum";
import { ForbiddenError, UnauthorizedError, ValidationError } from "@/backend/lib/errors";
import { logger } from "@/backend/lib/logger";
import { StudentOnboardingService } from "@/backend/services/admin/student-onboarding.service";
import {
  buildUpdatePatch,
  validateCreateInput,
  validateUpdatePatch,
} from "@/backend/services/admin/user-management.helpers";
import { AdminUserManagementService } from "@/backend/services/admin/user-management.service";
import { validatePhoneField } from "@/backend/services/shared";
import type {
  AdminCreateUserSubmitInput,
  AdminOnboardStudentSubmitInput,
  AdminUpdateUserPatchInput,
  AdminUserUpdateDbPatch,
  ApiFieldErrorType,
  DBTransaction,
  PlanSelectType,
} from "@/backend/types";
import { COUNTRIES } from "@/shared/constants/countries";
import { getServerTranslations } from "@/shared/locale/server-graphql";
import { ANONYMOUS_ACTOR_ID } from "@/test/workflows/helpers/journey-actor-fixtures";

const LOCALE = "en";
const EN = getServerTranslations("en");
const AR = getServerTranslations("ar");

const VALID_PHONE = "+201001234567";
const PHONE_16_CHARS = "+201001234567890"; // leading `+` + 15 digits = the E.164 ceiling
const PHONE_17_CHARS = `${PHONE_16_CHARS}1`; // one digit past the ceiling
const UNFORMATTED_SHORT = "12345"; // no `+`, too short — the malformed-shape probe

/** Weak fixture credential — never reused in production paths. */
const TEST_CREDENTIAL = "testPassword123";

/**
 * Registry of every spy created during the currently running test. bun's
 * `spyOn` reuses ONE mock per object+method pair until restored, so an
 * unrestored mock leaks call counts into later tests — every spy is tracked
 * here and restored by the file-level `afterEach`.
 */
const trackedSpies: Array<{ restore(): void }> = [];

afterEach(() => {
  for (const entry of trackedSpies) {
    entry.restore();
  }
  trackedSpies.length = 0;
});

/** Silences `logger.logDomainError` so denial probes keep test output compact. */
function silenceDomainLog(): void {
  const spy = spyOn(logger, "logDomainError").mockImplementation(() => {});
  trackedSpies.push({ restore: () => spy.mockRestore() });
}

/**
 * Synchronous analog of the mandated `expectRepoError` try/catch pattern:
 * the validators under test are synchronous, so a pinned `.rejects`
 * assertion is impossible and per-test manual catches are prohibited.
 * Returns the caught `ValidationError`, or `null` when the call passes; a
 * non-`ValidationError` throw propagates to fail the test loudly.
 */
function caughtValidationError(validate: () => void): ValidationError | null {
  try {
    validate();
    return null;
  } catch (error) {
    if (!(error instanceof ValidationError)) {
      throw error;
    }
    return error;
  }
}

/** The single phone entry of a validation error's fields payload (if any). */
function phoneEntryOf(error: ValidationError): ApiFieldErrorType | undefined {
  return (error.fields ?? []).find(entry => entry.field === "phone");
}

/** Asserts a caught rejection carries EXACTLY the expected phone entry. */
function expectPhoneEntry(error: ValidationError | null, expected: ApiFieldErrorType): void {
  if (!error) {
    throw new Error("expected a ValidationError, but the call passed");
  }
  const entry = phoneEntryOf(error);
  if (!entry) {
    throw new Error(`expected a phone entry in the fields payload, got: ${JSON.stringify(error.fields ?? [])}`);
  }
  expect(entry).toEqual(expected);
}

/** Builds an otherwise-valid create input whose only variable is the phone. */
function makeCreateInput(phone: string): AdminCreateUserSubmitInput {
  return {
    fullName: `Phone Probe ${randomUUID().slice(0, 8)}`,
    email: `phone-probe-${randomUUID()}@test.local`,
    phone,
    password: TEST_CREDENTIAL,
    country: "EG",
    role: "student",
  };
}

/** Builds an update patch whose only member is the given phone value. */
function makePhonePatch(phone: string): AdminUpdateUserPatchInput {
  return { phone };
}

/** Counts users rows carrying the given email (the zero-write anchor). */
async function countUsersWithEmail(tx: DBTransaction, email: string): Promise<number> {
  return tx.$count(users, eq(users.email, email));
}

/** Counts audit rows attributable to one actor (the denial zero-write oracle). */
async function countAuditsForActor(tx: DBTransaction, actorId: number): Promise<number> {
  return tx.$count(auditLogs, eq(auditLogs.actorId, actorId));
}

/** Raw users-row read (bypasses mappers so storage is asserted directly). */
async function readUserRow(tx: DBTransaction, id: number) {
  const [row] = await tx.select().from(users).where(eq(users.id, id)).limit(1);
  return row ?? null;
}

/** Per-test run tag — keeps onboarding emails and payment references unique. */
let runTag = 0;

/** Builds an onboarding submit input whose only variable is the phone. */
function makeOnboardInput(phone: string): AdminOnboardStudentSubmitInput {
  runTag += 1;
  return {
    fullName: `Onboarded Student ${runTag}`,
    email: `onboard-${runTag}-${randomUUID().slice(0, 8)}@test.local`,
    phone,
    password: TEST_CREDENTIAL,
    gender: undefined,
    country: "EG",
    parentId: null,
    planId: 0,
    paymentMethod: PaymentGateway.OfflineCash,
    paymentReference: `SVC-REF-${runTag}-${randomUUID().slice(0, 8)}`,
  };
}

/** One lane-bearing plan (the Hifz lane, 8 sessions, 30-day interval). */
function createLaneBearingPlan(tx: DBTransaction): Promise<PlanSelectType> {
  return createTestPlan(tx, {
    sessionCount: 8,
    intervalDays: 30,
    price: "200.00",
    balanceLane: SubscriptionCreditLane.Hifz,
  });
}

/**
 * Type-guard / assertion helper: narrows a caught `Error` to
 * `ValidationError` via a real `instanceof` runtime check — the
 * `no-unsafe-type-assertion`-safe alternative to `error as ValidationError`.
 */
function asValidationError(error: Error): ValidationError {
  if (!(error instanceof ValidationError)) {
    throw new Error(
      `expected a ValidationError instance, got ${error.constructor?.name ?? "unknown"}: ${error.message}`
    );
  }
  return error;
}

/** Catches a synchronous validator throw and returns the narrowed error. */
function catchValidationError(run: () => void): ValidationError {
  try {
    run();
  } catch (caught) {
    return asValidationError(caught instanceof Error ? caught : new Error(String(caught)));
  }
  throw new Error("expected the validator to throw, but it returned normally");
}

describe("validateCreateInput — phone routed through the shared gate (pure)", () => {
  test("a valid E.164 phone passes in en and ar", () => {
    expect(caughtValidationError(() => validateCreateInput(makeCreateInput(VALID_PHONE), "en"))).toBeNull();
    expect(caughtValidationError(() => validateCreateInput(makeCreateInput(VALID_PHONE), "ar"))).toBeNull();
  });

  test("missing phone → PHONE_REQUIRED with the exact localized entry", () => {
    for (const [locale, t] of [
      ["en", EN],
      ["ar", AR],
    ] as const) {
      const error = caughtValidationError(() => validateCreateInput(makeCreateInput(""), locale));
      expectPhoneEntry(error, { field: "phone", code: "PHONE_REQUIRED", message: t.authTranslations.phoneRequired });
      // Single-failure contract: the top-level message is the FIRST entry's.
      if (!error) throw new Error("expected a ValidationError");
      expect(error.message).toBe(t.authTranslations.phoneRequired);
    }
  });

  test("unformatted '12345' phone → PHONE_INVALID with the exact localized entry", () => {
    for (const [locale, t] of [
      ["en", EN],
      ["ar", AR],
    ] as const) {
      const error = caughtValidationError(() => validateCreateInput(makeCreateInput(UNFORMATTED_SHORT), locale));
      expectPhoneEntry(error, { field: "phone", code: "PHONE_INVALID", message: t.authTranslations.phoneInvalid });
    }
  });

  test("17-char phone → PHONE_TOO_LONG with the errorsTranslations.validation entry", () => {
    for (const [locale, t] of [
      ["en", EN],
      ["ar", AR],
    ] as const) {
      const error = caughtValidationError(() => validateCreateInput(makeCreateInput(PHONE_17_CHARS), locale));
      expectPhoneEntry(error, { field: "phone", code: "PHONE_TOO_LONG", message: t.errorsTranslations.validation });
    }
  });
});

describe("validateUpdatePatch — patch semantics (pure)", () => {
  test("absent phone key → no rejection (leave-alone intent)", () => {
    const patch: AdminUserUpdateDbPatch = { fullName: "Only A Name" };
    expect(caughtValidationError(() => validateUpdatePatch(patch, "en"))).toBeNull();
  });

  test("explicit undefined phone → no rejection", () => {
    const patch: AdminUserUpdateDbPatch = { fullName: "Only A Name", phone: undefined };
    expect(caughtValidationError(() => validateUpdatePatch(patch, "en"))).toBeNull();
  });

  test("null phone → no rejection (clear intent, nullable schema shape)", () => {
    const patch: AdminUserUpdateDbPatch = { fullName: "Only A Name", phone: null };
    expect(caughtValidationError(() => validateUpdatePatch(patch, "en"))).toBeNull();
  });

  test("empty-string phone → no rejection (stored verbatim, NOT cleared; never PHONE_REQUIRED)", () => {
    for (const locale of ["en", "ar"] as const) {
      expect(caughtValidationError(() => validateUpdatePatch(makePhonePatch(""), locale))).toBeNull();
    }
  });

  test("whitespace-only phone → no rejection (stored verbatim; the legacy length-only check also skipped it)", () => {
    for (const value of ["   ", "\t\n "]) {
      expect(caughtValidationError(() => validateUpdatePatch(makePhonePatch(value), "en"))).toBeNull();
    }
  });

  test("invalid non-empty phone '12345' → PHONE_INVALID with the exact localized entry", () => {
    for (const [locale, t] of [
      ["en", EN],
      ["ar", AR],
    ] as const) {
      const error = caughtValidationError(() => validateUpdatePatch(makePhonePatch(UNFORMATTED_SHORT), locale));
      expectPhoneEntry(error, { field: "phone", code: "PHONE_INVALID", message: t.authTranslations.phoneInvalid });
    }
  });

  test("17-char phone → PHONE_TOO_LONG with the errorsTranslations.validation entry", () => {
    for (const [locale, t] of [
      ["en", EN],
      ["ar", AR],
    ] as const) {
      const error = caughtValidationError(() => validateUpdatePatch(makePhonePatch(PHONE_17_CHARS), locale));
      expectPhoneEntry(error, { field: "phone", code: "PHONE_TOO_LONG", message: t.errorsTranslations.validation });
    }
  });

  test("a valid phone — with or without edge whitespace — passes", () => {
    expect(caughtValidationError(() => validateUpdatePatch(makePhonePatch(VALID_PHONE), "en"))).toBeNull();
    expect(caughtValidationError(() => validateUpdatePatch(makePhonePatch(`  ${VALID_PHONE}  `), "en"))).toBeNull();
  });
});

describe("Tier 2 — the 16/17 boundary and the create/update asymmetry", () => {
  test("16 chars parses in BOTH validators; 17 chars rejects with PHONE_TOO_LONG", () => {
    expect(caughtValidationError(() => validateCreateInput(makeCreateInput(PHONE_16_CHARS), "en"))).toBeNull();
    expect(caughtValidationError(() => validateUpdatePatch(makePhonePatch(PHONE_16_CHARS), "en"))).toBeNull();
    const createError = caughtValidationError(() => validateCreateInput(makeCreateInput(PHONE_17_CHARS), "en"));
    expectPhoneEntry(createError, {
      field: "phone",
      code: "PHONE_TOO_LONG",
      message: EN.errorsTranslations.validation,
    });
    const updateError = caughtValidationError(() => validateUpdatePatch(makePhonePatch(PHONE_17_CHARS), "en"));
    expectPhoneEntry(updateError, {
      field: "phone",
      code: "PHONE_TOO_LONG",
      message: EN.errorsTranslations.validation,
    });
  });

  test("whitespace-only is REQUIRED on create but stored verbatim on update", () => {
    const createError = caughtValidationError(() => validateCreateInput(makeCreateInput("   "), "en"));
    expectPhoneEntry(createError, {
      field: "phone",
      code: "PHONE_REQUIRED",
      message: EN.authTranslations.phoneRequired,
    });
    expect(caughtValidationError(() => validateUpdatePatch(makePhonePatch("   "), "en"))).toBeNull();
  });
});

describe("Tier 3 — fuzz + concurrency: the shared gate is the single verdict", () => {
  const FUZZ_CORPUS: readonly string[] = [
    "",
    " ",
    "\t\n\r ",
    "\u0000",
    "\u0000+201001234567",
    "+2010\n0123456",
    "\u202E+201001234567",
    "+٢٠١٠٠١٢٣٤٥٦",
    "+20abc1234",
    "++201001234567",
    "+20 (100) 123-4567",
    "%20_OR_1%3D1--",
    "'; DROP TABLE users; --",
    "\u0024{phone}",
    "admin@kottaby.test+phone",
    "+".repeat(17),
    "9".repeat(10_000),
    " +201001234567 ",
    "+20100123456789012345",
  ];

  test("create-path fuzz verdict equals the shared gate's verdict (en + ar)", () => {
    for (const payload of FUZZ_CORPUS) {
      for (const locale of ["en", "ar"] as const) {
        const expected = validatePhoneField(payload, locale);
        const error = caughtValidationError(() => validateCreateInput(makeCreateInput(payload), locale));
        if (expected === null) {
          expect(error).toBeNull();
        } else {
          expectPhoneEntry(error, expected);
        }
      }
    }
  });

  test("update-path fuzz verdict equals the shared gate's verdict for non-empty values", () => {
    for (const payload of FUZZ_CORPUS) {
      for (const locale of ["en", "ar"] as const) {
        const error = caughtValidationError(() => validateUpdatePatch(makePhonePatch(payload), locale));
        if (payload.trim().length === 0) {
          // Clearing shapes skip validation — the gate is never consulted.
          expect(error).toBeNull();
          continue;
        }
        const expected = validatePhoneField(payload, locale);
        if (expected === null) {
          // Edge-whitespace-tolerated valid values pass the update path too.
          expect(error).toBeNull();
        } else {
          expectPhoneEntry(error, expected);
        }
      }
    }
  });

  test("concurrent create/update probes agree with sequential results (Promise.allSettled)", async () => {
    const concurrentVerdicts = await Promise.allSettled(
      FUZZ_CORPUS.map((payload, index) => {
        const isCreate = index % 2 === 0;
        return Promise.resolve().then(() =>
          isCreate
            ? caughtValidationError(() => validateCreateInput(makeCreateInput(payload), "en"))
            : caughtValidationError(() => validateUpdatePatch(makePhonePatch(payload), "en"))
        );
      })
    );
    expect(concurrentVerdicts.every(outcome => outcome.status === "fulfilled")).toBe(true);

    FUZZ_CORPUS.forEach((payload, index) => {
      const settledOutcome = concurrentVerdicts[index];
      if (settledOutcome?.status !== "fulfilled") {
        throw new Error(`concurrent probe ${index} did not fulfill`);
      }
      const isCreate = index % 2 === 0;
      const sequential = isCreate
        ? caughtValidationError(() => validateCreateInput(makeCreateInput(payload), "en"))
        : caughtValidationError(() => validateUpdatePatch(makePhonePatch(payload), "en"));
      const concurrentError = settledOutcome.value;
      if (sequential === null) {
        expect(concurrentError).toBeNull();
        return;
      }
      if (!concurrentError) {
        throw new Error(`concurrent probe ${index} passed where sequential run rejected`);
      }
      expect(phoneEntryOf(concurrentError)).toEqual(phoneEntryOf(sequential));
    });
  });

  test("concurrent admin creates with hostile phones reject and write nothing", async () => {
    await runInRollback(async tx => {
      const admin = await createTestUser(tx, { role: "admin" });
      const first = makeCreateInput(UNFORMATTED_SHORT);
      const second = makeCreateInput(PHONE_17_CHARS);

      const settled = await Promise.allSettled([
        AdminUserManagementService.createUser(first, admin.id, LOCALE, tx),
        AdminUserManagementService.createUser(second, admin.id, LOCALE, tx),
      ]);
      expect(settled.every(outcome => outcome.status === "rejected")).toBe(true);
      if (settled[0].status !== "rejected" || settled[1].status !== "rejected") {
        throw new Error("expected both concurrent creates to reject");
      }
      const firstError = settled[0].reason;
      const secondError = settled[1].reason;
      expect(firstError).toBeInstanceOf(ValidationError);
      expect(secondError).toBeInstanceOf(ValidationError);
      if (!(firstError instanceof ValidationError) || !(secondError instanceof ValidationError)) {
        throw new Error("expected ValidationError instances");
      }
      expectPhoneEntry(firstError, {
        field: "phone",
        code: "PHONE_INVALID",
        message: EN.authTranslations.phoneInvalid,
      });
      expectPhoneEntry(secondError, {
        field: "phone",
        code: "PHONE_TOO_LONG",
        message: EN.errorsTranslations.validation,
      });

      // Validation precedes every write: no user row and no audit row exists.
      expect(await countUsersWithEmail(tx, first.email)).toBe(0);
      expect(await countUsersWithEmail(tx, second.email)).toBe(0);
      expect(await countAuditsForActor(tx, admin.id)).toBe(0);
    });
  });
});

describe("ar locale threads through the DB-backed admin service paths", () => {
  test("createUser and updateUser rejections carry the ar localized templates", async () => {
    await runInRollback(async tx => {
      silenceDomainLog();
      const admin = await createTestUser(tx, { role: "admin" });
      const target = await createTestUser(tx, { role: "student" });
      const targetBefore = await readUserRow(tx, target.id);

      const createInput = makeCreateInput(UNFORMATTED_SHORT);
      const createError = await expectRepoError(() =>
        AdminUserManagementService.createUser(createInput, admin.id, "ar", tx)
      );
      expect(createError).toBeInstanceOf(ValidationError);
      if (!(createError instanceof ValidationError)) throw new Error("expected a ValidationError");
      expectPhoneEntry(createError, {
        field: "phone",
        code: "PHONE_INVALID",
        message: AR.authTranslations.phoneInvalid,
      });

      const updateError = await expectRepoError(() =>
        AdminUserManagementService.updateUser(target.id, makePhonePatch(PHONE_17_CHARS), admin.id, "ar", tx)
      );
      expect(updateError).toBeInstanceOf(ValidationError);
      if (!(updateError instanceof ValidationError)) throw new Error("expected a ValidationError");
      expectPhoneEntry(updateError, {
        field: "phone",
        code: "PHONE_TOO_LONG",
        message: AR.errorsTranslations.validation,
      });

      // Both rejections fired at the gate: nothing written anywhere.
      expect(await countUsersWithEmail(tx, createInput.email)).toBe(0);
      expect(await readUserRow(tx, target.id)).toEqual(targetBefore);
    });
  });
});

describe("Tier 4 — BOPLA: the patch whitelist is the only write channel", () => {
  test("buildUpdatePatch keeps whitelisted keys and drops smuggled extras", () => {
    const smuggled: AdminUpdateUserPatchInput = { phone: VALID_PHONE, fullName: "Kept Name" };
    // Intermediate const keeps the hostile fixture value out of a literal
    // password-named key (matches the sibling service-suite pattern).
    const smuggledHashValue = "smuggledHashValue0123";
    Object.assign(smuggled, {
      role: "admin",
      id: 424242,
      isBlocked: true,
      passwordHash: smuggledHashValue,
      email: `smuggled-${randomUUID()}@test.local`,
    });
    expect(buildUpdatePatch(smuggled)).toEqual({ phone: VALID_PHONE, fullName: "Kept Name" });
  });

  test("updateUser writes only the phone — smuggled role/id/isBlocked never land", async () => {
    await runInRollback(async tx => {
      const admin = await createTestUser(tx, { role: "admin" });
      const target = await createTestUser(tx, { role: "student" });
      await createTestStudent(tx, target.id);
      const bystander = await createTestUser(tx, { role: "parent" });
      const targetBefore = await readUserRow(tx, target.id);
      const bystanderBefore = await readUserRow(tx, bystander.id);

      // Transport-tamper simulation: a typed phone patch with hostile extras
      // merged at runtime. The field-by-field whitelist must drop them all.
      const patchedPhone = "+201100000222";
      const smuggled: AdminUpdateUserPatchInput = { phone: patchedPhone };
      Object.assign(smuggled, {
        role: "admin",
        id: bystander.id,
        isBlocked: true,
        email: `smuggled-${randomUUID()}@test.local`,
      });

      const result = await AdminUserManagementService.updateUser(target.id, smuggled, admin.id, LOCALE, tx);
      expect(result.phone).toBe(patchedPhone);
      expect(result.role).toBe(UserRole.Student);
      expect(result.isBlocked).toBe(false);

      const targetAfter = await readUserRow(tx, target.id);
      expect(targetAfter?.phone).toBe(patchedPhone);
      expect(targetAfter?.email).toBe(targetBefore?.email);
      expect(targetAfter?.isBlocked).toBe(false);
      // The smuggled `id` must not redirect the write at the bystander row.
      const bystanderAfter = await readUserRow(tx, bystander.id);
      expect(bystanderAfter).toEqual(bystanderBefore);
    });
  });

  test("updateUser with an invalid phone rejects with PHONE_INVALID and leaves the row byte-identical", async () => {
    await runInRollback(async tx => {
      const admin = await createTestUser(tx, { role: "admin" });
      const target = await createTestUser(tx, { role: "student" });
      const before = await readUserRow(tx, target.id);
      silenceDomainLog();

      const error = await expectRepoError(() =>
        AdminUserManagementService.updateUser(target.id, makePhonePatch(UNFORMATTED_SHORT), admin.id, LOCALE, tx)
      );
      expect(error).toBeInstanceOf(ValidationError);
      if (!(error instanceof ValidationError)) throw new Error("expected a ValidationError");
      expectPhoneEntry(error, { field: "phone", code: "PHONE_INVALID", message: EN.authTranslations.phoneInvalid });
      expect(await readUserRow(tx, target.id)).toEqual(before);
    });
  });

  test("updateUser with an empty-string phone stores it verbatim (never cleared) without error", async () => {
    await runInRollback(async tx => {
      const admin = await createTestUser(tx, { role: "admin" });
      const target = await createTestUser(tx, { role: "student" });

      const result = await AdminUserManagementService.updateUser(target.id, makePhonePatch(""), admin.id, LOCALE, tx);
      expect(result.phone).toBe("");
      expect((await readUserRow(tx, target.id))?.phone).toBe("");
    });
  });

  test("createUser persists a valid phone verbatim (the gate passes it through)", async () => {
    await runInRollback(async tx => {
      const admin = await createTestUser(tx, { role: "admin" });
      const input = makeCreateInput(VALID_PHONE);

      const created = await AdminUserManagementService.createUser(input, admin.id, LOCALE, tx);
      expect(created.phone).toBe(VALID_PHONE);
      expect((await readUserRow(tx, created.id))?.phone).toBe(VALID_PHONE);
    });
  });
});

describe("onboarding inherits the shared phone gate through createUser (delegation)", () => {
  test("onboardStudentWithOfflinePayment rejects an invalid phone with PHONE_INVALID", async () => {
    await runInRollback(async tx => {
      const admin = await createTestUser(tx, { role: "admin" });
      const plan = await createLaneBearingPlan(tx);
      const input: AdminOnboardStudentSubmitInput = { ...makeOnboardInput(UNFORMATTED_SHORT), planId: plan.id };

      const error = await expectRepoError(() =>
        StudentOnboardingService.onboardStudentWithOfflinePayment(input, admin.id, LOCALE, tx)
      );
      expect(error).toBeInstanceOf(ValidationError);
      if (!(error instanceof ValidationError)) throw new Error("expected a ValidationError");
      expectPhoneEntry(error, { field: "phone", code: "PHONE_INVALID", message: EN.authTranslations.phoneInvalid });
      // The inherited single-failure message contract survives delegation.
      expect(error.message).toBe(EN.authTranslations.phoneInvalid);

      // The inherited gate keeps CREATE semantics for the required branch
      // too: an empty phone is PHONE_REQUIRED on the delegated path (not
      // the update path's verbatim-empty handling).
      const requiredInput: AdminOnboardStudentSubmitInput = { ...makeOnboardInput(""), planId: plan.id };
      const requiredError = await expectRepoError(() =>
        StudentOnboardingService.onboardStudentWithOfflinePayment(requiredInput, admin.id, LOCALE, tx)
      );
      expect(requiredError).toBeInstanceOf(ValidationError);
      if (!(requiredError instanceof ValidationError)) throw new Error("expected a ValidationError");
      expectPhoneEntry(requiredError, {
        field: "phone",
        code: "PHONE_REQUIRED",
        message: EN.authTranslations.phoneRequired,
      });
      expect(requiredError.message).toBe(EN.authTranslations.phoneRequired);

      // The rejection fires before ANY write of the onboarding flow.
      expect(await countUsersWithEmail(tx, input.email)).toBe(0);
      expect(await countUsersWithEmail(tx, requiredInput.email)).toBe(0);
      expect(await countAuditsForActor(tx, admin.id)).toBe(0);
    });
  });
});

describe("BFLA — admin create/update stay admin-only (real actors, honest denial)", () => {
  test("a real student actor cannot reach createUser → ForbiddenError, zero writes", async () => {
    await runInRollback(async tx => {
      const student = await createTestUser(tx, { role: "student" });
      await createTestStudent(tx, student.id);
      silenceDomainLog();
      const input = makeCreateInput(VALID_PHONE);

      const error = await expectRepoError(() => AdminUserManagementService.createUser(input, student.id, LOCALE, tx));
      expect(error).toBeInstanceOf(ForbiddenError);
      expect(await countUsersWithEmail(tx, input.email)).toBe(0);
    });
  });

  test("an anonymous caller cannot reach createUser → UnauthorizedError", async () => {
    await runInRollback(async tx => {
      silenceDomainLog();
      const input = makeCreateInput(VALID_PHONE);

      const error = await expectRepoError(() =>
        AdminUserManagementService.createUser(input, ANONYMOUS_ACTOR_ID, LOCALE, tx)
      );
      expect(error).toBeInstanceOf(UnauthorizedError);
      expect(await countUsersWithEmail(tx, input.email)).toBe(0);
    });
  });

  test("a real student actor cannot reach updateUser → ForbiddenError", async () => {
    await runInRollback(async tx => {
      const student = await createTestUser(tx, { role: "student" });
      await createTestStudent(tx, student.id);
      silenceDomainLog();

      const error = await expectRepoError(() =>
        AdminUserManagementService.updateUser(student.id, makePhonePatch(VALID_PHONE), student.id, LOCALE, tx)
      );
      expect(error).toBeInstanceOf(ForbiddenError);
    });
  });
});

describe("buildUpdatePatch — country bridge onto the code + display-name pair", () => {
  test("canonical code persists the pair (EG → countryCode EG + English display name)", () => {
    const patch = buildUpdatePatch({ country: "EG" });
    expect(patch.countryCode).toBe("EG");
    expect(patch.country).toBe(COUNTRIES.EG.en);
  });

  test("padded + lowercase variant normalizes onto the pair ('  eg ' → EG)", () => {
    const patch = buildUpdatePatch({ country: "  eg " });
    expect(patch.countryCode).toBe("EG");
    expect(patch.country).toBe(COUNTRIES.EG.en);
  });

  test("legacy display text resolves through the shared seed bridge (Egypt → EG, twin updated not erased)", () => {
    const patch = buildUpdatePatch({ country: "Egypt" });
    expect(patch.countryCode).toBe("EG");
    expect(patch.country).toBe(COUNTRIES.EG.en);
  });

  test("unresolvable free text keeps the legacy shape (raw text + twin cleared to null)", () => {
    const patch = buildUpdatePatch({ country: "Wonderland" });
    expect(patch.country).toBe("Wonderland");
    expect(patch.countryCode).toBeNull();
  });

  test("empty string lands in the patch unchanged — validateUpdatePatch rejects it downstream", () => {
    // The service runs build → empty-patch check → validate, so the bridge
    // must not swallow the empty value: the validator owns the localized
    // COUNTRY_INVALID rejection the edit dialog projects.
    const patch = buildUpdatePatch({ country: "" });
    expect(patch.country).toBe("");
    expect(patch.countryCode).toBeNull();
  });

  test("country absent → no country keys in the patch (only touched columns land in SET)", () => {
    const patch = buildUpdatePatch({ fullName: "Renamed" });
    expect(patch.fullName).toBe("Renamed");
    expect("country" in patch).toBe(false);
    expect("countryCode" in patch).toBe(false);
  });

  test("other whitelisted fields pass through untouched alongside a bridged country", () => {
    const patch = buildUpdatePatch({
      fullName: "Renamed",
      phone: "+201000000001",
      country: "EG",
      gender: Gender.Female,
      dateOfBirth: "2000-01-01",
    });
    expect(patch.fullName).toBe("Renamed");
    expect(patch.phone).toBe("+201000000001");
    expect(patch.countryCode).toBe("EG");
    expect(patch.country).toBe(COUNTRIES.EG.en);
    expect(patch.gender).toBe(Gender.Female);
    expect(patch.dateOfBirth).toBe("2000-01-01");
  });

  test("BOPLA discipline — transport-tampered extra keys are structurally unreachable", () => {
    // The whitelist is compile-typed; this transport-tamper simulation
    // Object.assigns hostile extras at runtime (no `as unknown as` cast) to
    // prove the builder never copies unknown keys.
    const smuggled: AdminUpdateUserPatchInput = { country: "EG" };
    Object.assign(smuggled, { role: "admin", passwordHash: "x" });
    const patch = buildUpdatePatch(smuggled);
    expect(patch.countryCode).toBe("EG");
    expect(patch.country).toBe(COUNTRIES.EG.en);
    expect("role" in patch).toBe(false);
    expect("passwordHash" in patch).toBe(false);
  });
});

describe("validateUpdatePatch — defense-in-depth on the derived twin", () => {
  test("a bridged patch (code + name pair) passes", () => {
    const patch = buildUpdatePatch({ country: " eg " });
    expect(() => validateUpdatePatch(patch, "en")).not.toThrow();
  });

  test("a non-member countryCode fails closed on the `country` field path", () => {
    // Only reachable by a caller bypassing buildUpdatePatch — the guard keeps
    // the repo-facing invariant honest even then.
    const error = catchValidationError(() => validateUpdatePatch({ country: "Egypt", countryCode: "EGY" }, "en"));
    expect(error.fields?.[0]?.field).toBe("country");
    expect(error.fields?.[0]?.code).toBe("COUNTRY_INVALID");
  });

  test("a null countryCode twin is the legitimate legacy-clear arm, not a failure", () => {
    expect(() => validateUpdatePatch({ country: "Wonderland", countryCode: null }, "en")).not.toThrow();
  });

  test("legacy free-text country still validates on the length bounds (≤ 100)", () => {
    expect(() => validateUpdatePatch({ country: "Egypt" }, "en")).not.toThrow();
    const error = catchValidationError(() => validateUpdatePatch({ country: "c".repeat(101) }, "en"));
    expect(error.fields?.[0]?.field).toBe("country");
    expect(error.fields?.[0]?.code).toBe("COUNTRY_INVALID");
  });
});

describe("buildUpdatePatch — country bridge onto the code + display-name pair", () => {
  test("canonical code persists the pair (EG → countryCode EG + English display name)", () => {
    const patch = buildUpdatePatch({ country: "EG" });
    expect(patch.countryCode).toBe("EG");
    expect(patch.country).toBe(COUNTRIES.EG.en);
  });

  test("padded + lowercase variant normalizes onto the pair ('  eg ' → EG)", () => {
    const patch = buildUpdatePatch({ country: "  eg " });
    expect(patch.countryCode).toBe("EG");
    expect(patch.country).toBe(COUNTRIES.EG.en);
  });

  test("legacy display text resolves through the shared seed bridge (Egypt → EG, twin updated not erased)", () => {
    const patch = buildUpdatePatch({ country: "Egypt" });
    expect(patch.countryCode).toBe("EG");
    expect(patch.country).toBe(COUNTRIES.EG.en);
  });

  test("unresolvable free text keeps the legacy shape (raw text + twin cleared to null)", () => {
    const patch = buildUpdatePatch({ country: "Wonderland" });
    expect(patch.country).toBe("Wonderland");
    expect(patch.countryCode).toBeNull();
  });

  test("empty string lands in the patch unchanged — validateUpdatePatch rejects it downstream", () => {
    // The service runs build → empty-patch check → validate, so the bridge
    // must not swallow the empty value: the validator owns the localized
    // COUNTRY_INVALID rejection the edit dialog projects.
    const patch = buildUpdatePatch({ country: "" });
    expect(patch.country).toBe("");
    expect(patch.countryCode).toBeNull();
  });

  test("country absent → no country keys in the patch (only touched columns land in SET)", () => {
    const patch = buildUpdatePatch({ fullName: "Renamed" });
    expect(patch.fullName).toBe("Renamed");
    expect("country" in patch).toBe(false);
    expect("countryCode" in patch).toBe(false);
  });

  test("other whitelisted fields pass through untouched alongside a bridged country", () => {
    const patch = buildUpdatePatch({
      fullName: "Renamed",
      phone: "+201000000001",
      country: "EG",
      gender: Gender.Female,
      dateOfBirth: "2000-01-01",
    });
    expect(patch.fullName).toBe("Renamed");
    expect(patch.phone).toBe("+201000000001");
    expect(patch.countryCode).toBe("EG");
    expect(patch.country).toBe(COUNTRIES.EG.en);
    expect(patch.gender).toBe(Gender.Female);
    expect(patch.dateOfBirth).toBe("2000-01-01");
  });

  test("BOPLA discipline — transport-tampered extra keys are structurally unreachable", () => {
    // The whitelist is compile-typed; this transport-tamper simulation
    // Object.assigns hostile extras at runtime (no `as unknown as` cast) to
    // prove the builder never copies unknown keys.
    const smuggled: AdminUpdateUserPatchInput = { country: "EG" };
    Object.assign(smuggled, { role: "admin", passwordHash: "x" });
    const patch = buildUpdatePatch(smuggled);
    expect(patch.countryCode).toBe("EG");
    expect(patch.country).toBe(COUNTRIES.EG.en);
    expect("role" in patch).toBe(false);
    expect("passwordHash" in patch).toBe(false);
  });
});

describe("validateUpdatePatch — defense-in-depth on the derived twin", () => {
  test("a bridged patch (code + name pair) passes", () => {
    const patch = buildUpdatePatch({ country: " eg " });
    expect(() => validateUpdatePatch(patch, "en")).not.toThrow();
  });

  test("a non-member countryCode fails closed on the `country` field path", () => {
    // Only reachable by a caller bypassing buildUpdatePatch — the guard keeps
    // the repo-facing invariant honest even then.
    const error = catchValidationError(() => validateUpdatePatch({ country: "Egypt", countryCode: "EGY" }, "en"));
    expect(error.fields?.[0]?.field).toBe("country");
    expect(error.fields?.[0]?.code).toBe("COUNTRY_INVALID");
  });

  test("a null countryCode twin is the legitimate legacy-clear arm, not a failure", () => {
    expect(() => validateUpdatePatch({ country: "Wonderland", countryCode: null }, "en")).not.toThrow();
  });

  test("legacy free-text country still validates on the length bounds (≤ 100)", () => {
    expect(() => validateUpdatePatch({ country: "Egypt" }, "en")).not.toThrow();
    const error = catchValidationError(() => validateUpdatePatch({ country: "c".repeat(101) }, "en"));
    expect(error.fields?.[0]?.field).toBe("country");
    expect(error.fields?.[0]?.code).toBe("COUNTRY_INVALID");
  });
});
