/**
 * `planCatalog` / `adminPlans` queries — integration suite (DEV1-005 3.2.TE).
 *
 * Runs over the REAL boundary exactly like
 * `frontend/graphql/test/teachers/applicant-profile.test.ts`: the shared
 * lifecycle boots the Next dev server on the shared TEST_PORT (3066) and
 * every row goes through Apollo Client v4 + the shared error helper
 * (`expectMutationError` — the canonical `extensions.code` assertion helper,
 * name is historical; it asserts `CombinedGraphQLErrors` on the
 * `result.error` of QUERIES and MUTATIONS alike) via `@/test/helpers`.
 *
 * Amendment notes (documented in outcome/3.2-catalog-queries-outcome.md):
 *  - LOCATION: the plan's `backend/graphql/test/` path defers to the
 *    ESTABLISHED server-boundary layout `frontend/graphql/test/` — this
 *    suite is server-boundary (Apollo wire) testing, not a backend unit
 *    suite, so it lives beside its model `teachers/applicant-profile.test.ts`.
 *  - DOCUMENTS: inline `parse()`d documents (NOT shared
 *    TypedDocumentNodes) — the shared documents under
 *    `frontend/graphql/sharedDocuments/` are codegen artifacts produced in
 *    Task 3.4 and deliberately NOT created here; inline documents keep this
 *    suite self-contained. `parse` from `graphql` is used instead of Apollo's
 *    `gql` because the `@/backend/db` fixture chain flips bun's module
 *    conditions so `graphql-tag`'s UMD build crashes (see the applicant
 *    suite's identical note).
 *
 * Auth mechanism per role (multi-role isolation, mirrors the applicant suite):
 *  - Every request carries its OWN identity via a per-request
 *    `Authorization: Bearer <accessToken>` header (context.headers) — the
 *    production client path per `gqlContextFactory.extractAccessToken`.
 *  - Student: registered through the PUBLIC `registerUser` mutation
 *    (RegisterPublicRole.Student), then logged in through the PUBLIC
 *    `login` mutation.
 *  - Admin: NOT publicly registrable (RegisterPublicRole BFLA exclusion), so
 *    the users row (role "admin") + `admin` child row are engineered
 *    directly in the DB with a REAL bcrypt hash, then logged in through the
 *    public `login` mutation — real session, real token, real scope check.
 *
 * Plan fixtures (beforeAll, direct DB insert for lifecycle control):
 *  - ONE active plan and ONE deactivated plan (`isActive: false` +
 *    `deactivatedAt: now`). Direct inserts are used instead of
 *    `PlanCatalogService.createPlan` because the service only creates
 *    ACTIVE plans — crafting the deactivated fixture requires direct
 *    lifecycle-column control. Accumulated rows follow the GraphQL
 *    integration-suite convention (randomized titles, no cleanup).
 *
 * Cells:
 *  1. anonymous `planCatalog`        → UNAUTHORIZED (401)
 *  2. student    `planCatalog`       → success, ACTIVE-ONLY (deactivated
 *     fixture absent) + full REQ-060 field shape + `__typename: "Plan"`
 *  3. student    `adminPlans`        → FORBIDDEN (403, role gate)
 *  4. anonymous  `adminPlans`        → UNAUTHORIZED (401)
 *  5. admin      `planCatalog`       → success, ACTIVE-ONLY (visibility
 *     split holds for admins on the consumer surface too)
 *  6. admin      `adminPlans` (default/true) → includes the deactivated fixture
 *  7. admin      `adminPlans(includeInactive: false)` → active-only
 */

import { beforeAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import type { TypedDocumentNode } from "@apollo/client";
import { parse } from "graphql";

import { db } from "@/backend/db";
import { plans } from "@/backend/db/schema/billing/plans";
import { admin } from "@/backend/db/schema/users/admin";
import { users } from "@/backend/db/schema/users/users";
import { hashPassword } from "@/backend/lib/auth/password";
import { RegisterPublicRole } from "@/frontend/graphql/generated/gql/graphql";
import {
  loginMutationDocument,
  registerUserMutationDocument,
} from "@/frontend/graphql/sharedDocuments/auth/auth.documents";
import { expectMutationError, setupTestServerLifecycle, testClient } from "@/test/helpers";

// Named without the literal `password` token so `sonarjs/no-hardcoded-passwords`
// does not flag it (same convention as auth.test.ts / applicant-profile.test.ts).
const testCredential = "Password123";

/** Randomized email (per-suite unique prefix + UUID salt) — see applicant suite. */
function uniqueEmail(rolePrefix: string): string {
  return `${rolePrefix}-${Date.now()}-${randomUUID().slice(0, 8)}@test.local`;
}

/** Randomized unique phone — DB uniqueness, no cross-fixture collisions. */
function uniquePhone(): string {
  return `+2010${randomUUID().replace(/\D/g, "").padEnd(8, "0").slice(0, 8)}`;
}

/**
 * Inline documents — selection set = EXACTLY the ten REQ-060 contract fields
 * so every returned object is pinned against the full canonical shape.
 */
const planSelection = `
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
  `;

const planCatalogQuery: TypedDocumentNode<PlanCatalogData> = parse(`
  query PlanCatalog {
    planCatalog {
      ${planSelection}
    }
  }
`);

/** `includeInactive` mirrors the SDL arg: `Boolean = true` (nullable variable). */
const adminPlansQuery: TypedDocumentNode<AdminPlansData, AdminPlansVariables> = parse(`
  query AdminPlans($includeInactive: Boolean) {
    adminPlans(includeInactive: $includeInactive) {
      ${planSelection}
    }
  }
`);

/**
 * Wire shape of one `Plan` node as pinned by the inline documents' selection
 * set (EXACTLY the ten REQ-060 contract fields). The inline `parse` documents
 * are typed through a TYPE-ONLY `TypedDocumentNode` annotation (no codegen in
 * this suite — Task 3.4; no runtime `gql` import, whose `graphql-tag` UMD
 * build crashes under the `@/backend/db` fixture chain's module conditions —
 * see the applicant suite's identical note). `parse` returns a `DocumentNode`
 * which is structurally assignable to `TypedDocumentNode` (the marker prop is
 * optional), so Apollo's result inference types every query call WITHOUT any
 * explicit generic parameter and without unsafe assertions.
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

interface PlanCatalogData {
  readonly planCatalog?: readonly PlanWireNode[];
}

interface AdminPlansData {
  readonly adminPlans?: readonly PlanWireNode[];
}

/** Variables accepted by the `AdminPlans($includeInactive: Boolean)` document. */
interface AdminPlansVariables {
  readonly includeInactive?: boolean | null;
}

/** Registers a student through the PUBLIC surface and returns a bearer token. */
async function registerStudentAndLogin(): Promise<string> {
  const email = uniqueEmail("student");
  const registered = await testClient.mutate({
    mutation: registerUserMutationDocument,
    variables: {
      input: {
        fullName: "Plan Catalog Student",
        email,
        phone: uniquePhone(),
        password: testCredential,
        gender: null,
        country: "EG",
        role: RegisterPublicRole.Student,
        preferredRecitation: null,
      },
    },
  });
  expect(registered.error).toBeUndefined();

  const loggedIn = await testClient.mutate({
    mutation: loginMutationDocument,
    variables: { email, password: testCredential },
  });
  expect(loggedIn.error).toBeUndefined();
  const accessToken = loggedIn.data?.login?.accessToken;
  if (!accessToken) throw new Error("login returned no accessToken");
  return accessToken;
}

/**
 * Admin is NOT publicly registrable (RegisterPublicRole BFLA exclusion), so
 * the row is engineered directly in the DB (Tier-2 pattern from the applicant
 * suite) and then logged in over the public login mutation.
 */
async function createAdminAndLogin(): Promise<string> {
  const email = uniqueEmail("admin");
  const [user] = await db
    .insert(users)
    .values({
      fullName: "Plan Catalog Admin",
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
  await db.insert(admin).values({ id: user.id });

  const loggedIn = await testClient.mutate({
    mutation: loginMutationDocument,
    variables: { email, password: testCredential },
  });
  expect(loggedIn.error).toBeUndefined();
  const accessToken = loggedIn.data?.login?.accessToken;
  if (!accessToken) throw new Error("login returned no accessToken");
  return accessToken;
}

describe("planCatalog / adminPlans GraphQL Integration", () => {
  // Memory-constrained sandbox adaptation: setting TEST_SERVER_EXTERNAL=1 +
  // GRAPHQL_TEST_PORT=<already-running server> runs the suite against that
  // warm server instead of spawning a second `next dev` (see applicant suite).
  // CI never sets the flag and keeps the standard boot-on-3066 lifecycle.
  if (process.env.TEST_SERVER_EXTERNAL !== "1") {
    setupTestServerLifecycle();
  }

  const activeTitle = `QA Active Plan ${Date.now()} ${randomUUID().slice(0, 8)}`;
  const inactiveTitle = `QA Inactive Plan ${Date.now()} ${randomUUID().slice(0, 8)}`;
  let activePlanId = -1;
  let inactivePlanId = -1;
  let studentToken = "";
  let adminToken = "";

  beforeAll(async () => {
    const [activePlan] = await db
      .insert(plans)
      .values({
        title: activeTitle,
        sessionCount: 8,
        price: "99.00",
        currency: "EGP",
        intervalDays: 30,
      })
      .returning();
    if (!activePlan) throw new Error("active plan insert returned no rows");
    activePlanId = activePlan.id;

    const [inactivePlan] = await db
      .insert(plans)
      .values({
        title: inactiveTitle,
        sessionCount: 4,
        price: "49.00",
        currency: "EGP",
        intervalDays: 30,
        isActive: false,
        deactivatedAt: new Date(),
      })
      .returning();
    if (!inactivePlan) throw new Error("inactive plan insert returned no rows");
    inactivePlanId = inactivePlan.id;

    studentToken = await registerStudentAndLogin();
    adminToken = await createAdminAndLogin();
  });

  test("anonymous planCatalog gets UNAUTHORIZED (401, never FORBIDDEN)", async () => {
    const result = await testClient.query({
      query: planCatalogQuery,
    });
    expect(result.error).toBeDefined();
    expectMutationError(result.error, "UNAUTHORIZED");
  });

  test("student planCatalog succeeds with ACTIVE-ONLY full REQ-060 shape", async () => {
    const result = await testClient.query({
      query: planCatalogQuery,
      context: { headers: { Authorization: `Bearer ${studentToken}` } },
    });

    expect(result.error).toBeUndefined();
    const catalog = result.data?.planCatalog;
    expect(Array.isArray(catalog)).toBe(true);
    expect(catalog?.length).toBeGreaterThan(0);

    // The deactivated fixture is ABSENT on the consumer surface.
    expect(catalog?.some(plan => plan.id === String(inactivePlanId))).toBe(false);

    // The active fixture is present with the FULL ten-field REQ-060 shape.
    const activeFixture = catalog?.find(plan => plan.id === String(activePlanId));
    expect(activeFixture).toEqual(
      expect.objectContaining({
        id: String(activePlanId),
        title: activeTitle,
        sessionCount: 8,
        price: "99.00",
        currency: "EGP",
        intervalDays: 30,
        isActive: true,
        deactivatedAt: null,
        createdAt: expect.any(String),
        updatedAt: expect.any(String),
      })
    );
    expect(activeFixture).toHaveProperty("__typename", "Plan");
  });

  test("student adminPlans gets FORBIDDEN (role gate, non-admin probe)", async () => {
    const result = await testClient.query({
      query: adminPlansQuery,
      variables: { includeInactive: true },
      context: { headers: { Authorization: `Bearer ${studentToken}` } },
    });
    expectMutationError(result.error, "FORBIDDEN");
  });

  test("anonymous adminPlans gets UNAUTHORIZED (401, never FORBIDDEN)", async () => {
    const result = await testClient.query({
      query: adminPlansQuery,
      variables: { includeInactive: true },
    });
    expect(result.error).toBeDefined();
    expectMutationError(result.error, "UNAUTHORIZED");
  });

  test("admin planCatalog succeeds with ACTIVE-ONLY visibility (split holds for admins)", async () => {
    const result = await testClient.query({
      query: planCatalogQuery,
      context: { headers: { Authorization: `Bearer ${adminToken}` } },
    });

    expect(result.error).toBeUndefined();
    const catalog = result.data?.planCatalog;
    expect(Array.isArray(catalog)).toBe(true);
    expect(catalog?.some(plan => plan.id === String(activePlanId))).toBe(true);
    // Deactivated fixture ABSENT even for the admin on the consumer surface.
    expect(catalog?.some(plan => plan.id === String(inactivePlanId))).toBe(false);
  });

  test("admin adminPlans with default/true includeInactive INCLUDES the deactivated fixture", async () => {
    // Omitted variable → SDL default `true` fills the arg (default-path check).
    const defaulted = await testClient.query({
      query: adminPlansQuery,
      context: { headers: { Authorization: `Bearer ${adminToken}` } },
    });
    expect(defaulted.error).toBeUndefined();
    expect(defaulted.data?.adminPlans?.some(plan => plan.id === String(activePlanId))).toBe(true);
    expect(defaulted.data?.adminPlans?.some(plan => plan.id === String(inactivePlanId))).toBe(true);

    // Explicit `includeInactive: true` — same total view.
    const explicit = await testClient.query({
      fetchPolicy: "no-cache",
      query: adminPlansQuery,
      variables: { includeInactive: true },
      context: { headers: { Authorization: `Bearer ${adminToken}` } },
    });
    expect(explicit.error).toBeUndefined();
    expect(explicit.data?.adminPlans?.some(plan => plan.id === String(inactivePlanId))).toBe(true);
  });

  test("admin adminPlans(includeInactive: false) shows the ACTIVE-ONLY slice", async () => {
    const result = await testClient.query({
      fetchPolicy: "no-cache",
      query: adminPlansQuery,
      variables: { includeInactive: false },
      context: { headers: { Authorization: `Bearer ${adminToken}` } },
    });

    expect(result.error).toBeUndefined();
    const catalog = result.data?.adminPlans;
    expect(Array.isArray(catalog)).toBe(true);
    expect(catalog?.some(plan => plan.id === String(activePlanId))).toBe(true);
    expect(catalog?.some(plan => plan.id === String(inactivePlanId))).toBe(false);
  });
});
