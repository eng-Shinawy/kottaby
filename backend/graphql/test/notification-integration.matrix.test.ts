/**
 * Consolidated GraphQL integration matrix — the role × operation tier for the
 * notification inbox surface (`setupTestServerLifecycle` + `testClient`).
 *
 * This is the 5.1 consolidation suite: the FULL matrix over the four inbox
 * operations (`myNotifications`, `myUnreadNotificationCount`,
 * `markNotificationRead`, `markAllNotificationsRead`) crossed with every
 * caller class the permission matrix (plan §3.4) recognizes. It extends —
 * never replaces — the 3.2 query suite and the 3.3 mutation suite.
 *
 * Matrix cells locked down over the REAL wire (HTTP → gateway pipeline →
 * scope-auth → resolver → NotificationEngine → PostgreSQL → back):
 *  - **Anonymous × 4 ops** — every operation answers UNAUTHORIZED
 *    (extensions.code) for credential-less callers, and the denial shape is
 *    CONSTANT across all four ops (same code, same localized message, same
 *    single-item envelope, null data — each op carrying only its own path).
 *  - **student / teacher / parent / admin × read ops** — every authenticated
 *    role reads EXACTLY its own inbox: the wire page is equivalent to an
 *    independent direct-DB oracle for that user (items, ordering, ids,
 *    totalCount, hasMore) and NEVER contains another actor's rows (pairwise
 *    cross-inbox isolation).
 *  - **Filter → content coherence** — `type` / `isRead` conjunctive filters
 *    match the same DB oracle for every role over the wire.
 *  - **Pagination caps** — `limit` 51 / 0 / -1 and negative `offset` reject
 *    with VALIDATION; the boundary `limit` 50 is accepted and window-equivalent
 *    to the oracle.
 *  - **student / teacher / parent / admin × mark ops** — every role marks its
 *    OWN rows (wire row ≡ post-update DB row on all eight fields; idempotent
 *    double-mark; type-filtered and unfiltered sweeps ≡ oracle counts; empty
 *    sets answer 0), while EVERY foreign-row probe across the full actor
 *    matrix — including the parent-outsider probes — answers the
 *    oracle-safe NOTIFICATION_NOT_FOUND, byte-identical victims, and a
 *    NONEXISTENT id is envelope-identical to a foreign one.
 *  - **Governed caller (suspended / blocked / deleted)** — the denial is
 *    CONTEXT-level (the auth session tier), never row-level: a governed
 *    account cannot mint a session (login → FORBIDDEN) with a denial shape
 *    constant across all three governance branches (no disclosure of WHICH
 *    branch applies). A pre-issued, still-valid access token retains its
 *    self-scoped inbox surface — reads and mark ops alike — until expiry
 *    (the documented governance window; the notification surface itself
 *    carries NO governance handling, so the gap vs the FAIL-CLOSED
 *    SSR/session tiers is recorded in the deferred-items ledger, row D5)
 *    — and the governed caller's BOLA posture is unchanged (a foreign id
 *    still answers the identical NOTIFICATION_NOT_FOUND).
 *  - **BOPLA wire probes** — smuggled identity fields (`filter.userId`,
 *    unknown root args, `userId` on either mutation) die as
 *    GRAPHQL_VALIDATION_FAILED before any resolver runs.
 *
 * Fixture strategy (3.2/3.3 conventions):
 *  - The four non-admin actors are created through the PUBLIC `registerUser`
 *    mutation over the wire (real registration path, real password hashes) so
 *    their logins exercise the genuine credential path. The admin actor rides
 *    the seeded admin (`ADMIN_EMAIL`/`ADMIN_PASSWORD` — the seed's own
 *    env-fallback chain); its USER row is never deleted — only its fixture
 *    notification rows are (the seeded 44-row inbox is provably untouched:
 *    every sweep only matches `is_read = false` and the seeded rows start
 *    all-read, pinned by a pre-suite snapshot + end-state count check).
 *  - The governed actor registers as a student and logs in while ACTIVE
 *    (minting a valid access token); the governance flags are then flipped
 *    directly in the DB between probes — exactly how a suspension lands in
 *    production after a token was issued.
 *  - Inbox rows are seeded with direct committed inserts (never the emit
 *    surface) and torn down in `afterAll` (rows → role-child rows → users).
 *  - Authenticated calls carry the `Authorization: Bearer` header (the
 *    documented production client path read by `createGraphQLContext`) on a
 *    raw fetch — the shared `testClient`'s fixed HttpLink cannot attach
 *    per-request auth headers. Anonymous/login probes use `testClient` with
 *    `expectMutationError` (the canonical helper), while envelope-constancy
 *    assertions ride the raw wire (Apollo v4's CombinedGraphQLErrors.message
 *    is a joined-message convenience, not the stable contract).
 *  - Tests mutate fixture state sequentially; every assertion derives its
 *    expectation from a fresh direct-DB oracle read (deltas, not absolute
 *    positions), so ordering brittleness cannot mask a semantic break.
 *
 * ENVIRONMENT NOTE (sandbox): the canonical lifecycle helper boots its own
 * dev server on TEST_PORT (3066) when nothing answers there. Where the
 * interactive dev server already owns port 3000 (Next 16 refuses a second
 * dev server on the same tree), point the suite at the LIVE server via
 * `GRAPHQL_TEST_PORT=3000` — the helper's liveness probe then succeeds and
 * no second server is spawned (or killed). CI boots the canonical 3066 path.
 *
 * Mandated runner: bun run test/scripts/run-test.ts backend/graphql/test/notification-integration.matrix.test.ts
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { gql } from "@apollo/client";
import { and, count, desc, eq, inArray, type SQL } from "drizzle-orm";
import { db } from "@/backend/db";
import { notifications } from "@/backend/db/schema/notifications/notifications";
import { parents } from "@/backend/db/schema/parents/parents";
import { students } from "@/backend/db/schema/students/students";
import { applicants } from "@/backend/db/schema/teachers/applicants";
import { users } from "@/backend/db/schema/users/users";
import { isNotificationType, NotificationType } from "@/backend/enum/notifications/notification-type.enum";
import type { NotificationInsertType, NotificationSelectType } from "@/backend/types";
import { expectMutationError, extractErrorCode, setupTestServerLifecycle, TEST_PORT, testClient } from "@/test/helpers";

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
const WIRE_CREDENTIAL = "WireMatrix!Pass1";
/** Seeded-admin credentials — the seed's own env-fallback chain. */
const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? "admin@draftacademy.local";
const ADMIN_CREDENTIAL = process.env.ADMIN_PASSWORD ?? "Seed_Pass1!";

