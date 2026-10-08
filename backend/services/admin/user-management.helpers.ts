/**
 * Admin user-management support helpers — pure guards, validators, and
 * payload builders extracted VERBATIM from `user-management.service.ts`
 * (behavior-identical extraction; zero logic change) except the country
 * validation, which enforces the shared ISO 3166-1 alpha-2 code schema
 * (`countryCodeSchema`) instead of free-text checks — on BOTH write paths.
 * The create path requires a code; the update path BRIDGES (a dataset code
 * persists as the code + display-name pair, legacy free text keeps its
 * legacy shape). Both write paths also enforce the shared E.164 phone gate
 * (`validatePhoneField`) — missing / malformed / over-length numbers reject
 * with the same localized field errors the public registration surface
 * emits. See `docs/admin/user-management.md`.
 */
import type { AuditActionType } from "@/backend/enum/audit/audit-action-type.enum";
import { Gender } from "@/backend/enum/users/gender.enum";
import { toUserRole, UserRole } from "@/backend/enum/users/user-role.enum";
import { ValidationError } from "@/backend/lib/errors";
import { isValidEmail, validatePhoneField } from "@/backend/services/shared";
import type {
  AdminCreateUserSubmitInput,
  AdminUpdateUserPatchInput,
  AdminUserUpdateDbPatch,
  ApiFieldErrorType,
  AuditLogWriteContract,
  UserInsertType,
} from "@/backend/types";
import { COUNTRIES } from "@/shared/constants/countries";
import { countryCodeSchema, countrySeedToCode, isValidCountryCode } from "@/shared/lib/country-code";
import { getServerTranslations } from "@/shared/locale/server-graphql";
import type { AuthLabels } from "@/shared/locale/types/auth";

/** Short lowercase entity label used on `audit_logs.entity_type`. */
const AUDIT_ENTITY_TYPE = "user";

/** Field-length bounds mirroring the `users` schema column lengths. */
const MAX_FULL_NAME_LENGTH = 255;
const MAX_COUNTRY_LENGTH = 100;
const MIN_PASSWORD_LENGTH = 8;

/** The `audit_logs.details` column ceiling — payloads are capped BEFORE insert. */
const AUDIT_DETAILS_MAX_LENGTH = 2000;

/**
 * Positive-safe-integer guard for IDs sourced from caller arguments.
 * Rejects `NaN`, non-integers, `<= 0`, and integers exceeding
 * `Number.MAX_SAFE_INTEGER` BEFORE any DB read. Production resolvers
 * pre-validate this, but the service re-asserts defensively — the cost
 * is trivial and the protection is load-bearing (no `as number` casts
 * anywhere downstream).
 */
export function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0 && value <= Number.MAX_SAFE_INTEGER;
}

/**
 * Normalizes a DATE column read-back to a stable `YYYY-MM-DD` string.
 *
 * The `users.date_of_birth` column is a SQL `DATE`. Different drivers return
 * different shapes:
 *  - production `pg` over a real PostgreSQL pool returns `"2000-01-01"`
 *    (string in `YYYY-MM-DD`).
 *  - the sandbox `@electric-sql/pglite` shim returns the full ISO 8601
 *    timestamp string `"2000-01-01T00:00:00.000Z"` (PGlite emits the date
 *    with a zero time component, mirroring how PG stores DATE internally).
 *
 * The public service contract (consumed by GraphQL resolvers + frontend
 * Apollo cache) is a `YYYY-MM-DD` string. This helper accepts either shape
 * (Date | ISO string | date string) and emits the canonical `YYYY-MM-DD`
 * slice. `null` / `undefined` pass through unchanged so the projection
 * preserves nullable columns.
 */
export function normalizeDateOnly(value: Date | string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }
  // After the Date check, `value` is narrowed to `string` (the remaining
  // member of `Date | string`). `String(value)` would be flagged by
  // `no-unnecessary-type-conversion` (value is already a string) — call
  // `.slice` directly.
  return value.slice(0, 10);
}

