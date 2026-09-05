"use client";

/**
 * DeleteConfirmDialogBody — the centered content stack of
 * `DeleteConfirmDialog` (extracted from `AdminUserDialogs.tsx`): halo icon,
 * title, bold-name line, body copy, and (deactivation only) the consequences
 * line and the role-note callout.
 */

import {
  InfoOutlined as InfoIcon,
  CheckCircleOutlined as ReactivateIcon,
  WarningAmberOutlined as WarningIcon,
} from "@mui/icons-material";
import { Box, Stack, Typography } from "@mui/material";
import type { ReactNode } from "react";
import { DirectoryRolePill } from "@/frontend/views/admin/users/directory";
import { asDirectoryRole } from "@/frontend/views/admin/users/utils";
import type { AdminUsersLabels } from "@/shared/locale/types/adminUsers";

interface DeleteConfirmDialogBodyProps {
  readonly labels: AdminUsersLabels;
  readonly fullName: string;
  readonly role: string;
  readonly isReactivate: boolean;
}

/**
 * Centered prototype composition: halo icon + title + bold-name body + info
 * callout. Deactivation uses the `error` family; reactivation reuses the
 * same structure with the `success` family (its namespace carries no
 * consequences/roleNote copy, so those lines render only for deactivation).
 */
export function DeleteConfirmDialogBody({
  labels,
  fullName,
  role,
  isReactivate,
}: DeleteConfirmDialogBodyProps): ReactNode {
  // Vertical rhythm: halo → +16 → title → +8 → name → +12 → body → +16 →
  // callout. The actions row adds +24px (content pb 1 + actions pt 2) after
  // the callout.
  return (
    <Stack spacing={0} sx={{ alignItems: "center", textAlign: "center" }}>
      <Box
        sx={theme => ({
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: 64,
          height: 64,
          borderRadius: "50%",
          backgroundColor: isReactivate ? theme.palette.successContainer : theme.palette.errorContainer,
        })}
      >
        {isReactivate ? (
          <ReactivateIcon sx={theme => ({ fontSize: 32, color: theme.palette.success.main })} />
        ) : (
          <WarningIcon sx={theme => ({ fontSize: 32, color: theme.palette.error.main })} />
        )}
      </Box>
      <Typography variant="h6" component="h2" sx={{ mt: 2, fontWeight: 700 }}>
        {isReactivate ? labels.reactivateConfirm.title : labels.deleteConfirm.title}
      </Typography>
      <Typography variant="body1" sx={{ mt: 1, fontWeight: 700, overflowWrap: "anywhere" }}>
        {fullName}
      </Typography>
      <Typography variant="body2" sx={theme => ({ mt: 1.5, color: theme.palette.text.secondary })}>
        {isReactivate ? labels.reactivateConfirm.message : labels.deleteConfirm.message}
      </Typography>
      {!isReactivate && (
        <Typography variant="body2" sx={theme => ({ mt: 1, color: theme.palette.text.secondary })}>
          {labels.deleteConfirm.consequences}
        </Typography>
      )}
      {!isReactivate && (
        <Box
          sx={theme => ({
            display: "flex",
            alignItems: "center",
            alignSelf: "stretch",
            // Inner rhythm after the 4px accent bar: `p: 1.5` puts 12px
            // between bar and icon; `gap: 1` keeps the icon→text and
            // (via the row Stack below) text→chip spacing at 8px.
            gap: 1,
            mt: 2,
            p: 1.5,
            borderRadius: "8px",
            textAlign: "start",
            backgroundColor: theme.palette.surfaceContainerHigh,
            borderInlineStart: `4px solid ${theme.palette.info.main}`,
          })}
        >
          <InfoIcon sx={theme => ({ fontSize: 20, color: theme.palette.info.main })} />
          <Stack direction="row" spacing={1} sx={{ alignItems: "center", flexWrap: "wrap", rowGap: 0.5 }}>
            <Typography variant="body2" sx={theme => ({ color: theme.palette.onSurface })}>
              {labels.deleteConfirm.roleNote}
            </Typography>
            <DirectoryRolePill role={asDirectoryRole(role)} labels={labels} />
          </Stack>
        </Box>
      )}
    </Stack>
  );
}
