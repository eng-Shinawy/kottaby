"use client";

/**
 * DirectoryFilterSelect — the shared 44px filter select chrome used by the
 * directory toolbar's role and governance selects: fixed-height outlined
 * select whose visible value is vertically centered, with a leading empty
 * ("any") option followed by the caller's labelled options. Callers narrow
 * the reported string back to their filter union.
 *
 * The label stays SHRUNKEN (persistent notch label) — the same grammar as
 * the toolbar's country text field. Without this, an empty select hides its
 * display value behind the placeholder-positioned label and the toolbar
 * mixes two label styles (QA finding).
 */

import { FormControl, InputLabel, MenuItem, Select } from "@mui/material";
import type { ReactNode } from "react";

interface DirectoryFilterOption {
  readonly value: string;
  readonly label: string;
}

interface DirectoryFilterSelectProps {
  readonly id: string;
  readonly label: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly emptyOptionLabel: string;
  readonly options: readonly DirectoryFilterOption[];
}

export function DirectoryFilterSelect({
  id,
  label,
  value,
  onChange,
  emptyOptionLabel,
  options,
}: DirectoryFilterSelectProps): ReactNode {
  return (
    <FormControl sx={{ minWidth: 150, flex: { xs: "1 1 100%", sm: "0 1 auto" } }}>
      <InputLabel htmlFor={id} shrink>
        {label}
      </InputLabel>
      <Select
        id={id}
        value={value}
        label={label}
        onChange={event => onChange(event.target.value || "")}
        sx={{
          height: 44,
          // Vertically center the visible value inside the fixed 44px
          // control: the default block padding makes the inner select box
          // taller than the outlined root.
          "&& .MuiSelect-select": {
            minHeight: 44,
            boxSizing: "border-box",
            paddingBlock: 0,
            display: "flex",
            alignItems: "center",
          },
          "& .MuiSelect-nativeInput": { height: "100%" },
        }}
      >
        <MenuItem value="">{emptyOptionLabel}</MenuItem>
        {options.map(option => (
          <MenuItem key={option.value} value={option.value}>
            {option.label}
          </MenuItem>
        ))}
      </Select>
    </FormControl>
  );
}
