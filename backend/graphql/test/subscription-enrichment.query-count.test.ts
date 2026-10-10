/**
 * Subscription page-enrichment N+1 oracle — the `StudentSubscription`
 * list queries' query-count regression lock plus the field resolvers'
 * branch lock.
 *
 * In-process execution against the REAL schema + REAL GraphQL context +
 * REAL services + REAL PostgreSQL, with a pg-level spy counting every SQL
 * statement per operation as the page size grows (the same counting
 * mechanism as the sibling `query-count-regression.test.ts` oracle —
 * `spyOn(pg.Client.prototype, "query")`, which sees every pooled and
 * transaction round trip because pg's `Pool` borrows a `Client` per
 * query and delegates to that client's `query` method).
 *
 * What it locks:
 *  - **K-bound**: `mySubscriptions` and `adminStudentSubscriptions`, with
 *    the enrichment fields (`plan`, `auditEntriesCount`, `auditTrailPeek`)
 *    selected, each issue ≤ 6 SQL statements per page at EVERY page size
 *    {1, 25, 100} — a page-size-independent constant (the list producers
 *    enrich the page in one batch pass and the field resolvers read the
 *    carried values; per-row growth fails the constancy assertion).
 *  - **Fast path / no double-call**: an enriched page resolves its three
 *    enrichment fields with ZERO single-row service reads.
 *  - **Fallback path**: a producer row that arrives WITHOUT the carried
 *    keys (the real `adminExtendSubscription` payload — a mutation, not a
 *    list producer) takes exactly ONE single-row read per enrichment
 *    field and still answers the same values the list read serves.
 *  - **Carried-null honesty**: a trail-less enriched page answers
 *    `auditEntriesCount: 0` / `auditTrailPeek: null` from the carried
 *    values without re-reading; a hostile truncated batch carrying
 *    `plan: null` surfaces the localized plan-not-found denial without a
 *    silent re-read.
 *  - **Auth semantics unchanged**: anonymous → UNAUTHORIZED, non-admin →
 *    FORBIDDEN on the admin list, non-student → FORBIDDEN on the own
 *    list — the exact pre-enrichment denial channels.
 *
 * Fixture strategy: three student owners holding 1 / 25 / 100
 * subscription rows (the page-size axis is the owner's row count — the
 * list queries take no pagination arguments), one plan pair the rows
 * alternate between, one admin actor, one teacher probe — all direct
 * inserts, torn down in `afterAll` (audit rows written by the extend
 * probe first, with the immutability triggers suspended exactly like the
 * shared cleanup helper does; then rows → child rows → users → plans).
 *
 * Mandated runner: bun run test:graphql backend/graphql/test/subscription-enrichment.query-count.test.ts
 */

