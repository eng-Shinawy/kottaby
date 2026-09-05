/**
 * Plan Catalog Frontend GraphQL Documents Tests — DEV1-005 Task 4.1.TE
 *
 * Verifies:
 *  - REQ-061: Document definitions for all 5 plan operations exist and are valid.
 *  - Selection sets contain `id` on every plan object for Apollo normalization.
 */

import { describe, expect, test } from "bun:test";
import {
  type DefinitionNode,
  type DocumentNode,
  Kind,
  type OperationDefinitionNode,
  type SelectionNode,
} from "graphql";
import {
  adminPlansQueryDocument,
  createPlanMutationDocument,
  planCatalogQueryDocument,
  setPlanActiveStatusMutationDocument,
  updatePlanMutationDocument,
} from "@/frontend/graphql/sharedDocuments/billing/plan-catalog.documents";

interface DocTestCase {
  readonly name: string;
  readonly doc: DocumentNode;
  readonly opType: "query" | "mutation";
}

describe("Plan Catalog GraphQL Shared Documents (REQ-061)", () => {
  const documents: DocTestCase[] = [
    { name: "planCatalogQueryDocument", doc: planCatalogQueryDocument, opType: "query" },
    { name: "adminPlansQueryDocument", doc: adminPlansQueryDocument, opType: "query" },
    { name: "createPlanMutationDocument", doc: createPlanMutationDocument, opType: "mutation" },
    { name: "updatePlanMutationDocument", doc: updatePlanMutationDocument, opType: "mutation" },
    {
      name: "setPlanActiveStatusMutationDocument",
      doc: setPlanActiveStatusMutationDocument,
      opType: "mutation",
    },
  ];

  test.each(documents)("$name is a valid $opType document containing id in selection set", ({ doc, opType }) => {
    expect(doc).toBeDefined();
    expect(doc.kind).toBe(Kind.DOCUMENT);

    const operation = doc.definitions.find(
      (def: DefinitionNode): def is OperationDefinitionNode => def.kind === Kind.OPERATION_DEFINITION
    );

    expect(operation).toBeDefined();
    expect(operation?.operation).toBe(opType);

    const mainField = operation?.selectionSet.selections[0];
    expect(mainField?.kind).toBe(Kind.FIELD);

    if (mainField?.kind === Kind.FIELD) {
      const selections = mainField.selectionSet?.selections ?? [];
      const hasId = selections.some((s: SelectionNode) => s.kind === Kind.FIELD && s.name.value === "id");
      expect(hasId).toBe(true);
    }
  });
});
