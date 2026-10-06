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
 *   2. ROLE STAT SHAPES: each role gets EXACTLY its own strip — student
 *      (FIVE cards: completed / upcoming / active subscriptions / prepaid
 *      credit total / unread — the balance card is the shared WalletIcon
 *      slot, now fed by the caller's own `mySessionBalance` lanes),
 *      teacher (completed / balance / upcoming / unread), parent (linked
 *      children / reports received / total sessions / unread), admin
 *      (total users / teachers / students / unread).
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
 *   6. PREPAID-CREDIT TOTAL: `sumStudentSessionBalance` sums the four
 *      `mySessionBalance` lanes — the NOT NULL trial lane plus the three
 *      nullable purchased lanes coalesced to 0 (a null lane record
 *      carries no credits). The sum NEVER includes subscription
 *      coverage: prepaid lanes only.
 *   7. STAT-STRIP GRID TEMPLATE: `statGridTemplate` adapts the
 *      responsive `gridTemplateColumns` to the strip's card count —
 *      ≤4 keeps the original 4-up md row; the student strip's FIVE
 *      cards balance 3+2 at md/lg and go 5-up at xl (the fixed 4-up
 *      template wrapped the Balance card alone as an orphan row on
 *      md/lg); >5 is defensive (3-up md / 4-up xl) so an oversized
 *      strip still wraps without a lone trailing card.
 *   8. BALANCE-BREAKDOWN LANES: the STUDENT payload additionally carries
 *      the four display lanes (`sessionCreditLanes`, resolved by
 *      `studentSessionCreditLanes` from the SAME wire object the sum
 *      reads — wire-null purchased lanes → 0); the tri-state mirrors the
 *      balance query (loading → `undefined`, failed → `null`, resolved →
 *      four numbers) WITHOUT touching the SUM card's semantics, and the
 *      teacher / parent / admin payloads NEVER carry lanes.
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
  statGridTemplate,
  studentSessionCreditLanes,
  sumStudentSessionBalance,
} from "@/frontend/views/dashboard/home/useDashboardStats.helpers";

/** Fully-resolved student payload — every card has an honest value, and the balance card carries its four display lanes. */
const STUDENT_DATA: DashboardStatsData = {
  completedSessionsCount: 12,
  upcomingSessionsCount: 2,
  activeSubscriptionsCount: 1,
  sessionCreditsTotal: 5,
  sessionCreditLanes: { trial: 1, hifz: 3, tajweed: 0, reviews: 1 },
  unreadNotificationsCount: 3,
};

