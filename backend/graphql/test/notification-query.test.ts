/**
 * Notification inbox queries — wire-tier integration suite for
 * `myNotifications` + `myUnreadNotificationCount` over the REAL GraphQL
 * boundary (`setupTestServerLifecycle` + `testClient`).
 *
 * What this locks down (real HTTP → gateway pipeline → scope-auth → resolver
 * → NotificationEngine → PostgreSQL → back over the wire):
 *  - **Anonymous rejection** — both inbox queries answer UNAUTHORIZED
 *    (extensions.code) for callers with no credentials.
 *  - **Self-scoped reads per role** — student, teacher (applicant), parent,
 *    and admin sessions each read ONLY their own inbox: the wire page is
 *    equivalent to an independent direct-DB oracle for that user (items,
 *    ordering, ids, totalCount) and NEVER contains another actor's rows.
 *  - **Filter-over-wire coherence** — `type` / `isRead` conjunctive filters
 *    and the `limit`/`offset` page window (incl. `hasMore` pagination math
 *    and page-overlap freedom) all match the same DB oracle.
 *  - **`id` normalization** — every row's `id` arrives as a STRINGified
 *    integer (GraphQL ID serialization) that round-trips against the DB ids.
 *  - **BOPLA wire probe** — smuggled identity fields (`filter: { userId }`,
 *    unknown root args) die as GRAPHQL_VALIDATION_FAILED before any resolver
 *    runs; there is no identity argument to address a foreign inbox with.
 *
 * Fixture strategy:
 *  - The three non-admin actors are created through the PUBLIC `registerUser`
 *    mutation over the wire (real registration path, real password hashes) so
 *    their logins exercise the genuine credential path. The admin actor rides
 *    the seeded admin (`ADMIN_EMAIL`/`ADMIN_PASSWORD` — the seed's own
 *    env-fallback chain).
 *  - Inbox rows are seeded with direct committed inserts (never the emit
 *    surface) and torn down in `afterAll` (rows → role-child rows → users);
 *    the seeded admin's own user row is never deleted — only its fixture
 *    notification rows are.
 *  - Authenticated calls carry the `Authorization: Bearer` header (the
 *    documented production client path read by `createGraphQLContext`) on a
 *    raw fetch — the shared `testClient`'s fixed HttpLink cannot attach
 *    per-request auth headers.
 *  - Enum filters travel as the GraphQL enum NAMES (the TS enum keys), per
 *    the registered enum-object convention; `wireNameOf` performs that
 *    single mapping and the oracle compares runtime values.
 *
 * ENVIRONMENT NOTE (sandbox): the canonical lifecycle helper boots its own
 * dev server on TEST_PORT (3066) when nothing answers there. Where the
 * interactive dev server already owns port 3000 (Next 16 refuses a second
 * dev server on the same tree), point the suite at the LIVE server via
 * `GRAPHQL_TEST_PORT=3000` — the helper's liveness probe then succeeds and
 * no second server is spawned (or killed). CI boots the canonical 3066 path.
 *
 * Mandated runner: bun run test/scripts/run-test.ts backend/graphql/test/notification-query.test.ts
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
import { NotificationType } from "@/backend/enum/notifications/notification-type.enum";
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
const WIRE_CREDENTIAL = "WireInbox!Pass1";
/** Seeded-admin credentials — the seed's own env-fallback chain. */
const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? "admin@draftacademy.local";
const ADMIN_CREDENTIAL = process.env.ADMIN_PASSWORD ?? "Seed_Pass1!";

const LIST_DOCUMENT = `
  query WireInboxPage($filter: MyNotificationsFilterInput) {
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
  query WireUnread {
    myUnreadNotificationCount
  }
`;

/** The GraphQL wire NAME of a canonical notification-type runtime value. */
function wireNameOf(type: NotificationType): string {
  const entry = Object.entries(NotificationType).find(([, value]) => value === type);
  if (entry === undefined) {
    throw new Error(`no wire name for notification type ${type}`);
  }
  return entry[0];
}

