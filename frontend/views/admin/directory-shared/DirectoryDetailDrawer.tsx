"use client";

/**
 * DirectoryDetailDrawer — the shared shell of the admin directory detail
 * side-drawers (students / teachers): a 420px temporary Drawer with a
 * pinned header (title + 44px close button) over a scrollable section
 * stack. The domain supplies its section cards as `children`.
 *
 * The Drawer uses the DEFAULT anchor (no `anchor` prop) exactly like
 * `DashboardSidebar` — the codebase runs the RTL emotion cache, which
 * mirrors the paper to the start edge in Arabic automatically;
 * `theme.direction` is never set, so no anchor-side branching is needed.
 *
 * Accessibility: Escape and backdrop click close the drawer (temporary
 * Drawer defaults); the close button carries a 44px touch target; one
 * drawer instance exists per directory (owned by the container), so only
 * one detail surface can ever be open at a time.
 *
 * MUI v9 discipline: `sx`-only styling, colors via theme callbacks,
 * `*Outlined` icons.
 */

import { CloseOutlined as CloseIcon } from "@mui/icons-material";
import { Box, Drawer, IconButton, Stack, Tooltip, Typography } from "@mui/material";
import type { ReactNode } from "react";
import { focusVisibleRingSx } from "@/frontend/components/ui/focusRing";

/** Drawer paper width — clamps inside narrow viewports. */
const DRAWER_WIDTH = 420;

interface DirectoryDetailDrawerProps {
  /** Whether the drawer is open (the container keeps the item mounted through the exit transition). */
  readonly open: boolean;
  /** Close callback (Escape, backdrop click, close button). */
  readonly onClose: () => void;
  /** The pinned header title (the localized details title). */
  readonly title: string;
  /** The close button's tooltip + aria-label. */
  readonly closeLabel: string;
  /** The drawer's section cards. */
  readonly children: ReactNode;
}

export function DirectoryDetailDrawer({
  open,
  onClose,
  title,
  closeLabel,
  children,
}: DirectoryDetailDrawerProps): ReactNode {
  return (
    <Drawer
      open={open}
      onClose={onClose}
      // Default anchor (no `anchor` prop) — mirrors `DashboardSidebar`; the
      // RTL emotion cache mirrors the paper to the start edge in Arabic.
      sx={{
        "& .MuiDrawer-paper": {
          width: DRAWER_WIDTH,
          maxWidth: "calc(100vw - 24px)",
          boxSizing: "border-box",
        },
      }}
    >
      <Stack sx={{ height: "100%" }}>
        <Stack
          direction="row"
          sx={theme => ({
            alignItems: "center",
            justifyContent: "space-between",
            px: 2,
            py: 0.75,
            borderBottom: `1px solid ${theme.palette.border.light}`,
          })}
        >
          <Typography variant="subtitle1" component="h2" sx={{ fontWeight: 700 }}>
            {title}
          </Typography>
          <Tooltip title={closeLabel} placement="bottom">
            <IconButton
              aria-label={closeLabel}
              onClick={onClose}
              sx={theme => ({
                ...focusVisibleRingSx,
                minWidth: 44,
                minHeight: 44,
                color: theme.palette.text.secondary,
              })}
            >
              <CloseIcon />
            </IconButton>
          </Tooltip>
        </Stack>
        <Box sx={theme => ({ overflowY: "auto", p: 2, bgcolor: theme.palette.surfaceContainerLowest, flexGrow: 1 })}>
          <Stack spacing={2} sx={{ alignItems: "stretch" }}>
            {children}
          </Stack>
        </Box>
      </Stack>
    </Drawer>
  );
}
