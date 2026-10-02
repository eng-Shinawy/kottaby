import type { ScheduleLabels } from "@/shared/locale/types/schedule";

export const scheduleEn: ScheduleLabels = {
  pageTitle: "Weekly Schedule",
  previousWeekLabel: "Previous week",
  nextWeekLabel: "Next week",
  thisWeekLabel: "This week",
  weekRangeLabel: (from: string, to: string) => `${from} – ${to}`,
  weekSessionsLabel: "Sessions this week",
  weekActiveLabel: "Active / upcoming",
  weekCompletedLabel: "Completed",
  weekCancelledLabel: "Cancelled",
  todayChip: "Today",
  dayColumnAria: (day: string, date: string) => `${day}, ${date}`,
  dayCountLine: (count: number) => (count === 1 ? "1 session" : `${count} sessions`),
  sessionChipAria: (status: string, time: string) => `${status}, ${time}`,
  emptyWeekTitle: "Nothing scheduled this week",
  emptyWeekBody:
    "Sessions land on the grid on the day they started (or were booked). Navigate weeks or book sessions to see your teaching activity here.",
  errorTitle: "Could not load your schedule",
  errorBody: "Something went wrong. Please try again.",
  loadingLabel: "Loading schedule",
  manageSessionsCta: "Manage sessions",
};
