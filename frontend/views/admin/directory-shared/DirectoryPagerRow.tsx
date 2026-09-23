"use client";

import { NavigateBeforeOutlined, NavigateNextOutlined } from "@mui/icons-material";
import { IconButton, Stack, Tooltip, Typography } from "@mui/material";
import type { ReactNode } from "react";
import { focusVisibleRingSx } from "@/frontend/components/ui/focusRing";

/**
 * DirectoryPagerRow — the admin directory prev/next pager row shared by the
 * directory surfaces (session-governance, broadcast history, …). It renders
 * ONLY when the honest total spans more than one page (the caller guards
 * that). The page label reads `page / totalPages`; both chevrons clamp at
 * the edges (`disabled` at page 1 and the last page) and a mid-flight
 * round-trip (`busy`) disables BOTH chevrons so a double-click can never
 * fire a duplicate page re-key. The chevrons are direction-flipped under
 * RTL (`scaleX(-1)`) — a logical previous/next affordance.
 */

interface DirectoryPagerRowProps {
  /** Test-id prefix — `<prefix>`, `<prefix>-prev`, `<prefix>-next`. */
  readonly testId: string;
  /** Current 1-based page. */
  readonly page: number;
  /** Honest page count (never below 1). */
  readonly totalPages: number;
  /** Round-trip in flight over the settled payload — both chevrons disable. */
  readonly busy: boolean;
  /** Previous-chevron aria vocabulary (tooltip + aria-label). */
  readonly prevLabel: string;
  /** Next-chevron aria vocabulary (tooltip + aria-label). */
  readonly nextLabel: string;
  /** Page-change intent — the caller clamps before committing. */
  readonly onPageChange: (nextPage: number) => void;
}

/** Prev / `page / totalPages` / next pager row (edge-clamped buttons). */
export function DirectoryPagerRow({
  testId,
  page,
  totalPages,
  busy,
  prevLabel,
  nextLabel,
  onPageChange,
}: Readonly<DirectoryPagerRowProps>): ReactNode {
  return (
    <Stack
      data-testid={testId}
      sx={{
        gap: 1,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        py: 1,
      }}
    >
      <Tooltip title={prevLabel}>
        <span>
          <IconButton
            aria-label={prevLabel}
            data-testid={`${testId}-prev`}
            disabled={busy || page <= 1}
            onClick={() => onPageChange(page - 1)}
            sx={focusVisibleRingSx}
          >
            <NavigateBeforeOutlined sx={theme => ({ transform: theme.direction === "rtl" ? "scaleX(-1)" : "none" })} />
          </IconButton>
        </span>
      </Tooltip>
      <Typography
        variant="body2"
        sx={theme => ({ color: theme.palette.text.secondary, minWidth: 64, textAlign: "center" })}
      >
        {page} / {totalPages}
      </Typography>
      <Tooltip title={nextLabel}>
        <span>
          <IconButton
            aria-label={nextLabel}
            data-testid={`${testId}-next`}
            disabled={busy || page >= totalPages}
            onClick={() => onPageChange(page + 1)}
            sx={focusVisibleRingSx}
          >
            <NavigateNextOutlined sx={theme => ({ transform: theme.direction === "rtl" ? "scaleX(-1)" : "none" })} />
          </IconButton>
        </span>
      </Tooltip>
    </Stack>
  );
}
