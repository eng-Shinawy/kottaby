"use client";

import { useQuery } from "@apollo/client/react";
import { HistoryEduOutlined as EmptyStateIcon, ErrorOutlineOutlined as ErrorStateIcon } from "@mui/icons-material";
import { Box, Button, FormControl, InputLabel, MenuItem, Select, Skeleton, Stack, Typography } from "@mui/material";
import { type ReactNode, useCallback, useMemo, useState } from "react";
import type { AdminAuditLogsQueryVariables } from "@/frontend/graphql/generated/gql/graphql";
import { adminAuditLogsQueryDocument } from "@/frontend/graphql/sharedDocuments";
import { AuditFilterBar, type AuditFilterValues } from "@/frontend/views/admin/audit/AuditFilterBar";
import { AuditTrailTable } from "@/frontend/views/admin/audit/AuditTrailTable";
import { Audit, useAppLocale, useAppTranslation } from "@/shared/locale";
import type { AuditLabels } from "@/shared/locale/types/audit";

/**
 * `AuditLogContainer` — the client-owned admin audit-trail viewer (mounted
 * by the `/audit` server shell) and the DEV3-020 Phase 1 read surface.
 *
 * Responsibilities:
 *  - DATA: `useQuery(adminAuditLogsQueryDocument, { variables })` — the
 *    server-enforced admin read (filtered + paginated trail, actor
 *    summaries embedded, newest first). The variables come from the
 *    APPLIED filter state, never the draft (a half-typed filter cannot
 *    reshape the read until the admin commits it);
 *  - COPY: `useAppTranslation(Audit)` — property access ONLY, no
 *    `t("key")` string lookups anywhere on this surface;
 *  - FILTERING: the filter bar owns a DRAFT (every keystroke); Apply
 *    sanitizes (empty → undefined, digits → ids, date bounds → UTC day
 *    envelopes) and commits — a page reset accompanies every commit (new
 *    filters start at page 1);
 *  - PAGINATION: offset stepping by the page size (server-clamped 1..100;
 *    the UI offers 10/20/50), prev/next derived from the server's `total`
 *    — never from local row counts;
 *  - STATES: skeleton rows while in flight → localized empty state →
 *    localized error state with retry → the responsive trail table.
 *
 * Server hand-off (`labels` prop): the `/audit` shell resolves
 * `getTranslations(locale).auditTranslations` server-side and passes the
 * STRING-KEYED subset (RSC props are serialized — the namespace's single
 * formatter `pageInfo` cannot cross the boundary); the full tree comes from
 * the client handle below. Precedent: the `/admin/verifications` shell ↔
 * `PaymentVerificationContainer` merge.
 *
 * MUI v9 discipline: `sx`-only styling through theme-palette tokens,
 * `*Outlined` icons, RTL-safe logical composition (grid + gap), zero
 * hardcoded user-facing strings, zero hardcoded colors.
 */

/** The rows-per-page options the pagination select offers. */
const PAGE_SIZE_OPTIONS = [10, 20, 50] as const;

/** Default rows per page. */
const DEFAULT_PAGE_SIZE = 20;

/**
 * The RSC-serializable slice of {@link AuditLabels} the server shell hands
 * down — plain strings. Three members are structurally excluded and always
 * resolve through the client handle below: the `pageInfo` formatter (it
 * cannot cross the server/client boundary) and the two details-popover keys
 * (`detailsExpandAriaLabel` / `detailsPopoverTitle` — consumed ONLY inside
 * the trail table's client-side popover, never by the server shell).
 */
export type AuditStaticLabels = Omit<AuditLabels, "pageInfo" | "detailsExpandAriaLabel" | "detailsPopoverTitle">;

export interface AuditLogContainerProps {
  /**
   * Optional server-resolved label subset (property access on
   * `auditTranslations`). When omitted — client-only mounts, tests — the
   * container resolves the FULL tree through `useAppTranslation(Audit)`.
   */
  readonly labels?: AuditStaticLabels;
}

/** The empty draft — every filter unset (""). */
const EMPTY_DRAFT: AuditFilterValues = {
  actionType: "",
  entityType: "",
  actorId: "",
  entityId: "",
  createdFrom: "",
  createdTo: "",
};

