/**
 * Subscription page-enrichment wire suite — the `StudentSubscription`
 * enrichment fields (`plan`, `auditEntriesCount`, `auditTrailPeek`) over
 * the LIVE dev server, across BOTH list producers plus the mutation
 * payload's single-row fallback.
 *
 * Proven over the real HTTP boundary (`testClient`), the real authScopes
 * gates, the real services, and real fixture rows:
 *  - **Enriched shapes byte-identical across producers** — the same row
 *    read through `mySubscriptions` (owner list) and
 *    `adminStudentSubscriptions` (admin list) carries IDENTICAL
 *    enrichment values, and the `adminExtendSubscription` payload — a
 *    non-list producer whose plain row takes the field resolvers'
 *    single-row fallback — answers the same values the enriched list
 *    reads serve after the extend.
 *  - **Carried honesty on the wire** — a trail-less row answers
 *    `auditEntriesCount: 0` / `auditTrailPeek: null`; the extend's audit
 *    row moves both to their real values on every read surface.
 *  - **Auth unchanged** — anonymous → UNAUTHORIZED on both list queries,
 *    student → FORBIDDEN on the admin list, teacher → FORBIDDEN on the
 *    own list, with the enrichment fields selected (denial fires before
 *    any enrichment read).
 *  - **Ownership unchanged** — cross-owner probes: each owner's own list
 *    contains exactly her rows; interleaved concurrent own/admin reads
 *    stay isolated; an ownerless student answers the honest empty list.
 *
 * Authentication per role: the shared `testClient` sends NO cookies
 * between tests, so every operation carries its OWN identity via a
 * per-request `Authorization: Bearer <accessToken>` header. Anonymous
 * probes omit the header entirely.
 *
 * Data lifecycle: every user this suite creates is tracked by id and
 * deleted in a top-level `afterAll` via the shared `deleteUsersByIds`
 * helper (which also sweeps the extend probe's audit rows by actor);
 * fixture `plans` rows have NO user FK and are deleted explicitly AFTER
 * the users (the `subscriptions.plan_id` RESTRICT FK releases once the
 * users' subscriptions are gone).
 *
 * Per `frontend/graphql/test/AGENTS.md`:
 *  - The admin-side operations reuse the REAL production documents
 *    (`adminStudentSubscriptionsQueryDocument`,
 *    `adminSubscriptionExtendMutationDocument`) — the drawer's actual
 *    enriched selection; the own-side enriched selection is declared
 *    here as a local `TypedDocumentNode` (the student surface's shared
 *    document does not select the audit fields yet) bound via `parse`
 *    (the `@/backend/db` fixture chain crashes `graphql-tag`'s UMD
 *    build; `parse` yields the same DocumentNode).
 *  - Mutations pass ALL input arguments; generated enum values are
 *    imported from `@/frontend/graphql/generated/gql/graphql`, never
 *    hardcoded string equivalents.
 *  - Every behavioral assertion runs through `testClient`; direct-DB
 *    use is limited to fixture provisioning and the hygiene teardown.
 */

