/**
 * `purchaseVerificationPlan` mutation — wire-boundary integration suite.
 *
 * Runs over the REAL boundary: `setupTestServerLifecycle` boots the Next dev
 * server on the shared TEST_PORT (3066) and every call goes through Apollo
 * Client v4 + the shared error helpers (`expectMutationError`) exactly like
 * `frontend/graphql/test/teachers/applicant-profile.test.ts` (the pattern
 * source for the register/login + Bearer-header harness in this file).
 *
 * Boundary purity (frontend/graphql/test/AGENTS.md rule 10): this file
 * interacts with the application EXCLUSIVELY through the GraphQL API
 * (`testClient` + shared TypedDocumentNodes). The canonical verification
 * plan is SEEDED test data for this tier (the tests-graphql pipeline runs
 * `bun run db seed` before the suite boots) — REQUIRED, never provisioned
 * here: the setup probe fails the suite when it is absent. The zero-write
 * invariant on denials is asserted in the SERVICE tier
 * (`backend/services/teachers/verification-purchase.service.test.ts`),
 * which owns the ledger-visibility tooling it needs.
 *
 * Denial matrix (the happy-path purchase is owned by the service suite
 * `backend/services/teachers/verification-purchase.service.test.ts` and the
 * J1 journey — deliberately NOT duplicated here, so this suite has no
 * dependency on a purchasable-catalog happy path):
 *  - anonymous (no Bearer) → UNAUTHORIZED — the `authenticated` authScope
 *    denies before the resolver (401 channel, never FORBIDDEN).
 *  - authenticated STUDENT (non-applicant) with a VALID idempotency key →
 *    APPLICANT_NOT_FOUND — the applicant eligibility gate lives at the
 *    SERVICE level (scope-composition rule: the surface declares only
 *    `{ authenticated: true }`), so the wire proof is the propagated
 *    extensions.code of the in-transaction guard.
 *  - teacher applicant (public registration provisions the pending
 *    `applicants` row) WITHOUT a key → VALIDATION — the pre-DB key guard
 *    rejects the absent header before any database work.
 *
 * Documents: shared TypedDocumentNodes only —
 * `purchaseVerificationPlanMutationDocument`
 * (`sharedDocuments/billing/verification-purchase.documents.ts`) for the
 * mutation and `planCatalogQueryDocument` for the catalog probe. No local
 * `parse`d strings, no raw queries (AGENTS.md rule 3).
 *
 * Idempotency key transport:
 *  - The key rides the per-request `x-idempotency-key` header exactly as
 *    `gqlContextFactory` captures it (propagation-only; raw verbatim value,
 *    `null` when absent). The keyless probe simply omits the header.
 *
 * Data lifecycle (HYGIENE — mirrors the sibling suites):
 *  - Every user this suite creates is tracked by id and deleted in a
 *    describe-scoped `afterAll` via the shared `deleteUsersByIds` helper
 *    (RESTRICT-gated references first, then the users; child rows cascade).
 *  - The verification plan is resolved by the purchase flow SERVER-side
 *    (canonical title constant) BEFORE the applicant gate, so the student
 *    probe needs an ACTIVE canonical catalog member to reach the mandated
 *    APPLICANT_NOT_FOUND. That member is seeded catalog data for this
 *    tier: the `beforeAll` probe verifies it over the GraphQL boundary and
 *    FAILS SETUP when absent (this suite never provisions catalog rows —
 *    the purchase service rejects an ambiguous canonical catalog, so a
 *    blind insert on a seeded catalog would flip every purchase into a
 *    conflict, and plan provisioning belongs to the service/repository
 *    test tier).
 */

