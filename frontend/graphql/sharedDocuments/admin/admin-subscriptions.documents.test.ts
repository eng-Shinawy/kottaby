/**
 * Structural lock over the admin-subscription shared GraphQL documents.
 *
 * Mirrors the `admin-students.documents.test.ts` discipline for the
 * subscription-management surface: the student drawer depends on these
 * SHARED `TypedDocumentNode` documents, so drift fails at this pure logic
 * tier instead of surfacing as a confusing wire mismatch later:
 *
 *   1. NAMED operations — one named query + four named mutations whose
 *      GraphQL operation names match the `{entityName}…Document` export
 *      convention (mutations carry NO `Subscription` suffix — the
 *      naming-convention lint reserves that suffix for GraphQL
 *      subscription semantics).
 *   2. Argument wiring — each declared variable is actually threaded into
 *      the root-field argument (no dead variables, no literal arguments).
 *   3. `id` field requirement — `id` is selected FIRST on every
 *      normalizable object (the row AND its nested plan) so Apollo
 *      normalizes the cache entries.
 *   4. Fragment reuse — every row selection spreads the SAME
 *      `AdminSubscriptionRowFields` fragment (no bespoke inline
 *      selections), so the read query and all four mutation payloads
 *      converge on identical cache shapes.
 *   5. Proration payload shape — the plan-change payload carries the new
 *      row plus the full proration summary (direction + carrySessions +
 *      forfeitedSessions) the drawer's success copy renders.
 *   6. Codegen binding + barrel parity — the constants stay
 *      `TypedDocumentNode`-typed against the generated operation types
 *      (compile-time proof by assignment), and the top-level barrel
 *      re-exports the SAME document instances.
 *
 * Zero server boot, zero DB, zero network: inspects only already-compiled
 * ASTs through graphql kind-guard narrowing — no unsafe assertions anywhere
 * (oxlint `no-unsafe-type-assertion`). NO useLazyQuery exists anywhere in
 * the documents layer; consumers import hooks from "@apollo/client/react".
 */

import { describe, expect, test } from "bun:test";
import type { TypedDocumentNode } from "@apollo/client";
import type {
  AdminStudentSubscriptionsQuery,
  AdminStudentSubscriptionsQueryVariables,
  AdminSubscriptionCancelMutation,
  AdminSubscriptionCancelMutationVariables,
  AdminSubscriptionExtendMutation,
  AdminSubscriptionExtendMutationVariables,
  AdminSubscriptionPlanChangeMutation,
  AdminSubscriptionPlanChangeMutationVariables,
  AdminSubscriptionRenewMutation,
  AdminSubscriptionRenewMutationVariables,
} from "@/frontend/graphql/generated/gql/graphql";
import {
  adminStudentSubscriptionsQueryDocument as adminStudentSubscriptionsViaBarrel,
  adminSubscriptionCancelMutationDocument as adminSubscriptionCancelViaBarrel,
  adminSubscriptionExtendMutationDocument as adminSubscriptionExtendViaBarrel,
  adminSubscriptionPlanChangeMutationDocument as adminSubscriptionPlanChangeViaBarrel,
  adminSubscriptionRenewMutationDocument as adminSubscriptionRenewViaBarrel,
} from "@/frontend/graphql/sharedDocuments";
import {
  adminStudentSubscriptionsQueryDocument,
  adminSubscriptionCancelMutationDocument,
  adminSubscriptionExtendMutationDocument,
  adminSubscriptionPlanChangeMutationDocument,
  adminSubscriptionRenewMutationDocument,
} from "@/frontend/graphql/sharedDocuments/admin/admin-subscriptions.documents";
import {
  argumentVariableNames,
  fieldNames,
  fragmentDefinition,
  fragmentSpreads,
  operationOrThrow,
  selectionPath,
  subField,
  variableNames,
} from "@/frontend/graphql/sharedDocuments/document-test-kit";

// ---------------------------------------------------------------------------
// Contract

