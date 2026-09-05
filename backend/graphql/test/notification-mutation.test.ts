/**
 * Notification inbox mutations — wire-tier integration suite for
 * `markNotificationRead` + `markAllNotificationsRead` over the REAL GraphQL
 * boundary (`setupTestServerLifecycle` + `testClient`).
 *
 * What this locks down (real HTTP → gateway pipeline → scope-auth → resolver
 * → NotificationEngine → PostgreSQL → back over the wire):
 *  - **Anonymous rejection** — both inbox mutations answer UNAUTHORIZED
 *    (extensions.code) for callers with no credentials, with the SAME
 *    localized message on both ops (constant denial class shape).
 *  - **mark-one happy path** — the caller marks one of their OWN unread rows:
 *    the wire row matches the post-update direct-DB row on ALL eight fields
 *    (stringified id, enum NAME on the wire, ISO createdAt) and the DB row
 *    flipped `is_read` only.
 *  - **Idempotent double mark** — a second mark of the same row returns it
 *    unchanged; the DB row is byte-identical across both calls (no drift).
 *  - **Oracle-safe denial constancy** — a foreign id (another actor's row)
 *    and a nonexistent id answer with the IDENTICAL error item (code,
 *    message, path, single-error envelope, null data) — existence is never
 *    disclosed — and the targeted foreign row stays byte-identical.
 *  - **Invalid-format ids** — non-canonical wire ids ("not-a-number", "0",
 *    "-7", "1.5", "1e3", "12abc", out-of-range magnitudes) reject with
 *    VALIDATION before any row is touched.
 *  - **mark-all** — the unfiltered sweep and the type-filtered sweep each
 *    return EXACTLY the direct-DB oracle count of the rows they flipped;
 *    repeat sweeps and type-empty sets report 0; outsider rows never move.
 *  - **BOPLA wire probe** — smuggled identity fields (`userId` on either
 *    root op) die as GRAPHQL_VALIDATION_FAILED before any resolver runs;
 *    there is no identity argument to address a foreign inbox with.
 *
 * Fixture strategy:
 *  - Two actors are created through the PUBLIC `registerUser` mutation over
 *    the wire (real registration path, real password hashes): a Student (the
 *    mutation subject with the richest row matrix) and a Parent (the
 *    cross-actor outsider — a parent can never reach the student's rows,
 *    mirroring the sibling-read impossibility of the self-scoped surface).
 *  - Inbox rows are seeded with direct committed inserts (never the emit
 *    surface) and torn down in `afterAll` (rows → role-child rows → users).
 *  - Authenticated calls carry the `Authorization: Bearer` header (the
 *    documented production client path read by `createGraphQLContext`) on a
 *    raw fetch — the shared `testClient`'s fixed HttpLink cannot attach
 *    per-request auth headers.
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
 * Mandated runner: bun run test/scripts/run-test.ts backend/graphql/test/notification-mutation.test.ts
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { gql } from "@apollo/client";
import { and, count, desc, eq, inArray, type SQL } from "drizzle-orm";
import { db } from "@/backend/db";
import { notifications } from "@/backend/db/schema/notifications/notifications";
import { parents } from "@/backend/db/schema/parents/parents";
import { students } from "@/backend/db/schema/students/students";
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
const WIRE_CREDENTIAL = "WireLatch!Pass1";

const MARK_ONE_DOCUMENT = `
  mutation WireMarkOne($id: ID!) {
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
  mutation WireMarkAll($type: NotificationType) {
    markAllNotificationsRead(type: $type)
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
async function postAnonymous(query: string): Promise<Record<string, unknown>> {
  const response = await fetch(GRAPHQL_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query }),
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

/** The GraphQL wire NAME of a canonical notification-type runtime value. */
function wireNameOf(type: NotificationType): string {
  const entry = Object.entries(NotificationType).find(([, value]) => value === type);
  if (entry === undefined) {
    throw new Error(`no wire name for notification type ${type}`);
  }
  return entry[0];
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

// ─── Direct-DB oracle (never routed through the engine) ──────────────────────

async function oracleRowById(id: number): Promise<NotificationSelectType | null> {
  const [row] = await db.select().from(notifications).where(eq(notifications.id, id)).limit(1);
  return row ?? null;
}

async function oracleRows(userId: number): Promise<NotificationSelectType[]> {
  return db
    .select()
    .from(notifications)
    .where(eq(notifications.userId, userId))
    .orderBy(desc(notifications.createdAt), desc(notifications.id));
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

const FIXTURE_MARKER = `wire-${randomUUID().slice(0, 8)}`;

function fixtureTitle(label: string, index: number): string {
  return `${FIXTURE_MARKER} ${label} notice ${index + 1}`;
}

// Richest matrix for the mark-one / type-filter / denial probes.
const STUDENT_SPECS: readonly RowSpec[] = [
  { type: NotificationType.SystemBroadcast, isRead: true, minutesAgo: 50 },
  { type: NotificationType.SystemBroadcast, isRead: false, minutesAgo: 40 },
  { type: NotificationType.SessionRequest, isRead: true, minutesAgo: 30 },
  { type: NotificationType.SessionRequest, isRead: false, minutesAgo: 20 },
  { type: NotificationType.PaymentConfirmation, isRead: false, minutesAgo: 10 },
];

// The cross-actor outsider's own inbox (also the mark-all sweep subject).
const PARENT_SPECS: readonly RowSpec[] = [
  { type: NotificationType.ParentLinkRequest, isRead: false, minutesAgo: 35 },
  { type: NotificationType.ParentLinkRequest, isRead: false, minutesAgo: 5 },
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
    relatedEntityId: 78_000 + i,
    createdAt: new Date(now - spec.minutesAgo * 60_000),
  }));
  return db
    .insert(notifications)
    .values([...values])
    .returning();
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

