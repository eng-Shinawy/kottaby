"use client";

/**
 * DirectoryViewDetailsButton — the explicit view-details quick action of
 * the admin directory identity cells: the row's keyboard/touch affordance
 * for opening the detail drawer (the row click itself stays pointer-only
 * convenience; this button is the real focusable control).
 */

import { VisibilityOutlined as ViewIcon } from "@mui/icons-material";
import { IconButton, Tooltip } from "@mui/material";
import type { ReactNode } from "react";
import { focusVisibleRingSx } from "@/frontend/components/ui/focusRing";

interface DirectoryViewDetailsButtonProps {
  /** The tooltip + aria-label (the drawer's viewDetails label). */
  readonly viewDetailsLabel: string;
  readonly onViewDetails: () => void;
}

export function DirectoryViewDetailsButton({
  viewDetailsLabel,
  onViewDetails,
}: DirectoryViewDetailsButtonProps): ReactNode {
  return (
    <Tooltip title={viewDetailsLabel} placement="top">
      <IconButton
        size="small"
        aria-label={viewDetailsLabel}
        onClick={onViewDetails}
        sx={theme => ({
          ...focusVisibleRingSx,
          // ≥44px touch target via transparent padding; the icon stays
          // visually 20px.
          p: 1.5,
          my: -1.5,
          flexShrink: 0,
          color: theme.palette.text.secondary,
        })}
      >
        <ViewIcon fontSize="small" />
      </IconButton>
    </Tooltip>
  );
}
