import {
  EventOutlined,
  GavelOutlined,
  HowToRegOutlined,
  PlayArrowOutlined,
  ReportProblemOutlined,
  ScheduleOutlined,
  StopCircleOutlined,
  type SvgIconComponent,
  TaskAltOutlined,
} from "@mui/icons-material";
import type { SessionByIdQuery_sessionById } from "@/frontend/graphql/generated/gql/graphql";
import { DEADLINE_PENDING_STATUSES } from "@/frontend/views/student/sessions/sessionRowPresentation";
import type { SessionsLabels } from "@/shared/locale/types/sessions";

/**
 * Pure timeline assembly for the details dialog (split from the component
 * file so the `.tsx` exports ONLY components — the react-refresh contract):
 * the lifecycle stamp ledger in DOMAIN order (created → deadline while
 * pending → confirmations → start → end → dispute → arbitration), one
 * icon bubble + localized label + locale-aware stamp per settled moment.
 * Absent stamps produce NO entry (the honest nulls: the dialog never
 * fabricates a moment the lifecycle has not set).
 */

/** One settled lifecycle moment on the details timeline. */
export interface SessionDetailsTimelineEntry {
  /** Stable React key (the lifecycle moment's token). */
  readonly key: string;
  /** Semantically-matching outlined icon inside the bubble. */
  readonly icon: SvgIconComponent;
  /** Localized stamp label (resolved `SessionsLabels` handle). */
  readonly label: string;
  /** The ISO-8601 instant (formatting happens at render, locale-aware). */
  readonly iso: string;
}

/**
 * Assembles the timeline entries from the `sessionById` wire payload in
 * domain order, skipping every unset stamp. The confirmation deadline
 * enters only while the status keeps it governing
 * ({@link DEADLINE_PENDING_STATUSES}); every other entry enters when its
 * stamp is non-null.
 */
export function buildSessionDetailsTimeline(
  wire: SessionByIdQuery_sessionById,
  t: SessionsLabels
): readonly SessionDetailsTimelineEntry[] {
  const entries: SessionDetailsTimelineEntry[] = [];
  const push = (key: string, icon: SvgIconComponent, label: string, iso: string | null): void => {
    if (iso !== null) {
      entries.push({ key, icon, label, iso });
    }
  };
  push("created", EventOutlined, t.createdAt, wire.createdAt);
  if (wire.status in DEADLINE_PENDING_STATUSES) {
    push("deadline", ScheduleOutlined, t.deadline, wire.confirmationDeadline);
  }
  push("student-confirmed", HowToRegOutlined, t.studentConfirmedAt, wire.confirmedByStudentAt);
  push("teacher-confirmed", TaskAltOutlined, t.teacherConfirmedAt, wire.confirmedByTeacherAt);
  push("started", PlayArrowOutlined, t.sessionDetailsStartedAt, wire.startedAt);
  push("ended", StopCircleOutlined, t.sessionDetailsEndedAt, wire.endedAt);
  push("disputed", ReportProblemOutlined, t.disputedAtLabel, wire.disputedAt);
  push("resolved", GavelOutlined, t.sessionDetailsResolvedAt, wire.resolvedAt);
  return entries;
}
