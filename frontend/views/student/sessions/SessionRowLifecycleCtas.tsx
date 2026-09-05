"use client";

import { FlagOutlined as DisputeActionIcon } from "@mui/icons-material";
import { Button, Tooltip } from "@mui/material";
import type { ReactNode } from "react";
import { Sessions, useAppTranslation } from "@/shared/locale";

interface SessionRowLifecycleCtasProps {
  /** Row identity (testid suffix). */
  readonly sessionId: string;
  /** Cancel CTA renders ENABLED only for cancellable lifecycle statuses. */
  readonly isCancellable: boolean;
  /** Disputed rows render the Cancel CTA VISIBLE but disabled (R-110). */
  readonly isDisputed: boolean;
  /**
   * Resolved dispute intent — `null` renders NO dispute CTA (the
   * affordance matrix stays caller-driven: the intent exists only when the
   * row is disputable AND the container passed the callback).
   */
  readonly disputeIntent: ((sessionId: string) => void) | null;
  /** Disabled while THIS row's dispute slot is in flight. */
  readonly disputeDisabled: boolean;
  /** Cancel-CTA intent — the container owns dialog open/close state. */
  readonly onCancelIntent: (sessionId: string) => void;
}

/**
 * The row's lifecycle CTA group (dispute / cancel / disabled-cancel):
 * same visual family (outlined, ≥44px touch target), colors through theme
 * tokens. Row CTAs hold FULL opacity at idle and never dim — the hover
 * affordance lives on the card shell, so touch users always see every
 * action at its normal strength.
 */
export function SessionRowLifecycleCtas({
  sessionId,
  isCancellable,
  isDisputed,
  disputeIntent,
  disputeDisabled,
  onCancelIntent,
}: Readonly<SessionRowLifecycleCtasProps>): ReactNode {
  const t = useAppTranslation(Sessions);

  return (
    <>
      {/*
       * Dispute affordance (DEV3-005 R-110) with the warning/amber accent
       * THROUGH theme tokens, disabled while this row's dispute slot is in
       * flight. Only for disputable lifecycles (the caller resolves that).
       */}
      {disputeIntent === null ? null : (
        <Button
          variant="outlined"
          color="warning"
          disabled={disputeDisabled}
          onClick={() => disputeIntent(sessionId)}
          startIcon={<DisputeActionIcon fontSize="small" />}
          data-testid={`session-action-${sessionId}-dispute`}
          sx={{ minHeight: { xs: 44, sm: 40 }, px: 3 }}
        >
          {t.openDispute}
        </Button>
      )}
      {isCancellable ? (
        <Button
          variant="outlined"
          color="error"
          onClick={() => onCancelIntent(sessionId)}
          sx={{ minHeight: { xs: 44, sm: 40 }, px: 3 }}
        >
          {t.cancelSession}
        </Button>
      ) : null}
      {isDisputed ? (
        //
        // The state machine forbids cancelling a disputed session (the
        // ONLY edge out is admin arbitration) — the CTA stays VISIBLE but
        // disabled, with the reason reachable via tooltip. MUI tooltips
        // need a focusable wrapper around a disabled button, hence the
        // inline span bridge.
        //
        <Tooltip title={t.cancelDisabledDisputed} placement="top">
          <span>
            <Button
              variant="outlined"
              color="error"
              disabled
              data-testid={`session-action-${sessionId}-cancel-disabled`}
              sx={{ minHeight: { xs: 44, sm: 40 }, px: 3 }}
            >
              {t.cancelSession}
            </Button>
          </span>
        </Tooltip>
      ) : null}
    </>
  );
}
