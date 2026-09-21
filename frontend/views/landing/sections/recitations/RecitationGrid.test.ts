import { describe, expect, test } from "bun:test";
import { RecitationGrid } from "@/frontend/views/landing/sections/recitations/RecitationGrid";

describe("RecitationGrid", () => {
  test("is memoized with React.memo", () => {
    expect(RecitationGrid).toHaveProperty("$$typeof", Symbol.for("react.memo"));
  });
});
