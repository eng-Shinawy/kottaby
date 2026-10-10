/**
 * RegistrationService — domain service for user registration.
 *
 * Responsibilities:
 *  1. Validate the public `RegistrationSubmitInput` (required fields, email
 *     shape, phone E.164 via the shared backend validator, password 8–1024
 *     chars — the shared length bounds, so a credential accepted here can
 *     never exceed the login-side verify ceiling, country an ISO 3166-1
 *     alpha-2 code from the shared dataset,
 *     role ∈ {student, teacher, parent}). Throws
 *     `ValidationError` with localized messages from
 *     `getServerTranslations(locale).authTranslations`.
 *  2. Hash the password via `hashPassword` BEFORE the transaction opens so
 *     plaintext never crosses into repository input types or logs.
 *  3. Open a single `db.transaction(async tx => …)` that orchestrates the
 *     `users` insert plus the role-specific child insert (atomicity).
 *     All repository calls inside the flow receive the same `tx`.
 *  4. Translate PostgreSQL `23505` on `users.email` into a localized
 *     `ConflictError`.
 *  5. Generate `handshake_code` for student registrations with a bounded
 *     in-tx retry loop on unique-violation; log via `logger.logDomainError`
 *     on exhaustion.
 *  6. BOPLA defense: explicit field-by-field mapping — NEVER `{ ...input }`
 *     spread into `.values()`.
 *
 * BFLA defense: the public `registerUser` method only accepts
 * `RegisterPublicRole` (no `"admin"`). The privileged `createAdminUser`
 * method exists for privileged super-admin onboarding and is NOT exposed
 * via any public Pothos mutation.
 *
 * i18n: all messages resolve through `getServerTranslations(locale)` — never
 * hardcoded strings, never `console.*` (uses `logger.logDomainError`).
 */
import { AdminRepository, UserRepository } from "@/backend/db/repo";
import { Gender } from "@/backend/enum/users/gender.enum";
import { UserRole } from "@/backend/enum/users/user-role.enum";
import { hashPassword } from "@/backend/lib/auth/password";
import { MAX_PASSWORD_LENGTH } from "@/backend/lib/auth/password-limits";
import { withTransaction } from "@/backend/lib/db/with-transaction";
import { ConflictError, translateDbError, ValidationError } from "@/backend/lib/errors";
import {
  createRoleChild,
  createStudentWithHandshakeRetry,
  isValidEmail,
  validatePhoneField,
} from "@/backend/services/shared";
import { RecitationCatalogService } from "@/backend/services/shared/recitation-catalog.service";
import { StudentTrialService } from "@/backend/services/students/student-trial.service";
import type {
  AdminRegistrationSubmitInput,
  ApiFieldErrorType,
  DBTransaction,
  RegisteredUserLookupResult,
  RegistrationReturnType,
  RegistrationSubmitInput,
  UserInsertType,
} from "@/backend/types";
import { COUNTRIES } from "@/shared/constants/countries";
import type { RecitationReading } from "@/shared/constants/recitation-reading.enum";
import { countryCodeSchema, isValidCountryCode, normalizeCountryCode } from "@/shared/lib/country-code";
import { getServerTranslations } from "@/shared/locale/server-graphql";

/** Shared primitives (`isValidEmail`, `generateHandshakeCode`,
 * `isUniqueViolation`, the bounded handshake retry, and the role-child
 * dispatch) live in `@/backend/services/shared` — the admin user-creation
 * flow composes the identical helpers so both write paths stay in lockstep.
 */

/** Minimum password length. */
const MIN_PASSWORD_LENGTH = 8;

