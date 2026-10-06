"use client";

import { Avatar, Stack, Typography } from "@mui/material";
import type { ReactNode } from "react";

interface SessionRowCounterpartProps {
  /**
   * The counterpart's display name — the batch-enriched
   * `Session.student`/`Session.teacher` band payload. `null`/`undefined`
   * (and the corrupt empty-string member) render NOTHING — the band is
   * populated ONLY by the participant lists, so an absent name is the
   * honest no-band answer, never an empty shell.
   */
  readonly name: string | null | undefined;
  /** The overline caption naming the counterpart's role — a resolved i18n handle. */
  readonly caption: string;
}

/**
 * SessionRowCounterpart — the session row's counterpart identity band: a
 * 32px initial avatar plus the role caption and the display name, one
 * RTL-safe horizontal band (gap + logical flow only — RTL flips it
 * wholesale). Presentation mirrors the directory card avatar exactly
 * (primary/onPrimary tones with the primaryContainer ring, through theme
 * callbacks — dark-mode coherence is the palette's job, never literal
 * colors). The caption rides MUI's `overline` variant and the name
 * truncates (`noWrap` + `minWidth: 0`) so long Arabic names ellipsize
 * instead of breaking the band. The initial is the name's first grapheme
 * uppercased — the directory card's `charAt(0)` idiom verbatim (the
 * surfaces carry BMP names, where code-point and charAt agree).
 */
export function SessionRowCounterpart({ name, caption }: Readonly<SessionRowCounterpartProps>): ReactNode {
  if (name === null || name === undefined || name === "") {
    return null;
  }
  // The directory card's initial idiom verbatim (cross-surface consistency):
  // the surfaces carry BMP names, so `charAt(0)` IS the first grapheme.
  const initial = name.charAt(0).toUpperCase();

  return (
    <Stack
      data-testid="session-row-counterpart"
      sx={{ flexDirection: "row", alignItems: "center", gap: 1, minWidth: 0 }}
    >
      <Avatar
        alt={name}
        sx={theme => ({
          width: 32,
          height: 32,
          fontSize: 14,
          bgcolor: theme.palette.primary.main,
          color: theme.palette.onPrimary,
          boxShadow: `0 0 0 2px ${theme.palette.primaryContainer}`,
        })}
      >
        {initial}
      </Avatar>
      <Stack sx={{ gap: 0, minWidth: 0 }}>
        <Typography variant="overline" sx={theme => ({ color: theme.palette.text.secondary, lineHeight: 1.4 })}>
          {caption}
        </Typography>
        <Typography variant="subtitle2" noWrap sx={{ fontWeight: 600 }}>
          {name}
        </Typography>
      </Stack>
    </Stack>
  );
}
