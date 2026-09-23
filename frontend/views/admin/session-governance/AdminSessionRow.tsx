"use client";

import { Stack } from "@mui/material";
import type { SxProps, Theme } from "@mui/material/styles";
import type { ReactNode } from "react";
import { SessionRowCardShell } from "@/frontend/components/ui/sessionList";
import type { AdminSessionsQuery_adminSessions_items } from "@/frontend/graphql/generated/gql/graphql";
import { AdminSessionRowActions } from "@/frontend/views/admin/session-governance/AdminSessionRowActions";
import { AdminSessionRowHeadBand } from "@/frontend/views/admin/session-governance/AdminSessionRowHeadBand";
import { AdminSessionRowMetaCells } from "@/frontend/views/admin/session-governance/AdminSessionRowMetaCells";
import type { AdminSessionGovernanceLabels } from "@/shared/locale/types/adminSessionGovernance";
import type { SessionsLabels } from "@/shared/locale/types/sessions";

/**
 * AdminSessionRow — ONE session rendered as a bordered list card in the
 * admin governance directory (`/admin/session-governance`).
 * Presentation mirrors the arbitration-queue row (shared card shell, overline
 * meta cells, verbatim fee) while the CONTENT is governance-specific:
 *
 *  - the head band (`AdminSessionRowHeadBand`) renders the type title, the
 *    `needsAttention` server-derived badge and the lifecycle StatusBadge
 *    through `AdminSessionRowStatusCell` (shared status vocabulary);
 *  - the payload meta cells (`AdminSessionRowMetaCells`) — the duration
 *    derives client-side from `startedAt`/`endedAt` (presentation-only —
 *    D-07: `durationMinutes` is not on the wire); participant ids render
 *    verbatim (the admin surface is trusted — the directory is intentionally
 *    unscoped per-row);
 *  - the kebab menu (`AdminSessionRowActions`) gates the four governance
 *    actions by the state eligibility matrix (D-03).
 *
 * The row is a pure affordance: dialog/drawer state lives in the container.
 * MUI v9 discipline: `sx`-only styling, theme-palette colors, `*Outlined`
 * icons only, RTL-safe logical composition, ≥44px touch targets.
 */

/** Kebab intent — which governance dialog (or the drawer) the row requests. */
export type GovernanceDialogKind = "reschedule" | "cancel" | "reassign";

/** Meta strip — cells wrap; the kebab trails at the inline edge on the same line. */
const ROW_META_STRIP_SX: SxProps<Theme> = {
  gap: 1.5,
  flexDirection: "row",
  flexWrap: "wrap",
  alignItems: "center",
};

interface AdminSessionRowProps {
  /** The session payload row (normalized `Session` entity + attention badge). */
  readonly session: AdminSessionsQuery_adminSessions_items;
  /** Localized governance-namespace labels. */
  readonly t: AdminSessionGovernanceLabels;
  /** Shared sessions-namespace labels (status chip + row meta vocabulary). */
  readonly tSessions: SessionsLabels;
  /** Open the read-only detail drawer for this session. */
  readonly onOpenDetails: (sessionId: string) => void;
  /** Open one governance dialog for this session (container owns the state). */
  readonly onDialogIntent: (kind: GovernanceDialogKind, session: AdminSessionsQuery_adminSessions_items) => void;
}

/** One governance-directory card: status + meta + attention badge + kebab. */
export function AdminSessionRow({
  session,
  t,
  tSessions,
  onOpenDetails,
  onDialogIntent,
}: Readonly<AdminSessionRowProps>): ReactNode {
  return (
    <SessionRowCardShell testId={`admin-session-row-${session.id}`}>
      <AdminSessionRowHeadBand session={session} t={t} tSessions={tSessions} />
      <Stack sx={ROW_META_STRIP_SX}>
        <AdminSessionRowMetaCells session={session} t={t} tSessions={tSessions} />
        <AdminSessionRowActions session={session} t={t} onOpenDetails={onOpenDetails} onDialogIntent={onDialogIntent} />
      </Stack>
    </SessionRowCardShell>
  );
}
