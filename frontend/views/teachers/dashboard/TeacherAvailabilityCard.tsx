"use client";

import { useQuery } from "@apollo/client/react";
import { PowerSettingsNewOutlined as PowerIcon } from "@mui/icons-material";
import { Alert, Box, Button, Stack, Typography } from "@mui/material";
import { type ReactNode, useCallback } from "react";
import { focusVisibleRingSx } from "@/frontend/components/ui/focusRing";
import { NoticeSnackbar } from "@/frontend/components/ui/NoticeSnackbar";
import type { MyTeacherAvailabilityQuery_myTeacherAvailability } from "@/frontend/graphql/generated/gql/graphql";
import { myTeacherAvailabilityQueryDocument } from "@/frontend/graphql/sharedDocuments";
import {
  AvailabilityLoadErrorShell,
  AvailabilityLoadingSkeleton,
  AvailabilityStatusChip,
  CARD_TEST_ID,
  SettledCardShell,
} from "@/frontend/views/teachers/dashboard/TeacherAvailabilityShell";
import {
  AVAILABILITY_NOTICE_AUTOHIDE_MS,
  useTeacherAvailabilityToggle,
} from "@/frontend/views/teachers/dashboard/useTeacherAvailabilityToggle";
import { Errors, useAppTranslation } from "@/shared/locale";
import { Availability } from "@/shared/locale/namespaces/availability";
import type { AvailabilityLabels } from "@/shared/locale/types/availability";

/**
 * TeacherAvailabilityCard — the certified-teacher availability toggle card
 * mounted above the fold on `/teacher/dashboard` (a sibling of
 * `ApplicantStatusCard` + `TeacherUpNextCard`).
 *
 * Self-contained client component: NO props, NO client-side role logic, and
 * NO locally derived lifecycle booleans — the page-level server guards
 * remain the ONLY authorization boundary and the zero-argument
 * `myTeacherAvailability` query answers identity server-side; every
 * rendered fact comes straight from the payload.
 *
 * The card reuses the EXISTING `availability` locale namespace (8 frozen
 * leaf-string keys — `cardTitle`, `toggleToAvailableCta`,
 * `toggleToUnavailableCta`, `certificationRequiredHint`,
 * `inSessionLockedHint`, `updateSuccess`, `updateGenericError`,
 * `loadErrorNotice`) plus the EXISTING `errors` namespace denial keys
 * surfaced by the shared error-link map. NO server `message` is ever
 * rendered verbatim — copy resolves through the compile-time i18n handles
 * via property access only.
 *
 * Render branches: skeleton (loading) → load-error (query failure) →
 * settled (with the success/neutral accent bar driven by `isOnline`,
 * a status chip driven by `isOnline`, an inline notice lane driven by
 * the mutation outcome, the `certificationRequiredHint` panel when
 * `isApproved === false` (INV-A1 pre-empt — the server 403 FORBIDDEN is
 * the defense-in-depth backstop), and the toggle button whose CTA label
 * is `toggleToUnavailableCta` when online and `toggleToAvailableCta` when
 * offline). The toggle write path lives in
 * `useTeacherAvailabilityToggle.ts`; the shell + chrome primitives live
 * in `TeacherAvailabilityShell.tsx`.
 *
 * MUI v9 discipline: `sx`-only styling, colors exclusively through
 * `theme.palette.*` callbacks, `*Outlined` icons only, RTL-safe logical
 * composition, and every user-facing string resolved through the
 * compile-time i18n handles (property access — NEVER `t('key')`).
 */
export function TeacherAvailabilityCard(): ReactNode {
  const t = useAppTranslation(Availability);
  const te = useAppTranslation(Errors);
  const { data, loading, error, refetch } = useQuery(myTeacherAvailabilityQueryDocument);

  // Branch 1 — in flight: skeleton placeholder announces busy semantics.
  if (loading) {
    return <AvailabilityLoadingSkeleton />;
  }

  // Branch 2 — query load failure: ONE localized inline Alert + retry
  // affordance. The toggle hook is NOT mounted here so the early return
  // stays hook-safe — the hook only runs in the settled branch.
  if (error !== undefined) {
    return (
      <AvailabilityLoadErrorShell>
        <Alert severity="error" variant="outlined">
          {t.loadErrorNotice}
        </Alert>
        <RetryButton label={te.internalServerError} onRetry={() => void refetch()} />
      </AvailabilityLoadErrorShell>
    );
  }

  // Apollo settles queries with data-or-error; this narrow guard keeps the
  // compiler informed without unsafe assertions.
  if (!data) {
    return <AvailabilityLoadingSkeleton />;
  }

  return <SettledAvailabilityCard state={data.myTeacherAvailability} t={t} refetch={refetch} />;
}

