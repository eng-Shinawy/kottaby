"use client";

/**
 * DirectoryEmptyState — the directory's empty-state block, rendered inside
 * the desktop table body and (wrapped in a card) on the mobile list.
 */

import { PersonOutlineOutlined as PersonIcon } from "@mui/icons-material";
import { Stack, Typography } from "@mui/material";
import type { ReactNode } from "react";
import type { AdminUsersLabels } from "@/shared/locale/types/adminUsers";

interface DirectoryEmptyStateProps {
  readonly labels: Pick<AdminUsersLabels, "emptyState">;
  readonly hasFilters: boolean;
}

/**
 * Empty-state block rendered inside the desktop table body and (wrapped in
 * a card) on the mobile list — the copy (`labels.emptyState`) and the
 * two-variant title/message selection are unchanged from the old table.
 */
export function DirectoryEmptyState({ labels, hasFilters }: DirectoryEmptyStateProps): ReactNode {
  return (
    <Stack spacing={1} sx={{ alignItems: "center", py: 6 }}>
      <PersonIcon sx={theme => ({ fontSize: 48, color: theme.palette.text.secondary })} />
      <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
        {hasFilters ? labels.emptyState.filteredTitle : labels.emptyState.title}
      </Typography>
      <Typography sx={theme => ({ color: theme.palette.text.secondary })}>
        {hasFilters ? labels.emptyState.filteredMessage : labels.emptyState.message}
      </Typography>
    </Stack>
  );
}