/**
 * Safely truncates a string to a maximum length without ever throwing.
 */
function truncateSafely(value: string, maxLength: number): string {
  try {
    if (typeof value !== "string") return "";
    if (value.length <= maxLength) return value;
    return value.slice(0, maxLength);
  } catch {
    return "";
  }
}

/** Runtime guard for the `Gender` enum (defensive — the type already narrows). */
function isValidGender(value: unknown): value is Gender {
  return value === Gender.Male || value === Gender.Female;
}

/**
 * Validates the create-input field bounds. Throws localized
 * `ValidationError` on any failure. BFLA: `role` is constrained by the
 * `RegisterPublicRole` type union at compile time; the runtime role
 * pre-guard (`createUser`) is the transport-tamper defense.
 *
 * Field-payload projection: instead of throw-on-first-failure, the validator
 * COLLECTS every failed check as an `ApiFieldErrorType` entry
 * (`{ field, code, message }` — field names match the create-dialog form
 * paths exactly) and throws ONE `ValidationError` whose top-level message is
 * the FIRST entry's message (backwards-compatible with the single-failure
 * message contract) and whose `fields` array carries every failed field. The
 * GraphQL boundary finalizer mirrors `fields` into `extensions.fields`, and
 * the admin create dialog projects them as inline per-field helperText via
 * `extractFieldErrors`. Entries are built explicitly per check — never an
 * echo/spread of client input (BOPLA discipline applies to error payloads
 * too).
 */
export function validateCreateInput(input: AdminCreateUserSubmitInput, locale: string): void {
  const t = getServerTranslations(locale);
  const tErrors = t.errorsTranslations;
  const tAuth = t.authTranslations;
  const entries: ApiFieldErrorType[] = [];

  if (!input.fullName || input.fullName.trim().length === 0) {
    entries.push({ field: "fullName", code: "NAME_REQUIRED", message: tAuth.nameRequired });
  } else if (input.fullName.trim().length > MAX_FULL_NAME_LENGTH) {
    entries.push({ field: "fullName", code: "NAME_TOO_LONG", message: tErrors.validation });
  }
  if (!input.email || input.email.trim().length === 0) {
    entries.push({ field: "email", code: "EMAIL_REQUIRED", message: tAuth.emailRequired });
  } else if (!isValidEmail(input.email)) {
    entries.push({ field: "email", code: "EMAIL_INVALID", message: tAuth.emailInvalid });
  }
  // Phone is validated by the shared backend gate (required → too-long →
  // invalid, in the schema's own check order), so the admin surface can
  // never drift from the public registration rule.
  const phoneError = validatePhoneField(input.phone, locale);
  if (phoneError) {
    entries.push(phoneError);
  }
  if (!input.password || input.password.length === 0) {
    entries.push({ field: "password", code: "PASSWORD_REQUIRED", message: tAuth.passwordRequired });
  } else if (input.password.length < MIN_PASSWORD_LENGTH) {
    entries.push({ field: "password", code: "PASSWORD_TOO_SHORT", message: tAuth.passwordTooShort });
  }
  // Country is an ISO 3166-1 alpha-2 code on the create path (shared schema
  // with public registration): empty/whitespace → REQUIRED, anything else
  // failing the normalize→membership pipeline → INVALID (covers legacy
  // free-text values, over-length strings, and curated-out codes alike).
  if (typeof input.country !== "string" || input.country.trim().length === 0) {
    entries.push({ field: "country", code: "COUNTRY_CODE_REQUIRED", message: tAuth.countryCodeRequired });
  } else {
    const parsedCountry = countryCodeSchema.safeParse(input.country);
    if (!parsedCountry.success) {
      entries.push({ field: "country", code: "COUNTRY_CODE_INVALID", message: tAuth.countryCodeInvalid });
    }
  }
  if (input.gender !== undefined && !isValidGender(input.gender)) {
    entries.push({ field: "gender", code: "GENDER_INVALID", message: tErrors.validation });
  }

  if (entries.length > 0) {
    throw new ValidationError(entries[0].message, entries);
  }
}

