/**
 * Paired suite — the homework tab's completion-notification deep-link
 * highlight: the `?session=` pointer the detail container threads through
 * `renderTabContent` lands on the homework row whose owning session it
 * names, with the SAME match + scroll mechanism the reports tab applies.
 *
 * WHAT THIS LOCKS
 *   1. THE MATCH RULE: a homework row is the highlight target exactly when
 *      the pointer is present and equals the row's owning session id — the
 *      one shared decision (`isDeepLinkTargetRow`) every content tab's row
 *      applies, so a single link highlights the same session everywhere.
 *   2. THE THREADING: the body renderer hands the pointer to EVERY mounted
 *      homework row untouched — no row is skipped, no pointer is rewritten,
 *      and exactly the matching row becomes the target.
 *   3. NO POINTER, NO HIGHLIGHT: with the pointer absent from the page data
 *      every row renders unhighlighted (the scroll precondition is false),
 *      and while the tab's read is still pending only the skeleton mounts —
 *      there is no row surface to scroll and nothing to crash.
 *   4. RAPID SWITCHES: the decision is a pure function of the CURRENT
 *      pointer and row id — alternating pointers recompute cleanly, every
 *      body render carries exactly its own render's pointer, and a remount
 *      without data mounts no stale rows.
 *   5. CLOSED ROW SURFACE: the pointer reaches a row ONLY as the highlight
 *      input — the row's prop surface stays `{ row, labels, locale,
 *      deepLinkSessionId }`, the row object is passed through unmodified,
 *      and a session id absent from the child's own rows highlights nothing.
 *
 * FIXTURES: plain literal rows (technical test data — ids, dates, grades)
 * + the real `parentMonitoring` locale leaf for the labels object. The
 * React tree is inspected as plain elements — no DOM, no renderer.
 *
 * RUNS VIA (in-sandbox): bun run test/scripts/run-test.ts
 * frontend/views/parent/monitoring/HomeworkTab.sessionHighlight.test.ts
 */

import { describe, expect, test } from "bun:test";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import type { ParentChildHomeworkQuery_parentChildHomework_items } from "@/frontend/graphql/generated/gql/graphql";
import { renderHomeworkBody } from "@/frontend/views/parent/monitoring/HomeworkTab.body";
import { HomeworkRow, HomeworkSkeleton } from "@/frontend/views/parent/monitoring/HomeworkTab.parts";
import { isDeepLinkTargetRow } from "@/frontend/views/parent/monitoring/ParentChildDetailContainer.helpers";
import { DEFAULT_SORT, type SearchFilterState } from "@/frontend/views/parent/monitoring/SearchFilterBar.helpers";
import { getDefaultTranslations } from "@/shared/locale/server";
import type { ParentMonitoringLabels } from "@/shared/locale/types/parentMonitoring";

const t: ParentMonitoringLabels = getDefaultTranslations().parentMonitoringTranslations;
const NO_ERROR = undefined;
const NO_FILTER: SearchFilterState = { query: "", ratingFilter: null, sort: DEFAULT_SORT };

const LINKED_SESSION = 2077;
const OTHER_SESSION = 314;
const THIRD_SESSION = 77;
const FOREIGN_SESSION = 2_000_000_000;

function homeworkRowFixture(
  id: string,
  sessionId: number,
  jadidGrade: number | null
): ParentChildHomeworkQuery_parentChildHomework_items {
  return {
    id,
    sessionId,
    createdAt: "2026-09-18T10:00:00.000Z",
    jadid: { surahJuz: null, fromAyah: 1, toAyah: 5, grade: jadidGrade },
    madi: null,
  };
}

function renderedBody(
  rows: readonly ParentChildHomeworkQuery_parentChildHomework_items[] | undefined,
  session: number | null
): ReactNode {
  return renderHomeworkBody(
    rows,
    rows,
    NO_ERROR,
    false,
    { internalServerError: "internal error stub" },
    { retry: "retry stub" },
    t,
    "en",
    session,
    NO_FILTER,
    () => undefined,
    () => Promise.resolve()
  );
}

// ---------------------------------------------------------------------------
// Plain-element inspection of the returned React tree (no renderer, no DOM)

function isReactNode(value: unknown): value is ReactNode {
  return (
    value === null ||
    value === undefined ||
    typeof value === "boolean" ||
    typeof value === "string" ||
    typeof value === "number" ||
    isValidElement(value) ||
    Array.isArray(value)
  );
}

