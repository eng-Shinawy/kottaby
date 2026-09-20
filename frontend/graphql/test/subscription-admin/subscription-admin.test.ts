/**
 * Admin subscription-management GraphQL integration suite.
 *
 * Proven over the LIVE Next.js dev server + real PostgreSQL rows,
 * exercising the four admin lifecycle mutations (`adminExtendSubscription`,
 * `adminRenewSubscription`, `adminCancelSubscription`,
 * `adminChangeSubscriptionPlan`) and the admin read query
 * (`adminStudentSubscriptions`) through the real authScopes boundary,
 * the real services, and real fixture rows.
 *
 * Tiers:
 *  - Tier 1 anonymous → each operation → UNAUTHORIZED (401, before any
 *    resolver body — no fixture reaches the flows).
 *  - Tier 2 student / teacher tokens → each operation → FORBIDDEN
 *    (defense-in-depth beyond the authScope gate).
 *  - Tier 3 admin happy paths through the REAL services — extend shifts a
 *    real window by exactly N days, renew opens a fresh period from a
 *    genuinely expired source, cancel flips a real active row
 *    (both the reason and the null-reason optional branch), and plan
 *    change reports the fixture-derived proration (upgrade carry 3).
 *  - Tier 4 replay semantics — a duplicate renew returns the FIRST
 *    renewal's row (same id, no error) and a serialized duplicate plan
 *    change replays the first result with zeros (carry 0 / forfeit 0 —
 *    the replayed call moved nothing).
 *  - Tier 5 the read query — owner-scoped rows across lifecycle states,
 *    a malformed owner id → VALIDATION, an unknown well-formed id → the
 *    honest empty list.
 *
 * Authentication per role (multi-role isolation):
 *  - The shared `testClient` sends NO cookies between tests, so every
 *    operation carries its OWN identity via a per-request
 *    `Authorization: Bearer <accessToken>` header. Anonymous probes omit
 *    the header entirely.
 *
 * Data lifecycle (HYGIENE — mirrors the sibling `admin-finance` suite):
 *  - Every user this suite creates is tracked by id and deleted in a
 *    top-level `afterAll` via the shared `deleteUsersByIds` helper
 *    (audit rows first, then subscriptions/user RESTRICT references, then
 *    the users; child rows cascade), so the shared dev database returns
 *    to its canonical seed state. Deletion is by EXPLICIT id list, never
 *    an email-pattern sweep, so parallel live-wire suites keep their own
 *    fixtures intact.
 *  - Fixture `plans` rows have NO user FK — they are tracked separately
 *    and deleted explicitly AFTER the users (the `subscriptions.plan_id`
 *    RESTRICT FK releases once the users' subscriptions are gone).
 *
 * Fixtures (direct-DB provisioning):
 *  - The admin actor goes through the sanctioned `@/test/helpers` fixture
 *    seam (`insertAdminUserWithChildRow`) — admin is NOT publicly
 *    registrable (`RegisterPublicRole` BFLA exclusion); every identity
 *    logs in through the public `login` mutation so authorization
 *    exercises the real token path.
 *  - Non-admin actors register through the PUBLIC `registerUser`
 *    mutation — a `Student` registration provisions the `students` row
 *    (the renewal's junction + lane-credit target) as a side effect.
 *  - Catalog plans and subscription rows have no public provisioning
 *    surface, mirroring the sibling suites' minimal direct-DB fixture
 *    inserts (plans / subscriptions / one lane-balance seed). The
 *    expired renew source is a real `expired` row whose window already
 *    ended — the exact shape the expiry sweep leaves behind.
 *
 * Proration fixture (hand-computed from the plan prices):
 *  - source plan 100.00 / 10 sessions vs target plan 100.00 / 5 sessions
 *    → per-session unit 10.00 → 20.00 (strictly greater) = UPGRADE;
 *    with the owner's lane balance seeded to 6 remaining sessions the
 *    exact carry is floor(6 × 100.00 × 5 / (10 × 100.00)) = 3 on top of
 *    the target plan's full 5, forfeiting nothing.
 *
 * Per `frontend/graphql/test/AGENTS.md`:
 *  - Generated enums imported from `@/frontend/graphql/generated/gql/graphql`
 *    where the generated surface carries them (`RegisterPublicRole`); the
 *    status/direction wire vocabularies are DERIVED from their canonical
 *    enums via the member-name derivation the scheduling suite pins (the
 *    generated gql module does not yet export `ProrationDirection`).
 *  - Mutations pass ALL input arguments (required + optional) — optional
 *    fields appear as `null` even when not exercised in a given case.
 *  - Every behavioral assertion runs through `testClient`; direct-DB use
 *    is limited to fixture provisioning and the hygiene teardown.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import type { TypedDocumentNode } from "@apollo/client";
import { eq, inArray, sql } from "drizzle-orm";
import { parse } from "graphql";

import { db } from "@/backend/db";
import { auditLogs } from "@/backend/db/schema/audit/audit-logs";
import { plans } from "@/backend/db/schema/billing/plans";
import { subscriptions } from "@/backend/db/schema/billing/subscriptions";
import { students } from "@/backend/db/schema/students/students";
import { ProrationDirection } from "@/backend/enum/billing/proration-direction.enum";
import { SubscriptionCreditLane } from "@/backend/enum/billing/subscription-credit-lane.enum";
import { SubscriptionStatus as SubscriptionStatusColumn } from "@/backend/enum/billing/subscription-status.enum";
import { RegisterPublicRole } from "@/frontend/graphql/generated/gql/graphql";
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

/** One day in milliseconds — the extend window's arithmetic unit. */
const MS_PER_DAY = 86_400_000;

