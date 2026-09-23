/**
 * Subscription-purchase GraphQL contract — idempotent-replay + ownership
 * isolation suite.
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
 * Pins the replay semantics of the student purchase and the owner-scoped read:
 *  - Same-key replay: the first purchase under a fixed key succeeds; the
 *    immediate same-caller retry surfaces the `DUPLICATE_REQUEST` conflict
 *    (409 channel — a replay THROWS, it never returns the first purchase's
 *    payload). The committed state proves the replay burned no second row:
 *    exactly ONE pending subscription, payment, junction, and idempotency
 *    claim survive, and the claim stays keyed verbatim and backfilled with
 *    the winning subscription's id.
 *  - Foreign-key replay: a second student replaying the FIRST student's
 *    spent key surfaces the oracle-safe payment-not-found 404 channel — the
 *    generic not-found denial, byte-identical to any ordinary unknown-resource
 *    answer, carrying no owner identifiers (no existence leak). The foreign
 *    caller writes nothing; the owner's pair is untouched.
 *  - `mySubscriptions` ownership isolation: the owner's list holds exactly
 *    the owner's subscription ids, a second student's list holds exactly
 *    their own (never the other caller's rows), and a fresh student sees the
 *    empty state.
 *
 * The idempotency key rides the context field exactly as the context factory
 * materializes it from the `X-Idempotency-Key` header (the header→context
 * transport mapping itself is pinned by the context factory suite) — the
 * replay semantics under test are the service's, reached through the same
 * resolver stack the HTTP boundary uses.
 *
 * Honest authorization substrate: real committed student actors, nothing
 * monkey-patched. Teardown hard-deletes every fixture row in FK-safe order.
 *
 * Run:
 *   bun run test/scripts/run-test.ts backend/graphql/test/subscription-purchase.replay.test.ts
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { eq, inArray } from "drizzle-orm";
import { graphql } from "graphql";
import { db } from "@/backend/db";
import { plans } from "@/backend/db/schema/billing/plans";
import { studentPayments } from "@/backend/db/schema/billing/student-payments";
import { studentSubscriptions } from "@/backend/db/schema/billing/student-subscriptions";
import { subscriptionPurchaseIdempotency } from "@/backend/db/schema/billing/subscription-purchase-idempotency";
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
const PREFIX = journeyPrefix("gqlsub-replay");

const KEY_REPLAY = `${PREFIX}-key-replay`;
const KEY_SECOND_STUDENT = `${PREFIX}-key-second`;

let studentA: UserSelectType;
let studentB: UserSelectType;
let studentC: UserSelectType;
let planId = 0;
let subscriptionAId = "";
let subscriptionBId = "";

// ─── Documents ───────────────────────────────────────────────────────────────

const PURCHASE_SOURCE = `
  mutation PurchaseSubscription($input: PurchaseSubscriptionInput!) {
    purchaseSubscription(input: $input) {
      subscription {
        id
        status
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

/** Extracts the nested subscription object of a purchase payload. */
function subscriptionOf(result: { readonly data?: unknown }): { readonly id: string; readonly status: string } {
  const payload = payloadOf(result, "purchaseSubscription");
  const subscription: unknown = payload.subscription;
  if (!isRecord(subscription) || typeof subscription.id !== "string" || typeof subscription.status !== "string") {
    throw new Error("purchase payload carries no subscription id/status pair");
  }
  return { id: subscription.id, status: subscription.status };
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

/** Committed pending-set counters for one student (the replay oracle). */
async function committedRowCounts(
  studentUserId: number
): Promise<{ subs: number; payments: number; junction: number; claims: number }> {
  const [subs, payments, junction, claims] = await Promise.all([
    db.$count(subscriptions, eq(subscriptions.userId, studentUserId)),
    db.$count(studentPayments, eq(studentPayments.studentId, studentUserId)),
    db.$count(studentSubscriptions, eq(studentSubscriptions.studentId, studentUserId)),
    db.$count(subscriptionPurchaseIdempotency, eq(subscriptionPurchaseIdempotency.userId, studentUserId)),
  ]);
  return { subs, payments, junction, claims };
}

/** Lists one student's committed subscription ids (ascending for stability). */
async function committedSubscriptionIds(studentUserId: number): Promise<number[]> {
  const rows = await db
    .select({ id: subscriptions.id })
    .from(subscriptions)
    .where(eq(subscriptions.userId, studentUserId));
  return rows.map(row => row.id).toSorted((a, b) => a - b);
}

// ─── Fixtures (committed cast: two purchasing students + one fresh reader) ──

beforeAll(async () => {
  await db.transaction(async tx => {
    studentA = await createTestUser(tx, { fullName: `${PREFIX} student-a` });
    await createTestStudent(tx, studentA.id);
    studentB = await createTestUser(tx, { fullName: `${PREFIX} student-b` });
    await createTestStudent(tx, studentB.id);
    studentC = await createTestUser(tx, { fullName: `${PREFIX} student-c` });
    await createTestStudent(tx, studentC.id);
    const plan = await createTestPlan(tx, { balanceLane: SubscriptionCreditLane.Hifz });
    planId = plan.id;
  });
});

afterAll(async () => {
  // FK-safe hard-delete of every fixture row. The payment-ledger rows are
  // un-deletable through their append-only guard, so that single leg runs
  // under the sanctioned teardown-window trigger suspension; with the ledger
  // leg resolved the rest deletes in strict child-first order (payments and
  // claims before subscriptions, so no set-null write fires against a
  // surviving parent row).
  const studentIds = [studentA.id, studentB.id, studentC.id];
  await withImmutabilityTriggersSuspended(["student_payments"], async () => {
    await db.delete(studentPayments).where(inArray(studentPayments.studentId, studentIds));
  });
  await db.delete(studentSubscriptions).where(inArray(studentSubscriptions.studentId, studentIds));
  await db.delete(subscriptionPurchaseIdempotency).where(inArray(subscriptionPurchaseIdempotency.userId, studentIds));
  await db.delete(subscriptions).where(inArray(subscriptions.userId, studentIds));
  await db.delete(plans).where(eq(plans.id, planId));
  await db.delete(students).where(inArray(students.id, studentIds));
  await db.delete(users).where(inArray(users.id, studentIds));

  // Load-bearing residue proof: the teardown must leave zero rows behind.
  const residueCounts = await Promise.all([
    db.$count(subscriptions, inArray(subscriptions.userId, studentIds)),
    db.$count(studentPayments, inArray(studentPayments.studentId, studentIds)),
    db.$count(studentSubscriptions, inArray(studentSubscriptions.studentId, studentIds)),
    db.$count(subscriptionPurchaseIdempotency, inArray(subscriptionPurchaseIdempotency.userId, studentIds)),
    db.$count(users, inArray(users.id, studentIds)),
  ]);
  for (const count of residueCounts) {
    expect(count).toBe(0);
  }
});

// ─── Section 1 — same-key replay: 409 conflict + exactly ONE pending set ─────

describe("purchaseSubscription — same-key replay", () => {
  test("first purchase under the fixed key commits ONE pending set", async () => {
    const first = await executePurchase(studentA, KEY_REPLAY);
    expect(first.errors).toBeUndefined();
    const won = subscriptionOf(first);
    expect(won.status).toBe("Pending");
    subscriptionAId = won.id;

    expect(await committedRowCounts(studentA.id)).toEqual({ subs: 1, payments: 1, junction: 1, claims: 1 });
  });

  test("immediate same-caller retry → DUPLICATE_REQUEST (a replay throws, never returns)", async () => {
    const second = await executePurchase(studentA, KEY_REPLAY);
    expectDomainDenial(second, "DUPLICATE_REQUEST");
  });

  test("the replay left exactly ONE set + ONE claim, backfilled with the winning id", async () => {
    expect(await committedRowCounts(studentA.id)).toEqual({ subs: 1, payments: 1, junction: 1, claims: 1 });

    const claims = await db
      .select({
        idempotencyKey: subscriptionPurchaseIdempotency.idempotencyKey,
        subscriptionId: subscriptionPurchaseIdempotency.subscriptionId,
      })
      .from(subscriptionPurchaseIdempotency)
      .where(eq(subscriptionPurchaseIdempotency.userId, studentA.id));
    expect(claims).toHaveLength(1);
    // The key is carried verbatim (never trimmed, never re-derived) and the
    // claim points at the FIRST purchase's subscription.
    expect(claims[0]?.idempotencyKey).toBe(KEY_REPLAY);
    expect(claims[0]?.subscriptionId).toBe(Number(subscriptionAId));
  });
});

// ─── Section 2 — foreign-key replay: oracle-safe 404, no existence leak ──────

describe("purchaseSubscription — foreign-key replay", () => {
  test("second student replaying the spent key → PAYMENT_NOT_FOUND (404 channel)", async () => {
    const result = await executePurchase(studentB, KEY_REPLAY);
    const { message } = expectDomainDenial(result, "PAYMENT_NOT_FOUND");

    // Oracle safety: the denial is the GENERIC not-found answer — byte-identical
    // to any ordinary unknown-resource response, carrying no owner identifiers.
    expect(message).toBe(getServerTranslations("en").errorsTranslations.notFound);
    expect(message).not.toContain(studentA.id.toString());
    expect(message).not.toContain(studentA.email);
  });

  test("the foreign caller wrote nothing and the owner's set is intact", async () => {
    expect(await committedRowCounts(studentB.id)).toEqual({ subs: 0, payments: 0, junction: 0, claims: 0 });
    expect(await committedRowCounts(studentA.id)).toEqual({ subs: 1, payments: 1, junction: 1, claims: 1 });
  });
});

// ─── Section 3 — mySubscriptions ownership isolation ─────────────────────────

describe("mySubscriptions — ownership isolation", () => {
  test("a fresh student sees the empty state", async () => {
    const result = await executeMySubscriptions(studentC);
    expect(result.errors).toBeUndefined();
    expect(listOf(result, "mySubscriptions")).toHaveLength(0);
  });

  test("each owner's list holds exactly their own rows — never the other caller's", async () => {
    // The second student completes their OWN purchase under their own key.
    const ownPurchase = await executePurchase(studentB, KEY_SECOND_STUDENT);
    expect(ownPurchase.errors).toBeUndefined();
    const wonB = subscriptionOf(ownPurchase);
    expect(wonB.status).toBe("Pending");
    subscriptionBId = wonB.id;

    const [listA, listB] = await Promise.all([executeMySubscriptions(studentA), executeMySubscriptions(studentB)]);
    expect(listA.errors).toBeUndefined();
    expect(listB.errors).toBeUndefined();

    // Caller A sees exactly A's subscription (one row, the replay set) —
    // B's id appears nowhere in it.
    const rowsA = listOf(listA, "mySubscriptions");
    expect(rowsA).toHaveLength(1);
    expect(rowsA[0]?.id).toBe(subscriptionAId);
    expect(rowsA[0]?.planId).toBe(planId);
    expect(rowsA[0]?.status).toBe("Pending");
    expect(rowsA.some(row => row.id === subscriptionBId)).toBe(false);

    // Caller B sees exactly B's own subscription — A's id appears nowhere.
    const rowsB = listOf(listB, "mySubscriptions");
    expect(rowsB).toHaveLength(1);
    expect(rowsB[0]?.id).toBe(subscriptionBId);
    expect(rowsB[0]?.planId).toBe(planId);
    expect(rowsB[0]?.status).toBe("Pending");
    expect(rowsB.some(row => row.id === subscriptionAId)).toBe(false);

    // The committed rows agree with the wire: one pending set per caller,
    // fully disjoint.
    const [idsA, idsB] = await Promise.all([
      committedSubscriptionIds(studentA.id),
      committedSubscriptionIds(studentB.id),
    ]);
    expect(idsA).toEqual([Number(subscriptionAId)]);
    expect(idsB).toEqual([Number(subscriptionBId)]);
  });

  test("a second owner-scoped read for the fresh student is still empty (no leakage)", async () => {
    const result = await executeMySubscriptions(studentC);
    expect(result.errors).toBeUndefined();
    const rows = listOf(result, "mySubscriptions");
    expect(rows).toHaveLength(0);
    expect(rows.some(row => row.id === subscriptionAId || row.id === subscriptionBId)).toBe(false);
  });

  test("a keyless read still resolves the owner's rows (key is transport metadata only)", async () => {
    // The idempotency key is propagation-only request metadata: a read that
    // carries no key resolves the caller's rows exactly like a keyed one.
    const result = await executeMySubscriptions(studentA);
    expect(result.errors).toBeUndefined();
    const rows = listOf(result, "mySubscriptions");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe(subscriptionAId);
  });
});
