/**
 * Consolidated GraphQL wire matrix — the role ×
 * operation × validation tier for the session-report/homework surface
 * (`submitSessionReport` + `sessionReport` + `sessionHomework`) over the
 * REAL wire (HTTP → gateway pipeline → scope-auth → resolver →
 * SessionReportService → PostgreSQL → back).
 *
 * Every cell of the session-surface permission matrix is asserted ONE-TO-ONE
 * (8 caller classes × 3 operations = 24 cells):
 *
 *  | caller              | submitSessionReport      | sessionReport | sessionHomework |
 *  |---------------------|--------------------------|---------------|-----------------|
 *  | anonymous           | UNAUTHORIZED (401)       | UNAUTHORIZED  | UNAUTHORIZED    |
 *  | student participant | FORBIDDEN (scope)        | row           | row             |
 *  | student foreign     | FORBIDDEN (scope)        | null          | null            |
 *  | teacher owner       | transition (happy path)  | row           | row             |
 *  | teacher foreign     | SESSION_NOT_FOUND oracle | null          | null            |
 *  | parent linked       | FORBIDDEN (scope)        | null          | null            |
 *  | parent other        | FORBIDDEN (scope)        | null          | null            |
 *  | admin               | FORBIDDEN (scope)        | null          | null            |
 *
 * On top of the matrix:
 *  - **Closed-input smuggle probes** — extraneous top-level input members
 *    (`id`, `sessionId`, `teacherId`, `createdAt`, `grades` at assignment
 *    level) and an unknown query field die PRE-RESOLVER through the
 *    schema validator's two closed-input tiers (BOPLA: the whitelist is
 *    closed; server-controlled columns are structurally unreachable):
 *    smuggled fields in the DOCUMENT literal die as GRAPHQL_VALIDATION_FAILED
 *    (the validation preset), and the same smuggle through the variables JSON
 *    dies as BAD_USER_INPUT (Apollo's variable-coercion preset — per
 *    error-contract-matrix.test.ts PRESET_ROWS), both with `data` absent.
 *  - **Invalid enum VALUE probes** — the same two closed channels refuse a
 *    non-member `SurahJuzRef` VALUE (perfectly legal input shape, closed
 *    vocabulary): an out-of-vocabulary surah/juz value in the variables JSON
 *    (`"Juz99"`, and a `SurahAlFurqanTypo`-style near-miss) dies as
 *    BAD_USER_INPUT at variable coercion, and the same non-member as an
 *    unquoted DOCUMENT literal dies as GRAPHQL_VALIDATION_FAILED — both
 *    pre-resolver with `data` absent and zero DB side effects (no report
 *    row, no homework row, no notification publish for any cast actor).
 *  - **Id-shape fuzz** — non-numeric / negative / zero / float / overflow
 *    session ids answer the SAME typed VALIDATION denial (the boundary
 *    guard) — never a masked 500 — on both the mutation and both queries.
 *  - **Wire ≡ service payload equality** — the successful submit returns the
 *    service row's exact canonical shape and field-identical content for the
 *    submitted input (the resolver is a THIN hand-off, so the wire payload IS
 *    the `SessionReportService` return), and both reads (participant + owner)
 *    return rows FIELD-IDENTICAL to the submit's row; persistence is proven
 *    by the replay-throw duplicate submit.
 *    SANDBOX NOTE: the direct service-call oracle (call
 *    `SessionReportService.getSessionReport` in the TEST process, the
 *    parent-link discipline) is not realizable under `DB_PROVIDER=pglite` —
 *    the bun-test process and the warm dev server hold SEPARATE in-memory
 *    PGlite instances over the same data dir (see
 *    `test/helpers/skip-when-pglite.ts`): a test-process service read can
 *    never observe server-process writes. Follow-up: on the
 *    real-PG CI tier, strengthen these three cells to the direct
 *    service-oracle call.
 *  - **Null-collapse byte identity** — the foreign-teacher read response
 *    vs the nonexistent-session read response are BYTE-IDENTICAL
 *    normalized GraphQL response bodies for both queries (raw
 *    serialize-and-compare; oracle-safety discipline), while the participant read
 *    returns the row.
 *  - **Domain errors at the wire** — wrong-state submit →
 *    SESSION_INVALID_TRANSITION; duplicate submit →
 *    SESSION_REPORT_ALREADY_EXISTS; validation junk → VALIDATION — each
 *    with the localized message for the requested Accept-Language (en AND
 *    ar both pass, resolved through getServerTranslations — never
 *    hardcoded strings).
 *  - **Envelope parity** — every denial carries EXACTLY one error item,
 *    the expected extensions.code, a correlated requestId, and NEVER a
 *    stacktrace; denial messages are the constant generic localized copy
 *    (no existence deltas, no payload echoes).
 *
 * Fixture strategy (session-lifecycle-mutations conventions): a real
 * committed cast via `buildSessionJourneyCast` (real `users.role` rows +
 * role children + certified teachers, tracked for hard-delete cleanup),
 * an extra unlinked parent from the entity-setup factories, the linked
 * parent emulated by the canonical `students.parent_id` update, and REAL
 * access tokens (same `signAccessToken` the auth layer issues). σ reaches
 * `completed` through the REAL lifecycle over the wire (book → start →
 * complete); σ′ stays `scheduled` as the wrong-state target. The submit's
 * report/homework rows and notification rows are hard-deleted in
 * `afterAll` BEFORE the registry sweep (FK-safe order). Nothing is
 * monkey-patched, no service is mocked.
 *
 * ENVIRONMENT NOTE (sandbox): the canonical lifecycle helper boots its own
 * dev server on TEST_PORT (3066) when nothing answers there; where a
 * server already owns the port the liveness probe succeeds and no second
 * server is spawned.
 *
 * Mandated runner: bun run test/scripts/run-test.ts backend/graphql/test/session-report.wire.test.ts
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { ApolloClient, gql, HttpLink, InMemoryCache } from "@apollo/client";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/backend/db";
import { homeWork } from "@/backend/db/schema/classes/home-work";
import { reports } from "@/backend/db/schema/classes/reports";
import { notifications } from "@/backend/db/schema/notifications/notifications";
import { students } from "@/backend/db/schema/students/students";
import { createTestParent, createTestUser } from "@/backend/db/test/entity-setup";
import { NotificationType } from "@/backend/enum/notifications/notification-type.enum";
import { signAccessToken } from "@/backend/lib/auth/jwt";
import { getServerTranslations } from "@/shared/locale/server-graphql";
import { expectMutationError, setupTestServerLifecycle, TEST_PORT, testClient } from "@/test/helpers";
import {
  buildSessionJourneyCast,
  createSessionFixtureRegistry,
  journeyPrefix,
  type SessionJourneyCast,
} from "@/test/workflows/helpers";

// ─── Harness state ───────────────────────────────────────────────────────────

/** Spawns (or reuses) the live test server before any wire call. */
setupTestServerLifecycle();

/** Per-run prefix — unique row labels AND idempotency keys per suite run. */
const PREFIX = journeyPrefix("sessrepwire");

const KEY_SIGMA = `${PREFIX}-key-sigma`;
const KEY_SIGMA_PRIME = `${PREFIX}-key-sigma-prime`;

