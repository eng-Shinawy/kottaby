"use client";

import { Alert, Box, Skeleton, Stack, Typography } from "@mui/material";
import type { ReactNode } from "react";
import { ErrorRetryAlert } from "@/frontend/components/ui/ErrorRetryAlert";
import { SessionMetaCell } from "@/frontend/components/ui/sessionList";
import {
  type AdminBroadcastDetailQuery_adminBroadcastDetail,
  BroadcastStatus,
} from "@/frontend/graphql/generated/gql/graphql";
import { formatApplicantDate } from "@/frontend/lib/i18n/format-date";
import {
  broadcastAudienceText,
  HISTORY_NO_VALUE_PLACEHOLDER,
} from "@/frontend/views/admin/broadcasts/broadcast-history.helpers";
import { useAppLocale } from "@/shared/locale";
import { useAppTranslation } from "@/shared/locale/client";
import { AdminBroadcasts } from "@/shared/locale/namespaces/adminBroadcasts";
import { AdminUsers } from "@/shared/locale/namespaces/adminUsers";
import { Common } from "@/shared/locale/namespaces/common";

/**
 * BroadcastDetailBody — the read-only body of the broadcast history drawer
 * (`/admin/broadcasts`, History tab): the loading skeleton, the error/retry
 * arm, and the settled arm over the verbatim broadcast body plus the meta
 * grid.
 *
 * The settled arm renders the entry's authored copy `dir="auto"` (the
 * broadcast title AND body — free text composed in either direction) and annotates
 * it with the live delivery counters the detail read carries
 * (`liveDeliveredCount` / `liveReadCount`). The unread figure derives from
 * the snapshot the server returned (recipients minus live reads, never
 * below zero) — it is display arithmetic over honest counters, not a
 * client-side guess at delivery state. The stop metadata rows and the
 * retraction callout render ONLY while the entry's own status snapshot says
 * the broadcast is stopped (`stopped` is terminal — an active broadcast
 * shows no stop block).
 *
 * Query-context errors classify through the shared retry alert copy
 * (`Common.error` / `Common.retry`) — never the server `message`.
 */

interface BroadcastDetailBodyProps {
  /** Settled detail payload, `null` until the drawer's fetch resolves. */
  readonly detail: AdminBroadcastDetailQuery_adminBroadcastDetail | null;
  /** True while this broadcast's detail read is in flight. */
  readonly loading: boolean;
  readonly error: unknown;
  /** Detail-refetch intent (the error arm's retry affordance). */
  readonly onRetry: () => void;
}

/** The drawer body: pending skeleton / error / settled content. */
export function BroadcastDetailBody({
  detail,
  loading,
  error,
  onRetry,
}: Readonly<BroadcastDetailBodyProps>): ReactNode {
  const tCommon = useAppTranslation(Common);

  const pendingBody = (
    <Stack aria-busy="true" data-testid="admin-broadcasts-detail-loading" sx={{ gap: 1.5, p: 2 }}>
      <Skeleton variant="text" sx={{ fontSize: "1.25rem", maxWidth: 220 }} />
      <Skeleton variant="rounded" sx={{ height: 24, width: 140, borderRadius: 999 }} />
      <Skeleton variant="rectangular" sx={{ height: 96, borderRadius: 2 }} />
      <Skeleton variant="rectangular" sx={{ height: 48, borderRadius: 2 }} />
    </Stack>
  );

  if (loading && detail === null && error === undefined) {
    return pendingBody;
  }
  if (error !== undefined && error !== null) {
    return (
      <Stack data-testid="admin-broadcasts-detail-error" sx={{ gap: 2, p: 2 }}>
        <ErrorRetryAlert title={tCommon.error} retryLabel={tCommon.retry} retryPending={false} onRetry={onRetry}>
          {null}
        </ErrorRetryAlert>
      </Stack>
    );
  }
  // Apollo settles queries with data-or-error; this narrow guard keeps the
  // compiler informed without unsafe assertions.
  if (detail === null) {
    return pendingBody;
  }
  return <SettledDetailBody detail={detail} />;
}

interface SettledDetailBodyProps {
  readonly detail: AdminBroadcastDetailQuery_adminBroadcastDetail;
}

/** The settled arm: verbatim title + body, live-counter meta grid, stop block. */
function SettledDetailBody({ detail }: Readonly<SettledDetailBodyProps>): ReactNode {
  const t = useAppTranslation(AdminBroadcasts);
  const tUsers = useAppTranslation(AdminUsers);
  const locale = useAppLocale();
  const entry = detail.entry;
  const stopped = entry.status === BroadcastStatus.Stopped;
  const stoppedAtText =
    entry.stoppedAt === null ? HISTORY_NO_VALUE_PLACEHOLDER : formatApplicantDate(entry.stoppedAt, locale);
  const stoppedByText = entry.stoppedByName ?? HISTORY_NO_VALUE_PLACEHOLDER;
  // Display arithmetic over the server's honest counters — never below zero.
  const unreadCount = Math.max(0, entry.recipientCount - detail.liveReadCount);

  return (
    <Box data-testid="admin-broadcasts-detail-body" sx={{ p: 2, overflowY: "auto" }}>
      <Stack sx={{ gap: 3 }}>
        <Stack
          sx={theme => ({
            p: 2,
            borderRadius: 2,
            bgcolor: theme.palette.surfaceContainerLow,
            border: "1px solid",
            borderColor: theme.palette.outlineVariant,
          })}
        >
          <Typography
            dir="auto"
            variant="h6"
            component="h3"
            sx={{ whiteSpace: "pre-wrap", overflowWrap: "break-word" }}
          >
            {entry.title}
          </Typography>
          <Typography dir="auto" variant="body1" sx={{ whiteSpace: "pre-wrap", overflowWrap: "break-word" }}>
            {entry.body}
          </Typography>
        </Stack>
        <Stack
          sx={{
            display: "grid",
            gap: 2,
            gridTemplateColumns: { xs: "1fr", sm: "repeat(2, 1fr)" },
          }}
        >
          <SessionMetaCell
            label={t.detailAudience}
            value={broadcastAudienceText(entry, t, tUsers.roleLabels, locale)}
          />
          <SessionMetaCell label={t.detailRecipients} value={String(entry.recipientCount)} />
          <SessionMetaCell label={t.detailDelivered} value={String(detail.liveDeliveredCount)} />
          <SessionMetaCell label={t.detailRead} value={String(detail.liveReadCount)} />
          <SessionMetaCell label={t.detailUnread} value={String(unreadCount)} />
          <SessionMetaCell label={t.detailSentAt} value={formatApplicantDate(entry.sentAt, locale)} />
          <SessionMetaCell label={t.columnSentBy} value={entry.sentByName} />
          {stopped ? (
            <>
              <SessionMetaCell label={t.detailStoppedAt} value={stoppedAtText} />
              <SessionMetaCell label={t.detailStoppedBy} value={stoppedByText} />
            </>
          ) : null}
        </Stack>
        {stopped ? <Alert severity="warning">{t.detailRetractedNote}</Alert> : null}
      </Stack>
    </Box>
  );
}
