/**
 * Admin user-management support helpers — pure guards, validators, and
 * payload builders extracted VERBATIM from `user-management.service.ts`
 * (behavior-identical extraction; zero logic change). See
 * `docs/admin/user-management.md`.
 */
import type { NormalizedAdminUserFilters } from "@/backend/db/repo/admin/admin-user.repository";
import type { AuditActionType } from "@/backend/enum/audit/audit-action-type.enum";
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
import { getServerTranslations } from "@/shared/locale/server-graphql";

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
export function truncateSafely(value: string, maxLength: number): string {
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
  if (!input.country || input.country.trim().length === 0) {
    entries.push({ field: "country", code: "COUNTRY_REQUIRED", message: tAuth.countryRequired });
  } else if (input.country.trim().length > MAX_COUNTRY_LENGTH) {
    entries.push({ field: "country", code: "COUNTRY_TOO_LONG", message: tErrors.validation });
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
  if (typeof patch.country === "string") {
    const trimmed = patch.country.trim();
    if (trimmed.length === 0 || trimmed.length > MAX_COUNTRY_LENGTH) {
      entries.push({ field: "country", code: "COUNTRY_INVALID", message: tErrors.validation });
    }
  }
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
 */
export function buildCreateUserInsert(input: AdminCreateUserSubmitInput, passwordHash: string): UserInsertType {
  const role: UserRole = toUserRole(input.role) ?? UserRole.Student;
  return {
    fullName: input.fullName,
    email: input.email,
    phone: input.phone,
    passwordHash,
    role,
    gender: input.gender ?? null,
    country: input.country,
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
    patch.country = input.country;
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
 * binds it directly to its `ilike(column, pattern)` predicate.
 */
export function normalizeFilters(filters: AdminUserFiltersSubmitInput): NormalizedAdminUserFilters {
  const role = filters.role ?? undefined;
  const governance = filters.governance ?? undefined;
  const country = filters.country ?? undefined;
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
  };
}