interface SettledAvailabilityCardProps {
  readonly state: MyTeacherAvailabilityQuery_myTeacherAvailability;
  readonly t: AvailabilityLabels;
  readonly refetch: () => Promise<unknown>;
}

/** Settled branch — mounts the toggle hook + renders the toggle affordance. */
function SettledAvailabilityCard({ state, t, refetch }: Readonly<SettledAvailabilityCardProps>): ReactNode {
  const { toggle, toggling, notice, inline, dismissNotice } = useTeacherAvailabilityToggle({
    refetch,
    labels: t,
    current: state,
  });
  const isOnline = state.isOnline;
  const isApproved = state.isApproved;
  // INV-A1 pre-empt: when the teacher is NOT certified, the "Available"
  // toggle stays DISABLED — the server 403 FORBIDDEN is the
  // defense-in-depth backstop. The "Unavailable" path stays open
  // (always allowed), but a non-certified teacher is never online in
  // steady state (the server enforces the gate on every write).
  const toggleDisabled = toggling || (isOnline ? false : !isApproved);
  const ctaLabel = isOnline ? t.toggleToUnavailableCta : t.toggleToAvailableCta;

  return (
    <>
      <SettledCardShell testId={CARD_TEST_ID} isOnline={isOnline}>
        <Stack
          spacing={1.5}
          sx={{
            flexDirection: { xs: "column", sm: "row" },
            alignItems: { xs: "flex-start", sm: "center" },
            justifyContent: "space-between",
          }}
        >
          <Typography variant="h5" component="h2" sx={{ fontWeight: 700 }}>
            {t.cardTitle}
          </Typography>
          <AvailabilityStatusChip isOnline={isOnline} label={isOnline ? t.statusAvailable : t.statusUnavailable} />
        </Stack>

        {inline !== null ? (
          <Alert severity={inline.kind === "inSession" ? "warning" : "error"} variant="outlined">
            {inline.message}
          </Alert>
        ) : null}

        {isApproved ? null : (
          <Box
            sx={theme => ({
              display: "flex",
              alignItems: "flex-start",
              gap: 1.5,
              p: 2,
              borderRadius: 2,
              bgcolor: theme.palette.warningContainer,
              color: theme.palette.onWarningContainer,
            })}
          >
            <Typography variant="body2">{t.certificationRequiredHint}</Typography>
          </Box>
        )}

        <Button
          variant={isOnline ? "outlined" : "contained"}
          startIcon={<PowerIcon />}
          disabled={toggleDisabled}
          onClick={() => {
            void toggle();
          }}
          sx={theme => ({
            ...focusVisibleRingSx,
            // Auto width on sm+ — a full-bleed stretched button inside the
            // card's grid reads as a static bar (visual-loop round-1
            // finding), not as a control. Grid items stretch on the INLINE
            // axis, so this is `justifySelf` (alignSelf would only move the
            // block axis). Mobile keeps the comfortable stretch.
            justifySelf: { xs: "stretch", sm: "start" },
            minHeight: { xs: 54 },
            px: { sm: 3 },
            fontWeight: 600,
            borderColor: isOnline ? theme.palette.primary.main : undefined,
          })}
        >
          {ctaLabel}
        </Button>
      </SettledCardShell>
      <NoticeSnackbar notice={notice} autoHideDuration={AVAILABILITY_NOTICE_AUTOHIDE_MS} onClose={dismissNotice} />
    </>
  );
}

/** Inline retry affordance for the query-load failure branch. */
function RetryButton({ label, onRetry }: Readonly<{ label: string; onRetry: () => void }>): ReactNode {
  const handleClick = useCallback((): void => {
    onRetry();
  }, [onRetry]);
  return (
    <Button variant="outlined" onClick={handleClick} sx={focusVisibleRingSx}>
      {label}
    </Button>
  );
}