export namespace RegistrationService {
  /**
   * Public registration entry point.
   *
   * Validates input, hashes the password, then opens a single transaction
   * that inserts the `users` row + role-specific child row. Returns the
   * created user with `passwordHash` omitted (never exposed to callers).
   *
   * @param input  Public registration contract (whitelisted fields only).
   * @param locale Active request locale (for i18n error messages).
   * @param outerTx  Optional outer transaction. When provided (test path),
   *     the service runs inside a SAVEPOINT on the outer transaction instead
   *     of opening a new top-level transaction — enables `runInRollback`
   *     isolation for service-level tests without leaking committed data.
   *     Production callers omit this; the service opens its own
   *     `db.transaction`.
   *
   * @throws ValidationError  missing/invalid fields, short password, bad role.
   * @throws ConflictError    email already exists (translated 23505).
   */
  export async function registerUser(
    input: RegistrationSubmitInput,
    locale: string,
    outerTx?: DBTransaction
  ): Promise<RegistrationReturnType> {
    const t = getServerTranslations(locale).authTranslations;

    validateInput(input, locale);

    // Validate preferredRecitation against the canonical catalog BEFORE
    // any DB work. Contract metadata only — NOT persisted to `recitation`
    // (recitation is session-linked, 1:1 with `session`).
    const preferredRecitation = RecitationCatalogService.validateOptionalReading(input.preferredRecitation, locale);

    // Hash BEFORE the transaction opens — plaintext never enters the tx.
    const passwordHash = await hashPassword(input.password);

    try {
      return await withTransaction(outerTx, async tx => {
        const created = await createUserRow(input, passwordHash, tx);
        // Shared dispatch: students get the handshake-retry insert PLUS the
        // one-time free-trial grant (same tx so the grant shares the
        // rollback fate). teacher / parent branches live in the shared
        // dispatcher. Exhaustion keeps THIS surface's ConflictError shape.
        await createRoleChild(created.id, input.role, tx, async (userId, childTx) => {
          await createStudentWithHandshakeRetry(
            userId,
            childTx,
            "registration",
            cause => new ConflictError("Handshake code generation failed after retries", { cause })
          );
          await StudentTrialService.grantFreeTrial(userId, locale, childTx);
        });
        // Zero recitation rows are created during registration.
        return toReturnType(created, preferredRecitation);
      });
    } catch (error) {
      // Map 23505 on email → ConflictError. translateDbError is idempotent
      // for already-DomainError instances.
      throw translateDbError(error, t.emailAlreadyExists);
    }
  }

  /**
   * Privileged admin-creation entry point (service-only, NOT exposed via any
   * public Pothos mutation). Used by privileged super-admin onboarding.
   *
   * Same validation + hashing + atomicity guarantees as `registerUser`, but
   * accepts `role: "admin"` and creates an `admin` child row instead of a
   * student/teacher/parent child.
   *
   * @param outerTx  Optional outer transaction for test isolation (see
   *     `registerUser` for the semantics).
   */
  export async function createAdminUser(
    input: AdminRegistrationSubmitInput,
    locale: string,
    outerTx?: DBTransaction
  ): Promise<RegistrationReturnType> {
    const t = getServerTranslations(locale).authTranslations;

    // Validate shared fields with a public-shaped proxy; admin role is the
    // only permitted role here (the type enforces it).
    validateInput({ ...input, role: "student" }, locale);

    // Validate preferredRecitation for the admin path too (same session-link guard).
    const preferredRecitation = RecitationCatalogService.validateOptionalReading(input.preferredRecitation, locale);

    const passwordHash = await hashPassword(input.password);

    try {
      return await withTransaction(outerTx, async tx => {
        const created = await createUserRow(input, passwordHash, tx);
        await AdminRepository.create(created.id, tx);
        return toReturnType(created, preferredRecitation);
      });
    } catch (error) {
      throw translateDbError(error, t.emailAlreadyExists);
    }
  }

  /**
   * Read-only lookup of an already-registered user by email — the seeder
   * bootstrap entry point for look-before-create flows. Seeders never query
   * repositories directly (seed-layer Service-Only Data Access rule): a
   * missing read bootstrap is added HERE instead. Returns null when no user
   * carries the email; never authenticates, never provisions.
   */
  export async function findRegisteredUserByEmail(email: string): Promise<RegisteredUserLookupResult | null> {
    const user = await UserRepository.findByEmail(email);
    if (!user) {
      return null;
    }
    return { id: user.id, email: user.email, role: user.role };
  }

  // ─── Internals ────────────────────────────────────────────────────────

