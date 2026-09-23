/**
 * Onboarding dialog view-model — the LOCAL dialog form state, its draft
 * vocabulary, and the two pure submit mappings.
 *
 * The dialog's controlled state is a flat, string-tokened draft: enum
 * members ride as raw tokens (`gender`, `paymentMethod`) and are mapped
 * onto the generated members through the `Record` lookups below (the
 * repo's unsafe-enum discipline). Option and result shapes are deliberately
 * NOT redefined here — the codegen-extracted query/mutation types
 * (`AdminUsersQuery_adminUsers_items`, `PlanCatalogQuery_planCatalog`,
 * `AdminOnboardStudentOfflineInput`, the onboarding mutation result)
 * thread through the component props verbatim so the hooks layer can pass
 * query data through with zero mapping.
 */

import { type AdminOnboardStudentOfflineInput, Gender, PaymentGateway } from "@/frontend/graphql/generated/gql/graphql";
import type { StudentOnboardingLabels } from "@/shared/locale/types/studentOnboarding";

/** The controlled form state shared by the onboarding dialog sections. */
export interface OnboardStudentFormState {
  /** The student's full name. */
  readonly fullName: string;
  /** The globally-unique login email. */
  readonly email: string;
  /** The contact phone number. */
  readonly phone: string;
  /** The admin-authored initial password (exact-value input, never trimmed). */
  readonly password: string;
  /** Gender select token ("" = leave unset — the select's unspecified slot). */
  readonly gender: "" | "Male" | "Female" | "Other";
  /** The student's country of residence. */
  readonly country: string;
  /** Picked parent user id; null onboards without a parent link. */
  readonly parentId: number | null;
  /** Picked active-plan id (GraphQL ID token; "" until a plan is bound). */
  readonly planId: string;
  /** Offline method token (a `PaymentGateway` member string; "" until picked). */
  readonly paymentMethod: string;
  /** The human payment reference (trimmed and bounded at submit). */
  readonly paymentReference: string;
}

/** Field keys addressed by the sections' change seams and error lookups. */
type OnboardStudentFieldKey = keyof OnboardStudentFormState;

/**
 * Per-field error map rendered inline as `helperText`: server VALIDATION
 * messages keyed by the input field name plus the dialog's own submit-time
 * checks (offline method + payment reference), merged by the dialog host.
 */
export type OnboardStudentFieldErrors = Partial<Record<OnboardStudentFieldKey, string>>;

/** Draft of a fresh dialog — every open starts an empty onboarding. */
export const EMPTY_ONBOARD_STUDENT_FORM: OnboardStudentFormState = {
  fullName: "",
  email: "",
  phone: "",
  password: "",
  gender: "",
  country: "",
  parentId: null,
  planId: "",
  paymentMethod: "",
  paymentReference: "",
};

/** Gender token → generated member (`Record` lookup — no enum comparisons). */
const GENDER_BY_TOKEN: Record<string, Gender> = {
  [Gender.Male]: Gender.Male,
  [Gender.Female]: Gender.Female,
  [Gender.Other]: Gender.Other,
};

/** Offline-method token → generated member (the three settled offline gateways). */
const OFFLINE_GATEWAY_BY_TOKEN: Record<string, PaymentGateway> = {
  [PaymentGateway.OfflineCash]: PaymentGateway.OfflineCash,
  [PaymentGateway.BankTransfer]: PaymentGateway.BankTransfer,
  [PaymentGateway.Scholarship]: PaymentGateway.Scholarship,
};

/**
 * The payment-reference ceiling — the `payment_reference` column is
 * varchar(255). The literal is deliberately DUPLICATED, never imported:
 * the server bound (`PAYMENT_REFERENCE_MAX_LENGTH` in
 * `backend/services/admin/student-onboarding.helpers.ts`) is backend
 * runtime machinery that must not ride into the client bundle. The server
 * bound stays the authority — a drift here degrades to the generic server
 * validation error, never to a persisted over-length reference.
 */
const REFERENCE_MAX_LENGTH = 255;

/**
 * The dialog's own submit-time checks — deliberately narrow (the service
 * re-validates everything): the reference is REQUIRED for every offline
 * method and must land within 1–255 characters after trimming, and the
 * picked method must resolve to an offline gateway member.
 */
export function validateOfflinePaymentDraft(
  form: OnboardStudentFormState,
  errorCopy: StudentOnboardingLabels["errors"]
): OnboardStudentFieldErrors {
  const errors: OnboardStudentFieldErrors = {};
  const reference = form.paymentReference.trim();
  if (reference.length === 0 || reference.length > REFERENCE_MAX_LENGTH) {
    errors.paymentReference = errorCopy.referenceInvalid;
  }
  // An UNSET method is a different miss than an unsupported token — each
  // gets its own copy line ("pick one" vs "that one can't settle here").
  if (form.paymentMethod.length === 0) {
    errors.paymentMethod = errorCopy.methodRequired;
  } else if (!Object.hasOwn(OFFLINE_GATEWAY_BY_TOKEN, form.paymentMethod)) {
    errors.paymentMethod = errorCopy.methodNotOffline;
  }
  return errors;
}

/**
 * Maps the draft onto the mutation's whitelist input, field-by-field:
 * identity fields are trimmed, the credential rides verbatim (exact-value
 * input), the optional gender resolves through its token table (an unknown
 * token downgrades to unset), and the parent id passes through as-is.
 */
export function buildOnboardStudentInput(
  form: OnboardStudentFormState,
  planId: number
): AdminOnboardStudentOfflineInput {
  return {
    fullName: form.fullName.trim(),
    email: form.email.trim(),
    phone: form.phone.trim(),
    password: form.password,
    gender: Object.hasOwn(GENDER_BY_TOKEN, form.gender) ? GENDER_BY_TOKEN[form.gender] : null,
    country: form.country.trim(),
    parentId: form.parentId,
    planId,
    paymentMethod: OFFLINE_GATEWAY_BY_TOKEN[form.paymentMethod],
    paymentReference: form.paymentReference.trim(),
  };
}
