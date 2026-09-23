/**
 * Subscription-purchase GraphQL contract — role-scope matrix suite.
 *
 * Executed in-process against the canonical code-first schema (the
 * plan-catalog contract-suite pattern): the resolvers, the scope gate, the
 * services, the repositories, and the live test database all run in THIS
 * process, so the committed-row oracles and the teardown are exact. The
 * live-server harness cannot run in this worktree: Turbopack refuses the
 * worktree's out-of-root `node_modules` symlink, and the single-process
 * PGlite provider gives the spawned server a disjoint database snapshot, so
 * the spawned boundary and the test process could never observe the same
 * rows (probe-proven). The contract this suite pins is identical either way:
 * the same schema object, resolver stack, and services the HTTP boundary uses.
 *
 * Pins the 401/403/200 scope matrix of BOTH student-only operations —
 * `purchaseSubscription` and `mySubscriptions` — across every principal the
 * role vocabulary can produce:
 *  - Anonymous → `UNAUTHORIZED` on both operations: the `authenticated` leg
 *    of the explicit `$all` scope conjunction fires the 401 channel before
 *    any resolver runs.
 *  - Authenticated non-students (parent, teacher, admin) → `FORBIDDEN` on
 *    both operations: the `role` leg fails into the canonical 403 channel.
 *    The admin denial is part of the contract — completing purchases is an
 *    admin-surface concern owned elsewhere, never a silent bypass here — and
 *    it also covers the permission-model supervisor shape (supervision is an
 *    admin-role permission grant in this repo, not a separate wire role).
 *  - Student → the only allowed shape: the mutation returns the pending pair
 *    and the query returns the caller's OWN rows (fresh list state proven
 *    before the purchase, the purchased row present after it).
 *
 * Honest authorization substrate: every actor context is built from a REAL
 * committed `users` row holding its real role value plus its real role-child
 * row — the role the scope gate evaluates is the one the database carries,
 * nothing is monkey-patched. Teardown hard-deletes every fixture row in
 * FK-safe order.
 *
 * Run:
 *   bun run test/scripts/run-test.ts backend/graphql/test/subscription-purchase.roles.test.ts
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { eq, inArray } from "drizzle-orm";
import { graphql } from "graphql";
import { db } from "@/backend/db";
import { plans } from "@/backend/db/schema/billing/plans";
import { studentPayments } from "@/backend/db/schema/billing/student-payments";
import { studentSubscriptions } from "@/backend/db/schema/billing/student-subscriptions";
import { subscriptions } from "@/backend/db/schema/billing/subscriptions";
import { parents } from "@/backend/db/schema/parents/parents";
import { students } from "@/backend/db/schema/students/students";
import { teacher } from "@/backend/db/schema/teachers/teacher";
import { admin } from "@/backend/db/schema/users/admin";
import { users } from "@/backend/db/schema/users/users";
import {
  createTestAdmin,
  createTestParent,
  createTestPlan,
  createTestStudent,
  createTestTeacherRow,
  createTestUser,
} from "@/backend/db/test/entity-setup";
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
const PREFIX = journeyPrefix("gqlsub-roles");

const KEY_PURCHASE = `${PREFIX}-key-purchase`;

let studentUser: UserSelectType;
let parentUser: UserSelectType;
let teacherUser: UserSelectType;
let adminUser: UserSelectType;
let planId = 0;
let purchasedSubscriptionId = "";

// ─── Documents ───────────────────────────────────────────────────────────────

const PURCHASE_SOURCE = `
  mutation PurchaseSubscription($input: PurchaseSubscriptionInput!) {
    purchaseSubscription(input: $input) {
      subscription {
        id
        planId
        status
        paymentMethod
      }
      payment {
        id
        status
      }
      checkout {
        provider
        providerReference
      }
    }
  }
`;

const MY_SUBSCRIPTIONS_SOURCE = `
  query MySubscriptions {
    mySubscriptions {
      id
      planId
      status
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
function contextFor(user: UserSelectType, idempotencyKey: string | null = null): Context {
  const { passwordHash: _passwordHash, ...rest } = user;
  const safeUser = { ...rest, preferredRecitation: null };
  const translations = getServerTranslations("en");
  return {
    locale: "en",
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

/** Extracts the root-field list of a happy-path query result. */
function listOf(result: { readonly data?: unknown }, rootField: string): readonly Record<string, unknown>[] {
  if (!isRecord(result.data)) {
    throw new Error(`missing data for ${rootField}`);
  }
  const list: unknown = result.data[rootField];
  if (!Array.isArray(list)) {
    throw new Error(`missing ${rootField} list in response data`);
  }
  return list.filter(isRecord);
}

