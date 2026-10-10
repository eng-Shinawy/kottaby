"use client";

import { Button, Paper, Stack, Typography } from "@mui/material";
import type { ReactNode } from "react";
import { focusVisibleRingSx } from "@/frontend/components/ui/focusRing";

interface CatalogEmptyStateProps {
  /** Decorative icon rendered above the copy (caller sets the size/color). */
  readonly icon: ReactNode;
  /** Bolded headline under the icon. */
  readonly title: string;
  /** Secondary supporting copy under the title. */
  readonly description: string;
  /** Contained CTA label; omit to render no button. */
  readonly actionLabel?: string;
  /** Invoked when the CTA is clicked. */
  readonly onAction?: () => void;
}

/**
 * CatalogEmptyState — the shared zero-rows composition for the admin
 * catalog surfaces (plans, lessons): a bordered paper panel with a
 * centered decorative icon, headline, secondary copy, and an optional
 * contained CTA. Presentational only — every surface-specific value
 * (icon, labels) arrives via props with its text already resolved by
 * the caller, so no translation hooks live here
 * (`frontend/AGENTS.md` sx-only styling; all colors come from the
 * theme palette — no hardcoded values).
 */
export function CatalogEmptyState({
  icon,
  title,
  description,
  actionLabel,
  onAction,
}: Readonly<CatalogEmptyStateProps>): ReactNode {
  return (
    <Paper
      elevation={0}
      sx={theme => ({
        border: 1,
        borderColor: theme.palette.divider,
        borderRadius: 2,
        p: 6,
        textAlign: "center",
        backgroundColor: theme.palette.background.paper,
      })}
    >
      <Stack sx={{ alignItems: "center", gap: 2 }}>
        {icon}
        <Typography variant="h6" sx={{ fontWeight: 600 }}>
          {title}
        </Typography>
        <Typography variant="body2" sx={theme => ({ color: theme.palette.text.secondary, maxWidth: 400 })}>
          {description}
        </Typography>
        {actionLabel !== undefined && onAction !== undefined && (
          <Button variant="contained" onClick={onAction} sx={{ ...focusVisibleRingSx, mt: 1 }}>
            {actionLabel}
          </Button>
        )}
      </Stack>
    </Paper>
  );
}
