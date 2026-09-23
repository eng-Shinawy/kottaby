"use client";

import { Box, Skeleton, Stack, Typography } from "@mui/material";
import type { ReactNode } from "react";
import { ErrorRetryAlert } from "@/frontend/components/ui/ErrorRetryAlert";
import { SessionMetaCell } from "@/frontend/components/ui/sessionList";
import type { AdminSessionQuery_adminSession } from "@/frontend/graphql/generated/gql/graphql";
import { formatApplicantDate } from "@/frontend/lib/i18n/format-date";
import {
  SESSION_INTENT_LABEL_KEY,
  SESSION_TYPE_LABEL_KEY,
} from "@/frontend/views/admin/session-governance/sessionTypePresentation";
import { SESSION_FEE_CURRENCY } from "@/shared/constants";
import { AdminSessionGovernance, useAppLocale, useAppTranslation } from "@/shared/locale";
import type { AppLocale } from "@/shared/locale/AppLocale";
import type { AdminSessionGovernanceLabels } from "@/shared/locale/types/adminSessionGovernance";
import type { SessionsLabels } from "@/shared/locale/types/sessions";

/**
 * AdminSessionDetailBody — the shared read-only body of the governance
 * session detail panel (`/admin/session-governance`): the
 * loading skeleton, the error/retry arm, the absent-row arm and the
 * settled arm over the {@link DetailMetaGrid}.
 *
 * The detail is a READ-ONLY browse view (any id, null-not-error):
 *  - `adminSession === null` renders the "absent row" body (data, not an
 *    error surface — the browse read answers id-probes with data);
 *  - the `needsAttention` badge is directory-only per the wire contract
 *    (detail always resolves false) and is deliberately NOT rendered here;
 *  - for a `started` (live) session the caller-supplied `joinBanner`
 *    mounts above the meta grid — the single-click observation confirm
 *    (JoinObservationAction).
 *
 * MUI v9 discipline: `sx`-only styling, theme-palette colors, RTL-safe
 * logical composition (no physical sides).
 */

/** Typographic placeholder for nullable payload values (NOT locale copy). */
const NO_VALUE_PLACEHOLDER = "—";

interface DetailBodyProps {
  readonly detail: AdminSessionQuery_adminSession | null;
  readonly loading: boolean;
  readonly error: unknown;
  readonly onRetry: () => void;
  readonly joinBanner: ReactNode;
  readonly joinVisible: boolean;
  readonly tSessions: SessionsLabels;
}

/** Shared scrollable body: banner / absent / error / skeleton / meta grid. */
export function DetailBody({
  detail,
  loading,
  error,
  onRetry,
  joinBanner,
  joinVisible,
  tSessions,
}: Readonly<DetailBodyProps>): ReactNode {
  const t = useAppTranslation(AdminSessionGovernance);

  if (loading && detail === null && error === undefined) {
    return (
      <Stack aria-busy="true" data-testid="admin-session-detail-loading" sx={{ gap: 1.5, p: 2 }}>
        <Skeleton variant="text" sx={{ fontSize: "1.25rem", maxWidth: 220 }} />
        <Skeleton variant="rounded" sx={{ height: 24, width: 140, borderRadius: 999 }} />
        <Skeleton variant="rectangular" sx={{ height: 48, borderRadius: 2 }} />
        <Skeleton variant="rectangular" sx={{ height: 48, borderRadius: 2 }} />
      </Stack>
    );
  }
  if (error) {
    return (
      <Stack data-testid="admin-session-detail-error" sx={{ gap: 2, p: 2 }}>
        <ErrorRetryAlert title={t.errorTitle} retryLabel={t.retryLabel} retryPending={false} onRetry={onRetry}>
          {null}
        </ErrorRetryAlert>
      </Stack>
    );
  }
  if (detail === null) {
    // The browse read answers an unknown id with DATA (`adminSession: null`)
    // — an absence body, not an error surface (the null-not-error contract).
    return (
      <Stack data-testid="admin-session-detail-missing" sx={{ gap: 1.5, py: 8, px: 3, textAlign: "center" }}>
        <Typography variant="body1" sx={theme => ({ color: theme.palette.text.secondary })}>
          {t.detailMissingBody}
        </Typography>
      </Stack>
    );
  }

  return (
    <Box sx={{ p: 2, overflowY: "auto" }}>
      {joinVisible ? joinBanner : null}
      <DetailMetaGrid detail={detail} t={t} tSessions={tSessions} />
    </Box>
  );
}

