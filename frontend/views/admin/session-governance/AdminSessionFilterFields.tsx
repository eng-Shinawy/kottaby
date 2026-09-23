"use client";

import { FormControl, InputLabel, MenuItem, Select, TextField } from "@mui/material";
import { type ReactNode, useId } from "react";
import { SessionStatus, SessionType } from "@/frontend/graphql/generated/gql/graphql";
import type { DirectoryFilterDraft } from "@/frontend/views/admin/session-governance/AdminSessionGovernanceContainer";
import { STATUS_LABEL_KEY } from "@/frontend/views/student/sessions/sessionRowPresentation";
import { AdminSessionGovernance, useAppTranslation } from "@/shared/locale";
import type { AdminSessionGovernanceLabels } from "@/shared/locale/types/adminSessionGovernance";
import type { SessionsLabels } from "@/shared/locale/types/sessions";

/**
 * AdminSessionFilterFields — the value fields of the governance directory
 * filter bar (`/admin/session-governance`): the session-type and
 * session-status selects (token space: an explicit "all" token clears the
 * filter — no enum comparisons) and the half-open creation window (`date`
 * inputs committed as inclusive from-midnight / EXCLUSIVE to-midnight UTC
 * instants). Draft/apply orchestration lives in the container — these
 * fields are a pure affordance.
 */

/** Token that clears a select filter (renders the "all" copy). */
const ALL_TOKEN = "all";

/** Explicit type options — value-driven array, never enum comparisons. */
const TYPE_OPTIONS: readonly {
  readonly value: SessionType;
  readonly labelKey: keyof Pick<
    AdminSessionGovernanceLabels,
    "typeStudentSession" | "typeTeacherEvaluation" | "typeReEvaluation"
  >;
}[] = [
  { value: SessionType.StudentSession, labelKey: "typeStudentSession" },
  { value: SessionType.TeacherEvaluation, labelKey: "typeTeacherEvaluation" },
  { value: SessionType.ReEvaluation, labelKey: "typeReEvaluation" },
];

/** Explicit status options — reuse the shared status label-key table. */
const STATUS_OPTIONS: readonly { readonly value: SessionStatus }[] = [
  { value: SessionStatus.Scheduled },
  { value: SessionStatus.Started },
  { value: SessionStatus.Completed },
  { value: SessionStatus.Cancelled },
  { value: SessionStatus.Disputed },
];

interface AdminSessionFilterFieldsProps {
  /** Draft edit intent (the container owns validation + commit). */
  readonly filterDraft: DirectoryFilterDraft;
  readonly onFilterDraftChange: (patch: Partial<DirectoryFilterDraft>) => void;
  /** Shared sessions-namespace labels (status select vocabulary). */
  readonly statusLabels: SessionsLabels;
}

/** The type/status selects + the half-open creation-window date pair. */
export function AdminSessionFilterFields({
  filterDraft,
  onFilterDraftChange,
  statusLabels,
}: Readonly<AdminSessionFilterFieldsProps>): ReactNode {
  const t = useAppTranslation(AdminSessionGovernance);
  const typeSelectId = useId();
  const statusSelectId = useId();

  return (
    <>
      <FormControl>
        <InputLabel id={typeSelectId}>{t.filterTypeLabel}</InputLabel>
        <Select
          labelId={typeSelectId}
          label={t.filterTypeLabel}
          value={filterDraft.type ?? ALL_TOKEN}
          onChange={event => {
            const token = event.target.value;
            const match = TYPE_OPTIONS.find(option => option.value === token);
            onFilterDraftChange({ type: token === ALL_TOKEN || match === undefined ? null : match.value });
          }}
          data-testid="admin-session-governance-filter-type"
        >
          <MenuItem value={ALL_TOKEN}>{t.filterTypeAll}</MenuItem>
          {TYPE_OPTIONS.map(option => (
            <MenuItem key={option.value} value={option.value}>
              {t[option.labelKey]}
            </MenuItem>
          ))}
        </Select>
      </FormControl>

      <FormControl>
        <InputLabel id={statusSelectId}>{t.filterStatusLabel}</InputLabel>
        <Select
          labelId={statusSelectId}
          label={t.filterStatusLabel}
          value={filterDraft.status ?? ALL_TOKEN}
          onChange={event => {
            const token = event.target.value;
            const match = STATUS_OPTIONS.find(option => option.value === token);
            onFilterDraftChange({ status: token === ALL_TOKEN || match === undefined ? null : match.value });
          }}
          data-testid="admin-session-governance-filter-status"
        >
          <MenuItem value={ALL_TOKEN}>{t.filterStatusAll}</MenuItem>
          {STATUS_OPTIONS.map(option => (
            <MenuItem key={option.value} value={option.value}>
              {statusLabels[STATUS_LABEL_KEY[option.value] ?? "statusDisputed"]}
            </MenuItem>
          ))}
        </Select>
      </FormControl>

      <TextField
        label={t.filterDateFromLabel}
        type="date"
        value={filterDraft.dateFrom ?? ""}
        onChange={event => onFilterDraftChange({ dateFrom: event.target.value === "" ? null : event.target.value })}
        data-testid="admin-session-governance-filter-date-from"
        slotProps={{
          htmlInput: { autoComplete: "off" },
          // Native date inputs always paint their segments — an un-shrunk
          // label would overlap them (and Chrome's picker indicator).
          inputLabel: { shrink: true },
        }}
      />
      <TextField
        label={t.filterDateToLabel}
        type="date"
        value={filterDraft.dateTo ?? ""}
        onChange={event => onFilterDraftChange({ dateTo: event.target.value === "" ? null : event.target.value })}
        data-testid="admin-session-governance-filter-date-to"
        slotProps={{
          htmlInput: { autoComplete: "off" },
          inputLabel: { shrink: true },
        }}
      />
    </>
  );
}