import { afterAll, afterEach, beforeAll, describe, expect, spyOn, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { type ExecutionResult, graphql } from "graphql";
import { Client } from "pg";
import { db } from "@/backend/db";
import { auditLogs } from "@/backend/db/schema/audit/audit-logs";
import { plans } from "@/backend/db/schema/billing/plans";
import { subscriptions } from "@/backend/db/schema/billing/subscriptions";
import { students } from "@/backend/db/schema/students/students";
import { users } from "@/backend/db/schema/users/users";
import { AuditActionType } from "@/backend/enum/audit/audit-action-type.enum";
import { SubscriptionCreditLane } from "@/backend/enum/billing/subscription-credit-lane.enum";
import { SubscriptionStatus as SubscriptionStatusColumn } from "@/backend/enum/billing/subscription-status.enum";
import { UserRole } from "@/backend/enum/users/user-role.enum";
import { type Context, createGraphQLContext } from "@/backend/graphql/gqlContextFactory";
import { graphQLSchema } from "@/backend/graphql/gqlSchema";
import { signAccessToken } from "@/backend/lib/auth/jwt";
import { hashPassword } from "@/backend/lib/auth/password";
import { PlanCatalogService } from "@/backend/services/billing/plan-catalog.service";
import { SUBSCRIPTION_AUDIT_ENTITY_TYPE } from "@/backend/services/billing/subscription-admin.helpers";
import { SubscriptionAdminService } from "@/backend/services/billing/subscription-admin.service";
import { SubscriptionPurchaseService } from "@/backend/services/billing/subscription-purchase.service";
import { withAuditDeleteTriggersSuspended } from "@/test/helpers/db-cleanup";

/** The page-size-independent statement budget per list page (the plan's K). */
const K_MAX_STATEMENTS = 6;

/** Page sizes the oracle sweeps — the owner's row count on the wire. */
const PAGE_SIZES: readonly number[] = [1, 25, 100];

/** One day in milliseconds — the fixture window length. */
const MS_PER_DAY = 86_400_000;
const PLAN_INTERVAL_DAYS = 30;

// ─── Wire documents (in-process execution — plain GraphQL sources) ─────────

const ENRICHED_ROW_FIELDS = `
      id
      planId
      plan { id }
      status
      auditEntriesCount
      auditTrailPeek { actionType at }
`;

const OWN_DOCUMENT = `
  query SubscriptionEnrichmentOwn {
    mySubscriptions {
      ${ENRICHED_ROW_FIELDS}
    }
  }
`;

const ADMIN_DOCUMENT = `
  query SubscriptionEnrichmentAdmin($userId: ID!) {
    adminStudentSubscriptions(userId: $userId) {
      ${ENRICHED_ROW_FIELDS}
    }
  }
`;

const EXTEND_DOCUMENT = `
  mutation SubscriptionEnrichmentExtend($input: ExtendSubscriptionInput!) {
    adminExtendSubscription(input: $input) {
      ${ENRICHED_ROW_FIELDS}
    }
  }
`;

// ─── Narrowing helpers (runtime-guarded — zero casts) ───────────────────────

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Minimal structural view of pg's query-bearing prototype. */
interface PgQueryCarrier {
  query: (...args: never[]) => unknown;
}

/** Type guard recovering the query-bearing prototype without assertions. */
function isPgQueryCarrier(value: unknown): value is PgQueryCarrier {
  return typeof value === "object" && value !== null && "query" in value && typeof value.query === "function";
}

/** Installs the pg-level statement counter (calls through; restore in afterAll). */
function installQuerySpy() {
  const candidate: unknown = Client.prototype;
  if (!isPgQueryCarrier(candidate)) {
    throw new Error("pg Client.prototype.query is not spyable");
  }
  return spyOn(candidate, "query");
}

/** Extracts a root-field row list from an execution result. */
function rowsOf(result: ExecutionResult, rootField: string): readonly unknown[] {
  if (!isRecord(result.data)) {
    throw new Error(`missing data for ${rootField} (errors: ${JSON.stringify(result.errors ?? [])})`);
  }
  const rows: unknown = result.data[rootField];
  if (!Array.isArray(rows)) {
    throw new Error(`${rootField} returned no row list`);
  }
  return rows;
}

/** Extracts one row's field as an unknown for narrowed assertion. */
function rowField(row: unknown, key: string): unknown {
  if (!isRecord(row)) {
    throw new Error("expected a row object");
  }
  return row[key];
}

/** Extracts a root-field single-row payload from an execution result. */
function payloadOf(result: ExecutionResult, rootField: string): Record<string, unknown> {
  if (!isRecord(result.data)) {
    throw new Error(`missing data for ${rootField} (errors: ${JSON.stringify(result.errors ?? [])})`);
  }
  const payload: unknown = result.data[rootField];
  if (!isRecord(payload)) {
    throw new Error(`${rootField} returned no payload row`);
  }
  return payload;
}

/** Narrows a row field to a number with an explicit failure. */
function numberField(row: unknown, key: string): number {
  const value = rowField(row, key);
  if (typeof value !== "number") {
    throw new Error(`${key} is not a number on the wire`);
  }
  return value;
}

/** The wire error code of an execution result's first GraphQL error. */
function firstErrorCode(result: ExecutionResult): string {
  const first = result.errors?.at(0);
  const code: unknown = first?.extensions?.code;
  return typeof code === "string" ? code : "";
}

/**
 * Resolves the SDL member name of a canonical string-enum member — the
 * wire vocabulary is always DERIVED from the canonical enum (never a
 * hardcoded string equivalent; same derivation the wire suites pin).
 */
function enumWireName(enumObject: Record<string, string>, member: string): string {
  const name = Object.entries(enumObject).find(([, value]) => value === member)?.[0];
  if (name === undefined) {
    throw new Error("enumWireName: member vanished from its canonical enum");
  }
  return name;
}

const UPDATE_ACTION_WIRE = enumWireName(AuditActionType, AuditActionType.Update);

// ─── Fixture state ──────────────────────────────────────────────────────────

interface ActorBundle {
  readonly userId: number;
  readonly context: Context;
}

interface FixtureState {
  readonly ownerOne: ActorBundle;
  readonly ownerTwentyFive: ActorBundle;
  readonly ownerHundred: ActorBundle;
  readonly admin: ActorBundle;
  readonly teacher: ActorBundle;
  readonly anonymous: Context;
  readonly subscriptionIds: readonly number[];
}

let fixture: FixtureState | null = null;
type QuerySpyHandle = ReturnType<typeof installQuerySpy>;
let querySpy: QuerySpyHandle | null = null;

/** Per-test spy restores — every service spy is returned to the original here. */
const spyRestores: Array<() => void> = [];

afterEach(() => {
  for (const restore of spyRestores.splice(0)) {
    restore();
  }
});

/** Creates a REAL GraphQL context over a signed access token for one user. */
async function contextForToken(userId: number, role: UserRole): Promise<Context> {
  const token = await signAccessToken({ userId, role });
  const request = new Request("https://subscription-enrichment.test/api/graphql", {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "accept-language": "en", cookie: "NEXT_LOCALE=en" },
  });
  return createGraphQLContext(request);
}

