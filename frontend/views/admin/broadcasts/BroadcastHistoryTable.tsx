"use client";

import { CampaignOutlined, StopCircleOutlined, VisibilityOutlined } from "@mui/icons-material";
import {
  Button,
  Chip,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from "@mui/material";
import type { ReactNode } from "react";
import { focusVisibleRingSx } from "@/frontend/components/ui/focusRing";
import { BroadcastStatus } from "@/frontend/graphql/generated/gql/graphql";
import { formatApplicantDate } from "@/frontend/lib/i18n/format-date";
import {
  BROADCAST_TONE_COLORS,
  type BroadcastHistoryRow,
  broadcastAudienceText,
  broadcastStatusLabelKey,
  broadcastStatusTone,
} from "@/frontend/views/admin/broadcasts/broadcast-history.helpers";
import { useAppLocale } from "@/shared/locale";
import { useAppTranslation } from "@/shared/locale/client";
import { AdminBroadcasts } from "@/shared/locale/namespaces/adminBroadcasts";
import { AdminUsers } from "@/shared/locale/namespaces/adminUsers";

/**
 * BroadcastHistoryTable — the history directory's rows: a hand-composed
 * MUI table (NO AppDataGrid) over one `AdminBroadcastEntryFields` snapshot
 * per send — title (author copy, `dir="auto"`), audience summary, honest
 * recipient count, the lifecycle status chip (Material 3
 * container/on-container pair — status renders from the header payload
 * only, never a client-side guess), the locale-aware sent stamp, the
 * sender name (`dir="auto"`), and the row actions.
 *
 * The View-details action is always present; the Stop action renders ONLY
 * while the header says the broadcast is active — `stopped` is terminal,
 * so a stopped row carries no lifecycle affordance.
 *
 * MUI v9 discipline: `sx`-only styling, colors exclusively through
 * `theme.palette.*` callbacks, ≥44px action targets.
 */

interface BroadcastHistoryTableProps {
  /** The loaded page's rows (the honest page — nothing is extrapolated). */
  readonly rows: readonly BroadcastHistoryRow[];
  /** Open the read-only detail drawer for one broadcast. */
  readonly onViewDetails: (entry: BroadcastHistoryRow) => void;
  /** Open the stop-confirmation dialog for one broadcast (active rows only). */
  readonly onStopIntent: (entry: BroadcastHistoryRow) => void;
}

interface HistoryTableRowProps {
  readonly entry: BroadcastHistoryRow;
  readonly onViewDetails: (entry: BroadcastHistoryRow) => void;
  readonly onStopIntent: (entry: BroadcastHistoryRow) => void;
}

/** One history row — the entry snapshot across the seven pinned columns. */
function HistoryTableRow({ entry, onViewDetails, onStopIntent }: Readonly<HistoryTableRowProps>): ReactNode {
  const t = useAppTranslation(AdminBroadcasts);
  const tUsers = useAppTranslation(AdminUsers);
  const locale = useAppLocale();
  const toneColors = BROADCAST_TONE_COLORS[broadcastStatusTone(entry.status)];
  const StatusIcon = entry.status === BroadcastStatus.Active ? CampaignOutlined : StopCircleOutlined;
  return (
    <TableRow data-testid={`broadcast-history-row-${entry.id}`} hover>
      <TableCell sx={{ maxWidth: 280 }}>
        <Typography variant="body2" dir="auto" sx={{ fontWeight: 600 }}>
          {entry.title}
        </Typography>
      </TableCell>
      <TableCell dir="auto">{broadcastAudienceText(entry, t, tUsers.roleLabels)}</TableCell>
      <TableCell align="right">{entry.recipientCount}</TableCell>
      <TableCell>
        <Chip
          icon={<StatusIcon fontSize="small" />}
          label={t[broadcastStatusLabelKey(entry.status)]}
          size="small"
          sx={theme => ({
            bgcolor: toneColors.bg(theme.palette),
            color: toneColors.fg(theme.palette),
            border: "1px solid",
            borderColor: theme.palette.outlineVariant,
            "& .MuiChip-icon": { color: toneColors.fg(theme.palette) },
          })}
        />
      </TableCell>
      <TableCell dir="auto">{formatApplicantDate(entry.sentAt, locale)}</TableCell>
      <TableCell dir="auto">{entry.sentByName}</TableCell>
      <TableCell align="right">
        <Stack sx={{ gap: 1, flexDirection: "row", flexWrap: "wrap", justifyContent: "flex-end" }}>
          <Button
            variant="text"
            startIcon={<VisibilityOutlined />}
            onClick={() => onViewDetails(entry)}
            data-testid={`broadcast-history-view-${entry.id}`}
            sx={theme => ({ minHeight: 44, color: theme.palette.primary.main, ...focusVisibleRingSx })}
          >
            {t.viewDetails}
          </Button>
          {entry.status === BroadcastStatus.Active ? (
            <Button
              variant="outlined"
              startIcon={<StopCircleOutlined />}
              onClick={() => onStopIntent(entry)}
              data-testid={`broadcast-history-stop-${entry.id}`}
              sx={theme => ({
                minHeight: 44,
                color: theme.palette.error.main,
                borderColor: theme.palette.error.main,
                ...focusVisibleRingSx,
              })}
            >
              {t.stopAction}
            </Button>
          ) : null}
        </Stack>
      </TableCell>
    </TableRow>
  );
}

/** The history rows table. */
export function BroadcastHistoryTable({
  rows,
  onViewDetails,
  onStopIntent,
}: Readonly<BroadcastHistoryTableProps>): ReactNode {
  const t = useAppTranslation(AdminBroadcasts);
  return (
    <TableContainer
      data-testid="admin-broadcasts-history-table"
      sx={theme => ({
        borderRadius: 3,
        border: "1px solid",
        borderColor: theme.palette.outlineVariant,
        bgcolor: theme.palette.surfaceContainerLow,
      })}
    >
      <Table aria-label={t.historyTitle} size="small">
        <TableHead>
          <TableRow>
            <TableCell>{t.columnTitle}</TableCell>
            <TableCell>{t.columnAudience}</TableCell>
            <TableCell align="right">{t.columnRecipientCount}</TableCell>
            <TableCell>{t.columnStatus}</TableCell>
            <TableCell>{t.columnSentAt}</TableCell>
            <TableCell>{t.columnSentBy}</TableCell>
            <TableCell align="right">{t.columnActions}</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.map(entry => (
            <HistoryTableRow key={entry.id} entry={entry} onViewDetails={onViewDetails} onStopIntent={onStopIntent} />
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  );
}
