/**
 * Structural lock over the admin financial-auditing shared GraphQL documents.
 *
 * Mirrors the `audit-trail.documents.test.ts` discipline for the
 * admin-finance domain: the `/finances` view container consumes these SHARED
 * `TypedDocumentNode` documents, so drift fails at this pure
 * logic tier instead of surfacing as confusing wire mismatches later:
 *
 *   1. NAMED operations — one named operation per document whose GraphQL
 *      operation name matches the `{entityName}…Document` export convention.
 *   2. Variable wiring — the declared variable set is EXACTLY the sanctioned
 *      set (source order) and every declared variable is threaded into its
 *      root-field argument (no dead variables, no literal arguments that
 *      would bypass the variable contract).
 *   3. `id` field requirement — every row selection that carries an `id`
 *      (`AdminStudentPayment` rows, `TeacherTransaction` rows) selects `id`
 *      FIRST so Apollo normalizes the cache entries; the id-less wrapper
 *      types (`AdminStudentPaymentPage`, `AdminTeacherWallet`,
 *      `AdminWithdrawalQueueRow`, `AdminWithdrawalQueuePage`) are embedded
 *      value types (`keyFields: false` in
 *      `frontend/providers/apollo/apolloCache.ts`) and correctly select no
 *      `id`.
 *   4. Codegen binding + barrel parity — every constant stays
 *      `TypedDocumentNode`-typed against the generated operation types
 *      (compile-time proof by assignment) and the admin documents barrel
 *      re-exports the SAME document instances as the deep imports (consumer
 *      import conventions table).
 *
 * Zero server boot, zero DB, zero network: inspects only the already-compiled
 * AST through graphql kind-guard narrowing — no unsafe assertions anywhere.
 * NO useLazyQuery exists anywhere in the documents layer; consumers import
 * hooks from "@apollo/client/react".
 */

import { describe, expect, test } from "bun:test";
import type { TypedDocumentNode } from "@apollo/client";
import type { DocumentNode, FieldNode, OperationDefinitionNode } from "graphql";
import type {
  AdjustTeacherWalletMutation,
  AdjustTeacherWalletMutationVariables,
  AdminPendingWithdrawalsQuery,
  AdminPendingWithdrawalsQueryVariables,
  AdminStudentPaymentsQuery,
  AdminStudentPaymentsQueryVariables,
  AdminTeacherWalletQuery,
  AdminTeacherWalletQueryVariables,
  ApproveWithdrawalMutation,
  ApproveWithdrawalMutationVariables,
  RejectWithdrawalMutation,
  RejectWithdrawalMutationVariables,
} from "@/frontend/graphql/generated/gql/graphql";
import {
  adjustTeacherWalletMutationDocument as adjustTeacherWalletViaBarrel,
  adminPendingWithdrawalsQueryDocument as adminPendingWithdrawalsViaBarrel,
  adminStudentPaymentsQueryDocument as adminStudentPaymentsViaBarrel,
  adminTeacherWalletQueryDocument as adminTeacherWalletViaBarrel,
  approveWithdrawalMutationDocument as approveWithdrawalViaBarrel,
  rejectWithdrawalMutationDocument as rejectWithdrawalViaBarrel,
} from "@/frontend/graphql/sharedDocuments";
import {
  adjustTeacherWalletMutationDocument,
  adminPendingWithdrawalsQueryDocument,
  adminStudentPaymentsQueryDocument,
  adminTeacherWalletQueryDocument,
  approveWithdrawalMutationDocument,
  rejectWithdrawalMutationDocument,
} from "@/frontend/graphql/sharedDocuments/admin/admin-finance.documents";

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

/** Resolves a dotted selection path ("adminStudentPayments.items") or throws. */
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

