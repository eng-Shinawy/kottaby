/**
 * Admin governance wire-tier matrix — the role × mutation × conflict-code
 * tier for the admin governance surface (`adminSetUserSuspended` /
 * `adminSetUserBlocked`) over the REAL wire (`setupTestServerLifecycle`
 * + `testClient` + raw `fetch`).
 *
 * Matrix cells locked down over the REAL wire (HTTP → gateway pipeline →
 * scope-auth → resolver → AdminUserManagementService → PostgreSQL → back):
 *  - **Anonymous × 2 mutations** — every mutation answers UNAUTHORIZED
 *    (extensions.code) for credential-less callers, and the denial rides
 *    the canonical single-error envelope per REQ-050.
 *  - **student / teacher / parent × 2 mutations** — every authenticated
 *    non-admin role answers FORBIDDEN pre-resolver (the `$all`
 *    conjunction scope line — pinned via introspection in Tier 0 — fires
 *    BEFORE the resolver body runs; the in-service defense-in-depth
 *    `assertActiveActorAdmin` line is the second gate but is unreachable
 *    for non-admin callers because the scope line rejects first).
 *  - **admin happy path** — admin suspends a fresh target (both
 *    directions of both mutations) and the wire response payload is
 *    field-by-field equivalent to an independent direct-DB oracle read
 *    of the post-write `users` row (wire ≡ oracle).
 *  - **invalid ids** — `0` and `-5` reach the resolver and reject as
 *    VALIDATION via the `requirePositiveIntId` guard (extensions.code =
 *    "VALIDATION"); non-integer values (1.5, "abc") fail GraphQL
 *    variable coercion and reject as GRAPHQL_VALIDATION_FAILED at the
 *    schema layer (validation-tier, never reaches the resolver).
 *  - **`periodDays` hostilities (suspend direction only)** — `null` / 0 /
 *    -3 / 3651 (all reach the service) reject as VALIDATION with
 *    `extensions.fields[0].field === "periodDays"` (the REQ-050
 *    field-naming contract); 1.5 fails GraphQL Int coercion as
 *    GRAPHQL_VALIDATION_FAILED; the unsuspend direction IGNORES
 *    `periodDays` entirely (a bad `periodDays` + `suspended: false`
 *    SUCCEEDS — proven explicitly).
 *  - **every conflict code at its REQ-050 envelope** —
 *    USER_ALREADY_SUSPENDED / USER_NOT_SUSPENDED /
 *    USER_ALREADY_BLOCKED / USER_NOT_BLOCKED /
 *    USER_SELF_SUSPENSION_FORBIDDEN / USER_SELF_BLOCK_FORBIDDEN /
 *    USER_ALREADY_DELETED / USER_NOT_FOUND; each denial is the
 *    canonical single-error envelope, AND every denial appends ZERO
 *    audit rows (JR-C-1 — count-probed at the wire tier).
 *  - **BOPLA smuggling probes** — smuggled identity fields (`role`,
 *    `email`, `isDeleted`, `actorId`, `userId`, `passwordHash`) and
 *    unknown root args die as GRAPHQL_VALIDATION_FAILED before any
 *    resolver runs (scalar args only — there is NO input object on
 *    these mutations).
 *  - **EXACT `$all` scope declaration pinned** — both fields carry
 *    `{ $all: { authenticated: true, role: [UserRole.Admin] } }`
 *    (introspected off the built schema's `pothosOptions.authScopes`
 *    snapshot — the same technique as `handshake-code-surface.test.ts`
 *    §125-157); the `$all` conjunction is load-bearing (a plain
 *    `{ authenticated, role }` map would combine with ANY semantics).
 *  - **HTTP governed-login probes** — actively-suspended target's
 *    `login` answers a single-error FORBIDDEN; a lapsed suspension
 *    target's `login` answers SUCCESS with a session payload
 *    (`accessToken` non-empty — REQ-019 zero-write lapse).
 *
 * Fixture strategy (mirrors `notification-integration.matrix.test.ts`):
 *  - The four non-admin actors are created through the PUBLIC
 *    `registerUser` mutation over the wire (real registration path,
 *    real password hashes). The admin actor rides the seeded admin
 *    (`ADMIN_EMAIL`/`ADMIN_PASSWORD` — the seed's own env-fallback
 *    chain); its USER row is never deleted.
 *  - Governance flags are flipped directly in the DB between probes
 *    (via `applyGovernanceState`) — exactly how a suspension lands in
 *    production after a token was issued.
 *  - Authenticated calls carry the `Authorization: Bearer` header on a
 *    raw `fetch` — the shared `testClient`'s fixed HttpLink cannot
 *    attach per-request auth headers. Anonymous/login probes use
 *    `testClient` with `expectMutationError` (the canonical helper),
 *    while envelope-constancy assertions ride the raw wire.
 *  - Audit count probes: `audit_logs` rows are counted BEFORE and
 *    AFTER every denial class — the delta MUST be ZERO (JR-C-1 at the
 *    wire tier — denials append zero audit rows).
 *  - Tests mutate fixture state sequentially; every assertion derives
 *    its expectation from a fresh direct-DB oracle read.
 *
 * ENVIRONMENT NOTE (sandbox): the canonical lifecycle helper boots its
 * own dev server on TEST_PORT (3066) when nothing answers there. Where
 * the interactive dev server already owns port 3000 (Next 16 refuses a
 * second dev server on the same tree), point the suite at the LIVE
 * server via `GRAPHQL_TEST_PORT=3000`.
 *
 * Mandated runner: bun run test/scripts/run-test.ts backend/graphql/test/admin-governance.matrix.test.ts
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { gql } from "@apollo/client";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/backend/db";
import { auditLogs } from "@/backend/db/schema/audit/audit-logs";
import { users } from "@/backend/db/schema/users/users";
import { UserRole } from "@/backend/enum/users/user-role.enum";
import { graphQLSchema } from "@/backend/graphql/gqlSchema";
import { expectMutationError, extractErrorCode, setupTestServerLifecycle, TEST_PORT, testClient } from "@/test/helpers";
import { countUsersByIds, deleteUsersByIds } from "@/test/helpers/db-cleanup";

setupTestServerLifecycle();

// ─── Runtime guards (no casts, per test-tier discipline) ─────────────────────

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function recordOf(value: unknown, message: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new Error(message);
  }
  return value;
}

// ─── Wire helpers ────────────────────────────────────────────────────────────

const GRAPHQL_URL = `http://localhost:${TEST_PORT}/api/graphql`;
const WIRE_CREDENTIAL = "GovernanceMatrix!Pass1";
/** Seeded-admin credentials — the seed's own env-fallback chain. */
const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? "admin@draftacademy.local";
const ADMIN_CREDENTIAL = process.env.ADMIN_PASSWORD ?? "Seed_Pass1!";

