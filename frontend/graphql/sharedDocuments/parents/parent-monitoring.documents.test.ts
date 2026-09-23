/**
 * Structural lock over the parent read-only monitoring portal shared
 * GraphQL documents.
 *
 * Mirrors the `sharedDocuments/parents/parent-link.documents.test.ts`
 * discipline for the parent-monitoring domain: the portal root
 * container, child detail header + progress tab, attendance / reports /
 * homework tabs rely on these SHARED `TypedDocumentNode` documents, so
 * drift fails at this pure logic tier instead of surfacing as confusing
 * wire mismatches later:
 *
 *   1. NAMED operations — every portal document is a single named
 *      `query` operation whose GraphQL operation name matches its
 *      `{entityName}…Document` export convention, on the right channel
 *      (query — read-only portal, zero mutations), with the exact
 *      sanctioned variable set (the six pinned operations, EXACT
 *      names).
 *   2. Argument wiring — each declared variable is actually threaded
 *      into its root-field argument (no dead variables, no literal
 *      arguments that would bypass the variable contract).
 *   3. `id` field requirement — every entity-shaped object selection
 *      (`ParentLinkedChild`, `ParentAttendanceEntry`, `ParentReportEntry`,
 *      `ParentHomeworkEntry`) carries `id` FIRST so Apollo normalizes
 *      the cache entries (those are the row types carrying real `id`s —
 *      the frozen `apolloCache.ts` policy inventory registers the
 *      seven no-`id` types with `keyFields: false`, never an
 *      `id`-bearing row type).
 *   4. Self-scoped surface — the pinned variable sets (`studentId` +
 *      optional `page`/`pageSize` for the four per-student reads,
 *      `sessionId` for the deep-link resolution read, none for the
 *      list) are the WHOLE variable surface: no identity
 *      argument (parent/user/actor) or role/auth hint exists anywhere
 *      in the documents; parent identity is always derived server-side
 *      from the authenticated caller.
 *   5. Codegen binding + barrel parity — the constants stay
 *      `TypedDocumentNode`-typed against the generated operation types
 *      (compile-time proof by assignment), the four paginated reads
 *      carry the honest envelope (`items` + `totalCount` + `page` +
 *      `pageSize`), the progress composite collapses the detail header
 *      + progress count + latest Jadid/Madi positions into one payload,
 *      the session-target read projects the closed two-field deep-link
 *      pair, and the top-level barrel re-exports the SAME document
 *      instances as the deep imports (consumer import conventions
 *      table).
 *
 * Zero server boot, zero DB, zero network: inspects only already-compiled
 * ASTs through graphql kind-guard narrowing — no unsafe assertions anywhere
 * (oxlint `no-unsafe-type-assertion`). NO `useLazyQuery` exists anywhere
 * in the documents layer; consumers import hooks from "@apollo/client/react".
 */

import { describe, expect, test } from "bun:test";
import type { TypedDocumentNode } from "@apollo/client";
import type { DocumentNode, FieldNode, OperationDefinitionNode } from "graphql";
import type {
  MyLinkedChildrenQuery,
  ParentChildHomeworkQuery,
  ParentChildHomeworkQueryVariables,
  ParentChildProgressQuery,
  ParentChildProgressQueryVariables,
  ParentChildReportsQuery,
  ParentChildReportsQueryVariables,
  ParentChildSessionsQuery,
  ParentChildSessionsQueryVariables,
  ParentSessionTargetQuery,
  ParentSessionTargetQueryVariables,
} from "@/frontend/graphql/generated/gql/graphql";
import {
  myLinkedChildrenQueryDocument as myLinkedChildrenViaBarrel,
  parentChildHomeworkQueryDocument as parentChildHomeworkViaBarrel,
  parentChildProgressQueryDocument as parentChildProgressViaBarrel,
  parentChildReportsQueryDocument as parentChildReportsViaBarrel,
  parentChildSessionsQueryDocument as parentChildSessionsViaBarrel,
  parentSessionTargetQueryDocument as parentSessionTargetViaBarrel,
} from "@/frontend/graphql/sharedDocuments";
import {
  myLinkedChildrenQueryDocument,
  parentChildHomeworkQueryDocument,
  parentChildProgressQueryDocument,
  parentChildReportsQueryDocument,
  parentChildSessionsQueryDocument,
  parentSessionTargetQueryDocument,
} from "@/frontend/graphql/sharedDocuments/parents/parent-monitoring.documents";

