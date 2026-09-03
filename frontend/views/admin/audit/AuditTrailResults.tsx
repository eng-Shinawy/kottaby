"use client";

/**
 * The settled results card: honest empty state when the trail has no
 * entries, else the raw-MUI `Table` trail (min-width track for the
 * small-breakpoint horizontal scroll) plus the pagination footer echoing
 * the server's resolved `page`/`pageSize`/`totalCount` envelope — never
 * optimistic client state.
 */

import { Card, Table, TableBody, TableContainer, TableHead, TablePagination, TableRow } from "@mui/material";
import type { ReactNode } from "react";
import type {
  AdminAuditLogsQuery_adminAuditLogs_items,
  AuditActionType,
} from "@/frontend/graphql/generated/gql/graphql";
import { AuditTrailHeaderCell, AuditTrailRow } from "@/frontend/views/admin/audit/AuditTrailRow";
import { AuditTrailEmptyState } from "@/frontend/views/admin/audit/AuditTrailStates";
import { surfaceCardSx } from "@/frontend/views/admin/audit/audit-trail-skin";
import type { AdminUsersLabels } from "@/shared/locale/types/adminUsers";

const TABLE_MIN_WIDTH_PX = 860;
const PAGE_SIZE_OPTIONS = [10, 25, 50] as const;

/**
 * ≥44px touch targets for the pagination footer's interactive controls —
 * the same minimum every hand-authored control of the view pins.
 */
const PAGINATION_TOUCH_TARGET_SX = {
  "& .MuiTablePagination-selectLabel, & .MuiTablePagination-displayedRows": {
    display: "flex",
    alignItems: "center",
    minHeight: 44,
  },
  "& .MuiTablePagination-select": { minHeight: 44 },
  "& .MuiIconButton-root": { minHeight: 44, minWidth: 44 },
} as const;

interface AuditTrailResultsProps {
  readonly labels: AdminUsersLabels["auditTrail"];
  readonly paginationLabels: AdminUsersLabels["pagination"];
  readonly locale: string;
  readonly items: readonly AdminAuditLogsQuery_adminAuditLogs_items[];
  readonly totalCount: number;
  /** Server-echoed resolved page (1-based). */
  readonly resolvedPage: number;
  /** Server-echoed resolved page size. */
  readonly resolvedPageSize: number;
  readonly expandedDetailsId: string | null;
  readonly actionLabels: Record<AuditActionType, string>;
  readonly onToggleDetails: (entryId: string) => void;
  /** Receives the ZERO-based next page (TablePagination contract). */
  readonly onPageChange: (nextPage: number) => void;
  readonly onPageSizeChange: (nextPageSize: number) => void;
}

export function AuditTrailResults(props: Readonly<AuditTrailResultsProps>): ReactNode {
  if (props.items.length === 0) {
    return <AuditTrailEmptyState emptyState={props.labels.emptyState} />;
  }
  return (
    <Card sx={surfaceCardSx}>
      <TableContainer sx={{ overflowX: "auto" }}>
        <Table sx={{ minWidth: TABLE_MIN_WIDTH_PX, tableLayout: "fixed" }} aria-label={props.labels.pageTitle}>
          <TableHead>
            <TableRow sx={theme => ({ backgroundColor: theme.palette.surfaceContainerHigh })}>
              <AuditTrailHeaderCell width="16%">{props.labels.table.whenHeader}</AuditTrailHeaderCell>
              <AuditTrailHeaderCell width="18%">{props.labels.table.actorHeader}</AuditTrailHeaderCell>
              <AuditTrailHeaderCell width="14%">{props.labels.table.actionHeader}</AuditTrailHeaderCell>
              <AuditTrailHeaderCell width="16%">{props.labels.table.entityTypeHeader}</AuditTrailHeaderCell>
              <AuditTrailHeaderCell width="12%">{props.labels.table.entityIdHeader}</AuditTrailHeaderCell>
              <AuditTrailHeaderCell width="24%">{props.labels.table.detailsHeader}</AuditTrailHeaderCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {props.items.map(entry => (
              <AuditTrailRow
                key={entry.id}
                entry={entry}
                tableLabels={props.labels.table}
                locale={props.locale}
                actionLabels={props.actionLabels}
                isExpanded={props.expandedDetailsId === entry.id}
                onToggleDetails={props.onToggleDetails}
              />
            ))}
          </TableBody>
        </Table>
      </TableContainer>
      {props.totalCount > 0 ? (
        <TablePagination
          component="div"
          sx={PAGINATION_TOUCH_TARGET_SX}
          count={props.totalCount}
          page={props.resolvedPage - 1}
          rowsPerPage={props.resolvedPageSize}
          rowsPerPageOptions={[...PAGE_SIZE_OPTIONS]}
          onPageChange={(_event, nextPage) => props.onPageChange(nextPage)}
          onRowsPerPageChange={event => {
            const nextPageSize = Number.parseInt(event.target.value, 10);
            if (!Number.isNaN(nextPageSize)) props.onPageSizeChange(nextPageSize);
          }}
          labelRowsPerPage={props.paginationLabels.pageSize}
          labelDisplayedRows={({ from, to, count }) =>
            `${props.paginationLabels.showingPrefix} ${from}–${to} ${props.paginationLabels.of} ${count}`
          }
          getItemAriaLabel={type =>
            type === "previous" ? props.paginationLabels.previous : props.paginationLabels.next
          }
        />
      ) : null}
    </Card>
  );
}