/** Positive-integer parse or undefined — the id-filter sanitizer. */
function parseIdFilter(raw: string): number | undefined {
  if (raw.length === 0) {
    return undefined;
  }
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

/** Builds the GraphQL variables for an APPLIED draft (sanitized). */
function buildVariables(filters: AuditFilterValues, limit: number, offset: number): AdminAuditLogsQueryVariables {
  // Date bounds ride the DateTime scalar as ISO-8601 STRINGS (the scalar's
  // parseValue validates + converts server-side): each bound becomes the
  // UTC day envelope [00:00:00.000, 23:59:59.999] of the picked date.
  return {
    actionType: filters.actionType === "" ? undefined : filters.actionType,
    entityType: filters.entityType === "" ? undefined : filters.entityType,
    actorId: parseIdFilter(filters.actorId),
    entityId: parseIdFilter(filters.entityId),
    createdFrom: filters.createdFrom === "" ? undefined : `${filters.createdFrom}T00:00:00.000Z`,
    createdTo: filters.createdTo === "" ? undefined : `${filters.createdTo}T23:59:59.999Z`,
    limit,
    offset,
  };
}

/** Trail-row loading skeleton — mirrors the real table's outer geometry. */
function TrailTableSkeleton({ loadingLabel }: { readonly loadingLabel: string }): ReactNode {
  return (
    <Box
      sx={theme => ({
        borderRadius: 3,
        border: "1px solid",
        borderColor: theme.palette.outlineVariant,
        bgcolor: theme.palette.surfaceContainerLow,
        p: { xs: 2.5, sm: 3 },
        display: "grid",
        gap: 2,
      })}
      aria-busy="true"
      data-testid="audit-trail-loading"
    >
      {[0, 1, 2, 3, 4].map(offset => (
        <Skeleton key={`skeleton-${offset}`} variant="rounded" height={44} />
      ))}
      <Typography
        sx={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }}
        aria-live="polite"
      >
        {loadingLabel}
      </Typography>
    </Box>
  );
}

