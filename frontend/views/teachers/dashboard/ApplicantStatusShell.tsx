"use client";

import type { SvgIconComponent } from "@mui/icons-material";
import { Card, CardContent, Chip, Skeleton, Stack } from "@mui/material";
import type { Palette } from "@mui/material/styles";
import type { ReactNode } from "react";

// ----------------------------------------------------------------------------
// Shell + chrome primitives
// ----------------------------------------------------------------------------

/** Visual tone family driving chip + accent-bar colors (theme-palette only). */
export type StatusTone = "pending" | "info" | "warning" | "success";

interface StatusChipProps {
  readonly label: string;
  readonly Icon: SvgIconComponent;
  readonly tone: StatusTone;
}

/** Tone-resolved status chip using Material 3 container/on-container pairs. */
export function StatusChip({ label, Icon, tone }: Readonly<StatusChipProps>): ReactNode {
  const toneColors = resolveToneColors(tone);
  return (
    <Chip
      icon={<Icon fontSize="small" />}
      label={label}
      size="small"
      sx={theme => ({
        fontWeight: 600,
        bgcolor: toneColors.bg(theme.palette),
        color: toneColors.fg(theme.palette),
        "& .MuiChip-icon": {
          color: toneColors.fg(theme.palette),
        },
      })}
    />
  );
}

/** Maps a tone family onto its container color pair (ProfileView pattern). */
function resolveToneColors(tone: StatusTone): {
  readonly bg: (palette: Palette) => string;
  readonly fg: (palette: Palette) => string;
} {
  switch (tone) {
    case "pending":
      return { bg: p => p.status.pendingContainer, fg: p => p.status.onPendingContainer };
    case "info":
      return { bg: p => p.infoContainer, fg: p => p.onInfoContainer };
    case "warning":
      return { bg: p => p.warningContainer, fg: p => p.onWarningContainer };
    default:
      return { bg: p => p.successContainer, fg: p => p.onSuccessContainer };
  }
}

interface BranchHeaderRowProps {
  readonly children: ReactNode;
  readonly chip?: ReactNode;
}

/** Title (+ optional status chip) header that wraps to columns on mobile. */
export function BranchHeaderRow({ children, chip }: Readonly<BranchHeaderRowProps>): ReactNode {
  return (
    <Stack
      spacing={1.5}
      sx={{
        flexDirection: { xs: "column", sm: "row" },
        alignItems: { xs: "flex-start", sm: "center" },
        justifyContent: "space-between",
      }}
    >
      {children}
      {chip}
    </Stack>
  );
}

interface StatusShellProps {
  readonly children: ReactNode;
  /** Accent-bar resolver painted onto the shell's top edge highlight. */
  readonly accent?: (palette: Palette) => string;
}

/** Outer card shell shared by every settled branch (uniform dashboard slot). */
export function StatusShell({ children, accent }: Readonly<StatusShellProps>): ReactNode {
  return (
    <Card
      elevation={0}
      data-testid="applicant-status-card"
      sx={theme => ({
        borderRadius: 3,
        border: "1px solid",
        borderColor: theme.palette.outlineVariant,
        bgcolor: theme.palette.surfaceContainerLow,
        boxShadow: theme.palette.shadow.card,
        borderTopWidth: 3,
        borderTopStyle: "solid",
        borderTopColor: accent ? accent(theme.palette) : theme.palette.primary.main,
      })}
    >
      <CardContent sx={{ p: { xs: 3, sm: 4 }, display: "grid", gap: 2 }}>{children}</CardContent>
    </Card>
  );
}

/** Loading skeleton — title line + badge pill + body panel + CTA placeholder. */
export function LoadingSkeleton(): ReactNode {
  return (
    <Card
      elevation={0}
      aria-busy="true"
      data-testid="applicant-status-card-loading"
      sx={theme => ({
        borderRadius: 3,
        border: "1px solid",
        borderColor: theme.palette.outlineVariant,
        bgcolor: theme.palette.surfaceContainerLow,
        boxShadow: theme.palette.shadow.card,
      })}
    >
      <CardContent sx={{ p: { xs: 3, sm: 4 }, display: "grid", gap: 2 }}>
        <Skeleton variant="text" sx={{ fontSize: "1.75rem", maxWidth: 280 }} />
        <Skeleton variant="rounded" sx={{ height: 26, width: 180, borderRadius: 999 }} />
        <Skeleton variant="rounded" sx={{ height: 64, borderRadius: 2 }} />
        <Skeleton variant="rectangular" sx={{ height: 44, width: 170, borderRadius: 2 }} />
      </CardContent>
    </Card>
  );
}
