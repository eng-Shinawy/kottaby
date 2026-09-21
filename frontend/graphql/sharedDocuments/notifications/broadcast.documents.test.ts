/**
 * Structural lock over the admin-broadcast shared GraphQL document.
 *
 * Mirrors the `notification.documents.test.ts` discipline for the broadcast
 * domain: the `/admin/broadcasts` compose container relies on this SHARED
 * `TypedDocumentNode` document, so drift fails at this pure logic tier
 * instead of surfacing as confusing wire mismatches later:
 *
 *   1. NAMED operation — the broadcast document is a single named mutation
 *      (`AdminBroadcastNotification`) matching its
 *      `{entityName}MutationDocument` export convention.
 *   2. Variable surface — `input` is the ONLY declared variable AND the
 *      ONLY root-field argument (wired as a variable, never a literal), and
 *      it is a non-null `AdminBroadcastNotificationInput`: zero identity
 *      variables exist anywhere in the document (actor identity is derived
 *      server-side from the authenticated admin).
 *   3. Bare `Int!` payload — the root field selects NO sub-selection, so
 *      there is nothing for Apollo to normalize.
 *   4. Transport discipline — no token-like or idempotency material in the
 *      document text: the compose-session key rides the `X-Idempotency-Key`
 *      HTTP header via the Apollo operation context (the authLink additive
 *      merge), never the input DTO.
 *   5. Codegen binding + barrel parity — the constant stays
 *      `TypedDocumentNode`-typed against the generated operation types
 *      (compile-time proof by assignment), and the top-level barrel
 *      re-exports the SAME document instance as the deep import (consumer
 *      import conventions table).
 *
 * The lifecycle trio — history list, detail read, stop mutation — extends
 * the same discipline:
 *
 *   6. NAMED operations — each lifecycle document is a single named
 *      operation on the right channel, matching its
 *      `{entityName}QueryDocument`/`{entityName}MutationDocument` export
 *      convention, with the exact sanctioned variable surface threaded
 *      into the root field (no dead variables, no literal arguments).
 *   7. Normalized rows — both reads spread the SHARED
 *      `AdminBroadcastEntryFields` fragment, which selects `id` FIRST (and
 *      the full pinned field set), so a stop-triggered refetch lands in the
 *      identical cache shape as the history rows. The id-less envelopes
 *      (`AdminBroadcastPage`, `AdminBroadcastDetail`) are embedded value
 *      objects and never select an `id`.
 *   8. Self-scoped surface — `broadcastId` is the ONLY variable on the
 *      detail read and the stop mutation (the resource pointer the server
 *      contract requires); caller identity lives in the session. No
 *      token-like or idempotency material rides anywhere in the documents.
 *
 * Zero server boot, zero DB, zero network: inspects only the already-
 * compiled AST through graphql kind-guard narrowing — no unsafe assertions
 * anywhere. NO useLazyQuery exists anywhere in the documents layer;
 * consumers import hooks from "@apollo/client/react".
 */

import { describe, expect, test } from "bun:test";
import type { TypedDocumentNode } from "@apollo/client";
import {
  type DocumentNode,
  type FieldNode,
  type FragmentDefinitionNode,
  type FragmentSpreadNode,
  type NamedTypeNode,
  type OperationDefinitionNode,
  print,
  type TypeNode,
} from "graphql";
import type {
  AdminBroadcastDetailQuery,
  AdminBroadcastDetailQueryVariables,
  AdminBroadcastNotificationMutation,
  AdminBroadcastNotificationMutationVariables,
  AdminBroadcastsQuery,
  AdminBroadcastsQueryVariables,
  AdminStopBroadcastMutation,
  AdminStopBroadcastMutationVariables,
} from "@/frontend/graphql/generated/gql/graphql";
import {
  adminBroadcastsQueryDocument as broadcastsViaBarrel,
  adminBroadcastNotificationMutationDocument as broadcastViaBarrel,
  adminBroadcastDetailQueryDocument as detailViaBarrel,
  adminStopBroadcastMutationDocument as stopViaBarrel,
} from "@/frontend/graphql/sharedDocuments";
import {
  adminBroadcastDetailQueryDocument,
  adminBroadcastNotificationMutationDocument,
  adminBroadcastsQueryDocument,
  adminStopBroadcastMutationDocument,
} from "@/frontend/graphql/sharedDocuments/notifications/broadcast.documents";

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

