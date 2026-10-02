/**
 * Admin broadcast — the pre-DB audience coherence matrix, extracted from the
 * service file under the sibling-module layout (the `session-lifecycle.guards.ts`
 * pattern of pure pre-DB guards/normalizers). Pure validation only: no reads,
 * no writes, no gate — the service composes these BEFORE any database work.
 *
 * The closed coherence matrix, one tiny validator per kind so each rule
 * stays independently readable:
 *  - `all`     — every companion absent;
 *  - `role`    — a recognized user role required, country/planId absent;
 *  - `country` — a trimmed, non-empty, ≤100 character country required,
 *                role/planId absent. The trimmed value resolves through the
 *                shared `countrySeedToCode` bridge (canonical ISO codes,
 *                padded/lowercase variants, and legacy display text):
 *                a resolvable seed canonicalizes onto the dataset pair —
 *                `country` becomes the canonical English display name and
 *                the validated selector carries its `countryCode` twin —
 *                while unresolvable free text keeps the legacy exact-match
 *                shape (`countryCode` null), so run-unique sentinels and
 *                pre-bridge callers behave byte-identically to before;
 *  - `plan`    — a positive safe integer planId required, role/country absent.
 *
 * Any violation — including a hostile non-member kind string or a role the
 * role coercion rejects — fails closed through the shared localized
 * rejection primitive.
 */

import {
  BroadcastAudienceType,
  isBroadcastAudienceType,
} from "@/backend/enum/notifications/broadcast-audience-type.enum";
import { toUserRole, type UserRole } from "@/backend/enum/users/user-role.enum";
import { rejectBroadcast } from "@/backend/services/notifications/admin-broadcast.service.helpers";
import { isPositiveSafeInt } from "@/backend/services/notifications/emit-validation";
import type { BroadcastAudienceSelector } from "@/backend/types";
import { COUNTRIES, type CountryCode } from "@/shared/constants/countries";
import { countrySeedToCode } from "@/shared/lib/country-code";

/** `users.country` column bound (varchar(100)) — the country companion's ceiling. */
const COUNTRY_MAX_LENGTH = 100;

/**
 * The coherence-validated audience selector — the closed, per-kind normalized
 * shape that flows onward to cohort resolution and the audit metadata. Each
 * member carries EXACTLY the companion its kind requires (never a spread of
 * the raw input); the union is structurally assignable to the canonical
 * `BroadcastAudienceSelector` the repository consumes, while letting the
 * flow narrow each companion honestly (no type assertions).
 */
export type ValidatedAudienceSelector =
  | { readonly type: BroadcastAudienceType.All }
  | { readonly type: BroadcastAudienceType.Role; readonly role: UserRole }
  | {
      readonly type: BroadcastAudienceType.Country;
      /** The matched `users.country` vocabulary: canonical display name for a resolvable seed, the raw trimmed text otherwise. */
      readonly country: string;
      /** The ISO twin — non-null exactly when `country` is a dataset display name (the shared invariant). */
      readonly countryCode: CountryCode | null;
    }
  | { readonly type: BroadcastAudienceType.Plan; readonly planId: number };

/** Wire-level "not provided" semantics: both absent and explicit null are absent. */
function isCompanionPresent<T>(value: T | null | undefined): value is T {
  return value !== undefined && value !== null;
}

function validateAllKind(selector: BroadcastAudienceSelector): ValidatedAudienceSelector | null {
  if (
    isCompanionPresent(selector.role) ||
    isCompanionPresent(selector.country) ||
    isCompanionPresent(selector.planId)
  ) {
    return null;
  }
  return { type: BroadcastAudienceType.All };
}

function validateRoleKind(selector: BroadcastAudienceSelector): ValidatedAudienceSelector | null {
  if (isCompanionPresent(selector.country) || isCompanionPresent(selector.planId)) {
    return null;
  }
  if (!isCompanionPresent(selector.role)) {
    return null;
  }
  const role = toUserRole(selector.role);
  if (role === null) {
    return null;
  }
  return { type: BroadcastAudienceType.Role, role };
}

function validateCountryKind(selector: BroadcastAudienceSelector): ValidatedAudienceSelector | null {
  if (isCompanionPresent(selector.role) || isCompanionPresent(selector.planId)) {
    return null;
  }
  if (!isCompanionPresent(selector.country) || typeof selector.country !== "string") {
    return null;
  }
  const country = selector.country.trim();
  if (country.length === 0 || country.length > COUNTRY_MAX_LENGTH) {
    return null;
  }
  // The seed bridge — the same normalization the directory filter and the
  // admin user patch use: canonical codes (padded/lowercase included) and
  // legacy English display names resolve onto a code; anything else fails
  // closed to "" and rides the legacy exact-match arm below.
  const code = countrySeedToCode(country);
  if (code !== "") {
    return { type: BroadcastAudienceType.Country, country: COUNTRIES[code].en, countryCode: code };
  }
  return { type: BroadcastAudienceType.Country, country, countryCode: null };
}

function validatePlanKind(selector: BroadcastAudienceSelector): ValidatedAudienceSelector | null {
  if (isCompanionPresent(selector.role) || isCompanionPresent(selector.country)) {
    return null;
  }
  if (!isPositiveSafeInt(selector.planId)) {
    return null;
  }
  return { type: BroadcastAudienceType.Plan, planId: selector.planId };
}

/**
 * Validates the audience selector against the closed coherence matrix and
 * returns the normalized companion-only selector. Any violation — including
 * a hostile non-member kind string or a role the role coercion rejects — is
 * one bounded log + one localized rejection.
 */
export function validateAudienceCoherence(
  selector: BroadcastAudienceSelector,
  locale: string,
  audienceInvalidMessage: string
): ValidatedAudienceSelector {
  const fail = (): never =>
    rejectBroadcast(
      locale,
      "BROADCAST_AUDIENCE_INVALID",
      "Admin broadcast rejected: audience selector violates the coherence matrix",
      audienceInvalidMessage
    );

  if (!isBroadcastAudienceType(selector.type)) {
    return fail();
  }

  let validated: ValidatedAudienceSelector | null;
  switch (selector.type) {
    case BroadcastAudienceType.All: {
      validated = validateAllKind(selector);
      break;
    }
    case BroadcastAudienceType.Role: {
      validated = validateRoleKind(selector);
      break;
    }
    case BroadcastAudienceType.Country: {
      validated = validateCountryKind(selector);
      break;
    }
    case BroadcastAudienceType.Plan: {
      validated = validatePlanKind(selector);
      break;
    }
    default: {
      // Fail-closed arm for a runtime-hostile discriminant that evaded the
      // enum guard (TS enums are erased at runtime) — same posture as the
      // audience repository's unhandled-kind arm.
      validated = null;
    }
  }

  if (validated === null) {
    return fail();
  }
  return validated;
}
