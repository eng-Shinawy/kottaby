/**
 * Consolidated GraphQL wire matrix — the session-recitation write-once record
 * and its participant-scoped read over the LIVE HTTP stack
 * (`setupTestServerLifecycle` + raw `fetch` where byte-shape matters).
 *
 * This is the consolidated wire-tier suite for the two session-recitation
 * root fields (`sessionRecitation` query — the NULLABLE collapse channel —
 * and `setSessionRecitation` mutation — the non-null write), crossing the
 * live gateway pipeline (HTTP → gateway → scope-auth → resolver →
 * RecitationRecordService → PostgreSQL → finalizer → back) with every caller
 * class the permission matrix recognizes.
 *
 * Matrix cells locked down:
 *  - **Public-operations allowlist hygiene** — neither operation is a member
 *    of the closed anonymous allowlist (exact-match rule, case variants
 *    included), and the anonymous tier below proves both ops refuse to
 *    execute without a session token.
 *  - **Anonymous × 2 ops** — every op answers UNAUTHORIZED for
 *    credential-less callers with the constant single-error envelope; the
 *    data channel follows the GraphQL spec (`data: null` on the non-nullable
 *    mutation, `data: { sessionRecitation: null }` on the nullable query).
 *  - **Wrong role × mutation** — student / parent / admin answer FORBIDDEN
 *    pre-resolver (the `$all { authenticated, role: [Teacher] }` scope
 *    conjunction; no admin bypass). A foreign teacher is deliberately NOT
 *    role-denied: tenancy is the service's oracle-safe collapse, so a
 *    foreign teacher and a nonexistent id answer the byte-identical
 *    SESSION_NOT_FOUND write denial (proved by body equality, not eyeballed).
 *  - **BOPLA smuggle probes** — `userId` / `sessionOwnerId` / `teacherId` as
 *    extra root args OR extra input fields die as GRAPHQL_VALIDATION_FAILED
 *    before any resolver runs (the `data` key is absent from the body).
 *  - **Malformed sessionId wire shapes** — `"0"`, `"-1"`, `"1.5"`, `"abc"`,
 *    `"12abc"` die pre-DB as VALIDATION on the write (never a masked 500);
 *    the same corpus collapses to the identical `null` on the read.
 *  - **Nullable collapse** — a foreign participant, a parent, a malformed id,
 *    a nonexistent id, and an id beyond the int4 session-id ceiling all
 *    answer byte-identical `null` payloads with NO error channel (body
 *    equality over a pinned correlation id — no existence oracle on the
 *    read either).
 *  - **Happy-path wire ≡ service oracle** — the owner's recorded row
 *    serializes field-by-field exactly as `RecitationRecordService`
 *    reports it (stringified ids, ISO-8601 instants, exact six-key row).
 *  - **Repeat-write replay** — the same write replayed WITHOUT any
 *    idempotency header surfaces the typed write-once conflict
 *    (RECITATION_ALREADY_EXISTS); the stored row stays byte-identical and
 *    exactly one row ever exists.
 *  - **Never-happened session** — a record against a scheduled session is
 *    the typed state conflict (RECITATION_SESSION_NOT_WRITEABLE) with zero
 *    rows written.
 *  - **Locale negotiation** — denial copy is localized via the request
 *    locale: one en + one ar assertion per denial class, expected copy
 *    resolved through the locale keys (never hardcoded strings).
 *  - **Int4-ceiling write collapse** — a well-formed id the service's shape
 *    guard deliberately admits but the integer column cannot represent
 *    collapses BEFORE any database read to the byte-identical typed
 *    session-not-found denial: localized (en + ar), correlated via the
 *    request id, no stacktrace, no driver wording, no submitted payload
 *    content, and zero persisted rows (the benign forcing trigger needs no
 *    monkey-patching; the driver-level failure the pre-fix stack answered
 *    with a masked INTERNAL_SERVER_ERROR is no longer reachable on this
 *    surface).
 *  - **Credential hygiene** — response bodies never echo bearer-token
 *    material; every error item carries a correlated requestId and NEVER a
 *    stacktrace.
 *
 * Fixture strategy (journey conventions): a real committed cast (real
 * `users.role` + role-child rows via the `@/test/workflows/helpers` builders)
 * plus two sessions booked over the WIRE under per-run idempotency keys —
 * one started (the recordable target) and one left scheduled (the
 * never-happened target). Identity rides minted-but-real access tokens
 * (the same `signAccessToken` the auth layer issues; the spawned server
 * verifies them with the same env) — nothing is monkey-patched. Every
 * created row is hard-deleted in `afterAll` (recitation rows first, then
 * the registry's FK-safe cast/session teardown).
 *
 * Test-order note: the pre-record read-collapse cells are declared BEFORE
 * the happy-path write and read the target while it carries no record yet;
 * the post-record participant read-back is declared after it. bun:test runs
 * the file's tests in declaration order.
 *
 * ENVIRONMENT NOTE (sandbox): the canonical lifecycle helper boots its own
 * dev server on TEST_PORT (3066) when nothing answers there. Where a server
 * already owns the port, the helper's liveness probe succeeds and no second
 * server is spawned (or killed).
 *
 * Mandated runner: bun run test/scripts/run-test.ts backend/graphql/test/recitation-record.wire.test.ts
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/backend/db";
import { recitation } from "@/backend/db/schema/classes/recitation";
import { SessionStatus } from "@/backend/enum/scheduling/session-status.enum";
import { signAccessToken } from "@/backend/lib/auth/jwt";
import { isPublicOperation } from "@/backend/lib/gateway/public-operations";
import { RecitationRecordService } from "@/backend/services";
import type { RecitationReturnType } from "@/backend/types";
import { getServerTranslations } from "@/shared/locale/server-graphql";
import { setupTestServerLifecycle, TEST_PORT } from "@/test/helpers";
import {
  buildSessionJourneyCast,
  createSessionFixtureRegistry,
  journeyPrefix,
  type SessionJourneyCast,
} from "@/test/workflows/helpers";

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

function requestIdOf(errorItem: Record<string, unknown>): string {
  const requestId = recordOf(errorItem.extensions, "expected extensions").requestId;
  if (typeof requestId !== "string" || requestId.length === 0) {
    throw new Error("expected a non-empty correlated requestId");
  }
  return requestId;
}

/** Runtime-guarded string field off a wire row (no casts, per test-tier discipline). */
function stringFieldOf(row: Record<string, unknown>, key: string): string {
  const value = row[key];
  if (typeof value !== "string") {
    throw new Error(`expected a string ${key} on the wire`);
  }
  return value;
}

