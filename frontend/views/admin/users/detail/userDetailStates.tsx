"use client";

/**
 * userDetailStates — the non-data states of the admin user DETAIL page,
 * extracted from `AdminUserDetailContainer`:
 *
 *  - `UserDetailLoading` — centered spinner while the first detail response
 *    is in flight (`loading && !data`).
 *  - `UserDetailNotFound` — a `USER_NOT_FOUND` response (stale link) renders
 *    a localized not-found section with a back-to-directory CTA.
 */

import { ArrowBackOutlined as BackIcon } from "@mui/icons-material";
import { Alert, Button, CircularProgress, Link as MuiLink, Stack, Typography } from "@mui/material";
import type { ReactNode } from "react";
import type { AdminUsersLabels } from "@/shared/locale/types/adminUsers";

export function UserDetailLoading(): ReactNode {
  return (
    <Stack sx={{ alignItems: "center", py: 8 }}>
      <CircularProgress />
    </Stack>
  );
}

interface UserDetailNotFoundProps {
  readonly labels: Pick<AdminUsersLabels, "detail">;
}

export function UserDetailNotFound({ labels }: UserDetailNotFoundProps): ReactNode {
  return (
    <Stack spacing={2} sx={{ p: { xs: 2, md: 3 } }}>
      <Button component={MuiLink} href="/admin/users" startIcon={<BackIcon />} sx={{ alignSelf: "flex-start" }}>
        {labels.detail.backToDirectory}
      </Button>
      <Alert severity="warning">
        <Stack spacing={1}>
          <Typography variant="subtitle1">{labels.detail.notFoundTitle}</Typography>
          <Typography variant="body2">{labels.detail.notFoundMessage}</Typography>
        </Stack>
      </Alert>
    </Stack>
  );
}
