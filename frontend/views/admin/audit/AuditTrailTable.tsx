"use client";

import {
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableFooter,
  TableHead,
  TableRow,
  Typography,
  useMediaQuery,
} from "@mui/material";
import { type Palette, useTheme } from "@mui/material/styles";
import type { ReactNode } from "react";
import type { AdminAuditLogsQuery_adminAuditLogs_items } from "@/frontend/graphql/generated/gql/graphql";
import { formatApplicantDate } from "@/frontend/lib/i18n/format-date";
import type { AuditLabels } from "@/shared/locale/types/audit";

/**
 * `AuditTrailTable` — the audit-trail viewer's data surface (DEV3-020
 * Phase 1).
 *
 * Presentational ONLY: every fact rendered comes from the canonical
 * `AdminAuditLog` rows handed in by {@link AuditLogContainer} (the Apollo
 * `adminAuditLogs` read lives in the container). Two layouts from ONE
 * payload, mirroring the plan-catalog table's dual-layout contract:
 *
 *  - `md` and up → full `Table` (timestamp, actor, action chip, entity,
 *    entity id, details) with a STICKY header and a footer-mounted
 *    pagination bar;
 *  - below `md` → card-stacked list (each entry becomes a self-contained
 *    card carrying the same facts as label/value pairs) — the RTL-first
 *    mobile experience; the default locale (`ar`) is RTL and the PRIMARY
 *    surface.
 *
 * Value-rendering contract:
 *  - timestamps pass through {@link formatApplicantDate} (the established
 *    locale-aware frontend date util — UTC, 24-hour, Arabic-Indic digits
 *    under `ar`);
 *  - action chips map the `audit_action_type` machine codes onto SEMANTIC
 *    theme families (create/reactivate → success, update → primary,
 *    adjust → warning, override → secondary, delete/suspend → error) —
 *    token-only, zero hardcoded hex, contrast preserved in light+dark;
 *  - the `details` JSON renders LTR monospace regardless of document
 *    direction (JSON is a machine artifact — bending it into RTL would
 *    scramble its punctuation), with a Tooltip carrying the full payload;
 *  - a null `details`/`entityId` renders a locale-neutral em dash
 *    (punctuation, not copy).
 *
 * MUI v9 discipline: `sx`-only styling with theme-palette tokens
 * exclusively, `*Outlined` icons, RTL-safe logical composition (flex/grid +
 * gap; no physical margins — `dir=rtl` mirrors automatically), and every
 * user-facing string resolved from the compile-time `AuditLabels` tree via
 * property access.
 */

/** Page size fixed by the container; surfaced here for the footer only. */
export interface AuditTrailTableProps {
  /** Canonical audit rows (container-owned `adminAuditLogs` payload). */
  readonly items: ReadonlyArray<AdminAuditLogsQuery_adminAuditLogs_items>;
  /** Full audit-namespace labels (property access ONLY inside). */
  readonly labels: AuditLabels;
  /** Active app locale — drives timestamp formatting via the shared util. */
  readonly locale: string;
  /** Pagination state (container-owned): zero-based row offset. */
  readonly offset: number;
  /** Rows per page (container-owned; the service clamps 1..100). */
  readonly limit: number;
  /** Grand total of rows matching the APPLIED filters (server-computed). */
  readonly total: number;
  /** Previous-page intent (disabled at offset 0 or while loading). */
  readonly onPrev: () => void;
  /** Next-page intent (disabled at the last page or while loading). */
  readonly onNext: () => void;
  /** True while the page read is in flight (buttons disable). */
  readonly busy: boolean;
}

/**
 * Maps one action code to its SEMANTIC theme family — the (background,
 * foreground) container/on-container token pair. Unknown codes (a future
 * enum value) degrade to the neutral grey pair rather than crashing.
 */