/**
 * Resolves the shared phone-gate error for an update patch's phone member.
 * Validation-by-shape: an absent key (`undefined`) and an empty /
 * whitespace-only string both skip validation, so the required-phone error
 * can never fire on the update path; only a non-empty string is parsed
 * against the shared E.164 contract.
 *
 * This helper is write-agnostic — what each shape WRITES is decided
 * downstream: `buildUpdatePatch` copies every non-`undefined` member
 * verbatim and the repo applies it via `.set({ ...patch })`. Wire shapes
 * (`AdminUpdateUserInput.phone` is nullable; `admin-users.mutation.ts`
 * maps it with `input.phone ?? undefined`): a field omitted from the
 * GraphQL variables — or an explicit wire `null`, which `?? undefined`
 * normalizes to absent — is dropped by `buildUpdatePatch` and leaves the
 * stored phone untouched; an explicit wire `""` (or whitespace-only
 * string) survives the normalization and is stored verbatim, NOT cleared —
 * the empty-trim guard above deliberately lets that admin-side shape
 * through ungated. Only a non-empty string is validated here.
 */
function phonePatchError(patch: AdminUserUpdateDbPatch, locale: string): ApiFieldErrorType | null {
  if (typeof patch.phone !== "string" || patch.phone.trim().length === 0) {
    return null;
  }
  return validatePhoneField(patch.phone, locale);
}

/**
 * Validates the update-patch field bounds. Throws localized
 * `ValidationError` on any failure. Empty patch (no whitelisted field
 * present) rejects with `USER_PATCH_EMPTY` BEFORE any DB read.
 *
 * The patch shape is the repo-internal `AdminUserUpdateDbPatch` whose
 * columns inherit the nullable-without-notNull schema shape (so
 * `phone` / `country` / `dateOfBirth` may be `string | null | undefined`
 * even though the public input whitelist types them as `string?`). The
 * write contract lives downstream — `buildUpdatePatch` copies every
 * non-`undefined` member verbatim and the repo applies it with
 * `.set({ ...patch })` — so: an absent key leaves the column untouched; a
 * non-empty string persists verbatim after validation; an empty /
 * whitespace-only `phone` string is stored verbatim, NOT cleared — a shape
 * the GraphQL wire CAN deliver (`AdminUpdateUserInput.phone` is nullable
 * and `admin-users.mutation.ts` maps it with `input.phone ?? undefined`,
 * which passes `""` through and normalizes an explicit wire `null` to
 * absent, so the patch never receives a wire `null` for `phone`). The
 * guards only reject malformed string values — for `phone`, empty /
 * whitespace strings pass ungated (deliberate admin-side semantics: stored
 * verbatim, never cleared); `fullName` / `country` still reject empty
 * strings as malformed; a `null` member — only `dateOfBirth` is typed to
 * carry one (`string | null`) — is always valid here and clears the
 * column on write.
 *
 * Field-payload projection: failed checks COLLECT into an `ApiFieldErrorType[]`
 * (field names match the edit-dialog form paths exactly — `fullName`, `phone`,
 * `country`, `gender`, `dateOfBirth`) and throw ONE `ValidationError` whose
 * top-level message is the FIRST entry's message (so a phone-only
 * PHONE_INVALID failure throws `authTranslations.phoneInvalid`, not
 * `errors.validation`) while the `fields` payload identifies the offending
 * fields for inline helperText projection.
 */

/**
 * Collects the update-patch country checks into `entries` — both arms project
 * onto the SAME `country` field path the edit dialog renders:
 *  - a `country` string must be non-empty and within the column length
 *    (malformed values, including whitespace-only, are `COUNTRY_INVALID`);
 *  - defense-in-depth on the service-derived twin: a present (non-null)
 *    `countryCode` is built by `buildUpdatePatch` from a dataset-valid code,
 *    so anything else means a caller bypassed the builder — fail closed.
 * `null` / absent values on either member are the legitimate "clear / not
 * touched" arms and never collect an entry.
 */
