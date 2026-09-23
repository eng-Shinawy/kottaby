/**
 * Evaluation-rubric shared documents — document-shape + cache round-trip
 * suite (documents tier, NO server / DB / network).
 *
 * Companion to the wire-tier `evaluation-rubric.test.ts` in this directory
 * (which pins the GraphQL boundary against the dev server): this file locks
 * the SHARED DOCUMENTS themselves — the exact evaluator-facing surface the
 * submit mutation and the two rubric reads expose to every Apollo consumer.
 *
 * WHAT THIS LOCKS (the shared evaluation-rubric documents — submit mutation +
 * pending-session page + own-submission read)
 *   1. NAMED operations — every document is a single named operation whose
 *      GraphQL name matches its `{entityName}…Document` export convention,
 *      on the right channel (query vs mutation), with the exact sanctioned
 *      variable set threaded into the root-field arguments (no dead
 *      variables, no literal arguments bypassing the variable contract).
 *   2. CLOSED selection contract — each operation selects exactly its one
 *      root field; the `RubricEvaluation` receipt selects the EXACT
 *      8-field row and the pending page the canonical `SessionPage` shape
 *      with `id` FIRST on every object selection (Apollo normalization).
 *   3. NOTES-FREE READS (BOPLA) — `notes` rides ONLY inside the mutation's
 *      `RubricEvaluationSubmitInput` variable; it is absent from every
 *      selection set AND every printed document body — verified both on the
 *      parsed AST (deep selection walk) and on `loc.source.body`.
 *   4. TYPING + BARREL PARITY — the exported constants keep their codegen
 *      `TypedDocumentNode` typing (compile-time proof by assignment), and
 *      the root barrel, the teachers barrel and the deep import resolve to
 *      the IDENTICAL document instances (consumer import conventions).
 *   5. NO useLazyQuery — a filesystem walk over the whole
 *      `sharedDocuments` tree pins the "stateful `useQuery` exclusively"
 *      rule for the documents layer.
 *   6. ROUND-TRIP — the REAL documents execute through a real Apollo
 *      pipeline (`ApolloClient` + `MockLink` + the production
 *      `createApolloCache()`) and emit ZERO "Cache data may be lost"
 *      cache-data-loss diagnostics; the `id`-first rows demonstrably
 *      normalize into standalone `Session:` / `RubricEvaluation:` cache
 *      entries, and a cache-hit re-read of a previously written page is
 *      served WITHOUT contacting the link again.
 *   7. DEV-MODE CANARY (LAST in this file, order-sensitive) — a control
 *      write that WOULD lose data through an UNPOLICIED cache DOES emit the
 *      warning, proving the warning machinery is live in this process so
 *      the zero assertions in (6) can never pass vacuously.
 *
 * gql IMPORT NOTE — this suite imports the shared documents module directly
 * (so the REAL documents are the ones under test). That module builds them
 * with `gql` from `@apollo/client`; the `bunfig.toml` `[test]` preload chain
 * (`graphql-interop.ts` before any test file) seeds `require.cache` so
 * graphql-tag resolves under Bun. The `apollo-dev-flag` preload is likewise
 * global (it evaluates before this file — and thus before any
 * `@apollo/client` import below — regardless of in-file import order);
 * `apolloDevModePreloaded` is value-imported in-file (bare side-effect
 * imports are lint-forbidden) to keep the dev-mode dependency explicit.
 *
 * Pure unit tier — runs via the mandated runner:
 * `bun run test/scripts/run-test.ts frontend/graphql/test/teachers/evaluation-rubric.documents.test.ts`.
 */