/** The fixture registry — cast rows AND wire-booked sessions hard-deleted in afterAll. */
const registry = createSessionFixtureRegistry();

let cast: SessionJourneyCast;
let parentOtherUserId = 0;
let sigmaId = "";
let sigmaPrimeId = "";

/**
 * Row anchors captured from the wire itself (see the header's SANDBOX NOTE:
 * a test-process service read cannot observe server-process writes under
 * PGlite, so the submit's own response anchors the round-trip equality).
 * `submittedReportRow` is set by the Section 6 happy-path submit;
 * `submittedHomeworkRow` is set by the FIRST successful homework read (the
 * homework assignment has no dedicated submit — it rides the report submit).
 */
let submittedReportRow: Record<string, unknown> | null = null;
let submittedReportReadRow: Record<string, unknown> | null = null;
let submittedHomeworkRow: Record<string, unknown> | null = null;

// Actor-scoped clients (Bearer identity, per the lifecycle wire-suite pattern).
let studentParticipant: ApolloClient;
let studentForeign: ApolloClient;
let teacherOwner: ApolloClient;
let teacherForeign: ApolloClient;
let parentLinked: ApolloClient;
let parentOther: ApolloClient;
let adminActor: ApolloClient;

// ─── Locale-key expected copy (never hardcoded strings) ──────────────────────

const tEn = getServerTranslations("en").errorsTranslations;
const tAr = getServerTranslations("ar").errorsTranslations;

// Notification copy slots for the submit path's report-ready wave (the
// side-effect oracle scopes its notification count to this copy slot —
// the journey suites' wave oracle discipline).
const tNotifsEn = getServerTranslations("en").notificationsTranslations;
const tNotifsAr = getServerTranslations("ar").notificationsTranslations;

// ─── Documents (id-first selections — Apollo cache normalization pin) ────────

const SUBMIT_REPORT_DOC = gql`
  mutation WireSubmitSessionReport($id: ID!, $input: SubmitSessionReportInput!) {
    submitSessionReport(id: $id, input: $input) {
      id
      sessionId
      teacherNotes
      studentRatingByTeacher
      createdAt
      updatedAt
    }
  }
`;

const SESSION_REPORT_DOC_TEXT = `
  query WireSessionReport($sessionId: ID!) {
    sessionReport(sessionId: $sessionId) {
      id
      sessionId
      teacherNotes
      studentRatingByTeacher
      createdAt
      updatedAt
    }
  }
`;

const SESSION_HOMEWORK_DOC_TEXT = `
  query WireSessionHomework($sessionId: ID!) {
    sessionHomework(sessionId: $sessionId) {
      id
      sessionId
      currentFromAyah
      currentToAyah
      currentGrade
      currentSurahJuz
      revisionFromAyah
      revisionToAyah
      revisionGrade
      revisionSurahJuz
      createdAt
      updatedAt
    }
  }
`;

const SESSION_REPORT_DOC = gql(SESSION_REPORT_DOC_TEXT);
const SESSION_HOMEWORK_DOC = gql(SESSION_HOMEWORK_DOC_TEXT);

const CREATE_SESSION_DOC = gql`
  mutation WireBookSession($input: CreateSessionInput!) {
    createSession(input: $input) {
      id
    }
  }
`;

const START_SESSION_DOC = gql`
  mutation WireStartSession($id: ID!) {
    startSession(id: $id) {
      id
    }
  }
`;

const COMPLETE_SESSION_DOC = gql`
  mutation WireCompleteSession($id: ID!) {
    completeSession(id: $id) {
      id
    }
  }
`;

/** The exact submit payload σ's happy path uses (all four input members). */
const SIGMA_SUBMIT_INPUT = {
  teacherNotes: "Wire suite report — excellent recitation progress this session.",
  studentRatingByTeacher: 5,
  homework: {
    jadid: { fromAyah: 1, toAyah: 7, surahJuz: "SurahAlBaqarah" },
    madi: { fromAyah: 281, toAyah: 286, surahJuz: "Juz30" },
  },
  previousGrades: null,
};

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

/** The single GraphQL error item of a raw denial body, runtime-guarded. */
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

/**
 * Asserts one raw-wire denial body answers the expected extensions.code
 * with the shipped error contract: single-item envelope, a correlated
 * requestId, and NEVER a stacktrace (no leaked internals). The `data`
 * channel differs by ROOT-FIELD NULLABILITY and execution tier:
 *  - `null` — the non-nullable mutation (`submitSessionReport`): scope
 *    deaths, boundary-guard deaths, and service DomainErrors all null the
 *    WHOLE data object;
 *  - `fieldNull` — the nullable queries (`sessionReport` /
 *    `sessionHomework`): the error nulls the FIELD, `data` stays an
 *    object carrying that one null;
 *  - `absent` — the request never executed (smuggled-field document
 *    validation deaths): the data key is absent from the body entirely.
 */
function expectDenialCode(
  body: Record<string, unknown>,
  expectedCode: string,
  dataMode: "null" | "absent" | { readonly fieldNull: string } = "null"
): Record<string, unknown> {
  const errorItem = soleErrorItemOf(body);
  expect(errorCodeOf(errorItem)).toBe(expectedCode);
  if (dataMode === "null") {
    expect(body.data).toBeNull();
  } else if (dataMode === "absent") {
    expect(body.data).toBeUndefined();
  } else {
    const data = recordOf(body.data, "expected a data object");
    expect(data[dataMode.fieldNull]).toBeNull();
  }
  const requestId = recordOf(errorItem.extensions, "expected extensions").requestId;
  expect(typeof requestId === "string" && requestId.length > 0).toBe(true);
  expect(JSON.stringify(errorItem)).not.toContain("stacktrace");
  return errorItem;
}

/** The sorted key set of a wire row — zero internal leakage probes. */
function sortedKeysOf(row: Record<string, unknown>): string[] {
  return Object.keys(row).toSorted((a, b) => a.localeCompare(b));
}

// ─── Wire helpers (raw fetch where byte-shape / headers matter) ──────────────

const GRAPHQL_URL = `http://localhost:${TEST_PORT}/api/graphql`;

interface RawWireResponse {
  readonly text: string;
  readonly body: Record<string, unknown>;
}

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
 * POSTs one document and returns the RAW response text alongside the
 * parsed body — the byte-identity probes serialize the parsed body back
 * and compare the two normalized serializations byte-for-byte.
 */
async function postDocumentRaw(
  query: string,
  accessToken: string,
  variables?: Record<string, unknown>,
  extraHeaders?: Record<string, string>
): Promise<RawWireResponse> {
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
  const text = await response.text();
  return { text, body: recordOf(JSON.parse(text), "expected a JSON object response") };
}

// ─── Actor-scoped client + lifecycle helpers (lifecycle wire-suite pattern) ──

/** Builds an actor-scoped client — real Bearer identity. */
function clientFor(accessToken: string): ApolloClient {
  return new ApolloClient({
    link: new HttpLink({
      uri: GRAPHQL_URL,
      headers: { authorization: `Bearer ${accessToken}` },
    }),
    cache: new InMemoryCache(),
    defaultOptions: {
      query: { errorPolicy: "all", fetchPolicy: "no-cache" },
      mutate: { errorPolicy: "all", fetchPolicy: "no-cache" },
      watchQuery: { errorPolicy: "all", fetchPolicy: "no-cache" },
    },
  });
}