function collectCountryPatchEntries(
  patch: AdminUserUpdateDbPatch,
  entries: ApiFieldErrorType[],
  validationMessage: string
): void {
  if (typeof patch.country === "string") {
    const trimmed = patch.country.trim();
    if (trimmed.length === 0 || trimmed.length > MAX_COUNTRY_LENGTH) {
      entries.push({ field: "country", code: "COUNTRY_INVALID", message: validationMessage });
    }
  }
  if (patch.countryCode !== undefined && patch.countryCode !== null && !isValidCountryCode(patch.countryCode)) {
    entries.push({ field: "country", code: "COUNTRY_INVALID", message: validationMessage });
  }
}

export function validateUpdatePatch(patch: AdminUserUpdateDbPatch, locale: string): void {
  const tErrors = getServerTranslations(locale).errorsTranslations;
  const entries: ApiFieldErrorType[] = [];

  if (patch.fullName !== undefined) {
    const trimmed = patch.fullName.trim();
    if (trimmed.length === 0 || trimmed.length > MAX_FULL_NAME_LENGTH) {
      entries.push({ field: "fullName", code: "FULL_NAME_INVALID", message: tErrors.validation });
    }
  }
  const phoneError = phonePatchError(patch, locale);
  if (phoneError) {
    entries.push(phoneError);
  }
  collectCountryPatchEntries(patch, entries, tErrors.validation);
  if (patch.gender !== undefined && patch.gender !== null && !isValidGender(patch.gender)) {
    entries.push({ field: "gender", code: "GENDER_INVALID", message: tErrors.validation });
  }
  if (typeof patch.dateOfBirth === "string") {
    const parsed = new Date(patch.dateOfBirth);
    if (Number.isNaN(parsed.getTime()) || parsed.getTime() > Date.now()) {
      entries.push({ field: "dateOfBirth", code: "DATE_OF_BIRTH_INVALID", message: tErrors.validation });
    }
  }

  if (entries.length > 0) {
    throw new ValidationError(entries[0].message, entries);
  }
}

/**
 * Validates a plaintext password against the shared credential policy.
 * Pure: returns the collected `ApiFieldErrorType` entries (an empty array
 * means the policy is satisfied) instead of throwing, so each consuming
 * service composes the result into its own localized `ValidationError`.
 * Empty / whitespace-only input rejects with `PASSWORD_REQUIRED`; anything
 * shorter than `MIN_PASSWORD_LENGTH` rejects with `PASSWORD_TOO_SHORT` —
 * the same two rules the create surface enforces in `validateCreateInput`,
 * reusing the localized `auth` copy verbatim. No complexity rule exists
 * beyond the shared minimum, so the entries are built explicitly per check
 * (never an echo of the submitted value — BOPLA discipline applies to
 * error payloads too).
 */
export function validatePasswordPolicy(password: string, tAuth: AuthLabels): ApiFieldErrorType[] {
  const entries: ApiFieldErrorType[] = [];
  if (!password || password.trim().length === 0) {
    entries.push({ field: "password", code: "PASSWORD_REQUIRED", message: tAuth.passwordRequired });
  } else if (password.length < MIN_PASSWORD_LENGTH) {
    entries.push({ field: "password", code: "PASSWORD_TOO_SHORT", message: tAuth.passwordTooShort });
  }
  return entries;
}

/**
 * Builds the `users` insert payload field-by-field (BOPLA — never a spread).
 * Maps the validated input + the pre-hashed password + server-controlled
 * governance defaults into the `UserInsertType` shape.
 *
 * Country contract: `validateCreateInput` guarantees an ISO 3166-1 alpha-2
 * code on `input.country` before this builder runs on the create path, so
 * the normalized code is stored in `countryCode` and the English display
 * name in the legacy `country` column. A direct call with unvalidated
 * input degrades to the legacy free-text row (`countryCode` null) rather
 * than persisting an unmapped code.
 */