import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ApolloClient, InMemoryCache, type TypedDocumentNode } from "@apollo/client";
import { loadDevMessages, loadErrorMessages } from "@apollo/client/dev";
import { MockLink } from "@apollo/client/testing";
import {
  type DocumentNode,
  type FieldNode,
  type OperationDefinitionNode,
  parse,
  type VariableDefinitionNode,
} from "graphql";
import {
  ApplicantStatus,
  type MyRubricEvaluationQuery,
  type MyRubricEvaluationQueryVariables,
  type MyRubricPendingSessionsQuery,
  type MyRubricPendingSessionsQuery_myRubricPendingSessions,
  type MyRubricPendingSessionsQuery_myRubricPendingSessions_items,
  type MyRubricPendingSessionsQueryVariables,
  SessionStatus,
  SessionType,
  type SubmitRubricEvaluationMutation,
  type SubmitRubricEvaluationMutation_submitRubricEvaluation,
  type SubmitRubricEvaluationMutationVariables,
} from "@/frontend/graphql/generated/gql/graphql";
import {
  myRubricEvaluationQueryDocument as myRubricEvaluationViaRootBarrel,
  myRubricPendingSessionsQueryDocument as myRubricPendingSessionsViaRootBarrel,
  submitRubricEvaluationMutationDocument as submitRubricEvaluationViaRootBarrel,
} from "@/frontend/graphql/sharedDocuments";
import {
  argumentVariableNames,
  fieldNames,
  operationOrThrow as singleOperationOrThrow,
  subFields,
} from "@/frontend/graphql/sharedDocuments/document-test-kit";
import {
  myRubricEvaluationQueryDocument as myRubricEvaluationViaTeachersBarrel,
  myRubricPendingSessionsQueryDocument as myRubricPendingSessionsViaTeachersBarrel,
  submitRubricEvaluationMutationDocument as submitRubricEvaluationViaTeachersBarrel,
} from "@/frontend/graphql/sharedDocuments/teachers";
import {
  myRubricEvaluationQueryDocument,
  myRubricPendingSessionsQueryDocument,
  submitRubricEvaluationMutationDocument,
} from "@/frontend/graphql/sharedDocuments/teachers/evaluation-rubric.documents";
import { createApolloCache } from "@/frontend/providers/apollo/apolloCache";
import { apolloDevModePreloaded } from "@/test/preload/apollo-dev-flag";

// Apollo's non-bundler build never auto-loads the friendly invariant message
// tables, so its diagnostics render as a URL-encoded fallback whose numeric
// code is build-specific. Loading the dev message tables here pins the
// diagnostic to its stable friendly text — the same posture as the browser
// dev build the apollo-dev-flag preload emulates.
loadDevMessages();
loadErrorMessages();

// ---------------------------------------------------------------------------
// Assertion-free AST helpers (guard-and-throw narrowing, same style as
// `handshake-code.documents.test.ts` — `no-unsafe-type-assertion` clean).

function namedFieldOrThrow(parent: OperationDefinitionNode | FieldNode, name: string): FieldNode {
  const field = subFields(parent).find(candidate => candidate.name.value === name);
  if (field === undefined) {
    throw new Error(`expected selection field ${name} to exist`);
  }
  return field;
}

/** Every field name in the whole operation, at any selection depth. */
function deepFieldNames(parent: OperationDefinitionNode | FieldNode): string[] {
  const nested = subFields(parent).flatMap(field => deepFieldNames(field));
  return [...fieldNames(parent), ...nested];
}

/** Renders one declared variable's type as GraphQL source notation (e.g. `ID!`). */
function variableTypeOrThrow(definition: VariableDefinitionNode): string {
  const type = definition.type;
  if (type.kind === "NonNullType") {
    const inner = type.type;
    if (inner.kind !== "NamedType") {
      throw new Error(`unexpected non-null wrapping of ${inner.kind}`);
    }
    return `${inner.name.value}!`;
  }
  if (type.kind === "NamedType") {
    return type.name.value;
  }
  throw new Error(`unexpected list-typed variable (${type.kind})`);
}

/** The printed source body of a document — fails loudly when the loc is gone. */
function requireSourceBody(document: DocumentNode): string {
  const loc = document.loc;
  if (loc === undefined) {
    throw new Error("document has no source location (printed body unavailable)");
  }
  return loc.source.body;
}

/** Unwraps a result's data — fails loudly instead of asserting non-undefined. */
function requireResultData<TData>(result: { readonly data: TData | undefined }, label: string): TData {
  if (result.data === undefined) {
    throw new Error(`${label} returned no data`);
  }
  return result.data;
}

