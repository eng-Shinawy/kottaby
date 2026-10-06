"use client";

import { skipToken, useQuery } from "@apollo/client/react";
import { Dialog, DialogContent, DialogTitle } from "@mui/material";
import type { ReactNode } from "react";
import { DialogCloseActions } from "@/frontend/components/ui/DialogCloseActions";
import { PermissionDeniedFallback } from "@/frontend/components/ui/PermissionDeniedFallback";
import type { SessionByIdQuery } from "@/frontend/graphql/generated/gql/graphql";
import { sessionByIdQueryDocument } from "@/frontend/graphql/sharedDocuments";
import { extractErrorCode } from "@/frontend/lib/graphql-error-utils";
import { mapGraphQLErrorByCode, normalizeGraphQLErrorCode } from "@/frontend/providers/apollo/error-link.map";
import { SessionDetailsContent } from "@/frontend/views/student/sessions/SessionDetailsDialog.content.parts";
import {
  SessionDetailsErrorSlot,
  SessionDetailsLoadingSkeleton,
  SessionDetailsUnavailableNotice,
} from "@/frontend/views/student/sessions/SessionDetailsDialog.parts";
import type { SessionRowRole } from "@/frontend/views/student/sessions/sessionRowPresentation";
import type { SessionDetailsRowPayload } from "@/frontend/views/student/sessions/useSessionDetailsDialogSlot";
import { Common, Sessions, useAppTranslation } from "@/shared/locale";

/**
 * SessionDetailsDialog — the READ-ONLY "Session details" dialog shared by
 * the student and teacher session lists (the cross-surface home this
 * folder already is — the teacher surface imports `SessionRow` from here).
 *
 * Data: ONE `sessionById` read (`useQuery` + `skipToken` while closed —
 * the Apollo v4 non-deprecated skip form; `useLazyQuery` is banned). The
 * document already selects every lifecycle/dispute field, so ZERO GraphQL
 * or backend changes ride along.
 *
 * Row-payload seam: the dialog receives the CLICKED LIST ROW (nullable)
 * and reads EXACTLY ONE datum from it — the counterpart identity band,
 * which the list producers batch-enrich and `sessionById` stays band-free
 * BY DESIGN. Every wire-selected field (status, intent, fee, stamps,
 * notes) renders from the FRESH single-session read, so the dialog shows
 * the authoritative lifecycle even if the row has drifted. A row that left
 * the list (`null`) degrades to a band-less header honestly.
 *
 * State matrix (mirrors `ParticipantDisputeCaseDialog`): `aria-busy`
 * skeleton → denial family (`permission-fallback` / `auth-recovery` via the
 * single `mapGraphQLErrorByCode` table) → inline retryable error slot →
 * the honest-null "unavailable" notice for `sessionById = null` (foreign /
 * nonexistent id — the no-oracle contract) → the settled content
 * (`SessionDetailsContent`). Dismissal: close button + backdrop + Escape;
 * NO submit actions anywhere.
 *
 * MUI v9 discipline: `sx`-only styling, theme-palette colors through
 * callbacks, RTL-safe logical composition, ≥44px touch target on the close
 * action.
 */

/** The dialog's testid prefix (suite anchor: `session-details-*`). */
const TESTID_PREFIX = "session-details";

interface SessionDetailsDialogProps {
  /** Open/close flag (the slot's id non-null arms the query). */
  readonly open: boolean;
  /** The session id whose details are on view (`null` while closed). */
  readonly sessionId: string | null;
  /**
   * The clicked list row — the band source ONLY (see the module docblock);
   * `null` renders the header band-less honestly.
   */
  readonly session: SessionDetailsRowPayload | null;
  /** The surface's row-role constant — picks WHICH band the row supplies. */
  readonly rowRole: SessionRowRole;
  /** Dismiss intent — close action, backdrop and Escape all route here. */
  readonly onClose: () => void;
}

/**
 * The dialog body — the state matrix (skeleton → denial fallback →
 * retryable error → unavailable → content) with the single
 * `sessionById` observer active. Extracted from the shell for the
 * per-function caps; the shell owns the chrome, this owns the content.
 */
function SessionDetailsBody({
  rowRole,
  session,
  data,
  loading,
  error,
  retryLabel,
  onRetry,
}: Readonly<{
  rowRole: SessionRowRole;
  session: SessionDetailsRowPayload | null;
  data: SessionByIdQuery | undefined;
  loading: boolean;
  error: unknown;
  retryLabel: string;
  onRetry: () => void;
}>): ReactNode {
  const t = useAppTranslation(Sessions);
  const tid = (suffix: string) => `${TESTID_PREFIX}-${suffix}`;

  if (loading && data === undefined) {
    // First fetch: the `aria-busy` skeleton — no fabricated section shells.
    return <SessionDetailsLoadingSkeleton testId={tid("loading")} />;
  }
  if (error) {
    const rawCode = extractErrorCode(error);
    const code = rawCode === null ? "" : normalizeGraphQLErrorCode(rawCode);
    const action = mapGraphQLErrorByCode(code, { contextKind: "query", hasForm: false });
    if (action?.kind === "permission-fallback" || action?.kind === "auth-recovery") {
      return <PermissionDeniedFallback />;
    }
    return (
      <SessionDetailsErrorSlot
        testId={tid("error")}
        message={t.genericError}
        retryLabel={retryLabel}
        onRetry={onRetry}
      />
    );
  }
  if (!data) {
    return <SessionDetailsLoadingSkeleton testId={tid("loading")} />;
  }
  const wire = data.sessionById;
  if (wire === null) {
    // Foreign/nonexistent id — the ONE honest answer (no-oracle contract).
    return <SessionDetailsUnavailableNotice testId={tid("unavailable")} message={t.sessionDetailsUnavailable} />;
  }
  return <SessionDetailsContent rowRole={rowRole} session={session} wire={wire} />;
}

/** The read-only session details dialog: one query, honest nulls, no submits. */
export function SessionDetailsDialog({
  open,
  sessionId,
  session,
  rowRole,
  onClose,
}: Readonly<SessionDetailsDialogProps>): ReactNode {
  const t = useAppTranslation(Sessions);
  const tc = useAppTranslation(Common);
  const tid = (suffix: string) => `${TESTID_PREFIX}-${suffix}`;

  // The ONE open-gated read — `skipToken` while closed (the Apollo v4
  // non-deprecated skip form; mounting is also conditional at the
  // containers, so the skip arm is the defensive belt).
  const result = useQuery(
    sessionByIdQueryDocument,
    open && sessionId !== null ? { variables: { id: sessionId } } : skipToken
  );

  return (
    <Dialog
      open={open}
      onClose={onClose}
      fullWidth
      maxWidth="sm"
      scroll="paper"
      data-testid={tid("dialog")}
      aria-labelledby={tid("title")}
    >
      <DialogTitle id={tid("title")} sx={theme => ({ color: theme.palette.onSurface })}>
        {t.sessionDetailsDialogTitle}
      </DialogTitle>
      <DialogContent sx={{ display: "grid", gap: 3 }}>
        <SessionDetailsBody
          rowRole={rowRole}
          session={session}
          data={result.data}
          loading={result.loading}
          error={result.error}
          retryLabel={tc.retry}
          onRetry={() => {
            void result.refetch();
          }}
        />
      </DialogContent>
      <DialogCloseActions onClick={onClose} testId={tid("close")} label={tc.close} />
    </Dialog>
  );
}
