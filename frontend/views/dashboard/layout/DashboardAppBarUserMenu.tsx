"use client";

import { LogoutOutlined as LogoutIcon } from "@mui/icons-material";
import { Avatar, Box, IconButton, Stack, Tooltip, Typography } from "@mui/material";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { focusVisibleRingSx } from "@/frontend/components/ui/focusRing";
import { useAuth } from "@/frontend/hooks/auth";
import { Dashboard, useAppTranslation } from "@/shared/locale";

/**
 * DashboardAppBarUserMenu — user identity chip + sign-out control, rendered
 * on the right edge of `DashboardAppBar` for authenticated users (renders
 * nothing for anonymous users).
 *
 * Below `sm` the identity chip yields its width to the wordmark + controls —
 * the sign-out itself stays mounted in EVERY viewport (QA R2: it was pushed
 * off-canvas at 375px). Avatar-only from `sm`; full name/email from `md`.
 *
 * The avatar shows the first letter of the user's full name (or "U" for
 * unknown) — a lightweight visual anchor without needing an image asset.
 */
export function DashboardAppBarUserMenu(): ReactNode {
  const t = useAppTranslation(Dashboard);
  const { user, logout } = useAuth();
  const router = useRouter();

  const handleLogout = () => {
    logout();
    router.push("/login");
  };

  const avatarLetter = user?.fullName?.charAt(0).toUpperCase() ?? "U";
  const avatarAlt = user ? t.userAvatarAlt(user.fullName) : t.title;

  return user ? (
    <Stack direction="row" sx={{ alignItems: "center", gap: { xs: 1, sm: 1.5 }, flexShrink: 0 }}>
      <Avatar
        alt={avatarAlt}
        sx={theme => ({
          width: 32,
          height: 32,
          bgcolor: theme.palette.primary.main,
          color: theme.palette.onPrimary,
          fontSize: 14,
          fontWeight: 700,
          // Avatar-only from `sm`; full name/email from `md`.
          display: { xs: "none", sm: "flex" },
        })}
      >
        {avatarLetter}
      </Avatar>
      <Box sx={{ display: { xs: "none", md: "block" }, minWidth: 0 }}>
        <Typography
          variant="body2"
          sx={theme => ({
            fontWeight: 600,
            color: theme.palette.text.primary,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            maxWidth: 200,
          })}
        >
          {user.fullName}
        </Typography>
        <Typography
          variant="caption"
          sx={theme => ({ color: theme.palette.text.secondary, display: "block", lineHeight: 1.2 })}
        >
          {user.email}
        </Typography>
      </Box>
      <Tooltip title={t.signOut}>
        <IconButton
          size="large"
          onClick={handleLogout}
          aria-label={t.signOut}
          sx={theme => ({ ...focusVisibleRingSx, color: theme.palette.text.secondary, flexShrink: 0 })}
        >
          <LogoutIcon />
        </IconButton>
      </Tooltip>
    </Stack>
  ) : null;
}