/** Variable declared types as an ordered name → (non-null) type-name map. */
function variableTypeNames(operation: OperationDefinitionNode): Map<string, string> {
  const types = new Map<string, string>();
  for (const definition of operation.variableDefinitions ?? []) {
    let type = definition.type;
    if (type.kind === "NonNullType") {
      type = type.type;
    }
    if (type.kind !== "NamedType") {
      throw new Error(`variable ${definition.variable.name.value} must be a named type`);
    }
    types.set(definition.variable.name.value, type.name.value);
  }
  return types;
}

// ---------------------------------------------------------------------------
// Contract pins

/** Teacher-transaction scalar row, `id` FIRST (Apollo cache normalization). */
const TRANSACTION_ROW_FIELDS = ["id", "type", "status", "amount", "description"] as const;
const MUTATION_RETURN_FIELDS = [
  "id",
  "type",
  "status",
  "amount",
  "description",
  "walletId",
  "sessionId",
  "createdAt",
] as const;

describe("admin-finance documents — named operations + variables", () => {
  test("AdminStudentPayments is a single named query with the exact sanctioned variable set", () => {
    const operation = operationOrThrow(adminStudentPaymentsQueryDocument);
    expect(operation.name?.value).toBe("AdminStudentPayments");
    expect(operation.operation).toBe("query");
    expect(variableNames(operation)).toEqual(["filters", "page", "pageSize"]);
    const types = variableTypeNames(operation);
    expect(types.get("filters")).toBe("AdminStudentPaymentsFilterInput");
    expect(types.get("page")).toBe("Int");
    expect(types.get("pageSize")).toBe("Int");
  });

  test("AdminTeacherWallet is a single named query with the exact sanctioned variable set", () => {
    const operation = operationOrThrow(adminTeacherWalletQueryDocument);
    expect(operation.name?.value).toBe("AdminTeacherWallet");
    expect(operation.operation).toBe("query");
    expect(variableNames(operation)).toEqual(["teacherId", "filters", "page", "pageSize"]);
    const types = variableTypeNames(operation);
    expect(types.get("teacherId")).toBe("ID");
    expect(types.get("filters")).toBe("AdminWalletTransactionFilterInput");
    expect(types.get("page")).toBe("Int");
    expect(types.get("pageSize")).toBe("Int");
  });

  test("AdminPendingWithdrawals is a single named query with the exact sanctioned variable set", () => {
    const operation = operationOrThrow(adminPendingWithdrawalsQueryDocument);
    expect(operation.name?.value).toBe("AdminPendingWithdrawals");
    expect(operation.operation).toBe("query");
    expect(variableNames(operation)).toEqual(["page", "pageSize"]);
    const types = variableTypeNames(operation);
    expect(types.get("page")).toBe("Int");
    expect(types.get("pageSize")).toBe("Int");
  });

  test("the three mutations are single named operations with their sanctioned variable sets", () => {
    const approve = operationOrThrow(approveWithdrawalMutationDocument);
    expect(approve.name?.value).toBe("ApproveWithdrawal");
    expect(approve.operation).toBe("mutation");
    expect(variableNames(approve)).toEqual(["transactionId"]);

    const reject = operationOrThrow(rejectWithdrawalMutationDocument);
    expect(reject.name?.value).toBe("RejectWithdrawal");
    expect(reject.operation).toBe("mutation");
    expect(variableNames(reject)).toEqual(["transactionId", "reason"]);

    const adjust = operationOrThrow(adjustTeacherWalletMutationDocument);
    expect(adjust.name?.value).toBe("AdjustTeacherWallet");
    expect(adjust.operation).toBe("mutation");
    expect(variableNames(adjust)).toEqual(["input"]);
  });
});

