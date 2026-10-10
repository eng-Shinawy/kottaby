"use client";

import { CloseOutlined, DownloadOutlined, PrintOutlined } from "@mui/icons-material";
import { Box, Button, Dialog, DialogContent, DialogTitle, IconButton, Stack, Tooltip, Typography } from "@mui/material";
import type { ReactNode } from "react";
import { focusVisibleRingSx } from "@/frontend/components/ui/focusRing";
import { formatApplicantDate } from "@/frontend/lib/i18n/format-date";
import { escapeCsv } from "@/frontend/views/shared/print-export/print-export-csv";
import { Common, useAppLocale, useAppTranslation } from "@/shared/locale";

export interface PrintableRow {
  readonly date: string;
  readonly col2: string;
  readonly col3: string;
  readonly col4: string;
}

/**
 * Caller-owned chrome copy — the dialog is domain-neutral, so every
 * visible string arrives from the consuming surface's own namespace
 * (the parent portal passes its monitoring labels, the student homework
 * page passes the homework labels).
 */
export interface PrintExportLabels {
  readonly printOption: string;
  readonly exportCsvOption: string;
}

/**
 * The shared print/CSV-export dialog. Domain-neutral: chrome copy arrives
 * through `labels` (caller-owned namespace strings) and the CSV meta line
 * names its subject through `metaSubject` (a child name on the parent
 * portal, the surface title on the student page). Every exported cell is
 * escaped by `print-export-csv.ts` (the shared CWE-1236 formula guard +
 * CSV quoting).
 */
export function PrintExportDialog({
  open,
  onClose,
  rows,
  metaSubject,
  title,
  colHeaders,
  countLabel,
  filePrefix,
  labels,
}: Readonly<{
  open: boolean;
  onClose: () => void;
  rows: readonly PrintableRow[];
  metaSubject: string;
  title: string;
  colHeaders: readonly [string, string, string, string];
  countLabel: (n: number) => string;
  filePrefix: string;
  labels: PrintExportLabels;
}>): ReactNode {
  const commonT = useAppTranslation(Common);
  const locale = useAppLocale();
  const handlePrint = () => {
    onClose();
    window.print();
  };
  const handleExportCsv = () => {
    const header = colHeaders.join(",");
    const lines = rows.map(row =>
      [escapeCsv(row.date), escapeCsv(row.col2), escapeCsv(row.col3), escapeCsv(row.col4)].join(",")
    );
    const now = formatApplicantDate(new Date().toISOString(), locale);
    const meta = escapeCsv(`# ${metaSubject} — ${now}`);
    const csv = [meta, header, ...lines].join("\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filePrefix + "-" + Date.now() + ".csv";
    link.click();
    URL.revokeObjectURL(url);
    onClose();
  };
  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", pr: 1 }}>
        <Typography variant="h6" component="span" sx={{ fontWeight: 700 }}>
          {title}
        </Typography>
        <Tooltip title={commonT.close}>
          <IconButton aria-label={commonT.close} onClick={onClose} size="small" sx={focusVisibleRingSx}>
            <CloseOutlined />
          </IconButton>
        </Tooltip>
      </DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ py: 1 }}>
          <Button
            variant="outlined"
            startIcon={<PrintOutlined />}
            onClick={handlePrint}
            fullWidth
            sx={theme => ({ borderColor: theme.palette.primary.main, py: 1.5 })}
          >
            {labels.printOption}
          </Button>
          <Button
            variant="contained"
            startIcon={<DownloadOutlined />}
            onClick={handleExportCsv}
            fullWidth
            sx={{ py: 1.5 }}
          >
            {labels.exportCsvOption}
          </Button>
          <Box sx={theme => ({ mt: 1, p: 1.5, borderRadius: 1.5, bgcolor: theme.palette.action.hover })}>
            <Typography variant="body2" sx={theme => ({ color: theme.palette.text.secondary })}>
              {rows.length} {countLabel(rows.length)}
            </Typography>
          </Box>
        </Stack>
      </DialogContent>
    </Dialog>
  );
}