/**
 * Detects Apollo's "Cache data may be lost" cache-data-loss diagnostic in one
 * captured `console.warn`/`console.error` argument list. With the dev message
 * tables loaded at the top of this file, the warning renders as its stable
 * friendly text. As a fallback (dev messages not yet registered), Apollo
 * renders a URL-encoded error payload whose numeric invariant code is
 * build-specific — the fallback branch matches any numeric invariant message
 * rather than a hard-coded code.
 */
function isCacheDataLossWarning(args: readonly unknown[]): boolean {
  return args.some(arg => {
    const text = String(arg);
    if (text.includes("Cache data may be lost")) {
      return true;
    }
    try {
      return /"message":\d+/.test(decodeURIComponent(text));
    } catch {
      return false;
    }
  });
}

/**
 * Strips comments (line + block) via plain string scanning so doc-only
 * mentions of a banned token (every documents file's "NO `useLazyQuery`
 * JSDoc) cannot false-positive the ban scan — only real code references
 * offend. String scanning (no regex) keeps the scan linear.
 */

/** Cuts one block-comment span out of a line, reporting an unterminated span. */
function stripBlockComment(line: string, startIndex: number): { code: string; unterminated: boolean } {
  const endIndex = line.indexOf("*/", startIndex);
  if (endIndex === -1) {
    return { code: line.slice(0, startIndex), unterminated: true };
  }
  return { code: line.slice(0, startIndex) + line.slice(endIndex + 2), unterminated: false };
}

function withoutComments(source: string): string {
  const codeLines: string[] = [];
  let inBlockComment = false;
  for (const line of source.split("\n")) {
    let code = line;
    if (inBlockComment) {
      const endIndex = code.indexOf("*/");
      if (endIndex === -1) {
        continue;
      }
      code = code.slice(endIndex + 2);
      inBlockComment = false;
    }
    const startIndex = code.indexOf("/*");
    if (startIndex !== -1) {
      const stripped = stripBlockComment(code, startIndex);
      code = stripped.code;
      inBlockComment = stripped.unterminated;
    }
    const lineCommentIndex = code.indexOf("//");
    if (lineCommentIndex !== -1) {
      code = code.slice(0, lineCommentIndex);
    }
    if (code.trim().length > 0) {
      codeLines.push(code);
    }
  }
  return codeLines.join("\n");
}

/**
 * Recursively collects every `.ts` file under `rootDir` (documents layer
 * tree-walk for the useLazyQuery rule — test-only filesystem read).
 */
function tsFilesUnder(rootDir: string): string[] {
  const collected: string[] = [];
  for (const entry of readdirSync(rootDir, { withFileTypes: true })) {
    const fullPath = join(rootDir, entry.name);
    if (entry.isDirectory()) {
      collected.push(...tsFilesUnder(fullPath));
    } else if (entry.name.endsWith(".ts")) {
      collected.push(fullPath);
    }
  }
  return collected;
}

// ---------------------------------------------------------------------------
// Round-trip fixtures (test data only — technical fixtures, not rendered UI
// copy; ids never double as identity inputs because the documents carry no
// identity variables at all).

const SESSION_A_ID = "rubric-session-a";
const SESSION_B_ID = "rubric-session-b";
const EVALUATION_ID = "rubric-evaluation-1";
const EVALUATOR_ID = "evaluator-user-1";
const EVALUATED_ID = "evaluated-user-1";
const PAGE_DEFAULTS = { page: 1, pageSize: 25 };

/** Wire payload type: the codegen receipt shape plus the physical __typename. */
type WireRubricEvaluation = SubmitRubricEvaluationMutation_submitRubricEvaluation & {
  readonly __typename: "RubricEvaluation";
};

/** Wire payload type: the codegen pending-page Session row plus __typename. */
type WireSessionRow = MyRubricPendingSessionsQuery_myRubricPendingSessions_items & {
  readonly __typename: "Session";
};

/** Wire payload type: the canonical id-less pagination wrapper plus __typename. */
type WirePendingPage = MyRubricPendingSessionsQuery_myRubricPendingSessions & {
  readonly __typename: "SessionPage";
  readonly items: WireSessionRow[];
};

