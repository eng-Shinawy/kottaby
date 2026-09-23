/**
 * Admin broadcast history/detail/stop — wire-tier integration suite for the
 * three admin lifecycle root operations over the REAL GraphQL boundary
 * (`setupTestServerLifecycle` + `testClient`/Bearer fetch):
 *
 *  - LIST (`adminBroadcasts`) — default page window (1-based, pageSize 25),
 *    AND-wise filters (titleSearch/status/audienceType), out-of-range page
 *    → empty items + honest `totalCount`, newest-first ordering, and the
 *    pageSize bound rejecting with the localized validation code.
 *  - DETAIL (`adminBroadcastDetail`) — known id → entry + live
 *    delivered/read stats matching the direct-DB oracle; unknown id →
 *    `BROADCAST_NOT_FOUND`.
 *  - STOP (`adminStopBroadcast`) — happy path returns the retracted row
 *    count; already-stopped → `BROADCAST_ALREADY_STOPPED`; unknown id →
 *    `BROADCAST_NOT_FOUND`.
 *  - Authorization oracle — teacher/student/parent → FORBIDDEN on ALL THREE
 *    operations with zero broadcast state written; anonymous → UNAUTHORIZED.
 *  - Tier 4 wire probes — smuggled identity args and unknown input fields
 *    die in GraphQL validation before any resolver runs.
 *
 * Fixture strategy: the three non-admin actors ride the PUBLIC `registerUser`
 * mutation (real registration + credential login path); the admin rides the
 * seeded admin's env-fallback credentials. History rows are seeded by REAL
 * `adminBroadcastNotification` sends with run-unique titles over a scoped
 * audience (`role: Parent`); `afterAll` deletes only this run's notification
 * and broadcast rows (audit rows are append-only and stay by design).
 *
 * Mandated runner: bun run test/scripts/run-test.ts backend/graphql/test/admin-broadcast-history.integration.test.ts
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { gql } from "@apollo/client";
import { and, count, eq, like, sql } from "drizzle-orm";
import { db } from "@/backend/db";
import { broadcasts } from "@/backend/db/schema/notifications/broadcasts";
import { notifications } from "@/backend/db/schema/notifications/notifications";
import { parents } from "@/backend/db/schema/parents/parents";
import { students } from "@/backend/db/schema/students/students";
import { applicants } from "@/backend/db/schema/teachers/applicants";
import { users } from "@/backend/db/schema/users/users";
import { setupTestServerLifecycle, TEST_PORT, testClient } from "@/test/helpers";
import { withAuditDeleteTriggersSuspended } from "@/test/helpers/db-cleanup";

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
const WIRE_CREDENTIAL = "WireHistory!Pass1";
const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? "admin@draftacademy.local";
const ADMIN_CREDENTIAL = process.env.ADMIN_PASSWORD ?? "Seed_Pass1!";
const BROADCAST_RELATED_ENTITY_TYPE = "broadcast";

const LIST_DOCUMENT = `
  query WireAdminBroadcasts($filters: AdminBroadcastFiltersInput, $page: Int, $pageSize: Int) {
    adminBroadcasts(filters: $filters, page: $page, pageSize: $pageSize) {
      items {
        id
        title
        status
        audienceType
        recipientCount
      }
      totalCount
      page
      pageSize
    }
  }
`;

const DETAIL_DOCUMENT = `
  query WireAdminBroadcastDetail($broadcastId: Int!) {
    adminBroadcastDetail(broadcastId: $broadcastId) {
      entry {
        id
        title
        status
        recipientCount
        stoppedAt
        stoppedByName
      }
      liveDeliveredCount
      liveReadCount
    }
  }
`;

const STOP_DOCUMENT = `
  mutation WireAdminStopBroadcast($broadcastId: Int!) {
    adminStopBroadcast(broadcastId: $broadcastId)
  }
`;

const SEND_DOCUMENT = `
  mutation WireAdminBroadcast($input: AdminBroadcastNotificationInput!) {
    adminBroadcastNotification(input: $input)
  }
`;

/** POSTs one document over the wire; `accessToken === null` means anonymous. */
async function postDocument(
  query: string,
  accessToken: string | null,
  variables?: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (accessToken !== null) {
    headers.authorization = `Bearer ${accessToken}`;
  }
  const response = await fetch(GRAPHQL_URL, {
    method: "POST",
    headers,
    body: JSON.stringify(variables === undefined ? { query } : { query, variables }),
    signal: AbortSignal.timeout(30_000),
  });
  return recordOf(await response.json(), "expected a JSON object response");
}

