"use client";

/**
 * AdminFinancesContainer — the client orchestrator behind `/admin/finances`
 * (the admin financial auditing console): the payments audit panel, the
 * withdrawal payout queue, and the teacher wallet inspector.
 *
 * Tab state mirrors the teachers surface's shareable-URL contract — the
 * bidirectional `?tab=` / `?teacherId=` wiring lives in
 * {@link useFinancesUrlState}; this container is the view over it.
 *
 * Panels stay MOUNTED while hidden (the `hidden` attribute — the MUI
 * TabPanel recipe) so switching tabs preserves each tab's filter/page
 * state; all three tab queries run from mount. The withdrawals tab label
 * carries a LIVE pending-count badge (the same queue document at the
 * narrowest window; the settlement mutations refetch it by name, so it
 * self-updates on every approve/reject).
 *
 * The settlement/adjustment mutations live in the panels' dialogs; every
 * outcome surfaces a container-level snackbar through
 * {@link AdminFinancesNoticeSnackbar} (success / error lanes — the raw
 * server `message` is NEVER echoed). Page-level authorization is the
 * server admin route guard — this container performs no role logic.
 *
 * MUI v9 discipline: `sx`-only styling, colors exclusively through
 * `theme.palette.*` callbacks, `*Outlined` icons only, ≥44px touch
 * targets, RTL-safe logical composition, `useAppTranslation(AdminFinance)`
 * property access for every label (no literal copy anywhere).
 */

import { Box, Card, Stack, Tab, Tabs } from "@mui/material";
import type { ReactNode } from "react";
import { DirectoryPageHeader } from "@/frontend/views/admin/directory-shared/DirectoryPageHeader";
import type { FinancesTab } from "@/frontend/views/admin/finances/finances-url-state";
import { PaymentsAuditPanel } from "@/frontend/views/admin/finances/PaymentsAuditPanel";
import { usePendingWithdrawalCount } from "@/frontend/views/admin/finances/useAdminFinanceQueries";
import { useFinancesUrlState } from "@/frontend/views/admin/finances/useFinancesUrlState";
import { WalletInspectorPanel } from "@/frontend/views/admin/finances/WalletInspectorPanel";
import { WithdrawalQueuePanel } from "@/frontend/views/admin/finances/WithdrawalQueuePanel";
import { WithdrawalsTabLabel } from "@/frontend/views/admin/finances/WithdrawalsTabLabel";
import { useAppTranslation } from "@/shared/locale/client";
import { AdminFinance } from "@/shared/locale/namespaces/adminFinance";

/** The tab ids of the three panels (stable DOM ids for the TabPanel recipe). */
const TAB_IDS: Readonly<Record<FinancesTab, { tab: string; panel: string }>> = {
  payments: { tab: "finances-tab-payments", panel: "finances-panel-payments" },
  withdrawals: { tab: "finances-tab-withdrawals", panel: "finances-panel-withdrawals" },
  wallet: { tab: "finances-tab-wallet", panel: "finances-panel-wallet" },
};

/**
 * The tab order of the strip, as a typed guard (no unsafe key cast).
 */
const TAB_ORDER: readonly FinancesTab[] = ["payments", "withdrawals", "wallet"];

/**
 * The finances console view: always-on chrome (title + tab strip) over the
 * three kept-mounted panels, plus the container-level snackbar chrome.
 */
export function AdminFinancesContainer(): ReactNode {
  const t = useAppTranslation(AdminFinance);
  // The withdrawals-tab badge: live pending-queue depth.
  const pendingCount = usePendingWithdrawalCount();

  // ── Shareable-URL wiring (tab + picker seed, mirrored back to ?tab/?teacherId) ──
  const { activeTab, setActiveTab, walletTeacherId, setWalletTeacherId } = useFinancesUrlState();

  const tabLabels: Readonly<Record<FinancesTab, string>> = {
    payments: t.paymentsTab,
    withdrawals: t.withdrawalsTab,
    wallet: t.walletInspectorTab,
  };

  return (
    <Stack spacing={3} sx={{ width: "100%", p: { xs: 2, md: 3 } }}>
      <DirectoryPageHeader title={t.title} subtitle={t.subtitle} />

      <Card
        sx={theme => ({
          borderRadius: "12px",
          border: `1px solid ${theme.palette.border.light}`,
          boxShadow: theme.palette.shadow.card,
        })}
      >
        <Tabs
          value={activeTab}
          onChange={(_, value: FinancesTab) => {
            setActiveTab(value);
          }}
          // Scrollable (not fullWidth): the three labels overflow 390px
          // viewports; scrollable keeps desktop identical and lets narrow
          // screens pan the strip instead of bleeding past the viewport.
          variant="scrollable"
          scrollButtons={false}
          aria-label={t.title}
          sx={theme => ({ paddingInline: 2, borderBottom: `1px solid ${theme.palette.border.light}` })}
        >
          {TAB_ORDER.map(tab => (
            <Tab
              key={tab}
              value={tab}
              label={
                tab === "withdrawals" ? (
                  <WithdrawalsTabLabel
                    label={tabLabels[tab]}
                    count={pendingCount}
                    countTitle={t.pendingWithdrawalsCount(pendingCount)}
                  />
                ) : (
                  tabLabels[tab]
                )
              }
              id={TAB_IDS[tab].tab}
              aria-controls={TAB_IDS[tab].panel}
              sx={{ minHeight: 48, textTransform: "none", fontWeight: 600, fontSize: 15 }}
            />
          ))}
        </Tabs>
      </Card>

      {/*
        All three panels stay MOUNTED while hidden (the `hidden` attribute —
        display:none removes them from the tab order and the accessibility
        tree) so each tab keeps its filter/page state across switches.
      */}
      <Box
        role="tabpanel"
        id={TAB_IDS.payments.panel}
        aria-labelledby={TAB_IDS.payments.tab}
        hidden={activeTab !== "payments"}
      >
        <PaymentsAuditPanel />
      </Box>

      <Box
        role="tabpanel"
        id={TAB_IDS.withdrawals.panel}
        aria-labelledby={TAB_IDS.withdrawals.tab}
        hidden={activeTab !== "withdrawals"}
      >
        <WithdrawalQueuePanel />
      </Box>

      <Box
        role="tabpanel"
        id={TAB_IDS.wallet.panel}
        aria-labelledby={TAB_IDS.wallet.tab}
        hidden={activeTab !== "wallet"}
      >
        <WalletInspectorPanel initialTeacherId={walletTeacherId} onTeacherChange={setWalletTeacherId} />
      </Box>
    </Stack>
  );
}
