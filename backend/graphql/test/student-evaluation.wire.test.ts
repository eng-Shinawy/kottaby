/**
 * Consolidated GraphQL wire matrix — the role ×
 * operation × validation tier for the student→teacher rating surface
 * (`submitTeacherEvaluation` + `myTeacherEvaluations`) over the REAL wire
 * (HTTP → gateway pipeline → scope-auth → resolver → StudentEvaluationService
 * → PostgreSQL → back).
 *
 * Every cell of the permission matrix below is asserted ONE-TO-ONE through
 * the canonical `expectMutationError` code channel (error `code`
 * assertions ONLY — never an HTTP status probe):
 *
 *  | caller              | submitTeacherEvaluation    | myTeacherEvaluations |
 *  |---------------------|----------------------------|----------------------|
 *  | anonymous           | UNAUTHORIZED               | UNAUTHORIZED         |
 *  | student participant | row (gates apply)          | own rows only        |
 *  | student foreign     | SESSION_NOT_FOUND (oracle) | own rows only        |
 *  | teacher             | FORBIDDEN (scope)          | FORBIDDEN            |
 *  | parent              | FORBIDDEN (scope)          | FORBIDDEN            |
 *  | admin               | FORBIDDEN (scope, no bypass)| FORBIDDEN           |
 *
 * On top of the role matrix (negative sweep):
 *  - **All four spec'd service error codes pinned at the wire** —
 *    `EVALUATION_SESSION_NOT_COMPLETED` (scheduled σ′ AND the
 *    teacher-stamp-only σ″), `EVALUATION_ALREADY_SUBMITTED` (write-once
 *    re-submit), `SESSION_NOT_FOUND` (foreign ≡ nonexistent,
 *    byte-identical denial), `VALIDATION` (rating outside 1..5 AND a
 *    malformed session id).
 *  - **`extensions.fields` present on the star-range VALIDATION** — the
 *    single projected field entry `{field: "rating",
 *    code: "TEACHER_RATING_INVALID"}` rides the same envelope; the
 *    malformed-id VALIDATION carries NO fields (bare message channel).
 *  - **Happy path returns the row** — `score = rating × 20` (4★ → 80),
 *    `evaluatedId` = the session's teacher (server-derived), `evaluatorId` =
 *    the calling student (server-derived), the session link, an ISO instant.
 *  - **Caller-scoped read (two students)** — `myTeacherEvaluations` answers
 *    `[]` (never null) before any rating, then EXACTLY the caller's own row;
 *    the two raters' lists never bleed into each other (the rater id is the
 *    read's only filter and it is server-bound).
 *  - **Envelope parity** — every denial carries EXACTLY one error item with
 *    the expected `extensions.code`, a correlated `requestId`, and NEVER a
 *    stacktrace; localized denial copy is resolved through
 *    `getServerTranslations` (never hardcoded strings). Both roots are
 *    NON-nullable (`Evaluation!` payload / `[Evaluation!]!` list), so every
 *    denial nulls the WHOLE data object.
 *
 * Fixture strategy (session-report wire-suite conventions): a real committed
 * cast via `buildSessionJourneyCast` (real `users.role` rows + role children
 * + certified teachers, tracked for hard-delete cleanup) and REAL access
 * tokens (same `signAccessToken` the auth layer issues). σ reaches dual
 * confirmation through the REAL lifecycle over the wire (book → start →
 * complete → student confirm); σ′ stays `scheduled`; σ″ is teacher-stamped
 * but never student-confirmed; σ₂ is the second student's own dual-confirmed
 * rating target. Evaluation rows, the teacher's earning ledger, notification
 * rows, and the cast itself are removed in `afterAll` (FK-safe order).
 * Nothing is monkey-patched, no service is mocked.
 *
 * Mandated runner:
 *   bun run test:graphql backend/graphql/test/student-evaluation.wire.test.ts
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { ApolloClient, gql, HttpLink, InMemoryCache } from "@apollo/client";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/backend/db";
import { teacherTransaction } from "@/backend/db/schema/billing/teacher-transaction";
import { wallet } from "@/backend/db/schema/billing/wallet";
import { notifications } from "@/backend/db/schema/notifications/notifications";
import { evaluations } from "@/backend/db/schema/teachers/evaluations";
import { signAccessToken } from "@/backend/lib/auth/jwt";
import { getServerTranslations } from "@/shared/locale/server-graphql";
import { expectMutationError, setupTestServerLifecycle, TEST_PORT, testClient } from "@/test/helpers";
import { withImmutabilityTriggersSuspended } from "@/test/helpers/db-cleanup";
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
const PREFIX = journeyPrefix("studevalwire");

const KEY_SIGMA = `${PREFIX}-key-sigma`;
const KEY_SIGMA_PRIME = `${PREFIX}-key-sigma-prime`;
const KEY_SIGMA_STAMP_ONLY = `${PREFIX}-key-sigma-stamp-only`;
const KEY_SIGMA_TWO = `${PREFIX}-key-sigma-two`;

/** The fixture registry — cast rows AND wire-created rows hard-deleted in afterAll. */
const registry = createSessionFixtureRegistry();

