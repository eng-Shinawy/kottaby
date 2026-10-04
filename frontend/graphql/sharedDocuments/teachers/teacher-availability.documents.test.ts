/**
 * Teacher-availability shared documents — document-shape suite (documents
 * tier, NO server / DB / network).
 *
 * Companion to the wire-tier `teacher-availability.test.ts` under
 * `frontend/graphql/test/teachers/` (which pins the GraphQL boundary
 * against the dev server): this file locks the SHARED documents
 * themselves — the exact teacher-facing surface the availability read
 * and the toggle mutation expose to every Apollo consumer.
 *
 * WHAT THIS LOCKS (the shared teacher-availability documents — read +
 * toggle write)
 *   1. NAMED operations — every document is a single named operation
 *      whose GraphQL name matches its `{entityName}…Document` export
 *      convention, on the right channel (query vs mutation), with the
 *      exact sanctioned variable set threaded into the root-field
 *      arguments (no dead variables, no literal arguments bypassing
 *      the variable contract).
 *   2. CLOSED selection contract — each operation selects exactly its
 *      one root field; the `TeacherAvailabilityState` row selects the
 *      EXACT three-field projection with `id` FIRST on every object
 *      selection (Apollo normalization).
 *   3. SELF-SCOPED SURFACE — the mutation's only variable is the
 *      `$isOnline: Boolean!` toggle; no caller-identity argument
 *      (teacher id, user id, role, …) exists anywhere in the
 *      documents. Identity is derived server-side from the
 *      authenticated caller (BOLA).
 *   4. TYPING + BARREL PARITY — the exported constants keep their
 *      codegen `TypedDocumentNode` typing (compile-time proof by
 *      assignment), and the root barrel, the teachers barrel and the
 *      deep import resolve to the IDENTICAL document instances
 *      (consumer import conventions).
 *
 * Zero server boot, zero DB, zero network: inspects only already-compiled
 * ASTs through graphql kind-guard narrowing — no unsafe assertions
 * anywhere (oxlint `no-unsafe-type-assertion`). NO `useLazyQuery` exists
 * in the documents file (verified by the semantic-review audit);
 * consumers import hooks from "@apollo/client/react".
 *
 * Pure unit tier — runs via the mandated runner:
 * `bun run test/scripts/run-test.ts frontend/graphql/sharedDocuments/teachers/teacher-availability.documents.test.ts`.
 */

import { describe, expect, test } from "bun:test";
import type { TypedDocumentNode } from "@apollo/client";
import type { DocumentNode, FieldNode, OperationDefinitionNode, VariableDefinitionNode } from "graphql";
import type {
  MyTeacherAvailabilityQuery,
  MyTeacherAvailabilityQueryVariables,
  SetTeacherAvailabilityMutation,
  SetTeacherAvailabilityMutationVariables,
} from "@/frontend/graphql/generated/gql/graphql";
import {
  myTeacherAvailabilityQueryDocument as myTeacherAvailabilityViaRootBarrel,
  setTeacherAvailabilityMutationDocument as setTeacherAvailabilityViaRootBarrel,
} from "@/frontend/graphql/sharedDocuments";
import {
  myTeacherAvailabilityQueryDocument as myTeacherAvailabilityViaTeachersBarrel,
  setTeacherAvailabilityMutationDocument as setTeacherAvailabilityViaTeachersBarrel,
} from "@/frontend/graphql/sharedDocuments/teachers";
import {
  myTeacherAvailabilityQueryDocument,
  setTeacherAvailabilityMutationDocument,
} from "@/frontend/graphql/sharedDocuments/teachers/teacher-availability.documents";

// ---------------------------------------------------------------------------
// Assertion-free AST helpers (guard-and-throw narrowing, same style as
// `notification.documents.test.ts` — `no-unsafe-type-assertion` clean).

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

function namedFieldOrThrow(parent: OperationDefinitionNode | FieldNode, name: string): FieldNode {
  const field = subFields(parent).find(candidate => candidate.name.value === name);
  if (field === undefined) {
    throw new Error(`expected selection field ${name} to exist`);
  }
  return field;
}