type SelectionParent = OperationDefinitionNode | FieldNode | FragmentDefinitionNode;

function subFields(parent: SelectionParent): FieldNode[] {
  const selectionSet = parent.selectionSet;
  if (!selectionSet) {
    return [];
  }
  return selectionSet.selections.filter((selection): selection is FieldNode => selection.kind === "Field");
}

function subField(parent: OperationDefinitionNode | FieldNode, name: string): FieldNode | undefined {
  return subFields(parent).find(field => field.name.value === name);
}

function variableNames(operation: OperationDefinitionNode): string[] {
  return (operation.variableDefinitions ?? []).map(definition => definition.variable.name.value);
}

/** Resolves a variable definition's type to its inner named type, or null. */
function namedTypeOf(type: TypeNode): NamedTypeNode | null {
  if (type.kind === "NamedType") {
    return type;
  }
  if (type.kind === "NonNullType" && type.type.kind === "NamedType") {
    return type.type;
  }
  return null;
}

function fieldNames(parent: SelectionParent): string[] {
  return subFields(parent).map(field => field.name.value);
}

/** The named fragment definition embedded in a document, or throws. */
function fragmentDefinition(document: DocumentNode, name: string): FragmentDefinitionNode {
  const fragment = document.definitions.find(
    (definition): definition is FragmentDefinitionNode =>
      definition.kind === "FragmentDefinition" && definition.name.value === name
  );
  expect(fragment).toBeDefined();
  if (!fragment) {
    throw new Error(`expected fragment ${name} to exist in the document`);
  }
  return fragment;
}

/** Fragment spreads referenced on a selection set, by name. */
function fragmentSpreads(parent: OperationDefinitionNode | FieldNode): string[] {
  const selectionSet = parent.selectionSet;
  if (!selectionSet) {
    return [];
  }
  return selectionSet.selections
    .filter((selection): selection is FragmentSpreadNode => selection.kind === "FragmentSpread")
    .map(selection => selection.name.value);
}

// ---------------------------------------------------------------------------
// Contract pins

describe("broadcast document — named operation + variable surface", () => {
  test("AdminBroadcastNotification is a single named mutation declaring exactly one variable", () => {
    const operation = operationOrThrow(adminBroadcastNotificationMutationDocument);
    expect(operation.name?.value).toBe("AdminBroadcastNotification");
    expect(operation.name?.value ?? "").not.toBe("");
    expect(operation.operation).toBe("mutation");
    expect(variableNames(operation)).toEqual(["input"]);
  });

  test("the root field threads the variable (no dead variables, no literal arguments)", () => {
    const operation = operationOrThrow(adminBroadcastNotificationMutationDocument);
    const root = subField(operation, "adminBroadcastNotification");
    expect(root).toBeDefined();
    if (!root) {
      throw new Error("expected the adminBroadcastNotification root field to exist");
    }
    // Exactly ONE argument on the wire — and it is the `$input` variable
    // itself (a literal smuggled past the variable contract would fail the
    // Variable-kind pin).
    expect(root.arguments ?? []).toHaveLength(1);
    const [argument] = root.arguments ?? [];
    expect(argument?.value.kind).toBe("Variable");
    if (argument?.value.kind === "Variable") {
      expect(argument.value.name.value).toBe("input");
    }
    expect(argument?.name.value).toBe("input");
  });

  test("variable surface is exactly input — zero identity variables", () => {
    const operation = operationOrThrow(adminBroadcastNotificationMutationDocument);
    const declared = variableNames(operation);
    expect(declared).toEqual(["input"]);
    // Belt-and-braces: the closed variable surface names no identity field
    // (recipients/actor resolve server-side from the authenticated admin).
    for (const name of declared) {
      expect(name.toLowerCase()).not.toContain("user");
      expect(name.toLowerCase()).not.toContain("actor");
      expect(name.toLowerCase()).not.toContain("recipient");
    }
  });

  test("the input variable is a non-null AdminBroadcastNotificationInput", () => {
    const operation = operationOrThrow(adminBroadcastNotificationMutationDocument);
    const definition = operation.variableDefinitions?.[0];
    expect(definition).toBeDefined();
    if (!definition) {
      throw new Error("expected one VariableDefinition on the broadcast mutation");
    }
    expect(definition.type.kind).toBe("NonNullType");
    const named = namedTypeOf(definition.type);
    expect(named?.name.value).toBe("AdminBroadcastNotificationInput");
  });
});

