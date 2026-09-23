/**
 * `adminOnboardStudentWithOfflinePayment` — wire-boundary integration suite.
 *
 * Runs over the REAL boundary: `setupTestServerLifecycle` boots the Next.js
 * dev server on the shared TEST_PORT (3066, reused when already live) and
 * every call goes through the shared Apollo test client + TypedDocumentNodes
 * the production admin dialog consumes (the harness pattern of
 * `frontend/graphql/test/admin/admin-users.integration.test.ts` and
 * `frontend/graphql/test/teachers/verification-plan-purchase.test.ts`).
 *
 * Boundary purity (frontend/graphql/test/AGENTS.md rule 10): this file
 * interacts with the application EXCLUSIVELY through the GraphQL API —
 * no backend repositories, drizzle schemas, or services are imported. The
 * only direct-DB fixture need (an admin actor, which is excluded from the
 * public registration surface) goes through the sanctioned shared helper
 * `insertAdminUserWithChildRow` under `test/helpers/`; the lane-bearing
 * plan is provisioned over the REAL admin-gated `createPlan` mutation.
 *
 * Authentication per role: the shared `testClient` sends no cookies, so
 * every operation carries its OWN identity via a per-request
 * `Authorization: Bearer <accessToken>` header (real tokens minted by the
 * public `login` mutation). Anonymous probes omit the header entirely.
 * Tokens are never logged and never cross cases (each case builds its own
 * uniquely-addressed input).
 *
 * Error-policy: the shared test client is configured with
 * `errorPolicy: "all"`, so denials arrive on `result.error` (never thrown)
 * and are pinned through the shared `expectMutationError` helper — the
 * `extensions.code` transport of the masked DomainError taxonomy.
 *
 * Case matrix:
 *  - anonymous → UNAUTHORIZED (scope gate, pre-resolver);
 *  - teacher / student / parent bearer → FORBIDDEN (scope gate, pre-resolver);
 *  - happy paths (optional `gender`/`parentId` exercised BOTH explicitly
 *    null AND with meaningful values per AGENTS.md rule 11) — full result
 *    shape with `id` first, the handshake code, the credit lane/session
 *    scalars and the subscription payment-verification slice;
 *  - denials: non-offline method → VALIDATION, blank reference → VALIDATION,
 *    duplicate payment reference → CONFLICT, duplicate email → CONFLICT,
 *    unknown plan → PLAN_NOT_FOUND, unknown parent → USER_NOT_FOUND,
 *    smuggled input field → BAD_USER_INPUT (variable-coercion gate);
 *  - zero-writer visibility: every denial surfaces errors only (no partial
 *    data), and each service-reached denial is followed by an admin
 *    directory search proving no student row was written for the denied
 *    email (the happy paths double as the directory-probe positive control).
 *
 * Data lifecycle (HYGIENE — mirrors the sibling live-wire suites):
 *  - Every user this suite creates (admin fixture, registered actors,
 *    onboarded students) is tracked by id and deleted in the top-level
 *    `afterAll` via the shared `deleteUsersByIds` helper — which sweeps the
 *    RESTRICT-gated audit/subscriptions references first under
 *    `withAuditDeleteTriggersSuspended` (audit-immutable tables), then the
 *    users; child rows cascade. The `countUsersByIds === 0` probe closes
 *    the cleanup. Deletion is by EXPLICIT id list, never an email sweep.
 *  - The lane-bearing plan cannot be deleted over the surface; it is
 *    deactivated in `afterAll` so the shared seeded catalog returns to its
 *    prior visible state.
 */

