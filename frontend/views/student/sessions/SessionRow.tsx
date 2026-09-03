"use client";

import { Alert, Box, Stack } from "@mui/material";
import type { ReactNode } from "react";
import type { MyStudentSessionsQuery_myStudentSessions_items } from "@/frontend/graphql/generated/gql/graphql";
import { SessionRowActions } from "@/frontend/views/student/sessions/SessionRowActions";
import { SessionRowCancelReason } from "@/frontend/views/student/sessions/SessionRowCancelReason";
import { SessionRowHeader } from "@/frontend/views/student/sessions/SessionRowHeader";
import { SessionRowLifecycleCtas } from "@/frontend/views/student/sessions/SessionRowLifecycleCtas";
import { SessionRowMeta } from "@/frontend/views/student/sessions/SessionRowMeta";
import type { SessionRowAction } from "@/frontend/views/student/sessions/sessionRowAction";
import {
  CANCELLABLE_STATUSES,
  DISPUTABLE_STATUSES,
  DISPUTED_STATUS,
  NO_VALUE_PLACEHOLDER,
  STATUS_LABEL_KEY,
} from "@/frontend/views/student/sessions/sessionRowPresentation";
import { Sessions, useAppLocale, useAppTranslation } from "@/shared/locale";

/**
 * SessionRow — ONE student session rendered as a bordered list card.
 *
 * Presentation is 100% payload-driven plus compile-time i18n handles:
 *  - the lifecycle status renders as a container-paired chip whose LABEL and
 *    TONE resolve through `Record<string, …>` lookup tables keyed by the
 *    server enum member strings (oxlint `no-unsafe-enum-comparison` — no
 *    `switch` and no direct enum comparisons; tables live in
 *    `sessionRowPresentation.ts`, the header/chip in `SessionRowHeader.tsx`);
 *  - the fee renders VERBATIM (decimal string, never parsed — money
 *    discipline in `shared/constants/session-fees.constants.ts`) followed by
 *    the `SESSION_FEE_CURRENCY` label (`SessionRowMeta.tsx`);
 *  - the confirmation deadline + creation moment expand through the shared
 *    locale-aware {@link formatApplicantDate} (byte-consistent with the
 *    server-side lifecycle formatter);
 *  - the booking intent renders verbatim from the payload (server-owned
 *    value — no client-side intent vocabulary exists in `SessionsLabels`).
 *
 * The Cancel CTA renders ONLY while the row's status is `Scheduled` or
 * `Started` (the cancellable-lifecycle lookup table) — the dialog itself,
 * the mutation and every outcome notice live one level up
 * (`CancelSessionConfirmDialog` + the role container), keeping this
 * row a pure affordance. `alertMessage` renders the row-scoped inline alert
 * the container raises (e.g. `SESSION_INVALID_TRANSITION` rejections).
 *
 * Role seam (4.3): the optional `actions` prop adds lifecycle CTAs BESIDE the
 * Cancel button without forking the row — the teacher container passes
 * Start (`Scheduled`) / Complete (`Started`) descriptors, each carrying its
 * own in-flight `disabled` state; the DEV3-012 student container passes the
 * Confirm descriptor (`Completed` + stamp unset + hold marked), which may
 * additionally carry a `tooltip` (the financial consequence explainer) and
 * a `color` token; terminal statuses receive an empty list otherwise.
 * The student path historically omitted the prop entirely. A
 * `TeacherSessionRow` wrapper was rejected because the Cancel CTA lives
 * INSIDE this row's action stack — the wrapper would have to duplicate the
 * meta/actions layout to sit next to it.
 *
 * DEV3-012 confirm-state display: the row renders the student-confirmation
 * meta cell whenever the stamp is set (dual-confirmation visibility for
 * BOTH roles) and an "awaiting student confirmation" info pill on the
 * exactly-once pending shape (`Completed` ∧ stamp unset ∧ `feeHeld`) — the
 * teacher surface's explanation of WHY the wallet credit has not fired.
 *
 * Hover polish: the card shell carries the idle→hover emphasis (elevation
 * + outline transition); the action buttons keep full opacity at idle so
 * no affordance is ever hover-gated.
 *
 * Composition (this file): the card shell + alert + the footer band; the
 * header band lives in `SessionRowHeader.tsx`, the meta band + pending pill
 * in `SessionRowMeta.tsx`, the cancel-reason line in
 * `SessionRowCancelReason.tsx`, the caller CTAs in `SessionRowActions.tsx`
 * and the dispute/cancel CTAs in `SessionRowLifecycleCtas.tsx`.
 *
 * MUI v9 discipline: `sx`-only styling, theme-palette colors through
 * callbacks, `*Outlined` icons only, RTL-safe logical composition (no
 * physical margins), ≥44px touch target on the mobile CTA.
 */

