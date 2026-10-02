/**
 * Structural lock over the admin direct-student-onboarding shared GraphQL
 * document.
 *
 * Mirrors the `admin-users.documents.test.ts` discipline for the onboarding
 * domain: the onboarding dialog + success-content consumers depend on this
 * SHARED `TypedDocumentNode` document, so drift fails at this pure logic
 * tier instead of surfacing as confusing wire mismatches later:
 *
 *   1. NAMED operation — a single named mutation whose GraphQL operation
 *      name matches both its `{entityName}MutationDocument` export
 *      convention and the backend root field it targets.
 *   2. Exact variable set — the mutation declares ONLY `$input`, typed as
 *      the backend's REQUIRED offline-onboarding input object (the ten-field
 *      whitelist travels as ONE object; no caller-identity argument exists
 *      anywhere — the actor is always derived server-side from the
 *      authenticated caller).
 *   3. Argument wiring — `$input` is threaded into the root-field argument
 *      (no dead variables, no literal arguments bypassing the contract).
 *   4. `id`-first selection — `student` selects `id` FIRST and carries the
 *      EXACT shared `AdminUserDetailFields` detail field set (pinned in
 *      lockstep against the fragment inside `adminUserDetailQueryDocument`),
 *      and `subscription` selects `id` FIRST followed by the exact
 *      offline-payment verification slice — Apollo normalizes the
 *      `AdminUserDetail:<id>` and `StudentSubscription:<id>` cache entries
 *      so the dialog's success view renders WITHOUT a refetch.
 *   5. Scalar envelope — `creditedLane` / `creditedSessions` /
 *      `handshakeCode` are scalar leaves and the result selection carries
 *      exactly those five top-level fields (nothing extra to drift).
 *   6. No fragment leakage — the document defines ZERO fragments; the
 *      detail shape is inlined so the codegen-extracted fragment sub-types
 *      keep their existing names for their current importers.
 *   7. Codegen binding + barrel identity — the constant stays
 *      `TypedDocumentNode`-typed against the generated operation types
 *      (compile-time proof by assignment) and the top-level barrel
 *      re-exports the SAME document instance as the deep import.
 *
 * Zero server boot, zero DB, zero network: inspects only already-compiled
 * ASTs through graphql kind-guard narrowing — no unsafe assertions anywhere
 * (oxlint `no-unsafe-type-assertion`). NO useLazyQuery exists in the
 * documents layer; consumers import hooks from "@apollo/client/react".
 */

import { describe, expect, test } from "bun:test";
import type { TypedDocumentNode } from "@apollo/client";
import type { OperationDefinitionNode, TypeNode } from "graphql";
import type {
  AdminOnboardStudentWithOfflinePaymentMutation,
  AdminOnboardStudentWithOfflinePaymentMutationVariables,
} from "@/frontend/graphql/generated/gql/graphql";
import { adminOnboardStudentWithOfflinePaymentMutationDocument as onboardViaBarrel } from "@/frontend/graphql/sharedDocuments";
import { adminOnboardStudentWithOfflinePaymentMutationDocument } from "@/frontend/graphql/sharedDocuments/admin/admin-student-onboarding.documents";
import { adminUserDetailQueryDocument } from "@/frontend/graphql/sharedDocuments/admin/admin-users.documents";
import {
  argumentVariableNames,
  fieldNames,
  fragmentDefinition,
  operationOrThrow,
  type SelectionSetNode,
  selectionPath,
  subField,
  subFields,
  variableNames,
} from "@/frontend/graphql/sharedDocuments/document-test-kit";

// ---------------------------------------------------------------------------
// Assertion-free AST helpers (variable-type inventory)

/** Flattens a GraphQL type node to its named type ("[X!]!" → "X"). */
function namedType(type: TypeNode): string {
  return type.kind === "NamedType" ? type.name.value : namedType(type.type);
}

function isNonNull(type: TypeNode): boolean {
  return type.kind === "NonNullType";
}

/** SDL-faithful variable signatures ("input: AdminOnboardStudentOfflineInput!"). */
function variableTypeSignatures(operation: OperationDefinitionNode): string[] {
  return (operation.variableDefinitions ?? []).map(
    definition =>
      `${definition.variable.name.value}: ${namedType(definition.type)}${isNonNull(definition.type) ? "!" : ""}`
  );
}

/** Dotted leaf paths of every direct + nested field selection, source order. */
function leafPaths(node: SelectionSetNode, prefix = ""): string[] {
  return subFields(node).flatMap(field => {
    const path = prefix === "" ? field.name.value : `${prefix}.${field.name.value}`;
    return field.selectionSet === undefined ? [path] : leafPaths(field, path);
  });
}

// ---------------------------------------------------------------------------
// Contract tests

