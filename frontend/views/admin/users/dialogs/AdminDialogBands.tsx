"use client";

/**
 * AdminDialogBands — header/footer bands shared by the admin create/edit
 * user dialogs (extracted from `AdminUserDialogs.tsx`). Rendered on
 * `background.paper` so they contrast against the tinted body band; both
 * bands draw the same `border.main` hairline.
 */

import { CloseOutlined as CloseIcon } from "@mui/icons-material";
import { Box, Button, DialogActions, IconButton, Typography } from "@mui/material";
import type { ReactNode } from "react";

interface AdminDialogHeaderBandProps {
  readonly title: string;
  readonly subtitle: string;
  /** Accessible label for the trailing close icon button. */
  readonly closeLabel: string;
  readonly loading: boolean;
  readonly onClose: () => void;
}

/**
 * Dialog header band shared by the create/edit dialogs — title + subtitle on
 * the start side, trailing close affordance, bottom hairline. Rendered on
 * `background.paper` so it contrasts against the tinted body band.
 */
export function AdminDialogHeaderBand({
  title,
  subtitle,
  closeLabel,
  loading,
  onClose,
}: AdminDialogHeaderBandProps): ReactNode {
  return (
    <Box
      sx={theme => ({
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "space-between",
        gap: 2,
        px: { xs: 2.5, sm: 3 },
        pt: { xs: 2.5, sm: 3 },
        pb: 2,
        backgroundColor: theme.palette.background.paper,
        // `border.main` (vs `.light`) keeps the band hairline readable against
        // the tinted body band (`surfaceContainer` light / `surfaceContainerLowest`
        // dark).
        borderBottom: `1px solid ${theme.palette.border.main}`,
      })}
    >
      <Box sx={{ minWidth: 0 }}>
        <Typography variant="h6" component="h2" sx={{ fontWeight: 700 }}>
          {title}
        </Typography>
        <Typography variant="body2" sx={theme => ({ mt: 0.5, color: theme.palette.text.secondary })}>
          {subtitle}
        </Typography>
      </Box>
      <IconButton aria-label={closeLabel} onClick={onClose} disabled={loading} size="small" sx={{ mt: -0.5 }}>
        <CloseIcon fontSize="small" />
      </IconButton>
    </Box>
  );
}

interface AdminDialogFooterBandProps {
  readonly cancelLabel: string;
  readonly submitLabel: string;
  readonly loading: boolean;
  readonly onClose: () => void;
}

/**
 * Dialog footer band shared by the create/edit dialogs — Cancel (text) +
 * submit (contained primary, form submit) end-aligned (the flex direction
 * flips automatically under RTL), top hairline, paper background. The parent
 * `<form>` supplies the submit behavior, so this band renders no form logic.
 */
export function AdminDialogFooterBand({
  cancelLabel,
  submitLabel,
  loading,
  onClose,
}: AdminDialogFooterBandProps): ReactNode {
  return (
    <DialogActions
      sx={theme => ({
        px: { xs: 2.5, sm: 3 },
        py: 2,
        gap: 1,
        justifyContent: "flex-end",
        backgroundColor: theme.palette.background.paper,
        borderTop: `1px solid ${theme.palette.border.main}`,
      })}
    >
      <Button
        onClick={onClose}
        disabled={loading}
        sx={theme => ({
          minHeight: 44,
          color: theme.palette.text.secondary,
          "&:hover": { backgroundColor: theme.palette.action.hover },
        })}
      >
        {cancelLabel}
      </Button>
      <Button type="submit" variant="contained" disabled={loading} sx={{ minHeight: 44 }}>
        {submitLabel}
      </Button>
    </DialogActions>
  );
}
