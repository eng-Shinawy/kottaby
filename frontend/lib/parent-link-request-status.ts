import { LinkStatus } from "@/frontend/graphql/generated/gql/graphql";
import type { ParentLinkLabels } from "@/shared/locale/types/parentLink";

/**
 * Shared computed-status machinery for the parent-link request
 * cards (student incoming queue + parent outgoing list).
 *
 * Read purity: a stored `pending` row whose `expiresAt` moment has
 * passed renders the expired chip and loses its CTAs WITHOUT any write —
 * the materialization stays server-side. The strict-`>` liveness here is
 * byte-for-byte parity with the service classifier
 * (`actionable ⇔ status pending AND expiresAt > now`), so both surfaces
 * ALWAYS agree with the server's verdict after a refetch.
 *
 * Enum-keyed `Record` lookups throughout — the sanctioned
 * `no-unsafe-enum-comparison` pattern (no switch on enum values).
 */

/** Only a stored `Pending` row is a liveness candidate. */
const PENDING_LIVE_CANDIDATE: Readonly<Record<LinkStatus, boolean>> = {
  [LinkStatus.Pending]: true,
  [LinkStatus.Confirmed]: false,
  [LinkStatus.Rejected]: false,
  [LinkStatus.Expired]: false,
};

/**
 * True when the row still exposes its interactive affordances: a stored
 * `pending` row whose expiry moment has NOT passed (strict `>`, parity with
 * the backend liveness classifier).
 */
export function isLinkRequestActionable(status: LinkStatus, expiresAt: string, nowMs: number): boolean {
  return PENDING_LIVE_CANDIDATE[status] && new Date(expiresAt).getTime() > nowMs;
}

/**
 * The DISPLAYED chip status: live-pending rows show `Pending`; stored-pending
 * rows past their expiry show the COMPUTED `Expired` verdict (never the stale
 * stored write); terminal rows show their stored status.
 */
export function displayLinkRequestStatus(status: LinkStatus, expiresAt: string, nowMs: number): LinkStatus {
  if (isLinkRequestActionable(status, expiresAt, nowMs)) {
    return LinkStatus.Pending;
  }
  if (PENDING_LIVE_CANDIDATE[status]) {
    return LinkStatus.Expired;
  }
  return status;
}

/**
 * Status chip label + theme-palette severity role per wire status — shared by
 * both parent-link card surfaces so the same status never renders with two
 * different palettes. Exhaustiveness is compiler-enforced by the
 * `Record<LinkStatus, …>` key type; severity roles stay inside
 * success/warning/error.
 */
export function parentLinkStatusChipSpec(
  labels: ParentLinkLabels
): Readonly<Record<LinkStatus, { readonly label: string; readonly color: "success" | "warning" | "error" }>> {
  return {
    [LinkStatus.Pending]: { label: labels.statusPending, color: "warning" },
    [LinkStatus.Confirmed]: { label: labels.statusConfirmed, color: "success" },
    [LinkStatus.Rejected]: { label: labels.statusRejected, color: "error" },
    [LinkStatus.Expired]: { label: labels.statusExpired, color: "error" },
  };
}
