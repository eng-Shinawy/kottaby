/**
 * GraphQL document contract-test kit — the shared AST-walk utilities of the
 * `*.documents.test.ts` suites (single-operation extraction, fragment
 * lookup, selection-path resolution, variable/spread inventories).
 *
 * Extracted so the per-suite copies cannot drift apart
 * (backend/db/test/AGENTS.md dedupe discipline, applied at the GraphQL
 * document layer).
 *
 * TEST-ONLY module: imports `bun:test` and must never be imported from
 * production code (components, resolvers, hooks).
 */

import { expect } from "bun:test";
import type {
  DocumentNode,
  FieldNode,
  FragmentDefinitionNode,
  FragmentSpreadNode,
  OperationDefinitionNode,
} from "graphql";

/** Any node carrying a `selectionSet` that the helpers below walk. */
export type SelectionSetNode = OperationDefinitionNode | FieldNode | FragmentDefinitionNode;

export function operationOrThrow(document: DocumentNode): OperationDefinitionNode {
  const operations = document.definitions.filter(
    (definition): definition is OperationDefinitionNode => definition.kind === "OperationDefinition"
  );
  expect(operations).toHaveLength(1);
  if (operations.length < 1) {
    throw new Error("expected exactly one OperationDefinition");
  }
  return operations[0];
}

export function fragmentDefinition(document: DocumentNode, name: string): FragmentDefinitionNode {
  const fragment = document.definitions.find(
    (definition): definition is FragmentDefinitionNode =>
      definition.kind === "FragmentDefinition" && definition.name.value === name
  );
  if (fragment === undefined) {
    throw new Error(`expected FragmentDefinition "${name}" to exist`);
  }
  return fragment;
}

export function subFields(parent: SelectionSetNode): FieldNode[] {
  const selectionSet = parent.selectionSet;
  if (!selectionSet) {
    return [];
  }
  return selectionSet.selections.filter((selection): selection is FieldNode => selection.kind === "Field");
}

export function subField(parent: SelectionSetNode, name: string): FieldNode | undefined {
  return subFields(parent).find(field => field.name.value === name);
}

/** Resolves a dotted selection path ("adminStudents.items") or throws. */
export function selectionPath(operation: OperationDefinitionNode, path: string): FieldNode {
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

export function fieldNames(parent: SelectionSetNode): string[] {
  return subFields(parent).map(field => field.name.value);
}

/** Fragment spreads referenced on a selection set, by name. */
export function fragmentSpreads(parent: OperationDefinitionNode | FieldNode): string[] {
  const selectionSet = parent.selectionSet;
  if (!selectionSet) {
    return [];
  }
  return selectionSet.selections
    .filter((selection): selection is FragmentSpreadNode => selection.kind === "FragmentSpread")
    .map(selection => selection.name.value);
}

export function variableNames(operation: OperationDefinitionNode): string[] {
  return (operation.variableDefinitions ?? []).map(definition => definition.variable.name.value);
}

/** Variable names threaded as root-field arguments (`$x` → `x`), source order. */
export function argumentVariableNames(field: FieldNode): string[] {
  return (field.arguments ?? []).flatMap(argument =>
    argument.value.kind === "Variable" ? [argument.value.name.value] : []
  );
}
