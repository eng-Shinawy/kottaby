"use client";

import { EditOutlined as EditIcon, LanguageOutlined as LanguageIcon } from "@mui/icons-material";
import { Button, Stack, Typography } from "@mui/material";
import type { ReactNode } from "react";
import type { UserRole } from "@/frontend/graphql/generated/gql/graphql";
import { roleDashboardPath } from "@/frontend/lib/auth/roleDashboardRoute";
import type { DashboardLabels } from "@/shared/locale/types/dashboard";

interface ProfileActionsProps {
  readonly role: UserRole;
  readonly t: DashboardLabels;
}

/** Profile page actions: back-to-dashboard + (disabled, future) edit profile. */
export function ProfileActions({ role, t }: Readonly<ProfileActionsProps>): ReactNode {
  return (
    <>
      <Stack direction="row" spacing={2} sx={{ justifyContent: "center", flexWrap: "wrap", gap: 1 }}>
        {/* Role-specific dashboard — never bare "/dashboard" (preview-gateway
            redirect loop, see `frontend/lib/auth/roleDashboardRoute.ts`). */}
        <Button variant="outlined" href={roleDashboardPath(role)} startIcon={<LanguageIcon />}>
          {t.backToDashboard}
        </Button>
        <Button variant="contained" startIcon={<EditIcon />} disabled>
          {t.editProfile}
        </Button>
      </Stack>

      {/* Edit-profile notice — explains why the button is disabled */}
      <Typography
        variant="caption"
        sx={theme => ({
          display: "block",
          textAlign: "center",
          mt: 1,
          color: theme.palette.text.secondary,
        })}
      >
        {t.editProfileNotice}
      </Typography>
    </>
  );
}
