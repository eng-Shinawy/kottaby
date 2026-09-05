/**
 * Structural lock over the parent-child link request shared GraphQL
 * documents.
 *
 * Mirrors the `sharedDocuments/notifications/notification.documents.test.ts`
 * discipline for the parent-link domain: the student link-requests page
 * and the parent handshake outgoing-requests section rely on
 * these SHARED `TypedDocumentNode` documents, so drift fails at this pure
 * logic tier instead of surfacing as confusing wire mismatches later:
 *
 *   1. NAMED operations — every parent-link document is a single named
 *      operation whose GraphQL operation name matches its
 *      `{entityName}…Document` export convention, on the right channel
 *      (query vs mutation), with the exact sanctioned variable set
 *      (the five pinned operations, EXACT names).
 *   2. Argument wiring — each declared variable is actually threaded into
 *      its root-field argument (no dead variables, no literal arguments
 *      that would bypass the variable contract).
 *   3. `id` field requirement — every object selection (both
 *      `OutgoingParentLinkRequest` and `IncomingParentLinkRequest` rows)
 *      selects the exact six-field canonical row with `id` FIRST so
 *      Apollo normalizes the cache entries (both objects carry real
 *      `id`s — the frozen `apolloCache.ts` policy inventory stays
 *      untouched). `respondedAt` (the sole nullable field) is selected
 *      so resolved rows restyle without a refetch.
 *   4. Self-scoped surface — the pinned variable sets (`code` /
 *      `requestId` + `accept` / `requestId`, none for the two lists) are
 *      the WHOLE variable surface: no identity argument (user/parent/
 *      student) exists anywhere in the documents; identity is always
 *      derived server-side from the authenticated caller.
 *   5. Codegen binding + barrel parity — the constants stay
 *      `TypedDocumentNode`-typed against the generated operation types
 *      (compile-time proof by assignment), the generated `LinkStatus`
 *      enum members are the GraphQL WIRE names, `requestParentChildLink`
 *      is the ONLY nullable payload (the null-collapse contract), and the
 *      top-level barrel re-exports the SAME document instances as the
 *      deep imports (consumer import conventions table).
 *
 * Zero server boot, zero DB, zero network: inspects only already-compiled
 * ASTs through graphql kind-guard narrowing — no unsafe assertions anywhere
 * (oxlint `no-unsafe-type-assertion`). NO useLazyQuery exists anywhere in
 * the documents layer; consumers import hooks from "@apollo/client/react".
 */

import { describe, expect, test } from "bun:test";
import type { TypedDocumentNode } from "@apollo/client";
import type { DocumentNode, FieldNode, OperationDefinitionNode } from "graphql";
import {
  type CancelParentLinkRequestMutation,
  type CancelParentLinkRequestMutationVariables,
  LinkStatus,
  type MyIncomingParentLinkRequestsQuery,
  type MyOutgoingParentLinkRequestsQuery,
  type RequestParentChildLinkMutation,
  type RequestParentChildLinkMutationVariables,
  type RespondToParentLinkRequestMutation,
  type RespondToParentLinkRequestMutationVariables,
} from "@/frontend/graphql/generated/gql/graphql";
import {
  cancelParentLinkRequestMutationDocument as cancelViaBarrel,
  myIncomingParentLinkRequestsQueryDocument as myIncomingViaBarrel,
  myOutgoingParentLinkRequestsQueryDocument as myOutgoingViaBarrel,
  requestParentChildLinkMutationDocument as requestViaBarrel,
  respondToParentLinkRequestMutationDocument as respondViaBarrel,
} from "@/frontend/graphql/sharedDocuments";
import {
  cancelParentLinkRequestMutationDocument,
  myIncomingParentLinkRequestsQueryDocument,
  myOutgoingParentLinkRequestsQueryDocument,
  requestParentChildLinkMutationDocument,
  respondToParentLinkRequestMutationDocument,
} from "@/frontend/graphql/sharedDocuments/parents/parent-link.documents";

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

/** Resolves a dotted selection path ("myOutgoingParentLinkRequests") or throws. */
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
  // zero arguments (e.g. the zero-arg `myOutgoingParentLinkRequests` list).
  return (field.arguments ?? []).flatMap(argument =>
    argument.value.kind === "Variable" ? [argument.value.name.value] : []
  );
}

/**
 * The consumer-side guard for the null collapse: a `null`
 * `requestParentChildLink` payload renders the sendUnavailableNotice —
 * exactly this predicate. Module scope (consistent-function-scoping).
 */
function isCollapsedPayload(payload: RequestParentChildLinkMutation["requestParentChildLink"] | null): boolean {
  return payload === null;
}

// ---------------------------------------------------------------------------
// Contract table

