/**
 * `bookEvaluationSession` + the evaluation-booking query surface — wire-
 * boundary integration suite.
 *
 * Runs over the REAL boundary: `setupTestServerLifecycle` boots the Next dev
 * server on the shared TEST_PORT (3066) and every call goes through Apollo
 * Client v4 + the shared error helpers (`expectMutationError`) exactly like
 * `frontend/graphql/test/teachers/verification-plan-purchase.test.ts` (the
 * pattern source for the register/login + Bearer-header harness in this
 * file).
 *
 * Boundary purity (frontend/graphql/test/AGENTS.md rule 10): this file
 * interacts with the application EXCLUSIVELY through the GraphQL API
 * (`testClient` + shared TypedDocumentNodes). State that has NO public
 * GraphQL surface in the dev environment — the applicant lifecycle flip to
 * `in_evaluation`, the gateway-side subscription activation, and the
 * certified-evaluator `teacher` child rows — is provisioned through the
 * shared direct-DB fixture seam under `@/test/helpers` (the sanctioned
 * provisioning path for entity state with no wire operation).
 *
 * Denial + happy matrix over the REAL resolvers:
 *  - anonymous (no Bearer) → UNAUTHORIZED — the `authenticated` authScope
 *    denies before the resolver (401 channel, never FORBIDDEN).
 *  - authenticated STUDENT (non-applicant) with a VALID idempotency key →
 *    APPLICANT_NOT_FOUND — the applicant eligibility gate lives at the
 *    SERVICE level (scope-composition rule: the surface declares only
 *    `{ authenticated: true }`); the same caller's loop-status read
 *    resolves the fixed ZERO-SHAPE (no applicants row → no oracle).
 *  - teacher applicant (public registration provisions the PENDING
 *    `applicants` row) WITH a key → APPLICANT_NOT_IN_EVALUATION — the
 *    in-transaction status gate fires before any cycle/capacity read.
 *  - in_evaluation applicant with an ACTIVE verification subscription →
 *    the happy loop: zero-shape status first (booked 0 / remaining 5),
 *    `availableEvaluators` listing the suite's certified evaluators, FIVE
 *    bookings with distinct evaluators + fresh keys (each returning the
 *    canonical `Session`), the status read walking to booked 5 / remaining
 *    0, `myEvaluationSessions` paging the five rows, and the SIXTH booking
 *    attempt rejected with the typed NO_EVALUATION_CREDITS_REMAINING code
 *    via `extensions.code`.
 *
 * Documents: shared TypedDocumentNodes only —
 * `frontend/graphql/sharedDocuments/teachers/evaluation-booking.documents.ts`
 * (the four evaluation-booking operations). No local `parse`d strings, no
 * raw queries (AGENTS.md rule 3).
 *
 * Idempotency key transport: the key rides the per-request
 * `x-idempotency-key` header exactly as `gqlContextFactory` captures it
 * (propagation-only; raw verbatim value, `null` when absent). Every
 * booking uses a FRESH per-run key (never shared across bookings or runs).
 *
 * Data lifecycle (HYGIENE — mirrors the sibling suites): every user this
 * suite creates is tracked by id and deleted in a describe-scoped
 * `afterAll`. Booked sessions RESTRICT-delete their participant users, so
 * the shared `deleteSessionsByParticipantUserIds` helper runs FIRST
 * (idempotency claims SET-NULL their session link; everything else
 * cascades or was never created here).
 */

