"use client";

/**
 * DirectoryTable — the desktop (≥`md`) admin user directory table.
 *
 * Card container (radius 12, `border.light` outline, `shadow.card`); the
 * header row sits on `surfaceContainerHigh` with uppercase 12px/600
 * letter-spaced `text.secondary` cells; body rows are ≥72px tall, separated
 * by `border.light` hairlines — odd rows carry a faint `action.hover` zebra
 * tint and pointer hover upgrades the row to `action.selected`.
 *
 * Columns (start → end; they mirror visually under RTL automatically):
 * USER (avatar + name link + ellipsized email + copy-email quick action),
 * PHONE (bidi-isolated LTR), ROLE (tonal pill), STATUS/DETAILS (per-role
 * headline), GOVERNANCE (dot pill), LAST ACTIVE (localized relative time),
 * ACTIONS (kebab menu). Each body row is rendered by `DirectoryUserRow`
 * (the identity cell lives in `DirectoryUserIdentityCell`); odd body rows
 * carry a faint zebra tint and hover upgrades to a stronger highlight.
 *
 * Loading renders stable-key skeleton rows; the empty state reuses the
 * existing `labels.emptyState` copy via `DirectoryEmptyState`. The
 * pagination footer is injected as a `pagination` slot rendered inside the
 * same card (top hairline from `DirectoryPagination`).
 */

import { Card, Skeleton, Table, TableBody, TableCell, TableHead, TableRow } from "@mui/material";
import type { ReactNode } from "react";
import {
  DirectoryEmptyState,
  type DirectoryRowActions,
  type DirectoryUserItem,
  DirectoryUserRow,
  type RowCellLabels,
} from "@/frontend/views/admin/users/directory";
import { DIRECTORY_SKELETON_KEYS } from "@/frontend/views/admin/users/utils";
import { useAppLocale } from "@/shared/locale";

interface DirectoryTableProps extends DirectoryRowActions {
  readonly labels: RowCellLabels;
  readonly items: readonly DirectoryUserItem[];
  readonly loading: boolean;
  readonly hasFilters: boolean;
  /** Footer slot rendered inside the card (the `DirectoryPagination` bar). */
  readonly pagination?: ReactNode;
}

const COLUMN_COUNT = 7;

export function DirectoryTable(props: DirectoryTableProps): ReactNode {
  const { labels, items, loading, hasFilters, onEdit, onChangePassword, onDelete, onCopyEmail, onClearFilters } = props;
  const locale = useAppLocale();
  return (
    <Card
      sx={theme => ({
        display: { xs: "none", md: "block" },
        borderRadius: "12px",
        border: `1px solid ${theme.palette.border.light}`,
        boxShadow: theme.palette.shadow.card,
        overflow: "hidden",
      })}
    >
      <Table sx={{ tableLayout: "fixed" }}>
        <TableHead>
          <TableRow sx={theme => ({ bgcolor: theme.palette.surfaceContainerHigh })}>
            <DirectoryHeaderCell width="27.5%">{labels.headers.name}</DirectoryHeaderCell>
            <DirectoryHeaderCell width="13%">{labels.headers.phone}</DirectoryHeaderCell>
            {/* ROLE gets ≥11% — the tonal pill's Arabic label ("مسؤول") needs
                ~60px of label space; at the former 9% the fixed-layout cell
                squeezed the chip below its content size and ellipsized it. */}
            <DirectoryHeaderCell width="11%">{labels.headers.role}</DirectoryHeaderCell>
            <DirectoryHeaderCell width="15%">{labels.headers.statusDetails}</DirectoryHeaderCell>
            {/* GOVERNANCE gets ≥13% — the letter-spaced "GOVERNANCE" caps label
                needs ~90px; at the former 9% it overflowed its fixed-layout
                cell and painted into the LAST ACTIVE header beside it. */}
            <DirectoryHeaderCell width="13%">{labels.headers.governance}</DirectoryHeaderCell>
            <DirectoryHeaderCell width="12.5%">{labels.headers.lastActive}</DirectoryHeaderCell>
            <DirectoryHeaderCell width="8%" align="end">
              {labels.headers.actions}
            </DirectoryHeaderCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {loading &&
            items.length === 0 &&
            DIRECTORY_SKELETON_KEYS.map(rowKey => (
              <TableRow key={rowKey}>
                <TableCell
                  colSpan={COLUMN_COUNT}
                  sx={theme => ({ borderBottom: `1px solid ${theme.palette.border.light}` })}
                >
                  <Skeleton variant="text" />
                </TableCell>
              </TableRow>
            ))}
          {!loading && items.length === 0 && (
            <TableRow>
              <TableCell colSpan={COLUMN_COUNT} sx={{ borderBottom: 0 }}>
                <DirectoryEmptyState labels={labels} hasFilters={hasFilters} onClearFilters={onClearFilters} />
              </TableCell>
            </TableRow>
          )}
          {items.map((user, index) => (
            <DirectoryUserRow
              key={user.id}
              user={user}
              labels={labels}
              locale={locale}
              striped={index % 2 === 1}
              onEdit={onEdit}
              onChangePassword={onChangePassword}
              onDelete={onDelete}
              onCopyEmail={onCopyEmail}
            />
          ))}
        </TableBody>
      </Table>
      {props.pagination}
    </Card>
  );
}

interface DirectoryHeaderCellProps {
  readonly children: ReactNode;
  readonly width?: string;
  readonly align?: "start" | "end";
}

/** Header cell — uppercase 12px / 600 / letter-spaced, `text.secondary`. */
function DirectoryHeaderCell({ children, width, align }: DirectoryHeaderCellProps): ReactNode {
  return (
    <TableCell
      sx={theme => ({
        width,
        textTransform: "uppercase",
        fontSize: 12,
        fontWeight: 600,
        letterSpacing: "0.06em",
        color: theme.palette.text.secondary,
        textAlign: align === "end" ? "end" : "start",
        borderBottom: `1px solid ${theme.palette.border.light}`,
        // Fixed-layout boundary guard: an overflowing header clips at its OWN
        // cell edge instead of painting into the neighbor's label. Column
        // widths above are sized so nothing reaches this clip in practice.
        overflow: "hidden",
        // End-aligned cells (the ACTIONS column) prevent wrapping so the
        // letter-spaced label never ellipsizes/clips, and get explicit
        // inline-end breathing room so it never kisses the card edge.
        ...(align === "end" && { whiteSpace: "nowrap", paddingInlineEnd: 3 }),
      })}
    >
      {children}
    </TableCell>
  );
}