let cast: SessionJourneyCast;
let sigmaId = "";
let sigmaPrimeId = "";
let sigmaStampOnlyId = "";
let sigmaTwoId = "";

/** Evaluation rows captured from the wire itself (happy-path + scoping legs). */
let submittedEvaluation: Record<string, unknown> | null = null;
let secondStudentEvaluation: Record<string, unknown> | null = null;

// Actor-scoped clients (Bearer identity, per the lifecycle wire-suite pattern).
let studentPrimary: ApolloClient;
let studentSecond: ApolloClient;
let teacherActor: ApolloClient;
let parentActor: ApolloClient;
let adminActor: ApolloClient;

// ─── Locale-key expected copy (never hardcoded strings — 3.4.SR) ─────────────

const tEn = getServerTranslations("en").errorsTranslations;

// ─── Documents (id-first selections — Apollo cache normalization pin) ────────

const SUBMIT_EVALUATION_DOC = gql`
  mutation WireSubmitTeacherEvaluation($sessionId: ID!, $input: SubmitTeacherEvaluationInput!) {
    submitTeacherEvaluation(sessionId: $sessionId, input: $input) {
      id
      evaluatedId
      evaluatorId
      sessionId
      score
      createdAt
    }
  }
`;

const MY_EVALUATIONS_DOC = gql`
  query WireMyTeacherEvaluations {
    myTeacherEvaluations {
      id
      evaluatedId
      evaluatorId
      sessionId
      score
      createdAt
    }
  }
`;

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

const CONFIRM_SESSION_DOC = gql`
  mutation WireConfirmSessionCompletion($id: ID!) {
    confirmSessionCompletion(id: $id) {
      id
    }
  }
`;

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
 * requestId, and NEVER a stacktrace (no leaked internals). BOTH roots of
 * this surface are NON-nullable (`Evaluation!` / `[Evaluation!]!`), so every
 * denial — scope death, boundary-guard death, service DomainError — nulls
 * the WHOLE data object.
 */