function childNodesOf(element: ReactElement): readonly ReactNode[] {
  const props: unknown = element.props;
  if (typeof props !== "object" || props === null) return [];
  const children: unknown = Reflect.get(props, "children");
  if (!isReactNode(children)) return [];
  return Array.isArray(children) ? children : [children];
}

function visitElementTree(node: ReactNode, into: ReactElement[]): void {
  if (!isReactNode(node)) return;
  if (Array.isArray(node)) {
    for (const child of node) {
      visitElementTree(child, into);
    }
    return;
  }
  if (isValidElement(node)) {
    into.push(node);
    for (const child of childNodesOf(node)) {
      visitElementTree(child, into);
    }
  }
}

function allElementsOf(node: ReactNode): readonly ReactElement[] {
  const found: ReactElement[] = [];
  visitElementTree(node, found);
  return found;
}

function rowElementsOf(node: ReactNode): readonly ReactElement[] {
  return allElementsOf(node).filter(element => element.type === HomeworkRow);
}

function propOf(element: ReactElement, key: string): unknown {
  const props: unknown = element.props;
  if (typeof props !== "object" || props === null) return undefined;
  return Reflect.get(props, key);
}

function propKeysOf(element: ReactElement): readonly string[] {
  const props: unknown = element.props;
  if (typeof props !== "object" || props === null) return [];
  return Object.keys(props);
}

function rowSessionIdOf(element: ReactElement): number | undefined {
  const row: unknown = propOf(element, "row");
  if (typeof row !== "object" || row === null || !("sessionId" in row)) return undefined;
  const sessionId: unknown = Reflect.get(row, "sessionId");
  return typeof sessionId === "number" ? sessionId : undefined;
}

function deepLinkSessionIdOf(element: ReactElement): number | null {
  const value: unknown = propOf(element, "deepLinkSessionId");
  return typeof value === "number" ? value : null;
}

function requireRowElement(elements: readonly ReactElement[], message: string): ReactElement {
  const element = elements[0];
  if (!element) throw new Error(message);
  return element;
}

function sortedKeys(keys: readonly string[]): readonly string[] {
  return keys.toSorted((a, b) => a.localeCompare(b));
}

// ===========================================================================
describe("isDeepLinkTargetRow — the shared highlight match rule", () => {
  test("the named session's row is the target; every other row is not", () => {
    expect(isDeepLinkTargetRow(LINKED_SESSION, LINKED_SESSION)).toBe(true);
    expect(isDeepLinkTargetRow(OTHER_SESSION, OTHER_SESSION)).toBe(true);
    expect(isDeepLinkTargetRow(LINKED_SESSION, OTHER_SESSION)).toBe(false);
    expect(isDeepLinkTargetRow(OTHER_SESSION, LINKED_SESSION)).toBe(false);
    expect(isDeepLinkTargetRow(LINKED_SESSION, THIRD_SESSION)).toBe(false);
  });

  test("an absent pointer never matches — no row is the target, whatever its session id", () => {
    for (const rowSessionId of [LINKED_SESSION, OTHER_SESSION, FOREIGN_SESSION, 0, -1]) {
      expect(isDeepLinkTargetRow(null, rowSessionId)).toBe(false);
    }
  });

  test("the decision reads only the session id — row content never influences it", () => {
    const gradedRow = homeworkRowFixture("hw-graded", LINKED_SESSION, 10);
    const ungradedRow = {
      ...gradedRow,
      id: "hw-ungraded",
      jadid: { surahJuz: null, fromAyah: null, toAyah: null, grade: null },
      madi: { surahJuz: null, fromAyah: 2, toAyah: 4, grade: 6 },
    };
    expect(isDeepLinkTargetRow(LINKED_SESSION, gradedRow.sessionId)).toBe(true);
    expect(isDeepLinkTargetRow(LINKED_SESSION, ungradedRow.sessionId)).toBe(true);
    expect(isDeepLinkTargetRow(FOREIGN_SESSION, gradedRow.sessionId)).toBe(
      isDeepLinkTargetRow(FOREIGN_SESSION, ungradedRow.sessionId)
    );
  });

  test("rapid pointer alternation — every decision is recomputed from the current pointer", () => {
    const row = homeworkRowFixture("hw-1", LINKED_SESSION, 8);
    const alternations: ReadonlyArray<readonly [number | null, boolean]> = [
      [LINKED_SESSION, true],
      [null, false],
      [LINKED_SESSION, true],
      [OTHER_SESSION, false],
      [null, false],
      [LINKED_SESSION, true],
    ];
    for (const [pointer, expected] of alternations) {
      expect(isDeepLinkTargetRow(pointer, row.sessionId)).toBe(expected);
    }
  });
});

