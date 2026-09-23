"use client";

import { FindInPageOutlined as CaseIcon } from "@mui/icons-material";
import { Alert, Button, Stack, Tooltip } from "@mui/material";
import type { ReactNode } from "react";
import { SessionRowCardShell } from "@/frontend/components/ui/sessionList";
import type { MyStudentSessionsQuery_myStudentSessions_items } from "@/frontend/graphql/generated/gql/graphql";
import { SessionRowActions } from "@/frontend/views/student/sessions/SessionRowActions";
import { SessionRowCancelReason } from "@/frontend/views/student/sessions/SessionRowCancelReason";
import { SessionRowDisputeReason } from "@/frontend/views/student/sessions/SessionRowDisputeReason";
import { SessionRowHeader } from "@/frontend/views/student/sessions/SessionRowHeader";
import { SessionRowLifecycleCtas } from "@/frontend/views/student/sessions/SessionRowLifecycleCtas";
import { SessionRowMeta } from "@/frontend/views/student/sessions/SessionRowMeta";
import { SessionRowResolutionNote } from "@/frontend/views/student/sessions/SessionRowResolutionNote";
import type { SessionRowAction } from "@/frontend/views/student/sessions/sessionRowAction";
import {
  CANCELLABLE_STATUSES,
  DISPUTED_STATUS,
  isDisputable,
  NO_VALUE_PLACEHOLDER,
  type SessionRowRole,
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
 * Role seam: the optional `actions` prop adds lifecycle CTAs BESIDE the
 * Cancel button without forking the row — the teacher container passes
 * Start (`Scheduled`) / Complete (`Started`) descriptors, each carrying its
 * own in-flight `disabled` state; the student container passes the
 * Confirm descriptor (`Completed` + stamp unset + hold marked), which may
 * additionally carry a `tooltip` (the financial consequence explainer) and
 * a `color` token; terminal statuses receive an empty list otherwise.
 * The student path historically omitted the prop entirely. A
 * `TeacherSessionRow` wrapper was rejected because the Cancel CTA lives
 * INSIDE this row's action stack — the wrapper would have to duplicate the
 * meta/actions layout to sit next to it.
 *
 * Dispute-role seam: the row owner's `role` token scopes the dispute
 * affordance through `isDisputable` — pre-completion rows stay disputable
 * for BOTH surfaces, while the post-confirmation escalation (completed +
 * student-confirmed + hold consumed) renders only on the student surface
 * (the shared disputable-status set itself stays unwidened, so teacher
 * rows never render the post-confirmation CTA). The token is a
 * UI-affordance scope supplied by each surface's container (mounted behind
 * that role's server-side page guard); the server re-validates ownership
 * and the state matrix on every dispute mutation.
 *
 * Confirm-state display: the row renders the student-confirmation
 * meta cell whenever the stamp is set (dual-confirmation visibility for
 * BOTH roles) and an "awaiting student confirmation" info pill on the
 * exactly-once pending shape (`Completed` ∧ stamp unset ∧ `feeHeld`) — the
 * teacher surface's explanation of WHY the wallet credit has not fired.
 *
 * Hover polish: the card shell (the shared `SessionRowCardShell`) carries
 * the idle→hover emphasis (elevation + outline transition); the action buttons keep full opacity at idle so
 * no affordance is ever hover-gated.
 *
 * Composition (this file): the card shell + alert + the footer band; the
 * header band lives in `SessionRowHeader.tsx`, the meta band + pending pill
 * in `SessionRowMeta.tsx`, the cancel-reason line in
 * `SessionRowCancelReason.tsx`, the participant dispute lines
 * (reason + arbitration outcome) in `SessionRowDisputeReason.tsx` /
 * `SessionRowResolutionNote.tsx`, the caller CTAs in `SessionRowActions.tsx`
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
   * Dispute-CTA intent — the container owns the dispute dialog
   * open/close state. When omitted the dispute affordance never renders
   * (the affordance matrix stays caller-driven).
   */
  readonly onDisputeIntent?: (sessionId: string) => void;
  /**
   * Disabled while THIS row's dispute slot is in flight (per-row slot
   * book, cron-r2 D9-bis mechanism extended with the `dispute` kind).
   */
  readonly disputeDisabled?: boolean;
  /**
   * The row owner's role token (each surface's container constant) —
   * scopes the dispute affordance matrix via `isDisputable`.
   */
  readonly role: SessionRowRole;
  /** Extra lifecycle CTAs (teacher Start/Complete); the student path omits it. */
  readonly actions?: ReadonlyArray<SessionRowAction>;
  /**
   * Case-detail intent — the container owns the case-dialog slot. When
   * supplied AND the row carries dispute history (`disputeReason` set —
   * open OR already-arbitrated, the claimed reason stays part of the case
   * story), the row renders the "Case details" read affordance beside the
   * dispute evidence lines. The student surface omits the prop entirely
   * (its dispute story lives on the row lines); the teacher surface passes
   * it so its rows open the participant-side case dialog.
   */
  readonly onCaseIntent?: (sessionId: string) => void;
  /**
   * Localized "still owes a rubric" label — when supplied (the teacher
   * surface), the meta band may render the rubric-pending pill for the
   * rows the caller marks; absent on the student surface.
   */
  readonly awaitingEvaluationLabel?: string | null;
  /**
   * Localized "unsubmitted draft parked" label — when supplied (the
   * teacher surface), the meta band may render the parked-draft chip for
   * the rows the caller marks (the storage membership read). Absent on
   * the student surface.
   */
  readonly parkedDraftLabel?: string | null;
}