export type { SessionRowAction };

interface SessionRowProps {
  /**
   * The session payload row (normalized `Session` entity). The student and
   * teacher list item types are structurally identical codegen shapes, so a
   * teacher row passes without a mapping layer.
   */
  readonly session: MyStudentSessionsQuery_myStudentSessions_items;
  /** Row-scoped inline alert copy (e.g. invalid-transition rejection), or absent. */
  readonly alertMessage?: string | null;
  /** Cancel-CTA intent — the container owns dialog open/close state. */
  readonly onCancelIntent: (sessionId: string) => void;
  /**
   * Dispute-CTA intent (DEV3-005) — the container owns the dispute dialog
   * open/close state. When omitted the dispute affordance never renders
   * (the affordance matrix stays caller-driven).
   */
  readonly onDisputeIntent?: (sessionId: string) => void;
  /**
   * Disabled while THIS row's dispute slot is in flight (per-row slot
   * book, cron-r2 D9-bis mechanism extended with the `dispute` kind).
   */
  readonly disputeDisabled?: boolean;
  /** Extra lifecycle CTAs (teacher Start/Complete); the student path omits it. */
  readonly actions?: ReadonlyArray<SessionRowAction>;
}

/** One session list card: status chip + intent title + fee/deadline/created meta. */
export function SessionRow({
  session,
  alertMessage,
  onCancelIntent,
  onDisputeIntent,
  disputeDisabled = false,
  actions,
}: Readonly<SessionRowProps>): ReactNode {
  const t = useAppTranslation(Sessions);
  const locale = useAppLocale();

  const statusLabelKey = STATUS_LABEL_KEY[session.status];
  const statusLabel = statusLabelKey in t ? t[statusLabelKey] : session.status;
  const isCancellable = session.status in CANCELLABLE_STATUSES;
  const isDisputed = session.status in DISPUTED_STATUS;
  const disputeIntent = session.status in DISPUTABLE_STATUSES && onDisputeIntent !== undefined ? onDisputeIntent : null;
  const intentText = session.intent ?? NO_VALUE_PLACEHOLDER;

  return (
    <Box
      data-testid={`session-row-${session.id}`}
      sx={theme => ({
        display: "grid",
        gap: 1.5,
        p: { xs: 2.5, sm: 3 },
        borderRadius: 3,
        border: "1px solid",
        borderColor: theme.palette.outlineVariant,
        bgcolor: theme.palette.surfaceContainerLow,
        boxShadow: theme.palette.shadow.card,
        // Hover lift — elevation + outline emphasis ease in together. The
        // emphasis step goes from the rest `outlineVariant` line to the
        // stronger `outline` token (the palette's accent outline).
        transition: theme.transitions.create(["box-shadow", "transform", "border-color"]),
        "&:hover": {
          boxShadow: theme.shadows[4],
          borderColor: theme.palette.outline,
        },
      })}
    >
      <SessionRowHeader status={session.status} statusLabel={statusLabel} intentText={intentText} />

      {alertMessage !== undefined && alertMessage !== null && alertMessage !== "" ? (
        <Alert severity="error" variant="outlined">
          {alertMessage}
        </Alert>
      ) : null}

      <Stack
        sx={{
          gap: 2,
          flexDirection: { xs: "column", sm: "row" },
          flexWrap: "wrap",
          alignItems: { xs: "stretch", sm: "flex-end" },
          justifyContent: "space-between",
        }}
      >
        <SessionRowMeta session={session} locale={locale} />
        {session.cancelReason !== null ? (
          <SessionRowCancelReason sessionId={session.id} reason={session.cancelReason} />
        ) : null}
        <SessionRowActions actions={actions} sessionId={session.id} />
        <SessionRowLifecycleCtas
          sessionId={session.id}
          isCancellable={isCancellable}
          isDisputed={isDisputed}
          disputeIntent={disputeIntent}
          disputeDisabled={disputeDisabled}
          onCancelIntent={onCancelIntent}
        />
      </Stack>
    </Box>
  );
}
