"use client";

/**
 * TeacherDirectoryRequestDialog.parts — the extracted sub-blocks of the
 * request-session dialog (the `*.parts.tsx` convention), keeping the host
 * file under the 150-line convention: the title row (localized title +
 * dismiss affordance) and the summary chip row (certifications + fluency
 * labels, no captions). Pure presentational — no hooks; MUI v9 `sx`-only,
 * theme-palette colors, RTL-safe flex/gap.
 */

import { CloseRounded as CloseIcon } from "@mui/icons-material";
import { Chip, DialogTitle, IconButton, Stack } from "@mui/material";
import type { ReactNode } from "react";
import { focusVisibleRingSx } from "@/frontend/components/ui/focusRing";

/** The dialog title row: localized title + the dismiss affordance. */
export function RequestDialogTitleRow(props: {
  readonly titleId: string;
  readonly title: string;
  readonly closeLabel: string;
  readonly closeRequested: () => void;
  readonly disabled: boolean;
}): ReactNode {
  const { titleId, title, closeLabel, closeRequested, disabled } = props;
  return (
    <DialogTitle
      id={titleId}
      sx={theme => ({
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 1,
        fontWeight: 700,
        color: theme.palette.text.primary,
      })}
    >
      {title}
      <IconButton
        aria-label={closeLabel}
        onClick={closeRequested}
        disabled={disabled}
        sx={theme => ({ ...focusVisibleRingSx, color: theme.palette.text.secondary })}
      >
        <CloseIcon />
      </IconButton>
    </DialogTitle>
  );
}

/** The summary chip row: certifications + fluency labels, no captions. */
export function RequestSummaryChips(props: { readonly labels: readonly string[] }): ReactNode {
  return (
    <Stack sx={{ flexDirection: "row", flexWrap: "wrap", gap: 1 }}>
      {props.labels.map(label => (
        <Chip
          key={label}
          label={label}
          size="small"
          variant="outlined"
          sx={theme => ({ borderColor: theme.palette.outlineVariant, color: theme.palette.onSurfaceVariant })}
        />
      ))}
    </Stack>
  );
}