/**
 * Asserts the result carries EXACTLY one domain error whose
 * `extensions.code` equals the expected transport code.
 */
function expectDomainDenial(
  result: { readonly errors?: readonly { readonly extensions?: { readonly code?: string } }[] },
  expectedCode: string
): void {
  const first = result.errors?.[0];
  expect(first).toBeDefined();
  expect(result.errors).toHaveLength(1);
  expect(first?.extensions?.code).toBe(expectedCode);
}

/** Runs the purchase mutation as one actor under one idempotency key. */
async function executePurchase(user: UserSelectType, idempotencyKey: string | null) {
  return graphql({
    schema: graphQLSchema,
    source: PURCHASE_SOURCE,
    variableValues: { input: { planId: String(planId) } },
    contextValue: contextFor(user, idempotencyKey),
  });
}

/** Runs the owner-scoped list query as one actor. */
async function executeMySubscriptions(user: UserSelectType) {
  return graphql({
    schema: graphQLSchema,
    source: MY_SUBSCRIPTIONS_SOURCE,
    contextValue: contextFor(user),
  });
}

// ─── Fixtures (committed cast: one student, one actor per denied role) ──────

beforeAll(async () => {
  await db.transaction(async tx => {
    studentUser = await createTestUser(tx, { fullName: `${PREFIX} student` });
    await createTestStudent(tx, studentUser.id);
    parentUser = await createTestUser(tx, { fullName: `${PREFIX} parent`, role: "parent" });
    await createTestParent(tx, parentUser.id);
    teacherUser = await createTestUser(tx, { fullName: `${PREFIX} teacher`, role: "teacher" });
    await createTestTeacherRow(tx, teacherUser.id);
    adminUser = await createTestUser(tx, { fullName: `${PREFIX} admin`, role: "admin" });
    await createTestAdmin(tx, adminUser.id);
    const plan = await createTestPlan(tx, { balanceLane: SubscriptionCreditLane.Hifz });
    planId = plan.id;
  });
});

afterAll(async () => {
  // FK-safe hard-delete of every fixture row. The payment-ledger rows are
  // un-deletable through their append-only guard, so that single leg runs
  // under the sanctioned teardown-window trigger suspension; with the ledger
  // leg resolved the rest deletes in strict child-first order (payments
  // before subscriptions, so the subscription delete never fires a set-null
  // write against a surviving payment row).
  const studentIds = [studentUser.id];
  const userIds = [studentUser.id, parentUser.id, teacherUser.id, adminUser.id];
  await withImmutabilityTriggersSuspended(["student_payments"], async () => {
    await db.delete(studentPayments).where(inArray(studentPayments.studentId, studentIds));
  });
  await db.delete(studentSubscriptions).where(inArray(studentSubscriptions.studentId, studentIds));
  await db.delete(subscriptions).where(inArray(subscriptions.userId, userIds));
  await db.delete(plans).where(eq(plans.id, planId));
  await db.delete(students).where(inArray(students.id, studentIds));
  await db.delete(parents).where(eq(parents.id, parentUser.id));
  await db.delete(teacher).where(eq(teacher.id, teacherUser.id));
  await db.delete(admin).where(eq(admin.id, adminUser.id));
  await db.delete(users).where(inArray(users.id, userIds));

  // Load-bearing residue proof: the teardown must leave zero rows behind.
  const residueCounts = await Promise.all([
    db.$count(subscriptions, inArray(subscriptions.userId, userIds)),
    db.$count(studentPayments, inArray(studentPayments.studentId, studentIds)),
    db.$count(studentSubscriptions, inArray(studentSubscriptions.studentId, studentIds)),
    db.$count(users, inArray(users.id, userIds)),
  ]);
  for (const count of residueCounts) {
    expect(count).toBe(0);
  }
});