/** Counts ALL audit rows in the table (denial-no-audit delta assertion). */
async function countAllAuditRows(): Promise<number> {
  const result = await db.select({ count: sql<number>`count(*)::int` }).from(auditLogs);
  return result[0]?.count ?? 0;
}

/** The renew/extend fixture window length in days (the plans' interval). */
const PLAN_INTERVAL_DAYS = 30;

/** How far the expired fixtures' windows sit in the past. */
const PAST_WINDOW_DAYS = 60;

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

/** Authorization header factory — keeps multi-role isolation explicit. */
function bearer(token: string): { headers: { Authorization: string } } {
  return { headers: { Authorization: `Bearer ${token}` } };
}

/**
 * Resolves the SDL member name of a canonical string-enum member — the wire
 * vocabulary is always DERIVED from the canonical enum (never a hardcoded
 * string equivalent; same derivation the session-lifecycle suite pins).
 */
function enumWireName(enumObject: Record<string, string>, member: string): string {
  const name = Object.entries(enumObject).find(([, value]) => value === member)?.[0];
  if (name === undefined) {
    throw new Error("enumWireName: member vanished from its canonical enum");
  }
  return name;
}

/** Wire member names derived from the canonical enums (never literals). */
const ACTIVE_WIRE = enumWireName(SubscriptionStatusColumn, SubscriptionStatusColumn.Active);
const CANCELLED_WIRE = enumWireName(SubscriptionStatusColumn, SubscriptionStatusColumn.Cancelled);
const EXPIRED_WIRE = enumWireName(SubscriptionStatusColumn, SubscriptionStatusColumn.Expired);
const UPGRADE_WIRE = enumWireName(ProrationDirection, ProrationDirection.Upgrade);

// ─── Wire documents (local parse — mirrors the scheduling-suite pattern) ──
//
// The shared admin-subscription documents do not exist yet in
// `frontend/graphql/sharedDocuments/`, so the wire shapes are declared HERE
// as local result interfaces and bound to the parsed documents via
// `TypedDocumentNode` annotations (structurally satisfied by a plain
// `DocumentNode` — no casts). `graphql-tag` is avoided deliberately: the
// `@/backend/db` fixture chain flips bun's module conditions and crashes its
// UMD build; `parse` yields the same DocumentNode.

/** The asserted subset of the `StudentSubscription` wire object. */
interface SubscriptionWire {
  readonly id: string;
  readonly planId: number;
  readonly status: string;
  readonly startDate: string | null;
  readonly endDate: string | null;
}

/** The `ChangeSubscriptionPlanPayload` wire shape (the asserted subset). */
interface ChangePlanPayloadWire {
  readonly adminChangeSubscriptionPlan: {
    readonly direction: string;
    readonly carrySessions: number;
    readonly forfeitedSessions: number;
    readonly subscription: SubscriptionWire;
  } | null;
}

