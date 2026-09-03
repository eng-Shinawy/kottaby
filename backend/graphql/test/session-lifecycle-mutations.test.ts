/**
 * REQ-064 mutation-cell integration matrix — session lifecycle mutations
 * over the LIVE GraphQL boundary (`setupTestServerLifecycle` + `testClient`
 * harness; mandated runner at the bottom).
 *
 * Every REQ-064 MUTATION cell is asserted with `expectMutationError`
 * (`extensions.code` asserted EXACTLY per REQ-050):
 *  - Anonymous on every op → `UNAUTHORIZED` (401).
 *  - Wrong authenticated role on role-gated ops → `FORBIDDEN` (403) —
 *    incl. the Ruling 2026-08-30 (B3) cells: teacher-role callers
 *    (certified AND applicant) are unconditionally FORBIDDEN on
 *    `createSession`.
 *  - Missing idempotency key on `createSession` → `VALIDATION` (pre-DB).
 *  - Same-key replay → `DUPLICATE_REQUEST` (409) on the second call.
 *  - Hostile booking intent (`Evaluation`) → `VALIDATION` (service guard).
 *  - Malformed target id (`"12abc"`) → `VALIDATION` (REQ-054 pre-DB
 *    id-shape guard on the service boundary — never a masked 500).
 *  - Nonexistent/uncertifiable `teacherId` (an applicant's users.id) →
 *    `TEACHER_NOT_FOUND`.
 *  - Terminal/regressive transitions → `SESSION_INVALID_TRANSITION`
 *    (double start, double complete, start-after-complete, double cancel,
 *    complete-while-scheduled).
 *  - Decertified `completeSession` → `TEACHER_NOT_CERTIFIED`.
 *  - `cancelSession` non-participant/nonexistent → `SESSION_NOT_FOUND`
 *    (oracle pairing: foreign student ≡ nonexistent id ≡ parent ≡ admin —
 *    NO admin bypass).
 *  - Happy paths return the live `Session` payload (id first, status
 *    chips, hold marker) and the cancel leg proves the same-lane refund
 *    through the full stack.
 *
 * Fixtures: a real committed cast (real `users.role` + role-child rows via
 * `@/test/workflows/helpers` builders) + per-run `jrn_*` idempotency keys;
 * every created session id is registered for the FK-safe hard-delete
 * cleanup. Identity rides minted-but-real access tokens (same
 * `signAccessToken` the auth layer issues; the spawned server verifies
 * them with the same env) — nothing is monkey-patched.
 *
 * Run:
 *   bun run test/scripts/run-test.ts backend/graphql/test/session-lifecycle-mutations.test.ts
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { ApolloClient, gql, HttpLink, InMemoryCache } from "@apollo/client";
import { eq } from "drizzle-orm";
import { db } from "@/backend/db";
import { students } from "@/backend/db/schema/students/students";
import { teacher } from "@/backend/db/schema/teachers/teacher";
import { signAccessToken } from "@/backend/lib/auth/jwt";
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

/** Per-run prefix — unique user labels AND idempotency keys per suite run. */
const PREFIX = journeyPrefix("sessmut");

const KEY_A = `${PREFIX}-key-a`;
const KEY_B = `${PREFIX}-key-b`;
const KEY_C = `${PREFIX}-key-c`;
const KEY_D = `${PREFIX}-key-d`;
const KEY_REPLAY = `${PREFIX}-key-replay`;
const KEY_PROBE = `${PREFIX}-key-probe`;

/** The fixture registry — every created session id is hard-deleted in afterAll. */
const registry = createSessionFixtureRegistry();

let cast: SessionJourneyCast;

// Actor-scoped clients (Bearer identity + fixed idempotency key per client).
let studentA: ApolloClient; // primary student
let studentB: ApolloClient; // second student (foreign actor)
let teacherT: ApolloClient; // certified owner teacher
let teacher2: ApolloClient; // second certified teacher (foreign)
let applicant: ApolloClient;
let parent: ApolloClient;
let admin: ApolloClient;

// Clients for idempotency-variance cells (one fixed key each).
let studentNoKey: ApolloClient; // NO idempotency header
let studentReplay: ApolloClient; // fixed KEY_REPLAY
let studentProbe: ApolloClient; // fixed KEY_PROBE (fresh — the probe's own
// claim rolls back with its denial, so the key is never burned)

/** Booked-session ids shared across the sequential transition legs. */
let sessionAId = "";
let sessionBId = "";
let sessionCId = "";
let sessionDId = "";

