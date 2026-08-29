/**
 * Plan-catalog document-shape contract (3.1.TE style, colocated suite).
 *
 * Mirrors `documents.contract.test.ts` for the DEV1-005 billing documents:
 * a PURE suite (zero server boot, zero DB, zero network) that pins the
 * five shared `TypedDocumentNode` documents from
 * `sharedDocuments/billing/plan-catalog.documents.ts` so drift fails at the
 * logic tier instead of surfacing as confusing wire mismatches later:
 *
 *   1. NAMED operations — one operation per document, name matching the
 *      `{EntityName}{Query|Mutation}Document` export convention.
 *   2. Channel table — 2 queries + 3 mutations, per `sharedDocuments/AGENTS.md`.
 *   3. Variable wiring — declared variable sets line up with the generated
 *      `…Variables` contracts (`includeInactive` / `input` / `id+input` /
 *      `id+isActive` / none).
 *   4. `id` field requirement + REQ-061/4.1.2 cache convergence — every
 *      `Plan` selection set selects `id` AND the FULL ten-field canonical
 *      shape, in source order (mutations return `RETURNING *`, so all five
 *      operations normalize onto the same `Plan:<id>` cache entries).
 *   5. Barrel parity — deep import, billing barrel, and top-level barrel
 *      resolve to the IDENTICAL document instance.
 *   6. Variables typing — compile-time assignment proofs against the exact
 *      codegen-generated type names (no inline type literals; optional
 *      `includeInactive?` provable by the empty-object assignment).
 *
 * Inspects only already-compiled ASTs through graphql kind-guard narrowing —
 * no unsafe assertions anywhere (oxlint `no-unsafe-type-assertion`). NO
 * useLazyQuery exists anywhere in the documents layer.
 */

import { describe, expect, test } from "bun:test";
import type { TypedDocumentNode } from "@apollo/client";
import type { DocumentNode, FieldNode, OperationDefinitionNode } from "graphql";
import type {
  AdminPlansQuery,
  AdminPlansQueryVariables,
  CreatePlanMutation,
  CreatePlanMutationVariables,
  PlanCatalogQuery,
  SetPlanActiveStatusMutation,
  SetPlanActiveStatusMutationVariables,
  UpdatePlanMutation,
  UpdatePlanMutationVariables,
} from "@/frontend/graphql/generated/gql/graphql";
import {
  adminPlansQueryDocument as adminPlansViaTopLevelBarrel,
  planCatalogQueryDocument as planCatalogViaTopLevelBarrel,
} from "@/frontend/graphql/sharedDocuments";
import { planCatalogQueryDocument as planCatalogViaBillingBarrel } from "@/frontend/graphql/sharedDocuments/billing";
import {
  adminPlansQueryDocument,
  createPlanMutationDocument,
  planCatalogQueryDocument,
  setPlanActiveStatusMutationDocument,
  updatePlanMutationDocument,
} from "@/frontend/graphql/sharedDocuments/billing/plan-catalog.documents";

// ---------------------------------------------------------------------------
// Assertion-free AST helpers (mirrors documents.contract.test.ts)

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

function selectsId(node: OperationDefinitionNode | FieldNode): boolean {
  return fieldSelections(node).some(field => field.name.value === "id");
}

/** Declared-variable names of one operation, in GraphQL source order. */
function variableNames(operation: OperationDefinitionNode): string[] {
  return (operation.variableDefinitions ?? []).map(definition => definition.variable.name.value);
}

/** Resolve one dotted path ("login.user") through nested sub-selections. */
function resolvePath(operation: OperationDefinitionNode, path: string): FieldNode | undefined {
  let current: FieldNode | undefined;
  for (const segment of path.split(".")) {
    const parent: OperationDefinitionNode | FieldNode = current ?? operation;
    const field = namedField(parent, segment);
    if (field === undefined) {
      return undefined;
    }
    current = field;
  }
  return current;
}

// ---------------------------------------------------------------------------
// Contract tables

