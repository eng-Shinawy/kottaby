"use client";

/**
 * DirectorySearchField — the admin user directory toolbar's search input:
 * the shared `DirectoryToolbarSearchField` primitive (magnifier leading
 * adornment, ~400px max width, fixed 44px control height — matches the
 * selects and the Create button) with this toolbar's desktop-only row
 * sizing (the card renders from `md` up and holds one wrapping line, so
 * the flexible floor is keyed to `md` with an explicit width pair).
 */

import type { SxProps, Theme } from "@mui/material/styles";
import type { ReactNode } from "react";
import { DirectoryToolbarSearchField } from "@/frontend/views/admin/directory-shared/DirectoryToolbarSearchField";
import type { AdminUsersLabels } from "@/shared/locale/types/adminUsers";

/** Desktop-row sizing of the users toolbar line (the md+ single wrapping row). */
const directorySearchFieldSx: SxProps<Theme> = {
  flex: { xs: "1 1 100%", md: "1 1 260px" },
  width: { xs: "100%", md: 400 },
  maxWidth: 400,
  minWidth: 220,
  "& .MuiInputBase-root": { minHeight: 54 },
};

interface DirectorySearchFieldProps {
  readonly id: string;
  readonly labels: Pick<AdminUsersLabels, "filters">;
  readonly value: string;
  readonly onChange: (value: string) => void;
}

export function DirectorySearchField({ id, labels, value, onChange }: DirectorySearchFieldProps): ReactNode {
  return (
    <DirectoryToolbarSearchField
      id={id}
      placeholder={labels.filters.searchPlaceholder}
      ariaLabel={labels.filters.search}
      clearLabel={labels.filters.searchClearLabel}
      value={value}
      onChange={onChange}
      sx={directorySearchFieldSx}
    />
  );
}
