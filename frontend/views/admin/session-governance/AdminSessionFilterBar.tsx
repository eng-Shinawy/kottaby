"use client";

import { TextField } from "@mui/material";
import type { ReactNode } from "react";
import { FilterActionsRow } from "@/frontend/views/admin/directory-shared/FilterActionsRow";
import { FilterSectionShell } from "@/frontend/views/admin/directory-shared/FilterSectionShell";
import { AdminSessionFilterFields } from "@/frontend/views/admin/session-governance/AdminSessionFilterFields";
import type { DirectoryFilterDraft } from "@/frontend/views/admin/session-governance/AdminSessionGovernanceContainer";
import { AdminSessionGovernance, useAppTranslation } from "@/shared/locale";
import type { SessionsLabels } from "@/shared/locale/types/sessions";

/**
 * AdminSessionFilterBar — the directory filter bar of the admin session
 * governance surface (`/admin/session-governance`): the section
 * shell over the teacher/student user-id inputs (whole numbers only; the
 * wire members are `Int`), the {@link AdminSessionFilterFields} selects +
 * creation window, and the APPLY/RESET action row. APPLY validates the
 * draft and commits; RESET restores the unfiltered directory. Draft/apply
 * orchestration lives in the container — this bar is a pure affordance.
 */

interface AdminSessionFilterBarProps {
  readonly filterDraft: DirectoryFilterDraft;
  /** True when the last APPLY carried a non-whole-number TEACHER id token. */
  readonly filterInvalidTeacherId: boolean;
  /** True when the last APPLY carried a non-whole-number STUDENT id token. */
  readonly filterInvalidStudentId: boolean;
  /** Localized invalid-id message for the offending id field. */
  readonly filterInvalidMessage: string;
  /** Draft edit intent (the container owns validation + commit). */
  readonly onFilterDraftChange: (patch: Partial<DirectoryFilterDraft>) => void;
  readonly onApplyFilters: () => void;
  readonly onResetFilters: () => void;
  /** Shared sessions-namespace labels (status select vocabulary). */
  readonly statusLabels: SessionsLabels;
}

/** The filter section: id inputs + selects/dates + apply/reset actions. */
export function AdminSessionFilterBar({
  filterDraft,
  filterInvalidTeacherId,
  filterInvalidStudentId,
  filterInvalidMessage,
  onFilterDraftChange,
  onApplyFilters,
  onResetFilters,
  statusLabels,
}: Readonly<AdminSessionFilterBarProps>): ReactNode {
  const t = useAppTranslation(AdminSessionGovernance);

  return (
    <FilterSectionShell
      testId="admin-session-governance-filters"
      ariaLabel={t.filterBarLabel}
      title={t.filterBarLabel}
      gridTemplateColumns={{ xs: "1fr", sm: "repeat(2, 1fr)", md: "repeat(3, 1fr)" }}
    >
      <TextField
        label={t.filterTeacherIdLabel}
        value={filterDraft.teacherUserId}
        onChange={event => onFilterDraftChange({ teacherUserId: event.target.value })}
        error={filterInvalidTeacherId}
        helperText={filterInvalidTeacherId ? filterInvalidMessage : undefined}
        aria-invalid={filterInvalidTeacherId}
        inputMode="numeric"
        data-testid="admin-session-governance-filter-teacher-id"
        slotProps={{ htmlInput: { inputMode: "numeric", autoComplete: "off" } }}
      />
      <TextField
        label={t.filterStudentIdLabel}
        value={filterDraft.studentUserId}
        onChange={event => onFilterDraftChange({ studentUserId: event.target.value })}
        error={filterInvalidStudentId}
        helperText={filterInvalidStudentId ? filterInvalidMessage : undefined}
        aria-invalid={filterInvalidStudentId}
        inputMode="numeric"
        data-testid="admin-session-governance-filter-student-id"
        slotProps={{ htmlInput: { inputMode: "numeric", autoComplete: "off" } }}
      />

      <AdminSessionFilterFields
        filterDraft={filterDraft}
        onFilterDraftChange={onFilterDraftChange}
        statusLabels={statusLabels}
      />

      <FilterActionsRow
        onReset={onResetFilters}
        resetTestId="admin-session-governance-filters-reset"
        resetLabel={t.filterReset}
        onApply={onApplyFilters}
        applyTestId="admin-session-governance-filters-apply"
        applyLabel={t.filterApply}
      />
    </FilterSectionShell>
  );
}
