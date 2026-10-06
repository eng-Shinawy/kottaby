"use client";

import { CheckCircleOutlined as AvailableIcon, RemoveCircleOutlined as UnavailableIcon } from "@mui/icons-material";
import { Card, CardContent, Chip, Skeleton } from "@mui/material";
import type { Palette } from "@mui/material/styles";
import type { ReactNode } from "react";
import { CardShell } from "@/frontend/views/students/dashboard/CardShell";

/**
 * TeacherAvailabilityCard shell + chrome primitives — the skeleton, the
 * load-error frame, the status chip, and the settled card shell extracted
 * so `TeacherAvailabilityCard.tsx` stays under the views-tree 150-line
 * file cap (mirrors the `ApplicantStatusShell.tsx` precedent).
 *
 * The plain card frame (skeleton + load-error branches) reuses the
 * shared `CardShell` from `students/dashboard` — DRY surface, single
 * source of truth for the uniform dashboard slot chrome.
 *
 * MUI v9 discipline: `sx`-only styling, colors exclusively through
 * `theme.palette.*` callbacks, `*Outlined` icons only, RTL-safe logical
 * composition (flex/grid mirroring — no physical margins), and zero
 * user-facing string surfaces (copy lives in the card entry point).
 */

/** Stable test hook — the settled card branch. */
export const CARD_TEST_ID = "teacher-availability-card";
/** Stable test hook — the in-flight skeleton branch. */
/** Stable test hook — the query-load failure branch. */

/** Visual tone family driving the chip + accent-bar colors (theme palette only). */
type AvailabilityTone = "available" | "unavailable";

/**
 * Resolves the chip palette pair for the current availability flag (MUI v9
 * `on<Color>` container siblings — never `contrastText`, never string-based
 * palette access).
 */
function resolveToneColors(tone: AvailabilityTone): {
  readonly bg: (palette: Palette) => string;
  readonly fg: (palette: Palette) => string;
} {
  return tone === "available"
    ? { bg: p => p.successContainer, fg: p => p.onSuccessContainer }
    : { bg: p => p.surfaceContainerHigh, fg: p => p.text.secondary };
}

interface AvailabilityStatusChipProps {
  /** Current availability flag — drives the chip's tone + icon + accent color. */
  readonly isOnline: boolean;
  /**
   * The localized state word ("Available" / "Offline") — resolved by the
   * card entry point (the shell keeps zero user-facing string surfaces).
   * The chip is NEVER icon-only: the word names the state next to the icon
   * so the indicator stays legible and screen-reader-announced.
   */
  readonly label: string;
}

/** Status chip driven by `isOnline` — semantic container/on-container pair. */
export function AvailabilityStatusChip({ isOnline, label }: Readonly<AvailabilityStatusChipProps>): ReactNode {
  const tone: AvailabilityTone = isOnline ? "available" : "unavailable";
  const colors = resolveToneColors(tone);
  return (
    <Chip
      icon={isOnline ? <AvailableIcon fontSize="small" /> : <UnavailableIcon fontSize="small" />}
      label={label}
      size="small"
      sx={theme => ({
        fontWeight: 600,
        bgcolor: colors.bg(theme.palette),
        color: colors.fg(theme.palette),
        "& .MuiChip-icon": {
          color: colors.fg(theme.palette),
        },
      })}
    />
  );
}

/**
 * Skeleton placeholder mirroring the settled card geometry — announced as
 * a busy live region so screen readers hear WHAT is loading, not just that
 * something is.
 */
export function AvailabilityLoadingSkeleton(): ReactNode {
  return (
    <CardShell testId="teacher-availability-card-loading" busy>
      <Skeleton variant="text" sx={{ fontSize: "1.75rem", maxWidth: 220 }} />
      <Skeleton variant="rounded" sx={{ height: 26, width: 120, borderRadius: 999 }} />
      <Skeleton variant="rounded" sx={{ height: 64, borderRadius: 2 }} />
      <Skeleton variant="rectangular" sx={{ minHeight: 42, width: 200, borderRadius: 2 }} />
    </CardShell>
  );
}

/** Outer shell for the load-error branch — mirrors the settled card frame. */
export function AvailabilityLoadErrorShell({ children }: Readonly<{ children: ReactNode }>): ReactNode {
  return <CardShell testId="teacher-availability-card-load-error">{children}</CardShell>;
}

interface SettledCardShellProps {
  /** Stable test hook for the settled card branch. */
  readonly testId: string;
  /** Current availability flag — drives the accent-bar color. */
  readonly isOnline: boolean;
  /** Card content. */
  readonly children: ReactNode;
}

/**
 * Outer card shell for the settled branch — uniform dashboard slot frame
 * with a top-edge accent bar driven by the availability flag.
 */
export function SettledCardShell({ testId, isOnline, children }: Readonly<SettledCardShellProps>): ReactNode {
  return (
    <Card
      elevation={0}
      data-testid={testId}
      sx={theme => ({
        borderRadius: 3,
        border: "1px solid",
        borderColor: theme.palette.outlineVariant,
        bgcolor: theme.palette.surfaceContainerLow,
        boxShadow: theme.palette.shadow.card,
        borderTopWidth: 4,
        borderTopStyle: "solid",
        borderTopColor: isOnline ? theme.palette.success.main : theme.palette.outline,
      })}
    >
      <CardContent sx={{ p: { xs: 3, sm: 4 }, display: "grid", gap: 2 }}>{children}</CardContent>
    </Card>
  );
}
