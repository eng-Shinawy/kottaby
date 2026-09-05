/**
 * Teacher Certification Frontend GraphQL Documents Tests
 *
 * Pins the cold-start certification mutation document contract:
 *  - Single named operation `AdminCertifyTeacherColdStart` (channel: mutation).
 *  - Exact declared variable set `{ userId, makeEvaluator }` with pinned
 *    types (`Int!`, `Boolean`) and the `makeEvaluator = true` default.
 *  - `id` selected FIRST in the payload (Apollo cache normalization).
 *  - Barrel identity: the domain barrel AND the top-level sharedDocuments barrel
 *    re-export the SAME document instance (cache-key safety — mirrors
 *    `sharedDocuments/documents.contract.test.ts`).
 */

import { describe, expect, test } from "bun:test";
import type { TypedDocumentNode } from "@apollo/client";
import type { DocumentNode, FieldNode, OperationDefinitionNode } from "graphql";
import type {
  AdminCertifyTeacherColdStartMutation,
  AdminCertifyTeacherColdStartMutationVariables,
} from "@/frontend/graphql/generated/gql/graphql";
import { adminCertifyTeacherColdStartMutationDocument as viaTopBarrel } from "@/frontend/graphql/sharedDocuments";
import { adminCertifyTeacherColdStartMutationDocument as viaAdminBarrel } from "@/frontend/graphql/sharedDocuments/admin";
import { adminCertifyTeacherColdStartMutationDocument } from "@/frontend/graphql/sharedDocuments/admin/teacher-certification.documents";

function singleOperationOrThrow(document: DocumentNode): OperationDefinitionNode {
  const operations = document.definitions.filter(
    (definition): definition is OperationDefinitionNode => definition.kind === "OperationDefinition"
  );
  expect(operations).toHaveLength(1);
  if (operations.length < 1) {
    throw new Error("expected exactly one OperationDefinition");
  }
  return operations[0];
}

function fieldSelections(parent: OperationDefinitionNode | FieldNode): FieldNode[] {
  const selectionSet = parent.selectionSet;
  if (!selectionSet) {
    return [];
  }
  return selectionSet.selections.filter((selection): selection is FieldNode => selection.kind === "Field");
}

function namedField(parent: OperationDefinitionNode | FieldNode, name: string): FieldNode | undefined {
  return fieldSelections(parent).find(field => field.name.value === name);
}

describe("teacher certification document — operation + variables contract", () => {
  test("is a single named mutation operation named AdminCertifyTeacherColdStart", () => {
    expect(adminCertifyTeacherColdStartMutationDocument).toBeDefined();
    expect(adminCertifyTeacherColdStartMutationDocument.kind).toBe("Document");

    const operation = singleOperationOrThrow(adminCertifyTeacherColdStartMutationDocument);
    expect(operation.operation).toBe("mutation");
    expect(operation.name?.value).toBe("AdminCertifyTeacherColdStart");
  });

  test("declares exactly the { userId, makeEvaluator } variable set", () => {
    const operation = singleOperationOrThrow(adminCertifyTeacherColdStartMutationDocument);
    const definitions = operation.variableDefinitions ?? [];
    const variableNames = definitions.map(definition => definition.variable.name.value);
    expect(variableNames).toEqual(["userId", "makeEvaluator"]);

    // Pin the declared types and the makeEvaluator default (REQ-062 / plan §5.4):
    // $userId: Int! (NonNullType wrapping a NamedType) and $makeEvaluator: Boolean = true.
    const [userIdDef, makeEvaluatorDef] = definitions;
    const userIdInnerType = userIdDef?.type.kind === "NonNullType" ? userIdDef.type.type : undefined;
    expect(userIdDef?.type.kind).toBe("NonNullType");
    expect(userIdInnerType).toEqual({ kind: "NamedType", name: { kind: "Name", value: "Int" } });
    expect(makeEvaluatorDef?.type).toEqual({ kind: "NamedType", name: { kind: "Name", value: "Boolean" } });
    expect(makeEvaluatorDef?.defaultValue).toEqual({ kind: "BooleanValue", value: true });
  });

  test("targets the adminCertifyTeacherColdStart backend field", () => {
    const operation = singleOperationOrThrow(adminCertifyTeacherColdStartMutationDocument);
    const payloadName = fieldSelections(operation).map(field => field.name.value);
    expect(payloadName).toEqual(["adminCertifyTeacherColdStart"]);
  });
});

describe("teacher certification document — selection shape: id FIRST", () => {
  test("payload selection order is id first, then role/governance/snapshots", () => {
    const operation = singleOperationOrThrow(adminCertifyTeacherColdStartMutationDocument);
    const payload = namedField(operation, "adminCertifyTeacherColdStart");
    if (payload === undefined) {
      throw new Error("expected adminCertifyTeacherColdStart payload selection");
    }
    expect(fieldSelections(payload).map(field => field.name.value)).toEqual([
      "id",
      "role",
      "isDeleted",
      "suspended",
      "isBlocked",
      "applicant",
      "teacher",
    ]);
  });

  test("applicant snapshot selects id first; teacher snapshot stays scalar", () => {
    const operation = singleOperationOrThrow(adminCertifyTeacherColdStartMutationDocument);
    const payload = namedField(operation, "adminCertifyTeacherColdStart");
    if (payload === undefined) {
      throw new Error("expected adminCertifyTeacherColdStart payload selection");
    }

    const applicant = namedField(payload, "applicant");
    if (applicant === undefined) {
      throw new Error("expected applicant selection");
    }
    expect(fieldSelections(applicant).map(field => field.name.value)).toEqual(["id", "status"]);

    const teacher = namedField(payload, "teacher");
    if (teacher === undefined) {
      throw new Error("expected teacher selection");
    }
    expect(fieldSelections(teacher).map(field => field.name.value)).toEqual([
      "isApproved",
      "isEvaluator",
      "isOnline",
      "averageRating",
    ]);
  });
});

describe("teacher certification document — barrel identity + codegen typing", () => {
  test("domain barrel and top-level barrel re-export the SAME document instance", () => {
    expect(viaAdminBarrel).toBe(adminCertifyTeacherColdStartMutationDocument);
    expect(viaTopBarrel).toBe(adminCertifyTeacherColdStartMutationDocument);
  });

  test("document stays TypedDocumentNode-typed against the generated operation types", () => {
    // Compile-time proof by assignment — tsgo fails if the export loses its
    // codegen typing or picks up an inline type literal.
    const typed: TypedDocumentNode<
      AdminCertifyTeacherColdStartMutation,
      AdminCertifyTeacherColdStartMutationVariables
    > = adminCertifyTeacherColdStartMutationDocument;
    expect(typed.loc).toBeDefined();
  });
});