describe("broadcast document — payload + transport shapes", () => {
  test("adminBroadcastNotification is a bare Int payload (no sub-selection)", () => {
    const operation = operationOrThrow(adminBroadcastNotificationMutationDocument);
    const root = subField(operation, "adminBroadcastNotification");
    expect(root).toBeDefined();
    expect(root?.selectionSet).toBeUndefined();
  });

  test("no token-like or idempotency material rides in the document (key rides headers only)", () => {
    const source = print(adminBroadcastNotificationMutationDocument);
    expect(source).not.toMatch(/authorization/i);
    expect(source).not.toMatch(/bearer/i);
    expect(source).not.toMatch(/idempoten/i);
    expect(source).not.toMatch(/token/i);
  });
});

describe("broadcast documents — codegen binding + barrel parity", () => {
  test("top-level barrel re-exports the SAME document instance (cache-key safety)", () => {
    expect(broadcastViaBarrel).toBe(adminBroadcastNotificationMutationDocument);
  });

  test("document remains TypedDocumentNode-typed against generated operation types", () => {
    // Compile-time proof by assignment — tsgo fails if the exported constant
    // loses its codegen typing or picks up an inline type literal.
    const typed: TypedDocumentNode<AdminBroadcastNotificationMutation, AdminBroadcastNotificationMutationVariables> =
      adminBroadcastNotificationMutationDocument;

    // Runtime uses keep the binding from being flagged as unused.
    expect(typed.loc).toBeDefined();
  });
});

describe("history list — named operation + variable surface", () => {
  test("AdminBroadcasts is a single named query declaring exactly the pagination surface", () => {
    const operation = operationOrThrow(adminBroadcastsQueryDocument);
    expect(operation.name?.value).toBe("AdminBroadcasts");
    expect(operation.operation).toBe("query");
    expect(variableNames(operation)).toEqual(["filters", "page", "pageSize"]);
  });

  test("the root field threads every variable (no dead variables, no literal arguments)", () => {
    const operation = operationOrThrow(adminBroadcastsQueryDocument);
    const root = subField(operation, "adminBroadcasts");
    expect(root).toBeDefined();
    if (!root) {
      throw new Error("expected the adminBroadcasts root field to exist");
    }
    expect((root.arguments ?? []).map(argument => argument.name.value)).toEqual(["filters", "page", "pageSize"]);
    for (const argument of root.arguments ?? []) {
      expect(argument.value.kind).toBe("Variable");
      if (argument.value.kind === "Variable") {
        expect(variableNames(operation)).toContain(argument.value.name.value);
      }
    }
  });

  test("filters variable is the nullable AdminBroadcastFiltersInput (the whole filter surface)", () => {
    const operation = operationOrThrow(adminBroadcastsQueryDocument);
    const definition = (operation.variableDefinitions ?? []).find(item => item.variable.name.value === "filters");
    expect(definition).toBeDefined();
    if (!definition) {
      throw new Error("expected the filters VariableDefinition to exist");
    }
    expect(definition.type.kind).toBe("NamedType");
    expect(namedTypeOf(definition.type)?.name.value).toBe("AdminBroadcastFiltersInput");
  });

  test("page envelope echoes totalCount, page, pageSize and spreads the shared entry fragment", () => {
    const operation = operationOrThrow(adminBroadcastsQueryDocument);
    const envelope = subField(operation, "adminBroadcasts");
    if (!envelope) {
      throw new Error("expected the adminBroadcasts envelope to exist");
    }
    expect(fieldNames(envelope)).toEqual(["items", "totalCount", "page", "pageSize"]);
    const items = subField(envelope, "items");
    if (!items) {
      throw new Error("expected the items selection to exist");
    }
    expect(fragmentSpreads(items)).toEqual(["AdminBroadcastEntryFields"]);
  });
});