interface DetailMetaGridProps {
  readonly detail: AdminSessionQuery_adminSession;
  readonly t: AdminSessionGovernanceLabels;
  readonly tSessions: SessionsLabels;
}

/** Nullable lifecycle stamp — the placeholder when absent, else the locale form. */
function nullableStamp(iso: string | null, locale: AppLocale): string {
  return iso === null ? NO_VALUE_PLACEHOLDER : formatApplicantDate(iso, locale);
}

/**
 * The settled session's two-column meta grid (the identity/timing/lifecycle
 * vocabulary). Nullable lifecycle stamps render as cells ONLY when present
 * (a scheduled row shows no resolution/cancel/dispute block).
 */
function DetailMetaGrid({ detail, t, tSessions }: Readonly<DetailMetaGridProps>): ReactNode {
  const locale = useAppLocale();

  const feeText = detail.fee === null ? NO_VALUE_PLACEHOLDER : `${detail.fee} ${SESSION_FEE_CURRENCY}`;
  const createdText = formatApplicantDate(detail.createdAt, locale);
  const startedText = nullableStamp(detail.startedAt, locale);
  const endedText = nullableStamp(detail.endedAt, locale);
  const deadlineText = nullableStamp(detail.confirmationDeadline, locale);
  const studentConfirmedText = nullableStamp(detail.confirmedByStudentAt, locale);
  const teacherConfirmedText = nullableStamp(detail.confirmedByTeacherAt, locale);
  const disputedText = nullableStamp(detail.disputedAt, locale);
  const resolvedAtText = nullableStamp(detail.resolvedAt, locale);

  // Defensive label lookups — an untabled wire token renders the neutral
  // type label / the row's typographic placeholder (mirrors the status
  // chip's defensive-corrupt arm), never an undefined render.
  const typeText = t[SESSION_TYPE_LABEL_KEY[detail.sessionType] ?? "typeStudentSession"];
  const intentText =
    detail.intent === null
      ? NO_VALUE_PLACEHOLDER
      : (t[SESSION_INTENT_LABEL_KEY[detail.intent]] ?? NO_VALUE_PLACEHOLDER);

  return (
    <Stack
      data-testid="admin-session-detail-body"
      sx={{
        display: "grid",
        gap: 2,
        gridTemplateColumns: { xs: "1fr", sm: "repeat(2, 1fr)" },
      }}
    >
      <SessionMetaCell label={t.detailSessionIdLabel} value={detail.id} />
      <SessionMetaCell label={t.detailIntentLabel} value={intentText} />
      <SessionMetaCell label={t.rowTypeLabel} value={typeText} />
      <SessionMetaCell label={tSessions.fee} value={feeText} />
      <SessionMetaCell label={tSessions.participantsLabel} value={`${detail.studentId} · ${detail.teacherId}`} />
      <SessionMetaCell label={tSessions.createdAt} value={createdText} />
      <SessionMetaCell label={t.detailStartLabel} value={startedText} />
      <SessionMetaCell label={t.detailEndLabel} value={endedText} />
      <SessionMetaCell label={t.detailDeadlineLabel} value={deadlineText} />
      <SessionMetaCell label={t.detailConfirmedByStudentLabel} value={studentConfirmedText} />
      <SessionMetaCell label={t.detailConfirmedByTeacherLabel} value={teacherConfirmedText} />
      {detail.cancelReason !== null ? (
        <SessionMetaCell label={t.detailCancelReasonLabel} value={detail.cancelReason} />
      ) : null}
      {detail.disputeReason !== null ? (
        <SessionMetaCell label={t.detailDisputeReasonLabel} value={detail.disputeReason} />
      ) : null}
      {detail.disputedAt !== null ? <SessionMetaCell label={tSessions.disputedAtLabel} value={disputedText} /> : null}
      {detail.resolutionNote !== null ? (
        <SessionMetaCell label={t.detailResolutionLabel} value={detail.resolutionNote} />
      ) : null}
      {detail.resolvedAt !== null ? <SessionMetaCell label={t.detailResolvedAtLabel} value={resolvedAtText} /> : null}
    </Stack>
  );
}
