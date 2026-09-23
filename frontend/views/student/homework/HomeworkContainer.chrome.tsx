"use client";

import { PrintOutlined, TaskAltOutlined } from "@mui/icons-material";
import { Box, IconButton, Stack, Tooltip, Typography } from "@mui/material";
import type { ReactNode } from "react";
import { IconCircleEmptyState } from "@/frontend/components/ui/IconCircleEmptyState";
import type { MyHomeworkQuery_myHomework_items } from "@/frontend/graphql/generated/gql/graphql";
import { SearchFilterBar } from "@/frontend/views/parent/monitoring/SearchFilterBar";
import { DEFAULT_SORT } from "@/frontend/views/parent/monitoring/SearchFilterBar.helpers";
import { HomeworkListBody } from "@/frontend/views/student/homework/HomeworkContainer.parts";
import type { HomeworkLabels } from "@/shared/locale/types/homework";

/**
 * The assignment-list section: the heading with the print entry point,
 * the shared search bar (search-only here — the rating/sort selects stay
 * parent-owned), the live count line, and the empty/list swap.
 */
export function HomeworkListSection({
  labels: t,
  locale,
  rows,
  settledVisibleRows,
  searchQuery,
  onSearchChange,
  onPrintOpenChange,
  emptyTitle,
  emptyBody,
}: Readonly<{
  labels: HomeworkLabels;
  locale: string;
  rows: readonly MyHomeworkQuery_myHomework_items[];
  settledVisibleRows: readonly MyHomeworkQuery_myHomework_items[];
  searchQuery: string;
  onSearchChange: (next: { query: string }) => void;
  onPrintOpenChange: (open: boolean) => void;
  emptyTitle: string;
  emptyBody: string;
}>): ReactNode {
  return (
    <Stack spacing={2} sx={{ minWidth: 0 }}>
      <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 1, flexWrap: "wrap" }}>
        <Typography variant="h6" component="h2" sx={theme => ({ fontWeight: 700, color: theme.palette.text.primary })}>
          {t.listHeading}
        </Typography>
        <Tooltip title={t.printLabel} arrow>
          <IconButton
            aria-label={t.printLabel}
            onClick={() => {
              onPrintOpenChange(true);
            }}
            size="small"
            sx={theme => ({
              color: theme.palette.primary.main,
              border: "1px solid",
              borderColor: theme.palette.outlineVariant,
              borderRadius: 1.5,
              "&:hover": { bgcolor: theme.palette.action.hover },
            })}
          >
            <PrintOutlined fontSize="small" />
          </IconButton>
        </Tooltip>
      </Box>
      {rows.length > 0 ? (
        <SearchFilterBar
          state={{ query: searchQuery, ratingFilter: null, sort: DEFAULT_SORT }}
          labels={t}
          onChange={onSearchChange}
          resultCount={settledVisibleRows.length}
          totalCount={rows.length}
          showRatingFilter={false}
          showSortFilter={false}
        />
      ) : null}
      <Typography variant="body2" sx={theme => ({ color: theme.palette.text.secondary })} aria-live="polite">
        {t.countLine(settledVisibleRows.length)}
      </Typography>
      {rows.length === 0 ? (
        <IconCircleEmptyState
          testId="student-homework-empty"
          icon={<TaskAltOutlined sx={{ fontSize: 36 }} />}
          title={emptyTitle}
          body={emptyBody}
        />
      ) : (
        <HomeworkListBody visibleRows={settledVisibleRows} labels={t} locale={locale} searchQuery={searchQuery} />
      )}
    </Stack>
  );
}
