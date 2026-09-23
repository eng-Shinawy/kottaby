"use client";

/**
 * FilterActionsRow — the shared APPLY/RESET action row of the admin filter
 * bars: the quiet outlined reset (near-white text + solid outline pair —
 * MUI's default outlined treatment sinks into the dark filter card) over
 * the contained apply. Consumed by the payments audit bar and the admin
 * session-governance bar.
 *
 * MUI v9 `sx`-only discipline, theme-palette colors, ≥44px touch targets.
 */

import { Button, Stack } from "@mui/material";
import type { ReactNode } from "react";

interface FilterActionsRowProps {
  /** Reset intent — restores the unfiltered listing. */
  readonly onReset: () => void;
  /** The reset affordance's `data-testid` (the suites + e2e drive it). */
  readonly resetTestId: string;
  /** Localized reset label. */
  readonly resetLabel: string;
  /** Apply intent — a validated commit (click-driven bars). */
  readonly onApply?: () => void;
  /** Apply submits the host form instead (`type="submit"`, no click handler). */
  readonly applySubmitsForm?: boolean;
  /** The apply affordance's `data-testid`. */
  readonly applyTestId: string;
  /** Localized apply label. */
  readonly applyLabel: string;
}

/** The shared apply/reset action row of the admin filter bars. */
export function FilterActionsRow({
  onReset,
  resetTestId,
  resetLabel,
  onApply,
  applySubmitsForm = false,
  applyTestId,
  applyLabel,
}: Readonly<FilterActionsRowProps>): ReactNode {
  return (
    <Stack
      sx={{
        flexDirection: { xs: "column", sm: "row" },
        gap: 2,
        gridColumn: "1 / -1",
        justifyContent: "flex-end",
        alignItems: { xs: "stretch", sm: "center" },
      }}
    >
      <Button
        variant="outlined"
        onClick={onReset}
        data-testid={resetTestId}
        sx={theme => ({
          minHeight: { xs: 44, sm: 40 },
          px: 3,
          // MUI's default outlined treatment sinks into the dark filter
          // card (~3.4:1) — quiet must stay legible, so the reset rides the
          // near-white text + solid outline pair instead.
          color: theme.palette.text.primary,
          borderColor: theme.palette.outline,
          "&:hover": {
            borderColor: theme.palette.primary.main,
            backgroundColor: "transparent",
          },
        })}
      >
        {resetLabel}
      </Button>
      <Button
        variant="contained"
        {...(applySubmitsForm ? { type: "submit" as const } : { onClick: onApply })}
        data-testid={applyTestId}
        sx={{ minHeight: { xs: 44, sm: 40 }, px: 3 }}
      >
        {applyLabel}
      </Button>
    </Stack>
  );
}
