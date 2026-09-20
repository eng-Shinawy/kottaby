/**
 * The subscription drawer section's copy-digest + proration-copy helpers
 * (pure logic tier). Split from `subscriptionAdmin.helpers.ts` (the
 * repo's 150-line view-file convention); the original module re-exports
 * these members so the existing import surface — including the helpers'
 * own test file — keeps working.
 */

import { ProrationDirection, SubscriptionStatus } from "@/frontend/graphql/generated/gql/graphql";

/** Canonical status order for the digest's counts line (the wire enum order). */
const DIGEST_STATUS_ORDER: readonly SubscriptionStatus[] = [
  SubscriptionStatus.Active,
  SubscriptionStatus.Expired,
  SubscriptionStatus.Pending,
  SubscriptionStatus.Cancelled,
  SubscriptionStatus.Suspended,
];

/**
 * One row's digest line: the seam id, the plan snapshot title, the
 * localized status label, and the period's end bound. The end display
 * arrives PRE-FORMATTED (the locale-aware date formatting stays in the
 * owning view — this helper stays string-in/string-out pure).
 */
export function subscriptionDigestRowLine(options: {
  readonly id: string;
  readonly planTitle: string;
  readonly statusLabel: string;
  readonly endLabel: string;
  readonly endDisplay: string;
}): string {
  return `#${options.id} ${options.planTitle} — ${options.statusLabel} — ${options.endLabel}: ${options.endDisplay}`;
}

/**
 * Assembles the copy-digest text the section header's quick action writes
 * to the clipboard: a header line (the section title + the student seam
 * id), the non-zero per-status counts in canonical order, the optional
 * next-expiry line (pre-composed by the caller — it reuses the counted
 * badge forms), a blank separator, then one line per row. Everything
 * arrives as resolved strings; this helper owns only the STRUCTURE so the
 * layout never drifts between locales.
 */
export function buildSubscriptionDigest(pieces: {
  readonly title: string;
  readonly studentId: string | number;
  readonly counts: Record<SubscriptionStatus, number>;
  readonly statusLabels: Record<SubscriptionStatus, string>;
  readonly nextExpiryLine: string | null;
  readonly rowLines: readonly string[];
}): string {
  const countsLine = DIGEST_STATUS_ORDER.filter(status => pieces.counts[status] > 0)
    .map(status => `${pieces.statusLabels[status]}: ${pieces.counts[status]}`)
    .join(" · ");
  const lines = [`${pieces.title} — #${String(pieces.studentId)}`, countsLine];
  if (pieces.nextExpiryLine !== null) {
    lines.push(pieces.nextExpiryLine);
  }
  lines.push("", ...pieces.rowLines);
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Plan-change proration copy

/** Which proration summary line the payload's direction maps to. */
export type ProrationCopyKind = "carried" | "forfeited";

const DIRECTION_COPY_KIND: Record<ProrationDirection, ProrationCopyKind> = {
  [ProrationDirection.Upgrade]: "carried",
  [ProrationDirection.Downgrade]: "forfeited",
};

/** Resolves the proration result-copy slot for the mutation's direction. */
export function prorationCopyKind(direction: ProrationDirection): ProrationCopyKind {
  return DIRECTION_COPY_KIND[direction];
}