// ---------------------------------------------------------------------------
// Assertion-free AST helpers

function operationOrThrow(document: DocumentNode): OperationDefinitionNode {
  const operations = document.definitions.filter(
    (definition): definition is OperationDefinitionNode => definition.kind === "OperationDefinition"
  );
  expect(operations).toHaveLength(1);
  if (operations.length < 1) {
    throw new Error("expected exactly one OperationDefinition");
  }
  return operations[0];
}

function subFields(parent: OperationDefinitionNode | FieldNode): FieldNode[] {
  const selectionSet = parent.selectionSet;
  if (!selectionSet) {
    return [];
  }
  return selectionSet.selections.filter((selection): selection is FieldNode => selection.kind === "Field");
}

function subField(parent: OperationDefinitionNode | FieldNode, name: string): FieldNode | undefined {
  return subFields(parent).find(field => field.name.value === name);
}

/** Resolves a dotted selection path ("parentChildSessions.items") or throws. */
function selectionPath(operation: OperationDefinitionNode, path: string): FieldNode {
  const segments = path.split(".");
  const first = subField(operation, segments[0]);
  if (first === undefined) {
    throw new Error(`expected selection ${path} to exist (missing ${segments[0]})`);
  }
  let current: FieldNode = first;
  for (const segment of segments.slice(1)) {
    const field = subField(current, segment);
    if (field === undefined) {
      throw new Error(`expected selection ${path} to exist (missing ${segment})`);
    }
    current = field;
  }
  return current;
}

function fieldNames(parent: OperationDefinitionNode | FieldNode): string[] {
  return subFields(parent).map(field => field.name.value);
}

function variableNames(operation: OperationDefinitionNode): string[] {
  return (operation.variableDefinitions ?? []).map(definition => definition.variable.name.value);
}

/** Variable names threaded as root-field arguments (`$x` → `x`), source order. */
function argumentVariableNames(field: FieldNode): string[] {
  // graphql-js types `arguments` as optional; an absent one simply yields
  // zero arguments (e.g. the zero-arg `myLinkedChildren` list).
  return (field.arguments ?? []).flatMap(argument =>
    argument.value.kind === "Variable" ? [argument.value.name.value] : []
  );
}

// ---------------------------------------------------------------------------
// Contract table

/**
 * The exact canonical rows, `id` FIRST on every entity-shaped selection.
 * The page wrappers, the homework track / position embedded value
 * objects, the progress composite, and the session-target resolution
 * pair carry no `id` (they are registered with `keyFields: false` in
 * `apolloCache.ts`).
 */
const LINKED_CHILD_ROW = ["id", "fullName", "createdAt"];
const ATTENDANCE_ENTRY_ROW = ["id", "status", "startedAt", "endedAt", "createdAt"];
const REPORT_ENTRY_ROW = [
  "id",
  "sessionId",
  "sessionStatus",
  "sessionStartedAt",
  "teacherNotes",
  "studentRatingByTeacher",
  "createdAt",
];
const HOMEWORK_ENTRY_ROW = ["id", "sessionId", "jadid", "madi", "createdAt"];
const HOMEWORK_TRACK_ROW = ["surahJuz", "fromAyah", "toAyah", "grade"];
const HOMEWORK_POSITION_ROW = ["surahJuz", "fromAyah", "toAyah"];
const PAGE_WRAPPER_ROW = ["items", "totalCount", "page", "pageSize"];
const PROGRESS_ROW = ["child", "progressRowCount", "latestJadidPosition", "latestMadiPosition"];
const SESSION_TARGET_ROW = ["sessionId", "studentId"];

