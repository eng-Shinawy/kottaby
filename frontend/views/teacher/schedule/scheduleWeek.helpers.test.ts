/**
 * Paired suite — the teacher weekly planner's pure decision layer
 * (`scheduleWeek.helpers`), the UTC calendar math the schedule grid
 * renders directly.
 *
 * WHAT THIS LOCKS
 *   1. UTC DETERMINISM: buckets, week starts and anchors never consult
 *      the host timezone — a session at `2026-09-16T23:30:00Z` is a
 *      WEDNESDAY-16 session even on a UTC+14 host, and `addUtcDays`
 *      rolls over month/year boundaries without local-time drift.
 *   2. WEEK VOCABULARY: `startOfWeekUtc` normalizes mid-week days onto
 *      the correct opening column for BOTH locale conventions — `en`
 *      opens on SUNDAY, `ar` (the Egyptian week) opens on SATURDAY; the
 *      boundary day itself is an identity.
 *   3. ANCHOR FALLBACK: a session's grid day is its `startedAt`, and
 *      ONLY a session that never started falls back to `createdAt` —
 *      the anchor never invents a third source.
 *   4. GROUPING: `groupSessionsByWeekDay` always yields SEVEN buckets,
 *      sessions anchored outside the visible window are dropped (the
 *      week navigator owns reachability), and within-day order is
 *      chronologically ascending regardless of input order.
 *   5. HONEST STATS: the week strip is a partition-of-the-whole —
 *      DISPUTED sessions surface in `total` only (never silently
 *      reclassified as active/completed/cancelled), and NO fee
 *      arithmetic exists anywhere in the module (money discipline).
 *   6. WEEKEND TINT: `ar` marks Friday+Saturday, `en` marks
 *      Saturday+Sunday — the tint never follows the host locale.
 *   7. FORMATTERS: locale digits (`en` → `14:00`, `ar` → Arabic-Indic)
 *      with UTC components, cached per locale for render stability — and
 *      the h23 MIDNIGHT PIN: a session at UTC midnight stamps `00:00`
 *      (`٠٠:٠٠`), never the h24 `24:00` leak `hour12: false` can produce.
 *
 * FIXTURES: structural session literals cast to the generated item
 * shape (technical test data only, never rendered UI copy).
 *
 * RUNS VIA (in-sandbox): bun run test/scripts/run-test.ts
 * frontend/views/teacher/schedule/scheduleWeek.helpers.test.ts
 * — pure unit tier, no server boot, no DB, no React render.
 */

import { describe, expect, test } from "bun:test";
import { SessionStatus, SessionType } from "@/frontend/graphql/generated/gql/graphql";
import {
  addUtcDays,
  clockStamp,
  dayMonthYearStamp,
  groupSessionsByWeekDay,
  isSameUtcDay,
  isWeekendDay,
  type ScheduleSession,
  sessionAnchorIso,
  startOfWeekUtc,
  utcMidnight,
  WEEK_STARTS_ON,
  weekdayName,
  weekStats,
} from "@/frontend/views/teacher/schedule/scheduleWeek.helpers";

// ─── Fixtures ────────────────────────────────────────────────────────────────

/** The structural fields the helpers read (plus the required wire shape). */
function makeSession(overrides: {
  status: ScheduleSession["status"];
  createdAt: string;
  startedAt: string | null;
  id?: string;
}): ScheduleSession {
  return {
    id: overrides.id ?? "s1",
    status: overrides.status,
    intent: null,
    sessionType: SessionType.StudentSession,
    fee: "25.00",
    feeHeld: false,
    studentId: "4",
    teacherId: "2",
    startedAt: overrides.startedAt,
    endedAt: null,
    confirmationDeadline: null,
    confirmedByStudentAt: null,
    confirmedByTeacherAt: null,
    createdAt: overrides.createdAt,
    updatedAt: overrides.createdAt,
    cancelReason: null,
    disputeReason: null,
    disputedAt: null,
    resolutionNote: null,
    resolutionOutcome: null,
    resolvedAt: null,
    // Counterpart identity objects (nullable in the wire shape; the schedule
    // week helpers never read them, so the fixtures carry the honest null).
    student: null,
    teacher: null,
  };
}

/** Wed 2026-09-16 23:30 UTC — the DST-edgeproof probe instant. */
const WED_2330 = "2026-09-16T23:30:00Z";
const WED_NIGHT = new Date(WED_2330);

// ─── 1. UTC calendar primitives ──────────────────────────────────────────────

