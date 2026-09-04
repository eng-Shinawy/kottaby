/**
 * Consolidated GraphQL wire matrix — the role × operation × validation tier
 * for the five parent-link root fields (`setupTestServerLifecycle` +
 * `testClient`, raw `fetch` where byte-shape matters).
 *
 * This is the consolidated wire-tier suite over the REAL wire (HTTP → gateway
 * pipeline → scope-auth → resolver → ParentLinkRequestService → PostgreSQL
 * → back), crossing the five parent-link operations with every caller class
 * the permission matrix recognizes:
 *
 *  - `myOutgoingParentLinkRequests` / `myIncomingParentLinkRequests` —
 *    the two zero-arg `[T!]!` lists;
 *  - `requestParentChildLink(code)` — the ONLY nullable new mutation;
 *  - `respondToParentLinkRequest(requestId, accept)` /
 *    `cancelParentLinkRequest(requestId)`.
 *
 * Matrix cells locked down:
 *  - **Anonymous × 5 ops** — every op answers UNAUTHORIZED for
 *    credential-less callers, with a CONSTANT single-error envelope (same
 *    localized copy, per-op `path`, each op carrying only its own path).
 *    The `data` channel follows the GraphQL spec: `data: null` on the four
 *    non-nullable ops, `data: { requestParentChildLink: null }` on the only
 *    nullable new mutation. Complements (never replaces) the in-process
 *    pins: the wire tier proves the transport behavior through the live
 *    gateway.
 *  - **Wrong role × 5 ops (15 cells)** — parent↔student cross-probes BOTH
 *    directions plus teacher and admin on every op answer FORBIDDEN
 *    (pre-resolver `role`-scope denial — there is deliberately
 *    NO admin override on this user-to-user handshake).
 *  - **Governed caller (pre-issued token)** — the denial is the SERVICE
 *    re-check: scope-auth passes on the still-valid JWT, then
 *    `requireActor`'s governance arm throws ForbiddenError — asserted as
 *    `extensions.code === "FORBIDDEN"`, NOT `UNAUTHORIZED`, with zero rows
 *    written. The READ-path divergence (relaxed re-check keeps a governed
 *    actor's self-scoped history visible) is pinned deliberately per the
 *    shipped helpers contract.
 *  - **Payload-wire equality** — wire `myOutgoingParentLinkRequests` ≡ the
 *    `ParentLinkRequestService.listMyOutgoing` oracle field-by-field for a
 *    known fixture (same for the incoming list): ids, statuses (wire enum
 *    names), masked vs full counterparty names, ISO timestamps.
 *  - **requestId fuzz** — `"0"`, `"-1"`, `"1.5"`, `"abc"`, oversized,
 *    whitespace-padded (plus `"12abc"` / `"1e3"` hardening and the numeric
 *    `0` branch) die at the module-local PRE-DB parser
 *    (`/^[1-9]\d*$/` + `isPositiveSafeInt`) with VALIDATION — never a
 *    service error, never 403, never a lazy-parse row hit.
 *  - **BOPLA smuggle probes** — `studentId` / `parentId` / `userId` as
 *    extra args on all three mutations die as GRAPHQL_VALIDATION_FAILED
 *    before any resolver runs (the request never executes: the `data` key
 *    is absent from the body).
 *  - **Nullable collapse** — a well-formed code matching
 *    no eligible student and a governed target answer byte-identical
 *    `data.requestParentChildLink === null` bodies with NO `errors` array,
 *    zero rows created (no existence oracle).
 *  - **Byte shapes** — every list row carries EXACTLY the six canonical
 *    keys (no internal leakage); timestamps are ISO-8601 instants; error
 *    items carry `extensions.code` + a correlated `extensions.requestId`
 *    and NEVER a `stacktrace`.
 *  - **Locale negotiation** — denial copy localized via ctx.t: one en + one
 *    ar assertion per denial class, expected copy resolved through the
 *    locale keys (never hardcoded strings).
 *  - **id-first selections** — the printed form of all five documents pins
 *    `id` as the FIRST field of every object selection.
 *
 * Fixture strategy (3.2/3.3/2.3 conventions):
 *  - Actors ride the PUBLIC `registerUser` mutation over the wire (real
 *    credential path); the admin rides the seeded admin credentials (the
 *    seed's own env-fallback chain) — its USER row is never deleted.
 *  - Student fixtures are registered students, so `students.handshake_code`
 *    exists with the canonical generated shape (asserted).
 *  - History rows are seeded with direct committed inserts; the ONE wire
 *    success path (`requestParentChildLink`) creates its own tracked row
 *    (asserted against the DB + the notification emit, then torn down).
 *  - Governance flags are flipped directly in the DB between probes —
 *    exactly how a suspension lands in production after a token was
 *    issued — and restored within the test that flipped them.
 *  - Teardown in `afterAll` deletes request rows BEFORE users/students
 *    (both `parent_link_requests` FKs are ON DELETE RESTRICT).
 *
 * ENVIRONMENT NOTE (sandbox): the canonical lifecycle helper boots its own
 * dev server on TEST_PORT (3066) when nothing answers there. Where a server
 * already owns the port (booted with the canonical run-server-tests env),
 * the helper's liveness probe succeeds and no second server is spawned (or
 * killed). CI boots the canonical 3066 path.
 *
 * Mandated runner: bun run test/scripts/run-test.ts backend/graphql/test/parent-link.wire.test.ts
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { gql } from "@apollo/client";
import { and, count, eq, inArray } from "drizzle-orm";
import { parse, visit } from "graphql";
import { db } from "@/backend/db";
import { notifications } from "@/backend/db/schema/notifications/notifications";
import { parentLinkRequests } from "@/backend/db/schema/parents/parent-link-requests";
import { parents } from "@/backend/db/schema/parents/parents";
import { students } from "@/backend/db/schema/students/students";
import { applicants } from "@/backend/db/schema/teachers/applicants";
import { users } from "@/backend/db/schema/users/users";
import { LinkStatus } from "@/backend/enum/shared/link-status.enum";
import { ParentLinkRequestService } from "@/backend/services";
import type { IncomingParentLinkRequestReturnType, OutgoingParentLinkRequestReturnType } from "@/backend/types";
import { isHandshakeCode } from "@/shared/constants/handshake-code.constants";
import { PARENT_LINK_REQUEST_MS } from "@/shared/constants/parent-link-request.constants";
import { maskFullName } from "@/shared/lib/mask-full-name";
import { getServerTranslations } from "@/shared/locale/server-graphql";
import { expectMutationError, setupTestServerLifecycle, TEST_PORT, testClient } from "@/test/helpers";

setupTestServerLifecycle();

// ─── Locale-key expected copy (never hardcoded strings — 5.1.SR) ─────────────

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

// ─── Wire helpers ────────────────────────────────────────────────────────────

const GRAPHQL_URL = `http://localhost:${TEST_PORT}/api/graphql`;
const WIRE_CREDENTIAL = "WireMatrix!Pass1";
/** Seeded-admin credentials — the seed's own env-fallback chain. */
const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? "admin@draftacademy.local";
const ADMIN_CREDENTIAL = process.env.ADMIN_PASSWORD ?? "Seed_Pass1!";