describe("detail read — named operation + variable surface", () => {
  test("AdminBroadcastDetail is a single named query declaring exactly one variable", () => {
    const operation = operationOrThrow(adminBroadcastDetailQueryDocument);
    expect(operation.name?.value).toBe("AdminBroadcastDetail");
    expect(operation.operation).toBe("query");
    expect(variableNames(operation)).toEqual(["broadcastId"]);
  });

  test("the root field threads broadcastId as a non-null Int variable (the resource pointer)", () => {
    const operation = operationOrThrow(adminBroadcastDetailQueryDocument);
    const root = subField(operation, "adminBroadcastDetail");
    expect(root).toBeDefined();
    if (!root) {
      throw new Error("expected the adminBroadcastDetail root field to exist");
    }
    expect(root.arguments ?? []).toHaveLength(1);
    const [argument] = root.arguments ?? [];
    expect(argument?.name.value).toBe("broadcastId");
    expect(argument?.value.kind).toBe("Variable");
    if (argument?.value.kind === "Variable") {
      expect(argument.value.name.value).toBe("broadcastId");
    }
    const definition = (operation.variableDefinitions ?? [])[0];
    if (!definition) {
      throw new Error("expected one VariableDefinition on the detail query");
    }
    expect(definition.type.kind).toBe("NonNullType");
    expect(namedTypeOf(definition.type)?.name.value).toBe("Int");
  });

  test("detail envelope carries entry (shared fragment) plus the two live counters", () => {
    const operation = operationOrThrow(adminBroadcastDetailQueryDocument);
    const envelope = subField(operation, "adminBroadcastDetail");
    if (!envelope) {
      throw new Error("expected the adminBroadcastDetail envelope to exist");
    }
    expect(fieldNames(envelope)).toEqual(["entry", "liveDeliveredCount", "liveReadCount"]);
    const entry = subField(envelope, "entry");
    if (!entry) {
      throw new Error("expected the entry selection to exist");
    }
    expect(fragmentSpreads(entry)).toEqual(["AdminBroadcastEntryFields"]);
  });
});

describe("stop mutation — named operation + variable surface", () => {
  test("AdminStopBroadcast is a single named mutation declaring exactly one variable", () => {
    const operation = operationOrThrow(adminStopBroadcastMutationDocument);
    expect(operation.name?.value).toBe("AdminStopBroadcast");
    expect(operation.operation).toBe("mutation");
    expect(variableNames(operation)).toEqual(["broadcastId"]);
  });

  test("adminStopBroadcast is a bare Int payload threaded with the non-null Int broadcastId", () => {
    const operation = operationOrThrow(adminStopBroadcastMutationDocument);
    const root = subField(operation, "adminStopBroadcast");
    expect(root).toBeDefined();
    if (!root) {
      throw new Error("expected the adminStopBroadcast root field to exist");
    }
    expect(root.selectionSet).toBeUndefined();
    expect(root.arguments ?? []).toHaveLength(1);
    const [argument] = root.arguments ?? [];
    expect(argument?.name.value).toBe("broadcastId");
    expect(argument?.value.kind).toBe("Variable");
    if (argument?.value.kind === "Variable") {
      expect(argument.value.name.value).toBe("broadcastId");
    }
    const definition = (operation.variableDefinitions ?? [])[0];
    if (!definition) {
      throw new Error("expected one VariableDefinition on the stop mutation");
    }
    expect(definition.type.kind).toBe("NonNullType");
    expect(namedTypeOf(definition.type)?.name.value).toBe("Int");
  });
});

