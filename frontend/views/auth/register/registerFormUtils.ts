import { Gender, type RecitationReading, RegisterPublicRole } from "@/frontend/graphql/generated/gql/graphql";
import { isValidEmail } from "@/shared/lib/email";
import type { AuthLabels } from "@/shared/locale/types/auth";

/** Minimum password length — mirrors `registration.service.ts`. */
export const MIN_PASSWORD_LENGTH = 8;

/** Shared helper-text treatment for the manual helper nodes */
export const helperTextSx = { lineHeight: 1.6 };

/** Honor prefers-reduced-motion for the submit CTA motion. */
export const reducedMotionSx = {
  "@media (prefers-reduced-motion: reduce)": {
    transition: "none",
    "&:hover": {
      transform: "none",
    },
  },
};

/**
 * Re-export `isValidEmail` under its legacy form-utility name so existing
 * form callers keep a semantically accurate callsite.
 */
export const isValidEmailShape = isValidEmail;

/**
 * Field paths the server may address in `extensions.fields[]` pairs.
 */
export const REGISTER_FIELD_PATHS = [
  "fullName",
  "email",
  "phone",
  "password",
  "country",
  "gender",
  "role",
  "preferredRecitation",
] as const;

export type RegisterFieldPath = (typeof REGISTER_FIELD_PATHS)[number];

/** Assertion-free narrowing guard over the registration form's field paths. */
export function isRegisterFieldPath(value: string): value is RegisterFieldPath {
  return REGISTER_FIELD_PATHS.some(path => path === value);
}

/**
 * Local string-keyed lookup tables for the form's select fields.
 */
const GENDER_BY_SELECT_VALUE: Readonly<Record<string, Gender>> = {
  [Gender.Male]: Gender.Male,
  [Gender.Female]: Gender.Female,
  [Gender.Other]: Gender.Other,
};

/** Pins a raw select value back to {@link Gender} (else `null`). */
export function genderFromSelectValue(rawValue: string): Gender | null {
  return GENDER_BY_SELECT_VALUE[rawValue] ?? null;
}

const ROLE_BY_SELECT_VALUE: Readonly<Record<string, RegisterPublicRole>> = {
  [RegisterPublicRole.Student]: RegisterPublicRole.Student,
  [RegisterPublicRole.Teacher]: RegisterPublicRole.Teacher,
  [RegisterPublicRole.Parent]: RegisterPublicRole.Parent,
};

/** Pins a raw select value back to {@link RegisterPublicRole} (else `""`). */
export function roleFromSelectValue(rawValue: string): RegisterPublicRole | "" {
  return ROLE_BY_SELECT_VALUE[rawValue] ?? "";
}

export interface RegisterFormValues {
  fullName: string;
  email: string;
  phone: string;
  password: string;
  country: string;
  gender: Gender | null;
  role: RegisterPublicRole | "";
  preferredRecitation: RecitationReading | null;
}

/**
 * Maps the currently-selected role to its translated helper text.
 */
export function getRoleHelperText(role: RegisterPublicRole | "", t: AuthLabels): string {
  switch (role) {
    case RegisterPublicRole.Student:
      return t.roleStudentHelper;
    case RegisterPublicRole.Teacher:
      return t.roleTeacherHelper;
    case RegisterPublicRole.Parent:
      return t.roleParentHelper;
    default:
      return "";
  }
}

/**
 * Evaluates password strength based on length, character diversity, and
 * special characters. Returns a 0–4 score, a translated label, and an
 * MUI palette color token for the strength meter bars.
 */
export function getPasswordStrength(pw: string, t: AuthLabels): { score: number; label: string; color: string } {
  if (pw.length === 0) return { score: 0, label: "", color: "var(--mui-palette-divider)" };
  let score = 0;
  if (pw.length >= 8) score++;
  if (pw.length >= 12) score++;
  if (/[A-Z]/.test(pw)) score++;
  if (/\d/.test(pw)) score++;
  if (/[^A-Za-z0-9]/.test(pw)) score++;
  if (score <= 1) return { score: 1, label: t.passwordStrengthWeak, color: "var(--mui-palette-error-main)" };
  if (score <= 2) return { score: 2, label: t.passwordStrengthFair, color: "var(--mui-palette-warning-main)" };
  if (score <= 3) return { score: 3, label: t.passwordStrengthGood, color: "var(--mui-palette-info-main)" };
  return { score: 4, label: t.passwordStrengthStrong, color: "var(--mui-palette-success-main)" };
}

/**
 * Maps the role-select error state to the id of its helper node.
 */
export function getRoleSelectDescribedBy(hasRoleError: boolean): string | undefined {
  return hasRoleError ? "register-role-error-helper" : undefined;
}
