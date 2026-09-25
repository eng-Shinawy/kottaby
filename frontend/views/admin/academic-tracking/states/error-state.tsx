"use client";

/**
 * Admin academic-tracking load-failure surface.
 *
 * Render-state classification (deep-link path): a query-context
 * FORBIDDEN renders the shared `PermissionDeniedFallback` — the page guard
 * passed, the read model denied, and the denial discloses ZERO data. The
 * classification goes through the SINGLE `mapGraphQLErrorByCode` table
 * over `extractErrorCode`; the raw server `message` is NEVER rendered.
 * Every other failure code renders the inline error `Alert` with the
 * localized body and a Retry CTA (disabled while the retry is in flight).
 *
 * MUI v9 discipline: `sx`-only styling, `*Outlined` icons, ≥44px touch
 * target on the retry CTA.
 */

import { RefreshOutlined } from "@mui/icons-material";
import { Alert, Button, Typography } from "@mui/material";
import type { ReactNode } from "react";
import { PermissionDeniedFallback } from "@/frontend/components/ui/PermissionDeniedFallback";
import { extractErrorCode } from "@/frontend/lib/graphql-error-utils";
import { mapGraphQLErrorByCode } from "@/frontend/providers/apollo/error-link.map";
import { Common, useAppTranslation } from "@/shared/locale";
import { AdminAcademic } from "@/shared/locale/namespaces/adminAcademic";

interface AcademicTrackingErrorStateProps {
  /** The settled Apollo error (or `undefined` while a retry re-attempts). */
  readonly error: unknown;
  /** Retry handler — refetches the owning query. */
  readonly onRetry: () => void;
  /** Retry in flight — disables the affordance while pending. */
  readonly retryPending: boolean;
  /**
   * Optional recovery affordance rendered INSIDE the denied fallback
   * (e.g. the drill-down's "back to dashboard" action). Rendered only
   * when both members are provided.
   */
  readonly deniedActionLabel?: string;
  readonly onDeniedAction?: () => void;
}

export function AcademicTrackingErrorState({
  error,
  onRetry,
  retryPending,
  deniedActionLabel,
  onDeniedAction,
}: Readonly<AcademicTrackingErrorStateProps>): ReactNode {
  const t = useAppTranslation(AdminAcademic);
  const commonT = useAppTranslation(Common);

  const errorCode = error ? extractErrorCode(error) : null;
  const denied =
    errorCode !== null &&
    mapGraphQLErrorByCode(errorCode, { contextKind: "query", hasForm: false })?.kind === "permission-fallback";

  if (denied) {
    // PermissionDeniedFallback itself renders the recovery affordance only
    // when BOTH action props are provided — omitting them yields the plain
    // alert-only surface.
    return <PermissionDeniedFallback actionLabel={deniedActionLabel} onAction={onDeniedAction} />;
  }

  return (
    <Alert
      severity="error"
      variant="outlined"
      sx={theme => ({ borderRadius: 2, borderColor: theme.palette.border.main })}
      action={
        <Button
          color="error"
          size="small"
          disabled={retryPending}
          onClick={onRetry}
          startIcon={<RefreshOutlined />}
          sx={{ flexShrink: 0, minHeight: 44 }}
        >
          {commonT.retry}
        </Button>
      }
    >
      <Typography variant="body2" component="p">
        {t.loadErrorBody}
      </Typography>
    </Alert>
  );
}
