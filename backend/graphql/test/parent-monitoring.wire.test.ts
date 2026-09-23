/**
 * Consolidated GraphQL wire matrix — the role × operation × BOLA tier for the
 * six parent-monitoring root query fields (`setupTestServerLifecycle` +
 * `testClient`, raw `fetch` where byte-shape matters).
 *
 * This is the consolidated wire-tier suite over the REAL wire (HTTP → gateway
 * pipeline → scope-auth → resolver → ParentMonitoringService → PostgreSQL
 * → back), crossing the six parent-only read operations with every caller
 * class the permission matrix recognizes:
 *
 *  - `myLinkedChildren` — zero-arg `[ParentLinkedChild!]!` list;
 *  - `parentChildProgress(studentId: Int!)` — `ParentChildProgress!`;
 *  - `parentChildSessions(studentId: Int!, page: Int, pageSize: Int)` —
 *    `ParentAttendancePage!`;
 *  - `parentChildReports(studentId: Int!, page: Int, pageSize: Int)` —
 *    `ParentReportPage!`;
 *  - `parentChildHomework(studentId: Int!, page: Int, pageSize: Int)` —
 *    `ParentHomeworkPage!`;
 *  - `parentSessionTarget(sessionId: Int!)` — `ParentSessionTarget!` (the
 *    completion-notification deep-link read: one session pointer → the
 *    closed (session, linked-child) id pair).
 *
 * Matrix cells locked down:
 *  - **Anonymous × 6 ops** — every op answers UNAUTHORIZED for
 *    credential-less callers, with a CONSTANT single-error envelope (same
 *    localized copy, per-op `path`, each op carrying only its own path).
 *    All six fields are non-nullable root fields, so `data: null` on every
 *    denial (GraphQL spec — a field error on a non-nullable field nulls the
 *    whole `data` object).
 *  - **Wrong role × 6 ops (18 cells)** — admin, teacher, and student on
 *    every op answer FORBIDDEN (pre-resolver `role`-scope denial — there is
 *    deliberately NO admin override on this parent-private surface).
 *  - **BFLA proof** — a wrong-role caller probes the same op with three
 *    different arg values (a foreign id, `0`, `-1`). All three
 *    responses are BYTE-IDENTICAL — the scope rejects before the resolver
 *    body runs, so the argument never reaches the service gate. The
 *    denial rides the SAME path, the SAME localized message, and the SAME
 *    extensions key-set across every value (no arg-dependent divergence).
 *  - **Forged-role token** — a role-escalated payload spliced into a real
 *    access token WITHOUT re-signing is rejected at token integrity:
 *    the request is answered UNAUTHORIZED (the tampered token buys
 *    anonymous treatment, never a trusted role claim).
 *  - **Parent without link × 6 ops** — `myLinkedChildren` answers 200 with
 *    `[]` (an honest empty list, NOT a 403); the five detail queries answer
 *    403 FORBIDDEN (the service gate's constant denial — no link in force).
 *  - **Parent with link to a foreign child × 5 detail ops** — every detail
 *    query with a foreign id answers 403 FORBIDDEN with ZERO data
 *    leakage (the response body is `data: null` — no child fields, no
 *    existence oracle, no per-cause disclosure).
 *  - **Parent with link to the requested child × 6 ops** — every op
 *    answers 200 with data. `myLinkedChildren` returns the linked child;
 *    `parentChildProgress` returns the composite progress payload; the three
 *    page wrappers return their honest `items` / `totalCount` / `page` /
 *    `pageSize` shape; `parentSessionTarget` resolves the linked child's
 *    own session to the closed two-field pair.
 *  - **BOLA probe** — a parent with a valid session requests a foreign
 *    id and a malformed id (`0`, `-1`). The id-based detail queries answer
 *    BYTE-IDENTICAL 403 FORBIDDEN bodies (the gate's constant denial —
 *    missing ≡ foreign ≡ never-linked ≡ severed ≡ malformed). Zero data
 *    leakage on every arm (response body assertions: `data === null`, no
 *    child fields, no stack trace).
 *  - **Session-target oracle + boundary** — for the deep-link read the
 *    constant-denial oracle covers EXISTENCE/OWNERSHIP only: a
 *    nonexistent session id and a foreign child's session answer
 *    BYTE-IDENTICAL FORBIDDEN bodies (repeated probes stay identical —
 *    no drift, no per-cause disclosure), while a NON-POSITIVE `sessionId`
 *    is a VALIDATION failure (shape, not ownership) and an out-of-range
 *    `Int` literal dies at GRAPHQL_VALIDATION_FAILED before any resolver.
 *  - **BOPLA smuggle probes** — `studentId` / `parentId` / `userId` as
 *    extra args on the six fields die as GRAPHQL_VALIDATION_FAILED before
 *    any resolver runs (the request never executes: the `data` key is
 *    absent from the body).
 *  - **Locale negotiation** — denial copy localized via `ctx.t`: one en +
 *    one ar assertion per denial class (UNAUTHORIZED + FORBIDDEN), expected
 *    copy resolved through the locale keys (never hardcoded strings). The
 *    `Accept-Language` header is the locale channel (the context factory's
 *    cookie → header → default fallback chain).
 *  - **Byte shapes** — every error item carries `extensions.code` + a
 *    correlated `extensions.requestId` and NEVER a `stacktrace`. The
 *    single-item envelope is constant across every denial class.
 *  - **id-first selections** — the printed form of the five id-bearing
 *    documents pins `id` as the FIRST field of every object selection that
 *    carries one; the session-target document pins the closed two-field
 *    selection instead (the value object carries NO `id`).
 *
 * Fixture strategy (matches the sibling parent-link wire suite):
 *  - Actors ride the PUBLIC `registerUser` mutation over the wire (real
 *    credential path); the admin rides the seeded admin credentials (the
 *    seed's own env-fallback chain) — its USER row is never deleted.
 *  - Registration mints the Parent/Student role-child rows server-side but
 *    NEVER a teacher row (that only comes from applicant verification), so
 *    the teacher actor is anchored with the sanctioned single-shared-PK
 *    insert (the journey cast helper's precedent) before session rows exist.
 *  - Both parent↔child link grants are established over the REAL parent-link
 *    wire flow (handshake code → request → accept) — the link lives entirely
 *    in the server's DB view, which is what the wire queries read from.
 *  - TWO students are linked to parentP: studentS (whose sessions page stays
 *    honestly empty) and studentS2 (which owns the deep-link read's linked
 *    session row) — the split keeps every honest-empty arm intact alongside
 *    the new session-target success cell. The foreign child owns the
 *    foreign-session denial row; reports/homework/progress stay unseeded.
 *  - Teardown in `afterAll` deletes session-anchored rows BEFORE users
 *    (both `session.student_id` and `session.teacher_id` are RESTRICT FKs);
 *    the `users` delete cascades to `students` / `parents` / `applicants` /
 *    `teacher` / `notifications` / `progress`.
 *
 * ENVIRONMENT NOTE (sandbox): the canonical lifecycle helper boots its own
 * dev server on TEST_PORT (3066) when nothing answers there. Where a server
 * already owns the port, the helper's liveness probe succeeds and no second
 * server is spawned. CI boots the canonical 3066 path.
 *
 * Mandated runner: bun run test/scripts/run-test.ts backend/graphql/test/parent-monitoring.wire.test.ts
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { gql } from "@apollo/client";
import { eq, inArray } from "drizzle-orm";
import { parse, visit } from "graphql";
import { db } from "@/backend/db";
import { session } from "@/backend/db/schema/classes/session";
import { parentLinkRequests } from "@/backend/db/schema/parents/parent-link-requests";
import { parents } from "@/backend/db/schema/parents/parents";
import { students } from "@/backend/db/schema/students/students";
import { applicants } from "@/backend/db/schema/teachers/applicants";
import { teacher } from "@/backend/db/schema/teachers/teacher";
import { users } from "@/backend/db/schema/users/users";
import { getServerTranslations } from "@/shared/locale/server-graphql";
import { expectMutationError, setupTestServerLifecycle, TEST_PORT, testClient } from "@/test/helpers";

setupTestServerLifecycle();

// ─── Locale-key expected copy (never hardcoded strings) ──────────────────────

const tEn = getServerTranslations("en").errorsTranslations;
const tAr = getServerTranslations("ar").errorsTranslations;

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

/**
 * Serializes a wire body with the per-request `requestId` redacted — the
 * correlation id is intentionally unique per request (tracing contract), so
 * byte-identical denial-shape comparisons across multiple probes must
 * normalize it. The redaction preserves every other field verbatim, so the
 * assertion still pins the denial SHAPE (message, path, locations,
 * extensions key set, code) — only the per-request UUID is elided.
 */
