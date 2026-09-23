/**
 * Structural lock over the student subscription-purchase shared GraphQL
 * documents.
 *
 * Mirrors the `sharedDocuments/documents.contract.test.ts` discipline for the
 * purchase-funnel domain: the catalog container, the checkout-redirect hook,
 * the payment result page and the my-subscriptions page all rely on these
 * SHARED `TypedDocumentNode` documents, so drift fails at this pure logic
 * tier instead of surfacing as confusing wire mismatches later:
 *
 *   1. NAMED operations — every document is a single named operation on the
 *      right channel (mutation vs query) with the exact sanctioned variable
 *      set, and every declared variable is actually threaded into its
 *      root-field argument (no dead variables, no literal arguments).
 *   2. Selection snapshots — the `StudentSubscription` and `StudentPayment`
 *      rows select their full field sets with `id` FIRST so Apollo
 *      normalizes the cache entries; the `PurchaseSubscriptionPayload` and
 *      `PaymentCheckout` wrappers are embedded value objects (no `id` by
 *      design) and correctly select none; the `StudentSubscription`
 *      selection is IDENTICAL across both documents so the cache-normalized
 *      shape never forks between the read and the write.
 *   3. Self-scoped surface — the whole variable surface is the single
 *      `input` whitelist whose only member is the plan selector: no
 *      identity argument (studentId or similar) exists anywhere in the
 *      documents, and the generated variables type pins the same whitelist
 *      at compile time (identity and money are always server-derived).
 *   4. Codegen binding + barrel parity — the constants stay
 *      `TypedDocumentNode`-typed against the generated operation types
 *      (compile-time proof by assignment), and the top-level barrel
 *      re-exports the SAME document instances as the deep imports
 *      (consumer import conventions table).
 *   5. Wire enums — the generated `SubscriptionStatus` / `PaymentStatus` /
 *      `PaymentGateway` enum members are the GraphQL WIRE names (status
 *      chips, settlement branches and gateway badges branch on these).
 *
 * Zero server boot, zero DB, zero network: inspects only already-compiled
 * ASTs through graphql kind-guard narrowing — no unsafe assertions anywhere
 * (oxlint `no-unsafe-type-assertion`). NO useLazyQuery exists anywhere in
 * the documents layer; consumers import hooks from "@apollo/client/react".
 */

import { describe, expect, test } from "bun:test";
import type { TypedDocumentNode } from "@apollo/client";
import type { DocumentNode, FieldNode, OperationDefinitionNode } from "graphql";
import {
  type MySubscriptionsQuery,
  PaymentGateway,
  PaymentStatus,
  type PurchaseSubscriptionPlanMutation,
  type PurchaseSubscriptionPlanMutationVariables,
  SubscriptionStatus,
} from "@/frontend/graphql/generated/gql/graphql";
import {
  mySubscriptionsQueryDocument as mySubscriptionsViaBarrel,
  purchaseSubscriptionMutationDocument as purchaseSubscriptionViaBarrel,
} from "@/frontend/graphql/sharedDocuments";
import {
  mySubscriptionsQueryDocument,
  purchaseSubscriptionMutationDocument,
} from "@/frontend/graphql/sharedDocuments/billing/subscription-purchase.documents";

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

/** Resolves a dotted selection path ("purchaseSubscription.subscription") or throws. */
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

/**
 * Variable names threaded as root-field arguments (`$x` → `x`), source order.
 * Throws on any LITERAL argument so the "no literal arguments" contract fails
 * here at the AST tier instead of being silently filtered away (a literal
 * would freeze a server-derived value into the document).
 */
function argumentVariableNames(field: FieldNode): string[] {
  // graphql-js types `arguments` as optional; an absent one simply yields
  // zero arguments (e.g. the no-arg `mySubscriptions` root field).
  return (field.arguments ?? []).flatMap(argument => {
    if (argument.value.kind === "Variable") {
      return [argument.value.name.value];
    }
    throw new Error(
      `expected argument "${argument.name.value}" on field "${field.name.value}" to be a variable (no literal arguments)`
    );
  });
}

// ---------------------------------------------------------------------------
// Contract table

interface PurchaseDocumentRow {
  readonly document: DocumentNode;
  readonly operationName: string;
  readonly channel: "mutation" | "query";
  /** Expected `($var, …)` declarations ([] for no-arg operations), in the
   * SAME order the document declares them (wire/source order). */
  readonly variables: readonly string[];
  /** Root field the operation targets. */
  readonly rootField: string;
}

