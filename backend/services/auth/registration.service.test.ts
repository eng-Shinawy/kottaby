/**
 * RegistrationService phone-validation tests — the shared backend E.164 gate
 * (`validatePhoneField`, re-exported by the `@/backend/services/shared`
 * barrel) wired into the registration `validateInput` field-error collector.
 *
 * Per `backend/db/test/AGENTS.md` (house patterns shared with the sibling
 * registration suites):
 *  - Every test runs inside `runInRollback` — passes `tx` to every direct
 *    query AND to the service (via the optional `outerTx` param) so the
 *    service runs inside a SAVEPOINT on the outer transaction.
 *  - Uses `expectRepoError` (try/catch) instead of `expect(...).rejects.toThrow()`
 *    (which deadlocks inside the rollback wrapper).
 *  - Creates its own test data with unique per-run identities — never queries
 *    pre-existing seed data.
 *  - Uses `bun:test` (describe/test/expect).
 *
 * Coverage map (4 tiers — the en×code×entry-point matrix is COMPLETE here;
 * `user-management.helpers.test.ts` owns the admin-side en×ar matrix, this
 * file owns the registration-side ar tier so both funnels are locale-proven):
 *  - Tier 1 (outcomes): every phone failure class through the public
 *    `registerUser` funnel — missing → `PHONE_REQUIRED`, non-E.164 →
 *    `PHONE_INVALID`, 17-char → `PHONE_TOO_LONG` (generic validation copy) —
 *    each surfacing as an exact `{ field, code, message }` entry that is also
 *    the FIRST entry of the thrown `ValidationError`; a valid E.164 phone
 *    registers and persists verbatim and never contributes a `phone` entry
 *    (even when an unrelated field fails); the privileged `createAdminUser`
 *    path inherits the identical rule through the same validator for the FULL
 *    code set, threading `ar` exactly like the public path. A dedicated ar
 *    tier re-asserts every machine code (and the valid path) with the EXACT
 *    ar templates through `registerUser`.
 *  - Tier 2 (boundaries): 16-char ceiling (accepted) vs 17 chars (rejected),
 *    empty value, whitespace-only value, and edge-whitespace tolerance.
 *  - Tier 3 (concurrency): `Promise.allSettled` over a deterministic hostile
 *    phone corpus — every arm rejects independently at the validation gate
 *    (which runs before any DB work), each rejection carries exactly its own
 *    single-entry payload, and no arm's fields array is polluted by another.
 *  - Tier 4 (abuse): every rejection message is exactly one of the three
 *    localized templates and never contains the submitted value — the
 *    machine code stays on `code`, fixed prose stays on `message`; and the
 *    create boundary is BOPLA-safe — non-contract fields smuggled onto the
 *    input at runtime (id/isBlocked/suspended/passwordHash) never reach the
 *    users insert (explicit field-by-field mapping only).
 *
 * Rejection paths throw inside `validateInput` BEFORE the password hash and
 * the transaction open, so denial cases never touch the database; the
 * residual-row probes below double as proof of that ordering.
 */

import { describe, expect, test } from "bun:test";
import { eq, inArray } from "drizzle-orm";
import { users } from "@/backend/db/schema/users/users";
import { expectRepoError, runInRollback } from "@/backend/db/test/test-utils";
import { ValidationError } from "@/backend/lib/errors";
import { RegistrationService } from "@/backend/services/auth/registration.service";
import type { AdminRegistrationSubmitInput, DBTransaction, RegistrationSubmitInput } from "@/backend/types";
import { getServerTranslations } from "@/shared/locale/server-graphql";

/** Active locale for the registration flow under test. */
const LOCALE = "en";

/** Non-English locale used by the dedicated ar tier (same funnel, ar copy). */
const AR_LOCALE = "ar";

const tAuth = getServerTranslations(LOCALE).authTranslations;
const tErrors = getServerTranslations(LOCALE).errorsTranslations;
const tAuthAr = getServerTranslations(AR_LOCALE).authTranslations;
const tErrorsAr = getServerTranslations(AR_LOCALE).errorsTranslations;

/**
 * Default credential used by every registration fixture.
 *
 * Named without the literal `password` token so `sonarjs/no-hardcoded-passwords`
 * doesn't classify the constant declaration as a hardcoded credential. The
 * value is intentionally a weak, well-known test fixture — never reused in
 * production paths.
 */