const PASSING_RECEIPT: WireRubricEvaluation = {
  __typename: "RubricEvaluation",
  id: EVALUATION_ID,
  sessionId: SESSION_A_ID,
  evaluatorId: EVALUATOR_ID,
  evaluatedId: EVALUATED_ID,
  score: 85,
  weaknessArea: null,
  createdAt: "2030-01-01T00:00:00.000Z",
  applicantStatus: ApplicantStatus.InEvaluation,
};

const PENDING_PAGE_ONE: WirePendingPage = {
  __typename: "SessionPage",
  items: [
    {
      __typename: "Session",
      id: SESSION_A_ID,
      status: SessionStatus.Completed,
      sessionType: SessionType.TeacherEvaluation,
      intent: null,
      teacherId: EVALUATOR_ID,
      studentId: EVALUATED_ID,
      confirmationDeadline: null,
      createdAt: "2030-01-01T00:00:00.000Z",
    },
  ],
  totalCount: 2,
  page: 1,
  pageSize: 25,
};

const PENDING_PAGE_TWO: WirePendingPage = {
  __typename: "SessionPage",
  items: [
    {
      __typename: "Session",
      id: SESSION_B_ID,
      status: SessionStatus.Completed,
      sessionType: SessionType.TeacherEvaluation,
      intent: null,
      teacherId: EVALUATOR_ID,
      studentId: EVALUATED_ID,
      confirmationDeadline: null,
      createdAt: "2030-01-02T00:00:00.000Z",
    },
  ],
  totalCount: 2,
  page: 2,
  pageSize: 25,
};

// Console spies — installed per test, restored together in afterEach. (The
// bunfig logger-mock preload has already no-op'd console.*; spyOn wraps
// whatever is installed, and Apollo resolves `console.warn` dynamically at
// call time, so the capture works regardless.)

const activeSpies: { mockRestore(): void }[] = [];

afterEach(() => {
  for (const spy of activeSpies.splice(0)) {
    spy.mockRestore();
  }
});

// ===========================================================================
describe("evaluation-rubric documents — named operations, channels, variables", () => {
  test("SubmitRubricEvaluation: single named mutation, exactly $sessionId: ID! + $input: RubricEvaluationSubmitInput!", () => {
    const operation = singleOperationOrThrow(submitRubricEvaluationMutationDocument);
    expect(operation.name?.value).toBe("SubmitRubricEvaluation");
    expect(operation.operation).toBe("mutation");

    const variables = operation.variableDefinitions ?? [];
    expect(variables.map(definition => definition.variable.name.value)).toEqual(["sessionId", "input"]);
    expect(variables.map(definition => variableTypeOrThrow(definition))).toEqual([
      "ID!",
      "RubricEvaluationSubmitInput!",
    ]);

    const rootFields = fieldNames(operation);
    expect(rootFields).toEqual(["submitRubricEvaluation"]);

    // Every declared variable is threaded as a root-field argument, and the
    // root field carries NO literal arguments (no bypass of the variable
    // contract — the session locator and sealed payload ride variables only).
    const submitField = namedFieldOrThrow(operation, "submitRubricEvaluation");
    expect((submitField.arguments ?? []).map(argument => argument.name.value)).toEqual(["sessionId", "input"]);
    expect(argumentVariableNames(submitField)).toEqual(["sessionId", "input"]);
    expect(submitField.arguments ?? []).toHaveLength(argumentVariableNames(submitField).length);
  });

  test("MyRubricPendingSessions: single named query, exactly optional $page + $pageSize", () => {
    const operation = singleOperationOrThrow(myRubricPendingSessionsQueryDocument);
    expect(operation.name?.value).toBe("MyRubricPendingSessions");
    expect(operation.operation).toBe("query");

    const variables = operation.variableDefinitions ?? [];
    expect(variables.map(definition => definition.variable.name.value)).toEqual(["page", "pageSize"]);
    expect(variables.map(definition => variableTypeOrThrow(definition))).toEqual(["Int", "Int"]);

    expect(fieldNames(operation)).toEqual(["myRubricPendingSessions"]);
    const pageField = namedFieldOrThrow(operation, "myRubricPendingSessions");
    expect((pageField.arguments ?? []).map(argument => argument.name.value)).toEqual(["page", "pageSize"]);
    expect(argumentVariableNames(pageField)).toEqual(["page", "pageSize"]);
    expect(pageField.arguments ?? []).toHaveLength(argumentVariableNames(pageField).length);
  });

  test("MyRubricEvaluation: single named query, exactly $sessionId: ID!", () => {
    const operation = singleOperationOrThrow(myRubricEvaluationQueryDocument);
    expect(operation.name?.value).toBe("MyRubricEvaluation");
    expect(operation.operation).toBe("query");

    const variables = operation.variableDefinitions ?? [];
    expect(variables.map(definition => definition.variable.name.value)).toEqual(["sessionId"]);
    expect(variables.map(definition => variableTypeOrThrow(definition))).toEqual(["ID!"]);

    expect(fieldNames(operation)).toEqual(["myRubricEvaluation"]);
    const evaluationField = namedFieldOrThrow(operation, "myRubricEvaluation");
    expect((evaluationField.arguments ?? []).map(argument => argument.name.value)).toEqual(["sessionId"]);
    expect(argumentVariableNames(evaluationField)).toEqual(["sessionId"]);
    expect(evaluationField.arguments ?? []).toHaveLength(argumentVariableNames(evaluationField).length);
  });
});

