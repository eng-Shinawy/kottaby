"use client";

/**
 * AuditTrailHeading — the audit-trail page heading row: the localized title
 * with its secondary subtitle (and the "filtered view" chip whenever the
 * applied record narrows the trail — the at-a-glance marker that a deep
 * link or filter edit IS active) on the inline-start side; the export pair
 * rides the inline-end side: the page CSV export (serializes from the rows
 * the view already holds) and the export-all (filtered) download — both
 * the directory toolbars' export-button recipe (same component, same 44px
 * floor). Split from `AuditTrailView` (the 150-line view-file convention).
 */

import { FilterAltOutlined as FilterIcon } from "@mui/icons-material";
import { Chip, Stack, Typography } from "@mui/material";
import type { ReactNode } from "react";
import { DirectoryExportCsvButton } from "@/frontend/views/admin/directory-shared/DirectoryExportCsvButton";
import type { AdminUsersLabels } from "@/shared/locale/types/adminUsers";

export function AuditTrailHeading({
  labels,
  isFiltered,
  exportDisabled,
  exportAllDisabled,
  exportAllLoading,
  onExport,
  onExportAll,
}: Readonly<{
  labels: AdminUsersLabels["auditTrail"];
  isFiltered: boolean;
  exportDisabled: boolean;
  exportAllDisabled: boolean;
  exportAllLoading: boolean;
  onExport: () => void;
  onExportAll: () => void;
}>): ReactNode {
  return (
    <Stack direction="row" sx={{ alignItems: "center", justifyContent: "space-between", gap: 2, flexWrap: "wrap" }}>
      <Stack spacing={0.5}>
        <Typography variant="h4" component="h1">
          {labels.pageTitle}
        </Typography>
        <Stack direction="row" sx={{ alignItems: "center", gap: 1.5, flexWrap: "wrap" }}>
          <Typography variant="body2" component="p" sx={theme => ({ color: theme.palette.text.secondary })}>
            {labels.pageSubtitle}
          </Typography>
          {isFiltered ? (
            <Chip
              size="small"
              icon={<FilterIcon fontSize="small" />}
              label={labels.filteredViewLabel}
              sx={theme => ({
                bgcolor: theme.palette.tertiaryContainer,
                color: theme.palette.onTertiaryContainer,
                fontWeight: 600,
                height: 26,
                "& .MuiChip-icon": { color: "inherit" },
              })}
            />
          ) : null}
        </Stack>
      </Stack>
      <Stack direction="row" sx={{ alignItems: "center", gap: 1, flexWrap: "wrap" }}>
        <DirectoryExportCsvButton
          exportLabel={labels.export.exportPageCsv}
          exportCsvEmptyLabel={labels.export.exportPageCsvEmpty}
          onExportCsv={onExport}
          exportLoading={false}
          exportDisabled={exportDisabled}
        />
        <DirectoryExportCsvButton
          exportLabel={labels.export.exportAllCsv}
          exportCsvEmptyLabel={labels.export.exportPageCsvEmpty}
          onExportCsv={onExportAll}
          exportLoading={exportAllLoading}
          exportDisabled={exportAllDisabled}
        />
      </Stack>
    </Stack>
  );
}
