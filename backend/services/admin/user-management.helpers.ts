/**
 * Admin user-management support helpers — pure guards, validators, and
 * payload builders extracted VERBATIM from `user-management.service.ts`
 * (behavior-identical extraction; zero logic change) except the country
 * validation, which enforces the shared ISO 3166-1 alpha-2 code schema
 * (`countryCodeSchema`) instead of free-text checks — on BOTH write paths.
 * The create path requires a code; the update path BRIDGES (a dataset code
 * persists as the code + display-name pair, legacy free text keeps its
 * legacy shape). See `docs/admin/user-management.md`.
 */
import type { NormalizedAdminUserFilters } from "@/backend/db/repo/admin/admin-user.repository";
import { AuditActionType } from "@/backend/enum/audit/audit-action-type.enum";
import { Gender } from "@/backend/enum/users/gender.enum";
import { toUserRole, UserRole } from "@/backend/enum/users/user-role.enum";
import { escapeLikeWildcards } from "@/backend/lib/db/escape-like-wildcards";
import { ValidationError } from "@/backend/lib/errors";
import { isValidEmail } from "@/backend/services/shared";
import type {
  AdminCreateUserSubmitInput,
  AdminUpdateUserPatchInput,
  AdminUserFiltersSubmitInput,
  AdminUserUpdateDbPatch,
  ApiFieldErrorType,
  AuditLogWriteContract,
  UserInsertType,
} from "@/backend/types";
import { COUNTRIES } from "@/shared/constants/countries";
import { countryCodeSchema, countrySeedToCode, isValidCountryCode } from "@/shared/lib/country-code";
import { getServerTranslations } from "@/shared/locale/server-graphql";
import type { AdminUsersLabels } from "@/shared/locale/types/adminUsers";

/** Short lowercase entity label used on `audit_logs.entity_type`. */
const AUDIT_ENTITY_TYPE = "user";

/** Field-length bounds mirroring the `users` schema column lengths. */
const MAX_FULL_NAME_LENGTH = 255;
const MAX_PHONE_LENGTH = 20;
const MAX_COUNTRY_LENGTH = 100;
const MIN_PASSWORD_LENGTH = 8;

/** The `audit_logs.details` column ceiling — payloads are capped BEFORE insert. */
const AUDIT_DETAILS_MAX_LENGTH = 2000;

/** Pagination bounds — out-of-range values reject with `VALIDATION`. */
const MIN_PAGE = 1;
const MIN_PAGE_SIZE = 1;
const MAX_PAGE_SIZE = 100;
const DEFAULT_PAGE_SIZE = 25;

/** Activity-timeline bounds — out-of-range `limit` values clamp (read path, never errors). */
const MIN_ACTIVITY_LIMIT = 1;
const MAX_ACTIVITY_LIMIT = 50;
const DEFAULT_ACTIVITY_LIMIT = 10;

/** Country-breakdown facet bounds — same clamp-first read-path discipline. */
const MIN_COUNTRY_BREAKDOWN_LIMIT = 1;
const MAX_COUNTRY_BREAKDOWN_LIMIT = 12;
const DEFAULT_COUNTRY_BREAKDOWN_LIMIT = 6;

/**
 * Defensively projects the `changedFields` array out of a raw audit
 * `details` JSON string. Returns `null` for every non-conforming shape
 * (unparseable JSON, non-object root, missing key, non-array value, or a
 * fully-filtered non-string member set) — the timeline still renders the
 * action + actor + timestamp. Only string members survive; nothing is
 * echoed unvalidated (BOPLA discipline on read-back).
 */
export function projectChangedFields(details: string | null): readonly string[] | null {
  if (!details) return null;
  try {
    const parsed: unknown = JSON.parse(details);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
    const candidate = (parsed as { changedFields?: unknown }).changedFields;
    if (!Array.isArray(candidate)) return null;
    const fields = candidate.filter((entry): entry is string => typeof entry === "string");
    return fields.length > 0 ? fields : null;
  } catch {
    return null;
  }
}

/** Positive-integer day-count guard for caption payload members (null otherwise). */
function captionDaysOf(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) return null;
  return value;
}

