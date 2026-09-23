"use client";

/**
 * WithdrawalQueueCards — the mobile (<`md`) card stack of the withdrawal
 * payout queue (`/admin/finances`, withdrawals tab), extracted from the
 * original monolithic panel as a focused sibling component: stable-key
 * skeleton cards while loading, the honest empty state, and one card per
 * pending request with the same settle actions as the desktop rows.
 *
 * One queue row card: teacher, the status chip, amount (the requester's
 * reserved wallet balance at read time), requested-at timestamp, and the
 * right-aligned approve/reject settle-button pair.
 *
 * All copy comes from the `AdminFinance` namespace; MUI v9 `sx`-only
 * discipline, theme-palette colors.
 */

import { PendingActionsOutlined as EmptyIcon } from "@mui/icons-material";
import { Card, Stack, Typography } from "@mui/material";
import type { SxProps, Theme } from "@mui/material/styles";
import type { ReactNode } from "react";
import type { AdminPendingWithdrawalsQuery_adminPendingWithdrawals_items } from "@/frontend/graphql/generated/gql/graphql";
import { formatApplicantDate, formatLedgerStamp } from "@/frontend/lib/i18n/format-date";
import { formatMoneyAmount } from "@/frontend/views/admin/analytics/platform-analytics-display";
import { directoryPanelCardSx } from "@/frontend/views/admin/directory-shared/directory-skins";
import { WITHDRAWALS_SKELETON_KEYS } from "@/frontend/views/admin/finances/adminFinanceSkeletonKeys";
import { QueueSettleButtons } from "@/frontend/views/admin/finances/WithdrawalQueueSettleButtons";
import { withdrawalStatusLabel, withdrawalStatusTone } from "@/frontend/views/admin/finances/withdrawalStatusDisplay";
import { TonalChip } from "@/frontend/views/admin/users/ui";
import { useAppTranslation } from "@/shared/locale/client";
import { AdminFinance } from "@/shared/locale/namespaces/adminFinance";

/** Mobile queue row card skin — the panel card recipe plus 16px padding. */
function mobileQueueRowCardSx(): SxProps<Theme> {
  return theme => ({
    borderRadius: "12px",
    border: `1px solid ${theme.palette.border.light}`,
    boxShadow: theme.palette.shadow.card,
    p: 2,
  });
}

/** One queue row of the mobile card stack. */
function WithdrawalMobileCardRow({
  item,
  locale,
  onApprove,
  onReject,
}: Readonly<{
  item: AdminPendingWithdrawalsQuery_adminPendingWithdrawals_items;
  locale: string;
  onApprove: (item: AdminPendingWithdrawalsQuery_adminPendingWithdrawals_items) => void;
  onReject: (item: AdminPendingWithdrawalsQuery_adminPendingWithdrawals_items) => void;
}>): ReactNode {
  const t = useAppTranslation(AdminFinance);
  return (
    <Card sx={mobileQueueRowCardSx()}>
      <Stack spacing={1}>
        <Stack direction="row" sx={{ alignItems: "center", justifyContent: "space-between", gap: 2 }}>
          <Typography variant="body2" sx={{ fontWeight: 600 }}>
            {item.teacherName}
          </Typography>
          <TonalChip
            tone={withdrawalStatusTone(item.transaction.status)}
            label={withdrawalStatusLabel(item.transaction.status, t)}
          />
        </Stack>
        <Stack direction="row" sx={{ alignItems: "center", justifyContent: "space-between", gap: 2 }}>
          <Typography variant="caption" component="p" sx={theme => ({ color: theme.palette.text.secondary })}>
            {t.amountHeader}
          </Typography>
          <Typography variant="body2" sx={{ fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>
            {formatMoneyAmount(item.transaction.amount)}
          </Typography>
        </Stack>
        <Stack direction="row" sx={{ alignItems: "center", justifyContent: "space-between", gap: 2 }}>
          <Typography variant="caption" component="p" sx={theme => ({ color: theme.palette.text.secondary })}>
            {t.walletBalanceHeader}
          </Typography>
          <Typography variant="body2" sx={{ fontVariantNumeric: "tabular-nums" }}>
            {formatMoneyAmount(item.walletBalance)}
          </Typography>
        </Stack>
        <Stack direction="row" sx={{ alignItems: "center", justifyContent: "space-between", gap: 2 }}>
          <Typography variant="caption" component="p" sx={theme => ({ color: theme.palette.text.secondary })}>
            {t.requestedAtHeader}
          </Typography>
          <Typography
            variant="body2"
            dir="ltr"
            title={formatApplicantDate(item.transaction.createdAt, locale)}
            sx={theme => ({
              // Isolated LTR box + pure-ASCII stamp: the ICU `ar` stamp embeds
              // RLM controls that mash the visible order inside an RTL cell
              // (QA finding) — the numeric stamp pins the glyph order, and the
              // locale-aware full stamp rides the native tooltip.
              unicodeBidi: "isolate",
              fontVariantNumeric: "tabular-nums",
              whiteSpace: "nowrap",
              color: theme.palette.text.secondary,
              cursor: "default",
            })}
          >
            {formatLedgerStamp(item.transaction.createdAt)}
          </Typography>
        </Stack>
        <QueueSettleButtons
          transactionId={item.transaction.id}
          onApprove={() => {
            onApprove(item);
          }}
          onReject={() => {
            onReject(item);
          }}
          approveLabel={t.approveAction}
          rejectLabel={t.rejectAction}
          justifyContent="flex-end"
        />
      </Stack>
    </Card>
  );
}

/**
 * Mobile (<md) withdrawal-queue card stack: stable-key skeleton cards while
 * loading, the honest empty state, and one card per pending request with
 * the same settle actions as the desktop rows.
 */
export function WithdrawalMobileCards({
  items,
  loading,
  locale,
  onApprove,
  onReject,
}: Readonly<{
  items: readonly AdminPendingWithdrawalsQuery_adminPendingWithdrawals_items[];
  loading: boolean;
  locale: string;
  onApprove: (item: AdminPendingWithdrawalsQuery_adminPendingWithdrawals_items) => void;
  onReject: (item: AdminPendingWithdrawalsQuery_adminPendingWithdrawals_items) => void;
}>): ReactNode {
  const t = useAppTranslation(AdminFinance);
  return (
    <Stack spacing={2}>
      {loading && items.length === 0
        ? WITHDRAWALS_SKELETON_KEYS.slice(0, 4).map(rowKey => <Card key={rowKey} sx={directoryPanelCardSx()} />)
        : null}
      {!loading && items.length === 0 ? (
        <Card sx={directoryPanelCardSx()}>
          <Stack spacing={1} sx={{ alignItems: "center", py: 6 }}>
            <EmptyIcon sx={theme => ({ fontSize: 48, color: theme.palette.text.secondary })} />
            <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
              {t.withdrawalsEmpty}
            </Typography>
          </Stack>
        </Card>
      ) : null}
      {items.map(item => (
        <WithdrawalMobileCardRow
          key={item.transaction.id}
          item={item}
          locale={locale}
          onApprove={onApprove}
          onReject={onReject}
        />
      ))}
    </Stack>
  );
}
