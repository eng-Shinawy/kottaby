"use client";

import { Box, Divider, Drawer, List, Toolbar, Typography } from "@mui/material";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { useAuth } from "@/frontend/hooks/auth";
import { getNavItemsForRole, SidebarListItem } from "@/frontend/views/dashboard/nav";
import { Dashboard, HandshakeCode, useAppTranslation } from "@/shared/locale";

/**
 * Props for `DashboardSidebar` — the temporary-drawer open state is hoisted
 * to `DashboardLayout` so the app-bar hamburger can drive it.
 */
export interface DashboardSidebarProps {
  /** Mobile-only: open state of the temporary `Drawer`. */
  readonly mobileOpen: boolean;
  /** Mobile-only: close handler (called on backdrop click + nav-item click). */
  readonly onMobileClose: () => void;
}

/** Drawer width in pixels — must match the `MuiDrawer` `PaperProps` width. */
const DRAWER_WIDTH = 264;

/**
 * DashboardSidebar — role-aware navigation sidebar.
 *
 * Renders as a permanent (clipped) `Drawer` on `lg+` and a temporary `Drawer`
 * on smaller viewports. The temporary variant is controlled by `mobileOpen`
 * + `onMobileClose` (hoisted to `DashboardLayout`).
 *
 * Navigation items are derived from `getNavItemsForRole(user.role)` — the
 * current user's role determines the visible link set (FR-1.2 role-based
 * inheritance). Active route highlighting uses Next.js's `usePathname()` +
 * MUI's `selected` prop on `ListItemButton`.
 *
 * Accessibility (audit R2): each nav link is wrapped in a `ListItem
 * component="li"` so the rendered DOM is `ul > li > a` — the MUI `List`
 * renders a `<ul>` whose DIRECT children must be `<li>` (axe `list` rule);
 * rendering the anchors as direct `ul` children was invalid list semantics.
 * The `ListItemButton` spreads `focusVisibleRingSx` so keyboard focus draws
 * the app-wide 2px copper ring (MUI v9 ButtonBase ships no focus-visible
 * styling — the previous background-only indicator was too subtle on the
 * sidebar surface).
 *
 * MUI v9 patterns: `sx` callback only, `*Outlined` icons, theme palette
 * colors (no string-based `color` props).
 */
export function DashboardSidebar({ mobileOpen, onMobileClose }: Readonly<DashboardSidebarProps>): ReactNode {
  const t = useAppTranslation(Dashboard);
  const handshakeCodeLabels = useAppTranslation(HandshakeCode);
  const { user } = useAuth();
  const pathname = usePathname();

  const navItems = getNavItemsForRole(user?.role);

  const list = (
    <Box sx={{ width: DRAWER_WIDTH, height: "100%", display: "flex", flexDirection: "column" }}>
      <Toolbar sx={{ minHeight: { xs: 56, sm: 64 } }} />
      <Divider />
      <Box component="nav" aria-label={t.sidebarAriaLabel} sx={{ flex: 1, overflowY: "auto", py: 1 }}>
        <List>
          {navItems.map(item => (
            <SidebarListItem
              key={item.route}
              item={item}
              t={t}
              handshakeCodeLabels={handshakeCodeLabels}
              pathname={pathname}
              onNavigate={onMobileClose}
            />
          ))}
        </List>
      </Box>
      <Divider />
      <Box sx={{ p: 2 }}>
        <Typography variant="caption" sx={theme => ({ color: theme.palette.text.secondary, display: "block" })}>
          {t.title}
        </Typography>
      </Box>
    </Box>
  );

  return (
    <Box component="aside" sx={{ flexShrink: { lg: 0 }, width: { lg: DRAWER_WIDTH } }}>
      {/* Mobile: temporary Drawer. Mounts only while open (no `keepMounted`):
          a kept-mounted closed drawer parks its 264px paper off-canvas, where
          its toolbar/list nodes register as viewport-clipped geometry in DOM
          audits ("AppBar internals past the right edge"). */}
      <Drawer
        variant="temporary"
        open={mobileOpen}
        onClose={onMobileClose}
        sx={{
          display: { xs: "block", lg: "none" },
          "& .MuiDrawer-paper": {
            width: DRAWER_WIDTH,
            boxSizing: "border-box",
            bgcolor: "var(--mui-palette-surface)",
          },
        }}
      >
        {list}
      </Drawer>

      {/* Desktop: permanent Drawer */}
      <Drawer
        variant="permanent"
        sx={{
          display: { xs: "none", lg: "block" },
          "& .MuiDrawer-paper": {
            width: DRAWER_WIDTH,
            boxSizing: "border-box",
            bgcolor: "var(--mui-palette-surface)",
            borderRight: "1px solid var(--mui-palette-outlineVariant)",
          },
        }}
        open
      >
        {list}
      </Drawer>
    </Box>
  );
}