/** Fully-resolved teacher payload — the balance rides as the raw decimal string. NO lanes: the wallet has no prepaid-lane breakdown. */
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
  test("student strip: completed / upcoming / active subscriptions / prepaid credits / unread", () => {
    expect(resolveStatDrafts("Student", STUDENT_DATA)).toEqual([
      { key: "sessionsCompleted", value: "12", unavailable: false },
      { key: "upcoming", value: "2", unavailable: false },
      { key: "activeSubscriptions", value: "1", unavailable: false },
      { key: "balance", value: "5", unavailable: false },
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

  test("the student balance slot rides the shared WalletIcon card and mirrors the balance query's tri-state", () => {
    const keys = resolveStatDrafts("Student", STUDENT_DATA).map(draft => draft.key);
    expect(keys).toContain("balance");
    expect(keys).toHaveLength(5);
    // Balance query still resolving (field absent) → the loading sentinel.
    const loading = resolveStatDrafts("Student", { ...STUDENT_DATA, sessionCreditsTotal: undefined });
    expect(loading.find(draft => draft.key === "balance")).toEqual({
      key: "balance",
      value: "",
      unavailable: false,
    });
    // Balance query failed (null) → the unavailable marker, siblings intact.
    const failed = resolveStatDrafts("Student", { ...STUDENT_DATA, sessionCreditsTotal: null });
    expect(failed.find(draft => draft.key === "balance")).toEqual({
      key: "balance",
      value: STAT_UNAVAILABLE,
      unavailable: true,
    });
    expect(failed.find(draft => draft.key === "sessionsCompleted")?.value).toBe("12");
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
      sessionCreditsTotal: 0,
      unreadNotificationsCount: 0,
    });
    // Five cards for the student — an all-zero prepaid lane set is the
    // empty reality the credits card honestly announces (never a dash).
    expect(drafts.map(draft => draft.value)).toEqual(["0", "0", "0", "0", "0"]);
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

describe("sumStudentSessionBalance — prepaid lane sum", () => {
  test("sums the four lanes; the trial lane is NOT NULL, purchased lanes ride their real values", () => {
    expect(sumStudentSessionBalance({ balanceTrial: 1, balanceHifz: 3, balanceTajweed: 2, balanceReviews: 4 })).toBe(
      10
    );
  });

  test("null purchased lanes coalesce to 0 (a null lane record carries no credits)", () => {
    expect(
      sumStudentSessionBalance({ balanceTrial: 2, balanceHifz: null, balanceTajweed: 3, balanceReviews: null })
    ).toBe(5);
  });

  test("an all-null purchased set over a zero trial lane is the honest zero", () => {
    expect(
      sumStudentSessionBalance({ balanceTrial: 0, balanceHifz: null, balanceTajweed: null, balanceReviews: null })
    ).toBe(0);
  });
});

describe("statGridTemplate — strip-card-count buckets", () => {
  test("<= 4 cards keeps the original template (single phone column, 2-up sm, 4-up md)", () => {
    // 0 is unreachable at the call site (the view guards an empty strip)
    // but the pure function is total — the original template is the floor.
    expect(statGridTemplate(0)).toEqual({ xs: "1fr", sm: "1fr 1fr", md: "repeat(4, 1fr)" });
    // teacher / parent / admin strips: exactly four cards.
    expect(statGridTemplate(4)).toEqual({ xs: "1fr", sm: "1fr 1fr", md: "repeat(4, 1fr)" });
  });

  test("the student strip's 5 cards balance 3+2 at md/lg and go 5-up at xl (no orphan fifth card)", () => {
    expect(statGridTemplate(5)).toEqual({ xs: "1fr", sm: "1fr 1fr", md: "repeat(3, 1fr)", xl: "repeat(5, 1fr)" });
  });

  test("> 5 (defensive) wraps 3-up md / 4-up xl so an oversized strip never orphans a lone card", () => {
    expect(statGridTemplate(6)).toEqual({ xs: "1fr", sm: "1fr 1fr", md: "repeat(3, 1fr)", xl: "repeat(4, 1fr)" });
    expect(statGridTemplate(9)).toEqual({ xs: "1fr", sm: "1fr 1fr", md: "repeat(3, 1fr)", xl: "repeat(4, 1fr)" });
  });
});

describe("sessionCreditLanes — the balance card's breakdown payload", () => {
  test("the resolved STUDENT payload carries the four display lanes; teacher/parent/admin NEVER do", () => {
    expect(STUDENT_DATA.sessionCreditLanes).toEqual({ trial: 1, hifz: 3, tajweed: 0, reviews: 1 });
    expect(TEACHER_DATA.sessionCreditLanes).toBeUndefined();
    expect(PARENT_DATA.sessionCreditLanes).toBeUndefined();
    expect(ADMIN_DATA.sessionCreditLanes).toBeUndefined();
  });

  test("studentSessionCreditLanes coalesces wire-null purchased lanes to 0; the trial lane passes through verbatim", () => {
    expect(
      studentSessionCreditLanes({ balanceTrial: 2, balanceHifz: null, balanceTajweed: 5, balanceReviews: null })
    ).toEqual({ trial: 2, hifz: 0, tajweed: 5, reviews: 0 });
    expect(
      studentSessionCreditLanes({ balanceTrial: 0, balanceHifz: null, balanceTajweed: null, balanceReviews: null })
    ).toEqual({ trial: 0, hifz: 0, tajweed: 0, reviews: 0 });
  });

  test("the lane payload tri-state mirrors the balance query without touching the SUM card's semantics", () => {
    // Resolved: the lanes ride ALONGSIDE the unchanged sum draft.
    const resolved = resolveStatDrafts("Student", STUDENT_DATA);
    expect(resolved.find(draft => draft.key === "balance")).toEqual({
      key: "balance",
      value: "5",
      unavailable: false,
    });
    // Loading (field absent — buildStudentStats emits undefined): same sum draft, skeleton lanes.
    const loading: DashboardStatsData = { ...STUDENT_DATA, sessionCreditLanes: undefined };
    expect(loading.sessionCreditsTotal).toBe(5);
    expect(loading.sessionCreditLanes).toBeUndefined();
    // Failed (buildStudentStats emits null via the shared resolver): the SUM card keeps its
    // "—" semantics independently — the popover renders the unavailable treatment instead.
    const failed: DashboardStatsData = { ...STUDENT_DATA, sessionCreditLanes: null, sessionCreditsTotal: null };
    expect(failed.sessionCreditLanes).toBeNull();
    expect(resolveStatDrafts("Student", failed).find(draft => draft.key === "balance")).toEqual({
      key: "balance",
      value: STAT_UNAVAILABLE,
      unavailable: true,
    });
  });
});