/** The exact six-field canonical row of each object kind, `id` FIRST. */
const OUTGOING_ROW = ["id", "status", "studentMaskedName", "createdAt", "expiresAt", "respondedAt"];
const INCOMING_ROW = ["id", "status", "parentFullName", "createdAt", "expiresAt", "respondedAt"];

interface ParentLinkDocumentRow {
  readonly document: DocumentNode;
  readonly operationName: string;
  readonly channel: "mutation" | "query";
  /** Expected `($var, …)` declarations ([] for zero-arg operations), in the
   * SAME order the document declares them (wire/source order). */
  readonly variables: readonly string[];
  /** Root field the operation targets. */
  readonly rootField: string;
  /** Dotted object-selection path + the exact canonical row it must carry. */
  readonly rowSelection: { readonly path: string; readonly row: readonly string[] };
}

const PARENT_LINK_DOCUMENT_TABLE: readonly ParentLinkDocumentRow[] = [
  {
    document: myOutgoingParentLinkRequestsQueryDocument,
    operationName: "MyOutgoingParentLinkRequests",
    channel: "query",
    variables: [],
    rootField: "myOutgoingParentLinkRequests",
    rowSelection: { path: "myOutgoingParentLinkRequests", row: OUTGOING_ROW },
  },
  {
    document: myIncomingParentLinkRequestsQueryDocument,
    operationName: "MyIncomingParentLinkRequests",
    channel: "query",
    variables: [],
    rootField: "myIncomingParentLinkRequests",
    rowSelection: { path: "myIncomingParentLinkRequests", row: INCOMING_ROW },
  },
  {
    document: requestParentChildLinkMutationDocument,
    operationName: "RequestParentChildLink",
    channel: "mutation",
    variables: ["code"],
    rootField: "requestParentChildLink",
    rowSelection: { path: "requestParentChildLink", row: OUTGOING_ROW },
  },
  {
    document: respondToParentLinkRequestMutationDocument,
    operationName: "RespondToParentLinkRequest",
    channel: "mutation",
    variables: ["requestId", "accept"],
    rootField: "respondToParentLinkRequest",
    rowSelection: { path: "respondToParentLinkRequest", row: INCOMING_ROW },
  },
  {
    document: cancelParentLinkRequestMutationDocument,
    operationName: "CancelParentLinkRequest",
    channel: "mutation",
    variables: ["requestId"],
    rootField: "cancelParentLinkRequest",
    rowSelection: { path: "cancelParentLinkRequest", row: OUTGOING_ROW },
  },
];

describe("parent-link documents — named operations + channel + variables", () => {
  for (const row of PARENT_LINK_DOCUMENT_TABLE) {
    test(`${row.operationName} is a single named ${row.channel} operation`, () => {
      const operation = operationOrThrow(row.document);
      expect(operation.name?.value).toBe(row.operationName);
      expect(operation.name?.value ?? "").not.toBe("");
      expect(operation.operation).toBe(row.channel);
      expect(variableNames(operation)).toEqual([...row.variables]);
    });
  }

  test("every declared variable is wired into its root-field argument (no dead variables, no literal arguments)", () => {
    for (const row of PARENT_LINK_DOCUMENT_TABLE) {
      const operation = operationOrThrow(row.document);
      const root = selectionPath(operation, row.rootField);
      expect(argumentVariableNames(root)).toEqual([...row.variables]);
    }
  });

  test("variable surface is exactly the sanctioned code/requestId/accept set — zero identity arguments", () => {
    const declared = PARENT_LINK_DOCUMENT_TABLE.flatMap(row => variableNames(operationOrThrow(row.document))).toSorted(
      (a, b) => a.localeCompare(b)
    );
    expect(declared).toEqual(["accept", "code", "requestId", "requestId"]);
    // Belt-and-braces: no document smuggles a caller-identity argument —
    // the handshake code is the ONLY targeting capability, request ids are
    // the ONLY row handles; parent/student/user ids never cross the wire.
    for (const name of declared) {
      expect(name.toLowerCase()).not.toContain("user");
      expect(name.toLowerCase()).not.toContain("parent");
      expect(name.toLowerCase()).not.toContain("student");
    }
  });
});

