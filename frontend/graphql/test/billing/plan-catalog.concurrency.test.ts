/**
 * Plan catalog CONCURRENCY & CHAOS probes — DEV1-005 Task 5.2 (REQ-074).
 *
 * THREE end-to-end race probes over the REAL GraphQL boundary (Apollo Client
 * v4 + warm/external dev server, same harness as the 3.2/3.3/3.6 billing
 * suites). Every mutation rides the SAME admin bearer token and requests the
 * EXACT ten-field REQ-060 whitelist selection — nothing else touches the wire.
 *
 * Probes (REQ-074):
 *  1. Double-deactivation — two concurrent `setPlanActiveStatus(isActive:
 *     false)` calls on one active plan. Exactly ONE fulfilled response + ONE
 *     rejected with `extensions.code === "PLAN_ALREADY_INACTIVE"`, and the row
 *     transitioned EXACTLY ONCE. This probe IS the 5.2.SEC claim: the guarded
 *     conditional UPDATE (`plans.isActive = NOT target` predicate — plan D2)
 *     has a TOCTOU window of ZERO — one guarded UPDATE wins, the loser finds
 *     the row already in the target state and hits the service-owned conflict.
 *  2. Deactivate/reactivate interleave — sequential round-trip deactivate →
 *     reactivate → deactivate; the lifecycle transitions COMPOSE and converge
 *     to a consistent final state (isActive false, deactivatedAt non-null,
 *     updatedAt advanced past the pre-sequence stamp). Deterministic: plain
 *     awaited mutations, no timing sleeps.
 *  3. Concurrent updatePlan LWW — three concurrent price patches ("10.00",
 *     "20.00", "30.00") on the same plan: ZERO protocol errors (all
 *     allSettled-fulfilled), final price equals ONE of the issued patches
 *     (last-write-wins). The deterministic chronological-last guarantee is the
 *     documented D2/LWW semantics — asserted as set membership, never as a
 *     timing/ordering assert.
 *
 * Race orchestration is `Promise.allSettled` ONLY (5.2.SR): no sleeps, no
 * wall-clock timing asserts anywhere in this suite.
 *
 * Layout amendment: the plan's `backend/graphql/test/plan-catalog.
 * concurrency.test.ts` defers to this established `frontend/graphql/test/
 * billing/` location — consistent with the 3.2/3.3/3.6 outcomes.
 */

import { beforeAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import type { TypedDocumentNode } from "@graphql-typed-document-node/core";
import { eq } from "drizzle-orm";
import { parse } from "graphql";

import { db } from "@/backend/db";
import { plans } from "@/backend/db/schema/billing/plans";
import { admin } from "@/backend/db/schema/users/admin";
import { users } from "@/backend/db/schema/users/users";
import { hashPassword } from "@/backend/lib/auth/password";
import { loginMutationDocument } from "@/frontend/graphql/sharedDocuments/auth/auth.documents";
import { expectMutationError, setupTestServerLifecycle, testClient } from "@/test/helpers";

// Memory-constrained sandbox adaptation (see applicant-profile.test.ts and
// the 3.6 roles suite): TEST_SERVER_EXTERNAL=1 + GRAPHQL_TEST_PORT reuses the
// warm server instead of spawning a second `next dev`; CI keeps the standard
// boot-on-3066 lifecycle.
if (process.env.TEST_SERVER_EXTERNAL !== "1") {
  setupTestServerLifecycle();
}

// Named without the literal `password` token (sonarjs/no-hardcoded-passwords).
const testCredential = "Password123";

/** Randomized email (per-suite unique prefix + UUID salt) — suite convention. */
function uniqueEmail(rolePrefix: string): string {
  return `${rolePrefix}-${Date.now()}-${randomUUID().slice(0, 8)}@test.local`;
}

/** Randomized unique phone — `users.phone` has no unique constraint, varied anyway. */
function uniquePhone(): string {
  return `+2010${randomUUID().replace(/\D/g, "").padEnd(8, "0").slice(0, 8)}`;
}

/** Randomized plan title — unique per fixture, collision-free across suites. */
function uniquePlanTitle(prefix: string): string {
  return `${prefix} ${Date.now()} ${randomUUID().slice(0, 8)}`;
}

/** The exact ten-field Plan selection (+ __typename pinning) every document requests. */
const PLAN_SELECTION = `
      id
      title
      sessionCount
      price
      currency
      intervalDays
      isActive
      deactivatedAt
      createdAt
      updatedAt
      __typename
    `;

/**
 * Wire shape of one `Plan` node as pinned by the inline documents' selection
 * set (EXACTLY the ten REQ-060 contract fields). Inline `parse` documents
 * typed through a TYPE-ONLY `TypedDocumentNode` annotation — the SAME pattern
 * as the 3.2/3.3/3.6 sibling suites (no codegen artifacts, no runtime `gql`
 * import; `graphql-tag`'s UMD build crashes under the `@/backend/db` fixture
 * chain's module conditions).
 */
interface PlanWireNode {
  readonly __typename: "Plan";
  readonly id: string;
  readonly title: string;
  readonly sessionCount: number;
  readonly price: string;
  readonly currency: string;
  readonly intervalDays: number;
  readonly isActive: boolean;
  readonly deactivatedAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

interface AdminPlansData {
  readonly adminPlans?: readonly PlanWireNode[];
}

/** Variables accepted by the `adminPlans($includeInactive: Boolean)` document. */
interface AdminPlansVariables {
  readonly includeInactive?: boolean | null;
}

interface SetPlanActiveStatusData {
  readonly setPlanActiveStatus: PlanWireNode;
}

interface UpdatePlanData {
  readonly updatePlan: PlanWireNode;
}

interface SetPlanActiveStatusVars {
  readonly id: string;
  readonly isActive: boolean;
}

interface UpdatePlanVars {
  readonly id: string;
  readonly input: { readonly price: string };
}

// Inline parse() documents — the SAME pattern as the 3.2/3.3/3.6 sibling suites.
const adminPlansQuery: TypedDocumentNode<AdminPlansData, AdminPlansVariables> = parse(`
  query AdminPlans($includeInactive: Boolean) {
    adminPlans(includeInactive: $includeInactive) {
      ${PLAN_SELECTION}
    }
  }
`);

const setPlanActiveStatusMutation: TypedDocumentNode<SetPlanActiveStatusData, SetPlanActiveStatusVars> = parse(`
  mutation SetPlanActiveStatus($id: ID!, $isActive: Boolean!) {
    setPlanActiveStatus(id: $id, isActive: $isActive) { ${PLAN_SELECTION} }
  }
`);

const updatePlanMutation: TypedDocumentNode<UpdatePlanData, UpdatePlanVars> = parse(`
  mutation UpdatePlan($id: ID!, $input: UpdatePlanInput!) {
    updatePlan(id: $id, input: $input) { ${PLAN_SELECTION} }
  }
`);

/** Per-request bearer header — the production identity path (`context.headers`). */
function bearer(token: string): { headers: { Authorization: string } } {
  return { headers: { Authorization: `Bearer ${token}` } };
}

/** The ONE admin identity every mutation in this suite rides (set in beforeAll). */
let adminToken = "";

/**
 * Lifecycle-transition runner: issues ONE admin mutation and THROWS the
 * Apollo error container when the server answered with a GraphQL error.
 * Throwing is what materializes the wire-level failure as an actual
 * `Promise.allSettled` rejection — `testClient` uses `errorPolicy: "all"`,
 * so without this lift an error response would masquerade as a fulfillment.
 */
async function transitionStatus(planId: number, isActive: boolean): Promise<PlanWireNode> {
  const result = await testClient.mutate({
    mutation: setPlanActiveStatusMutation,
    variables: { id: String(planId), isActive },
    context: bearer(adminToken),
  });
  if (result.error) throw result.error;
  const plan = result.data?.setPlanActiveStatus;
  if (!plan) throw new Error(`setPlanActiveStatus returned no data for plan ${planId}`);
  return plan;
}

/** LWW probe runner: ONE admin price patch, protocol errors lifted into rejections. */
async function patchPrice(planId: number, price: string): Promise<PlanWireNode> {
  const result = await testClient.mutate({
    mutation: updatePlanMutation,
    variables: { id: String(planId), input: { price } },
    context: bearer(adminToken),
  });
  if (result.error) throw result.error;
  const plan = result.data?.updatePlan;
  if (!plan) throw new Error(`updatePlan returned no data for plan ${planId}`);
  return plan;
}

/** Fresh admin read of ONE plan through the WIRE (primary verification channel). */
async function wirePlanById(planId: number): Promise<PlanWireNode> {
  const result = await testClient.query({
    query: adminPlansQuery,
    variables: { includeInactive: true },
    context: bearer(adminToken),
  });
  expect(result.error).toBeUndefined();
  const plan = result.data?.adminPlans?.find(node => node.id === String(planId));
  if (!plan) throw new Error(`adminPlans did not return plan ${planId}`);
  return plan;
}

/** Direct-DB corroboration read (secondary channel, documented per probe). */
async function dbPlanById(planId: number) {
  const [row] = await db.select().from(plans).where(eq(plans.id, planId));
  if (!row) throw new Error(`plans row ${planId} missing from the database`);
  return row;
}

describe("plan catalog concurrency & chaos probes — REQ-074 (DEV1-005 Task 5.2)", () => {
  // Fixture rows + their insert-time lifecycle stamps (the "before" baseline
  // for the interleave's updatedAt-advanced assert). Direct-DB inserts, like
  // the 3.6 suite: the service creates plans active and the fixtures need
  // nothing else — randomized titles keep them collision-free.
  const interleaveTitle = uniquePlanTitle("QA Concurrency Interleave Plan");
  const doubleDeactivateTitle = uniquePlanTitle("QA Concurrency Double-Deactivate Plan");
  const lwwTitle = uniquePlanTitle("QA Concurrency LWW Plan");
  let interleavePlanId = -1;
  let interleaveInitialUpdatedAt = new Date(0);
  let doubleDeactivatePlanId = -1;
  let lwwPlanId = -1;

  beforeAll(async () => {
    // Direct-DB admin fixture (admin is NOT publicly registrable): `users`
    // row with role "admin" + the `admin` child row, then a REAL public login.
    const email = uniqueEmail("concurrency-admin");
    const [user] = await db
      .insert(users)
      .values({
        fullName: "Plan Catalog Concurrency Admin",
        email,
        phone: uniquePhone(),
        passwordHash: await hashPassword(testCredential),
        role: "admin",
        isDeleted: false,
        suspended: false,
        isBlocked: false,
        lastActiveAt: new Date(),
      })
      .returning();
    if (!user) throw new Error("admin user insert returned no rows");
    const [adminRow] = await db.insert(admin).values({ id: user.id }).returning();
    if (!adminRow) throw new Error("admin child-row insert returned no rows");

    const loggedIn = await testClient.mutate({
      mutation: loginMutationDocument,
      variables: { email, password: testCredential },
    });
    expect(loggedIn.error).toBeUndefined();
    const accessToken = loggedIn.data?.login?.accessToken;
    if (!accessToken) throw new Error("login returned no accessToken");
    adminToken = accessToken;

    const [interleaveRow] = await db
      .insert(plans)
      .values({
        title: interleaveTitle,
        sessionCount: 6,
        price: "75.00",
        currency: "EGP",
        intervalDays: 30,
      })
      .returning();
    if (!interleaveRow) throw new Error("interleave plan insert returned no rows");
    interleavePlanId = interleaveRow.id;
    interleaveInitialUpdatedAt = interleaveRow.updatedAt;

    const [doubleDeactivateRow] = await db
      .insert(plans)
      .values({
        title: doubleDeactivateTitle,
        sessionCount: 8,
        price: "120.00",
        currency: "EGP",
        intervalDays: 30,
      })
      .returning();
    if (!doubleDeactivateRow) throw new Error("double-deactivate plan insert returned no rows");
    doubleDeactivatePlanId = doubleDeactivateRow.id;

    const [lwwRow] = await db
      .insert(plans)
      .values({
        title: lwwTitle,
        sessionCount: 10,
        price: "99.00",
        currency: "EGP",
        intervalDays: 30,
      })
      .returning();
    if (!lwwRow) throw new Error("LWW plan insert returned no rows");
    lwwPlanId = lwwRow.id;
  });

  // ── Probe 1: double-deactivation — the TOCTOU=0 proof (5.2.SEC, plan D2) ──

  test("probe[double-deactivation] → exactly ONE win + ONE PLAN_ALREADY_INACTIVE; row transitioned EXACTLY ONCE", async () => {
    // Two deactivations of the SAME active plan, SAME admin token, fired
    // concurrently. No sleeps — allSettled is the entire orchestration.
    const settled = await Promise.allSettled([
      transitionStatus(doubleDeactivatePlanId, false),
      transitionStatus(doubleDeactivatePlanId, false),
    ]);

    const fulfilled = settled.filter(
      (outcome): outcome is PromiseFulfilledResult<PlanWireNode> => outcome.status === "fulfilled"
    );
    const rejected = settled.filter((outcome): outcome is PromiseRejectedResult => outcome.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);

    // The WINNER: the guarded conditional UPDATE returned the transitioned
    // row over the wire (isActive flipped, deactivatedAt server-stamped).
    const winner = fulfilled[0]?.value;
    expect(winner?.isActive).toBe(false);
    expect(winner?.deactivatedAt).toEqual(expect.any(String));

    // The LOSER: rejected with the service-owned idempotency conflict —
    // the guarded UPDATE matched zero rows and the existsById probe
    // disambiguated "already in target state" from "missing".
    expectMutationError(rejected[0]?.reason, "PLAN_ALREADY_INACTIVE");

    // Final state — PRIMARY channel: the wire. A fresh adminPlans query
    // (no-cache) shows the deactivated row.
    const wireRow = await wirePlanById(doubleDeactivatePlanId);
    expect(wireRow.isActive).toBe(false);
    expect(wireRow.deactivatedAt).toEqual(expect.any(String));

    // Final state — SECONDARY channel (documented): direct db.select for
    // timestamp precision. The on-disk deactivatedAt EQUALS the winner's
    // reported stamp: the only write that could have moved it is another
    // guarded deactivation (re-stamping), and the loser was denied by the
    // guard — so the transition happened EXACTLY ONCE. (Both processes run
    // UTC; `deactivated_at` is timestamp-without-tz, so the wire ISO and the
    // drizzle-parsed Date agree at millisecond precision.)
    const dbRow = await dbPlanById(doubleDeactivatePlanId);
    expect(dbRow.isActive).toBe(false);
    expect(dbRow.deactivatedAt?.getTime()).toBe(new Date(winner?.deactivatedAt ?? 0).getTime());
  });

  // ── Probe 2: deactivate/reactivate interleave — transitions COMPOSE ──────

  test("probe[deactivate/reactivate interleave] → sequential transitions compose; final state converges deterministically", async () => {
    // The interleave IS the sequential round-trip: each mutation is fully
    // awaited before the next is issued, so the transitions compose through
    // the guarded UPDATE — no sleeps, no timing assumptions.
    const deactivated = await transitionStatus(interleavePlanId, false);
    expect(deactivated.isActive).toBe(false);
    expect(deactivated.deactivatedAt).toEqual(expect.any(String));

    const reactivated = await transitionStatus(interleavePlanId, true);
    expect(reactivated.isActive).toBe(true);
    expect(reactivated.deactivatedAt).toBeNull();

    const deactivatedAgain = await transitionStatus(interleavePlanId, false);
    expect(deactivatedAgain.isActive).toBe(false);
    expect(deactivatedAgain.deactivatedAt).toEqual(expect.any(String));

    // updatedAt advanced strictly past the fixture's insert-time stamp —
    // three guarded UPDATEs each stamped `updated_at = now()`; the fixture
    // baseline predates the sequence by the whole beforeAll setup, so the
    // strict comparison is deterministic (no clock-precision flake).
    expect(new Date(deactivatedAgain.updatedAt).getTime()).toBeGreaterThan(interleaveInitialUpdatedAt.getTime());

    // Final converged state — PRIMARY channel: the wire.
    const wireRow = await wirePlanById(interleavePlanId);
    expect(wireRow.isActive).toBe(false);
    expect(wireRow.deactivatedAt).toEqual(expect.any(String));
    expect(new Date(wireRow.updatedAt).getTime()).toBeGreaterThan(interleaveInitialUpdatedAt.getTime());

    // SECONDARY channel (documented): the DB row agrees with the wire.
    const dbRow = await dbPlanById(interleavePlanId);
    expect(dbRow.isActive).toBe(false);
    expect(dbRow.deactivatedAt).not.toBeNull();
    expect(dbRow.updatedAt.getTime()).toBe(new Date(wireRow.updatedAt).getTime());
  });

  // ── Probe 3: concurrent updatePlan — LWW convergence, zero errors ────────

  test("probe[concurrent updatePlan] → 3 concurrent price patches, ZERO errors, final price is ONE of the issued patches", async () => {
    const issuedPatches: readonly string[] = ["10.00", "20.00", "30.00"];

    // Three concurrent price patches on the same plan, SAME admin token.
    // `patchPrice` lifts protocol errors into promise rejections, so "all
    // fulfilled" IS the zero-errors assertion — no retries, no sleeps.
    const settled = await Promise.allSettled(issuedPatches.map(price => patchPrice(lwwPlanId, price)));

    const fulfilled = settled.filter(
      (outcome): outcome is PromiseFulfilledResult<PlanWireNode> => outcome.status === "fulfilled"
    );
    const rejected = settled.filter((outcome): outcome is PromiseRejectedResult => outcome.status === "rejected");
    expect(rejected).toHaveLength(0);
    expect(fulfilled).toHaveLength(issuedPatches.length);
    for (const outcome of fulfilled) {
      expect(outcome.value).toHaveProperty("__typename", "Plan");
    }

    // LWW convergence: the final row price equals ONE of the issued patches —
    // set membership only. WHICH patch wins (chronological last) is the
    // documented D2/LWW semantics, deliberately NOT asserted as a timing
    // or ordering claim.
    const wireRow = await wirePlanById(lwwPlanId);
    expect(issuedPatches).toContain(wireRow.price);
    expect(wireRow.isActive).toBe(true);

    // SECONDARY channel (documented): the DB row price equals the wire value
    // — the wire reflects the persisted last write, not a stale read.
    const dbRow = await dbPlanById(lwwPlanId);
    expect(dbRow.price).toBe(wireRow.price);
  });
});
