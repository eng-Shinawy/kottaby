/**
 * The drawer subscription section's copy-digest composer: assembles the
 * plain-text summary the section header's quick action writes to the
 * clipboard (title + student seam id, the non-zero per-status counts, the
 * optional next-expiry line, then one line per row). Split from
 * `SubscriptionAdminSection` (the 150-line view-file convention); pure
 * string-in/string-out so the composition stays testable without
 * rendering, and the layout never drifts between locales.
 */

import { formatApplicantDate } from "@/frontend/lib/i18n/format-date";
import {
  buildSubscriptionDigest,
  countByStatus,
  type SubscriptionRow,
  subscriptionDigestRowLine,
} from "@/frontend/views/admin/students/subscriptions/subscriptionAdmin.helpers";
import { statusLabelsOf } from "@/frontend/views/admin/students/subscriptions/subscriptionView.helpers";
import type { AppLocale } from "@/shared/locale";
import type { SubscriptionAdminLabels } from "@/shared/locale/types/subscriptionAdmin";

/**
 * Builds the copy-digest text for the addressed student's subscription
 * list. The next-expiry line reuses the counted badge forms through the
 * same resolution the summary banner does; the end bound renders through
 * the shared locale-aware date formatter (honest em-dash while pending).
 */
export function buildStudentDigestText(options: {
  readonly rows: readonly SubscriptionRow[];
  /** The addressed student's user id (the digest's seam id line). */
  readonly studentId: string | number;
  readonly nextBound: string | null;
  readonly labels: SubscriptionAdminLabels;
  readonly locale: AppLocale;
}): string {
  const { rows, studentId, nextBound, labels, locale } = options;
  const statusLabels = statusLabelsOf(labels);
  const counts = countByStatus(rows);

  const digestRows = rows.map(row =>
    subscriptionDigestRowLine({
      id: row.id,
      planTitle: row.plan.title,
      statusLabel: statusLabels[row.status],
      endLabel: labels.fields.end,
      endDisplay: row.endDate === null ? "—" : formatApplicantDate(row.endDate, locale),
    })
  );
  const digestNextExpiryLine =
    nextBound === null ? null : `${labels.summary.nextExpiry}: ${formatApplicantDate(nextBound, locale)}`;

  return buildSubscriptionDigest({
    title: labels.title,
    studentId,
    counts,
    statusLabels,
    nextExpiryLine: digestNextExpiryLine,
    rowLines: digestRows,
  });
}