describe("admin-finance documents — variable wiring into root-field arguments", () => {
  test("every query variable is threaded into its root-field argument (no dead variables)", () => {
    expect(
      argumentVariableNames(selectionPath(operationOrThrow(adminStudentPaymentsQueryDocument), "adminStudentPayments"))
    ).toEqual(["filters", "page", "pageSize"]);
    expect(
      argumentVariableNames(selectionPath(operationOrThrow(adminTeacherWalletQueryDocument), "adminTeacherWallet"))
    ).toEqual(["teacherId", "filters", "page", "pageSize"]);
    expect(
      argumentVariableNames(
        selectionPath(operationOrThrow(adminPendingWithdrawalsQueryDocument), "adminPendingWithdrawals")
      )
    ).toEqual(["page", "pageSize"]);
  });

  test("every mutation variable is threaded into its root-field argument (no dead variables)", () => {
    expect(
      argumentVariableNames(selectionPath(operationOrThrow(approveWithdrawalMutationDocument), "approveWithdrawal"))
    ).toEqual(["transactionId"]);
    expect(
      argumentVariableNames(selectionPath(operationOrThrow(rejectWithdrawalMutationDocument), "rejectWithdrawal"))
    ).toEqual(["transactionId", "reason"]);
    expect(
      argumentVariableNames(selectionPath(operationOrThrow(adjustTeacherWalletMutationDocument), "adjustTeacherWallet"))
    ).toEqual(["input"]);
  });

  test("mutation variables carry the sanctioned declared types", () => {
    const approveTypes = variableTypeNames(operationOrThrow(approveWithdrawalMutationDocument));
    expect(approveTypes.get("transactionId")).toBe("ID");
    const rejectTypes = variableTypeNames(operationOrThrow(rejectWithdrawalMutationDocument));
    expect(rejectTypes.get("transactionId")).toBe("ID");
    expect(rejectTypes.get("reason")).toBe("String");
    const adjustTypes = variableTypeNames(operationOrThrow(adjustTeacherWalletMutationDocument));
    expect(adjustTypes.get("input")).toBe("AdjustTeacherWalletInput");
  });
});

describe("admin-finance documents — id + selection shapes", () => {
  test("the payment row selects the full scalar row with id first", () => {
    const operation = operationOrThrow(adminStudentPaymentsQueryDocument);
    const row = selectionPath(operation, "adminStudentPayments.items");
    expect(fieldNames(row)).toEqual([
      "id",
      "studentId",
      "studentName",
      "subscriptionId",
      "amount",
      "currency",
      "paymentGateway",
      "status",
      "createdAt",
    ]);
    expect(fieldNames(row)[0]).toBe("id");
    for (const field of subFields(row)) {
      expect(field.selectionSet).toBeUndefined();
    }
  });

  test("the AdminStudentPaymentPage wrapper selects the honest envelope and no id (embedded value type)", () => {
    const wrapper = selectionPath(operationOrThrow(adminStudentPaymentsQueryDocument), "adminStudentPayments");
    expect(fieldNames(wrapper)).toEqual(["items", "totalCount", "page", "pageSize"]);
    expect(fieldNames(wrapper)).not.toContain("id");
  });

  test("the wallet summary selects the flat nullable pair + currency + teacher identity and no id", () => {
    const operation = operationOrThrow(adminTeacherWalletQueryDocument);
    const wrapper = selectionPath(operation, "adminTeacherWallet");
    expect(fieldNames(wrapper)).toEqual([
      "balance",
      "totalEarning",
      "currency",
      "teacherId",
      "teacherName",
      "transactions",
      "totalCount",
      "page",
      "pageSize",
    ]);
    expect(fieldNames(wrapper)).not.toContain("id");
  });

  test("the wallet transaction rows select the scalar row with id first", () => {
    const operation = operationOrThrow(adminTeacherWalletQueryDocument);
    const row = selectionPath(operation, "adminTeacherWallet.transactions");
    expect(fieldNames(row)).toEqual([...TRANSACTION_ROW_FIELDS, "sessionId", "createdAt"]);
    expect(fieldNames(row)[0]).toBe("id");
  });

  test("the withdrawal queue row embeds the pending transaction (id first) plus teacherName + walletBalance", () => {
    const operation = operationOrThrow(adminPendingWithdrawalsQueryDocument);
    const row = selectionPath(operation, "adminPendingWithdrawals.items");
    expect(fieldNames(row)).toEqual(["transaction", "teacherName", "walletBalance"]);
    const transaction = subField(row, "transaction");
    if (transaction === undefined) {
      throw new Error("expected transaction selection to exist");
    }
    expect(fieldNames(transaction)).toEqual([...TRANSACTION_ROW_FIELDS, "createdAt"]);
    expect(fieldNames(transaction)[0]).toBe("id");
  });

  test("the AdminWithdrawalQueuePage wrapper selects the honest envelope and no id (embedded value type)", () => {
    const wrapper = selectionPath(operationOrThrow(adminPendingWithdrawalsQueryDocument), "adminPendingWithdrawals");
    expect(fieldNames(wrapper)).toEqual(["items", "totalCount", "totalAmount", "page", "pageSize"]);
    expect(fieldNames(wrapper)).not.toContain("id");
  });

  test("each mutation returns the settled TeacherTransaction row with id first", () => {
    for (const [document, rootField] of [
      [approveWithdrawalMutationDocument, "approveWithdrawal"],
      [rejectWithdrawalMutationDocument, "rejectWithdrawal"],
      [adjustTeacherWalletMutationDocument, "adjustTeacherWallet"],
    ] as const) {
      const row = selectionPath(operationOrThrow(document), rootField);
      expect(fieldNames(row)).toEqual([...MUTATION_RETURN_FIELDS]);
      expect(fieldNames(row)[0]).toBe("id");
      expect(fieldNames(row)).not.toContain("updatedAt");
    }
  });
});

