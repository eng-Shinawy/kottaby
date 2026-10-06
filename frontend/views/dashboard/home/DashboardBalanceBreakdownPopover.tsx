"use client";

/**
 * DashboardBalanceBreakdownPopover — the STUDENT dashboard's balance-card
 * popover: clicking the prepaid-credits stat card opens this small panel
 * breaking the caller's own prepaid session-credit total down into the
 * four `mySessionBalance` lanes (trial / hifz / tajweed / reviews).
 *
 * Scope honesty: the lanes are the student's own PREPAID credit records —
 * sessions covered by a subscription are intentionally NOT shown here (the
 * surface carries that note in every state). The payload is tri-state and
 * degrades independently of the SUM card, whose "—"/skeleton semantics
 * stay untouched.
 *
 * Chrome posture: a plain MUI `Popover` anchored to the balance card's
 * grid cell (bottom-center under the card, top-center growing down, MUI
 * clamping it flush to the viewport margin on narrow screens). Pointer
 * and keyboard dismissal ride the Popover defaults (backdrop click and
 * Escape → `onClose`) — the same contract as the app-bar notification
 * drawer. The panel is a labeled dialog: the paper carries `role="dialog"`
 * + `aria-labelledby` pointing at the surface's title id (MUI Popover adds
 * no dialog role of its own).
 */

import { Popover } from "@mui/material";
import { type ReactNode, useId } from "react";
import { DashboardBalanceBreakdownSurface } from "@/frontend/views/dashboard/home/DashboardBalanceBreakdownPopover.parts";
import type { SessionCreditLanes } from "@/frontend/views/dashboard/home/useDashboardStats.helpers";
import type { DashboardLabels } from "@/shared/locale/types/dashboard";

interface DashboardBalanceBreakdownPopoverProps {
  /** Open state owned by the view (the balance card's activation seam sets it). */
  readonly open: boolean;
  /** The anchoring element — the balance card's wrapper (its grid cell). */
  readonly anchorEl: HTMLElement | null;
  /** The lane payload tri-state — `undefined` loading, `null` failed, resolved = four display counts. */
  readonly lanes: SessionCreditLanes | null | undefined;
  /** Close callback — invoked by the Popover defaults (backdrop click, Escape). */
  readonly onClose: () => void;
  /** Compile-time localized copy handles (property access only). */
  readonly labels: DashboardLabels;
}

/** The balance card's prepaid-credits breakdown popover — see the module docblock. */
export function DashboardBalanceBreakdownPopover({
  open,
  anchorEl,
  lanes,
  onClose,
  labels,
}: Readonly<DashboardBalanceBreakdownPopoverProps>): ReactNode {
  const titleId = useId();
  return (
    <Popover
      open={open}
      anchorEl={anchorEl}
      onClose={onClose}
      anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
      transformOrigin={{ vertical: "top", horizontal: "center" }}
      slotProps={{ paper: { role: "dialog", "aria-labelledby": titleId } }}
    >
      <DashboardBalanceBreakdownSurface lanes={lanes} labels={labels} titleId={titleId} />
    </Popover>
  );
}
