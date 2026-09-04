"use client";

import {
  DarkModeOutlined as DarkModeIcon,
  LightModeOutlined as LightModeIcon,
  MenuOutlined as MenuIcon,
} from "@mui/icons-material";
import { AppBar, Box, IconButton, Stack, Toolbar, Tooltip, Typography } from "@mui/material";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { LocaleSwitcher } from "@/frontend/components/LocaleSwitcher";
import { focusVisibleRingSx } from "@/frontend/components/ui/focusRing";
import { NotificationUnreadBadge } from "@/frontend/components/ui/NotificationUnreadBadge";
import { useAuth } from "@/frontend/hooks/auth";
import { useThemeMode } from "@/frontend/hooks/theme";
import { roleDashboardPath } from "@/frontend/lib/auth/roleDashboardRoute";
import { BrandMark } from "@/frontend/views/auth/layout";
import { DashboardAppBarUserMenu } from "@/frontend/views/dashboard/layout";
import { Dashboard, useAppTranslation } from "@/shared/locale";

/**
 * Props for `DashboardAppBar` — the mobile menu toggle is hoisted to the
 * `DashboardLayout` so it controls the temporary `Drawer` open state.
 */
export interface DashboardAppBarProps {
  /** Click handler for the mobile hamburger button (opens the temporary drawer). */
  readonly onMenuClick: () => void;
  /** Whether the mobile menu button should be visible (hidden on `lg+`). */
  readonly showMenuButton: boolean;
}

/**
 * DashboardAppBar — top app bar for the dashboard layout.
 *
 * Layout (LTR order; mirrored in RTL via MUI's `direction: rtl`):
 *  - Left: hamburger (mobile only) + "Kottaby Academy" brand wordmark.
 *  - Right: locale switcher, theme toggle, notifications bell (unread badge
 *    → `/notifications`), user avatar + email + sign-out.
 *
 * Auth-aware: reads `useAuth()` to render either the user's info + sign-out
 * (authenticated) or a "Sign in" link (anonymous). The auth redirect itself
 * happens at the `DashboardLayout` level — this component just renders the
 * current state.
 *
 * Responsive (audit R2): below `sm` the identity chip (avatar + name/email)
 * yields its width so every control (hamburger, wordmark, locale switcher,
 * theme toggle, bell, sign-out) stays fully on-canvas at 375px in BOTH
 * directions. The wordmark owns the shrinkage: `minWidth: 0` + `noWrap`
 * ellipsis let the flex item contract below its min-content width, so the
 * toolbar never spills off-screen (root cause of the spill: the default
 * `min-width: auto` floor on the text container blocked flex-shrink, so the
 * trailing controls rendered off-canvas instead).
 *
 * Accessibility: every raw IconButton spreads `focusVisibleRingSx` (the
 * bell/LocaleSwitcher convention) — MUI v9 ButtonBase ships no default
 * focus-visible styling.
 *
 * MUI v9 patterns: `sx` callback only (no string-based color props), `*Outlined`
 * icons, theme palette colors. The `position="sticky"` keeps the bar visible
 * during scroll; `elevation={0}` keeps the surface flat (the bar visually
 * blends with the sidebar — `borderBottom` provides the separation).
 */
export function DashboardAppBar({ onMenuClick, showMenuButton }: Readonly<DashboardAppBarProps>): ReactNode {
  const t = useAppTranslation(Dashboard);
  const { user } = useAuth();
  const { mode, toggleTheme } = useThemeMode();
  const pathname = usePathname();

  // Track the current path so the brand wordmark's `aria-current` reflects
  // the active route (accessibility best practice for nav landmarks). The
  // wordmark links to the caller's ROLE-SPECIFIC dashboard — never bare
  // "/dashboard", which the preview gateway loops into a redirect storm
  // (see `frontend/lib/auth/roleDashboardRoute.ts`).
  const dashboardHref = roleDashboardPath(user?.role);
  const isOnDashboard = pathname === dashboardHref;

  return (
    <AppBar
      position="sticky"
      elevation={0}
      sx={theme => ({
        bgcolor: theme.palette.surface,
        color: theme.palette.text.primary,
        borderBottom: "1px solid",
        borderColor: theme.palette.outlineVariant,
      })}
    >
      <Toolbar
        sx={{
          gap: { xs: 1, sm: 2 },
          minHeight: { xs: 56, sm: 64 },
          // 12px gutters below `sm` reclaim app-bar width for the controls;
          // ≥`sm` keeps the theme's 24px gutter so desktop is unchanged.
          paddingLeft: { xs: 1.5, sm: 3 },
          paddingRight: { xs: 1.5, sm: 3 },
        }}
      >
        {/* Mobile hamburger — opens the temporary Drawer */}
        {showMenuButton ? (
          <IconButton
            size="large"
            edge="start"
            onClick={onMenuClick}
            aria-label={t.menuToggleAriaLabel}
            sx={theme => ({ ...focusVisibleRingSx, color: theme.palette.text.primary, flexShrink: 0 })}
          >
            <MenuIcon />
          </IconButton>
        ) : null}

        {/* Brand — link to the caller's role dashboard. Below `sm` the
            wordmark cannot fit next to the fixed-size toolbar controls at
            375px (it ellipsized ~23px, the recurring mobile-clip finding),
            so the bar swaps to the icon-only brand mark; `sm`+ renders the
            full wordmark. The link keeps the localized brand as its
            accessible name + tooltip either way, and the 44px min height
            makes it a proper tap target (it was a 24px strip). */}
        <Typography
          component={Link}
          href={dashboardHref}
          aria-current={isOnDashboard ? "page" : undefined}
          aria-label={t.title}
          title={t.title}
          sx={theme => ({
            textDecoration: "none",
            color: theme.palette.text.primary,
            fontWeight: 700,
            fontSize: { xs: 16, sm: 20 },
            letterSpacing: "-0.01em",
            whiteSpace: "nowrap",
            flexGrow: 1,
            flexShrink: 1,
            minWidth: 0,
            display: "inline-flex",
            alignItems: "center",
            gap: 1,
            minHeight: 44,
          })}
        >
          <Box component="span" aria-hidden="true" sx={{ display: { xs: "inline-flex", sm: "none" }, flexShrink: 0 }}>
            <BrandMark size={32} />
          </Box>
          <Box component="span" sx={{ display: { xs: "none", sm: "inline" } }}>
            {t.title}
          </Box>
        </Typography>

        {/* Right-side actions — the stack never shrinks (the wordmark absorbs
            space pressure, see above), so these controls keep their natural
            size and stay fully inside the viewport in LTR and RTL alike. */}
        <Stack direction="row" sx={{ alignItems: "center", gap: { xs: 0.5, sm: 1 }, flexShrink: 0 }}>
          <LocaleSwitcher />

          {/* Theme toggle */}
          <Tooltip title={t.toggleTheme}>
            <IconButton
              size="large"
              onClick={toggleTheme}
              aria-label={t.toggleTheme}
              sx={theme => ({ ...focusVisibleRingSx, color: theme.palette.text.primary, flexShrink: 0 })}
            >
              {mode === "light" ? <DarkModeIcon /> : <LightModeIcon />}
            </IconButton>
          </Tooltip>

          {/* Notifications bell — unread badge linked to the inbox
              (mounted here so every authenticated role sees it; the shell
              socket maintains the cached count, REQ-063c/065/067) */}
          <NotificationUnreadBadge />

          {/* User identity + sign-out (authenticated only) — extracted to
              `DashboardAppBarUserMenu`. */}
          <DashboardAppBarUserMenu />
        </Stack>
      </Toolbar>
    </AppBar>
  );
}
