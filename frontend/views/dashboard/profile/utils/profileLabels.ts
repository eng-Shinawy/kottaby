import { Gender, UserRole, AppLocale as WireAppLocale } from "@/frontend/graphql/generated/gql/graphql";
import type { AppLocale } from "@/shared/locale";

/**
 * Maps a shared app locale ("ar"/"en") to its GraphQL wire enum value
 * (`Ar`/`En` — the PascalCase Gender-convention the `AppLocale` enum
 * serializes with; the DB + shared union store lowercase values).
 */
export function toWireAppLocale(locale: AppLocale): WireAppLocale {
  return locale === "ar" ? WireAppLocale.Ar : WireAppLocale.En;
}

/**
 * Maps a GraphQL wire `AppLocale` value back to the shared app locale
 * union — `null` for an unset (never persisted) or unrecognized value.
 */
export function fromWireAppLocale(wire: WireAppLocale | null | undefined): AppLocale | null {
  if (wire === WireAppLocale.Ar) {
    return "ar";
  }
  if (wire === WireAppLocale.En) {
    return "en";
  }
  return null;
}

/**
 * Display name of an app locale, written in the locale's OWN language (the
 * language-picker convention — deliberately NOT run through the translation
 * system so each option always reads natively).
 */
export function languageName(locale: AppLocale): string {
  return locale === "ar" ? "العربية" : "English";
}

/** Maps a UserRole to its translated display label (via the Auth namespace). */
export function getRoleLabel(
  role: UserRole,
  t: { readonly roleStudent: string; readonly roleTeacher: string; readonly roleParent: string }
): string {
  switch (role) {
    case UserRole.Student:
      return t.roleStudent;
    case UserRole.Teacher:
      return t.roleTeacher;
    case UserRole.Parent:
      return t.roleParent;
    default:
      // Admin and unknown roles fall through to a capitalized raw string.
      return role.charAt(0).toUpperCase() + role.slice(1);
  }
}

/** Maps a Gender to its translated display label (via the Auth namespace). */
export function getGenderLabel(
  gender: Gender | null | undefined,
  t: { readonly genderMale: string; readonly genderFemale: string; readonly genderOther: string }
): string | null {
  if (!gender) return null;
  switch (gender) {
    case Gender.Male:
      return t.genderMale;
    case Gender.Female:
      return t.genderFemale;
    case Gender.Other:
      return t.genderOther;
    default:
      return null;
  }
}
