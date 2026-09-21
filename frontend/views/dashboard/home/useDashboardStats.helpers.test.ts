/**
 * Paired suite — the dashboard stat strip's pure decision layer
 * (`useDashboardStats.helpers`), the role dispatch the stats hook feeds
 * raw query outcomes into.
 *
 * WHAT THIS LOCKS
 *   1. HONEST ZERO vs UNAVAILABLE vs LOADING: a resolved `0` renders as
 *      the value "0" (an empty reality, never an error); `null` (failed
 *      query) renders the unavailable marker with `unavailable: true`;
 *      `undefined` (still loading) renders the empty-string sentinel the
 *      view maps to a skeleton — the three states never blur.
 *   2. ROLE STAT SHAPES: each role gets EXACTLY its own four-card strip —
 *      student (completed / upcoming / active subscriptions / unread),
 *      teacher (completed / balance / upcoming / unread), parent (linked
 *      children / reports received / total sessions / unread), admin
 *      (total users / teachers / students / unread). The student strip
 *      has NO balance card (no student wallet read surface exists) — the
 *      slot is swapped, not dash-primed.
 *   3. BALANCE VERBATIM: the teacher's wallet balance passes through as
 *      the raw decimal string — never parsed, reformatted, or rounded.
 *   4. ROLE DISPATCH: the capitalized wire names ("Student" / "Teacher" /
 *      "Parent" / "Admin" — the GraphQL enum NAMEs) resolve to their
 *      builders; an unrecognized or missing role yields an EMPTY strip
 *      (no cards rather than invented data).
 *   5. ACTIVE-SUBSCRIPTION COUNT: only `Active` lifecycle rows count —
 *      pending purchases, expired and suspended periods are excluded;
 *      `undefined`/`null` inputs (loading/failed) propagate as
 *      `undefined` so the card keeps its skeleton instead of flashing 0.
 *
 * FIXTURES: plain literal inputs (the module is pure) — technical test
 * data only, never rendered UI copy.
 *
 * RUNS VIA (in-sandbox): bun run test/scripts/run-test.ts
 * frontend/views/dashboard/home/useDashboardStats.helpers.test.ts
 * — pure unit tier, no server boot, no DB, no React render.
 */

import { describe, expect, test } from "bun:test";
import {
  countActiveSubscriptions,
  type DashboardStatsData,
  resolveStatDrafts,
  STAT_UNAVAILABLE,
} from "@/frontend/views/dashboard/home/useDashboardStats.helpers";

/** Fully-resolved student payload — every card has an honest value. */
const STUDENT_DATA: DashboardStatsData = {
  completedSessionsCount: 12,
  upcomingSessionsCount: 2,
  activeSubscriptionsCount: 1,
  unreadNotificationsCount: 3,
};

/** Fully-resolved teacher payload — the balance rides as the raw decimal string. */
const TEACHER_DATA: DashboardStatsData = {
  completedSessionsCount: 34,
  upcomingSessionsCount: 3,
  walletBalance: "1250.50",
  unreadNotificationsCount: 2,
};

/** Fully-resolved parent payload — the two aggregates span two linked children. */
const PARENT_DATA: DashboardStatsData = {
  linkedChildrenCount: 2,
  reportsReceivedCount: 5,
  totalSessionsCount: 9,
  unreadNotificationsCount: 1,
};

/** Fully-resolved admin payload — the platform account mix. */
const ADMIN_DATA: DashboardStatsData = {
  totalUsersCount: 128,
  teachersCount: 14,
  studentsCount: 97,
  unreadNotificationsCount: 5,
};