function actionChipPair(code: string, palette: Palette): { readonly background: string; readonly foreground: string } {
  const dark = palette.mode === "dark";
  switch (code) {
    // Both terminal-positive actions ride the success family.
    case "create":
    case "reactivate":
      return { background: palette.successContainer, foreground: palette.onSuccessContainer };
    case "update":
      return { background: palette.primaryContainer, foreground: palette.onPrimaryContainer };
    case "adjust":
      return { background: palette.warningContainer, foreground: palette.onWarningContainer };
    case "override":
      return { background: palette.secondaryContainer, foreground: palette.onSecondaryContainer };
    case "delete":
    case "suspend":
      return { background: palette.errorContainer, foreground: palette.onErrorContainer };
    default:
      return dark
        ? { background: palette.grey[800], foreground: palette.grey[200] }
        : { background: palette.grey[200], foreground: palette.grey[900] };
  }
}

/**
 * System monospace stack for the details JSON (no theme mono token exists).
 */
const MONO_FONT_STACK = 'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace';

/** Localized display name for an action code (unknown codes show raw). */
function actionDisplay(code: string, labels: AuditLabels): string {
  switch (code) {
    case "create":
      return labels.actionCreate;
    case "update":
      return labels.actionUpdate;
    case "delete":
      return labels.actionDelete;
    case "override":
      return labels.actionOverride;
    case "adjust":
      return labels.actionAdjust;
    case "suspend":
      return labels.actionSuspend;
    case "reactivate":
      return labels.actionReactivate;
    default:
      return code;
  }
}

/** Localized display name for an entity family (unknown codes show raw). */
function entityDisplay(code: string, labels: AuditLabels): string {
  switch (code) {
    case "plans":
      return labels.entityPlans;
    case "subscriptions":
      return labels.entitySubscriptions;
    default:
      return `${labels.entityOther} · ${code}`;
  }
}

/** Action chip — the semantic family mapping above, icon-free for density. */
function ActionChip({ code, labels }: { readonly code: string; readonly labels: AuditLabels }): ReactNode {
  return (
    <Chip
      size="small"
      label={actionDisplay(code, labels)}
      sx={theme => {
        const pair = actionChipPair(code, theme.palette);
        return { fontWeight: 600, bgcolor: pair.background, color: pair.foreground };
      }}
    />
  );
}

/** Locale-aware UTC timestamp — the trail's forensic anchor. */
function TimestampText({ iso, locale }: { readonly iso: string; readonly locale: string }): ReactNode {
  return (
    <Typography
      variant="body2"
      component="time"
      dateTime={iso}
      sx={theme => ({ color: theme.palette.text.secondary, whiteSpace: "nowrap" })}
    >
      {formatApplicantDate(iso, locale)}
    </Typography>
  );
}

/** Actor cell — name prominent, email secondary beneath (never a bare id). */
function ActorCell({
  actor,
  dense = false,
}: {
  readonly actor: AdminAuditLogsQuery_adminAuditLogs_items["actor"];
  readonly dense?: boolean;
}): ReactNode {
  return (
    <Stack spacing={0.25}>
      <Typography variant={dense ? "body2" : "body1"} sx={{ fontWeight: 600, lineHeight: 1.3 }}>
        {actor.fullName}
      </Typography>
      <Typography
        variant="caption"
        dir="ltr"
        sx={theme => ({ color: theme.palette.text.secondary, textAlign: "start" })}
      >
        {actor.email}
      </Typography>
    </Stack>
  );
}

/** LTR monospace details JSON (or a neutral dash) — machine artifact styling. */
function DetailsCell({
  details,
  labels,
}: {
  readonly details: string | null;
  readonly labels: AuditLabels;
}): ReactNode {
  if (details === null) {
    return (
      <Typography variant="body2" sx={theme => ({ color: theme.palette.text.secondary })}>
        {labels.detailsEmpty}
      </Typography>
    );
  }
  return (
    <Typography
      variant="caption"
      dir="ltr"
      component="code"
      sx={theme => ({
        fontFamily: MONO_FONT_STACK,
        bgcolor: theme.palette.surfaceContainerHighest,
        borderRadius: 1,
        px: 0.75,
        py: 0.25,
        display: "inline-block",
        maxWidth: 320,
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
        verticalAlign: "middle",
      })}
    >
      {details}
    </Typography>
  );
}

