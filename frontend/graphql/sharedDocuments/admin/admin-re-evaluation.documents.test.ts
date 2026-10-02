/**
 * Structural lock over the admin-ordered re-evaluation shared GraphQL
 * document (`adminOrderTeacherReEvaluation`).
 *
 * Mirrors the `admin-teacher-applicants.documents.test.ts` discipline for
 * the paid re-evaluation write: the admin user-detail governance action
 * depends on this SHARED `TypedDocumentNode` document, so drift fails at
 * this pure logic tier instead of surfacing as a confusing wire mismatch
 * later:
 *
 *   1. NAMED operation — a single named mutation whose GraphQL operation
 *      name matches the `{entityName}MutationDocument` export convention,
 *      with the exact sanctioned variable set (`teacherId`, `reason`).
 *   2. Argument wiring — each declared variable is actually threaded into
 *      the root-field argument (no dead variables, no literal arguments).
 *   3. Honest channel — the variable surface carries ZERO caller-identity
 *      arguments (the actor is derived server-side from the authenticated
 *      admin) and ZERO pricing arguments (the fee never rides the wire —
 *      server-owned pricing).
 *   4. IDE-LESS payload shape — `TeacherReEvaluationOrder` exposes
 *      `teacherId: ID!` instead of an `id`, so the selection set is pinned
 *      to EXACTLY the five receipt fields and contains NO `id` selection
 *      anywhere (the type is `keyFields: false`-registered in
 *      `frontend/providers/apollo/apolloCache.ts`).
 *   5. Codegen binding + barrel parity — the constant stays
 *      `TypedDocumentNode`-typed against the generated operation type
 *      (compile-time proof by assignment), and the admin barrel re-exports
 *      the SAME document instance.
 *
 * Zero server boot, zero DB, zero network: inspects only already-compiled
 * ASTs through graphql kind-guard narrowing — no unsafe assertions anywhere
 * (oxlint `no-unsafe-type-assertion`). NO useLazyQuery exists anywhere in
 * the documents layer; consumers import hooks from "@apollo/client/react".
 */

import { describe, expect, test } from "bun:test";
import type { TypedDocumentNode } from "@apollo/client";
import type {
  AdminOrderTeacherReEvaluationMutation,
  AdminOrderTeacherReEvaluationMutationVariables,
} from "@/frontend/graphql/generated/gql/graphql";
import { adminOrderTeacherReEvaluationMutationDocument as reEvaluationViaBarrel } from "@/frontend/graphql/sharedDocuments";
import { adminOrderTeacherReEvaluationMutationDocument } from "@/frontend/graphql/sharedDocuments/admin/admin-re-evaluation.documents";
import {
  argumentVariableNames,
  fieldNames,
  operationOrThrow,
  selectionPath,
  variableNames,
} from "@/frontend/graphql/sharedDocuments/document-test-kit";

// ---------------------------------------------------------------------------
// Contract

/** The exact receipt-field selection the id-less payload exposes (source order). */
const RE_EVALUATION_RECEIPT_FIELDS = [
  "teacherId",
  "amountCharged",
  "currency",
  "walletBalance",
  "reEvaluationStartedAt",
] as const;

/** Variable-name fragments that would smuggle actor identity onto the wire. */
const FORBIDDEN_IDENTITY_MARKERS = ["actor", "userid", "caller"] as const;

/** Variable-name fragments that would smuggle server-owned pricing onto the wire. */
const FORBIDDEN_PRICING_MARKERS = ["fee", "amount", "price", "currency"] as const;

// ---------------------------------------------------------------------------
// Contract tests

describe("admin-re-evaluation document — named operation + channel + variables", () => {
  test("AdminOrderTeacherReEvaluation is a single named mutation with the sanctioned variable set", () => {
    const operation = operationOrThrow(adminOrderTeacherReEvaluationMutationDocument);
    expect(operation.name?.value).toBe("AdminOrderTeacherReEvaluation");
    expect(operation.name?.value ?? "").not.toBe("");
    expect(operation.operation).toBe("mutation");
    expect(variableNames(operation)).toEqual(["teacherId", "reason"]);
  });

  test("every declared variable is wired into the root-field argument (no dead variables, no literal arguments)", () => {
    const operation = operationOrThrow(adminOrderTeacherReEvaluationMutationDocument);
    const root = selectionPath(operation, "adminOrderTeacherReEvaluation");
    expect(argumentVariableNames(root)).toEqual(["teacherId", "reason"]);
  });

  test("variable surface carries zero caller-identity arguments (actor derived server-side)", () => {
    const operation = operationOrThrow(adminOrderTeacherReEvaluationMutationDocument);
    for (const name of variableNames(operation)) {
      const lowered = name.toLowerCase();
      for (const marker of FORBIDDEN_IDENTITY_MARKERS) {
        expect(lowered).not.toContain(marker);
      }
    }
  });

  test("variable surface carries zero pricing arguments (the fee never rides the wire)", () => {
    const operation = operationOrThrow(adminOrderTeacherReEvaluationMutationDocument);
    for (const name of variableNames(operation)) {
      const lowered = name.toLowerCase();
      for (const marker of FORBIDDEN_PRICING_MARKERS) {
        expect(lowered).not.toContain(marker);
      }
    }
  });
});

describe("admin-re-evaluation document — id-less receipt shape", () => {
  test("the payload selects EXACTLY the five receipt fields (no id selection anywhere)", () => {
    const operation = operationOrThrow(adminOrderTeacherReEvaluationMutationDocument);
    const root = selectionPath(operation, "adminOrderTeacherReEvaluation");
    // Source-order pin — a dropped or extra receipt field fails here.
    expect(fieldNames(root)).toEqual([...RE_EVALUATION_RECEIPT_FIELDS]);
    // The receipt type has NO `id` field (the id-less payload contract);
    // selecting one would be a GraphQL validation failure on the wire.
    expect(fieldNames(root)).not.toContain("id");
    // The only object in the document is the receipt — no nested selections
    // could carry an `id` even indirectly.
    expect(fieldNames(operation)).toHaveLength(1);
  });
});

describe("admin-re-evaluation document — codegen binding + barrel parity", () => {
  test("admin barrel + top-level barrel re-export the SAME document instance (cache-key safety)", () => {
    expect(reEvaluationViaBarrel).toBe(adminOrderTeacherReEvaluationMutationDocument);
  });

  test("document remains TypedDocumentNode-typed against the generated operation type", () => {
    // Compile-time proof by assignment — tsgo fails if the exported constant
    // loses its codegen typing (result AND exact variables binding) or picks
    // up an inline type literal.
    const typedMutation: TypedDocumentNode<
      AdminOrderTeacherReEvaluationMutation,
      AdminOrderTeacherReEvaluationMutationVariables
    > = adminOrderTeacherReEvaluationMutationDocument;
    expect(typedMutation.loc).toBeDefined();
  });
});