/** Extracts the root-field payload object of a happy-path result. */
function payloadOf(result: { readonly data?: unknown }, rootField: string): Record<string, unknown> {
  if (!isRecord(result.data)) {
    throw new Error(`missing data for ${rootField}`);
  }
  const payload: unknown = result.data[rootField];
  if (!isRecord(payload)) {
    throw new Error(`missing ${rootField} payload in response data`);
  }
  return payload;
}

/**
 * Asserts the NULL-COLLAPSE shape of a nullable-query result over the
 * actor-scoped clients: `data` is an object whose ONLY root field is
 * `null`, with NO error hop (the read is authorized; the answer is just
 * nothing). `payloadOf` cannot be used here — a collapsed null is not a
 * record.
 */
function expectNullCollapsed(result: { readonly data?: unknown; readonly error?: unknown }, rootField: string): void {
  if (!isRecord(result.data)) {
    throw new Error(`missing data for ${rootField}`);
  }
  expect(result.data[rootField]).toBeNull();
  expect(result.error).toBeUndefined();
}

/** Books one session over the wire under a UNIQUE idempotency key. */
async function bookSession(accessToken: string, idempotencyKey: string, teacherId: number): Promise<string> {
  const clientWithKey = new ApolloClient({
    link: new HttpLink({
      uri: GRAPHQL_URL,
      headers: { authorization: `Bearer ${accessToken}`, "x-idempotency-key": idempotencyKey },
    }),
    cache: new InMemoryCache(),
    defaultOptions: { mutate: { errorPolicy: "all", fetchPolicy: "no-cache" } },
  });
  const result = await clientWithKey.mutate({
    mutation: CREATE_SESSION_DOC,
    variables: { input: { teacherId, intent: "Hifz" } },
  });
  const id: unknown = payloadOf(result, "createSession").id;
  if (typeof id !== "string" && typeof id !== "number") {
    throw new Error("createSession returned no id");
  }
  return String(id);
}

/** Drives one booked session through start → complete over the wire (teacher). */
async function startAndCompleteSession(accessToken: string, id: string): Promise<void> {
  const client = clientFor(accessToken);
  const started = await client.mutate({ mutation: START_SESSION_DOC, variables: { id } });
  payloadOf(started, "startSession");
  const completed = await client.mutate({ mutation: COMPLETE_SESSION_DOC, variables: { id } });
  payloadOf(completed, "completeSession");
}

// ─── Wire ≡ service-oracle equality helpers ──────────────────────────────────

/**
 * Field-by-field wire-row ≡ submitted-input equality (report rows). The
 * resolver is a thin hand-off, so the service return MUST encode exactly the
 * submitted input plus the server-assigned identity/timestamps.
 */
function expectWireReportMatchesSubmittedInput(row: Record<string, unknown>): void {
  expect(row.teacherNotes).toBe(SIGMA_SUBMIT_INPUT.teacherNotes);
  expect(row.studentRatingByTeacher).toBe(SIGMA_SUBMIT_INPUT.studentRatingByTeacher);
  expect(typeof row.id === "string" && row.id.length > 0).toBe(true);
  expect(row.sessionId).toBe(Number(sigmaId));
  // Server-assigned audit columns: ISO-8601 instants (the DateTime scalar).
  expect(typeof row.createdAt === "string" && !Number.isNaN(Date.parse(row.createdAt))).toBe(true);
  expect(typeof row.updatedAt === "string" && !Number.isNaN(Date.parse(row.updatedAt))).toBe(true);
}

/**
 * Field-by-field wire-row ≡ submitted-input equality (homework rows). The
 * homework assignment rides the report submit; the grade columns are
 * submitted untouched (write-once — the grader tier owns them).
 */
function expectWireHomeworkMatchesSubmittedInput(row: Record<string, unknown>): void {
  expect(row.currentFromAyah).toBe(1);
  expect(row.currentToAyah).toBe(7);
  expect(row.currentSurahJuz).toBe("SurahAlBaqarah");
  expect(row.revisionFromAyah).toBe(281);
  expect(row.revisionToAyah).toBe(286);
  expect(row.revisionSurahJuz).toBe("Juz30");
  // Write-once grade columns start NULL on the wire row.
  expect(row.currentGrade).toBeNull();
  expect(row.revisionGrade).toBeNull();
  expect(typeof row.id === "string" && row.id.length > 0).toBe(true);
  expect(row.sessionId).toBe(Number(sigmaId));
  expect(typeof row.createdAt === "string" && !Number.isNaN(Date.parse(row.createdAt))).toBe(true);
  expect(typeof row.updatedAt === "string" && !Number.isNaN(Date.parse(row.updatedAt))).toBe(true);
}

/** Two wire rows of the same query are FIELD-IDENTICAL (round-trip pin). */
function expectWireRowsFieldIdentical(row: Record<string, unknown>, anchor: Record<string, unknown>): void {
  expect(sortedKeysOf(row)).toEqual(sortedKeysOf(anchor));
  for (const key of sortedKeysOf(anchor)) {
    expect(row[key]).toBe(anchor[key]);
  }
}

/**
 * The READ row carries the same content the SUBMIT returned (identity +
 * submitted fields). Timestamps are deliberately NOT compared across the
 * submit/read boundary: the submit response echoes the insert-instant and
 * the read re-decodes the persisted column — they agree only to the second
 * (observed Δ < 1s). READ-vs-READ comparisons (below) remain FULLY strict.
 */
function expectWireReportContentMatches(row: Record<string, unknown>, anchor: Record<string, unknown>): void {
  expect(row.id).toBe(anchor.id);
  expect(row.sessionId).toBe(anchor.sessionId);
  expect(row.teacherNotes).toBe(anchor.teacherNotes);
  expect(row.studentRatingByTeacher).toBe(anchor.studentRatingByTeacher);
}

/**
 * Every `SessionReport` wire row carries EXACTLY the six canonical keys.
 *
 * The actor-scoped clients are Apollo `InMemoryCache` pipelines, whose
 * normalization step injects `__typename` into every returned object
 * CLIENT-side — the raw wire body itself never carries it (the
 * byte-identity probes pin the raw shape: `{ data: { sessionReport: null } }`).
 * Strip the injected key before the exact-key comparison so the probe keeps
 * asserting what the WIRE exposed (canonical columns only, zero leakage).
 */
function expectExactReportRowShape(row: Record<string, unknown>): void {
  const { __typename: _apolloInjected, ...wireRow } = row;
  expect(sortedKeysOf(wireRow)).toEqual(
    ["createdAt", "id", "sessionId", "studentRatingByTeacher", "teacherNotes", "updatedAt"].toSorted((a, b) =>
      a.localeCompare(b)
    )
  );
}

/** Every `SessionHomeWork` wire row carries EXACTLY the twelve canonical keys. */
function expectExactHomeworkRowShape(row: Record<string, unknown>): void {
  const { __typename: _apolloInjected, ...wireRow } = row;
  expect(sortedKeysOf(wireRow)).toEqual(
    [
      "createdAt",
      "currentFromAyah",
      "currentGrade",
      "currentSurahJuz",
      "currentToAyah",
      "id",
      "revisionFromAyah",
      "revisionGrade",
      "revisionSurahJuz",
      "revisionToAyah",
      "sessionId",
      "updatedAt",
    ].toSorted((a, b) => a.localeCompare(b))
  );
}

