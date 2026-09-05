"use client";

/**
 * DirectoryRoleFilter — the role select inside the desktop
 * `DirectoryToolbar` (44px control height; the empty option means
 * "any role").
 */

import { FormControl, InputLabel, MenuItem, Select } from "@mui/material";
import type { ReactNode } from "react";
import type { DirectoryRole } from "@/frontend/views/admin/users/utils";
import type { AdminUsersLabels } from "@/shared/locale/types/adminUsers";

interface DirectoryRoleFilterProps {
  readonly id: string;
  readonly roleFilter: DirectoryRole | "";
  readonly setRoleFilter: (value: DirectoryRole | "") => void;
  readonly labels: Pick<AdminUsersLabels, "filters" | "roleLabels" | "genderOptions">;
}

export function DirectoryRoleFilter({ id, roleFilter, setRoleFilter, labels }: DirectoryRoleFilterProps): ReactNode {
  return (
    <FormControl sx={{ minWidth: 150, flex: { xs: "1 1 100%", sm: "0 1 auto" } }}>
      <InputLabel htmlFor={id}>{labels.filters.role}</InputLabel>
      <Select
        id={id}
        value={roleFilter}
        label={labels.filters.role}
        onChange={event => setRoleFilter(event.target.value || "")}
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
        <MenuItem value="">{labels.genderOptions.unspecified}</MenuItem>
        <MenuItem value="Admin">{labels.roleLabels.admin}</MenuItem>
        <MenuItem value="Teacher">{labels.roleLabels.teacher}</MenuItem>
        <MenuItem value="Student">{labels.roleLabels.student}</MenuItem>
        <MenuItem value="Parent">{labels.roleLabels.parent}</MenuItem>
      </Select>
    </FormControl>
  );
}