// ─── Documents ───────────────────────────────────────────────────────────────

const CREATE_SESSION_DOC = gql`
  mutation CreateSession($input: CreateSessionInput!) {
    createSession(input: $input) {
      id
      teacherId
      studentId
      status
      sessionType
      intent
      fee
      feeHeld
      confirmationDeadline
      createdAt
      updatedAt
    }
  }
`;

const START_SESSION_DOC = gql`
  mutation StartSession($id: ID!) {
    startSession(id: $id) {
      id
      status
      startedAt
    }
  }
`;

const COMPLETE_SESSION_DOC = gql`
  mutation CompleteSession($id: ID!) {
    completeSession(id: $id) {
      id
      status
      endedAt
      confirmedByTeacherAt
    }
  }
`;

const CANCEL_SESSION_DOC = gql`
  mutation CancelSession($id: ID!, $reason: String) {
    cancelSession(id: $id, reason: $reason) {
      id
      status
      feeHeld
    }
  }
`;

// ─── Narrowing helpers (runtime-guarded — zero casts) ────────────────────────

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Extracts the root-field payload object of a happy-path mutation result. */
function payloadOf(result: { readonly data?: unknown }, rootField: string): Record<string, unknown> {
  if (!isRecord(result.data)) {
    throw new Error(`missing data for ${rootField} (error: ${String(result.data)})`);
  }
  const payload: unknown = result.data[rootField];
  if (!isRecord(payload)) {
    throw new Error(`missing ${rootField} payload in response data`);
  }
  return payload;
}

/** Builds an actor-scoped client — real Bearer identity + optional key header. */
function clientFor(accessToken: string | null, idempotencyKey: string | null = null): ApolloClient {
  return new ApolloClient({
    link: new HttpLink({
      uri: `http://localhost:${TEST_PORT}/api/graphql`,
      headers: {
        ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
        ...(idempotencyKey ? { "x-idempotency-key": idempotencyKey } : {}),
      },
    }),
    cache: new InMemoryCache(),
    defaultOptions: {
      query: { errorPolicy: "all", fetchPolicy: "no-cache" },
      mutate: { errorPolicy: "all", fetchPolicy: "no-cache" },
      watchQuery: { errorPolicy: "all", fetchPolicy: "no-cache" },
    },
  });
}

/** Mints a REAL access token for a cast user (verified by the live server). */
async function tokenFor(userId: number, role: string): Promise<string> {
  return signAccessToken({ userId, role });
}

/** Books one happy-path session over the wire under a UNIQUE idempotency key. */
async function bookSession(accessToken: string, key: string, teacherId: number): Promise<string> {
  const client = clientFor(accessToken, key);
  const result = await client.mutate({
    mutation: CREATE_SESSION_DOC,
    variables: { input: { teacherId, intent: "Hifz" } },
  });
  const payload = payloadOf(result, "createSession");
  const id: unknown = payload.id;
  if (typeof id !== "string" && typeof id !== "number") {
    throw new Error("createSession returned no id");
  }
  return String(id);
}

/** Registers a created session id for FK-safe cleanup. */
function trackSession(id: string): void {
  registry.track("session", Number(id));
}

/** Reads one student's hifz lane balance (the refund-proof lane). */
async function readHifzBalance(studentUserId: number): Promise<number> {
  const rows = await db
    .select({ balanceHifz: students.balanceHifz })
    .from(students)
    .where(eq(students.id, studentUserId));
  const balance: unknown = rows[0]?.balanceHifz;
  if (typeof balance !== "number") {
    throw new Error(`no students row found for user ${String(studentUserId)}`);
  }
  return balance;
}

// ─── Fixtures (committed cast + pre-booked lifecycle targets) ───────────────