// ─── Fixtures (committed cast + pre-driven lifecycle targets) ───────────────

beforeAll(async () => {
  // Committed cast — the primary student funded for TWO bookings (σ and σ′
  // both drain the trial ladder; neither booking is cancelled). Second
  // student stays zero-balance (the foreign-read actor never books).
  await db.transaction(async tx => {
    cast = await buildSessionJourneyCast(tx, registry, {
      prefix: PREFIX,
      primaryStudent: { trial: 2 },
    });

    // The parent-OTHER actor (never linked to any student) — real users +
    // parents rows through the entity-setup factories, tracked for cleanup.
    const parentOtherUser = await createTestUser(tx, { role: "parent", fullName: `${PREFIX} parent-other` });
    await createTestParent(tx, parentOtherUser.id);
    registry.track("users", parentOtherUser.id);
    registry.track("parents", parentOtherUser.id);
    parentOtherUserId = parentOtherUser.id;

    // The parent-LINKED actor: cast.parent links to the primary student
    // (emulates the link-request mutation per the journey precedent). The
    // matrix still expects a `null` read — owns parent reads.
    await tx.update(students).set({ parentId: cast.parent.userId }).where(eq(students.id, cast.primaryStudent.userId));
  });

  // Real access tokens for every actor (same signer the auth layer uses).
  const [
    tokenStudent,
    tokenStudentForeign,
    tokenTeacher,
    tokenTeacherForeign,
    tokenParent,
    tokenParentOther,
    tokenAdmin,
  ] = await Promise.all([
    signAccessToken({ userId: cast.primaryStudent.userId, role: cast.primaryStudent.user.role }),
    signAccessToken({ userId: cast.secondStudent.userId, role: cast.secondStudent.user.role }),
    signAccessToken({ userId: cast.teacher.userId, role: cast.teacher.user.role }),
    signAccessToken({ userId: cast.secondTeacher.userId, role: cast.secondTeacher.user.role }),
    signAccessToken({ userId: cast.parent.userId, role: cast.parent.user.role }),
    signAccessToken({ userId: parentOtherUserId, role: "parent" }),
    signAccessToken({ userId: cast.admin.userId, role: cast.admin.user.role }),
  ]);

  studentParticipant = clientFor(tokenStudent);
  studentForeign = clientFor(tokenStudentForeign);
  teacherOwner = clientFor(tokenTeacher);
  teacherForeign = clientFor(tokenTeacherForeign);
  parentLinked = clientFor(tokenParent);
  parentOther = clientFor(tokenParentOther);
  adminActor = clientFor(tokenAdmin);

  // Pre-drive the two transition targets over the wire: σ reaches
  // `completed` through the REAL lifecycle (book → start → complete);
  // σ′ stays `scheduled` as the wrong-state target. Sequential — the
  // trial-lane ladder drains in booking order.
  sigmaId = await bookSession(tokenStudent, KEY_SIGMA, cast.teacher.userId);
  registry.track("session", Number(sigmaId));
  await startAndCompleteSession(tokenTeacher, sigmaId);

  sigmaPrimeId = await bookSession(tokenStudent, KEY_SIGMA_PRIME, cast.teacher.userId);
  registry.track("session", Number(sigmaPrimeId));
}, 240_000);

afterAll(async () => {
  // FK-safe order: service-created report/homework rows (session-scoped)
  // and notification rows FIRST, then the registry sweep (sessions →
  // role children → users). The service-created rows carry NO children.
  const sessionIds = [sigmaId, sigmaPrimeId].map(id => Number(id)).filter(id => id > 0);
  if (sessionIds.length > 0) {
    await db.delete(reports).where(inArray(reports.sessionId, sessionIds));
    await db.delete(homeWork).where(inArray(homeWork.sessionId, sessionIds));
  }
  const fixtureUserIds = [
    cast.primaryStudent.userId,
    cast.secondStudent.userId,
    cast.teacher.userId,
    cast.secondTeacher.userId,
    cast.parent.userId,
    parentOtherUserId,
    cast.admin.userId,
  ].filter(id => id > 0);
  if (fixtureUserIds.length > 0) {
    await db.delete(notifications).where(inArray(notifications.userId, fixtureUserIds));
  }
  await registry.cleanup();
}, 60_000);

// ─── Section 1 — anonymous tier (401): one cell per operation ────────────────

describe("permission matrix — anonymous tier (401, pre-resolver)", () => {
  test("submitSessionReport × anonymous → UNAUTHORIZED", async () => {
    const result = await testClient.mutate({
      mutation: SUBMIT_REPORT_DOC,
      variables: { id: sigmaId, input: SIGMA_SUBMIT_INPUT },
    });
    const error = expectMutationError(result.error, "UNAUTHORIZED");
    expect(error.errors).toHaveLength(1);
  });

  test("sessionReport × anonymous → UNAUTHORIZED", async () => {
    const result = await testClient.query({
      query: SESSION_REPORT_DOC,
      variables: { sessionId: sigmaId },
    });
    const error = expectMutationError(result.error, "UNAUTHORIZED");
    expect(error.errors).toHaveLength(1);
  });

  test("sessionHomework × anonymous → UNAUTHORIZED", async () => {
    const result = await testClient.query({
      query: SESSION_HOMEWORK_DOC,
      variables: { sessionId: sigmaId },
    });
    const error = expectMutationError(result.error, "UNAUTHORIZED");
    expect(error.errors).toHaveLength(1);
  });

  test("the anonymous denial class is CONSTANT across all three ops (same code + message, no existence delta)", async () => {
    // Raw-wire envelope parity: the mutation (non-nullable root) nulls the
    // whole data object; the two nullable queries null only their field —
    // but the error CODE and the localized copy are the same constant, and
    // no message ever echoes the probed session id.
    const [submitBody, reportBody, homeworkBody] = await Promise.all([
      postAnonymous(
        'mutation M { submitSessionReport(id: "1", input: { teacherNotes: "x", studentRatingByTeacher: 5 }) { id } }'
      ),
      postAnonymous('query Q { sessionReport(sessionId: "1") { id } }'),
      postAnonymous('query H { sessionHomework(sessionId: "1") { id } }'),
    ]);
    const submitItem = expectDenialCode(submitBody, "UNAUTHORIZED");
    const reportItem = expectDenialCode(reportBody, "UNAUTHORIZED", { fieldNull: "sessionReport" });
    const homeworkItem = expectDenialCode(homeworkBody, "UNAUTHORIZED", { fieldNull: "sessionHomework" });
    expect(errorMessageOf(submitItem)).toBe(tEn.unauthorized);
    expect(errorMessageOf(reportItem)).toBe(tEn.unauthorized);
    expect(errorMessageOf(homeworkItem)).toBe(tEn.unauthorized);
    expect(errorMessageOf(submitItem)).not.toContain("1");
  });
});

// ─── Section 2 — submitSessionReport wrong-role scope denials (403) ──────────

