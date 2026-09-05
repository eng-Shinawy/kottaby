/**
 * GraphQL wire matrix — the global audit-trail read surface
 * (`adminAuditLogs`) over the real HTTP pipeline (`setupTestServerLifecycle`
 * + `testClient` + raw-HTTP probes, per the notification-integration matrix
 * precedent).
 *
 * Matrix cells locked down over the REAL wire (HTTP → gateway pipeline →
 * scope-auth → resolver → AuditTrailService → PostgreSQL → back):
 *  - **Anonymous × adminAuditLogs** — UNAUTHORIZED with the single-error
 *    envelope (exactly one item, nulled `data`, the field's own path), and
 *    a byte-unchanged `audit_logs` row-count oracle across the denial
 *    storm (the read surface performs zero writes and the denial happens
 *    before any data leaves).
 *  - **student / teacher / parent** — FORBIDDEN each, with a denial shape
 *    CONSTANT across the three roles (same message, same extensions key
 *    set — no per-role disclosure), also row-count-oracle-unchanged.
 *  - **Admin happy path** — the closed eight-field projection (`id`,
 *    `actionType`, `actorId`, `actorName`, `entityType`, `entityId`,
 *    `details`, `createdAt`) round-trips against a direct-DB oracle
 *    (values, ordering, nullability, exact key set), and the envelope
 *    echoes `page` / `pageSize` / `totalCount` honestly (explicit window,
 *    resolved defaults, out-of-range empty page, actionType filtering).
 *  - **Hostile pagination** — `pageSize` 0 / 101 and `page` 0 reject with
 *    VALIDATION (the service's pre-DB rejection surfacing through the
 *    boundary), while the boundary `pageSize` 100 stays accepted; the
 *    row-count oracle never moves.
 *  - **BOPLA smuggle probes** — `userId` at the root selection args,
 *    `userId` inside `filters`, a forged enum literal, and an
 *    Int-overflow id all die as GRAPHQL_VALIDATION_FAILED with the `data`
 *    key ABSENT from the body (the request never executed — the closed
 *    input whitelist is structurally unreachable, even for the legitimate
 *    admin caller).
 *  - **Chaos tier — corrupt stored `action_type` + generic unexpected
 *    internals** — a corrupt value cannot be inserted through the `pgEnum`,
 *    so the fault is injected at the repository seam (the sanctioned
 *    injection point, mirroring the service suite): the real admin gate
 *    passes, the row mapper fails CLOSED with a plain (non-domain) runtime
 *    error carrying the raw stored value. A second probe injects a generic
 *    non-domain fault into the paired snapshot read itself (the read-stage
 *    rejection means the listing leg never runs). Both carriers are masked
 *    by the boundary finalizer into localized INTERNAL_SERVER_ERROR items
 *    with the corrupt value / internal prose absent from the serialized
 *    envelope. No test-only forced-failure fixture exists on the wire
 *    schema (same conclusion as the gateway integration suite), so the
 *    live-HTTP hop of this tier is owned by the boundary finalizer suite's
 *    masking contract.
 *
 * Fixture strategy (live-wire conventions):
 *  - Student/teacher/parent actors register through the PUBLIC
 *    `registerUser` mutation and log in through the PUBLIC `login`
 *    mutation (real credential path, real password hashes). The admin
 *    actor is a dedicated direct-DB fixture (admin is NOT publicly
 *    registrable) with a real bcrypt hash, minting a genuine session
 *    through the same login mutation.
 *  - Trail rows are seeded with direct committed inserts carrying a
 *    unique marker in `entity_type` (exact oracle scoping — never a
 *    global-position assumption on a shared table), and torn down in
 *    `afterAll`: tracked row ids delete under
 *    `withAuditDeleteTriggersSuspended` (the append-only immutability
 *    trigger on migrate-provisioned databases blocks a bare DELETE), the
 *    fixture users ride the shared `deleteUsersByIds` helper (explicit id
 *    list — never an email sweep), and the zero-residue state is
 *    re-probed (users gone, marker rows gone, actor rows gone).
 *  - Authenticated raw probes carry the `Authorization: Bearer` header
 *    (the documented production client path read by
 *    `createGraphQLContext`) — the shared `testClient`'s fixed HttpLink
 *    cannot attach per-request auth headers. Anonymous probes ride the
 *    canonical `testClient` + `expectMutationError` helper.
 *
 * Mandated runner: bun run test/scripts/run-test.ts backend/graphql/test/audit-trail.query.test.ts
 */

