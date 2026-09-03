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
  type NamedTypeNode,
  type OperationDefinitionNode,
  print,
  type TypeNode,
} from "graphql";
import type {
  AdminBroadcastNotificationMutation,
  AdminBroadcastNotificationMutationVariables,
} from "@/frontend/graphql/generated/gql/graphql";
import { adminBroadcastNotificationMutationDocument as broadcastViaBarrel } from "@/frontend/graphql/sharedDocuments";
import { adminBroadcastNotificationMutationDocument } from "@/frontend/graphql/sharedDocuments/notifications/broadcast.documents";

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

describe("broadcast document — codegen binding + barrel parity", () => {
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