const PURCHASE_DOCUMENT_TABLE: readonly PurchaseDocumentRow[] = [
  {
    document: purchaseSubscriptionMutationDocument,
    operationName: "PurchaseSubscriptionPlan",
    channel: "mutation",
    variables: ["input"],
    rootField: "purchaseSubscription",
  },
  {
    document: mySubscriptionsQueryDocument,
    operationName: "MySubscriptions",
    channel: "query",
    variables: [],
    rootField: "mySubscriptions",
  },
];

// The full `StudentSubscription` row (definition order, `id` first) — the
// byte-identical selection BOTH documents pin so the cache-normalized shape
// never forks between the purchase write and the list read. The nested
// `plan { id title }` sub-selection is part of that shared shape (the plan
// title the student surfaces render); the row-level `planId` stays so the
// mutation payload converges on the same `Plan:<id>` cache entry.
const STUDENT_SUBSCRIPTION_ROW: readonly string[] = [
  "id",
  "planId",
  "plan",
  "status",
  "startDate",
  "endDate",
  "paymentMethod",
  "paymentReference",
  "paymentVerifiedAt",
  "createdAt",
  "updatedAt",
];

/** The `plan` relation's sub-selection (the resolved catalog row's identity + title). */
const STUDENT_SUBSCRIPTION_PLAN_ROW: readonly string[] = ["id", "title"];

// The full `StudentPayment` ledger row (definition order, `id` first) — money
// as decimal strings (`amount`/`currency`), settlement state for the pending
// pair the purchase returns.
const STUDENT_PAYMENT_ROW: readonly string[] = [
  "id",
  "subscriptionId",
  "amount",
  "currency",
  "paymentGateway",
  "status",
  "createdAt",
  "updatedAt",
];

describe("subscription-purchase documents — named operations + channel + variables", () => {
  for (const row of PURCHASE_DOCUMENT_TABLE) {
    test(`${row.operationName} is a single named ${row.channel} operation`, () => {
      const operation = operationOrThrow(row.document);
      expect(operation.name?.value).toBe(row.operationName);
      expect(operation.name?.value ?? "").not.toBe("");
      expect(operation.operation).toBe(row.channel);
      expect(variableNames(operation)).toEqual([...row.variables]);
    });
  }

  test("every declared variable is wired into its root-field argument (no dead variables, no literal arguments)", () => {
    for (const row of PURCHASE_DOCUMENT_TABLE) {
      const operation = operationOrThrow(row.document);
      const root = selectionPath(operation, row.rootField);
      expect(argumentVariableNames(root)).toEqual([...row.variables]);
    }
  });

  test("variable surface is exactly the single input whitelist — zero identity arguments", () => {
    const declared = PURCHASE_DOCUMENT_TABLE.flatMap(row => variableNames(operationOrThrow(row.document)));
    expect(declared).toEqual(["input"]);
    // Belt-and-braces: no document smuggles a caller-identity argument.
    for (const name of declared) {
      expect(name.toLowerCase()).not.toContain("user");
      expect(name.toLowerCase()).not.toContain("student");
      expect(name.toLowerCase()).not.toContain("teacher");
    }
  });
});

