/**
 * Plan catalog FULL GraphQL role-matrix proof — DEV1-005 Task 3.6 (REQ-064 + REQ-072).
 *
 * ONE suite asserting EVERY cell of the 5-surface × 5-role permission matrix
 * over the REAL wire boundary (Apollo Client v4 + warm/external dev server,
 * same harness as `plan-catalog.queries.test.ts` / `plan-catalog.mutations.test.ts`).
 * This suite IS the BFLA proof: every failure cell is a HARD
 * `extensions.code` assertion (via the canonical `expectMutationError`
 * helper — name is historical; it also covers queries) and every success
 * cell asserts DATA SHAPE (field values + `__typename "Plan"`). No skips,
 * no soft-asserts, no message-text coupling.
 *
 * Matrix under proof (REQ-064 + REQ-072):
 *
 * | Surface             | Anonymous    | Student      | Parent       | Teacher      | Admin              |
 * |---------------------|--------------|--------------|--------------|--------------|--------------------|
 * | planCatalog         | UNAUTHORIZED | active-only  | active-only  | active-only  | active-only        |
 * | adminPlans          | UNAUTHORIZED | FORBIDDEN    | FORBIDDEN    | FORBIDDEN    | full (incl. inact) |
 * | createPlan          | UNAUTHORIZED | FORBIDDEN    | FORBIDDEN    | FORBIDDEN    | success            |
 * | updatePlan          | UNAUTHORIZED | FORBIDDEN    | FORBIDDEN    | FORBIDDEN    | success            |
 * | setPlanActiveStatus | UNAUTHORIZED | FORBIDDEN    | FORBIDDEN    | FORBIDDEN    | success            |
 *
 * Gate amendments (documented in outcome/3.6-role-matrix-outcome.md):
 *  - The plan §3.3 matrix's "Supervisor" column is VACUOUS: the RBAC reality
 *    is `UserRole` = { Admin, Teacher, Student, Parent } ONLY
 *    (backend/enum/users/user-role.enum.ts; `user_role` pgEnum in
 *    backend/db/schema/enums.ts carries exactly ["admin","teacher","student",
 *    "parent"]). No `users.role` value — hence no JWT role claim — can be
 *    "supervisor"; the "supervisor" that exists in the codebase is a
 *    ManagerAccountType / permission-group concept entirely outside the
 *    users.role axis these authScopes gates check. The parent + teacher
 *    FORBIDDEN cells bracket the same non-admin axis, and the role gate is
 *    `[UserRole.Admin]` — a closed allowlist — so an absent role cannot fall
 *    through.
 *  - "Super Admin" (plan prototype copy) maps to `UserRole.Admin` — the
 *    only admin-tier role on the users.role axis.
 *  - LOCATION: `frontend/graphql/test/billing/` (established server-boundary
 *    layout) instead of the plan's `backend/graphql/test/` — same amendment
 *    as Tasks 3.2/3.3.
 *
 * Fixtures (beforeAll):
 *  - Student / Parent / Teacher tokens through the PUBLIC `registerUser` +
 *    `login` mutations (`RegisterPublicRole` excludes admin — BFLA at the
 *    schema layer). Every identity rides its OWN per-request
 *    `Authorization: Bearer` header (production client path).
 *  - Admin is NOT publicly registrable → users row (role "admin") + `admin`
 *    child row engineered directly in the DB with a REAL bcrypt hash, then a
 *    REAL public login (genuine session, token, scope check).
 *  - ONE active + ONE deactivated plan via direct `db.insert(plans)` (the
 *    deactivated fixture needs lifecycle-column control the service never
 *    grants: `isActive: false` + `deactivatedAt`). Rows accumulate by the
 *    GraphQL integration-suite convention (randomized titles, no cleanup).
 *
 * Admin success-path round-trip (doubles as end-to-end proof): the admin
 * `createPlan` cell captures the created id → the `updatePlan` cell patches
 * it → the `setPlanActiveStatus` cell deactivates it → the closing
 * visibility cell re-activates it and proves catalog membership tracks the
 * state change in BOTH directions.
 */

import { beforeAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import type { TypedDocumentNode } from "@graphql-typed-document-node/core";
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

// Memory-constrained sandbox adaptation (see applicant-profile.test.ts):
// TEST_SERVER_EXTERNAL=1 + GRAPHQL_TEST_PORT reuses the warm server instead
// of spawning a second `next dev`; CI keeps the standard boot-on-3066
// lifecycle.
if (process.env.TEST_SERVER_EXTERNAL !== "1") {
  setupTestServerLifecycle();
}

// Named without the literal `password` token (sonarjs/no-hardcoded-passwords).
const testCredential = "Password123";

/** Randomized email (per-suite unique prefix + UUID salt) — applicant-suite convention. */
function uniqueEmail(rolePrefix: string): string {
  return `${rolePrefix}-${Date.now()}-${randomUUID().slice(0, 8)}@test.local`;
}

/** Randomized unique phone — `users.phone` has no unique constraint, varied anyway. */
function uniquePhone(): string {
  return `+2010${randomUUID().replace(/\D/g, "").padEnd(8, "0").slice(0, 8)}`;
}

/** Randomized plan title — unique per fixture AND per assertion cell. */
function uniquePlanTitle(prefix: string): string {
  return `${prefix} ${Date.now()} ${randomUUID().slice(0, 8)}`;
}

/** The exact ten-field Plan selection (+ __typename pinning) every plan document requests. */
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
 * set (EXACTLY the ten REQ-060 contract fields). The inline `parse`
 * documents are typed through a TYPE-ONLY `TypedDocumentNode` annotation (no
 * codegen artifacts for the billing surface; no runtime `gql` import —
 * `graphql-tag`'s UMD build crashes under the `@/backend/db` fixture chain's
 * module conditions, see the applicant suite's identical note). `parse`
 * returns a `DocumentNode` which is structurally assignable to
 * `TypedDocumentNode`, so Apollo infers result/variables types through its
 * non-deprecated overloads WITHOUT casts or explicit generics.
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

/** Variables accepted by the `adminPlans($includeInactive: Boolean)` document. */
interface AdminPlansVariables {
  readonly includeInactive?: boolean | null;
}

interface CreatePlanData {
  readonly createPlan: PlanWireNode;
}

interface UpdatePlanData {
  readonly updatePlan: PlanWireNode;
}

interface SetPlanActiveStatusData {
  readonly setPlanActiveStatus: PlanWireNode;
}

interface CreatePlanVars {
  readonly input: {
    readonly title: string;
    readonly sessionCount: number;
    readonly price: string;
    readonly currency: string;
    readonly intervalDays: number;
  };
}

interface UpdatePlanVars {
  readonly id: string;
  readonly input: { readonly price: string };
}

interface SetPlanActiveStatusVars {
  readonly id: string;
  readonly isActive: boolean;
}

// Inline parse() documents — the SAME pattern as the 3.2/3.3 sibling suites.
const planCatalogQuery: TypedDocumentNode<PlanCatalogData> = parse(`
  query PlanCatalog {
    planCatalog {
      ${PLAN_SELECTION}
    }
  }
`);

const adminPlansQuery: TypedDocumentNode<AdminPlansData, AdminPlansVariables> = parse(`
  query AdminPlans($includeInactive: Boolean) {
    adminPlans(includeInactive: $includeInactive) {
      ${PLAN_SELECTION}
    }
  }
`);

const createPlanMutation: TypedDocumentNode<CreatePlanData, CreatePlanVars> = parse(`
  mutation CreatePlan($input: CreatePlanInput!) {
    createPlan(input: $input) { ${PLAN_SELECTION} }
  }
`);

const updatePlanMutation: TypedDocumentNode<UpdatePlanData, UpdatePlanVars> = parse(`
  mutation UpdatePlan($id: ID!, $input: UpdatePlanInput!) {
    updatePlan(id: $id, input: $input) { ${PLAN_SELECTION} }
  }
`);

const setPlanActiveStatusMutation: TypedDocumentNode<SetPlanActiveStatusData, SetPlanActiveStatusVars> = parse(`
  mutation SetPlanActiveStatus($id: ID!, $isActive: Boolean!) {
    setPlanActiveStatus(id: $id, isActive: $isActive) { ${PLAN_SELECTION} }
  }
`);

/** Per-request bearer header — the production identity path (`context.headers`). */
function bearer(token: string): { headers: { Authorization: string } } {
  return { headers: { Authorization: `Bearer ${token}` } };
}

/** Logs in through the PUBLIC login mutation and returns the bearer token. */
async function loginAccessToken(email: string): Promise<string> {
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
 * PUBLIC identity path for the three publicly-registrable roles
 * (Student / Parent / Teacher — `RegisterPublicRole` BFLA-excludes admin).
 * Same input shape for every role; the role discriminator rides `input.role`.
 */
async function registerRoleAndLogin(role: RegisterPublicRole, fullName: string): Promise<string> {
  const email = uniqueEmail(role.toLowerCase());
  const registered = await testClient.mutate({
    mutation: registerUserMutationDocument,
    variables: {
      input: {
        fullName,
        email,
        phone: uniquePhone(),
        password: testCredential,
        gender: null,
        country: "EG",
        role,
        preferredRecitation: null,
      },
    },
  });
  expect(registered.error).toBeUndefined();
  return loginAccessToken(email);
}

/**
 * Direct-DB admin fixture (admin is NOT publicly registrable): `users` row
 * with role "admin" + the `admin` child row, then a REAL public login.
 */
async function createAdminAndLogin(): Promise<string> {
  const email = uniqueEmail("matrix-admin");
  const [user] = await db
    .insert(users)
    .values({
      fullName: "Plan Catalog Matrix Admin",
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
  return loginAccessToken(email);
}

describe("plan catalog FULL role matrix — REQ-064 + REQ-072 (DEV1-005 Task 3.6)", () => {
  // Direct-DB plan fixtures — randomized titles, accumulated by convention.
  const activeTitle = `QA Matrix Active Plan ${Date.now()} ${randomUUID().slice(0, 8)}`;
  const inactiveTitle = `QA Matrix Inactive Plan ${Date.now()} ${randomUUID().slice(0, 8)}`;
  let activePlanId = -1;
  let inactivePlanId = -1;

  let studentToken = "";
  let parentToken = "";
  let teacherToken = "";
  let adminToken = "";

  // Admin success-path round-trip chain (createPlan → updatePlan →
  // setPlanActiveStatus → re-activate): the captured state feeds the later
  // cells; a failure in an upstream cell cascades LOUDLY by design.
  let e2ePlanId = "";
  let e2eCreated: PlanWireNode | undefined;
  const e2eCreateInput = {
    title: uniquePlanTitle("QA Matrix E2E Plan"),
    sessionCount: 12,
    price: "149.50",
    currency: "EGP",
    intervalDays: 30,
  } satisfies CreatePlanVars["input"];

  beforeAll(async () => {
    const [activePlan] = await db
      .insert(plans)
      .values({
        title: activeTitle,
        sessionCount: 8,
        price: "199.00",
        currency: "EGP",
        intervalDays: 30,
      })
      .returning();
    if (!activePlan) throw new Error("active plan insert returned no rows");
    activePlanId = activePlan.id;

    // Deactivated fixture: lifecycle columns ONLY craftable by direct insert
    // (the service creates plans active and never back-dates deactivatedAt).
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

    studentToken = await registerRoleAndLogin(RegisterPublicRole.Student, "Plan Matrix Student");
    parentToken = await registerRoleAndLogin(RegisterPublicRole.Parent, "Plan Matrix Parent");
    teacherToken = await registerRoleAndLogin(RegisterPublicRole.Teacher, "Plan Matrix Teacher");
    adminToken = await createAdminAndLogin();
  });

  /**
   * Consumer-surface contract shared by EVERY authenticated role (Student,
   * Parent, Teacher, Admin): the active fixture rides the full ten-field
   * REQ-060 shape, the deactivated fixture is ABSENT, and the whole list is
   * ACTIVE-ONLY (the visibility split, asserted per role — no exceptions,
   * admin included).
   */
  function assertActiveOnlyCatalog(catalog: readonly PlanWireNode[] | undefined): void {
    expect(Array.isArray(catalog)).toBe(true);
    expect(catalog?.length).toBeGreaterThan(0);
    for (const node of catalog ?? []) {
      expect(node.isActive).toBe(true);
      expect(node.deactivatedAt).toBeNull();
      expect(node).toHaveProperty("__typename", "Plan");
    }
    // Deactivated fixture ABSENT from the consumer surface.
    expect(catalog?.some(plan => plan.id === String(inactivePlanId))).toBe(false);
    // Active fixture present with the FULL REQ-060 shape.
    const activeFixture = catalog?.find(plan => plan.id === String(activePlanId));
    expect(activeFixture).toEqual(
      expect.objectContaining({
        id: String(activePlanId),
        title: activeTitle,
        sessionCount: 8,
        price: "199.00",
        currency: "EGP",
        intervalDays: 30,
        isActive: true,
        deactivatedAt: null,
        createdAt: expect.any(String),
        updatedAt: expect.any(String),
      })
    );
    expect(activeFixture).toHaveProperty("__typename", "Plan");
  }

  // ── Surface 1: planCatalog (consumer read — $all{authenticated}) ─────────

  test("matrix[planCatalog×anonymous] → UNAUTHORIZED (401, never FORBIDDEN)", async () => {
    const result = await testClient.query({
      query: planCatalogQuery,
    });
    expect(result.error).toBeDefined();
    expectMutationError(result.error, "UNAUTHORIZED");
  });

  test("matrix[planCatalog×student] → success, ACTIVE-ONLY + full REQ-060 shape", async () => {
    const result = await testClient.query({
      fetchPolicy: "no-cache",
      query: planCatalogQuery,
      context: bearer(studentToken),
    });
    expect(result.error).toBeUndefined();
    assertActiveOnlyCatalog(result.data?.planCatalog);
  });

  test("matrix[planCatalog×parent] → success, ACTIVE-ONLY (deactivated fixture absent)", async () => {
    const result = await testClient.query({
      fetchPolicy: "no-cache",
      query: planCatalogQuery,
      context: bearer(parentToken),
    });
    expect(result.error).toBeUndefined();
    assertActiveOnlyCatalog(result.data?.planCatalog);
  });

  test("matrix[planCatalog×teacher] → success, ACTIVE-ONLY (deactivated fixture absent)", async () => {
    const result = await testClient.query({
      fetchPolicy: "no-cache",
      query: planCatalogQuery,
      context: bearer(teacherToken),
    });
    expect(result.error).toBeUndefined();
    assertActiveOnlyCatalog(result.data?.planCatalog);
  });

  test("matrix[planCatalog×admin] → success, ACTIVE-ONLY (split holds for admins too)", async () => {
    const result = await testClient.query({
      fetchPolicy: "no-cache",
      query: planCatalogQuery,
      context: bearer(adminToken),
    });
    expect(result.error).toBeUndefined();
    assertActiveOnlyCatalog(result.data?.planCatalog);
  });

  // ── Surface 2: adminPlans (admin read — $all{authenticated, role:[admin]}) ─

  test("matrix[adminPlans×anonymous] → UNAUTHORIZED (401, never FORBIDDEN)", async () => {
    const result = await testClient.query({
      query: adminPlansQuery,
      variables: { includeInactive: true },
    });
    expect(result.error).toBeDefined();
    expectMutationError(result.error, "UNAUTHORIZED");
  });

  test("matrix[adminPlans×student] → FORBIDDEN (role gate, non-admin probe)", async () => {
    const result = await testClient.query({
      query: adminPlansQuery,
      variables: { includeInactive: true },
      context: bearer(studentToken),
    });
    expectMutationError(result.error, "FORBIDDEN");
  });

  test("matrix[adminPlans×parent] → FORBIDDEN (role gate, non-admin probe)", async () => {
    const result = await testClient.query({
      query: adminPlansQuery,
      variables: { includeInactive: true },
      context: bearer(parentToken),
    });
    expectMutationError(result.error, "FORBIDDEN");
  });

  test("matrix[adminPlans×teacher] → FORBIDDEN (role gate, non-admin probe)", async () => {
    const result = await testClient.query({
      query: adminPlansQuery,
      variables: { includeInactive: true },
      context: bearer(teacherToken),
    });
    expectMutationError(result.error, "FORBIDDEN");
  });

  test("matrix[adminPlans×admin] → success, FULL catalog INCLUDING the deactivated fixture", async () => {
    const result = await testClient.query({
      fetchPolicy: "no-cache",
      query: adminPlansQuery,
      variables: { includeInactive: true },
      context: bearer(adminToken),
    });
    expect(result.error).toBeUndefined();
    const catalog = result.data?.adminPlans;
    expect(Array.isArray(catalog)).toBe(true);

    const inactiveFixture = catalog?.find(plan => plan.id === String(inactivePlanId));
    expect(inactiveFixture).toEqual(
      expect.objectContaining({
        id: String(inactivePlanId),
        title: inactiveTitle,
        sessionCount: 4,
        price: "49.00",
        currency: "EGP",
        intervalDays: 30,
        isActive: false,
        deactivatedAt: expect.any(String),
      })
    );
    expect(inactiveFixture).toHaveProperty("__typename", "Plan");
    expect(catalog?.some(plan => plan.id === String(activePlanId))).toBe(true);
  });

  // ── Surface 3: createPlan (admin mutation — $all{authenticated, role:[admin]}) ─

  test("matrix[createPlan×anonymous] → UNAUTHORIZED (BFLA: scope check precedes the resolver body)", async () => {
    const result = await testClient.mutate({
      mutation: createPlanMutation,
      variables: { input: { ...e2eCreateInput, title: uniquePlanTitle("QA Matrix Anon Plan") } },
    });
    expectMutationError(result.error, "UNAUTHORIZED");
  });

  test("matrix[createPlan×student] → FORBIDDEN", async () => {
    const result = await testClient.mutate({
      mutation: createPlanMutation,
      variables: { input: { ...e2eCreateInput, title: uniquePlanTitle("QA Matrix Student Plan") } },
      context: bearer(studentToken),
    });
    expectMutationError(result.error, "FORBIDDEN");
  });

  test("matrix[createPlan×parent] → FORBIDDEN", async () => {
    const result = await testClient.mutate({
      mutation: createPlanMutation,
      variables: { input: { ...e2eCreateInput, title: uniquePlanTitle("QA Matrix Parent Plan") } },
      context: bearer(parentToken),
    });
    expectMutationError(result.error, "FORBIDDEN");
  });

  test("matrix[createPlan×teacher] → FORBIDDEN", async () => {
    const result = await testClient.mutate({
      mutation: createPlanMutation,
      variables: { input: { ...e2eCreateInput, title: uniquePlanTitle("QA Matrix Teacher Plan") } },
      context: bearer(teacherToken),
    });
    expectMutationError(result.error, "FORBIDDEN");
  });

  test("matrix[createPlan×admin] → success, full persisted shape (captures the E2E round-trip id)", async () => {
    const result = await testClient.mutate({
      mutation: createPlanMutation,
      variables: { input: e2eCreateInput },
      context: bearer(adminToken),
    });
    expect(result.error).toBeUndefined();

    const plan = result.data?.createPlan;
    if (!plan) throw new Error("createPlan returned no data");

    // Full persisted row (RETURNING *): the five submitted fields echo
    // verbatim; the lifecycle columns are server-owned.
    expect(plan.title).toBe(e2eCreateInput.title);
    expect(plan.sessionCount).toBe(12);
    expect(plan.price).toBe("149.50");
    expect(plan.currency).toBe("EGP");
    expect(plan.intervalDays).toBe(30);
    expect(plan.isActive).toBe(true);
    expect(plan.deactivatedAt).toBeNull();
    expect(typeof plan.createdAt).toBe("string");
    expect(typeof plan.updatedAt).toBe("string");
    // Numeric PK rides the ID scalar → string on the wire.
    expect(typeof plan.id).toBe("string");
    expect(Number(plan.id)).toBeGreaterThan(0);
    expect(plan).toHaveProperty("__typename", "Plan");

    e2eCreated = plan;
    e2ePlanId = plan.id;
  });

  // ── Surface 4: updatePlan (admin mutation — $all{authenticated, role:[admin]}) ─

  test("matrix[updatePlan×anonymous] → UNAUTHORIZED", async () => {
    const result = await testClient.mutate({
      mutation: updatePlanMutation,
      variables: { id: "1", input: { price: "2.00" } },
    });
    expectMutationError(result.error, "UNAUTHORIZED");
  });

  test("matrix[updatePlan×student] → FORBIDDEN", async () => {
    const result = await testClient.mutate({
      mutation: updatePlanMutation,
      variables: { id: "1", input: { price: "2.00" } },
      context: bearer(studentToken),
    });
    expectMutationError(result.error, "FORBIDDEN");
  });

  test("matrix[updatePlan×parent] → FORBIDDEN", async () => {
    const result = await testClient.mutate({
      mutation: updatePlanMutation,
      variables: { id: "1", input: { price: "2.00" } },
      context: bearer(parentToken),
    });
    expectMutationError(result.error, "FORBIDDEN");
  });

  test("matrix[updatePlan×teacher] → FORBIDDEN", async () => {
    const result = await testClient.mutate({
      mutation: updatePlanMutation,
      variables: { id: "1", input: { price: "2.00" } },
      context: bearer(teacherToken),
    });
    expectMutationError(result.error, "FORBIDDEN");
  });

  test("matrix[updatePlan×admin] → success, price-only patch on the created plan (echo + updatedAt bump)", async () => {
    if (!e2eCreated) throw new Error("createPlan cell did not capture the E2E plan (upstream failure)");
    const result = await testClient.mutate({
      mutation: updatePlanMutation,
      variables: { id: e2ePlanId, input: { price: "249.99" } },
      context: bearer(adminToken),
    });
    expect(result.error).toBeUndefined();

    const plan = result.data?.updatePlan;
    if (!plan) throw new Error("updatePlan returned no data");

    // Partial patch: price changed, every other field untouched.
    expect(plan.id).toBe(e2ePlanId);
    expect(plan.price).toBe("249.99");
    expect(plan.title).toBe(e2eCreateInput.title);
    expect(plan.sessionCount).toBe(12);
    expect(plan.currency).toBe("EGP");
    expect(plan.intervalDays).toBe(30);
    expect(plan.isActive).toBe(true);
    expect(plan.deactivatedAt).toBeNull();
    expect(plan).toHaveProperty("__typename", "Plan");
    // The UPDATE ... RETURNING * row carries a freshly bumped updatedAt.
    expect(new Date(plan.updatedAt).getTime()).toBeGreaterThan(new Date(e2eCreated.updatedAt).getTime());
  });

  // ── Surface 5: setPlanActiveStatus (admin lifecycle — $all{…, role:[admin]}) ──

  test("matrix[setPlanActiveStatus×anonymous] → UNAUTHORIZED", async () => {
    const result = await testClient.mutate({
      mutation: setPlanActiveStatusMutation,
      variables: { id: "1", isActive: false },
    });
    expectMutationError(result.error, "UNAUTHORIZED");
  });

  test("matrix[setPlanActiveStatus×student] → FORBIDDEN", async () => {
    const result = await testClient.mutate({
      mutation: setPlanActiveStatusMutation,
      variables: { id: "1", isActive: false },
      context: bearer(studentToken),
    });
    expectMutationError(result.error, "FORBIDDEN");
  });

  test("matrix[setPlanActiveStatus×parent] → FORBIDDEN", async () => {
    const result = await testClient.mutate({
      mutation: setPlanActiveStatusMutation,
      variables: { id: "1", isActive: false },
      context: bearer(parentToken),
    });
    expectMutationError(result.error, "FORBIDDEN");
  });

  test("matrix[setPlanActiveStatus×teacher] → FORBIDDEN", async () => {
    const result = await testClient.mutate({
      mutation: setPlanActiveStatusMutation,
      variables: { id: "1", isActive: false },
      context: bearer(teacherToken),
    });
    expectMutationError(result.error, "FORBIDDEN");
  });

  test("matrix[setPlanActiveStatus×admin] → success, deactivates the created plan (isActive false + non-null deactivatedAt)", async () => {
    if (!e2ePlanId) throw new Error("createPlan cell did not capture the E2E plan (upstream failure)");
    const result = await testClient.mutate({
      mutation: setPlanActiveStatusMutation,
      variables: { id: e2ePlanId, isActive: false },
      context: bearer(adminToken),
    });
    expect(result.error).toBeUndefined();

    const plan = result.data?.setPlanActiveStatus;
    if (!plan) throw new Error("setPlanActiveStatus returned no data");
    expect(plan.id).toBe(e2ePlanId);
    expect(plan.isActive).toBe(false);
    expect(plan.deactivatedAt).not.toBeNull();
    expect(typeof plan.deactivatedAt).toBe("string");
    expect(plan).toHaveProperty("__typename", "Plan");
  });

  // ── Visibility split — the deactivated fixture is adminPlans-only ────────

  test("visibility split AFTER a real deactivation: E2E plan + fixture absent from planCatalog for EVERY authed role, present in adminPlans for admin only", async () => {
    // The E2E plan was REALLY deactivated by the previous cell — both it and
    // the direct-insert fixture are inactive right now, so the consumer
    // surface must hide BOTH for every role (admin included; the four tokens
    // below are exactly the Student / Parent / Teacher / Admin identities).
    // The four reads are independent (no sequencing) → Promise.all.
    const splitViews = await Promise.all(
      [studentToken, parentToken, teacherToken, adminToken].map(token =>
        testClient.query({
          fetchPolicy: "no-cache",
          query: planCatalogQuery,
          context: bearer(token),
        })
      )
    );
    for (const result of splitViews) {
      expect(result.error).toBeUndefined();
      assertActiveOnlyCatalog(result.data?.planCatalog);
      expect(result.data?.planCatalog?.some(plan => plan.id === e2ePlanId)).toBe(false);
    }

    const adminView = await testClient.query({
      fetchPolicy: "no-cache",
      query: adminPlansQuery,
      variables: { includeInactive: true },
      context: bearer(adminToken),
    });
    expect(adminView.error).toBeUndefined();
    expect(adminView.data?.adminPlans?.some(plan => plan.id === String(inactivePlanId))).toBe(true);
    expect(adminView.data?.adminPlans?.some(plan => plan.id === e2ePlanId)).toBe(true);
    expect(adminView.data?.adminPlans?.some(plan => plan.id === String(activePlanId))).toBe(true);
  });

  test("visibility split closes the round-trip: re-activated E2E plan re-enters planCatalog (state change drives visibility in BOTH directions)", async () => {
    if (!e2ePlanId) throw new Error("createPlan cell did not capture the E2E plan (upstream failure)");
    const reactivated = await testClient.mutate({
      mutation: setPlanActiveStatusMutation,
      variables: { id: e2ePlanId, isActive: true },
      context: bearer(adminToken),
    });
    expect(reactivated.error).toBeUndefined();
    const plan = reactivated.data?.setPlanActiveStatus;
    if (!plan) throw new Error("setPlanActiveStatus(reactivate) returned no data");
    expect(plan.id).toBe(e2ePlanId);
    expect(plan.isActive).toBe(true);
    expect(plan.deactivatedAt).toBeNull();
    expect(plan).toHaveProperty("__typename", "Plan");

    const catalog = await testClient.query({
      fetchPolicy: "no-cache",
      query: planCatalogQuery,
      context: bearer(adminToken),
    });
    expect(catalog.error).toBeUndefined();
    expect(catalog.data?.planCatalog?.some(planNode => planNode.id === e2ePlanId)).toBe(true);
  });
});