const SUSPEND_DOCUMENT = `
  mutation GovernanceMatrixSuspend($id: Int!, $suspended: Boolean!, $periodDays: Int) {
    adminSetUserSuspended(id: $id, suspended: $suspended, periodDays: $periodDays) {
      id
      fullName
      email
      role
      isDeleted
      deletedAt
      suspended
      suspendedAt
      suspendedPeriodDays
      isBlocked
      blockedAt
      updatedAt
    }
  }
`;

const BLOCK_DOCUMENT = `
  mutation GovernanceMatrixBlock($id: Int!, $blocked: Boolean!) {
    adminSetUserBlocked(id: $id, blocked: $blocked) {
      id
      fullName
      email
      role
      isDeleted
      deletedAt
      suspended
      suspendedAt
      suspendedPeriodDays
      isBlocked
      blockedAt
      updatedAt
    }
  }
`;

const LOGIN_DOCUMENT = `
  mutation GovernanceMatrixLogin($email: String!, $password: String!) {
    login(email: $email, password: $password) {
      accessToken
    }
  }
`;

/** POSTs one document over the wire with a Bearer access token. */
async function postDocument(
  query: string,
  accessToken: string,
  variables?: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const response = await fetch(GRAPHQL_URL, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${accessToken}` },
    body: JSON.stringify(variables === undefined ? { query } : { query, variables }),
    signal: AbortSignal.timeout(30_000),
  });
  return recordOf(await response.json(), "expected a JSON object response");
}

/** POSTs one document over the wire with NO credentials (anonymous caller). */
async function postAnonymous(query: string, variables?: Record<string, unknown>): Promise<Record<string, unknown>> {
  const response = await fetch(GRAPHQL_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(variables === undefined ? { query } : { query, variables }),
    signal: AbortSignal.timeout(30_000),
  });
  return recordOf(await response.json(), "expected a JSON object response");
}

/** The single GraphQL error item of a denial response, runtime-guarded. */
function soleErrorItemOf(body: Record<string, unknown>): Record<string, unknown> {
  const errors = recordOf(body, "expected a response body").errors;
  if (!Array.isArray(errors) || errors.length !== 1) {
    throw new Error("expected exactly one error item");
  }
  return recordOf(errors[0], "expected a record-shaped error item");
}

function errorCodeOf(errorItem: Record<string, unknown>): string {
  const code = recordOf(errorItem.extensions, "expected record-shaped extensions").code;
  if (typeof code !== "string") {
    throw new Error("expected a string error code");
  }
  return code;
}

function errorMessageOf(errorItem: Record<string, unknown>): string {
  const message = errorItem.message;
  if (typeof message !== "string") {
    throw new Error("expected a string error message");
  }
  return message;
}

/** The sorted extensions key set of an error item (envelope-shape probes). */
function extensionKeysOf(errorItem: Record<string, unknown>): string[] {
  return Object.keys(recordOf(errorItem.extensions, "expected extensions")).toSorted((a, b) => a.localeCompare(b));
}

/** Wire `AdminUserDetail` payload, runtime-guarded. */
function wireDetailOf(
  body: Record<string, unknown>,
  field: "adminSetUserSuspended" | "adminSetUserBlocked"
): Record<string, unknown> {
  const data = recordOf(recordOf(body, "expected a body").data, "expected a data object");
  return recordOf(data[field], `expected a ${field} payload`);
}

/** Extracts the access token from a login mutation result. */
function accessTokenOf(result: { readonly data?: unknown }): string {
  const data = recordOf(result.data, "login returned no data");
  const payload = recordOf(data.login, "login returned no payload");
  const token = payload.accessToken;
  if (typeof token !== "string" || token.length === 0) {
    throw new Error("login accessToken must be a non-empty string");
  }
  return token;
}

/** Extracts the registered user's id from a registerUser mutation result. */
function registeredUserIdOf(result: { readonly data?: unknown }): number {
  const data = recordOf(result.data, "registerUser returned no data");
  const payload = recordOf(data.registerUser, "registerUser returned no payload");
  const wireId = payload.id;
  if (typeof wireId !== "string" && typeof wireId !== "number") {
    throw new Error("registerUser id must be a string or a number");
  }
  const parsed = Number.parseInt(String(wireId), 10);
  if (!Number.isSafeInteger(parsed)) {
    throw new Error("registerUser id must be a safe integer");
  }
  return parsed;
}

/** Asserts one raw-wire denial body answers the expected extensions.code. */
function expectDenialCode(
  body: Record<string, unknown>,
  expectedCode: string,
  dataMode: "null" | "absent" = "null"
): Record<string, unknown> {
  const errorItem = soleErrorItemOf(body);
  expect(errorCodeOf(errorItem)).toBe(expectedCode);
  // Execution-tier denials null the `data` field; validation-tier deaths
  // (the request never executed — smuggled-field rejections) omit the key
  // from the response body entirely.
  if (dataMode === "null") {
    expect(body.data).toBeNull();
  } else {
    expect(body.data).toBeUndefined();
  }
  return errorItem;
}

// ─── Direct-DB oracle (never routed through the resolver) ────────────────────

/** Reads the `users` row for one id (the canonical post-write oracle). */
async function readUserRow(id: number) {
  const rows = await db.select().from(users).where(eq(users.id, id)).limit(1);
  return rows[0] ?? null;
}

/** Counts `audit_logs` rows for an entity (denial-no-audit delta helper). */
async function countAuditForEntity(entityId: number): Promise<number> {
  const result = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(auditLogs)
    .where(and(eq(auditLogs.entityType, "user"), eq(auditLogs.entityId, entityId)));
  return result[0]?.count ?? 0;
}

// ─── Fixtures ────────────────────────────────────────────────────────────────

/** One wire-tier actor: a real session + its registered user id. */
interface WireActor {
  readonly label: string;
  readonly userId: number;
  readonly accessToken: string;
  readonly email: string;
}

/** Governance caller states probed by the matrix (matches the suspend/block/delete axes). */
type GovernanceState = "active" | "suspended" | "blocked" | "deleted";

const FIXTURE_MARKER = `gov-matrix-${randomUUID().slice(0, 8)}`;
const SUSPEND_PERIOD_DAYS = 7;
/** Large unused id — `USER_NOT_FOUND` oracle for the conflict-code matrix. */
const UNKNOWN_USER_ID = 999_999_999;

/** Registers one actor over the wire through the PUBLIC registerUser mutation. */
async function registerActor(
  label: string,
  role: "Student" | "Teacher" | "Parent"
): Promise<{ id: number; email: string }> {
  const email = `${FIXTURE_MARKER}-${label}@test.local`;
  const result = await testClient.mutate({
    mutation: gql`
      mutation RegisterGovernanceMatrixActor($input: RegisterUserInput!) {
        registerUser(input: $input) {
          id
        }
      }
    `,
    variables: {
      input: {
        fullName: `Governance Matrix ${label} ${FIXTURE_MARKER}`,
        email,
        phone: "+15551234567",
        password: WIRE_CREDENTIAL,
        country: "US",
        role,
      },
    },
  });
  if (result.error) {
    throw new Error(`registerUser failed for ${label} (code: ${extractErrorCode(result.error) ?? "unknown"})`);
  }
  return { id: registeredUserIdOf(result), email };
}

/** Logs one actor in over the wire and returns the access token. */
async function loginActor(email: string, credential: string): Promise<string> {
  const result = await testClient.mutate({
    mutation: gql`
      mutation LoginGovernanceMatrixActor($email: String!, $password: String!) {
        login(email: $email, password: $password) {
          accessToken
        }
      }
    `,
    variables: { email, password: credential },
  });
  if (result.error) {
    throw new Error(`login failed for ${email} (code: ${extractErrorCode(result.error) ?? "unknown"})`);
  }
  return accessTokenOf(result);
}

/**
 * Flips the governed actor's governance flags directly in the DB — exactly
 * how a suspension lands in production AFTER a token was minted. The
 * `suspendedPeriodDays` is set explicitly so the active-vs-lapsed window
 * is deterministic (the fail-closed-on-null case is exercised by the
 * notification matrix regression lock, NOT this matrix).
 */
async function applyGovernanceState(
  userId: number,
  state: GovernanceState,
  periodDays: number | null = SUSPEND_PERIOD_DAYS
): Promise<void> {
  const now = new Date();
  await db
    .update(users)
    .set({
      suspended: state === "suspended",
      suspendedAt: state === "suspended" ? now : null,
      suspendedPeriodDays: state === "suspended" ? periodDays : null,
      isBlocked: state === "blocked",
      blockedAt: state === "blocked" ? now : null,
      isDeleted: state === "deleted",
      deletedAt: state === "deleted" ? now : null,
    })
    .where(eq(users.id, userId));
}

/**
 * Writes a LAPSED suspension window directly into the DB —
 * `suspended = true`, `suspendedAt = (periodDays + 1) days ago`,
 * `suspendedPeriodDays = periodDays`. The window has LAPSED, so the
 * auth boundary predicate returns `false` (login succeeds — REQ-019
 * zero-write lapse).
 */
async function applyLapsedSuspension(userId: number, periodDays: number = SUSPEND_PERIOD_DAYS): Promise<void> {
  const suspendedAt = new Date(Date.now() - (periodDays + 1) * 86_400_000);
  await db
    .update(users)
    .set({
      suspended: true,
      suspendedAt,
      suspendedPeriodDays: periodDays,
      isBlocked: false,
      blockedAt: null,
      isDeleted: false,
      deletedAt: null,
    })
    .where(eq(users.id, userId));
}

let actors: readonly WireActor[] = [];
let adminActor: WireActor | null = null;
/** Every fixture user id created via `registerActor` (tracked for teardown). */
const trackedUserIds: number[] = [];

function actorByLabel(label: string): WireActor {
  const actor = actors.find(candidate => candidate.label === label);
  if (!actor) {
    throw new Error(`expected the ${label} actor fixture`);
  }
  return actor;
}

function admin(): WireActor {
  if (!adminActor) {
    throw new Error("admin actor not yet provisioned");
  }
  return adminActor;
}

/** Issues one adminSetUserSuspended over the wire as the supplied actor. */
function suspendAs(
  accessToken: string,
  id: number,
  suspended: boolean,
  periodDays: number | null
): Promise<Record<string, unknown>> {
  const variables: Record<string, unknown> = { id, suspended };
  if (periodDays !== null) {
    variables.periodDays = periodDays;
  }
  return postDocument(SUSPEND_DOCUMENT, accessToken, variables);
}

/** Issues one adminSetUserBlocked over the wire as the supplied actor. */
function blockAs(accessToken: string, id: number, blocked: boolean): Promise<Record<string, unknown>> {
  return postDocument(BLOCK_DOCUMENT, accessToken, { id, blocked });
}

// ─── Tier 0 — `$all` scope declaration pinned via introspection ──────────────

function isRecordValue(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * Reads the `authScopes` declaration off one root field through the Pothos
 * extension snapshot. Same technique as `handshake-code-surface.test.ts:59-65`.
 */
function declaredAuthScopes(rootField: unknown): unknown {
  const extensions: unknown = Reflect.get(isRecordValue(rootField) ? rootField : {}, "extensions");
  if (!isRecordValue(extensions)) return undefined;
  const pothosOptions: unknown = Reflect.get(extensions, "pothosOptions");
  if (!isRecordValue(pothosOptions)) return undefined;
  return Reflect.get(pothosOptions, "authScopes");
}

/** The role array inside a field's `$all` scope conjunction (empty when absent). */
function scopeRoles(scopes: unknown): readonly string[] {
  if (!isRecordValue(scopes)) return [];
  const all: unknown = Reflect.get(scopes, "$all");
  if (!isRecordValue(all)) return [];
  const roles: unknown = Reflect.get(all, "role");
  return Array.isArray(roles) ? roles : [];
}

/** The key names inside a field's `$all` scope conjunction (empty when absent). */
function scopeKeys(scopes: unknown): readonly string[] {
  if (!isRecordValue(scopes)) return [];
  const all: unknown = Reflect.get(scopes, "$all");
  if (!isRecordValue(all)) return [];
  return Object.keys(all).toSorted((a, b) => a.localeCompare(b));
}

function mutationField(name: string) {
  const fields = graphQLSchema.getMutationType()?.getFields();
  if (!fields) {
    throw new Error("Schema must define a root Mutation type");
  }
  const field = fields[name];
  if (!field) {
    throw new Error(`Mutation must register a \`${name}\` root field`);
  }
  return field;
}

