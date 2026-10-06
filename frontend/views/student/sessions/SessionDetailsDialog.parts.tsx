"use client";

import { LockOutlined as HeldIcon, LockOpenOutlined as NotHeldIcon } from "@mui/icons-material";
import { Alert, Button, Chip, Skeleton, Stack, Typography } from "@mui/material";
import type { ReactNode } from "react";
import { SessionMetaCell } from "@/frontend/components/ui/sessionList";
import {
  HOLD_CONCLUDED_STATUSES,
  NO_VALUE_PLACEHOLDER,
} from "@/frontend/views/student/sessions/sessionRowPresentation";
import { SESSION_FEE_CURRENCY } from "@/shared/constants";
import { Sessions, useAppTranslation } from "@/shared/locale";

/**
 * `SessionDetailsDialog.parts` — the details dialog's content slots split
 * out of the shell (the `.parts` convention, per-function lint caps): the
 * fee row with its hold-state pill, the outlined severity callout shells
 * for the lifecycle notes, and the dialog-level loading / error /
 * unavailable slots. Every slot renders honest nulls — nothing is
 * fabricated.
 */

/** The fee-row hold pill's tone/icon/copy table keyed by the resolved state. */
const FEE_HOLD_PILL: Record<
  string,
  { readonly icon: typeof HeldIcon; readonly labelKey: "sessionDetailsFeeHeld" | "sessionDetailsFeeNotHeld" }
> = {
  held: { icon: HeldIcon, labelKey: "sessionDetailsFeeHeld" },
  "not-held": { icon: NotHeldIcon, labelKey: "sessionDetailsFeeNotHeld" },
};

/** Fee meta value — the verbatim decimal + currency label (never parsed). */
function sessionDetailsFeeText(fee: string | null): string {
  return fee === null ? NO_VALUE_PLACEHOLDER : `${fee} ${SESSION_FEE_CURRENCY}`;
}

/**
 * The fee row: the verbatim fee meta cell (the row meta's exact idiom)
 * beside the hold-state pill. `feeHeld = true` is ALWAYS meaningful (money
 * in escrow); the `false` arm renders only when the hold lifecycle has
 * concluded ({@link HOLD_CONCLUDED_STATUSES} — released on `Cancelled`,
 * consumed on `Completed`), because on the pre-settlement and open-dispute
 * statuses a false wire value is an edge shape answered with honest
 * silence (the row pills' membership posture).
 */
export function SessionDetailsFeeRow({
  fee,
  feeHeld,
  status,
}: Readonly<{ fee: string | null; feeHeld: boolean; status: string }>): ReactNode {
  const t = useAppTranslation(Sessions);
  let state: "held" | "not-held" | null = null;
  if (feeHeld) {
    state = "held";
  } else if (status in HOLD_CONCLUDED_STATUSES) {
    state = "not-held";
  }
  return (
    <Stack sx={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 2 }}>
      <SessionMetaCell label={t.fee} value={sessionDetailsFeeText(fee)} />
      {state === null ? null : <SessionDetailsFeeHoldPill state={state} />}
    </Stack>
  );
}

/** The hold pill render shape (resolved state → chip), split for clarity. */
function SessionDetailsFeeHoldPill({ state }: Readonly<{ state: "held" | "not-held" }>): ReactNode {
  const t = useAppTranslation(Sessions);
  const pill = FEE_HOLD_PILL[state];
  const Icon = pill.icon;
  const held = state === "held";
  return (
    <Chip
      icon={<Icon fontSize="small" />}
      label={t[pill.labelKey]}
      size="small"
      variant="outlined"
      data-testid={`session-details-fee-${state}`}
      sx={theme => ({
        borderColor: held ? theme.palette.infoContainer : theme.palette.outlineVariant,
        bgcolor: theme.palette.surfaceContainerLowest,
        color: held ? theme.palette.onInfoContainer : theme.palette.text.secondary,
        "& .MuiChip-icon": {
          color: held ? theme.palette.onInfoContainer : theme.palette.text.secondary,
        },
      })}
    />
  );
}

/** One lifecycle note as an outlined severity callout (label + free-text body). */
export function SessionDetailsNoteCallout({
  severity,
  label,
  children,
  testId,
}: Readonly<{
  severity: "warning" | "error" | "info";
  label: string;
  children: ReactNode;
  testId: string;
}>): ReactNode {
  return (
    <Alert severity={severity} variant="outlined" data-testid={testId}>
      <Stack sx={{ gap: 0.5, minWidth: 0 }}>
        <Typography variant="overline" sx={theme => ({ color: theme.palette.text.secondary })}>
          {label}
        </Typography>
        {children}
      </Stack>
    </Alert>
  );
}

/** Free-text note body: auto-dir isolate (the row evidence lines' treatment). */
export function SessionDetailsNoteText({ text }: Readonly<{ text: string }>): ReactNode {
  return (
    <Typography variant="body2" dir="auto" sx={{ unicodeBidi: "isolate", whiteSpace: "pre-wrap" }}>
      {text}
    </Typography>
  );
}

/** The dialog's `aria-busy` loading slot — bare skeleton lines, stable keys. */
export function SessionDetailsLoadingSkeleton({ testId }: Readonly<{ testId: string }>): ReactNode {
  const loadingKeys = ["session", "timeline", "notes"];
  return (
    <Stack aria-busy="true" data-testid={testId} sx={{ gap: 2, py: 2 }}>
      {loadingKeys.map(key => (
        <Skeleton key={key} variant="rounded" sx={{ height: 56 }} />
      ))}
    </Stack>
  );
}

/** The honest-null slot: `sessionById` answered `null` (the no-oracle contract). */
export function SessionDetailsUnavailableNotice({
  testId,
  message,
}: Readonly<{ testId: string; message: string }>): ReactNode {
  return (
    <Stack data-testid={testId} sx={{ py: 4 }}>
      <Alert severity="info" variant="outlined">
        {message}
      </Alert>
    </Stack>
  );
}

/** The settled-failure slot: the mapped copy plus the caller's retry intent. */
export function SessionDetailsErrorSlot({
  testId,
  message,
  retryLabel,
  onRetry,
}: Readonly<{ testId: string; message: string; retryLabel: string; onRetry: () => void }>): ReactNode {
  return (
    <Stack data-testid={testId} sx={{ gap: 2, py: 2 }}>
      <Alert severity="error" variant="outlined">
        {message}
      </Alert>
      <Button variant="outlined" onClick={onRetry} sx={{ minHeight: 44, alignSelf: "flex-start", px: 3 }}>
        {retryLabel}
      </Button>
    </Stack>
  );
}