// ===========================================================================
describe("evaluation-rubric documents — closed selection contract, id FIRST", () => {
  test("RubricEvaluation receipt: EXACT 8-field row, id FIRST, every field a leaf", () => {
    const EXPECTED_FIELDS = [
      "id",
      "sessionId",
      "evaluatorId",
      "evaluatedId",
      "score",
      "weaknessArea",
      "createdAt",
      "applicantStatus",
    ];

    const mutationOperation = singleOperationOrThrow(submitRubricEvaluationMutationDocument);
    const queryOperation = singleOperationOrThrow(myRubricEvaluationQueryDocument);

    for (const [label, operation] of [
      ["submitRubricEvaluation", mutationOperation],
      ["myRubricEvaluation", queryOperation],
    ] as const) {
      const receipt = namedFieldOrThrow(operation, label);
      expect(fieldNames(receipt)).toEqual(EXPECTED_FIELDS);
      expect(fieldNames(receipt)[0]).toBe("id");
      // Scalars + enums only — no nested object selection anywhere on the
      // receipt (`weaknessArea`/`applicantStatus` are enum leaves).
      for (const field of subFields(receipt)) {
        expect(field.selectionSet).toBeUndefined();
      }
    }
  });

  test("MyRubricPendingSessions: canonical SessionPage — page members + 8-field Session rows, id FIRST", () => {
    const operation = singleOperationOrThrow(myRubricPendingSessionsQueryDocument);
    const pageField = namedFieldOrThrow(operation, "myRubricPendingSessions");

    expect(fieldNames(pageField)).toEqual(["items", "totalCount", "page", "pageSize"]);
    // Scalar page members are leaves; only `items` carries a selection.
    for (const member of subFields(pageField)) {
      if (member.name.value === "items") {
        continue;
      }
      expect(member.selectionSet).toBeUndefined();
    }

    const items = namedFieldOrThrow(pageField, "items");
    expect(fieldNames(items)).toEqual([
      "id",
      "status",
      "sessionType",
      "intent",
      "teacherId",
      "studentId",
      "confirmationDeadline",
      "createdAt",
    ]);
    expect(fieldNames(items)[0]).toBe("id");
    for (const field of subFields(items)) {
      expect(field.selectionSet).toBeUndefined();
    }
  });

  test("NO document selects `notes` at any selection depth — and no printed body mentions it", () => {
    for (const document of [
      submitRubricEvaluationMutationDocument,
      myRubricPendingSessionsQueryDocument,
      myRubricEvaluationQueryDocument,
    ]) {
      const operation = singleOperationOrThrow(document);
      expect(deepFieldNames(operation).includes("notes")).toBe(false);
      // The sealed payload rides the typed input variable — the printed
      // GraphQL body never spells out its members (no `notes` token at all).
      expect(requireSourceBody(document).includes("notes")).toBe(false);
    }
  });

  test("documents remain TypedDocumentNode-typed against the generated operation types", () => {
    // Compile-time proof by assignment — tsgo fails if any exported
    // constant loses its codegen typing or picks up an inline type literal.
    const typedSubmit: TypedDocumentNode<SubmitRubricEvaluationMutation, SubmitRubricEvaluationMutationVariables> =
      submitRubricEvaluationMutationDocument;
    const typedPending: TypedDocumentNode<MyRubricPendingSessionsQuery, MyRubricPendingSessionsQueryVariables> =
      myRubricPendingSessionsQueryDocument;
    const typedOwn: TypedDocumentNode<MyRubricEvaluationQuery, MyRubricEvaluationQueryVariables> =
      myRubricEvaluationQueryDocument;

    // Runtime uses keep the bindings from being flagged as unused.
    expect(typedSubmit.loc).toBeDefined();
    expect(typedPending.loc).toBeDefined();
    expect(typedOwn.loc).toBeDefined();
  });
});

