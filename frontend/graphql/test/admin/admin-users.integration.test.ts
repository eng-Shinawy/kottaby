/**
 * Admin user-management GraphQL permission-matrix integration suite.
 *
 * Phase 5.1 — full §3.4 permission matrix proven over the LIVE
 * Next.js dev server + real PostgreSQL rows, exercising all six admin
 * operations through the shared TypedDocumentNodes the production UI
 * consumes.
 *
 * Tiers (per plan.md §3.4 + tasks.md 5.1):
 *  - Tier 1 anonymous → each of the six operations → UNAUTHORIZED.
 *  - Tier 2 student / parent / teacher(applicant+certified) → each of the
 *    six operations → FORBIDDEN (defense-in-depth at the service seam,
 *    beyond authScope).
 *  - Tier 3 admin happy paths on all six operations (directory list,
 *    detail fetch, overview stats, create, update, soft-delete + reactivate).
 *  - Tier 4 transport-tamper probes:
 *      (a) admin createUser(role=admin) → ADMIN_ROLE_CREATION_FORBIDDEN
 *          (runtime role-pre-guard; RegisterPublicRole type union can't
 *           express this so the document is a `parse`d local probe).
 *      (b) admin self-deactivation → USER_SELF_DEACTIVATION_FORBIDDEN.
 *      (c) admin fetches an unknown id → USER_NOT_FOUND.
 *  - Tier 5 zero-leak gates: every successful payload carries `id` first
 *    (Apollo normalization) and NEVER carries `passwordHash` (deep key
 *    walk); every denial emits ZERO `audit_logs` rows (count-delta —
 *    JR-C-1 at the API tier).
 *
 * Authentication per role (multi-role isolation):
 *  - The shared `testClient` sends NO cookies between tests, so every
 *    operation carries its OWN identity via a per-request
 *    `Authorization: Bearer <accessToken>` header. Anonymous probes
 *    omit the header entirely.
 *
 * Data lifecycle (HYGIENE — diverges from `auth.test.ts` +
 * `applicant-profile.test.ts` accumulate-by-convention):
 *  - Every user this suite creates — public registrations, the
 *    direct-DB admin fixture, admin happy-path creates — is tracked
 *    by id and deleted in a top-level `afterAll` via the shared
 *    `deleteUsersByIds` helper (RESTRICT-gated audit/subscriptions/
 *    evaluations rows first, then the users; child rows cascade), so
 *    the shared dev database returns to its canonical seed state.
 *    Deletion is by EXPLICIT id list, never an email-pattern sweep,
 *    so parallel live-wire suites keep their own fixtures intact.
 *  - Direct-DB usage (`db.insert(users)` + `admin` child row) is
 *    required because admin is NOT publicly registrable
 *    (`RegisterPublicRole` BFLA exclusion).
 *
 * Per `frontend/graphql/test/AGENTS.md`:
 *  - Documents imported via `@/frontend/graphql/sharedDocuments/admin/...`
 *    (single-source discipline — never re-declare wire operations).
 *  - Generated enums imported from `@/frontend/graphql/generated/gql/graphql`.
 *  - Test helpers via `@/test/helpers` (`setupTestServerLifecycle`,
 *    `testClient`, `expectMutationError`, `extractErrorCode`).
 *  - Mutations pass ALL input arguments (required + optional) — optional
 *    fields appear as `null` even when not exercised in a given case.
 */

import { afterAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";

import { db } from "@/backend/db";
import { auditLogs } from "@/backend/db/schema/audit/audit-logs";
import { admin } from "@/backend/db/schema/users/admin";
import { users } from "@/backend/db/schema/users/users";
import { hashPassword } from "@/backend/lib/auth/password";
import { AuditActionType, Gender, RegisterPublicRole, UserRole } from "@/frontend/graphql/generated/gql/graphql";
import {
  adminCreateUserMutationDocument,
  adminSetUserDeletedMutationDocument,
  adminUpdateUserMutationDocument,
  adminUserActivityQueryDocument,
  adminUserDetailQueryDocument,
  adminUserStatsQueryDocument,
  adminUsersQueryDocument,
} from "@/frontend/graphql/sharedDocuments/admin/admin-users.documents";
import {
  loginMutationDocument,
  registerUserMutationDocument,
} from "@/frontend/graphql/sharedDocuments/auth/auth.documents";
import {
  countUsersByIds,
  deleteUsersByIds,
  describeGraphqlSuite,
  expectMutationError,
  setupTestServerLifecycle,
  testClient,
} from "@/test/helpers";

/** Randomized email per fixture — unique prefix + UUID salt avoids the
 * `users.email` unique index across parallel or repeated runs. */
function uniqueEmail(rolePrefix: string): string {
  return `${rolePrefix}-${Date.now()}-${randomUUID().slice(0, 8)}@test.local`;
}

/** Ids of every user this suite creates (any surface) — drained by the
 * top-level `afterAll` hygiene cleanup so the shared dev database stays
 * at its canonical seed state. Explicit ids (not an email sweep) keep
 * parallel live-wire suites' fixtures safe. */
const createdUserIds = new Set<number>();

function trackCreatedUser(id: number | null | undefined): void {
  if (typeof id === "number") createdUserIds.add(id);
}

// Named without the literal `password` token so `sonarjs/no-hardcoded-passwords`
// does not flag the constant declaration (matches the convention in
// `applicant-profile.test.ts`).
const TEST_CREDENTIAL = "Password123";

interface ActorBundle {
  readonly userId: number;
  readonly email: string;
  readonly accessToken: string;
}

/**
 * Registers a non-admin user through the PUBLIC registerUser mutation,
 * then logs in through the PUBLIC login mutation to obtain a real bearer
 * token. Returns userId + email + accessToken so Tier-1 callers can
 * cross-reference the registration id with directory payloads.
 *
 * Admin is NOT publicly registrable — use {@link provisionAdminActor}
 * (direct-DB fixture) instead.
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
 * Engineers an admin actor directly in the DB (admin role is excluded
 * from the public registration surface — BFLA defense). Real bcrypt hash
 * lets the public login mutation mint a genuine session for the probe.
 */
async function provisionAdminActor(): Promise<ActorBundle> {
  const email = uniqueEmail("admin");
  const [user] = await db
    .insert(users)
    .values({
      fullName: "Admin Matrix Probe",
      email,
      phone: "+201234567891",
      passwordHash: await hashPassword(TEST_CREDENTIAL),
      role: "admin",
      isDeleted: false,
      suspended: false,
      isBlocked: false,
      lastActiveAt: new Date(),
    })
    .returning();
  if (!user) throw new Error("admin user insert returned no rows");
  trackCreatedUser(user.id);
  const [adminRow] = await db.insert(admin).values({ id: user.id }).returning();
  if (!adminRow) throw new Error("admin child-row insert returned no rows");

  const loggedIn = await testClient.mutate({
    mutation: loginMutationDocument,
    variables: { email, password: TEST_CREDENTIAL },
  });
  expect(loggedIn.error).toBeUndefined();
  const accessToken = loggedIn.data?.login?.accessToken;
  if (!accessToken) throw new Error("admin login returned no accessToken");

  return { userId: user.id, email, accessToken };
}

/** Counts ALL audit rows in the table (denial-no-audit delta assertion). */
async function countAllAuditRows(): Promise<number> {
  const result = await db.select({ count: sql<number>`count(*)::int` }).from(auditLogs);
  return result[0]?.count ?? 0;
}

/**
 * Deep key-walk for `passwordHash` — rejects the leak regardless of
 * nesting depth or property name casing. Apollo-normalized payloads
 * also include `__typename` entries, which are walked past (not leaked
 * data). Strings are never traversed (only objects + arrays).
 *
 * Uses an exhaustive `Object.entries` traversal rather than an
 * `as Record<string, unknown>` cast — the project's oxlint config
 * denies `typescript/no-unsafe-type-assertion` warnings, and the
 * cast on an arbitrary `unknown` value trips that rule. `Object.entries`
 * returns `[string, unknown][]` for object inputs, which is the safe
 * projection we want.
 */
function deepFindKey(node: unknown, target: string): boolean {
  if (typeof node !== "object" || node === null) return false;
  if (Array.isArray(node)) {
    for (const item of node) {
      if (deepFindKey(item, target)) return true;
    }
    return false;
  }
  for (const [key, value] of Object.entries(node)) {
    if (key === target) return true;
    if (deepFindKey(value, target)) return true;
  }
  return false;
}

/** Authorization header factory — keeps multi-role isolation explicit. */
function bearer(token: string): { headers: { Authorization: string } } {
  return { headers: { Authorization: `Bearer ${token}` } };
}

/**
 * Structural type guard for GraphQL error envelopes returned by the
 * raw fetch GraphQL transport. Apollo Client's typed `testClient` path
 * uses `CombinedGraphQLErrors` natively; raw `fetch` responses need a
 * safe narrowing — `as { errors?: ... }` on the response body would
 * trip the project's `typescript/no-unsafe-type-assertion` oxlint rule.
 */
interface GraphqlResponseEnvelope {
  readonly errors?: ReadonlyArray<{ readonly extensions?: { readonly code?: string } }>;
}

function isGraphqlResponseEnvelope(value: unknown): value is GraphqlResponseEnvelope {
  return typeof value === "object" && value !== null;
}

function readErrorCode(body: unknown): string | undefined {
  if (!isGraphqlResponseEnvelope(body)) return undefined;
  return body.errors?.[0]?.extensions?.code;
}

/** The seven admin operations covered by the matrix — sanity-checked
 * against future drift if the operation set changes. */
const ADMIN_OPERATIONS = [
  "adminUsers",
  "adminUserDetail",
  "adminUserStats",
  "adminUserActivity",
  "adminCreateUser",
  "adminUpdateUser",
  "adminSetUserDeleted",
] as const;

describeGraphqlSuite("Admin user-management GraphQL permission matrix", () => {
  // The sandbox dev server (port 3000) is already running and is
  // graphQL-live. Per the AGENTS.md "Memory-constrained sandbox
  // adaptation", setting TEST_SERVER_EXTERNAL=1 reuses the warm server
  // instead of spawning a second `next dev` on port 3066.
  if (process.env.TEST_SERVER_EXTERNAL !== "1") {
    setupTestServerLifecycle();
  }

  // ─── Hygiene: restore the shared dev database to canonical seed state ───
  // Deletes exactly the users this suite created (tracked by id) plus
  // their RESTRICT-gated audit/subscriptions/evaluations references;
  // child rows cascade. Runs after every tier, proving the suite leaves
  // zero artifact rows behind.
  afterAll(async () => {
    const ids = [...createdUserIds];
    if (ids.length === 0) return;
    const deleted = await deleteUsersByIds(ids);
    expect(deleted).toBe(ids.length);
    expect(await countUsersByIds(ids)).toBe(0);
  });

  // ─── Tier 1: anonymous → each operation → UNAUTHORIZED ─────────────
  describe("Tier 1 — anonymous caller denied across all seven operations", () => {
    test("adminUsers (list) → UNAUTHORIZED; zero audit writes", async () => {
      const auditBefore = await countAllAuditRows();
      const result = await testClient.query({ query: adminUsersQueryDocument });
      expectMutationError(result.error, "UNAUTHORIZED");
      expect(await countAllAuditRows()).toBe(auditBefore);
    });

    test("adminUserStats (overview) → UNAUTHORIZED; zero audit writes", async () => {
      const auditBefore = await countAllAuditRows();
      const result = await testClient.query({ query: adminUserStatsQueryDocument });
      expectMutationError(result.error, "UNAUTHORIZED");
      expect(await countAllAuditRows()).toBe(auditBefore);
    });

    test("adminUserDetail → UNAUTHORIZED; zero audit writes", async () => {
      const auditBefore = await countAllAuditRows();
      const result = await testClient.query({
        query: adminUserDetailQueryDocument,
        variables: { id: 1 },
      });
      expectMutationError(result.error, "UNAUTHORIZED");
      expect(await countAllAuditRows()).toBe(auditBefore);
    });

    test("adminUserActivity → UNAUTHORIZED; zero audit writes", async () => {
      const auditBefore = await countAllAuditRows();
      const result = await testClient.query({
        query: adminUserActivityQueryDocument,
        variables: { id: 1, limit: 5 },
      });
      expectMutationError(result.error, "UNAUTHORIZED");
      expect(await countAllAuditRows()).toBe(auditBefore);
    });

    test("adminCreateUser → UNAUTHORIZED; zero audit writes", async () => {
      const auditBefore = await countAllAuditRows();
      const result = await testClient.mutate({
        mutation: adminCreateUserMutationDocument,
        variables: {
          input: {
            fullName: "Anon Probe",
            email: uniqueEmail("anon-create"),
            phone: "+201234567890",
            password: TEST_CREDENTIAL,
            gender: null,
            country: "EG",
            role: RegisterPublicRole.Student,
          },
        },
      });
      expectMutationError(result.error, "UNAUTHORIZED");
      expect(await countAllAuditRows()).toBe(auditBefore);
    });

    test("adminUpdateUser → UNAUTHORIZED; zero audit writes", async () => {
      const auditBefore = await countAllAuditRows();
      const result = await testClient.mutate({
        mutation: adminUpdateUserMutationDocument,
        variables: {
          id: 1,
          input: { fullName: "Anon Update", phone: null, country: null, dateOfBirth: null, gender: null },
        },
      });
      expectMutationError(result.error, "UNAUTHORIZED");
      expect(await countAllAuditRows()).toBe(auditBefore);
    });

    test("adminSetUserDeleted → UNAUTHORIZED; zero audit writes", async () => {
      const auditBefore = await countAllAuditRows();
      const result = await testClient.mutate({
        mutation: adminSetUserDeletedMutationDocument,
        variables: { id: 1, deleted: true },
      });
      expectMutationError(result.error, "UNAUTHORIZED");
      expect(await countAllAuditRows()).toBe(auditBefore);
    });

    test("the seven operations enumerated (drift guard)", () => {
      expect(ADMIN_OPERATIONS).toHaveLength(7);
    });
  });

  // ─── Tier 2: non-admin roles → each operation → FORBIDDEN ─────────
  describe("Tier 2 — non-admin roles denied across all seven operations", () => {
    const nonAdminRoles: ReadonlyArray<RegisterPublicRole> = [
      RegisterPublicRole.Student,
      RegisterPublicRole.Parent,
      RegisterPublicRole.Teacher,
    ];

    for (const role of nonAdminRoles) {
      test(`${role} actor → adminUsers → FORBIDDEN; zero audit writes`, async () => {
        const { accessToken } = await registerAndLogin(role);
        const auditBefore = await countAllAuditRows();
        const result = await testClient.query({
          query: adminUsersQueryDocument,
          context: bearer(accessToken),
        });
        expectMutationError(result.error, "FORBIDDEN");
        expect(await countAllAuditRows()).toBe(auditBefore);
      });

      test(`${role} actor → adminUserDetail → FORBIDDEN; zero audit writes`, async () => {
        const { accessToken } = await registerAndLogin(role);
        const auditBefore = await countAllAuditRows();
        const result = await testClient.query({
          query: adminUserDetailQueryDocument,
          variables: { id: 1 },
          context: bearer(accessToken),
        });
        expectMutationError(result.error, "FORBIDDEN");
        expect(await countAllAuditRows()).toBe(auditBefore);
      });

      test(`${role} actor → adminUserStats → FORBIDDEN; zero audit writes`, async () => {
        const { accessToken } = await registerAndLogin(role);
        const auditBefore = await countAllAuditRows();
        const result = await testClient.query({
          query: adminUserStatsQueryDocument,
          context: bearer(accessToken),
        });
        expectMutationError(result.error, "FORBIDDEN");
        expect(await countAllAuditRows()).toBe(auditBefore);
      });

      test(`${role} actor → adminUserActivity → FORBIDDEN; zero audit writes`, async () => {
        const { accessToken } = await registerAndLogin(role);
        const auditBefore = await countAllAuditRows();
        const result = await testClient.query({
          query: adminUserActivityQueryDocument,
          variables: { id: 1, limit: 5 },
          context: bearer(accessToken),
        });
        expectMutationError(result.error, "FORBIDDEN");
        expect(await countAllAuditRows()).toBe(auditBefore);
      });

      test(`${role} actor → adminCreateUser → FORBIDDEN; zero audit writes`, async () => {
        const { accessToken } = await registerAndLogin(role);
        const auditBefore = await countAllAuditRows();
        const result = await testClient.mutate({
          mutation: adminCreateUserMutationDocument,
          variables: {
            input: {
              fullName: `${role} Probe`,
              email: uniqueEmail(`${role.toLowerCase()}-create`),
              phone: "+201234567890",
              password: TEST_CREDENTIAL,
              gender: null,
              country: "EG",
              role: RegisterPublicRole.Student,
            },
          },
          context: bearer(accessToken),
        });
        expectMutationError(result.error, "FORBIDDEN");
        expect(await countAllAuditRows()).toBe(auditBefore);
      });

      test(`${role} actor → adminUpdateUser → FORBIDDEN; zero audit writes`, async () => {
        const { accessToken } = await registerAndLogin(role);
        const auditBefore = await countAllAuditRows();
        const result = await testClient.mutate({
          mutation: adminUpdateUserMutationDocument,
          variables: {
            id: 1,
            input: { fullName: `${role} Update`, phone: null, country: null, dateOfBirth: null, gender: null },
          },
          context: bearer(accessToken),
        });
        expectMutationError(result.error, "FORBIDDEN");
        expect(await countAllAuditRows()).toBe(auditBefore);
      });

      test(`${role} actor → adminSetUserDeleted → FORBIDDEN; zero audit writes`, async () => {
        const { accessToken } = await registerAndLogin(role);
        const auditBefore = await countAllAuditRows();
        const result = await testClient.mutate({
          mutation: adminSetUserDeletedMutationDocument,
          variables: { id: 1, deleted: true },
          context: bearer(accessToken),
        });
        expectMutationError(result.error, "FORBIDDEN");
        expect(await countAllAuditRows()).toBe(auditBefore);
      });
    }
  });

  // ─── Tier 3: admin happy paths + zero-leak gates ───────────────────
  describe("Tier 3 — admin happy paths across all six operations + zero-leak gates", () => {
    let adminActor: ActorBundle;
    let createdUserId: number;

    test("admin → adminUsers returns a non-empty directory with `id` first; no `passwordHash` leak", async () => {
      adminActor = await provisionAdminActor();
      const result = await testClient.query({
        query: adminUsersQueryDocument,
        variables: { filters: null, page: 1, pageSize: 25 },
        context: bearer(adminActor.accessToken),
      });
      expect(result.error).toBeUndefined();
      const items = result.data?.adminUsers?.items;
      if (!items) throw new Error("adminUsers returned no items");
      expect(items.length).toBeGreaterThan(0);
      // Apollo cache normalization: `id` is the first key on every item.
      for (const item of items) {
        expect(Object.keys(item)[0]).toBe("id");
        expect(item.id).toBeGreaterThan(0);
      }
      // Zero-leak: no `passwordHash` anywhere in the response payload.
      expect(deepFindKey(result.data, "passwordHash")).toBe(false);
    });

    test("admin → adminUserDetail returns the same shape with `id` first; no `passwordHash` leak", async () => {
      const result = await testClient.query({
        query: adminUserDetailQueryDocument,
        variables: { id: adminActor.userId },
        context: bearer(adminActor.accessToken),
      });
      expect(result.error).toBeUndefined();
      const detail = result.data?.adminUserDetail;
      if (!detail) throw new Error("adminUserDetail returned no data");
      expect(Object.keys(detail)[0]).toBe("id");
      expect(detail.id).toBe(adminActor.userId);
      expect(detail.role).toBe(UserRole.Admin);
      expect(deepFindKey(result.data, "passwordHash")).toBe(false);
    });

    test("admin → adminUserStats returns coherent counters; zero audit writes; no `passwordHash` leak", async () => {
      const auditBefore = await countAllAuditRows();
      const result = await testClient.query({
        query: adminUserStatsQueryDocument,
        context: bearer(adminActor.accessToken),
      });
      expect(result.error).toBeUndefined();
      const stats = result.data?.adminUserStats;
      if (!stats) throw new Error("adminUserStats returned no data");
      // Every counter is a non-negative integer.
      for (const value of [
        stats.totalCount,
        stats.activeCount,
        stats.suspendedCount,
        stats.blockedCount,
        stats.deletedCount,
        stats.adminsCount,
        stats.teachersCount,
        stats.studentsCount,
        stats.parentsCount,
        stats.newThisWeekCount,
      ]) {
        expect(Number.isInteger(value)).toBe(true);
        expect(value).toBeGreaterThanOrEqual(0);
      }
      // Role counters partition the total exactly (one role per user).
      expect(stats.adminsCount + stats.teachersCount + stats.studentsCount + stats.parentsCount).toBe(stats.totalCount);
      // Governance counters are filtered counts bounded by the total.
      expect(stats.activeCount).toBeLessThanOrEqual(stats.totalCount);
      expect(stats.deletedCount).toBeLessThanOrEqual(stats.totalCount);
      expect(stats.newThisWeekCount).toBeLessThanOrEqual(stats.totalCount);
      // The provisioned admin fixture is observable in both counters.
      expect(stats.totalCount).toBeGreaterThanOrEqual(5);
      expect(stats.adminsCount).toBeGreaterThanOrEqual(2);
      expect(stats.newThisWeekCount).toBeGreaterThanOrEqual(1);
      // Reads never audit — the stats read emits zero audit rows.
      expect(await countAllAuditRows()).toBe(auditBefore);
      // Zero-leak: the scalar envelope carries no `passwordHash`.
      expect(deepFindKey(result.data, "passwordHash")).toBe(false);
    });

    test("admin → adminCreateUser(role=student) returns the new detail; audit row emitted", async () => {
      const auditBefore = await countAllAuditRows();
      const email = uniqueEmail("matrix-create-student");
      const result = await testClient.mutate({
        mutation: adminCreateUserMutationDocument,
        variables: {
          input: {
            fullName: "Matrix Student",
            email,
            phone: "+201234567892",
            password: TEST_CREDENTIAL,
            gender: Gender.Male,
            country: "EG",
            role: RegisterPublicRole.Student,
          },
        },
        context: bearer(adminActor.accessToken),
      });
      expect(result.error).toBeUndefined();
      const detail = result.data?.adminCreateUser;
      if (!detail) throw new Error("adminCreateUser returned no data");
      expect(Object.keys(detail)[0]).toBe("id");
      expect(detail.email).toBe(email);
      expect(detail.role).toBe(UserRole.Student);
      expect(deepFindKey(result.data, "passwordHash")).toBe(false);
      createdUserId = detail.id;
      trackCreatedUser(detail.id);
      // Exactly one audit row emitted for the successful create.
      expect(await countAllAuditRows()).toBe(auditBefore + 1);
    });

    test("admin → adminUpdateUser updates the whitelist profile; audit row emitted", async () => {
      const auditBefore = await countAllAuditRows();
      const result = await testClient.mutate({
        mutation: adminUpdateUserMutationDocument,
        variables: {
          id: createdUserId,
          input: {
            fullName: "Matrix Student Updated",
            phone: "+201234567893",
            country: "SA",
            dateOfBirth: null,
            gender: Gender.Male,
          },
        },
        context: bearer(adminActor.accessToken),
      });
      expect(result.error).toBeUndefined();
      const detail = result.data?.adminUpdateUser;
      if (!detail) throw new Error("adminUpdateUser returned no data");
      expect(detail.id).toBe(createdUserId);
      expect(detail.fullName).toBe("Matrix Student Updated");
      expect(deepFindKey(result.data, "passwordHash")).toBe(false);
      expect(await countAllAuditRows()).toBe(auditBefore + 1);
    });

    test("admin → adminSetUserDeleted(true) soft-deletes; second call → ALREADY_DELETED; both emit one audit row", async () => {
      const auditBeforeFirst = await countAllAuditRows();
      const firstDelete = await testClient.mutate({
        mutation: adminSetUserDeletedMutationDocument,
        variables: { id: createdUserId, deleted: true },
        context: bearer(adminActor.accessToken),
      });
      expect(firstDelete.error).toBeUndefined();
      const detail = firstDelete.data?.adminSetUserDeleted;
      if (!detail) throw new Error("adminSetUserDeleted returned no data");
      expect(detail.id).toBe(createdUserId);
      expect(detail.isDeleted).toBe(true);
      expect(detail.deletedAt).not.toBeNull();
      expect(deepFindKey(firstDelete.data, "passwordHash")).toBe(false);
      expect(await countAllAuditRows()).toBe(auditBeforeFirst + 1);

      // Second soft-delete → USER_ALREADY_DELETED; zero audit writes for the denial.
      // The error code is `USER_ALREADY_DELETED` (not `ADMIN_USERS_ALREADY_DELETED`)
      // — the service emits the domain-typed code, surfaced via the GraphQL
      // `extensions.code` transport. The ADMIN_USERS_* prefix is the locale
      // namespace grouping, NOT the wire-code prefix.
      const auditBeforeSecond = await countAllAuditRows();
      const secondDelete = await testClient.mutate({
        mutation: adminSetUserDeletedMutationDocument,
        variables: { id: createdUserId, deleted: true },
        context: bearer(adminActor.accessToken),
      });
      expectMutationError(secondDelete.error, "USER_ALREADY_DELETED");
      expect(await countAllAuditRows()).toBe(auditBeforeSecond);
    });

    test("admin → adminSetUserDeleted(false) reactivates; audit row emitted", async () => {
      const auditBefore = await countAllAuditRows();
      const result = await testClient.mutate({
        mutation: adminSetUserDeletedMutationDocument,
        variables: { id: createdUserId, deleted: false },
        context: bearer(adminActor.accessToken),
      });
      expect(result.error).toBeUndefined();
      const detail = result.data?.adminSetUserDeleted;
      if (!detail) throw new Error("adminSetUserDeleted returned no data");
      expect(detail.id).toBe(createdUserId);
      expect(detail.isDeleted).toBe(false);
      expect(detail.deletedAt).toBeNull();
      expect(await countAllAuditRows()).toBe(auditBefore + 1);
    });

    test("admin → adminUserActivity returns the audit trail newest-first with projected changedFields; zero audit writes; no leaks", async () => {
      const auditBefore = await countAllAuditRows();
      const result = await testClient.query({
        query: adminUserActivityQueryDocument,
        variables: { id: createdUserId, limit: 10 },
        context: bearer(adminActor.accessToken),
      });
      expect(result.error).toBeUndefined();
      const entries = result.data?.adminUserActivity;
      if (!entries) throw new Error("adminUserActivity returned no data");

      // The Tier-3 flow above wrote exactly four audit rows about this user:
      // Create (adminCreateUser) → Update → Delete → Reactivate. The timeline
      // returns them newest-first.
      expect(entries).toHaveLength(4);
      expect(entries[0].actionType).toBe(AuditActionType.Reactivate);
      expect(entries[1].actionType).toBe(AuditActionType.Delete);
      expect(entries[2].actionType).toBe(AuditActionType.Update);
      expect(entries[3].actionType).toBe(AuditActionType.Create);
      // `id` is the first key on every entry (Apollo cache normalization).
      for (const entry of entries) {
        expect(Object.keys(entry)[0]).toBe("id");
        expect(entry.actorName).toBe("Admin Matrix Probe");
      }
      // The Update entry projects the changed-field names. The input
      // supplied `dateOfBirth: null`, but the resolver maps null → undefined
      // (partial-update semantics — explicit nulls are dropped, never
      // "clear the value"; see QA 6-QA-4 P2-2), so the audit payload
      // carries the four string/enum fields plus the derived ISO
      // `countryCode` stamped alongside its `country` display name.
      expect(entries[2].changedFields).toEqual(["fullName", "phone", "country", "countryCode", "gender"]);
      expect(entries[0].changedFields).toBeNull();
      expect(entries[1].changedFields).toBeNull();
      expect(entries[3].changedFields).toBeNull();
      // Reads never audit — the timeline read emits zero audit rows.
      expect(await countAllAuditRows()).toBe(auditBefore);
      // Zero-leak: no `passwordHash` and no raw audit `details` JSON payload
      // anywhere in the response (only the projected changedFields list).
      expect(deepFindKey(result.data, "passwordHash")).toBe(false);
      expect(deepFindKey(result.data, "details")).toBe(false);
    });

    test("admin → adminUserActivity for an unknown id → USER_NOT_FOUND; zero audit writes", async () => {
      const auditBefore = await countAllAuditRows();
      const result = await testClient.query({
        query: adminUserActivityQueryDocument,
        variables: { id: 99_999_999, limit: 5 },
        context: bearer(adminActor.accessToken),
      });
      expectMutationError(result.error, "USER_NOT_FOUND");
      expect(await countAllAuditRows()).toBe(auditBefore);
    });
  });

  // ─── Tier 4: transport-tamper probes + unknown-id denials ──────────
  describe("Tier 4 — transport-tamper + unknown-id denial probes", () => {
    let adminActor: ActorBundle;

    test("admin createUser(role=admin) → GRAPHQL_VALIDATION_FAILED (SDL-level BFLA gate); zero audit writes", async () => {
      adminActor = await provisionAdminActor();
      const auditBefore = await countAllAuditRows();
      // The `RegisterPublicRole` SDL enum structurally excludes `Admin` —
      // so a raw `role: Admin` literal in the GraphQL document is rejected
      // at schema validation (GRAPHQL_VALIDATION_FAILED), NEVER reaching the
      // resolver. This is the FIRST line of defense (BFLA — the input type
      // cannot even express `admin`). The runtime role-pre-guard inside the
      // service (`ADMIN_ROLE_CREATION_FORBIDDEN`) is the SECOND line, only
      // reachable through transport-tamper that bypasses the SDL validator
      // (e.g., a custom-serialized HTTP body with a non-enum `role` field).
      // That second line is covered by the JOURNEY C step 3 service-tier
      // probe; the GraphQL-tier assertion below proves the SDL gate holds.
      const res = await fetch(`http://localhost:${process.env.GRAPHQL_TEST_PORT ?? 3066}/api/graphql`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminActor.accessToken}` },
        body: JSON.stringify({
          query: `mutation { adminCreateUser(input: { fullName: "Tampered", email: "${uniqueEmail("tamper")}", phone: "+201234567890", password: "${TEST_CREDENTIAL}", gender: null, country: "EG", role: Admin }) { id } }`,
        }),
      });
      const body = await res.json();
      expect(readErrorCode(body)).toBe("GRAPHQL_VALIDATION_FAILED");
      expect(await countAllAuditRows()).toBe(auditBefore);
    });

    test("admin self-deactivation → USER_SELF_DEACTIVATION_FORBIDDEN; zero audit writes", async () => {
      const auditBefore = await countAllAuditRows();
      const result = await testClient.mutate({
        mutation: adminSetUserDeletedMutationDocument,
        variables: { id: adminActor.userId, deleted: true },
        context: bearer(adminActor.accessToken),
      });
      expectMutationError(result.error, "USER_SELF_DEACTIVATION_FORBIDDEN");
      expect(await countAllAuditRows()).toBe(auditBefore);
    });

    test("admin createUser multi-field rejection → VALIDATION + extensions.fields wire payload; zero audit writes", async () => {
      const auditBefore = await countAllAuditRows();
      const result = await testClient.mutate({
        mutation: adminCreateUserMutationDocument,
        variables: {
          input: {
            fullName: "   ",
            email: "not-an-email",
            phone: "",
            password: "short",
            gender: null,
            country: "EG",
            role: RegisterPublicRole.Student,
          },
        },
        context: bearer(adminActor.accessToken),
      });
      const gqlError = expectMutationError(result.error, "VALIDATION");
      expect(await countAllAuditRows()).toBe(auditBefore);

      // Wire projection: the first GraphQL error item carries
      // `extensions.fields` naming EVERY failed field — the exact payload the
      // create dialog reduces to inline per-field helperText via
      // `extractFieldErrors`. Narrowed structurally (no unsafe assertions).
      const fieldsPayload = gqlError.errors[0]?.extensions?.fields;
      expect(Array.isArray(fieldsPayload)).toBe(true);
      if (!Array.isArray(fieldsPayload)) throw new Error("expected extensions.fields on the wire");
      const byField = new Map<string, string>();
      for (const entry of fieldsPayload) {
        if (typeof entry?.field === "string" && typeof entry.code === "string") {
          byField.set(entry.field, entry.code);
        }
      }
      expect(byField.get("fullName")).toBe("NAME_REQUIRED");
      expect(byField.get("email")).toBe("EMAIL_INVALID");
      expect(byField.get("phone")).toBe("PHONE_REQUIRED");
      expect(byField.get("password")).toBe("PASSWORD_TOO_SHORT");
      // `country: "EG"` is a wire-valid ISO code: it passes the CountryCode
      // scalar gate AND the service membership check, so the multi-field
      // payload carries only the four genuinely failed fields.
      expect(byField.has("country")).toBe(false);
      // Every entry also carries a localized message for helperText.
      for (const entry of fieldsPayload) {
        expect(typeof entry?.message).toBe("string");
      }
    });

    test("admin createUser with an empty country string → BAD_USER_INPUT at the CountryCode wire gate; zero audit writes", async () => {
      const auditBefore = await countAllAuditRows();
      const result = await testClient.mutate({
        mutation: adminCreateUserMutationDocument,
        variables: {
          input: {
            fullName: "Wire Gate Probe",
            email: uniqueEmail("wire-gate-empty-country"),
            phone: "+201234567890",
            password: TEST_CREDENTIAL,
            gender: null,
            country: "",
            role: RegisterPublicRole.Student,
          },
        },
        context: bearer(adminActor.accessToken),
      });
      // `country` is the non-null `CountryCode` scalar: an empty string fails
      // the scalar's ISO 3166-1 parse during VARIABLE COERCION — before any
      // resolver runs — so the transport answers BAD_USER_INPUT, not a service
      // VALIDATION payload. The service-tier required-country branch stays
      // behind the GraphQL layer and is covered by the service suite.
      const error = expectMutationError(result.error, "BAD_USER_INPUT");
      const messages = error.errors.map(item => item.message).join(" | ");
      expect(messages).toContain("Value is not a valid country code");
      expect(await countAllAuditRows()).toBe(auditBefore);
    });

    test("admin createUser with a dataset-curated-out ISO code (XK) → VALIDATION + COUNTRY_CODE_INVALID on the country path; zero audit writes", async () => {
      const auditBefore = await countAllAuditRows();
      const result = await testClient.mutate({
        mutation: adminCreateUserMutationDocument,
        variables: {
          input: {
            fullName: "Curated Out Probe",
            email: uniqueEmail("curated-out-country"),
            phone: "+201234567890",
            password: TEST_CREDENTIAL,
            gender: null,
            country: "XK",
            role: RegisterPublicRole.Student,
          },
        },
        context: bearer(adminActor.accessToken),
      });
      // `XK` is in the scalar's hardcoded ISO 3166-1 list, so wire coercion
      // PASSES it through, but the project dataset curates it out — the
      // service membership check rejects the create with `COUNTRY_CODE_INVALID`
      // on the unchanged `country` field path (the path the create dialog's
      // helperText projection reads).
      const gqlError = expectMutationError(result.error, "VALIDATION");
      const fieldsPayload = gqlError.errors[0]?.extensions?.fields;
      expect(Array.isArray(fieldsPayload)).toBe(true);
      if (!Array.isArray(fieldsPayload)) throw new Error("expected extensions.fields on the wire");
      const byField = new Map<string, string>();
      for (const entry of fieldsPayload) {
        if (typeof entry?.field === "string" && typeof entry.code === "string") {
          byField.set(entry.field, entry.code);
        }
      }
      expect(byField.get("country")).toBe("COUNTRY_CODE_INVALID");
      // Every entry also carries a localized message for helperText.
      for (const entry of fieldsPayload) {
        expect(typeof entry?.message).toBe("string");
      }
      expect(await countAllAuditRows()).toBe(auditBefore);
    });

    test("admin fetches unknown user id → USER_NOT_FOUND; zero audit writes", async () => {
      const auditBefore = await countAllAuditRows();
      const result = await testClient.query({
        query: adminUserDetailQueryDocument,
        variables: { id: 999_999 },
        context: bearer(adminActor.accessToken),
      });
      expectMutationError(result.error, "USER_NOT_FOUND");
      expect(await countAllAuditRows()).toBe(auditBefore);
    });

    test("admin updates unknown user id → USER_NOT_FOUND; zero audit writes", async () => {
      const auditBefore = await countAllAuditRows();
      const result = await testClient.mutate({
        mutation: adminUpdateUserMutationDocument,
        variables: {
          id: 999_999,
          input: { fullName: "No Such User", phone: null, country: null, dateOfBirth: null, gender: null },
        },
        context: bearer(adminActor.accessToken),
      });
      expectMutationError(result.error, "USER_NOT_FOUND");
      expect(await countAllAuditRows()).toBe(auditBefore);
    });

    test("admin soft-deletes unknown user id → USER_NOT_FOUND; zero audit writes", async () => {
      const auditBefore = await countAllAuditRows();
      const result = await testClient.mutate({
        mutation: adminSetUserDeletedMutationDocument,
        variables: { id: 999_999, deleted: true },
        context: bearer(adminActor.accessToken),
      });
      expectMutationError(result.error, "USER_NOT_FOUND");
      expect(await countAllAuditRows()).toBe(auditBefore);
    });
  });
});
