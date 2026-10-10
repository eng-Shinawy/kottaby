"use client";

/**
 * DirectoryExportCsvButton — the admin directory toolbars' export action:
 * a text button that runs the surface's export query and downloads the CSV
 * file. Same recipe as the refresh/copy-link actions next to it (variant/
 * 44px floor/`text.secondary` ink/`flexShrink: 0`).
 *
 * While the export query is in flight the button shows MUI's leading
 * spinner busy state. The tooltip switches to the honest "nothing to
 * export" copy while disabled; a `<span>` wrapper keeps the tooltip
 * reachable on a disabled button (disabled elements emit no pointer
 * events). The tooltip runs as a DESCRIPTION (`describeChild` — the span
 * receives only `aria-describedby`, an attribute a generic `<span>` may
 * carry): MUI's label mode would pin `aria-label` onto the non-interactive
 * wrapper, which the accessibility tree rejects. The button's own name
 * comes from its visible text. Labels flow in via plain strings (the
 * caller's `export` label slice) — nothing is hardcoded.
 */

import { FileDownloadOutlined as DownloadIcon } from "@mui/icons-material";
import { Box, Button, Tooltip } from "@mui/material";
import type { ReactNode } from "react";
import { focusVisibleRingSx } from "@/frontend/components/ui/focusRing";

interface DirectoryExportCsvButtonProps {
  /** Visible label + accessible name (e.g. `labels.export.exportCsv`). */
  readonly exportLabel: string;
  /** Tooltip copy while the export is disabled — nothing to export. */
  readonly exportCsvEmptyLabel: string;
  /** Runs the export query and downloads the CSV file. */
  readonly onExportCsv: () => void;
  /** `true` while the export query is in flight (the button shows a busy state). */
  readonly exportLoading: boolean;
  /** `true` while loading or the filtered total is zero — nothing to export. */
  readonly exportDisabled: boolean;
}

export function DirectoryExportCsvButton({
  exportLabel,
  exportCsvEmptyLabel,
  onExportCsv,
  exportLoading,
  exportDisabled,
}: DirectoryExportCsvButtonProps): ReactNode {
  return (
    <Tooltip title={exportDisabled ? exportCsvEmptyLabel : exportLabel} placement="top" describeChild>
      <Box component="span" sx={{ display: "inline-flex", flexShrink: 0 }}>
        <Button
          variant="text"
          startIcon={<DownloadIcon />}
          onClick={onExportCsv}
          loading={exportLoading}
          disabled={exportDisabled}
          sx={theme => ({ ...focusVisibleRingSx, minHeight: 54, flexShrink: 0, color: theme.palette.text.secondary })}
        >
          {exportLabel}
        </Button>
      </Box>
    </Tooltip>
  );
}