/** The canonical ten-field REQ-060 Plan shape, in DOCUMENT SOURCE ORDER. */
const PLAN_TEN_FIELDS: readonly string[] = [
  "id",
  "title",
  "sessionCount",
  "price",
  "currency",
  "intervalDays",
  "isActive",
  "deactivatedAt",
  "createdAt",
  "updatedAt",
];

interface DocumentContractRow {
  readonly document: DocumentNode;
  readonly operationName: string;
  readonly channel: "mutation" | "query";
  readonly variables: readonly string[];
  /** Dotted object-selection path that must carry the ten-field Plan shape. */
  readonly planSelectionPath: string;
}

const DOCUMENT_CONTRACT_TABLE: readonly DocumentContractRow[] = [
  {
    document: planCatalogQueryDocument,
    operationName: "PlanCatalog",
    channel: "query",
    variables: [],
    planSelectionPath: "planCatalog",
  },
  {
    document: adminPlansQueryDocument,
    operationName: "AdminPlans",
    channel: "query",
    variables: ["includeInactive"],
    planSelectionPath: "adminPlans",
  },
  {
    document: createPlanMutationDocument,
    operationName: "CreatePlan",
    channel: "mutation",
    variables: ["input"],
    planSelectionPath: "createPlan",
  },
  {
    document: updatePlanMutationDocument,
    operationName: "UpdatePlan",
    channel: "mutation",
    variables: ["id", "input"],
    planSelectionPath: "updatePlan",
  },
  {
    document: setPlanActiveStatusMutationDocument,
    operationName: "SetPlanActiveStatus",
    channel: "mutation",
    variables: ["id", "isActive"],
    planSelectionPath: "setPlanActiveStatus",
  },
];

// ---------------------------------------------------------------------------
// 1 + 2 + 3 — named operations, channel, variable wiring

describe("plan-catalog document contract — named operations + channel + variables", () => {
  for (const row of DOCUMENT_CONTRACT_TABLE) {
    test(`${row.operationName} is a single named ${row.channel} operation`, () => {
      const operation = singleOperationOrThrow(row.document);
      expect(operation.name?.value).toBe(row.operationName);
      expect(operation.name?.value ?? "").not.toBe("");
      expect(operation.operation).toBe(row.channel);
      expect(variableNames(operation)).toEqual([...row.variables]);
    });
  }
});

// ---------------------------------------------------------------------------
// 4 — id field requirement + full ten-field selection on every Plan set