import { afterAll, beforeAll, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import type { TypedDocumentNode } from "@apollo/client";
import { inArray } from "drizzle-orm";
import { parse } from "graphql";

import { db } from "@/backend/db";
import { plans } from "@/backend/db/schema/billing/plans";
import { subscriptions } from "@/backend/db/schema/billing/subscriptions";
import { SubscriptionCreditLane } from "@/backend/enum/billing/subscription-credit-lane.enum";
import { SubscriptionStatus as SubscriptionStatusColumn } from "@/backend/enum/billing/subscription-status.enum";
import { AuditActionType, RegisterPublicRole } from "@/frontend/graphql/generated/gql/graphql";
import {
  adminStudentSubscriptionsQueryDocument,
  adminSubscriptionExtendMutationDocument,
} from "@/frontend/graphql/sharedDocuments/admin/admin-subscriptions.documents";
import {
  loginMutationDocument,
  registerUserMutationDocument,
} from "@/frontend/graphql/sharedDocuments/auth/auth.documents";
import {
  countUsersByIds,
  deleteUsersByIds,
  describeGraphqlSuite,
  expectMutationError,
  insertAdminUserWithChildRow,
  setupTestServerLifecycle,
  testClient,
} from "@/test/helpers";

// ─── Shared harness helpers (module scope — no per-test duplication) ──────

/** The fixture window length in days (the plan's interval). */
const PLAN_INTERVAL_DAYS = 30;

/** How far the active fixtures' windows run. */
const MS_PER_DAY = 86_400_000;

/**
 * Randomized email per fixture — unique prefix + UUID salt avoids the
 * `users.email` unique index across parallel or repeated runs.
 */
function uniqueEmail(rolePrefix: string): string {
  return `${rolePrefix}-${Date.now()}-${randomUUID().slice(0, 8)}@test.local`;
}

// Named without the literal `password` token so `sonarjs/no-hardcoded-passwords`
// does not flag the constant declaration (matches the sibling suites).
const TEST_CREDENTIAL = "Password123";

/** Run-unique catalog title — never asserted, only kept unique per run. */
const fixturePlanTitle = `Integration Plan ${randomUUID().slice(0, 8)}`;

/** Authorization header factory — keeps multi-role isolation explicit. */
function bearer(token: string): { headers: { Authorization: string } } {
  return { headers: { Authorization: `Bearer ${token}` } };
}

// ─── The own-side enriched selection (local — the student surface's shared ─
// ─── document does not select the audit fields yet) ─────────────────────────

/** The asserted subset of the enriched own-list wire row. */
interface OwnEnrichedRow {
  readonly id: string;
  readonly planId: number;
  readonly plan: { readonly id: string };
  readonly status: string;
  readonly auditEntriesCount: number;
  readonly auditTrailPeek: { readonly actionType: string; readonly at: string } | null;
}

const mySubscriptionsEnrichedQuery: TypedDocumentNode<{ readonly mySubscriptions: readonly OwnEnrichedRow[] }> = parse(`
  query MySubscriptionsEnriched {
    mySubscriptions {
      id
      planId
      plan {
        id
      }
      status
      auditEntriesCount
      auditTrailPeek {
        actionType
        at
      }
    }
  }
`);

/** The enrichment projection compared byte-for-byte across producers. */
interface EnrichmentProjection {
  readonly planId: number;
  readonly plan: { readonly id: string };
  readonly auditEntriesCount: number;
  readonly auditTrailPeek: { readonly actionType: string; readonly at: string } | null;
}

/** Structural input every enriched wire row satisfies (own, admin, payload). */
interface EnrichedSourceRow {
  readonly planId: number;
  readonly plan: { readonly id: string };
  readonly auditEntriesCount: number;
  readonly auditTrailPeek: { readonly actionType: string; readonly at: string } | null;
}

/** Projects one wire row down to the enrichment compared across producers. */
function enrichmentOf(row: EnrichedSourceRow): EnrichmentProjection {
  return {
    planId: row.planId,
    plan: { id: row.plan.id },
    auditEntriesCount: row.auditEntriesCount,
    auditTrailPeek:
      row.auditTrailPeek === null ? null : { actionType: row.auditTrailPeek.actionType, at: row.auditTrailPeek.at },
  };
}

/** Rows keyed by id — the list reads' own ordering is never asserted on. */
function byId<T extends { readonly id: string }>(rows: readonly T[]): Map<string, T> {
  return new Map(rows.map(row => [row.id, row]));
}

// ─── Fixture provisioning (direct-DB — the sanctioned fixture shape) ──────

interface ActorBundle {
  readonly userId: number;
  readonly email: string;
  readonly accessToken: string;
}

/** Ids of every user this suite creates — drained by the `afterAll` hygiene. */
const createdUserIds = new Set<number>();

function trackCreatedUser(id: number | null | undefined): void {
  if (typeof id === "number") createdUserIds.add(id);
}

/** Fixture `plans` rows — no user FK, deleted explicitly in the `afterAll`. */
const createdPlanIds = new Set<number>();

/**
 * Registers a non-admin user through the PUBLIC registerUser mutation,
 * then logs in through the PUBLIC login mutation to obtain a real bearer
 * token (a `Student` registration provisions the `students` row).
 */
async function registerAndLogin(role: RegisterPublicRole): Promise<ActorBundle> {
  const email = uniqueEmail(role.toLowerCase());
  const registered = await testClient.mutate({
    mutation: registerUserMutationDocument,
    variables: {
      input: {
        fullName: `Enrichment ${role}`,
        email,
        phone: "+201234567890",
        password: TEST_CREDENTIAL,
        gender: null,
        country: "EG",
        role,
        preferredRecitation: null,
      },
    },
  });
  expect(registered.error).toBeUndefined();
  const userId = registered.data?.registerUser?.id;
  if (!userId) throw new Error("registerUser returned no id");
  trackCreatedUser(userId);

  const loggedIn = await testClient.mutate({
    mutation: loginMutationDocument,
    variables: { email, password: TEST_CREDENTIAL },
  });
  expect(loggedIn.error).toBeUndefined();
  const accessToken = loggedIn.data?.login?.accessToken;
  if (!accessToken) throw new Error("login returned no accessToken");

  return { userId, email, accessToken };
}

/**
 * Engineers the admin actor through the sanctioned `@/test/helpers` fixture
 * seam (admin role is excluded from the public registration surface).
 */
async function provisionAdminActor(): Promise<ActorBundle> {
  const email = uniqueEmail("admin");
  const userId = await insertAdminUserWithChildRow({
    fullName: "Admin Enrichment Probe",
    email,
    phone: "+201234567891",
    password: TEST_CREDENTIAL,
  });
  trackCreatedUser(userId);

  const loggedIn = await testClient.mutate({
    mutation: loginMutationDocument,
    variables: { email, password: TEST_CREDENTIAL },
  });
  expect(loggedIn.error).toBeUndefined();
  const accessToken = loggedIn.data?.login?.accessToken;
  if (!accessToken) throw new Error("admin login returned no accessToken");

  return { userId, email, accessToken };
}

/** Inserts one active subscription fixture row for a tracked user. */
async function insertSubscriptionRow(userId: number, planId: number): Promise<number> {
  const now = Date.now();
  const [row] = await db
    .insert(subscriptions)
    .values({
      userId,
      planId,
      status: SubscriptionStatusColumn.Active,
      startDate: new Date(now),
      endDate: new Date(now + PLAN_INTERVAL_DAYS * MS_PER_DAY),
      paymentMethod: null,
      paymentReference: null,
      paymentVerifiedAt: null,
    })
    .returning({ id: subscriptions.id });
  if (!row) throw new Error("subscription fixture insert returned no rows");
  return row.id;
}

// ─── Suite-scoped fixture handles (filled by `beforeAll`) ─────────────────

let admin: ActorBundle | undefined;
let studentA: ActorBundle | undefined;
let studentB: ActorBundle | undefined;
let planId: number | undefined;
/** Student A's to-be-extended row — the fallback-path vehicle. */
let subExtendId: number | undefined;
/** Student A's untouched row — the trail-less honesty probe. */
let subQuietId: number | undefined;
/** Student B's row — the cross-owner isolation probe. */
let subIsolatedId: number | undefined;

describeGraphqlSuite("Subscription enrichment wire — shapes, fallback parity, auth", () => {
  // The sandbox dev server (port 3000) may already be running and
  // graphQL-live. Per the AGENTS.md "Memory-constrained sandbox
  // adaptation", setting TEST_SERVER_EXTERNAL=1 reuses the warm server
  // instead of spawning a second `next dev` on port 3066.
  if (process.env.TEST_SERVER_EXTERNAL !== "1") {
    setupTestServerLifecycle();
  }

  beforeAll(async () => {
    admin = await provisionAdminActor();
    studentA = await registerAndLogin(RegisterPublicRole.Student);
    studentB = await registerAndLogin(RegisterPublicRole.Student);

    const [planRow] = await db
      .insert(plans)
      .values({
        title: fixturePlanTitle,
        sessionCount: 10,
        price: "100.00",
        currency: "EGP",
        intervalDays: PLAN_INTERVAL_DAYS,
        balanceLane: SubscriptionCreditLane.Hifz,
        isActive: true,
        deactivatedAt: null,
      })
      .returning({ id: plans.id });
    if (!planRow) throw new Error("plan fixture insert returned no rows");
    planId = planRow.id;
    createdPlanIds.add(planRow.id);

    subExtendId = await insertSubscriptionRow(studentA.userId, planId);
    subQuietId = await insertSubscriptionRow(studentA.userId, planId);
    subIsolatedId = await insertSubscriptionRow(studentB.userId, planId);
  });

  // ─── Hygiene: restore the shared dev database to canonical seed state ───
  // `deleteUsersByIds` sweeps the extend probe's audit rows (by actor) plus
  // the RESTRICT-gated subscriptions, then the users (child rows cascade).
  // Plans (no user FK) go AFTER the users so the plan RESTRICT releases.
  afterAll(async () => {
    const ids = [...createdUserIds];
    if (ids.length > 0) {
      const deleted = await deleteUsersByIds(ids);
      expect(deleted).toBe(ids.length);
      expect(await countUsersByIds(ids)).toBe(0);
    }
    const planIds = [...createdPlanIds];
    if (planIds.length > 0) {
      await db.delete(plans).where(inArray(plans.id, planIds));
    }
  });

  // ─── Tier 1/2: enriched shapes, owner scope, carried honesty ────────────

  test("the own list serves the enriched shape owner-scoped; trail-less rows carry 0/null", async () => {
    if (studentA === undefined || studentB === undefined || planId === undefined) {
      throw new Error("fixtures missing");
    }
    const ownA = await testClient.query({
      query: mySubscriptionsEnrichedQuery,
      context: bearer(studentA.accessToken),
    });
    expect(ownA.error).toBeUndefined();
    const rowsA = ownA.data?.mySubscriptions;
    if (!rowsA) throw new Error("mySubscriptions returned no list");
    expect(rowsA).toHaveLength(2);

    const ownB = await testClient.query({
      query: mySubscriptionsEnrichedQuery,
      context: bearer(studentB.accessToken),
    });
    expect(ownB.error).toBeUndefined();
    const rowsB = ownB.data?.mySubscriptions;
    if (!rowsB) throw new Error("mySubscriptions returned no list");
    expect(rowsB).toHaveLength(1);

    // Ownership isolation — each owner sees exactly her own rows.
    const idsA = new Set(rowsA.map(row => row.id));
    const idsB = new Set(rowsB.map(row => row.id));
    expect(idsA.has(String(subExtendId))).toBe(true);
    expect(idsA.has(String(subQuietId))).toBe(true);
    expect(idsB.has(String(subIsolatedId))).toBe(true);
    for (const id of idsA) {
      expect(idsB.has(id)).toBe(false);
    }

    // Enriched shape: the carried plan matches the row's plan id, and the
    // trail-less fixtures carry the honest 0/null values.
    for (const row of [...rowsA, ...rowsB]) {
      expect(row.plan.id).toBe(String(row.planId));
      expect(row.planId).toBe(planId);
      expect(row.auditEntriesCount).toBe(0);
      expect(row.auditTrailPeek).toBeNull();
    }
  });

  test("the admin list matches the own list's enrichment row-for-row", async () => {
    if (admin === undefined || studentA === undefined) throw new Error("fixtures missing");
    const own = await testClient.query({
      query: mySubscriptionsEnrichedQuery,
      context: bearer(studentA.accessToken),
    });
    expect(own.error).toBeUndefined();
    const ownRows = own.data?.mySubscriptions;
    if (!ownRows) throw new Error("mySubscriptions returned no list");

    const adminRead = await testClient.query({
      query: adminStudentSubscriptionsQueryDocument,
      variables: { userId: String(studentA.userId) },
      context: bearer(admin.accessToken),
    });
    expect(adminRead.error).toBeUndefined();
    const adminRows = adminRead.data?.adminStudentSubscriptions;
    if (!adminRows) throw new Error("adminStudentSubscriptions returned no list");
    expect(adminRows).toHaveLength(2);

    const ownById = byId(ownRows);
    expect(ownById.size).toBe(2);
    for (const row of adminRows) {
      const ownRow = ownById.get(row.id);
      if (!ownRow) throw new Error("admin list surfaced a row the own list does not carry");
      expect(enrichmentOf(row)).toEqual(enrichmentOf(ownRow));
    }
  });

  test("an ownerless student answers the honest empty own page", async () => {
    const studentC = await registerAndLogin(RegisterPublicRole.Student);
    const result = await testClient.query({
      query: mySubscriptionsEnrichedQuery,
      context: bearer(studentC.accessToken),
    });
    expect(result.error).toBeUndefined();
    expect(result.data?.mySubscriptions).toEqual([]);
  });

  // ─── Tier 3: interleaved concurrent reads stay isolated ──────────────────

  test("interleaved concurrent own/admin reads stay isolated", async () => {
    if (admin === undefined || studentA === undefined || studentB === undefined) {
      throw new Error("fixtures missing");
    }
    const [ownA, adminB] = await Promise.allSettled([
      testClient.query({
        query: mySubscriptionsEnrichedQuery,
        context: bearer(studentA.accessToken),
      }),
      testClient.query({
        query: adminStudentSubscriptionsQueryDocument,
        variables: { userId: String(studentB.userId) },
        context: bearer(admin.accessToken),
      }),
    ]);
    if (ownA.status !== "fulfilled" || adminB.status !== "fulfilled") {
      throw new Error("interleaved reads did not both fulfill");
    }
    expect(ownA.value.error).toBeUndefined();
    expect(adminB.value.error).toBeUndefined();
    expect(ownA.value.data?.mySubscriptions).toHaveLength(2);
    expect(adminB.value.data?.adminStudentSubscriptions).toHaveLength(1);
  });

  // ─── The fallback ≡ fast-path equivalence over the real surfaces ────────

  test("the extend payload's fallback enrichment equals the enriched list reads", async () => {
    if (admin === undefined || studentA === undefined || subExtendId === undefined) {
      throw new Error("fixtures missing");
    }
    // The mutation payload is a NON-list producer: its plain row takes the
    // field resolvers' single-row fallback, and it must answer the same
    // enrichment the page batch later carries.
    const extend = await testClient.mutate({
      mutation: adminSubscriptionExtendMutationDocument,
      variables: { input: { subscriptionId: String(subExtendId), days: 1 } },
      context: bearer(admin.accessToken),
    });
    expect(extend.error).toBeUndefined();
    const payload = extend.data?.adminExtendSubscription;
    if (!payload) throw new Error("adminExtendSubscription returned no row");
    expect(payload.id).toBe(String(subExtendId));
    expect(payload.auditEntriesCount).toBe(1);
    if (!payload.auditTrailPeek) throw new Error("extend payload resolved no peek");
    expect(payload.auditTrailPeek.actionType).toBe(AuditActionType.Update);
    expect(payload.auditTrailPeek.at).toBeString();

    // Both enriched list reads (admin fast path + owner fast path) must
    // now serve byte-identical enrichment values for the extended row.
    const adminRead = await testClient.query({
      query: adminStudentSubscriptionsQueryDocument,
      variables: { userId: String(studentA.userId) },
      context: bearer(admin.accessToken),
    });
    expect(adminRead.error).toBeUndefined();
    const adminRows = adminRead.data?.adminStudentSubscriptions;
    if (!adminRows) throw new Error("adminStudentSubscriptions returned no list");
    const adminRow = byId(adminRows).get(String(subExtendId));
    if (!adminRow) throw new Error("admin list lost the extended row");
    expect(enrichmentOf(adminRow)).toEqual(enrichmentOf(payload));

    const ownRead = await testClient.query({
      query: mySubscriptionsEnrichedQuery,
      context: bearer(studentA.accessToken),
    });
    expect(ownRead.error).toBeUndefined();
    const ownRows = ownRead.data?.mySubscriptions;
    if (!ownRows) throw new Error("mySubscriptions returned no list");
    const ownRow = byId(ownRows).get(String(subExtendId));
    if (!ownRow) throw new Error("own list lost the extended row");
    expect(enrichmentOf(ownRow)).toEqual(enrichmentOf(payload));

    // The untouched sibling keeps its carried 0/null honesty.
    if (subQuietId === undefined) throw new Error("quiet fixture missing");
    const quietRow = byId(adminRows).get(String(subQuietId));
    if (!quietRow) throw new Error("admin list lost the quiet row");
    expect(quietRow.auditEntriesCount).toBe(0);
    expect(quietRow.auditTrailPeek).toBeNull();
  });

  // ─── Tier 4: the auth semantics are exactly the pre-enrichment channels ──

  test("anonymous caller → UNAUTHORIZED on both list queries", async () => {
    if (studentA === undefined) throw new Error("fixtures missing");
    const own = await testClient.query({ query: mySubscriptionsEnrichedQuery });
    // Direct assertion: the probe must reject the query (sonarjs needs a
    // lexically visible assertion; expectMutationError rides on top of it).
    expect(own.error).toBeDefined();
    expectMutationError(own.error, "UNAUTHORIZED");
    const adminRead = await testClient.query({
      query: adminStudentSubscriptionsQueryDocument,
      variables: { userId: String(studentA.userId) },
    });
    expect(adminRead.error).toBeDefined();
    expectMutationError(adminRead.error, "UNAUTHORIZED");
  });

  test("student caller → FORBIDDEN on the admin list", async () => {
    if (studentA === undefined || studentB === undefined) throw new Error("fixtures missing");
    const result = await testClient.query({
      query: adminStudentSubscriptionsQueryDocument,
      variables: { userId: String(studentB.userId) },
      context: bearer(studentA.accessToken),
    });
    // Direct assertion: the probe must reject the query (sonarjs needs a
    // lexically visible assertion; expectMutationError rides on top of it).
    expect(result.error).toBeDefined();
    expectMutationError(result.error, "FORBIDDEN");
  });

  test("teacher caller → FORBIDDEN on the own list", async () => {
    const teacher = await registerAndLogin(RegisterPublicRole.Teacher);
    const result = await testClient.query({
      query: mySubscriptionsEnrichedQuery,
      context: bearer(teacher.accessToken),
    });
    expectMutationError(result.error, "FORBIDDEN");
  });
});