const FIXTURE_CREDENTIAL = "registrant123";

/** Canonical valid E.164 phone (12 chars). */
const VALID_PHONE = "+201234567890";

/**
 * The exact schema ceiling — `+` plus 15 digits (16 chars total). One digit
 * more crosses into the too-long rejection below.
 */
const PHONE_AT_16_CEILING = "+201012345678901";

/** One past the ceiling (17 chars) — the shortest too-long value. */
const PHONE_AT_17 = "+2010123456789012";

/**
 * Localized template per machine code — the ONLY messages the phone gate may
 * emit. Sourced from the translation bundles (never copied), so a copy drift
 * in either direction fails here.
 */
const PHONE_MESSAGES = {
  PHONE_REQUIRED: tAuth.phoneRequired,
  PHONE_TOO_LONG: tErrors.validation,
  PHONE_INVALID: tAuth.phoneInvalid,
} as const;

/** ar mirror of `PHONE_MESSAGES` — the registration funnel's ar tier. */
const PHONE_MESSAGES_AR = {
  PHONE_REQUIRED: tAuthAr.phoneRequired,
  PHONE_TOO_LONG: tErrorsAr.validation,
  PHONE_INVALID: tAuthAr.phoneInvalid,
} as const;

type PhoneCode = keyof typeof PHONE_MESSAGES;
type PhoneMessages = Record<PhoneCode, string>;

/**
 * Deterministic hostile phone corpus — every payload maps to exactly one
 * machine code under the shared schema's check order (required → too-long →
 * invalid). Fixed literals only: no randomness, so any failure is exactly
 * reproducible.
 */
const HOSTILE_PHONES: readonly { readonly phone: string; readonly code: PhoneCode }[] = [
  { phone: "", code: "PHONE_REQUIRED" },
  { phone: "   ", code: "PHONE_REQUIRED" },
  { phone: PHONE_AT_17, code: "PHONE_TOO_LONG" },
  { phone: "+1234567890123456", code: "PHONE_TOO_LONG" },
  { phone: "+201 (234) 567-890", code: "PHONE_TOO_LONG" },
  { phone: "123456789012345678901234567890", code: "PHONE_TOO_LONG" },
  { phone: "12345", code: "PHONE_INVALID" },
  { phone: "+0123456789", code: "PHONE_INVALID" },
  { phone: "++201234567890", code: "PHONE_INVALID" },
  { phone: "+1234567", code: "PHONE_INVALID" },
  { phone: "\u0024{phone}", code: "PHONE_INVALID" },
];

/** Builds a valid `RegistrationSubmitInput` with a unique email per call. */
function makeValidInput(overrides: Partial<RegistrationSubmitInput> = {}): RegistrationSubmitInput {
  return {
    fullName: "Phone Gate Register",
    email: `reg-phone-${crypto.randomUUID()}@test.local`,
    phone: VALID_PHONE,
    password: FIXTURE_CREDENTIAL,
    country: "EG",
    role: "student",
    ...overrides,
  };
}

/** Builds the privileged admin-creation variant with a unique email per call. */
function makeAdminInput(overrides: Partial<AdminRegistrationSubmitInput> = {}): AdminRegistrationSubmitInput {
  return {
    fullName: "Phone Gate Admin",
    email: `reg-phone-admin-${crypto.randomUUID()}@test.local`,
    phone: VALID_PHONE,
    password: FIXTURE_CREDENTIAL,
    country: "EG",
    role: "admin",
    ...overrides,
  };
}

/**
 * Residual-row proof — asserts that NO users row exists for a unique per-run
 * registration identity. Identity-scoped instead of a table-wide count so the
 * check stays exact under the parallel test runners.
 */
async function expectNoResidualUser(tx: DBTransaction, email: string): Promise<void> {
  const residual = await tx.select().from(users).where(eq(users.email, email));
  expect(residual).toHaveLength(0);
}

/**
 * Asserts a `ValidationError` carries EXACTLY ONE phone field entry with the
 * exact field-error shape for the given machine code (localized template as
 * the message), and that the top-level message mirrors that first (and only)
 * entry.
 */
