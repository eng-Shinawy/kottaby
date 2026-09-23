"use client";

import {
  AssignmentOutlined,
  CalendarMonthOutlined,
  DescriptionOutlined,
  RateReviewOutlined,
  TrendingUpOutlined,
} from "@mui/icons-material";
import type { ReactElement, ReactNode } from "react";
import { AttendanceTab } from "@/frontend/views/parent/monitoring/AttendanceTab";
import { EvaluationsTab } from "@/frontend/views/parent/monitoring/EvaluationsTab";
import { HomeworkTab } from "@/frontend/views/parent/monitoring/HomeworkTab";
import type { TabKey } from "@/frontend/views/parent/monitoring/ParentChildDetailContainer.helpers";
import { ProgressTab } from "@/frontend/views/parent/monitoring/ProgressTab";
import { ReportsTab } from "@/frontend/views/parent/monitoring/ReportsTab";

export type DeniedAction = Readonly<{ readonly label: string; readonly onAction: () => void }>;

/** Per-tab iconography, keyed by the shared tab-key union. */
export const TAB_ICONS: Readonly<Record<TabKey, ReactElement>> = {
  attendance: <CalendarMonthOutlined fontSize="small" />,
  reports: <DescriptionOutlined fontSize="small" />,
  homework: <AssignmentOutlined fontSize="small" />,
  evaluations: <RateReviewOutlined fontSize="small" />,
  progress: <TrendingUpOutlined fontSize="small" />,
};

/**
 * renderTabContent — mounts the active tab with its data props, the
 * page-level recovery affordance every tab hands to its FORBIDDEN fallback,
 * and the `?session=` deep-link highlight pointer the three content tabs
 * (reports, homework, evaluations) share for the same session's row.
 * Extracted from the container to keep both files under the line-count
 * lint budget.
 */
export function renderTabContent(
  tab: TabKey,
  studentId: number,
  session: number | null,
  childName: string,
  deniedAction: DeniedAction
): ReactNode {
  switch (tab) {
    case "reports":
      return <ReportsTab studentId={studentId} session={session} childName={childName} deniedAction={deniedAction} />;
    case "homework":
      return <HomeworkTab studentId={studentId} session={session} deniedAction={deniedAction} />;
    case "evaluations":
      return <EvaluationsTab studentId={studentId} session={session} deniedAction={deniedAction} />;
    case "progress":
      return <ProgressTab studentId={studentId} deniedAction={deniedAction} />;
    default:
      return <AttendanceTab studentId={studentId} deniedAction={deniedAction} />;
  }
}
