"use client";

import { Box, FormControl, InputLabel, MenuItem, Select, TextField } from "@mui/material";
import type { ReactNode } from "react";
import { focusVisibleRingSx } from "@/frontend/components/ui/focusRing";
import {
  AUDIENCE_KINDS,
  audienceKindLabel,
  isAudienceKind,
} from "@/frontend/views/admin/broadcasts/broadcast-compose.helpers";
import { MENU_ITEM_SX } from "@/frontend/views/admin/broadcasts/broadcast-compose-skin";
import {
  BROADCAST_STATUS_OPTIONS,
  type BroadcastHistoryFilterDraft,
  broadcastStatusLabelKey,
  EMPTY_HISTORY_FILTER_DRAFT,
  isBroadcastStatusValue,
} from "@/frontend/views/admin/broadcasts/broadcast-history.helpers";
import { FilterActionsRow } from "@/frontend/views/admin/directory-shared/FilterActionsRow";
import { useAppTranslation } from "@/shared/locale/client";
import { AdminBroadcasts } from "@/shared/locale/namespaces/adminBroadcasts";

/**
 * BroadcastHistoryFilterBar — the history directory's filter affordance:
 * the title-search field (a DRAFT — typing never re-keys the query; the
 * form commits on submit) beside the status and audience-kind selects,
 * which commit INSTANTLY through the same `applyFilters(patch)` seam (a
 * select change and its commit share one render — never a stale-draft
 * race), plus the shared APPLY/RESET action row: APPLY submits the form
 * (committing the draft search), RESET re-keys both the draft and the
 * applied filters back to the unfiltered listing through one
 * `applyFilters(EMPTY_HISTORY_FILTER_DRAFT)` commit. Draft/apply
 * orchestration lives in the data hook — this bar is a pure affordance
 * over the shared filter vocabulary.
 *
 * The empty select value is the unfiltered arm ("All") — it falls out of
 * the value guards, never a hand-rolled null check. MUI v9 discipline:
 * `sx`-only styling, colors exclusively through `theme.palette.*`.
 */

interface BroadcastHistoryFilterBarProps {
  /** The active filter draft (search token + select values). */
  readonly filterDraft: BroadcastHistoryFilterDraft;
  /** Search-draft edit intent (typing only — selects use the apply seam). */
  readonly onFilterDraftChange: (patch: Partial<BroadcastHistoryFilterDraft>) => void;
  /** Filter-commit intent — the selects carry their patch; the form submit commits the draft. */
  readonly onApplyFilters: (patch?: Partial<BroadcastHistoryFilterDraft>) => void;
}

/** The unfiltered select option's sentinel (never an enum member). */
const ALL_FILTER_VALUE = "";

const STATUS_SELECT_LABEL_ID = "broadcast-history-status-label";
const AUDIENCE_SELECT_LABEL_ID = "broadcast-history-audience-label";

/** The filter row: search draft + instant-commit status/audience selects. */
export function BroadcastHistoryFilterBar({
  filterDraft,
  onFilterDraftChange,
  onApplyFilters,
}: Readonly<BroadcastHistoryFilterBarProps>): ReactNode {
  const t = useAppTranslation(AdminBroadcasts);

  const handleSubmit = (event: React.SubmitEvent<HTMLFormElement>): void => {
    event.preventDefault();
    onApplyFilters();
  };

  return (
    <Box
      component="form"
      noValidate
      onSubmit={handleSubmit}
      data-testid="admin-broadcasts-history-filters"
      sx={theme => ({
        display: "flex",
        flexDirection: "row",
        flexWrap: "wrap",
        alignItems: "flex-end",
        gap: 1.5,
        p: { xs: 2, sm: 2.5 },
        borderRadius: 3,
        border: "1px solid",
        borderColor: theme.palette.outlineVariant,
        bgcolor: theme.palette.surfaceContainerLow,
      })}
    >
      <TextField
        type="search"
        label={t.filterSearchLabel}
        value={filterDraft.titleSearch}
        onChange={event => onFilterDraftChange({ titleSearch: event.target.value })}
        slotProps={{ htmlInput: { inputMode: "search", autoComplete: "off" } }}
        sx={theme => ({
          flex: { xs: "1 1 100%", sm: "1 1 240px" },
          bgcolor: theme.palette.surfaceContainer,
          ...focusVisibleRingSx,
        })}
        data-testid="admin-broadcasts-history-filter-search"
      />
      <FormControl sx={{ minWidth: { xs: "100%", sm: 160 }, ...focusVisibleRingSx }}>
        <InputLabel id={STATUS_SELECT_LABEL_ID}>{t.filterStatusLabel}</InputLabel>
        <Select
          labelId={STATUS_SELECT_LABEL_ID}
          label={t.filterStatusLabel}
          value={filterDraft.status ?? ALL_FILTER_VALUE}
          onChange={event => {
            const nextStatus = event.target.value;
            onApplyFilters({ status: isBroadcastStatusValue(nextStatus) ? nextStatus : null });
          }}
          data-testid="admin-broadcasts-history-filter-status"
        >
          <MenuItem value={ALL_FILTER_VALUE} sx={MENU_ITEM_SX}>
            {t.filterAllLabel}
          </MenuItem>
          {BROADCAST_STATUS_OPTIONS.map(option => (
            <MenuItem key={option} value={option} sx={MENU_ITEM_SX}>
              {t[broadcastStatusLabelKey(option)]}
            </MenuItem>
          ))}
        </Select>
      </FormControl>
      <FormControl sx={{ minWidth: { xs: "100%", sm: 200 }, ...focusVisibleRingSx }}>
        <InputLabel id={AUDIENCE_SELECT_LABEL_ID}>{t.filterAudienceLabel}</InputLabel>
        <Select
          labelId={AUDIENCE_SELECT_LABEL_ID}
          label={t.filterAudienceLabel}
          value={filterDraft.audienceType ?? ALL_FILTER_VALUE}
          onChange={event => {
            const nextKind = event.target.value;
            onApplyFilters({ audienceType: isAudienceKind(nextKind) ? nextKind : null });
          }}
          data-testid="admin-broadcasts-history-filter-audience"
        >
          <MenuItem value={ALL_FILTER_VALUE} sx={MENU_ITEM_SX}>
            {t.filterAllLabel}
          </MenuItem>
          {AUDIENCE_KINDS.map(kind => (
            <MenuItem key={kind} value={kind} sx={MENU_ITEM_SX}>
              {audienceKindLabel(kind, t)}
            </MenuItem>
          ))}
        </Select>
      </FormControl>
      <FilterActionsRow
        onReset={() => onApplyFilters(EMPTY_HISTORY_FILTER_DRAFT)}
        resetTestId="admin-broadcasts-history-filter-reset"
        resetLabel={t.filterReset}
        applySubmitsForm
        applyTestId="admin-broadcasts-history-filter-apply"
        applyLabel={t.filterApply}
      />
    </Box>
  );
}