/** Per-action override caption; a rejecting override appends its stamped cooldown length. */
function overrideCaptionOf(record: Record<string, unknown>, labels: AdminUsersLabels["activity"]): string | null {
  if (record.action === "certify") return labels.captionCertify;
  if (record.action === "grant_re_evaluation") return labels.captionGrantReEvaluation;
  if (record.action !== "reject") return null;
  const days = captionDaysOf(record.cooldownDays);
  return days === null ? labels.captionReject : `${labels.captionReject} · ${labels.captionCooldownDays(days)}`;
}

/**
 * Narrows an unknown parsed member to a plain object (arrays excluded).
 * The `no-unsafe-type-assertion`-compliant escape hatch (same `value is Type`
 * predicate pattern as `backend/db/client.ts`): the JSON.parse result is
 * runtime-validated here instead of trusted via an `as Record<string, unknown>`
 * cast, preserving the exact checks the previous assertion implicitly relied on.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Composes the human-readable caption for one recent-activity timeline
 * entry from its raw audit `details` JSON — the localized rendering of the
 * teacher-applicant lifecycle payloads (cooldown extension, evaluation
 * override) that carry no `changedFields` key.
 *
 * Recognized shapes (the audit writers' own contracts):
 *  - an Override row whose `action` is `certify` / `reject` /
 *    `grant_re_evaluation` → the per-action caption; a rejecting override
 *    additionally appends the stamped cooldown length when its
 *    `cooldownDays` is a positive integer.
 *  - an Adjust row whose `additionalDays` is a positive integer → the
 *    cooldown-extension caption.
 * Any other action type, malformed / truncated / non-object JSON, unknown
 * action values, or non-numeric day members degrade to `null` — the
 * timeline renders the action label + actor + timestamp regardless (BOPLA
 * on read-back: never echo unvalidated payload shapes). The `user`-entity
 * Update rows already surface their `changedFields` list, so they stay
 * captionless here.
 */
