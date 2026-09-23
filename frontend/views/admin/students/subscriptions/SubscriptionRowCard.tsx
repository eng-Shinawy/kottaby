"use client";

/**
 * SubscriptionRowCard — one subscription row of the admin student drawer's
 * subscription-management section: the plan header (tinted glyph, snapshot
 * title, the `#<id>` seam identifier + the copy-id quick action), the
 * status chip beside the relative expiry-window badge (the badge rides
 * only the statuses whose window can actually end — active/expired/
 * pending — a CANCELLED row's bound is a would-have-been value, so the
 * countdown is withheld and the status chip speaks alone), the start/end
 * label-value rows (the drawer's `DirectoryLabelValueRow` recipe, honest
 * em-dash while a period bound is pending), the per-status lifecycle
 * action buttons (active → extend/cancel/change plan; expired → renew;
 * pending/cancelled → none), and the audit-trail deep link footer. The
 * card's inline-start edge carries a status-tone accent bar — the per-row
 * lifecycle lane reads at a glance, in both reading directions.
 *
 * Presentational: the row data arrives via props; every label resolves in
 * the owning section through the `subscriptionAdmin` namespace; the badge
 * and the audit link are their own focused components. MUI v9 `sx`-only
 * styling with the shared directory tone lanes (no hardcoded colors);
 * RTL/LTR discipline is inherited from the drawer.
 */
import { Box, Divider, Stack } from "@mui/material";
import type { ReactNode } from "react";
import { SubscriptionStatus } from "@/frontend/graphql/generated/gql/graphql";
import { formatApplicantDate } from "@/frontend/lib/i18n/format-date";
import { actionLabelsOf } from "@/frontend/views/admin/audit/audit-trail-filters";
import {
  DirectoryEmptyValue,
  DirectoryLabelValueRow,
} from "@/frontend/views/admin/directory-shared/DirectoryDrawerPrimitives";
import { SubscriptionAuditLinkButton } from "@/frontend/views/admin/students/subscriptions/SubscriptionAuditLinkButton";
import { SubscriptionExpiryBadge } from "@/frontend/views/admin/students/subscriptions/SubscriptionExpiryBadge";
import { SubscriptionPlanFactsLine } from "@/frontend/views/admin/students/subscriptions/SubscriptionPlanFactsLine";
import { SubscriptionRowActionsBar } from "@/frontend/views/admin/students/subscriptions/SubscriptionRowActionsBar";
import { LastActionChip, StatusChip } from "@/frontend/views/admin/students/subscriptions/SubscriptionRowCard.chips";
import { SubscriptionRowCardHeader } from "@/frontend/views/admin/students/subscriptions/SubscriptionRowCardHeader";
import {
  STATUS_TONE,
  type SubscriptionRow,
  type SubscriptionRowActions,
} from "@/frontend/views/admin/students/subscriptions/subscriptionAdmin.helpers";
import { toneColors } from "@/frontend/views/admin/users/utils";
import type { AppLocale } from "@/shared/locale";
import type { AdminUsersLabels } from "@/shared/locale/types/adminUsers";
import type { SubscriptionAdminLabels } from "@/shared/locale/types/subscriptionAdmin";

/** The per-row caption + action + quick-action labels the card renders (pre-resolved). */
export interface SubscriptionRowCardLabels {
  readonly fields: {
    readonly plan: string;
    readonly status: string;
    readonly start: string;
    readonly end: string;
    readonly lastAction: string;
  };
  /** The counted plan-facts fragments (the snapshot summary line). */
  readonly planFacts: SubscriptionAdminLabels["planFacts"];
  readonly actions: {
    readonly extend: string;
    readonly renew: string;
    readonly cancel: string;
    readonly changePlan: string;
  };
  readonly expiryBadge: {
    readonly upcoming: (days: number) => string;
    readonly past: (days: number) => string;
  };
  readonly copyId: {
    readonly copy: string;
    readonly copied: string;
  };
  readonly auditLink: string;
  /** The counted trail-depth badge copy (the audit link's pill). */
  readonly auditLinkCount: (count: number) => string;
  /** The adminUsers activity block — single-sources the audit action labels. */
  readonly activityLabels: AdminUsersLabels["activity"];
}

