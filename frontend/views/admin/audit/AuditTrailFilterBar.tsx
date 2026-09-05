"use client";

/**
 * The audit-trail filter bar — a real `<form>` whose submit handler narrows
 * the query (NEVER per-field `onChange` queries; `React.SubmitEvent`
 * discipline). Owns the DRAFT state internally (seeded from the sanitized
 * deep-link `initialFilters`) and lifts only the settled outcomes: `onApply`
 * receives the applied-filter record built from the drafts, `onClear` resets
 * drafts AND the applied record. All queries ride the enclosing form submit.
 */

import { Box } from "@mui/material";
import { type ReactNode, useState } from "react";
import type { AuditActionType } from "@/frontend/graphql/generated/gql/graphql";
import { AuditTrailFilterFields } from "@/frontend/views/admin/audit/AuditTrailFilterFields";
import {
  type AppliedAuditTrailFilters,
  type AuditTrailFiltersSeed,
  appliedFiltersFromDrafts,
  draftsFromSubmitInput,
  type FilterDrafts,
} from "@/frontend/views/admin/audit/audit-trail-filters";
import type { AdminUsersLabels } from "@/shared/locale/types/adminUsers";

const EMPTY_DRAFTS: FilterDrafts = {
  actionType: "",
  actorId: "",
  entityType: "",
  entityId: "",
  from: "",
  to: "",
};

interface AuditTrailFilterBarProps {
  /** Sanitized deep-link seed — pre-fills the drafts on first mount. */
  readonly initialFilters: AuditTrailFiltersSeed | undefined;
  readonly labels: AdminUsersLabels["auditTrail"]["filters"];
  readonly allActionsOption: string;
  readonly actionLabels: Record<AuditActionType, string>;
  /** Drafts and the bar stay interactive only while no data has settled. */
  readonly fieldsDisabled: boolean;
  /** Apply is in flight — button disables + announces via `aria-busy`. */
  readonly applyInFlight: boolean;
  /** Active UI locale — threaded to the date inputs' `lang`. */
  readonly locale: string;
  readonly onApply: (applied: AppliedAuditTrailFilters) => void;
  readonly onClear: () => void;
}

export function AuditTrailFilterBar({
  initialFilters,
  labels,
  allActionsOption,
  actionLabels,
  fieldsDisabled,
  applyInFlight,
  locale,
  onApply,
  onClear,
}: Readonly<AuditTrailFilterBarProps>): ReactNode {
  const [drafts, setDrafts] = useState<FilterDrafts>(() => draftsFromSubmitInput(initialFilters));

  const handleDraftChange = (patch: Partial<FilterDrafts>): void => {
    setDrafts(current => ({ ...current, ...patch }));
  };

  const handleSubmit = (event: React.SubmitEvent<HTMLFormElement>): void => {
    event.preventDefault();
    onApply(appliedFiltersFromDrafts(drafts));
  };

  const handleClear = (): void => {
    setDrafts(EMPTY_DRAFTS);
    onClear();
  };

  return (
    <Box component="form" onSubmit={handleSubmit} noValidate>
      <AuditTrailFilterFields
        drafts={drafts}
        onDraftChange={handleDraftChange}
        labels={labels}
        allActionsOption={allActionsOption}
        actionLabels={actionLabels}
        fieldsDisabled={fieldsDisabled}
        applyInFlight={applyInFlight}
        onClear={handleClear}
        locale={locale}
      />
    </Box>
  );
}