describe("schedule week primitives — UTC determinism", () => {
  test("utcMidnight normalizes any instant onto its UTC day", () => {
    const midnight = utcMidnight(WED_NIGHT);
    expect(midnight.toISOString()).toBe("2026-09-16T00:00:00.000Z");
  });

  test("addUtcDays rolls over month and year boundaries", () => {
    expect(addUtcDays(new Date("2026-09-30T12:00:00Z"), 1).toISOString()).toBe("2026-10-01T00:00:00.000Z");
    expect(addUtcDays(new Date("2026-12-31T12:00:00Z"), 1).toISOString()).toBe("2027-01-01T00:00:00.000Z");
    expect(addUtcDays(new Date("2026-03-01T00:00:00Z"), -1).toISOString()).toBe("2026-02-28T00:00:00.000Z");
  });

  test("isSameUtcDay ignores the clock and never crosses days", () => {
    expect(isSameUtcDay(new Date("2026-09-16T00:00:00Z"), new Date("2026-09-16T23:59:59Z"))).toBe(true);
    expect(isSameUtcDay(new Date("2026-09-16T23:30:00Z"), new Date("2026-09-17T00:00:00Z"))).toBe(false);
  });
});

// ─── 2. Week vocabulary per locale ───────────────────────────────────────────

describe("startOfWeekUtc — locale week conventions", () => {
  test("en opens the week on SUNDAY", () => {
    expect(startOfWeekUtc(WED_NIGHT, WEEK_STARTS_ON.en).toISOString()).toBe("2026-09-13T00:00:00.000Z");
    // Identity on the boundary itself.
    expect(startOfWeekUtc(new Date("2026-09-13T10:00:00Z"), WEEK_STARTS_ON.en).toISOString()).toBe(
      "2026-09-13T00:00:00.000Z"
    );
  });

  test("ar (Egyptian week) opens the week on SATURDAY", () => {
    expect(startOfWeekUtc(WED_NIGHT, WEEK_STARTS_ON.ar).toISOString()).toBe("2026-09-12T00:00:00.000Z");
    expect(startOfWeekUtc(new Date("2026-09-12T10:00:00Z"), WEEK_STARTS_ON.ar).toISOString()).toBe(
      "2026-09-12T00:00:00.000Z"
    );
  });
});

// ─── 3. Anchor fallback ──────────────────────────────────────────────────────

describe("sessionAnchorIso — start moment first, booking moment fallback", () => {
  test("uses startedAt when the session started", () => {
    const session = makeSession({
      status: SessionStatus.Completed,
      createdAt: WED_2330,
      startedAt: "2026-09-17T08:00:00Z",
    });
    expect(sessionAnchorIso(session)).toBe("2026-09-17T08:00:00Z");
  });

  test("falls back to createdAt when the session never started", () => {
    const session = makeSession({ status: SessionStatus.Cancelled, createdAt: WED_2330, startedAt: null });
    expect(sessionAnchorIso(session)).toBe(WED_2330);
  });
});

// ─── 4. Grouping ─────────────────────────────────────────────────────────────

describe("groupSessionsByWeekDay — seven buckets, honest windows", () => {
  test("always yields seven day buckets", () => {
    const days = groupSessionsByWeekDay([], startOfWeekUtc(WED_NIGHT, WEEK_STARTS_ON.ar));
    expect(days).toHaveLength(7);
    expect(days.every(day => day.startsAt.getUTCHours() === 0)).toBe(true);
  });

  test("sessions land on their UTC anchor day; out-of-window sessions drop", () => {
    const inWindow = [
      makeSession({
        id: "a",
        status: SessionStatus.Completed,
        createdAt: "2026-09-16T10:00:00Z",
        startedAt: "2026-09-16T10:00:00Z",
      }),
      makeSession({ id: "b", status: SessionStatus.Scheduled, createdAt: "2026-09-14T09:00:00Z", startedAt: null }),
    ];
    const outOfWindow = [
      makeSession({
        id: "x",
        status: SessionStatus.Completed,
        createdAt: "2026-09-01T10:00:00Z",
        startedAt: "2026-09-01T10:00:00Z",
      }),
      makeSession({
        id: "y",
        status: SessionStatus.Completed,
        createdAt: "2026-10-20T10:00:00Z",
        startedAt: "2026-10-20T10:00:00Z",
      }),
    ];
    const days = groupSessionsByWeekDay([...inWindow, ...outOfWindow], startOfWeekUtc(WED_NIGHT, WEEK_STARTS_ON.ar));
    // Mon 14th (index 2) carries the scheduled row; Wed 16th (index 4) the completed one.
    expect(days[2].sessions.map(session => session.id)).toEqual(["b"]);
    expect(days[4].sessions.map(session => session.id)).toEqual(["a"]);
    expect(days.reduce((sum, day) => sum + day.sessions.length, 0)).toBe(2);
  });

  test("within-day order is chronologically ascending regardless of input order", () => {
    const later = makeSession({
      id: "late",
      status: SessionStatus.Completed,
      createdAt: "2026-09-16T20:00:00Z",
      startedAt: "2026-09-16T20:00:00Z",
    });
    const earlier = makeSession({
      id: "early",
      status: SessionStatus.Completed,
      createdAt: "2026-09-16T08:00:00Z",
      startedAt: "2026-09-16T08:00:00Z",
    });
    const days = groupSessionsByWeekDay([later, earlier], startOfWeekUtc(WED_NIGHT, WEEK_STARTS_ON.en));
    expect(days[3].sessions.map(session => session.id)).toEqual(["early", "late"]);
  });
});