function bodyShapeOf(body: Record<string, unknown>): string {
  return JSON.stringify(body).replace(/"requestId":"[^"]+"/g, '"requestId":"<redacted>"');
}

// ─── Wire helpers ────────────────────────────────────────────────────────────

const GRAPHQL_URL = `http://localhost:${TEST_PORT}/api/graphql`;
const WIRE_CREDENTIAL = "WireMonitor!Pass1";
/** Seeded-admin credentials — the seed's own env-fallback chain. */
const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? "admin@draftacademy.local";
const ADMIN_CREDENTIAL = process.env.ADMIN_PASSWORD ?? "Seed_Pass1!";

const LINKED_CHILDREN_DOCUMENT = `
  query WireMatrixLinkedChildren {
    myLinkedChildren {
      id
      fullName
      createdAt
    }
  }
`;

const CHILD_PROGRESS_DOCUMENT = `
  query WireMatrixChildProgress($studentId: Int!) {
    parentChildProgress(studentId: $studentId) {
      child {
        id
        fullName
        createdAt
      }
      progressRowCount
      latestJadidPosition {
        surahJuz
        fromAyah
        toAyah
      }
      latestMadiPosition {
        surahJuz
        fromAyah
        toAyah
      }
    }
  }
`;

const CHILD_SESSIONS_DOCUMENT = `
  query WireMatrixChildSessions($studentId: Int!, $page: Int, $pageSize: Int) {
    parentChildSessions(studentId: $studentId, page: $page, pageSize: $pageSize) {
      items {
        id
        status
        startedAt
        endedAt
        createdAt
      }
      totalCount
      page
      pageSize
    }
  }
`;

const CHILD_REPORTS_DOCUMENT = `
  query WireMatrixChildReports($studentId: Int!, $page: Int, $pageSize: Int) {
    parentChildReports(studentId: $studentId, page: $page, pageSize: $pageSize) {
      items {
        id
        sessionId
        sessionStatus
        sessionStartedAt
        teacherNotes
        studentRatingByTeacher
        createdAt
      }
      totalCount
      page
      pageSize
    }
  }
`;

const CHILD_HOMEWORK_DOCUMENT = `
  query WireMatrixChildHomework($studentId: Int!, $page: Int, $pageSize: Int) {
    parentChildHomework(studentId: $studentId, page: $page, pageSize: $pageSize) {
      items {
        id
        sessionId
        jadid {
          surahJuz
          fromAyah
          toAyah
          grade
        }
        madi {
          surahJuz
          fromAyah
          toAyah
          grade
        }
        createdAt
      }
      totalCount
      page
      pageSize
    }
  }
`;

/**
 * The deep-link read's document: the closed two-field selection (the value
 * object carries NO `id`, so the id-first pin does not apply here — the
 * selection-shape pin below locks the exact two fields instead).
 */
const SESSION_TARGET_DOCUMENT = `
  query WireMatrixSessionTarget($sessionId: Int!) {
    parentSessionTarget(sessionId: $sessionId) {
      sessionId
      studentId
    }
  }
`;

