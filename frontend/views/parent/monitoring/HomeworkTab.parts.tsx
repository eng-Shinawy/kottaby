"use client";

import { AutoStoriesOutlined, ReplayOutlined } from "@mui/icons-material";
import { Card, Skeleton, Stack, Typography } from "@mui/material";
import type { ReactNode } from "react";
import type { ParentChildHomeworkQuery_parentChildHomework_items } from "@/frontend/graphql/generated/gql/graphql";
import { formatApplicantDate } from "@/frontend/lib/i18n/format-date";
import { DeepLinkTargetChip } from "@/frontend/views/parent/monitoring/DeepLinkTargetChip";
import { HomeworkTrackBlock } from "@/frontend/views/parent/monitoring/HomeworkTab.parts.helpers";
import {
  deepLinkRowSx,
  useDeepLinkRowHighlight,
} from "@/frontend/views/parent/monitoring/ParentChildDetailContainer.helpers";
import type { ParentMonitoringLabels } from "@/shared/locale/types/parentMonitoring";

const HOMEWORK_SKELETON_KEYS: readonly string[] = ["homework-skeleton-1", "homework-skeleton-2", "homework-skeleton-3"];

export function HomeworkSkeleton(): ReactNode {
  return (
    <Stack aria-busy="true" data-testid="parent-homework-loading" sx={{ gap: 2 }}>
      {HOMEWORK_SKELETON_KEYS.map(key => (
        <Card
          key={key}
          variant="outlined"
          sx={theme => ({
            display: "flex",
            flexDirection: "column",
            gap: 1,
            padding: 2,
            borderRadius: 2,
            borderColor: theme.palette.border.main,
          })}
        >
          <Skeleton variant="text" sx={{ fontSize: "1rem", maxWidth: 180 }} />
          <Skeleton variant="rectangular" sx={{ height: 56, borderRadius: 2 }} />
          <Skeleton variant="rectangular" sx={{ height: 56, borderRadius: 2 }} />
        </Card>
      ))}
    </Stack>
  );
}

export function HomeworkRow({
  row,
  labels,
  locale,
  deepLinkSessionId,
}: Readonly<{
  row: ParentChildHomeworkQuery_parentChildHomework_items;
  labels: ParentMonitoringLabels;
  locale: string;
  deepLinkSessionId: number | null;
}>): ReactNode {
  const { rowRef, isDeepLinkTarget } = useDeepLinkRowHighlight(deepLinkSessionId, row.sessionId);
  return (
    <Card
      ref={rowRef}
      variant="outlined"
      data-testid="parent-homework-row"
      aria-current={isDeepLinkTarget ? "true" : undefined}
      sx={deepLinkRowSx(isDeepLinkTarget)}
    >
      {isDeepLinkTarget ? <DeepLinkTargetChip labels={labels} /> : null}
      <Typography variant="body2" dir="auto" sx={theme => ({ color: theme.palette.text.secondary })}>
        {formatApplicantDate(row.createdAt, locale)}
      </Typography>
      <HomeworkTrackBlock
        track={row.jadid}
        trackLabel={labels.trackJadid}
        noneLabel={labels.trackNoneAssigned}
        columnGradeLabel={labels.homeworkColumnGrade}
        icon={<AutoStoriesOutlined fontSize="small" />}
        accentColor="primary.main"
      />
      <HomeworkTrackBlock
        track={row.madi}
        trackLabel={labels.trackMadi}
        noneLabel={labels.trackNoneAssigned}
        columnGradeLabel={labels.homeworkColumnGrade}
        icon={<ReplayOutlined fontSize="small" />}
        accentColor="secondary.main"
      />
    </Card>
  );
}