const OUTGOING_LIST_DOCUMENT = `
  query WireMatrixOutgoing {
    myOutgoingParentLinkRequests {
      id
      status
      studentMaskedName
      createdAt
      expiresAt
      respondedAt
    }
  }
`;

const INCOMING_LIST_DOCUMENT = `
  query WireMatrixIncoming {
    myIncomingParentLinkRequests {
      id
      status
      parentFullName
      createdAt
      expiresAt
      respondedAt
    }
  }
`;

const REQUEST_LINK_DOCUMENT = `
  mutation WireMatrixRequest($code: String!) {
    requestParentChildLink(code: $code) {
      id
      status
      studentMaskedName
      createdAt
      expiresAt
      respondedAt
    }
  }
`;

const RESPOND_DOCUMENT = `
  mutation WireMatrixRespond($requestId: ID!, $accept: Boolean!) {
    respondToParentLinkRequest(requestId: $requestId, accept: $accept) {
      id
      status
      parentFullName
      createdAt
      expiresAt
      respondedAt
    }
  }
`;

const CANCEL_DOCUMENT = `
  mutation WireMatrixCancel($requestId: ID!) {
    cancelParentLinkRequest(requestId: $requestId) {
      id
      status
      studentMaskedName
      createdAt
      expiresAt
      respondedAt
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
 * and NEVER a stacktrace (no leaked internals). The `data` channel differs
 * by ROOT-FIELD NULLABILITY and execution tier (GraphQL spec behavior):
 *  - `null` — non-nullable root field: the field error nulls the WHOLE data
 *    object (scope/parser/service deaths on the two lists and
 *    respond/cancel — the four `!` ops);
 *  - `fieldNull` — the ONLY nullable new mutation (`requestParentChildLink`):
 *    the error nulls the FIELD, `data` stays an object carrying that null;
 *  - `absent` — the request never executed (smuggled-arg document
 *    validation deaths): the data key is absent from the body entirely.
 */
function expectDenialCode(
  body: Record<string, unknown>,
  expectedCode: string,
  dataMode: "null" | "absent" | "fieldNull" = "null"
): Record<string, unknown> {
  const errorItem = soleErrorItemOf(body);
  expect(errorCodeOf(errorItem)).toBe(expectedCode);
  if (dataMode === "null") {
    expect(body.data).toBeNull();
  } else if (dataMode === "fieldNull") {
    const data = recordOf(body.data, "expected a data object");
    expect(data.requestParentChildLink).toBeNull();
  } else {
    expect(body.data).toBeUndefined();
  }
  const requestId = recordOf(errorItem.extensions, "expected extensions").requestId;
  expect(typeof requestId === "string" && requestId.length > 0).toBe(true);
  expect(JSON.stringify(errorItem)).not.toContain("stacktrace");
  return errorItem;
}

/** Wire list payload, runtime-guarded (the `[T!]!` zero-arg shape). */
function wireRowListOf(body: Record<string, unknown>, field: string): Record<string, unknown>[] {
  const data = recordOf(recordOf(body, "expected a body").data, "expected a data object");
  const rawRows = data[field];
  if (!Array.isArray(rawRows)) {
    throw new Error(`expected an array payload for ${field}`);
  }
  return rawRows.map(row => recordOf(row, "expected record-shaped row entries"));
}

/** The wire `requestParentChildLink` payload (nullable — the ONLY nullable new mutation). */
function wireRequestPayloadOf(body: Record<string, unknown>): Record<string, unknown> | null {
  const data = recordOf(recordOf(body, "expected a body").data, "expected a data object");
  if (data.requestParentChildLink === null) {
    return null;
  }
  return recordOf(data.requestParentChildLink, "expected a record or null requestParentChildLink payload");
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

/** The GraphQL wire NAME of a canonical LinkStatus runtime value. */
function wireStatusNameOf(status: LinkStatus): string {
  const entry = Object.entries(LinkStatus).find(([, value]) => value === status);
  if (entry === undefined) {
    throw new Error(`no wire name for link status ${status}`);
  }
  return entry[0];
}

/** The LinkStatus wire-name inventory, derived from the single enum source. */
const WIRE_STATUS_NAMES = Object.entries(LinkStatus).map(([name]) => name);

/** Runtime-guarded string field off a wire row (no casts, per test-tier discipline). */
function stringFieldOf(row: Record<string, unknown>, key: string): string {
  const value = row[key];
  if (typeof value !== "string") {
    throw new Error(`expected a string ${key} on the wire`);
  }
  return value;
}

// ─── Wire ≡ service-oracle equality helpers ──────────────────────────────────

/** ISO-8601 instant shape (pinned BEFORE parseability — see error-contract-matrix). */
const ISO_8601_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

/** Every list row carries EXACTLY the six canonical keys — zero internal leakage. */
function expectExactRowShape(row: Record<string, unknown>, counterpartyKey: string): void {
  expect(Object.keys(row).toSorted((a, b) => a.localeCompare(b))).toEqual(
    ["createdAt", "expiresAt", "id", "respondedAt", "status", counterpartyKey].toSorted((a, b) => a.localeCompare(b))
  );
  expect(/^\d+$/.test(stringFieldOf(row, "id"))).toBe(true);
  expect(WIRE_STATUS_NAMES).toContain(stringFieldOf(row, "status"));
  expect(ISO_8601_INSTANT.test(stringFieldOf(row, "createdAt"))).toBe(true);
  expect(ISO_8601_INSTANT.test(stringFieldOf(row, "expiresAt"))).toBe(true);
  const respondedAt = row.respondedAt;
  expect(respondedAt === null || ISO_8601_INSTANT.test(stringFieldOf(row, "respondedAt"))).toBe(true);
}

/** Field-by-field wire ≡ service-oracle row equality (outgoing rows). */
function expectWireRowMatchesOutgoingOracle(
  row: Record<string, unknown>,
  oracle: OutgoingParentLinkRequestReturnType
): void {
  expect(row.id).toBe(String(oracle.id));
  expect(row.status).toBe(wireStatusNameOf(oracle.status));
  expect(row.studentMaskedName).toBe(oracle.studentMaskedName);
  expect(row.createdAt).toBe(oracle.createdAt.toISOString());
  expect(row.expiresAt).toBe(oracle.expiresAt.toISOString());
  expect(row.respondedAt).toBe(oracle.respondedAt === null ? null : oracle.respondedAt.toISOString());
}

/** Field-by-field wire ≡ service-oracle row equality (incoming rows). */
function expectWireRowMatchesIncomingOracle(
  row: Record<string, unknown>,
  oracle: IncomingParentLinkRequestReturnType
): void {
  expect(row.id).toBe(String(oracle.id));
  expect(row.status).toBe(wireStatusNameOf(oracle.status));
  expect(row.parentFullName).toBe(oracle.parentFullName);
  expect(row.createdAt).toBe(oracle.createdAt.toISOString());
  expect(row.expiresAt).toBe(oracle.expiresAt.toISOString());
  expect(row.respondedAt).toBe(oracle.respondedAt === null ? null : oracle.respondedAt.toISOString());
}

/** Printed-selections order pin: `id` is the FIRST field of every object selection. */
function expectIdFirstInEveryObjectSelection(documentText: string): void {
  visit(parse(documentText), {
    Field: {
      enter(node) {
        if (node.selectionSet === undefined) {
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

const FIXTURE_MARKER = `plwire-${randomUUID().slice(0, 8)}`;

/** Registers one actor over the wire through the PUBLIC registerUser mutation. */
async function registerActor(label: string, role: "Student" | "Teacher" | "Parent"): Promise<number> {
  const result = await testClient.mutate({
    mutation: gql`
      mutation RegisterParentLinkWireActor($input: RegisterUserInput!) {
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
    throw new Error(`registerUser failed for ${label}`);
  }
  return registeredUserIdOf(result);
}

