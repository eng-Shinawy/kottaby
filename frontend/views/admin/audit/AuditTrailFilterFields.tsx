"use client";

/**
 * The audit-trail filter field grid (three-column wrap layout): actor-id / entity-id
 * number fields, free-text entity type, the
 * action-type `Select` fed by the generated `AuditActionType` values × the
 * REUSED `adminUsers.activity.action*` labels with an "all actions" empty
 * option, the native date-input from/to pair, and the ≥44px Apply / Clear
 * pair as the trailing grid cells — plus the entity-type quick-pick chip
 * row beneath the grid (the chips fill the same free-text DRAFT; queries
 * fire ONLY on the enclosing form submit). Purely controlled — every edit
 * flows up through `onDraftChange`.
 */

import { Box, Button, FormControl, InputLabel, MenuItem, Select, TextField } from "@mui/material";
import type { CSSObject } from "@mui/material/styles";
import type { ReactNode } from "react";
import { focusVisibleRingSx } from "@/frontend/components/ui/focusRing";
import type { AuditActionType } from "@/frontend/graphql/generated/gql/graphql";
import { AuditDateRangeFields } from "@/frontend/views/admin/audit/AuditDateRangeFields";
import { AuditEntityTypeQuickPick } from "@/frontend/views/admin/audit/AuditEntityTypeQuickPick";
import { ACTION_VALUES, type FilterDrafts } from "@/frontend/views/admin/audit/audit-trail-filters";
import type { AdminUsersLabels } from "@/shared/locale/types/adminUsers";

const ACTOR_ID_INPUT_ID = "audit-trail-actor-id";
const ENTITY_TYPE_INPUT_ID = "audit-trail-entity-type";
const ENTITY_ID_INPUT_ID = "audit-trail-entity-id";
const ACTION_TYPE_SELECT_ID = "audit-trail-action-type";
/** MUI wires the trigger's `aria-labelledby` ONLY from this prop — it is what gives the combobox its accessible name. */
const ACTION_TYPE_LABEL_ID = "audit-trail-action-type-label";

const GRID_SX = {
  display: "grid",
  gridTemplateColumns: { xs: "1fr", sm: "repeat(2, 1fr)", md: "repeat(3, 1fr)" },
  gap: 2,
  alignItems: "end",
} as const;

const ACTION_BUTTON_SX: CSSObject = { ...focusVisibleRingSx, minHeight: 44 };

interface AuditTrailFilterFieldsProps {
  readonly drafts: FilterDrafts;
  readonly onDraftChange: (patch: Partial<FilterDrafts>) => void;
  readonly labels: AdminUsersLabels["auditTrail"]["filters"];
  /** The full auditTrail label block — the quick-pick chips' vocabulary. */
  readonly auditTrailLabels: AdminUsersLabels["auditTrail"];
  readonly allActionsOption: string;
  readonly actionLabels: Record<AuditActionType, string>;
  readonly fieldsDisabled: boolean;
  readonly applyInFlight: boolean;
  readonly onClear: () => void;
  /** Active UI locale — localizes the browser's built-in date mask via `lang`. */
  readonly locale: string;
}

export function AuditTrailFilterFields({
  drafts,
  onDraftChange,
  labels,
  auditTrailLabels,
  allActionsOption,
  actionLabels,
  fieldsDisabled,
  applyInFlight,
  onClear,
  locale,
}: Readonly<AuditTrailFilterFieldsProps>): ReactNode {
  return (
    <Box sx={{ display: "grid", gap: 2 }}>
      <Box sx={GRID_SX}>
        <TextField
          id={ACTOR_ID_INPUT_ID}
          type="number"
          fullWidth
          label={labels.actorIdLabel}
          value={drafts.actorId}
          onChange={event => onDraftChange({ actorId: event.target.value })}
          disabled={fieldsDisabled}
          slotProps={{ htmlInput: { min: 1, step: 1 } }}
        />
        <TextField
          id={ENTITY_TYPE_INPUT_ID}
          fullWidth
          label={labels.entityTypeLabel}
          value={drafts.entityType}
          onChange={event => onDraftChange({ entityType: event.target.value })}
          disabled={fieldsDisabled}
          // The filter matches the RECORDED wire value exactly — the trail's
          // chips are localized display labels, so the hint names canonical
          // values the admin can paste into the field or a deep link.
          helperText={labels.entityTypeHint}
        />
        <TextField
          id={ENTITY_ID_INPUT_ID}
          type="number"
          fullWidth
          label={labels.entityIdLabel}
          value={drafts.entityId}
          onChange={event => onDraftChange({ entityId: event.target.value })}
          disabled={fieldsDisabled}
          slotProps={{ htmlInput: { min: 1, step: 1 } }}
        />
        <FormControl sx={{ minWidth: 150 }}>
          <InputLabel id={ACTION_TYPE_LABEL_ID}>{labels.actionTypeLabel}</InputLabel>
          <Select
            id={ACTION_TYPE_SELECT_ID}
            labelId={ACTION_TYPE_LABEL_ID}
            value={drafts.actionType}
            label={labels.actionTypeLabel}
            onChange={event => onDraftChange({ actionType: event.target.value || "" })}
            disabled={fieldsDisabled}
            sx={{ minHeight: 44 }}
          >
            <MenuItem value="">{allActionsOption}</MenuItem>
            {ACTION_VALUES.map(value => (
              <MenuItem key={value} value={value}>
                {actionLabels[value]}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
        <AuditDateRangeFields
          drafts={drafts}
          onDraftChange={onDraftChange}
          labels={{ fromDateLabel: labels.fromDateLabel, toDateLabel: labels.toDateLabel }}
          fieldsDisabled={fieldsDisabled}
          locale={locale}
        />
        <Button
          type="submit"
          variant="contained"
          disabled={applyInFlight}
          aria-busy={applyInFlight}
          sx={ACTION_BUTTON_SX}
        >
          {labels.applyAction}
        </Button>
        <Button type="button" variant="outlined" onClick={onClear} disabled={fieldsDisabled} sx={ACTION_BUTTON_SX}>
          {labels.clearAction}
        </Button>
      </Box>
      <AuditEntityTypeQuickPick
        labels={auditTrailLabels}
        caption={labels.quickPickCaption}
        value={drafts.entityType}
        onChange={nextValue => onDraftChange({ entityType: nextValue })}
        disabled={fieldsDisabled}
      />
    </Box>
  );
}