describe("permission matrix — submitSessionReport × non-teacher callers (403, pre-resolver scope)", () => {
  test("submitSessionReport × student-participant → FORBIDDEN", async () => {
    const result = await studentParticipant.mutate({
      mutation: SUBMIT_REPORT_DOC,
      variables: { id: sigmaId, input: SIGMA_SUBMIT_INPUT },
    });
    const error = expectMutationError(result.error, "FORBIDDEN");
    expect(error.errors).toHaveLength(1);
  });

  test("submitSessionReport × student-foreign → FORBIDDEN", async () => {
    const result = await studentForeign.mutate({
      mutation: SUBMIT_REPORT_DOC,
      variables: { id: sigmaId, input: SIGMA_SUBMIT_INPUT },
    });
    const error = expectMutationError(result.error, "FORBIDDEN");
    expect(error.errors).toHaveLength(1);
  });

  test("submitSessionReport × parent-linked → FORBIDDEN", async () => {
    const result = await parentLinked.mutate({
      mutation: SUBMIT_REPORT_DOC,
      variables: { id: sigmaId, input: SIGMA_SUBMIT_INPUT },
    });
    const error = expectMutationError(result.error, "FORBIDDEN");
    expect(error.errors).toHaveLength(1);
  });

  test("submitSessionReport × parent-other → FORBIDDEN", async () => {
    const result = await parentOther.mutate({
      mutation: SUBMIT_REPORT_DOC,
      variables: { id: sigmaId, input: SIGMA_SUBMIT_INPUT },
    });
    const error = expectMutationError(result.error, "FORBIDDEN");
    expect(error.errors).toHaveLength(1);
  });

  test("submitSessionReport × admin → FORBIDDEN (no bypass)", async () => {
    const result = await adminActor.mutate({
      mutation: SUBMIT_REPORT_DOC,
      variables: { id: sigmaId, input: SIGMA_SUBMIT_INPUT },
    });
    const error = expectMutationError(result.error, "FORBIDDEN");
    expect(error.errors).toHaveLength(1);
  });

  test("every 403 denial message is the constant localized copy (no payload/identity echo)", async () => {
    const body = await postDocument(
      "mutation M($id: ID!, $input: SubmitSessionReportInput!) { submitSessionReport(id: $id, input: $input) { id } }",
      await signAccessToken({ userId: cast.admin.userId, role: cast.admin.user.role }),
      { id: sigmaId, input: SIGMA_SUBMIT_INPUT }
    );
    const item = expectDenialCode(body, "FORBIDDEN");
    expect(errorMessageOf(item)).toBe(tEn.forbidden);
  });
});

// ─── Section 3 — submitSessionReport service-tier denials at the wire ────────

describe("permission matrix — submitSessionReport × teacher-foreign (SESSION_NOT_FOUND oracle)", () => {
  test("submitSessionReport × teacher-foreign → SESSION_NOT_FOUND (owner-scoped gate)", async () => {
    const body = await postDocument(
      "mutation M($id: ID!, $input: SubmitSessionReportInput!) { submitSessionReport(id: $id, input: $input) { id } }",
      await signAccessToken({ userId: cast.secondTeacher.userId, role: cast.secondTeacher.user.role }),
      { id: sigmaId, input: SIGMA_SUBMIT_INPUT }
    );
    const item = expectDenialCode(body, "SESSION_NOT_FOUND");
    // The oracle-safe generic copy — the message never distinguishes a
    // foreign session from a nonexistent one (no existence delta).
    expect(errorMessageOf(item)).toBe(tEn.sessionNotFound);
  });
});

describe("domain errors at the wire — localized denial copy (Accept-Language en + ar)", () => {
  test("wrong-state submit (σ′ scheduled) → SESSION_INVALID_TRANSITION with the en copy", async () => {
    const body = await postDocument(
      "mutation M($id: ID!, $input: SubmitSessionReportInput!) { submitSessionReport(id: $id, input: $input) { id } }",
      await signAccessToken({ userId: cast.teacher.userId, role: cast.teacher.user.role }),
      { id: sigmaPrimeId, input: SIGMA_SUBMIT_INPUT },
      { "accept-language": "en" }
    );
    const item = expectDenialCode(body, "SESSION_INVALID_TRANSITION");
    expect(errorMessageOf(item)).toBe(tEn.sessionInvalidTransition);
  });

  test("wrong-state submit (σ′ scheduled) → SESSION_INVALID_TRANSITION with the ar copy", async () => {
    const body = await postDocument(
      "mutation M($id: ID!, $input: SubmitSessionReportInput!) { submitSessionReport(id: $id, input: $input) { id } }",
      await signAccessToken({ userId: cast.teacher.userId, role: cast.teacher.user.role }),
      { id: sigmaPrimeId, input: SIGMA_SUBMIT_INPUT },
      { "accept-language": "ar" }
    );
    const item = expectDenialCode(body, "SESSION_INVALID_TRANSITION");
    expect(errorMessageOf(item)).toBe(tAr.sessionInvalidTransition);
  });

  test("validation junk (rating 7) → VALIDATION with the en copy", async () => {
    const body = await postDocument(
      "mutation M($id: ID!, $input: SubmitSessionReportInput!) { submitSessionReport(id: $id, input: $input) { id } }",
      await signAccessToken({ userId: cast.teacher.userId, role: cast.teacher.user.role }),
      {
        id: sigmaId,
        input: { ...SIGMA_SUBMIT_INPUT, studentRatingByTeacher: 7, previousGrades: null },
      },
      { "accept-language": "en" }
    );
    const item = expectDenialCode(body, "VALIDATION");
    expect(errorMessageOf(item)).toBe(tEn.sessionRatingRange);
  });

  test("validation junk (rating 7) → VALIDATION with the ar copy", async () => {
    const body = await postDocument(
      "mutation M($id: ID!, $input: SubmitSessionReportInput!) { submitSessionReport(id: $id, input: $input) { id } }",
      await signAccessToken({ userId: cast.teacher.userId, role: cast.teacher.user.role }),
      {
        id: sigmaId,
        input: { ...SIGMA_SUBMIT_INPUT, studentRatingByTeacher: 7, previousGrades: null },
      },
      { "accept-language": "ar" }
    );
    const item = expectDenialCode(body, "VALIDATION");
    expect(errorMessageOf(item)).toBe(tAr.sessionRatingRange);
  });
});

// ─── Section 4 — id-shape fuzz (uniform typed denial, no 500s) ───────────────

