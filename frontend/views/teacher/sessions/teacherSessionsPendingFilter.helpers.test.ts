/**
 * Pure-unit tests for the pending-rubric sessions filter (the teacher
 * sessions banner's "show only these" lane).
 *
 * Pure unit tier — NO server boot, NO network, NO DB. Runs via the
 * mandated runner: `bun run test/scripts/run-test.ts frontend/views/teacher/sessions/teacherSessionsPendingFilter.helpers.test.ts`.
 */

import { describe, expect, test } from "bun:test";
import type { MyTeacherSessionsQuery_myTeacherSessions_items } from "@/frontend/graphql/generated/gql/graphql";
import { filterSessionsAwaitingRubric } from "@/frontend/views/teacher/sessions/teacherSessionsPendingFilter.helpers";

/** A minimal row factory — the filter reads ONLY the `id` field. */
function row(id: string): MyTeacherSessionsQuery_myTeacherSessions_items {
  // The filter reads ONLY the `id` field; the JSON round-trip mints the
  // minimal row without an unsafe assertion.
  return JSON.parse(JSON.stringify({ id }));
}

describe("filterSessionsAwaitingRubric", () => {
  test("keeps ONLY rows whose id sits in the pending set, preserving list order", () => {
    const sessions = [row("a"), row("b"), row("c"), row("d")];
    const pending = new Set(["d", "b"]);
    const filtered = filterSessionsAwaitingRubric(sessions, pending);
    expect(filtered.map(s => s.id)).toEqual(["b", "d"]);
  });

  test("an empty pending set filters EVERYTHING out (the post-final-submission state)", () => {
    const sessions = [row("a"), row("b")];
    expect(filterSessionsAwaitingRubric(sessions, new Set())).toEqual([]);
  });

  test("a pending set with unknown ids filters nothing unexpected (id-set membership is exact)", () => {
    const sessions = [row("a"), row("b")];
    const pending = new Set(["a", "zzz-not-on-page"]);
    expect(filterSessionsAwaitingRubric(sessions, pending).map(s => s.id)).toEqual(["a"]);
  });

  test("an empty settled page yields an empty result (no invention)", () => {
    expect(filterSessionsAwaitingRubric([], new Set(["a"]))).toEqual([]);
  });
});
