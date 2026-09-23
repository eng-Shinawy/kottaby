/**
 * resultPresentation — pure type→presentation maps for the payment-result
 * view (the `plansViewLabels` precedent: namespace-owned localized copy,
 * never raw server data).
 *
 * The authoritative status arrives from the `mySubscriptions` re-query as a
 * codegen `SubscriptionStatus` value. Both the status chip and the arm
 * decision map through the `Record` lookup-table convention (never a switch
 * on enum values) with the unreachable-value fallback keeping each map
 * total.
 */
import type { Palette } from "@mui/material/styles";
import { SubscriptionStatus } from "@/frontend/graphql/generated/gql/graphql";
import { subscriptionStatusChipLabel } from "@/frontend/views/student/subscriptionStatusPresentation";
import type { CheckoutLabels } from "@/shared/locale/types/checkout";

/** The authoritative arm the container renders (server truth only). */
export type PaymentResultArm = "success" | "pending" | "failed";

/** MUI color family per arm — `theme.palette` members only (theme-token rule). */
export type ResultArmColor = "success" | "warning" | "error";

/** The per-arm color table (`warning` is the pending tone — the prototype's amber clock). */
const ARM_COLORS: Readonly<Record<PaymentResultArm, ResultArmColor>> = {
  success: "success",
  pending: "warning",
  failed: "error",
};

/** Resolves the MUI palette family for one arm (the map is total by construction). */
export function resultArmColor(arm: PaymentResultArm): ResultArmColor {
  return ARM_COLORS[arm];
}

/**
 * Container tone for one arm — the Material 3 `on<Color>`/container siblings
 * keyed by arm (the `PermissionDeniedFallback` tinting precedent).
 */
export interface ResultArmTone {
  readonly bg: (palette: Palette) => string;
  readonly on: (palette: Palette) => string;
}

/** The per-arm container-tone table (theme tokens only — never a hex). */
const ARM_TONES: Readonly<Record<PaymentResultArm, ResultArmTone>> = {
  success: {
    bg: palette => palette.successContainer,
    on: palette => palette.onSuccessContainer,
  },
  pending: {
    bg: palette => palette.warningContainer,
    on: palette => palette.onWarningContainer,
  },
  failed: {
    bg: palette => palette.errorContainer,
    on: palette => palette.onErrorContainer,
  },
};

/** Resolves the container tone pair for one arm. */
export function resultArmTone(arm: PaymentResultArm): ResultArmTone {
  return ARM_TONES[arm];
}

/**
 * The lifecycle chip label per authoritative subscription status — resolved
 * through the shared `subscriptionStatusPresentation` map (every view
 * rendering a subscription chip consumes the same checkout-namespace
 * vocabulary; every codegen member carries an entry, so the map is total).
 */
export function statusChipLabel(status: SubscriptionStatus, t: CheckoutLabels): string {
  return subscriptionStatusChipLabel(status, t);
}

/**
 * The authoritative arm decision — the trust boundary of the result page.
 *
 * Server truth comes FIRST and is the only gate for the success arm: an
 * `Active` subscription row (or `undefined` handled by the caller's loading
 * arm) is the ONLY path that renders anything positive. A forged or genuine
 * gateway redirect hint can NEVER produce the success arm — a confirmed
 * activation is visible only when the re-query returns an active row.
 *
 * The negative zone (a pending subscription row — the row type has no
 * failed member, a failed purchase leaves it `Pending` with the payment
 * unverified) is refined by the DISPLAY-ONLY redirect hints: a decline
 * redirect carries `success=false`, so the failed arm's guidance copy is
 * shown; every other negative shape renders the pending arm. The hints can
 * only DOWNGRADE the display inside the negative zone — never elevate it.
 */
export function resolveResultArm(
  subscriptionStatus: SubscriptionStatus | undefined,
  declineHints: boolean
): PaymentResultArm {
  if (subscriptionStatus === SubscriptionStatus.Active) {
    return "success";
  }
  return declineHints ? "failed" : "pending";
}

/**
 * Reads the display-only failure refinement off the untrusted redirect
 * hints: `pending=true` keeps the still-processing arm (an in-flight wallet
 * confirmation is not a decline); `success=false` (case-insensitive) is the
 * decline redirect's shape. Any other value — including the forged
 * `success=true` — refines nothing. The result is consumed ONLY by the
 * negative-zone refinement in `resolveResultArm`; it can never reach the
 * success arm.
 */
export function hintsIndicateDecline(hints: Readonly<Record<string, string | string[] | undefined>>): boolean {
  const pending = hints.pending;
  if (typeof pending === "string" && pending.toLowerCase() === "true") {
    return false;
  }
  const success = hints.success;
  return typeof success === "string" && success.toLowerCase() === "false";
}
