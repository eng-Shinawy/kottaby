"use client";

import { ClearOutlined, SearchOutlined, SortOutlined } from "@mui/icons-material";
import {
  FormControl,
  IconButton,
  InputAdornment,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import type { ReactNode } from "react";
import { DEFAULT_SORT, type SearchFilterState } from "@/frontend/views/parent/monitoring/SearchFilterBar.helpers";
import { RatingFilterSelect } from "@/frontend/views/parent/monitoring/SearchFilterBar.parts";

/**
 * The NARROW label contract the bar actually renders. The three search
 * keys are always required; the select labels are optional because a
 * consumer may hide those controls entirely (the student homework page
 * renders search-only) — a select renders ONLY when its copy exists, so
 * a shown control can never render an empty label. The parent-monitoring
 * namespace (this bar's origin) declares all of them required on its own
 * interface and satisfies this contract structurally; the student
 * homework namespace satisfies it with the search trio alone. Property
 * ownership stays with the caller's namespace — no cross-namespace
 * coupling.
 */
export interface SearchFilterBarLabels {
  readonly searchPlaceholder: string;
  readonly searchClearLabel: string;
  readonly searchNoResults: string;
  /** Rating-select copy — present on every namespace that shows the select. */
  readonly filterByRatingLabel?: string;
  readonly filterAllRatings?: string;
  /** Sort-select copy — present on every namespace that shows the select. */
  readonly sortByLabel?: string;
  readonly sortDateDesc?: string;
  readonly sortDateAsc?: string;
  readonly sortRatingDesc?: string;
  readonly sortRatingAsc?: string;
}

export function SearchFilterBar({
  state,
  labels,
  onChange,
  resultCount,
  totalCount,
  showRatingFilter = true,
  showSortFilter = true,
}: Readonly<{
  state: SearchFilterState;
  labels: SearchFilterBarLabels;
  onChange: (next: SearchFilterState) => void;
  resultCount: number;
  totalCount: number;
  showRatingFilter?: boolean;
  /** Hide the sort select — for consumers whose list owns a fixed order. */
  showSortFilter?: boolean;
}>): ReactNode {
  const hasFilter = state.query !== "" || state.ratingFilter !== null || state.sort !== DEFAULT_SORT;
  return (
    <Stack spacing={1.5} sx={{ width: "100%" }}>
      <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5} sx={{ width: "100%" }}>
        <TextField
          size="small"
          placeholder={labels.searchPlaceholder}
          value={state.query}
          onChange={e => onChange({ ...state, query: e.target.value })}
          fullWidth
          sx={{ flex: 1 }}
          slotProps={{
            input: {
              startAdornment: (
                <InputAdornment position="start">
                  <SearchOutlined fontSize="small" />
                </InputAdornment>
              ),
              endAdornment:
                state.query !== "" ? (
                  <InputAdornment position="end">
                    <IconButton
                      aria-label={labels.searchClearLabel}
                      size="small"
                      onClick={() => onChange({ ...state, query: "" })}
                    >
                      <ClearOutlined fontSize="small" />
                    </IconButton>
                  </InputAdornment>
                ) : null,
            },
          }}
        />
        {showRatingFilter ? <RatingFilterSelect state={state} labels={labels} onChange={onChange} /> : null}
        {showSortFilter && labels.sortByLabel !== undefined ? (
          <FormControl size="small" sx={{ minWidth: 160 }}>
            <InputLabel id="sort-label">{labels.sortByLabel}</InputLabel>
            <Select
              labelId="sort-label"
              label={labels.sortByLabel}
              value={state.sort}
              onChange={e => onChange({ ...state, sort: e.target.value })}
              startAdornment={
                <InputAdornment position="start">
                  <SortOutlined fontSize="small" />
                </InputAdornment>
              }
            >
              <MenuItem value="dateDesc">{labels.sortDateDesc}</MenuItem>
              <MenuItem value="dateAsc">{labels.sortDateAsc}</MenuItem>
              <MenuItem value="ratingDesc">{labels.sortRatingDesc}</MenuItem>
              <MenuItem value="ratingAsc">{labels.sortRatingAsc}</MenuItem>
            </Select>
          </FormControl>
        ) : null}
      </Stack>
      {hasFilter ? (
        <Typography variant="caption" sx={theme => ({ color: theme.palette.text.secondary })}>
          {resultCount} / {totalCount}
          {resultCount === 0 ? " — " + labels.searchNoResults : ""}
        </Typography>
      ) : null}
    </Stack>
  );
}