export function composeActivityCaption(
  details: string | null,
  actionType: AuditActionType,
  labels: AdminUsersLabels["activity"]
): string | null {
  if (!details) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(details);
  } catch {
    return null;
  }
  if (!isRecord(parsed)) return null;
  const record = parsed;
  if (actionType === AuditActionType.Override) return overrideCaptionOf(record, labels);
  if (actionType === AuditActionType.Adjust) {
    const days = captionDaysOf(record.additionalDays);
    return days === null ? null : labels.captionCooldownExtended(days);
  }
  return null;
}

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
  return value === Gender.Male || value === Gender.Female || value === Gender.Other;
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
  if (!input.phone || input.phone.trim().length === 0) {
    entries.push({ field: "phone", code: "PHONE_REQUIRED", message: tAuth.phoneRequired });
  } else if (input.phone.length > MAX_PHONE_LENGTH) {
    entries.push({ field: "phone", code: "PHONE_TOO_LONG", message: tErrors.validation });
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
 * Validates the update-patch field bounds. Throws localized
 * `ValidationError` on any failure. Empty patch (no whitelisted field
 * present) rejects with `USER_PATCH_EMPTY` BEFORE any DB read.
 *
 * The patch shape is the repo-internal `AdminUserUpdateDbPatch` whose
 * columns inherit the nullable-without-notNull schema shape (so
 * `phone` / `country` / `dateOfBirth` may be `string | null | undefined`
 * even though the public input whitelist types them as `string?`). The
 * validators below treat `null` as the "clear the stored value" intent
 * — passing `null` through to the repo is valid; the guards only
 * reject malformed string values.
 *
 * Field-payload projection: failed checks COLLECT into an `ApiFieldErrorType[]`
 * (field names match the edit-dialog form paths exactly — `fullName`, `phone`,
 * `country`, `gender`, `dateOfBirth`) and throw ONE `ValidationError` whose
 * top-level message stays the canonical `tErrors.validation` string while the
 * `fields` payload identifies the offending fields for inline helperText
 * projection (same contract as `validateCreateInput` above).
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
  if (typeof patch.phone === "string" && patch.phone.length > MAX_PHONE_LENGTH) {
    entries.push({ field: "phone", code: "PHONE_TOO_LONG", message: tErrors.validation });
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
 * just the changed columns. `updatedAt` is server-stamped inside the repo.
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
 * Resolves + validates the directory pagination bounds. Out-of-range
 * values reject with `VALIDATION` (localized); valid input returns the
 * resolved page / pageSize / SQL offset triple.
 */
export function resolvePageBounds(
  page: number,
  pageSize: number | undefined,
  locale: string
): { resolvedPage: number; resolvedPageSize: number; offset: number } {
  const tErrors = getServerTranslations(locale).errorsTranslations;

  const resolvedPage = page;
  if (!isPositiveSafeInteger(resolvedPage) || resolvedPage < MIN_PAGE) {
    throw new ValidationError(tErrors.validation);
  }
  const resolvedPageSize = pageSize ?? DEFAULT_PAGE_SIZE;
  if (!Number.isInteger(resolvedPageSize) || resolvedPageSize < MIN_PAGE_SIZE || resolvedPageSize > MAX_PAGE_SIZE) {
    throw new ValidationError(tErrors.validation);
  }

  return { resolvedPage, resolvedPageSize, offset: (resolvedPage - 1) * resolvedPageSize };
}

/**
 * Resolves the activity-timeline `limit`. Clamp-first: `undefined`/`null`/
 * non-finite → default; every finite value truncates then clamps into
 * 1..50. An explicit 0 reads as "minimum" (1), never as "unbounded".
 */
export function resolveActivityLimit(limit?: number | null): number {
  const rawLimit = limit ?? DEFAULT_ACTIVITY_LIMIT;
  const truncated = Number.isFinite(rawLimit) ? Math.trunc(rawLimit) : DEFAULT_ACTIVITY_LIMIT;
  return Math.min(Math.max(truncated, MIN_ACTIVITY_LIMIT), MAX_ACTIVITY_LIMIT);
}

/**
 * Resolves the country-breakdown facet's `limit`. Clamp-first, mirroring
 * `resolveActivityLimit`: `undefined`/`null`/non-finite → default (6);
 * every finite value truncates then clamps into 1..12. An explicit 0
 * reads as "minimum" (1), never as "unbounded".
 */
export function resolveCountryBreakdownLimit(limit?: number | null): number {
  const rawLimit = limit ?? DEFAULT_COUNTRY_BREAKDOWN_LIMIT;
  const truncated = Number.isFinite(rawLimit) ? Math.trunc(rawLimit) : DEFAULT_COUNTRY_BREAKDOWN_LIMIT;
  return Math.min(Math.max(truncated, MIN_COUNTRY_BREAKDOWN_LIMIT), MAX_COUNTRY_BREAKDOWN_LIMIT);
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

/**
 * Normalizes a transport-shape filter input into the repo-internal
 * `NormalizedAdminUserFilters` shape. Drops empty / null / unknown
 * members (the directory falls back to the unfiltered listing rather
 * than erroring). The `search` substring is escaped via
 * `escapeLikeWildcards` and wrapped as `%…%` BEFORE being passed to the
 * repo — the repo receives the final escaped + wrapped pattern and
 * binds it directly to its `ilike(column, pattern)` predicate. The two
 * applicant-lifecycle members are enum members already validated at the
 * GraphQL input boundary, so they pass through unchanged (absent →
 * undefined → dropped by the WHERE-chain builder per the forgiving
 * read rule).
 */
export function normalizeFilters(filters: AdminUserFiltersSubmitInput): NormalizedAdminUserFilters {
  const role = filters.role ?? undefined;
  const governance = filters.governance ?? undefined;
  const country = filters.country ?? undefined;
  const applicantStatus = filters.applicantStatus ?? undefined;
  const cooldownState = filters.cooldownState ?? undefined;
  // Boolean narrow: only an EXPLICIT `true` survives (null/false/undefined
  // all drop out per the forgiving read rule — a tampered `false` can never
  // accidentally express "absent" semantics; both read the same).
  const cooldownExpiringSoon = filters.cooldownExpiringSoon === true ? true : undefined;
  let searchPattern: string | undefined;
  if (filters.search && filters.search.trim().length > 0) {
    const escaped = escapeLikeWildcards(filters.search.trim());
    searchPattern = `%${escaped}%`;
  }
  return {
    role,
    governance,
    country,
    searchPattern,
    applicantStatus,
    cooldownState,
    cooldownExpiringSoon,
  };
}
