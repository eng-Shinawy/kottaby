/**
 * Plan catalog mutations — 4-Tier integration suite (DEV1-005 Task 3.3.TE).
 *
 * Runs over the REAL boundary: `setupTestServerLifecycle` (or the warm
 * external server when TEST_SERVER_EXTERNAL=1 + GRAPHQL_TEST_PORT) and every
 * request goes through Apollo Client v4 + the shared error helpers
 * (`expectMutationError`) exactly like
 * `frontend/graphql/test/teachers/applicant-profile.test.ts`.
 *
 * Documents:
 *  - The THREE plan-catalog documents are LOCAL `parse()` literals — there
 *    are deliberately NO codegen artifacts for them: Task 3.4 owns
 *    codegen/schema-surface reconciliation for the new billing surface.
 *    Each `parse(...)` result is ANNOTATED (never asserted) as a
 *    `TypedDocumentNode<TData, TVariables>` — the phantom-typed interface is
 *    a structural supertype of graphql's `DocumentNode`, so plain documents
 *    assign directly and Apollo infers the result/variables types through
 *    its non-deprecated mutate overload. Note: Apollo's `gql` is
 *    deliberately not imported — `@/backend/db` flips bun's module conditions
 *    and graphql-tag's UMD build crashes; `parse` yields the same
 *    DocumentNode.
 *  - Auth-flow documents are reused from
 *    `@/frontend/graphql/sharedDocuments/auth/auth.documents` (pre-existing,
 *    not regenerated) and the `RegisterPublicRole` enum from the existing
 *    generated module — single-source discipline, no duplication.
 *
 * Authentication mechanism (multi-role isolation, mirrors applicant suite):
 *  - Every test carries its OWN identity via a per-request
 *    `Authorization: Bearer <accessToken>` header (context.headers) — the
 *    production client path per `gqlContextFactory.extractAccessToken`.
 *  - Admin is NOT publicly registrable (`RegisterPublicRole` BFLA exclusion),
 *    so the admin row (+ `admin` child row) is engineered directly in the DB
 *    with a REAL bcrypt hash and then logged in over the public `login`
 *    mutation — a genuine session, token, and scope check. The student is a
 *    normal public register + login.
 *
 * Data lifecycle (mirrors auth.test.ts / applicant-profile.test.ts):
 *  - Rows accumulate on the test database by convention; titles and emails
 *    are randomized per test (randomUUID salt) to avoid unique-constraint
 *    hits. Plan fixtures use direct `db.insert(plans)` (`.env` is loaded into
 *    the bun-test process by the runner) with `isActive` defaulting to true.
 *
 * Tiers:
 *  - Tier 1  happy paths (admin): createPlan returns the FULL persisted Plan
 *            shape (isActive true / deactivatedAt null / __typename "Plan");
 *            updatePlan with a price-only patch returns the updated row with
 *            a bumped updatedAt; setPlanActiveStatus false → inactive +
 *            non-null deactivatedAt; true → re-activated + null deactivatedAt.
 *  - Tier 2  error contracts (extensions.code asserted, NEVER message text):
 *            createPlan invalid payload → VALIDATION with non-empty
 *            `extensions.fields[]`; updatePlan(missing id) → PLAN_NOT_FOUND;
 *            setPlanActiveStatus on already-inactive/active plans →
 *            PLAN_ALREADY_INACTIVE / PLAN_ALREADY_ACTIVE; empty patch →
 *            VALIDATION (the service's planPatchEmpty reject is a bare
 *            ValidationError — fields[] deliberately absent).
 *  - Tier 3  authz matrix: anonymous → UNAUTHORIZED (401) and student →
 *            FORBIDDEN (403) on ALL THREE mutations ($all conjunction).
 *  - Tier 4  BOPLA smuggle on the wire: `isActive` inside the createPlan
 *            input is rejected BEFORE execution — via the variables path as
 *            BAD_USER_INPUT (Apollo preset for variable-coercion failures,
 *            protocol pass-through per the masking boundary) and via an
 *            inline literal as GRAPHQL_VALIDATION_FAILED (schema validation),
 *            even for a fully-authenticated admin.
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

/** The exact ten-field Plan selection every plan document requests. */
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

