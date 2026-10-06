"use client";

/**
 * TeacherDirectoryResultsHeader — the results heading row of the student
 * teacher directory: the section heading (`resultsTitle`, real `h2` under
 * the page's `h1`) plus the honest range caption composed from the
 * server-echoed pagination envelope as
 * `${showingPrefix} ${from}–${to} ${of} ${total}`.
 *
 * Numbers are DATA text nodes, never interpolated copy (the namespace's
 * static-string discipline); the from–to range is bolded exactly like the
 * admin directory's pagination caption so both surfaces read as one
 * system. Wide viewports set the caption on the heading's baseline
 * (space-between); narrow ones stack it under the heading.
 */

import { Box, Stack, Typography } from "@mui/material";
import type { ReactNode } from "react";
import { TeacherDirectory, useAppTranslation } from "@/shared/locale";

interface TeacherDirectoryResultsHeaderProps {
  /** The honest unfiltered-by-page total (server echo). */
  readonly total: number;
  /** The 1-based page the envelope was served for (server echo). */
  readonly page: number;
  /** The page size the envelope was served with (server echo). */
  readonly pageSize: number;
}

/** The results heading + range caption row. */
export function TeacherDirectoryResultsHeader({
  total,
  page,
  pageSize,
}: Readonly<TeacherDirectoryResultsHeaderProps>): ReactNode {
  const t = useAppTranslation(TeacherDirectory);
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);
  return (
    <Stack
      sx={{
        gap: 0.5,
        flexDirection: { xs: "column", md: "row" },
        alignItems: { md: "baseline" },
        justifyContent: { md: "space-between" },
      }}
    >
      <Typography variant="h5" component="h2" sx={{ fontWeight: 700 }}>
        {t.resultsTitle}
      </Typography>
      <Typography variant="body2" component="p" sx={theme => ({ color: theme.palette.text.secondary })}>
        {`${t.showingPrefix} `}
        <Box component="span" sx={{ fontWeight: 700 }}>
          {from}–{to}
        </Box>
        {` ${t.of} ${total}`}
      </Typography>
    </Stack>
  );
}
