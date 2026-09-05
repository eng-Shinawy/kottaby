/**
 * Structural lock over the notification shared GraphQL documents.
 *
 * Mirrors the `sharedDocuments/documents.contract.test.ts` discipline for the
 * notifications-inbox domain: the feed container, the realtime hook and the
 * badge consumers rely on these SHARED `TypedDocumentNode` documents, so
 * drift fails at this pure logic tier instead of surfacing as confusing
 * wire mismatches later:
 *
 *   1. NAMED operations — every notification document is a single named
 *      operation whose GraphQL operation name matches its
 *      `{entityName}…Document` export convention, on the right channel
 *      (query vs mutation), with the exact sanctioned variable set.
 *   2. Argument wiring — each declared variable is actually threaded into
 *      its root-field argument (no dead variables, no literal arguments
 *      that would bypass the variable contract).
 *   3. `id` field requirement — every `Notification`-typed selection
 *      (`myNotifications.items`, the `markNotificationRead` payload) selects
 *      the full eight-field row with `id` FIRST so Apollo normalizes the
 *      cache entries; the `NotificationListPage` wrapper is an embedded
 *      value type (`keyFields: false`) and correctly selects no `id`.
 *   4. Self-scoped surface — the pinned variable sets (`filter` / `id` /
 *      `type`, and none for the count) are the WHOLE variable surface: no
 *      identity argument (userId or similar) exists anywhere in the
 *      documents; identity is always derived server-side from the
 *      authenticated caller.
 *   5. Codegen binding + barrel parity — the constants stay
 *      `TypedDocumentNode`-typed against the generated operation types
 *      (compile-time proof by assignment), the generated `NotificationType`
 *      enum members are the GraphQL WIRE names (the backend runtime enum
 *      values are snake_case server-side only), and the top-level barrel
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
import {
  type MarkAllNotificationsReadMutation,
  type MarkAllNotificationsReadMutationVariables,
  type MarkNotificationReadMutation,
  type MarkNotificationReadMutationVariables,
  type MyNotificationsQuery,
  type MyNotificationsQueryVariables,
  type MyUnreadNotificationCountQuery,
  NotificationType,
} from "@/frontend/graphql/generated/gql/graphql";
import {
  markAllNotificationsReadMutationDocument as markAllViaBarrel,
  markNotificationReadMutationDocument as markOneViaBarrel,
  myNotificationsQueryDocument as myNotificationsViaBarrel,
  myUnreadNotificationCountQueryDocument as myUnreadCountViaBarrel,
} from "@/frontend/graphql/sharedDocuments";
import {
  markAllNotificationsReadMutationDocument,
  markNotificationReadMutationDocument,
  myNotificationsQueryDocument,
  myUnreadNotificationCountQueryDocument,
} from "@/frontend/graphql/sharedDocuments/notifications/notification.documents";

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

/** Resolves a dotted selection path ("myNotifications.items") or throws. */
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
  // zero arguments (e.g. the no-arg `myUnreadNotificationCount` root field).
  return (field.arguments ?? []).flatMap(argument =>
    argument.value.kind === "Variable" ? [argument.value.name.value] : []
  );
}

// ---------------------------------------------------------------------------
// Contract table

interface NotificationDocumentRow {
  readonly document: DocumentNode;
  readonly operationName: string;
  readonly channel: "mutation" | "query";
  /** Expected `($var, …)` declarations ([] for no-arg operations), in the
   * SAME order the document declares them (wire/source order). */
  readonly variables: readonly string[];
  /** Root field the operation targets. */
  readonly rootField: string;
  /** Dotted object-selection paths that must carry `id`. */
  readonly notificationSelections: readonly string[];
}

const NOTIFICATION_DOCUMENT_TABLE: readonly NotificationDocumentRow[] = [
  {
    document: myNotificationsQueryDocument,
    operationName: "MyNotifications",
    channel: "query",
    variables: ["filter"],
    rootField: "myNotifications",
    notificationSelections: ["myNotifications.items"],
  },
  {
    document: myUnreadNotificationCountQueryDocument,
    operationName: "MyUnreadNotificationCount",
    channel: "query",
    variables: [],
    rootField: "myUnreadNotificationCount",
    notificationSelections: [],
  },
  {
    document: markNotificationReadMutationDocument,
    operationName: "MarkNotificationRead",
    channel: "mutation",
    variables: ["id"],
    rootField: "markNotificationRead",
    notificationSelections: ["markNotificationRead"],
  },
  {
    document: markAllNotificationsReadMutationDocument,
    operationName: "MarkAllNotificationsRead",
    channel: "mutation",
    variables: ["type"],
    rootField: "markAllNotificationsRead",
    notificationSelections: [],
  },
];

