/**
 * Subscription-purchase GraphQL contract — schema + payload-shape suite.
 *
 * Executed in-process against the canonical code-first schema (the
 * plan-catalog contract-suite pattern): the resolvers, the scope gate, the
 * purchase service, the repositories, and the live test database all run in
 * THIS process, so the committed-row oracles and the teardown are exact. The
 * live-server harness cannot run in this worktree: Turbopack refuses the
 * worktree's out-of-root `node_modules` symlink, and the single-process
 * PGlite provider gives the spawned server a disjoint database snapshot, so
 * the spawned boundary and the test process could never observe the same
 * rows (probe-proven). The contract this suite pins is identical either way:
 * the same schema object, resolver stack, and service the HTTP boundary uses.
 *
 * Pins the WIRE CONTRACT of the student purchase surface:
 *  - SDL shape: `purchaseSubscription(input: PurchaseSubscriptionInput!)` →
 *    `PurchaseSubscriptionPayload!` and the zero-argument
 *    `mySubscriptions: [StudentSubscription!]!` list, plus the exact field
 *    inventory of the payload triple (`subscription`/`payment`/`checkout`),
 *    the `StudentSubscription` entity (wire name — `Subscription` is reserved
 *    for the schema's subscription root and must never carry the entity), and
 *    the `PaymentCheckout` descriptor with its nullable `checkoutUrl`.
 *  - Identity hygiene at the shape level: the entities expose NO owner column
 *    (`userId`/`studentId` never cross the wire — the purchaser identity is
 *    server-bound).
 *  - Executed payload shape: the student happy path returns the pending pair
 *    (strongly-typed wire enums, decimal money as a string, mock gateway
 *    descriptor with a `mock_` provider reference and a `null` checkout URL)
 *    and commits exactly one pending subscription/payment/junction set; every
 *    denial channel below leaves the committed state untouched.
 *  - Denial channels: a missing idempotency key (the context field exactly as
 *    the context factory materializes it from the `X-Idempotency-Key` header)
 *    surfaces `VALIDATION` before any write; an inactive plan, an unknown
 *    plan, and a malformed plan id all surface the canonical
 *    plan-not-purchasable `PLAN_NOT_FOUND` channel — the malformed id dies in
 *    the strict numeric coercion at the resolver boundary, never a silent
 *    mis-target.
 *
 * Fixtures: a real committed student + plan pair via the DB entity-setup
 * helpers; every actor context is built from a REAL `users` row holding its
 * real role value and governance state — nothing is monkey-patched. Teardown
 * hard-deletes every fixture row in FK-safe order.
 *
 * Run:
 *   bun run test/scripts/run-test.ts backend/graphql/test/subscription-purchase.schema.test.ts
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { GraphQLInputObjectType, GraphQLObjectType, graphql } from "graphql";
import { db } from "@/backend/db";
import { plans } from "@/backend/db/schema/billing/plans";
import { studentPayments } from "@/backend/db/schema/billing/student-payments";
import { studentSubscriptions } from "@/backend/db/schema/billing/student-subscriptions";
import { subscriptions } from "@/backend/db/schema/billing/subscriptions";
import { students } from "@/backend/db/schema/students/students";
import { users } from "@/backend/db/schema/users/users";
import { createTestPlan, createTestStudent, createTestUser } from "@/backend/db/test/entity-setup";
import { SubscriptionCreditLane } from "@/backend/enum/billing/subscription-credit-lane.enum";
import { toUserRole } from "@/backend/enum/users/user-role.enum";
import type { Context } from "@/backend/graphql/gqlContextFactory";
import { graphQLSchema } from "@/backend/graphql/gqlSchema";
import type { UserSelectType } from "@/backend/types";
import { getServerTranslations } from "@/shared/locale/server-graphql";
import type { Translations } from "@/shared/locale/types/message";
import { withImmutabilityTriggersSuspended } from "@/test/helpers/db-cleanup";
import { journeyPrefix } from "@/test/workflows/helpers";

// ─── Harness state ───────────────────────────────────────────────────────────

/** Per-run prefix — unique actor labels, plan titles, and idempotency keys. */
const PREFIX = journeyPrefix("gqlsub-schema");