/** One session list card: status chip + intent title + fee/deadline/created meta. */
export function SessionRow({
  session,
  alertMessage,
  onCancelIntent,
  onDisputeIntent,
  disputeDisabled = false,
  role,
  actions,
  onCaseIntent,
  awaitingEvaluationLabel,
  parkedDraftLabel,
}: Readonly<SessionRowProps>): ReactNode {
  const t = useAppTranslation(Sessions);
  const locale = useAppLocale();

  const statusLabelKey = STATUS_LABEL_KEY[session.status];
  const statusLabel = statusLabelKey in t ? t[statusLabelKey] : session.status;
  const isCancellable = session.status in CANCELLABLE_STATUSES;
  const isDisputed = session.status in DISPUTED_STATUS;
  const disputeIntent = isDisputable(session, role) && onDisputeIntent !== undefined ? onDisputeIntent : null;
  const intentText = session.intent ?? NO_VALUE_PLACEHOLDER;

  return (
    <SessionRowCardShell testId={`session-row-${session.id}`}>
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
        <SessionRowMeta
          session={session}
          locale={locale}
          awaitingEvaluationLabel={awaitingEvaluationLabel}
          parkedDraftLabel={parkedDraftLabel}
        />
        {session.disputeReason !== null && session.disputedAt !== null ? (
          <SessionRowDisputeReason
            sessionId={session.id}
            reason={session.disputeReason}
            disputedAt={session.disputedAt}
            locale={locale}
          />
        ) : null}
        {session.resolvedAt !== null && (session.resolutionOutcome !== null || session.resolutionNote !== null) ? (
          <SessionRowResolutionNote
            sessionId={session.id}
            outcome={session.resolutionOutcome}
            note={session.resolutionNote}
            resolvedAt={session.resolvedAt}
            locale={locale}
          />
        ) : null}
        {session.cancelReason !== null ? (
          <SessionRowCancelReason sessionId={session.id} reason={session.cancelReason} />
        ) : null}
        {onCaseIntent !== undefined && session.disputeReason !== null ? (
          <Tooltip title={t.teacherCaseTitle} placement="top">
            <Button
              variant="text"
              color="primary"
              size="small"
              startIcon={<CaseIcon fontSize="small" />}
              onClick={() => onCaseIntent(session.id)}
              data-testid={`session-case-action-${session.id}`}
              sx={{
                minHeight: { xs: 44, sm: 36 },
                px: 2,
                alignSelf: { xs: "stretch", sm: "auto" },
                justifyContent: { xs: "center", sm: "flex-end" },
              }}
            >
              {t.teacherCaseCta}
            </Button>
          </Tooltip>
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
    </SessionRowCardShell>
  );
}