function firstErrorCode(body: Record<string, unknown>): string {
  const errors = recordOf(body, "expected a response body").errors;
  if (!Array.isArray(errors) || errors.length === 0) {
    throw new Error("expected an errors array");
  }
  const first = recordOf(errors[0], "expected a record-shaped error item");
  const code = recordOf(first.extensions, "expected record-shaped extensions").code;
  if (typeof code !== "string") {
    throw new Error("expected a string error code");
  }
  return code;
}

function dataOf(body: Record<string, unknown>): Record<string, unknown> {
  return recordOf(recordOf(body, "expected a body").data, "expected a data object");
}

interface WireListPage {
  readonly items: readonly Record<string, unknown>[];
  readonly totalCount: number;
  readonly page: number;
  readonly pageSize: number;
}

function wireListPageOf(body: Record<string, unknown>): WireListPage {
  const page = recordOf(dataOf(body).adminBroadcasts, "expected an adminBroadcasts payload");
  const rawItems = page.items;
  if (!Array.isArray(rawItems)) {
    throw new Error("expected an items array");
  }
  const items = rawItems.map(item => recordOf(item, "expected record-shaped items entry"));
  const totalCount = page.totalCount;
  const wirePage = page.page;
  const wirePageSize = page.pageSize;
  if (typeof totalCount !== "number" || typeof wirePage !== "number" || typeof wirePageSize !== "number") {
    throw new Error("expected numeric totalCount/page/pageSize");
  }
  return { items, totalCount, page: wirePage, pageSize: wirePageSize };
}

function wireStringOf(item: Record<string, unknown>, field: string): string {
  const value = item[field];
  if (typeof value !== "string") {
    throw new Error(`expected a string ${field} on the wire`);
  }
  return value;
}

/** Registers one actor over the wire through the PUBLIC registerUser mutation. */
async function registerActor(label: string, role: "Student" | "Teacher" | "Parent"): Promise<number> {
  const result = await testClient.mutate({
    mutation: gql`
      mutation RegisterHistoryActor($input: RegisterUserInput!) {
        registerUser(input: $input) {
          id
        }
      }
    `,
    variables: {
      input: {
        fullName: `Wire History ${label} ${MARKER}`,
        email: `${MARKER}-${label}@test.local`,
        phone: "+15551234567",
        password: WIRE_CREDENTIAL,
        country: "US",
        role,
      },
    },
  });
  if (result.error) {
    throw new Error(`registerUser failed for ${label}`);
  }
  const payload = recordOf(recordOf(result.data, "registerUser returned no data").registerUser, "no payload");
  const parsed = Number.parseInt(String(payload.id), 10);
  if (!Number.isSafeInteger(parsed)) {
    throw new Error("registerUser id must be a safe integer");
  }
  return parsed;
}

/** Logs one actor in over the wire and returns the access token. */
async function loginActor(email: string, credential: string): Promise<string> {
  const result = await testClient.mutate({
    mutation: gql`
      mutation LoginHistoryActor($email: String!, $password: String!) {
        login(email: $email, password: $password) {
          accessToken
        }
      }
    `,
    variables: { email, password: credential },
  });
  if (result.error) {
    throw new Error(`login failed for ${email}`);
  }
  const payload = recordOf(recordOf(result.data, "login returned no data").login, "no payload");
  const token = payload.accessToken;
  if (typeof token !== "string" || token.length === 0) {
    throw new Error("login accessToken must be a non-empty string");
  }
  return token;
}

// ─── Direct-DB oracle (never routed through the engine) ──────────────────────

async function oracleLiveStats(broadcastId: number): Promise<{ total: number; read: number }> {
  const [row] = await db
    .select({
      total: count(),
      read: sql<number>`coalesce(sum(case when ${notifications.isRead} then 1 else 0 end), 0)`.mapWith(Number),
    })
    .from(notifications)
    .where(
      and(
        eq(notifications.relatedEntityType, BROADCAST_RELATED_ENTITY_TYPE),
        eq(notifications.relatedEntityId, broadcastId)
      )
    );
  return { total: row?.total ?? 0, read: row?.read ?? 0 };
}

