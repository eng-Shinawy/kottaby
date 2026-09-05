/**
 * PlanStatusChip — Active / Inactive status chips for the admin plan catalog.
 *
 * Extracted from PlanCatalogTable (Task 4.3).
 *  - Theme-callback token styling (zero hardcoded hex/strings)
 */

"use client";

import { Chip } from "@mui/material";

export interface PlanStatusChipProps {
  readonly isActive: boolean;
  readonly activeLabel: string;
  readonly inactiveLabel: string;
}

export function PlanStatusChip({ isActive, activeLabel, inactiveLabel }: PlanStatusChipProps): React.ReactElement {
  return (
    <Chip
      label={isActive ? activeLabel : inactiveLabel}
      size="small"
      sx={theme => ({
        backgroundColor: isActive ? theme.palette.success.main : theme.palette.action.selected,
        color: isActive ? theme.palette.success.contrastText : theme.palette.text.primary,
        fontWeight: 600,
      })}
    />
  );
}
