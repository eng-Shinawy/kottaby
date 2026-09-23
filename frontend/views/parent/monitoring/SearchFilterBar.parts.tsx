"use client";

import { FormControl, InputLabel, MenuItem, Select } from "@mui/material";
import type { ReactNode } from "react";
import type { SearchFilterState } from "@/frontend/views/parent/monitoring/SearchFilterBar.helpers";

export function RatingFilterSelect({
  state,
  labels,
  onChange,
}: Readonly<{
  state: SearchFilterState;
  labels: {
    readonly filterByRatingLabel?: string;
    readonly filterAllRatings?: string;
  };
  onChange: (next: SearchFilterState) => void;
}>): ReactNode {
  if (labels.filterByRatingLabel === undefined || labels.filterAllRatings === undefined) {
    return null;
  }
  return (
    <FormControl size="small" sx={{ minWidth: 140 }}>
      <InputLabel id="rating-filter-label">{labels.filterByRatingLabel}</InputLabel>
      <Select
        labelId="rating-filter-label"
        label={labels.filterByRatingLabel}
        value={state.ratingFilter === null ? "all" : String(state.ratingFilter)}
        onChange={e => {
          const v = e.target.value;
          onChange({ ...state, ratingFilter: v === "all" ? null : Number(v) });
        }}
      >
        <MenuItem value="all">{labels.filterAllRatings}</MenuItem>
        <MenuItem value="5">5 / 5</MenuItem>
        <MenuItem value="4">4 / 5</MenuItem>
        <MenuItem value="3">3 / 5</MenuItem>
        <MenuItem value="2">2 / 5</MenuItem>
        <MenuItem value="1">1 / 5</MenuItem>
      </Select>
    </FormControl>
  );
}