describe("admin-governance scopes — documented `$all` conjunction pinned", () => {
  const suspendField = mutationField("adminSetUserSuspended");
  const blockField = mutationField("adminSetUserBlocked");

  test("`adminSetUserSuspended` carries the admin `$all` conjunction verbatim", () => {
    expect(declaredAuthScopes(suspendField)).toEqual({
      $all: { authenticated: true, role: [UserRole.Admin] },
    });
  });

  test("`adminSetUserBlocked` carries the admin `$all` conjunction verbatim", () => {
    expect(declaredAuthScopes(blockField)).toEqual({
      $all: { authenticated: true, role: [UserRole.Admin] },
    });
  });

  test("both fields use the explicit `$all` shape with EXACTLY the authenticated+role keys", () => {
    // A plain scope map combines with ANY semantics (the documented wrong
    // answer) — the conjunction key must be present on both fields.
    expect(scopeKeys(declaredAuthScopes(suspendField))).toEqual(["authenticated", "role"]);
    expect(scopeKeys(declaredAuthScopes(blockField))).toEqual(["authenticated", "role"]);
  });

  test("the role set is EXACTLY [UserRole.Admin] — no sibling / teacher / parent / student read override", () => {
    expect(scopeRoles(declaredAuthScopes(suspendField))).toEqual([UserRole.Admin]);
    expect(scopeRoles(declaredAuthScopes(suspendField))).not.toContain(UserRole.Student);
    expect(scopeRoles(declaredAuthScopes(suspendField))).not.toContain(UserRole.Teacher);
    expect(scopeRoles(declaredAuthScopes(suspendField))).not.toContain(UserRole.Parent);
    expect(scopeRoles(declaredAuthScopes(blockField))).toEqual([UserRole.Admin]);
    expect(scopeRoles(declaredAuthScopes(blockField))).not.toContain(UserRole.Student);
    expect(scopeRoles(declaredAuthScopes(blockField))).not.toContain(UserRole.Teacher);
    expect(scopeRoles(declaredAuthScopes(blockField))).not.toContain(UserRole.Parent);
  });
});

