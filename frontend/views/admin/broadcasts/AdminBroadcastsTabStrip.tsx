"use client";

import { Card, Tab, Tabs } from "@mui/material";
import type { ReactNode } from "react";
import {
  type BroadcastsTab,
  TAB_LABEL_IDS,
  TAB_PANEL_IDS,
} from "@/frontend/views/admin/broadcasts/broadcast-tabs.helpers";

/**
 * AdminBroadcastsTabStrip — the `/admin/broadcasts` surface's tab card: the
 * MUI `Tabs` strip over the surface's two tabs (History DEFAULT, Compose),
 * sx-only and RTL-safe (the indicator and label order mirror automatically
 * under the RTL emotion cache). Tab state is surface-owned; this strip only
 * reports selections. The tab union + accessibility DOM ids live in
 * `broadcast-tabs.helpers.ts` (shared with the container's panel hosts).
 */

export interface AdminBroadcastsTabStripProps {
  /** The currently active tab. */
  readonly activeTab: BroadcastsTab;
  /** Tab-selection intent. */
  readonly onSelect: (tab: BroadcastsTab) => void;
  /** The strip's accessible grouping label (the page title). */
  readonly ariaLabel: string;
  /** The History tab label. */
  readonly historyLabel: string;
  /** The Compose tab label. */
  readonly composeLabel: string;
}

/** The tab card — History (default position) and Compose, a11y-wired. */
export function AdminBroadcastsTabStrip({
  activeTab,
  onSelect,
  ariaLabel,
  historyLabel,
  composeLabel,
}: Readonly<AdminBroadcastsTabStripProps>): ReactNode {
  return (
    <Card
      sx={theme => ({
        borderRadius: "12px",
        border: `1px solid ${theme.palette.border.light}`,
        boxShadow: theme.palette.shadow.card,
      })}
    >
      <Tabs
        value={activeTab}
        onChange={(_, value: BroadcastsTab) => {
          onSelect(value);
        }}
        aria-label={ariaLabel}
        sx={theme => ({ paddingInline: 2, borderBottom: `1px solid ${theme.palette.border.light}` })}
      >
        <Tab
          value="history"
          label={historyLabel}
          id={TAB_LABEL_IDS.history}
          aria-controls={TAB_PANEL_IDS.history}
          data-testid="admin-broadcasts-tab-history"
          sx={{ minHeight: 48, textTransform: "none", fontWeight: 600, fontSize: 15 }}
        />
        <Tab
          value="compose"
          label={composeLabel}
          id={TAB_LABEL_IDS.compose}
          aria-controls={TAB_PANEL_IDS.compose}
          data-testid="admin-broadcasts-tab-compose"
          sx={{ minHeight: 48, textTransform: "none", fontWeight: 600, fontSize: 15 }}
        />
      </Tabs>
    </Card>
  );
}