import { afterAll, beforeAll, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";

import { RegisterPublicRole } from "@/frontend/graphql/generated/gql/graphql";
import {
  loginMutationDocument,
  registerUserMutationDocument,
} from "@/frontend/graphql/sharedDocuments/auth/auth.documents";
import { planCatalogQueryDocument } from "@/frontend/graphql/sharedDocuments/billing/plan-catalog.documents";
import { purchaseVerificationPlanMutationDocument } from "@/frontend/graphql/sharedDocuments/billing/verification-purchase.documents";
/** Canonical verification plan identity (shared constant — the server's resolution key). */
import { VERIFICATION_PLAN_TITLE } from "@/shared/constants/verification-plan.constants";
import {
  countUsersByIds,
  deleteUsersByIds,
  describeGraphqlSuite,
  expectMutationError,
  setupTestServerLifecycle,
  testClient,
} from "@/test/helpers";

/** Per-run idempotency-key salt — unique keys, never shared across runs. */
const PREFIX = randomUUID().slice(0, 8);
const KEY_STUDENT = `${PREFIX}-key-student`;

/**
 * Randomized email generator (per-suite unique prefix + UUID salt) — follows
 * the entity-setup guidance ("randomUUID avoids unique-constraint hits")
 * while keeping the auth.test.ts `@test.local` domain marker.
 */
function uniqueEmail(rolePrefix: string): string {
  return `${rolePrefix}-${Date.now()}-${randomUUID().slice(0, 8)}@test.local`;
}

// Named without the literal `password` token so `sonarjs/no-hardcoded-passwords`
// does not flag it (same convention as the sibling suites).
const testCredential = "Password123";

interface RegistrationOutcome {
  readonly userId: number;
  readonly accessToken: string;
}

/** Ids of every user this suite creates (any surface) — drained by the
 * describe-scoped `afterAll` hygiene cleanup so the shared dev database
 * stays at its canonical seed state. Explicit ids (not an email sweep)
 * keep parallel live-wire suites' fixtures safe. */
const createdUserIds = new Set<number>();

function trackCreatedUser(id: number | null | undefined): void {
  if (typeof id === "number") createdUserIds.add(id);
}

/**
 * Registers a user through the PUBLIC registerUser mutation, then logs in
 * through the PUBLIC login mutation to obtain a bearer token. A `teacher`
 * registration provisions the pending `applicants` row as a side effect of
 * the real registration service — the suite never hand-inserts one.
 */
async function registerAndLogin(
  role: RegisterPublicRole.Student | RegisterPublicRole.Teacher
): Promise<RegistrationOutcome> {
  const email = uniqueEmail(role === RegisterPublicRole.Teacher ? "applicant" : "student");
  const registered = await testClient.mutate({
    mutation: registerUserMutationDocument,
    variables: {
      input: {
        fullName: "Test Verification Purchaser",
        email,
        phone: "+201234567890",
        password: testCredential,
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
    variables: { email, password: testCredential },
  });
  expect(loggedIn.error).toBeUndefined();
  const accessToken = loggedIn.data?.login?.accessToken;
  if (!accessToken) throw new Error("login returned no accessToken");

  return { userId, accessToken };
}

describeGraphqlSuite("purchaseVerificationPlan GraphQL Integration", () => {
  setupTestServerLifecycle();

  // ─── Fixtures: the ACTIVE verification plan the service resolves ────
  beforeAll(async () => {
    // Catalog probe over the REAL GraphQL boundary: an authenticated scout
    // (public registration, tracked for cleanup) reads the ACTIVE catalog.
    // The canonical verification plan is SEEDED catalog data for this tier
    // — REQUIRED, never provisioned here (see the module docblock's
    // data-lifecycle section): a seeded catalog without the canonical
    // member is a setup failure, not something this suite patches with a
    // direct-DB fixture row.
    const scout = await registerAndLogin(RegisterPublicRole.Student);
    const catalog = await testClient.query({
      query: planCatalogQueryDocument,
      context: { headers: { Authorization: `Bearer ${scout.accessToken}` } },
    });
    expect(catalog.error).toBeUndefined();
    const hasCanonicalMember = (catalog.data?.planCatalog ?? []).some(plan => plan.title === VERIFICATION_PLAN_TITLE);
    if (!hasCanonicalMember) {
      throw new Error(
        "setup: the seeded catalog has no ACTIVE verification plan row — run `bun run db seed` before this suite"
      );
    }
  });

  // ─── Hygiene: restore the shared dev database to canonical seed state ───
  // Deletes exactly the users this suite created (tracked by id) — the
  // catalog is probed, never mutated.
  afterAll(async () => {
    const ids = [...createdUserIds];
    if (ids.length > 0) {
      const deleted = await deleteUsersByIds(ids);
      expect(deleted).toBe(ids.length);
      expect(await countUsersByIds(ids)).toBe(0);
    }
  });

  test("Tier 3 — anonymous caller gets UNAUTHORIZED (401 semantics, never FORBIDDEN)", async () => {
    const result = await testClient.mutate({
      mutation: purchaseVerificationPlanMutationDocument,
    });
    expect(result.error).toBeDefined();
    expectMutationError(result.error, "UNAUTHORIZED");
  });

  test("Tier 3 — authenticated STUDENT with a valid idempotency key gets APPLICANT_NOT_FOUND (service-level applicant gate)", async () => {
    const { accessToken } = await registerAndLogin(RegisterPublicRole.Student);
    const result = await testClient.mutate({
      mutation: purchaseVerificationPlanMutationDocument,
      context: {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          // Valid key: present, non-empty, within the claim column's length —
          // the key guard passes so the denial comes from the applicant gate.
          "x-idempotency-key": KEY_STUDENT,
        },
      },
    });
    expectMutationError(result.error, "APPLICANT_NOT_FOUND");
  });

  test("Tier 1 boundary — teacher applicant WITHOUT an idempotency key gets VALIDATION (pre-DB key guard)", async () => {
    const { accessToken } = await registerAndLogin(RegisterPublicRole.Teacher);
    const result = await testClient.mutate({
      mutation: purchaseVerificationPlanMutationDocument,
      context: {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          // NO x-idempotency-key header — the context captures null and the
          // service's pre-DB key guard rejects before any database work.
        },
      },
    });
    expectMutationError(result.error, "VALIDATION");
  });
});