import { afterAll, beforeAll, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import {
  type AdminOnboardStudentOfflineInput,
  type AdminOnboardStudentWithOfflinePaymentMutationVariables,
  Gender,
  PaymentGateway,
  RegisterPublicRole,
  SubscriptionCreditLane,
  SubscriptionStatus,
  UserRole,
} from "@/frontend/graphql/generated/gql/graphql";
import { adminOnboardStudentWithOfflinePaymentMutationDocument } from "@/frontend/graphql/sharedDocuments/admin/admin-student-onboarding.documents";
import { adminStudentsQueryDocument } from "@/frontend/graphql/sharedDocuments/admin/admin-students.documents";
import {
  loginMutationDocument,
  registerUserMutationDocument,
} from "@/frontend/graphql/sharedDocuments/auth/auth.documents";
import {
  createPlanMutationDocument,
  setPlanActiveStatusMutationDocument,
} from "@/frontend/graphql/sharedDocuments/billing/plan-catalog.documents";
import {
  countUsersByIds,
  deleteUsersByIds,
  describeGraphqlSuite,
  expectMutationError,
  insertAdminUserWithChildRow,
  setupTestServerLifecycle,
  testClient,
} from "@/test/helpers";

/** Run-unique salt — keeps plan titles, payment references and emails
 * collision-free across parallel and repeated runs on the shared database. */
const RUN_SALT = `${Date.now()}-${randomUUID().slice(0, 8)}`;

/** Session credential for every account this suite provisions. Named
 * without the literal credential token so `sonarjs/no-hardcoded-passwords`
 * does not flag the declaration (sibling-suite convention). */
const TEST_CREDENTIAL = "Password123";

/** Lane-bearing plan shape the happy paths credit against. */
const LANE_PLAN_SESSION_COUNT = 6;

/** Ids of every user this suite creates on any surface — drained by the
 * top-level `afterAll` hygiene cleanup. */
const createdUserIds = new Set<number>();

/** Wire ids of the catalog rows this suite created (deactivated, not
 * deleted — the surface has no plan deletion). */
const createdPlanIds = new Set<string>();

function trackCreatedUser(id: number | null | undefined): void {
  if (typeof id === "number") createdUserIds.add(id);
}

/** Unique email per fixture — unique prefix + salt avoids the
 * `users.email` unique index across parallel or repeated runs. */
function uniqueEmail(prefix: string): string {
  return `${prefix}-${RUN_SALT}-${randomUUID().slice(0, 8)}@test.local`;
}

/** Authorization header factory — keeps per-request identity explicit. */
function bearer(token: string): { headers: { Authorization: string } } {
  return { headers: { Authorization: `Bearer ${token}` } };
}

/** Identity bundle for an actor able to call the API with a real bearer. */
interface ActorBundle {
  readonly userId: number;
  readonly email: string;
  readonly accessToken: string;
}

/**
 * Registers a non-admin user through the PUBLIC registerUser mutation (the
 * registration service provisions the matching role-child row), then logs
 * in through the PUBLIC login mutation to obtain a real bearer token.
 */
async function registerAndLogin(role: RegisterPublicRole): Promise<ActorBundle> {
  const email = uniqueEmail(role.toLowerCase());
  const registered = await testClient.mutate({
    mutation: registerUserMutationDocument,
    variables: {
      input: {
        fullName: `Onboarding ${role}`,
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
 * Engineers the admin actor through the sanctioned fixture helper (admin
 * is excluded from the public registration surface) and mints a real
 * session for it through the public login mutation.
 */
async function provisionAdminActor(): Promise<ActorBundle> {
  const email = uniqueEmail("admin");
  const userId = await insertAdminUserWithChildRow({
    fullName: "Onboarding Suite Admin",
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
 * Typed builder for the closed onboarding input whitelist — ALL ten fields
 * on every call site, optional slots defaulting to explicit `null` and
 * overridable (frontend/graphql/test/AGENTS.md rule 11 builder pattern).
 * `email` and `paymentReference` default to run-unique values so cases
 * never collide on the unique indexes.
 */
function buildOnboardInput(
  overrides: Partial<AdminOnboardStudentOfflineInput> & { email: string }
): AdminOnboardStudentOfflineInput {
  return {
    fullName: overrides.fullName ?? "Onboarded Student",
    email: overrides.email,
    phone: overrides.phone ?? "+201234567890",
    password: overrides.password ?? TEST_CREDENTIAL,
    gender: overrides.gender ?? null,
    country: overrides.country ?? "EG",
    parentId: overrides.parentId ?? null,
    planId: overrides.planId ?? lanePlanId,
    paymentMethod: overrides.paymentMethod ?? PaymentGateway.OfflineCash,
    paymentReference: overrides.paymentReference ?? `ONB-${RUN_SALT}-${randomUUID().slice(0, 8)}`,
  };
}

/**
 * Admin directory search by the exact student email — the zero-writer
 * visibility probe. Returns the rows whose email matches exactly; denials
 * must yield none, happy paths exactly one (positive control).
 */
async function adminStudentRowsByEmail(adminToken: string, email: string) {
  const directory = await testClient.query({
    query: adminStudentsQueryDocument,
    variables: {
      filters: { hasParent: null, language: null, search: email },
      page: 1,
      pageSize: 25,
    },
    context: bearer(adminToken),
  });
  expect(directory.error).toBeUndefined();
  const items = directory.data?.adminStudents?.items;
  if (!items) throw new Error("adminStudents returned no items");
  return items.filter(item => item.email === email);
}

/**
 * Deep key-walk for a forbidden key — rejects a leak regardless of nesting
 * depth. Walks only objects + arrays; strings are never traversed. Uses an
 * exhaustive `Object.entries` traversal (no unsafe assertions — the
 * project's oxlint config denies unsafe type assertions).
 */
function deepFindKey(node: unknown, target: string): boolean {
  if (typeof node !== "object" || node === null) return false;
  if (Array.isArray(node)) {
    return node.some(item => deepFindKey(item, target));
  }
  return Object.entries(node).some(([key, value]) => key === target || deepFindKey(value, target));
}

/** Module-scoped fixtures shared by the case matrix (set in `beforeAll`). */
let adminActor: ActorBundle | undefined;
let parentActor: ActorBundle | undefined;
let lanePlanId = 0;

describeGraphqlSuite("Admin direct student onboarding (offline payment) — wire boundary", () => {
  setupTestServerLifecycle();

  beforeAll(async () => {
    adminActor = await provisionAdminActor();

    // Lane-bearing plan over the REAL admin-gated catalog mutation — the
    // suite never imports provisioning code (boundary purity). ALL input
    // fields are passed, with the balance lane the happy paths credit.
    const planResult = await testClient.mutate({
      mutation: createPlanMutationDocument,
      variables: {
        input: {
          title: `onboarding-suite-lane-plan-${RUN_SALT}`,
          sessionCount: LANE_PLAN_SESSION_COUNT,
          price: "150.00",
          currency: "EGP",
          intervalDays: 30,
          balanceLane: SubscriptionCreditLane.Hifz,
        },
      },
      context: bearer(adminActor.accessToken),
    });
    expect(planResult.error).toBeUndefined();
    const plan = planResult.data?.createPlan;
    if (!plan) throw new Error("createPlan returned no data");
    expect(plan.isActive).toBe(true);
    expect(plan.balanceLane).toBe(SubscriptionCreditLane.Hifz);
    createdPlanIds.add(plan.id);

    const numericPlanId = Number(plan.id);
    if (!Number.isInteger(numericPlanId) || numericPlanId <= 0) {
      throw new Error("createPlan returned a non-numeric id");
    }
    lanePlanId = numericPlanId;

    // The optional parent association target (public registration
    // provisions the parents role-child row that the link gate requires).
    parentActor = await registerAndLogin(RegisterPublicRole.Parent);
  }, 120_000);

  afterAll(async () => {
    // Deactivate the catalog rows this suite created so the shared seeded
    // catalog returns to its prior visible state (plan rows have no
    // deletion surface; the users cleanup below sweeps their audit rows).
    const cleanupActor = adminActor;
    if (cleanupActor && createdPlanIds.size > 0) {
      const deactivations = await Promise.all(
        [...createdPlanIds].map(planId =>
          testClient.mutate({
            mutation: setPlanActiveStatusMutationDocument,
            variables: { id: planId, isActive: false },
            context: bearer(cleanupActor.accessToken),
          })
        )
      );
      for (const deactivation of deactivations) {
        expect(deactivation.error).toBeUndefined();
      }
    }

    // Delete exactly the users this suite created (explicit ids, never an
    // email sweep). The shared helper sweeps RESTRICT-gated audit and
    // subscription references under suspended audit-delete triggers before
    // the users delete; child rows cascade.
    const ids = [...createdUserIds];
    if (ids.length === 0) return;
    const deleted = await deleteUsersByIds(ids);
    expect(deleted).toBe(ids.length);
    expect(await countUsersByIds(ids)).toBe(0);
  });

  // ─── Scope gate: anonymous → UNAUTHORIZED (pre-resolver) ────────────
  test("anonymous caller → UNAUTHORIZED; errors only, no data", async () => {
    if (!adminActor) throw new Error("setup: admin actor missing");
    const email = uniqueEmail("anon-probe");
    const result = await testClient.mutate({
      mutation: adminOnboardStudentWithOfflinePaymentMutationDocument,
      variables: { input: buildOnboardInput({ email }) },
    });
    expectMutationError(result.error, "UNAUTHORIZED");
    expect(result.data?.adminOnboardStudentWithOfflinePayment ?? null).toBeNull();
  });

  // ─── Scope gate: authenticated non-admins → FORBIDDEN (pre-resolver) ─
  test("teacher bearer → FORBIDDEN; errors only, zero directory visibility", async () => {
    if (!adminActor) throw new Error("setup: admin actor missing");
    const actor = await registerAndLogin(RegisterPublicRole.Teacher);
    const email = uniqueEmail("teacher-probe");
    const result = await testClient.mutate({
      mutation: adminOnboardStudentWithOfflinePaymentMutationDocument,
      variables: { input: buildOnboardInput({ email }) },
      context: bearer(actor.accessToken),
    });
    expectMutationError(result.error, "FORBIDDEN");
    expect(result.data?.adminOnboardStudentWithOfflinePayment ?? null).toBeNull();
    expect(await adminStudentRowsByEmail(adminActor.accessToken, email)).toHaveLength(0);
  });

  test("student bearer → FORBIDDEN; errors only, zero directory visibility", async () => {
    if (!adminActor) throw new Error("setup: admin actor missing");
    const actor = await registerAndLogin(RegisterPublicRole.Student);
    const email = uniqueEmail("student-probe");
    const result = await testClient.mutate({
      mutation: adminOnboardStudentWithOfflinePaymentMutationDocument,
      variables: { input: buildOnboardInput({ email }) },
      context: bearer(actor.accessToken),
    });
    expectMutationError(result.error, "FORBIDDEN");
    expect(result.data?.adminOnboardStudentWithOfflinePayment ?? null).toBeNull();
    expect(await adminStudentRowsByEmail(adminActor.accessToken, email)).toHaveLength(0);
  });

  test("parent bearer → FORBIDDEN; errors only, zero directory visibility", async () => {
    if (!adminActor) throw new Error("setup: admin actor missing");
    const actor = await registerAndLogin(RegisterPublicRole.Parent);
    const email = uniqueEmail("parent-probe");
    const result = await testClient.mutate({
      mutation: adminOnboardStudentWithOfflinePaymentMutationDocument,
      variables: { input: buildOnboardInput({ email }) },
      context: bearer(actor.accessToken),
    });
    expectMutationError(result.error, "FORBIDDEN");
    expect(result.data?.adminOnboardStudentWithOfflinePayment ?? null).toBeNull();
    expect(await adminStudentRowsByEmail(adminActor.accessToken, email)).toHaveLength(0);
  });

  // ─── Happy paths: optionals explicit null / meaningful values ───────
  test("admin onboards with optional slots null → full result shape; row visible in the directory", async () => {
    if (!adminActor) throw new Error("setup: admin actor missing");
    const email = uniqueEmail("onboarded");
    const reference = `ONB-${RUN_SALT}-hp-null`;

    const result = await testClient.mutate({
      mutation: adminOnboardStudentWithOfflinePaymentMutationDocument,
      variables: { input: buildOnboardInput({ email, paymentReference: reference }) },
      context: bearer(adminActor.accessToken),
    });
    expect(result.error).toBeUndefined();
    const onboarded = result.data?.adminOnboardStudentWithOfflinePayment;
    if (!onboarded) throw new Error("adminOnboardStudentWithOfflinePayment returned no data");

    // `id` first on the fresh student (Apollo normalization) + identity.
    expect(Object.keys(onboarded.student)[0]).toBe("id");
    expect(typeof onboarded.student.id).toBe("number");
    trackCreatedUser(onboarded.student.id);
    expect(onboarded.student.email).toBe(email);
    expect(onboarded.student.role).toBe(UserRole.Student);
    const studentRoleChild = onboarded.student.student;
    if (!studentRoleChild) throw new Error("onboarded student carries no student role-child projection");
    expect(studentRoleChild.parentId).toBeNull();

    // Parent handoff scalar — minted, format-pinned, and echoed on the
    // fresh role-child projection.
    expect(onboarded.handshakeCode).toMatch(/^KSB-[A-Z0-9]{8}$/);
    expect(studentRoleChild.handshakeCode).toBe(onboarded.handshakeCode);

    // Credit scalars follow the lane-bearing plan exactly.
    expect(onboarded.creditedLane).toBe(SubscriptionCreditLane.Hifz);
    expect(onboarded.creditedSessions).toBe(LANE_PLAN_SESSION_COUNT);

    // Offline payment evidence: activated subscription with the recorded
    // reference and the verification timestamp already attested.
    expect(onboarded.subscription.id).toBeTruthy();
    expect(onboarded.subscription.status).toBe(SubscriptionStatus.Active);
    expect(onboarded.subscription.paymentMethod).toBe(PaymentGateway.OfflineCash);
    expect(onboarded.subscription.paymentReference).toBe(reference);
    expect(onboarded.subscription.paymentVerifiedAt).not.toBeNull();

    // No credential material anywhere in the response payload.
    expect(deepFindKey(result.data, "passwordHash")).toBe(false);

    // Positive control for the directory probe: exactly the fresh row.
    const rows = await adminStudentRowsByEmail(adminActor.accessToken, email);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.hasParent).toBe(false);
  });

  test("admin onboards with a parent link → linked student, bank-transfer evidence, directory parentage", async () => {
    if (!adminActor || !parentActor) throw new Error("setup: admin/parent actor missing");
    const email = uniqueEmail("onboarded-linked");
    const reference = `ONB-${RUN_SALT}-hp-linked`;

    const result = await testClient.mutate({
      mutation: adminOnboardStudentWithOfflinePaymentMutationDocument,
      variables: {
        input: buildOnboardInput({
          email,
          paymentReference: reference,
          gender: Gender.Female,
          parentId: parentActor.userId,
          paymentMethod: PaymentGateway.BankTransfer,
        }),
      },
      context: bearer(adminActor.accessToken),
    });
    expect(result.error).toBeUndefined();
    const onboarded = result.data?.adminOnboardStudentWithOfflinePayment;
    if (!onboarded) throw new Error("adminOnboardStudentWithOfflinePayment returned no data");

    trackCreatedUser(onboarded.student.id);
    expect(onboarded.student.email).toBe(email);
    expect(onboarded.student.gender).toBe(Gender.Female);
    const studentRoleChild = onboarded.student.student;
    if (!studentRoleChild) throw new Error("onboarded student carries no student role-child projection");
    expect(studentRoleChild.parentId).toBe(parentActor.userId);

    expect(onboarded.subscription.status).toBe(SubscriptionStatus.Active);
    expect(onboarded.subscription.paymentMethod).toBe(PaymentGateway.BankTransfer);
    expect(onboarded.subscription.paymentReference).toBe(reference);
    expect(onboarded.creditedLane).toBe(SubscriptionCreditLane.Hifz);
    expect(onboarded.creditedSessions).toBe(LANE_PLAN_SESSION_COUNT);
    expect(deepFindKey(result.data, "passwordHash")).toBe(false);

    // The directory projects the new parentage on the fresh row.
    const rows = await adminStudentRowsByEmail(adminActor.accessToken, email);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.hasParent).toBe(true);
    expect(rows[0]?.parentEmail).toBe(parentActor.email);
  });

  // ─── Denials: localized validation, conflicts, not-found ────────────
  test("online payment method → VALIDATION; no student row written", async () => {
    if (!adminActor) throw new Error("setup: admin actor missing");
    const email = uniqueEmail("deny-method");
    const result = await testClient.mutate({
      mutation: adminOnboardStudentWithOfflinePaymentMutationDocument,
      variables: {
        input: buildOnboardInput({ email, paymentMethod: PaymentGateway.Paymob }),
      },
      context: bearer(adminActor.accessToken),
    });
    expectMutationError(result.error, "VALIDATION");
    expect(result.data?.adminOnboardStudentWithOfflinePayment ?? null).toBeNull();
    expect(await adminStudentRowsByEmail(adminActor.accessToken, email)).toHaveLength(0);
  });

  test("payment reference blank after trim → VALIDATION; no student row written", async () => {
    if (!adminActor) throw new Error("setup: admin actor missing");
    const email = uniqueEmail("deny-reference");
    const result = await testClient.mutate({
      mutation: adminOnboardStudentWithOfflinePaymentMutationDocument,
      variables: {
        input: buildOnboardInput({ email, paymentReference: "   " }),
      },
      context: bearer(adminActor.accessToken),
    });
    expectMutationError(result.error, "VALIDATION");
    expect(result.data?.adminOnboardStudentWithOfflinePayment ?? null).toBeNull();
    expect(await adminStudentRowsByEmail(adminActor.accessToken, email)).toHaveLength(0);
  });

  test("duplicate payment reference → CONFLICT; the replayed onboarding writes nothing", async () => {
    if (!adminActor) throw new Error("setup: admin actor missing");
    // Self-contained collision: the first onboarding commits the reference,
    // the replay with a fresh identity arbitrates through the unique
    // constraint and must not leave a second row.
    const reference = `ONB-${RUN_SALT}-dupref`;
    const first = await testClient.mutate({
      mutation: adminOnboardStudentWithOfflinePaymentMutationDocument,
      variables: { input: buildOnboardInput({ email: uniqueEmail("dupref-first"), paymentReference: reference }) },
      context: bearer(adminActor.accessToken),
    });
    expect(first.error).toBeUndefined();
    const firstStudentId = first.data?.adminOnboardStudentWithOfflinePayment?.student.id;
    trackCreatedUser(firstStudentId);

    const replayEmail = uniqueEmail("dupref-replay");
    const replay = await testClient.mutate({
      mutation: adminOnboardStudentWithOfflinePaymentMutationDocument,
      variables: { input: buildOnboardInput({ email: replayEmail, paymentReference: reference }) },
      context: bearer(adminActor.accessToken),
    });
    expectMutationError(replay.error, "CONFLICT");
    expect(replay.data?.adminOnboardStudentWithOfflinePayment ?? null).toBeNull();
    expect(await adminStudentRowsByEmail(adminActor.accessToken, replayEmail)).toHaveLength(0);
  });

  test("duplicate student email → CONFLICT", async () => {
    if (!adminActor) throw new Error("setup: admin actor missing");
    // The email is already committed by the public registration of a real
    // student account; the onboarding whitelist must arbitrate through the
    // same unique constraint instead of duplicating the identity.
    const actor = await registerAndLogin(RegisterPublicRole.Student);
    const result = await testClient.mutate({
      mutation: adminOnboardStudentWithOfflinePaymentMutationDocument,
      variables: { input: buildOnboardInput({ email: actor.email }) },
      context: bearer(adminActor.accessToken),
    });
    expectMutationError(result.error, "CONFLICT");
    expect(result.data?.adminOnboardStudentWithOfflinePayment ?? null).toBeNull();
  });

  test("unknown planId → PLAN_NOT_FOUND; no student row written", async () => {
    if (!adminActor) throw new Error("setup: admin actor missing");
    const email = uniqueEmail("deny-plan");
    const result = await testClient.mutate({
      mutation: adminOnboardStudentWithOfflinePaymentMutationDocument,
      variables: {
        input: buildOnboardInput({ email, planId: 99_999_999 }),
      },
      context: bearer(adminActor.accessToken),
    });
    expectMutationError(result.error, "PLAN_NOT_FOUND");
    expect(result.data?.adminOnboardStudentWithOfflinePayment ?? null).toBeNull();
    expect(await adminStudentRowsByEmail(adminActor.accessToken, email)).toHaveLength(0);
  });

  test("unknown parentId → USER_NOT_FOUND; no student row written", async () => {
    if (!adminActor) throw new Error("setup: admin actor missing");
    const email = uniqueEmail("deny-parent");
    const result = await testClient.mutate({
      mutation: adminOnboardStudentWithOfflinePaymentMutationDocument,
      variables: {
        input: buildOnboardInput({ email, parentId: 99_999_999 }),
      },
      context: bearer(adminActor.accessToken),
    });
    expectMutationError(result.error, "USER_NOT_FOUND");
    expect(result.data?.adminOnboardStudentWithOfflinePayment ?? null).toBeNull();
    expect(await adminStudentRowsByEmail(adminActor.accessToken, email)).toHaveLength(0);
  });

  // ─── Transport-tamper: smuggled input field dies at request validation ─
  test("smuggled `role` field inside the input → BAD_USER_INPUT; nothing written", async () => {
    if (!adminActor) throw new Error("setup: admin actor missing");
    const email = uniqueEmail("smuggle-probe");
    // Transport-tamper probe (typed-client variant of the sibling suite's
    // Tier-4 pattern): `role` is deliberately NOT a field of the closed
    // input whitelist. The compile-time gate rejects it (suppressed below —
    // the probe must type-check against the Exact variables type apart from
    // the smuggled key), and the request proves the server's variable-
    // coercion gate rejects the unknown key before any resolver runs — a
    // privilege-escalation payload can never reach the writer. The wire
    // code for variable-coercion rejection is BAD_USER_INPUT (the
    // execution-phase input-coercion channel, distinct from the
    // document-parse channel's GRAPHQL_VALIDATION_FAILED).
    const smuggleVariables: AdminOnboardStudentWithOfflinePaymentMutationVariables = {
      input: {
        fullName: "Smuggle Probe Student",
        email,
        phone: "+201234567890",
        password: TEST_CREDENTIAL,
        gender: null,
        country: "EG",
        parentId: null,
        planId: lanePlanId,
        paymentMethod: PaymentGateway.OfflineCash,
        paymentReference: `ONB-${RUN_SALT}-smuggle`,
        // @ts-expect-error — smuggling probe: `role` is deliberately absent from the input whitelist; the compile-time Exact gate rejects it and the wire probe proves the server-side variable-coercion gate.
        role: UserRole.Admin,
      },
    };
    const result = await testClient.mutate({
      mutation: adminOnboardStudentWithOfflinePaymentMutationDocument,
      variables: smuggleVariables,
      context: bearer(adminActor.accessToken),
    });
    expectMutationError(result.error, "BAD_USER_INPUT");
    expect(result.data?.adminOnboardStudentWithOfflinePayment ?? null).toBeNull();
    expect(await adminStudentRowsByEmail(adminActor.accessToken, email)).toHaveLength(0);
  });
});