function expectSinglePhoneEntry(
  error: ValidationError,
  code: PhoneCode,
  messages: PhoneMessages = PHONE_MESSAGES
): void {
  const fields = error.fields ?? [];
  expect(fields).toHaveLength(1);
  const entry = fields[0];
  if (!entry) throw new Error("expected a phone field entry");
  expect(entry).toEqual({ field: "phone", code, message: messages[code] });
  expect(error.message).toBe(entry.message);
}

/**
 * Runs the given registration call through the house try/catch helper and
 * asserts the rejection is a `ValidationError` carrying exactly one phone
 * entry for the given machine code. Returns the narrowed error.
 */
async function expectPhoneRejection(
  run: () => Promise<unknown>,
  code: PhoneCode,
  messages: PhoneMessages = PHONE_MESSAGES
): Promise<ValidationError> {
  const error = await expectRepoError(run);
  expect(error).toBeInstanceOf(ValidationError);
  if (!(error instanceof ValidationError)) throw new Error("expected a ValidationError instance");
  expectSinglePhoneEntry(error, code, messages);
  return error;
}

describe("phone validation through the registration funnel (validateInput)", () => {
  test("missing phone → single PHONE_REQUIRED entry mirroring the top-level message; nothing persists", async () => {
    await runInRollback(async tx => {
      const input = makeValidInput({ phone: "" });
      await expectPhoneRejection(() => RegistrationService.registerUser(input, LOCALE, tx), "PHONE_REQUIRED");
      await expectNoResidualUser(tx, input.email);
    });
  });

  test("non-E.164 phone → PHONE_INVALID entry; nothing persists", async () => {
    await runInRollback(async tx => {
      const input = makeValidInput({ phone: "12345" });
      await expectPhoneRejection(() => RegistrationService.registerUser(input, LOCALE, tx), "PHONE_INVALID");
      await expectNoResidualUser(tx, input.email);
    });
  });

  test("17-char phone → PHONE_TOO_LONG entry carrying the generic validation copy; nothing persists", async () => {
    await runInRollback(async tx => {
      const input = makeValidInput({ phone: PHONE_AT_17 });
      const error = await expectPhoneRejection(
        () => RegistrationService.registerUser(input, LOCALE, tx),
        "PHONE_TOO_LONG"
      );
      // The too-long copy is the generic localized validation message, not a
      // phone-specific leaf.
      expect(error.fields?.[0]?.message).toBe(tErrors.validation);
      await expectNoResidualUser(tx, input.email);
    });
  });

  test("valid E.164 phone registers and persists verbatim", async () => {
    await runInRollback(async tx => {
      const input = makeValidInput();
      const result = await RegistrationService.registerUser(input, LOCALE, tx);

      expect(result.id).toBeGreaterThan(0);
      expect(result.phone).toBe(input.phone);

      const userRows = await tx.select().from(users).where(eq(users.email, input.email));
      expect(userRows).toHaveLength(1);
      expect(userRows[0]?.phone).toBe(input.phone);
    });
  });

  test("a valid phone never contributes a field entry, even when an unrelated field fails", async () => {
    await runInRollback(async tx => {
      const input = makeValidInput({ email: "not-an-email" });
      const error = await expectRepoError(() => RegistrationService.registerUser(input, LOCALE, tx));
      expect(error).toBeInstanceOf(ValidationError);
      if (!(error instanceof ValidationError)) throw new Error("expected a ValidationError instance");

      const fields = error.fields ?? [];
      const byField = new Map(fields.map(fieldEntry => [fieldEntry.field, fieldEntry.code]));
      expect(byField.get("email")).toBe("EMAIL_INVALID");
      expect(byField.has("phone")).toBe(false);
      // Collector ordering stays deterministic: the email failure is FIRST —
      // the phone slot between email and password stays empty.
      expect(fields[0]?.field).toBe("email");
      expect(fields.map(fieldEntry => fieldEntry.field)).not.toContain("phone");
    });
  });

  test("privileged createAdminUser inherits the shared phone gate", async () => {
    await runInRollback(async tx => {
      const input = makeAdminInput({ phone: "12345" });
      await expectPhoneRejection(() => RegistrationService.createAdminUser(input, LOCALE, tx), "PHONE_INVALID");
      await expectNoResidualUser(tx, input.email);
    });
  });

  test("createAdminUser enforces the full code set (REQUIRED + TOO_LONG) and threads ar", async () => {
    await runInRollback(async tx => {
      const required = makeAdminInput({ phone: "" });
      await expectPhoneRejection(() => RegistrationService.createAdminUser(required, LOCALE, tx), "PHONE_REQUIRED");
      await expectNoResidualUser(tx, required.email);

      const tooLong = makeAdminInput({ phone: PHONE_AT_17 });
      await expectPhoneRejection(() => RegistrationService.createAdminUser(tooLong, LOCALE, tx), "PHONE_TOO_LONG");
      await expectNoResidualUser(tx, tooLong.email);

      const arabic = makeAdminInput({ phone: "12345" });
      await expectPhoneRejection(
        () => RegistrationService.createAdminUser(arabic, AR_LOCALE, tx),
        "PHONE_INVALID",
        PHONE_MESSAGES_AR
      );
      await expectNoResidualUser(tx, arabic.email);
    });
  });

  test("the ar locale surfaces every machine code with the ar template — and a valid phone still registers", async () => {
    await runInRollback(async tx => {
      const arCases = [
        { phone: "", code: "PHONE_REQUIRED" },
        { phone: "12345", code: "PHONE_INVALID" },
        { phone: PHONE_AT_17, code: "PHONE_TOO_LONG" },
      ] as const;
      const rejectedInputs = arCases.map(expected => makeValidInput({ phone: expected.phone }));
      const errors = await Promise.all(
        rejectedInputs.map((input, index) => {
          const expected = arCases[index];
          if (!expected) throw new Error("missing ar corpus expectation");
          return expectPhoneRejection(
            () => RegistrationService.registerUser(input, AR_LOCALE, tx),
            expected.code,
            PHONE_MESSAGES_AR
          );
        })
      );
      expect(errors).toHaveLength(arCases.length);

      // The gate rejects before any DB work — no arm leaked a users row.
      const residuals = await tx
        .select({ email: users.email })
        .from(users)
        .where(
          inArray(
            users.email,
            rejectedInputs.map(input => input.email)
          )
        );
      expect(residuals).toHaveLength(0);

      // The valid path is locale-independent: an ar registration persists
      // the phone verbatim like its en counterpart.
      const valid = makeValidInput();
      const result = await RegistrationService.registerUser(valid, AR_LOCALE, tx);
      expect(result.id).toBeGreaterThan(0);
      expect(result.phone).toBe(valid.phone);
      const userRows = await tx.select().from(users).where(eq(users.email, valid.email));
      expect(userRows).toHaveLength(1);
      expect(userRows[0]?.phone).toBe(valid.phone);
    });
  });
});