describe("resolveStatDrafts — role dispatch", () => {
  test("student strip: completed / upcoming / active subscriptions / unread", () => {
    expect(resolveStatDrafts("Student", STUDENT_DATA)).toEqual([
      { key: "sessionsCompleted", value: "12", unavailable: false },
      { key: "upcoming", value: "2", unavailable: false },
      { key: "activeSubscriptions", value: "1", unavailable: false },
      { key: "notifications", value: "3", unavailable: false },
    ]);
  });

  test("teacher strip: completed / balance (verbatim) / upcoming / unread", () => {
    expect(resolveStatDrafts("Teacher", TEACHER_DATA)).toEqual([
      { key: "sessionsCompleted", value: "34", unavailable: false },
      { key: "balance", value: "1250.50", unavailable: false },
      { key: "upcoming", value: "3", unavailable: false },
      { key: "notifications", value: "2", unavailable: false },
    ]);
  });

  test("parent strip: linked children / reports received / total sessions / unread", () => {
    expect(resolveStatDrafts("Parent", PARENT_DATA)).toEqual([
      { key: "linkedChildren", value: "2", unavailable: false },
      { key: "reportsReceived", value: "5", unavailable: false },
      { key: "totalSessions", value: "9", unavailable: false },
      { key: "notifications", value: "1", unavailable: false },
    ]);
  });

  test("admin strip: total users / teachers / students / unread", () => {
    expect(resolveStatDrafts("Admin", ADMIN_DATA)).toEqual([
      { key: "totalUsers", value: "128", unavailable: false },
      { key: "totalTeachers", value: "14", unavailable: false },
      { key: "totalStudents", value: "97", unavailable: false },
      { key: "notifications", value: "5", unavailable: false },
    ]);
  });

  test("the student strip has NO balance slot — the gap is a slot swap, not a dash", () => {
    const keys = resolveStatDrafts("Student", STUDENT_DATA).map(draft => draft.key);
    expect(keys).not.toContain("balance");
    expect(keys).toHaveLength(4);
  });

  test("an unrecognized or missing role yields an EMPTY strip", () => {
    expect(resolveStatDrafts("Root", STUDENT_DATA)).toEqual([]);
    expect(resolveStatDrafts(null, STUDENT_DATA)).toEqual([]);
    expect(resolveStatDrafts(undefined, STUDENT_DATA)).toEqual([]);
  });
});

describe("resolveStatDrafts — zero / unavailable / loading posture", () => {
  test("a resolved zero renders as the honest value '0', never the unavailable marker", () => {
    const drafts = resolveStatDrafts("Student", {
      completedSessionsCount: 0,
      upcomingSessionsCount: 0,
      activeSubscriptionsCount: 0,
      unreadNotificationsCount: 0,
    });
    expect(drafts.map(draft => draft.value)).toEqual(["0", "0", "0", "0"]);
    expect(drafts.every(draft => !draft.unavailable)).toBe(true);
  });

  test("a failed query (null) renders the unavailable marker with unavailable: true", () => {
    const drafts = resolveStatDrafts("Teacher", {
      completedSessionsCount: 34,
      upcomingSessionsCount: 3,
      walletBalance: null,
      unreadNotificationsCount: null,
    });
    expect(drafts.find(draft => draft.key === "balance")).toEqual({
      key: "balance",
      value: STAT_UNAVAILABLE,
      unavailable: true,
    });
    expect(drafts.find(draft => draft.key === "notifications")?.unavailable).toBe(true);
    // Sibling stats stay resolved — one failed query never blanks the strip.
    expect(drafts.find(draft => draft.key === "sessionsCompleted")?.value).toBe("34");
  });

  test("a still-loading query (undefined) renders the empty loading sentinel", () => {
    const drafts = resolveStatDrafts("Parent", {
      linkedChildrenCount: undefined,
      reportsReceivedCount: 5,
      totalSessionsCount: 9,
      unreadNotificationsCount: 1,
    });
    const loading = drafts.find(draft => draft.key === "linkedChildren");
    expect(loading?.value).toBe("");
    expect(loading?.unavailable).toBe(false);
  });
});

describe("countActiveSubscriptions", () => {
  test("counts ONLY Active lifecycle rows", () => {
    expect(
      countActiveSubscriptions([
        { status: "Active" },
        { status: "Pending" },
        { status: "Expired" },
        { status: "Active" },
        { status: "Suspended" },
        { status: "Cancelled" },
      ])
    ).toBe(2);
  });

  test("an empty list is an honest zero", () => {
    expect(countActiveSubscriptions([])).toBe(0);
  });

  test("loading (undefined) and failed (null) inputs propagate as undefined", () => {
    expect(countActiveSubscriptions(undefined)).toBeUndefined();
    expect(countActiveSubscriptions(null)).toBeUndefined();
  });
});