  /**
   * Validates the public input shape. Throws localized `ValidationError` on
   * any failure. BFLA defense: `role` is constrained by the
   * `RegisterPublicRole` type union — `admin` is structurally rejected.
   *
   * Field-payload projection (same contract as the admin
   * `validateCreateInput`): instead of throw-on-first-failure, the validator
   * COLLECTS every failed check as an `ApiFieldErrorType` entry
   * (`{ field, code, message }` — field names match the registration form
   * paths exactly: `fullName`, `email`, `phone`, `password`, `country`,
   * `role`, `gender`) and throws ONE `ValidationError` whose top-level
   * message is the FIRST entry's message (backwards-compatible with the
   * single-failure message contract — the check order is unchanged) and
   * whose `fields` array carries every failed field. The GraphQL boundary
   * finalizer mirrors `fields` into `extensions.fields`, and the public
   * registration form projects them as inline per-field helperText via
   * `extractFieldErrors` (the form's `REGISTER_FIELD_PATHS` mapping already
   * covers every path emitted here). Entries are built explicitly per check
   * — never an echo/spread of client input (BOPLA discipline applies to
   * error payloads too).
   */
  function validateInput(input: RegistrationSubmitInput, locale: string): void {
    const translations = getServerTranslations(locale);
    const t = translations.authTranslations;
    const tErrors = translations.errorsTranslations;
    const entries: ApiFieldErrorType[] = [];

    if (!input.fullName || input.fullName.trim().length === 0) {
      entries.push({ field: "fullName", code: "NAME_REQUIRED", message: t.nameRequired });
    }
    if (!input.email || input.email.trim().length === 0) {
      entries.push({ field: "email", code: "EMAIL_REQUIRED", message: t.emailRequired });
    } else if (!isValidEmail(input.email)) {
      entries.push({ field: "email", code: "EMAIL_INVALID", message: t.emailInvalid });
    }
    // Shared phone gate — one call owns required/length/E.164-format and
    // returns the localized field error; `null` means the value parses.
    const phoneError = validatePhoneField(input.phone, locale);
    if (phoneError) {
      entries.push(phoneError);
    }
    const passwordError = passwordFieldError(input.password, locale);
    if (passwordError) {
      entries.push(passwordError);
    }
    // Country carries an ISO 3166-1 alpha-2 code (any case / surrounding
    // padding — the shared schema normalizes before the dataset membership
    // check). Absent, blank, or non-string values take the REQUIRED code so
    // the form prompts a selection; any present-but-non-member value takes
    // INVALID. The field path stays `country` so the registration form's
    // field-error projection is unchanged.
    const country = typeof input.country === "string" ? input.country : "";
    if (country.trim().length === 0) {
      entries.push({ field: "country", code: "COUNTRY_CODE_REQUIRED", message: t.countryCodeRequired });
    } else if (!countryCodeSchema.safeParse(country).success) {
      entries.push({ field: "country", code: "COUNTRY_CODE_INVALID", message: t.countryCodeInvalid });
    }
    // BFLA: role ∈ {student, teacher, parent}. The TS type enforces this at
    // compile time; this runtime guard defends against transport-layer tamper.
    if (!input.role) {
      entries.push({ field: "role", code: "ROLE_REQUIRED", message: t.roleRequired });
    } else if (input.role !== "student" && input.role !== "teacher" && input.role !== "parent") {
      // Transport-tamper rejection keeps the canonical custom code as the
      // top-level `code` (ROLE_FORBIDDEN) while the entry projects onto the
      // `role` form path for inline feedback.
      entries.push({ field: "role", code: "ROLE_FORBIDDEN", message: t.roleForbidden });
      throw new ValidationError("ROLE_FORBIDDEN", t.roleForbidden, undefined, entries);
    }
    // gender is optional — `undefined` is valid (schema column is nullable).
    if (input.gender !== undefined && !isValidGender(input.gender)) {
      // Historical note: this branch previously threw `t.emailInvalid` (a
      // copy-paste bug — the message had nothing to do with gender). The
      // field payload now carries the generic localized validation message
      // under the GENDER_INVALID code on the `gender` form path.
      entries.push({ field: "gender", code: "GENDER_INVALID", message: tErrors.validation });
    }

    if (entries.length > 0) {
      throw new ValidationError(entries[0].message, entries);
    }
  }