describe("id-shape fuzz — every malformed id shape answers the SAME typed VALIDATION", () => {
  const FUZZ_SHAPES: readonly { readonly label: string; readonly raw: string }[] = [
    { label: "non-numeric", raw: "12abc" },
    { label: "negative", raw: "-5" },
    { label: "zero", raw: "0" },
    { label: "float", raw: "3.5" },
    { label: "overflow", raw: "9223372036854775808" },
  ];

  test("submitSessionReport fuzz × 5 shapes → uniform VALIDATION (boundary guard, pre-DB)", async () => {
    const token = await signAccessToken({ userId: cast.teacher.userId, role: cast.teacher.user.role });
    const bodies = await Promise.all(
      FUZZ_SHAPES.map(shape =>
        postDocument(
          "mutation M($id: ID!, $input: SubmitSessionReportInput!) { submitSessionReport(id: $id, input: $input) { id } }",
          token,
          { id: shape.raw, input: SIGMA_SUBMIT_INPUT }
        )
      )
    );
    const codes = bodies.map(body => {
      const item = expectDenialCode(body, "VALIDATION");
      expect(errorMessageOf(item).length).toBeGreaterThan(0);
      return errorCodeOf(item);
    });
    // Uniformity: the SAME typed denial for every shape — never a masked 500.
    expect(codes).toEqual(FUZZ_SHAPES.map(() => "VALIDATION"));
  });

  test("sessionReport fuzz × 5 shapes → uniform VALIDATION (field-null on the nullable query)", async () => {
    const token = await signAccessToken({ userId: cast.teacher.userId, role: cast.teacher.user.role });
    const bodies = await Promise.all(
      FUZZ_SHAPES.map(shape => postDocument(SESSION_REPORT_DOC_TEXT, token, { sessionId: shape.raw }))
    );
    const codes = bodies.map(body => {
      const item = expectDenialCode(body, "VALIDATION", { fieldNull: "sessionReport" });
      expect(errorMessageOf(item).length).toBeGreaterThan(0);
      return errorCodeOf(item);
    });
    expect(codes).toEqual(FUZZ_SHAPES.map(() => "VALIDATION"));
  });

  test("sessionHomework fuzz × 5 shapes → uniform VALIDATION (field-null on the nullable query)", async () => {
    const token = await signAccessToken({ userId: cast.teacher.userId, role: cast.teacher.user.role });
    const bodies = await Promise.all(
      FUZZ_SHAPES.map(shape => postDocument(SESSION_HOMEWORK_DOC_TEXT, token, { sessionId: shape.raw }))
    );
    const codes = bodies.map(body => {
      const item = expectDenialCode(body, "VALIDATION", { fieldNull: "sessionHomework" });
      expect(errorMessageOf(item).length).toBeGreaterThan(0);
      return errorCodeOf(item);
    });
    expect(codes).toEqual(FUZZ_SHAPES.map(() => "VALIDATION"));
  });
});

// ─── Section 5 — closed-input smuggle probes (BOPLA, pre-resolver) ───────────

describe("closed-input smuggle probes — extraneous fields die pre-resolver", () => {
  /**
   * The five smuggled members, each fired as its OWN inline-literal document
   * so the document-validation tier answers with EXACTLY ONE error item:
   * the closed input type refuses the field before any execution happens.
   */
  const SMUGGLED_MEMBERS: readonly { readonly label: string; readonly literal: string }[] = [
    { label: "id", literal: 'input: { teacherNotes: "x", studentRatingByTeacher: 5, id: 4242 }' },
    { label: "sessionId", literal: 'input: { teacherNotes: "x", studentRatingByTeacher: 5, sessionId: 4242 }' },
    { label: "teacherId", literal: 'input: { teacherNotes: "x", studentRatingByTeacher: 5, teacherId: 4242 }' },
    {
      label: "createdAt",
      literal: 'input: { teacherNotes: "x", studentRatingByTeacher: 5, createdAt: "2020-01-01T00:00:00.000Z" }',
    },
    {
      label: "grades at assignment level",
      literal:
        'input: { teacherNotes: "x", studentRatingByTeacher: 5, homework: { jadid: { fromAyah: 1, toAyah: 7, surahJuz: SurahAlBaqarah }, grades: { currentGrade: 99, revisionGrade: 88 } } }',
    },
  ];

  for (const member of SMUGGLED_MEMBERS) {
    test(`document-literal smuggle × ${member.label} → GRAPHQL_VALIDATION_FAILED, data absent (single-error)`, async () => {
      const body = await postDocument(
        `mutation M { submitSessionReport(id: "${sigmaId}", ${member.literal}) { id } }`,
        await signAccessToken({ userId: cast.teacher.userId, role: cast.teacher.user.role })
      );
      const item = expectDenialCode(body, "GRAPHQL_VALIDATION_FAILED", "absent");
      // The SCHEMA validator (not the service) rejected the document: the
      // message names the closed input type (or the nested assignment type).
      expect(errorMessageOf(item)).toContain("not to include unknown field");
    });
  }

  test("the same smuggle through the variables JSON → BAD_USER_INPUT (coercion preset), one item per unknown field, data absent", async () => {
    // The variables channel skips document validation but is STILL closed:
    // graphql-js variable coercion refuses every unknown member (one error
    // item each, one shared requestId) — BAD_USER_INPUT per the pinned
    // protocol-preset rows in error-contract-matrix.test.ts.
    const smuggledInput: Record<string, unknown> = { ...SIGMA_SUBMIT_INPUT };
    smuggledInput.id = 4242;
    smuggledInput.sessionId = 4242;
    smuggledInput.teacherId = 4242;
    smuggledInput.createdAt = "2020-01-01T00:00:00.000Z";
    smuggledInput.homework = {
      ...(SIGMA_SUBMIT_INPUT.homework as Record<string, unknown>),
      grades: { currentGrade: 99, revisionGrade: 88 },
    };
    const body = await postDocument(
      "mutation M($id: ID!, $input: SubmitSessionReportInput!) { submitSessionReport(id: $id, input: $input) { id } }",
      await signAccessToken({ userId: cast.teacher.userId, role: cast.teacher.user.role }),
      { id: sigmaId, input: smuggledInput }
    );
    const errors = recordOf(body, "expected a response body").errors;
    if (!Array.isArray(errors) || errors.length !== 5) {
      throw new Error(`expected five per-field coercion errors, got ${Array.isArray(errors) ? errors.length : "none"}`);
    }
    expect(body.data).toBeUndefined();
    const requestIds = new Set(
      errors.map(error => {
        const item = recordOf(error, "expected a record-shaped error item");
        expect(errorCodeOf(item)).toBe("BAD_USER_INPUT");
        expect(errorMessageOf(item)).toContain("not to include unknown field");
        return recordOf(item.extensions, "expected extensions").requestId;
      })
    );
    expect(requestIds.size).toBe(1);
  });

  test("unknown query field is rejected pre-resolver", async () => {
    const body = await postDocument(
      "query Q($sessionId: ID!) { sessionReport(sessionId: $sessionId) { id teacherSecretDossier } }",
      await signAccessToken({ userId: cast.teacher.userId, role: cast.teacher.user.role }),
      { sessionId: sigmaId }
    );
    const item = expectDenialCode(body, "GRAPHQL_VALIDATION_FAILED", "absent");
    expect(errorMessageOf(item)).toContain("Cannot query field");
  });
});

// ─── Section 5b — invalid enum VALUE probes (closed vocabulary, pre-resolver) ─