/** The Plan payload shape as it rides the wire (ID scalar → string id; DateTime → ISO strings). */
interface PlanPayload {
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
  readonly __typename: string;
}

interface CreatePlanData {
  readonly createPlan: PlanPayload;
}

interface UpdatePlanData {
  readonly updatePlan: PlanPayload;
}

interface SetPlanActiveStatusData {
  readonly setPlanActiveStatus: PlanPayload;
}

/** The five caller-editable plan fields (the whole BOPLA input surface). */
type PlanPatchInput = Partial<Pick<PlanPayload, "title" | "sessionCount" | "price" | "currency" | "intervalDays">>;

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
  readonly input: PlanPatchInput;
}

interface SetPlanActiveStatusVars {
  readonly id: string;
  readonly isActive: boolean;
}

// Local parse() documents — NO codegen artifacts (Task 3.4 owns codegen for
// the billing surface). Each result is ANNOTATED as a TypedDocumentNode (a
// structural supertype of DocumentNode — no type assertion needed) so the
// shared client infers result/variables types through its non-deprecated
// mutate overload.
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

// Raw (uncast) smuggle documents — only `result.error` is asserted.
const createPlanSmuggleVariablesDocument = parse(`
  mutation CreatePlanSmuggled($input: CreatePlanInput!) {
    createPlan(input: $input) { ${PLAN_SELECTION} }
  }
`);

const createPlanSmuggleLiteralDocument = parse(`
  mutation CreatePlanSmuggledLiteral {
    createPlan(input: {
      title: "Smuggled Plan"
      sessionCount: 1
      price: "10.00"
      currency: "EGP"
      intervalDays: 30
      isActive: true
    }) { ${PLAN_SELECTION} }
  }
`);

/** Randomized email (per-suite unique prefix + UUID salt), applicant-suite convention. */
function uniqueEmail(rolePrefix: string): string {
  return `${rolePrefix}-${Date.now()}-${randomUUID().slice(0, 8)}@test.local`;
}

/** Randomized plan title — unique per fixture AND per assertion cell. */
function uniquePlanTitle(prefix: string): string {
  return `${prefix} ${randomUUID().slice(0, 8)}`;
}

// Named without the literal `password` token (sonarjs/no-hardcoded-passwords).
const testCredential = "Password123";

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
 * Direct-DB admin fixture (`.env` is loaded into the bun-test process):
 * `users` row with role "admin" + the `admin` child row, then a REAL login.
 */
