"use client";

/**
 * DirectoryToolbarActions — the admin user directory toolbar's dedicated
 * actions row (the toolbar's first row):
 *  1. the shareable-view **Copy link** action (the directory-shared
 *     `DirectoryCopyLinkButton` primitive),
 *  2. the primary **Create User** button (54px tall, `flexShrink: 0`,
 *     never wraps its label).
 *
 * Auto margin right-aligns the group along its own row, keeping the
 * primary action anchored to the card's trailing edge at every md+ width
 * without ever competing for space with the filter controls below it
 * (they live on the separate filters row in `DirectoryToolbar`).
 * Label slices are passed down narrowed — nothing is hardcoded.
 */

import { AddOutlined as AddIcon } from "@mui/icons-material";
import { Box, Button } from "@mui/material";
import type { ReactNode } from "react";
import { DirectoryCopyLinkButton } from "@/frontend/views/admin/directory-shared/DirectoryCopyLinkButton";
import type { AdminUsersLabels } from "@/shared/locale/types/adminUsers";

type ToolbarActionsLabels = Pick<AdminUsersLabels, "quickActions" | "createDialog">;

interface DirectoryToolbarActionsProps {
  readonly labels: ToolbarActionsLabels;
  /** Reports the successful copy-link through the surface's shared snackbar. */
  readonly onCopyLink: () => void;
  readonly onCreateUser: () => void;
}

export function DirectoryToolbarActions(props: DirectoryToolbarActionsProps): ReactNode {
  return (
    <Box
      sx={{
        display: "flex",
        gap: 2,
        alignItems: "center",
        // Auto margin right-aligns the actions along the toolbar's first
        // row, pinning the primary Create action to the card's trailing
        // edge at every md+ width.
        marginInlineStart: "auto",
        flexShrink: 0,
      }}
    >
      <DirectoryCopyLinkButton copyLinkLabel={props.labels.quickActions.copyLink} onCopyLink={props.onCopyLink} />
      <Button
        variant="contained"
        startIcon={<AddIcon />}
        onClick={props.onCreateUser}
        sx={theme => ({
          borderRadius: "8px",
          minHeight: 54,
          flexShrink: 0,
          whiteSpace: "nowrap",
          // Pin the fill/ink pair to the theme's `primary.main`/`onPrimary`
          // tokens so the label stays on a contrast-checked pair in both
          // light and dark themes instead of relying on the default
          // `primary.contrastText` resolution.
          bgcolor: theme.palette.primary.main,
          color: theme.palette.onPrimary,
          "&:hover": { bgcolor: theme.palette.primary.dark },
        })}
      >
        {props.labels.createDialog.title}
      </Button>
    </Box>
  );
}