/** Resolves a dotted selection path ("myTeacherAvailability") or throws. */
function selectionPath(operation: OperationDefinitionNode, path: string): FieldNode {
  const segments = path.split(".");
  const first = subFields(operation).find(field => field.name.value === segments[0]);
  if (first === undefined) {
    throw new Error(`expected selection ${path} to exist (missing ${segments[0]})`);
  }
  let current: FieldNode = first;
  for (const segment of segments.slice(1)) {
    const field = subFields(current).find(candidate => candidate.name.value === segment);
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

/** Renders one declared variable's type as GraphQL source notation (e.g. `Boolean!`). */
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

// ===========================================================================
describe("teacher-availability documents — named operations, channels, variables", () => {
  test("MyTeacherAvailability: single named query, zero variables", () => {
    const operation = operationOrThrow(myTeacherAvailabilityQueryDocument);
    expect(operation.name?.value).toBe("MyTeacherAvailability");
    expect(operation.operation).toBe("query");

    // Zero-argument query: identity is derived server-side ONLY from the
    // access token's user, so the operation declares NO variables.
    expect(variableNames(operation)).toEqual([]);

    expect(fieldNames(operation)).toEqual(["myTeacherAvailability"]);
    const readField = namedFieldOrThrow(operation, "myTeacherAvailability");
    // No arguments at all — no injection surface for a BOLA probe.
    expect(readField.arguments ?? []).toHaveLength(0);
    expect(argumentVariableNames(readField)).toEqual([]);
  });

  test("SetTeacherAvailability: single named mutation, exactly $isOnline: Boolean!", () => {
    const operation = operationOrThrow(setTeacherAvailabilityMutationDocument);
    expect(operation.name?.value).toBe("SetTeacherAvailability");
    expect(operation.operation).toBe("mutation");

    const variables = operation.variableDefinitions ?? [];
    expect(variables.map(definition => definition.variable.name.value)).toEqual(["isOnline"]);
    // The ONLY variable is the non-null boolean toggle — the whole write
    // surface (BOPLA, closed input whitelist).
    expect(variables.map(definition => variableTypeOrThrow(definition))).toEqual(["Boolean!"]);

    expect(fieldNames(operation)).toEqual(["setTeacherAvailability"]);
    const toggleField = namedFieldOrThrow(operation, "setTeacherAvailability");
    expect((toggleField.arguments ?? []).map(argument => argument.name.value)).toEqual(["isOnline"]);
    expect(argumentVariableNames(toggleField)).toEqual(["isOnline"]);
    expect(toggleField.arguments ?? []).toHaveLength(argumentVariableNames(toggleField).length);
  });

  test("both documents parse into exactly one OperationDefinition each", () => {
    // A document that failed to parse would have thrown at module load;
    // this asserts the structural single-operation shape explicitly.
    expect(operationOrThrow(myTeacherAvailabilityQueryDocument).kind).toBe("OperationDefinition");
    expect(operationOrThrow(setTeacherAvailabilityMutationDocument).kind).toBe("OperationDefinition");
  });
});

// ===========================================================================
describe("teacher-availability documents — closed selection contract, id FIRST", () => {
  const AVAILABILITY_FIELDS = ["id", "isOnline", "isApproved"] as const;

  test("MyTeacherAvailability: EXACT 3-field row, id FIRST, every field a leaf", () => {
    const operation = operationOrThrow(myTeacherAvailabilityQueryDocument);
    const readField = namedFieldOrThrow(operation, "myTeacherAvailability");
    expect(fieldNames(readField)).toEqual([...AVAILABILITY_FIELDS]);
    expect(fieldNames(readField)[0]).toBe("id");
    // Scalars only — no nested object selection anywhere on the row.
    for (const field of subFields(readField)) {
      expect(field.selectionSet).toBeUndefined();
    }
  });

  test("SetTeacherAvailability: EXACT 3-field row, id FIRST, every field a leaf", () => {
    const operation = operationOrThrow(setTeacherAvailabilityMutationDocument);
    const toggleField = namedFieldOrThrow(operation, "setTeacherAvailability");
    expect(fieldNames(toggleField)).toEqual([...AVAILABILITY_FIELDS]);
    expect(fieldNames(toggleField)[0]).toBe("id");
    for (const field of subFields(toggleField)) {
      expect(field.selectionSet).toBeUndefined();
    }
  });

  test("both selections carry id (Apollo cache normalization requirement)", () => {
    // Belt-and-braces: the `id` field is REQUIRED so Apollo Client can
    // normalize the returned `TeacherAvailabilityState` row into the
    // cache (per `sharedDocuments/AGENTS.md` "id Field Requirement") —
    // a successful toggle then overwrites the SAME cache entry the
    // read populates, visible to every consumer of the row.
    const readSelection = selectionPath(operationOrThrow(myTeacherAvailabilityQueryDocument), "myTeacherAvailability");
    const toggleSelection = selectionPath(
      operationOrThrow(setTeacherAvailabilityMutationDocument),
      "setTeacherAvailability"
    );
    expect(fieldNames(readSelection).includes("id")).toBe(true);
    expect(fieldNames(toggleSelection).includes("id")).toBe(true);
  });

  test("NO document selects any field beyond id/isOnline/isApproved at any depth", () => {
    // BOPLA read-side hygiene: the projection is closed to the three
    // public availability fields. A drift to a wider projection would
    // fail this assertion loudly (no silent PII leak).
    const allowed = new Set<string>(AVAILABILITY_FIELDS);
    for (const document of [myTeacherAvailabilityQueryDocument, setTeacherAvailabilityMutationDocument]) {
      const operation = operationOrThrow(document);
      const rootFields = subFields(operation);
      expect(rootFields.length).toBeGreaterThan(0);
      // Walk every leaf of the root selection — every name MUST be one
      // of the three allowed projection fields.
      for (const rootField of rootFields) {
        for (const leaf of subFields(rootField)) {
          expect(allowed.has(leaf.name.value)).toBe(true);
          // Scalars only — no nested object selection anywhere on the row.
          expect(leaf.selectionSet).toBeUndefined();
        }
      }
    }
  });
});

// ===========================================================================
describe("teacher-availability documents — self-scoped surface (no caller identity)", () => {
  test("the only declared variable across both documents is the boolean toggle (no identity argument)", () => {
    const declared = [
      ...variableNames(operationOrThrow(myTeacherAvailabilityQueryDocument)),
      ...variableNames(operationOrThrow(setTeacherAvailabilityMutationDocument)),
    ].toSorted((a, b) => a.localeCompare(b));
    expect(declared).toEqual(["isOnline"]);
    // Belt-and-braces: no document smuggles a caller-identity argument
    // (teacher id, user id, role, …) — the actor is always derived
    // server-side from the access token (BOLA).
    for (const name of declared) {
      expect(name.toLowerCase()).not.toContain("user");
      expect(name.toLowerCase()).not.toContain("teacherid");
      expect(name.toLowerCase()).not.toContain("id");
    }
  });
});

// ===========================================================================
describe("teacher-availability documents — codegen binding + barrel parity", () => {
  test("top-level + teachers barrels re-export the SAME document instances (cache-key safety)", () => {
    // An accidental re-declaration in a barrel (a second `gql` call instead
    // of a re-export) would mint a second DocumentNode: equal text,
    // different identity — which would fragment Apollo's document-keyed
    // caches and request-dedup sets (see sharedDocuments/AGENTS.md
    // §Consumer import conventions).
    expect(myTeacherAvailabilityViaRootBarrel).toBe(myTeacherAvailabilityQueryDocument);
    expect(setTeacherAvailabilityViaRootBarrel).toBe(setTeacherAvailabilityMutationDocument);
    expect(myTeacherAvailabilityViaTeachersBarrel).toBe(myTeacherAvailabilityQueryDocument);
    expect(setTeacherAvailabilityViaTeachersBarrel).toBe(setTeacherAvailabilityMutationDocument);
  });

  test("documents remain TypedDocumentNode-typed against the generated operation types", () => {
    // Compile-time proof by assignment — tsgo fails if any exported
    // constant loses its codegen typing or picks up an inline type literal.
    const typedRead: TypedDocumentNode<MyTeacherAvailabilityQuery, MyTeacherAvailabilityQueryVariables> =
      myTeacherAvailabilityQueryDocument;
    const typedToggle: TypedDocumentNode<SetTeacherAvailabilityMutation, SetTeacherAvailabilityMutationVariables> =
      setTeacherAvailabilityMutationDocument;

    // Runtime uses keep the bindings from being flagged as unused.
    expect(typedRead.loc).toBeDefined();
    expect(typedToggle.loc).toBeDefined();
  });
});