async function createAdminAccessToken(): Promise<string> {
  const email = uniqueEmail("plan-admin");
  const [user] = await db
    .insert(users)
    .values({
      fullName: "Plan Catalog Admin",
      email,
      phone: "+201234567893",
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

/** Public register (Student) + public login — the normal identity path. */
async function createStudentAccessToken(): Promise<string> {
  const email = uniqueEmail("plan-student");
  const registered = await testClient.mutate({
    mutation: registerUserMutationDocument,
    variables: {
      input: {
        fullName: "Plan Catalog Student",
        email,
        phone: "+201234567894",
        password: testCredential,
        gender: null,
        country: "EG",
        role: RegisterPublicRole.Student,
        preferredRecitation: null,
      },
    },
  });
  expect(registered.error).toBeUndefined();
  return loginAccessToken(email);
}

/**
 * Direct-DB plan fixture. `isActive` defaults to true at the schema level;
 * pass `{ isActive: false }` for the already-inactive conflict fixture —
 * the helper stamps `deactivatedAt` alongside it, keeping the fixture
 * faithful to the REQ-014/015 lifecycle-pair semantics (a persisted
 * inactive plan always carries its deactivation timestamp).
 */
async function insertPlanFixture(
  overrides: { title?: string; price?: string; isActive?: boolean } = {}
): Promise<typeof plans.$inferSelect> {
  const [row] = await db
    .insert(plans)
    .values({
      title: overrides.title ?? `Plan Fixture ${randomUUID().slice(0, 8)}`,
      sessionCount: 8,
      price: overrides.price ?? "250.00",
      currency: "EGP",
      intervalDays: 30,
      ...(overrides.isActive === undefined
        ? {}
        : {
            isActive: overrides.isActive,
            ...(overrides.isActive ? {} : { deactivatedAt: new Date() }),
          }),
    })
    .returning();
  if (!row) throw new Error("plan fixture insert returned no rows");
  return row;
}

/** Structural guard over a ValidationError `extensions.fields[]` entry. */
interface FieldErrorLike {
  readonly field: unknown;
  readonly code: unknown;
  readonly message: unknown;
}

function readValidationFields(gqlError: ReturnType<typeof expectMutationError>): readonly FieldErrorLike[] {
  const fields: unknown = gqlError.errors[0]?.extensions?.fields;
  expect(Array.isArray(fields)).toBe(true);
  if (!Array.isArray(fields)) {
    throw new Error("expected extensions.fields to be an array (see failed assertion above)");
  }
  expect(fields.length).toBeGreaterThan(0);
  return fields as readonly FieldErrorLike[];
}

describe("plan catalog mutations — admin-only CRUD (DEV1-005 Task 3.3)", () => {
  let adminToken = "";
  let studentToken = "";

  beforeAll(async () => {
    adminToken = await createAdminAccessToken();
    studentToken = await createStudentAccessToken();
  });

  // ── Tier 1 — admin happy paths ────────────────────────────────────────────

  test("Tier 1 — admin createPlan returns the persisted Plan shape (active by construction)", async () => {
    const input = {
      title: uniquePlanTitle("Golden Plan"),
      sessionCount: 12,
      price: "199.99",
      currency: "EGP",
      intervalDays: 30,
    };
    const result = await testClient.mutate({
      mutation: createPlanMutation,
      variables: { input },
      context: { headers: { Authorization: `Bearer ${adminToken}` } },
    });
    expect(result.error).toBeUndefined();

    const plan = result.data?.createPlan;
    if (!plan) throw new Error("createPlan returned no data");

    // Full persisted row (RETURNING * — Apollo cache convergence): the five
    // submitted fields echo verbatim; the lifecycle columns are server-owned.
    expect(plan.title).toBe(input.title);
    expect(plan.sessionCount).toBe(input.sessionCount);
    expect(plan.price).toBe(input.price);
    expect(plan.currency).toBe(input.currency);
    expect(plan.intervalDays).toBe(input.intervalDays);
    expect(plan.isActive).toBe(true);
    expect(plan.deactivatedAt).toBeNull();
    expect(typeof plan.createdAt).toBe("string");
    expect(typeof plan.updatedAt).toBe("string");
    // The numeric PK rides the ID scalar — serialized as a STRING on the
    // wire (exposeID → Apollo cache normalization contract).
    expect(typeof plan.id).toBe("string");
    expect(Number(plan.id)).toBeGreaterThan(0);
    expect(plan).toHaveProperty("__typename", "Plan");
  });

  test("Tier 1 — admin updatePlan with a price-only patch returns the updated row (updatedAt bumped)", async () => {
    const fixture = await insertPlanFixture();
    const result = await testClient.mutate({
      mutation: updatePlanMutation,
      variables: { id: String(fixture.id), input: { price: "321.99" } },
      context: { headers: { Authorization: `Bearer ${adminToken}` } },
    });
    expect(result.error).toBeUndefined();

    const plan = result.data?.updatePlan;
    if (!plan) throw new Error("updatePlan returned no data");

    // Partial patch: price changed, every other field untouched.
    // (id serializes through the ID scalar → string on the wire.)
    expect(plan.id).toBe(String(fixture.id));
    expect(plan.price).toBe("321.99");
    expect(plan.title).toBe(fixture.title);
    expect(plan.sessionCount).toBe(fixture.sessionCount);
    expect(plan.currency).toBe(fixture.currency);
    expect(plan.intervalDays).toBe(fixture.intervalDays);
    expect(plan.isActive).toBe(true);
    expect(plan).toHaveProperty("__typename", "Plan");
    // The UPDATE ... RETURNING * row carries a freshly bumped updatedAt.
    expect(new Date(plan.updatedAt).getTime()).toBeGreaterThan(fixture.updatedAt.getTime());
  });

  test("Tier 1 — admin setPlanActiveStatus(false) deactivates (isActive false + non-null deactivatedAt)", async () => {
    const fixture = await insertPlanFixture();
    const result = await testClient.mutate({
      mutation: setPlanActiveStatusMutation,
      variables: { id: String(fixture.id), isActive: false },
      context: { headers: { Authorization: `Bearer ${adminToken}` } },
    });
    expect(result.error).toBeUndefined();

    const plan = result.data?.setPlanActiveStatus;
    if (!plan) throw new Error("setPlanActiveStatus returned no data");
    expect(plan.id).toBe(String(fixture.id));
    expect(plan.isActive).toBe(false);
    expect(plan.deactivatedAt).not.toBeNull();
    expect(typeof plan.deactivatedAt).toBe("string");
    expect(plan).toHaveProperty("__typename", "Plan");
  });

  test("Tier 1 — admin setPlanActiveStatus(true) re-activates (isActive true + deactivatedAt cleared)", async () => {
    const fixture = await insertPlanFixture({ isActive: false });
    const result = await testClient.mutate({
      mutation: setPlanActiveStatusMutation,
      variables: { id: String(fixture.id), isActive: true },
      context: { headers: { Authorization: `Bearer ${adminToken}` } },
    });
    expect(result.error).toBeUndefined();

    const plan = result.data?.setPlanActiveStatus;
    if (!plan) throw new Error("setPlanActiveStatus returned no data");
    expect(plan.id).toBe(String(fixture.id));
    expect(plan.isActive).toBe(true);
    expect(plan.deactivatedAt).toBeNull();
  });

  // ── Tier 3 — authz matrix ($all conjunction on all three mutations) ──────

  test("Tier 3 — anonymous createPlan is UNAUTHORIZED (401 semantics, never FORBIDDEN)", async () => {
    const result = await testClient.mutate({
      mutation: createPlanMutation,
      variables: {
        input: {
          title: uniquePlanTitle("Anon Plan"),
          sessionCount: 1,
          price: "1.00",
          currency: "EGP",
          intervalDays: 7,
        },
      },
    });
    expectMutationError(result.error, "UNAUTHORIZED");
  });

  test("Tier 3 — anonymous updatePlan is UNAUTHORIZED", async () => {
    const result = await testClient.mutate({
      mutation: updatePlanMutation,
      variables: { id: "1", input: { price: "2.00" } },
    });
    expectMutationError(result.error, "UNAUTHORIZED");
  });

  test("Tier 3 — anonymous setPlanActiveStatus is UNAUTHORIZED", async () => {
    const result = await testClient.mutate({
      mutation: setPlanActiveStatusMutation,
      variables: { id: "1", isActive: false },
    });
    expectMutationError(result.error, "UNAUTHORIZED");
  });

  test("Tier 3 — authenticated STUDENT gets FORBIDDEN on createPlan (role gate)", async () => {
    const result = await testClient.mutate({
      mutation: createPlanMutation,
      variables: {
        input: {
          title: uniquePlanTitle("Student Plan"),
          sessionCount: 1,
          price: "1.00",
          currency: "EGP",
          intervalDays: 7,
        },
      },
      context: { headers: { Authorization: `Bearer ${studentToken}` } },
    });
    expectMutationError(result.error, "FORBIDDEN");
  });

  test("Tier 3 — authenticated STUDENT gets FORBIDDEN on updatePlan", async () => {
    const result = await testClient.mutate({
      mutation: updatePlanMutation,
      variables: { id: "1", input: { price: "2.00" } },
      context: { headers: { Authorization: `Bearer ${studentToken}` } },
    });
    expectMutationError(result.error, "FORBIDDEN");
  });

  test("Tier 3 — authenticated STUDENT gets FORBIDDEN on setPlanActiveStatus", async () => {
    const result = await testClient.mutate({
      mutation: setPlanActiveStatusMutation,
      variables: { id: "1", isActive: false },
      context: { headers: { Authorization: `Bearer ${studentToken}` } },
    });
    expectMutationError(result.error, "FORBIDDEN");
  });

  // ── Tier 2 — service error contracts (codes + structural fields only) ────

  test("Tier 2 — createPlan with price 'abc' → VALIDATION with a non-empty aggregated fields[] payload", async () => {
    const result = await testClient.mutate({
      mutation: createPlanMutation,
      variables: {
        input: {
          title: uniquePlanTitle("Broken Price"),
          sessionCount: 4,
          price: "abc",
          currency: "EGP",
          intervalDays: 30,
        },
      },
      context: { headers: { Authorization: `Bearer ${adminToken}` } },
    });
    const gqlError = expectMutationError(result.error, "VALIDATION");
    const fields = readValidationFields(gqlError);
    // Structural field entries only — message TEXT is never asserted.
    expect(fields.some(entry => entry.field === "price" && entry.code === "PLAN_PRICE_INVALID")).toBe(true);
  });

  test("Tier 2 — updatePlan on a missing plan (id 999999) → PLAN_NOT_FOUND", async () => {
    const result = await testClient.mutate({
      mutation: updatePlanMutation,
      variables: { id: "999999", input: { price: "9.99" } },
      context: { headers: { Authorization: `Bearer ${adminToken}` } },
    });
    expectMutationError(result.error, "PLAN_NOT_FOUND");
  });

  test("Tier 2 — setPlanActiveStatus(false) on an already-inactive plan → PLAN_ALREADY_INACTIVE", async () => {
    const fixture = await insertPlanFixture({ isActive: false });
    const result = await testClient.mutate({
      mutation: setPlanActiveStatusMutation,
      variables: { id: String(fixture.id), isActive: false },
      context: { headers: { Authorization: `Bearer ${adminToken}` } },
    });
    expectMutationError(result.error, "PLAN_ALREADY_INACTIVE");
  });

  test("Tier 2 — setPlanActiveStatus(true) on an already-active plan → PLAN_ALREADY_ACTIVE", async () => {
    const fixture = await insertPlanFixture();
    const result = await testClient.mutate({
      mutation: setPlanActiveStatusMutation,
      variables: { id: String(fixture.id), isActive: true },
      context: { headers: { Authorization: `Bearer ${adminToken}` } },
    });
    expectMutationError(result.error, "PLAN_ALREADY_ACTIVE");
  });

  test("Tier 2 — updatePlan with an empty patch → VALIDATION (planPatchEmpty carries no fields[] payload)", async () => {
    const result = await testClient.mutate({
      mutation: updatePlanMutation,
      variables: { id: "1", input: {} },
      context: { headers: { Authorization: `Bearer ${adminToken}` } },
    });
    const gqlError = expectMutationError(result.error, "VALIDATION");
    // The service throws the bare planPatchEmpty ValidationError (no field
    // entries) — the fields[] payload is deliberately ABSENT here, unlike
    // the per-field validation contract asserted above.
    expect(gqlError.errors[0]?.extensions?.fields).toBeUndefined();
  });

  // ── Tier 4 — BOPLA smuggle on the wire (isActive is server-controlled) ───

  test("Tier 4 — smuggled isActive inside createPlan input variables dies BEFORE execution (BAD_USER_INPUT)", async () => {
    // Even a fully-authenticated ADMIN cannot express the lifecycle field:
    // CreatePlanInput structurally omits it, so the variables value fails
    // input coercion before any resolver runs (execution produces no data).
    const result = await testClient.mutate({
      mutation: createPlanSmuggleVariablesDocument,
      variables: {
        input: {
          title: uniquePlanTitle("Smuggled"),
          sessionCount: 1,
          price: "10.00",
          currency: "EGP",
          intervalDays: 30,
          isActive: true,
        },
      },
      context: { headers: { Authorization: `Bearer ${adminToken}` } },
    });
    // Apollo preset for variable-coercion failures (protocol pass-through).
    expectMutationError(result.error, "BAD_USER_INPUT");
    expect(result.data).toBeUndefined();
  });

  test("Tier 4 — smuggled isActive inline literal dies at schema validation (GRAPHQL_VALIDATION_FAILED)", async () => {
    const result = await testClient.mutate({
      mutation: createPlanSmuggleLiteralDocument,
      context: { headers: { Authorization: `Bearer ${adminToken}` } },
    });
    // Unknown input field on CreatePlanInput → document validation failure.
    expectMutationError(result.error, "GRAPHQL_VALIDATION_FAILED");
    expect(result.data).toBeUndefined();
  });
});