describe("invalid enum VALUE probes — a non-member SurahJuzRef dies on BOTH closed channels", () => {
  /**
   * DB side-effect oracle for this tier: scoped row counts for the probe's
   * session (reports + home_work) and the SUBMIT path's notification rows
   * across every cast actor's inbox. These deaths happen BEFORE any resolver
   * runs, so no report row, no homework row, and no report-ready
   * notification row may ever appear — and at this point in the suite the
   * target session is still report-less, so the pre-probe baseline is
   * expected to be all zeros. The notification count scopes to the
   * report-ready wave copy slot (the journey suites' wave-oracle
   * discipline): σ's real-lifecycle booking already persisted the sibling
   * handshake completion-prompt row, which no submit may ever write.
   */
  async function wireSideEffectCounts(): Promise<{
    reportRows: number;
    homeworkRows: number;
    notificationRows: number;
  }> {
    const castUserIds = [
      cast.primaryStudent.userId,
      cast.secondStudent.userId,
      cast.teacher.userId,
      cast.secondTeacher.userId,
      cast.parent.userId,
      parentOtherUserId,
      cast.admin.userId,
    ].filter(id => id > 0);
    const [reportRows, homeworkRows, notificationRows] = await Promise.all([
      db.$count(reports, eq(reports.sessionId, Number(sigmaId))),
      db.$count(homeWork, eq(homeWork.sessionId, Number(sigmaId))),
      db.$count(
        notifications,
        and(
          inArray(notifications.userId, castUserIds),
          eq(notifications.type, NotificationType.SessionCompletion),
          inArray(notifications.title, [tNotifsEn.eventSessionReportReadyTitle, tNotifsAr.eventSessionReportReadyTitle])
        )
      ),
    ]);
    return { reportRows, homeworkRows, notificationRows };
  }

  /** The submit variables with ONE jadid block field overridden (no casts). */
  function hostileVariablesInput(jadidOverride: Record<string, unknown>): Record<string, unknown> {
    const hostileInput: Record<string, unknown> = { ...SIGMA_SUBMIT_INPUT };
    hostileInput.homework = {
      ...(SIGMA_SUBMIT_INPUT.homework as Record<string, unknown>),
      jadid: jadidOverride,
    };
    return hostileInput;
  }

  test('variables JSON × jadid surahJuz "Juz99" → BAD_USER_INPUT (coercion preset), data absent, zero DB side effects', async () => {
    const before = await wireSideEffectCounts();
    const body = await postDocument(
      "mutation M($id: ID!, $input: SubmitSessionReportInput!) { submitSessionReport(id: $id, input: $input) { id } }",
      await signAccessToken({ userId: cast.teacher.userId, role: cast.teacher.user.role }),
      {
        id: sigmaId,
        input: hostileVariablesInput({ fromAyah: 1, toAyah: 7, surahJuz: "Juz99" }),
      }
    );
    // The Apollo variable-coercion preset — same channel death as the
    // smuggled-field probe above, but here the input SHAPE is legal and the
    // closed enum VALUE SET is what refuses it.
    const item = expectDenialCode(body, "BAD_USER_INPUT", "absent");
    expect(errorMessageOf(item)).toContain('Value "Juz99" does not exist in "SurahJuzRef" enum');
    // Pre-resolver death: the service and the DB were never reached.
    const after = await wireSideEffectCounts();
    expect(before).toEqual({ reportRows: 0, homeworkRows: 0, notificationRows: 0 });
    expect(after).toEqual(before);
  });

  test('variables JSON × jadid surahJuz "SurahAlFurqanTypo" (near-miss) → BAD_USER_INPUT, data absent, zero DB side effects', async () => {
    const before = await wireSideEffectCounts();
    const body = await postDocument(
      "mutation M($id: ID!, $input: SubmitSessionReportInput!) { submitSessionReport(id: $id, input: $input) { id } }",
      await signAccessToken({ userId: cast.teacher.userId, role: cast.teacher.user.role }),
      {
        id: sigmaId,
        input: hostileVariablesInput({ fromAyah: 1, toAyah: 7, surahJuz: "SurahAlFurqanTypo" }),
      }
    );
    const item = expectDenialCode(body, "BAD_USER_INPUT", "absent");
    expect(errorMessageOf(item)).toContain('Value "SurahAlFurqanTypo" does not exist in "SurahJuzRef" enum');
    const after = await wireSideEffectCounts();
    expect(before).toEqual({ reportRows: 0, homeworkRows: 0, notificationRows: 0 });
    expect(after).toEqual(before);
  });

  test("document literal × surahJuz: Juz99 → GRAPHQL_VALIDATION_FAILED (validation preset), data absent, zero DB side effects", async () => {
    const before = await wireSideEffectCounts();
    const body = await postDocument(
      `mutation M { submitSessionReport(id: "${sigmaId}", input: { teacherNotes: "x", studentRatingByTeacher: 5, homework: { jadid: { fromAyah: 1, toAyah: 7, surahJuz: Juz99 } } }) { id } }`,
      await signAccessToken({ userId: cast.teacher.userId, role: cast.teacher.user.role })
    );
    // The validation preset — the unquoted non-member literal is refused while
    // the document is being validated, before any execution (contrast the
    // smuggled-FIELD probes: same pre-resolver tier, closed VALUE this time).
    const item = expectDenialCode(body, "GRAPHQL_VALIDATION_FAILED", "absent");
    expect(errorMessageOf(item)).toContain('Value "Juz99" does not exist in "SurahJuzRef" enum');
    const after = await wireSideEffectCounts();
    expect(before).toEqual({ reportRows: 0, homeworkRows: 0, notificationRows: 0 });
    expect(after).toEqual(before);
  });
});

// ─── Section 6 — teacher-owner submit happy path + wire ≡ service equality ───

describe("permission matrix — submitSessionReport × teacher-owner (happy path, wire ≡ service)", () => {
  test("teacher-owner submit succeeds; the wire payload is field-identical to the service row for the submitted input", async () => {
    const result = await teacherOwner.mutate({
      mutation: SUBMIT_REPORT_DOC,
      variables: { id: sigmaId, input: SIGMA_SUBMIT_INPUT },
    });
    const payload = payloadOf(result, "submitSessionReport");
    expectExactReportRowShape(payload);
    expectWireReportMatchesSubmittedInput(payload);
    submittedReportRow = payload;
  });
});

// ─── Section 7 — reads matrix (both queries × all eight caller classes) ──────

describe("permission matrix — sessionReport × caller classes (participant rows + null collapse)", () => {
  test("sessionReport × student-participant → the row (content ≡ the submit's service row)", async () => {
    const result = await studentParticipant.query({ query: SESSION_REPORT_DOC, variables: { sessionId: sigmaId } });
    const payload = payloadOf(result, "sessionReport");
    expectExactReportRowShape(payload);
    if (!submittedReportRow) {
      throw new Error("the submit happy path did not anchor the report row");
    }
    expectWireReportContentMatches(payload, submittedReportRow);
    submittedReportReadRow = payload;
  });

  test("sessionReport × student-foreign → null collapse", async () => {
    const result = await studentForeign.query({ query: SESSION_REPORT_DOC, variables: { sessionId: sigmaId } });
    expectNullCollapsed(result, "sessionReport");
  });

  test("sessionReport × teacher-owner → the row (FIELD-IDENTICAL to the participant's read)", async () => {
    const result = await teacherOwner.query({ query: SESSION_REPORT_DOC, variables: { sessionId: sigmaId } });
    const payload = payloadOf(result, "sessionReport");
    expectExactReportRowShape(payload);
    if (!submittedReportReadRow) {
      throw new Error("the participant read did not anchor the report row");
    }
    expectWireRowsFieldIdentical(payload, submittedReportReadRow);
  });

  test("sessionReport × teacher-foreign → null collapse", async () => {
    const result = await teacherForeign.query({ query: SESSION_REPORT_DOC, variables: { sessionId: sigmaId } });
    expectNullCollapsed(result, "sessionReport");
  });

  test("sessionReport × parent-linked → null (owns parent reads)", async () => {
    const result = await parentLinked.query({ query: SESSION_REPORT_DOC, variables: { sessionId: sigmaId } });
    expectNullCollapsed(result, "sessionReport");
  });

  test("sessionReport × parent-other → null", async () => {
    const result = await parentOther.query({ query: SESSION_REPORT_DOC, variables: { sessionId: sigmaId } });
    expectNullCollapsed(result, "sessionReport");
  });

  test("sessionReport × admin → null (no bypass)", async () => {
    const result = await adminActor.query({ query: SESSION_REPORT_DOC, variables: { sessionId: sigmaId } });
    expectNullCollapsed(result, "sessionReport");
  });

  test("sessionReport × participant but session carries NO report yet → null (σ′)", async () => {
    const result = await teacherOwner.query({ query: SESSION_REPORT_DOC, variables: { sessionId: sigmaPrimeId } });
    expectNullCollapsed(result, "sessionReport");
  });
});

