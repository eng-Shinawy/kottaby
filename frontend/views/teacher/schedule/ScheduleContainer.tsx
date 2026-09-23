"use client";

import { useQuery } from "@apollo/client/react";
import {
  CalendarMonthOutlined as CalendarIcon,
  EventBusyOutlined as CancelIcon,
  EventAvailableOutlined as DoneIcon,
  ChevronRightOutlined as NextLtrIcon,
  ChevronLeftOutlined as PrevLtrIcon,
  UpdateOutlined as UpcomingIcon,
} from "@mui/icons-material";
import { Box, Button, Stack, Tooltip, Typography } from "@mui/material";
import { useRouter } from "next/navigation";
import { type ReactNode, useCallback, useMemo, useState } from "react";
import { myTeacherSessionsQueryDocument } from "@/frontend/graphql/sharedDocuments";
import { ScheduleBody } from "@/frontend/views/teacher/schedule/ScheduleContainer.parts";
import {
  addUtcDays,
  dayMonthYearStamp,
  groupSessionsByWeekDay,
  isSameUtcDay,
  type ScheduleSession,
  startOfWeekUtc,
  WEEK_STARTS_ON,
  weekStats,
} from "@/frontend/views/teacher/schedule/scheduleWeek.helpers";
import { Schedule, Sessions, useAppLocale, useAppTranslation } from "@/shared/locale";

/**
 * ScheduleContainer — the client orchestrator behind `/schedule`, the
 * teacher's WEEKLY PLANNER: an always-on chrome (title + week navigator +
 * summary strip) over a responsive seven-day grid of anchored sessions.
 *
 * Data — ONE stateful `myTeacherSessions` read (unfiltered, the SAME
 * identity the sessions list consumes); week navigation is pure client
 * state over the already-fetched items (no refetch per week). Anchoring
 * rule: a session renders on the UTC day it STARTED, falling back to its
 * booking day (see `scheduleWeek.helpers`).
 *
 * Week conventions — the Egyptian week (ar) opens SATURDAY, the
 * international week (en) opens SUNDAY; weekend columns tint per locale.
 * All stamps are UTC-fixed `Intl` formatters — server/client identical.
 *
 * Render branches (the chrome renders in EVERY branch; only the body
 * swaps — the teacher sessions container's branch matrix precedent):
 *
 * | # | Condition | Body |
 * |---|-----------|------|
 * | 1 | query in flight | `ScheduleLoadingSkeleton` (`aria-busy`) |
 * | 2 | query error | inline `Alert` (`errorTitle` / `errorBody`) |
 * | 3 | zero sessions across the visible week | empty state (calendar icon + `emptyWeekTitle`/`emptyWeekBody`) |
 * | 4 | rows present | summary strip + seven `ScheduleDayCard`s |
 *
 * Navigation — every session chip routes to `/teacher/sessions` (the
 * lifecycle CTA surface; the planner never duplicates mutation wiring),
 * and the footer CTA offers the same hop from the empty state.
 *
 * MUI v6 discipline: `sx`-only styling, theme-palette tokens only,
 * `*Outlined` icons only, RTL-safe logical composition (the CSS grid
 * mirrors automatically under the RTL document).
 */

/** The teacher's session-management list — the planner's action hop. */
const TEACHER_SESSIONS_ROUTE = "/teacher/sessions";

const EMPTY_WEEK: readonly ScheduleSession[] = [];

/**
 * Screen-reader-only recipe for the week-navigation live region (the
 * canonical `@mui/utils/visuallyHidden` values, as used by the
 * notifications feed's hidden copy).
 */
const VISUALLY_HIDDEN_LIVE_REGION_SX = {
  position: "absolute",
  width: "1px",
  height: "1px",
  padding: 0,
  margin: "-1px",
  overflow: "hidden",
  clip: "rect(0 0 0 0)",
  clipPath: "inset(50%)",
  whiteSpace: "nowrap",
  border: 0,
} as const;

