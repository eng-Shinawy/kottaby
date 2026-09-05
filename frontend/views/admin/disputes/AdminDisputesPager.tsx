"use client";

import { NavigateBeforeOutlined, NavigateNextOutlined } from "@mui/icons-material";
import { IconButton, Stack, Typography } from "@mui/material";
import type { ReactNode } from "react";
import type { SessionsLabels } from "@/shared/locale/types/sessions";

/**
 * AdminDisputesPager — the admin arbitration queue's prev/next pager. It
 * renders ONLY when the honest total spans more than one page (the caller
 * guards that); the page label reads `page / totalPages` and both buttons
 * clamp at the edges (`disabled` at page 1 and the last page). Extracted
 * verbatim from `AdminDisputesContainer`'s body; behavior is unchanged.
 */

interface AdminDisputesPagerProps {
  /** Current 1-based page. */
  readonly page: number;
  /** Honest page count (never below 1). */
  readonly totalPages: number;
  /** Page-change intent — the container clamps before committing. */
  readonly onPageChange: (nextPage: number) => void;
  /** Localized sessions-namespace labels (pager aria vocabulary). */
  readonly t: SessionsLabels;
}

/** Prev / `page / totalPages` / next pager row (edge-clamped buttons). */
export function AdminDisputesPager({
  page,
  totalPages,
  onPageChange,
  t,
}: Readonly<AdminDisputesPagerProps>): ReactNode {
  return (
    <Stack
      data-testid="admin-disputes-pager"
      sx={{
        gap: 1,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        py: 1,
      }}
    >
      <IconButton
        aria-label={t.pagerPreviousLabel}
        data-testid="admin-disputes-pager-prev"
        disabled={page <= 1}
        onClick={() => onPageChange(page - 1)}
        sx={theme => ({
          "&:focus-visible": {
            outline: `2px solid ${theme.palette.outline}`,
            outlineOffset: 2,
          },
        })}
      >
        <NavigateBeforeOutlined />
      </IconButton>
      <Typography
        variant="body2"
        sx={theme => ({ color: theme.palette.text.secondary, minWidth: 64, textAlign: "center" })}
      >
        {page} / {totalPages}
      </Typography>
      <IconButton
        aria-label={t.pagerNextLabel}
        data-testid="admin-disputes-pager-next"
        disabled={page >= totalPages}
        onClick={() => onPageChange(page + 1)}
        sx={theme => ({
          "&:focus-visible": {
            outline: `2px solid ${theme.palette.outline}`,
            outlineOffset: 2,
          },
        })}
      >
        <NavigateNextOutlined />
      </IconButton>
    </Stack>
  );
}
