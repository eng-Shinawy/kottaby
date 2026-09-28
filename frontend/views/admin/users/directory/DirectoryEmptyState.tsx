"use client";

/**
 * DirectoryEmptyState — the directory's empty-state block, rendered inside
 * the desktop table body and (wrapped in a card) on the mobile list.
 * Delegates to the shared `DirectoryEmptyState` block with the user icon;
 * the copy (`labels.emptyState`) and the two-variant title/message
 * selection are unchanged from the old table.
 *
 * When the emptiness is FILTER-caused (`hasFilters`) and a recovery
 * handler is supplied, the shared block's CTA slot renders an outlined
 * "Clear filters" button — one-click recovery from over-filtering instead
 * of forcing the admin to hunt for every active filter by hand. The CTA
 * uses the same `labels.emptyState.cta`-adjacent `filters.clear` copy the
 * toolbar's clear button carries, so the recovery affordance reads as one
 * verb everywhere it appears.
 */

import { FilterAltOffOutlined as FilterAltOffIcon, PersonOutlineOutlined as PersonIcon } from "@mui/icons-material";
import { Button } from "@mui/material";
import type { ReactNode } from "react";
import { DirectoryEmptyState as DirectoryEmptyStateBlock } from "@/frontend/views/admin/directory-shared/DirectoryEmptyState";
import type { AdminUsersLabels } from "@/shared/locale/types/adminUsers";

interface DirectoryEmptyStateProps {
  readonly labels: Pick<AdminUsersLabels, "emptyState" | "filters">;
  readonly hasFilters: boolean;
  /** When provided, a filtered zero-match state gains a clear-filters CTA. */
  readonly onClearFilters?: () => void;
}

export function DirectoryEmptyState({ labels, hasFilters, onClearFilters }: DirectoryEmptyStateProps): ReactNode {
  return (
    <DirectoryEmptyStateBlock
      icon={<PersonIcon sx={theme => ({ fontSize: 48, color: theme.palette.text.secondary })} />}
      hasFilters={hasFilters}
      labels={labels.emptyState}
      actions={
        hasFilters && onClearFilters ? (
          <Button
            variant="outlined"
            size="small"
            startIcon={<FilterAltOffIcon />}
            onClick={onClearFilters}
            sx={theme => ({
              mt: 1.5,
              borderRadius: "10px",
              borderColor: theme.palette.outlineVariant,
              color: theme.palette.text.primary,
              // Same destructive-hover grammar as the ActiveFiltersRow
              // chips' delete icon — discoverable, never shouting.
              "&:hover": {
                borderColor: theme.palette.error.main,
                color: theme.palette.error.main,
                backgroundColor: "transparent",
              },
            })}
          >
            {labels.filters.clear}
          </Button>
        ) : null
      }
    />
  );
}
