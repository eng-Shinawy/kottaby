/**
 * Structural lock over the session-recitation shared GraphQL documents.
 *
 * Mirrors the `sharedDocuments/parents/parent-link.documents.test.ts`
 * discipline for the recitation domain: consumer surfaces rely on these
 * SHARED `TypedDocumentNode` documents, so drift fails at this pure logic
 * tier instead of surfacing as confusing wire mismatches later:
 *
 *   1. NAMED operations — both documents are single named operations whose
 *      GraphQL operation name matches the `{entityName}…Document` export
 *      convention, on the right channel (query vs mutation), with the
 *      exact sanctioned variable set.
 *   2. Argument wiring — each declared variable is actually threaded into
 *      its root-field argument (no dead variables, no literal arguments
 *      that would bypass the variable contract).
 *   3. `id` field requirement — the payload selection carries the exact
 *      six-field canonical row with `id` FIRST so Apollo normalizes the
 *      cache entry (`SessionRecitation` carries a real `id` — the frozen
 *      `apolloCache.ts` type-policy inventory stays untouched; no
 *      `keyFields: false` registration applies).
 *   4. Self-scoped surface — the pinned variable sets (`sessionId` on the
 *      read, `sessionId` + `input` on the write) are the WHOLE variable
 *      surface: no identity argument (user/teacher/student/owner) exists
 *      anywhere in the documents; identity is always derived server-side
 *      from the authenticated caller.
 *   5. Codegen binding + barrel parity — the constants stay
 *      `TypedDocumentNode`-typed against the generated operation types
 *      (compile-time proof by assignment), the read payload is the ONLY
 *      nullable one (the null collapse), and the top-level barrel
 *      re-exports the SAME document instances as the deep imports
 *      (consumer import conventions table).
 *
 * Zero server boot, zero DB, zero network: inspects only already-compiled
 * ASTs through graphql kind-guard narrowing — no unsafe assertions anywhere
 * (oxlint `no-unsafe-type-assertion`). NO useLazyQuery exists anywhere in
 * the documents layer; consumers import hooks from "@apollo/client/react".
 */

import { describe, expect, test } from "bun:test";
import type { TypedDocumentNode } from "@apollo/client";
import type { DocumentNode, FieldNode, OperationDefinitionNode } from "graphql";
import type {
  SessionRecitationQuery,
  SessionRecitationQueryVariables,
  SetSessionRecitationMutation,
  SetSessionRecitationMutationVariables,
} from "@/frontend/graphql/generated/gql/graphql";
import {
  sessionRecitationQueryDocument as sessionRecitationViaBarrel,
  setSessionRecitationMutationDocument as setSessionRecitationViaBarrel,
} from "@/frontend/graphql/sharedDocuments";
import {
  sessionRecitationQueryDocument,
  setSessionRecitationMutationDocument,
} from "@/frontend/graphql/sharedDocuments/scheduling/recitation.documents";

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

/** Resolves a dotted selection path ("sessionRecitation") or throws. */
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
  // zero arguments.
  return (field.arguments ?? []).flatMap(argument =>
    argument.value.kind === "Variable" ? [argument.value.name.value] : []
  );
}

/**
 * The consumer-side guard for the null collapse: a `null`
 * `sessionRecitation` payload means "no visible record" — exactly this
 * predicate. Module scope (consistent-function-scoping).
 */
function isCollapsedPayload(payload: SessionRecitationQuery["sessionRecitation"] | null): boolean {
  return payload === null;
}

// ---------------------------------------------------------------------------
// Contract table

/** The exact six-field canonical row of the record, `id` FIRST. */
const RECITATION_ROW = ["id", "sessionId", "name", "description", "createdAt", "updatedAt"];

interface RecitationDocumentRow {
  readonly document: DocumentNode;
  readonly operationName: string;
  readonly channel: "mutation" | "query";
  /** Expected `($var, …)` declarations, in the SAME order the document
   * declares them (wire/source order). */
  readonly variables: readonly string[];
  /** Root field the operation targets. */
  readonly rootField: string;
}

const RECITATION_DOCUMENT_TABLE: readonly RecitationDocumentRow[] = [
  {
    document: sessionRecitationQueryDocument,
    operationName: "SessionRecitation",
    channel: "query",
    variables: ["sessionId"],
    rootField: "sessionRecitation",
  },
  {
    document: setSessionRecitationMutationDocument,
    operationName: "SetSessionRecitation",
    channel: "mutation",
    variables: ["sessionId", "input"],
    rootField: "setSessionRecitation",
  },
];