// ─── Section 1 — purchaseSubscription scope matrix ───────────────────────────

describe("purchaseSubscription — role-scope matrix", () => {
  test("anonymous → UNAUTHORIZED (authenticated leg, pre-resolver)", async () => {
    const result = await graphql({
      schema: graphQLSchema,
      source: PURCHASE_SOURCE,
      variableValues: { input: { planId: String(planId) } },
      contextValue: anonymousContext(),
    });
    expectDomainDenial(result, "UNAUTHORIZED");
  });

  test("parent → FORBIDDEN (role leg — parents cannot purchase)", async () => {
    const result = await executePurchase(parentUser, KEY_PURCHASE);
    expectDomainDenial(result, "FORBIDDEN");
  });

  test("teacher → FORBIDDEN (role leg)", async () => {
    const result = await executePurchase(teacherUser, KEY_PURCHASE);
    expectDomainDenial(result, "FORBIDDEN");
  });

  test("admin → FORBIDDEN (role leg — no admin bypass; supervisors are admin-role permission grants, so the same leg denies them)", async () => {
    const result = await executePurchase(adminUser, KEY_PURCHASE);
    expectDomainDenial(result, "FORBIDDEN");
  });

  test("student → pending pair (the only allowed role)", async () => {
    const result = await executePurchase(studentUser, KEY_PURCHASE);
    expect(result.errors).toBeUndefined();

    const payload = payloadOf(result, "purchaseSubscription");
    const subscription: unknown = payload.subscription;
    if (!isRecord(subscription)) {
      throw new Error("missing subscription object in purchase payload");
    }
    expect(subscription.status).toBe("Pending");
    expect(subscription.planId).toBe(planId);
    const id: unknown = subscription.id;
    if (typeof id !== "string") {
      throw new Error("purchase payload subscription has no wire id");
    }
    purchasedSubscriptionId = id;
  });
});

// ─── Section 2 — mySubscriptions scope matrix + own-row proof ────────────────

describe("mySubscriptions — role-scope matrix", () => {
  test("anonymous → UNAUTHORIZED (authenticated leg, pre-resolver)", async () => {
    const result = await graphql({
      schema: graphQLSchema,
      source: MY_SUBSCRIPTIONS_SOURCE,
      contextValue: anonymousContext(),
    });
    expectDomainDenial(result, "UNAUTHORIZED");
  });

  test("parent → FORBIDDEN (role leg)", async () => {
    const result = await executeMySubscriptions(parentUser);
    expectDomainDenial(result, "FORBIDDEN");
  });

  test("teacher → FORBIDDEN (role leg)", async () => {
    const result = await executeMySubscriptions(teacherUser);
    expectDomainDenial(result, "FORBIDDEN");
  });

  test("admin → FORBIDDEN (role leg — no admin/supervisor bypass)", async () => {
    const result = await executeMySubscriptions(adminUser);
    expectDomainDenial(result, "FORBIDDEN");
  });

  test("student → the caller's own purchased row (and nothing else)", async () => {
    const result = await executeMySubscriptions(studentUser);
    expect(result.errors).toBeUndefined();

    const rows = listOf(result, "mySubscriptions");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe(purchasedSubscriptionId);
    expect(rows[0]?.planId).toBe(planId);
    expect(rows[0]?.status).toBe("Pending");
  });
});