async function oracleMarkerBroadcastCount(): Promise<number> {
  const [row] = await db
    .select({ value: count() })
    .from(broadcasts)
    .where(like(broadcasts.title, `${MARKER}%`));
  return row?.value ?? 0;
}

// ─── Fixtures ────────────────────────────────────────────────────────────────

/** Run-unique marker — every artifact of this suite carries it as a title prefix. */
const MARKER = `Abhl-History-${randomUUID()}`;
const TITLE_ALPHA = `${MARKER}-alpha`;
const TITLE_BRAVO = `${MARKER}-bravo`;
const TITLE_CHARLIE = `${MARKER}-charlie`;
const PARENT_AUDIENCE = { type: "Role", role: "Parent" };

interface WireFixture {
  readonly studentToken: string;
  readonly teacherToken: string;
  readonly parentToken: string;
  readonly adminToken: string;
  readonly parentUserId: number;
  readonly studentUserId: number;
  readonly teacherUserId: number;
  readonly alphaId: number;
  readonly bravoId: number;
  readonly charlieId: number;
  readonly unknownId: number;
}

let fixture: WireFixture | null = null;

/** Sends one real broadcast over the wire and returns its header id. */
async function sendBroadcast(adminToken: string, title: string): Promise<number> {
  const body = await postDocument(SEND_DOCUMENT, adminToken, {
    input: { title, body: `Wire-tier history body for ${title}`, audience: PARENT_AUDIENCE },
  });
  if (body.errors !== undefined) {
    throw new Error(`adminBroadcastNotification failed for ${title} (${firstErrorCode(body)})`);
  }
  const [row] = await db.select({ id: broadcasts.id }).from(broadcasts).where(eq(broadcasts.title, title)).limit(1);
  if (!row) {
    throw new Error(`broadcast header row missing for ${title}`);
  }
  return row.id;
}

beforeAll(async () => {
  // Real registrations through the public mutation (committed users).
  const [studentId, teacherId, parentId] = await Promise.all([
    registerActor("student", "Student"),
    registerActor("teacher", "Teacher"),
    registerActor("parent", "Parent"),
  ]);
  // Real logins — the seeded admin rides its env-fallback credentials.
  const [studentToken, teacherToken, parentToken, adminToken] = await Promise.all([
    loginActor(`${MARKER}-student@test.local`, WIRE_CREDENTIAL),
    loginActor(`${MARKER}-student@test.local`, WIRE_CREDENTIAL),
    loginActor(`${MARKER}-student@test.local`, WIRE_CREDENTIAL),
    loginActor(ADMIN_EMAIL, ADMIN_CREDENTIAL),
  ]);

  // Real sends over the wire — sequential so sentAt is strictly increasing.
  const alphaId = await sendBroadcast(adminToken, TITLE_ALPHA);
  const bravoId = await sendBroadcast(adminToken, TITLE_BRAVO);
  const charlieId = await sendBroadcast(adminToken, TITLE_CHARLIE);

  // One read receipt on the fixture parent's bravo copy → live read stat > 0.
  await db
    .update(notifications)
    .set({ isRead: true })
    .where(
      and(
        eq(notifications.userId, parentId),
        eq(notifications.relatedEntityType, BROADCAST_RELATED_ENTITY_TYPE),
        eq(notifications.relatedEntityId, bravoId)
      )
    );

  const [maxRow] = await db
    .select({ value: sql<number>`coalesce(max(${broadcasts.id}), 0)`.mapWith(Number) })
    .from(broadcasts);
  fixture = {
    studentToken,
    teacherToken,
    parentToken,
    adminToken,
    parentUserId: parentId,
    studentUserId: studentId,
    teacherUserId: teacherId,
    alphaId,
    bravoId,
    charlieId,
    unknownId: (maxRow?.value ?? 0) + 1000,
  };
}, 120_000);