/** POSTs one document over the wire with a Bearer access token (+ extra headers). */
async function postDocument(
  query: string,
  accessToken: string,
  variables?: Record<string, unknown>,
  extraHeaders?: Record<string, string>
): Promise<Record<string, unknown>> {
  const response = await fetch(GRAPHQL_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${accessToken}`,
      ...extraHeaders,
    },
    body: JSON.stringify(variables === undefined ? { query } : { query, variables }),
    signal: AbortSignal.timeout(30_000),
  });
  return recordOf(await response.json(), "expected a JSON object response");
}

/** POSTs one document over the wire with NO credentials (+ extra headers). */
async function postAnonymous(
  query: string,
  variables?: Record<string, unknown>,
  extraHeaders?: Record<string, string>
): Promise<Record<string, unknown>> {
  const response = await fetch(GRAPHQL_URL, {
    method: "POST",
    headers: { "content-type": "application/json", ...extraHeaders },
    body: JSON.stringify(variables === undefined ? { query } : { query, variables }),
    signal: AbortSignal.timeout(30_000),
  });
  return recordOf(await response.json(), "expected a JSON object response");
}

/**
 * Asserts one raw-wire denial body answers the expected extensions.code with
 * the shipped error contract: single-item envelope, a correlated requestId,
 * and NEVER a stacktrace (no leaked internals). The `data` channel follows the
 * GraphQL spec for non-nullable root fields: `null` when the field error
 * nulls the whole data object (all six portal fields are non-nullable).
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
  const requestId = recordOf(errorItem.extensions, "expected extensions").requestId;
  expect(typeof requestId === "string" && requestId.length > 0).toBe(true);
  expect(JSON.stringify(errorItem)).not.toContain("stacktrace");
  return errorItem;
}

/** Wire list payload, runtime-guarded (the `[T!]!` zero-arg shape). */
function wireListItemsOf(body: Record<string, unknown>, field: string): Record<string, unknown>[] {
  const data = recordOf(recordOf(body, "expected a body").data, "expected a data object");
  const rawRows = data[field];
  if (!Array.isArray(rawRows)) {
    throw new Error(`expected an array payload for ${field}`);
  }
  return rawRows.map(row => recordOf(row, "expected record-shaped row entries"));
}

/** Wire page payload, runtime-guarded (the `items` + `totalCount` + `page` + `pageSize` shape). */
function wirePageOf(
  body: Record<string, unknown>,
  field: string
): {
  readonly items: Record<string, unknown>[];
  readonly totalCount: number;
  readonly page: number;
  readonly pageSize: number;
} {
  const data = recordOf(recordOf(body, "expected a body").data, "expected a data object");
  const page = recordOf(data[field], "expected a page payload");
  const items = page.items;
  if (!Array.isArray(items)) {
    throw new Error(`expected an array items field for ${field}`);
  }
  const totalCount = page.totalCount;
  const pageNumber = page.page;
  const pageSize = page.pageSize;
  if (typeof totalCount !== "number" || typeof pageNumber !== "number" || typeof pageSize !== "number") {
    throw new Error(`expected numeric page metadata for ${field}`);
  }
  return {
    items: items.map(row => recordOf(row, "expected record-shaped page item")),
    totalCount,
    page: pageNumber,
    pageSize,
  };
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

/**
 * Forges a role-escalated copy of a REAL access token by splicing the role
 * claim in the payload segment WITHOUT re-signing: the signature no longer
 * covers the payload, so token integrity — not the role claim — decides the
 * outcome. The probe proves a forged role can never ride a stolen structure.
 */
function forgedRoleTokenOf(accessToken: string): string {
  const segments = accessToken.split(".");
  if (segments.length !== 3) {
    throw new Error("expected a three-segment JWT access token");
  }
  const decoded: unknown = JSON.parse(Buffer.from(segments[1], "base64url").toString("utf8"));
  const payload = recordOf(decoded, "expected a record-shaped JWT payload");
  payload.role = "Admin";
  const reEncoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `${segments[0]}.${reEncoded}.${segments[2]}`;
}

/** Runtime-guarded string field off a wire row (no casts, per test-tier discipline). */
function stringFieldOf(row: Record<string, unknown>, key: string): string {
  const value = row[key];
  if (typeof value !== "string") {
    throw new Error(`expected a string ${key} on the wire`);
  }
  return value;
}

/** Printed-selections order pin: `id` is the FIRST field of every object selection that carries one. */
function expectIdFirstInEveryObjectSelection(documentText: string): void {
  visit(parse(documentText), {
    Field: {
      enter(node) {
        if (node.selectionSet === undefined) {
          return;
        }
        // Only object selections that ACTUALLY carry an `id` field are
        // subject to the id-first pin — nested objects without an `id`
        // (e.g. `latestJadidPosition { surahJuz, fromAyah, toAyah }`) are
        // free to lead with their canonical domain field.
        const hasIdField = node.selectionSet.selections.some(
          selection => selection.kind === "Field" && selection.name.value === "id"
        );
        if (!hasIdField) {
          return;
        }
        const first = node.selectionSet.selections[0];
        expect(first.kind === "Field" && first.name.value === "id").toBe(true);
      },
    },
  });
}

// ─── Fixtures ────────────────────────────────────────────────────────────────

/** One wire-tier actor: a real session + identity bits the assertions need. */
interface WireActor {
  readonly label: string;
  readonly userId: number;
  readonly fullName: string;
  readonly accessToken: string;
}

const FIXTURE_MARKER = `pmwire-${randomUUID().slice(0, 8)}`;

/** Registers one actor over the wire through the PUBLIC registerUser mutation. */
async function registerActor(label: string, role: "Student" | "Teacher" | "Parent"): Promise<number> {
  const result = await testClient.mutate({
    mutation: gql`
      mutation RegisterParentMonitoringWireActor($input: RegisterUserInput!) {
        registerUser(input: $input) {
          id
        }
      }
    `,
    variables: {
      input: {
        fullName: `Wire Monitor ${label} ${FIXTURE_MARKER}`,
        email: `${FIXTURE_MARKER}-${label}@test.local`,
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
  return registeredUserIdOf(result);
}

/**
 * Registers the fixture cast ONE AT A TIME (sequential reduce — the sanctioned
 * no-await-in-loop idiom). Registration is the ONLY fixture step whose
 * server-side transaction carries a nested SAVEPOINT, and the sandbox's
 * single-connection PGlite instance interleaves concurrent transactions onto
 * ONE session — parallel `registerUser` calls collide on the shared `sp1`
 * savepoint name. The parallel deny-probes in the cells below stay parallel:
 * scope-auth, validation, coercion, and smuggled-arg denials never touch the
 * database.
 */
async function registerActorCast(
  specs: readonly (readonly [label: string, role: "Student" | "Teacher" | "Parent"])[]
): Promise<number[]> {
  return specs.reduce<Promise<number[]>>(
    async (ids, [label, role]) => [...(await ids), await registerActor(label, role)],
    Promise.resolve([])
  );
}

/** Logs one actor in over the wire and returns the access token. */
async function loginActor(email: string, credential: string): Promise<string> {
  const result = await testClient.mutate({
    mutation: gql`
      mutation LoginParentMonitoringWireActor($email: String!, $password: String!) {
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
  return accessTokenOf(result);
}

function actorByLabel(label: string): WireActor {
  const actor = actors.find(candidate => candidate.label === label);
  if (!actor) {
    throw new Error(`expected the ${label} actor fixture`);
  }
  return actor;
}

/**
 * Establishes one parent→student link grant over the REAL parent-link wire
 * flow (the student's own handshake code → the parent's request → the
 * student's accept) and returns the tracked link request id for teardown.
 * The `myHandshakeCode` query is the student's own-code lookup (zero-arg,
 * identity from ctx) — no direct DB writes from the test process.
 */
async function linkParentToStudentOverWire(
  parentAccessToken: string,
  studentAccessToken: string,
  studentLabel: string
): Promise<number> {
  const handshakeBody = await postDocument("query WireMatrixMyHandshakeCode { myHandshakeCode }", studentAccessToken);
  if (handshakeBody.errors) {
    throw new Error(`failed to fetch ${studentLabel} handshake code over the wire`);
  }
  const handshakeData = recordOf(handshakeBody.data, "myHandshakeCode returned no data");
  const handshakeCode = handshakeData.myHandshakeCode;
  if (typeof handshakeCode !== "string") {
    throw new Error("expected a string handshake code from the wire");
  }

  const requestBody = await postDocument(
    "mutation WireMatrixRequestLink($code: String!) { requestParentChildLink(code: $code) { id } }",
    parentAccessToken,
    { code: handshakeCode }
  );
  if (requestBody.errors) {
    throw new Error("failed to request parent-child link over the wire");
  }
  const requestData = recordOf(requestBody.data, "requestParentChildLink returned no data");
  const requestPayload = recordOf(requestData.requestParentChildLink, "requestParentChildLink returned no payload");
  const wireRequestId = requestPayload.id;
  if (typeof wireRequestId !== "string" && typeof wireRequestId !== "number") {
    throw new Error("expected a request id from the wire");
  }
  const requestId = String(wireRequestId);

  const respondBody = await postDocument(
    "mutation WireMatrixRespondLink($requestId: ID!, $accept: Boolean!) { respondToParentLinkRequest(requestId: $requestId, accept: $accept) { id } }",
    studentAccessToken,
    { requestId, accept: true }
  );
  if (respondBody.errors) {
    throw new Error("failed to accept parent-child link over the wire");
  }
  const respondData = recordOf(respondBody.data, "respondToParentLinkRequest returned no data");
  const respondPayload = recordOf(
    respondData.respondToParentLinkRequest,
    "respondToParentLinkRequest returned no payload"
  );
  if (respondPayload.id === null || respondPayload.id === undefined) {
    throw new Error("expected a respond id from the wire");
  }
  return Number.parseInt(requestId, 10);
}

let actors: WireActor[] = [];
let adminUserId = 0;
let linkedStudentId = 0;
let secondLinkedStudentId = 0;
let foreignStudentId = 0;
let seededRequestId = 0;
let seededSecondRequestId = 0;
let linkedSessionId = 0;
let foreignSessionId = 0;

beforeAll(async () => {
  // Real registrations through the public mutation (committed users + the
  // role-child rows). SEQUENTIAL via registerActorCast — see the helper's
  // savepoint note.
  //  - parentP: the entitled parent (linked to studentS AND studentS2 via
  //    the wire flow).
  //  - parentU: a parent with NO link (the empty-list arm of the matrix).
  //  - studentS: the linked child whose sessions page stays honestly empty.
  //  - studentS2: the second linked child — owner of the deep-link read's
  //    linked session row (the split keeps every honest-empty arm intact).
  //  - studentF: a foreign child (never linked to parentP — BOLA probe arm).
  //  - teacherT: a wrong-role caller (the portal is parent-private).
  const [parentP, parentU, studentS, studentS2, studentF, teacherT] = await registerActorCast([
    ["parentP", "Parent"],
    ["parentU", "Parent"],
    ["studentS", "Student"],
    ["studentS2", "Student"],
    ["studentF", "Student"],
    ["teacherT", "Teacher"],
  ]);

  // Real logins — the seeded admin rides its env-fallback credentials.
  const [parentPToken, parentUToken, studentSToken, studentS2Token, studentFToken, teacherTToken, adminToken] =
    await Promise.all([
      loginActor(`${FIXTURE_MARKER}-parentP@test.local`, WIRE_CREDENTIAL),
      loginActor(`${FIXTURE_MARKER}-parentU@test.local`, WIRE_CREDENTIAL),
      loginActor(`${FIXTURE_MARKER}-studentS@test.local`, WIRE_CREDENTIAL),
      loginActor(`${FIXTURE_MARKER}-studentS2@test.local`, WIRE_CREDENTIAL),
      loginActor(`${FIXTURE_MARKER}-studentF@test.local`, WIRE_CREDENTIAL),
      loginActor(`${FIXTURE_MARKER}-teacherT@test.local`, WIRE_CREDENTIAL),
      loginActor(ADMIN_EMAIL, ADMIN_CREDENTIAL),
    ]);

  const [adminRow] = await db.select({ id: users.id }).from(users).where(eq(users.email, ADMIN_EMAIL)).limit(1);
  if (!adminRow) {
    throw new Error(`seeded admin ${ADMIN_EMAIL} not found`);
  }
  adminUserId = adminRow.id;

  actors = [
    {
      label: "parentP",
      userId: parentP,
      fullName: `Wire Monitor parentP ${FIXTURE_MARKER}`,
      accessToken: parentPToken,
    },
    {
      label: "parentU",
      userId: parentU,
      fullName: `Wire Monitor parentU ${FIXTURE_MARKER}`,
      accessToken: parentUToken,
    },
    {
      label: "studentS",
      userId: studentS,
      fullName: `Wire Monitor studentS ${FIXTURE_MARKER}`,
      accessToken: studentSToken,
    },
    {
      label: "studentS2",
      userId: studentS2,
      fullName: `Wire Monitor studentS2 ${FIXTURE_MARKER}`,
      accessToken: studentS2Token,
    },
    {
      label: "studentF",
      userId: studentF,
      fullName: `Wire Monitor studentF ${FIXTURE_MARKER}`,
      accessToken: studentFToken,
    },
    {
      label: "teacherT",
      userId: teacherT,
      fullName: `Wire Monitor teacherT ${FIXTURE_MARKER}`,
      accessToken: teacherTToken,
    },
    // The seeded admin is NEVER deleted — it only supplies wrong-role cells.
    { label: "admin", userId: adminUserId, fullName: "Seeded Administrator", accessToken: adminToken },
  ];

  linkedStudentId = studentS;
  secondLinkedStudentId = studentS2;
  foreignStudentId = studentF;

  // The link grants are established over the wire through the REAL
  // parent-link flow (the same path production uses) — one per linked child,
  // sequentially (each accept mutates the shared parent row). No direct DB
  // writes from the test process — the links live entirely in the server's
  // DB view, which is what the wire queries read from.
  seededRequestId = await linkParentToStudentOverWire(parentPToken, studentSToken, "studentS");
  seededSecondRequestId = await linkParentToStudentOverWire(parentPToken, studentS2Token, "studentS2");

  // registerUser mints the users row plus the Parent/Student role-child rows,
  // but NEVER a teacher row (that only comes from applicant verification) —
  // the session FK needs one, so teacherT is anchored with the sanctioned
  // single-shared-PK insert (the journey cast helper's precedent).
  await db.insert(teacher).values({ id: teacherT });

  // Two minimal session rows anchor the deep-link read's matrix cells: one
  // owned by the LINKED child (the success + no-link + anonymous/role cells)
  // and one owned by the FOREIGN child (the foreign-session denial arm).
  // teacherT is the owning teacher on both — its role-child row above is the
  // FK anchor. Everything else on the rows is schema defaults.
  const [linkedSessionRow] = await db
    .insert(session)
    .values({ teacherId: teacherT, studentId: studentS })
    .returning({ id: session.id });
  const [foreignSessionRow] = await db
    .insert(session)
    .values({ teacherId: teacherT, studentId: studentF })
    .returning({ id: session.id });
  if (!linkedSessionRow || !foreignSessionRow) {
    throw new Error("failed to seed the wire matrix session rows");
  }
  linkedSessionId = linkedSessionRow.id;
  foreignSessionId = foreignSessionRow.id;
}, 120_000);

afterAll(async () => {
  const fixtureUserIds = actors.map(actor => actor.userId).filter(userId => userId !== adminUserId);
  // FK-safe order: session rows FIRST (session.teacher_id / session.student_id
  // are RESTRICT FKs into teacher / students) → parent_link_requests (RESTRICT
  // FKs to users) → role-child rows → users. The seeded admin's USER row is
  // NEVER deleted. Under PGlite the test process's `db` instance does not
  // share live writes with the warm dev server (single-connection WASM PG) —
  // the deletes here are no-ops in that environment (fixture data accumulates
  // but never collides due to the unique FIXTURE_MARKER); in CI (real
  // Postgres) the deletes run against the shared DB and clean up properly.
  const fixtureSessionIds = [linkedSessionId, foreignSessionId].filter(sessionId => sessionId > 0);
  if (fixtureSessionIds.length > 0) {
    await db.delete(session).where(inArray(session.id, fixtureSessionIds));
  }
  if (seededRequestId > 0) {
    await db.delete(parentLinkRequests).where(eq(parentLinkRequests.id, seededRequestId));
  }
  if (seededSecondRequestId > 0) {
    await db.delete(parentLinkRequests).where(eq(parentLinkRequests.id, seededSecondRequestId));
  }
  if (fixtureUserIds.length > 0) {
    await db.delete(parentLinkRequests).where(inArray(parentLinkRequests.parentId, fixtureUserIds));
    await db.delete(students).where(inArray(students.id, fixtureUserIds));
    await db.delete(applicants).where(inArray(applicants.id, fixtureUserIds));
    await db.delete(teacher).where(inArray(teacher.id, fixtureUserIds));
    await db.delete(parents).where(inArray(parents.id, fixtureUserIds));
    await db.delete(users).where(inArray(users.id, fixtureUserIds));
  }
}, 60_000);

// ─── Matrix: anonymous tier (401) ────────────────────────────────────────────

describe("wire matrix — anonymous tier (credential-less caller × 6 ops)", () => {
  test("myLinkedChildren answers UNAUTHORIZED for anonymous callers", async () => {
    const result = await testClient.query({
      query: gql`
        query MatrixAnonymousLinkedChildren {
          myLinkedChildren {
            id
          }
        }
      `,
      fetchPolicy: "no-cache",
    });
    const error = expectMutationError(result.error, "UNAUTHORIZED");
    expect(error.errors).toHaveLength(1);
  });

  test("parentChildProgress answers UNAUTHORIZED for anonymous callers", async () => {
    const result = await testClient.query({
      query: gql`
        query MatrixAnonymousProgress($studentId: Int!) {
          parentChildProgress(studentId: $studentId) {
            child {
              id
            }
          }
        }
      `,
      variables: { studentId: linkedStudentId || 1 },
      fetchPolicy: "no-cache",
    });
    const error = expectMutationError(result.error, "UNAUTHORIZED");
    expect(error.errors).toHaveLength(1);
  });

  test("parentChildSessions answers UNAUTHORIZED for anonymous callers", async () => {
    const result = await testClient.query({
      query: gql`
        query MatrixAnonymousSessions($studentId: Int!) {
          parentChildSessions(studentId: $studentId) {
            totalCount
          }
        }
      `,
      variables: { studentId: linkedStudentId || 1 },
      fetchPolicy: "no-cache",
    });
    const error = expectMutationError(result.error, "UNAUTHORIZED");
    expect(error.errors).toHaveLength(1);
  });

  test("parentChildReports answers UNAUTHORIZED for anonymous callers", async () => {
    const result = await testClient.query({
      query: gql`
        query MatrixAnonymousReports($studentId: Int!) {
          parentChildReports(studentId: $studentId) {
            totalCount
          }
        }
      `,
      variables: { studentId: linkedStudentId || 1 },
      fetchPolicy: "no-cache",
    });
    const error = expectMutationError(result.error, "UNAUTHORIZED");
    expect(error.errors).toHaveLength(1);
  });

  test("parentChildHomework answers UNAUTHORIZED for anonymous callers", async () => {
    const result = await testClient.query({
      query: gql`
        query MatrixAnonymousHomework($studentId: Int!) {
          parentChildHomework(studentId: $studentId) {
            totalCount
          }
        }
      `,
      variables: { studentId: linkedStudentId || 1 },
      fetchPolicy: "no-cache",
    });
    const error = expectMutationError(result.error, "UNAUTHORIZED");
    expect(error.errors).toHaveLength(1);
  });

  test("parentSessionTarget answers UNAUTHORIZED for anonymous callers", async () => {
    const result = await testClient.query({
      query: gql`
        query MatrixAnonymousSessionTarget($sessionId: Int!) {
          parentSessionTarget(sessionId: $sessionId) {
            studentId
          }
        }
      `,
      variables: { sessionId: linkedSessionId || 1 },
      fetchPolicy: "no-cache",
    });
    const error = expectMutationError(result.error, "UNAUTHORIZED");
    expect(error.errors).toHaveLength(1);
  });

  test("the anonymous denial shape is CONSTANT across all six operations", async () => {
    // Each op rides its own raw-wire request — the single-error envelope per op.
    const bodies = [
      await postAnonymous("{ myLinkedChildren { id } }"),
      await postAnonymous("{ parentChildProgress(studentId: 1) { child { id } } }"),
      await postAnonymous("{ parentChildSessions(studentId: 1) { totalCount } }"),
      await postAnonymous("{ parentChildReports(studentId: 1) { totalCount } }"),
      await postAnonymous("{ parentChildHomework(studentId: 1) { totalCount } }"),
      await postAnonymous("{ parentSessionTarget(sessionId: 1) { studentId } }"),
    ];

    const items = bodies.map(body => expectDenialCode(body, "UNAUTHORIZED"));

    // Same localized copy on ALL six ops — resolved via the locale key, no
    // per-op disclosure.
    for (const item of items.slice(1)) {
      expect(errorMessageOf(item)).toBe(tEn.unauthorized);
      expect(errorMessageOf(item)).toBe(errorMessageOf(items[0]));
    }
    // Each error carries its OWN path (the failing root field)…
    expect(items[0].path).toEqual(["myLinkedChildren"]);
    expect(items[1].path).toEqual(["parentChildProgress"]);
    expect(items[2].path).toEqual(["parentChildSessions"]);
    expect(items[3].path).toEqual(["parentChildReports"]);
    expect(items[4].path).toEqual(["parentChildHomework"]);
    expect(items[5].path).toEqual(["parentSessionTarget"]);
    // …and the same single-item envelope with the same extensions key set.
    for (const item of items.slice(1)) {
      expect(extensionKeysOf(item)).toEqual(extensionKeysOf(items[0]));
    }
  });
});

// ─── Matrix: wrong-role tier (403 — no admin override, BFLA pre-service) ─────

describe("wire matrix — wrong-role tier (admin, teacher, student × 6 ops)", () => {
  test("the FULL wrong-role matrix — 18 cells answer FORBIDDEN with the constant localized shape", async () => {
    const admin = actorByLabel("admin");
    const teacherT = actorByLabel("teacherT");
    const studentS = actorByLabel("studentS");

    // One probe per wrong-role cell: (caller, op). The operations are the
    // six root fields; wrong roles are admin, teacher, and student (parent
    // is the entitled role — it has its own tier below).
    const OPS = [
      "myLinkedChildren",
      "parentChildProgress",
      "parentChildSessions",
      "parentChildReports",
      "parentChildHomework",
      "parentSessionTarget",
    ];
    const CELLS: readonly { readonly caller: { readonly accessToken: string }; readonly op: string }[] = [
      ...OPS.map(op => ({ caller: admin, op })),
      ...OPS.map(op => ({ caller: teacherT, op })),
      ...OPS.map(op => ({ caller: studentS, op })),
    ];
    expect(CELLS).toHaveLength(18);

    const OP_DOCUMENTS: Record<string, { readonly query: string; readonly variables?: Record<string, unknown> }> = {
      myLinkedChildren: { query: "query L { myLinkedChildren { id } }" },
      parentChildProgress: {
        query: "query P($studentId: Int!) { parentChildProgress(studentId: $studentId) { child { id } } }",
        variables: { studentId: linkedStudentId },
      },
      parentChildSessions: {
        query: "query S($studentId: Int!) { parentChildSessions(studentId: $studentId) { totalCount } }",
        variables: { studentId: linkedStudentId },
      },
      parentChildReports: {
        query: "query R($studentId: Int!) { parentChildReports(studentId: $studentId) { totalCount } }",
        variables: { studentId: linkedStudentId },
      },
      parentChildHomework: {
        query: "query H($studentId: Int!) { parentChildHomework(studentId: $studentId) { totalCount } }",
        variables: { studentId: linkedStudentId },
      },
      parentSessionTarget: {
        query: "query T($sessionId: Int!) { parentSessionTarget(sessionId: $sessionId) { studentId } }",
        variables: { sessionId: linkedSessionId },
      },
    };

    const probes = await Promise.all(
      CELLS.map(async cell => {
        const document = OP_DOCUMENTS[cell.op];
        if (!document) {
          throw new Error(`expected an op document for ${cell.op}`);
        }
        return { op: cell.op, body: await postDocument(document.query, cell.caller.accessToken, document.variables) };
      })
    );

    let firstItem: Record<string, unknown> | null = null;
    for (const { op, body } of probes) {
      const item = expectDenialCode(body, "FORBIDDEN");
      // The denial rides the failing root field's path…
      expect(item.path).toEqual([op]);
      // …and the localized copy resolved via the locale key (never hardcoded).
      expect(errorMessageOf(item)).toBe(tEn.forbidden);
      if (firstItem === null) {
        firstItem = item;
      } else {
        // Envelope constancy across ALL cells — no role-specific disclosure.
        expect(errorMessageOf(item)).toBe(errorMessageOf(firstItem));
        expect(extensionKeysOf(item)).toEqual(extensionKeysOf(firstItem));
      }
    }
  });

  test("BFLA — a wrong-role caller's denial is BYTE-IDENTICAL across foreign, zero, and negative studentId values (the scope rejects pre-service)", async () => {
    // The role scope rejects before the resolver body runs, so the
    // `studentId` arg never reaches the service gate. Varying the arg across
    // (a) a foreign id, (b) `0`, (c) `-1` therefore produces BYTE-IDENTICAL
    // FORBIDDEN bodies — the service gate (which WOULD distinguish these
    // cases by emitting different `logDomainError` rows on the server side)
    // never runs. If the scope had let the resolver run, the gate's
    // `requireLinkedChild` would still produce a 403 (these ids are not the
    // caller's own child), but the server-side log row count and the
    // `entityId` field WOULD differ across the three probes — observably
    // distinguishable. The wire response itself stays byte-identical because
    // the gate's denial is constant-shaped; this test pins that
    // wire-level constancy.
    const studentS = actorByLabel("studentS");
    const document = "query B($studentId: Int!) { parentChildProgress(studentId: $studentId) { child { id } } }";

    const bodies = await Promise.all([
      postDocument(document, studentS.accessToken, { studentId: foreignStudentId }),
      postDocument(document, studentS.accessToken, { studentId: 0 }),
      postDocument(document, studentS.accessToken, { studentId: -1 }),
    ]);

    const items = bodies.map(body => expectDenialCode(body, "FORBIDDEN"));
    for (const item of items) {
      expect(item.path).toEqual(["parentChildProgress"]);
      expect(errorMessageOf(item)).toBe(tEn.forbidden);
    }
    // Byte-identical across all three probes (no arg-dependent divergence).
    // The per-request `requestId` UUID is redacted before comparison — it
    // is intentionally unique per request (tracing contract), so the
    // denial-shape comparison normalizes it.
    expect(bodyShapeOf(bodies[1])).toBe(bodyShapeOf(bodies[0]));
    expect(bodyShapeOf(bodies[2])).toBe(bodyShapeOf(bodies[0]));
  });

  test("BFLA — the deep-link read's wrong-role denial is BYTE-IDENTICAL across foreign, zero, and negative sessionId values (zero service invocations)", async () => {
    // Same pre-service proof, session-target edition: the role scope rejects
    // before the resolver body runs, so the `sessionId` argument never
    // reaches the service — the session lookup, the linked-child gate, and
    // the per-cause denial log (whose `entityId` WOULD differ across these
    // probes) are all never invoked. The wire response stays byte-identical
    // across a foreign id, `0`, and `-1`.
    const teacherT = actorByLabel("teacherT");
    const document = SESSION_TARGET_DOCUMENT;

    const bodies = await Promise.all([
      postDocument(document, teacherT.accessToken, { sessionId: linkedSessionId }),
      postDocument(document, teacherT.accessToken, { sessionId: 0 }),
      postDocument(document, teacherT.accessToken, { sessionId: -1 }),
    ]);

    const items = bodies.map(body => expectDenialCode(body, "FORBIDDEN"));
    for (const item of items) {
      expect(item.path).toEqual(["parentSessionTarget"]);
      expect(errorMessageOf(item)).toBe(tEn.forbidden);
    }
    expect(bodyShapeOf(bodies[1])).toBe(bodyShapeOf(bodies[0]));
    expect(bodyShapeOf(bodies[2])).toBe(bodyShapeOf(bodies[0]));
  });

  test("forged-role token — a role-escalated payload spliced into a real token is rejected at token integrity, never trusted as a role", async () => {
    // The parent's REAL access token with `role: "Admin"` spliced into the
    // payload segment and the ORIGINAL signature kept: the signature no
    // longer covers the payload, so verification fails and the context
    // factory treats the caller as anonymous. The response is the 401
    // UNAUTHORIZED denial — NOT a 403 that would mean the forged role was
    // read, and never a 200.
    const parentP = actorByLabel("parentP");
    const forged = forgedRoleTokenOf(parentP.accessToken);
    expect(forged).not.toBe(parentP.accessToken);

    const body = await postDocument(SESSION_TARGET_DOCUMENT, forged, { sessionId: linkedSessionId });
    const item = expectDenialCode(body, "UNAUTHORIZED");
    expect(errorMessageOf(item)).toBe(tEn.unauthorized);
    expect(item.path).toEqual(["parentSessionTarget"]);
  });
});

// ─── Matrix: parent-without-link tier (list → []; details → 403) ─────────────

describe("wire matrix — parent without link (list honest-empty, details FORBIDDEN)", () => {
  test("myLinkedChildren answers 200 with an EMPTY list for a parent with no link", async () => {
    const parentU = actorByLabel("parentU");
    const body = await postDocument(LINKED_CHILDREN_DOCUMENT, parentU.accessToken);
    expect(body.errors).toBeUndefined();
    expect(wireListItemsOf(body, "myLinkedChildren")).toEqual([]);
  });

  test("parentChildProgress answers FORBIDDEN for a parent with no link (constant denial)", async () => {
    const parentU = actorByLabel("parentU");
    const body = await postDocument(CHILD_PROGRESS_DOCUMENT, parentU.accessToken, { studentId: linkedStudentId });
    const item = expectDenialCode(body, "FORBIDDEN");
    expect(item.path).toEqual(["parentChildProgress"]);
    expect(errorMessageOf(item)).toBe(tEn.forbidden);
  });

  test("parentChildSessions answers FORBIDDEN for a parent with no link", async () => {
    const parentU = actorByLabel("parentU");
    const body = await postDocument(CHILD_SESSIONS_DOCUMENT, parentU.accessToken, { studentId: linkedStudentId });
    const item = expectDenialCode(body, "FORBIDDEN");
    expect(item.path).toEqual(["parentChildSessions"]);
    expect(errorMessageOf(item)).toBe(tEn.forbidden);
  });

  test("parentChildReports answers FORBIDDEN for a parent with no link", async () => {
    const parentU = actorByLabel("parentU");
    const body = await postDocument(CHILD_REPORTS_DOCUMENT, parentU.accessToken, { studentId: linkedStudentId });
    const item = expectDenialCode(body, "FORBIDDEN");
    expect(item.path).toEqual(["parentChildReports"]);
    expect(errorMessageOf(item)).toBe(tEn.forbidden);
  });

  test("parentChildHomework answers FORBIDDEN for a parent with no link", async () => {
    const parentU = actorByLabel("parentU");
    const body = await postDocument(CHILD_HOMEWORK_DOCUMENT, parentU.accessToken, { studentId: linkedStudentId });
    const item = expectDenialCode(body, "FORBIDDEN");
    expect(item.path).toEqual(["parentChildHomework"]);
    expect(errorMessageOf(item)).toBe(tEn.forbidden);
  });

  test("parentSessionTarget answers FORBIDDEN for a parent with no link (constant denial)", async () => {
    const parentU = actorByLabel("parentU");
    const body = await postDocument(SESSION_TARGET_DOCUMENT, parentU.accessToken, { sessionId: linkedSessionId });
    const item = expectDenialCode(body, "FORBIDDEN");
    expect(item.path).toEqual(["parentSessionTarget"]);
    expect(errorMessageOf(item)).toBe(tEn.forbidden);
  });
});

// ─── Matrix: parent with link to a FOREIGN child (BOLA — 403 zero data) ─────

describe("wire matrix — parent with link to a foreign child (BOLA — 403 zero data)", () => {
  test("parentP requesting studentF's data answers FORBIDDEN with zero data leakage on every detail op", async () => {
    const parentP = actorByLabel("parentP");
    const documentByOp: { readonly op: string; readonly query: string; readonly variables: Record<string, unknown> }[] =
      [
        { op: "parentChildProgress", query: CHILD_PROGRESS_DOCUMENT, variables: { studentId: foreignStudentId } },
        { op: "parentChildSessions", query: CHILD_SESSIONS_DOCUMENT, variables: { studentId: foreignStudentId } },
        { op: "parentChildReports", query: CHILD_REPORTS_DOCUMENT, variables: { studentId: foreignStudentId } },
        { op: "parentChildHomework", query: CHILD_HOMEWORK_DOCUMENT, variables: { studentId: foreignStudentId } },
        { op: "parentSessionTarget", query: SESSION_TARGET_DOCUMENT, variables: { sessionId: foreignSessionId } },
      ];

    const probes = await Promise.all(
      documentByOp.map(async entry => ({
        op: entry.op,
        body: await postDocument(entry.query, parentP.accessToken, entry.variables),
      }))
    );

    let firstItem: Record<string, unknown> | null = null;
    for (const { op, body } of probes) {
      const item = expectDenialCode(body, "FORBIDDEN");
      expect(item.path).toEqual([op]);
      expect(errorMessageOf(item)).toBe(tEn.forbidden);
      // Zero data leakage: the response body is `data: null` — no child
      // fields, no existence oracle, no per-cause disclosure.
      expect(body.data).toBeNull();
      if (firstItem === null) {
        firstItem = item;
      } else {
        expect(errorMessageOf(item)).toBe(errorMessageOf(firstItem));
        expect(extensionKeysOf(item)).toEqual(extensionKeysOf(firstItem));
      }
    }
  });

  test("parentP's myLinkedChildren list does NOT include the foreign child (no existence oracle)", async () => {
    const parentP = actorByLabel("parentP");
    const body = await postDocument(LINKED_CHILDREN_DOCUMENT, parentP.accessToken);
    expect(body.errors).toBeUndefined();
    const rows = wireListItemsOf(body, "myLinkedChildren");
    const ids = rows.map(row => row.id);
    expect(ids).not.toContain(String(foreignStudentId));
  });
});

// ─── Matrix: parent with link to the requested child (success) ──────────────

describe("wire matrix — parent with link to the requested child (200 with data)", () => {
  test("myLinkedChildren answers 200 with the linked child", async () => {
    const parentP = actorByLabel("parentP");
    const body = await postDocument(LINKED_CHILDREN_DOCUMENT, parentP.accessToken);
    expect(body.errors).toBeUndefined();
    const rows = wireListItemsOf(body, "myLinkedChildren");
    expect(rows.length).toBeGreaterThanOrEqual(1);
    const linkedRow = rows.find(row => row.id === String(linkedStudentId));
    if (!linkedRow) {
      throw new Error("expected the linked child in the wire list");
    }
    expect(stringFieldOf(linkedRow, "fullName")).toBe(actorByLabel("studentS").fullName);
  });

  test("parentChildProgress answers 200 with the composite progress payload (honest empty signals)", async () => {
    const parentP = actorByLabel("parentP");
    const body = await postDocument(CHILD_PROGRESS_DOCUMENT, parentP.accessToken, { studentId: linkedStudentId });
    expect(body.errors).toBeUndefined();
    const data = recordOf(recordOf(body, "expected a body").data, "expected a data object");
    const progressPayload = recordOf(data.parentChildProgress, "expected a progress payload");
    const child = recordOf(progressPayload.child, "expected a child echo");
    expect(stringFieldOf(child, "id")).toBe(String(linkedStudentId));
    // No progress rows seeded — the count is an honest zero, never a fabricated
    // percentage. Both latest positions are null (no homework rows at all).
    const progressRowCount = progressPayload.progressRowCount;
    if (typeof progressRowCount !== "number") {
      throw new Error("expected a numeric progressRowCount");
    }
    expect(progressRowCount).toBe(0);
    expect(progressPayload.latestJadidPosition).toBeNull();
    expect(progressPayload.latestMadiPosition).toBeNull();
  });

  test("parentChildSessions answers 200 with an honest empty page (the sessions-holding child's sibling has none)", async () => {
    const parentP = actorByLabel("parentP");
    // The deep-link fixture seeds ONE session row on the SECOND linked child
    // (the session-target success cell's anchor); studentS's own page stays
    // honestly empty — the arm proves the page wrapper never fabricates rows.
    const body = await postDocument(CHILD_SESSIONS_DOCUMENT, parentP.accessToken, { studentId: secondLinkedStudentId });
    expect(body.errors).toBeUndefined();
    const page = wirePageOf(body, "parentChildSessions");
    expect(page.totalCount).toBe(0);
    expect(page.items).toEqual([]);
    expect(page.page).toBe(1);
    expect(page.pageSize).toBe(25);
  });

  test("parentChildReports answers 200 with an honest empty page (no reports seeded)", async () => {
    const parentP = actorByLabel("parentP");
    const body = await postDocument(CHILD_REPORTS_DOCUMENT, parentP.accessToken, { studentId: linkedStudentId });
    expect(body.errors).toBeUndefined();
    const page = wirePageOf(body, "parentChildReports");
    expect(page.totalCount).toBe(0);
    expect(page.items).toEqual([]);
    expect(page.page).toBe(1);
    expect(page.pageSize).toBe(25);
  });

  test("parentChildHomework answers 200 with an honest empty page (no homework seeded)", async () => {
    const parentP = actorByLabel("parentP");
    const body = await postDocument(CHILD_HOMEWORK_DOCUMENT, parentP.accessToken, { studentId: linkedStudentId });
    expect(body.errors).toBeUndefined();
    const page = wirePageOf(body, "parentChildHomework");
    expect(page.totalCount).toBe(0);
    expect(page.items).toEqual([]);
    expect(page.page).toBe(1);
    expect(page.pageSize).toBe(25);
  });

  test("parentSessionTarget answers 200 with the closed two-field pair for the linked child's own session", async () => {
    const parentP = actorByLabel("parentP");
    const body = await postDocument(SESSION_TARGET_DOCUMENT, parentP.accessToken, { sessionId: linkedSessionId });
    expect(body.errors).toBeUndefined();
    const data = recordOf(recordOf(body, "expected a body").data, "expected a data object");
    const target = recordOf(data.parentSessionTarget, "expected a session-target payload");
    // The closed two-field projection: EXACTLY sessionId + studentId — no
    // id, no session content, no teacher/fee/status fields on the wire.
    expect(Object.keys(target).toSorted((a, b) => a.localeCompare(b))).toEqual(["sessionId", "studentId"]);
    expect(target.sessionId).toBe(linkedSessionId);
    // The student id names the LINKED child — the deep link's landing key.
    expect(target.studentId).toBe(linkedStudentId);
  });
});

// ─── Matrix: BOLA probe (foreign ≡ malformed → constant 403 zero data) ──────

describe("wire matrix — BOLA probe (foreign ≡ malformed studentId → constant 403)", () => {
  /**
   * The gate's constant denial shape: a foreign id, a missing id, and a
   * malformed id (zero, negative) all collapse to the SAME 403 FORBIDDEN
   * body. The caller cannot distinguish the cause — no existence oracle,
   * no per-cause disclosure. Every arm produces `data: null` (zero data
   * leakage) and the SAME localized `forbidden` message.
   */
  test("parentP probing parentChildProgress with foreign, zero, and negative ids answers BYTE-IDENTICAL 403 bodies", async () => {
    const parentP = actorByLabel("parentP");
    const document = CHILD_PROGRESS_DOCUMENT;

    const bodies = await Promise.all([
      postDocument(document, parentP.accessToken, { studentId: foreignStudentId }),
      postDocument(document, parentP.accessToken, { studentId: 0 }),
      postDocument(document, parentP.accessToken, { studentId: -1 }),
      // A nonexistent-but-parser-clean positive id (no row at all).
      postDocument(document, parentP.accessToken, { studentId: 999999999 }),
    ]);

    const items = bodies.map(body => expectDenialCode(body, "FORBIDDEN"));
    for (const item of items) {
      expect(item.path).toEqual(["parentChildProgress"]);
      expect(errorMessageOf(item)).toBe(tEn.forbidden);
      // Zero data leakage on every arm.
      expect(recordOf(items[0], "expected an error item")).toBeTruthy();
    }
    // Byte-identical across ALL four probes (no cause disclosure). The
    // per-request `requestId` UUID is redacted before comparison — it is
    // intentionally unique per request (tracing contract), so the
    // denial-shape comparison normalizes it.
    for (const body of bodies.slice(1)) {
      expect(bodyShapeOf(body)).toBe(bodyShapeOf(bodies[0]));
    }
  });

  test("parentP probing parentChildSessions, parentChildReports, parentChildHomework with a malformed id answers the SAME constant 403", async () => {
    const parentP = actorByLabel("parentP");
    const documents = [
      { op: "parentChildSessions", query: CHILD_SESSIONS_DOCUMENT },
      { op: "parentChildReports", query: CHILD_REPORTS_DOCUMENT },
      { op: "parentChildHomework", query: CHILD_HOMEWORK_DOCUMENT },
    ];

    const probes = await Promise.all(
      documents.map(async entry => ({
        op: entry.op,
        body: await postDocument(entry.query, parentP.accessToken, { studentId: 0 }),
      }))
    );

    for (const { op, body } of probes) {
      const item = expectDenialCode(body, "FORBIDDEN");
      expect(item.path).toEqual([op]);
      expect(errorMessageOf(item)).toBe(tEn.forbidden);
      expect(body.data).toBeNull();
    }
  });
});

// ─── Matrix: session-target oracle + boundary + chaos (deep-link read) ──────

describe("wire matrix — session-target oracle, boundary, and repeated probes", () => {
  test("nonexistent ≡ foreign-session — the deep-link denials are BYTE-IDENTICAL 403 bodies (existence non-disclosure)", async () => {
    const parentP = actorByLabel("parentP");
    // A positive, parser-clean, parser-accepted session id with NO row
    // (below the Int32 bound — above it the wire would reject the literal
    // before any resolver, which is the boundary tier's own cell below).
    const ABSENT_SESSION_ID = 1_999_999_999;

    const bodies = [
      await postDocument(SESSION_TARGET_DOCUMENT, parentP.accessToken, { sessionId: ABSENT_SESSION_ID }),
      await postDocument(SESSION_TARGET_DOCUMENT, parentP.accessToken, { sessionId: foreignSessionId }),
    ];

    const items = bodies.map(body => expectDenialCode(body, "FORBIDDEN"));
    for (const item of items) {
      expect(item.path).toEqual(["parentSessionTarget"]);
      expect(errorMessageOf(item)).toBe(tEn.forbidden);
    }
    // Byte-identical across both causes — a prober cannot distinguish a
    // stale/deleted notification pointer from someone else's session.
    expect(bodyShapeOf(bodies[1])).toBe(bodyShapeOf(bodies[0]));
  });

  test("chaos — repeated denial probes stay BYTE-IDENTICAL (no drift, no per-cause disclosure over time)", async () => {
    const parentP = actorByLabel("parentP");
    const ABSENT_SESSION_ID = 1_999_999_999;
    const PROBE_COUNT = 5;

    // Deliberately SEQUENTIAL probes (chaos-over-time: each probe rides its
    // own request after the previous one landed) via the sanctioned
    // sequential-reduce idiom — the same no-await-in-loop shape the actor
    // registration helper uses.
    const bodies = await Array.from({ length: PROBE_COUNT }).reduce<Promise<Record<string, unknown>[]>>(
      async accumulator => [
        ...(await accumulator),
        await postDocument(SESSION_TARGET_DOCUMENT, parentP.accessToken, { sessionId: ABSENT_SESSION_ID }),
      ],
      Promise.resolve([])
    );

    for (const body of bodies) {
      const item = expectDenialCode(body, "FORBIDDEN");
      expect(item.path).toEqual(["parentSessionTarget"]);
      expect(errorMessageOf(item)).toBe(tEn.forbidden);
    }
    for (const body of bodies.slice(1)) {
      expect(bodyShapeOf(body)).toBe(bodyShapeOf(bodies[0]));
    }
  });

  test("boundary — a non-positive sessionId is a VALIDATION failure (shape, not ownership), zero data", async () => {
    const parentP = actorByLabel("parentP");

    // Zero and negative integers are parser-clean but fail the service's
    // positive-safe-integer guard BEFORE any gate or read — the honest
    // VALIDATION arm, distinct from the constant ownership denial above.
    const bodies = [
      await postDocument(SESSION_TARGET_DOCUMENT, parentP.accessToken, { sessionId: 0 }),
      await postDocument(SESSION_TARGET_DOCUMENT, parentP.accessToken, { sessionId: -1 }),
    ];

    for (const body of bodies) {
      const item = expectDenialCode(body, "VALIDATION");
      expect(item.path).toEqual(["parentSessionTarget"]);
      expect(errorMessageOf(item)).toBe(tEn.validation);
      expect(body.data).toBeNull();
    }
    // Shape-only rejections are cause-blind too: zero and negative answer
    // the same VALIDATION body.
    expect(bodyShapeOf(bodies[1])).toBe(bodyShapeOf(bodies[0]));
  });

  test("boundary — an out-of-range Int sessionId dies at GRAPHQL_VALIDATION_FAILED pre-resolver (the data key is absent)", async () => {
    const parentP = actorByLabel("parentP");

    // 2^31 exceeds the GraphQL Int bound: the literal fails coercion during
    // document validation, so the request never executes — no resolver, no
    // service, no gate (and the `data` key is ABSENT, the parse-time shape).
    const body = await postDocument(
      "{ parentSessionTarget(sessionId: 2147483648) { sessionId studentId } }",
      parentP.accessToken
    );
    expectDenialCode(body, "GRAPHQL_VALIDATION_FAILED", "absent");
  });
});

// ─── Matrix: BOPLA smuggle probes (identity args die pre-resolver) ───────────

describe("wire matrix — BOPLA smuggle probes (smuggled identity args)", () => {
  test("studentId/parentId/userId as extra args on the six fields die as GRAPHQL_VALIDATION_FAILED pre-resolver", async () => {
    const parentP = actorByLabel("parentP");

    const probes = [
      // myLinkedChildren is zero-arg — every identity arg is a smuggle.
      {
        caller: parentP,
        query: "query { myLinkedChildren(studentId: 12345) { id } }",
      },
      {
        caller: parentP,
        query: "query { myLinkedChildren(parentId: 12345) { id } }",
      },
      // parentChildProgress with smuggled identity args alongside the legit studentId.
      {
        caller: parentP,
        query: "query { parentChildProgress(studentId: 1, parentId: 12345) { child { id } } }",
      },
      {
        caller: parentP,
        query: "query { parentChildProgress(studentId: 1, userId: 12345) { child { id } } }",
      },
      // parentChildSessions with smuggled identity args.
      {
        caller: parentP,
        query: "query { parentChildSessions(studentId: 1, parentId: 12345) { totalCount } }",
      },
      {
        caller: parentP,
        query: "query { parentChildSessions(studentId: 1, userId: 12345) { totalCount } }",
      },
      // parentChildReports with smuggled identity args.
      {
        caller: parentP,
        query: "query { parentChildReports(studentId: 1, parentId: 12345) { totalCount } }",
      },
      {
        caller: parentP,
        query: "query { parentChildReports(studentId: 1, userId: 12345) { totalCount } }",
      },
      // parentChildHomework with smuggled identity args.
      {
        caller: parentP,
        query: "query { parentChildHomework(studentId: 1, parentId: 12345) { totalCount } }",
      },
      {
        caller: parentP,
        query: "query { parentChildHomework(studentId: 1, userId: 12345) { totalCount } }",
      },
      // parentSessionTarget with smuggled identity args alongside the legit sessionId.
      {
        caller: parentP,
        query: "query { parentSessionTarget(sessionId: 1, parentId: 12345) { studentId } }",
      },
      {
        caller: parentP,
        query: "query { parentSessionTarget(sessionId: 1, userId: 12345) { studentId } }",
      },
      {
        caller: parentP,
        query: "query { parentSessionTarget(sessionId: 1, studentId: 12345) { studentId } }",
      },
    ];

    const bodies = await Promise.all(probes.map(probe => postDocument(probe.query, probe.caller.accessToken)));
    for (const body of bodies) {
      // The request never executed — the data key is ABSENT from the body.
      expectDenialCode(body, "GRAPHQL_VALIDATION_FAILED", "absent");
    }
  });
});

// ─── Matrix: locale negotiation (denial copy via ctx.t) ──────────────────────

describe("wire matrix — locale negotiation (denial copy localized via Accept-Language)", () => {
  test("en locale — the anonymous and wrong-role denials carry the en copies", async () => {
    const studentS = actorByLabel("studentS");

    // Anonymous denial (UNAUTHORIZED) — en copy via Accept-Language.
    const anonymousBody = await postAnonymous("{ myLinkedChildren { id } }", undefined, {
      "accept-language": "en",
    });
    expect(errorMessageOf(expectDenialCode(anonymousBody, "UNAUTHORIZED"))).toBe(tEn.unauthorized);

    // Wrong-role denial (FORBIDDEN) — en copy via Accept-Language.
    const forbiddenBody = await postDocument(LINKED_CHILDREN_DOCUMENT, studentS.accessToken, undefined, {
      "accept-language": "en",
    });
    expect(errorMessageOf(expectDenialCode(forbiddenBody, "FORBIDDEN"))).toBe(tEn.forbidden);
  });

  test("ar locale — the same denials carry the ar copies (Accept-Language negotiation)", async () => {
    const studentS = actorByLabel("studentS");

    const anonymousBody = await postAnonymous("{ myLinkedChildren { id } }", undefined, {
      "accept-language": "ar",
    });
    expect(errorMessageOf(expectDenialCode(anonymousBody, "UNAUTHORIZED"))).toBe(tAr.unauthorized);
    expect(tAr.unauthorized).not.toBe(tEn.unauthorized);

    const forbiddenBody = await postDocument(LINKED_CHILDREN_DOCUMENT, studentS.accessToken, undefined, {
      "accept-language": "ar",
    });
    expect(errorMessageOf(expectDenialCode(forbiddenBody, "FORBIDDEN"))).toBe(tAr.forbidden);
    expect(tAr.forbidden).not.toBe(tEn.forbidden);
  });

  test("ar locale — the service-gate denial (parent without link) also carries the ar copy", async () => {
    const parentU = actorByLabel("parentU");
    const body = await postDocument(
      CHILD_PROGRESS_DOCUMENT,
      parentU.accessToken,
      { studentId: linkedStudentId },
      { "accept-language": "ar" }
    );
    expect(errorMessageOf(expectDenialCode(body, "FORBIDDEN"))).toBe(tAr.forbidden);
  });

  test("parentSessionTarget — the deep-link denial carries the SAME localized copy in en AND ar (parity)", async () => {
    const parentU = actorByLabel("parentU");

    const enBody = await postDocument(
      SESSION_TARGET_DOCUMENT,
      parentU.accessToken,
      { sessionId: linkedSessionId },
      { "accept-language": "en" }
    );
    const enItem = expectDenialCode(enBody, "FORBIDDEN");
    expect(errorMessageOf(enItem)).toBe(tEn.forbidden);

    const arBody = await postDocument(
      SESSION_TARGET_DOCUMENT,
      parentU.accessToken,
      { sessionId: linkedSessionId },
      { "accept-language": "ar" }
    );
    const arItem = expectDenialCode(arBody, "FORBIDDEN");
    expect(errorMessageOf(arItem)).toBe(tAr.forbidden);
    // Parity is NOT identity: the two locales genuinely differ.
    expect(tAr.forbidden).not.toBe(tEn.forbidden);
  });
});

// ─── Matrix: id-first selections (printed-selections order pin) ──────────────

describe("wire matrix — id-first selections (printed-selections order pin)", () => {
  test("id is the FIRST field of every object selection across the five id-bearing wire documents", () => {
    for (const documentText of [
      LINKED_CHILDREN_DOCUMENT,
      CHILD_PROGRESS_DOCUMENT,
      CHILD_SESSIONS_DOCUMENT,
      CHILD_REPORTS_DOCUMENT,
      CHILD_HOMEWORK_DOCUMENT,
    ]) {
      expectIdFirstInEveryObjectSelection(documentText);
    }
  });

  test("the session-target document pins the closed two-field selection (no id, no over-fetch)", () => {
    const documentNode = parse(SESSION_TARGET_DOCUMENT);
    const fieldNode = documentNode.definitions.flatMap(definition =>
      definition.kind === "OperationDefinition"
        ? definition.selectionSet.selections.filter(
            selection => selection.kind === "Field" && selection.name.value === "parentSessionTarget"
          )
        : []
    );
    expect(fieldNode).toHaveLength(1);
    const target = fieldNode[0];
    if (target?.kind !== "Field" || target.selectionSet === undefined) {
      throw new Error("expected a parentSessionTarget selection with a selection set");
    }
    const selectedNames = target.selectionSet.selections.map(selection =>
      selection.kind === "Field" ? selection.name.value : "<not-a-field>"
    );
    // The exact closed projection: the pair alone — no `id` (the value
    // object carries none), no session content fields, no `__typename`.
    expect(selectedNames).toEqual(["sessionId", "studentId"]);
  });
});