const KEY_HAPPY = `${PREFIX}-key-happy`;
const KEY_INACTIVE = `${PREFIX}-key-inactive`;
const KEY_UNKNOWN = `${PREFIX}-key-unknown`;
const KEY_MALFORMED = `${PREFIX}-key-malformed`;

let studentUser: UserSelectType;
let planId = 0;
let inactivePlanId = 0;

// ─── Documents ───────────────────────────────────────────────────────────────

const PURCHASE_SOURCE = `
  mutation PurchaseSubscription($input: PurchaseSubscriptionInput!) {
    purchaseSubscription(input: $input) {
      subscription {
        id
        planId
        status
        startDate
        endDate
        paymentMethod
        paymentReference
        paymentVerifiedAt
        createdAt
        updatedAt
      }
      payment {
        id
        subscriptionId
        amount
        currency
        paymentGateway
        status
        createdAt
        updatedAt
      }
      checkout {
        provider
        providerReference
        checkoutUrl
      }
    }
  }
`;

// ─── Execution helpers (in-process — zero casts) ─────────────────────────────

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * Builds the per-request context for a REAL user row — the exact shape the
 * context factory produces for an authenticated request (sanitized user,
 * enum-mapped role, propagation-only idempotency key), with the role and
 * governance state read from the committed row itself.
 */
function contextFor(user: UserSelectType, idempotencyKey: string | null): Context {
  const { passwordHash: _passwordHash, ...rest } = user;
  const safeUser = { ...rest, preferredRecitation: null };
  const locale = "en";
  const translations = getServerTranslations(locale);
  return {
    locale,
    t: async <K extends keyof Translations>(namespace: K) => translations[namespace],
    requestId: `${PREFIX}-request`,
    idempotencyKey,
    user: safeUser,
    safeUser,
    permissions: [],
    isSuperAdmin: user.role === "admin",
    role: toUserRole(user.role),
    cookies: {},
    authCookieOut: [],
  };
}

/** Anonymous context — the exact shape the factory produces when no token verifies. */
function anonymousContext(): Context {
  const translations = getServerTranslations("en");
  return {
    locale: "en",
    t: async <K extends keyof Translations>(namespace: K) => translations[namespace],
    requestId: `${PREFIX}-request`,
    idempotencyKey: null,
    user: null,
    safeUser: null,
    permissions: [],
    isSuperAdmin: false,
    role: null,
    cookies: {},
    authCookieOut: [],
  };
}

/** Extracts the root-field payload object of a happy-path result. */
function payloadOf(result: { readonly data?: unknown }, rootField: string): Record<string, unknown> {
  if (!isRecord(result.data)) {
    throw new Error(`missing data for ${rootField}`);
  }
  const payload: unknown = result.data[rootField];
  if (!isRecord(payload)) {
    throw new Error(`missing ${rootField} payload in response data`);
  }
  return payload;
}

/** Extracts a nested object payload (e.g. the checkout descriptor). */
function nestedOf(parent: Record<string, unknown>, field: string): Record<string, unknown> {
  const nested: unknown = parent[field];
  if (!isRecord(nested)) {
    throw new Error(`missing ${field} object in payload`);
  }
  return nested;
}

/**
 * Asserts the result carries EXACTLY one domain error whose
 * `extensions.code` equals the expected transport code, returning the message
 * for callers that pin denial-copy properties.
 */
function expectDomainDenial(
  result: Awaited<ReturnType<typeof executePurchase>>,
  expectedCode: string
): { readonly message: string } {
  const first = result.errors?.[0];
  expect(first).toBeDefined();
  expect(result.errors).toHaveLength(1);
  expect(first?.extensions?.code).toBe(expectedCode);
  return { message: first?.message ?? "" };
}

/** Runs the purchase mutation as one actor under one idempotency key. */
async function executePurchase(idempotencyKey: string | null, rawPlanId: string, user: UserSelectType) {
  return graphql({
    schema: graphQLSchema,
    source: PURCHASE_SOURCE,
    variableValues: { input: { planId: rawPlanId } },
    contextValue: contextFor(user, idempotencyKey),
  });
}