describe("permission matrix — sessionHomework × caller classes (participant rows + null collapse)", () => {
  test("sessionHomework × student-participant → the row (≡ the submitted assignment, field-for-field)", async () => {
    const result = await studentParticipant.query({ query: SESSION_HOMEWORK_DOC, variables: { sessionId: sigmaId } });
    const payload = payloadOf(result, "sessionHomework");
    expectExactHomeworkRowShape(payload);
    expectWireHomeworkMatchesSubmittedInput(payload);
    if (!submittedHomeworkRow) {
      submittedHomeworkRow = payload;
    } else {
      expectWireRowsFieldIdentical(payload, submittedHomeworkRow);
    }
  });

  test("sessionHomework × student-foreign → null collapse", async () => {
    const result = await studentForeign.query({ query: SESSION_HOMEWORK_DOC, variables: { sessionId: sigmaId } });
    expectNullCollapsed(result, "sessionHomework");
  });

  test("sessionHomework × teacher-owner → the row (≡ the submitted assignment, field-for-field)", async () => {
    const result = await teacherOwner.query({ query: SESSION_HOMEWORK_DOC, variables: { sessionId: sigmaId } });
    const payload = payloadOf(result, "sessionHomework");
    expectExactHomeworkRowShape(payload);
    if (!submittedHomeworkRow) {
      throw new Error("the participant read did not anchor the homework row");
    }
    expectWireRowsFieldIdentical(payload, submittedHomeworkRow);
  });

  test("sessionHomework × teacher-foreign → null collapse", async () => {
    const result = await teacherForeign.query({ query: SESSION_HOMEWORK_DOC, variables: { sessionId: sigmaId } });
    expectNullCollapsed(result, "sessionHomework");
  });

  test("sessionHomework × parent-linked → null (owns parent reads)", async () => {
    const result = await parentLinked.query({ query: SESSION_HOMEWORK_DOC, variables: { sessionId: sigmaId } });
    expectNullCollapsed(result, "sessionHomework");
  });

  test("sessionHomework × parent-other → null", async () => {
    const result = await parentOther.query({ query: SESSION_HOMEWORK_DOC, variables: { sessionId: sigmaId } });
    expectNullCollapsed(result, "sessionHomework");
  });

  test("sessionHomework × admin → null (no bypass)", async () => {
    const result = await adminActor.query({ query: SESSION_HOMEWORK_DOC, variables: { sessionId: sigmaId } });
    expectNullCollapsed(result, "sessionHomework");
  });

  test("sessionHomework × participant but session carries NO assignment yet → null (σ′)", async () => {
    const result = await teacherOwner.query({ query: SESSION_HOMEWORK_DOC, variables: { sessionId: sigmaPrimeId } });
    expectNullCollapsed(result, "sessionHomework");
  });
});

// ─── Section 8 — null-collapse byte identity (oracle safety) ─────────────────

describe("null-collapse byte identity — foreign-teacher read ≡ nonexistent-session read", () => {
  test("sessionReport: foreign-teacher and nonexistent-session responses are BYTE-IDENTICAL", async () => {
    const foreignToken = await signAccessToken({
      userId: cast.secondTeacher.userId,
      role: cast.secondTeacher.user.role,
    });
    const ownerToken = await signAccessToken({ userId: cast.teacher.userId, role: cast.teacher.user.role });
    const [foreign, nonexistent] = [
      await postDocumentRaw(SESSION_REPORT_DOC_TEXT, foreignToken, { sessionId: sigmaId }),
      await postDocumentRaw(SESSION_REPORT_DOC_TEXT, ownerToken, { sessionId: "999999999" }),
    ];
    // The normalized bodies are byte-identical AND exactly the minimal
    // null shape (no errors key, no partial row, no discriminator).
    expect(JSON.stringify(foreign.body)).toBe(JSON.stringify(nonexistent.body));
    expect(foreign.body).toEqual({ data: { sessionReport: null } });
  });

  test("sessionHomework: foreign-teacher and nonexistent-session responses are BYTE-IDENTICAL", async () => {
    const foreignToken = await signAccessToken({
      userId: cast.secondTeacher.userId,
      role: cast.secondTeacher.user.role,
    });
    const ownerToken = await signAccessToken({ userId: cast.teacher.userId, role: cast.teacher.user.role });
    const [foreign, nonexistent] = [
      await postDocumentRaw(SESSION_HOMEWORK_DOC_TEXT, foreignToken, { sessionId: sigmaId }),
      await postDocumentRaw(SESSION_HOMEWORK_DOC_TEXT, ownerToken, { sessionId: "999999999" }),
    ];
    expect(JSON.stringify(foreign.body)).toBe(JSON.stringify(nonexistent.body));
    expect(foreign.body).toEqual({ data: { sessionHomework: null } });
  });
});

// ─── Section 9 — duplicate submit (replay-throw at the wire) ─────────────────

describe("domain errors at the wire — duplicate submit replays SESSION_REPORT_ALREADY_EXISTS", () => {
  test("duplicate submit → SESSION_REPORT_ALREADY_EXISTS with the en copy (and grades never re-applied)", async () => {
    const body = await postDocument(
      "mutation M($id: ID!, $input: SubmitSessionReportInput!) { submitSessionReport(id: $id, input: $input) { id } }",
      await signAccessToken({ userId: cast.teacher.userId, role: cast.teacher.user.role }),
      {
        id: sigmaId,
        input: {
          ...SIGMA_SUBMIT_INPUT,
          previousGrades: { currentGrade: 88, revisionGrade: 74 },
        },
      },
      { "accept-language": "en" }
    );
    const item = expectDenialCode(body, "SESSION_REPORT_ALREADY_EXISTS");
    expect(errorMessageOf(item)).toBe(tEn.sessionReportAlreadyExists);
  });

  test("duplicate submit → SESSION_REPORT_ALREADY_EXISTS with the ar copy", async () => {
    const body = await postDocument(
      "mutation M($id: ID!, $input: SubmitSessionReportInput!) { submitSessionReport(id: $id, input: $input) { id } }",
      await signAccessToken({ userId: cast.teacher.userId, role: cast.teacher.user.role }),
      { id: sigmaId, input: SIGMA_SUBMIT_INPUT },
      { "accept-language": "ar" }
    );
    const item = expectDenialCode(body, "SESSION_REPORT_ALREADY_EXISTS");
    expect(errorMessageOf(item)).toBe(tAr.sessionReportAlreadyExists);
  });
});
