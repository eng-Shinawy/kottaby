/**
 * Structural lock over the admin audit-trail shared GraphQL document.
 *
 * Mirrors the `sharedDocuments/documents.contract.test.ts` discipline for the
 * admin audit-trail domain: the `/audit` view container consumes this SHARED
 * `TypedDocumentNode` document, so drift fails at this pure logic tier
 * instead of surfacing as confusing wire mismatches later:
 *
 *   1. NAMED operation — a single named query whose GraphQL operation name
 *      matches the `{entityName}…Document` export convention
 *      (`AdminAuditLogsQueryDocument` ↔ `query AdminAuditLogs`).
 *   2. Variable wiring — the declared variable set is EXACTLY
 *      `["filters", "page", "pageSize"]` (source order) and every declared
 *      variable is threaded into its root-field argument (no dead variables,
 *      no literal arguments that would bypass the variable contract).
 *   3. `id` field requirement — the `AdminAuditLogEntry` row
 *      (`adminAuditLogs.items`) selects the full eight-field scalar row with
 *      `id` FIRST so Apollo normalizes the cache entries; the
 *      `AdminAuditLogPage` wrapper is an embedded value type
 *      (`keyFields: false` in `frontend/providers/apollo/apolloCache.ts`)
 *      and correctly selects no `id`.
 *   4. Codegen binding + barrel parity — the constant stays
 *      `TypedDocumentNode`-typed against the generated operation types
 *      (compile-time proof by assignment) and the top-level barrel re-exports
 *      the SAME document instance as the deep import (consumer import
 *      conventions table).
 *
 * Zero server boot, zero DB, zero network: inspects only the already-compiled
 * AST through graphql kind-guard narrowing — no unsafe assertions anywhere
 * (oxlint `no-unsafe-type-assertion`). NO useLazyQuery exists anywhere in
 * the documents layer; consumers import hooks from "@apollo/client/react".
 */

import { describe, expect, test } from "bun:test";
import type { TypedDocumentNode } from "@apollo/client";
import type { DocumentNode, FieldNode, OperationDefinitionNode } from "graphql";
import type { AdminAuditLogsQuery, AdminAuditLogsQueryVariables } from "@/frontend/graphql/generated/gql/graphql";
import { adminAuditLogsQueryDocument as adminAuditLogsViaBarrel } from "@/frontend/graphql/sharedDocuments";
import { adminAuditLogsQueryDocument } from "@/frontend/graphql/sharedDocuments/admin/audit-trail.documents";

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

/** Resolves a dotted selection path ("adminAuditLogs.items") or throws. */
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
  return (field.arguments ?? []).flatMap(argument =>
    argument.value.kind === "Variable" ? [argument.value.name.value] : []
  );
}

// ---------------------------------------------------------------------------
// Contract pins

const ROOT_FIELD = "adminAuditLogs";
const OPERATION_NAME = "AdminAuditLogs";
/** The WHOLE variable surface, in the document's declaration (wire) order. */
const SANCTIONED_VARIABLES = ["filters", "page", "pageSize"] as const;
/** The eight-field entry row, `id` FIRST (Apollo cache normalization). */
const ENTRY_ROW_FIELDS = [
  "id",
  "actionType",
  "actorId",
  "actorName",
  "entityType",
  "entityId",
  "details",
  "createdAt",
] as const;

describe("audit-trail documents — named operation + channel + variables", () => {
  test(`${OPERATION_NAME} is a single named query operation with the exact sanctioned variable set`, () => {
    const operation = operationOrThrow(adminAuditLogsQueryDocument);
    expect(operation.name?.value).toBe(OPERATION_NAME);
    expect(operation.name?.value ?? "").not.toBe("");
    expect(operation.operation).toBe("query");
    expect(variableNames(operation)).toEqual([...SANCTIONED_VARIABLES]);
  });

  test("every declared variable is wired into its root-field argument (no dead variables, no literal arguments)", () => {
    const operation = operationOrThrow(adminAuditLogsQueryDocument);
    const root = selectionPath(operation, ROOT_FIELD);
    expect(argumentVariableNames(root)).toEqual([...SANCTIONED_VARIABLES]);
  });

  test("declared variable types are the filter input + Int pagination pair", () => {
    const operation = operationOrThrow(adminAuditLogsQueryDocument);
    const expectedTypes: ReadonlyMap<string, string> = new Map([
      ["filters", "AdminAuditLogFiltersInput"],
      ["page", "Int"],
      ["pageSize", "Int"],
    ]);
    for (const definition of operation.variableDefinitions ?? []) {
      const name = definition.variable.name.value;
      const expected = expectedTypes.get(name);
      if (expected === undefined) {
        throw new Error(`unexpected variable ${name} outside the sanctioned set`);
      }
      expect(definition.type.kind).toBe("NamedType");
      if (definition.type.kind !== "NamedType") {
        throw new Error(`variable ${name} must be a plain named type`);
      }
      expect(definition.type.name.value).toBe(expected);
    }
  });
});

describe("audit-trail documents — id + selection shapes", () => {
  test("the entry row selects the full eight-field scalar row with id first", () => {
    const operation = operationOrThrow(adminAuditLogsQueryDocument);
    const entryRow = selectionPath(operation, `${ROOT_FIELD}.items`);
    expect(fieldNames(entryRow)).toEqual([...ENTRY_ROW_FIELDS]);
    expect(fieldNames(entryRow)[0]).toBe("id");
  });

  test("the entry row is scalar-only — no nested object selections", () => {
    const operation = operationOrThrow(adminAuditLogsQueryDocument);
    const entryRow = selectionPath(operation, `${ROOT_FIELD}.items`);
    for (const field of subFields(entryRow)) {
      // Every entry field is a scalar/enum leaf; a nested object added later
      // would need an `id` of its own (Apollo normalization) and a pin here.
      expect(field.selectionSet).toBeUndefined();
    }
  });

  test("the AdminAuditLogPage wrapper selects items/totalCount/page/pageSize and no id (embedded value type)", () => {
    const operation = operationOrThrow(adminAuditLogsQueryDocument);
    const wrapper = selectionPath(operation, ROOT_FIELD);
    expect(fieldNames(wrapper)[0]).toBe("items");
    expect(fieldNames(wrapper).toSorted((a, b) => a.localeCompare(b))).toEqual([
      "items",
      "page",
      "pageSize",
      "totalCount",
    ]);
    expect(fieldNames(wrapper)).not.toContain("id");
  });
});

describe("audit-trail documents — codegen binding + barrel parity", () => {
  test("top-level barrel re-exports the SAME document instance (cache-key safety)", () => {
    expect(adminAuditLogsViaBarrel).toBe(adminAuditLogsQueryDocument);
  });

  test("document remains TypedDocumentNode-typed against generated operation types", () => {
    // Compile-time proof by assignment — tsgo fails if the exported constant
    // loses its codegen typing or picks up an inline type literal.
    const typed: TypedDocumentNode<AdminAuditLogsQuery, AdminAuditLogsQueryVariables> = adminAuditLogsQueryDocument;

    // Runtime use keeps the binding from being flagged as unused.
    expect(typed.loc).toBeDefined();
  });
});
