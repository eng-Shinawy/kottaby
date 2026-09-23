"use client";

/**
 * The meta-band pills of `SessionRowMeta.tsx` — split out for the lint
 * line cap. Each pill is a private render shape of the meta band: a
 * themed Chip whose semantics travel in the prop (the parent decides
 * membership, the pill only renders).
 */

import {
  RateReviewOutlined as AwaitingEvaluationIcon,
  EditNoteOutlined as ParkedDraftIcon,
  HourglassTopOutlined as PendingConfirmIcon,
} from "@mui/icons-material";
import { Chip } from "@mui/material";
import type { ReactNode } from "react";

/**
 * Confirm-pending hint — a completed session whose hold is still marked
 * and whose student stamp is unset. On the teacher surface it explains WHY
 * the wallet credit has not fired; on the student surface it names what the
 * Confirm CTA settles. Info-toned pill through theme tokens (no raw hex).
 */
export function AwaitingConfirmationPill({
  sessionId,
  label,
}: Readonly<{ sessionId: string; label: string }>): ReactNode {
  return (
    <Chip
      icon={<PendingConfirmIcon fontSize="small" />}
      label={label}
      size="small"
      variant="outlined"
      data-testid={`session-awaiting-confirmation-${sessionId}`}
      sx={theme => ({
        alignSelf: "center",
        borderColor: theme.palette.infoContainer,
        bgcolor: theme.palette.surfaceContainerLowest,
        color: theme.palette.onInfoContainer,
        "& .MuiChip-icon": {
          color: theme.palette.onInfoContainer,
        },
      })}
    />
  );
}

/**
 * Rubric-pending hint — the evaluator's still-owed submission marker,
 * driven by the pending read's id set (the same membership gate that
 * renders the row's submit CTA, so pill and CTA always agree). Tinted
 * with the primary container so it reads as an ACTION reminder next to
 * the info-toned confirm pill rather than a second status. The icon
 * breathes (a reduced-motion-aware opacity pulse) so the strip reads as
 * "action owed", not "status recorded".
 */
export function AwaitingEvaluationPill({
  sessionId,
  label,
}: Readonly<{ sessionId: string; label: string }>): ReactNode {
  return (
    <Chip
      icon={<AwaitingEvaluationIcon fontSize="small" />}
      label={label}
      size="small"
      variant="outlined"
      data-testid={`session-awaiting-evaluation-${sessionId}`}
      sx={theme => ({
        alignSelf: "center",
        borderColor: theme.palette.primaryContainer,
        bgcolor: theme.palette.surfaceContainerLowest,
        color: theme.palette.onPrimaryContainer,
        "& .MuiChip-icon": {
          color: theme.palette.onPrimaryContainer,
        },
        "@media (prefers-reduced-motion: no-preference)": {
          "& .MuiChip-icon": {
            animation: "awaiting-evaluation-pulse 2.4s ease-in-out infinite",
          },
        },
        "@keyframes awaiting-evaluation-pulse": {
          "0%, 100%": { opacity: 1 },
          "50%": { opacity: 0.4 },
        },
      })}
    />
  );
}

/**
 * Parked-draft hint — the evaluator's "a restorable draft is parked for
 * THIS session" marker, driven by the storage membership read (only the
 * current envelope version counts — the chip promises the dialog will
 * actually restore). The DASHED border is the semantics: unlike the
 * solid-bordered status/action pills beside it, a draft is an unfinished
 * thing — deliberately quieter (muted secondary copy, a static glyph —
 * no pulse) so the strip keeps its hierarchy: the owed action pulses,
 * the parked draft simply waits.
 */
export function ParkedDraftChip({ sessionId, label }: Readonly<{ sessionId: string; label: string }>): ReactNode {
  return (
    <Chip
      icon={<ParkedDraftIcon fontSize="small" />}
      label={label}
      size="small"
      variant="outlined"
      data-testid={`session-parked-draft-${sessionId}`}
      sx={theme => ({
        alignSelf: "center",
        borderStyle: "dashed",
        borderColor: theme.palette.outlineVariant,
        bgcolor: theme.palette.surfaceContainerLowest,
        color: theme.palette.text.secondary,
        "& .MuiChip-icon": {
          color: theme.palette.text.secondary,
        },
      })}
    />
  );
}