beforeAll(async () => {
  // Committed cast — primary student funded for FOUR net bookings (A trial +
  // B/C paid-lane + the replay pair's FIRST booking) PLUS one spare hifz
  // unit of ladder headroom: the createSession contract runs the trial-first
  // debit ladder BEFORE the idempotency-claim insert (the service suite's
  // pinned REQ-043(e) order — a replay's ladder debit is undone by the
  // DUPLICATE_REQUEST rollback), so the replay RETRY and the applicant-
  // teacherId probe must still clear the ladder to reach the code under
  // test. Their debits roll back with their denials — one spare unit is
  // never permanently consumed. Second student funded for ONE (D).
  await db.transaction(async tx => {
    cast = await buildSessionJourneyCast(tx, registry, {
      prefix: PREFIX,
      primaryStudent: { trial: 1, hifz: 4 },
      secondStudent: { hifz: 1 },
    });
  });

  // Real access tokens for every actor (same signer the auth layer uses).
  const [tokenStudentA, tokenStudentB, tokenTeacherT, tokenTeacher2, tokenApplicant, tokenParent, tokenAdmin] =
    await Promise.all([
      tokenFor(cast.primaryStudent.userId, cast.primaryStudent.user.role),
      tokenFor(cast.secondStudent.userId, cast.secondStudent.user.role),
      tokenFor(cast.teacher.userId, cast.teacher.user.role),
      tokenFor(cast.secondTeacher.userId, cast.secondTeacher.user.role),
      tokenFor(cast.applicant.userId, cast.applicant.user.role),
      tokenFor(cast.parent.userId, cast.parent.user.role),
      tokenFor(cast.admin.userId, cast.admin.user.role),
    ]);

  studentA = clientFor(tokenStudentA);
  studentB = clientFor(tokenStudentB);
  teacherT = clientFor(tokenTeacherT);
  teacher2 = clientFor(tokenTeacher2);
  applicant = clientFor(tokenApplicant);
  parent = clientFor(tokenParent);
  admin = clientFor(tokenAdmin);
  studentNoKey = clientFor(tokenStudentA);
  studentReplay = clientFor(tokenStudentA, KEY_REPLAY);
  studentProbe = clientFor(tokenStudentA, KEY_PROBE);

  // Pre-book the four transition targets under DISTINCT per-run keys. A
  // drains the trial lane; B and C bind the hifz lane; D belongs to the
  // second student against the SECOND teacher (the decertification leg).
  // Sequential — lane order matters.
  sessionAId = await bookSession(tokenStudentA, KEY_A, cast.teacher.userId);
  sessionBId = await bookSession(tokenStudentA, KEY_B, cast.teacher.userId);
  sessionCId = await bookSession(tokenStudentA, KEY_C, cast.teacher.userId);
  sessionDId = await bookSession(tokenStudentB, KEY_D, cast.secondTeacher.userId);
  trackSession(sessionAId);
  trackSession(sessionBId);
  trackSession(sessionCId);
  trackSession(sessionDId);
}, 240_000);

afterAll(async () => {
  await registry.cleanup();
});

// ─── Section 1 — anonymous callers: UNAUTHORIZED on every mutation ──────────

describe("REQ-064 mutation matrix — anonymous callers (UNAUTHORIZED)", () => {
  test("anonymous createSession → UNAUTHORIZED", async () => {
    const result = await testClient.mutate({
      mutation: CREATE_SESSION_DOC,
      variables: { input: { teacherId: 1, intent: "Hifz" } },
    });
    expect(result.error).toBeDefined();
    expectMutationError(result.error, "UNAUTHORIZED");
  });

  test("anonymous startSession → UNAUTHORIZED", async () => {
    const result = await testClient.mutate({ mutation: START_SESSION_DOC, variables: { id: sessionAId } });
    expect(result.error).toBeDefined();
    expectMutationError(result.error, "UNAUTHORIZED");
  });

  test("anonymous completeSession → UNAUTHORIZED", async () => {
    const result = await testClient.mutate({ mutation: COMPLETE_SESSION_DOC, variables: { id: sessionAId } });
    expect(result.error).toBeDefined();
    expectMutationError(result.error, "UNAUTHORIZED");
  });

  test("anonymous cancelSession → UNAUTHORIZED", async () => {
    const result = await testClient.mutate({ mutation: CANCEL_SESSION_DOC, variables: { id: sessionBId } });
    expect(result.error).toBeDefined();
    expectMutationError(result.error, "UNAUTHORIZED");
  });
});

// ─── Section 2 — wrong authenticated role: FORBIDDEN (pre-resolver) ─────────

