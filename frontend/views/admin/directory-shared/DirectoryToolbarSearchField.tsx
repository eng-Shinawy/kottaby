"use client";

/**
 * DirectoryToolbarSearchField — the admin directory toolbars' search input:
 * a hidden-label `TextField` with a magnifier leading adornment, a fixed 44px
 * control height, and a ~400px max width. The debouncing itself lives in the
 * directory hooks (the draft state feeds the applied query); this field is
 * the controlled input those drafts bind to.
 *
 * Copy flows in via plain strings (the caller's `filters` label slice) —
 * nothing is hardcoded. The responsive sizing defaults to the toolbars'
 * wrapping-row recipe (`sm` floor, 400px max); a caller can replace it
 * entirely through `sx` when its toolbar line is sized differently (the
 * users directory's desktop-only `md`+ row).
 */

import { ClearOutlined as ClearIcon, SearchOutlined as SearchIcon } from "@mui/icons-material";
import { IconButton, InputAdornment, TextField, Tooltip } from "@mui/material";
import type { SxProps, Theme } from "@mui/material/styles";
import type { ReactNode } from "react";
import { focusVisibleRingSx } from "@/frontend/components/ui/focusRing";

/** Default responsive sizing inside the toolbars' wrapping flex row. */
const directoryToolbarSearchFieldSx: SxProps<Theme> = {
  flex: { xs: "1 1 100%", sm: "1 1 300px" },
  maxWidth: 400,
  "& .MuiInputBase-root": { height: 44 },
};

interface DirectoryToolbarSearchFieldProps {
  /** Stable element id (wired to nothing visible — the field is hidden-label). */
  readonly id: string;
  /** Visible placeholder copy (e.g. `labels.filters.searchPlaceholder`). */
  readonly placeholder: string;
  /** Accessible name announced to screen readers (e.g. `labels.filters.search`). */
  readonly ariaLabel: string;
  /** Accessible name for the clear button (defaults to `ariaLabel`). */
  readonly clearLabel?: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  /** Replaces the default responsive sizing when the toolbar row is sized differently. */
  readonly sx?: SxProps<Theme>;
}

export function DirectoryToolbarSearchField({
  id,
  placeholder,
  ariaLabel,
  clearLabel,
  value,
  onChange,
  sx,
}: DirectoryToolbarSearchFieldProps): ReactNode {
  const hasValue = Boolean(value);

  return (
    <TextField
      id={id}
      hiddenLabel
      placeholder={placeholder}
      value={value}
      onChange={event => onChange(event.target.value)}
      slotProps={{
        htmlInput: { "aria-label": ariaLabel },
        input: {
          startAdornment: (
            <SearchIcon fontSize="small" sx={theme => ({ marginInlineEnd: 1, color: theme.palette.text.secondary })} />
          ),
          endAdornment: hasValue ? (
            <InputAdornment position="end" sx={{ marginInlineStart: 0 }}>
              <Tooltip title={clearLabel ?? ariaLabel} placement="top">
                <IconButton
                  size="small"
                  aria-label={clearLabel ?? ariaLabel}
                  onClick={() => onChange("")}
                  edge="end"
                  sx={theme => ({
                    ...focusVisibleRingSx,
                    color: theme.palette.text.secondary,
                    p: 0.5,
                  })}
                >
                  <ClearIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            </InputAdornment>
          ) : undefined,
        },
      }}
      sx={sx ?? directoryToolbarSearchFieldSx}
    />
  );
}