describe("lifecycle documents — normalized rows + transport discipline", () => {
  test("AdminBroadcastEntryFields fragment selects id FIRST (row normalization)", () => {
    const fragment = fragmentDefinition(adminBroadcastsQueryDocument, "AdminBroadcastEntryFields");
    expect(fieldNames(fragment)[0]).toBe("id");
    expect(fieldNames(fragment)).toEqual([
      "id",
      "title",
      "body",
      "status",
      "audienceType",
      "audienceRole",
      "audienceCountry",
      "audiencePlanId",
      "recipientCount",
      "sentAt",
      "sentById",
      "sentByName",
      "stoppedAt",
      "stoppedById",
      "stoppedByName",
    ]);
  });

  test("both reads embed the SAME fragment definition (identical cache shape after refetches)", () => {
    const listFragment = fragmentDefinition(adminBroadcastsQueryDocument, "AdminBroadcastEntryFields");
    const detailFragment = fragmentDefinition(adminBroadcastDetailQueryDocument, "AdminBroadcastEntryFields");
    expect(print(listFragment)).toBe(print(detailFragment));
  });

  test("id-less envelopes never mint an id (embedded value objects)", () => {
    const operation = operationOrThrow(adminBroadcastsQueryDocument);
    const envelope = subField(operation, "adminBroadcasts");
    if (!envelope) {
      throw new Error("expected the adminBroadcasts envelope to exist");
    }
    expect(fieldNames(envelope)).not.toContain("id");
    const detailOperation = operationOrThrow(adminBroadcastDetailQueryDocument);
    const detailEnvelope = subField(detailOperation, "adminBroadcastDetail");
    if (!detailEnvelope) {
      throw new Error("expected the adminBroadcastDetail envelope to exist");
    }
    expect(fieldNames(detailEnvelope)).not.toContain("id");
  });

  test("zero identity variables anywhere in the lifecycle documents (caller identity lives in the session)", () => {
    for (const document of [
      adminBroadcastsQueryDocument,
      adminBroadcastDetailQueryDocument,
      adminStopBroadcastMutationDocument,
    ]) {
      const operation = operationOrThrow(document);
      for (const name of variableNames(operation)) {
        expect(name.toLowerCase()).not.toContain("user");
        expect(name.toLowerCase()).not.toContain("admin");
        expect(name.toLowerCase()).not.toContain("token");
        expect(name.toLowerCase()).not.toContain("session");
        expect(name.toLowerCase()).not.toContain("authorization");
      }
    }
  });

  test("no token-like or idempotency material rides in any lifecycle document (key rides headers only)", () => {
    for (const document of [
      adminBroadcastsQueryDocument,
      adminBroadcastDetailQueryDocument,
      adminStopBroadcastMutationDocument,
    ]) {
      const source = print(document);
      expect(source).not.toMatch(/authorization/i);
      expect(source).not.toMatch(/bearer/i);
      expect(source).not.toMatch(/idempoten/i);
      expect(source).not.toMatch(/token/i);
    }
  });
});

describe("lifecycle documents — codegen binding + barrel parity", () => {
  test("top-level barrel re-exports the SAME document instances (cache-key safety)", () => {
    expect(broadcastsViaBarrel).toBe(adminBroadcastsQueryDocument);
    expect(detailViaBarrel).toBe(adminBroadcastDetailQueryDocument);
    expect(stopViaBarrel).toBe(adminStopBroadcastMutationDocument);
  });

  test("lifecycle documents remain TypedDocumentNode-typed against generated operation types", () => {
    // Compile-time proof by assignment — tsgo fails if an exported constant
    // loses its codegen typing or picks up an inline type literal.
    const list: TypedDocumentNode<AdminBroadcastsQuery, AdminBroadcastsQueryVariables> = adminBroadcastsQueryDocument;
    const detail: TypedDocumentNode<AdminBroadcastDetailQuery, AdminBroadcastDetailQueryVariables> =
      adminBroadcastDetailQueryDocument;
    const stop: TypedDocumentNode<AdminStopBroadcastMutation, AdminStopBroadcastMutationVariables> =
      adminStopBroadcastMutationDocument;

    // Runtime uses keep the bindings from being flagged as unused.
    expect(list.loc).toBeDefined();
    expect(detail.loc).toBeDefined();
    expect(stop.loc).toBeDefined();
  });
});