describe("notification documents — named operations + channel + variables", () => {
  for (const row of NOTIFICATION_DOCUMENT_TABLE) {
    test(`${row.operationName} is a single named ${row.channel} operation`, () => {
      const operation = operationOrThrow(row.document);
      expect(operation.name?.value).toBe(row.operationName);
      expect(operation.name?.value ?? "").not.toBe("");
      expect(operation.operation).toBe(row.channel);
      expect(variableNames(operation)).toEqual([...row.variables]);
    });
  }

  test("every declared variable is wired into its root-field argument (no dead variables, no literal arguments)", () => {
    for (const row of NOTIFICATION_DOCUMENT_TABLE) {
      const operation = operationOrThrow(row.document);
      const root = selectionPath(operation, row.rootField);
      expect(argumentVariableNames(root)).toEqual([...row.variables]);
    }
  });

  test("variable surface is exactly the sanctioned filter/id/type set — zero identity arguments", () => {
    const declared = NOTIFICATION_DOCUMENT_TABLE.flatMap(row => variableNames(operationOrThrow(row.document))).toSorted(
      (a, b) => a.localeCompare(b)
    );
    expect(declared).toEqual(["filter", "id", "type"]);
    // Belt-and-braces: no document smuggles a caller-identity argument.
    for (const name of declared) {
      expect(name.toLowerCase()).not.toContain("user");
    }
  });
});

describe("notification documents — id + selection shapes", () => {
  test("every Notification-typed selection selects the full eight-field row with id first", () => {
    const notificationRow = [
      "id",
      "type",
      "title",
      "body",
      "isRead",
      "relatedEntityType",
      "relatedEntityId",
      "createdAt",
    ];
    for (const row of NOTIFICATION_DOCUMENT_TABLE) {
      const operation = operationOrThrow(row.document);
      for (const path of row.notificationSelections) {
        const selection = selectionPath(operation, path);
        expect(fieldNames(selection)).toEqual(notificationRow);
        expect(fieldNames(selection)[0]).toBe("id");
      }
    }
  });

  test("the NotificationListPage wrapper selects items/totalCount/hasMore and no id (embedded value type)", () => {
    const operation = operationOrThrow(myNotificationsQueryDocument);
    const wrapper = selectionPath(operation, "myNotifications");
    expect(fieldNames(wrapper).toSorted((a, b) => a.localeCompare(b))).toEqual(["hasMore", "items", "totalCount"]);
  });

  test("scalar payloads select no sub-selection (bare Int reads)", () => {
    const countOperation = operationOrThrow(myUnreadNotificationCountQueryDocument);
    expect(subField(countOperation, "myUnreadNotificationCount")?.selectionSet).toBeUndefined();

    const markAllOperation = operationOrThrow(markAllNotificationsReadMutationDocument);
    expect(subField(markAllOperation, "markAllNotificationsRead")?.selectionSet).toBeUndefined();
  });
});

describe("notification documents — codegen binding + barrel parity", () => {
  test("top-level barrel re-exports the SAME document instances (cache-key safety)", () => {
    expect(myNotificationsViaBarrel).toBe(myNotificationsQueryDocument);
    expect(myUnreadCountViaBarrel).toBe(myUnreadNotificationCountQueryDocument);
    expect(markOneViaBarrel).toBe(markNotificationReadMutationDocument);
    expect(markAllViaBarrel).toBe(markAllNotificationsReadMutationDocument);
  });

  test("documents remain TypedDocumentNode-typed against generated operation types", () => {
    // Compile-time proof by assignment — tsgo fails if any exported constant
    // loses its codegen typing or picks up an inline type literal.
    const typedList: TypedDocumentNode<MyNotificationsQuery, MyNotificationsQueryVariables> =
      myNotificationsQueryDocument;
    const typedCount: TypedDocumentNode<MyUnreadNotificationCountQuery> = myUnreadNotificationCountQueryDocument;
    const typedMarkOne: TypedDocumentNode<MarkNotificationReadMutation, MarkNotificationReadMutationVariables> =
      markNotificationReadMutationDocument;
    const typedMarkAll: TypedDocumentNode<MarkAllNotificationsReadMutation, MarkAllNotificationsReadMutationVariables> =
      markAllNotificationsReadMutationDocument;

    // Runtime uses keep the bindings from being flagged as unused.
    expect(typedList.loc).toBeDefined();
    expect(typedCount.loc).toBeDefined();
    expect(typedMarkOne.loc).toBeDefined();
    expect(typedMarkAll.loc).toBeDefined();
  });

  test("generated NotificationType enum members are the GraphQL wire names", () => {
    // The codegen enum is the ONLY enum frontend code may use: its values are
    // the wire names. (The backend canonical TS enum maps the same keys to
    // snake_case runtime values — server-side only, never imported here.)
    // Widening the spread into a Record<string, string> keeps the matcher
    // arguments plain strings without unsafe casts or conversions.
    const wireNames: Record<string, string> = { ...NotificationType };
    expect(wireNames).toEqual({
      EvaluationResult: "EvaluationResult",
      ParentLinkRequest: "ParentLinkRequest",
      PaymentConfirmation: "PaymentConfirmation",
      SessionCancellation: "SessionCancellation",
      SessionCompletion: "SessionCompletion",
      SessionRequest: "SessionRequest",
      SystemBroadcast: "SystemBroadcast",
    });
  });
});