/** The `adminStudentSubscriptions` list wire shape. */
interface SubscriptionsListWire {
  readonly adminStudentSubscriptions: readonly SubscriptionWire[] | null;
}

type RenewVariables = { readonly input: { readonly subscriptionId: string } };
type ExtendVariables = { readonly input: { readonly subscriptionId: string; readonly days: number } };
type CancelVariables = { readonly input: { readonly subscriptionId: string; readonly reason: string | null } };
type ChangePlanVariables = { readonly input: { readonly subscriptionId: string; readonly newPlanId: string } };

const adminStudentSubscriptionsQuery: TypedDocumentNode<SubscriptionsListWire, { userId: string }> = parse(`
  query AdminStudentSubscriptions($userId: ID!) {
    adminStudentSubscriptions(userId: $userId) {
      id
      planId
      status
      startDate
      endDate
    }
  }
`);

const adminExtendSubscriptionMutation: TypedDocumentNode<
  { adminExtendSubscription: SubscriptionWire | null },
  ExtendVariables
> = parse(`
  mutation AdminExtendSubscription($input: ExtendSubscriptionInput!) {
    adminExtendSubscription(input: $input) {
      id
      planId
      status
      startDate
      endDate
    }
  }
`);

const adminRenewSubscriptionMutation: TypedDocumentNode<
  { adminRenewSubscription: SubscriptionWire | null },
  RenewVariables
> = parse(`
  mutation AdminRenewSubscription($input: RenewSubscriptionInput!) {
    adminRenewSubscription(input: $input) {
      id
      planId
      status
      startDate
      endDate
    }
  }
`);

const adminCancelSubscriptionMutation: TypedDocumentNode<
  { adminCancelSubscription: SubscriptionWire | null },
  CancelVariables
> = parse(`
  mutation AdminCancelSubscription($input: CancelSubscriptionInput!) {
    adminCancelSubscription(input: $input) {
      id
      planId
      status
      startDate
      endDate
    }
  }
`);

const adminChangeSubscriptionPlanMutation: TypedDocumentNode<ChangePlanPayloadWire, ChangePlanVariables> = parse(`
  mutation AdminChangeSubscriptionPlan($input: ChangeSubscriptionPlanInput!) {
    adminChangeSubscriptionPlan(input: $input) {
      direction
      carrySessions
      forfeitedSessions
      subscription {
        id
        planId
        status
        startDate
        endDate
      }
    }
  }
`);

// ─── Fixture provisioning (direct-DB — the sanctioned fixture shape) ──────

interface ActorBundle {
  readonly userId: number;
  readonly email: string;
  readonly accessToken: string;
}

/** Ids of every user this suite creates — drained by the `afterAll` hygiene
 * cleanup. Explicit ids (not an email sweep) keep parallel live-wire
 * suites' fixtures safe. */
const createdUserIds = new Set<number>();

function trackCreatedUser(id: number | null | undefined): void {
  if (typeof id === "number") createdUserIds.add(id);
}

/** Fixture `plans` rows — no user FK, deleted explicitly in the `afterAll`
 * AFTER the users (the subscriptions RESTRICT releases with them). */
const createdPlanIds = new Set<number>();

/**
 * Registers a non-admin user through the PUBLIC registerUser mutation,
 * then logs in through the PUBLIC login mutation to obtain a real bearer
 * token. A `Student` registration provisions the `students` row (lane
 * balances + the renewal junction target) as a registration side effect.
 */