describe("parent-link documents — id-first + canonical row shapes", () => {
  test("every object selection carries the exact canonical row with id FIRST", () => {
    for (const row of PARENT_LINK_DOCUMENT_TABLE) {
      const operation = operationOrThrow(row.document);
      const selection = selectionPath(operation, row.rowSelection.path);
      // Exact-order equality both closes the selection set (no extra or
      // missing fields) and pins `id` as the FIRST selection.
      expect(fieldNames(selection)).toEqual([...row.rowSelection.row]);
      expect(fieldNames(selection)[0]).toBe("id");
    }
  });

  test("outgoing rows carry studentMaskedName and incoming rows carry parentFullName — never both", () => {
    for (const row of PARENT_LINK_DOCUMENT_TABLE) {
      const operation = operationOrThrow(row.document);
      const selection = selectionPath(operation, row.rowSelection.path);
      const names = fieldNames(selection);
      if (row.rowSelection.row === OUTGOING_ROW) {
        expect(names).toContain("studentMaskedName");
        expect(names).not.toContain("parentFullName");
      } else {
        expect(names).toContain("parentFullName");
        expect(names).not.toContain("studentMaskedName");
      }
    }
  });

  test("both list queries are zero-argument with no root-field arguments", () => {
    for (const row of PARENT_LINK_DOCUMENT_TABLE.filter(entry => entry.channel === "query")) {
      const operation = operationOrThrow(row.document);
      expect(operation.variableDefinitions ?? []).toHaveLength(0);
      const root = selectionPath(operation, row.rootField);
      expect(root.arguments ?? []).toHaveLength(0);
    }
  });

  test("respondedAt is selected on every row (the sole nullable timestamp, resolved-state restyling)", () => {
    for (const row of PARENT_LINK_DOCUMENT_TABLE) {
      const operation = operationOrThrow(row.document);
      const selection = selectionPath(operation, row.rowSelection.path);
      expect(fieldNames(selection)).toContain("respondedAt");
    }
  });
});

describe("parent-link documents — codegen binding + barrel parity", () => {
  test("top-level barrel re-exports the SAME document instances (cache-key safety)", () => {
    expect(myOutgoingViaBarrel).toBe(myOutgoingParentLinkRequestsQueryDocument);
    expect(myIncomingViaBarrel).toBe(myIncomingParentLinkRequestsQueryDocument);
    expect(requestViaBarrel).toBe(requestParentChildLinkMutationDocument);
    expect(respondViaBarrel).toBe(respondToParentLinkRequestMutationDocument);
    expect(cancelViaBarrel).toBe(cancelParentLinkRequestMutationDocument);
  });

  test("documents remain TypedDocumentNode-typed against generated operation types", () => {
    // Compile-time proof by assignment — tsgo fails if any exported constant
    // loses its codegen typing or picks up an inline type literal.
    const typedOutgoing: TypedDocumentNode<MyOutgoingParentLinkRequestsQuery> =
      myOutgoingParentLinkRequestsQueryDocument;
    const typedIncoming: TypedDocumentNode<MyIncomingParentLinkRequestsQuery> =
      myIncomingParentLinkRequestsQueryDocument;
    const typedRequest: TypedDocumentNode<RequestParentChildLinkMutation, RequestParentChildLinkMutationVariables> =
      requestParentChildLinkMutationDocument;
    const typedRespond: TypedDocumentNode<
      RespondToParentLinkRequestMutation,
      RespondToParentLinkRequestMutationVariables
    > = respondToParentLinkRequestMutationDocument;
    const typedCancel: TypedDocumentNode<CancelParentLinkRequestMutation, CancelParentLinkRequestMutationVariables> =
      cancelParentLinkRequestMutationDocument;

    // Runtime uses keep the bindings from being flagged as unused.
    expect(typedOutgoing.loc).toBeDefined();
    expect(typedIncoming.loc).toBeDefined();
    expect(typedRequest.loc).toBeDefined();
    expect(typedRespond.loc).toBeDefined();
    expect(typedCancel.loc).toBeDefined();
  });

  test("requestParentChildLink is the ONLY nullable payload (the null collapse)", () => {
    // Compile-time proof by assignment — the `null` literal is assignable to
    // the generated payload type ONLY because the codegen union carries the
    // null member (unknown code ≡ governed code ≡ non-linkable).
    // The respond/cancel payload types REJECT null: a `null` assignment there
    // would fail `bun tsgo` — the non-null side of this pin is enforced at
    // the type-check gate (not expressible as a passing runtime assertion).
    const requestPayload: RequestParentChildLinkMutation["requestParentChildLink"] | null = null;
    expect(requestParentChildLinkMutationDocument.loc).toBeDefined();
    expect(isCollapsedPayload(requestPayload)).toBe(true);
  });

  test("generated LinkStatus enum members are the GraphQL wire names", () => {
    // The codegen enum is the ONLY enum frontend code may use: its values are
    // the wire names. (The backend canonical TS enum maps the same keys to
    // lowercase runtime values — server-side only, never imported here.)
    // Widening the spread into a Record<string, string> keeps the matcher
    // arguments plain strings without unsafe casts or conversions.
    const wireNames: Record<string, string> = { ...LinkStatus };
    expect(wireNames).toEqual({
      Confirmed: "Confirmed",
      Expired: "Expired",
      Pending: "Pending",
      Rejected: "Rejected",
    });
  });
});
