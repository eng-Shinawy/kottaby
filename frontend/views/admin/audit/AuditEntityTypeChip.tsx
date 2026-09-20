"use client";

/**
 * AuditEntityTypeChip — the localized entity-type pill of the audit trail's
 * entity column (desktop row + mobile card share it).
 *
 * The raw wire value resolves through `entityTypeLabelOf` (known values get
 * the localized `entityTypeLabels` copy; an unknown value renders verbatim)
 * and a per-entity outline icon gives the column scannable texture beyond
 * the label text. Tone rides the theme's tertiary container pair — distinct
 * from the action chips' tone-mapped pairs so the two pill systems never
 * read as the same dimension.
 */

import { Box, SvgIcon } from "@mui/material";
import type { ReactNode } from "react";
import { auditEntityTypeIconOf } from "@/frontend/views/admin/audit/audit-entity-type-icons";
import { entityTypeLabelOf } from "@/frontend/views/admin/audit/audit-trail-filters";
import type { AdminUsersLabels } from "@/shared/locale/types/adminUsers";

interface AuditEntityTypeChipProps {
  /** The raw entity-type wire value as recorded on the entry. */
  readonly entityType: string;
  /** The auditTrail label block carrying the `entityTypeLabels` vocabulary. */
  readonly labels: AdminUsersLabels["auditTrail"];
}

export function AuditEntityTypeChip({ entityType, labels }: Readonly<AuditEntityTypeChipProps>): ReactNode {
  return (
    <Box
      component="span"
      sx={theme => ({
        display: "inline-flex",
        alignItems: "center",
        gap: 0.75,
        padding: theme.spacing(0.25, 1.25),
        borderRadius: 999,
        backgroundColor: theme.palette.tertiaryContainer,
        color: theme.palette.onTertiaryContainer,
        fontSize: 13,
        fontWeight: 600,
        maxWidth: "100%",
      })}
    >
      <SvgIcon fontSize="inherit" aria-hidden="true" sx={{ flexShrink: 0 }}>
        {auditEntityTypeIconOf(entityType)}
      </SvgIcon>
      {entityTypeLabelOf(labels, entityType)}
    </Box>
  );
}