describe("REQ-064 mutation matrix — wrong-role callers (FORBIDDEN)", () => {
  test("certified teacher createSession → FORBIDDEN (Ruling 2026-08-30, B3)", async () => {
    const result = await teacherT.mutate({
      mutation: CREATE_SESSION_DOC,
      variables: { input: { teacherId: cast.teacher.userId, intent: "Hifz" } },
    });
    expect(result.error).toBeDefined();
    expectMutationError(result.error, "FORBIDDEN");
  });

  test("teacher applicant createSession → FORBIDDEN (honest role-scope denial)", async () => {
    const result = await applicant.mutate({
      mutation: CREATE_SESSION_DOC,
      variables: { input: { teacherId: cast.teacher.userId, intent: "Hifz" } },
    });
    expect(result.error).toBeDefined();
    expectMutationError(result.error, "FORBIDDEN");
  });

  test("parent createSession → FORBIDDEN", async () => {
    const result = await parent.mutate({
      mutation: CREATE_SESSION_DOC,
      variables: { input: { teacherId: cast.teacher.userId, intent: "Hifz" } },
    });
    expect(result.error).toBeDefined();
    expectMutationError(result.error, "FORBIDDEN");
  });

  test("admin createSession → FORBIDDEN (no bypass)", async () => {
    const result = await admin.mutate({
      mutation: CREATE_SESSION_DOC,
      variables: { input: { teacherId: cast.teacher.userId, intent: "Hifz" } },
    });
    expect(result.error).toBeDefined();
    expectMutationError(result.error, "FORBIDDEN");
  });

  test("student startSession → FORBIDDEN", async () => {
    const result = await studentA.mutate({ mutation: START_SESSION_DOC, variables: { id: sessionAId } });
    expect(result.error).toBeDefined();
    expectMutationError(result.error, "FORBIDDEN");
  });

  test("student completeSession → FORBIDDEN", async () => {
    const result = await studentA.mutate({ mutation: COMPLETE_SESSION_DOC, variables: { id: sessionAId } });
    expect(result.error).toBeDefined();
    expectMutationError(result.error, "FORBIDDEN");
  });

  test("parent startSession → FORBIDDEN", async () => {
    const result = await parent.mutate({ mutation: START_SESSION_DOC, variables: { id: sessionAId } });
    expect(result.error).toBeDefined();
    expectMutationError(result.error, "FORBIDDEN");
  });

  test("admin startSession → FORBIDDEN", async () => {
    const result = await admin.mutate({ mutation: START_SESSION_DOC, variables: { id: sessionAId } });
    expect(result.error).toBeDefined();
    expectMutationError(result.error, "FORBIDDEN");
  });

  test("parent completeSession → FORBIDDEN", async () => {
    const result = await parent.mutate({ mutation: COMPLETE_SESSION_DOC, variables: { id: sessionAId } });
    expect(result.error).toBeDefined();
    expectMutationError(result.error, "FORBIDDEN");
  });

  test("admin completeSession → FORBIDDEN", async () => {
    const result = await admin.mutate({ mutation: COMPLETE_SESSION_DOC, variables: { id: sessionAId } });
    expect(result.error).toBeDefined();
    expectMutationError(result.error, "FORBIDDEN");
  });
});

// ─── Section 3 — createSession idempotency + input guards (student) ─────────

describe("REQ-064/REQ-050 — createSession idempotency + input guards", () => {
  test("missing X-Idempotency-Key header → VALIDATION (pre-DB, REQ-014)", async () => {
    const result = await studentNoKey.mutate({
      mutation: CREATE_SESSION_DOC,
      variables: { input: { teacherId: cast.teacher.userId, intent: "Hifz" } },
    });
    expect(result.error).toBeDefined();
    expectMutationError(result.error, "VALIDATION");
  });

  test("same key replayed → second booking surfaces DUPLICATE_REQUEST (409)", async () => {
    // First booking under KEY_REPLAY succeeds and creates EXACTLY one row.
    const first = await studentReplay.mutate({
      mutation: CREATE_SESSION_DOC,
      variables: { input: { teacherId: cast.teacher.userId, intent: "Hifz" } },
    });
    const payload = payloadOf(first, "createSession");
    const id: unknown = payload.id;
    if (typeof id !== "string" && typeof id !== "number") {
      throw new Error("first replay-pair booking returned no id");
    }
    trackSession(String(id));
    expect(payload.feeHeld).toBe(true);
    expect(payload.status).toBe("Scheduled");

    // The immediate same-key retry is the DUPLICATE_REQUEST replay (never a
    // success-shaped return — replay-throw ruling, REQ-065 client mapping).
    const second = await studentReplay.mutate({
      mutation: CREATE_SESSION_DOC,
      variables: { input: { teacherId: cast.teacher.userId, intent: "Hifz" } },
    });
    expectMutationError(second.error, "DUPLICATE_REQUEST");
  });

  test("booking intent Evaluation (SDL-legal, service-hostile) → VALIDATION", async () => {
    const result = await studentA.mutate({
      mutation: CREATE_SESSION_DOC,
      variables: { input: { teacherId: cast.teacher.userId, intent: "Evaluation" } },
    });
    expect(result.error).toBeDefined();
    expectMutationError(result.error, "VALIDATION");
  });

  test("applicant's users.id as teacherId → TEACHER_NOT_FOUND (never mints certification)", async () => {
    // A KEYED student client: the missing-key guard (VALIDATION, pre-DB) is
    // the FIRST pre-DB check after the integer guards, so the keyless
    // `studentA` client could never reach the teacher-certification lock.
    const result = await studentProbe.mutate({
      mutation: CREATE_SESSION_DOC,
      variables: { input: { teacherId: cast.applicant.userId, intent: "Hifz" } },
    });
    expect(result.error).toBeDefined();
    expectMutationError(result.error, "TEACHER_NOT_FOUND");
  });
});