describe("subscription-purchase documents — selection snapshots", () => {
  test("every StudentSubscription-typed selection selects the full eleven-field row with id first", () => {
    for (const path of ["purchaseSubscription.subscription", "mySubscriptions"]) {
      const operation = path.startsWith("mySubscriptions")
        ? operationOrThrow(mySubscriptionsQueryDocument)
        : operationOrThrow(purchaseSubscriptionMutationDocument);
      const selection = selectionPath(operation, path);
      expect(fieldNames(selection)).toEqual([...STUDENT_SUBSCRIPTION_ROW]);
      expect(fieldNames(selection)[0]).toBe("id");
    }
  });

  test("every plan relation selects exactly the resolved row's identity + title with id first", () => {
    for (const path of ["purchaseSubscription.subscription.plan", "mySubscriptions.plan"]) {
      const operation = path.startsWith("mySubscriptions")
        ? operationOrThrow(mySubscriptionsQueryDocument)
        : operationOrThrow(purchaseSubscriptionMutationDocument);
      const selection = selectionPath(operation, path);
      expect(fieldNames(selection)).toEqual([...STUDENT_SUBSCRIPTION_PLAN_ROW]);
      expect(fieldNames(selection)[0]).toBe("id");
    }
  });

  test("the StudentPayment selection selects the full eight-field row with id first", () => {
    const operation = operationOrThrow(purchaseSubscriptionMutationDocument);
    const payment = selectionPath(operation, "purchaseSubscription.payment");
    expect(fieldNames(payment)).toEqual([...STUDENT_PAYMENT_ROW]);
    expect(fieldNames(payment)[0]).toBe("id");
  });

  test("the PurchaseSubscriptionPayload wrapper selects exactly subscription/payment/checkout", () => {
    const operation = operationOrThrow(purchaseSubscriptionMutationDocument);
    const payload = selectionPath(operation, "purchaseSubscription");
    expect(fieldNames(payload)).toEqual(["subscription", "payment", "checkout"]);
  });

  test("the PaymentCheckout descriptor selects its three fields and no id (embedded value type)", () => {
    const operation = operationOrThrow(purchaseSubscriptionMutationDocument);
    const checkout = selectionPath(operation, "purchaseSubscription.checkout");
    expect(fieldNames(checkout)).toEqual(["provider", "providerReference", "checkoutUrl"]);
    // The redirect trigger the checkout consumer branches on is honestly
    // nullable on the wire (server-side providers have no hosted URL).
    expect(fieldNames(checkout)).not.toContain("id");
  });

  test("the StudentSubscription selection is identical across both documents (cache shape never forks)", () => {
    const mutationOperation = operationOrThrow(purchaseSubscriptionMutationDocument);
    const queryOperation = operationOrThrow(mySubscriptionsQueryDocument);
    const viaMutation = selectionPath(mutationOperation, "purchaseSubscription.subscription");
    const viaQuery = selectionPath(queryOperation, "mySubscriptions");
    expect(fieldNames(viaMutation)).toEqual(fieldNames(viaQuery));
    // The ONLY nested sub-selection is the `plan` relation (identity +
    // title); every other row field stays flat.
    const nestedFields = (row: FieldNode): string[] =>
      subFields(row)
        .filter(field => field.selectionSet !== undefined)
        .map(field => field.name.value);
    expect(nestedFields(viaQuery)).toEqual(["plan"]);
    expect(nestedFields(viaMutation)).toEqual(["plan"]);
  });
});

describe("subscription-purchase documents — codegen binding + barrel parity", () => {
  test("top-level barrel re-exports the SAME document instances (cache-key safety)", () => {
    expect(purchaseSubscriptionViaBarrel).toBe(purchaseSubscriptionMutationDocument);
    expect(mySubscriptionsViaBarrel).toBe(mySubscriptionsQueryDocument);
  });

  test("documents remain TypedDocumentNode-typed against generated operation types", () => {
    // Compile-time proof by assignment — tsgo fails if any exported constant
    // loses its codegen typing or picks up an inline type literal.
    const typedPurchase: TypedDocumentNode<
      PurchaseSubscriptionPlanMutation,
      PurchaseSubscriptionPlanMutationVariables
    > = purchaseSubscriptionMutationDocument;
    const typedList: TypedDocumentNode<MySubscriptionsQuery> = mySubscriptionsQueryDocument;

    // Runtime uses keep the bindings from being flagged as unused.
    expect(typedPurchase.loc).toBeDefined();
    expect(typedList.loc).toBeDefined();
  });

  test("the purchase variables whitelist is exactly the plan selector (compile-time pin)", () => {
    // Object-literal excess-property checking makes any added client-owned
    // field (identity, money, currency…) a compile error here — the wire
    // whitelist is the plan selector alone; everything else is
    // server-derived.
    const purchaseVariables: PurchaseSubscriptionPlanMutationVariables = { input: { planId: "42" } };
    expect(purchaseVariables.input.planId).toBe("42");
  });
});

describe("generated billing enums are the GraphQL wire names", () => {
  test("SubscriptionStatus members are the wire names", () => {
    // The codegen enum is the ONLY enum frontend code may use: its values
    // are the wire names. Widening the spread into a Record<string, string>
    // keeps the matcher arguments plain strings without unsafe casts.
    const wireNames: Record<string, string> = { ...SubscriptionStatus };
    expect(wireNames).toEqual({
      Active: "Active",
      Cancelled: "Cancelled",
      Expired: "Expired",
      Pending: "Pending",
      Suspended: "Suspended",
    });
  });

  test("PaymentStatus members are the wire names", () => {
    const wireNames: Record<string, string> = { ...PaymentStatus };
    expect(wireNames).toEqual({
      Failed: "Failed",
      Paid: "Paid",
      Pending: "Pending",
      Refunded: "Refunded",
    });
  });

  test("PaymentGateway members are the wire names", () => {
    const wireNames: Record<string, string> = { ...PaymentGateway };
    expect(wireNames).toEqual({
      BankTransfer: "BankTransfer",
      Fawry: "Fawry",
      Mock: "Mock",
      OfflineCash: "OfflineCash",
      Other: "Other",
      Paymob: "Paymob",
      Paypal: "Paypal",
      Scholarship: "Scholarship",
      Stripe: "Stripe",
    });
  });
});