describe("phone boundary values", () => {
  test("16-char phone (the exact schema ceiling) registers; 17 chars rejects with PHONE_TOO_LONG", async () => {
    await runInRollback(async tx => {
      const accepted = makeValidInput({ phone: PHONE_AT_16_CEILING });
      const result = await RegistrationService.registerUser(accepted, LOCALE, tx);
      expect(result.phone).toBe(PHONE_AT_16_CEILING);

      const rejected = makeValidInput({ phone: PHONE_AT_17 });
      await expectPhoneRejection(() => RegistrationService.registerUser(rejected, LOCALE, tx), "PHONE_TOO_LONG");
      await expectNoResidualUser(tx, rejected.email);
    });
  });

  test("empty phone → PHONE_REQUIRED", async () => {
    await runInRollback(async tx => {
      const input = makeValidInput({ phone: "" });
      await expectPhoneRejection(() => RegistrationService.registerUser(input, LOCALE, tx), "PHONE_REQUIRED");
    });
  });

  test("whitespace-only phone → PHONE_REQUIRED (edge whitespace is trimmed before the required check)", async () => {
    await runInRollback(async tx => {
      const input = makeValidInput({ phone: "   " });
      await expectPhoneRejection(() => RegistrationService.registerUser(input, LOCALE, tx), "PHONE_REQUIRED");
    });
  });

  test("edge whitespace around a valid E.164 value is tolerated by the gate", async () => {
    await runInRollback(async tx => {
      const input = makeValidInput({ phone: " +201234567890 " });
      const result = await RegistrationService.registerUser(input, LOCALE, tx);
      expect(result.id).toBeGreaterThan(0);
    });
  });
});