interface ParentMonitoringDocumentRow {
  readonly document: DocumentNode;
  readonly operationName: string;
  /** Expected `($var, …)` declarations ([] for zero-arg operations), in the
   * SAME order the document declares them (wire/source order). */
  readonly variables: readonly string[];
  /** Root field the operation targets. */
  readonly rootField: string;
}

const PARENT_MONITORING_DOCUMENT_TABLE: readonly ParentMonitoringDocumentRow[] = [
  {
    document: myLinkedChildrenQueryDocument,
    operationName: "MyLinkedChildren",
    variables: [],
    rootField: "myLinkedChildren",
  },
  {
    document: parentChildProgressQueryDocument,
    operationName: "ParentChildProgress",
    variables: ["studentId"],
    rootField: "parentChildProgress",
  },
  {
    document: parentChildSessionsQueryDocument,
    operationName: "ParentChildSessions",
    variables: ["studentId", "page", "pageSize"],
    rootField: "parentChildSessions",
  },
  {
    document: parentChildReportsQueryDocument,
    operationName: "ParentChildReports",
    variables: ["studentId", "page", "pageSize"],
    rootField: "parentChildReports",
  },
  {
    document: parentChildHomeworkQueryDocument,
    operationName: "ParentChildHomework",
    variables: ["studentId", "page", "pageSize"],
    rootField: "parentChildHomework",
  },
  {
    document: parentSessionTargetQueryDocument,
    operationName: "ParentSessionTarget",
    variables: ["sessionId"],
    rootField: "parentSessionTarget",
  },
];

describe("parent-monitoring documents — named operations + channel + variables", () => {
  for (const row of PARENT_MONITORING_DOCUMENT_TABLE) {
    test(`${row.operationName} is a single named query operation`, () => {
      const operation = operationOrThrow(row.document);
      expect(operation.name?.value).toBe(row.operationName);
      expect(operation.name?.value ?? "").not.toBe("");
      expect(operation.operation).toBe("query");
      expect(variableNames(operation)).toEqual([...row.variables]);
    });
  }

  test("every declared variable is wired into its root-field argument (no dead variables, no literal arguments)", () => {
    for (const row of PARENT_MONITORING_DOCUMENT_TABLE) {
      const operation = operationOrThrow(row.document);
      const root = selectionPath(operation, row.rootField);
      expect(argumentVariableNames(root)).toEqual([...row.variables]);
    }
  });

  test("variable surface is exactly the sanctioned studentId/sessionId + pagination set — zero parent/role/auth hints", () => {
    const declared = PARENT_MONITORING_DOCUMENT_TABLE.flatMap(row =>
      variableNames(operationOrThrow(row.document))
    ).toSorted((a, b) => a.localeCompare(b));
    expect(declared).toEqual([
      "page",
      "page",
      "page",
      "pageSize",
      "pageSize",
      "pageSize",
      "sessionId",
      "studentId",
      "studentId",
      "studentId",
      "studentId",
    ]);
    // Belt-and-braces: no document smuggles a caller-identity argument
    // (parent/actor/user) or a role/auth hint. `studentId` IS sanctioned —
    // it is the per-child targeting capability gated inside
    // `requireLinkedChild` (TOCTOU seal); parent identity is always derived
    // server-side from the authenticated caller. `sessionId` is the
    // deep-link pointer the notification row carries — its ownership is
    // re-verified server-side on every resolution.
    for (const name of declared) {
      expect(name.toLowerCase()).not.toContain("parent");
      expect(name.toLowerCase()).not.toContain("actor");
      expect(name.toLowerCase()).not.toContain("user");
      expect(name.toLowerCase()).not.toContain("role");
      expect(name.toLowerCase()).not.toContain("auth");
      expect(name.toLowerCase()).not.toContain("token");
    }
  });

  test("the list query is zero-argument (caller identity IS the read scope)", () => {
    const operation = operationOrThrow(myLinkedChildrenQueryDocument);
    expect(operation.variableDefinitions ?? []).toHaveLength(0);
    const root = selectionPath(operation, "myLinkedChildren");
    expect(root.arguments ?? []).toHaveLength(0);
  });
});