// ===========================================================================
describe("consumer import conventions — barrel ≡ deep import identity", () => {
  test("root + teachers barrels re-export the SAME document instances (cache-key safety)", () => {
    // An accidental re-declaration in a barrel (a second `gql` call instead
    // of a re-export) would mint a second DocumentNode: equal text, different
    // identity — which would fragment Apollo's document-keyed caches and
    // request-dedup sets (see sharedDocuments/AGENTS.md §Consumer import
    // conventions).
    expect(submitRubricEvaluationViaRootBarrel).toBe(submitRubricEvaluationMutationDocument);
    expect(myRubricPendingSessionsViaRootBarrel).toBe(myRubricPendingSessionsQueryDocument);
    expect(myRubricEvaluationViaRootBarrel).toBe(myRubricEvaluationQueryDocument);
    expect(submitRubricEvaluationViaTeachersBarrel).toBe(submitRubricEvaluationMutationDocument);
    expect(myRubricPendingSessionsViaTeachersBarrel).toBe(myRubricPendingSessionsQueryDocument);
    expect(myRubricEvaluationViaTeachersBarrel).toBe(myRubricEvaluationQueryDocument);
  });

  test("NO useLazyQuery anywhere in the sharedDocuments documents layer", () => {
    // Comment-stripped scan: the JSDoc of most documents files STATES the ban
    // ("NO `useLazyQuery`"), so only real code references may offend.
    const documentsRoot = join(import.meta.dir, "..", "..", "sharedDocuments");
    const offenders = tsFilesUnder(documentsRoot).filter(path =>
      withoutComments(readFileSync(path, "utf8")).includes("useLazyQuery")
    );
    expect(offenders).toEqual([]);
  });
});