/** Committed-row counters for the fixture student (the zero-writes oracle). */
async function committedRowCounts(
  studentUserId: number
): Promise<{ subs: number; payments: number; junction: number }> {
  const [subs, payments, junction] = await Promise.all([
    db.$count(subscriptions, eq(subscriptions.userId, studentUserId)),
    db.$count(studentPayments, eq(studentPayments.studentId, studentUserId)),
    db.$count(studentSubscriptions, eq(studentSubscriptions.studentId, studentUserId)),
  ]);
  return { subs, payments, junction };
}

// ─── Fixtures (committed cast) ───────────────────────────────────────────────

beforeAll(async () => {
  await db.transaction(async tx => {
    studentUser = await createTestUser(tx, { fullName: `${PREFIX} student` });
    await createTestStudent(tx, studentUser.id);
    const activePlan = await createTestPlan(tx, { balanceLane: SubscriptionCreditLane.Hifz });
    const inactivePlan = await createTestPlan(tx, { isActive: false, deactivatedAt: new Date() });
    planId = activePlan.id;
    inactivePlanId = inactivePlan.id;
  });
});

afterAll(async () => {
  // FK-safe hard-delete of every fixture row. The payment-ledger rows are
  // un-deletable through their append-only guard, so that single leg runs
  // under the sanctioned teardown-window trigger suspension; with the ledger
  // leg resolved the rest deletes in strict child-first order (payments
  // before subscriptions, so the subscription delete never fires a set-null
  // write against a surviving payment row).
  await withImmutabilityTriggersSuspended(["student_payments"], async () => {
    await db.delete(studentPayments).where(eq(studentPayments.studentId, studentUser.id));
  });
  await db.delete(studentSubscriptions).where(eq(studentSubscriptions.studentId, studentUser.id));
  await db.delete(subscriptions).where(eq(subscriptions.userId, studentUser.id));
  await db.delete(plans).where(eq(plans.id, planId));
  await db.delete(plans).where(eq(plans.id, inactivePlanId));
  await db.delete(students).where(eq(students.id, studentUser.id));
  await db.delete(users).where(eq(users.id, studentUser.id));

  // Load-bearing residue proof: the teardown must leave zero rows behind.
  const [subResidue, paymentResidue, junctionResidue, userResidue] = await Promise.all([
    db.$count(subscriptions, eq(subscriptions.userId, studentUser.id)),
    db.$count(studentPayments, eq(studentPayments.studentId, studentUser.id)),
    db.$count(studentSubscriptions, eq(studentSubscriptions.studentId, studentUser.id)),
    db.$count(users, eq(users.id, studentUser.id)),
  ]);
  expect(subResidue).toBe(0);
  expect(paymentResidue).toBe(0);
  expect(junctionResidue).toBe(0);
  expect(userResidue).toBe(0);
});

// ─── Section 1 — SDL surface contract ────────────────────────────────────────