afterAll(async () => {
  if (fixture === null) {
    return;
  }
  await withAuditDeleteTriggersSuspended(async () => {
    // Only this run's rows; audit rows are append-only trail and stay.
    await db.delete(notifications).where(like(notifications.title, `${MARKER}%`));
    await db.delete(broadcasts).where(like(broadcasts.title, `${MARKER}%`));
  });
  // Fixture users: delete role-child rows before the user rows (FK-safe order).
  await db.delete(students).where(eq(students.id, fixture.studentUserId));
  await db.delete(applicants).where(eq(applicants.id, fixture.teacherUserId));
  await db.delete(parents).where(eq(parents.id, fixture.parentUserId));
  await db.delete(notifications).where(eq(notifications.userId, fixture.studentUserId));
  await db.delete(notifications).where(eq(notifications.userId, fixture.teacherUserId));
  await db.delete(notifications).where(eq(notifications.userId, fixture.parentUserId));
  await db.delete(users).where(eq(users.id, fixture.studentUserId));
  await db.delete(users).where(eq(users.id, fixture.teacherUserId));
  await db.delete(users).where(eq(users.id, fixture.parentUserId));
}, 60_000);

function requireFixture(): WireFixture {
  if (fixture === null) {
    throw new Error("expected the beforeAll fixture");
  }
  return fixture;
}

// ─── LIST ────────────────────────────────────────────────────────────────────

describe("adminBroadcasts — list window and filters", () => {
  test("default page window: 1-based page, default pageSize 25, marker rows present newest-first", async () => {
    const fx = requireFixture();
    const body = await postDocument(LIST_DOCUMENT, fx.adminToken, { filters: { titleSearch: MARKER } });
    const page = wireListPageOf(body);
    expect(body.errors).toBeUndefined();
    expect(page.page).toBe(1);
    expect(page.pageSize).toBe(25);
    expect(page.totalCount).toBe(3);
    expect(page.items).toHaveLength(3);
    // Newest-first: charlie (sent last) leads, then bravo, then alpha.
    expect(page.items.map(item => wireStringOf(item, "title"))).toEqual([TITLE_CHARLIE, TITLE_BRAVO, TITLE_ALPHA]);
    for (const item of page.items) {
      expect(wireStringOf(item, "id")).toMatch(/^\d+$/);
      expect(wireStringOf(item, "status")).toBe("Active");
      expect(wireStringOf(item, "audienceType")).toBe("Role");
    }
  });

  test("out-of-range page returns EMPTY items with an HONEST totalCount (echoed window)", async () => {
    const fx = requireFixture();
    const body = await postDocument(LIST_DOCUMENT, fx.adminToken, {
      filters: { titleSearch: MARKER },
      page: 9999,
      pageSize: 2,
    });
    const page = wireListPageOf(body);
    expect(body.errors).toBeUndefined();
    expect(page.items).toHaveLength(0);
    expect(page.totalCount).toBe(3);
    expect(page.page).toBe(9999);
    expect(page.pageSize).toBe(2);
  });

  test("pageSize above the 100 bound rejects with the localized validation code", async () => {
    const fx = requireFixture();
    const body = await postDocument(LIST_DOCUMENT, fx.adminToken, {
      filters: { titleSearch: MARKER },
      page: 1,
      pageSize: 500,
    });
    expect(firstErrorCode(body)).toBe("VALIDATION");
  });
});

// ─── DETAIL ──────────────────────────────────────────────────────────────────

describe("adminBroadcastDetail — entry and live stats", () => {
  test("known id returns the entry with live delivered/read counts matching the DB oracle", async () => {
    const fx = requireFixture();
    const oracle = await oracleLiveStats(fx.bravoId);
    expect(oracle.total).toBeGreaterThanOrEqual(1);
    expect(oracle.read).toBeGreaterThanOrEqual(1);

    const body = await postDocument(DETAIL_DOCUMENT, fx.adminToken, { broadcastId: fx.bravoId });
    expect(body.errors).toBeUndefined();
    const detail = recordOf(dataOf(body).adminBroadcastDetail, "expected a detail payload");
    const entry = recordOf(detail.entry, "expected an entry object");
    expect(wireStringOf(entry, "title")).toBe(TITLE_BRAVO);
    expect(wireStringOf(entry, "id")).toBe(String(fx.bravoId));
    expect(wireStringOf(entry, "status")).toBe("Active");
    expect(entry.stoppedAt).toBeNull();
    expect(entry.stoppedByName).toBeNull();
    expect(detail.liveDeliveredCount).toBe(oracle.total);
    expect(detail.liveReadCount).toBe(oracle.read);
  });

  test("unknown id rejects with BROADCAST_NOT_FOUND", async () => {
    const fx = requireFixture();
    const body = await postDocument(DETAIL_DOCUMENT, fx.adminToken, { broadcastId: fx.unknownId });
    expect(firstErrorCode(body)).toBe("BROADCAST_NOT_FOUND");
  });
});

