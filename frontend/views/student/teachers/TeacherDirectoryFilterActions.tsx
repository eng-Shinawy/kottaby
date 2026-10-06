"use client";

/**
 * TeacherDirectoryFilterActions — the apply/reset action row of the
 * student browse filter bar: the quiet outlined reset (near-white text +
 * solid outline pair — MUI's default outlined treatment sinks into the
 * dark filter card) over the emphasized contained apply (bold label —
 * the submit boundary is the row's primary affordance). Mirrors the
 * admin filter bars' `FilterActionsRow` STYLE, built locally:
 * `frontend/views/student/**` never imports `frontend/views/admin/**`.
 * Both actions carry the shared keyboard-focus ring (MUI v9 ButtonBase
 * ships no focus-visible styling of its own).
 *
 * MUI v9 `sx`-only discipline, theme-palette colors, ≥44px touch targets.
 */

import { Button, Stack } from "@mui/material";
import type { ReactNode } from "react";
import { focusVisibleRingSx } from "@/frontend/components/ui/focusRing";

interface TeacherDirectoryFilterActionsProps {
  /** Reset intent — restores the default choices. */
  readonly onReset: () => void;
  /** Localized reset label. */
  readonly resetLabel: string;
  /** Localized apply label (the affordance submits the host form). */
  readonly applyLabel: string;
}

/** The apply/reset action row of the student browse filter bar. */
export function TeacherDirectoryFilterActions({
  onReset,
  resetLabel,
  applyLabel,
}: Readonly<TeacherDirectoryFilterActionsProps>): ReactNode {
  return (
    <Stack
      sx={theme => ({
        flexDirection: { xs: "column", sm: "row" },
        gap: 2,
        gridColumn: "1 / -1",
        justifyContent: "flex-end",
        alignItems: { xs: "stretch", sm: "center" },
        // The hairline groups the row as the form's footer — fields above,
        // actions below.
        pt: 2,
        borderTop: "1px solid",
        borderColor: theme.palette.border.light,
      })}
    >
      <Button
        variant="outlined"
        onClick={onReset}
        data-testid="student-teachers-filters-reset"
        sx={theme => ({
          ...focusVisibleRingSx,
          minHeight: 44,
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
        type="submit"
        variant="contained"
        data-testid="student-teachers-filters-apply"
        sx={{ ...focusVisibleRingSx, minHeight: 44, px: 3, fontWeight: 700 }}
      >
        {applyLabel}
      </Button>
    </Stack>
  );
}