describe("admin-finance documents — codegen binding + barrel parity", () => {
  test("admin barrel re-exports the SAME document instances (cache-key safety)", () => {
    expect(adminStudentPaymentsViaBarrel).toBe(adminStudentPaymentsQueryDocument);
    expect(adminTeacherWalletViaBarrel).toBe(adminTeacherWalletQueryDocument);
    expect(adminPendingWithdrawalsViaBarrel).toBe(adminPendingWithdrawalsQueryDocument);
    expect(approveWithdrawalViaBarrel).toBe(approveWithdrawalMutationDocument);
    expect(rejectWithdrawalViaBarrel).toBe(rejectWithdrawalMutationDocument);
    expect(adjustTeacherWalletViaBarrel).toBe(adjustTeacherWalletMutationDocument);
  });

  test("documents remain TypedDocumentNode-typed against generated operation types", () => {
    // Compile-time proof by assignment — tsgo fails if an exported constant
    // loses its codegen typing or picks up an inline type literal.
    const studentPayments: TypedDocumentNode<AdminStudentPaymentsQuery, AdminStudentPaymentsQueryVariables> =
      adminStudentPaymentsQueryDocument;
    const teacherWallet: TypedDocumentNode<AdminTeacherWalletQuery, AdminTeacherWalletQueryVariables> =
      adminTeacherWalletQueryDocument;
    const pendingWithdrawals: TypedDocumentNode<AdminPendingWithdrawalsQuery, AdminPendingWithdrawalsQueryVariables> =
      adminPendingWithdrawalsQueryDocument;
    const approve: TypedDocumentNode<ApproveWithdrawalMutation, ApproveWithdrawalMutationVariables> =
      approveWithdrawalMutationDocument;
    const reject: TypedDocumentNode<RejectWithdrawalMutation, RejectWithdrawalMutationVariables> =
      rejectWithdrawalMutationDocument;
    const adjust: TypedDocumentNode<AdjustTeacherWalletMutation, AdjustTeacherWalletMutationVariables> =
      adjustTeacherWalletMutationDocument;

    // Runtime use keeps the bindings from being flagged as unused.
    expect(studentPayments.loc).toBeDefined();
    expect(teacherWallet.loc).toBeDefined();
    expect(pendingWithdrawals.loc).toBeDefined();
    expect(approve.loc).toBeDefined();
    expect(reject.loc).toBeDefined();
    expect(adjust.loc).toBeDefined();
  });
});