export function AuditLogContainer({ labels }: Readonly<AuditLogContainerProps>): ReactNode {
  const translated = useAppTranslation(Audit);
  const locale = useAppLocale();

  // Server hand-off wins where provided (byte-identical copy to the server
  // shell); the client handle supplies the remaining keys — including the
  // pagination-range formatter.
  const t: AuditLabels = { ...translated, ...labels };

  // ── Filter state: draft (form) vs applied (query) ─────────────────────────
  const [draft, setDraft] = useState<AuditFilterValues>(EMPTY_DRAFT);
  const [applied, setApplied] = useState<AuditFilterValues>(EMPTY_DRAFT);
  const [pageSize, setPageSize] = useState<number>(DEFAULT_PAGE_SIZE);
  const [offset, setOffset] = useState(0);

  // Date-range sanity is judged on the DRAFT (the bar flags it live); an
  // inverted range blocks Apply.
  const dateRangeError = draft.createdFrom !== "" && draft.createdTo !== "" && draft.createdFrom > draft.createdTo;

  const variables = useMemo(() => buildVariables(applied, pageSize, offset), [applied, pageSize, offset]);
  const { data, loading, error, refetch, previousData } = useQuery(adminAuditLogsQueryDocument, { variables });

  const patchDraft = useCallback((patch: Partial<AuditFilterValues>) => {
    setDraft(previous => ({ ...previous, ...patch }));
  }, []);

  const applyFilters = useCallback(() => {
    if (dateRangeError) {
      return;
    }
    setApplied(draft);
    // New filters start at page 1 — the offset of the OLD filter set has no
    // meaning for the new result window.
    setOffset(0);
  }, [dateRangeError, draft]);

  const clearFilters = useCallback(() => {
    setDraft(EMPTY_DRAFT);
    setApplied(EMPTY_DRAFT);
    setOffset(0);
  }, []);

  const goPrev = useCallback(() => setOffset(previous => Math.max(previous - pageSize, 0)), [pageSize]);
  const goNext = useCallback(() => setOffset(previous => previous + pageSize), [pageSize]);
  const changePageSize = useCallback((size: number) => {
    setPageSize(size);
    setOffset(0);
  }, []);

  // ── State branches (error → loading → populated) ──────────────────────────
  // `previousData` keeps the last good page on the wire during a refetch —
  // the table never flashes empty between pages.
  const page = data ?? previousData;

  let surface: ReactNode;
  if (error) {
    surface = (
      <Stack
        spacing={2}
        sx={{ alignItems: "center", textAlign: "center", py: 8 }}
        role="alert"
        data-testid="audit-trail-error"
      >
        <ErrorStateIcon sx={theme => ({ fontSize: 48, color: theme.palette.error.main })} aria-hidden />
        <Typography variant="h6" component="p" sx={{ fontWeight: 700 }}>
          {t.errorStateTitle}
        </Typography>
        <Typography variant="body2" sx={theme => ({ color: theme.palette.text.secondary, maxWidth: 420 })}>
          {t.errorStateBody}
        </Typography>
        <Button variant="outlined" onClick={() => void refetch()} sx={{ borderRadius: 2 }}>
          {t.errorStateRetry}
        </Button>
      </Stack>
    );
  } else if (loading && page === undefined) {
    surface = <TrailTableSkeleton loadingLabel={t.loading} />;
  } else if (page === undefined || page.adminAuditLogs.items.length === 0) {
    surface = (
      <Stack spacing={2} sx={{ alignItems: "center", textAlign: "center", py: 8 }} data-testid="audit-trail-empty">
        {/* Decorative icon inside a tinted circular well — the shared admin
            empty-state composition (token-only colors, RTL-safe). */}
        <Box
          aria-hidden
          sx={theme => ({
            width: 88,
            height: 88,
            borderRadius: "50%",
            display: "grid",
            placeItems: "center",
            bgcolor: theme.palette.surfaceContainerHighest,
          })}
        >
          <EmptyStateIcon sx={theme => ({ fontSize: 48, color: theme.palette.text.secondary })} />
        </Box>
        <Typography variant="h6" component="p" sx={{ fontWeight: 700 }}>
          {t.emptyStateTitle}
        </Typography>
        <Typography variant="body2" sx={theme => ({ color: theme.palette.text.secondary, maxWidth: 420 })}>
          {t.emptyStateBody}
        </Typography>
      </Stack>
    );
  } else {
    surface = (
      <AuditTrailTable
        items={page.adminAuditLogs.items}
        labels={t}
        locale={locale}
        offset={page.adminAuditLogs.offset}
        limit={page.adminAuditLogs.limit}
        total={page.adminAuditLogs.total}
        onPrev={goPrev}
        onNext={goNext}
        busy={loading}
      />
    );
  }

  return (
    <Stack spacing={2.5} data-testid="audit-trail-view">
      <AuditFilterBar
        labels={t}
        values={draft}
        onChange={patchDraft}
        onApply={applyFilters}
        onClear={clearFilters}
        dateRangeError={dateRangeError}
      />
      {/* Page-size control sits OUTSIDE the table (a compact toolbar row) —
          it re-pages the read, so it belongs to the container's controls. */}
      <PageSizeSelect
        labels={t}
        value={pageSize}
        options={PAGE_SIZE_OPTIONS}
        onChange={changePageSize}
        disabled={loading}
      />
      {surface}
    </Stack>
  );
}

/** Compact rows-per-page select (the toolbar row above the table). */
function PageSizeSelect({
  labels,
  value,
  options,
  onChange,
  disabled,
}: {
  readonly labels: AuditLabels;
  readonly value: number;
  readonly options: readonly number[];
  readonly onChange: (size: number) => void;
  readonly disabled: boolean;
}): ReactNode {
  return (
    <Stack
      spacing={1}
      sx={{ flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: 1.5 }}
      data-testid="audit-page-size"
    >
      <FormControl size="small" sx={{ minWidth: 128 }}>
        <InputLabel id="audit-page-size-label">{labels.rowsPerPage}</InputLabel>
        <Select
          labelId="audit-page-size-label"
          value={value}
          label={labels.rowsPerPage}
          disabled={disabled}
          onChange={event => onChange(Number(event.target.value))}
        >
          {options.map(size => (
            <MenuItem key={size} value={size}>
              {size}
            </MenuItem>
          ))}
        </Select>
      </FormControl>
    </Stack>
  );
}