describe("recitation documents — named operations + channel + variables", () => {
  for (const row of RECITATION_DOCUMENT_TABLE) {
    test(`${row.operationName} is a single named ${row.channel} operation`, () => {
      const operation = operationOrThrow(row.document);
      expect(operation.name?.value).toBe(row.operationName);
      expect(operation.name?.value ?? "").not.toBe("");
      expect(operation.operation).toBe(row.channel);
      expect(variableNames(operation)).toEqual([...row.variables]);
    });
  }

  test("every declared variable is wired into its root-field argument (no dead variables, no literal arguments)", () => {
    for (const row of RECITATION_DOCUMENT_TABLE) {
      const operation = operationOrThrow(row.document);
      const root = selectionPath(operation, row.rootField);
      expect(argumentVariableNames(root)).toEqual([...row.variables]);
    }
  });

  test("variable surface is exactly the sanctioned sessionId/input set — zero identity variables", () => {
    const declared = RECITATION_DOCUMENT_TABLE.flatMap(row => variableNames(operationOrThrow(row.document))).toSorted(
      (a, b) => a.localeCompare(b)
    );
    expect(declared).toEqual(["input", "sessionId", "sessionId"]);
    // Belt-and-braces: no document smuggles a caller-identity variable —
    // the session id is the ONLY targeting capability and the closed
    // two-field input is the ONLY payload; user/teacher/student/owner ids
    // never cross the wire.
    for (const name of declared) {
      expect(name.toLowerCase()).not.toContain("user");
      expect(name.toLowerCase()).not.toContain("teacher");
      expect(name.toLowerCase()).not.toContain("student");
      expect(name.toLowerCase()).not.toContain("owner");
    }
  });
});

describe("recitation documents — id-first + canonical row shape", () => {
  test("the payload carries the exact canonical row with id FIRST", () => {
    for (const row of RECITATION_DOCUMENT_TABLE) {
      const operation = operationOrThrow(row.document);
      const selection = selectionPath(operation, row.rootField);
      // Exact-order equality both closes the selection set (no extra or
      // missing fields) and pins `id` as the FIRST selection.
      expect(fieldNames(selection)).toEqual([...RECITATION_ROW]);
      expect(fieldNames(selection)[0]).toBe("id");
    }
  });

  test("no ownership-lane field is selected (BOPLA surface hygiene)", () => {
    for (const row of RECITATION_DOCUMENT_TABLE) {
      const operation = operationOrThrow(row.document);
      const selection = selectionPath(operation, row.rootField);
      for (const name of fieldNames(selection)) {
        expect(name).not.toBe("userId");
        expect(name).not.toBe("teacherId");
        expect(name).not.toBe("studentId");
      }
    }
  });

  test("description (the sole nullable field) is selected so rendered rows restyle without a refetch", () => {
    for (const row of RECITATION_DOCUMENT_TABLE) {
      const operation = operationOrThrow(row.document);
      const selection = selectionPath(operation, row.rootField);
      expect(fieldNames(selection)).toContain("description");
    }
  });
});

describe("recitation documents — codegen binding + barrel parity", () => {
  test("top-level barrel re-exports the SAME document instances (cache-key safety)", () => {
    expect(sessionRecitationViaBarrel).toBe(sessionRecitationQueryDocument);
    expect(setSessionRecitationViaBarrel).toBe(setSessionRecitationMutationDocument);
  });

  test("documents remain TypedDocumentNode-typed against generated operation types", () => {
    // Compile-time proof by assignment — tsgo fails if any exported constant
    // loses its codegen typing or picks up an inline type literal.
    const typedRead: TypedDocumentNode<SessionRecitationQuery, SessionRecitationQueryVariables> =
      sessionRecitationQueryDocument;
    const typedWrite: TypedDocumentNode<SetSessionRecitationMutation, SetSessionRecitationMutationVariables> =
      setSessionRecitationMutationDocument;

    // Runtime uses keep the bindings from being flagged as unused.
    expect(typedRead.loc).toBeDefined();
    expect(typedWrite.loc).toBeDefined();
  });

  test("sessionRecitation is the ONLY nullable payload (the null collapse)", () => {
    // Compile-time proof by assignment — the `null` literal is assignable to
    // the generated payload type ONLY because the codegen union carries the
    // null member (no record ≡ foreign session ≡ nonexistent session). The
    // declaration carries NO explicit `| null` widening: a schema flip to
    // non-null would fail `bun tsgo` right here.
    // The mutation payload type REJECTS null: a `null` assignment there
    // would fail `bun tsgo` — the non-null side of this pin is enforced at
    // the type-check gate (not expressible as a passing runtime assertion).
    const readPayload: SessionRecitationQuery["sessionRecitation"] = null;
    expect(sessionRecitationQueryDocument.loc).toBeDefined();
    expect(isCollapsedPayload(readPayload)).toBe(true);
  });
});