describe("plan-catalog document contract — Plan selection shape", () => {
  test("every Plan selection set carries the FULL ten-field canonical shape with id first", () => {
    for (const row of DOCUMENT_CONTRACT_TABLE) {
      const operation = singleOperationOrThrow(row.document);
      const planField = resolvePath(operation, row.planSelectionPath);
      if (planField === undefined) {
        throw new Error(`${row.operationName}: expected selection ${row.planSelectionPath} to exist`);
      }
      const fieldNames = fieldSelections(planField).map(field => field.name.value);
      expect(fieldNames).toEqual([...PLAN_TEN_FIELDS]);
      expect(selectsId(planField)).toBe(true);
    }
  });

  test("all five operations share ONE identical Plan sub-selection (cache convergence)", () => {
    const shapes = DOCUMENT_CONTRACT_TABLE.map(row => {
      const operation = singleOperationOrThrow(row.document);
      const planField = resolvePath(operation, row.planSelectionPath);
      if (planField === undefined) {
        throw new Error(`${row.operationName}: expected selection ${row.planSelectionPath} to exist`);
      }
      return fieldSelections(planField)
        .map(field => `${field.name.value}:${field.alias?.value ?? ""}`)
        .join(",");
    });
    for (const shape of shapes) {
      expect(shape).toBe(shapes[0]);
    }
  });

  test("PlanCatalog declares no variables (no-arg query), AdminPlans declares only includeInactive", () => {
    const planCatalogOp = singleOperationOrThrow(planCatalogQueryDocument);
    expect(planCatalogOp.variableDefinitions ?? []).toHaveLength(0);

    const adminPlansOp = singleOperationOrThrow(adminPlansQueryDocument);
    const includeInactive = adminPlansOp.variableDefinitions?.find(
      definition => definition.variable.name.value === "includeInactive"
    );
    expect(includeInactive).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// 5 — barrel parity

describe("plan-catalog consumer import conventions — barrel ≡ deep import identity", () => {
  test("top-level barrel and billing barrel re-export the SAME document instance (cache-key safety)", () => {
    expect(planCatalogViaTopLevelBarrel).toBe(planCatalogQueryDocument);
    expect(planCatalogViaBillingBarrel).toBe(planCatalogQueryDocument);
    expect(adminPlansViaTopLevelBarrel).toBe(adminPlansQueryDocument);
  });
});

// ---------------------------------------------------------------------------
// 6 — variables typing (compile-time proofs via assignment)

describe("plan-catalog documents remain TypedDocumentNode-typed against generated operation types", () => {
  test("documents are assignable to their exact codegen TypedDocumentNode shapes", () => {
    const typedPlanCatalog: TypedDocumentNode<PlanCatalogQuery> = planCatalogQueryDocument;
    const typedAdminPlans: TypedDocumentNode<AdminPlansQuery, AdminPlansQueryVariables> = adminPlansQueryDocument;
    const typedCreatePlan: TypedDocumentNode<CreatePlanMutation, CreatePlanMutationVariables> =
      createPlanMutationDocument;
    const typedUpdatePlan: TypedDocumentNode<UpdatePlanMutation, UpdatePlanMutationVariables> =
      updatePlanMutationDocument;
    const typedSetPlanActiveStatus: TypedDocumentNode<
      SetPlanActiveStatusMutation,
      SetPlanActiveStatusMutationVariables
    > = setPlanActiveStatusMutationDocument;

    // Runtime uses keep the bindings from being flagged as unused.
    expect(typedPlanCatalog.loc).toBeDefined();
    expect(typedAdminPlans.loc).toBeDefined();
    expect(typedCreatePlan.loc).toBeDefined();
    expect(typedUpdatePlan.loc).toBeDefined();
    expect(typedSetPlanActiveStatus.loc).toBeDefined();
  });

  test("AdminPlansQueryVariables.includeInactive is optional nullable boolean (empty object assignable)", () => {
    // Compile-time proof: `includeInactive` is OPTIONAL (codegen emits
    // `includeInactive?: boolean | null | undefined`) — an empty variables
    // object must typecheck because the server default is `true`.
    const withoutFlag: AdminPlansQueryVariables = {};
    const withFlag: AdminPlansQueryVariables = { includeInactive: false };
    const withNull: AdminPlansQueryVariables = { includeInactive: null };

    expect(withoutFlag).toBeDefined();
    expect(withFlag.includeInactive).toBe(false);
    expect(withNull.includeInactive).toBeNull();
  });

  test("mutation variables align with the generated BOPLA input surfaces", () => {
    // CreatePlanInput: five REQUIRED fields, price as decimal STRING,
    // lifecycle fields structurally unrepresentable (BOPLA).
    const createVars: CreatePlanMutationVariables = {
      input: { title: "Starter", sessionCount: 8, price: "0.00", currency: "USD", intervalDays: 30 },
    };
    expect(createVars.input.price).toBe("0.00");

    // UpdatePlanInput: every field optional at the WIRE tier, but codegen's
    // `avoidOptionals` emits required keys typed `| null | undefined` — a
    // partial patch keeps the untouched keys `undefined` (JSON serialization
    // drops them ⇒ they are NOT sent), while the server also normalizes
    // explicit null (defined-and-non-null partial-patch builder).
    const updateVars: UpdatePlanMutationVariables = {
      id: "1",
      input: {
        title: undefined,
        sessionCount: undefined,
        price: "9.99",
        currency: undefined,
        intervalDays: undefined,
      },
    };
    expect(updateVars.input.price).toBe("9.99");

    // ID variables accept both string and number (ID scalar).
    const statusVars: SetPlanActiveStatusMutationVariables = { id: 1, isActive: false };
    expect(statusVars.isActive).toBe(false);
  });
});