// ===========================================================================
describe("renderHomeworkBody — the pointer threads to every mounted homework row", () => {
  const rows = [
    homeworkRowFixture("hw-1", OTHER_SESSION, 8),
    homeworkRowFixture("hw-2", LINKED_SESSION, null),
    homeworkRowFixture("hw-3", THIRD_SESSION, 10),
  ];

  test("with the deep-link pointer — exactly the named session's row is the target", () => {
    const rowElements = rowElementsOf(renderedBody(rows, LINKED_SESSION));
    expect(rowElements).toHaveLength(rows.length);
    for (const element of rowElements) {
      expect(deepLinkSessionIdOf(element)).toBe(LINKED_SESSION);
    }
    const targeted = rowElements.filter(element =>
      isDeepLinkTargetRow(deepLinkSessionIdOf(element), rowSessionIdOf(element) ?? -1)
    );
    expect(targeted).toHaveLength(1);
    expect(rowSessionIdOf(requireRowElement(targeted, "the linked session's homework row should be mounted"))).toBe(
      LINKED_SESSION
    );
  });

  test("with no pointer — every row renders unhighlighted and carries a null pointer", () => {
    const rowElements = rowElementsOf(renderedBody(rows, null));
    expect(rowElements).toHaveLength(rows.length);
    for (const element of rowElements) {
      expect(deepLinkSessionIdOf(element)).toBeNull();
      expect(isDeepLinkTargetRow(deepLinkSessionIdOf(element), rowSessionIdOf(element) ?? -1)).toBe(false);
    }
  });

  test("a pointer outside the child's own rows highlights nothing", () => {
    const rowElements = rowElementsOf(renderedBody(rows, FOREIGN_SESSION));
    expect(rowElements).toHaveLength(rows.length);
    for (const element of rowElements) {
      expect(isDeepLinkTargetRow(deepLinkSessionIdOf(element), rowSessionIdOf(element) ?? -1)).toBe(false);
    }
  });

  test("the row prop surface stays closed — the pointer is the ONLY deep-link prop", () => {
    const rowElements = rowElementsOf(renderedBody(rows, LINKED_SESSION));
    const element = requireRowElement(rowElements, "homework rows should be mounted");
    expect(sortedKeys(propKeysOf(element))).toEqual(sortedKeys(["deepLinkSessionId", "labels", "locale", "row"]));
  });

  test("rows pass through unmodified — the pointer never merges into row data", () => {
    const rowElements = rowElementsOf(renderedBody(rows, LINKED_SESSION));
    expect(rowElements).toHaveLength(rows.length);
    for (const element of rowElements) {
      const mountedRow: unknown = propOf(element, "row");
      const fixture = rows.find(row => row.sessionId === rowSessionIdOf(element));
      if (fixture === undefined) throw new Error("every mounted row should come from the page data");
      expect(mountedRow).toBe(fixture);
    }
  });
});

// ===========================================================================
describe("pending data and re-renders — no stale highlight surface", () => {
  test("while the tab's read is pending only the skeleton mounts — no rows, no scroll, no crash", () => {
    const body = renderedBody(undefined, LINKED_SESSION);
    const elements = allElementsOf(body);
    expect(elements.some(element => element.type === HomeworkRow)).toBe(false);
    expect(elements.some(element => element.type === HomeworkSkeleton)).toBe(true);
  });

  test("every body render carries exactly its own render's pointer — no stale pointer", () => {
    const rows = [homeworkRowFixture("hw-1", LINKED_SESSION, 8)];
    for (const pointer of [LINKED_SESSION, null, FOREIGN_SESSION, OTHER_SESSION, LINKED_SESSION]) {
      const rowElements = rowElementsOf(renderedBody(rows, pointer));
      expect(rowElements).toHaveLength(rows.length);
      for (const element of rowElements) {
        expect(deepLinkSessionIdOf(element)).toBe(pointer);
      }
    }
  });

  test("a remount without data mounts no rows — the previous render's rows do not leak", () => {
    const rows = [homeworkRowFixture("hw-1", LINKED_SESSION, 8)];
    const withData = renderedBody(rows, LINKED_SESSION);
    expect(rowElementsOf(withData)).toHaveLength(1);
    const remounted = renderedBody(undefined, LINKED_SESSION);
    expect(rowElementsOf(remounted)).toHaveLength(0);
    expect(allElementsOf(remounted).some(element => element.type === HomeworkSkeleton)).toBe(true);
  });
});
