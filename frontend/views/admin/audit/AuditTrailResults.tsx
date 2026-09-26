"use client";

/**
 * The settled results card: honest empty state when the trail has no
 * entries, else the raw-MUI `Table` trail (min-width track for the
 * small-breakpoint horizontal scroll) plus the pagination footer echoing
 * the server's resolved `page`/`pageSize`/`totalCount` envelope — never
 * optimistic client state.
 */

import { Box, Card, Table, TableBody, TableContainer, TableHead, TablePagination, TableRow } from "@mui/material";
import type { ReactNode } from "react";
import type {
  AdminAuditLogsQuery_adminAuditLogs_items,
  AuditActionType,
} from "@/frontend/graphql/generated/gql/graphql";
import { AuditTrailMobileCards } from "@/frontend/views/admin/audit/AuditTrailMobileCards";
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
    minHeight: 54,
  },
  "& .MuiTablePagination-select": { minHeight: 54 },
  "& .MuiIconButton-root": { minHeight: 54, minWidth: 44 },
} as const;

/**
 * Vertical scroll bounds for the desktop trail track — tall page sizes
 * (25/50 rows) scroll inside the card while the header row stays pinned.
 * The default 10-row page fits comfortably, so the bound is inert there.
 */
const TABLE_CONTAINER_MAX_HEIGHT_PX = 640;

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
      {/* Mobile (< md): per-entry card stack — the fixed-width table would
          shear mid-column inside a 390px viewport. */}
      <Box sx={{ display: { xs: "block", md: "none" }, p: 2 }}>
        <AuditTrailMobileCards
          entries={props.items}
          tableLabels={props.labels.table}
          entityLabels={props.labels}
          locale={props.locale}
          actionLabels={props.actionLabels}
          expandedDetailsId={props.expandedDetailsId}
          onToggleDetails={props.onToggleDetails}
        />
      </Box>
      <TableContainer
        sx={{
          overflowX: "auto",
          display: { xs: "none", md: "block" },
          maxHeight: { md: TABLE_CONTAINER_MAX_HEIGHT_PX },
        }}
      >
        <Table sx={{ minWidth: TABLE_MIN_WIDTH_PX, tableLayout: "fixed" }} aria-label={props.labels.pageTitle}>
          {/* Sticky head: pinned to the container's scroll box on desktop —
              the header row never scrolls away on tall pages. */}
          <TableHead sx={{ position: "sticky", top: 0, zIndex: 1 }}>
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
            {props.items.map((entry, index) => (
              <AuditTrailRow
                key={entry.id}
                entry={entry}
                tableLabels={props.labels.table}
                entityLabels={props.labels}
                locale={props.locale}
                actionLabels={props.actionLabels}
                isExpanded={props.expandedDetailsId === entry.id}
                rowIndex={index}
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
