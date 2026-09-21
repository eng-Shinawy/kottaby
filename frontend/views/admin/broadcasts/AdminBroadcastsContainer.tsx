"use client";

import { Box, Stack } from "@mui/material";
import { type ReactNode, useState } from "react";
import { AdminBroadcastsTabStrip } from "@/frontend/views/admin/broadcasts/AdminBroadcastsTabStrip";
import { BroadcastComposeContainer } from "@/frontend/views/admin/broadcasts/BroadcastComposeContainer";
import { BroadcastDetailDrawer } from "@/frontend/views/admin/broadcasts/BroadcastDetailDrawer";
import { BroadcastHistorySection } from "@/frontend/views/admin/broadcasts/BroadcastHistorySection";
import {
  type BroadcastHistoryRow,
  broadcastNumericId,
} from "@/frontend/views/admin/broadcasts/broadcast-history.helpers";
import {
  type BroadcastsTab,
  TAB_LABEL_IDS,
  TAB_PANEL_IDS,
} from "@/frontend/views/admin/broadcasts/broadcast-tabs.helpers";
import { StopBroadcastDialog } from "@/frontend/views/admin/broadcasts/StopBroadcastDialog";
import { useAdminBroadcastDetail } from "@/frontend/views/admin/broadcasts/useAdminBroadcastDetail";
import { useAdminBroadcastsData } from "@/frontend/views/admin/broadcasts/useAdminBroadcastsData";
import { useStopBroadcast } from "@/frontend/views/admin/broadcasts/useStopBroadcast";
import { useAppTranslation } from "@/shared/locale/client";
import { AdminBroadcasts } from "@/shared/locale/namespaces/adminBroadcasts";

/**
 * AdminBroadcastsContainer — the client orchestrator behind
 * `/admin/broadcasts`: the broadcast surface's two tabs, History (DEFAULT)
 * and Compose, over the same page gate the server shell already enforces.
 *
 * Tab state is surface-owned (no URL mirroring): the tabs are a
 * within-surface switch, not shareable views. BOTH panels stay MOUNTED
 * while hidden (the `hidden` attribute — `display:none` removes the hidden
 * panel from the tab order and the accessibility tree) so the Compose
 * draft + its Apollo cache survive every tab switch — flipping to History
 * and back never loses a half-written broadcast.
 *
 * Read/mutation state lives in the domain hooks: the directory read +
 * filter/paging orchestration ({@link useAdminBroadcastsData}), the
 * skip-gated detail read behind the drawer
 * ({@link useAdminBroadcastDetail} — a stateful `useQuery` skipped while
 * no broadcast is selected), and the stop mutation + snackbar toast seam
 * ({@link useStopBroadcast}). The stop dialog rides the governance remount
 * idiom — a single nullable KEY state gates mounting and doubles as the
 * React `key`, so the dialog remounts fresh for every open; its target
 * row resolves from the loaded directory page (the stop affordance only
 * exists on loaded rows), and confirming closes the dialog while the
 * mutation's outcome arrives through the surface's shared snackbar.
 *
 * Page-level authorization is the server admin route guard — this
 * container performs no role logic.
 *
 * MUI v9 discipline: `sx`-only styling, colors exclusively through
 * `theme.palette.*` callbacks, ≥44px targets, RTL-safe logical composition,
 * `useAppTranslation(AdminBroadcasts)` property access for every label.
 */

export function AdminBroadcastsContainer(): ReactNode {
  const t = useAppTranslation(AdminBroadcasts);
  const [activeTab, setActiveTab] = useState<BroadcastsTab>("history");
  const directory = useAdminBroadcastsData();
  const stop = useStopBroadcast();
  const [selectedBroadcastId, setSelectedBroadcastId] = useState<number | null>(null);
  const detail = useAdminBroadcastDetail(selectedBroadcastId);
  const [stopDialogId, setStopDialogId] = useState<string | null>(null);
  const stopEntry =
    stopDialogId === null ? null : (directory.data?.adminBroadcasts.items.find(row => row.id === stopDialogId) ?? null);

  const openDetails = (entry: BroadcastHistoryRow): void => {
    const broadcastId = broadcastNumericId(entry.id);
    if (broadcastId !== null) {
      setSelectedBroadcastId(broadcastId);
    }
  };

  const confirmStop = (broadcastId: number): void => {
    setStopDialogId(null);
    stop.stopBroadcast(broadcastId);
  };

  return (
    <Stack sx={{ gap: 3, width: "100%" }}>
      <AdminBroadcastsTabStrip
        activeTab={activeTab}
        onSelect={setActiveTab}
        ariaLabel={t.pageTitle}
        historyLabel={t.historyTab}
        composeLabel={t.composeTab}
      />
      {/*
        Both panels stay MOUNTED while hidden (the `hidden` attribute) so
        the compose draft + Apollo cache survive tab switches.
      */}
      <Box
        role="tabpanel"
        id={TAB_PANEL_IDS.history}
        aria-labelledby={TAB_LABEL_IDS.history}
        hidden={activeTab !== "history"}
      >
        <BroadcastHistorySection
          data={directory.data}
          loading={directory.loading}
          listBusy={directory.listBusy}
          error={directory.error}
          page={directory.page}
          totalPages={directory.totalPages}
          filterDraft={directory.filterDraft}
          notice={stop.notice}
          onDismissNotice={stop.dismissNotice}
          onRetry={directory.refetch}
          onPageChange={directory.changePage}
          onFilterDraftChange={directory.updateFilterDraft}
          onApplyFilters={directory.applyFilters}
          onViewDetails={openDetails}
          onStopIntent={entry => {
            setStopDialogId(entry.id);
          }}
        />
      </Box>
      <Box
        role="tabpanel"
        id={TAB_PANEL_IDS.compose}
        aria-labelledby={TAB_LABEL_IDS.compose}
        hidden={activeTab !== "compose"}
      >
        <BroadcastComposeContainer />
      </Box>
      <BroadcastDetailDrawer
        open={selectedBroadcastId !== null}
        detail={detail.detail?.adminBroadcastDetail ?? null}
        loading={detail.detailLoading}
        error={detail.detailError}
        onClose={() => {
          setSelectedBroadcastId(null);
        }}
        onRetry={detail.refetchDetail}
      />
      {stopDialogId !== null && stopEntry !== null ? (
        <StopBroadcastDialog
          key={stopDialogId}
          entry={stopEntry}
          loading={stop.stopping}
          onClose={() => {
            setStopDialogId(null);
          }}
          onConfirm={confirmStop}
        />
      ) : null}
    </Stack>
  );
}