/** Inserts one fixture user (plus the `students` child row for students). */
async function insertUser(role: UserRole, label: string): Promise<number> {
  const stamp = randomUUID().slice(0, 18);
  const inserted = await db
    .insert(users)
    .values({
      fullName: `Enrichment ${label} ${stamp}`,
      email: `enrichment-${label}-${stamp}@test.local`,
      phone: `+2010001${stamp.replace(/-/g, "").slice(0, 7)}`,
      passwordHash: await hashPassword(`enrichment-${stamp}`),
      role,
      isDeleted: false,
      suspended: false,
      isBlocked: false,
      lastActiveAt: new Date(),
      country: "Egypt",
      countryCode: "EG",
    })
    .returning({ id: users.id });
  const userId = inserted.at(0)?.id;
  if (userId === undefined) {
    throw new Error(`fixture ${label} users insert returned no rows`);
  }
  if (role === UserRole.Student) {
    await db.insert(students).values({
      id: userId,
      handshakeCode: `EN${stamp.replace(/-/g, "").slice(0, 12)}`,
      balanceTrial: 0,
    });
  }
  return userId;
}

/** Inserts one catalog plan fixture (tracked for the afterAll teardown). */
const createdPlanIds = new Set<number>();

async function insertPlanRow(label: string, sessionCount: number): Promise<number> {
  const [row] = await db
    .insert(plans)
    .values({
      title: `Enrichment Plan ${label} ${randomUUID().slice(0, 8)}`,
      sessionCount,
      price: "100.00",
      currency: "EGP",
      intervalDays: PLAN_INTERVAL_DAYS,
      balanceLane: SubscriptionCreditLane.Hifz,
      isActive: true,
      deactivatedAt: null,
    })
    .returning({ id: plans.id });
  if (!row) throw new Error("plan fixture insert returned no rows");
  createdPlanIds.add(row.id);
  return row.id;
}

/** Seeds one owner's active subscription rows, alternating the plan pair. */
async function insertSubscriptionRows(userId: number, planIds: readonly number[], count: number): Promise<number[]> {
  const firstPlan = planIds.at(0);
  if (firstPlan === undefined) {
    throw new Error("no plan fixtures to seed subscriptions against");
  }
  const now = Date.now();
  const inserted = await db
    .insert(subscriptions)
    .values(
      Array.from({ length: count }, (_, index) => ({
        userId,
        planId: planIds[index % planIds.length] ?? firstPlan,
        status: SubscriptionStatusColumn.Active,
        startDate: new Date(now - index * 60_000),
        endDate: new Date(now + PLAN_INTERVAL_DAYS * MS_PER_DAY),
        paymentMethod: null,
        paymentReference: null,
        paymentVerifiedAt: null,
      }))
    )
    .returning({ id: subscriptions.id });
  return inserted.map(row => row.id);
}

