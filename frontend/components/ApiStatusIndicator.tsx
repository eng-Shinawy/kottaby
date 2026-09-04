"use client";

import { Box, Tooltip, Typography } from "@mui/material";
import type { ReactNode } from "react";
import {
  statusChipSx,
  statusDotSx,
  statusLabelSx,
  versionLabelSx,
} from "@/frontend/components/ApiStatusIndicator.styles";
import { type ApiStatusKind, useApiStatusPolling } from "@/frontend/components/useApiStatusPolling";
import { logger } from "@/frontend/lib/logger";
import { Landing, useAppTranslation } from "@/shared/locale";

/**
 * ApiStatusIndicator — live footer chip for the unauthenticated LB probe
 * (`GET /api/health`, envelope `{ data: { status, version, ... }, requestId }`).
 * Polling behaviour lives in `useApiStatusPolling`; styling in
 * `ApiStatusIndicator.styles.ts`.
 *
 * Accessibility: renders as `<output>` (implicit ARIA role "status", so the
 * localized label re-announces politely on transitions) + explicit
 * `aria-live="polite"`; the animated dot is aria-hidden; all motion is gated
 * behind `prefers-reduced-motion: no-preference`. Invisible ::after padding
 * lifts the pointer target to ≥44px without inflating the visual pill.
 *
 * Correlation id policy: the health envelope's `requestId` NEVER renders on
 * the surface (tooltip or copy) — users get the friendly localized status
 * line only. The raw id stays a dev/support channel: it travels on the
 * `data-api-request-id` attribute (queryable from devtools) and is emitted
 * through the frontend logger.
 */

export interface ApiStatusIndicatorProps {
  /** Re-poll cadence in ms. Tests pass a small value; production keeps 60s. */
  readonly pollIntervalMs?: number;
}

export function ApiStatusIndicator({ pollIntervalMs }: Readonly<ApiStatusIndicatorProps>): ReactNode {
  const t = useAppTranslation(Landing);
  const status = useApiStatusPolling(pollIntervalMs);

  const labelsByKind: Record<ApiStatusKind, string> = {
    checking: t.footerStatusChecking,
    operational: t.footerStatusOperational,
    offline: t.footerStatusOffline,
  };
  const statusLabel = labelsByKind[status.kind];

  if (status.requestId !== null) {
    // Dev/support correlation only — never rendered (see doc block above).
    logger.debug({ caller: "ApiStatusIndicator" }, "[ApiStatus] probe correlation id", {
      requestId: status.requestId,
    });
  }

  // Friendly localized line only — the raw requestId is deliberately absent
  // from the user-visible tooltip (support reads it via the data attribute).
  const tooltipTitle = `${statusLabel} — ${t.footerStatusLabel}`;

  return (
    <Tooltip title={tooltipTitle} arrow describeChild placement="top">
      <Box
        component="output"
        tabIndex={0}
        aria-live="polite"
        data-api-status={status.kind}
        data-api-request-id={status.requestId ?? undefined}
        sx={statusChipSx(status.kind)}
      >
        <Box aria-hidden="true" sx={statusDotSx(status.kind)} />
        <Typography component="span" sx={statusLabelSx}>
          {statusLabel}
        </Typography>
        {status.version !== null && (
          <Typography component="span" sx={versionLabelSx}>
            v{status.version}
          </Typography>
        )}
      </Box>
    </Tooltip>
  );
}
