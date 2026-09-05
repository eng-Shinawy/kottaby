"use client";

/**
 * UserDetailPrimitives — shared presentational building blocks for the admin
 * user DETAIL page cards (hero, profile, governance, teacher-application,
 * student-status, recent-activity).
 *
 * Centralizes the detail page's repeated vocabulary so each card file stays
 * focused on its own data:
 *  - `DetailCard`          — radius-12 white card (`border.light` outline +
 *    `shadow.card` shadow), the page's single card recipe.
 *  - `DetailCardTitle`     — icon (primary lane) + 700-weight title + optional
 *    trailing slot (status chip / action).
 *  - `DetailInfoStrip`     — tinted info-note strip used as the profile /
 *    governance card footers and the teacher-application read-only note.
 *  - `DetailEyebrow`       — ALL-CAPS 11px eyebrow label used above grid
 *    values (governance grid, teacher stats panel).
 *  - `DetailTonalChip`     — small pill painted from an M3
 *    container/`on<Color>Container` pair (mirrors the directory's private
 *    `TonalChip` recipe; kept separate because the directory one is module
 *    private by design).
 *
 * `ApplicantStatusChip` (applicant lifecycle status as a tonal chip, shared
 * by the hero chip row and the teacher-application title row) lives in its
 * own sibling module `ApplicantStatusChip.tsx`.
 *
 * MUI v9 `sx`-only discipline; zero hardcoded colors — every paint resolves
 * through `theme.palette.*` callbacks.
 */

import { InfoOutlined as InfoIcon } from "@mui/icons-material";
import { Box, Card, Chip, Stack, Typography } from "@mui/material";
import type { Theme } from "@mui/material/styles";
import type { ReactNode } from "react";

/** Detail-surface tonal lanes backed by M3 container/`on<Color>Container` pairs. */
export type DetailTone = "success" | "warning" | "error" | "info" | "neutral";

interface ToneColors {
  readonly bg: string;
  readonly fg: string;
}

/**
 * Tone lane → M3 token pair (private — module stays component-only for
 * `react-refresh/only-export-components`). Every pair exists in BOTH
 * `lightPalette.ts` and `darkPalette.ts`.
 */
function toneColors(theme: Theme, tone: DetailTone): ToneColors {
  switch (tone) {
    case "success":
      return { bg: theme.palette.successContainer, fg: theme.palette.onSuccessContainer };
    case "warning":
      return { bg: theme.palette.warningContainer, fg: theme.palette.onWarningContainer };
    case "error":
      return { bg: theme.palette.errorContainer, fg: theme.palette.onErrorContainer };
    case "info":
      return { bg: theme.palette.infoContainer, fg: theme.palette.onInfoContainer };
    default:
      return { bg: theme.palette.surfaceContainerHighest, fg: theme.palette.onSurfaceVariant };
  }
}

/** Radius-12 white card — the detail page's single card recipe. */
export function DetailCard({ children }: { readonly children: ReactNode }): ReactNode {
  return (
    <Card
      sx={theme => ({
        p: { xs: 2, md: 3 },
        borderRadius: "12px",
        border: `1px solid ${theme.palette.border.light}`,
        boxShadow: theme.palette.shadow.card,
        minWidth: 0,
      })}
    >
      {children}
    </Card>
  );
}

interface DetailCardTitleProps {
  readonly icon: ReactNode;
  readonly title: string;
  readonly trailing?: ReactNode;
}

/** Card title row — primary-tinted icon, 700-weight title, optional trailing slot. */
export function DetailCardTitle({ icon, title, trailing }: DetailCardTitleProps): ReactNode {
  return (
    <Stack direction="row" sx={{ alignItems: "center", gap: 1, mb: 2 }}>
      <Box
        aria-hidden
        sx={theme => ({ display: "inline-flex", color: theme.palette.primary.main, "& > svg": { fontSize: 22 } })}
      >
        {icon}
      </Box>
      <Typography variant="h6" component="h2" sx={{ fontWeight: 700, fontSize: 17, flex: 1, minWidth: 0 }}>
        {title}
      </Typography>
      {trailing}
    </Stack>
  );
}

interface DetailInfoStripProps {
  readonly note: string;
  /** `info` paints the elevated surface + info accent bar (teacher note); `surface` the neutral low-surface strip. */
  readonly tone?: "surface" | "info";
}

/** Tinted info-note strip — InfoOutlined icon + localized note text. The
 *  `info` tone uses `surfaceContainerHigh` (not `infoContainer`, which reads
 *  as a saturated slab in dark mode) with the info identity carried by the
 *  leading accent bar and the icon. */
export function DetailInfoStrip({ note, tone = "surface" }: DetailInfoStripProps): ReactNode {
  return (
    <Box
      sx={theme => ({
        display: "flex",
        alignItems: "flex-start",
        gap: 1,
        mt: 1,
        p: 1.5,
        borderRadius: "8px",
        bgcolor: tone === "info" ? theme.palette.surfaceContainerHigh : theme.palette.surfaceContainerLow,
        ...(tone === "info" && { borderInlineStart: `4px solid ${theme.palette.info.main}` }),
      })}
    >
      <InfoIcon sx={theme => ({ fontSize: 18, flexShrink: 0, mt: "2px", color: theme.palette.info.main })} />
      <Typography
        variant="body2"
        sx={theme => ({ color: tone === "info" ? theme.palette.onSurface : theme.palette.text.secondary })}
      >
        {note}
      </Typography>
    </Box>
  );
}

/** 11px eyebrow label sitting above a grid cell value (weight 700 + 0.08em
    tracking carry the label/value hierarchy for LTR and Arabic alike, where
    uppercase alone gives no emphasis). */
export function DetailEyebrow({ children }: { readonly children: ReactNode }): ReactNode {
  return (
    <Typography
      variant="caption"
      component="div"
      sx={theme => ({
        fontSize: 11,
        fontWeight: 700,
        letterSpacing: "0.08em",
        textTransform: "uppercase",
        color: theme.palette.text.secondary,
      })}
    >
      {children}
    </Typography>
  );
}

interface DetailTonalChipProps {
  readonly tone: DetailTone;
  readonly label: string;
}

/** Small pill chip painted from the tone lane's M3 container pair. */
export function DetailTonalChip({ tone, label }: DetailTonalChipProps): ReactNode {
  return (
    <Chip
      size="small"
      label={label}
      sx={theme => {
        const colors = toneColors(theme, tone);
        return {
          height: 26,
          borderRadius: "999px",
          fontWeight: 600,
          flexShrink: 0,
          // minWidth + inline padding keep short labels ("لا" / "Yes") a
          // rounded pill instead of collapsing into a circle.
          minWidth: 44,
          px: 1,
          bgcolor: colors.bg,
          color: colors.fg,
        };
      }}
    />
  );
}