// ─── Section 4 — start/complete transitions (teacher-owner + regressions) ───

describe("REQ-064/REQ-050 — start/complete transition cells", () => {
  test("foreign certified teacher startSession → SESSION_NOT_FOUND (oracle-safe)", async () => {
    const result = await teacher2.mutate({ mutation: START_SESSION_DOC, variables: { id: sessionAId } });
    expect(result.error).toBeDefined();
    expectMutationError(result.error, "SESSION_NOT_FOUND");
  });

  test("teacher applicant startSession → SESSION_NOT_FOUND (no session can exist for him)", async () => {
    const result = await applicant.mutate({ mutation: START_SESSION_DOC, variables: { id: sessionAId } });
    expect(result.error).toBeDefined();
    expectMutationError(result.error, "SESSION_NOT_FOUND");
  });

  test("owner teacher startSession → Scheduled → Started (happy path)", async () => {
    const result = await teacherT.mutate({ mutation: START_SESSION_DOC, variables: { id: sessionAId } });
    const payload = payloadOf(result, "startSession");
    expect(payload.status).toBe("Started");
    expect(payload.startedAt).toBeTypeOf("string");
  });

  test("double start → SESSION_INVALID_TRANSITION (terminal regression)", async () => {
    const result = await teacherT.mutate({ mutation: START_SESSION_DOC, variables: { id: sessionAId } });
    expect(result.error).toBeDefined();
    expectMutationError(result.error, "SESSION_INVALID_TRANSITION");
  });

  test("owner teacher completeSession → Started → Completed (happy path)", async () => {
    const result = await teacherT.mutate({ mutation: COMPLETE_SESSION_DOC, variables: { id: sessionAId } });
    const payload = payloadOf(result, "completeSession");
    expect(payload.status).toBe("Completed");
    expect(payload.endedAt).toBeTypeOf("string");
    expect(payload.confirmedByTeacherAt).toBeTypeOf("string");
  });

  test("double complete → SESSION_INVALID_TRANSITION (terminal regression)", async () => {
    const result = await teacherT.mutate({ mutation: COMPLETE_SESSION_DOC, variables: { id: sessionAId } });
    expect(result.error).toBeDefined();
    expectMutationError(result.error, "SESSION_INVALID_TRANSITION");
  });

  test("start after completed → SESSION_INVALID_TRANSITION (terminal state)", async () => {
    const result = await teacherT.mutate({ mutation: START_SESSION_DOC, variables: { id: sessionAId } });
    expect(result.error).toBeDefined();
    expectMutationError(result.error, "SESSION_INVALID_TRANSITION");
  });
});

// ─── Section 5 — decertified complete (REQ-016 fused certification) ─────────

describe("REQ-064/REQ-050 — decertified completeSession", () => {
  test("completeSession while Scheduled → SESSION_INVALID_TRANSITION (wrong state)", async () => {
    const result = await teacher2.mutate({ mutation: COMPLETE_SESSION_DOC, variables: { id: sessionDId } });
    expect(result.error).toBeDefined();
    expectMutationError(result.error, "SESSION_INVALID_TRANSITION");
  });

  test("owner startSession(D) still succeeds while certified", async () => {
    const result = await teacher2.mutate({ mutation: START_SESSION_DOC, variables: { id: sessionDId } });
    const payload = payloadOf(result, "startSession");
    expect(payload.status).toBe("Started");
  });

  test("decertified owner completeSession → TEACHER_NOT_CERTIFIED (fused EXISTS)", async () => {
    // Decertify the owning teacher at the DB (the same value the fused
    // EXISTS predicate reads) — then the guarded complete matches zero rows.
    await db.update(teacher).set({ isApproved: false }).where(eq(teacher.id, cast.secondTeacher.userId));
    const result = await teacher2.mutate({ mutation: COMPLETE_SESSION_DOC, variables: { id: sessionDId } });
    expect(result.error).toBeDefined();
    expectMutationError(result.error, "TEACHER_NOT_CERTIFIED");
  });
});

