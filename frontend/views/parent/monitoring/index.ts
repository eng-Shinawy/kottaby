/**
 * Parent read-only monitoring portal — public component surface.
 *
 * Consumers (the portal route server shells in
 * `app/(dashboard)/parent/children/`) import the two containers from
 * here. The five tab components are re-exported for the detail
 * container's internal composition and for the component-test lane;
 * presentational parts (`*.parts.tsx`) and the locale-neutral display
 * helpers (`parentMonitoringDisplay.ts`) stay deep-imported — they are
 * not part of the public surface.
 */

export * from "./AttendanceCalendar";
export * from "./AttendanceSummary";
export * from "./AttendanceTab";
export * from "./EvaluationsSummary";
export * from "./EvaluationsTab";
export * from "./HomeworkSummary";
export * from "./HomeworkTab";
export * from "./ParentChildDetailContainer";
export * from "./ParentChildrenRootContainer";
export * from "./ProgressSummary";
export * from "./ProgressTab";
export * from "./RatingTrendChart";
export * from "./ReportsTab";