const LIST_DOCUMENT = `
  query WireMatrixPage($filter: MyNotificationsFilterInput) {
    myNotifications(filter: $filter) {
      items {
        id
        type
        title
        isRead
        createdAt
      }
      totalCount
      hasMore
    }
  }
`;

const COUNT_DOCUMENT = `
  query WireMatrixUnread {
    myUnreadNotificationCount
  }
`;

const MARK_ONE_DOCUMENT = `
  mutation WireMatrixMarkOne($id: ID!) {
    markNotificationRead(id: $id) {
      id
      type
      title
      body
      isRead
      relatedEntityType
      relatedEntityId
      createdAt
    }
  }
`;

const MARK_ALL_DOCUMENT = `
  mutation WireMatrixMarkAll($type: NotificationType) {
    markAllNotificationsRead(type: $type)
  }
`;

const LOGIN_DOCUMENT = `
  mutation WireMatrixLogin($email: String!, $password: String!) {
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

/** The GraphQL wire NAME of a canonical notification-type runtime value. */
function wireNameOf(type: NotificationType): string {
  const entry = Object.entries(NotificationType).find(([, value]) => value === type);
  if (entry === undefined) {
    throw new Error(`no wire name for notification type ${type}`);
  }
  return entry[0];
}

/** Wire page payload, runtime-guarded. */
interface WirePage {
  readonly items: readonly Record<string, unknown>[];
  readonly totalCount: number;
  readonly hasMore: boolean;
}

function wirePageOf(body: Record<string, unknown>): WirePage {
  const data = recordOf(recordOf(body, "expected a body").data, "expected a data object");
  const page = recordOf(data.myNotifications, "expected a myNotifications payload");
  const rawItems = page.items;
  if (!Array.isArray(rawItems)) {
    throw new Error("expected an items array");
  }
  const items = rawItems.map(item => recordOf(item, "expected record-shaped items entry"));
  const totalCount = page.totalCount;
  if (typeof totalCount !== "number") {
    throw new Error("expected a numeric totalCount");
  }
  const hasMore = page.hasMore;
  if (typeof hasMore !== "boolean") {
    throw new Error("expected a boolean hasMore");
  }
  return { items, totalCount, hasMore };
}

function wireIdOf(item: Record<string, unknown>): string {
  const id = item.id;
  if (typeof id !== "string") {
    throw new Error("expected a string id on the wire");
  }
  return id;
}

function wireTitleOf(item: Record<string, unknown>): string {
  const title = item.title;
  if (typeof title !== "string") {
    throw new Error("expected a string title on the wire");
  }
  return title;
}

function wireUnreadCountOf(body: Record<string, unknown>): number {
  const data = recordOf(recordOf(body, "expected a body").data, "expected a data object");
  const value = data.myUnreadNotificationCount;
  if (typeof value !== "number") {
    throw new Error("expected a numeric myUnreadNotificationCount");
  }
  return value;
}

/** The wire `Notification` payload of a successful markNotificationRead call. */
function wireNotificationOf(body: Record<string, unknown>): Record<string, unknown> {
  const data = recordOf(recordOf(body, "expected a body").data, "expected a data object");
  return recordOf(data.markNotificationRead, "expected a markNotificationRead payload");
}

/** The wire affected-count of a successful markAllNotificationsRead call. */
function wireMarkAllCountOf(body: Record<string, unknown>): number {
  const data = recordOf(recordOf(body, "expected a body").data, "expected a data object");
  const value = data.markAllNotificationsRead;
  if (typeof value !== "number") {
    throw new Error("expected a numeric markAllNotificationsRead count");
  }
  return value;
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

// ─── Direct-DB oracle (never routed through the engine) ──────────────────────

type OracleFilters = { readonly type?: NotificationType | null; readonly isRead?: boolean | null };

function oracleConditions(userId: number, filters: OracleFilters): SQL[] {
  const conditions: SQL[] = [eq(notifications.userId, userId)];
  if (filters.type != null) {
    conditions.push(eq(notifications.type, filters.type));
  }
  if (filters.isRead != null) {
    conditions.push(eq(notifications.isRead, filters.isRead));
  }
  return conditions;
}

async function oracleRows(userId: number, filters: OracleFilters = {}): Promise<NotificationSelectType[]> {
  return db
    .select()
    .from(notifications)
    .where(and(...oracleConditions(userId, filters)))
    .orderBy(desc(notifications.createdAt), desc(notifications.id));
}

async function oracleRowById(id: number): Promise<NotificationSelectType | null> {
  const [row] = await db.select().from(notifications).where(eq(notifications.id, id)).limit(1);
  return row ?? null;
}

/** Count of the user's UNREAD rows, optionally narrowed to one type. */
async function oracleUnreadCount(userId: number, type?: NotificationType): Promise<number> {
  const conditions: SQL[] = [eq(notifications.userId, userId), eq(notifications.isRead, false)];
  if (type != null) {
    conditions.push(eq(notifications.type, type));
  }
  const [row] = await db
    .select({ value: count() })
    .from(notifications)
    .where(and(...conditions));
  return row?.value ?? 0;
}

// ─── Fixtures ────────────────────────────────────────────────────────────────

interface RowSpec {
  readonly type: NotificationType;
  readonly isRead: boolean;
  readonly minutesAgo: number;
}

/** One wire-tier actor: a real session + its seeded inbox rows. */
interface WireActor {
  readonly label: string;
  readonly userId: number;
  readonly accessToken: string;
  readonly rows: readonly NotificationSelectType[];
}

const FIXTURE_MARKER = `matrix-${randomUUID().slice(0, 8)}`;

function fixtureTitle(label: string, index: number): string {
  return `${FIXTURE_MARKER} ${label} notice ${index + 1}`;
}

// Richest matrix: seeded-read rows for the byte-identical closure, a
// SystemBroadcast mark-one subject, a SessionRequest type-sweep subject, and
// a PaymentConfirmation foreign-probe victim.
const STUDENT_SPECS: readonly RowSpec[] = [
  { type: NotificationType.SystemBroadcast, isRead: true, minutesAgo: 50 },
  { type: NotificationType.SystemBroadcast, isRead: false, minutesAgo: 40 },
  { type: NotificationType.SessionRequest, isRead: true, minutesAgo: 30 },
  { type: NotificationType.SessionRequest, isRead: false, minutesAgo: 20 },
  { type: NotificationType.PaymentConfirmation, isRead: false, minutesAgo: 10 },
];

// Teacher: a SessionCompletion mark-one subject + a SystemBroadcast victim.
const TEACHER_SPECS: readonly RowSpec[] = [
  { type: NotificationType.SessionCompletion, isRead: true, minutesAgo: 25 },
  { type: NotificationType.SessionCompletion, isRead: false, minutesAgo: 15 },
  { type: NotificationType.SystemBroadcast, isRead: false, minutesAgo: 5 },
];

// Parent: a ParentLinkRequest mark-one subject + a SystemBroadcast victim
// (the parent-outsider posture — INV-P2: a parent never reaches a child's
// inbox, and foreign probes answer the oracle-safe denial).
const PARENT_SPECS: readonly RowSpec[] = [
  { type: NotificationType.ParentLinkRequest, isRead: true, minutesAgo: 35 },
  { type: NotificationType.ParentLinkRequest, isRead: false, minutesAgo: 20 },
  { type: NotificationType.SystemBroadcast, isRead: false, minutesAgo: 5 },
];

// Admin: a SystemBroadcast mark-one subject + a SessionCompletion victim.
const ADMIN_SPECS: readonly RowSpec[] = [
  { type: NotificationType.PaymentConfirmation, isRead: true, minutesAgo: 55 },
  { type: NotificationType.SystemBroadcast, isRead: false, minutesAgo: 45 },
  { type: NotificationType.SessionCompletion, isRead: false, minutesAgo: 8 },
];

// Governed actor: one read row + one unread row — enough to prove the
// pre-issued-token self-scoped window against its own oracle.
const GOVERNED_SPECS: readonly RowSpec[] = [
  { type: NotificationType.SessionRequest, isRead: true, minutesAgo: 12 },
  { type: NotificationType.SystemBroadcast, isRead: false, minutesAgo: 6 },
];

/** Seeds committed inbox rows for one user (direct insert — never the emit surface). */
async function seedRows(userId: number, label: string, specs: readonly RowSpec[]): Promise<NotificationSelectType[]> {
  const now = Date.now();
  const values: NotificationInsertType[] = specs.map((spec, i) => ({
    userId,
    type: spec.type,
    title: fixtureTitle(label, i),
    body: `Body for ${fixtureTitle(label, i)}`,
    isRead: spec.isRead,
    relatedEntityType: "session",
    relatedEntityId: 79_000 + i,
    createdAt: new Date(now - spec.minutesAgo * 60_000),
  }));
  return db
    .insert(notifications)
    .values([...values])
    .returning();
}

/** Registers one actor over the wire through the PUBLIC registerUser mutation. */
async function registerActor(label: string, role: "Student" | "Teacher" | "Parent"): Promise<number> {
  const result = await testClient.mutate({
    mutation: gql`
      mutation RegisterWireMatrixActor($input: RegisterUserInput!) {
        registerUser(input: $input) {
          id
        }
      }
    `,
    variables: {
      input: {
        fullName: `Wire Matrix ${label} ${FIXTURE_MARKER}`,
        email: `${FIXTURE_MARKER}-${label}@test.local`,
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
  return registeredUserIdOf(result);
}

/** Logs one actor in over the wire and returns the access token. */
async function loginActor(email: string, credential: string): Promise<string> {
  const result = await testClient.mutate({
    mutation: gql`
      mutation LoginWireMatrixActor($email: String!, $password: String!) {
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

/** The governed caller's login probe through the canonical test client. */
function loginProbe(email: string, credential: string) {
  return testClient.mutate({
    mutation: gql`
      mutation GovernedLoginMatrixProbe($email: String!, $password: String!) {
        login(email: $email, password: $password) {
          accessToken
        }
      }
    `,
    variables: { email, password: credential },
  });
}

/** Governance caller states probed by the matrix (REQ-038). */
type GovernanceState = "active" | "suspended" | "blocked" | "deleted";

/**
 * Flips the governed actor's governance flags directly in the DB — exactly
 * how a suspension lands in production AFTER a token was minted.
 */
async function applyGovernanceState(userId: number, state: GovernanceState): Promise<void> {
  const now = new Date();
  await db
    .update(users)
    .set({
      suspended: state === "suspended",
      suspendedAt: state === "suspended" ? now : null,
      isBlocked: state === "blocked",
      blockedAt: state === "blocked" ? now : null,
      isDeleted: state === "deleted",
      deletedAt: state === "deleted" ? now : null,
    })
    .where(eq(users.id, userId));
}

let actors: readonly WireActor[] = [];
let adminUserId = 0;
/** The seeded admin's TOTAL row count before any fixture lands — the untouched-seed proof. */
let adminPreSuiteTotal = 0;
let governedUserId = 0;
let governedAccessToken = "";

beforeAll(async () => {
  // Real registrations through the public mutation (committed users).
  const [studentId, teacherId, parentId, governedId] = await Promise.all([
    registerActor("student", "Student"),
    registerActor("teacher", "Teacher"),
    registerActor("parent", "Parent"),
    registerActor("governed", "Student"),
  ]);
  // Real logins — the seeded admin rides its env-fallback credentials; the
  // governed actor logs in while ACTIVE (mints the pre-issued token).
  const [studentToken, teacherToken, parentToken, adminToken, governedToken] = await Promise.all([
    loginActor(`${FIXTURE_MARKER}-student@test.local`, WIRE_CREDENTIAL),
    loginActor(`${FIXTURE_MARKER}-teacher@test.local`, WIRE_CREDENTIAL),
    loginActor(`${FIXTURE_MARKER}-parent@test.local`, WIRE_CREDENTIAL),
    loginActor(ADMIN_EMAIL, ADMIN_CREDENTIAL),
    loginActor(`${FIXTURE_MARKER}-governed@test.local`, WIRE_CREDENTIAL),
  ]);
  const [adminRow] = await db.select({ id: users.id }).from(users).where(eq(users.email, ADMIN_EMAIL)).limit(1);
  if (!adminRow) {
    throw new Error(`seeded admin ${ADMIN_EMAIL} not found`);
  }
  adminUserId = adminRow.id;
  adminPreSuiteTotal = (await oracleRows(adminUserId)).length;
  governedUserId = governedId;
  governedAccessToken = governedToken;

  // Committed inbox fixtures (direct inserts — never the emit surface).
  const [studentRows, teacherRows, parentRows, adminRows] = await Promise.all([
    seedRows(studentId, "student", STUDENT_SPECS),
    seedRows(teacherId, "teacher", TEACHER_SPECS),
    seedRows(parentId, "parent", PARENT_SPECS),
    seedRows(adminUserId, "admin", ADMIN_SPECS),
    seedRows(governedId, "governed", GOVERNED_SPECS),
  ]);

  actors = [
    { label: "student", userId: studentId, accessToken: studentToken, rows: studentRows },
    { label: "teacher", userId: teacherId, accessToken: teacherToken, rows: teacherRows },
    { label: "parent", userId: parentId, accessToken: parentToken, rows: parentRows },
    { label: "admin", userId: adminUserId, accessToken: adminToken, rows: adminRows },
  ];
}, 120_000);

afterAll(async () => {
  // Every registered fixture user (the governed actor included — it is a
  // plain student fixture, never the seeded admin) cascades its rows.
  const registeredUserIds = actors.filter(actor => actor.userId !== adminUserId).map(actor => actor.userId);
  if (governedUserId !== adminUserId && governedUserId > 0) {
    registeredUserIds.push(governedUserId);
  }
  const adminNotificationIds = actors
    .filter(actor => actor.userId === adminUserId)
    .flatMap(actor => actor.rows.map(row => row.id));

  // The seeded admin's user row is NEVER deleted — only its fixture rows.
  if (adminNotificationIds.length > 0) {
    await db.delete(notifications).where(inArray(notifications.id, adminNotificationIds));
  }
  // Fixture users cascade their notifications; delete role-child rows before
  // the user rows (FK-safe order).
  if (registeredUserIds.length > 0) {
    await db.delete(students).where(inArray(students.id, registeredUserIds));
    await db.delete(applicants).where(inArray(applicants.id, registeredUserIds));
    await db.delete(parents).where(inArray(parents.id, registeredUserIds));
    await db.delete(notifications).where(inArray(notifications.userId, registeredUserIds));
    await db.delete(users).where(inArray(users.id, registeredUserIds));
  }
}, 60_000);

// ─── Assertion helpers ───────────────────────────────────────────────────────

/** Full wire ≡ oracle equivalence for one actor's page (items, order, ids, totals, hasMore). */
async function expectPageEquivalentToOracle(
  actor: WireActor,
  filters: OracleFilters = {},
  window?: { readonly limit: number; readonly offset: number }
): Promise<WirePage> {
  const oracle = await oracleRows(actor.userId, filters);
  const effectiveWindow = window ?? { limit: 20, offset: 0 };
  const expectedWindow = oracle.slice(effectiveWindow.offset, effectiveWindow.offset + effectiveWindow.limit);
  const expectedIds = expectedWindow.map(row => String(row.id));

  const filterVariable: Record<string, unknown> = { ...window };
  if (filters.type != null) {
    filterVariable.type = wireNameOf(filters.type);
  }
  if (filters.isRead != null) {
    filterVariable.isRead = filters.isRead;
  }

  const body = await postDocument(LIST_DOCUMENT, actor.accessToken, { filter: filterVariable });
  const page = wirePageOf(body);
  expect(body.errors).toBeUndefined();

  expect(page.items.map(item => wireIdOf(item))).toEqual(expectedIds);
  expect(page.items.map(item => wireTitleOf(item))).toEqual(expectedWindow.map(row => row.title));
  expect(page.totalCount).toBe(oracle.length);
  expect(page.hasMore).toBe(effectiveWindow.offset + expectedWindow.length < oracle.length);
  return page;
}

function actorByLabel(label: string): WireActor {
  const actor = actors.find(candidate => candidate.label === label);
  if (!actor) {
    throw new Error(`expected the ${label} actor fixture`);
  }
  return actor;
}

/** Finds one of an actor's seeded rows by kind + read state (enum-guarded). */
function rowBySpec(actor: WireActor, type: NotificationType, isRead: boolean): NotificationSelectType {
  const row = actor.rows.find(
    candidate => isNotificationType(candidate.type) && candidate.type === type && candidate.isRead === isRead
  );
  if (!row) {
    throw new Error(`expected a ${isRead ? "read" : "unread"} ${type} fixture row for ${actor.label}`);
  }
  return row;
}

/** The actor's UNREAD row designated as its own mark-one subject. */
function subjectRowOf(actor: WireActor): NotificationSelectType {
  const subjectTypeByLabel: Record<string, NotificationType> = {
    student: NotificationType.SystemBroadcast,
    teacher: NotificationType.SessionCompletion,
    parent: NotificationType.ParentLinkRequest,
    admin: NotificationType.SystemBroadcast,
  };
  return rowBySpec(actor, subjectTypeByLabel[actor.label], false);
}

/** The actor's UNREAD row designated as the foreign-probe VICTIM (distinct kind from the subject). */
function victimRowOf(actor: WireActor): NotificationSelectType {
  const victimTypeByLabel: Record<string, NotificationType> = {
    student: NotificationType.PaymentConfirmation,
    teacher: NotificationType.SystemBroadcast,
    parent: NotificationType.SystemBroadcast,
    admin: NotificationType.SessionCompletion,
  };
  return rowBySpec(actor, victimTypeByLabel[actor.label], false);
}

/** One authenticated markNotificationRead over the wire. */
function markOne(accessToken: string, id: string): Promise<Record<string, unknown>> {
  return postDocument(MARK_ONE_DOCUMENT, accessToken, { id });
}

/** One authenticated markAllNotificationsRead over the wire. */
function markAll(accessToken: string, type?: string): Promise<Record<string, unknown>> {
  const variables: Record<string, unknown> = {};
  if (type !== undefined) {
    variables.type = type;
  }
  return postDocument(MARK_ALL_DOCUMENT, accessToken, variables);
}

/** Full wire ≡ DB-row equivalence on ALL eight disclosed fields. */
function expectWireRowMatchesDbRow(wireRow: Record<string, unknown>, dbRow: NotificationSelectType): void {
  if (!isNotificationType(dbRow.type)) {
    throw new Error(`unexpected notification type in DB row: ${dbRow.type}`);
  }
  expect(wireRow.id).toBe(String(dbRow.id));
  expect(wireRow.type).toBe(wireNameOf(dbRow.type));
  expect(wireRow.title).toBe(dbRow.title);
  expect(wireRow.body).toBe(dbRow.body);
  expect(wireRow.isRead).toBe(dbRow.isRead ?? false);
  expect(wireRow.relatedEntityType).toBe(dbRow.relatedEntityType);
  expect(wireRow.relatedEntityId).toBe(dbRow.relatedEntityId);
  expect(wireRow.createdAt).toBe(dbRow.createdAt.toISOString());
}

/** Byte-identical full-row comparison (dates via ISO serialization). */
function expectRowsByteIdentical(actual: NotificationSelectType, expected: NotificationSelectType): void {
  expect(JSON.stringify(actual)).toBe(JSON.stringify(expected));
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

// ─── Matrix: anonymous tier ──────────────────────────────────────────────────

describe("integration matrix — anonymous tier (role-less caller × 4 ops)", () => {
  test("myNotifications answers UNAUTHORIZED for anonymous callers", async () => {
    const result = await testClient.query({
      query: gql`
        query MatrixAnonymousList {
          myNotifications {
            totalCount
          }
        }
      `,
      fetchPolicy: "no-cache",
    });
    const error = expectMutationError(result.error, "UNAUTHORIZED");
    // The denial rides the single-error envelope — exactly one error item.
    expect(error.errors).toHaveLength(1);
  });

  test("myUnreadNotificationCount answers UNAUTHORIZED for anonymous callers", async () => {
    const result = await testClient.query({
      query: gql`
        query MatrixAnonymousUnread {
          myUnreadNotificationCount
        }
      `,
      fetchPolicy: "no-cache",
    });
    const error = expectMutationError(result.error, "UNAUTHORIZED");
    // The denial rides the single-error envelope — exactly one error item.
    expect(error.errors).toHaveLength(1);
  });

  test("markNotificationRead answers UNAUTHORIZED for anonymous callers", async () => {
    const result = await testClient.mutate({
      mutation: gql`
        mutation MatrixAnonymousMarkOne($id: ID!) {
          markNotificationRead(id: $id) {
            id
          }
        }
      `,
      variables: { id: "1" },
    });
    const error = expectMutationError(result.error, "UNAUTHORIZED");
    // The denial rides the single-error envelope — exactly one error item.
    expect(error.errors).toHaveLength(1);
  });

  test("markAllNotificationsRead answers UNAUTHORIZED for anonymous callers", async () => {
    const result = await testClient.mutate({
      mutation: gql`
        mutation MatrixAnonymousMarkAll {
          markAllNotificationsRead
        }
      `,
    });
    const error = expectMutationError(result.error, "UNAUTHORIZED");
    // The denial rides the single-error envelope — exactly one error item.
    expect(error.errors).toHaveLength(1);
  });

  test("the anonymous denial shape is CONSTANT across all four operations (REQ-039)", async () => {
    // Each op rides its own request — the single-error envelope per operation.
    const listBody = await postAnonymous("{ myNotifications { totalCount } }");
    const countBody = await postAnonymous("query { myUnreadNotificationCount }");
    const markOneBody = await postAnonymous('mutation { markNotificationRead(id: "1") { id } }');
    const markAllBody = await postAnonymous("mutation { markAllNotificationsRead }");

    const items = [listBody, countBody, markOneBody, markAllBody].map(body => expectDenialCode(body, "UNAUTHORIZED"));

    // Same localized message on ALL four ops — no per-op disclosure.
    for (const item of items.slice(1)) {
      expect(errorMessageOf(item)).toBe(errorMessageOf(items[0]));
    }
    // Each error carries its OWN path (the failing root field)…
    expect(items[0].path).toEqual(["myNotifications"]);
    expect(items[1].path).toEqual(["myUnreadNotificationCount"]);
    expect(items[2].path).toEqual(["markNotificationRead"]);
    expect(items[3].path).toEqual(["markAllNotificationsRead"]);
    // …and the same single-item envelope with the same extensions key set.
    for (const item of items.slice(1)) {
      expect(extensionKeysOf(item)).toEqual(extensionKeysOf(items[0]));
    }
  });
});

// ─── Matrix: authenticated roles × read ops ─────────────────────────────────

describe("integration matrix — every authenticated role reads ONLY its own inbox", () => {
  test("each role's wire page is EXACTLY its own DB oracle (items, order, ids, totals, hasMore)", async () => {
    const pages = await Promise.all(actors.map(async actor => expectPageEquivalentToOracle(actor)));
    expect(pages).toHaveLength(4);
  });

  test("cross-inbox isolation — no role's page EVER contains another actor's fixture rows", async () => {
    const results = await Promise.all(
      actors.map(async actor => ({
        actor,
        body: await postDocument(LIST_DOCUMENT, actor.accessToken, {}),
        oracleTitles: new Set((await oracleRows(actor.userId)).map(row => row.title)),
      }))
    );
    for (const { actor, body, oracleTitles } of results) {
      const page = wirePageOf(body);
      // Every returned row belongs to this actor's own oracle…
      for (const item of page.items) {
        expect(oracleTitles.has(wireTitleOf(item))).toBe(true);
      }
      // …and NO foreign fixture title ever appears (pairwise, all roles).
      for (const other of actors) {
        if (other.label === actor.label) {
          continue;
        }
        for (const foreignRow of other.rows) {
          expect(page.items.some(item => wireTitleOf(item) === foreignRow.title)).toBe(false);
        }
      }
    }
  });

  test("myUnreadNotificationCount matches the direct-DB unread oracle for every role", async () => {
    const results = await Promise.all(
      actors.map(async actor => ({
        body: await postDocument(COUNT_DOCUMENT, actor.accessToken),
        oracle: await oracleUnreadCount(actor.userId),
      }))
    );
    for (const { body, oracle } of results) {
      expect(body.errors).toBeUndefined();
      expect(wireUnreadCountOf(body)).toBe(oracle);
    }
  });

  test("filter → content coherence: type and isRead filters return ONLY matching rows, oracle-verified per role", async () => {
    // Type filter for every role (each against its own oracle).
    await expectPageEquivalentToOracle(actorByLabel("student"), { type: NotificationType.SessionRequest });
    await expectPageEquivalentToOracle(actorByLabel("teacher"), { type: NotificationType.SessionCompletion });
    await expectPageEquivalentToOracle(actorByLabel("parent"), { type: NotificationType.ParentLinkRequest });
    await expectPageEquivalentToOracle(actorByLabel("admin"), { type: NotificationType.SystemBroadcast });
    // Read-state filters…
    await expectPageEquivalentToOracle(actorByLabel("student"), { isRead: false });
    await expectPageEquivalentToOracle(actorByLabel("student"), { isRead: true });
    await expectPageEquivalentToOracle(actorByLabel("admin"), { isRead: false });
    // …and the conjunctive composition.
    await expectPageEquivalentToOracle(actorByLabel("student"), {
      type: NotificationType.SessionRequest,
      isRead: false,
    });
  });

  test("pagination caps: limit 51/0/-1 and negative offset reject with VALIDATION; boundary limit 50 is accepted", async () => {
    const student = actorByLabel("student");
    const oracleBefore = await oracleRows(student.userId);

    // Out-of-range windows die as VALIDATION with the null-data envelope.
    const overLimit = await postDocument(LIST_DOCUMENT, student.accessToken, { filter: { limit: 51 } });
    const overLimitItem = expectDenialCode(overLimit, "VALIDATION");
    expect(overLimitItem.path).toEqual(["myNotifications"]);

    const zeroLimit = await postDocument(LIST_DOCUMENT, student.accessToken, { filter: { limit: 0 } });
    expectDenialCode(zeroLimit, "VALIDATION");
    const negativeLimit = await postDocument(LIST_DOCUMENT, student.accessToken, { filter: { limit: -1 } });
    expectDenialCode(negativeLimit, "VALIDATION");
    const negativeOffset = await postDocument(LIST_DOCUMENT, student.accessToken, { filter: { offset: -5 } });
    expectDenialCode(negativeOffset, "VALIDATION");

    // The boundary limit 50 is ACCEPTED and window-equivalent to the oracle.
    await expectPageEquivalentToOracle(student, {}, { limit: 50, offset: 0 });
    await expectPageEquivalentToOracle(actorByLabel("admin"), {}, { limit: 50, offset: 0 });

    // Zero row movement across all the rejected probes.
    expect(await oracleRows(student.userId)).toHaveLength(oracleBefore.length);
  });
});

// ─── Matrix: authenticated roles × mark-one ─────────────────────────────────

describe("integration matrix — mark-one across every role (own latch vs foreign denial)", () => {
  test("every role marks one OWN unread row — wire ≡ post-update DB row on all eight fields", async () => {
    const results = await Promise.all(
      actors.map(async actor => {
        const subject = subjectRowOf(actor);
        const body = await markOne(actor.accessToken, String(subject.id));
        expect(body.errors).toBeUndefined();
        const dbRow = await oracleRowById(subject.id);
        return { actor, body, dbRow };
      })
    );
    for (const { actor, body, dbRow } of results) {
      if (!dbRow) {
        throw new Error(`expected the marked row of ${actor.label} to persist`);
      }
      expect(dbRow.isRead).toBe(true);
      expectWireRowMatchesDbRow(wireNotificationOf(body), dbRow);
      // The id round-trips as the canonical STRINGified integer.
      expect(/^\d+$/.test(wireIdOf(wireNotificationOf(body)))).toBe(true);
    }
  });

  test("the FULL foreign matrix — every role probing every other role's row answers NOTIFICATION_NOT_FOUND (victims byte-identical)", async () => {
    // Snapshot every victim BEFORE the probe storm (parallel reads).
    const snapshots = await Promise.all(
      actors.map(async target => {
        const victim = victimRowOf(target);
        const snapshot = await oracleRowById(victim.id);
        return { label: target.label, victimId: victim.id, snapshot };
      })
    );
    const victimsById = new Map<number, NotificationSelectType>();
    for (const { label, victimId, snapshot } of snapshots) {
      if (!snapshot) {
        throw new Error(`expected the victim row of ${label} to persist`);
      }
      victimsById.set(victimId, snapshot);
    }

    // 4 actors × 3 foreign targets = 12 denial probes, fired in parallel.
    const probes = await Promise.all(
      actors.flatMap(prober =>
        actors
          .filter(target => target.label !== prober.label)
          .map(async target => {
            const victim = victimRowOf(target);
            const body = await markOne(prober.accessToken, String(victim.id));
            return { victimId: victim.id, body };
          })
      )
    );
    expect(probes).toHaveLength(12);
    for (const { body } of probes) {
      const errorItem = expectDenialCode(body, "NOTIFICATION_NOT_FOUND");
      expect(errorItem.path).toEqual(["markNotificationRead"]);
    }

    // Every victim row stays byte-identical — nothing moved.
    const afters = await Promise.all(probes.map(probe => oracleRowById(probe.victimId)));
    for (const after of afters) {
      if (!after) {
        throw new Error("expected the victim row to persist");
      }
      const snapshot = victimsById.get(after.id);
      if (!snapshot) {
        throw new Error(`expected a victim snapshot for row ${after.id}`);
      }
      expectRowsByteIdentical(after, snapshot);
    }
  });

  test("a NONEXISTENT id is envelope-identical to a foreign one — the parent-outsider and admin-outsider probes (REQ-039)", async () => {
    // The parent outsider probes the student's row (INV-P2 posture)…
    const studentVictim = victimRowOf(actorByLabel("student"));
    const parentForeign = await markOne(actorByLabel("parent").accessToken, String(studentVictim.id));
    const parentForeignItem = expectDenialCode(parentForeign, "NOTIFICATION_NOT_FOUND");
    // …the admin outsider probes the teacher's row…
    const teacherVictim = victimRowOf(actorByLabel("teacher"));
    const adminForeign = await markOne(actorByLabel("admin").accessToken, String(teacherVictim.id));
    const adminForeignItem = expectDenialCode(adminForeign, "NOTIFICATION_NOT_FOUND");

    // …and each compares the foreign denial against the NONEXISTENT-id denial.
    const parentNonexistent = await markOne(actorByLabel("parent").accessToken, "2000000000");
    const parentNonexistentItem = expectDenialCode(parentNonexistent, "NOTIFICATION_NOT_FOUND");
    const adminNonexistent = await markOne(actorByLabel("admin").accessToken, "2000000000");
    const adminNonexistentItem = expectDenialCode(adminNonexistent, "NOTIFICATION_NOT_FOUND");

    // Identical code, message, path — existence is never disclosed.
    expect(errorMessageOf(parentNonexistentItem)).toBe(errorMessageOf(parentForeignItem));
    expect(parentNonexistentItem.path).toEqual(parentForeignItem.path);
    expect(extensionKeysOf(parentNonexistentItem)).toEqual(extensionKeysOf(parentForeignItem));
    expect(errorMessageOf(adminNonexistentItem)).toBe(errorMessageOf(adminForeignItem));
    expect(adminNonexistentItem.path).toEqual(adminForeignItem.path);
    expect(extensionKeysOf(adminNonexistentItem)).toEqual(extensionKeysOf(adminForeignItem));
  });

  test("invalid-format ids answer VALIDATION before any row is touched", async () => {
    const student = actorByLabel("student");
    const invalidIds = ["not-a-number", "0", "-7", "1.5", "1e3", "12abc", "99999999999999999999"];
    const bodies = await Promise.all(invalidIds.map(id => markOne(student.accessToken, id)));
    for (const body of bodies) {
      expectDenialCode(body, "VALIDATION");
    }
    // No fixture row moved while the probes ran (2 unread remain: the
    // type-sweep subject + the foreign-probe victim).
    expect(await oracleUnreadCount(student.userId)).toBe(2);
  });

  test("idempotent double-mark — the row returns unchanged, byte-identical in the DB", async () => {
    const results = await Promise.all(
      ["student", "teacher"].map(async label => {
        const actor = actorByLabel(label);
        const subject = subjectRowOf(actor);
        const before = await oracleRowById(subject.id);
        if (!before) {
          throw new Error(`expected the marked row of ${label} to persist`);
        }
        expect(before.isRead).toBe(true);
        const body = await markOne(actor.accessToken, String(subject.id));
        expect(body.errors).toBeUndefined();
        const after = await oracleRowById(subject.id);
        return { label, before, body, after };
      })
    );
    for (const { label, before, body, after } of results) {
      expectWireRowMatchesDbRow(wireNotificationOf(body), before);
      if (!after) {
        throw new Error(`expected the marked row of ${label} to persist`);
      }
      expectRowsByteIdentical(after, before);
    }
  });
});

// ─── Matrix: authenticated roles × mark-all ─────────────────────────────────

describe("integration matrix — mark-all sweeps across every role", () => {
  test("a type-filtered sweep flips ONLY that kind and reports the oracle count", async () => {
    const student = actorByLabel("student");
    const before = await oracleUnreadCount(student.userId, NotificationType.SessionRequest);
    expect(before).toBe(1);

    const body = await markAll(student.accessToken, wireNameOf(NotificationType.SessionRequest));
    expect(body.errors).toBeUndefined();
    expect(wireMarkAllCountOf(body)).toBe(before);

    // The filtered kind is fully read now…
    expect(await oracleUnreadCount(student.userId, NotificationType.SessionRequest)).toBe(0);
    // …the OTHER unread kinds stay unread…
    expect(await oracleUnreadCount(student.userId)).toBe(1);
    // …and no OTHER role's inbox moved.
    const others = await Promise.all(
      actors
        .filter(actor => actor.label !== "student")
        .map(async actor => ({ oracle: await oracleUnreadCount(actor.userId) }))
    );
    for (const { oracle } of others) {
      expect(oracle).toBe(1);
    }
  });

  test("every role's final unfiltered sweep reports its own oracle count and leaves the end-state closed", async () => {
    const sweeps = await Promise.all(
      actors.map(async actor => ({
        actor,
        before: await oracleUnreadCount(actor.userId),
        body: await markAll(actor.accessToken),
        finalRows: await oracleRows(actor.userId),
        finalUnread: await oracleUnreadCount(actor.userId),
      }))
    );
    for (const { actor, before, body, finalRows, finalUnread } of sweeps) {
      expect(body.errors).toBeUndefined();
      expect(wireMarkAllCountOf(body)).toBe(before);
      expect(finalUnread).toBe(0);

      // End-state closure across EVERY fixture row: all read, every seeded
      // fixture row still exists (no creates, no deletes), seeded-read rows
      // are byte-identical, and every flipped row differs from its seed by AT
      // MOST the is_read latch (rewinding it reproduces the seed). The
      // seeded admin's oracle ALSO contains its 44 pre-existing rows — its
      // row-SET proof is the total-count check (pre-suite snapshot + fixture
      // count), while the three registered actors own their entire oracle.
      const expectedTotal = actor.userId === adminUserId ? adminPreSuiteTotal + actor.rows.length : actor.rows.length;
      expect(finalRows).toHaveLength(expectedTotal);
      for (const seeded of actor.rows) {
        const finalRow = finalRows.find(candidate => candidate.id === seeded.id);
        if (!finalRow) {
          throw new Error(`expected fixture row ${seeded.id} of ${actor.label} to persist`);
        }
        expect(finalRow.isRead).toBe(true);
        if (seeded.isRead === true) {
          expectRowsByteIdentical(finalRow, seeded);
        } else {
          expect(JSON.stringify({ ...finalRow, isRead: seeded.isRead })).toBe(JSON.stringify(seeded));
        }
      }
    }

    // The seeded admin's pre-existing inbox is untouched: its total is exactly
    // the pre-suite snapshot + the 3 fixture rows, and it still has ZERO
    // unread seeded rows (every sweep only ever matched is_read = false).
    const admin = actorByLabel("admin");
    const adminFinalRows = await oracleRows(admin.userId);
    expect(adminFinalRows).toHaveLength(adminPreSuiteTotal + ADMIN_SPECS.length);
    const seededRows = adminFinalRows.filter(row => !admin.rows.some(fixture => fixture.id === row.id));
    for (const row of seededRows) {
      expect(row.isRead).toBe(true);
    }
  });

  test("empty sets answer 0 — repeat sweep and type with no matching rows", async () => {
    const student = actorByLabel("student");
    const repeatBody = await markAll(student.accessToken);
    expect(repeatBody.errors).toBeUndefined();
    expect(wireMarkAllCountOf(repeatBody)).toBe(0);

    // The student has NO ParentLinkRequest rows at all — a type-empty sweep.
    const typedBody = await markAll(student.accessToken, wireNameOf(NotificationType.ParentLinkRequest));
    expect(typedBody.errors).toBeUndefined();
    expect(wireMarkAllCountOf(typedBody)).toBe(0);
  });
});

// ─── Matrix: governed caller tier (context-level denial) ─────────────────────

describe("integration matrix — governed caller tier (suspended / blocked / deleted)", () => {
  test("a suspended caller is denied at the SESSION tier with FORBIDDEN — context-level, never row-level", async () => {
    await applyGovernanceState(governedUserId, "suspended");
    const result = await loginProbe(`${FIXTURE_MARKER}-governed@test.local`, WIRE_CREDENTIAL);
    // The context-level denial: the account-governance class (FORBIDDEN), NOT
    // the notification row class and NOT the anonymous class.
    expectMutationError(result.error, "FORBIDDEN");

    const body = await postAnonymous(LOGIN_DOCUMENT, {
      email: `${FIXTURE_MARKER}-governed@test.local`,
      password: WIRE_CREDENTIAL,
    });
    const errorItem = expectDenialCode(body, "FORBIDDEN");
    expect(errorItem.path).toEqual(["login"]);
    expect(errorMessageOf(errorItem)).not.toBe("The notification was not found.");
    expect(errorMessageOf(errorItem)).not.toBe("Authentication required.");
  });

  test("the governance denial shape is CONSTANT across suspended, blocked, and deleted (no branch disclosure)", async () => {
    // suspended (already active on the row) → blocked → deleted, each probed
    // over the raw wire so the envelopes compare authoritatively.
    const suspendedBody = await postAnonymous(LOGIN_DOCUMENT, {
      email: `${FIXTURE_MARKER}-governed@test.local`,
      password: WIRE_CREDENTIAL,
    });
    await applyGovernanceState(governedUserId, "blocked");
    const blockedBody = await postAnonymous(LOGIN_DOCUMENT, {
      email: `${FIXTURE_MARKER}-governed@test.local`,
      password: WIRE_CREDENTIAL,
    });
    await applyGovernanceState(governedUserId, "deleted");
    const deletedBody = await postAnonymous(LOGIN_DOCUMENT, {
      email: `${FIXTURE_MARKER}-governed@test.local`,
      password: WIRE_CREDENTIAL,
    });

    const suspendedItem = expectDenialCode(suspendedBody, "FORBIDDEN");
    const blockedItem = expectDenialCode(blockedBody, "FORBIDDEN");
    const deletedItem = expectDenialCode(deletedBody, "FORBIDDEN");

    // Identical message / path / envelope across ALL THREE governance
    // branches — the denial discloses nothing about WHICH state applies.
    for (const item of [blockedItem, deletedItem]) {
      expect(errorMessageOf(item)).toBe(errorMessageOf(suspendedItem));
      expect(item.path).toEqual(suspendedItem.path);
      expect(extensionKeysOf(item)).toEqual(extensionKeysOf(suspendedItem));
    }
  });

  test("a pre-issued, still-valid access token retains its SELF-SCOPED inbox surface — reads and mark ops alike (documented governance window)", async () => {
    // DISCOVERY (pinned deliberately): the GraphQL bearer-token context does
    // NOT re-check governance flags — unlike the SSR boundary
    // (`getServerUserContext` fails closed) and the session tier (login /
    // refreshToken deny above). A governed caller holding a pre-issued,
    // unexpired access token keeps its ENTIRE self-scoped inbox surface
    // (reads and mark ops alike — a strictly wider window than the WS
    // socket's read-only receipt trade-off in REQ-038). The notification
    // surface itself carries NO governance handling (REQ-038's "no
    // inbox-specific handling" clause); the gap vs the fail-closed
    // SSR/session tiers is recorded as ledger row D5. When the governance
    // context gate lands, THIS assertion flips deliberately.
    await applyGovernanceState(governedUserId, "suspended");
    const suspendedPageBody = await postDocument(LIST_DOCUMENT, governedAccessToken, {});
    const suspendedCountBody = await postDocument(COUNT_DOCUMENT, governedAccessToken);
    await applyGovernanceState(governedUserId, "deleted");
    const deletedPageBody = await postDocument(LIST_DOCUMENT, governedAccessToken, {});
    const deletedCountBody = await postDocument(COUNT_DOCUMENT, governedAccessToken);

    const oracle = await oracleRows(governedUserId);
    const oracleUnread = await oracleUnreadCount(governedUserId);
    for (const body of [suspendedPageBody, deletedPageBody]) {
      expect(body.errors).toBeUndefined();
      const page = wirePageOf(body);
      expect(page.items.map(item => wireTitleOf(item))).toEqual(oracle.map(row => row.title));
      expect(page.totalCount).toBe(oracle.length);
    }
    for (const body of [suspendedCountBody, deletedCountBody]) {
      expect(body.errors).toBeUndefined();
      expect(wireUnreadCountOf(body)).toBe(oracleUnread);
    }
  });

  test("the governed caller's BOLA posture is unchanged — a foreign id still answers the identical NOTIFICATION_NOT_FOUND", async () => {
    // The governed caller (deleted-flagged, still holding its valid token)
    // probes the student's victim row: the SAME oracle-safe denial an active
    // caller receives — the governance state neither widens nor narrows the
    // row-level tenancy boundary.
    const studentVictim = victimRowOf(actorByLabel("student"));
    const before = await oracleRowById(studentVictim.id);
    if (!before) {
      throw new Error("expected the student victim row to persist");
    }
    const body = await markOne(governedAccessToken, String(studentVictim.id));
    expectDenialCode(body, "NOTIFICATION_NOT_FOUND");
    const after = await oracleRowById(studentVictim.id);
    if (!after) {
      throw new Error("expected the student victim row to persist");
    }
    expectRowsByteIdentical(after, before);
  });
});

// ─── Matrix: BOPLA wire probes ───────────────────────────────────────────────

describe("integration matrix — BOPLA wire probes (smuggled identity fields)", () => {
  test("smuggled identity fields die as GRAPHQL_VALIDATION_FAILED before any resolver runs", async () => {
    const student = actorByLabel("student");
    const smuggledFilter = await postDocument(
      "{ myNotifications(filter: { userId: 12345 }) { totalCount } }",
      student.accessToken
    );
    expectDenialCode(smuggledFilter, "GRAPHQL_VALIDATION_FAILED", "absent");

    const smuggledRootArg = await postDocument(
      "{ myNotifications(userId: 12345) { totalCount } }",
      student.accessToken
    );
    expectDenialCode(smuggledRootArg, "GRAPHQL_VALIDATION_FAILED", "absent");

    const smuggledMarkOne = await postDocument(
      'mutation { markNotificationRead(userId: 12345, id: "1") { id } }',
      student.accessToken
    );
    expectDenialCode(smuggledMarkOne, "GRAPHQL_VALIDATION_FAILED", "absent");

    const smuggledMarkAll = await postDocument(
      "mutation { markAllNotificationsRead(userId: 12345) }",
      student.accessToken
    );
    expectDenialCode(smuggledMarkAll, "GRAPHQL_VALIDATION_FAILED", "absent");
  });
});
