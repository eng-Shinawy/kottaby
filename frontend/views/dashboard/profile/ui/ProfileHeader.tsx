"use client";

import { Avatar, Box, Chip, Stack, Typography } from "@mui/material";
import type { ReactNode } from "react";
import type { AuthUser } from "@/frontend/context/AuthContext";
import type { DashboardLabels } from "@/shared/locale/types/dashboard";

interface ProfileHeaderProps {
  readonly user: AuthUser;
  readonly roleLabel: string;
  readonly t: DashboardLabels;
}

/** Header card row: avatar + full name + email + role chip. */
export function ProfileHeader({ user, roleLabel, t }: Readonly<ProfileHeaderProps>): ReactNode {
  const avatarLetter = user.fullName.charAt(0).toUpperCase();

  return (
    <Stack
      direction="row"
      spacing={2}
      sx={{
        alignItems: "center",
        mb: 4,
      }}
    >
      <Avatar
        alt={t.userAvatarAlt(user.fullName)}
        sx={theme => ({
          width: 64,
          height: 64,
          bgcolor: theme.palette.primary.main,
          color: theme.palette.onPrimary,
          fontSize: 28,
          fontWeight: 700,
          flexShrink: 0,
        })}
      >
        {avatarLetter}
      </Avatar>
      <Box sx={{ minWidth: 0, flex: 1 }}>
        <Typography variant="h5" sx={{ fontWeight: 700 }}>
          {user.fullName}
        </Typography>
        <Typography variant="body2" sx={theme => ({ color: theme.palette.text.secondary })}>
          {user.email}
        </Typography>
      </Box>
      <Chip
        label={roleLabel}
        variant="outlined"
        sx={theme => ({
          fontWeight: 600,
          textTransform: "capitalize",
          borderColor: theme.palette.primary.main,
          color: theme.palette.primary.main,
        })}
      />
    </Stack>
  );
}