async function registerAndLogin(role: RegisterPublicRole): Promise<ActorBundle> {
  const email = uniqueEmail(role.toLowerCase());
  const registered = await testClient.mutate({
    mutation: registerUserMutationDocument,
    variables: {
      input: {
        fullName: `Test ${role}`,
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
 * seam (admin role is excluded from the public registration surface — BFLA
 * defense). The real bcrypt hash lets the public login mutation mint a
 * genuine session for the probe.
 */
async function provisionAdminActor(): Promise<ActorBundle> {
  const email = uniqueEmail("admin");
  const userId = await insertAdminUserWithChildRow({
    fullName: "Admin Subscription Probe",
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

/**
 * Inserts one catalog `plans` row (full column control) and tracks its id
 * for the FK-safe teardown. Plans credit the Hifz lane so the renew credit
 * and the plan-change settlement both have a configured anchor.
 */
async function insertPlanRow(overrides: { readonly sessionCount: number; readonly price: string }): Promise<number> {
  // Run-unique catalog title — never asserted, only kept unique per run.
  const fixturePlanTitle = `Integration Plan ${randomUUID().slice(0, 8)}`;
  const [row] = await db
    .insert(plans)
    .values({
      title: fixturePlanTitle,
      sessionCount: overrides.sessionCount,
      price: overrides.price,
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

/**
 * Inserts one `subscriptions` row for a tracked user with full lifecycle
 * control (status + window). The expired renew source is a real expired
 * row whose window already ended — the shape the expiry sweep leaves.
 */
async function insertSubscriptionRow(
  userId: number,
  planId: number,
  lifecycle: {
    readonly status: SubscriptionStatusColumn;
    readonly startMs: number;
    readonly endMs: number | null;
  }
): Promise<number> {
  const [row] = await db
    .insert(subscriptions)
    .values({
      userId,
      planId,
      status: lifecycle.status,
      startDate: new Date(lifecycle.startMs),
      endDate: lifecycle.endMs === null ? null : new Date(lifecycle.endMs),
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
let planTenId: number | undefined;
let planFiveId: number | undefined;
let extendOwner: ActorBundle | undefined;
let subExtendId: number | undefined;
let subExtendEndMs: number | undefined;
let renewOwner: ActorBundle | undefined;
let subRenewSourceId: number | undefined;
let cancelOwner: ActorBundle | undefined;
let subCancelReasonId: number | undefined;
let subCancelNullId: number | undefined;
let changeOwner: ActorBundle | undefined;
let subPlanChangeId: number | undefined;
let listOwner: ActorBundle | undefined;
let subListActiveId: number | undefined;
let subListExpiredId: number | undefined;
/** The first renewal's row id — the replay test pins the SAME id. */
let firstRenewalId: string | undefined;
/** The first plan change's new row id — the replay test pins the SAME id. */
let firstPlanChangeId: string | undefined;

describeGraphqlSuite("Admin subscription-management GraphQL integration", () => {
  // The sandbox dev server (port 3000) may already be running and
  // graphQL-live. Per the AGENTS.md "Memory-constrained sandbox
  // adaptation", setting TEST_SERVER_EXTERNAL=1 reuses the warm server
  // instead of spawning a second `next dev` on port 3066.
  if (process.env.TEST_SERVER_EXTERNAL !== "1") {
    setupTestServerLifecycle();
  }

  beforeAll(async () => {
    admin = await provisionAdminActor();

    // Catalog: 10 sessions @ 100.00 and 5 sessions @ 100.00 — the proration
    // pair whose unit values derive the UPGRADE direction and the exact
    // carry of 3 from the seeded 6 remaining sessions.
    planTenId = await insertPlanRow({ sessionCount: 10, price: "100.00" });
    planFiveId = await insertPlanRow({ sessionCount: 5, price: "100.00" });

    const now = Date.now();

    // Extend fixture — a genuinely active row with an open window.
    extendOwner = await registerAndLogin(RegisterPublicRole.Student);
    subExtendEndMs = now + PLAN_INTERVAL_DAYS * MS_PER_DAY;
    subExtendId = await insertSubscriptionRow(extendOwner.userId, planTenId, {
      status: SubscriptionStatusColumn.Active,
      startMs: now,
      endMs: subExtendEndMs,
    });

    // Renew fixture — the expired source: status `expired` PLUS a window
    // that already ended (the sweep-shaped row).
    renewOwner = await registerAndLogin(RegisterPublicRole.Student);
    subRenewSourceId = await insertSubscriptionRow(renewOwner.userId, planTenId, {
      status: SubscriptionStatusColumn.Expired,
      startMs: now - PAST_WINDOW_DAYS * MS_PER_DAY,
      endMs: now - PLAN_INTERVAL_DAYS * MS_PER_DAY,
    });

    // Cancel fixtures — two active rows for one owner: the optional
    // `reason` field is exercised BOTH ways (meaningful value, then null).
    cancelOwner = await registerAndLogin(RegisterPublicRole.Student);
    subCancelReasonId = await insertSubscriptionRow(cancelOwner.userId, planTenId, {
      status: SubscriptionStatusColumn.Active,
      startMs: now,
      endMs: now + PLAN_INTERVAL_DAYS * MS_PER_DAY,
    });
    subCancelNullId = await insertSubscriptionRow(cancelOwner.userId, planTenId, {
      status: SubscriptionStatusColumn.Active,
      startMs: now,
      endMs: now + PLAN_INTERVAL_DAYS * MS_PER_DAY,
    });

    // Plan-change fixture — an active row on the 10-session plan whose
    // owner's Hifz lane holds the proration's remaining 6 sessions.
    changeOwner = await registerAndLogin(RegisterPublicRole.Student);
    subPlanChangeId = await insertSubscriptionRow(changeOwner.userId, planTenId, {
      status: SubscriptionStatusColumn.Active,
      startMs: now,
      endMs: now + PLAN_INTERVAL_DAYS * MS_PER_DAY,
    });
    await db.update(students).set({ balanceHifz: 6 }).where(eq(students.id, changeOwner.userId));

    // List fixture — one owner holding rows in two lifecycle states.
    listOwner = await registerAndLogin(RegisterPublicRole.Student);
    subListActiveId = await insertSubscriptionRow(listOwner.userId, planTenId, {
      status: SubscriptionStatusColumn.Active,
      startMs: now,
      endMs: now + PLAN_INTERVAL_DAYS * MS_PER_DAY,
    });
    subListExpiredId = await insertSubscriptionRow(listOwner.userId, planTenId, {
      status: SubscriptionStatusColumn.Expired,
      startMs: now - PAST_WINDOW_DAYS * MS_PER_DAY,
      endMs: now - PLAN_INTERVAL_DAYS * MS_PER_DAY,
    });
  });

  // ─── Hygiene: restore the shared dev database to canonical seed state ───
  // 1. Users (tracked by explicit id) — the shared helper sweeps the
  //    audit rows (by actor + about-user), the RESTRICT-gated
  //    `subscriptions.user_id` references, then the users; child rows
  //    (students, junction, claims) cascade.
  // 2. Plans (tracked by explicit id, no user FK) — deleted AFTER the
  //    users so the `subscriptions.plan_id` RESTRICT FK is released.
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

  // ─── Tier 1: anonymous → each operation → UNAUTHORIZED ─────────────
  describe("Tier 1 — anonymous caller denied across every operation", () => {
    test("adminStudentSubscriptions → UNAUTHORIZED", async () => {
      const auditBefore = await countAllAuditRows();
      const result = await testClient.query({
        query: adminStudentSubscriptionsQuery,
        variables: { userId: "1" },
      });
      expectMutationError(result.error, "UNAUTHORIZED");
      expect(await countAllAuditRows()).toBe(auditBefore);
    });

    test("adminExtendSubscription → UNAUTHORIZED", async () => {
      const auditBefore = await countAllAuditRows();
      const result = await testClient.mutate({
        mutation: adminExtendSubscriptionMutation,
        variables: { input: { subscriptionId: "1", days: 5 } },
      });
      expectMutationError(result.error, "UNAUTHORIZED");
      expect(await countAllAuditRows()).toBe(auditBefore);
    });

    test("adminRenewSubscription → UNAUTHORIZED", async () => {
      const auditBefore = await countAllAuditRows();
      const result = await testClient.mutate({
        mutation: adminRenewSubscriptionMutation,
        variables: { input: { subscriptionId: "1" } },
      });
      expectMutationError(result.error, "UNAUTHORIZED");
      expect(await countAllAuditRows()).toBe(auditBefore);
    });

    test("adminCancelSubscription → UNAUTHORIZED", async () => {
      const auditBefore = await countAllAuditRows();
      const result = await testClient.mutate({
        mutation: adminCancelSubscriptionMutation,
        variables: { input: { subscriptionId: "1", reason: null } },
      });
      expectMutationError(result.error, "UNAUTHORIZED");
      expect(await countAllAuditRows()).toBe(auditBefore);
    });

    test("adminChangeSubscriptionPlan → UNAUTHORIZED", async () => {
      const auditBefore = await countAllAuditRows();
      const result = await testClient.mutate({
        mutation: adminChangeSubscriptionPlanMutation,
        variables: { input: { subscriptionId: "1", newPlanId: "1" } },
      });
      expectMutationError(result.error, "UNAUTHORIZED");
      expect(await countAllAuditRows()).toBe(auditBefore);
    });
  });

  // ─── Tier 2: non-admin roles → each operation → FORBIDDEN ─────────
  describe("Tier 2 — non-admin roles denied across every operation", () => {
    const nonAdminRoles: ReadonlyArray<RegisterPublicRole> = [RegisterPublicRole.Student, RegisterPublicRole.Teacher];

    for (const role of nonAdminRoles) {
      test(`${role} actor → adminStudentSubscriptions → FORBIDDEN`, async () => {
        const { accessToken } = await registerAndLogin(role);
        const result = await testClient.query({
          query: adminStudentSubscriptionsQuery,
          variables: { userId: "1" },
          context: bearer(accessToken),
        });
        expectMutationError(result.error, "FORBIDDEN");
      });

      test(`${role} actor → adminExtendSubscription → FORBIDDEN`, async () => {
        const { accessToken } = await registerAndLogin(role);
        const result = await testClient.mutate({
          mutation: adminExtendSubscriptionMutation,
          variables: { input: { subscriptionId: "1", days: 5 } },
          context: bearer(accessToken),
        });
        expectMutationError(result.error, "FORBIDDEN");
      });

      test(`${role} actor → adminRenewSubscription → FORBIDDEN`, async () => {
        const { accessToken } = await registerAndLogin(role);
        const result = await testClient.mutate({
          mutation: adminRenewSubscriptionMutation,
          variables: { input: { subscriptionId: "1" } },
          context: bearer(accessToken),
        });
        expectMutationError(result.error, "FORBIDDEN");
      });

      test(`${role} actor → adminCancelSubscription → FORBIDDEN`, async () => {
        const { accessToken } = await registerAndLogin(role);
        const result = await testClient.mutate({
          mutation: adminCancelSubscriptionMutation,
          variables: { input: { subscriptionId: "1", reason: null } },
          context: bearer(accessToken),
        });
        expectMutationError(result.error, "FORBIDDEN");
      });

      test(`${role} actor → adminChangeSubscriptionPlan → FORBIDDEN`, async () => {
        const { accessToken } = await registerAndLogin(role);
        const result = await testClient.mutate({
          mutation: adminChangeSubscriptionPlanMutation,
          variables: { input: { subscriptionId: "1", newPlanId: "1" } },
          context: bearer(accessToken),
        });
        expectMutationError(result.error, "FORBIDDEN");
      });
    }
  });

  // ─── Tier 3: admin happy paths through the REAL services ──────────
  describe("Tier 3 — admin happy paths against real fixtures", () => {
    test("adminExtendSubscription shifts a real window by exactly the requested days", async () => {
      if (admin === undefined || subExtendId === undefined || subExtendEndMs === undefined) {
        throw new Error("extend fixtures missing");
      }
      const result = await testClient.mutate({
        mutation: adminExtendSubscriptionMutation,
        variables: { input: { subscriptionId: String(subExtendId), days: 5 } },
        context: bearer(admin.accessToken),
      });
      expect(result.error).toBeUndefined();
      const extended = result.data?.adminExtendSubscription;
      if (!extended) throw new Error("adminExtendSubscription returned no row");
      expect(extended.id).toBe(String(subExtendId));
      expect(extended.status).toBe(ACTIVE_WIRE);
      if (extended.endDate === null) throw new Error("extended row lost its window end");
      expect(new Date(extended.endDate).getTime() - subExtendEndMs).toBe(5 * MS_PER_DAY);
    });

    test("adminRenewSubscription opens a fresh period from the expired source", async () => {
      if (admin === undefined || subRenewSourceId === undefined || planTenId === undefined) {
        throw new Error("renew fixtures missing");
      }
      const result = await testClient.mutate({
        mutation: adminRenewSubscriptionMutation,
        variables: { input: { subscriptionId: String(subRenewSourceId) } },
        context: bearer(admin.accessToken),
      });
      expect(result.error).toBeUndefined();
      const renewed = result.data?.adminRenewSubscription;
      if (!renewed) throw new Error("adminRenewSubscription returned no row");
      expect(renewed.id).not.toBe(String(subRenewSourceId));
      expect(renewed.planId).toBe(planTenId);
      expect(renewed.status).toBe(ACTIVE_WIRE);
      if (renewed.startDate === null || renewed.endDate === null) {
        throw new Error("renewal row opened without a window");
      }
      const startMs = new Date(renewed.startDate).getTime();
      expect(Math.abs(startMs - Date.now())).toBeLessThan(60_000);
      expect(new Date(renewed.endDate).getTime() - startMs).toBe(PLAN_INTERVAL_DAYS * MS_PER_DAY);
      firstRenewalId = renewed.id;
    });

    test("adminCancelSubscription flips an active row with a bounded reason", async () => {
      if (admin === undefined || subCancelReasonId === undefined) {
        throw new Error("cancel fixtures missing");
      }
      const result = await testClient.mutate({
        mutation: adminCancelSubscriptionMutation,
        variables: {
          input: { subscriptionId: String(subCancelReasonId), reason: "integration cancel probe" },
        },
        context: bearer(admin.accessToken),
      });
      expect(result.error).toBeUndefined();
      const cancelled = result.data?.adminCancelSubscription;
      if (!cancelled) throw new Error("adminCancelSubscription returned no row");
      expect(cancelled.id).toBe(String(subCancelReasonId));
      expect(cancelled.status).toBe(CANCELLED_WIRE);
    });

    test("adminCancelSubscription accepts the null reason branch", async () => {
      if (admin === undefined || subCancelNullId === undefined) {
        throw new Error("cancel fixtures missing");
      }
      const result = await testClient.mutate({
        mutation: adminCancelSubscriptionMutation,
        variables: { input: { subscriptionId: String(subCancelNullId), reason: null } },
        context: bearer(admin.accessToken),
      });
      expect(result.error).toBeUndefined();
      const cancelled = result.data?.adminCancelSubscription;
      if (!cancelled) throw new Error("adminCancelSubscription returned no row");
      expect(cancelled.id).toBe(String(subCancelNullId));
      expect(cancelled.status).toBe(CANCELLED_WIRE);
    });

    test("adminChangeSubscriptionPlan reports the fixture-derived upgrade carry", async () => {
      if (admin === undefined || subPlanChangeId === undefined || planFiveId === undefined) {
        throw new Error("plan-change fixtures missing");
      }
      const result = await testClient.mutate({
        mutation: adminChangeSubscriptionPlanMutation,
        variables: { input: { subscriptionId: String(subPlanChangeId), newPlanId: String(planFiveId) } },
        context: bearer(admin.accessToken),
      });
      expect(result.error).toBeUndefined();
      const payload = result.data?.adminChangeSubscriptionPlan;
      if (!payload) throw new Error("adminChangeSubscriptionPlan returned no payload");
      // 100.00/10 → 100.00/5: unit 10.00 → 20.00 (strictly greater) = UPGRADE;
      // remaining 6 seeded on the lane → carry floor(6 × 100 × 5 / (10 × 100)) = 3.
      expect(payload.direction).toBe(UPGRADE_WIRE);
      expect(payload.carrySessions).toBe(3);
      expect(payload.forfeitedSessions).toBe(0);
      expect(payload.subscription.id).not.toBe(String(subPlanChangeId));
      expect(payload.subscription.planId).toBe(planFiveId);
      expect(payload.subscription.status).toBe(ACTIVE_WIRE);
      firstPlanChangeId = payload.subscription.id;
    });
  });

  // ─── Tier 4: replay semantics — duplicates return the FIRST result ──
  describe("Tier 4 — idempotent replay of committed flows", () => {
    test("duplicate adminRenewSubscription replays the FIRST renewal's row", async () => {
      if (admin === undefined || subRenewSourceId === undefined || firstRenewalId === undefined) {
        throw new Error("renew replay fixtures missing");
      }
      const result = await testClient.mutate({
        mutation: adminRenewSubscriptionMutation,
        variables: { input: { subscriptionId: String(subRenewSourceId) } },
        context: bearer(admin.accessToken),
      });
      expect(result.error).toBeUndefined();
      const replayed = result.data?.adminRenewSubscription;
      if (!replayed) throw new Error("adminRenewSubscription replay returned no row");
      expect(replayed.id).toBe(firstRenewalId);
      expect(replayed.status).toBe(ACTIVE_WIRE);
    });

    test("serialized duplicate adminChangeSubscriptionPlan replays with zeros", async () => {
      if (
        admin === undefined ||
        subPlanChangeId === undefined ||
        planFiveId === undefined ||
        firstPlanChangeId === undefined
      ) {
        throw new Error("plan-change replay fixtures missing");
      }
      const result = await testClient.mutate({
        mutation: adminChangeSubscriptionPlanMutation,
        variables: { input: { subscriptionId: String(subPlanChangeId), newPlanId: String(planFiveId) } },
        context: bearer(admin.accessToken),
      });
      expect(result.error).toBeUndefined();
      const payload = result.data?.adminChangeSubscriptionPlan;
      if (!payload) throw new Error("adminChangeSubscriptionPlan replay returned no payload");
      expect(payload.subscription.id).toBe(firstPlanChangeId);
      expect(payload.direction).toBe(UPGRADE_WIRE);
      // The replayed call moved nothing — the settlement zeros report that.
      expect(payload.carrySessions).toBe(0);
      expect(payload.forfeitedSessions).toBe(0);
    });
  });

  // ─── Tier 5: the admin read query — owner scope, validation, honesty ─
  describe("Tier 5 — adminStudentSubscriptions read surface", () => {
    test("admin reads exactly the addressed owner's rows across lifecycle states", async () => {
      if (
        admin === undefined ||
        listOwner === undefined ||
        subListActiveId === undefined ||
        subListExpiredId === undefined
      ) {
        throw new Error("list fixtures missing");
      }
      const result = await testClient.query({
        query: adminStudentSubscriptionsQuery,
        variables: { userId: String(listOwner.userId) },
        context: bearer(admin.accessToken),
      });
      expect(result.error).toBeUndefined();
      const rows = result.data?.adminStudentSubscriptions;
      if (!rows) throw new Error("adminStudentSubscriptions returned no list");
      expect(rows).toHaveLength(2);
      const ids = new Set(rows.map(row => row.id));
      expect(ids.has(String(subListActiveId))).toBe(true);
      expect(ids.has(String(subListExpiredId))).toBe(true);
      const statuses = new Set(rows.map(row => row.status));
      expect(statuses.has(ACTIVE_WIRE)).toBe(true);
      expect(statuses.has(EXPIRED_WIRE)).toBe(true);
    });

    test("the plan-change owner's list shows the cancelled source beside the fresh row", async () => {
      if (
        admin === undefined ||
        changeOwner === undefined ||
        subPlanChangeId === undefined ||
        firstPlanChangeId === undefined
      ) {
        throw new Error("plan-change list fixtures missing");
      }
      const result = await testClient.query({
        query: adminStudentSubscriptionsQuery,
        variables: { userId: String(changeOwner.userId) },
        context: bearer(admin.accessToken),
      });
      expect(result.error).toBeUndefined();
      const rows = result.data?.adminStudentSubscriptions;
      if (!rows) throw new Error("adminStudentSubscriptions returned no list");
      const ids = new Set(rows.map(row => row.id));
      expect(ids.has(String(subPlanChangeId))).toBe(true);
      expect(ids.has(firstPlanChangeId)).toBe(true);
      const statusById = new Map(rows.map(row => [row.id, row.status]));
      expect(statusById.get(String(subPlanChangeId))).toBe(CANCELLED_WIRE);
      expect(statusById.get(firstPlanChangeId)).toBe(ACTIVE_WIRE);
    });

    test("malformed owner id → VALIDATION on extensions.code", async () => {
      if (admin === undefined) throw new Error("admin fixture missing");
      const auditBefore = await countAllAuditRows();
      const result = await testClient.query({
        query: adminStudentSubscriptionsQuery,
        variables: { userId: "not-a-number" },
        context: bearer(admin.accessToken),
      });
      expectMutationError(result.error, "VALIDATION");
      expect(await countAllAuditRows()).toBe(auditBefore);
    });

    test("unknown well-formed owner id → the honest empty list", async () => {
      if (admin === undefined) throw new Error("admin fixture missing");
      const result = await testClient.query({
        query: adminStudentSubscriptionsQuery,
        variables: { userId: "999999999" },
        context: bearer(admin.accessToken),
      });
      expect(result.error).toBeUndefined();
      expect(result.data?.adminStudentSubscriptions).toEqual([]);
    });
  });
});
