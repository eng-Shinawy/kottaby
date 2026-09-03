"use client";

/**
 * One trail row of the raw-MUI `Table`: locale-aware `createdAt`
 * stamp, actor, the reused `activity.action*` chip, entity columns and the
 * per-row expandable `details` block — rendered VERBATIM inside a
 * `dir="auto"` pre-formatted element (mixed-direction JSON blobs), with the
 * namespace em-dash placeholders for the null `details`/`entityId` cells.
 */

import { Box, Button, TableCell, TableRow, Typography } from "@mui/material";
import type { ReactNode } from "react";
import { focusVisibleRingSx } from "@/frontend/components/ui/focusRing";
import type {
  AdminAuditLogsQuery_adminAuditLogs_items,
  AuditActionType,
} from "@/frontend/graphql/generated/gql/graphql";
import { formatApplicantDate } from "@/frontend/lib/i18n/format-date";
import { bodyCellSx } from "@/frontend/views/admin/audit/audit-trail-skin";
import type { AdminUsersLabels } from "@/shared/locale/types/adminUsers";

interface AuditTrailHeaderCellProps {
  readonly children: ReactNode;
  readonly width: string;
}

/** Header cell — uppercase 12px / 600 / letter-spaced, `text.secondary`. */
export function AuditTrailHeaderCell({ children, width }: Readonly<AuditTrailHeaderCellProps>): ReactNode {
  return (
    <TableCell
      sx={theme => ({
        width,
        textTransform: "uppercase",
        fontSize: 12,
        fontWeight: 600,
        letterSpacing: "0.06em",
        color: theme.palette.text.secondary,
        textAlign: "start",
        borderBottom: `1px solid ${theme.palette.border.light}`,
      })}
    >
      {children}
    </TableCell>
  );
}

interface AuditTrailRowProps {
  readonly entry: AdminAuditLogsQuery_adminAuditLogs_items;
  readonly tableLabels: AdminUsersLabels["auditTrail"]["table"];
  readonly locale: string;
  readonly actionLabels: Record<AuditActionType, string>;
  readonly isExpanded: boolean;
  readonly onToggleDetails: (entryId: string) => void;
}

export function AuditTrailRow({
  entry,
  tableLabels,
  locale,
  actionLabels,
  isExpanded,
  onToggleDetails,
}: Readonly<AuditTrailRowProps>): ReactNode {
  const hasDetails = entry.details !== null;
  return (
    <TableRow sx={theme => ({ "&:hover": { backgroundColor: theme.palette.action.hover } })}>
      <TableCell sx={bodyCellSx}>
        <Typography variant="body2" component="p">
          {formatApplicantDate(entry.createdAt, locale)}
        </Typography>
      </TableCell>
      <TableCell sx={bodyCellSx}>
        <Typography variant="body2" component="p" sx={{ fontWeight: 600 }}>
          {entry.actorName}
        </Typography>
      </TableCell>
      <TableCell sx={bodyCellSx}>
        <Box
          component="span"
          sx={theme => ({
            display: "inline-flex",
            alignItems: "center",
            padding: theme.spacing(0.25, 1.25),
            borderRadius: 999,
            backgroundColor: theme.palette.secondaryContainer,
            color: theme.palette.onSecondaryContainer,
            fontSize: 13,
            fontWeight: 600,
          })}
        >
          {actionLabels[entry.actionType]}
        </Box>
      </TableCell>
      <TableCell sx={bodyCellSx}>
        <Typography variant="body2" component="p">
          {entry.entityType}
        </Typography>
      </TableCell>
      <TableCell sx={bodyCellSx}>
        {entry.entityId === null ? (
          <Typography variant="body2" component="p" sx={theme => ({ color: theme.palette.text.secondary })}>
            {tableLabels.noEntityIdValue}
          </Typography>
        ) : (
          <Typography variant="body2" component="p">
            {entry.entityId}
          </Typography>
        )}
      </TableCell>
      <TableCell sx={bodyCellSx}>
        {hasDetails ? (
          <>
            <Button
              size="small"
              variant="text"
              aria-expanded={isExpanded}
              onClick={() => onToggleDetails(entry.id)}
              sx={{ ...focusVisibleRingSx, minHeight: 44 }}
            >
              {isExpanded ? tableLabels.detailsHideLabel : tableLabels.detailsShowLabel}
            </Button>
            {isExpanded ? (
              <Box
                component="pre"
                dir="auto"
                sx={theme => ({
                  margin: 0,
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                  fontSize: 12,
                  color: theme.palette.text.secondary,
                })}
              >
                {entry.details}
              </Box>
            ) : null}
          </>
        ) : (
          <Typography variant="body2" component="p" sx={theme => ({ color: theme.palette.text.secondary })}>
            {tableLabels.noDetailsValue}
          </Typography>
        )}
      </TableCell>
    </TableRow>
  );
}