// ─── Wire helpers ────────────────────────────────────────────────────────────

const GRAPHQL_URL = `http://localhost:${TEST_PORT}/api/graphql`;
const READ_FIELD = "sessionRecitation";
const WRITE_FIELD = "setSessionRecitation";

const RECITATION_QUERY_DOCUMENT = `
  query WireRecitationRead($sessionId: ID!) {
    sessionRecitation(sessionId: $sessionId) {
      id
      sessionId
      name
      description
      createdAt
      updatedAt
    }
  }
`;

const RECITATION_MUTATION_DOCUMENT = `
  mutation WireRecitationRecord($sessionId: ID!, $input: SessionRecitationInput!) {
    setSessionRecitation(sessionId: $sessionId, input: $input) {
      id
      sessionId
      name
      description
      createdAt
      updatedAt
    }
  }
`;

const CREATE_SESSION_DOCUMENT = `
  mutation WireRecitationBook($input: CreateSessionInput!) {
    createSession(input: $input) {
      id
      status
    }
  }
`;

const START_SESSION_DOCUMENT = `
  mutation WireRecitationStart($id: ID!) {
    startSession(id: $id) {
      id
      status
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
 *  - `null` — the non-nullable mutation: the field error nulls the WHOLE
 *    data object (scope/parser/service deaths on the write);
 *  - `fieldNull` — the nullable query: the error nulls the FIELD, `data`
 *    stays an object carrying that null;
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
    expect(data[READ_FIELD]).toBeNull();
  } else {
    expect(body.data).toBeUndefined();
  }
  expect(requestIdOf(errorItem)).not.toBe("");
  expect(JSON.stringify(errorItem)).not.toContain("stacktrace");
  return errorItem;
}

/** The non-null mutation payload, runtime-guarded. */
function wireWriteRowOf(body: Record<string, unknown>): Record<string, unknown> {
  const data = recordOf(recordOf(body, "expected a body").data, "expected a data object");
  return recordOf(data[WRITE_FIELD], "expected a non-null setSessionRecitation payload");
}

/** The nullable query payload — `null` is a first-class answer (the collapse channel). */
function wireReadRowOf(body: Record<string, unknown>): Record<string, unknown> | null {
  const data = recordOf(recordOf(body, "expected a body").data, "expected a data object");
  if (data[READ_FIELD] === null) {
    return null;
  }
  return recordOf(data[READ_FIELD], "expected a record or null sessionRecitation payload");
}

// ─── Payload-shape and oracle-equality helpers ───────────────────────────────

/** ISO-8601 instant shape (pinned BEFORE parseability — see error-contract-matrix). */
const ISO_8601_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

/** The GraphQL wire NAME of a canonical SessionStatus runtime value. */
function wireStatusNameOf(status: SessionStatus): string {
  const entry = Object.entries(SessionStatus).find(([, value]) => value === status);
  if (entry === undefined) {
    throw new Error(`no wire name for session status ${status}`);
  }
  return entry[0];
}

/** The wire row carries EXACTLY the six canonical keys — zero internal leakage. */
function expectCanonicalRecitationRow(
  row: Record<string, unknown>,
  expectedSessionId: string,
  expectedName: string,
  expectedDescription: string | null
): void {
  expect(Object.keys(row).toSorted((a, b) => a.localeCompare(b))).toEqual([
    "createdAt",
    "description",
    "id",
    "name",
    "sessionId",
    "updatedAt",
  ]);
  expect(/^\d+$/.test(stringFieldOf(row, "id"))).toBe(true);
  expect(stringFieldOf(row, "sessionId")).toBe(expectedSessionId);
  expect(stringFieldOf(row, "name")).toBe(expectedName);
  expect(row.description).toBe(expectedDescription);
  expect(ISO_8601_INSTANT.test(stringFieldOf(row, "createdAt"))).toBe(true);
  expect(ISO_8601_INSTANT.test(stringFieldOf(row, "updatedAt"))).toBe(true);
}

/** Field-by-field wire ≡ service-oracle row equality. */
function expectWireRowMatchesOracle(row: Record<string, unknown>, oracle: RecitationReturnType): void {
  expect(row.id).toBe(String(oracle.id));
  expect(row.sessionId).toBe(String(oracle.sessionId));
  expect(row.name).toBe(oracle.name);
  expect(row.description).toBe(oracle.description);
  expect(row.createdAt).toBe(oracle.createdAt.toISOString());
  expect(row.updatedAt).toBe(oracle.updatedAt.toISOString());
}

// ─── Harness state ───────────────────────────────────────────────────────────

/** Per-run prefix — unique cast labels AND idempotency keys per suite run. */
const PREFIX = journeyPrefix("recwire");

/** The fixture registry — every created session/cast row is hard-deleted in afterAll. */
const registry = createSessionFixtureRegistry();

/** The submission payload the happy path records (and the replay replays). */
const RECORD_NAME = `Wire record ${PREFIX}`;
const RECORD_DESCRIPTION = "Recorded through the live HTTP stack";

/** The first id beyond the session/recitation integer columns' int4 range. */
const OVERFLOW_SESSION_ID = "2147483648";

let cast: SessionJourneyCast;
let ownerToken = "";
let secondTeacherToken = "";
let studentToken = "";
let parentToken = "";
let adminToken = "";
let startedSessionId = "";
let scheduledSessionId = "";
/** Byte-snapshot of the persisted record row (replay + masking rollback proofs). */
let recordedRowSnapshot = "";

/** Mints a REAL access token for a cast user (verified by the live server). */
async function tokenFor(userId: number, role: string): Promise<string> {
  return signAccessToken({ userId, role });
}

/** Books one happy-path session over the wire under a UNIQUE idempotency key. */
async function bookSession(accessToken: string, idempotencyKey: string, teacherId: number): Promise<string> {
  const body = await postDocument(
    CREATE_SESSION_DOCUMENT,
    accessToken,
    { input: { teacherId, intent: "Hifz" } },
    { "x-idempotency-key": idempotencyKey }
  );
  if (body.errors !== undefined) {
    throw new Error("fixture booking over the wire failed");
  }
  const data = recordOf(body.data, "expected booking data");
  return stringFieldOf(recordOf(data.createSession, "expected a createSession payload"), "id");
}

/** Starts one booked session over the wire as its owning teacher. */
async function startSessionFixture(accessToken: string, sessionId: string): Promise<void> {
  const body = await postDocument(START_SESSION_DOCUMENT, accessToken, { id: sessionId });
  if (body.errors !== undefined) {
    throw new Error("fixture startSession over the wire failed");
  }
  const data = recordOf(body.data, "expected startSession data");
  const row = recordOf(data.startSession, "expected a startSession payload");
  expect(stringFieldOf(row, "status")).toBe(wireStatusNameOf(SessionStatus.Started));
}

/** The canonical write variables for one target session. */
function recordVariablesFor(sessionId: string, name: string, description: string | null): Record<string, unknown> {
  return { sessionId, input: { name, description } };
}

// ─── Fixtures (committed cast + wire-booked lifecycle targets) ───────────────

beforeAll(async () => {
  // Committed cast — the primary student is funded for TWO net bookings (the
  // trial lane drains first, then the hifz lane, exactly like the lifecycle
  // journeys); the certified teacher owns both targets; the second certified
  // teacher is the non-participant observer.
  await db.transaction(async tx => {
    cast = await buildSessionJourneyCast(tx, registry, {
      prefix: PREFIX,
      primaryStudent: { trial: 1, hifz: 1 },
    });
  });

  // Real access tokens for every actor (same signer the auth layer uses).
  [ownerToken, secondTeacherToken, studentToken, parentToken, adminToken] = await Promise.all([
    tokenFor(cast.teacher.userId, cast.teacher.user.role),
    tokenFor(cast.secondTeacher.userId, cast.secondTeacher.user.role),
    tokenFor(cast.primaryStudent.userId, cast.primaryStudent.user.role),
    tokenFor(cast.parent.userId, cast.parent.user.role),
    tokenFor(cast.admin.userId, cast.admin.user.role),
  ]);

  // Book the two targets under DISTINCT per-run keys (sequential — lane order
  // matters), then start exactly one: the recordable target. The other stays
  // scheduled — the never-happened target.
  startedSessionId = await bookSession(studentToken, `${PREFIX}-key-started`, cast.teacher.userId);
  registry.track("session", Number(startedSessionId));
  scheduledSessionId = await bookSession(studentToken, `${PREFIX}-key-scheduled`, cast.teacher.userId);
  registry.track("session", Number(scheduledSessionId));

  await startSessionFixture(ownerToken, startedSessionId);
}, 240_000);

afterAll(async () => {
  // FK-safe order: the record rows first (they cascade on session deletion —
  // the explicit delete is the belt-and-braces first pass), then the
  // registry's child-table-first teardown of sessions + the whole cast.
  const trackedSessionIds = [...registry.ids("session")];
  if (trackedSessionIds.length > 0) {
    await db.delete(recitation).where(inArray(recitation.sessionId, trackedSessionIds));
  }
  await registry.cleanup();
}, 60_000);

// ─── Matrix: public-operations allowlist hygiene ─────────────────────────────

describe("wire matrix — public-operations allowlist hygiene", () => {
  test("neither operation is a member of the closed anonymous allowlist (exact-match rule)", () => {
    expect(isPublicOperation(WRITE_FIELD)).toBe(false);
    expect(isPublicOperation(READ_FIELD)).toBe(false);
    expect(isPublicOperation("SetSessionRecitation")).toBe(false);
    expect(isPublicOperation("SessionRecitation")).toBe(false);
  });
});

// ─── Matrix: anonymous tier (401) ────────────────────────────────────────────

describe("wire matrix — anonymous tier (credential-less caller × 2 ops)", () => {
  test("anonymous setSessionRecitation answers UNAUTHORIZED (data nulled)", async () => {
    const body = await postAnonymous(
      RECITATION_MUTATION_DOCUMENT,
      recordVariablesFor(startedSessionId, RECORD_NAME, null)
    );
    const item = expectDenialCode(body, "UNAUTHORIZED");
    expect(item.path).toEqual([WRITE_FIELD]);
  });

  test("anonymous sessionRecitation answers UNAUTHORIZED (field-nulled)", async () => {
    const body = await postAnonymous(RECITATION_QUERY_DOCUMENT, { sessionId: startedSessionId });
    const item = expectDenialCode(body, "UNAUTHORIZED", "fieldNull");
    expect(item.path).toEqual([READ_FIELD]);
  });

  test("the anonymous denial shape is CONSTANT across both operations", async () => {
    const mutationBody = await postAnonymous(
      RECITATION_MUTATION_DOCUMENT,
      recordVariablesFor(startedSessionId, RECORD_NAME, null)
    );
    const queryBody = await postAnonymous(RECITATION_QUERY_DOCUMENT, { sessionId: startedSessionId });
    const mutationItem = soleErrorItemOf(mutationBody);
    const queryItem = soleErrorItemOf(queryBody);
    expect(errorCodeOf(mutationItem)).toBe(errorCodeOf(queryItem));
    expect(errorMessageOf(mutationItem)).toBe(errorMessageOf(queryItem));
    expect(requestIdOf(mutationItem)).not.toBe("");
    expect(requestIdOf(queryItem)).not.toBe("");
  });
});

// ─── Matrix: wrong-role tier (pre-resolver scope matrix) ─────────────────────

describe("wire matrix — wrong-role tier (student / parent / admin on the write)", () => {
  test("student setSessionRecitation → FORBIDDEN (pre-resolver scope)", async () => {
    const body = await postDocument(
      RECITATION_MUTATION_DOCUMENT,
      studentToken,
      recordVariablesFor(startedSessionId, RECORD_NAME, null)
    );
    const item = expectDenialCode(body, "FORBIDDEN");
    expect(item.path).toEqual([WRITE_FIELD]);
  });

  test("parent setSessionRecitation → FORBIDDEN (pre-resolver scope)", async () => {
    const body = await postDocument(
      RECITATION_MUTATION_DOCUMENT,
      parentToken,
      recordVariablesFor(startedSessionId, RECORD_NAME, null)
    );
    const item = expectDenialCode(body, "FORBIDDEN");
    expect(item.path).toEqual([WRITE_FIELD]);
  });

  test("admin setSessionRecitation → FORBIDDEN (no bypass)", async () => {
    const body = await postDocument(
      RECITATION_MUTATION_DOCUMENT,
      adminToken,
      recordVariablesFor(startedSessionId, RECORD_NAME, null)
    );
    const item = expectDenialCode(body, "FORBIDDEN");
    expect(item.path).toEqual([WRITE_FIELD]);
  });

  test("a foreign teacher is NOT role-denied — tenancy is the service collapse (SESSION_NOT_FOUND)", async () => {
    const body = await postDocument(
      RECITATION_MUTATION_DOCUMENT,
      secondTeacherToken,
      recordVariablesFor(startedSessionId, RECORD_NAME, null)
    );
    const item = expectDenialCode(body, "SESSION_NOT_FOUND");
    expect(item.path).toEqual([WRITE_FIELD]);
  });
});

// ─── Matrix: write-denial tenancy collapse (foreign ≡ nonexistent) ───────────

describe("wire matrix — write-denial tenancy collapse (foreign ≡ nonexistent, byte-identical)", () => {
  test("a foreign teacher's denial and a nonexistent id's denial are byte-identical bodies", async () => {
    const correlationId = "wire-recitation-write-collapse";
    const foreignBody = await postDocument(
      RECITATION_MUTATION_DOCUMENT,
      secondTeacherToken,
      recordVariablesFor(startedSessionId, RECORD_NAME, null),
      { "x-request-id": correlationId }
    );
    const missingBody = await postDocument(
      RECITATION_MUTATION_DOCUMENT,
      ownerToken,
      recordVariablesFor("999999999", RECORD_NAME, null),
      { "x-request-id": correlationId }
    );
    expect(errorCodeOf(soleErrorItemOf(foreignBody))).toBe("SESSION_NOT_FOUND");
    expect(errorCodeOf(soleErrorItemOf(missingBody))).toBe("SESSION_NOT_FOUND");
    expect(JSON.stringify(foreignBody)).toBe(JSON.stringify(missingBody));
  });
});

// ─── Matrix: BOPLA smuggle probes (identity args die pre-resolver) ───────────

describe("wire matrix — BOPLA smuggle probes (smuggled identity args and input fields)", () => {
  test("userId/sessionOwnerId/teacherId as root args OR input fields die as GRAPHQL_VALIDATION_FAILED", async () => {
    const probes: readonly string[] = [
      `mutation { ${WRITE_FIELD}(sessionId: "1", input: { name: "x" }, userId: 12345) { id } }`,
      `mutation { ${WRITE_FIELD}(sessionId: "1", input: { name: "x" }, sessionOwnerId: 12345) { id } }`,
      `mutation { ${WRITE_FIELD}(sessionId: "1", input: { name: "x" }, teacherId: 12345) { id } }`,
      `mutation { ${WRITE_FIELD}(sessionId: "1", input: { name: "x", userId: 12345 }) { id } }`,
      `mutation { ${WRITE_FIELD}(sessionId: "1", input: { name: "x", sessionOwnerId: 12345 }) { id } }`,
      `mutation { ${WRITE_FIELD}(sessionId: "1", input: { name: "x", teacherId: 12345 }) { id } }`,
    ];
    const bodies = await Promise.all(probes.map(probe => postDocument(probe, ownerToken)));
    for (const body of bodies) {
      // The request never executed — the data key is ABSENT from the body.
      expectDenialCode(body, "GRAPHQL_VALIDATION_FAILED", "absent");
    }
  });
});

// ─── Matrix: malformed sessionId tier (pre-DB shape guard) ───────────────────

describe("wire matrix — malformed sessionId tier (pre-DB VALIDATION on the write, null on the read)", () => {
  /** The hostile-id corpus: non-positive, fractional, NaN, and lazy-parse shapes. */
  const FUZZ_IDS: readonly string[] = ["0", "-1", "1.5", "abc", "12abc"];

  test("every hostile id dies as VALIDATION pre-DB on the write (never a masked 500)", async () => {
    const bodies = await Promise.all(
      FUZZ_IDS.map(sessionId =>
        postDocument(RECITATION_MUTATION_DOCUMENT, ownerToken, recordVariablesFor(sessionId, RECORD_NAME, null))
      )
    );
    for (const body of bodies) {
      const item = expectDenialCode(body, "VALIDATION");
      expect(item.path).toEqual([WRITE_FIELD]);
      expect(errorMessageOf(item)).toBe(tEn.validation);
    }
  });

  test("the same hostile corpus collapses to the identical null on the read (no error channel)", async () => {
    const bodies = await Promise.all(
      FUZZ_IDS.map(sessionId => postDocument(RECITATION_QUERY_DOCUMENT, ownerToken, { sessionId }))
    );
    for (const body of bodies) {
      expect(body.errors).toBeUndefined();
      expect(wireReadRowOf(body)).toBeNull();
    }
  });
});

// ─── Matrix: nullable collapse tier (read, pre-record) ───────────────────────

describe("wire matrix — nullable collapse tier (read, pre-record)", () => {
  test("the owner reads the started session as null while it carries no record", async () => {
    const body = await postDocument(RECITATION_QUERY_DOCUMENT, ownerToken, { sessionId: startedSessionId });
    expect(body.errors).toBeUndefined();
    expect(wireReadRowOf(body)).toBeNull();
  });

  test("a foreign teacher, a parent, and a nonexistent id all answer the same null", async () => {
    const foreignBody = await postDocument(RECITATION_QUERY_DOCUMENT, secondTeacherToken, {
      sessionId: startedSessionId,
    });
    const parentBody = await postDocument(RECITATION_QUERY_DOCUMENT, parentToken, { sessionId: startedSessionId });
    const missingBody = await postDocument(RECITATION_QUERY_DOCUMENT, ownerToken, { sessionId: "999999999" });
    for (const body of [foreignBody, parentBody, missingBody]) {
      expect(body.errors).toBeUndefined();
      expect(wireReadRowOf(body)).toBeNull();
    }
  });

  test("an id beyond the int4 session-id ceiling collapses to the same null (no error channel)", async () => {
    const bodies = await Promise.all(
      [OVERFLOW_SESSION_ID, "4294967296"].map(sessionId =>
        postDocument(RECITATION_QUERY_DOCUMENT, ownerToken, { sessionId })
      )
    );
    for (const body of bodies) {
      expect(body.errors).toBeUndefined();
      expect(wireReadRowOf(body)).toBeNull();
    }
  });

  test("foreign session and nonexistent session answer byte-identical null bodies (no existence oracle)", async () => {
    const correlationId = "wire-recitation-read-collapse";
    const foreignBody = await postDocument(
      RECITATION_QUERY_DOCUMENT,
      secondTeacherToken,
      { sessionId: startedSessionId },
      { "x-request-id": correlationId }
    );
    const missingBody = await postDocument(
      RECITATION_QUERY_DOCUMENT,
      ownerToken,
      { sessionId: "999999999" },
      { "x-request-id": correlationId }
    );
    expect(wireReadRowOf(foreignBody)).toBeNull();
    expect(wireReadRowOf(missingBody)).toBeNull();
    expect(foreignBody.errors).toBeUndefined();
    expect(missingBody.errors).toBeUndefined();
    expect(JSON.stringify(foreignBody)).toBe(JSON.stringify(missingBody));
  });
});

// ─── Matrix: happy path (wire ≡ service oracle) ──────────────────────────────

describe("wire matrix — happy path (owner records a started session; wire ≡ service oracle)", () => {
  test("the wire-created record matches the service oracle field-by-field with the exact row shape", async () => {
    const sessionIdNumber = Number(startedSessionId);
    const beforeCount = await db.$count(recitation, eq(recitation.sessionId, sessionIdNumber));

    const body = await postDocument(
      RECITATION_MUTATION_DOCUMENT,
      ownerToken,
      recordVariablesFor(startedSessionId, RECORD_NAME, RECORD_DESCRIPTION)
    );
    expect(body.errors).toBeUndefined();
    const row = wireWriteRowOf(body);
    expectCanonicalRecitationRow(row, startedSessionId, RECORD_NAME, RECORD_DESCRIPTION);

    const oracle = await RecitationRecordService.getSessionRecitation(cast.teacher.userId, sessionIdNumber);
    if (!oracle) {
      throw new Error("expected the service oracle to see the persisted record");
    }
    expectWireRowMatchesOracle(row, oracle);

    // Exactly ONE row exists for the session, and its byte-snapshot is kept
    // for the replay and masking rollback proofs.
    const afterCount = await db.$count(recitation, eq(recitation.sessionId, sessionIdNumber));
    expect(afterCount).toBe(beforeCount + 1);
    const [dbRow] = await db.select().from(recitation).where(eq(recitation.sessionId, sessionIdNumber)).limit(1);
    if (!dbRow) {
      throw new Error("expected the persisted recitation row");
    }
    recordedRowSnapshot = JSON.stringify(dbRow);
  });
});

// ─── Matrix: repeat-write replay (write-once arbiter, no idempotency key) ────

describe("wire matrix — repeat-write replay (typed conflict without any idempotency key)", () => {
  test("the same write replayed answers RECITATION_ALREADY_EXISTS and the stored row stays byte-identical", async () => {
    const body = await postDocument(
      RECITATION_MUTATION_DOCUMENT,
      ownerToken,
      recordVariablesFor(startedSessionId, RECORD_NAME, RECORD_DESCRIPTION)
    );
    const item = expectDenialCode(body, "RECITATION_ALREADY_EXISTS");
    expect(item.path).toEqual([WRITE_FIELD]);
    expect(errorMessageOf(item)).toBe(tEn.recitationAlreadyExists);

    const [after] = await db
      .select()
      .from(recitation)
      .where(eq(recitation.sessionId, Number(startedSessionId)))
      .limit(1);
    if (!after) {
      throw new Error("expected the recorded row to persist untouched");
    }
    expect(JSON.stringify(after)).toBe(recordedRowSnapshot);
    expect(await db.$count(recitation, eq(recitation.sessionId, Number(startedSessionId)))).toBe(1);
  });
});

// ─── Matrix: never-happened session (state conflict, zero rows) ──────────────

describe("wire matrix — never-happened session (scheduled target answers the state conflict)", () => {
  test("recording a scheduled session answers RECITATION_SESSION_NOT_WRITEABLE with zero rows written", async () => {
    const body = await postDocument(
      RECITATION_MUTATION_DOCUMENT,
      ownerToken,
      recordVariablesFor(scheduledSessionId, RECORD_NAME, null)
    );
    const item = expectDenialCode(body, "RECITATION_SESSION_NOT_WRITEABLE");
    expect(item.path).toEqual([WRITE_FIELD]);
    expect(errorMessageOf(item)).toBe(tEn.recitationSessionNotWriteable);
    expect(await db.$count(recitation, eq(recitation.sessionId, Number(scheduledSessionId)))).toBe(0);
  });
});

// ─── Matrix: participant read-back (post-record) ─────────────────────────────

describe("wire matrix — participant read-back (post-record)", () => {
  test("the session's student (participant) reads the recorded row — wire ≡ oracle", async () => {
    const body = await postDocument(RECITATION_QUERY_DOCUMENT, studentToken, { sessionId: startedSessionId });
    expect(body.errors).toBeUndefined();
    const row = wireReadRowOf(body);
    if (!row) {
      throw new Error("expected the participant read to surface the record");
    }
    expectCanonicalRecitationRow(row, startedSessionId, RECORD_NAME, RECORD_DESCRIPTION);
    const oracle = await RecitationRecordService.getSessionRecitation(
      cast.primaryStudent.userId,
      Number(startedSessionId)
    );
    if (!oracle) {
      throw new Error("expected the service oracle to see the persisted record");
    }
    expectWireRowMatchesOracle(row, oracle);
  });
});

// ─── Matrix: locale negotiation (denial copy via the request locale) ─────────

describe("wire matrix — locale negotiation (denial copy via the request locale)", () => {
  test("en locale — the two recitation conflicts carry the en copies", async () => {
    const replayBody = await postDocument(
      RECITATION_MUTATION_DOCUMENT,
      ownerToken,
      recordVariablesFor(startedSessionId, RECORD_NAME, RECORD_DESCRIPTION),
      { "accept-language": "en" }
    );
    expect(errorMessageOf(expectDenialCode(replayBody, "RECITATION_ALREADY_EXISTS"))).toBe(tEn.recitationAlreadyExists);

    const conflictBody = await postDocument(
      RECITATION_MUTATION_DOCUMENT,
      ownerToken,
      recordVariablesFor(scheduledSessionId, RECORD_NAME, null),
      { "accept-language": "en" }
    );
    expect(errorMessageOf(expectDenialCode(conflictBody, "RECITATION_SESSION_NOT_WRITEABLE"))).toBe(
      tEn.recitationSessionNotWriteable
    );
  });

  test("ar locale — the same conflicts carry the ar copies (Accept-Language negotiation)", async () => {
    const replayBody = await postDocument(
      RECITATION_MUTATION_DOCUMENT,
      ownerToken,
      recordVariablesFor(startedSessionId, RECORD_NAME, RECORD_DESCRIPTION),
      { "accept-language": "ar" }
    );
    expect(errorMessageOf(expectDenialCode(replayBody, "RECITATION_ALREADY_EXISTS"))).toBe(tAr.recitationAlreadyExists);
    expect(tAr.recitationAlreadyExists).not.toBe(tEn.recitationAlreadyExists);

    const conflictBody = await postDocument(
      RECITATION_MUTATION_DOCUMENT,
      ownerToken,
      recordVariablesFor(scheduledSessionId, RECORD_NAME, null),
      { "accept-language": "ar" }
    );
    expect(errorMessageOf(expectDenialCode(conflictBody, "RECITATION_SESSION_NOT_WRITEABLE"))).toBe(
      tAr.recitationSessionNotWriteable
    );
    expect(tAr.recitationSessionNotWriteable).not.toBe(tEn.recitationSessionNotWriteable);
  });
});

// ─── Matrix: int4-ceiling write collapse (typed denial over the full stack) ──

describe("wire matrix — int4-ceiling write collapse (typed localized denial, correlated, zero leak)", () => {
  test("an id beyond the int4 ceiling collapses to the typed session-not-found denial with the correlation id", async () => {
    const correlationId = "wire-recitation-ceiling-en";
    // The forcing trigger is benign and needs no monkey-patching: the id is
    // a positive safe integer the service's shape guard deliberately admits,
    // but the integer column cannot represent it — the write path collapses
    // it BEFORE the database read to the same typed session-not-found denial
    // as a foreign or nonexistent session (no driver-level failure is
    // reachable on this surface anymore).
    const body = await postDocument(
      RECITATION_MUTATION_DOCUMENT,
      ownerToken,
      recordVariablesFor(OVERFLOW_SESSION_ID, RECORD_NAME, null),
      { "x-request-id": correlationId, "accept-language": "en" }
    );
    const item = expectDenialCode(body, "SESSION_NOT_FOUND");
    expect(errorMessageOf(item)).toBe(tEn.sessionNotFound);
    expect(requestIdOf(item)).toBe(correlationId);
    const serialized = JSON.stringify(item);
    expect(serialized).not.toContain("stacktrace");
    expect(serialized).not.toContain("out of range");
    expect(serialized).not.toContain(RECORD_NAME);
  });

  test("arabic locale collapses through its own copy with its own correlation id", async () => {
    const correlationId = "wire-recitation-ceiling-ar";
    const body = await postDocument(
      RECITATION_MUTATION_DOCUMENT,
      ownerToken,
      recordVariablesFor(OVERFLOW_SESSION_ID, RECORD_NAME, null),
      { "x-request-id": correlationId, "accept-language": "ar" }
    );
    const item = expectDenialCode(body, "SESSION_NOT_FOUND");
    expect(errorMessageOf(item)).toBe(tAr.sessionNotFound);
    expect(requestIdOf(item)).toBe(correlationId);
  });

  test("the collapsed denial wrote nothing and disturbed nothing (rollback purity over the wire)", async () => {
    const [after] = await db
      .select()
      .from(recitation)
      .where(eq(recitation.sessionId, Number(startedSessionId)))
      .limit(1);
    if (!after) {
      throw new Error("expected the recorded row to persist");
    }
    expect(JSON.stringify(after)).toBe(recordedRowSnapshot);
  });
});

// ─── Matrix: credential hygiene (no token echo on any response) ──────────────

describe("wire matrix — credential hygiene (response bodies never echo identity material)", () => {
  test("neither a denial body nor a success body echoes the bearer token", async () => {
    const tokenProbe = ownerToken.slice(24, 56);
    if (tokenProbe.length === 0) {
      throw new Error("expected a long-enough bearer token for the echo probe");
    }

    const denialBody = await postDocument(
      RECITATION_MUTATION_DOCUMENT,
      ownerToken,
      recordVariablesFor(scheduledSessionId, RECORD_NAME, null)
    );
    expect(JSON.stringify(denialBody)).not.toContain(tokenProbe);

    const readBody = await postDocument(RECITATION_QUERY_DOCUMENT, ownerToken, { sessionId: startedSessionId });
    expect(JSON.stringify(readBody)).not.toContain(tokenProbe);
  });
});