/** Executes one GraphQL operation in-process over the real schema + context. */
async function runOperation(
  source: string,
  variableValues: Record<string, unknown> | undefined,
  context: Context
): Promise<ExecutionResult> {
  return graphql({
    schema: graphQLSchema,
    source,
    variableValues,
    contextValue: context,
  });
}

/** Statement delta for one operation execution (its window never interleaves). */
async function measuredDelta(
  source: string,
  variables: Record<string, unknown> | undefined,
  context: Context
): Promise<number> {
  if (querySpy === null) {
    throw new Error("query spy not installed");
  }
  const before = querySpy.mock.calls.length;
  const result = await runOperation(source, variables, context);
  expect(result.errors ?? [], `${source} must execute without GraphQL errors`).toEqual([]);
  expect(result.data, `${source} must resolve data`).not.toBeNull();
  return querySpy.mock.calls.length - before;
}

/**
 * Sweeps the page sizes SEQUENTIALLY (via async recursion — measured
 * windows must never interleave, so `Promise.all` would corrupt the
 * deltas; the recursion keeps the lint rule's intent explicit).
 */
async function sweepOwnPages(state: FixtureState): Promise<number[]> {
  const contexts = [state.ownerOne.context, state.ownerTwentyFive.context, state.ownerHundred.context];
  const deltas: number[] = [];
  const step = async (remaining: readonly Context[]): Promise<void> => {
    const head = remaining.at(0);
    if (head === undefined) {
      return;
    }
    deltas.push(await measuredDelta(OWN_DOCUMENT, undefined, head));
    await step(remaining.slice(1));
  };
  await step(contexts);
  expect(deltas, "the own-page sweep must cover every page size").toHaveLength(PAGE_SIZES.length);
  return deltas;
}

async function sweepAdminPages(state: FixtureState): Promise<number[]> {
  const owners = [state.ownerOne.userId, state.ownerTwentyFive.userId, state.ownerHundred.userId];
  const deltas: number[] = [];
  const step = async (remaining: readonly number[]): Promise<void> => {
    const head = remaining.at(0);
    if (head === undefined) {
      return;
    }
    deltas.push(await measuredDelta(ADMIN_DOCUMENT, { userId: String(head) }, state.admin.context));
    await step(remaining.slice(1));
  };
  await step(owners);
  expect(deltas, "the admin-page sweep must cover every page size").toHaveLength(PAGE_SIZES.length);
  return deltas;
}

/** The K-bound + constancy assertions over one operation's sweep. */
function expectBoundedConstantDeltas(operation: string, deltas: readonly number[]): void {
  const [first] = deltas;
  expect(first, `${operation} as-found statement counts per page size: ${deltas.join(", ")}`).toBeGreaterThan(0);
  for (const delta of deltas) {
    expect(delta, `${operation} statement count grew with page size (deltas: ${deltas.join(", ")})`).toBe(first);
    expect(
      delta,
      `${operation} round trips exceed the page-size-independent budget (K = ${K_MAX_STATEMENTS})`
    ).toBeLessThanOrEqual(K_MAX_STATEMENTS);
  }
}

// ─── Suite ──────────────────────────────────────────────────────────────────