// ===========================================================================
describe("Apollo round-trip — real documents through the production cache", () => {
  test("the dev-mode flag captured (precondition: the zero assertions below are live)", () => {
    // The bunfig preload sets globalThis.__DEV__ before the first
    // @apollo/client import; this in-file value import re-asserts it so a
    // preload-chain regression cannot silently make this suite vacuous.
    expect(apolloDevModePreloaded).toBe(true);
  });

  test("pending-page reads round-trip warning-free; Session rows normalize by id (incl. cache-hit re-read)", async () => {
    const warnSpy = spyOn(console, "warn");
    const errorSpy = spyOn(console, "error");
    activeSpies.push(warnSpy, errorSpy);

    // Real documents + production cache + MockLink: the full Apollo pipeline
    // minus the network. Both page mocks are registered up-front; the
    // cache-hit re-read below must be served WITHOUT contacting the link
    // again (both mocks are consumed by then, so a network fallback would
    // fail loudly).
    const client = new ApolloClient({
      link: new MockLink([
        {
          request: { query: myRubricPendingSessionsQueryDocument, variables: { ...PAGE_DEFAULTS } },
          result: { data: { myRubricPendingSessions: PENDING_PAGE_ONE } },
        },
        {
          request: { query: myRubricPendingSessionsQueryDocument, variables: { page: 2, pageSize: 25 } },
          result: { data: { myRubricPendingSessions: PENDING_PAGE_TWO } },
        },
      ]),
      cache: createApolloCache(),
    });

    const first = await client.query({
      query: myRubricPendingSessionsQueryDocument,
      variables: { ...PAGE_DEFAULTS },
    });
    const firstData = requireResultData(first, "pending page one");
    expect(firstData.myRubricPendingSessions.items.map(row => row.id)).toEqual([SESSION_A_ID]);
    expect(firstData.myRubricPendingSessions.totalCount).toBe(2);

    // Second page: a second page write into the SAME cache under different
    // variables — a new row normalizes alongside the first (id-first rule).
    const second = await client.query({
      query: myRubricPendingSessionsQueryDocument,
      variables: { page: 2, pageSize: 25 },
    });
    const secondData = requireResultData(second, "pending page two");
    expect(secondData.myRubricPendingSessions.items.map(row => row.id)).toEqual([SESSION_B_ID]);

    // Both rows normalized into standalone Session cache entries (the whole
    // point of the id-first selection contract).
    const extracted = JSON.stringify(client.cache.extract());
    expect(extracted).toContain(`"Session:${SESSION_A_ID}"`);
    expect(extracted).toContain(`"Session:${SESSION_B_ID}"`);

    // Cache-hit re-read of page ONE (default cache-first policy: no link
    // pass, both mocks already consumed).
    const reread = await client.query({
      query: myRubricPendingSessionsQueryDocument,
      variables: { ...PAGE_DEFAULTS },
    });
    const rereadData = requireResultData(reread, "cache-hit re-read");
    expect(rereadData.myRubricPendingSessions.items.map(row => row.id)).toEqual([SESSION_A_ID]);

    // Zero console.warn calls of ANY kind during the full round-trip…
    expect(warnSpy.mock.calls).toHaveLength(0);
    // …and no cache-data-loss diagnostics on the error channel either.
    expect(errorSpy.mock.calls.filter(call => isCacheDataLossWarning(call))).toHaveLength(0);
  });

  test("submit mutation round-trip normalizes the receipt by id, warning-free", async () => {
    const warnSpy = spyOn(console, "warn");
    const errorSpy = spyOn(console, "error");
    activeSpies.push(warnSpy, errorSpy);

    const client = new ApolloClient({
      link: new MockLink([
        {
          request: {
            query: submitRubricEvaluationMutationDocument,
            variables: { sessionId: SESSION_A_ID, input: { score: 85, notes: "draft", weaknessArea: null } },
          },
          result: { data: { submitRubricEvaluation: PASSING_RECEIPT } },
        },
      ]),
      cache: createApolloCache(),
    });

    const result = await client.mutate({
      mutation: submitRubricEvaluationMutationDocument,
      variables: {
        sessionId: SESSION_A_ID,
        input: { score: 85, notes: "draft", weaknessArea: null },
      },
    });
    const data = requireResultData(result, "submit mutation");
    expect(data.submitRubricEvaluation.id).toBe(EVALUATION_ID);
    expect(data.submitRubricEvaluation.score).toBe(85);
    expect(data.submitRubricEvaluation.applicantStatus).toBe(ApplicantStatus.InEvaluation);

    // The receipt normalized into its own identity-derived cache entry —
    // visible to every other consumer of the same row.
    const extracted = JSON.stringify(client.cache.extract());
    expect(extracted).toContain(`"RubricEvaluation:${EVALUATION_ID}"`);

    expect(warnSpy.mock.calls).toHaveLength(0);
    expect(errorSpy.mock.calls.filter(call => isCacheDataLossWarning(call))).toHaveLength(0);
  });

  test("own-submission read round-trips BOTH arms (row + legal null), warning-free", async () => {
    const warnSpy = spyOn(console, "warn");
    const errorSpy = spyOn(console, "error");
    activeSpies.push(warnSpy, errorSpy);

    const client = new ApolloClient({
      link: new MockLink([
        {
          request: { query: myRubricEvaluationQueryDocument, variables: { sessionId: SESSION_A_ID } },
          result: { data: { myRubricEvaluation: PASSING_RECEIPT } },
        },
        {
          request: { query: myRubricEvaluationQueryDocument, variables: { sessionId: SESSION_B_ID } },
          result: { data: { myRubricEvaluation: null } },
        },
      ]),
      cache: createApolloCache(),
    });

    const submitted = await client.query({
      query: myRubricEvaluationQueryDocument,
      variables: { sessionId: SESSION_A_ID },
    });
    const submittedData = requireResultData(submitted, "own submission read");
    expect(submittedData.myRubricEvaluation?.id).toBe(EVALUATION_ID);
    expect(submittedData.myRubricEvaluation?.weaknessArea).toBeNull();

    // The unsubmitted arm is a legal null on the wire (nullable root field),
    // read back as null — never a foreign row.
    const unsubmitted = await client.query({
      query: myRubricEvaluationQueryDocument,
      variables: { sessionId: SESSION_B_ID },
    });
    const unsubmittedData = requireResultData(unsubmitted, "unsubmitted read");
    expect(unsubmittedData.myRubricEvaluation).toBeNull();

    const extracted = JSON.stringify(client.cache.extract());
    expect(extracted).toContain(`"RubricEvaluation:${EVALUATION_ID}"`);

    expect(warnSpy.mock.calls).toHaveLength(0);
    expect(errorSpy.mock.calls.filter(call => isCacheDataLossWarning(call))).toHaveLength(0);
  });
});