interface SubscriptionRowCardProps {
  readonly row: SubscriptionRow;
  /** Resolved per-status action availability (the pure matrix). */
  readonly actions: SubscriptionRowActions;
  /** Status labels keyed by the wire enum (resolved in the section). */
  readonly statusLabels: Record<SubscriptionStatus, string>;
  readonly labels: SubscriptionRowCardLabels;
  readonly locale: AppLocale;
  readonly onExtend: (row: SubscriptionRow) => void;
  readonly onRenew: (row: SubscriptionRow) => void;
  readonly onCancel: (row: SubscriptionRow) => void;
  readonly onChangePlan: (row: SubscriptionRow) => void;
}

export function SubscriptionRowCard({
  row,
  actions,
  statusLabels,
  labels,
  locale,
  onExtend,
  onRenew,
  onCancel,
  onChangePlan,
}: SubscriptionRowCardProps): ReactNode {
  return (
    <Box
      sx={theme => {
        const accent = toneColors(theme, STATUS_TONE[row.status]).dot;
        return {
          borderRadius: "12px",
          border: `1px solid ${theme.palette.border.light}`,
          borderInlineStartWidth: 3,
          borderInlineStartStyle: "solid",
          borderInlineStartColor: accent,
          p: 1.5,
          transition: theme.transitions.create(["border-color", "box-shadow"], {
            duration: theme.transitions.duration.shorter,
          }),
          "&:hover": {
            borderColor: theme.palette.outlineVariant,
            boxShadow: theme.shadows[2],
          },
        };
      }}
    >
      <SubscriptionRowCardHeader row={row} copyIdLabels={labels.copyId} />
      <SubscriptionPlanFactsLine row={row} planFactsLabels={labels.planFacts} />
      <DirectoryLabelValueRow label={labels.fields.status}>
        <Stack direction="row" spacing={0.75} sx={{ alignItems: "center", flexWrap: "wrap", gap: 0.75 }}>
          <StatusChip status={row.status} labels={statusLabels} />
          {row.status !== SubscriptionStatus.Cancelled && row.endDate !== null && (
            <SubscriptionExpiryBadge endDate={row.endDate} locale={locale} labels={labels.expiryBadge} />
          )}
        </Stack>
      </DirectoryLabelValueRow>
      <DirectoryLabelValueRow label={labels.fields.start}>
        {row.startDate === null ? <DirectoryEmptyValue /> : formatApplicantDate(row.startDate, locale)}
      </DirectoryLabelValueRow>
      <DirectoryLabelValueRow label={labels.fields.end}>
        {row.endDate === null ? <DirectoryEmptyValue /> : formatApplicantDate(row.endDate, locale)}
      </DirectoryLabelValueRow>
      {row.auditTrailPeek !== null && (
        <DirectoryLabelValueRow label={labels.fields.lastAction}>
          <Stack direction="row" spacing={0.75} sx={{ alignItems: "center", flexWrap: "wrap", gap: 0.75 }}>
            <LastActionChip actionLabel={actionLabelsOf(labels.activityLabels)[row.auditTrailPeek.actionType]} />
            <Box component="span" sx={theme => ({ color: theme.palette.text.secondary })}>
              {formatApplicantDate(row.auditTrailPeek.at, locale)}
            </Box>
          </Stack>
        </DirectoryLabelValueRow>
      )}
      {hasAnyAction(actions) && (
        <SubscriptionRowActionsBar
          row={row}
          actions={actions}
          labels={labels.actions}
          onExtend={onExtend}
          onRenew={onRenew}
          onCancel={onCancel}
          onChangePlan={onChangePlan}
        />
      )}
      <Divider sx={theme => ({ my: 1, borderColor: theme.palette.border.light })} />
      <SubscriptionAuditLinkButton
        subscriptionId={row.id}
        label={labels.auditLink}
        count={row.auditEntriesCount}
        countLabel={labels.auditLinkCount(row.auditEntriesCount)}
      />
    </Box>
  );
}

/** Whether the status affords ANY lifecycle action (gates the button row). */
function hasAnyAction(actions: SubscriptionRowActions): boolean {
  return actions.extend || actions.renew || actions.cancel || actions.changePlan;
}