describe("subscription purchase — SDL surface contract", () => {
  test("purchaseSubscription mutation exposes the payload with a single non-null input arg", () => {
    const mutationType = graphQLSchema.getMutationType();
    expect(mutationType).toBeDefined();
    const field = mutationType?.getFields().purchaseSubscription;
    expect(field).toBeDefined();
    expect(field?.type.toString()).toBe("PurchaseSubscriptionPayload!");
    expect(field?.args.map(arg => arg.name)).toEqual(["input"]);
    expect(field?.args[0]?.type.toString()).toBe("PurchaseSubscriptionInput!");
  });

  test("mySubscriptions query is a zero-argument non-null list of StudentSubscription", () => {
    const queryType = graphQLSchema.getQueryType();
    expect(queryType).toBeDefined();
    const field = queryType?.getFields().mySubscriptions;
    expect(field).toBeDefined();
    expect(field?.type.toString()).toBe("[StudentSubscription!]!");
    expect(field?.args).toHaveLength(0);
  });

  test("PurchaseSubscriptionPayload carries exactly the pending triple", () => {
    const payloadType = graphQLSchema.getType("PurchaseSubscriptionPayload");
    expect(payloadType).toBeInstanceOf(GraphQLObjectType);
    if (!(payloadType instanceof GraphQLObjectType)) return;

    const fields = payloadType.getFields();
    expect(Object.keys(fields).toSorted((a, b) => a.localeCompare(b))).toEqual(["checkout", "payment", "subscription"]);
    expect(fields.subscription?.type.toString()).toBe("StudentSubscription!");
    expect(fields.payment?.type.toString()).toBe("StudentPayment!");
    expect(fields.checkout?.type.toString()).toBe("PaymentCheckout!");
  });

  test("StudentSubscription entity exposes its lifecycle shape and no owner column", () => {
    const entityType = graphQLSchema.getType("StudentSubscription");
    expect(entityType).toBeInstanceOf(GraphQLObjectType);
    if (!(entityType instanceof GraphQLObjectType)) return;

    const fields = entityType.getFields();
    const expectedTypes: Record<string, string> = {
      id: "ID!",
      planId: "Int!",
      plan: "Plan!",
      status: "SubscriptionStatus!",
      startDate: "String",
      endDate: "String",
      paymentMethod: "PaymentGateway",
      paymentReference: "String",
      paymentVerifiedAt: "String",
      createdAt: "String!",
      updatedAt: "String!",
    };
    // The plan relation resolves the catalog row (the title the student
    // surfaces render) — NON-NULL honestly (restrict-FK plan_id).
    for (const [name, expectedType] of Object.entries(expectedTypes)) {
      expect(fields[name]?.type.toString()).toBe(expectedType);
    }
    // The purchaser identity stays server-bound: no owner column on the wire.
    expect(fields.userId).toBeUndefined();
    expect(fields.studentId).toBeUndefined();
  });

  test("StudentPayment entity exposes its ledger shape and no owner column", () => {
    const paymentType = graphQLSchema.getType("StudentPayment");
    expect(paymentType).toBeInstanceOf(GraphQLObjectType);
    if (!(paymentType instanceof GraphQLObjectType)) return;

    const fields = paymentType.getFields();
    const expectedTypes: Record<string, string> = {
      id: "ID!",
      subscriptionId: "Int",
      amount: "String!",
      currency: "String!",
      paymentGateway: "PaymentGateway!",
      status: "PaymentStatus!",
      createdAt: "String!",
      updatedAt: "String!",
    };
    for (const [name, expectedType] of Object.entries(expectedTypes)) {
      expect(fields[name]?.type.toString()).toBe(expectedType);
    }
    expect(fields.studentId).toBeUndefined();
  });

  test("PaymentCheckout descriptor carries provider, reference, and a nullable checkout URL", () => {
    const checkoutType = graphQLSchema.getType("PaymentCheckout");
    expect(checkoutType).toBeInstanceOf(GraphQLObjectType);
    if (!(checkoutType instanceof GraphQLObjectType)) return;

    const fields = checkoutType.getFields();
    expect(Object.keys(fields).toSorted((a, b) => a.localeCompare(b))).toEqual([
      "checkoutUrl",
      "provider",
      "providerReference",
    ]);
    expect(fields.provider?.type.toString()).toBe("PaymentGateway!");
    expect(fields.providerReference?.type.toString()).toBe("String!");
    expect(fields.checkoutUrl?.type.toString()).toBe("String");
  });

  test("PurchaseSubscriptionInput carries exactly the non-null planId selector", () => {
    const inputType = graphQLSchema.getType("PurchaseSubscriptionInput");
    expect(inputType).toBeInstanceOf(GraphQLInputObjectType);
    if (!(inputType instanceof GraphQLInputObjectType)) return;

    const fields = inputType.getFields();
    expect(Object.keys(fields)).toEqual(["planId"]);
    expect(fields.planId?.type.toString()).toBe("ID!");
  });
});

// ─── Section 2 — executed payload shape (student happy path) ─────────────────