// ─── Tier 1 — anonymous tier ──────────────────────────────────────────────────

describe("admin-governance matrix — DB-backed tiers (anon / non-admin / happy-path / invalid-ids / periodDays / conflicts / BOPLA / login probes)", () => {
  beforeAll(async () => {
    // Real registrations through the public mutation (committed users).
    const [student, teacher, parent, target] = await Promise.all([
      registerActor("student", "Student"),
      registerActor("teacher", "Teacher"),
      registerActor("parent", "Parent"),
      registerActor("target", "Student"),
    ]);
    trackedUserIds.push(student.id, teacher.id, parent.id, target.id);

    // Real logins — the seeded admin rides its env-fallback credentials.
    const [studentToken, teacherToken, parentToken, adminToken] = await Promise.all([
      loginActor(student.email, WIRE_CREDENTIAL),
      loginActor(teacher.email, WIRE_CREDENTIAL),
      loginActor(parent.email, WIRE_CREDENTIAL),
      loginActor(ADMIN_EMAIL, ADMIN_CREDENTIAL),
    ]);

    actors = [
      { label: "student", userId: student.id, accessToken: studentToken, email: student.email },
      { label: "teacher", userId: teacher.id, accessToken: teacherToken, email: teacher.email },
      { label: "parent", userId: parent.id, accessToken: parentToken, email: parent.email },
      { label: "target", userId: target.id, accessToken: "", email: target.email },
    ];

    // Resolve the seeded admin's user id (NEVER register a fresh admin — the
    // seeded admin's row is reused; only its fixture audit rows are scoped
    // by entity_id, which deleteUsersByIds never touches for non-tracked ids).
    const [adminRow] = await db.select({ id: users.id }).from(users).where(eq(users.email, ADMIN_EMAIL)).limit(1);
    if (!adminRow) {
      throw new Error(`seeded admin ${ADMIN_EMAIL} not found`);
    }
    adminActor = { label: "admin", userId: adminRow.id, accessToken: adminToken, email: ADMIN_EMAIL };
  }, 120_000);

  afterAll(async () => {
    // The seeded admin's user row is NEVER deleted — only the registered
    // fixture users (student/teacher/parent/target) cascade through the
    // canonical FK-safe cleanup helper. The helper suspends the
    // `audit_logs` immutability trigger, deletes audit rows for the
    // fixture user ids (as actor OR as entity), then deletes the user
    // rows in FK-safe order.
    if (trackedUserIds.length === 0) return;
    await deleteUsersByIds(trackedUserIds);
    const residue = await countUsersByIds(trackedUserIds);
    expect(residue).toBe(0);
  }, 60_000);

  // ─── Tier 1 — anonymous tier ──────────────────────────────────────────────────

  describe("admin-governance matrix — anonymous tier (role-less caller × 2 mutations)", () => {
    test("adminSetUserSuspended answers UNAUTHORIZED for anonymous callers (single-error envelope)", async () => {
      const body = await postAnonymous(SUSPEND_DOCUMENT, { id: 1, suspended: true, periodDays: 7 });
      const errorItem = expectDenialCode(body, "UNAUTHORIZED");
      expect(errorItem.path).toEqual(["adminSetUserSuspended"]);
    });

    test("adminSetUserBlocked answers UNAUTHORIZED for anonymous callers (single-error envelope)", async () => {
      const body = await postAnonymous(BLOCK_DOCUMENT, { id: 1, blocked: true });
      const errorItem = expectDenialCode(body, "UNAUTHORIZED");
      expect(errorItem.path).toEqual(["adminSetUserBlocked"]);
    });

    test("the anonymous denial shape is CONSTANT across both mutations (REQ-050 envelope)", async () => {
      const suspendBody = await postAnonymous(SUSPEND_DOCUMENT, { id: 1, suspended: true, periodDays: 7 });
      const blockBody = await postAnonymous(BLOCK_DOCUMENT, { id: 1, blocked: true });
      const suspendItem = soleErrorItemOf(suspendBody);
      const blockItem = soleErrorItemOf(blockBody);
      expect(errorCodeOf(suspendItem)).toBe("UNAUTHORIZED");
      expect(errorCodeOf(blockItem)).toBe("UNAUTHORIZED");
      // Same localized message + envelope key set on both ops (no per-op disclosure).
      expect(errorMessageOf(blockItem)).toBe(errorMessageOf(suspendItem));
      expect(extensionKeysOf(blockItem)).toEqual(extensionKeysOf(suspendItem));
      // Each carries its own path (the failing root field).
      expect(suspendItem.path).toEqual(["adminSetUserSuspended"]);
      expect(blockItem.path).toEqual(["adminSetUserBlocked"]);
    });

    test("anonymous denials append ZERO audit rows (JR-C-1)", async () => {
      const auditBefore = await countAuditForEntity(1);
      await postAnonymous(SUSPEND_DOCUMENT, { id: 1, suspended: true, periodDays: 7 });
      await postAnonymous(BLOCK_DOCUMENT, { id: 1, blocked: true });
      const auditAfter = await countAuditForEntity(1);
      expect(auditAfter).toBe(auditBefore);
    });
  });

  // ─── Tier 2 — non-admin (student / teacher / parent) tier ────────────────────

  describe("admin-governance matrix — non-admin tier (FORBIDDEN pre-resolver, single-error envelope)", () => {
    const NON_ADMIN_LABELS: string[] = ["student", "teacher", "parent"];

    test.each(NON_ADMIN_LABELS)(
      "adminSetUserSuspended answers FORBIDDEN for %s caller (single-error envelope)",
      async label => {
        const actor = actorByLabel(label);
        const body = await suspendAs(actor.accessToken, 1, true, 7);
        const errorItem = expectDenialCode(body, "FORBIDDEN");
        expect(errorItem.path).toEqual(["adminSetUserSuspended"]);
      }
    );

    test.each(NON_ADMIN_LABELS)(
      "adminSetUserBlocked answers FORBIDDEN for %s caller (single-error envelope)",
      async label => {
        const actor = actorByLabel(label);
        const body = await blockAs(actor.accessToken, 1, true);
        const errorItem = expectDenialCode(body, "FORBIDDEN");
        expect(errorItem.path).toEqual(["adminSetUserBlocked"]);
      }
    );

    test("the FORBIDDEN denial shape is CONSTANT across all three non-admin roles × both mutations", async () => {
      const probeEntries = await Promise.all(
        NON_ADMIN_LABELS.flatMap(label => {
          const actor = actorByLabel(label);
          return [
            suspendAs(actor.accessToken, 1, true, 7).then(body => [`${label}:suspend`, soleErrorItemOf(body)] as const),
            blockAs(actor.accessToken, 1, true).then(body => [`${label}:block`, soleErrorItemOf(body)] as const),
          ];
        })
      );
      const samples: Record<string, Record<string, unknown>> = {};
      for (const [key, item] of probeEntries) {
        samples[key] = item;
      }
      const codes = Object.values(samples).map(errorCodeOf);
      for (const code of codes) {
        expect(code).toBe("FORBIDDEN");
      }
      // Same message + envelope key set on every cell (no per-role disclosure).
      const reference = samples["student:suspend"];
      const referenceMessage = errorMessageOf(reference);
      const referenceKeys = extensionKeysOf(reference);
      for (const item of Object.values(samples)) {
        expect(errorMessageOf(item)).toBe(referenceMessage);
        expect(extensionKeysOf(item)).toEqual(referenceKeys);
      }
    });

    test("non-admin denials append ZERO audit rows (JR-C-1)", async () => {
      const target = actorByLabel("target");
      const auditBefore = await countAuditForEntity(target.userId);
      await Promise.all(
        NON_ADMIN_LABELS.flatMap(label => {
          const actor = actorByLabel(label);
          return [
            suspendAs(actor.accessToken, target.userId, true, 7),
            blockAs(actor.accessToken, target.userId, true),
          ];
        })
      );
      const auditAfter = await countAuditForEntity(target.userId);
      expect(auditAfter).toBe(auditBefore);
    });
  });

  // ─── Tier 3 — admin happy path (wire ≡ post-write DB oracle) ─────────────────

  describe("admin-governance matrix — admin happy path (wire ≡ post-write DB oracle)", () => {
    test("adminSetUserSuspended (suspend direction) — wire payload field-by-field ≡ DB row", async () => {
      const target = actorByLabel("target");
      // Reset the target to a clean state first (no suspended / blocked / deleted).
      await applyGovernanceState(target.userId, "active");

      const body = await suspendAs(admin().accessToken, target.userId, true, SUSPEND_PERIOD_DAYS);
      expect(body.errors).toBeUndefined();
      const wireDetail = wireDetailOf(body, "adminSetUserSuspended");
      const dbRow = await readUserRow(target.userId);
      if (!dbRow) throw new Error("expected the target user row to persist");

      expect(wireDetail.id).toBe(dbRow.id);
      expect(wireDetail.fullName).toBe(dbRow.fullName);
      expect(wireDetail.email).toBe(dbRow.email);
      expect(wireDetail.isDeleted).toBe(dbRow.isDeleted ?? false);
      expect(wireDetail.suspended).toBe(true);
      expect(dbRow.suspended).toBe(true);
      expect(wireDetail.suspendedPeriodDays).toBe(SUSPEND_PERIOD_DAYS);
      expect(dbRow.suspendedPeriodDays).toBe(SUSPEND_PERIOD_DAYS);
      expect(wireDetail.isBlocked).toBe(dbRow.isBlocked ?? false);
      // `suspendedAt` and `updatedAt` are server-stamped inside the tx;
      // compare them to the DB row (the wire serializes them as ISO strings).
      expect(wireDetail.suspendedAt).toBe(dbRow.suspendedAt?.toISOString() ?? null);
      expect(wireDetail.updatedAt).toBe(dbRow.updatedAt.toISOString());
    });

    test("adminSetUserSuspended (unsuspend direction) — wire payload field-by-field ≡ DB row", async () => {
      const target = actorByLabel("target");
      // Target is suspended from the previous test; unsuspend it now.
      const body = await suspendAs(admin().accessToken, target.userId, false, null);
      expect(body.errors).toBeUndefined();
      const wireDetail = wireDetailOf(body, "adminSetUserSuspended");
      const dbRow = await readUserRow(target.userId);
      if (!dbRow) throw new Error("expected the target user row to persist");

      expect(wireDetail.suspended).toBe(false);
      expect(dbRow.suspended).toBe(false);
      expect(wireDetail.suspendedAt).toBeNull();
      expect(dbRow.suspendedAt).toBeNull();
      expect(wireDetail.suspendedPeriodDays).toBeNull();
      expect(dbRow.suspendedPeriodDays).toBeNull();
    });

    test("adminSetUserBlocked (block direction) — wire payload field-by-field ≡ DB row", async () => {
      const target = actorByLabel("target");
      await applyGovernanceState(target.userId, "active");

      const body = await blockAs(admin().accessToken, target.userId, true);
      expect(body.errors).toBeUndefined();
      const wireDetail = wireDetailOf(body, "adminSetUserBlocked");
      const dbRow = await readUserRow(target.userId);
      if (!dbRow) throw new Error("expected the target user row to persist");

      expect(wireDetail.isBlocked).toBe(true);
      expect(dbRow.isBlocked).toBe(true);
      expect(wireDetail.suspended).toBe(dbRow.suspended ?? false);
      expect(wireDetail.blockedAt).toBe(dbRow.blockedAt?.toISOString() ?? null);
    });

    test("adminSetUserBlocked (unblock direction) — wire payload field-by-field ≡ DB row", async () => {
      const target = actorByLabel("target");
      const body = await blockAs(admin().accessToken, target.userId, false);
      expect(body.errors).toBeUndefined();
      const wireDetail = wireDetailOf(body, "adminSetUserBlocked");
      const dbRow = await readUserRow(target.userId);
      if (!dbRow) throw new Error("expected the target user row to persist");

      expect(wireDetail.isBlocked).toBe(false);
      expect(dbRow.isBlocked).toBe(false);
      expect(wireDetail.blockedAt).toBeNull();
      expect(dbRow.blockedAt).toBeNull();
    });

    test("axis independence — suspending a blocked target SUCCEEDS (REQ-014)", async () => {
      const target = actorByLabel("target");
      await applyGovernanceState(target.userId, "blocked");

      const body = await suspendAs(admin().accessToken, target.userId, true, SUSPEND_PERIOD_DAYS);
      expect(body.errors).toBeUndefined();
      const wireDetail = wireDetailOf(body, "adminSetUserSuspended");
      const dbRow = await readUserRow(target.userId);
      if (!dbRow) throw new Error("expected the target user row to persist");

      // Both axes set: blocked=true AND suspended=true.
      expect(wireDetail.suspended).toBe(true);
      expect(wireDetail.isBlocked).toBe(true);
      expect(dbRow.suspended).toBe(true);
      expect(dbRow.isBlocked).toBe(true);
      // Reset for downstream tests.
      await applyGovernanceState(target.userId, "active");
    });
  });

  // ─── Tier 4 — invalid ids ────────────────────────────────────────────────────

  describe("admin-governance matrix — invalid ids (resolver-side VALIDATION vs schema-side GRAPHQL_VALIDATION_FAILED)", () => {
    test("id = 0 and id = -5 reach the resolver and reject as VALIDATION (requirePositiveIntId)", async () => {
      const target = actorByLabel("target");
      await applyGovernanceState(target.userId, "active");
      const auditBefore = await countAuditForEntity(target.userId);

      const zeroSuspend = await suspendAs(admin().accessToken, 0, true, 7);
      expectDenialCode(zeroSuspend, "VALIDATION");
      const negativeSuspend = await suspendAs(admin().accessToken, -5, true, 7);
      expectDenialCode(negativeSuspend, "VALIDATION");
      const zeroBlock = await blockAs(admin().accessToken, 0, true);
      expectDenialCode(zeroBlock, "VALIDATION");
      const negativeBlock = await blockAs(admin().accessToken, -5, true);
      expectDenialCode(negativeBlock, "VALIDATION");

      // Zero audit rows for every invalid-id probe (JR-C-1).
      const auditAfter = await countAuditForEntity(target.userId);
      expect(auditAfter).toBe(auditBefore);
    });

    test("non-integer id (`1.5` variable) fails GraphQL Int coercion → GRAPHQL_VALIDATION_FAILED", async () => {
      // `Int!` arg + a Float variable: GraphQL variable coercion rejects
      // `1.5` for an `Int` input per the spec (the value is not a valid
      // Int). The request never reaches the resolver.
      const body = await postDocument(SUSPEND_DOCUMENT, admin().accessToken, {
        id: 1.5,
        suspended: true,
        periodDays: 7,
      });
      expectDenialCode(body, "GRAPHQL_VALIDATION_FAILED", "absent");
    });

    test("non-integer id (`abc` inline string literal) fails parse → GRAPHQL_VALIDATION_FAILED", async () => {
      // An inline string literal where an `Int!` is expected is a parse-time
      // error; GraphQL rejects before variable coercion.
      const body = await postDocument(
        'mutation { adminSetUserSuspended(id: "abc", suspended: true, periodDays: 7) { id } }',
        admin().accessToken
      );
      expectDenialCode(body, "GRAPHQL_VALIDATION_FAILED", "absent");
    });
  });

  // ─── Tier 5 — periodDays hostilities (suspend direction only) ────────────────

  /**
   * Extracts the `fields` payload off a denial error item (runtime-guarded).
   * Returns the first entry's `field` name when present (else `null`).
   */
  function firstFieldNameOf(errorItem: Record<string, unknown>): string | null {
    const fields = recordOf(errorItem.extensions, "expected extensions").fields;
    if (!Array.isArray(fields) || fields.length === 0) return null;
    const first = fields[0];
    if (!isRecord(first)) return null;
    const field = first.field;
    return typeof field === "string" ? field : null;
  }

  describe("admin-governance matrix — periodDays hostilities on the suspend direction", () => {
    test("periodDays = null + suspended=true → VALIDATION with fields[0].field === 'periodDays'", async () => {
      const target = actorByLabel("target");
      await applyGovernanceState(target.userId, "active");
      const auditBefore = await countAuditForEntity(target.userId);

      // Null periodDays (variable omitted so GraphQL sends `null` for `Int`).
      const body = await postDocument(SUSPEND_DOCUMENT, admin().accessToken, {
        id: target.userId,
        suspended: true,
        periodDays: null,
      });
      const errorItem = expectDenialCode(body, "VALIDATION");
      expect(firstFieldNameOf(errorItem)).toBe("periodDays");

      const auditAfter = await countAuditForEntity(target.userId);
      expect(auditAfter).toBe(auditBefore);
    });

    test.each([0, -3, 3651])(
      "periodDays = %d + suspended=true → VALIDATION with fields[0].field === 'periodDays'",
      async periodDays => {
        const target = actorByLabel("target");
        await applyGovernanceState(target.userId, "active");
        const auditBefore = await countAuditForEntity(target.userId);

        const body = await suspendAs(admin().accessToken, target.userId, true, periodDays);
        const errorItem = expectDenialCode(body, "VALIDATION");
        expect(firstFieldNameOf(errorItem)).toBe("periodDays");

        const auditAfter = await countAuditForEntity(target.userId);
        expect(auditAfter).toBe(auditBefore);
      }
    );

    test("periodDays = 1 + suspended=true → ACCEPTED (boundary minimum)", async () => {
      const target = actorByLabel("target");
      await applyGovernanceState(target.userId, "active");

      const body = await suspendAs(admin().accessToken, target.userId, true, 1);
      expect(body.errors).toBeUndefined();
      const wireDetail = wireDetailOf(body, "adminSetUserSuspended");
      expect(wireDetail.suspendedPeriodDays).toBe(1);
    });

    test("periodDays = 3650 + suspended=true → ACCEPTED (boundary maximum)", async () => {
      const target = actorByLabel("target");
      await applyGovernanceState(target.userId, "active");

      const body = await suspendAs(admin().accessToken, target.userId, true, 3650);
      expect(body.errors).toBeUndefined();
      const wireDetail = wireDetailOf(body, "adminSetUserSuspended");
      expect(wireDetail.suspendedPeriodDays).toBe(3650);
    });

    test("periodDays = 1.5 + suspended=true → GRAPHQL_VALIDATION_FAILED (Int coercion)", async () => {
      // A non-integer periodDays value fails GraphQL variable coercion at
      // the schema layer — the resolver never runs.
      const body = await postDocument(SUSPEND_DOCUMENT, admin().accessToken, {
        id: actorByLabel("target").userId,
        suspended: true,
        periodDays: 1.5,
      });
      expectDenialCode(body, "GRAPHQL_VALIDATION_FAILED", "absent");
    });

    test("periodDays is IGNORED on the unsuspend direction — bad periodDays + suspended=false SUCCEEDS", async () => {
      const target = actorByLabel("target");
      await applyGovernanceState(target.userId, "suspended");
      // A wildly out-of-range periodDays is IGNORED on unsuspend.
      const body = await suspendAs(admin().accessToken, target.userId, false, 9999);
      expect(body.errors).toBeUndefined();
      const wireDetail = wireDetailOf(body, "adminSetUserSuspended");
      expect(wireDetail.suspended).toBe(false);
      expect(wireDetail.suspendedPeriodDays).toBeNull();
    });
  });

  // ─── Tier 6 — conflict codes (every REQ-050 code at its envelope + zero-audit) ──

  describe("admin-governance matrix — conflict codes (REQ-050 envelope + JR-C-1 zero-audit count probes)", () => {
    test("USER_ALREADY_SUSPENDED — admin suspends an already-suspended target", async () => {
      const target = actorByLabel("target");
      await applyGovernanceState(target.userId, "suspended");
      const auditBefore = await countAuditForEntity(target.userId);

      const body = await suspendAs(admin().accessToken, target.userId, true, SUSPEND_PERIOD_DAYS);
      const errorItem = expectDenialCode(body, "USER_ALREADY_SUSPENDED");
      expect(errorItem.path).toEqual(["adminSetUserSuspended"]);

      const auditAfter = await countAuditForEntity(target.userId);
      expect(auditAfter).toBe(auditBefore);
    });

    test("USER_NOT_SUSPENDED — admin unsuspends a not-suspended target", async () => {
      const target = actorByLabel("target");
      await applyGovernanceState(target.userId, "active");
      const auditBefore = await countAuditForEntity(target.userId);

      const body = await suspendAs(admin().accessToken, target.userId, false, null);
      const errorItem = expectDenialCode(body, "USER_NOT_SUSPENDED");
      expect(errorItem.path).toEqual(["adminSetUserSuspended"]);

      const auditAfter = await countAuditForEntity(target.userId);
      expect(auditAfter).toBe(auditBefore);
    });

    test("USER_ALREADY_BLOCKED — admin blocks an already-blocked target", async () => {
      const target = actorByLabel("target");
      await applyGovernanceState(target.userId, "blocked");
      const auditBefore = await countAuditForEntity(target.userId);

      const body = await blockAs(admin().accessToken, target.userId, true);
      const errorItem = expectDenialCode(body, "USER_ALREADY_BLOCKED");
      expect(errorItem.path).toEqual(["adminSetUserBlocked"]);

      const auditAfter = await countAuditForEntity(target.userId);
      expect(auditAfter).toBe(auditBefore);
    });

    test("USER_NOT_BLOCKED — admin unblocks a not-blocked target", async () => {
      const target = actorByLabel("target");
      await applyGovernanceState(target.userId, "active");
      const auditBefore = await countAuditForEntity(target.userId);

      const body = await blockAs(admin().accessToken, target.userId, false);
      const errorItem = expectDenialCode(body, "USER_NOT_BLOCKED");
      expect(errorItem.path).toEqual(["adminSetUserBlocked"]);

      const auditAfter = await countAuditForEntity(target.userId);
      expect(auditAfter).toBe(auditBefore);
    });

    test("USER_SELF_SUSPENSION_FORBIDDEN — admin self-targets suspend", async () => {
      const self = admin();
      const auditBefore = await countAuditForEntity(self.userId);

      const body = await suspendAs(self.accessToken, self.userId, true, SUSPEND_PERIOD_DAYS);
      const errorItem = expectDenialCode(body, "USER_SELF_SUSPENSION_FORBIDDEN");
      expect(errorItem.path).toEqual(["adminSetUserSuspended"]);

      const auditAfter = await countAuditForEntity(self.userId);
      expect(auditAfter).toBe(auditBefore);
    });

    test("USER_SELF_BLOCK_FORBIDDEN — admin self-targets block", async () => {
      const self = admin();
      const auditBefore = await countAuditForEntity(self.userId);

      const body = await blockAs(self.accessToken, self.userId, true);
      const errorItem = expectDenialCode(body, "USER_SELF_BLOCK_FORBIDDEN");
      expect(errorItem.path).toEqual(["adminSetUserBlocked"]);

      const auditAfter = await countAuditForEntity(self.userId);
      expect(auditAfter).toBe(auditBefore);
    });

    test("USER_ALREADY_DELETED — admin suspends a soft-deleted target", async () => {
      const target = actorByLabel("target");
      await applyGovernanceState(target.userId, "deleted");
      const auditBefore = await countAuditForEntity(target.userId);

      const body = await suspendAs(admin().accessToken, target.userId, true, SUSPEND_PERIOD_DAYS);
      const errorItem = expectDenialCode(body, "USER_ALREADY_DELETED");
      expect(errorItem.path).toEqual(["adminSetUserSuspended"]);

      const auditAfter = await countAuditForEntity(target.userId);
      expect(auditAfter).toBe(auditBefore);
    });

    test("USER_ALREADY_DELETED — admin blocks a soft-deleted target", async () => {
      const target = actorByLabel("target");
      await applyGovernanceState(target.userId, "deleted");
      const auditBefore = await countAuditForEntity(target.userId);

      const body = await blockAs(admin().accessToken, target.userId, true);
      const errorItem = expectDenialCode(body, "USER_ALREADY_DELETED");
      expect(errorItem.path).toEqual(["adminSetUserBlocked"]);

      const auditAfter = await countAuditForEntity(target.userId);
      expect(auditAfter).toBe(auditBefore);
      // Reset for downstream tests.
      await applyGovernanceState(target.userId, "active");
    });

    test("USER_NOT_FOUND — admin targets an unknown id (oracle-safe single error)", async () => {
      const auditBefore = await countAuditForEntity(UNKNOWN_USER_ID);

      const suspendBody = await suspendAs(admin().accessToken, UNKNOWN_USER_ID, true, SUSPEND_PERIOD_DAYS);
      const suspendItem = expectDenialCode(suspendBody, "USER_NOT_FOUND");
      expect(suspendItem.path).toEqual(["adminSetUserSuspended"]);

      const blockBody = await blockAs(admin().accessToken, UNKNOWN_USER_ID, true);
      const blockItem = expectDenialCode(blockBody, "USER_NOT_FOUND");
      expect(blockItem.path).toEqual(["adminSetUserBlocked"]);

      // Both USER_NOT_FOUND envelopes are byte-identical in code/message/keys
      // (no per-mutation disclosure).
      expect(errorMessageOf(blockItem)).toBe(errorMessageOf(suspendItem));
      expect(extensionKeysOf(blockItem)).toEqual(extensionKeysOf(suspendItem));

      const auditAfter = await countAuditForEntity(UNKNOWN_USER_ID);
      expect(auditAfter).toBe(auditBefore);
    });
  });

  // ─── Tier 7 — BOPLA smuggling probes (smuggled identity fields) ──────────────

  describe("admin-governance matrix — BOPLA smuggling probes (smuggled args → GRAPHQL_VALIDATION_FAILED)", () => {
    test("smuggled identity root args on adminSetUserSuspended die as GRAPHQL_VALIDATION_FAILED", async () => {
      const target = actorByLabel("target");
      await applyGovernanceState(target.userId, "active");
      // Unknown root arg `actorId` (would-be BOLA escalation vector).
      const smuggledActorId = await postDocument(
        `mutation ($id: Int!, $suspended: Boolean!, $periodDays: Int, $actorId: Int) {
        adminSetUserSuspended(id: $id, suspended: $suspended, periodDays: $periodDays, actorId: $actorId) { id }
      }`,
        admin().accessToken,
        { id: target.userId, suspended: true, periodDays: 7, actorId: 1 }
      );
      expectDenialCode(smuggledActorId, "GRAPHQL_VALIDATION_FAILED", "absent");

      // Smuggled identity field `role` on the mutation.
      const smuggledRole = await postDocument(
        `mutation ($id: Int!, $suspended: Boolean!, $periodDays: Int, $role: String) {
        adminSetUserSuspended(id: $id, suspended: $suspended, periodDays: $periodDays, role: $role) { id }
      }`,
        admin().accessToken,
        { id: target.userId, suspended: true, periodDays: 7, role: "admin" }
      );
      expectDenialCode(smuggledRole, "GRAPHQL_VALIDATION_FAILED", "absent");
    });

    test("smuggled identity root args on adminSetUserBlocked die as GRAPHQL_VALIDATION_FAILED", async () => {
      const target = actorByLabel("target");
      await applyGovernanceState(target.userId, "active");
      const smuggledUserId = await postDocument(
        `mutation ($id: Int!, $blocked: Boolean!, $userId: Int) {
        adminSetUserBlocked(id: $id, blocked: $blocked, userId: $userId) { id }
      }`,
        admin().accessToken,
        { id: target.userId, blocked: true, userId: 1 }
      );
      expectDenialCode(smuggledUserId, "GRAPHQL_VALIDATION_FAILED", "absent");

      const smuggledEmail = await postDocument(
        `mutation ($id: Int!, $blocked: Boolean!, $email: String) {
        adminSetUserBlocked(id: $id, blocked: $blocked, email: $email) { id }
      }`,
        admin().accessToken,
        { id: target.userId, blocked: true, email: "x@y.z" }
      );
      expectDenialCode(smuggledEmail, "GRAPHQL_VALIDATION_FAILED", "absent");
    });

    test("smuggled input-object shape is REJECTED — the mutations expose ONLY scalar args (no input type)", async () => {
      // Attempting to pass an `input: AdminSetUserSuspendedInput!` arg fails
      // at the schema layer (no such input type exists for these mutations).
      const smuggledInput = await postDocument(
        `mutation ($input: AdminSetUserSuspendedInput!) {
        adminSetUserSuspended(input: $input) { id }
      }`,
        admin().accessToken,
        { input: { id: 1, suspended: true, periodDays: 7 } }
      );
      expectDenialCode(smuggledInput, "GRAPHQL_VALIDATION_FAILED", "absent");
    });
  });

  // ─── Tier 8 — HTTP governed-login probes (active-suspended → FORBIDDEN; lapsed → SUCCESS) ──

  describe("admin-governance matrix — HTTP governed-login probes (REQ-019 window honesty)", () => {
    test("actively-suspended target's login → single-error FORBIDDEN", async () => {
      const target = actorByLabel("target");
      await applyGovernanceState(target.userId, "suspended", SUSPEND_PERIOD_DAYS);

      // Raw-wire probe — single-error envelope assertion.
      const body = await postAnonymous(LOGIN_DOCUMENT, { email: target.email, password: WIRE_CREDENTIAL });
      const errorItem = expectDenialCode(body, "FORBIDDEN");
      expect(errorItem.path).toEqual(["login"]);

      // Canonical helper path — same code, single-error envelope.
      const result = await testClient.mutate({
        mutation: gql`
        mutation GovernanceMatrixLoginSuspended($email: String!, $password: String!) {
          login(email: $email, password: $password) {
            accessToken
          }
        }
      `,
        variables: { email: target.email, password: WIRE_CREDENTIAL },
      });
      expectMutationError(result.error, "FORBIDDEN");
    });

    test("lapsed-suspension target's login → SUCCESS with session payload (REQ-019 zero-write lapse)", async () => {
      const target = actorByLabel("target");
      // Fixture-write a LAPSED suspension window (suspended=true, the
      // window ended > periodDays ago). The predicate returns false →
      // login SUCCEEDS — REQ-019 zero-write lapse path.
      await applyLapsedSuspension(target.userId, SUSPEND_PERIOD_DAYS);
      const before = await readUserRow(target.userId);
      if (!before) throw new Error("expected the target user row to persist");

      const body = await postAnonymous(LOGIN_DOCUMENT, { email: target.email, password: WIRE_CREDENTIAL });
      expect(body.errors).toBeUndefined();
      const data = recordOf(recordOf(body, "expected a body").data, "expected a data object");
      const payload = recordOf(data.login, "expected a login payload");
      const token = payload.accessToken;
      if (typeof token !== "string") {
        throw new Error("expected a string accessToken on the lapsed-suspension login payload");
      }
      expect(token.length).toBeGreaterThan(0);

      // REQ-019 zero-write proof: the `suspended*` columns are byte-identical
      // before/after the login (the predicate is pure READ — no UPDATE
      // releases the lapse).
      const after = await readUserRow(target.userId);
      if (!after) throw new Error("expected the target user row to persist after login");
      expect(after.suspended).toBe(before.suspended);
      expect(after.suspendedAt).toEqual(before.suspendedAt);
      expect(after.suspendedPeriodDays).toBe(before.suspendedPeriodDays);
    });

    test("blocked target's login → single-error FORBIDDEN (block NEVER lapses)", async () => {
      const target = actorByLabel("target");
      await applyGovernanceState(target.userId, "blocked");

      const body = await postAnonymous(LOGIN_DOCUMENT, { email: target.email, password: WIRE_CREDENTIAL });
      const errorItem = expectDenialCode(body, "FORBIDDEN");
      expect(errorItem.path).toEqual(["login"]);
      // Reset for downstream tests.
      await applyGovernanceState(target.userId, "active");
    });

    test("active target's login → SUCCESS (control — no governance flag set)", async () => {
      const target = actorByLabel("target");
      await applyGovernanceState(target.userId, "active");

      const body = await postAnonymous(LOGIN_DOCUMENT, { email: target.email, password: WIRE_CREDENTIAL });
      expect(body.errors).toBeUndefined();
      const data = recordOf(recordOf(body, "expected a body").data, "expected a data object");
      const payload = recordOf(data.login, "expected a login payload");
      const token = payload.accessToken;
      if (typeof token !== "string") {
        throw new Error("expected a string accessToken on the active-target control login payload");
      }
      expect(token.length).toBeGreaterThan(0);
    });
  });
}); // end of DB-backed tiers describe