  /**
   * Password length gate — returns the FIRST failed check as a field
   * payload entry (required → too short → too long, same order and messages
   * as the inline chain it replaces) or `null` when the value passes.
   */
  function passwordFieldError(password: string, locale: string): ApiFieldErrorType | null {
    const t = getServerTranslations(locale).authTranslations;
    if (!password || password.length === 0) {
      return { field: "password", code: "PASSWORD_REQUIRED", message: t.passwordRequired };
    }
    if (password.length < MIN_PASSWORD_LENGTH) {
      return { field: "password", code: "PASSWORD_TOO_SHORT", message: t.passwordTooShort };
    }
    if (password.length > MAX_PASSWORD_LENGTH) {
      return { field: "password", code: "PASSWORD_TOO_LONG", message: t.passwordTooLong };
    }
    return null;
  }

  /**
   * Inserts the `users` row with governance defaults set server-side.
   *
   * The country is persisted as a normalized ISO 3166-1 alpha-2 code in
   * `countryCode` alongside its canonical English display name in the
   * legacy `country` column (backward-compatible free-text consumers keep
   * reading a human-readable name).
   */
  async function createUserRow(
    input: RegistrationSubmitInput | AdminRegistrationSubmitInput,
    passwordHash: string,
    tx: DBTransaction
  ): Promise<Awaited<ReturnType<typeof UserRepository.create>>> {
    // Both input variants carry a `role` literal whose string value is a
    // valid `UserRole` enum member ("admin" | "teacher" | "student" | "parent").
    // We map the string union to the `UserRole` enum explicitly (the pgEnum
    // string values and the TS enum values are identical at runtime).
    const role: UserRole = toUserRole(input.role);
    // Country: `validateInput` already gated the value through the shared
    // schema on every entry point, so it normalizes into a dataset member.
    // Normalize first, then narrow to the generated `CountryCode` union
    // BEFORE the display-name lookup — the `COUNTRIES` index is therefore
    // statically member-safe (never undefined, never prototype-polluted).
    // The null arm is unreachable through the service entry points (the
    // code is a validated member before this mapping runs) and keeps the
    // persisted pair consistent: no code ⇔ no display name.
    const normalizedCountryCode = normalizeCountryCode(input.country);
    const countryCode = isValidCountryCode(normalizedCountryCode) ? normalizedCountryCode : null;
    // BOPLA: explicit field-by-field mapping — NEVER `{ ...input }` spread.
    const insert: UserInsertType = {
      fullName: input.fullName,
      email: input.email,
      phone: input.phone,
      passwordHash,
      role,
      gender: input.gender ?? null,
      country: countryCode === null ? null : COUNTRIES[countryCode].en,
      countryCode,
      // Governance defaults — server-set, never client-controlled.
      isDeleted: false,
      deletedAt: null,
      suspended: false,
      suspendedAt: null,
      suspendedPeriodDays: null,
      isBlocked: false,
      blockedAt: null,
      lastActiveAt: new Date(),
    };
    return UserRepository.create(insert, tx);
  }

  /**
   * Strips `passwordHash` from the user row + attaches the validated
   * `preferredRecitation` (contract metadata — NOT persisted to `recitation`).
   */
  function toReturnType(
    user: Awaited<ReturnType<typeof UserRepository.create>>,
    preferredRecitation: RecitationReading | null
  ): RegistrationReturnType {
    // Omit passwordHash so it can never leak to resolvers or logs.
    const { passwordHash: _omitted, ...rest } = user;
    return { ...rest, preferredRecitation };
  }

  /** Runtime guard for the `Gender` enum (defensive — the type already narrows). */
  function isValidGender(value: unknown): value is Gender {
    return value === Gender.Male || value === Gender.Female;
  }

  /**
   * Maps the `RegistrationSubmitInput`/`AdminRegistrationSubmitInput` role
   * string union to the `UserRole` TS enum. The values are identical at
   * runtime; this switch satisfies the exhaustiveness check and avoids an
   * unsafe `as UserRole` cast.
   */
  function toUserRole(role: "admin" | "teacher" | "student" | "parent"): UserRole {
    switch (role) {
      case "admin":
        return UserRole.Admin;
      case "teacher":
        return UserRole.Teacher;
      case "student":
        return UserRole.Student;
      case "parent":
        return UserRole.Parent;
      default: {
        // Exhaustiveness guard — the type union guarantees this is unreachable.
        const exhaustive: never = role;
        throw new Error(`Unexpected role: ${String(exhaustive)}`);
      }
    }
  }
}