describe("purchaseSubscription — executed payload shape (student)", () => {
  test("anonymous purchase → UNAUTHORIZED (scope gate, pre-resolver)", async () => {
    const result = await graphql({
      schema: graphQLSchema,
      source: PURCHASE_SOURCE,
      variableValues: { input: { planId: String(planId) } },
      contextValue: anonymousContext(),
    });
    expectDomainDenial(result, "UNAUTHORIZED");
  });

  test("student purchase returns the pending pair plus the mock checkout descriptor", async () => {
    const result = await executePurchase(KEY_HAPPY, String(planId), studentUser);
    expect(result.errors).toBeUndefined();

    const payload = payloadOf(result, "purchaseSubscription");
    const subscription = nestedOf(payload, "subscription");
    const payment = nestedOf(payload, "payment");
    const checkout = nestedOf(payload, "checkout");

    // Pending subscription: lifecycle + gateway echo + no start window yet.
    expect(typeof subscription.id).toBe("string");
    expect(subscription.planId).toBe(planId);
    expect(subscription.status).toBe("Pending");
    expect(subscription.paymentMethod).toBe("Mock");
    expect(subscription.paymentReference).toBe(checkout.providerReference);
    expect(subscription.startDate).toBeNull();
    expect(subscription.endDate).toBeNull();
    expect(subscription.paymentVerifiedAt).toBeNull();
    expect(typeof subscription.createdAt).toBe("string");
    expect(typeof subscription.updatedAt).toBe("string");

    // Pending payment: server-derived decimal money (a string) + pair linkage.
    expect(typeof payment.id).toBe("string");
    expect(payment.subscriptionId).toBe(Number(subscription.id));
    expect(payment.amount).toBe("200.00");
    expect(typeof payment.amount).toBe("string");
    expect(payment.currency).toBe("EGP");
    expect(payment.paymentGateway).toBe("Mock");
    expect(payment.status).toBe("Pending");
    expect(typeof payment.createdAt).toBe("string");
    expect(typeof payment.updatedAt).toBe("string");

    // Checkout descriptor: mock provider, deterministic mock reference, and
    // NO redirect URL (the mock gateway session has nowhere to redirect).
    expect(checkout.provider).toBe("Mock");
    expect(typeof checkout.providerReference).toBe("string");
    const providerReference: unknown = checkout.providerReference;
    if (typeof providerReference !== "string") {
      throw new Error("checkout descriptor carries no provider reference");
    }
    expect(providerReference.startsWith("mock_")).toBe(true);
    expect(checkout.checkoutUrl).toBeNull();

    // Exactly one pending subscription/payment/junction set was committed.
    const counts = await committedRowCounts(studentUser.id);
    expect(counts).toEqual({ subs: 1, payments: 1, junction: 1 });
  });
});

// ─── Section 3 — denial channels (pre-write) ─────────────────────────────────

describe("purchaseSubscription — denial channels leave the ledger untouched", () => {
  test("missing idempotency key → VALIDATION (the absent-header context shape)", async () => {
    // `idempotencyKey: null` is EXACTLY what the context factory materializes
    // when the X-Idempotency-Key header is absent.
    const result = await executePurchase(null, String(planId), studentUser);
    expectDomainDenial(result, "VALIDATION");
  });

  test("inactive plan → PLAN_NOT_FOUND (not purchasable)", async () => {
    const result = await executePurchase(KEY_INACTIVE, String(inactivePlanId), studentUser);
    expectDomainDenial(result, "PLAN_NOT_FOUND");
  });

  test("unknown plan id → PLAN_NOT_FOUND", async () => {
    const result = await executePurchase(KEY_UNKNOWN, "999999999", studentUser);
    expectDomainDenial(result, "PLAN_NOT_FOUND");
  });

  test("malformed plan id ('12abc') → PLAN_NOT_FOUND (strict id coercion, pre-DB)", async () => {
    // The wire ID rides verbatim as the raw string; the resolver boundary's
    // strict numeric parse turns the malformed shape into the canonical
    // plan-not-found denial before any database work.
    const result = await executePurchase(KEY_MALFORMED, "12abc", studentUser);
    expectDomainDenial(result, "PLAN_NOT_FOUND");
  });

  test("the denials burned no second row — the happy-path pair is intact", async () => {
    const counts = await committedRowCounts(studentUser.id);
    expect(counts).toEqual({ subs: 1, payments: 1, junction: 1 });
  });
});
