"use client";

/**
 * LifecyclePanelChrome — the state shells & frame of the admin cooldown
 * lifecycle panel, extracted from `AdminCooldownLifecyclePanel` (file-size
 * cap): `PanelSkeleton` (loading), `LifecyclePanelError` (denial class vs
 * surfaced failure), `LifecycleRail` (the dotted rail threading the bucket
 * rows), and `LifecycleFooter` (the view-all link). Presentation only —
 * copy arrives via props, navigation stays a callback.
 */

import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Skeleton from "@mui/material/Skeleton";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import type { ReactNode } from "react";
import { PermissionDeniedFallback } from "@/frontend/components/ui/PermissionDeniedFallback";
import { extractErrorCode } from "@/frontend/lib/graphql-error-utils";
import { BucketRow } from "@/frontend/views/admin/dashboard/LifecyclePanelRows";
import type { BucketView } from "@/frontend/views/admin/dashboard/lifecycleBucketViews";
import { Errors, useAppTranslation } from "@/shared/locale";

/** Loading shell — skeleton card with busy semantics. Renders on the native
    `<output>` element: it is implicitly a `status` live region (same
    screen-reader contract as the previous `role="status"`), and
    `display: "block"` keeps the div-parity layout `output` lacks by default. */
export function PanelSkeleton({ loadingLabel }: { readonly loadingLabel: string }): ReactNode {
  return (
    <Card
      component="output"
      aria-busy="true"
      aria-label={loadingLabel}
      sx={theme => ({
        display: "block",
        borderRadius: 3,
        border: "1px solid",
        borderColor: theme.palette.outlineVariant,
        bgcolor: theme.palette.surfaceContainerLow,
      })}
    >
      <CardContent sx={{ p: { xs: 2, md: 3 } }}>
        <Skeleton width="42%" height={28} />
        <Skeleton width="64%" height={20} sx={{ mb: 2.5 }} />
        <Stack spacing={2}>
          <Skeleton variant="rounded" height={56} />
          <Skeleton variant="rounded" height={56} />
          <Skeleton variant="rounded" height={56} />
        </Stack>
      </CardContent>
    </Card>
  );
}

/** Settled-failure shell — the page-level server guard stays the only
    authorization boundary, so denial class reuses the shared fallback and
    any other error surfaces the localized internal-error copy (silent
    degradation — the errorLink owns toasts). */
export function LifecyclePanelError({ error }: { readonly error: unknown }): ReactNode {
  const te = useAppTranslation(Errors);
  const code = extractErrorCode(error);
  if (code === "UNAUTHORIZED" || code === "FORBIDDEN") {
    return <PermissionDeniedFallback />;
  }
  return (
    <Alert severity="error" variant="outlined">
      {te.internalServerError}
    </Alert>
  );
}

interface LifecycleRailProps {
  readonly ariaLabel: string;
  readonly buckets: readonly BucketView[];
  readonly onOpen: (href: string) => void;
}

/** The lifecycle rail: one start-aligned vertical line threading the
    three status dots — the cooldown-domain dot language rendered as
    a timeline. The rail is a single absolutely-positioned span so
    the rows stay plain flex (RTL mirrors with zero extra code). */
export function LifecycleRail({ ariaLabel, buckets, onOpen }: LifecycleRailProps): ReactNode {
  return (
    <Box component="nav" aria-label={ariaLabel} sx={{ position: "relative" }}>
      <Box
        aria-hidden="true"
        sx={theme => ({
          position: "absolute",
          insetInlineStart: 11,
          top: 24,
          bottom: 24,
          width: 2,
          borderRadius: 1,
          bgcolor: theme.palette.outlineVariant,
          opacity: 0.6,
        })}
      />
      <Stack spacing={1.25}>
        {buckets.map(bucketView => (
          <BucketRow key={bucketView.bucket} view={bucketView} onOpen={onOpen} />
        ))}
      </Stack>
    </Box>
  );
}

interface LifecycleFooterProps {
  readonly viewAllLabel: string;
  readonly onViewAll: () => void;
}

/** The view-all link — full-width row, primary-colored unset-styled button.
    MUI v9 Stack takes NO system props — alignment rides inside `sx`
    (a bare `justifyContent` prop would fall through to the DOM). */
export function LifecycleFooter({ viewAllLabel, onViewAll }: LifecycleFooterProps): ReactNode {
  return (
    <Stack direction="row" sx={{ mt: 2, justifyContent: "flex-end" }}>
      <Typography
        variant="body2"
        component="button"
        onClick={onViewAll}
        sx={theme => ({
          all: "unset",
          cursor: "pointer",
          color: theme.palette.primary.main,
          fontWeight: 600,
          fontSize: 13,
          borderRadius: 1,
          px: 0.5,
          py: 0.25,
          transition: theme.transitions.create(["color"], { duration: theme.transitions.duration.short }),
          "&:hover": { color: theme.palette.primary.dark, textDecoration: "underline" },
          "&:focus-visible": { outline: `2px solid ${theme.palette.primary.main}`, outlineOffset: 2 },
        })}
      >
        {viewAllLabel}
      </Typography>
    </Stack>
  );
}