import { afterAll, afterEach, beforeAll, describe, expect, spyOn, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { gql } from "@apollo/client";
import { desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/backend/db";
import { AuditTrailRepository } from "@/backend/db/repo";
import { auditLogs } from "@/backend/db/schema/audit/audit-logs";
import { users } from "@/backend/db/schema/users/users";
import { AuditActionType } from "@/backend/enum/audit/audit-action-type.enum";
import type { Context } from "@/backend/graphql/gqlContextFactory";
import { finalizeGraphqlResponseScope, type GraphqlResponseScope } from "@/backend/graphql/graphqlErrorsFinalizer";
import { createAuthCookieOut } from "@/backend/lib/auth/cookies";
import { hashPassword } from "@/backend/lib/auth/password";
import { DomainError } from "@/backend/lib/errors";
import { AuditTrailService } from "@/backend/services";
import type { AuditLogInsertType, AuditLogSelectType } from "@/backend/types";
import { getServerTranslations } from "@/shared/locale/server-graphql";
import {
  countUsersByIds,
  deleteUsersByIds,
  describeGraphqlSuite,
  expectMutationError,
  extractErrorCode,
  setupTestServerLifecycle,
  TEST_PORT,
  testClient,
} from "@/test/helpers";
// Deep import: the suspension wrapper is deliberately absent from the
// `test/helpers` barrel (backend-only graphs must not pull the Apollo test
// client in) — same rationale as the journey cleanup helper.
import { withAuditDeleteTriggersSuspended } from "@/test/helpers/db-cleanup";

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
/** Shared fixture credential (registration + login probes). */
const WIRE_CREDENTIAL = "AuditWireProbe!1";
/** Admin-fixture display name — the trail's `actorName` is this live value. */
const ADMIN_FIXTURE_NAME = "Audit Wire Admin";

const PAGE_DOCUMENT = `
  query WireAuditTrailPage($filters: AdminAuditLogFiltersInput, $page: Int, $pageSize: Int) {
    adminAuditLogs(filters: $filters, page: $page, pageSize: $pageSize) {
      items {
        id
        actionType
        actorId
        actorName
        entityType
        entityId
        details
        createdAt
      }
      totalCount
      page
      pageSize
    }
  }
`;

const TOTAL_DOCUMENT = `
  query WireAuditTrailTotal($filters: AdminAuditLogFiltersInput) {
    adminAuditLogs(filters: $filters) {
      totalCount
    }
  }
`;

const LOGIN_DOCUMENT = `
  mutation WireAuditLogin($email: String!, $password: String!) {
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

/**
 * Stored audit-action value → GraphQL wire name over the canonical enum
 * (the pgEnum stores the VALUE; the wire enum member is the KEY).
 */
const AUDIT_ACTION_WIRE_NAMES: ReadonlyMap<string, string> = new Map(
  Object.entries(AuditActionType).map(([wireName, stored]): [string, string] => [stored, wireName])
);

/** The GraphQL wire NAME of a canonical audit-action runtime value. */
function wireNameOf(actionType: AuditActionType): string {
  const wireName = AUDIT_ACTION_WIRE_NAMES.get(actionType);
  if (wireName === undefined) {
    throw new Error(`no wire name for audit action type ${actionType}`);
  }
  return wireName;
}

/** Resolves a raw stored `action_type` string to its wire name (fail-closed). */
function wireNameOfStored(raw: string): string {
  const wireName = AUDIT_ACTION_WIRE_NAMES.get(raw);
  if (wireName === undefined) {
    throw new Error(`no canonical audit action for stored value ${raw}`);
  }
  return wireName;
}

/** Wire page payload, runtime-guarded. */
interface WireAuditPage {
  readonly items: readonly Record<string, unknown>[];
  readonly totalCount: number;
  readonly page: number;
  readonly pageSize: number;
}

function wireAuditPageOf(body: Record<string, unknown>): WireAuditPage {
  const data = recordOf(recordOf(body, "expected a body").data, "expected a data object");
  const page = recordOf(data.adminAuditLogs, "expected an adminAuditLogs payload");
  const rawItems = page.items;
  if (!Array.isArray(rawItems)) {
    throw new Error("expected an items array");
  }
  const items = rawItems.map(item => recordOf(item, "expected record-shaped items entry"));
  const totalCount = page.totalCount;
  if (typeof totalCount !== "number") {
    throw new Error("expected a numeric totalCount");
  }
  const resolvedPage = page.page;
  if (typeof resolvedPage !== "number") {
    throw new Error("expected a numeric page");
  }
  const pageSize = page.pageSize;
  if (typeof pageSize !== "number") {
    throw new Error("expected a numeric pageSize");
  }
  return { items, totalCount, page: resolvedPage, pageSize };
}

function wireIdOf(item: Record<string, unknown>): string {
  const id = item.id;
  if (typeof id !== "string") {
    throw new Error("expected a string id on the wire");
  }
  return id;
}

/**
 * Asserts one raw-wire denial body answers the expected extensions.code.
 * Execution-tier denials null the `data` field; validation-tier deaths
 * (the request never executed — smuggled-field rejections) omit the key
 * from the response body entirely.
 */
function expectDenialCode(
  body: Record<string, unknown>,
  expectedCode: string,
  dataMode: "null" | "absent" = "null"
): Record<string, unknown> {
  const errorItem = soleErrorItemOf(body);
  expect(errorCodeOf(errorItem)).toBe(expectedCode);
  if (dataMode === "null") {
    expect(body.data).toBeNull();
  } else {
    expect(body.data).toBeUndefined();
  }
  return errorItem;
}

// ─── Direct-DB oracle (never routed through the resolver) ────────────────────

const FIXTURE_MARKER = `audit-wire-${randomUUID().slice(0, 8)}`;

/** Counts ALL audit rows in the table (denial-no-write delta assertion). */
async function countAllAuditRows(): Promise<number> {
  const result = await db.select({ value: sql<number>`count(*)::int` }).from(auditLogs);
  return result[0]?.value ?? 0;
}

/** The suite's marker-scoped trail rows, newest-first (the exact oracle). */
async function oracleMarkerRows(): Promise<AuditLogSelectType[]> {
  return db
    .select()
    .from(auditLogs)
    .where(eq(auditLogs.entityType, FIXTURE_MARKER))
    .orderBy(desc(auditLogs.createdAt), desc(auditLogs.id));
}

// ─── Fixtures ────────────────────────────────────────────────────────────────

function fixtureEmail(label: string): string {
  return `${FIXTURE_MARKER}-${label}@test.local`;
}

/** Registers one actor over the wire through the PUBLIC registerUser mutation. */
async function registerActor(label: string, role: "Student" | "Teacher" | "Parent"): Promise<number> {
  const result = await testClient.mutate({
    mutation: gql`
      mutation RegisterAuditWireActor($input: RegisterUserInput!) {
        registerUser(input: $input) {
          id
        }
      }
    `,
    variables: {
      input: {
        fullName: `Audit Wire ${label} ${FIXTURE_MARKER}`,
        email: fixtureEmail(label),
        phone: "+15551234567",
        password: WIRE_CREDENTIAL,
        gender: null,
        country: "US",
        role,
        preferredRecitation: null,
      },
    },
  });
  if (result.error) {
    throw new Error(`registerUser failed for ${label} (code: ${extractErrorCode(result.error) ?? "unknown"})`);
  }
  return registeredUserIdOf(result);
}

/** Logs one actor in over the wire and returns the access token. */
async function loginActor(email: string, credential: string): Promise<string> {
  const result = await testClient.mutate({
    mutation: gql`
      ${LOGIN_DOCUMENT}
    `,
    variables: { email, password: credential },
  });
  if (result.error) {
    throw new Error(`login failed for ${email} (code: ${extractErrorCode(result.error) ?? "unknown"})`);
  }
  return accessTokenOf(result);
}

/**
 * Engineers the admin actor directly in the DB (admin is excluded from the
 * public registration surface). A real bcrypt hash lets the public login
 * mutation mint a genuine session for the probes.
 */
async function provisionAdminFixture(): Promise<{ readonly id: number; readonly accessToken: string }> {
  const [user] = await db
    .insert(users)
    .values({
      fullName: ADMIN_FIXTURE_NAME,
      email: fixtureEmail("admin"),
      phone: "+15551234568",
      passwordHash: await hashPassword(WIRE_CREDENTIAL),
      role: "admin",
      isDeleted: false,
      suspended: false,
      isBlocked: false,
      lastActiveAt: new Date(),
    })
    .returning();
  if (!user) {
    throw new Error("admin fixture insert returned no rows");
  }
  const accessToken = await loginActor(fixtureEmail("admin"), WIRE_CREDENTIAL);
  return { id: user.id, accessToken };
}

/** Action-type variety for the closed-projection round-trip. */
const TRAIL_ACTION_SPECS: readonly AuditActionType[] = [
  AuditActionType.Suspend,
  AuditActionType.Update,
  AuditActionType.Create,
];

/** Seeds the marker-scoped trail rows (direct committed inserts). */
async function seedTrailRows(adminId: number): Promise<AuditLogSelectType[]> {
  const now = Date.now();
  const values: AuditLogInsertType[] = TRAIL_ACTION_SPECS.map((actionType, index) => ({
    actorId: adminId,
    actionType,
    entityType: FIXTURE_MARKER,
    entityId: 91_000 + index,
    // The last row carries NO entity pointer beyond its type marker and NO
    // details — the nullable projection slots ride real nulls on the wire.
    ...(index === TRAIL_ACTION_SPECS.length - 1 ? { entityId: null } : {}),
    details: index === TRAIL_ACTION_SPECS.length - 1 ? null : `{"probe":"wire-${index}"}`,
    createdAt: new Date(now - index * 60_000),
  }));
  return db
    .insert(auditLogs)
    .values([...values])
    .returning();
}

// ─── Spy lifecycle (bun reuses ONE mock per object+method until restored) ────

interface RestorableSpy {
  readonly mockRestore: () => void;
}

const trackedSpies: RestorableSpy[] = [];

function trackSpy<T extends RestorableSpy>(spy: T): T {
  trackedSpies.push(spy);
  return spy;
}

afterEach(() => {
  for (const spy of trackedSpies) {
    spy.mockRestore();
  }
  trackedSpies.length = 0;
});

/** Grabs one service rejection via the sanctioned try/catch pattern. */
async function caughtServiceError(fn: () => Promise<unknown>): Promise<Error> {
  let errorCaught: unknown = null;
  try {
    await fn();
  } catch (error) {
    errorCaught = error;
  }
  if (!(errorCaught instanceof Error)) {
    throw new Error("expected the service call to reject with an Error instance");
  }
  return errorCaught;
}

// ─── Boundary-finalizer structural scope fixture ─────────────────────────────

function contextFixture(locale: string, requestId: string): Context {
  const translations = getServerTranslations(locale);
  return {
    locale,
    requestId,
    t: async namespace => translations[namespace],
    user: null,
    safeUser: null,
    permissions: [],
    isSuperAdmin: false,
    role: null,
    cookies: {},
    authCookieOut: createAuthCookieOut(),
  };
}

function scopeWith(singleResult: Record<string, unknown>): GraphqlResponseScope {
  return {
    request: {},
    contextValue: contextFixture("en", "audit-wire-finalizer-request-id"),
    response: { body: { kind: "single", singleResult } },
  };
}

function extensionsOf(scope: GraphqlResponseScope): Record<string, unknown> {
  const item = firstErrorItem(scope);
  return recordOf(item.extensions, "expected record-shaped extensions");
}

function firstErrorItem(scope: GraphqlResponseScope): Record<string, unknown> {
  const body = scope.response.body;
  if (body.kind !== "single" || !Array.isArray(body.singleResult.errors) || body.singleResult.errors.length === 0) {
    throw new Error("expected finalized single-result errors array with entries");
  }
  return recordOf(body.singleResult.errors[0], "expected record-shaped error item");
}

/**
 * Feeds one plain non-domain carrier through the boundary finalizer on the
 * `adminAuditLogs` path and asserts the masked INTERNAL_SERVER_ERROR
 * envelope: requestId attached, every leak material absent from the
 * serialized body, and a non-empty localized replacement message.
 */
function expectMaskedInternal(carrier: Error, leakMaterials: readonly string[]): void {
  const scope = scopeWith({
    data: { adminAuditLogs: null },
    errors: [
      {
        message: carrier.message,
        path: ["adminAuditLogs"],
        originalError: carrier,
      },
    ],
  });
  finalizeGraphqlResponseScope(scope);

  const extensions = extensionsOf(scope);
  expect(extensions.code).toBe("INTERNAL_SERVER_ERROR");
  expect(extensions.requestId).toBe("audit-wire-finalizer-request-id");
  const serialized = JSON.stringify(scope.response.body);
  expect(serialized.includes(carrier.message)).toBe(false);
  for (const material of leakMaterials) {
    expect(serialized.includes(material)).toBe(false);
  }
  expect(errorMessageOf(firstErrorItem(scope)).length).toBeGreaterThan(0);
}

// ─── State + the matrix ──────────────────────────────────────────────────────

interface AdminFixture {
  readonly id: number;
  readonly accessToken: string;
}

let adminFixture: AdminFixture | null = null;
let studentToken = "";
let teacherToken = "";
let parentToken = "";
let fixtureRowIds: readonly number[] = [];
const fixtureUserIds: number[] = [];

describeGraphqlSuite("audit-trail wire matrix (adminAuditLogs over the live HTTP pipeline)", () => {
  setupTestServerLifecycle();

  beforeAll(async () => {
    adminFixture = await provisionAdminFixture();
    fixtureUserIds.push(adminFixture.id);

    // Real registrations + logins through the public mutations (committed users).
    const [studentId, teacherId, parentId] = await Promise.all([
      registerActor("student", "Student"),
      registerActor("teacher", "Teacher"),
      registerActor("parent", "Parent"),
    ]);
    fixtureUserIds.push(studentId, teacherId, parentId);
    const [student, teacher, parent] = await Promise.all([
      loginActor(fixtureEmail("student"), WIRE_CREDENTIAL),
      loginActor(fixtureEmail("teacher"), WIRE_CREDENTIAL),
      loginActor(fixtureEmail("parent"), WIRE_CREDENTIAL),
    ]);
    studentToken = student;
    teacherToken = teacher;
    parentToken = parent;

    // Committed trail fixtures (direct inserts — the read surface writes nothing).
    const seeded = await seedTrailRows(adminFixture.id);
    fixtureRowIds = seeded.map(row => row.id);
  }, 120_000);

  afterAll(async () => {
    // Tracked trail rows delete FIRST (their actor FK is the admin fixture),
    // under the trigger-suspension wrapper — migrate-provisioned databases
    // block a bare DELETE on the append-only table.
    if (fixtureRowIds.length > 0) {
      await withAuditDeleteTriggersSuspended(() =>
        db.delete(auditLogs).where(inArray(auditLogs.id, [...fixtureRowIds]))
      );
    }
    // Every fixture user (the dedicated admin included — never the seeded
    // admin) hard-deletes via the shared helper, which pre-cleans any
    // RESTRICT-gated audit rows under the same suspension wrapper.
    const deleted = await deleteUsersByIds(fixtureUserIds);
    expect(deleted).toBe(fixtureUserIds.length);
    expect(await countUsersByIds(fixtureUserIds)).toBe(0);

    // Zero-residue probes: marker rows and actor rows are gone.
    const markerResidue = await db
      .select({ value: sql<number>`count(*)::int` })
      .from(auditLogs)
      .where(eq(auditLogs.entityType, FIXTURE_MARKER));
    expect(markerResidue[0]?.value ?? 0).toBe(0);
    if (fixtureUserIds.length > 0) {
      const actorResidue = await db
        .select({ value: sql<number>`count(*)::int` })
        .from(auditLogs)
        .where(inArray(auditLogs.actorId, fixtureUserIds));
      expect(actorResidue[0]?.value ?? 0).toBe(0);
    }
  }, 60_000);

  function requireAdminFixture(): AdminFixture {
    if (!adminFixture) {
      throw new Error("expected the admin fixture to be provisioned");
    }
    return adminFixture;
  }

  // ─── Tier 1 — denial matrix (anonymous + non-admin roles, pre-resolver) ────

  describe("wire denial matrix (anonymous + non-admin roles)", () => {
    test("anonymous caller answers UNAUTHORIZED through the canonical test client", async () => {
      const result = await testClient.query({
        query: gql`
          query WireAuditAnonymous {
            adminAuditLogs {
              totalCount
            }
          }
        `,
      });
      const error = expectMutationError(result.error, "UNAUTHORIZED");
      // The denial rides the single-error envelope — exactly one error item.
      expect(error.errors).toHaveLength(1);
    });

    test("anonymous + student/teacher/parent share the denial shape; the table never moves", async () => {
      const before = await countAllAuditRows();

      const bodies = await Promise.all([
        postAnonymous(TOTAL_DOCUMENT),
        postDocument(TOTAL_DOCUMENT, studentToken),
        postDocument(TOTAL_DOCUMENT, teacherToken),
        postDocument(TOTAL_DOCUMENT, parentToken),
      ]);
      expect(bodies).toHaveLength(4);

      const anonymousItem = expectDenialCode(bodies[0] ?? {}, "UNAUTHORIZED");
      expect(anonymousItem.path).toEqual(["adminAuditLogs"]);

      const roleItems = [
        expectDenialCode(bodies[1] ?? {}, "FORBIDDEN"),
        expectDenialCode(bodies[2] ?? {}, "FORBIDDEN"),
        expectDenialCode(bodies[3] ?? {}, "FORBIDDEN"),
      ];
      // No per-role disclosure: identical message + extensions key set
      // across student / teacher / parent.
      for (const item of roleItems) {
        expect(item.path).toEqual(["adminAuditLogs"]);
        expect(errorMessageOf(item)).toBe(errorMessageOf(roleItems[0] ?? {}));
        expect(extensionKeysOf(item)).toEqual(extensionKeysOf(roleItems[0] ?? {}));
      }

      // Zero writes across the whole denial storm (and a read denial leaves
      // no trace of any kind on the append-only table).
      expect(await countAllAuditRows()).toBe(before);
    });

    test("the scope denial precedes any service logic — hostile paging still answers FORBIDDEN", async () => {
      const body = await postDocument(PAGE_DOCUMENT, studentToken, {
        filters: { entityType: FIXTURE_MARKER },
        page: 1,
        pageSize: 0,
      });
      expectDenialCode(body, "FORBIDDEN");
    });
  });

  // ─── Tier 2 — admin happy path (closed projection + pagination echo) ──────

  describe("admin happy path (closed projection + honest envelope)", () => {
    test("the marker page matches the direct-DB oracle on ALL eight fields, in oracle order", async () => {
      const oracle = await oracleMarkerRows();
      expect(oracle).toHaveLength(TRAIL_ACTION_SPECS.length);

      const body = await postDocument(PAGE_DOCUMENT, requireAdminFixture().accessToken, {
        filters: { entityType: FIXTURE_MARKER },
      });
      expect(body.errors).toBeUndefined();
      const page = wireAuditPageOf(body);

      expect(page.totalCount).toBe(oracle.length);
      expect(page.page).toBe(1);
      expect(page.pageSize).toBe(25);

      expect(page.items.map(item => wireIdOf(item))).toEqual(oracle.map(row => String(row.id)));
      for (const [index, item] of page.items.entries()) {
        const row = oracle[index];
        if (!row) {
          throw new Error("oracle row missing for wire item");
        }
        // The closed projection — exactly the eight disclosed keys, no more.
        expect(Object.keys(item).toSorted((a, b) => a.localeCompare(b))).toEqual([
          "actionType",
          "actorId",
          "actorName",
          "createdAt",
          "details",
          "entityId",
          "entityType",
          "id",
        ]);
        expect(item.actionType).toBe(wireNameOfStored(row.actionType));
        expect(item.actorId).toBe(row.actorId);
        // Live projection: the actor's CURRENT display name (the users join).
        expect(item.actorName).toBe(ADMIN_FIXTURE_NAME);
        expect(item.entityType).toBe(row.entityType);
        expect(item.entityId).toBe(row.entityId);
        expect(item.details).toBe(row.details);
        expect(item.createdAt).toBe(row.createdAt.toISOString());
      }
    });

    test("pagination echo — explicit window, defaults, and the out-of-range honest empty page", async () => {
      const oracle = await oracleMarkerRows();
      expect(oracle).toHaveLength(TRAIL_ACTION_SPECS.length);
      const filters = { entityType: FIXTURE_MARKER };
      const admin = requireAdminFixture();

      // Explicit window: page 2 / pageSize 1 yields the second-newest row,
      // and the echoed values are the RESOLVED values verbatim.
      const windowBody = await postDocument(PAGE_DOCUMENT, admin.accessToken, { filters, page: 2, pageSize: 1 });
      expect(windowBody.errors).toBeUndefined();
      const windowPage = wireAuditPageOf(windowBody);
      expect(windowPage.page).toBe(2);
      expect(windowPage.pageSize).toBe(1);
      expect(windowPage.totalCount).toBe(oracle.length);
      expect(windowPage.items.map(item => wireIdOf(item))).toEqual([String(oracle[1]?.id)]);

      // Defaults arrive resolved (1 / 25), never clamped.
      const defaultsBody = await postDocument(PAGE_DOCUMENT, admin.accessToken, { filters });
      expect(defaultsBody.errors).toBeUndefined();
      const defaultsPage = wireAuditPageOf(defaultsBody);
      expect(defaultsPage.page).toBe(1);
      expect(defaultsPage.pageSize).toBe(25);
      expect(defaultsPage.totalCount).toBe(oracle.length);

      // Out-of-range page: EMPTY items with the unchanged honest count.
      const farBody = await postDocument(PAGE_DOCUMENT, admin.accessToken, { filters, page: 50, pageSize: 1 });
      expect(farBody.errors).toBeUndefined();
      const farPage = wireAuditPageOf(farBody);
      expect(farPage.items).toHaveLength(0);
      expect(farPage.totalCount).toBe(oracle.length);
      expect(farPage.page).toBe(50);
      expect(farPage.pageSize).toBe(1);
    });

    test("the closed actionType filter narrows exactly to its canonical member", async () => {
      const body = await postDocument(PAGE_DOCUMENT, requireAdminFixture().accessToken, {
        filters: { entityType: FIXTURE_MARKER, actionType: wireNameOf(AuditActionType.Create) },
      });
      expect(body.errors).toBeUndefined();
      const page = wireAuditPageOf(body);
      expect(page.totalCount).toBe(1);
      expect(page.items[0]?.actionType).toBe(wireNameOf(AuditActionType.Create));
    });
  });

  // ─── Tier 3 — hostile pagination (service pre-DB rejection on the wire) ───

  describe("hostile pagination (pageSize 0/101, page 0)", () => {
    test("out-of-range page bounds reject with VALIDATION; the boundary 100 stays accepted", async () => {
      const before = await countAllAuditRows();
      const admin = requireAdminFixture();
      const filters = { entityType: FIXTURE_MARKER };

      const zeroPageSize = await postDocument(PAGE_DOCUMENT, admin.accessToken, { filters, page: 1, pageSize: 0 });
      const zeroItem = expectDenialCode(zeroPageSize, "VALIDATION");
      expect(zeroItem.path).toEqual(["adminAuditLogs"]);

      const overPageSize = await postDocument(PAGE_DOCUMENT, admin.accessToken, { filters, page: 1, pageSize: 101 });
      expectDenialCode(overPageSize, "VALIDATION");

      const zeroPage = await postDocument(PAGE_DOCUMENT, admin.accessToken, { filters, page: 0, pageSize: 25 });
      expectDenialCode(zeroPage, "VALIDATION");

      // The boundary pageSize 100 is ACCEPTED with the honest echo.
      const boundaryBody = await postDocument(PAGE_DOCUMENT, admin.accessToken, { filters, page: 1, pageSize: 100 });
      expect(boundaryBody.errors).toBeUndefined();
      const boundaryPage = wireAuditPageOf(boundaryBody);
      expect(boundaryPage.page).toBe(1);
      expect(boundaryPage.pageSize).toBe(100);
      expect(boundaryPage.totalCount).toBe((await oracleMarkerRows()).length);

      // Zero row movement across all the rejected probes.
      expect(await countAllAuditRows()).toBe(before);
    });
  });

  // ─── Tier 4 — BOPLA smuggle probes (closed schema, wire tier) ─────────────

  describe("BOPLA smuggle probes (smuggled identity args + forged enum)", () => {
    test("smuggled identity fields and a forged enum literal die as GRAPHQL_VALIDATION_FAILED before any resolver runs", async () => {
      const before = await countAllAuditRows();
      const admin = requireAdminFixture();

      // userId smuggled at the ROOT selection args…
      const smuggledRoot = await postDocument("{ adminAuditLogs(userId: 12345) { totalCount } }", admin.accessToken);
      const rootItem = expectDenialCode(smuggledRoot, "GRAPHQL_VALIDATION_FAILED", "absent");
      // The rejection must NAME the smuggled member: a schema-absent server
      // (a whole-type "unknown type" answer) dies with this same code, so
      // the message text is the discriminator that keeps the probe from
      // false-passing under schema drift.
      expect(errorMessageOf(rootItem)).toMatch(/userId/);

      // …and inside the filters input…
      const smuggledFilter = await postDocument(
        "{ adminAuditLogs(filters: { userId: 12345 }) { totalCount } }",
        admin.accessToken
      );
      const filterItem = expectDenialCode(smuggledFilter, "GRAPHQL_VALIDATION_FAILED", "absent");
      expect(errorMessageOf(filterItem)).toMatch(/userId/);

      // …a forged enum literal for the action filter…
      const forgedEnum = await postDocument(
        "{ adminAuditLogs(filters: { actionType: NOT_A_REAL_ACTION }) { totalCount } }",
        admin.accessToken
      );
      expectDenialCode(forgedEnum, "GRAPHQL_VALIDATION_FAILED", "absent");

      // …and an Int-overflow id beyond the wire's 32-bit Int.
      const intOverflow = await postDocument(
        "{ adminAuditLogs(filters: { actorId: 99999999999999 }) { totalCount } }",
        admin.accessToken
      );
      expectDenialCode(intOverflow, "GRAPHQL_VALIDATION_FAILED", "absent");

      // The validation tier cannot move rows — and the closed schema never
      // let a resolver run to try.
      expect(await countAllAuditRows()).toBe(before);
    });
  });

  // ─── Tier 5 — chaos (corrupt stored enum → masked internal) ───────────────

  describe("chaos tier — corrupt stored enum fails closed and masks at the boundary", () => {
    test("unknown raw actionType → plain non-domain Error, masked to INTERNAL_SERVER_ERROR with zero leak material", async () => {
      const admin = requireAdminFixture();

      // A corrupt stored value cannot be inserted through the pgEnum, so the
      // raw row is substituted at the repository seam (the sanctioned
      // injection point): the canned row carries an `action_type` string
      // outside the canonical member set while the REAL admin gate runs.
      const corruptRow = {
        id: 987_654_321,
        actionType: "wire_matrix_corrupt",
        actorId: admin.id,
        actorName: ADMIN_FIXTURE_NAME,
        entityType: FIXTURE_MARKER,
        entityId: null,
        details: null,
        createdAt: new Date(),
      };
      const countSpy = trackSpy(spyOn(AuditTrailRepository, "countEntries").mockResolvedValue(1));
      const listSpy = trackSpy(spyOn(AuditTrailRepository, "listEntries").mockResolvedValue([corruptRow]));

      const error = await caughtServiceError(() => AuditTrailService.listAuditTrail({}, 1, 25, "en", admin.id));

      // The failure happens at map time, AFTER the paired snapshot reads ran.
      expect(countSpy).toHaveBeenCalledTimes(1);
      expect(listSpy).toHaveBeenCalledTimes(1);
      // Fail-closed: a plain runtime error — never a domain error code,
      // never an unsafe cast — carrying the raw stored value.
      expect(error).toBeInstanceOf(Error);
      expect(error).not.toBeInstanceOf(DomainError);
      expect(error.message).toContain("wire_matrix_corrupt");

      // The boundary masks the exact thrown carrier: localized
      // INTERNAL_SERVER_ERROR with a requestId and NO leak material
      // (no raw stored value, no mapper prose, not the thrown message).
      expectMaskedInternal(error, ["wire_matrix_corrupt", "Unexpected audit action type"]);
    });

    test("generic unexpected-internal fault from the snapshot read → masked INTERNAL_SERVER_ERROR with zero leak material", async () => {
      const admin = requireAdminFixture();

      // The real admin gate passes; the paired snapshot read then fails
      // with a generic non-domain fault injected at the repository seam —
      // the read-stage rejection means the listing leg never even runs.
      const countSpy = trackSpy(
        spyOn(AuditTrailRepository, "countEntries").mockRejectedValue(
          new Error("snapshot read failed: connection terminated unexpectedly")
        )
      );
      const listSpy = trackSpy(spyOn(AuditTrailRepository, "listEntries").mockResolvedValue([]));

      const error = await caughtServiceError(() => AuditTrailService.listAuditTrail({}, 1, 25, "en", admin.id));

      expect(countSpy).toHaveBeenCalledTimes(1);
      expect(listSpy).not.toHaveBeenCalled();
      // Fail-closed: the internal carrier is a plain runtime error — never
      // a domain code — and its prose is diagnostics for the correlated log
      // line only, never for the client envelope.
      expect(error).toBeInstanceOf(Error);
      expect(error).not.toBeInstanceOf(DomainError);
      expect(error.message).toContain("connection terminated unexpectedly");

      expectMaskedInternal(error, ["connection terminated unexpectedly"]);
    });
  });
});