// ─── Section 6 — cancelSession participant predicate + oracle pairing ───────

describe("REQ-064/REQ-050 — cancelSession participant predicate + oracle pairing", () => {
  test("foreign student cancel → SESSION_NOT_FOUND", async () => {
    const result = await studentB.mutate({
      mutation: CANCEL_SESSION_DOC,
      variables: { id: sessionCId, reason: "not mine" },
    });
    expect(result.error).toBeDefined();
    expectMutationError(result.error, "SESSION_NOT_FOUND");
  });

  test("nonexistent id cancel → SESSION_NOT_FOUND (oracle pair of the foreign denial)", async () => {
    const result = await studentA.mutate({
      mutation: CANCEL_SESSION_DOC,
      variables: { id: "999999999", reason: null },
    });
    expect(result.error).toBeDefined();
    expectMutationError(result.error, "SESSION_NOT_FOUND");
  });

  test("parent cancel → SESSION_NOT_FOUND (authenticated, never participant)", async () => {
    const result = await parent.mutate({ mutation: CANCEL_SESSION_DOC, variables: { id: sessionCId } });
    expect(result.error).toBeDefined();
    expectMutationError(result.error, "SESSION_NOT_FOUND");
  });

  test("admin cancel → SESSION_NOT_FOUND (NO admin bypass)", async () => {
    const result = await admin.mutate({ mutation: CANCEL_SESSION_DOC, variables: { id: sessionCId } });
    expect(result.error).toBeDefined();
    expectMutationError(result.error, "SESSION_NOT_FOUND");
  });

  test("owner student cancel with reason → Cancelled + hold released to the SAME lane", async () => {
    // Snapshot the lane BEFORE the cancel — the refund must add EXACTLY one
    // unit back to the SAME lane the hold was taken from (B bound hifz: the
    // trial lane was drained by booking A).
    const beforeRefund = await readHifzBalance(cast.primaryStudent.userId);
    const result = await studentA.mutate({
      mutation: CANCEL_SESSION_DOC,
      variables: { id: sessionBId, reason: "schedule conflict" },
    });
    const payload = payloadOf(result, "cancelSession");
    expect(payload.status).toBe("Cancelled");
    expect(payload.feeHeld).toBe(false);
    const afterRefund = await readHifzBalance(cast.primaryStudent.userId);
    expect(afterRefund).toBe(beforeRefund + 1);
  });

  test("double cancel → SESSION_INVALID_TRANSITION (never double-refunds)", async () => {
    const result = await studentA.mutate({ mutation: CANCEL_SESSION_DOC, variables: { id: sessionBId } });
    expect(result.error).toBeDefined();
    expectMutationError(result.error, "SESSION_INVALID_TRANSITION");
  });

  test("owner teacher cancel → Cancelled (teacher participant leg)", async () => {
    const result = await teacherT.mutate({ mutation: CANCEL_SESSION_DOC, variables: { id: sessionCId } });
    const payload = payloadOf(result, "cancelSession");
    expect(payload.status).toBe("Cancelled");
    expect(payload.feeHeld).toBe(false);
  });
});

// ─── Section 7 — REQ-054 malformed target-id shape guard (pre-DB) ────────────

describe("REQ-054 — malformed target-id shape guard (pre-DB VALIDATION)", () => {
  test("startSession with a malformed id ('12abc') → VALIDATION (never a masked 500)", async () => {
    // The `ID` variable rides the wire VERBATIM as the raw string — the
    // boundary's shape-only `Number()` parse turns it into NaN, and the
    // service's pre-DB positive-safe-integer guard denies it BEFORE any
    // database work (REQ-050: extensions.code VALIDATION, 422 — the same
    // taxonomy cell as every other service-side input guard).
    const result = await teacherT.mutate({ mutation: START_SESSION_DOC, variables: { id: "12abc" } });
    expect(result.error).toBeDefined();
    expectMutationError(result.error, "VALIDATION");
  });
});