export function ScheduleContainer(): ReactNode {
  const scheduleT = useAppTranslation(Schedule);
  const sessionsT = useAppTranslation(Sessions);
  const locale = useAppLocale();
  const router = useRouter();

  // The visible week's opening UTC midnight — the ONLY navigation state.
  const [weekStart, setWeekStart] = useState<Date>(() => startOfWeekUtc(new Date(), WEEK_STARTS_ON[locale]));

  const { data, loading, error } = useQuery(myTeacherSessionsQueryDocument, {
    variables: { filter: null, page: null, pageSize: null },
  });

  const sessions: readonly ScheduleSession[] = data?.myTeacherSessions?.items ?? EMPTY_WEEK;

  const days = useMemo(() => groupSessionsByWeekDay(sessions, weekStart), [sessions, weekStart]);
  const stats = useMemo(() => weekStats(days), [days]);

  const goPrevWeek = useCallback(() => setWeekStart(current => addUtcDays(current, -7)), []);
  const goNextWeek = useCallback(() => setWeekStart(current => addUtcDays(current, 7)), []);
  const goThisWeek = useCallback(() => setWeekStart(startOfWeekUtc(new Date(), WEEK_STARTS_ON[locale])), [locale]);
  const openSessionsList = useCallback(() => router.push(TEACHER_SESSIONS_ROUTE), [router]);

  const rangeFrom = dayMonthYearStamp(weekStart, locale);
  const rangeTo = dayMonthYearStamp(addUtcDays(weekStart, 6), locale);
  const isCurrentWeek = isSameUtcDay(weekStart, startOfWeekUtc(new Date(), WEEK_STARTS_ON[locale]));

  // RTL: "previous" points RIGHT under the Arabic reading direction.
  const PrevIcon = locale === "ar" ? NextLtrIcon : PrevLtrIcon;
  const NextIcon = locale === "ar" ? PrevLtrIcon : NextLtrIcon;

  const statCards = [
    { label: scheduleT.weekSessionsLabel, value: String(stats.total), Icon: CalendarIcon },
    { label: scheduleT.weekActiveLabel, value: String(stats.active), Icon: UpcomingIcon },
    { label: scheduleT.weekCompletedLabel, value: String(stats.completed), Icon: DoneIcon },
    { label: scheduleT.weekCancelledLabel, value: String(stats.cancelled), Icon: CancelIcon },
  ] as const;

  return (
    <Stack data-testid="schedule-view" sx={{ gap: 3 }}>
      <Stack spacing={2}>
        <Typography variant="h5" component="h1" sx={{ fontWeight: 700 }}>
          {scheduleT.pageTitle}
        </Typography>
        <Stack direction="row" spacing={1.5} sx={{ alignItems: "center", flexWrap: "wrap", rowGap: 1 }}>
          <Typography
            variant="h6"
            component="h2"
            sx={theme => ({ color: theme.palette.text.secondary, fontWeight: 600 })}
          >
            {scheduleT.weekRangeLabel(rangeFrom, rangeTo)}
          </Typography>
          {/**
           * Week-change announcement: a mounted-always polite output region
           * (implicit role="status") whose text swaps with the navigator —
           * screen readers re-announce the visible week + its session count
           * on every prev/next/this-week hop without stealing focus.
           */}
          <Box component="output" sx={VISUALLY_HIDDEN_LIVE_REGION_SX}>
            {scheduleT.weekRangeLabel(rangeFrom, rangeTo)} · {scheduleT.dayCountLine(stats.total)}
          </Box>
          <Stack direction="row" spacing={1} sx={{ alignItems: "center", ml: "auto" }}>
            <Button size="small" variant="text" onClick={goThisWeek} disabled={isCurrentWeek}>
              {scheduleT.thisWeekLabel}
            </Button>
            <Tooltip title={scheduleT.previousWeekLabel}>
              <span>
                <Button
                  size="small"
                  variant="outlined"
                  aria-label={scheduleT.previousWeekLabel}
                  onClick={goPrevWeek}
                  sx={{ minWidth: 0, px: 1 }}
                >
                  <PrevIcon fontSize="small" />
                </Button>
              </span>
            </Tooltip>
            <Tooltip title={scheduleT.nextWeekLabel}>
              <span>
                <Button
                  size="small"
                  variant="outlined"
                  aria-label={scheduleT.nextWeekLabel}
                  onClick={goNextWeek}
                  sx={{ minWidth: 0, px: 1 }}
                >
                  <NextIcon fontSize="small" />
                </Button>
              </span>
            </Tooltip>
          </Stack>
        </Stack>
      </Stack>

      <ScheduleBody
        loading={loading}
        error={error}
        empty={sessions.length === 0}
        statCards={statCards}
        days={days}
        locale={locale}
        scheduleT={scheduleT}
        sessionsT={sessionsT}
        onOpenSession={openSessionsList}
      />
    </Stack>
  );
}
