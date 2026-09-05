"use client";

/**
 * AdminDialogFieldLabel — above-the-field label shared by the admin
 * create/edit user dialogs. Extracted from `AdminUserDialogs.tsx` (see that
 * module for the shared error-propagation contract of the dialogs that
 * render this label).
 */

import { Box, Typography } from "@mui/material";
import type { ReactNode } from "react";

interface AdminDialogFieldLabelProps {
  readonly text: string;
  /** Targets the input element id (`label htmlFor`) — used for TextField fields. */
  readonly htmlFor?: string;
  /** Stable label-element id — consumed by the gender `Select labelId`. */
  readonly id?: string;
  /** Appends a `*` marker in `error.main` for required fields. */
  readonly required?: boolean;
}

/**
 * Above-the-field label shared by the create/edit dialogs — the prototype's
 * label pattern: a bold-ish text row ABOVE the control instead of MUI's
 * floating/notch InputLabel. Renders a real `<label>` when `htmlFor` is
 * supplied; the gender Select wires it via `labelId` instead.
 */
export function AdminDialogFieldLabel({ text, htmlFor, id, required = false }: AdminDialogFieldLabelProps): ReactNode {
  return (
    <Typography
      component="label"
      htmlFor={htmlFor}
      id={id}
      variant="body2"
      sx={theme => ({ display: "block", mb: 0.75, fontWeight: 600, color: theme.palette.text.primary })}
    >
      {text}
      {required && (
        // `marginInlineStart` (not a literal leading space) pins the asterisk
        // to the label's visual END under both directions — left of Arabic
        // labels (RTL) and right of Latin ones (LTR).
        <Box component="span" sx={theme => ({ marginInlineStart: 0.5, color: theme.palette.error.main })}>
          {"*"}
        </Box>
      )}
    </Typography>
  );
}