// ─── 5. Honest stats ─────────────────────────────────────────────────────────

describe("weekStats — partition of the whole, disputed counts as total only", () => {
  test("statuses partition without reclassification", () => {
    const days = [
      {
        startsAt: new Date("2026-09-12T00:00:00Z"),
        sessions: [
          makeSession({ id: "1", status: SessionStatus.Scheduled, createdAt: WED_2330, startedAt: null }),
          makeSession({
            id: "2",
            status: SessionStatus.Started,
            createdAt: WED_2330,
            startedAt: "2026-09-12T08:00:00Z",
          }),
          makeSession({
            id: "3",
            status: SessionStatus.Completed,
            createdAt: WED_2330,
            startedAt: "2026-09-13T08:00:00Z",
          }),
          makeSession({ id: "4", status: SessionStatus.Cancelled, createdAt: WED_2330, startedAt: null }),
          makeSession({
            id: "5",
            status: SessionStatus.Disputed,
            createdAt: WED_2330,
            startedAt: "2026-09-14T08:00:00Z",
          }),
        ],
      },
    ];
    expect(weekStats(days)).toEqual({ total: 5, active: 2, completed: 1, cancelled: 1 });
  });

  test("an empty week is all zeros — never null, never fabricated", () => {
    expect(weekStats([])).toEqual({ total: 0, active: 0, completed: 0, cancelled: 0 });
  });
});

// ─── 6. Weekend tint ─────────────────────────────────────────────────────────

describe("isWeekendDay — locale-owned weekend sets", () => {
  const FRIDAY = new Date("2026-09-18T00:00:00Z");
  const SATURDAY = new Date("2026-09-19T00:00:00Z");
  const SUNDAY = new Date("2026-09-13T00:00:00Z");
  const MONDAY = new Date("2026-09-14T00:00:00Z");

  test("ar marks Friday + Saturday", () => {
    expect(isWeekendDay(FRIDAY, "ar")).toBe(true);
    expect(isWeekendDay(SATURDAY, "ar")).toBe(true);
    expect(isWeekendDay(SUNDAY, "ar")).toBe(false);
    expect(isWeekendDay(MONDAY, "ar")).toBe(false);
  });

  test("en marks Saturday + Sunday", () => {
    expect(isWeekendDay(FRIDAY, "en")).toBe(false);
    expect(isWeekendDay(SATURDAY, "en")).toBe(true);
    expect(isWeekendDay(SUNDAY, "en")).toBe(true);
    expect(isWeekendDay(MONDAY, "en")).toBe(false);
  });
});

// ─── 7. Formatters ───────────────────────────────────────────────────────────

describe("schedule formatters — UTC components, locale digits", () => {
  test("weekdayName resolves long names per locale", () => {
    expect(weekdayName(WED_NIGHT, "en")).toBe("Wednesday");
    expect(weekdayName(WED_NIGHT, "ar")).toContain("الأربعاء");
  });

  test("clockStamp uses 24h UTC with locale digits", () => {
    expect(clockStamp(WED_2330, "en")).toBe("23:30");
    // Arabic-Indic zero is U+0660 — the ar stamp must NOT contain Latin digits.
    const arStamp = clockStamp(WED_2330, "ar");
    expect(arStamp).toContain("٢٣");
    expect(/\d/.test(arStamp)).toBe(false);
  });

  test("clockStamp pins UTC midnight to the h23 cycle — 00:xx, never 24:xx", () => {
    const MIDNIGHT = "2026-09-16T00:00:00Z";
    // `hour12: false` selects the locale's DEFAULT h24 pattern, which some
    // ICU locale datasets define as h24 (midnight → `24:00`); the h23 pin
    // guarantees the `00:` hour regardless of host ICU data.
    expect(clockStamp(MIDNIGHT, "en")).toBe("00:00");
    expect(clockStamp(MIDNIGHT, "en").startsWith("24:")).toBe(false);
    // Arabic-Indic zero hour (`٠٠:`) — a leading `٢٤:` would be the h24 leak.
    const arMidnight = clockStamp(MIDNIGHT, "ar");
    expect(arMidnight.startsWith("٠٠:")).toBe(true);
    expect(arMidnight.startsWith("٢٤:")).toBe(false);
  });

  test("dayMonthYearStamp includes the year for the range label", () => {
    expect(dayMonthYearStamp(WED_NIGHT, "en")).toContain("2026");
    expect(dayMonthYearStamp(WED_NIGHT, "ar")).toContain("٢٠٢٦");
  });
});