/** The pinned row fragment selection (source order) — read + payloads alike. */
const ADMIN_SUBSCRIPTION_ROW_FIELDS = [
  "id",
  "planId",
  "status",
  "startDate",
  "endDate",
  "createdAt",
  "updatedAt",
  "auditEntriesCount",
  "auditTrailPeek",
  "plan",
] as const;

/** The pinned nested audit-peek selection (source order — an embedded value object, so no id). */
const ADMIN_SUBSCRIPTION_PEEK_FIELDS = ["actionType", "at"] as const;

/** The pinned nested plan snapshot selection (source order). */
const ADMIN_SUBSCRIPTION_PLAN_FIELDS = [
  "id",
  "title",
  "sessionCount",
  "intervalDays",
  "price",
  "currency",
  "balanceLane",
] as const;

/**
 * Every document under contract, with its operation name, kind, and the
 * root-field path its rows/payload sit at (the mutation operation names
 * are `AdminSubscription<Verb>` while the wire fields stay
 * `admin<Verb>Subscription` — the lint reserves the `Subscription` suffix
 * on operation names only).
 */
const DOCUMENT_CONTRACTS = [
  {
    document: adminStudentSubscriptionsQueryDocument,
    name: "AdminStudentSubscriptions",
    kind: "query",
    rootField: "adminStudentSubscriptions",
  },
  {
    document: adminSubscriptionExtendMutationDocument,
    name: "AdminSubscriptionExtend",
    kind: "mutation",
    rootField: "adminExtendSubscription",
  },
  {
    document: adminSubscriptionRenewMutationDocument,
    name: "AdminSubscriptionRenew",
    kind: "mutation",
    rootField: "adminRenewSubscription",
  },
  {
    document: adminSubscriptionCancelMutationDocument,
    name: "AdminSubscriptionCancel",
    kind: "mutation",
    rootField: "adminCancelSubscription",
  },
  {
    document: adminSubscriptionPlanChangeMutationDocument,
    name: "AdminSubscriptionPlanChange",
    kind: "mutation",
    rootField: "adminChangeSubscriptionPlan.subscription",
  },
] as const;

describe("admin-subscriptions documents — named operations + variables", () => {
  test("every contract is a single named operation with its sanctioned variable set", () => {
    for (const contract of DOCUMENT_CONTRACTS) {
      const operation = operationOrThrow(contract.document);
      expect(operation.name?.value).toBe(contract.name);
      expect(operation.operation).toBe(contract.kind);
      expect(variableNames(operation)).toEqual(contract.kind === "query" ? ["userId"] : ["input"]);
    }
  });

  test("every declared variable is wired into the root-field argument (no dead variables, no literal arguments)", () => {
    for (const contract of DOCUMENT_CONTRACTS) {
      const operation = operationOrThrow(contract.document);
      // Arguments live on the ROOT field only — the plan-change contract's
      // path continues into `.subscription` for the row-shape assertions.
      const rootField = contract.rootField.split(".")[0] ?? contract.rootField;
      const root = selectionPath(operation, rootField);
      expect(argumentVariableNames(root)).toEqual(contract.kind === "query" ? ["userId"] : ["input"]);
    }
  });
});