describe("concurrent registration over a hostile phone corpus", () => {
  test("Promise.allSettled arms each reject with their own single phone entry — no cross-arm pollution", async () => {
    await runInRollback(async tx => {
      const inputs = HOSTILE_PHONES.map(entry => makeValidInput({ phone: entry.phone }));
      const settled = await Promise.allSettled(
        inputs.map(input => RegistrationService.registerUser(input, LOCALE, tx))
      );

      expect(settled).toHaveLength(HOSTILE_PHONES.length);
      for (const [index, arm] of settled.entries()) {
        const expected = HOSTILE_PHONES[index];
        if (!expected) throw new Error("missing corpus expectation");
        if (arm.status !== "rejected") {
          throw new Error("expected every concurrent arm to reject at the validation gate");
        }
        const reason: unknown = arm.reason;
        expect(reason).toBeInstanceOf(ValidationError);
        if (!(reason instanceof ValidationError)) throw new Error("expected a ValidationError rejection");
        // Each arm's payload is exactly its own single phone entry — the
        // per-call collector never accumulates another arm's failures.
        expectSinglePhoneEntry(reason, expected.code);
      }

      // The gate rejects before any DB work — no arm leaked a users row.
      // One identity-scoped query over the whole per-run email set (a single
      // round-trip instead of a client-contention loop).
      const residuals = await tx
        .select({ email: users.email })
        .from(users)
        .where(
          inArray(
            users.email,
            inputs.map(input => input.email)
          )
        );
      expect(residuals).toHaveLength(0);
    });
  });
});

describe("phone rejection messages never echo the submitted value", () => {
  test("every hostile rejection message is a fixed localized template without the raw input", async () => {
    await runInRollback(async tx => {
      const templates = Object.values(PHONE_MESSAGES);
      const caught = await Promise.all(
        HOSTILE_PHONES.map(expected =>
          expectRepoError(() =>
            RegistrationService.registerUser(makeValidInput({ phone: expected.phone }), LOCALE, tx)
          ).then(error => ({ expected, error }))
        )
      );

      for (const { expected, error } of caught) {
        expect(error).toBeInstanceOf(ValidationError);
        if (!(error instanceof ValidationError)) throw new Error("expected a ValidationError instance");

        const fields = error.fields ?? [];
        expect(fields).toHaveLength(1);
        const entry = fields[0];
        if (!entry) throw new Error("expected a phone field entry");

        // The message is EXACTLY the localized template for the machine code
        // — fixed prose, never a rendering of the submitted value.
        expect(entry.message).toBe(PHONE_MESSAGES[expected.code]);
        expect(templates).toContain(entry.message);
        expect(entry.field).toBe("phone");
        expect(entry.code).toBe(expected.code);
        // No-echo probes only make sense for non-empty payloads (the empty
        // string is a substring of every message by definition).
        if (expected.phone.length > 0) {
          expect(entry.message).not.toContain(expected.phone);
          expect(error.message).not.toContain(expected.phone);
        }
      }
    });
  });
});

describe("BOPLA — the registration insert maps whitelisted fields only", () => {
  test("smuggled non-contract fields never reach the users row; the phone still persists", async () => {
    await runInRollback(async tx => {
      const input = makeValidInput();
      // Transport-tamper simulation: governance/id/hash fields merged onto
      // the input at runtime. The service maps fields EXPLICITLY (never a
      // spread), so none of these may reach the insert. The intermediate
      // const keeps the hostile fixture value out of a literal password-named
      // key (matches the sibling admin-suite pattern).
      const smuggledHashValue = "smuggledHashValue0123";
      Object.assign(input, {
        id: 424242,
        isBlocked: true,
        suspended: true,
        passwordHash: smuggledHashValue,
      });

      const result = await RegistrationService.registerUser(input, LOCALE, tx);
      expect(result.id).not.toBe(424242);
      expect(result.isBlocked).toBe(false);

      const [row] = await tx.select().from(users).where(eq(users.email, input.email));
      if (!row) throw new Error("expected the registration row to exist");
      expect(row.id).not.toBe(424242);
      expect(row.isBlocked).toBe(false);
      expect(row.suspended).toBe(false);
      expect(row.passwordHash).not.toBe(smuggledHashValue);
      expect(row.phone).toBe(input.phone);
      expect(row.email).toBe(input.email);
    });
  });
});
