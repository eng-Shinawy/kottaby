"use client";

import { MoreVertOutlined } from "@mui/icons-material";
import { Box, IconButton, Menu, MenuItem, Tooltip } from "@mui/material";
import type { SxProps, Theme } from "@mui/material/styles";
import { type ReactNode, useState } from "react";
import { type AdminSessionsQuery_adminSessions_items, SessionStatus } from "@/frontend/graphql/generated/gql/graphql";
import type { GovernanceDialogKind } from "@/frontend/views/admin/session-governance/AdminSessionRow";
import type { AdminSessionGovernanceLabels } from "@/shared/locale/types/adminSessionGovernance";

/**
 * AdminSessionRowActions — the governance row's kebab menu. It gates the
 * four governance actions by the state eligibility matrix (D-03):
 * reschedule/cancel on `scheduled|started`, reassign on `scheduled` only,
 * join on `started` only — INELIGIBLE actions render DISABLED with an
 * explanatory tooltip instead of disappearing (the operator learns the
 * rule, the affordance stays discoverable). View-details is always
 * available, and the join item OPENS the drawer (the live-session banner
 * inside is the single-click observe confirm) rather than joining in place
 * — so its label names the view-and-observe intent, never the immediate
 * action. Extracted verbatim from `AdminSessionRow`; behavior is unchanged.
 */

/** Reschedule/cancel eligibility — `scheduled|started` (D-03 matrix). */
const TIMING_MUTABLE_STATUSES: Record<string, true> = {
  [SessionStatus.Scheduled]: true,
  [SessionStatus.Started]: true,
};

/** Reassign eligibility — `scheduled` only (live/arbitration rows excluded). */
const REASSIGN_ELIGIBLE_STATUSES: Record<string, true> = {
  [SessionStatus.Scheduled]: true,
};

/** Join eligibility — `started` only. */
const JOIN_ELIGIBLE_STATUSES: Record<string, true> = {
  [SessionStatus.Started]: true,
};

/** Kebab button rides the meta strip's inline edge (wraps below on narrow cards). */
const ROW_KEBAB_SX: SxProps<Theme> = theme => ({
  minHeight: { xs: 44, sm: 40 },
  minWidth: { xs: 44, sm: 40 },
  marginInlineStart: "auto",
  alignSelf: "center",
  color: theme.palette.text.secondary,
  "&:focus-visible": {
    outline: `2px solid ${theme.palette.outline}`,
    outlineOffset: 2,
  },
});

interface AdminSessionRowActionsProps {
  /** The session payload row — the testids + the eligibility matrix drive off it. */
  readonly session: AdminSessionsQuery_adminSessions_items;
  /** Localized governance-namespace labels (action labels + disabled hints). */
  readonly t: AdminSessionGovernanceLabels;
  /** Open the read-only detail drawer for this session. */
  readonly onOpenDetails: (sessionId: string) => void;
  /** Open one governance dialog for this session (container owns the state). */
  readonly onDialogIntent: (kind: GovernanceDialogKind, session: AdminSessionsQuery_adminSessions_items) => void;
}

/** The row's kebab affordance + eligibility-gated governance actions menu. */
export function AdminSessionRowActions({
  session,
  t,
  onOpenDetails,
  onDialogIntent,
}: Readonly<AdminSessionRowActionsProps>): ReactNode {
  const [actionsAnchorEl, setActionsAnchorEl] = useState<HTMLElement | null>(null);

  const timingMutable = TIMING_MUTABLE_STATUSES[session.status];
  const reassignEligible = REASSIGN_ELIGIBLE_STATUSES[session.status];
  const joinEligible = JOIN_ELIGIBLE_STATUSES[session.status];

  const closeActionsMenu = (): void => {
    setActionsAnchorEl(null);
  };

  const runMenuAction = (action: () => void): void => {
    closeActionsMenu();
    action();
  };

  return (
    <>
      <Tooltip title={t.rowActionsAriaLabel} placement="top">
        <IconButton
          aria-label={t.rowActionsAriaLabel}
          aria-haspopup="menu"
          aria-expanded={actionsAnchorEl !== null}
          data-testid={`admin-session-actions-${session.id}`}
          onClick={event => {
            setActionsAnchorEl(event.currentTarget);
          }}
          sx={ROW_KEBAB_SX}
        >
          <MoreVertOutlined />
        </IconButton>
      </Tooltip>
      <Menu
        anchorEl={actionsAnchorEl}
        open={actionsAnchorEl !== null}
        onClose={closeActionsMenu}
        // Menu origins stay at MUI's viewport-clamped defaults (matching the
        // admin users directory kebab) — `end` is not a valid origin value
        // and physical left/right edges are not direction-safe.
        slotProps={{ list: { "aria-label": t.rowActionsAriaLabel } }}
      >
        <MenuItem
          onClick={() => {
            runMenuAction(() => onOpenDetails(session.id));
          }}
          data-testid={`admin-session-action-${session.id}-details`}
        >
          {t.actionViewDetails}
        </MenuItem>
        <GatedRowActionMenuItem
          eligible={timingMutable}
          hint={t.rescheduleDisabledHint}
          label={t.actionReschedule}
          testId={`admin-session-action-${session.id}-reschedule`}
          onSelect={() => {
            runMenuAction(() => onDialogIntent("reschedule", session));
          }}
        />
        <GatedRowActionMenuItem
          eligible={timingMutable}
          hint={t.cancelDisabledHint}
          label={t.actionCancel}
          testId={`admin-session-action-${session.id}-cancel`}
          onSelect={() => {
            runMenuAction(() => onDialogIntent("cancel", session));
          }}
        />
        <GatedRowActionMenuItem
          eligible={reassignEligible}
          hint={t.reassignDisabledHint}
          label={t.actionReassign}
          testId={`admin-session-action-${session.id}-reassign`}
          onSelect={() => {
            runMenuAction(() => onDialogIntent("reassign", session));
          }}
        />
        <GatedRowActionMenuItem
          eligible={joinEligible}
          hint={t.joinDisabledHint}
          label={t.actionViewAndObserve}
          testId={`admin-session-action-${session.id}-join`}
          onSelect={() => {
            runMenuAction(() => onOpenDetails(session.id));
          }}
        />
      </Menu>
    </>
  );
}

interface GatedRowActionMenuItemProps {
  /** The localized explanation — tooltip copy shown ONLY while ineligible. */
  readonly hint: string;
  /** State-matrix eligibility — an ineligible action renders DISABLED (D-03). */
  readonly eligible: boolean;
  /** The affordance's testid (`admin-session-action-<id>-<action>`). */
  readonly testId: string;
  /** The localized action label. */
  readonly label: string;
  /** The action intent (the menu closes first, then the callback runs). */
  readonly onSelect: () => void;
}

/**
 * One eligibility-gated menu item — the DISABLED affordance keeps its
 * explanatory tooltip (wrapped in a block Box so a disabled MenuItem still
 * receives the hover events that open it).
 */
function GatedRowActionMenuItem({
  hint,
  eligible,
  testId,
  label,
  onSelect,
}: Readonly<GatedRowActionMenuItemProps>): ReactNode {
  return (
    <Tooltip title={eligible ? "" : hint} placement="top" disableHoverListener={eligible}>
      <Box sx={{ display: "block" }}>
        <MenuItem disabled={!eligible} onClick={onSelect} data-testid={testId}>
          {label}
        </MenuItem>
      </Box>
    </Tooltip>
  );
}