describe("parent-monitoring documents — id-first + canonical row shapes", () => {
  test("every entity-shaped object selection carries the exact canonical row with id FIRST", () => {
    const operationList = operationOrThrow(myLinkedChildrenQueryDocument);
    expect(fieldNames(selectionPath(operationList, "myLinkedChildren"))).toEqual(LINKED_CHILD_ROW);
    expect(fieldNames(selectionPath(operationList, "myLinkedChildren"))[0]).toBe("id");

    const operationSessions = operationOrThrow(parentChildSessionsQueryDocument);
    expect(fieldNames(selectionPath(operationSessions, "parentChildSessions.items"))).toEqual(ATTENDANCE_ENTRY_ROW);
    expect(fieldNames(selectionPath(operationSessions, "parentChildSessions.items"))[0]).toBe("id");

    const operationReports = operationOrThrow(parentChildReportsQueryDocument);
    expect(fieldNames(selectionPath(operationReports, "parentChildReports.items"))).toEqual(REPORT_ENTRY_ROW);
    expect(fieldNames(selectionPath(operationReports, "parentChildReports.items"))[0]).toBe("id");

    const operationHomework = operationOrThrow(parentChildHomeworkQueryDocument);
    expect(fieldNames(selectionPath(operationHomework, "parentChildHomework.items"))).toEqual(HOMEWORK_ENTRY_ROW);
    expect(fieldNames(selectionPath(operationHomework, "parentChildHomework.items"))[0]).toBe("id");
  });

  test("the progress child echo re-projects the same ParentLinkedChild selection as the list (id FIRST)", () => {
    const operation = operationOrThrow(parentChildProgressQueryDocument);
    const childSelection = selectionPath(operation, "parentChildProgress.child");
    expect(fieldNames(childSelection)).toEqual(LINKED_CHILD_ROW);
    expect(fieldNames(childSelection)[0]).toBe("id");
  });

  test("every page wrapper carries the honest envelope (items + totalCount + page + pageSize)", () => {
    for (const path of ["parentChildSessions", "parentChildReports", "parentChildHomework"]) {
      const document = PARENT_MONITORING_DOCUMENT_TABLE.find(row => row.rootField === path);
      if (!document) {
        throw new Error(`missing document for root field ${path}`);
      }
      const operation = operationOrThrow(document.document);
      expect(fieldNames(selectionPath(operation, path))).toEqual(PAGE_WRAPPER_ROW);
    }
  });

  test("the progress composite exposes child + count + two nullable position tracks (no id — embedded value)", () => {
    const operation = operationOrThrow(parentChildProgressQueryDocument);
    const progressSelection = selectionPath(operation, "parentChildProgress");
    expect(fieldNames(progressSelection)).toEqual(PROGRESS_ROW);
    // The progress composite carries no id — it is registered with
    // `keyFields: false` in apolloCache.ts (an embedded value type read
    // through its enclosing parent).
    expect(fieldNames(progressSelection)).not.toContain("id");
  });

  test("the homework track block carries surahJuz/fromAyah/toAyah/grade (no id — embedded value)", () => {
    const operation = operationOrThrow(parentChildHomeworkQueryDocument);
    const jadid = selectionPath(operation, "parentChildHomework.items.jadid");
    const madi = selectionPath(operation, "parentChildHomework.items.madi");
    expect(fieldNames(jadid)).toEqual(HOMEWORK_TRACK_ROW);
    expect(fieldNames(madi)).toEqual(HOMEWORK_TRACK_ROW);
    expect(fieldNames(jadid)).not.toContain("id");
    expect(fieldNames(madi)).not.toContain("id");
  });

  test("the progress latest-position blocks carry surahJuz/fromAyah/toAyah (no id — embedded value)", () => {
    const operation = operationOrThrow(parentChildProgressQueryDocument);
    const jadid = selectionPath(operation, "parentChildProgress.latestJadidPosition");
    const madi = selectionPath(operation, "parentChildProgress.latestMadiPosition");
    expect(fieldNames(jadid)).toEqual(HOMEWORK_POSITION_ROW);
    expect(fieldNames(madi)).toEqual(HOMEWORK_POSITION_ROW);
    expect(fieldNames(jadid)).not.toContain("id");
    expect(fieldNames(madi)).not.toContain("id");
  });

  test("the session-target projection is the closed two-field deep-link pair (no id — normalized-exempt value)", () => {
    const operation = operationOrThrow(parentSessionTargetQueryDocument);
    const targetSelection = selectionPath(operation, "parentSessionTarget");
    // Closed projection: the pair is EXACTLY sessionId + studentId — no
    // over-fetch, no id-first pin (the wire type carries no `id`).
    expect(fieldNames(targetSelection)).toEqual(SESSION_TARGET_ROW);
    // Cache policy holds: with no `id` in the selection, Apollo
    // cannot even attempt to normalize the value, which matches the
    // `ParentSessionTarget: { keyFields: false }` registration in
    // apolloCache.ts (a value object read through the root query field,
    // replaced wholesale on every resolution — never cache-keyed).
    expect(fieldNames(targetSelection)).not.toContain("id");
  });
});

