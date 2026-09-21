import type { UpNextLabels } from "@/shared/locale/types/upNext";

export const upNextEn: UpNextLabels = {
  upNextTitle: "What's next",
  upcomingHeading: "Upcoming sessions",
  upcomingEmpty: "No upcoming sessions yet — sessions you book will appear here.",
  upcomingEmptyTeacher: "No upcoming sessions yet — sessions students book with you will appear here.",
  upcomingEmptyChild: "No upcoming sessions yet — sessions you book will appear here.",
  upcomingEmptyParentNoChildren: "No linked children yet — link your child to follow their upcoming sessions.",
  linkChildCta: "Link my child",
  sessionLine: (id: number) => `Session #${id}`,
  bookedPrefix: "Booked",
  sessionsCta: "View sessions",
  homeworkHeading: "Homework",
  homeworkPendingLine: (count: number) =>
    count === 1 ? "1 assignment awaiting grade" : `${count} assignments awaiting grade`,
  homeworkAllGraded: "All caught up — nothing awaiting grade",
  scheduledMoreLine: (count: number) => (count === 1 ? "1 more scheduled session" : `${count} more scheduled sessions`),
  loadingLabel: "Loading your next steps",
  errorBody: "Could not load your next steps.",
};