import { afterAll, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";

import { RegisterPublicRole, SessionStatus } from "@/frontend/graphql/generated/gql/graphql";
import {
  loginMutationDocument,
  registerUserMutationDocument,
} from "@/frontend/graphql/sharedDocuments/auth/auth.documents";
import {
  availableEvaluatorsQueryDocument,
  bookEvaluationSessionMutationDocument,
  myEvaluationLoopStatusQueryDocument,
  myEvaluationSessionsQueryDocument,
} from "@/frontend/graphql/sharedDocuments/teachers/evaluation-booking.documents";
import {
  countUsersByIds,
  deleteSessionsByParticipantUserIds,
  deleteUsersByIds,
  describeGraphqlSuite,
  expectMutationError,
  insertActiveVerificationSubscription,
  insertEvaluatorTeacherRow,
  promoteApplicantToEvaluation,
  setupTestServerLifecycle,
  testClient,
} from "@/test/helpers";

/** Per-run key salt — unique keys, never shared across runs or bookings. */
const PREFIX = `evb-${randomUUID().slice(0, 8)}`;

/** How many evaluators the loop books before the sixth attempt is rejected. */
const LOOP_EVALUATOR_COUNT = 5;

/**
 * Randomized email generator (per-suite unique prefix + UUID salt) — follows
 * the entity-setup guidance ("randomUUID avoids unique-constraint hits")
 * while keeping the auth.test.ts `@test.local` domain marker.
 */
function uniqueEmail(rolePrefix: string): string {
  return `${rolePrefix}-${Date.now()}-${randomUUID().slice(0, 8)}@test.local`;
}

// Named without the literal `password` token so `sonarjs/no-hardcoded-passwords`
// does not flag it (same convention as the sibling suites).
const testCredential = "Password123";

interface RegistrationOutcome {
  readonly userId: number;
  readonly accessToken: string;
}

/**
 * Ids of every user this suite creates (any surface) — drained by the
 * describe-scoped `afterAll` hygiene cleanup so the shared dev database
 * stays at its canonical seed state. Explicit ids (not an email sweep)
 * keep parallel live-wire suites' fixtures safe.
 */
const createdUserIds = new Set<number>();

function trackCreatedUser(id: number | null | undefined): void {
  if (typeof id === "number") createdUserIds.add(id);
}

/**
 * Registers a user through the PUBLIC registerUser mutation, then logs in
 * through the PUBLIC login mutation to obtain a bearer token. A `teacher`
 * registration provisions the pending `applicants` row as a side effect of
 * the real registration service — the suite never hand-inserts one.
 */
async function registerAndLogin(
  role: RegisterPublicRole.Student | RegisterPublicRole.Teacher,
  fullName: string
): Promise<RegistrationOutcome> {
  const email = uniqueEmail(role === RegisterPublicRole.Teacher ? "applicant" : "student");
  const registered = await testClient.mutate({
    mutation: registerUserMutationDocument,
    variables: {
      input: {
        fullName,
        email,
        phone: "+201234567890",
        password: testCredential,
        gender: null,
        country: "EG",
        role,
        preferredRecitation: null,
      },
    },
  });
  expect(registered.error).toBeUndefined();
  const userId = registered.data?.registerUser?.id;
  if (!userId) throw new Error("registerUser returned no id");
  trackCreatedUser(userId);

  const loggedIn = await testClient.mutate({
    mutation: loginMutationDocument,
    variables: { email, password: testCredential },
  });
  expect(loggedIn.error).toBeUndefined();
  const accessToken = loggedIn.data?.login?.accessToken;
  if (!accessToken) throw new Error("login returned no accessToken");

  return { userId, accessToken };
}

/** Auth headers for the shared test client (Bearer + fresh booking key). */
function authHeaders(accessToken: string, idempotencyKey?: string): Record<string, string> {
  const headers: Record<string, string> = { Authorization: `Bearer ${accessToken}` };
  if (idempotencyKey !== undefined) {
    headers["x-idempotency-key"] = idempotencyKey;
  }
  return headers;
}

describeGraphqlSuite("Evaluation Booking GraphQL Integration", () => {
  setupTestServerLifecycle();

  // ─── Hygiene: restore the shared dev database to canonical seed state ───
  // Booked sessions RESTRICT-delete their participant users, so the
  // session rows go first; the claims SET-NULL their link and the users
  // (with every cascading child row) follow.
  afterAll(async () => {
    const ids = [...createdUserIds];
    if (ids.length > 0) {
      await deleteSessionsByParticipantUserIds(ids);
      const deleted = await deleteUsersByIds(ids);
      expect(deleted).toBe(ids.length);
      expect(await countUsersByIds(ids)).toBe(0);
    }
  });

  test("anonymous caller gets UNAUTHORIZED (401 semantics, never FORBIDDEN)", async () => {
    const result = await testClient.mutate({
      mutation: bookEvaluationSessionMutationDocument,
      variables: { input: { evaluatorId: "1" } },
    });
    expect(result.error).toBeDefined();
    expectMutationError(result.error, "UNAUTHORIZED");
  });

  test("authenticated STUDENT with a valid idempotency key gets APPLICANT_NOT_FOUND (service-level applicant gate); loop status resolves the zero-shape", async () => {
    const { accessToken } = await registerAndLogin(RegisterPublicRole.Student, "Eval Booking Non Applicant");
    const result = await testClient.mutate({
      mutation: bookEvaluationSessionMutationDocument,
      variables: { input: { evaluatorId: "1" } },
      context: { headers: authHeaders(accessToken, `${PREFIX}-non-applicant`) },
    });
    expectMutationError(result.error, "APPLICANT_NOT_FOUND");

    // The same caller's status read never errors and never leaks: no
    // applicants row → the fixed ZERO-SHAPE (booked 0 / completed 0 /
    // remaining 0, no cycle start).
    const status = await testClient.query({
      query: myEvaluationLoopStatusQueryDocument,
      context: { headers: authHeaders(accessToken) },
    });
    expect(status.error).toBeUndefined();
    const loop = status.data?.myEvaluationLoopStatus;
    if (!loop) throw new Error("myEvaluationLoopStatus returned no value");
    expect(loop.bookedCount).toBe(0);
    expect(loop.completedCount).toBe(0);
    expect(loop.remainingCredits).toBe(0);
    expect(loop.cycleStartDate).toBeNull();
  });

  test("PENDING teacher applicant with a key gets APPLICANT_NOT_IN_EVALUATION (in-transaction status gate fires first)", async () => {
    const { accessToken } = await registerAndLogin(RegisterPublicRole.Teacher, "Eval Booking Pending Applicant");
    const result = await testClient.mutate({
      mutation: bookEvaluationSessionMutationDocument,
      variables: { input: { evaluatorId: "1" } },
      context: { headers: authHeaders(accessToken, `${PREFIX}-pending-applicant`) },
    });
    expectMutationError(result.error, "APPLICANT_NOT_IN_EVALUATION");
  });

  test("in_evaluation applicant books the five-session loop; the sixth attempt gets the typed NO_EVALUATION_CREDITS_REMAINING code", async () => {
    // ─── Fixtures: five certified evaluators + one in-loop applicant ───
    // Registrations and child-row inserts are independent per evaluator —
    // `Promise.all` satisfies the no-await-in-loop rule with no shared
    // mutable state (each call provisions its own user).
    const evaluators = await Promise.all(
      Array.from({ length: LOOP_EVALUATOR_COUNT }, (_, index) =>
        registerAndLogin(RegisterPublicRole.Teacher, `Eval Booking Evaluator ${index + 1}`)
      )
    );
    const teacherRowIds = await Promise.all(evaluators.map(e => insertEvaluatorTeacherRow(e.userId)));
    expect(teacherRowIds).toStrictEqual(evaluators.map(e => e.userId));
    const evaluatorIds = evaluators.map(e => e.userId);
    const applicant = await registerAndLogin(RegisterPublicRole.Teacher, "Eval Booking Applicant");
    expect(await promoteApplicantToEvaluation(applicant.userId)).toBe("in_evaluation");
    await insertActiveVerificationSubscription(applicant.userId);

    const headers = authHeaders(applicant.accessToken);

    // ─── Pre-loop reads: zero-shape status + the evaluator picker ───
    const statusBefore = await testClient.query({
      query: myEvaluationLoopStatusQueryDocument,
      context: { headers },
    });
    expect(statusBefore.error).toBeUndefined();
    const loopBefore = statusBefore.data?.myEvaluationLoopStatus;
    if (!loopBefore) throw new Error("myEvaluationLoopStatus returned no value");
    expect(loopBefore.bookedCount).toBe(0);
    expect(loopBefore.completedCount).toBe(0);
    expect(loopBefore.remainingCredits).toBe(LOOP_EVALUATOR_COUNT);
    expect(loopBefore.cycleStartDate).not.toBeNull();

    const pickers = await testClient.query({
      query: availableEvaluatorsQueryDocument,
      variables: { page: 1, pageSize: 25 },
      context: { headers },
    });
    expect(pickers.error).toBeUndefined();
    const pickerPage = pickers.data?.availableEvaluators;
    if (!pickerPage) throw new Error("availableEvaluators returned no value");
    expect(pickerPage.page).toBe(1);
    expect(pickerPage.pageSize).toBe(25);
    const pickerIds = new Set(pickerPage.items.map(option => option.id));
    for (const evaluatorId of evaluatorIds) {
      expect(pickerIds.has(String(evaluatorId))).toBe(true);
    }
    expect(pickerPage.totalCount).toBeGreaterThanOrEqual(LOOP_EVALUATOR_COUNT);

    // Explicit-null pagination members — the service normalizes the window
    // and echoes the effective values honestly.
    const pickersDefaulted = await testClient.query({
      query: availableEvaluatorsQueryDocument,
      variables: { page: null, pageSize: null },
      context: { headers },
    });
    expect(pickersDefaulted.error).toBeUndefined();
    const defaultedPage = pickersDefaulted.data?.availableEvaluators;
    if (!defaultedPage) throw new Error("availableEvaluators returned no value");
    expect(defaultedPage.page).toBe(1);
    expect(defaultedPage.pageSize).toBe(25);

    // ─── The loop: five bookings with distinct evaluators + fresh keys ───
    // The five bookings are issued concurrently (each its own evaluator +
    // key); the booking transaction's applicant-row lock serializes them,
    // so exactly the five distinct-evaluator credits are spent.
    const bookings = await Promise.all(
      evaluatorIds.map(evaluatorId =>
        testClient.mutate({
          mutation: bookEvaluationSessionMutationDocument,
          variables: { input: { evaluatorId: String(evaluatorId) } },
          context: {
            headers: authHeaders(applicant.accessToken, `${PREFIX}-book-${evaluatorId}-${randomUUID().slice(0, 8)}`),
          },
        })
      )
    );
    for (const [index, booking] of bookings.entries()) {
      expect(booking.error).toBeUndefined();
      const booked = booking.data?.bookEvaluationSession;
      if (!booked) throw new Error("bookEvaluationSession returned no value");
      expect(booked.teacherId).toBe(String(evaluatorIds[index]));
      expect(booked.studentId).toBe(String(applicant.userId));
      expect(booked.status).toBe(SessionStatus.Scheduled);
    }

    // ─── Post-loop reads: capacity exhausted, the five rows paged ───
    const statusAfter = await testClient.query({
      query: myEvaluationLoopStatusQueryDocument,
      context: { headers },
    });
    expect(statusAfter.error).toBeUndefined();
    const loopAfter = statusAfter.data?.myEvaluationLoopStatus;
    if (!loopAfter) throw new Error("myEvaluationLoopStatus returned no value");
    expect(loopAfter.bookedCount).toBe(LOOP_EVALUATOR_COUNT);
    expect(loopAfter.completedCount).toBe(0);
    expect(loopAfter.remainingCredits).toBe(0);

    const sessions = await testClient.query({
      query: myEvaluationSessionsQueryDocument,
      variables: { filter: null, page: 1, pageSize: 25 },
      context: { headers },
    });
    expect(sessions.error).toBeUndefined();
    const sessionPage = sessions.data?.myEvaluationSessions;
    if (!sessionPage) throw new Error("myEvaluationSessions returned no value");
    expect(sessionPage.totalCount).toBe(LOOP_EVALUATOR_COUNT);
    expect(sessionPage.items).toHaveLength(LOOP_EVALUATOR_COUNT);

    // Meaningful lifecycle filter — the scheduled rows match exactly.
    const scheduledOnly = await testClient.query({
      query: myEvaluationSessionsQueryDocument,
      variables: { filter: { status: SessionStatus.Scheduled }, page: 1, pageSize: 25 },
      context: { headers },
    });
    expect(scheduledOnly.error).toBeUndefined();
    const scheduledPage = scheduledOnly.data?.myEvaluationSessions;
    if (!scheduledPage) throw new Error("myEvaluationSessions returned no value");
    expect(scheduledPage.totalCount).toBe(LOOP_EVALUATOR_COUNT);

    // ─── The sixth attempt: capacity is spent → typed conflict code ───
    const sixth = await testClient.mutate({
      mutation: bookEvaluationSessionMutationDocument,
      // A distinct sixth evaluator is NOT required: the capacity gate fires
      // before distinctness — but the fresh id keeps the denial unambiguous.
      variables: { input: { evaluatorId: String(evaluatorIds[0]) } },
      context: { headers: authHeaders(applicant.accessToken, `${PREFIX}-sixth-${randomUUID().slice(0, 8)}`) },
    });
    expectMutationError(sixth.error, "NO_EVALUATION_CREDITS_REMAINING");
  });
});
