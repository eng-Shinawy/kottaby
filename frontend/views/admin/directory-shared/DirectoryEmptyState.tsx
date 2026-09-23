"use client";

/**
 * DirectoryEmptyState — the shared empty-state block of the admin directory
 * surfaces, rendered inside the desktop table body and (wrapped in a card)
 * on the mobile lists.
 *
 * Icon + two-variant copy selection (unfiltered zero-rows vs filtered
 * no-matches) + an optional CTA slot under the copy (e.g. the teachers
 * join-requests button). All copy comes from the consumer's `emptyState`
 * locale block — nothing is hardcoded here.
 */

import { Stack, Typography } from "@mui/material";
import type { ReactNode } from "react";

/** The two-variant copy shape every directory `emptyState` label block carries. */
interface DirectoryEmptyStateCopy {
  /** Zero-rows heading — shown when the directory is empty with no filters. */
  readonly title: string;
  /** Zero-rows body. */
  readonly message: string;
  /** Filtered heading — shown when filters returned zero matches. */
  readonly filteredTitle: string;
  /** Filtered body. */
  readonly filteredMessage: string;
}

interface DirectoryEmptyStateProps {
  /** Domain icon (rendered at 48px in `text.secondary`). */
  readonly icon: ReactNode;
  readonly hasFilters: boolean;
  /** The domain's `emptyState` label block (title/message + filtered variants). */
  readonly labels: DirectoryEmptyStateCopy;
  /** Optional CTA slot under the copy. */
  readonly actions?: ReactNode;
}

export function DirectoryEmptyState({ icon, hasFilters, labels, actions }: DirectoryEmptyStateProps): ReactNode {
  return (
    <Stack spacing={1} sx={{ alignItems: "center", py: 6 }}>
      {icon}
      <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
        {hasFilters ? labels.filteredTitle : labels.title}
      </Typography>
      <Typography sx={theme => ({ color: theme.palette.text.secondary })}>
        {hasFilters ? labels.filteredMessage : labels.message}
      </Typography>
      {actions ?? null}
    </Stack>
  );
}