export function AuditTrailTable({
  items,
  labels,
  locale,
  offset,
  limit,
  total,
  onPrev,
  onNext,
  busy,
}: Readonly<AuditTrailTableProps>): ReactNode {
  const theme = useTheme();
  // `md`+ gets the table; below it the card stack. Mirrors the
  // DashboardLayout `useMediaQuery` convention: the server render emits the
  // mobile-first branch, the client re-renders once the viewport is known —
  // no hydration mismatch (same contract as the plan-catalog table).
  const isDesktop = useMediaQuery(theme.breakpoints.up("md"));

  // Pagination arithmetic — the truthful 1-based window into `total`.
  const from = total === 0 ? 0 : offset + 1;
  const to = Math.min(offset + limit, total);
  const hasPrev = offset > 0;
  const hasNext = offset + limit < total;

  const paginationBar = (
    <Stack
      spacing={1}
      sx={{ flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: 1.5, flexWrap: "wrap" }}
      data-testid="audit-pagination"
    >
      <Typography variant="body2" sx={theme => ({ color: theme.palette.text.secondary })} aria-live="polite">
        {labels.pageInfo(from, to, total)}
      </Typography>
      <TablePaginationButton label={labels.paginationPrev} disabled={!hasPrev || busy} onClick={onPrev} />
      <TablePaginationButton label={labels.paginationNext} disabled={!hasNext || busy} onClick={onNext} />
    </Stack>
  );

  if (!isDesktop) {
    return (
      <Stack spacing={2} data-testid="audit-trail-cards">
        <Box sx={{ display: "grid", gap: 2 }}>
          {items.map(entry => (
            <Card
              key={entry.id}
              elevation={0}
              sx={theme => ({
                borderRadius: 3,
                border: "1px solid",
                borderColor: theme.palette.outlineVariant,
                bgcolor: theme.palette.surfaceContainerLow,
                boxShadow: theme.palette.shadow.card,
              })}
            >
              <CardContent sx={{ display: "grid", gap: 1.25, p: { xs: 2.5, sm: 3 } }}>
                <Stack
                  spacing={1}
                  sx={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 1 }}
                >
                  <TimestampText iso={entry.createdAt} locale={locale} />
                  <ActionChip code={entry.actionType} labels={labels} />
                </Stack>
                <ActorCell actor={entry.actor} dense />
                <MobileSpecRow label={labels.colEntity} value={entityDisplay(entry.entityType, labels)} />
                <MobileSpecRow
                  label={labels.colEntityId}
                  value={entry.entityId === null ? labels.detailsEmpty : entry.entityId}
                />
                <MobileSpecRow
                  label={labels.colDetails}
                  value={entry.details ?? labels.detailsEmpty}
                  monospace={entry.details !== null}
                />
              </CardContent>
            </Card>
          ))}
        </Box>
        {paginationBar}
      </Stack>
    );
  }

  return (
    <TableContainer
      component={Paper}
      elevation={0}
      data-testid="audit-trail-table"
      sx={theme => ({
        borderRadius: 3,
        border: "1px solid",
        borderColor: theme.palette.outlineVariant,
        bgcolor: theme.palette.surfaceContainerLow,
        boxShadow: theme.palette.shadow.card,
      })}
    >
      <Table
        size="medium"
        aria-label={labels.tableSummary}
        sx={{
          // Compact horizontal rhythm — the six-column trail fits a 1280px
          // viewport without the last column spilling into a heavy scroll
          // (QA-round-2 catalog lesson carried over); narrower viewports
          // still scroll gracefully through the TableContainer.
          "& th, & td": { px: 1.5 },
        }}
      >
        <TableHead
          sx={theme => ({
            // Sticky header — the trail stays readable while scrolling;
            // background must be OPAQUE (rows slide beneath otherwise).
            position: "sticky",
            top: 0,
            zIndex: 1,
            bgcolor: theme.palette.surfaceContainerLow,
          })}
        >
          <TableRow>
            <TableCell scope="col" sx={theme => ({ color: theme.palette.text.secondary, fontWeight: 700 })}>
              {labels.colTimestamp}
            </TableCell>
            <TableCell scope="col" sx={theme => ({ color: theme.palette.text.secondary, fontWeight: 700 })}>
              {labels.colActor}
            </TableCell>
            <TableCell scope="col" sx={theme => ({ color: theme.palette.text.secondary, fontWeight: 700 })}>
              {labels.colAction}
            </TableCell>
            <TableCell scope="col" sx={theme => ({ color: theme.palette.text.secondary, fontWeight: 700 })}>
              {labels.colEntity}
            </TableCell>
            <TableCell scope="col" sx={theme => ({ color: theme.palette.text.secondary, fontWeight: 700 })}>
              {labels.colDetails}
            </TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {items.map(entry => (
            <TableRow key={entry.id} hover sx={{ "&:last-child td": { borderBottom: 0 } }}>
              <TableCell>
                <TimestampText iso={entry.createdAt} locale={locale} />
              </TableCell>
              <TableCell>
                <ActorCell actor={entry.actor} />
              </TableCell>
              <TableCell>
                <ActionChip code={entry.actionType} labels={labels} />
              </TableCell>
              <TableCell>
                <Stack spacing={0.25}>
                  <Typography variant="body1" sx={{ fontWeight: 600, whiteSpace: "nowrap" }}>
                    {entityDisplay(entry.entityType, labels)}
                  </Typography>
                  {entry.entityId === null ? null : (
                    <Typography
                      variant="caption"
                      sx={theme => ({ color: theme.palette.text.secondary })}
                    >{`${labels.colEntityId}: ${entry.entityId}`}</Typography>
                  )}
                </Stack>
              </TableCell>
              <TableCell>
                <DetailsCell details={entry.details} labels={labels} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
        <TableFooter>
          <TableRow>
            <TableCell colSpan={5} sx={{ borderBottom: 0, pt: 2 }}>
              {paginationBar}
            </TableCell>
          </TableRow>
        </TableFooter>
      </Table>
    </TableContainer>
  );
}

/** One icon-less text pagination button (shared by both layouts). */
function TablePaginationButton({
  label,
  disabled,
  onClick,
}: {
  readonly label: string;
  readonly disabled: boolean;
  readonly onClick: () => void;
}): ReactNode {
  return (
    <Button size="small" variant="outlined" disabled={disabled} onClick={onClick} sx={{ borderRadius: 2 }}>
      {label}
    </Button>
  );
}

/** Label/value pair mirroring a table column inside a mobile card. */
function MobileSpecRow({
  label,
  value,
  monospace = false,
}: {
  readonly label: string;
  readonly value: string | number;
  readonly monospace?: boolean;
}): ReactNode {
  return (
    <Box sx={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 2 }}>
      <Typography variant="body2" sx={theme => ({ color: theme.palette.text.secondary })}>
        {label}
      </Typography>
      {monospace ? (
        <Typography
          variant="body2"
          component="code"
          dir="ltr"
          sx={theme => ({
            fontWeight: 400,
            textAlign: "end",
            fontFamily: MONO_FONT_STACK,
            bgcolor: theme.palette.surfaceContainerHighest,
            borderRadius: 1,
            px: 0.75,
            py: 0.25,
          })}
        >
          {value}
        </Typography>
      ) : (
        <Typography variant="body2" sx={{ fontWeight: 600, textAlign: "end" }}>
          {value}
        </Typography>
      )}
    </Box>
  );
}
