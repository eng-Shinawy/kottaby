"use client";

/**
 * DirectoryDrawerPrimitives — the shared building blocks of the admin
 * directory detail drawers' section cards (same visual output on every
 * surface):
 *  - `DirectoryDrawerSection`: radius 12 card with `border.light` outline
 *    and an uppercase pinned header,
 *  - `DirectoryLabelValueRow`: the `ProfileInfoCard` caption/value row
 *    recipe,
 *  - `DirectoryEmptyValue`: the honest null — the em-dash is a display
 *    affordance, not a value.
 */

import { Box, Stack, Typography } from "@mui/material";
import type { ReactNode } from "react";

interface DirectoryDrawerSectionProps {
  readonly label: string;
  /**
   * Optional trailing header action (an icon button in the section's
   * pinned header row) — absent on every plain section, present only
   * where a section owns a header-level quick action.
   */
  readonly action?: ReactNode;
  readonly children: ReactNode;
}

/** Section card — radius 12, `border.light` outline, uppercase pinned header. */
export function DirectoryDrawerSection({ label, action, children }: DirectoryDrawerSectionProps): ReactNode {
  return (
    <Box
      component="section"
      aria-label={label}
      sx={theme => ({
        borderRadius: "12px",
        border: `1px solid ${theme.palette.border.light}`,
        boxShadow: theme.palette.shadow.card,
        bgcolor: theme.palette.background.paper,
        p: 2,
      })}
    >
      <Stack direction="row" sx={{ alignItems: "center", justifyContent: "space-between", gap: 1, marginBottom: 1 }}>
        <Typography
          variant="overline"
          component="h3"
          sx={theme => ({
            display: "block",
            color: theme.palette.text.secondary,
            fontWeight: 700,
            letterSpacing: "0.06em",
          })}
        >
          {label}
        </Typography>
        {action}
      </Stack>
      {children}
    </Box>
  );
}

interface DirectoryLabelValueRowProps {
  readonly label: string;
  /** Latin-contact values (email/phone) are LTR data — pinned via the HTML attribute. */
  readonly ltr?: boolean;
  readonly children: ReactNode;
}

/**
 * Caption/value row (the `ProfileInfoCard` recipe): fixed 40% label column
 * in `text.secondary`, value flexing with 500 weight.
 */
export function DirectoryLabelValueRow({ label, ltr = false, children }: DirectoryLabelValueRowProps): ReactNode {
  return (
    <Stack direction="row" spacing={2} sx={theme => ({ py: 1, borderTop: `1px solid ${theme.palette.divider}` })}>
      <Typography
        variant="body2"
        sx={theme => ({ color: theme.palette.text.secondary, flexBasis: "40%", flexShrink: 0 })}
      >
        {label}
      </Typography>
      <Box
        {...(ltr ? { dir: "ltr" } : {})}
        sx={theme => ({
          flex: 1,
          minWidth: 0,
          fontWeight: 500,
          color: theme.palette.text.primary,
          ...(ltr && { unicodeBidi: "isolate", textAlign: "start" }),
        })}
      >
        {children}
      </Box>
    </Stack>
  );
}

/** Honest null — the em-dash is a display affordance, not a value. */
export function DirectoryEmptyValue(): ReactNode {
  return (
    <Typography variant="body2" sx={theme => ({ color: theme.palette.text.secondary })}>
      —
    </Typography>
  );
}
