"use client";

/**
 * DirectorySearchField — the toolbar's search input: magnifier leading
 * adornment, ~400px max width, fixed 44px control height (matches the
 * selects and the Create button).
 */

import { SearchOutlined as SearchIcon } from "@mui/icons-material";
import { TextField } from "@mui/material";
import type { ReactNode } from "react";
import type { AdminUsersLabels } from "@/shared/locale/types/adminUsers";

interface DirectorySearchFieldProps {
  readonly id: string;
  readonly labels: Pick<AdminUsersLabels, "filters">;
  readonly value: string;
  readonly onChange: (value: string) => void;
}

export function DirectorySearchField({ id, labels, value, onChange }: DirectorySearchFieldProps): ReactNode {
  return (
    <TextField
      id={id}
      hiddenLabel
      placeholder={labels.filters.searchPlaceholder}
      value={value}
      onChange={event => onChange(event.target.value)}
      slotProps={{
        htmlInput: { "aria-label": labels.filters.search },
        input: {
          startAdornment: (
            <SearchIcon fontSize="small" sx={theme => ({ marginInlineEnd: 1, color: theme.palette.text.secondary })} />
          ),
        },
      }}
      sx={{
        flex: { xs: "1 1 100%", md: "0 1 auto" },
        width: { xs: "100%", md: 400 },
        maxWidth: 400,
        "& .MuiInputBase-root": { height: 44 },
      }}
    />
  );
}