/** Registers one actor over the wire through the PUBLIC registerUser mutation. */
async function registerActor(label: string, role: "Student" | "Parent"): Promise<number> {
  const result = await testClient.mutate({
    mutation: gql`
      mutation RegisterWireLatchActor($input: RegisterUserInput!) {
        registerUser(input: $input) {
          id
        }
      }
    `,
    variables: {
      input: {
        fullName: `Wire Latch ${label} ${FIXTURE_MARKER}`,
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
async function loginActor(email: string): Promise<string> {
  const result = await testClient.mutate({
    mutation: gql`
      mutation LoginWireLatchActor($email: String!, $password: String!) {
        login(email: $email, password: $password) {
          accessToken
        }
      }
    `,
    variables: { email, password: WIRE_CREDENTIAL },
  });
  if (result.error) {
    throw new Error(`login failed for ${email} (code: ${extractErrorCode(result.error) ?? "unknown"})`);
  }
  return accessTokenOf(result);
}

let student: WireActor | undefined;
let parent: WireActor | undefined;

function studentActor(): WireActor {
  if (!student) {
    throw new Error("expected the student actor fixture");
  }
  return student;
}

function parentActor(): WireActor {
  if (!parent) {
    throw new Error("expected the parent actor fixture");
  }
  return parent;
}

/** Finds one of the student's seeded rows by kind + read state (enum-guarded). */
function studentRowBySpec(type: NotificationType, isRead: boolean): NotificationSelectType {
  const row = studentActor().rows.find(
    candidate => isNotificationType(candidate.type) && candidate.type === type && candidate.isRead === isRead
  );
  if (!row) {
    throw new Error(`expected a ${isRead ? "read" : "unread"} ${type} fixture row`);
  }
  return row;
}

/** The student's seeded UNREAD SystemBroadcast row — the mark-one subject. */
function studentUnreadBroadcastRow(): NotificationSelectType {
  return studentRowBySpec(NotificationType.SystemBroadcast, false);
}

/** The student's seeded UNREAD row of a kind OTHER than the sweep subject. */
function studentUnreadPaymentRow(): NotificationSelectType {
  return studentRowBySpec(NotificationType.PaymentConfirmation, false);
}

beforeAll(async () => {
  // Real registrations through the public mutation (committed users).
  const [studentId, parentId] = await Promise.all([
    registerActor("student", "Student"),
    registerActor("parent", "Parent"),
  ]);
  // Real logins — genuine credential paths for both actors.
  const [studentToken, parentToken] = await Promise.all([
    loginActor(`${FIXTURE_MARKER}-student@test.local`),
    loginActor(`${FIXTURE_MARKER}-parent@test.local`),
  ]);

  // Committed inbox fixtures (direct inserts — never the emit surface).
  const [studentRows, parentRows] = await Promise.all([
    seedRows(studentId, "student", STUDENT_SPECS),
    seedRows(parentId, "parent", PARENT_SPECS),
  ]);

  student = { label: "student", userId: studentId, accessToken: studentToken, rows: studentRows };
  parent = { label: "parent", userId: parentId, accessToken: parentToken, rows: parentRows };
}, 120_000);

afterAll(async () => {
  const fixtureUserIds = [studentActor().userId, parentActor().userId];
  // Fixture users cascade their notifications; delete role-child rows before
  // the user rows (FK-safe order).
  await db.delete(students).where(inArray(students.id, fixtureUserIds));
  await db.delete(parents).where(inArray(parents.id, fixtureUserIds));
  await db.delete(notifications).where(inArray(notifications.userId, fixtureUserIds));
  await db.delete(users).where(inArray(users.id, fixtureUserIds));
}, 60_000);

// ─── Assertions ──────────────────────────────────────────────────────────────

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

describe("notification inbox mutations — anonymous tier", () => {
  test("markNotificationRead answers UNAUTHORIZED for anonymous callers", async () => {
    const result = await testClient.mutate({
      mutation: gql`
        mutation AnonymousMarkOne($id: ID!) {
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
        mutation AnonymousMarkAll {
          markAllNotificationsRead
        }
      `,
    });
    const error = expectMutationError(result.error, "UNAUTHORIZED");
    // The denial rides the single-error envelope — exactly one error item.
    expect(error.errors).toHaveLength(1);
  });

  test("the anonymous denial class is CONSTANT across both ops (same code, message, envelope)", async () => {
    const markOneBody = await postAnonymous('mutation { markNotificationRead(id: "1") { id } }');
    const markOneItem = soleErrorItemOf(markOneBody);
    const markAllBody = await postAnonymous("mutation { markAllNotificationsRead }");
    const markAllItem = soleErrorItemOf(markAllBody);

    expect(errorCodeOf(markOneItem)).toBe("UNAUTHORIZED");
    expect(errorCodeOf(markAllItem)).toBe("UNAUTHORIZED");
    // Same localized message on both ops — no per-op disclosure.
    expect(errorMessageOf(markAllItem)).toBe(errorMessageOf(markOneItem));
    // Each error carries its OWN path (the failing root field) and the same
    // null-data / single-item envelope.
    expect(markOneItem.path).toEqual(["markNotificationRead"]);
    expect(markAllItem.path).toEqual(["markAllNotificationsRead"]);
    expect(markOneBody.data).toBeNull();
    expect(markAllBody.data).toBeNull();
    expect(
      Object.keys(recordOf(markOneItem.extensions, "expected extensions")).toSorted((a, b) => a.localeCompare(b))
    ).toEqual(
      Object.keys(recordOf(markAllItem.extensions, "expected extensions")).toSorted((a, b) => a.localeCompare(b))
    );
  });
});

describe("notification inbox mutations — mark-one latch", () => {
  test("marking an own unread row returns it with isRead true, wire ≡ post-update DB row", async () => {
    const subject = studentUnreadBroadcastRow();
    const body = await markOne(studentActor().accessToken, String(subject.id));
    expect(body.errors).toBeUndefined();

    const dbRow = await oracleRowById(subject.id);
    if (!dbRow) {
      throw new Error("expected the marked row to persist");
    }
    expect(dbRow.isRead).toBe(true);
    expectWireRowMatchesDbRow(wireNotificationOf(body), dbRow);
    // The id round-trips as the canonical STRINGified integer.
    expect(/^\d+$/.test(String(wireNotificationOf(body).id))).toBe(true);
  });

  test("double mark is idempotent — the row returns unchanged, byte-identical in the DB", async () => {
    const subject = studentUnreadBroadcastRow();
    const before = await oracleRowById(subject.id);
    if (!before) {
      throw new Error("expected the marked row to persist");
    }
    expect(before.isRead).toBe(true);

    const body = await markOne(studentActor().accessToken, String(subject.id));
    expect(body.errors).toBeUndefined();
    expectWireRowMatchesDbRow(wireNotificationOf(body), before);

    const after = await oracleRowById(subject.id);
    if (!after) {
      throw new Error("expected the marked row to persist");
    }
    expectRowsByteIdentical(after, before);
  });

  test("a FOREIGN id answers NOTIFICATION_NOT_FOUND and the victim row stays byte-identical", async () => {
    const victim = studentUnreadPaymentRow();
    const before = await oracleRowById(victim.id);
    if (!before) {
      throw new Error("expected the victim row to persist");
    }

    // The parent outsider probes the student's row id.
    const body = await markOne(parentActor().accessToken, String(victim.id));
    const errorItem = soleErrorItemOf(body);
    expect(errorCodeOf(errorItem)).toBe("NOTIFICATION_NOT_FOUND");
    expect(errorItem.path).toEqual(["markNotificationRead"]);
    expect(body.data).toBeNull();

    const after = await oracleRowById(victim.id);
    if (!after) {
      throw new Error("expected the victim row to persist");
    }
    expectRowsByteIdentical(after, before);
  });

  test("a NONEXISTENT id is indistinguishable from a foreign one (constant denial shape)", async () => {
    const victim = studentUnreadPaymentRow();
    const foreignBody = await markOne(parentActor().accessToken, String(victim.id));
    const foreignItem = soleErrorItemOf(foreignBody);
    // A safe-magnitude id that matches no row.
    const nonexistentBody = await markOne(parentActor().accessToken, "2000000000");
    const nonexistentItem = soleErrorItemOf(nonexistentBody);

    // Identical code, message, path — existence is never disclosed.
    expect(errorCodeOf(nonexistentItem)).toBe("NOTIFICATION_NOT_FOUND");
    expect(errorMessageOf(nonexistentItem)).toBe(errorMessageOf(foreignItem));
    expect(nonexistentItem.path).toEqual(foreignItem.path);
    // Identical envelope: one error item, null data, same extensions keys.
    expect(nonexistentBody.data).toBeNull();
    expect(
      Object.keys(recordOf(nonexistentItem.extensions, "expected extensions")).toSorted((a, b) => a.localeCompare(b))
    ).toEqual(
      Object.keys(recordOf(foreignItem.extensions, "expected extensions")).toSorted((a, b) => a.localeCompare(b))
    );
  });

  test("invalid-format ids answer VALIDATION before any row is touched", async () => {
    const invalidIds = ["not-a-number", "0", "-7", "1.5", "1e3", "12abc", "99999999999999999999"];
    const bodies = await Promise.all(invalidIds.map(id => markOne(studentActor().accessToken, id)));
    for (const body of bodies) {
      expect(errorCodeOf(soleErrorItemOf(body))).toBe("VALIDATION");
      expect(body.data).toBeNull();
    }
    // No fixture row moved while the probes ran.
    expect(await oracleUnreadCount(studentActor().userId)).toBe(2);
  });
});

describe("notification inbox mutations — mark-all sweeps", () => {
  test("a type-filtered sweep flips ONLY that kind and reports the oracle count", async () => {
    const before = await oracleUnreadCount(studentActor().userId, NotificationType.SessionRequest);
    expect(before).toBe(1);

    const body = await markAll(studentActor().accessToken, wireNameOf(NotificationType.SessionRequest));
    expect(body.errors).toBeUndefined();
    expect(wireMarkAllCountOf(body)).toBe(before);

    // The filtered kind is fully read now…
    expect(await oracleUnreadCount(studentActor().userId, NotificationType.SessionRequest)).toBe(0);
    // …the OTHER unread kinds stay unread…
    expect(await oracleUnreadCount(studentActor().userId)).toBe(1);
    // …and the outsider's rows never moved.
    expect(await oracleUnreadCount(parentActor().userId)).toBe(2);
  });

  test("an unfiltered sweep flips every unread row and reports the oracle count", async () => {
    const before = await oracleUnreadCount(parentActor().userId);
    expect(before).toBe(2);

    const body = await markAll(parentActor().accessToken);
    expect(body.errors).toBeUndefined();
    expect(wireMarkAllCountOf(body)).toBe(before);

    expect(await oracleUnreadCount(parentActor().userId)).toBe(0);
    const parentRows = await oracleRows(parentActor().userId);
    for (const row of parentRows) {
      expect(row.isRead).toBe(true);
    }
    // The student's remaining unread row is untouched by the parent's sweep.
    expect(await oracleUnreadCount(studentActor().userId)).toBe(1);
  });

  test("empty sets answer 0 — repeat sweep and type with no unread rows", async () => {
    const repeatBody = await markAll(parentActor().accessToken);
    expect(repeatBody.errors).toBeUndefined();
    expect(wireMarkAllCountOf(repeatBody)).toBe(0);

    // The student has NO ParentLinkRequest rows at all — a type-empty sweep.
    const typedBody = await markAll(studentActor().accessToken, wireNameOf(NotificationType.ParentLinkRequest));
    expect(typedBody.errors).toBeUndefined();
    expect(wireMarkAllCountOf(typedBody)).toBe(0);
  });

  test("the final sweep drains the student's inbox and the latch is visible to the query surface", async () => {
    const before = await oracleUnreadCount(studentActor().userId);
    expect(before).toBe(1);

    const body = await markAll(studentActor().accessToken);
    expect(body.errors).toBeUndefined();
    expect(wireMarkAllCountOf(body)).toBe(before);
    expect(await oracleUnreadCount(studentActor().userId)).toBe(0);

    // Cross-surface coherence: the query op reports the drained badge too.
    const countBody = await postDocument("query { myUnreadNotificationCount }", studentActor().accessToken);
    expect(countBody.errors).toBeUndefined();
    expect(
      recordOf(recordOf(countBody, "expected a body").data, "expected a data object").myUnreadNotificationCount
    ).toBe(0);

    // End-state closure: every fixture row is read, the row SET is exactly
    // the seeded seven (no creates, no deletes), and every row differs from
    // its seeded snapshot by AT MOST the is_read latch (seeded-read rows are
    // byte-identical — they were never touched).
    const finalRows = await oracleRows(studentActor().userId);
    const finalParentRows = await oracleRows(parentActor().userId);
    expect(finalRows).toHaveLength(5);
    expect(finalParentRows).toHaveLength(2);
    for (const row of [...finalRows, ...finalParentRows]) {
      expect(row.isRead).toBe(true);
    }
    for (const seeded of [...studentActor().rows, ...parentActor().rows]) {
      const finalRow = [...finalRows, ...finalParentRows].find(candidate => candidate.id === seeded.id);
      if (!finalRow) {
        throw new Error(`expected fixture row ${seeded.id} to persist`);
      }
      if (seeded.isRead === true) {
        expectRowsByteIdentical(finalRow, seeded);
      } else {
        // ONLY the latch flipped — rewinding it must reproduce the seed.
        expect(JSON.stringify({ ...finalRow, isRead: seeded.isRead })).toBe(JSON.stringify(seeded));
      }
    }
  });
});

describe("notification inbox mutations — BOPLA wire probe", () => {
  test("smuggled identity args die as GRAPHQL_VALIDATION_FAILED before any resolver runs", async () => {
    const smuggledMarkOne = await postDocument(
      'mutation { markNotificationRead(userId: 12345, id: "1") { id } }',
      studentActor().accessToken
    );
    expect(errorCodeOf(soleErrorItemOf(smuggledMarkOne))).toBe("GRAPHQL_VALIDATION_FAILED");

    const smuggledMarkAll = await postDocument(
      "mutation { markAllNotificationsRead(userId: 12345) }",
      studentActor().accessToken
    );
    expect(errorCodeOf(soleErrorItemOf(smuggledMarkAll))).toBe("GRAPHQL_VALIDATION_FAILED");
  });
});