/** POSTs one document over the wire with a Bearer access token. */
async function postQuery(
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

function firstErrorCode(body: Record<string, unknown>): string {
  const errors = recordOf(body, "expected a response body").errors;
  if (!Array.isArray(errors)) {
    throw new Error("expected an errors array");
  }
  const first = recordOf(errors[0], "expected a record-shaped error item");
  const code = recordOf(first.extensions, "expected record-shaped extensions").code;
  if (typeof code !== "string") {
    throw new Error("expected a string error code");
  }
  return code;
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

async function oracleUnreadCount(userId: number): Promise<number> {
  const [row] = await db
    .select({ value: count() })
    .from(notifications)
    .where(and(eq(notifications.userId, userId), eq(notifications.isRead, false)));
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

const FIXTURE_MARKER = `wire-${randomUUID().slice(0, 8)}`;

function fixtureTitle(label: string, index: number): string {
  return `${FIXTURE_MARKER} ${label} notice ${index + 1}`;
}

const STUDENT_SPECS: readonly RowSpec[] = [
  { type: NotificationType.SystemBroadcast, isRead: true, minutesAgo: 50 },
  { type: NotificationType.SystemBroadcast, isRead: false, minutesAgo: 40 },
  { type: NotificationType.SessionRequest, isRead: true, minutesAgo: 30 },
  { type: NotificationType.SessionRequest, isRead: false, minutesAgo: 20 },
  { type: NotificationType.PaymentConfirmation, isRead: false, minutesAgo: 10 },
];

const TEACHER_SPECS: readonly RowSpec[] = [
  { type: NotificationType.SessionCompletion, isRead: true, minutesAgo: 25 },
  { type: NotificationType.SystemBroadcast, isRead: false, minutesAgo: 15 },
];

const PARENT_SPECS: readonly RowSpec[] = [
  { type: NotificationType.ParentLinkRequest, isRead: false, minutesAgo: 35 },
  { type: NotificationType.ParentLinkRequest, isRead: false, minutesAgo: 5 },
];

const ADMIN_SPECS: readonly RowSpec[] = [
  { type: NotificationType.PaymentConfirmation, isRead: true, minutesAgo: 55 },
  { type: NotificationType.SystemBroadcast, isRead: false, minutesAgo: 45 },
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
    relatedEntityId: 77_000 + i,
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
      mutation RegisterWireActor($input: RegisterUserInput!) {
        registerUser(input: $input) {
          id
        }
      }
    `,
    variables: {
      input: {
        fullName: `Wire Inbox ${label} ${FIXTURE_MARKER}`,
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
      mutation LoginWireActor($email: String!, $password: String!) {
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

let actors: readonly WireActor[] = [];
let adminUserId = 0;

beforeAll(async () => {
  // Real registrations through the public mutation (committed users).
  const [studentId, teacherId, parentId] = await Promise.all([
    registerActor("student", "Student"),
    registerActor("teacher", "Teacher"),
    registerActor("parent", "Parent"),
  ]);
  // Real logins — the seeded admin rides its env-fallback credentials.
  const [studentToken, teacherToken, parentToken, adminToken] = await Promise.all([
    loginActor(`${FIXTURE_MARKER}-student@test.local`, WIRE_CREDENTIAL),
    loginActor(`${FIXTURE_MARKER}-teacher@test.local`, WIRE_CREDENTIAL),
    loginActor(`${FIXTURE_MARKER}-parent@test.local`, WIRE_CREDENTIAL),
    loginActor(ADMIN_EMAIL, ADMIN_CREDENTIAL),
  ]);
  const [adminRow] = await db.select({ id: users.id }).from(users).where(eq(users.email, ADMIN_EMAIL)).limit(1);
  if (!adminRow) {
    throw new Error(`seeded admin ${ADMIN_EMAIL} not found`);
  }
  adminUserId = adminRow.id;

  // Committed inbox fixtures (direct inserts — never the emit surface).
  const [studentRows, teacherRows, parentRows, adminRows] = await Promise.all([
    seedRows(studentId, "student", STUDENT_SPECS),
    seedRows(teacherId, "teacher", TEACHER_SPECS),
    seedRows(parentId, "parent", PARENT_SPECS),
    seedRows(adminUserId, "admin", ADMIN_SPECS),
  ]);

  actors = [
    { label: "student", userId: studentId, accessToken: studentToken, rows: studentRows },
    { label: "teacher", userId: teacherId, accessToken: teacherToken, rows: teacherRows },
    { label: "parent", userId: parentId, accessToken: parentToken, rows: parentRows },
    { label: "admin", userId: adminUserId, accessToken: adminToken, rows: adminRows },
  ];
}, 120_000);

afterAll(async () => {
  const fixtureUserIds = actors.filter(actor => actor.userId !== adminUserId).map(actor => actor.userId);
  const adminNotificationIds = actors
    .filter(actor => actor.userId === adminUserId)
    .flatMap(actor => actor.rows.map(row => row.id));

  // The seeded admin's user row is NEVER deleted — only its fixture rows.
  if (adminNotificationIds.length > 0) {
    await db.delete(notifications).where(inArray(notifications.id, adminNotificationIds));
  }
  // Fixture users cascade their notifications; delete role-child rows before
  // the user rows (FK-safe order).
  if (fixtureUserIds.length > 0) {
    await db.delete(students).where(inArray(students.id, fixtureUserIds));
    await db.delete(applicants).where(inArray(applicants.id, fixtureUserIds));
    await db.delete(parents).where(inArray(parents.id, fixtureUserIds));
    await db.delete(notifications).where(inArray(notifications.userId, fixtureUserIds));
    await db.delete(users).where(inArray(users.id, fixtureUserIds));
  }
}, 60_000);

// ─── Assertions ──────────────────────────────────────────────────────────────

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

  const body = await postQuery(LIST_DOCUMENT, actor.accessToken, { filter: filterVariable });
  const page = wirePageOf(body);
  expect(body.errors).toBeUndefined();

  expect(page.items.map(item => wireIdOf(item))).toEqual(expectedIds);
  expect(page.items.map(item => wireTitleOf(item))).toEqual(expectedWindow.map(row => row.title));
  expect(page.totalCount).toBe(oracle.length);
  expect(page.hasMore).toBe(effectiveWindow.offset + expectedWindow.length < oracle.length);
  return page;
}

/** The filter-coherence/BOPLA subject actor (richest fixture matrix). */
function studentActor(): WireActor {
  const student = actors.find(actor => actor.label === "student");
  if (!student) {
    throw new Error("expected the student actor fixture");
  }
  return student;
}

describe("notification inbox queries — anonymous tier", () => {
  test("myNotifications answers UNAUTHORIZED for anonymous callers", async () => {
    const result = await testClient.query({
      query: gql`
        query AnonymousInboxList {
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
        query AnonymousUnreadCount {
          myUnreadNotificationCount
        }
      `,
      fetchPolicy: "no-cache",
    });
    const error = expectMutationError(result.error, "UNAUTHORIZED");
    // The denial rides the single-error envelope — exactly one error item.
    expect(error.errors).toHaveLength(1);
  });
});

describe("notification inbox queries — per-role self-scoped reads", () => {
  test("every actor's wire page is EXACTLY its own DB oracle (items, order, ids, totals)", async () => {
    const pages = await Promise.all(actors.map(async actor => expectPageEquivalentToOracle(actor)));
    expect(pages).toHaveLength(4);
  });

  test("no actor's page EVER contains another actor's fixture rows (cross-inbox isolation)", async () => {
    const results = await Promise.all(
      actors.map(async actor => ({
        actor,
        body: await postQuery(LIST_DOCUMENT, actor.accessToken, {}),
        oracleTitles: new Set((await oracleRows(actor.userId)).map(row => row.title)),
      }))
    );
    for (const { actor, body, oracleTitles } of results) {
      const page = wirePageOf(body);
      // Every returned row belongs to this actor's own oracle…
      for (const item of page.items) {
        expect(oracleTitles.has(wireTitleOf(item))).toBe(true);
      }
      // …and NO foreign fixture title ever appears.
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
        body: await postQuery(COUNT_DOCUMENT, actor.accessToken),
        oracle: await oracleUnreadCount(actor.userId),
      }))
    );
    for (const { body, oracle } of results) {
      expect(body.errors).toBeUndefined();
      expect(wireUnreadCountOf(body)).toBe(oracle);
    }
  });

  test("`id` arrives as a STRINGified integer that round-trips against the DB ids", async () => {
    const student = actors.find(actor => actor.label === "student");
    if (!student) {
      throw new Error("expected the student actor fixture");
    }
    const body = await postQuery(LIST_DOCUMENT, student.accessToken, {});
    const page = wirePageOf(body);
    expect(page.items.length).toBeGreaterThan(0);
    const dbIds = new Set(student.rows.map(row => String(row.id)));
    for (const item of page.items) {
      const wireId = wireIdOf(item);
      expect(typeof wireId).toBe("string");
      expect(/^\d+$/.test(wireId)).toBe(true);
      expect(dbIds.has(wireId)).toBe(true);
    }
  });
});

describe("notification inbox queries — filter-over-wire coherence", () => {
  test("type filter narrows the page AND the total to the matching kind", async () => {
    await expectPageEquivalentToOracle(studentActor(), { type: NotificationType.SystemBroadcast });
  });

  test("type + isRead compose conjunctively over the wire", async () => {
    await expectPageEquivalentToOracle(studentActor(), { type: NotificationType.SessionRequest, isRead: false });
  });

  test("isRead-only filter narrows to the read rows", async () => {
    await expectPageEquivalentToOracle(studentActor(), { isRead: true });
  });

  test("limit/offset window slides without overlap and hasMore follows the pagination math", async () => {
    const student = studentActor();
    const oracle = await oracleRows(student.userId);
    expect(oracle.length).toBeGreaterThanOrEqual(5);

    const page1 = await expectPageEquivalentToOracle(student, {}, { limit: 2, offset: 0 });
    expect(page1.items).toHaveLength(2);
    expect(page1.totalCount).toBe(oracle.length);
    expect(page1.hasMore).toBe(true);

    const page2 = await expectPageEquivalentToOracle(student, {}, { limit: 2, offset: 2 });
    expect(page2.items).toHaveLength(2);
    expect(page2.hasMore).toBe(true);
    const page1Ids = new Set(page1.items.map(item => wireIdOf(item)));
    for (const item of page2.items) {
      expect(page1Ids.has(wireIdOf(item))).toBe(false);
    }

    const tail = await expectPageEquivalentToOracle(student, {}, { limit: 2, offset: oracle.length - 1 });
    expect(tail.items).toHaveLength(1);
    expect(tail.hasMore).toBe(false);
  });
});

describe("notification inbox queries — BOPLA wire probe", () => {
  test("smuggled filter identity fields die as GRAPHQL_VALIDATION_FAILED before any resolver runs", async () => {
    const body = await postQuery(
      "{ myNotifications(filter: { userId: 12345 }) { totalCount } }",
      studentActor().accessToken
    );
    expect(firstErrorCode(body)).toBe("GRAPHQL_VALIDATION_FAILED");
  });

  test("unknown root identity args die as GRAPHQL_VALIDATION_FAILED", async () => {
    const body = await postQuery("{ myNotifications(userId: 12345) { totalCount } }", studentActor().accessToken);
    expect(firstErrorCode(body)).toBe("GRAPHQL_VALIDATION_FAILED");
  });
});