describe("parent-monitoring documents — codegen binding + barrel parity", () => {
  test("top-level barrel re-exports the SAME document instances (cache-key safety)", () => {
    expect(myLinkedChildrenViaBarrel).toBe(myLinkedChildrenQueryDocument);
    expect(parentChildProgressViaBarrel).toBe(parentChildProgressQueryDocument);
    expect(parentChildSessionsViaBarrel).toBe(parentChildSessionsQueryDocument);
    expect(parentChildReportsViaBarrel).toBe(parentChildReportsQueryDocument);
    expect(parentChildHomeworkViaBarrel).toBe(parentChildHomeworkQueryDocument);
    expect(parentSessionTargetViaBarrel).toBe(parentSessionTargetQueryDocument);
  });

  test("documents remain TypedDocumentNode-typed against generated operation types", () => {
    // Compile-time proof by assignment — tsgo fails if any exported constant
    // loses its codegen typing or picks up an inline type literal.
    const typedList: TypedDocumentNode<MyLinkedChildrenQuery> = myLinkedChildrenQueryDocument;
    const typedProgress: TypedDocumentNode<ParentChildProgressQuery, ParentChildProgressQueryVariables> =
      parentChildProgressQueryDocument;
    const typedSessions: TypedDocumentNode<ParentChildSessionsQuery, ParentChildSessionsQueryVariables> =
      parentChildSessionsQueryDocument;
    const typedReports: TypedDocumentNode<ParentChildReportsQuery, ParentChildReportsQueryVariables> =
      parentChildReportsQueryDocument;
    const typedHomework: TypedDocumentNode<ParentChildHomeworkQuery, ParentChildHomeworkQueryVariables> =
      parentChildHomeworkQueryDocument;
    const typedSessionTarget: TypedDocumentNode<ParentSessionTargetQuery, ParentSessionTargetQueryVariables> =
      parentSessionTargetQueryDocument;

    // Runtime uses keep the bindings from being flagged as unused.
    expect(typedList.loc).toBeDefined();
    expect(typedProgress.loc).toBeDefined();
    expect(typedSessions.loc).toBeDefined();
    expect(typedReports.loc).toBeDefined();
    expect(typedHomework.loc).toBeDefined();
    expect(typedSessionTarget.loc).toBeDefined();
  });
});