describe("admin-subscriptions documents — id + fragment-reuse shapes", () => {
  test("AdminSubscriptionRowFields fragment selects id FIRST (row normalization)", () => {
    const fragment = fragmentDefinition(adminStudentSubscriptionsQueryDocument, "AdminSubscriptionRowFields");
    expect(fieldNames(fragment)[0]).toBe("id");
    expect(fieldNames(fragment)).toEqual([...ADMIN_SUBSCRIPTION_ROW_FIELDS]);
  });

  test("the nested plan snapshot selects id FIRST and carries the lane the change-plan selector filters on", () => {
    const fragment = fragmentDefinition(adminStudentSubscriptionsQueryDocument, "AdminSubscriptionRowFields");
    const plan = subField(fragment, "plan");
    expect(plan).toBeDefined();
    if (plan === undefined) {
      throw new Error("expected the AdminSubscriptionRowFields fragment to select plan");
    }
    expect(fieldNames(plan)[0]).toBe("id");
    expect(fieldNames(plan)).toEqual([...ADMIN_SUBSCRIPTION_PLAN_FIELDS]);
  });

  test("the nested audit peek selects exactly actionType + at (embedded value object — no id of its own)", () => {
    const fragment = fragmentDefinition(adminStudentSubscriptionsQueryDocument, "AdminSubscriptionRowFields");
    const peek = subField(fragment, "auditTrailPeek");
    expect(peek).toBeDefined();
    if (peek === undefined) {
      throw new Error("expected the AdminSubscriptionRowFields fragment to select auditTrailPeek");
    }
    expect(fieldNames(peek)).toEqual([...ADMIN_SUBSCRIPTION_PEEK_FIELDS]);
  });

  test("every contract's rows spread the SHARED AdminSubscriptionRowFields fragment", () => {
    for (const contract of DOCUMENT_CONTRACTS) {
      const operation = operationOrThrow(contract.document);
      const selection = selectionPath(operation, contract.rootField);
      expect(fragmentSpreads(selection)).toContain("AdminSubscriptionRowFields");
    }
  });
});

describe("admin-subscriptions plan-change payload — proration summary", () => {
  test("the payload selects the new row plus direction/carrySessions/forfeitedSessions", () => {
    const operation = operationOrThrow(adminSubscriptionPlanChangeMutationDocument);
    const payload = selectionPath(operation, "adminChangeSubscriptionPlan");
    expect(fieldNames(payload)).toEqual(["subscription", "direction", "carrySessions", "forfeitedSessions"]);
  });

  test("the payload wrapper itself selects no id (embedded value object — the nested row normalizes)", () => {
    const operation = operationOrThrow(adminSubscriptionPlanChangeMutationDocument);
    const payload = selectionPath(operation, "adminChangeSubscriptionPlan");
    expect(fieldNames(payload)).not.toContain("id");
  });
});

describe("admin-subscriptions documents — codegen binding + barrel parity", () => {
  test("top-level barrel re-exports the SAME document instances (cache-key safety)", () => {
    expect(adminStudentSubscriptionsViaBarrel).toBe(adminStudentSubscriptionsQueryDocument);
    expect(adminSubscriptionExtendViaBarrel).toBe(adminSubscriptionExtendMutationDocument);
    expect(adminSubscriptionRenewViaBarrel).toBe(adminSubscriptionRenewMutationDocument);
    expect(adminSubscriptionCancelViaBarrel).toBe(adminSubscriptionCancelMutationDocument);
    expect(adminSubscriptionPlanChangeViaBarrel).toBe(adminSubscriptionPlanChangeMutationDocument);
  });

  test("documents remain TypedDocumentNode-typed against the generated operation types", () => {
    // Compile-time proof by assignment — tsgo fails if any exported constant
    // loses its codegen typing or picks up an inline type literal.
    const query: TypedDocumentNode<AdminStudentSubscriptionsQuery, AdminStudentSubscriptionsQueryVariables> =
      adminStudentSubscriptionsQueryDocument;
    const extend: TypedDocumentNode<AdminSubscriptionExtendMutation, AdminSubscriptionExtendMutationVariables> =
      adminSubscriptionExtendMutationDocument;
    const renew: TypedDocumentNode<AdminSubscriptionRenewMutation, AdminSubscriptionRenewMutationVariables> =
      adminSubscriptionRenewMutationDocument;
    const cancel: TypedDocumentNode<AdminSubscriptionCancelMutation, AdminSubscriptionCancelMutationVariables> =
      adminSubscriptionCancelMutationDocument;
    const planChange: TypedDocumentNode<
      AdminSubscriptionPlanChangeMutation,
      AdminSubscriptionPlanChangeMutationVariables
    > = adminSubscriptionPlanChangeMutationDocument;
    expect(query.loc).toBeDefined();
    expect(extend.loc).toBeDefined();
    expect(renew.loc).toBeDefined();
    expect(cancel.loc).toBeDefined();
    expect(planChange.loc).toBeDefined();
  });
});