describe("subscription page enrichment — N+1 oracle + resolver branch lock", () => {
  beforeAll(async () => {
    const planIds = [await insertPlanRow("solo", 10), await insertPlanRow("pair", 5)];

    const ownerOneId = await insertUser(UserRole.Student, "owner-one");
    const ownerTwentyFiveId = await insertUser(UserRole.Student, "owner-twentyfive");
    const ownerHundredId = await insertUser(UserRole.Student, "owner-hundred");
    const adminId = await insertUser(UserRole.Admin, "admin");
    const teacherId = await insertUser(UserRole.Teacher, "teacher");

    const subscriptionIds = [
      ...(await insertSubscriptionRows(ownerOneId, planIds, 1)),
      ...(await insertSubscriptionRows(ownerTwentyFiveId, planIds, 25)),
      ...(await insertSubscriptionRows(ownerHundredId, planIds, 100)),
    ];

    const ownerOne = { userId: ownerOneId, context: await contextForToken(ownerOneId, UserRole.Student) };
    const ownerTwentyFive = {
      userId: ownerTwentyFiveId,
      context: await contextForToken(ownerTwentyFiveId, UserRole.Student),
    };
    const ownerHundred = { userId: ownerHundredId, context: await contextForToken(ownerHundredId, UserRole.Student) };
    const admin = { userId: adminId, context: await contextForToken(adminId, UserRole.Admin) };
    const teacher = { userId: teacherId, context: await contextForToken(teacherId, UserRole.Teacher) };
    const anonymous = await createGraphQLContext(
      new Request("https://subscription-enrichment.test/api/graphql", {
        method: "POST",
        headers: { "accept-language": "en", cookie: "NEXT_LOCALE=en" },
      })
    );

    fixture = {
      ownerOne,
      ownerTwentyFive,
      ownerHundred,
      admin,
      teacher,
      anonymous,
      subscriptionIds,
    };

    // Warm-up executions (one per context) before counting: the real
    // context factory's throttled activity stamp and any per-actor caches
    // settle on the first call — the measured windows must contain ONLY
    // the operation's own statements.
    const warmOwnOne = await runOperation(OWN_DOCUMENT, undefined, ownerOne.context);
    expect(warmOwnOne.errors ?? []).toEqual([]);
    const warmOwnTwentyFive = await runOperation(OWN_DOCUMENT, undefined, ownerTwentyFive.context);
    expect(warmOwnTwentyFive.errors ?? []).toEqual([]);
    const warmOwnHundred = await runOperation(OWN_DOCUMENT, undefined, ownerHundred.context);
    expect(warmOwnHundred.errors ?? []).toEqual([]);
    const warmAdmin = await runOperation(ADMIN_DOCUMENT, { userId: String(ownerOne.userId) }, admin.context);
    expect(warmAdmin.errors ?? []).toEqual([]);

    querySpy = installQuerySpy();
  }, 120_000);

  afterAll(async () => {
    querySpy?.mockRestore();
    const state = fixture;
    if (state === null) {
      return;
    }
    const ownerIds = [state.ownerOne.userId, state.ownerTwentyFive.userId, state.ownerHundred.userId];
    const actorIds = [...ownerIds, state.admin.userId, state.teacher.userId];
    await withAuditDeleteTriggersSuspended(() =>
      db
        .delete(auditLogs)
        .where(
          and(
            eq(auditLogs.entityType, SUBSCRIPTION_AUDIT_ENTITY_TYPE),
            inArray(auditLogs.entityId, state.subscriptionIds)
          )
        )
    );
    await db.delete(subscriptions).where(inArray(subscriptions.userId, ownerIds));
    await db.delete(students).where(inArray(students.id, ownerIds));
    await db.delete(users).where(inArray(users.id, actorIds));
    const planIdList = [...createdPlanIds];
    if (planIdList.length > 0) {
      await db.delete(plans).where(inArray(plans.id, planIdList));
    }
  }, 120_000);

  // ─── The K-bound: constant statements per page regardless of size ────────

  test("mySubscriptions: ≤ K statements per page, constant across sizes 1/25/100", async () => {
    const state = fixture;
    if (state === null) throw new Error("fixture not seeded");
    const deltas = await sweepOwnPages(state);
    expectBoundedConstantDeltas("mySubscriptions", deltas);
  });

  test("adminStudentSubscriptions: ≤ K statements per page, constant across sizes 1/25/100", async () => {
    const state = fixture;
    if (state === null) throw new Error("fixture not seeded");
    const deltas = await sweepAdminPages(state);
    expectBoundedConstantDeltas("adminStudentSubscriptions", deltas);
  });

  test("an unknown well-formed owner answers the honest empty page inside the K budget", async () => {
    const state = fixture;
    if (state === null) throw new Error("fixture not seeded");
    const delta = await measuredDelta(ADMIN_DOCUMENT, { userId: "999999999" }, state.admin.context);
    expect(delta).toBeLessThanOrEqual(K_MAX_STATEMENTS);
    const result = await runOperation(ADMIN_DOCUMENT, { userId: "999999999" }, state.admin.context);
    expect(rowsOf(result, "adminStudentSubscriptions")).toEqual([]);
  });

  // ─── Carried-value correctness through the real resolvers ─────────────────

  test("an enriched page serves plan/count/peek from the carried values", async () => {
    const state = fixture;
    if (state === null) throw new Error("fixture not seeded");
    const result = await runOperation(OWN_DOCUMENT, undefined, state.ownerHundred.context);
    const rows = rowsOf(result, "mySubscriptions");
    expect(rows).toHaveLength(100);
    for (const row of rows) {
      const planId = numberField(row, "planId");
      const plan = rowField(row, "plan");
      if (!isRecord(plan)) throw new Error("enriched row carried no plan object");
      expect(rowField(plan, "id")).toBe(String(planId));
      expect(rowField(row, "auditEntriesCount")).toBe(0);
      expect(rowField(row, "auditTrailPeek")).toBeNull();
    }
  });

  test("the own list stays owner-scoped: the 1-row owner sees exactly her row", async () => {
    const state = fixture;
    if (state === null) throw new Error("fixture not seeded");
    const result = await runOperation(OWN_DOCUMENT, undefined, state.ownerOne.context);
    expect(rowsOf(result, "mySubscriptions")).toHaveLength(1);
  });

  // ─── The resolver branch lock ─────────────────────────────────────────────

  test("fast path: an enriched page issues ZERO single-row service reads (no double-call)", async () => {
    const state = fixture;
    if (state === null) throw new Error("fixture not seeded");
    const planSpy = spyOn(PlanCatalogService, "findById");
    const countSpy = spyOn(SubscriptionAdminService, "auditEntriesCount");
    const peekSpy = spyOn(SubscriptionAdminService, "auditTrailPeek");
    spyRestores.push(
      () => planSpy.mockRestore(),
      () => countSpy.mockRestore(),
      () => peekSpy.mockRestore()
    );

    const result = await runOperation(
      ADMIN_DOCUMENT,
      { userId: String(state.ownerHundred.userId) },
      state.admin.context
    );
    expect(result.errors ?? []).toEqual([]);
    expect(rowsOf(result, "adminStudentSubscriptions")).toHaveLength(100);

    expect(planSpy.mock.calls).toHaveLength(0);
    expect(countSpy.mock.calls).toHaveLength(0);
    expect(peekSpy.mock.calls).toHaveLength(0);
  });

  test("fallback path: a non-enriched payload row takes exactly one single-row read per enrichment field", async () => {
    const state = fixture;
    if (state === null) throw new Error("fixture not seeded");
    const planSpy = spyOn(PlanCatalogService, "findById");
    const countSpy = spyOn(SubscriptionAdminService, "auditEntriesCount");
    const peekSpy = spyOn(SubscriptionAdminService, "auditTrailPeek");
    spyRestores.push(
      () => planSpy.mockRestore(),
      () => countSpy.mockRestore(),
      () => peekSpy.mockRestore()
    );

    // A mutation payload (not a list producer) carries a PLAIN row — the
    // resolvers must fall back to the single-row reads, exactly once each.
    const extendableId = state.subscriptionIds.at(0);
    if (extendableId === undefined) throw new Error("owner fixture row missing");
    const extend = await runOperation(
      EXTEND_DOCUMENT,
      { input: { subscriptionId: String(extendableId), days: 1 } },
      state.admin.context
    );
    expect(extend.errors ?? []).toEqual([]);
    const payload = payloadOf(extend, "adminExtendSubscription");
    expect(planSpy.mock.calls).toHaveLength(1);
    expect(countSpy.mock.calls).toHaveLength(1);
    expect(peekSpy.mock.calls).toHaveLength(1);

    // The fallback answers the same values the list read serves: the
    // extend minted exactly one audit row, so the count is 1 and the peek
    // is that row.
    const planId = numberField(payload, "planId");
    const plan = rowField(payload, "plan");
    if (!isRecord(plan)) throw new Error("fallback resolved no plan object");
    expect(rowField(plan, "id")).toBe(String(planId));
    expect(rowField(payload, "auditEntriesCount")).toBe(1);
    const peek = rowField(payload, "auditTrailPeek");
    if (!isRecord(peek)) throw new Error("fallback resolved no peek object");
    expect(rowField(peek, "actionType")).toBe(UPDATE_ACTION_WIRE);
    expect(rowField(peek, "at")).toBeString();
  });

  test("carried honesty: a truncated batch's plan:null surfaces the localized denial, never a silent re-read", async () => {
    const state = fixture;
    if (state === null) throw new Error("fixture not seeded");
    const carriedRow = (await SubscriptionPurchaseService.listOwn(state.ownerTwentyFive.userId)).at(0);
    if (carriedRow === undefined) throw new Error("owner fixture row missing");
    const hostileRow = Object.assign({}, carriedRow, { plan: null });

    const planSpy = spyOn(PlanCatalogService, "findById");
    const listSpy = spyOn(SubscriptionAdminService, "listForAdmin");
    spyRestores.push(
      () => planSpy.mockRestore(),
      () => listSpy.mockRestore()
    );
    listSpy.mockResolvedValue([hostileRow]);

    const result = await runOperation(
      ADMIN_DOCUMENT,
      { userId: String(state.ownerTwentyFive.userId) },
      state.admin.context
    );
    expect(result.errors?.length ?? 0).toBeGreaterThan(0);
    expect(firstErrorCode(result)).toBe("PLAN_NOT_FOUND");
    expect(planSpy.mock.calls).toHaveLength(0);
  });

  // ─── Tier 3: interleaved concurrent pages stay isolated ───────────────────

  test("interleaved concurrent own/admin pages resolve without cross-contamination", async () => {
    const state = fixture;
    if (state === null) throw new Error("fixture not seeded");
    const [ownHundred, adminTwentyFive] = await Promise.allSettled([
      runOperation(OWN_DOCUMENT, undefined, state.ownerHundred.context),
      runOperation(ADMIN_DOCUMENT, { userId: String(state.ownerTwentyFive.userId) }, state.admin.context),
    ]);
    if (ownHundred.status !== "fulfilled" || adminTwentyFive.status !== "fulfilled") {
      throw new Error("interleaved pages did not both fulfill");
    }
    expect(ownHundred.value.errors ?? []).toEqual([]);
    expect(adminTwentyFive.value.errors ?? []).toEqual([]);
    expect(rowsOf(ownHundred.value, "mySubscriptions")).toHaveLength(100);
    expect(rowsOf(adminTwentyFive.value, "adminStudentSubscriptions")).toHaveLength(25);
  });

  // ─── Tier 4: the auth semantics are exactly the pre-enrichment channels ───

  test("anonymous caller → UNAUTHORIZED on both list queries", async () => {
    const state = fixture;
    if (state === null) throw new Error("fixture not seeded");
    const own = await runOperation(OWN_DOCUMENT, undefined, state.anonymous);
    expect(firstErrorCode(own)).toBe("UNAUTHORIZED");
    const admin = await runOperation(ADMIN_DOCUMENT, { userId: String(state.ownerOne.userId) }, state.anonymous);
    expect(firstErrorCode(admin)).toBe("UNAUTHORIZED");
  });

  test("non-admin caller → FORBIDDEN on the admin list; non-student caller → FORBIDDEN on the own list", async () => {
    const state = fixture;
    if (state === null) throw new Error("fixture not seeded");
    const studentOnAdmin = await runOperation(
      ADMIN_DOCUMENT,
      { userId: String(state.ownerOne.userId) },
      state.ownerOne.context
    );
    expect(firstErrorCode(studentOnAdmin)).toBe("FORBIDDEN");
    const teacherOnOwn = await runOperation(OWN_DOCUMENT, undefined, state.teacher.context);
    expect(firstErrorCode(teacherOnOwn)).toBe("FORBIDDEN");
  });
});