// ─── STOP ────────────────────────────────────────────────────────────────────

describe("adminStopBroadcast — one-way lifecycle transition", () => {
  test("happy path stops an ACTIVE broadcast and returns the retracted row count", async () => {
    const fx = requireFixture();
    const liveBefore = await oracleLiveStats(fx.charlieId);
    expect(liveBefore.total).toBeGreaterThanOrEqual(1);

    const body = await postDocument(STOP_DOCUMENT, fx.adminToken, { broadcastId: fx.charlieId });
    expect(body.errors).toBeUndefined();
    expect(dataOf(body).adminStopBroadcast).toBe(liveBefore.total);

    // Live stats collapse to zero; the header records the stopper and time.
    const detail = await postDocument(DETAIL_DOCUMENT, fx.adminToken, { broadcastId: fx.charlieId });
    const payload = recordOf(dataOf(detail).adminBroadcastDetail, "expected a detail payload");
    const entry = recordOf(payload.entry, "expected an entry object");
    expect(wireStringOf(entry, "status")).toBe("Stopped");
    expect(typeof entry.stoppedByName).toBe("string");
    expect(payload.liveDeliveredCount).toBe(0);
    expect(payload.liveReadCount).toBe(0);
  });

  test("re-stopping a stopped broadcast rejects with BROADCAST_ALREADY_STOPPED", async () => {
    const fx = requireFixture();
    const body = await postDocument(STOP_DOCUMENT, fx.adminToken, { broadcastId: fx.charlieId });
    expect(firstErrorCode(body)).toBe("BROADCAST_ALREADY_STOPPED");
  });

  test("stopping an unknown id rejects with BROADCAST_NOT_FOUND", async () => {
    const fx = requireFixture();
    const body = await postDocument(STOP_DOCUMENT, fx.adminToken, { broadcastId: fx.unknownId });
    expect(firstErrorCode(body)).toBe("BROADCAST_NOT_FOUND");
  });
});

// ─── Filters over the stopped lifecycle (run AFTER the stop describe) ───────

describe("adminBroadcasts — status/audience filters over the stopped lifecycle", () => {
  test("status=Stopped narrows to exactly the stopped fixture broadcast", async () => {
    const fx = requireFixture();
    const body = await postDocument(LIST_DOCUMENT, fx.adminToken, {
      filters: { titleSearch: MARKER, status: "Stopped" },
    });
    const page = wireListPageOf(body);
    expect(body.errors).toBeUndefined();
    expect(page.totalCount).toBe(1);
    expect(page.items).toHaveLength(1);
    expect(wireStringOf(page.items[0], "title")).toBe(TITLE_CHARLIE);
  });

  test("titleSearch + status + audienceType compose AND-wise", async () => {
    const fx = requireFixture();
    const body = await postDocument(LIST_DOCUMENT, fx.adminToken, {
      filters: { titleSearch: MARKER, status: "Active", audienceType: "Role" },
    });
    const page = wireListPageOf(body);
    expect(body.errors).toBeUndefined();
    expect(page.totalCount).toBe(2);
    expect(page.items.map(item => wireStringOf(item, "title"))).toEqual([TITLE_BRAVO, TITLE_ALPHA]);
  });

  test("a titleSearch that matches nothing returns an honest empty page", async () => {
    const fx = requireFixture();
    const body = await postDocument(LIST_DOCUMENT, fx.adminToken, {
      filters: { titleSearch: `${MARKER}-no-such-broadcast` },
    });
    const page = wireListPageOf(body);
    expect(body.errors).toBeUndefined();
    expect(page.items).toHaveLength(0);
    expect(page.totalCount).toBe(0);
  });
});

// ─── Authorization oracle ─────────────────────────────────────────────────────