/** Logs one actor in over the wire and returns the access token. */
async function loginActor(email: string, credential: string): Promise<string> {
  const result = await testClient.mutate({
    mutation: gql`
      mutation LoginParentLinkWireActor($email: String!, $password: String!) {
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

/** Governance flags flipped directly in the DB (post-token-issuance posture). */
interface GovernancePatch {
  readonly suspended?: boolean;
  readonly isBlocked?: boolean;
  readonly isDeleted?: boolean;
}

async function applyGovernanceState(userId: number, patch: GovernancePatch): Promise<void> {
  await db
    .update(users)
    .set({
      suspended: patch.suspended ?? false,
      suspendedAt: patch.suspended ? new Date() : null,
      suspendedPeriodDays: patch.suspended ? 7 : null,
      isBlocked: patch.isBlocked ?? false,
      blockedAt: patch.isBlocked ? new Date() : null,
      isDeleted: patch.isDeleted ?? false,
      deletedAt: patch.isDeleted ? new Date() : null,
    })
    .where(eq(users.id, userId));
}

function actorByLabel(label: string): WireActor {
  const actor = actors.find(candidate => candidate.label === label);
  if (!actor) {
    throw new Error(`expected the ${label} actor fixture`);
  }
  return actor;
}

interface StudentFixture {
  readonly userId: number;
  readonly handshakeCode: string;
}

let actors: WireActor[] = [];
const studentFixtures: Record<string, StudentFixture> = {};
let adminUserId = 0;
let seededRequestId = 0;
let rejectedRequestId = 0;
let wireCreatedRequestId = 0;

beforeAll(async () => {
  // Real registrations through the public mutation (committed users + the
  // students role-child rows with their canonical handshake codes).
  const [parentP, studentS, studentG, studentH, teacherT, governedParent] = await Promise.all([
    registerActor("parentP", "Parent"),
    registerActor("studentS", "Student"),
    registerActor("studentG", "Student"),
    registerActor("studentH", "Student"),
    registerActor("teacherT", "Teacher"),
    registerActor("governedP", "Parent"),
  ]);

  // Real logins — the seeded admin rides its env-fallback credentials.
  const [parentPToken, studentSToken, studentGToken, studentHToken, teacherTToken, governedPToken, adminToken] =
    await Promise.all([
      loginActor(`${FIXTURE_MARKER}-parentP@test.local`, WIRE_CREDENTIAL),
      loginActor(`${FIXTURE_MARKER}-studentS@test.local`, WIRE_CREDENTIAL),
      loginActor(`${FIXTURE_MARKER}-studentG@test.local`, WIRE_CREDENTIAL),
      loginActor(`${FIXTURE_MARKER}-studentH@test.local`, WIRE_CREDENTIAL),
      loginActor(`${FIXTURE_MARKER}-teacherT@test.local`, WIRE_CREDENTIAL),
      loginActor(`${FIXTURE_MARKER}-governedP@test.local`, WIRE_CREDENTIAL),
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
      fullName: `Wire Matrix parentP ${FIXTURE_MARKER}`,
      accessToken: parentPToken,
    },
    {
      label: "studentS",
      userId: studentS,
      fullName: `Wire Matrix studentS ${FIXTURE_MARKER}`,
      accessToken: studentSToken,
    },
    {
      label: "studentG",
      userId: studentG,
      fullName: `Wire Matrix studentG ${FIXTURE_MARKER}`,
      accessToken: studentGToken,
    },
    {
      label: "studentH",
      userId: studentH,
      fullName: `Wire Matrix studentH ${FIXTURE_MARKER}`,
      accessToken: studentHToken,
    },
    {
      label: "teacherT",
      userId: teacherT,
      fullName: `Wire Matrix teacherT ${FIXTURE_MARKER}`,
      accessToken: teacherTToken,
    },
    {
      label: "governedP",
      userId: governedParent,
      fullName: `Wire Matrix governedP ${FIXTURE_MARKER}`,
      accessToken: governedPToken,
    },
    // The seeded admin is NEVER deleted — it only supplies wrong-role cells.
    { label: "admin", userId: adminUserId, fullName: "Seeded Administrator", accessToken: adminToken },
  ];

  // Student fixtures with their generated handshake codes (canonical shape).
  const studentRows = await db
    .select({ id: students.id, handshakeCode: students.handshakeCode })
    .from(students)
    .where(inArray(students.id, [studentS, studentG, studentH]));
  const codeByUserId = new Map(studentRows.map(row => [row.id, row.handshakeCode]));
  for (const label of ["studentS", "studentG", "studentH"]) {
    const fixture = actorByLabel(label);
    const code = codeByUserId.get(fixture.userId);
    if (code === undefined) {
      throw new Error(`expected a students row with a handshake code for ${label}`);
    }
    expect(isHandshakeCode(code)).toBe(true);
    studentFixtures[label] = { userId: fixture.userId, handshakeCode: code };
  }

  // Committed history rows (direct inserts — never the emit surface):
  // one live pending (parentP → studentS) and one post-resolution rejected
  // (parentP → studentG) with a respondedAt to pin the nullable timestamp.
  const now = Date.now();
  const [pendingRow, rejectedRow] = await db
    .insert(parentLinkRequests)
    .values([
      {
        parentId: parentP,
        studentId: studentS,
        status: LinkStatus.Pending,
        createdAt: new Date(now - 60_000),
        expiresAt: new Date(now + 6 * 24 * 60 * 60 * 1000),
      },
      {
        parentId: parentP,
        studentId: studentG,
        status: LinkStatus.Rejected,
        createdAt: new Date(now - 2 * 60 * 60 * 1000),
        expiresAt: new Date(now - 2 * 60 * 60 * 1000 + 7 * 24 * 60 * 60 * 1000),
        respondedAt: new Date(now - 60 * 60 * 1000),
      },
    ])
    .returning();
  seededRequestId = pendingRow.id;
  rejectedRequestId = rejectedRow.id;
}, 120_000);

afterAll(async () => {
  // FK-safe order: request rows (RESTRICT FKs) → notifications → role-child
  // rows → users. The seeded admin's USER row is NEVER deleted.
  const fixtureUserIds = actors.map(actor => actor.userId).filter(userId => userId !== adminUserId);
  const requestIds = [seededRequestId, rejectedRequestId, wireCreatedRequestId].filter(id => id > 0);
  if (requestIds.length > 0) {
    await db.delete(parentLinkRequests).where(inArray(parentLinkRequests.id, requestIds));
  }
  if (fixtureUserIds.length > 0) {
    await db.delete(notifications).where(inArray(notifications.userId, fixtureUserIds));
    await db.delete(students).where(inArray(students.id, fixtureUserIds));
    await db.delete(applicants).where(inArray(applicants.id, fixtureUserIds));
    await db.delete(parents).where(inArray(parents.id, fixtureUserIds));
    await db.delete(users).where(inArray(users.id, fixtureUserIds));
  }
}, 60_000);

// ─── Matrix: anonymous tier (401) ────────────────────────────────────────────

describe("wire matrix — anonymous tier (credential-less caller × 5 ops)", () => {
  test("myOutgoingParentLinkRequests answers UNAUTHORIZED for anonymous callers", async () => {
    const result = await testClient.query({
      query: gql`
        query MatrixAnonymousOutgoing {
          myOutgoingParentLinkRequests {
            id
          }
        }
      `,
      fetchPolicy: "no-cache",
    });
    const error = expectMutationError(result.error, "UNAUTHORIZED");
    expect(error.errors).toHaveLength(1);
  });

  test("myIncomingParentLinkRequests answers UNAUTHORIZED for anonymous callers", async () => {
    const result = await testClient.query({
      query: gql`
        query MatrixAnonymousIncoming {
          myIncomingParentLinkRequests {
            id
          }
        }
      `,
      fetchPolicy: "no-cache",
    });
    const error = expectMutationError(result.error, "UNAUTHORIZED");
    expect(error.errors).toHaveLength(1);
  });

  test("requestParentChildLink answers UNAUTHORIZED for anonymous callers", async () => {
    const result = await testClient.mutate({
      mutation: gql`
        mutation MatrixAnonymousRequest($code: String!) {
          requestParentChildLink(code: $code) {
            id
          }
        }
      `,
      variables: { code: "KSB-00000000" },
    });
    const error = expectMutationError(result.error, "UNAUTHORIZED");
    expect(error.errors).toHaveLength(1);
  });

  test("respondToParentLinkRequest answers UNAUTHORIZED for anonymous callers", async () => {
    const result = await testClient.mutate({
      mutation: gql`
        mutation MatrixAnonymousRespond($requestId: ID!, $accept: Boolean!) {
          respondToParentLinkRequest(requestId: $requestId, accept: $accept) {
            id
          }
        }
      `,
      variables: { requestId: "1", accept: true },
    });
    const error = expectMutationError(result.error, "UNAUTHORIZED");
    expect(error.errors).toHaveLength(1);
  });

  test("cancelParentLinkRequest answers UNAUTHORIZED for anonymous callers", async () => {
    const result = await testClient.mutate({
      mutation: gql`
        mutation MatrixAnonymousCancel($requestId: ID!) {
          cancelParentLinkRequest(requestId: $requestId) {
            id
          }
        }
      `,
      variables: { requestId: "1" },
    });
    const error = expectMutationError(result.error, "UNAUTHORIZED");
    expect(error.errors).toHaveLength(1);
  });

  test("the anonymous denial shape is CONSTANT across all five operations", async () => {
    // Each op rides its own raw-wire request — the single-error envelope per op.
    const bodies = [
      await postAnonymous("{ myOutgoingParentLinkRequests { id } }"),
      await postAnonymous("{ myIncomingParentLinkRequests { id } }"),
      await postAnonymous('mutation { requestParentChildLink(code: "KSB-00000000") { id } }'),
      await postAnonymous('mutation { respondToParentLinkRequest(requestId: "1", accept: true) { id } }'),
      await postAnonymous('mutation { cancelParentLinkRequest(requestId: "1") { id } }'),
    ];

    const items = [
      expectDenialCode(bodies[0], "UNAUTHORIZED"),
      expectDenialCode(bodies[1], "UNAUTHORIZED"),
      // The nullable mutation nulls its FIELD, not the whole data object.
      expectDenialCode(bodies[2], "UNAUTHORIZED", "fieldNull"),
      expectDenialCode(bodies[3], "UNAUTHORIZED"),
      expectDenialCode(bodies[4], "UNAUTHORIZED"),
    ];

    // Same localized copy on ALL five ops — resolved via the locale key, no
    // per-op disclosure.
    for (const item of items.slice(1)) {
      expect(errorMessageOf(item)).toBe(tEn.unauthorized);
      expect(errorMessageOf(item)).toBe(errorMessageOf(items[0]));
    }
    // Each error carries its OWN path (the failing root field)…
    expect(items[0].path).toEqual(["myOutgoingParentLinkRequests"]);
    expect(items[1].path).toEqual(["myIncomingParentLinkRequests"]);
    expect(items[2].path).toEqual(["requestParentChildLink"]);
    expect(items[3].path).toEqual(["respondToParentLinkRequest"]);
    expect(items[4].path).toEqual(["cancelParentLinkRequest"]);
    // …and the same single-item envelope with the same extensions key set.
    for (const item of items.slice(1)) {
      expect(extensionKeysOf(item)).toEqual(extensionKeysOf(items[0]));
    }
  });
});

// ─── Matrix: wrong-role tier (403 — no admin override) ───────────────────

describe("wire matrix — wrong-role tier (parent↔student cross-probes, teacher, admin)", () => {
  test("the FULL wrong-role matrix — 15 cells answer FORBIDDEN with the constant localized shape", async () => {
    const parentP = actorByLabel("parentP");
    const studentS = actorByLabel("studentS");
    const teacherT = actorByLabel("teacherT");
    const admin = actorByLabel("admin");

    // One probe per wrong-role cell: (caller, op). The operations are the
    // five root fields; wrong roles are the sibling role (both directions),
    // teacher, and admin.
    const CELLS: readonly { readonly caller: { readonly accessToken: string }; readonly op: string }[] = [
      { caller: studentS, op: "requestParentChildLink" },
      { caller: studentS, op: "cancelParentLinkRequest" },
      { caller: studentS, op: "myOutgoingParentLinkRequests" },
      { caller: parentP, op: "respondToParentLinkRequest" },
      { caller: parentP, op: "myIncomingParentLinkRequests" },
      ...["requestParentChildLink", "cancelParentLinkRequest", "myOutgoingParentLinkRequests"].map(op => ({
        caller: teacherT,
        op,
      })),
      { caller: teacherT, op: "respondToParentLinkRequest" },
      { caller: teacherT, op: "myIncomingParentLinkRequests" },
      ...["requestParentChildLink", "cancelParentLinkRequest", "myOutgoingParentLinkRequests"].map(op => ({
        caller: admin,
        op,
      })),
      { caller: admin, op: "respondToParentLinkRequest" },
      { caller: admin, op: "myIncomingParentLinkRequests" },
    ];
    expect(CELLS).toHaveLength(15);

    const OP_DOCUMENTS: Record<string, { readonly query: string; readonly variables?: Record<string, unknown> }> = {
      requestParentChildLink: {
        query: "mutation R($code: String!) { requestParentChildLink(code: $code) { id } }",
        variables: { code: "KSB-00000000" },
      },
      respondToParentLinkRequest: {
        query:
          "mutation P($requestId: ID!, $accept: Boolean!) { respondToParentLinkRequest(requestId: $requestId, accept: $accept) { id } }",
        variables: { requestId: "1", accept: true },
      },
      cancelParentLinkRequest: {
        query: "mutation C($requestId: ID!) { cancelParentLinkRequest(requestId: $requestId) { id } }",
        variables: { requestId: "1" },
      },
      myOutgoingParentLinkRequests: { query: "query O { myOutgoingParentLinkRequests { id } }" },
      myIncomingParentLinkRequests: { query: "query I { myIncomingParentLinkRequests { id } }" },
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
      const item = expectDenialCode(body, "FORBIDDEN", op === "requestParentChildLink" ? "fieldNull" : "null");
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

  test("entitled self-role probes ride the same envelope the wrong-role denials answer on (no self-service hole)", async () => {
    // Mirror-image sanity for the 15-cell matrix: each role on its OWN ops
    // succeeds through the same raw-wire path (a scope map with ANY
    // semantics would flip some of these into denials). Read-only cells
    // only — the entitled respond/cancel transitions are journey territory.
    const parentP = actorByLabel("parentP");
    const studentS = actorByLabel("studentS");

    const parentOnParentOps = [await postDocument(OUTGOING_LIST_DOCUMENT, parentP.accessToken)];
    const studentOnStudentOps = [await postDocument(INCOMING_LIST_DOCUMENT, studentS.accessToken)];
    for (const body of parentOnParentOps) {
      expect(body.errors).toBeUndefined();
    }
    for (const body of studentOnStudentOps) {
      expect(body.errors).toBeUndefined();
    }
  });
});

// ─── Matrix: id-first selections (printed-selections order pin) ──────────────

describe("wire matrix — id-first selections (printed-selections order pin)", () => {
  test("id is the FIRST field of every object selection across all five wire documents", () => {
    for (const documentText of [
      OUTGOING_LIST_DOCUMENT,
      INCOMING_LIST_DOCUMENT,
      REQUEST_LINK_DOCUMENT,
      RESPOND_DOCUMENT,
      CANCEL_DOCUMENT,
    ]) {
      expectIdFirstInEveryObjectSelection(documentText);
    }
  });
});

// ─── Matrix: payload-wire equality (wire ≡ service oracle) ───────────────────

describe("wire matrix — payload-wire equality (wire ≡ service oracle)", () => {
  test("wire myOutgoingParentLinkRequests ≡ listMyOutgoing oracle, field-by-field", async () => {
    const parentP = actorByLabel("parentP");
    const oracle = await ParentLinkRequestService.listMyOutgoing(parentP.userId, "en");
    expect(oracle.length).toBeGreaterThanOrEqual(2);

    const body = await postDocument(OUTGOING_LIST_DOCUMENT, parentP.accessToken);
    expect(body.errors).toBeUndefined();
    const rows = wireRowListOf(body, "myOutgoingParentLinkRequests");
    expect(rows.map(row => row.id)).toEqual(oracle.map(oracleRow => String(oracleRow.id)));

    for (const [index, row] of rows.entries()) {
      const oracleRow = oracle[index];
      if (!oracleRow) {
        throw new Error(`expected an oracle row at index ${index}`);
      }
      expectExactRowShape(row, "studentMaskedName");
      expectWireRowMatchesOutgoingOracle(row, oracleRow);
    }

    // The mask contract at the wire: every masked name is the deterministic
    // mask of ONE student fixture's real name — and NEVER a real full name.
    const studentFullNames = ["studentS", "studentG", "studentH"].map(label => actorByLabel(label).fullName);
    const expectedMasks = studentFullNames.map(fullName => maskFullName(fullName));
    for (const row of rows) {
      expect(expectedMasks).toContain(stringFieldOf(row, "studentMaskedName"));
      expect(studentFullNames).not.toContain(stringFieldOf(row, "studentMaskedName"));
    }
  });

  test("wire myIncomingParentLinkRequests ≡ listMyIncoming oracle, field-by-field (full-name disclosure)", async () => {
    const studentS = actorByLabel("studentS");
    const parentP = actorByLabel("parentP");
    const oracle = await ParentLinkRequestService.listMyIncoming(studentS.userId, "en");
    expect(oracle.length).toBeGreaterThanOrEqual(1);

    const body = await postDocument(INCOMING_LIST_DOCUMENT, studentS.accessToken);
    expect(body.errors).toBeUndefined();
    const rows = wireRowListOf(body, "myIncomingParentLinkRequests");
    expect(rows.map(row => row.id)).toEqual(oracle.map(oracleRow => String(oracleRow.id)));

    for (const [index, row] of rows.entries()) {
      const oracleRow = oracle[index];
      if (!oracleRow) {
        throw new Error(`expected an oracle row at index ${index}`);
      }
      expectExactRowShape(row, "parentFullName");
      expectWireRowMatchesIncomingOracle(row, oracleRow);
    }
    // The deciding student sees the parent's FULL name (sanctioned
    // disclosure — the confirmation decision needs identity).
    expect(rows[0]?.parentFullName).toBe(parentP.fullName);
  });
});

// ─── Matrix: nullable collapse (null-collapse contract) ─────────────────────

describe("wire matrix — nullable collapse (missing ≡ governed ≡ non-linkable)", () => {
  test("code miss and governed target both answer null with byte-identical bodies and zero rows", async () => {
    const parentP = actorByLabel("parentP");
    const studentG = actorByLabel("studentG");

    const [before] = await db
      .select({ value: count() })
      .from(parentLinkRequests)
      .where(eq(parentLinkRequests.parentId, parentP.userId));

    // Arm 1 — a well-formed code matching NO eligible student.
    const missBody = await postDocument(REQUEST_LINK_DOCUMENT, parentP.accessToken, { code: "KSB-00000000" });
    expect(missBody.errors).toBeUndefined();
    expect(wireRequestPayloadOf(missBody)).toBeNull();

    // Arm 2 — a real code whose owner is governance-excluded (blocked).
    await applyGovernanceState(studentG.userId, { isBlocked: true });
    try {
      const governedBody = await postDocument(REQUEST_LINK_DOCUMENT, parentP.accessToken, {
        code: studentFixtures.studentG.handshakeCode,
      });
      expect(governedBody.errors).toBeUndefined();
      expect(wireRequestPayloadOf(governedBody)).toBeNull();

      // Missing ≡ governed: byte-identical bodies — no existence oracle.
      expect(JSON.stringify(governedBody)).toBe(JSON.stringify(missBody));
    } finally {
      await applyGovernanceState(studentG.userId, {});
    }

    // Zero rows created across BOTH collapse arms.
    const [after] = await db
      .select({ value: count() })
      .from(parentLinkRequests)
      .where(eq(parentLinkRequests.parentId, parentP.userId));
    expect(after.value).toBe(before.value);
  });
});

// ─── Matrix: success payload shape (the only-nullable mutation's non-null arm) ─

describe("wire matrix — success payload shape (requestParentChildLink non-null arm)", () => {
  test("a live code creates exactly one pending row; wire payload ≡ oracle, exact shape, emit lands", async () => {
    const parentP = actorByLabel("parentP");
    const studentH = actorByLabel("studentH");

    const before = Date.now();
    const body = await postDocument(REQUEST_LINK_DOCUMENT, parentP.accessToken, {
      code: studentFixtures.studentH.handshakeCode,
    });
    const after = Date.now();
    expect(body.errors).toBeUndefined();
    const payload = wireRequestPayloadOf(body);
    if (!payload) {
      throw new Error("expected a NON-null requestParentChildLink payload for a live code");
    }

    // Exact six-key shape + masked-name contract at the wire.
    expectExactRowShape(payload, "studentMaskedName");
    expect(payload.status).toBe("Pending");
    expect(payload.studentMaskedName).toBe(maskFullName(studentH.fullName));
    expect(payload.studentMaskedName).not.toBe(studentH.fullName);
    expect(payload.respondedAt).toBeNull();

    // The created row is tracked for teardown and matches the DB + the
    // 7-day expiry contract (expiresAt = captured now + PARENT_LINK_REQUEST_MS).
    const wireId = payload.id;
    if (typeof wireId !== "string" || !/^\d+$/.test(wireId)) {
      throw new Error("expected a stringified integer id on the wire payload");
    }
    wireCreatedRequestId = Number.parseInt(wireId, 10);
    const [dbRow] = await db
      .select()
      .from(parentLinkRequests)
      .where(eq(parentLinkRequests.id, wireCreatedRequestId))
      .limit(1);
    if (!dbRow) {
      throw new Error("expected the wire-created request row to persist");
    }
    expect(dbRow.parentId).toBe(parentP.userId);
    expect(dbRow.studentId).toBe(studentH.userId);
    expect(dbRow.status).toBe(LinkStatus.Pending);
    expect(dbRow.expiresAt.getTime()).toBeGreaterThanOrEqual(before + PARENT_LINK_REQUEST_MS);
    expect(dbRow.expiresAt.getTime()).toBeLessThanOrEqual(after + PARENT_LINK_REQUEST_MS);

    // The wire payload equals the service oracle for the same row.
    const oracle = await ParentLinkRequestService.listMyOutgoing(parentP.userId, "en");
    const oracleRow = oracle.find(row => row.id === wireCreatedRequestId);
    if (!oracleRow) {
      throw new Error("expected the wire-created row in the service oracle");
    }
    expectWireRowMatchesOutgoingOracle(payload, oracleRow);

    // The in-tx emit landed exactly once for the target student.
    const [emitted] = await db
      .select({ value: count() })
      .from(notifications)
      .where(
        and(eq(notifications.userId, studentH.userId), eq(notifications.relatedEntityType, "parent_link_request"))
      );
    expect(emitted.value).toBe(1);
  });
});

// ─── Matrix: validation tier (pre-DB requestId parser) ───────────────────────

describe("wire matrix — validation tier (pre-DB requestId parser)", () => {
  /** The exact fuzz corpus of the journey tier + the parser's hardening cases. */
  const FUZZ_IDS: readonly string[] = ["0", "-1", "1.5", "abc", "99999999999999999999", " 12", "12abc", "1e3"];

  test("respondToParentLinkRequest fuzz — every hostile id dies as VALIDATION pre-DB (never 403, never a service error)", async () => {
    const studentS = actorByLabel("studentS");
    const bodies = await Promise.all(
      FUZZ_IDS.map(requestId => postDocument(RESPOND_DOCUMENT, studentS.accessToken, { requestId, accept: true }))
    );
    for (const body of bodies) {
      const item = expectDenialCode(body, "VALIDATION");
      expect(item.path).toEqual(["respondToParentLinkRequest"]);
      expect(errorMessageOf(item)).toBe(tEn.validation);
    }
    // The numeric-ID branch of the parser: 0 fails isPositiveSafeInt.
    const zeroNumeric = await postDocument(RESPOND_DOCUMENT, studentS.accessToken, { requestId: 0, accept: true });
    expectDenialCode(zeroNumeric, "VALIDATION");
  });

  test("cancelParentLinkRequest fuzz — every hostile id dies as VALIDATION pre-DB", async () => {
    const parentP = actorByLabel("parentP");
    const bodies = await Promise.all(
      FUZZ_IDS.map(requestId => postDocument(CANCEL_DOCUMENT, parentP.accessToken, { requestId }))
    );
    for (const body of bodies) {
      const item = expectDenialCode(body, "VALIDATION");
      expect(item.path).toEqual(["cancelParentLinkRequest"]);
      expect(errorMessageOf(item)).toBe(tEn.validation);
    }
  });

  test("a lazy-parse id (`<liveRowId>abc`) never addresses the live row — VALIDATION, row byte-identical", async () => {
    const studentS = actorByLabel("studentS");
    const [before] = await db
      .select()
      .from(parentLinkRequests)
      .where(eq(parentLinkRequests.id, seededRequestId))
      .limit(1);
    if (!before) {
      throw new Error("expected the seeded pending row to persist");
    }

    const body = await postDocument(RESPOND_DOCUMENT, studentS.accessToken, {
      requestId: `${seededRequestId}abc`,
      accept: true,
    });
    expectDenialCode(body, "VALIDATION");

    const [after] = await db
      .select()
      .from(parentLinkRequests)
      .where(eq(parentLinkRequests.id, seededRequestId))
      .limit(1);
    expect(JSON.stringify(after)).toBe(JSON.stringify(before));
  });
});

// ─── Matrix: BOPLA smuggle probes (identity args die pre-resolver) ───────────

describe("wire matrix — BOPLA smuggle probes (smuggled identity args)", () => {
  test("studentId/parentId/userId as extra args on all three mutations die as GRAPHQL_VALIDATION_FAILED pre-resolver", async () => {
    const parentP = actorByLabel("parentP");
    const studentS = actorByLabel("studentS");

    const probes = [
      // requestParentChildLink with smuggled identity args (correct-role caller).
      {
        caller: parentP,
        query: 'mutation { requestParentChildLink(code: "KSB-00000000", studentId: 12345) { id } }',
      },
      {
        caller: parentP,
        query: 'mutation { requestParentChildLink(code: "KSB-00000000", userId: 12345) { id } }',
      },
      // respondToParentLinkRequest with smuggled identity args.
      {
        caller: studentS,
        query: 'mutation { respondToParentLinkRequest(requestId: "1", accept: true, parentId: 12345) { id } }',
      },
      {
        caller: studentS,
        query: 'mutation { respondToParentLinkRequest(requestId: "1", accept: true, userId: 12345) { id } }',
      },
      // cancelParentLinkRequest with smuggled identity args.
      {
        caller: parentP,
        query: 'mutation { cancelParentLinkRequest(requestId: "1", studentId: 12345) { id } }',
      },
      {
        caller: parentP,
        query: 'mutation { cancelParentLinkRequest(requestId: "1", parentId: 12345) { id } }',
      },
    ];

    const bodies = await Promise.all(probes.map(probe => postDocument(probe.query, probe.caller.accessToken)));
    for (const body of bodies) {
      // The request never executed — the data key is ABSENT from the body.
      expectDenialCode(body, "GRAPHQL_VALIDATION_FAILED", "absent");
    }
  });
});

// ─── Matrix: governed caller tier (service-layer re-check) ─────────────

describe("wire matrix — governed caller tier (service-layer re-check)", () => {
  test("a governed parent with a PRE-ISSUED token is denied at the SERVICE layer — FORBIDDEN, never UNAUTHORIZED, zero writes", async () => {
    const governedP = actorByLabel("governedP");
    await applyGovernanceState(governedP.userId, { suspended: true });
    try {
      const [before] = await db
        .select({ value: count() })
        .from(parentLinkRequests)
        .where(eq(parentLinkRequests.parentId, governedP.userId));

      // The scope tier passes on the still-valid JWT (authenticated + Parent
      // role) — the denial comes from the service's fresh-read re-check.
      const body = await postDocument(REQUEST_LINK_DOCUMENT, governedP.accessToken, { code: "KSB-00000000" });
      const item = expectDenialCode(body, "FORBIDDEN", "fieldNull");
      expect(item.path).toEqual(["requestParentChildLink"]);
      // NOT the anonymous class — the governed denial rides the SAME
      // constant localized copy as the role arm (no branch disclosure).
      expect(errorMessageOf(item)).toBe(tEn.forbidden);
      expect(errorMessageOf(item)).not.toBe(tEn.unauthorized);

      // Zero-write property of the service denial: it created nothing.
      const [after] = await db
        .select({ value: count() })
        .from(parentLinkRequests)
        .where(eq(parentLinkRequests.parentId, governedP.userId));
      expect(after.value).toBe(before.value);
    } finally {
      await applyGovernanceState(governedP.userId, {});
    }
  });

  test("a governed student with a PRE-ISSUED token is denied at the SERVICE layer on respond — own live row untouched", async () => {
    const studentS = actorByLabel("studentS");
    await applyGovernanceState(studentS.userId, { suspended: true });
    try {
      // The id is well-formed and the row is the caller's OWN live pending —
      // scope-auth and the parser both pass; the governance arm denies.
      const body = await postDocument(RESPOND_DOCUMENT, studentS.accessToken, {
        requestId: String(seededRequestId),
        accept: true,
      });
      const item = expectDenialCode(body, "FORBIDDEN");
      expect(item.path).toEqual(["respondToParentLinkRequest"]);
      expect(errorMessageOf(item)).toBe(tEn.forbidden);
    } finally {
      await applyGovernanceState(studentS.userId, {});
    }

    // The own row stayed byte-identical — zero side-effects on denial.
    const [row] = await db.select().from(parentLinkRequests).where(eq(parentLinkRequests.id, seededRequestId)).limit(1);
    if (!row) {
      throw new Error("expected the seeded pending row to persist");
    }
    expect(row.status).toBe(LinkStatus.Pending);
    expect(row.respondedAt).toBeNull();
  });

  test("the relaxed READ path keeps a governed actor's self-scoped history visible (shipped helpers contract)", async () => {
    // DISCOVERY (pinned deliberately): the parent-link service enforces the
    // governance arm on MUTATIONS only — the read re-check is identity+role
    // (`enforceGovernance: false`), so a governed actor's own request
    // history stays visible to him. This mirrors the shipped behavior
    // documented in `parent-link-request.helpers.ts` (requireActor) and the
    // service header — NOT a leak: the surface is strictly self-scoped.
    const governedP = actorByLabel("governedP");
    await applyGovernanceState(governedP.userId, { suspended: true });
    try {
      const body = await postDocument(OUTGOING_LIST_DOCUMENT, governedP.accessToken);
      expect(body.errors).toBeUndefined();
      expect(wireRowListOf(body, "myOutgoingParentLinkRequests")).toHaveLength(0);
    } finally {
      await applyGovernanceState(governedP.userId, {});
    }
  });
});

// ─── Matrix: locale negotiation (denial copy via ctx.t) ──────────────────────

describe("wire matrix — locale negotiation (denial copy localized via ctx.t)", () => {
  test("en locale — the validation and wrong-role denials carry the en copies", async () => {
    const studentS = actorByLabel("studentS");
    const validationBody = await postDocument(
      RESPOND_DOCUMENT,
      studentS.accessToken,
      { requestId: "abc", accept: true },
      { "accept-language": "en" }
    );
    expect(errorMessageOf(expectDenialCode(validationBody, "VALIDATION"))).toBe(tEn.validation);

    const forbiddenBody = await postDocument(OUTGOING_LIST_DOCUMENT, studentS.accessToken, undefined, {
      "accept-language": "en",
    });
    expect(errorMessageOf(expectDenialCode(forbiddenBody, "FORBIDDEN"))).toBe(tEn.forbidden);
  });

  test("ar locale — the same denials carry the ar copies (Accept-Language negotiation)", async () => {
    const studentS = actorByLabel("studentS");
    const validationBody = await postDocument(
      RESPOND_DOCUMENT,
      studentS.accessToken,
      { requestId: "abc", accept: true },
      { "accept-language": "ar" }
    );
    expect(errorMessageOf(expectDenialCode(validationBody, "VALIDATION"))).toBe(tAr.validation);
    expect(tAr.validation).not.toBe(tEn.validation);

    const forbiddenBody = await postDocument(OUTGOING_LIST_DOCUMENT, studentS.accessToken, undefined, {
      "accept-language": "ar",
    });
    expect(errorMessageOf(expectDenialCode(forbiddenBody, "FORBIDDEN"))).toBe(tAr.forbidden);
    expect(tAr.forbidden).not.toBe(tEn.forbidden);
  });
});