// ===========================================================================
// DEV-MODE CANARY — MUST stay LAST in this file.
//
// Apollo dedups the data-loss warning per `Parent.field` in a module-level
// set: if this control ran first, it would silence a genuine warning for the
// same field in the round-trip above. Running it last keeps the round-trip's
// zero assertion non-vacuous while still proving the machinery is live.
describe("dev-mode canary — the zero-warning assertions above are not vacuous", () => {
  // Client-side probe documents only. The control replays the exact lossy
  // mechanism the round-trip avoids: the id-less `SessionPage` wrapper is
  // stored INLINE under its root-field key, so a second write of the SAME
  // probe with a dropped member (`totalCount`) REPLACES the stored value —
  // the partial-replace path a `keyFields: false`-less embedded type trips.
  // (Normalized `id`-bearing rows cannot replay it: entity merges keep
  // previously stored fields, so the receipt probes stay warning-free by
  // design — the wrapper is where the loss lives.)
  const FULL_PAGE_PROBE_DOCUMENT = parse(`
    query RubricPageProbeFull {
      myRubricPendingSessions(page: 1, pageSize: 25) {
        items {
          id
        }
        totalCount
      }
    }
  `);
  const PARTIAL_PAGE_PROBE_DOCUMENT = parse(`
    query RubricPageProbePartial {
      myRubricPendingSessions(page: 1, pageSize: 25) {
        items {
          id
        }
      }
    }
  `);

  test("a WOULD-lose-data write through an UNPOLICIED cache DOES emit the warning", () => {
    const warnSpy = spyOn(console, "warn");
    activeSpies.push(warnSpy);

    const cache = new InMemoryCache(); // deliberately NO typePolicies
    cache.writeQuery({
      query: FULL_PAGE_PROBE_DOCUMENT,
      data: {
        myRubricPendingSessions: {
          __typename: "SessionPage",
          items: [{ __typename: "Session", id: SESSION_A_ID }],
          totalCount: 2,
        },
      },
    });
    cache.writeQuery({
      query: PARTIAL_PAGE_PROBE_DOCUMENT,
      data: {
        myRubricPendingSessions: {
          __typename: "SessionPage",
          items: [{ __typename: "Session", id: SESSION_A_ID }],
        },
      },
    });

    // If this ever fails, Apollo's dev mode (or the console spy) is inert in
    // this process — the round-trip zero assertions would be vacuously green.
    // See test/preload/apollo-dev-flag.ts for the flag-capture semantics.
    expect(warnSpy.mock.calls.some(call => isCacheDataLossWarning(call))).toBe(true);
  });
});
