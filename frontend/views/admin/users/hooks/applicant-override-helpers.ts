/**
 * Applicant-override helpers — pure functions extracted from
 * `useApplicantOverride` so the hook module stays under the `max-lines`
 * (150) cap for `frontend/views/**` files.
 *
 * Covers the three override directions of the
 * `adminOverrideApplicantEvaluation` mutation (certify / grant
 * re-evaluation / reject): per-action dialog copy resolution, the
 * reject-only cooldown-days field visibility, the client-mirrored bounds
 * gate, and the server-error routing matrix.
 */

import {
  AdminApplicantOverrideAction,
  ApplicantCooldownState,
  ApplicantStatus,
} from "@/frontend/graphql/generated/gql/graphql";
import { extractErrorCode, extractErrorMessage } from "@/frontend/lib/graphql-error-utils";
import type { AdminUsersLabels } from "@/shared/locale/types/adminUsers";

/** The wire enum driving the three override directions. */
export type OverrideAction = AdminApplicantOverrideAction;

/** Resolved i18n copy for the override affordance (`applicantOverride`). */
export type OverrideCopy = AdminUsersLabels["applicantOverride"];

/** In-dialog conflict banner (typed domain rejections, server-localized). */
export type OverrideInlineAlert = { readonly severity: "info" | "warning"; readonly message: string };

/** Per-action dialog chrome (title / body / confirm label / confirm tone). */
export interface OverrideActionMeta {
  readonly title: string;
  readonly message: string;
  readonly confirm: string;
  readonly confirmColor: "success" | "secondary" | "error";
}

/** Mirrors the server-side bounds for the reject cooldown window (1..3650). */
export const OVERRIDE_MIN_DAYS = 1;
export const OVERRIDE_MAX_DAYS = 3650;

/**
 * Client mirror of the server-side CERTIFY eligibility gate — certification
 * is terminal, so the affordance is meaningless on a passed applicant (the
 * server denies with `APPLICANT_ALREADY_CERTIFIED`).
 */
export function isCertifyEligible(status: ApplicantStatus): boolean {
  return status !== ApplicantStatus.Passed;
}

/**
 * Client mirror of the server-side GRANT eligibility gate — granting
 * re-evaluation clears a cooldown, so it is meaningless with nothing
 * recorded (the server denies with `APPLICANT_NO_ACTIVE_COOLDOWN`).
 */
export function isGrantEligible(cooldownState: ApplicantCooldownState): boolean {
  return cooldownState === ApplicantCooldownState.Active || cooldownState === ApplicantCooldownState.Expired;
}

/**
 * Client mirror of the server-side REJECT eligibility gate — rejection
 * supersedes the algorithm's PASSED verdict, so it targets passed
 * applicants only (the server denies with `APPLICANT_OVERRIDE_NOT_PASSED`).
 */
export function isRejectEligible(status: ApplicantStatus): boolean {
  return status === ApplicantStatus.Passed;
}

/**
 * Whether the dialog renders the cooldown-days field for an action —
 * REQUIRED semantics for reject (validated server-side), IGNORED for
 * certify / grant_re_evaluation (the `adminSetUserSuspended` `periodDays`
 * precedent: send the arg only for the direction that consumes it).
 */
export function overrideUsesDays(action: OverrideAction): boolean {
  return action === AdminApplicantOverrideAction.Reject;
}

/**
 * Client mirror of the server-side reject bounds gate — an invalid value
 * never crosses the wire (same discipline as the extension + suspend
 * day-count gates).
 */
export function isValidOverrideDays(raw: string): boolean {
  if (raw.trim() === "") return false;
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed >= OVERRIDE_MIN_DAYS && parsed <= OVERRIDE_MAX_DAYS;
}

/** Per-action dialog chrome — resolved from the localized copy block. */
export function metaForOverride(copy: OverrideCopy, action: OverrideAction): OverrideActionMeta {
  if (action === AdminApplicantOverrideAction.Certify) {
    return {
      title: copy.dialogTitleCertify,
      message: copy.certifyDesc,
      confirm: copy.certifyConfirm,
      confirmColor: "success",
    };
  }
  if (action === AdminApplicantOverrideAction.GrantReEvaluation) {
    return {
      title: copy.dialogTitleGrant,
      message: copy.grantDesc,
      confirm: copy.grantConfirm,
      confirmColor: "secondary",
    };
  }
  return {
    title: copy.dialogTitleReject,
    message: copy.rejectDesc,
    confirm: copy.rejectConfirm,
    confirmColor: "error",
  };
}

/** Per-action success snackbar copy. */
export function successToastOf(copy: OverrideCopy, action: OverrideAction): string {
  if (action === AdminApplicantOverrideAction.Certify) return copy.successToastCertify;
  if (action === AdminApplicantOverrideAction.GrantReEvaluation) return copy.successToastGrant;
  return copy.successToastReject;
}

/**
 * Server-error → inline state mutation. Routing matrix for the override
 * mutation's typed rejections:
 *  - `FORBIDDEN` → suppressed inline (rides the global toast path);
 *  - `APPLICANT_OVERRIDE_COOLDOWN_INVALID` + the generic `VALIDATION` class
 *    → field-level `helperText` on the cooldown-days input;
 *  - any other typed domain rejection (`APPLICANT_ALREADY_CERTIFIED`,
 *    `APPLICANT_OVERRIDE_NOT_PASSED`, `APPLICANT_NO_ACTIVE_COOLDOWN`,
 *    `APPLICANT_ALREADY_FINALIZED`, `APPLICANT_NOT_FOUND`, …) → in-dialog
 *    info alert carrying the SERVER-localized message.
 */
export function buildOverrideRouteError(
  setDaysErr: (msg: string | null) => void,
  setAlert: (a: OverrideInlineAlert | null) => void
): (err: unknown) => void {
  return err => {
    const code = extractErrorCode(err);
    if (code === "FORBIDDEN") return undefined;
    if (code === "APPLICANT_OVERRIDE_COOLDOWN_INVALID" || code === "VALIDATION") {
      setDaysErr(extractErrorMessage(err));
      return undefined;
    }
    setAlert({ severity: "info", message: extractErrorMessage(err) ?? "" });
    return undefined;
  };
}