export function buildCreateUserInsert(input: AdminCreateUserSubmitInput, passwordHash: string): UserInsertType {
  const role: UserRole = toUserRole(input.role) ?? UserRole.Student;
  const parsedCountry = countryCodeSchema.safeParse(input.country);
  const countryCode = parsedCountry.success ? parsedCountry.data : null;
  return {
    fullName: input.fullName,
    email: input.email,
    phone: input.phone,
    passwordHash,
    role,
    gender: input.gender ?? null,
    countryCode,
    country: countryCode !== null ? COUNTRIES[countryCode].en : input.country,
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
}

/**
 * Builds the whitelisted profile patch field-by-field (BOPLA — never a spread).
 * Only fields the caller supplied are included so the SET clause touches
 * just the changed columns: a key left `undefined` is omitted (the column
 * is left untouched), while every present member is copied verbatim —
 * values are never rewritten here; the repo stores them as-is via
 * `.set({ ...patch })`, including the empty / whitespace-only strings the
 * nullable `AdminUpdateUserInput` wire fields can deliver. The one member
 * typed to carry an explicit `null` is `dateOfBirth` (`string | null`):
 * copied verbatim, it clears the column downstream (SQL NULL). For the
 * `string`-only members (`phone` included) the `admin-users.mutation.ts`
 * resolver normalizes a wire `null` to absent (`input.x ?? undefined`), so
 * no `null` member is ever produced from the GraphQL wire.
 *
 * Country bridge (mirrors `buildCreateUserInsert`'s pairing, with the READ-
 * side tolerance of `countrySeedToCode`): a caller value that resolves to a
 * dataset country — a canonical code, a padded/lowercase variant, OR legacy
 * display text such as "Egypt" from older wire consumers — persists the
 * canonical pair: normalized code into `countryCode`, English display name
 * into the legacy `country` column. Truly unresolvable free text keeps its
 * legacy shape: raw text in `country` with the `countryCode` twin explicitly
 * cleared to `null`, so the row invariant "`countryCode` non-null ⟺
 * `country` is a dataset display name" holds on every write path.
 * `updatedAt` is server-stamped inside the repo.
 */
export function buildUpdatePatch(input: AdminUpdateUserPatchInput): AdminUserUpdateDbPatch {
  const patch: AdminUserUpdateDbPatch = {};
  if (input.fullName !== undefined) {
    patch.fullName = input.fullName;
  }
  if (input.phone !== undefined) {
    patch.phone = input.phone;
  }
  if (input.country !== undefined) {
    const resolvedCode = countrySeedToCode(input.country);
    if (resolvedCode !== "") {
      patch.country = COUNTRIES[resolvedCode].en;
      patch.countryCode = resolvedCode;
    } else {
      patch.country = input.country;
      patch.countryCode = null;
    }
  }
  if (input.gender !== undefined) {
    patch.gender = input.gender;
  }
  if (input.dateOfBirth !== undefined) {
    patch.dateOfBirth = input.dateOfBirth;
  }
  return patch;
}

/**
 * Composes the audit-log write contract for a create / update / delete /
 * reactivate mutation. The `details` field carries field NAMES + metadata
 * only (never contact-PII values, never credentials) and is defensively
 * truncated to the `varchar(2000)` column ceiling.
 */
export function buildAuditContract(
  actorId: number,
  actionType: AuditActionType,
  entityId: number,
  details: Record<string, unknown>
): AuditLogWriteContract {
  const detailsJson = truncateSafely(JSON.stringify(details), AUDIT_DETAILS_MAX_LENGTH);
  return {
    actorId,
    actionType,
    entityType: AUDIT_ENTITY_TYPE,
    entityId,
    details: detailsJson,
  };
}