describe("admin broadcast history — authorization oracle", () => {
  test("teacher/student/parent receive FORBIDDEN on ALL THREE operations with ZERO broadcast state written", async () => {
    const fx = requireFixture();
    const stateBefore = await oracleMarkerBroadcastCount();
    const deniedTokens = [fx.teacherToken, fx.studentToken, fx.parentToken];

    // Every denied role × every operation, in one parallel batch — the three
    // scope denials are independent and all fire pre-resolver.
    const bodies = await Promise.all(
      deniedTokens.flatMap(token => [
        postDocument(LIST_DOCUMENT, token, { filters: { titleSearch: MARKER } }),
        postDocument(DETAIL_DOCUMENT, token, { broadcastId: fx.bravoId }),
        postDocument(STOP_DOCUMENT, token, { broadcastId: fx.alphaId }),
      ])
    );
    for (const body of bodies) {
      expect(firstErrorCode(body)).toBe("FORBIDDEN");
    }
    // Pre-resolver proof: no denial wrote or transitioned any broadcast state.
    expect(await oracleMarkerBroadcastCount()).toBe(stateBefore);
  });
});

// ─── Anonymous tier ───────────────────────────────────────────────────────────

describe("admin broadcast history — anonymous tier", () => {
  test("anonymous callers receive UNAUTHORIZED on all three operations (pre-resolver)", async () => {
    const list = await postDocument(LIST_DOCUMENT, null, { filters: { titleSearch: MARKER } });
    expect(firstErrorCode(list)).toBe("UNAUTHORIZED");
    const detail = await postDocument(DETAIL_DOCUMENT, null, { broadcastId: 1 });
    expect(firstErrorCode(detail)).toBe("UNAUTHORIZED");
    const stop = await postDocument(STOP_DOCUMENT, null, { broadcastId: 1 });
    expect(firstErrorCode(stop)).toBe("UNAUTHORIZED");
  });
});

// ─── Tier 4 wire probes ───────────────────────────────────────────────────────

describe("admin broadcast history — Tier 4 identity-smuggling probes", () => {
  test("unknown root identity args die as GRAPHQL_VALIDATION_FAILED (list/detail/stop)", async () => {
    const fx = requireFixture();
    const listBody = await postDocument(`query { adminBroadcasts(userId: 1) { totalCount } }`, fx.adminToken);
    expect(firstErrorCode(listBody)).toBe("GRAPHQL_VALIDATION_FAILED");
    const detailBody = await postDocument(
      `query { adminBroadcastDetail(broadcastId: ${fx.bravoId}, actorId: 1) { liveDeliveredCount } }`,
      fx.adminToken
    );
    expect(firstErrorCode(detailBody)).toBe("GRAPHQL_VALIDATION_FAILED");
    const stopBody = await postDocument(
      `mutation { adminStopBroadcast(broadcastId: ${fx.bravoId}, actorId: 1) }`,
      fx.adminToken
    );
    expect(firstErrorCode(stopBody)).toBe("GRAPHQL_VALIDATION_FAILED");
  });

  test("smuggled identity field inside the filters input dies pre-resolver (inline + variables channel)", async () => {
    const fx = requireFixture();
    const inlineBody = await postDocument(
      `query { adminBroadcasts(filters: { titleSearch: "x", userId: 1 }) { totalCount } }`,
      fx.adminToken
    );
    expect(firstErrorCode(inlineBody)).toBe("GRAPHQL_VALIDATION_FAILED");
    // Same smuggle over the VARIABLES channel → value coercion denies it.
    const variablesBody = await postDocument(LIST_DOCUMENT, fx.adminToken, {
      filters: { titleSearch: MARKER, userId: 1 },
    });
    expect(firstErrorCode(variablesBody)).toBe("BAD_USER_INPUT");
  });

  test("an identity variable that the document never declares dies in validation", async () => {
    const fx = requireFixture();
    const body = await postDocument(
      `query UnusedIdentityProbe($broadcastId: Int!) { adminBroadcasts { totalCount } }`,
      fx.adminToken,
      { broadcastId: fx.bravoId, actorId: 1 }
    );
    expect(firstErrorCode(body)).toBe("GRAPHQL_VALIDATION_FAILED");
  });
});