function expectDenialCode(body: Record<string, unknown>, expectedCode: string): Record<string, unknown> {
  const errorItem = soleErrorItemOf(body);
  expect(errorCodeOf(errorItem)).toBe(expectedCode);
  expect(body.data).toBeNull();
  const requestId = recordOf(errorItem.extensions, "expected extensions").requestId;
  expect(typeof requestId === "string" && requestId.length > 0).toBe(true);
  expect(JSON.stringify(errorItem)).not.toContain("stacktrace");
  return errorItem;
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

/** Extracts the root-field payload list of a happy-path result. */
function listPayloadOf(result: { readonly data?: unknown }, rootField: string): Record<string, unknown>[] {
  if (!isRecord(result.data)) {
    throw new Error(`missing data for ${rootField}`);
  }
  const payload: unknown = result.data[rootField];
  if (!Array.isArray(payload)) {
    throw new Error(`missing ${rootField} list payload in response data`);
  }
  return payload.map(entry => recordOf(entry, "expected record-shaped list rows"));
}

/**
 * Every `Evaluation` wire row carries EXACTLY the six canonical keys. The
 * actor-scoped clients are Apollo `InMemoryCache` pipelines, whose
 * normalization step injects `__typename` into every returned object
 * CLIENT-side — strip the injected key before the exact-key comparison so
 * the probe keeps asserting what the WIRE exposed (canonical columns only,
 * zero soft-delete/notes/update-stamp leakage).
 */
function expectExactEvaluationRowShape(row: Record<string, unknown>): void {
  const { __typename: _apolloInjected, ...wireRow } = row;
  expect(Object.keys(wireRow).toSorted((a, b) => a.localeCompare(b))).toEqual(
    ["createdAt", "evaluatedId", "evaluatorId", "id", "score", "sessionId"].toSorted((a, b) => a.localeCompare(b))
  );
}

// ─── Wire helpers (raw fetch where envelope shape / headers matter) ──────────

const GRAPHQL_URL = `http://localhost:${TEST_PORT}/api/graphql`;

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

/**
 * Drives one booked session through the REAL dual-confirmation handshake
 * over the wire: the teacher starts, the teacher completes (teacher stamp +
 * the student's confirm prompt), the student confirms (student stamp; the
 * hold releases and the teacher is credited as a REAL financial side
 * effect — reconciled in afterAll).
 */
async function driveToDualConfirmation(studentClient: ApolloClient, sessionId: string): Promise<void> {
  const started = await teacherActor.mutate({ mutation: START_SESSION_DOC, variables: { id: sessionId } });
  payloadOf(started, "startSession");
  const completed = await teacherActor.mutate({ mutation: COMPLETE_SESSION_DOC, variables: { id: sessionId } });
  payloadOf(completed, "completeSession");
  const confirmed = await studentClient.mutate({ mutation: CONFIRM_SESSION_DOC, variables: { id: sessionId } });
  payloadOf(confirmed, "confirmSessionCompletion");
}

/** Submits one rating over the wire and returns the Evaluation row payload. */
async function submitRating(client: ApolloClient, sessionId: string, rating: number): Promise<Record<string, unknown>> {
  const result = await client.mutate({
    mutation: SUBMIT_EVALUATION_DOC,
    variables: { sessionId, input: { rating } },
  });
  return payloadOf(result, "submitTeacherEvaluation");
}

// ─── Fixtures (committed cast + pre-driven lifecycle targets) ───────────────

beforeAll(async () => {
  // Committed cast — the primary student funded for THREE bookings (σ, σ′,
  // σ″; none cancelled), the second student funded for ONE (σ₂).
  await db.transaction(async tx => {
    cast = await buildSessionJourneyCast(tx, registry, {
      prefix: PREFIX,
      primaryStudent: { trial: 3 },
      secondStudent: { trial: 1 },
    });
  });

  // Real access tokens for every actor (same signer the auth layer uses).
  const [tokenPrimary, tokenSecond, tokenTeacher, tokenParent, tokenAdmin] = await Promise.all([
    signAccessToken({ userId: cast.primaryStudent.userId, role: cast.primaryStudent.user.role }),
    signAccessToken({ userId: cast.secondStudent.userId, role: cast.secondStudent.user.role }),
    signAccessToken({ userId: cast.teacher.userId, role: cast.teacher.user.role }),
    signAccessToken({ userId: cast.parent.userId, role: cast.parent.user.role }),
    signAccessToken({ userId: cast.admin.userId, role: cast.admin.user.role }),
  ]);

  studentPrimary = clientFor(tokenPrimary);
  studentSecond = clientFor(tokenSecond);
  teacherActor = clientFor(tokenTeacher);
  parentActor = clientFor(tokenParent);
  adminActor = clientFor(tokenAdmin);

  // Pre-drive the lifecycle targets over the wire. Sequential — the
  // trial-lane ladders drain in booking order:
  //   σ   dual-confirmed  (happy path + write-once target, primary student)
  //   σ′  scheduled       (not-completed gate target, primary student)
  //   σ″  teacher-stamped only (the OTHER not-completed shape, primary)
  //   σ₂  dual-confirmed  (the second student's own rating target)
  sigmaId = await bookSession(tokenPrimary, KEY_SIGMA, cast.teacher.userId);
  registry.track("session", Number(sigmaId));
  await driveToDualConfirmation(studentPrimary, sigmaId);

  sigmaPrimeId = await bookSession(tokenPrimary, KEY_SIGMA_PRIME, cast.teacher.userId);
  registry.track("session", Number(sigmaPrimeId));

  sigmaStampOnlyId = await bookSession(tokenPrimary, KEY_SIGMA_STAMP_ONLY, cast.teacher.userId);
  registry.track("session", Number(sigmaStampOnlyId));
  const stampStarted = await teacherActor.mutate({
    mutation: START_SESSION_DOC,
    variables: { id: sigmaStampOnlyId },
  });
  payloadOf(stampStarted, "startSession");
  const stampCompleted = await teacherActor.mutate({
    mutation: COMPLETE_SESSION_DOC,
    variables: { id: sigmaStampOnlyId },
  });
  payloadOf(stampCompleted, "completeSession");

  sigmaTwoId = await bookSession(tokenSecond, KEY_SIGMA_TWO, cast.teacher.userId);
  registry.track("session", Number(sigmaTwoId));
  await driveToDualConfirmation(studentSecond, sigmaTwoId);
}, 240_000);

afterAll(async () => {
  // FK-safe order: the earning-ledger rows the confirmation legs created
  // are append-only (DELETE-blocked) and restrict-delete their way into the
  // teacher's wallet, which the cast teardown would otherwise cascade away
  // with the teacher row. They are removed under the sanctioned
  // append-only trigger suspension BEFORE the registry sweep.
  const teacherWalletRows = await db.select().from(wallet).where(eq(wallet.teacherId, cast.teacher.userId)).limit(1);
  const teacherWallet = teacherWalletRows[0];
  if (teacherWallet) {
    await withImmutabilityTriggersSuspended(["teacher_transaction"], async () => {
      await db.delete(teacherTransaction).where(eq(teacherTransaction.walletId, teacherWallet.id));
    });
  }

  // The completion-prompt notification rows the lifecycle legs created
  // (one per completed session, targeting the confirming student) are
  // deleted before the registry sweep.
  const fixtureUserIds = [
    cast.primaryStudent.userId,
    cast.secondStudent.userId,
    cast.teacher.userId,
    cast.secondTeacher.userId,
    cast.parent.userId,
    cast.applicant.userId,
    cast.admin.userId,
  ].filter(id => id > 0);
  if (fixtureUserIds.length > 0) {
    await db.delete(notifications).where(inArray(notifications.userId, fixtureUserIds));
  }

  // Snapshot the tracked rating ids BEFORE the sweep clears the registry,
  // then prove zero residue (the evaluator_id FK is RESTRICT — users last).
  const trackedEvaluationIds = registry.ids("evaluations").slice();
  await registry.cleanup();
  const trackedEvaluationResidues = await Promise.all(
    trackedEvaluationIds.map(async id => db.$count(evaluations, eq(evaluations.id, id)))
  );
  for (const residue of trackedEvaluationResidues) {
    expect(residue).toBe(0);
  }
}, 60_000);

// ─── Section 1 — anonymous tier (pre-resolver) ───────────────────────────────

describe("role matrix — anonymous tier", () => {
  test("submitTeacherEvaluation × anonymous → UNAUTHORIZED", async () => {
    const result = await testClient.mutate({
      mutation: SUBMIT_EVALUATION_DOC,
      variables: { sessionId: sigmaId, input: { rating: 4 } },
    });
    const error = expectMutationError(result.error, "UNAUTHORIZED");
    expect(error.errors).toHaveLength(1);
  });

  test("myTeacherEvaluations × anonymous → UNAUTHORIZED", async () => {
    const result = await testClient.query({ query: MY_EVALUATIONS_DOC });
    const error = expectMutationError(result.error, "UNAUTHORIZED");
    expect(error.errors).toHaveLength(1);
  });

  test("the anonymous denial is the constant localized copy on BOTH roots (raw envelope parity)", async () => {
    const [submitBody, queryBody] = await Promise.all([
      postAnonymous('mutation M { submitTeacherEvaluation(sessionId: "1", input: { rating: 4 }) { id } }'),
      postAnonymous("query Q { myTeacherEvaluations { id } }"),
    ]);
    const submitItem = expectDenialCode(submitBody, "UNAUTHORIZED");
    const queryItem = expectDenialCode(queryBody, "UNAUTHORIZED");
    expect(errorMessageOf(submitItem)).toBe(tEn.unauthorized);
    expect(errorMessageOf(queryItem)).toBe(tEn.unauthorized);
  });
});

// ─── Section 2 — teacher/parent/admin role denials (role matrix) ─────────────

describe("role matrix — teacher/parent/admin callers (pre-resolver scope)", () => {
  test("submitTeacherEvaluation × teacher → FORBIDDEN", async () => {
    const result = await teacherActor.mutate({
      mutation: SUBMIT_EVALUATION_DOC,
      variables: { sessionId: sigmaId, input: { rating: 4 } },
    });
    const error = expectMutationError(result.error, "FORBIDDEN");
    expect(error.errors).toHaveLength(1);
  });

  test("submitTeacherEvaluation × parent → FORBIDDEN", async () => {
    const result = await parentActor.mutate({
      mutation: SUBMIT_EVALUATION_DOC,
      variables: { sessionId: sigmaId, input: { rating: 4 } },
    });
    const error = expectMutationError(result.error, "FORBIDDEN");
    expect(error.errors).toHaveLength(1);
  });

  test("submitTeacherEvaluation × admin → FORBIDDEN (no bypass)", async () => {
    const result = await adminActor.mutate({
      mutation: SUBMIT_EVALUATION_DOC,
      variables: { sessionId: sigmaId, input: { rating: 4 } },
    });
    const error = expectMutationError(result.error, "FORBIDDEN");
    expect(error.errors).toHaveLength(1);
  });

  test("myTeacherEvaluations × teacher → FORBIDDEN", async () => {
    const result = await teacherActor.query({ query: MY_EVALUATIONS_DOC });
    const error = expectMutationError(result.error, "FORBIDDEN");
    expect(error.errors).toHaveLength(1);
  });

  test("myTeacherEvaluations × parent → FORBIDDEN", async () => {
    const result = await parentActor.query({ query: MY_EVALUATIONS_DOC });
    const error = expectMutationError(result.error, "FORBIDDEN");
    expect(error.errors).toHaveLength(1);
  });

  test("myTeacherEvaluations × admin → FORBIDDEN (no bypass)", async () => {
    const result = await adminActor.query({ query: MY_EVALUATIONS_DOC });
    const error = expectMutationError(result.error, "FORBIDDEN");
    expect(error.errors).toHaveLength(1);
  });

  test("every role denial message is the constant localized copy (no payload/identity echo)", async () => {
    const body = await postDocument(
      'mutation M { submitTeacherEvaluation(sessionId: "1", input: { rating: 4 }) { id } }',
      await signAccessToken({ userId: cast.admin.userId, role: cast.admin.user.role })
    );
    const item = expectDenialCode(body, "FORBIDDEN");
    expect(errorMessageOf(item)).toBe(tEn.forbidden);
  });
});

// ─── Section 3 — the four spec'd service error codes at the wire ─────────────

describe("service error codes at the wire", () => {
  test("scheduled σ′ → EVALUATION_SESSION_NOT_COMPLETED with the localized copy (en)", async () => {
    const body = await postDocument(
      "mutation M($sessionId: ID!, $input: SubmitTeacherEvaluationInput!) { submitTeacherEvaluation(sessionId: $sessionId, input: $input) { id } }",
      await signAccessToken({ userId: cast.primaryStudent.userId, role: cast.primaryStudent.user.role }),
      { sessionId: sigmaPrimeId, input: { rating: 4 } },
      { "accept-language": "en" }
    );
    const item = expectDenialCode(body, "EVALUATION_SESSION_NOT_COMPLETED");
    expect(errorMessageOf(item)).toBe(tEn.evaluationSessionNotCompleted);
  });

  test("teacher-stamp-only σ″ (student stamp absent) → the same not-completed channel", async () => {
    const result = await studentPrimary.mutate({
      mutation: SUBMIT_EVALUATION_DOC,
      variables: { sessionId: sigmaStampOnlyId, input: { rating: 4 } },
    });
    const error = expectMutationError(result.error, "EVALUATION_SESSION_NOT_COMPLETED");
    expect(error.errors).toHaveLength(1);
  });

  test("foreign student × σ → SESSION_NOT_FOUND (oracle-safe, no existence delta)", async () => {
    const body = await postDocument(
      "mutation M($sessionId: ID!, $input: SubmitTeacherEvaluationInput!) { submitTeacherEvaluation(sessionId: $sessionId, input: $input) { id } }",
      await signAccessToken({ userId: cast.secondStudent.userId, role: cast.secondStudent.user.role }),
      { sessionId: sigmaId, input: { rating: 4 } }
    );
    const item = expectDenialCode(body, "SESSION_NOT_FOUND");
    // The oracle-safe generic copy — the message never distinguishes a
    // foreign session from a nonexistent one (no existence delta).
    expect(errorMessageOf(item)).toBe(tEn.sessionNotFound);
  });

  test("unknown session id ≡ foreign session: byte-identical denial (raw-body oracle pin)", async () => {
    const foreignBody = await postDocument(
      "mutation M($sessionId: ID!, $input: SubmitTeacherEvaluationInput!) { submitTeacherEvaluation(sessionId: $sessionId, input: $input) { id } }",
      await signAccessToken({ userId: cast.secondStudent.userId, role: cast.secondStudent.user.role }),
      { sessionId: sigmaId, input: { rating: 4 } }
    );
    const unknownBody = await postDocument(
      "mutation M($sessionId: ID!, $input: SubmitTeacherEvaluationInput!) { submitTeacherEvaluation(sessionId: $sessionId, input: $input) { id } }",
      await signAccessToken({ userId: cast.secondStudent.userId, role: cast.secondStudent.user.role }),
      { sessionId: "2000000000", input: { rating: 4 } }
    );
    const foreignItem = expectDenialCode(foreignBody, "SESSION_NOT_FOUND");
    const unknownItem = expectDenialCode(unknownBody, "SESSION_NOT_FOUND");
    // Byte-identity: same code AND same message; neither echoes the probed id.
    expect(errorMessageOf(unknownItem)).toBe(errorMessageOf(foreignItem));
    expect(errorMessageOf(unknownItem)).toBe(tEn.sessionNotFound);
    expect(JSON.stringify(unknownBody)).not.toContain("2000000000");
  });
});

// ─── Section 4 — happy path + write-once + validation at the wire ────────────

describe("happy path, write-once re-submit, and validation at the wire", () => {
  test("primary student rates σ (4★) → the row with score = rating × 20, server-derived identities", async () => {
    const row = await submitRating(studentPrimary, sigmaId, 4);
    submittedEvaluation = row;
    registry.track("evaluations", Number(row.id));

    expectExactEvaluationRowShape(row);
    expect(typeof row.id === "string" && row.id.length > 0).toBe(true);
    expect(row.evaluatedId).toBe(cast.teacher.userId);
    expect(row.evaluatorId).toBe(cast.primaryStudent.userId);
    expect(row.sessionId).toBe(Number(sigmaId));
    expect(row.score).toBe(80);
    expect(typeof row.createdAt === "string" && !Number.isNaN(Date.parse(row.createdAt))).toBe(true);
  });

  test("re-submitting σ → EVALUATION_ALREADY_SUBMITTED; the stored rating is untouched", async () => {
    const result = await studentPrimary.mutate({
      mutation: SUBMIT_EVALUATION_DOC,
      variables: { sessionId: sigmaId, input: { rating: 5 } },
    });
    const error = expectMutationError(result.error, "EVALUATION_ALREADY_SUBMITTED");
    expect(error.errors).toHaveLength(1);

    // Exactly the same single row, field-identical — the denial inserted
    // nothing and mutated nothing (write-once; no replace surface).
    const list = listPayloadOf(await studentPrimary.query({ query: MY_EVALUATIONS_DOC }), "myTeacherEvaluations");
    expect(list).toHaveLength(1);
    const anchor = recordOf(submittedEvaluation, "expected the happy-path row");
    expect(list[0]?.id).toBe(anchor.id);
    expect(list[0]?.score).toBe(80);
    expect(list[0]?.evaluatedId).toBe(cast.teacher.userId);
  });

  test("rating 6 → VALIDATION with extensions.fields projecting ONLY the rating field", async () => {
    const result = await studentPrimary.mutate({
      mutation: SUBMIT_EVALUATION_DOC,
      variables: { sessionId: sigmaPrimeId, input: { rating: 6 } },
    });
    const error = expectMutationError(result.error, "VALIDATION");
    expect(error.errors).toHaveLength(1);
    const item = recordOf(error.errors[0], "expected a record-shaped error item");
    const extensions = recordOf(item.extensions, "expected record-shaped extensions");
    expect(extensions.fields).toEqual([
      { field: "rating", code: "TEACHER_RATING_INVALID", message: tEn.teacherRatingInvalid },
    ]);
  });

  test("malformed session id → VALIDATION (boundary guard, bare message channel — no fields)", async () => {
    const result = await studentPrimary.mutate({
      mutation: SUBMIT_EVALUATION_DOC,
      variables: { sessionId: "not-a-number", input: { rating: 4 } },
    });
    const error = expectMutationError(result.error, "VALIDATION");
    expect(error.errors).toHaveLength(1);
    const item = recordOf(error.errors[0], "expected a record-shaped error item");
    const extensions = recordOf(item.extensions, "expected record-shaped extensions");
    expect(extensions.fields).toBeUndefined();
  });
});

// ─── Section 5 — caller-scoped read (two students; empty shape; no bleed) ────

describe("myTeacherEvaluations — caller-scoped read across two students", () => {
  test("the second student's list is the EMPTY list before their first rating (never null)", async () => {
    const result = await studentSecond.query({ query: MY_EVALUATIONS_DOC });
    expect(result.error).toBeUndefined();
    expect(listPayloadOf(result, "myTeacherEvaluations")).toEqual([]);
  });

  test("the primary student's list is EXACTLY their own σ row (rater-bound scoping)", async () => {
    const result = await studentPrimary.query({ query: MY_EVALUATIONS_DOC });
    expect(result.error).toBeUndefined();
    const list = listPayloadOf(result, "myTeacherEvaluations");
    expect(list).toHaveLength(1);
    const anchor = recordOf(submittedEvaluation, "expected the happy-path row");
    expectExactEvaluationRowShape(list[0] ?? {});
    expect(list[0]?.id).toBe(anchor.id);
    expect(list[0]?.evaluatorId).toBe(cast.primaryStudent.userId);
    expect(list[0]?.evaluatedId).toBe(cast.teacher.userId);
    expect(list[0]?.sessionId).toBe(Number(sigmaId));
    expect(list[0]?.score).toBe(80);
  });

  test("the second student rates σ₂ (5★) → their own row; the two raters' lists never bleed", async () => {
    const row = await submitRating(studentSecond, sigmaTwoId, 5);
    secondStudentEvaluation = row;
    registry.track("evaluations", Number(row.id));

    expectExactEvaluationRowShape(row);
    expect(row.score).toBe(100);
    expect(row.evaluatorId).toBe(cast.secondStudent.userId);
    expect(row.evaluatedId).toBe(cast.teacher.userId);
    expect(row.sessionId).toBe(Number(sigmaTwoId));

    // Each caller sees EXACTLY their own row — the evaluator id is the
    // read's only filter and it is server-bound (no argument exists).
    const primaryList = listPayloadOf(
      await studentPrimary.query({ query: MY_EVALUATIONS_DOC }),
      "myTeacherEvaluations"
    );
    expect(primaryList).toHaveLength(1);
    expect(primaryList[0]?.id).toBe(recordOf(submittedEvaluation, "expected the happy-path row").id);
    expect(primaryList[0]?.evaluatorId).toBe(cast.primaryStudent.userId);
    expect(primaryList[0]?.sessionId).toBe(Number(sigmaId));

    const secondList = listPayloadOf(await studentSecond.query({ query: MY_EVALUATIONS_DOC }), "myTeacherEvaluations");
    expect(secondList).toHaveLength(1);
    expect(secondList[0]?.id).toBe(recordOf(secondStudentEvaluation, "expected the second student's row").id);
    expect(secondList[0]?.evaluatorId).toBe(cast.secondStudent.userId);
    expect(secondList[0]?.sessionId).toBe(Number(sigmaTwoId));
  });
});