describe("admin-student-onboarding document — named operation + variable contract", () => {
  test("AdminOnboardStudentWithOfflinePayment is a single named mutation operation", () => {
    const operation = operationOrThrow(adminOnboardStudentWithOfflinePaymentMutationDocument);
    expect(operation.name?.value).toBe("AdminOnboardStudentWithOfflinePayment");
    expect(operation.name?.value ?? "").not.toBe("");
    expect(operation.operation).toBe("mutation");
  });

  test("operation name matches the backend root field it targets", () => {
    const operation = operationOrThrow(adminOnboardStudentWithOfflinePaymentMutationDocument);
    expect(fieldNames(operation)).toEqual(["adminOnboardStudentWithOfflinePayment"]);
  });

  test("variable surface is exactly the backend offline-onboarding input contract", () => {
    // The ten-field whitelist (fullName / email / phone / password / gender /
    // country / parentId / planId / paymentMethod / paymentReference) travels
    // as ONE required input object — 1:1 with the backend input. The document
    // declares no other variable: subscription status, payment-verification
    // state and the admin actor identity are all derived server-side.
    const operation = operationOrThrow(adminOnboardStudentWithOfflinePaymentMutationDocument);
    expect(variableNames(operation)).toEqual(["input"]);
    expect(variableTypeSignatures(operation)).toEqual(["input: AdminOnboardStudentOfflineInput!"]);
    for (const name of variableNames(operation)) {
      expect(name.toLowerCase()).not.toContain("actor");
      expect(name.toLowerCase()).not.toContain("userid");
    }
  });

  test("$input is threaded into the root-field argument (no dead variables, no literal arguments)", () => {
    const operation = operationOrThrow(adminOnboardStudentWithOfflinePaymentMutationDocument);
    const root = selectionPath(operation, "adminOnboardStudentWithOfflinePayment");
    expect(argumentVariableNames(root)).toEqual(["input"]);
    expect(root.arguments ?? []).toHaveLength(1);
  });
});

describe("admin-student-onboarding document — id-first + selection shapes", () => {
  test("student selects id FIRST and carries EXACTLY the shared AdminUserDetailFields field set", () => {
    // Lockstep pin against the shared detail fragment (read from
    // adminUserDetailQueryDocument): identical leaf-path set AND order, so
    // the fresh student row normalizes into the SAME `AdminUserDetail:<id>`
    // entry with the SAME shape the admin directory/detail consumers read.
    // The fields are inlined rather than spread so the codegen-extracted
    // fragment sub-types keep their existing names for their importers.
    const operation = operationOrThrow(adminOnboardStudentWithOfflinePaymentMutationDocument);
    const student = selectionPath(operation, "adminOnboardStudentWithOfflinePayment.student");
    const referenceFragment = fragmentDefinition(adminUserDetailQueryDocument, "AdminUserDetailFields");
    expect(fieldNames(student)[0]).toBe("id");
    expect(leafPaths(student)).toEqual(leafPaths(referenceFragment));
  });

  test("the document defines ZERO fragments (no unrelated-domain field leakage)", () => {
    const fragments = adminOnboardStudentWithOfflinePaymentMutationDocument.definitions.filter(
      definition => definition.kind === "FragmentDefinition"
    );
    expect(fragments).toEqual([]);
  });

  test("subscription selects id FIRST + the exact offline-payment verification slice", () => {
    const operation = operationOrThrow(adminOnboardStudentWithOfflinePaymentMutationDocument);
    const subscription = selectionPath(operation, "adminOnboardStudentWithOfflinePayment.subscription");
    expect(fieldNames(subscription)).toEqual([
      "id",
      "status",
      "paymentMethod",
      "paymentReference",
      "paymentVerifiedAt",
    ]);
  });

  test("result envelope is exactly the five sanctioned top-level fields (scalar leaves only)", () => {
    const operation = operationOrThrow(adminOnboardStudentWithOfflinePaymentMutationDocument);
    const root = selectionPath(operation, "adminOnboardStudentWithOfflinePayment");
    expect(fieldNames(root)).toEqual(["student", "subscription", "creditedLane", "creditedSessions", "handshakeCode"]);
    for (const name of ["creditedLane", "creditedSessions", "handshakeCode"]) {
      const leaf = subField(root, name);
      if (leaf === undefined) {
        throw new Error(`expected ${name} selection to exist`);
      }
      expect(leaf.selectionSet).toBeUndefined();
    }
  });
});

describe("admin-student-onboarding document — codegen binding + barrel identity", () => {
  test("top-level barrel re-exports the SAME document instance (cache-key safety)", () => {
    expect(onboardViaBarrel).toBe(adminOnboardStudentWithOfflinePaymentMutationDocument);
  });

  test("document remains TypedDocumentNode-typed against the generated operation types", () => {
    // Compile-time proof by assignment — tsgo fails if the exported constant
    // loses its codegen typing or picks up an inline type literal.
    const typedOnboard: TypedDocumentNode<
      AdminOnboardStudentWithOfflinePaymentMutation,
      AdminOnboardStudentWithOfflinePaymentMutationVariables
    > = adminOnboardStudentWithOfflinePaymentMutationDocument;

    // Runtime use keeps the binding from being flagged as unused.
    expect(typedOnboard.loc).toBeDefined();
  });
});
