/**
 * TeacherMatchingSort enum test — the pure unit tier (NO DB, NO schema
 * imports). The vocabulary is a pure transport selector, so the suite pins
 * the exact member set: the canonical wire values frozen as declared, plus
 * the member count (an added/renamed member is a breaking browse-contract
 * change that must land with a deliberate pin update, never silently).
 */
import { describe, expect, test } from "bun:test";
import { TeacherMatchingSort } from "@/backend/enum/teachers/teacher-matching-sort.enum";

describe("TeacherMatchingSort", () => {
  test("canonical value set frozen exactly as declared", () => {
    expect((Object.values(TeacherMatchingSort) as string[]).join("|")).toBe("RATING_DESC|NAME_ASC|NEWEST");
  });

  test("exposes exactly the three members", () => {
    expect(Object.keys(TeacherMatchingSort).toSorted((a, b) => a.localeCompare(b))).toEqual([
      "NameAsc",
      "Newest",
      "RatingDesc",
    ]);
  });

  test("every member value is its own wire token (key mirrors value vocabulary)", () => {
    // The members are widened to `string` so the wire-token literal comparison
    // type-checks against bun:test's generic `toBe(actual: T)` (a SCREAMING_CASE
    // string is not assignable to the enum type itself).
    expect(TeacherMatchingSort.RatingDesc as string).toBe("RATING_DESC");
    expect(TeacherMatchingSort.NameAsc as string).toBe("NAME_ASC");
    expect(TeacherMatchingSort.Newest as string).toBe("NEWEST");
  });
});
