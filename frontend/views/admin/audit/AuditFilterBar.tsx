"use client";

import { RefreshOutlined as ClearFiltersIcon, FilterListOutlined as FiltersIcon } from "@mui/icons-material";
import {
  Box,
  Button,
  Card,
  CardContent,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import type { ReactNode } from "react";
import type { AuditLabels } from "@/shared/locale/types/audit";

/**
 * `AuditFilterBar` — the audit-trail viewer's filter form (DEV3-020 Phase 1).
 *
 * Presentational + controlled: the container owns the DRAFT state (every
 * keystroke lands here) while the QUERY runs against the APPLIED state
 * (committed on submit) — a half-typed filter can never silently reshape
 * the server read. `onApply` receives the sanitized draft; date-range
 * sanity (from ≤ to) is enforced BEFORE submission and surfaced inline.
 *
 * Value contract:
 *  - Action/entity selects carry "" for the ALL option — the container
 *    strips empties before building the GraphQL variables (an absent
 *    filter arg is `undefined`, never an empty string on the wire);
 *  - Actor/entity id inputs accept only positive integers (any other input
 *    leaves the draft value as the raw string and the container strips it);
 *  - Date bounds are native `type="date"` inputs (keyboard-accessible,
 *    locale-native calendar UI, zero extra dependencies).
 *
 * MUI v9 discipline: `sx`-only styling through theme-palette tokens,
 * `*Outlined` icons, RTL-safe logical composition (grid + gap), zero
 * hardcoded user-facing strings, zero hardcoded colors.
 */

/** The sanitized filter draft the container builds GraphQL variables from. */
export interface AuditFilterValues {
  /** "" = all action types. */
  readonly actionType: string;
  /** "" = all entity types. */
  readonly entityType: string;
  /** Raw actor-id input (digits only; "" = unset). */
  readonly actorId: string;
  /** Raw entity-id input (digits only; "" = unset). */
  readonly entityId: string;
  /** ISO date (yyyy-mm-dd) lower bound; "" = unset. */
  readonly createdFrom: string;
  /** ISO date (yyyy-mm-dd) upper bound; "" = unset. */
  readonly createdTo: string;
}

/** The canonical machine values the action/entity selects offer. */
export const AUDIT_ACTION_TYPE_VALUES = [
  "create",
  "update",
  "delete",
  "override",
  "adjust",
  "suspend",
  "reactivate",
] as const;

export const AUDIT_ENTITY_TYPE_VALUES = ["plans", "subscriptions"] as const;

export interface AuditFilterBarProps {
  /** Full audit-namespace labels (property access ONLY inside). */
  readonly labels: AuditLabels;
  /** The controlled draft (container-owned). */
  readonly values: AuditFilterValues;
  /** Draft mutation — one merged patch per edit. */
  readonly onChange: (patch: Partial<AuditFilterValues>) => void;
  /** Submit intent — the container sanitizes + commits to the query. */
  readonly onApply: () => void;
  /** Reset intent — the container clears the draft AND the applied state. */
  readonly onClear: () => void;
  /** Whether the date-range validation currently fails (inline error). */
  readonly dateRangeError: boolean;
}

export function AuditFilterBar({
  labels,
  values,
  onChange,
  onApply,
  onClear,
  dateRangeError,
}: Readonly<AuditFilterBarProps>): ReactNode {
  const actionLabel = (value: string): string => {
    switch (value) {
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
        return labels.filterActionAll;
    }
  };

  const entityLabel = (value: string): string => {
    switch (value) {
      case "plans":
        return labels.entityPlans;
      case "subscriptions":
        return labels.entitySubscriptions;
      default:
        return labels.filterEntityAll;
    }
  };

  return (
    <Card
      elevation={0}
      component="section"
      aria-label={labels.applyFilters}
      data-testid="audit-filter-bar"
      sx={theme => ({
        borderRadius: 3,
        border: "1px solid",
        borderColor: theme.palette.outlineVariant,
        bgcolor: theme.palette.surfaceContainerLow,
        boxShadow: theme.palette.shadow.card,
      })}
    >
      <CardContent sx={{ display: "grid", gap: 2, p: { xs: 2, sm: 2.5 } }}>
        <Stack spacing={0.75} sx={{ flexDirection: "row", alignItems: "center", gap: 1 }}>
          <FiltersIcon fontSize="small" sx={theme => ({ color: theme.palette.text.secondary })} aria-hidden />
          <Typography variant="subtitle2" sx={theme => ({ color: theme.palette.text.secondary, fontWeight: 700 })}>
            {labels.applyFilters}
          </Typography>
        </Stack>

        <Box
          sx={{
            display: "grid",
            gridTemplateColumns: { xs: "1fr 1fr", md: "repeat(3, 1fr)" },
            gap: 1.5,
          }}
        >
          {/* Action-type select */}
          <FormControl size="small" sx={{ gridColumn: { xs: "span 2", md: "span 1" } }}>
            <InputLabel id="audit-filter-action-label" shrink>
              {labels.labelActionType}
            </InputLabel>
            <Select
              labelId="audit-filter-action-label"
              value={values.actionType}
              label={labels.labelActionType}
              onChange={event => onChange({ actionType: event.target.value })}
            >
              <MenuItem value="">{labels.filterActionAll}</MenuItem>
              {AUDIT_ACTION_TYPE_VALUES.map(value => (
                <MenuItem key={value} value={value}>
                  {actionLabel(value)}
                </MenuItem>
              ))}
            </Select>
          </FormControl>

          {/* Entity-type select */}
          <FormControl size="small" sx={{ gridColumn: { xs: "span 2", md: "span 1" } }}>
            <InputLabel id="audit-filter-entity-label" shrink>
              {labels.labelEntityType}
            </InputLabel>
            <Select
              labelId="audit-filter-entity-label"
              value={values.entityType}
              label={labels.labelEntityType}
              onChange={event => onChange({ entityType: event.target.value })}
            >
              <MenuItem value="">{labels.filterEntityAll}</MenuItem>
              {AUDIT_ENTITY_TYPE_VALUES.map(value => (
                <MenuItem key={value} value={value}>
                  {entityLabel(value)}
                </MenuItem>
              ))}
            </Select>
          </FormControl>

          {/* Actor id — digits only (inputMode hints the mobile keypad). */}
          <TextField
            size="small"
            label={labels.labelActorId}
            inputMode="numeric"
            value={values.actorId}
            onChange={event => onChange({ actorId: event.target.value.replace(/[^\d]/g, "") })}
            sx={{ gridColumn: { xs: "span 1", md: "span 1" } }}
          />
          <TextField
            size="small"
            label={labels.labelEntityId}
            inputMode="numeric"
            value={values.entityId}
            onChange={event => onChange({ entityId: event.target.value.replace(/[^\d]/g, "") })}
            sx={{ gridColumn: { xs: "span 1", md: "span 1" } }}
          />

          {/* Date range — native date inputs; the container converts each
              bound to a UTC day envelope before the query. */}
          <TextField
            size="small"
            type="date"
            label={labels.labelDateFrom}
            value={values.createdFrom}
            onChange={event => onChange({ createdFrom: event.target.value })}
            error={dateRangeError}
            slotProps={{ inputLabel: { shrink: true } }}
            sx={{ gridColumn: { xs: "span 1", md: "span 1" } }}
          />
          <TextField
            size="small"
            type="date"
            label={labels.labelDateTo}
            value={values.createdTo}
            onChange={event => onChange({ createdTo: event.target.value })}
            error={dateRangeError}
            helperText={dateRangeError ? labels.invalidDateRange : undefined}
            slotProps={{ inputLabel: { shrink: true } }}
            sx={{ gridColumn: { xs: "span 1", md: "span 1" } }}
          />
        </Box>

        <Stack spacing={1} sx={{ flexDirection: "row", justifyContent: "flex-end", gap: 1 }}>
          <Button
            variant="text"
            startIcon={<ClearFiltersIcon />}
            onClick={onClear}
            sx={{ borderRadius: 2 }}
            data-testid="audit-filters-clear"
          >
            {labels.clearFilters}
          </Button>
          <Button variant="contained" onClick={onApply} sx={{ borderRadius: 2 }} data-testid="audit-filters-apply">
            {labels.applyFilters}
          </Button>
        </Stack>
      </CardContent>
    </Card>
  );
}
