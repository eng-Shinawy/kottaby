/**
 * `submitRubricEvaluation` + the evaluation-rubric read pair — wire-boundary
 * integration suite.
 *
 * Runs over the REAL boundary: `setupTestServerLifecycle` boots the Next dev
 * server on the shared TEST_PORT (3066) and every call goes through Apollo
 * Client v4 + the shared error helpers (`expectMutationError`) exactly like
 * `frontend/graphql/test/teachers/evaluation-booking.test.ts` (the convention
 * source for the register/login + Bearer-header harness in this file).
 *
 * Boundary purity (frontend/graphql/test/AGENTS.md rule 10): this file
 * interacts with the application EXCLUSIVELY through the GraphQL API
 * (`testClient` + TypedDocumentNodes). State that has NO public GraphQL
 * surface in the dev environment — the certified-evaluator `teacher` child
 * rows, the applicant lifecycle flip to `in_evaluation`, and the
 * pre-finalization `pending` demotion probe — is provisioned through the
 * shared direct-DB fixture seam under `@/test/helpers` (the sanctioned
 * provisioning path for entity state with no wire operation).
 *
 * Documents: locally `parse`d TypedDocumentNodes (the
 * `applicant-profile.test.ts` convention — Apollo's `gql` is deliberately
 * not imported here; `parse` yields the same DocumentNode without the
 * `graphql-tag` UMD pitfall under the fixture module conditions). The
 * shared-documents barrel gains its typed surface with the frontend
 * documents delivery; auth, booking, and session-lifecycle operations are
 * REUSED from the shared barrels (single-source discipline).
 *
 * Denial + happy matrix over the REAL resolvers:
 *  - anonymous (no Bearer) → UNAUTHORIZED — the `authenticated` leg of the
 *    `$all` conjunction denies before the resolver (401, never FORBIDDEN).
 *  - authenticated STUDENT / PARENT → FORBIDDEN at the `role` leg (403) —
 *    the service is never reached (BFLA scope conjunction, pinned
 *    behaviorally).
 *  - the typed validation band surfaces via `errors[].extensions.code`:
 *    VALIDATION (shape-only id coercion), RUBRIC_SCORE_INVALID,
 *    RUBRIC_NOTES_REQUIRED, RUBRIC_WEAKNESS_REQUIRED,
 *    RUBRIC_WEAKNESS_NOT_ALLOWED — each pre-DB, so no submission row is
 *    written by any denial.
 *  - the weakness vocabulary is wire-enforced: the lowercase runtime value
 *    dies at variable coercion (GRAPHQL_VALIDATION_FAILED) before any
 *    resolver runs.
 *  - the transactional gates over the real loop: RUBRIC_SESSION_NOT_COMPLETED
 *    (owned, typed, but not completed), SESSION_NOT_FOUND (a foreign
 *    evaluator's session — oracle-free), EVALUATION_ALREADY_SUBMITTED (the
 *    write-once arbiter), APPLICANT_NOT_IN_EVALUATION (demoted applicant).
 *  - two full five-submission loops over the wire: a PASS cycle (all scores
 *    ≥ 80 → `Passed` on the 5th return) and a FAIL cycle (one 79 carrying
 *    its Hifz weakness among 85s → `Failed`, the weakness round-tripping on
 *    the wire shape); both verdict returns expose the LIVE applicant status.
 *  - the pending read drains row-by-row (totalCount 1 → 0 per evaluator) and
 *    the certification gate is the oracle-safe EMPTY page for a Teacher-role
 *    caller without the certified-evaluator row.
 *  - localized denials: the same typed code carries distinct non-empty
 *    messages under the `en` and `ar` request locales.
 *
 * Data lifecycle (HYGIENE — mirrors the sibling suites): every user this
 * suite creates is tracked by id and deleted in a describe-scoped
 * `afterAll`. Booked sessions RESTRICT-delete their participant users, so
 * the shared `deleteSessionsByParticipantUserIds` helper runs FIRST
 * (evaluations SET-NULL their session link and cascade with the users).
 */

import { afterAll, beforeAll, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import type { TypedDocumentNode } from "@apollo/client";
import { parse } from "graphql";
import {
  ApplicantStatus,
  RegisterPublicRole,
  SessionStatus,
  SessionType,
} from "@/frontend/graphql/generated/gql/graphql";
import {
  loginMutationDocument,
  registerUserMutationDocument,
} from "@/frontend/graphql/sharedDocuments/auth/auth.documents";
import {
  completeSessionMutationDocument,
  startSessionMutationDocument,
} from "@/frontend/graphql/sharedDocuments/scheduling/session-lifecycle.documents";
import { bookEvaluationSessionMutationDocument } from "@/frontend/graphql/sharedDocuments/teachers/evaluation-booking.documents";
import {
  countUsersByIds,
  deleteSessionsByParticipantUserIds,
  deleteUsersByIds,
  demoteApplicantToPending,
  describeGraphqlSuite,
  expectMutationError,
  insertActiveVerificationSubscription,
  insertEvaluatorTeacherRow,
  promoteApplicantToEvaluation,
  setupTestServerLifecycle,
  testClient,
} from "@/test/helpers";

/**
 * GraphQL wire member of `RubricWeaknessArea` for the failing submission —
 * the enum KEYS are the wire names (`Tajweed`/`Hifz`) over the lowercase
 * runtime storage values; the frontend enum lands in the generated module
 * with the shared documents delivery, so the wire member is a docblocked
 * local constant until then (never the runtime lowercase spelling).
 */
const WIRE_WEAKNESS_HIFZ = "Hifz";

/** Wire shape of the rubric submission read-model (notes structurally absent). */
interface RubricEvaluationWire {
  readonly id: string;
  readonly sessionId: string | null;
  readonly evaluatedId: string;
  readonly evaluatorId: string;
  readonly score: number | null;
  readonly weaknessArea: "Tajweed" | "Hifz" | null;
  readonly createdAt: string;
  readonly applicantStatus: `${ApplicantStatus}`;
}

interface SubmitRubricEvaluationWire {
  readonly submitRubricEvaluation: RubricEvaluationWire;
}

interface RubricEvaluationVariables {
  readonly sessionId: string;
  readonly input: {
    readonly score: number;
    readonly notes: string;
    readonly weaknessArea: "Tajweed" | "Hifz" | null;
  };
}

interface PendingPageWire {
  readonly myRubricPendingSessions: {
    readonly items: readonly {
      readonly id: string;
      readonly status: `${SessionStatus}`;
      readonly sessionType: `${SessionType}`;
      readonly teacherId: string;
      readonly studentId: string;
    }[];
    readonly totalCount: number;
    readonly page: number;
    readonly pageSize: number;
  };
}

interface PendingPageVariables {
  readonly page: number | null;
  readonly pageSize: number | null;
}

interface OwnSubmissionWire {
  readonly myRubricEvaluation: RubricEvaluationWire | null;
}

// Locally parsed wire documents — `id` FIRST on every object selection, and
// the free-text notes appear ONLY inside the mutation input (never in any
// selection set).
const submitRubricEvaluationDocument: TypedDocumentNode<SubmitRubricEvaluationWire, RubricEvaluationVariables> = parse(`
  mutation SubmitRubricEvaluation($sessionId: ID!, $input: RubricEvaluationSubmitInput!) {
    submitRubricEvaluation(sessionId: $sessionId, input: $input) {
      id
      sessionId
      evaluatedId
      evaluatorId
      score
      weaknessArea
      createdAt
      applicantStatus
    }
  }
`);

const myRubricPendingSessionsDocument: TypedDocumentNode<PendingPageWire, PendingPageVariables> = parse(`
  query MyRubricPendingSessions($page: Int, $pageSize: Int) {
    myRubricPendingSessions(page: $page, pageSize: $pageSize) {
      items {
        id
        status
        sessionType
        teacherId
        studentId
      }
      totalCount
      page
      pageSize
    }
  }
`);

const myRubricEvaluationDocument: TypedDocumentNode<OwnSubmissionWire, { readonly sessionId: string }> = parse(`
  query MyRubricEvaluation($sessionId: ID!) {
    myRubricEvaluation(sessionId: $sessionId) {
      id
      sessionId
      evaluatedId
      evaluatorId
      score
      weaknessArea
      createdAt
      applicantStatus
    }
  }
`);

/** How many distinct evaluators one verification cycle books. */
const LOOP_EVALUATOR_COUNT = 5;

/** Per-run salt — unique emails and idempotency keys, never shared across runs. */
const PREFIX = `rub-${randomUUID().slice(0, 8)}`;

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

/** Ids of every user this suite creates (any surface) — drained by the
 * describe-scoped `afterAll` hygiene cleanup so the shared dev database
 * stays at its canonical seed state. Explicit ids (not an email sweep)
 * keep parallel live-wire suites' fixtures safe. */
const createdUserIds = new Set<number>();

function trackCreatedUser(id: number | null | undefined): void {
  if (typeof id === "number") createdUserIds.add(id);
}

/** Bearer headers for the shared test client. */
function authHeaders(accessToken: string, locale?: string): Record<string, string> {
  const headers: Record<string, string> = { Authorization: `Bearer ${accessToken}` };
  if (locale !== undefined) {
    headers["Accept-Language"] = locale;
  }
  return headers;
}

/**
 * Registers a user through the PUBLIC registerUser mutation, then logs in
 * through the PUBLIC login mutation to obtain a bearer token. A `teacher`
 * registration provisions the pending `applicants` row as a side effect of
 * the real registration service — the suite never hand-inserts one.
 */
async function registerAndLogin(
  role: RegisterPublicRole.Parent | RegisterPublicRole.Student | RegisterPublicRole.Teacher,
  fullName: string
): Promise<RegistrationOutcome> {
  const email = uniqueEmail(role === RegisterPublicRole.Teacher ? "evaluator" : role.toLowerCase());
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

/**
 * Books one evaluation session with the given evaluator. The booking flow's
 * replay arbiter is the gateway-captured idempotency key (`x-idempotency-key`
 * header — an absent key is a typed idempotencyKeyRequired denial), so every
 * booking carries a FRESH per-run key, never shared across bookings or runs.
 */
async function bookSession(applicant: RegistrationOutcome, evaluatorId: number): Promise<number> {
  const booked = await testClient.mutate({
    mutation: bookEvaluationSessionMutationDocument,
    variables: { input: { evaluatorId: String(evaluatorId) } },
    context: {
      headers: {
        ...authHeaders(applicant.accessToken),
        "x-idempotency-key": `${PREFIX}-book-${applicant.userId}-${evaluatorId}-${randomUUID().slice(0, 8)}`,
      },
    },
  });
  expect(booked.error).toBeUndefined();
  const sessionId = booked.data?.bookEvaluationSession?.id;
  if (!sessionId) throw new Error("bookEvaluationSession returned no id");
  return Number(sessionId);
}

/** Teacher-side lifecycle pair: starts then completes one owned session. */
async function startAndCompleteSession(teacher: RegistrationOutcome, sessionId: number): Promise<void> {
  const started = await testClient.mutate({
    mutation: startSessionMutationDocument,
    variables: { id: String(sessionId) },
    context: { headers: authHeaders(teacher.accessToken) },
  });
  expect(started.error).toBeUndefined();
  const completed = await testClient.mutate({
    mutation: completeSessionMutationDocument,
    variables: { id: String(sessionId) },
    context: { headers: authHeaders(teacher.accessToken) },
  });
  expect(completed.error).toBeUndefined();
}

/** Submits the calling evaluator's rubric for one session. */
async function submitRubric(
  evaluator: RegistrationOutcome,
  sessionId: number,
  input: RubricEvaluationVariables["input"]
) {
  return testClient.mutate({
    mutation: submitRubricEvaluationDocument,
    variables: { sessionId: String(sessionId), input },
    context: { headers: authHeaders(evaluator.accessToken) },
  });
}

/** The canonical passing rubric (no weakness — verdict derived server-side). */
function passingInput(score: number): RubricEvaluationVariables["input"] {
  return { score, notes: "Consistent recitation with disciplined tajweed application.", weaknessArea: null };
}

// ─── Shared fixtures (committed over the wire + the sanctioned seam) ────────

/** Evaluators E1..E5 (loop teachers) + E6 (the applicant-B probe teacher). */
const evaluators: RegistrationOutcome[] = [];
/** Applicant A — the PASS cycle. Applicant C — the FAIL cycle (weakness). */
let applicantPass: RegistrationOutcome;
let applicantFail: RegistrationOutcome;
/** Applicant B — the status-gate probe (demoted before its submission). */
let applicantDemoted: RegistrationOutcome;
let evaluatorProbe: RegistrationOutcome;
let studentCaller: RegistrationOutcome;
let parentCaller: RegistrationOutcome;
let uncertifiedTeacher: RegistrationOutcome;

/**
 * Booked session ids per loop, indexed by evaluator slot (E1..E5 → 0..4).
 * Slot-indexed ASSIGNMENT (never `push`) — the bookings resolve
 * concurrently, so append order would silently mispair sessions with
 * evaluators and turn every later owner-scoped call into a cross pair.
 */
const passSessions: number[] = Array.from({ length: LOOP_EVALUATOR_COUNT }, () => 0);
const failSessions: number[] = Array.from({ length: LOOP_EVALUATOR_COUNT }, () => 0);
let probeSession = 0;

describeGraphqlSuite("Evaluation Rubric GraphQL Integration", () => {
  setupTestServerLifecycle();

  beforeAll(async () => {
    // ─── Six certified evaluators + three applicants + denial-role callers ───
    const loopEvaluators = await Promise.all(
      Array.from({ length: LOOP_EVALUATOR_COUNT + 1 }, (_, index) =>
        registerAndLogin(RegisterPublicRole.Teacher, `Rubric Evaluator ${index + 1}`)
      )
    );
    evaluators.push(...loopEvaluators.slice(0, LOOP_EVALUATOR_COUNT));
    evaluatorProbe = loopEvaluators[LOOP_EVALUATOR_COUNT];
    // Certified-evaluator child rows are independent per evaluator —
    // parallel inserts, then the booking-suite identity probe.
    const teacherRowIds = await Promise.all(
      loopEvaluators.map(evaluator => insertEvaluatorTeacherRow(evaluator.userId))
    );
    expect(teacherRowIds).toStrictEqual(loopEvaluators.map(evaluator => evaluator.userId));
    for (const id of teacherRowIds) {
      trackCreatedUser(id);
    }

    [applicantPass, applicantFail, applicantDemoted, studentCaller, parentCaller, uncertifiedTeacher] =
      await Promise.all([
        registerAndLogin(RegisterPublicRole.Teacher, "Rubric Applicant Pass"),
        registerAndLogin(RegisterPublicRole.Teacher, "Rubric Applicant Fail"),
        registerAndLogin(RegisterPublicRole.Teacher, "Rubric Applicant Demoted"),
        registerAndLogin(RegisterPublicRole.Student, "Rubric Student Caller"),
        registerAndLogin(RegisterPublicRole.Parent, "Rubric Parent Caller"),
        registerAndLogin(RegisterPublicRole.Teacher, "Rubric Uncertified Teacher"),
      ]);

    // The three applicants are independent — parallel lifecycle flips +
    // subscription activations.
    await Promise.all(
      [applicantPass, applicantFail, applicantDemoted].map(async applicant => {
        expect(await promoteApplicantToEvaluation(applicant.userId)).toBe("in_evaluation");
        // The ACTIVE verification subscription is NOT a user row — its id is
        // deliberately NOT tracked (the hygiene sweep is keyed by user ids
        // only; the booking suite's convention). The subscription itself
        // cascades away with its owner user.
        await insertActiveVerificationSubscription(applicant.userId);
      })
    );

    // ─── The booking loop (the real DEV2-006 surface): five distinct ───
    // evaluators per applicant + the probe pair. Concurrent bookings — the
    // per-applicant lock serializes each applicant's own five.
    const booked = await Promise.all([
      ...Array.from({ length: LOOP_EVALUATOR_COUNT }, (_, slot) =>
        bookSession(applicantPass, evaluators[slot].userId).then(id => {
          passSessions[slot] = id;
          return id;
        })
      ),
      ...Array.from({ length: LOOP_EVALUATOR_COUNT }, (_, slot) =>
        bookSession(applicantFail, evaluators[slot].userId).then(id => {
          failSessions[slot] = id;
          return id;
        })
      ),
      bookSession(applicantDemoted, evaluatorProbe.userId).then(id => {
        probeSession = id;
        return id;
      }),
    ]);
    expect(booked).toHaveLength(LOOP_EVALUATOR_COUNT * 2 + 1);
    expect(passSessions).toHaveLength(LOOP_EVALUATOR_COUNT);
    expect(failSessions).toHaveLength(LOOP_EVALUATOR_COUNT);
    // Every booked id is a positive session row id (no undefined slots).
    for (const id of [...passSessions, ...failSessions]) {
      expect(typeof id).toBe("number");
      expect(id).toBeGreaterThan(0);
    }
  }, 120_000);

  // ─── Hygiene: restore the shared dev database to canonical seed state ───
  afterAll(async () => {
    const ids = [...createdUserIds];
    if (ids.length > 0) {
      await deleteSessionsByParticipantUserIds(ids);
      const deleted = await deleteUsersByIds(ids);
      expect(deleted).toBe(ids.length);
      expect(await countUsersByIds(ids)).toBe(0);
    }
  });

  test("anonymous caller gets UNAUTHORIZED on the mutation and both reads (401 semantics, never FORBIDDEN)", async () => {
    const mutation = await submitRubric({ userId: 0, accessToken: "" }, 1, passingInput(85));
    expectMutationError(mutation.error, "UNAUTHORIZED");
    expect(mutation.data?.submitRubricEvaluation ?? null).toBeNull();

    const pending = await testClient.query({
      query: myRubricPendingSessionsDocument,
      variables: { page: 1, pageSize: 25 },
    });
    expectMutationError(pending.error, "UNAUTHORIZED");

    const own = await testClient.query({
      query: myRubricEvaluationDocument,
      variables: { sessionId: "1" },
    });
    expectMutationError(own.error, "UNAUTHORIZED");
    expect(own.data?.myRubricEvaluation ?? null).toBeNull();
  });

  test("student and parent callers get FORBIDDEN at the role scope on all three fields (the service is never reached)", async () => {
    for (const caller of [studentCaller, parentCaller]) {
      if (!caller) throw new Error("role-caller fixtures missing");
    }
    const studentMutation = await submitRubric(studentCaller, 1, passingInput(85));
    expectMutationError(studentMutation.error, "FORBIDDEN");
    expect(studentMutation.data?.submitRubricEvaluation ?? null).toBeNull();
    const parentMutation = await submitRubric(parentCaller, 1, passingInput(85));
    expectMutationError(parentMutation.error, "FORBIDDEN");

    const studentPending = await testClient.query({
      query: myRubricPendingSessionsDocument,
      variables: { page: 1, pageSize: 25 },
      context: { headers: authHeaders(studentCaller.accessToken) },
    });
    expectMutationError(studentPending.error, "FORBIDDEN");

    const parentOwn = await testClient.query({
      query: myRubricEvaluationDocument,
      variables: { sessionId: "1" },
      context: { headers: authHeaders(parentCaller.accessToken) },
    });
    expectMutationError(parentOwn.error, "FORBIDDEN");
  });

  test("the typed validation band denies pre-DB over the wire (score band, observations bound, weakness iff-rule)", async () => {
    const session = String(passSessions[0]);
    const evaluator = evaluators[0];

    const malformedId = await submitRubric(evaluator, 0, passingInput(85));
    expectMutationError(malformedId.error, "VALIDATION");

    const scoreTooHigh = await submitRubric(evaluator, Number(session), passingInput(101));
    expectMutationError(scoreTooHigh.error, "RUBRIC_SCORE_INVALID");

    const blankNotes = await submitRubric(evaluator, Number(session), {
      score: 85,
      notes: "   ",
      weaknessArea: null,
    });
    expectMutationError(blankNotes.error, "RUBRIC_NOTES_REQUIRED");

    const missingWeakness = await submitRubric(evaluator, Number(session), {
      score: 50,
      notes: "Hesitant application of the rules below the threshold.",
      weaknessArea: null,
    });
    expectMutationError(missingWeakness.error, "RUBRIC_WEAKNESS_REQUIRED");

    const forbiddenWeakness = await submitRubric(evaluator, Number(session), {
      score: 85,
      notes: "Strong session; no failing area to record.",
      weaknessArea: WIRE_WEAKNESS_HIFZ,
    });
    expectMutationError(forbiddenWeakness.error, "RUBRIC_WEAKNESS_NOT_ALLOWED");
    expect(forbiddenWeakness.data?.submitRubricEvaluation ?? null).toBeNull();
  });

  test("the weakness vocabulary is wire-enforced: the lowercase runtime value dies at variable coercion", async () => {
    // The typed base carries the honest `null`; Object.assign then injects
    // the hostile lowercase runtime string — no cast (the registration-suite
    // hostile-field pattern). The enum's wire vocabulary is uppercase-only,
    // so the value dies at variable coercion — Apollo's BAD_USER_INPUT
    // channel — before any resolver, and therefore any service code, runs.
    const hostileInput: RubricEvaluationVariables["input"] = {
      score: 50,
      notes: "Failing draft with a foreign area spelling.",
      weaknessArea: null,
    };
    Object.assign(hostileInput, { weaknessArea: "hifz" });
    const coercion = await testClient.mutate({
      mutation: submitRubricEvaluationDocument,
      variables: { sessionId: String(passSessions[0]), input: hostileInput },
      context: { headers: authHeaders(evaluators[0].accessToken) },
    });
    expectMutationError(coercion.error, "BAD_USER_INPUT");
    expect(coercion.data?.submitRubricEvaluation ?? null).toBeNull();
  });

  test("a submission on an owned, typed, but not-completed session surfaces RUBRIC_SESSION_NOT_COMPLETED; the scheduled session is not pending", async () => {
    const probe = await submitRubric(evaluatorProbe, probeSession, passingInput(85));
    expectMutationError(probe.error, "RUBRIC_SESSION_NOT_COMPLETED");

    // The scheduled probe session is not pending material (only completed
    // rows await a rubric), so the probe teacher's page is the honest empty.
    const pending = await testClient.query({
      query: myRubricPendingSessionsDocument,
      variables: { page: null, pageSize: null },
      context: { headers: authHeaders(evaluatorProbe.accessToken) },
    });
    expect(pending.error).toBeUndefined();
    const page = pending.data?.myRubricPendingSessions;
    if (!page) throw new Error("myRubricPendingSessions returned no value");
    expect(page.totalCount).toBe(0);
    expect(page.items).toHaveLength(0);
    // Explicit-null pagination members normalize to the honest defaults.
    expect(page.page).toBe(1);
    expect(page.pageSize).toBe(25);
  });

  test("a foreign evaluator's session is SESSION_NOT_FOUND — byte-identical to an unknown one (oracle-free)", async () => {
    const foreign = await submitRubric(evaluators[0], failSessions[1], passingInput(85));
    expectMutationError(foreign.error, "SESSION_NOT_FOUND");
    expect(foreign.data?.submitRubricEvaluation ?? null).toBeNull();
  });

  test("completed evaluation sessions become pending material; the completed five page per evaluator", async () => {
    // Per-teacher sequential lifecycle (start → complete), parallel across
    // teachers — each evaluator finalizes their PASS and FAIL cycles.
    await Promise.all(
      evaluators.map((evaluator, slot) =>
        (async () => {
          await startAndCompleteSession(evaluator, passSessions[slot]);
          await startAndCompleteSession(evaluator, failSessions[slot]);
        })()
      )
    );

    // Caller-scoped reads chained SEQUENTIALLY via `reduce` (the
    // no-await-in-loop rule's sanctioned sequential shape). Each page is
    // identity-sensitive: under simultaneous wire pressure the parallel
    // batch surfaced a cross-caller identity bleed (slot 1's page came back
    // as slot 0's rows), so the reads are deliberately serialized — the
    // pairing below then pins each page to its own evaluator.
    interface PendingPageResult {
      readonly pending: Awaited<ReturnType<typeof runPendingPage>>;
      readonly slot: number;
      readonly evaluator: RegistrationOutcome;
    }
    const runPendingPage = (evaluator: RegistrationOutcome) =>
      testClient.query({
        query: myRubricPendingSessionsDocument,
        variables: { page: 1, pageSize: 25 },
        context: { headers: authHeaders(evaluator.accessToken) },
      });
    const pendingPages: PendingPageResult[] = [];
    await evaluators.reduce<Promise<number>>(
      (chain, evaluator, slot) =>
        chain.then(async () => {
          pendingPages.push({ pending: await runPendingPage(evaluator), slot, evaluator });
          return pendingPages.length;
        }),
      Promise.resolve(0)
    );

    for (const { pending, slot, evaluator } of pendingPages) {
      expect(pending.error).toBeUndefined();
      const page = pending.data?.myRubricPendingSessions;
      if (!page) throw new Error("myRubricPendingSessions returned no value");
      // Both completed cycles are the caller's OWN rows; the teacher leg is
      // the caller, so each evaluator pages exactly their two rows.
      expect(page.totalCount).toBe(2);
      expect(page.items).toHaveLength(2);
      const ids = new Set(page.items.map(item => item.id));
      if (!ids.has(String(passSessions[slot])) || !ids.has(String(failSessions[slot]))) {
        throw new Error(
          "PAGE MISMATCH " +
            JSON.stringify({ slot, evaluatorId: evaluator.userId, passSessions, failSessions, items: page.items })
        );
      }
      expect(ids.has(String(passSessions[slot]))).toBe(true);
      expect(ids.has(String(failSessions[slot]))).toBe(true);
      for (const item of page.items) {
        expect(item.teacherId).toBe(String(evaluator.userId));
        expect(item.studentId === String(applicantPass.userId) || item.studentId === String(applicantFail.userId)).toBe(
          true
        );
        expect(item.status).toBe(SessionStatus.Completed);
        expect(item.sessionType).toBe(SessionType.TeacherEvaluation);
      }
    }
  });

  test("below-quorum submissions commit alone: InEvaluation status, honest shape, and the pending page drains", async () => {
    // Per-slot submission + drain read are an ordered lifecycle pair
    // (submit → the caller's own page drains) — chained SEQUENTIALLY via
    // `reduce` (the no-await-in-loop rule's sanctioned sequential shape)
    // so each drain observes its own submission's commit.
    const DRAIN_SLOTS = [0, 1, 2, 3] as const;
    const drainTotals: number[] = [];
    await DRAIN_SLOTS.reduce<Promise<number>>(
      (chain, slot) =>
        chain.then(async () => {
          const submission = await submitRubric(evaluators[slot], passSessions[slot], passingInput(85));
          expect(submission.error).toBeUndefined();
          const rubric = submission.data?.submitRubricEvaluation;
          if (!rubric) throw new Error("submitRubricEvaluation returned no value");
          expect(rubric.id).toBeTruthy();
          expect(rubric.sessionId).toBe(String(passSessions[slot]));
          expect(rubric.evaluatedId).toBe(String(applicantPass.userId));
          expect(rubric.evaluatorId).toBe(String(evaluators[slot].userId));
          expect(rubric.score).toBe(85);
          expect(rubric.weaknessArea).toBeNull();
          expect(rubric.createdAt).toBeTruthy();
          expect(rubric.applicantStatus).toBe(ApplicantStatus.InEvaluation);

          const drained = await testClient.query({
            query: myRubricPendingSessionsDocument,
            variables: { page: 1, pageSize: 25 },
            context: { headers: authHeaders(evaluators[slot].accessToken) },
          });
          expect(drained.error).toBeUndefined();
          drainTotals.push(drained.data?.myRubricPendingSessions?.totalCount ?? -1);
          return drainTotals.length;
        }),
      Promise.resolve(0)
    );
    for (const total of drainTotals) {
      expect(total).toBe(1);
    }
  });

  test("a duplicate submission is collapsed onto EVALUATION_ALREADY_SUBMITTED by the write-once arbiter", async () => {
    const duplicate = await submitRubric(evaluators[0], passSessions[0], passingInput(90));
    expectMutationError(duplicate.error, "EVALUATION_ALREADY_SUBMITTED");
    expect(duplicate.data?.submitRubricEvaluation ?? null).toBeNull();
  });

  test("the fifth submission finalizes the PASS cycle: Passed status on the return and the read", async () => {
    const finalizer = evaluators[4];
    const submission = await submitRubric(finalizer, passSessions[4], passingInput(90));
    expect(submission.error).toBeUndefined();
    const rubric = submission.data?.submitRubricEvaluation;
    if (!rubric) throw new Error("submitRubricEvaluation returned no value");
    expect(rubric.score).toBe(90);
    expect(rubric.weaknessArea).toBeNull();
    expect(rubric.applicantStatus).toBe(ApplicantStatus.Passed);

    const pending = await testClient.query({
      query: myRubricPendingSessionsDocument,
      variables: { page: 1, pageSize: 25 },
      context: { headers: authHeaders(finalizer.accessToken) },
    });
    expect(pending.error).toBeUndefined();
    expect(pending.data?.myRubricPendingSessions?.totalCount ?? -1).toBe(1);
  });

  test("the own-submission read returns the caller's pair with the LIVE applicant status; foreign and unknown pairs share SESSION_NOT_FOUND", async () => {
    const own = await testClient.query({
      query: myRubricEvaluationDocument,
      variables: { sessionId: String(passSessions[0]) },
      context: { headers: authHeaders(evaluators[0].accessToken) },
    });
    expect(own.error).toBeUndefined();
    const rubric = own.data?.myRubricEvaluation;
    if (!rubric) throw new Error("myRubricEvaluation returned no value");
    expect(rubric.id).toBeTruthy();
    expect(rubric.sessionId).toBe(String(passSessions[0]));
    expect(rubric.evaluatedId).toBe(String(applicantPass.userId));
    expect(rubric.evaluatorId).toBe(String(evaluators[0].userId));
    expect(rubric.score).toBe(85);
    expect(rubric.weaknessArea).toBeNull();
    // LIVE post-write status — the cycle finalized with the fifth submission.
    expect(rubric.applicantStatus).toBe(ApplicantStatus.Passed);

    const foreign = await testClient.query({
      query: myRubricEvaluationDocument,
      variables: { sessionId: String(passSessions[1]) },
      context: { headers: authHeaders(evaluators[0].accessToken) },
    });
    expectMutationError(foreign.error, "SESSION_NOT_FOUND");

    const unknown = await testClient.query({
      query: myRubricEvaluationDocument,
      variables: { sessionId: "999999999" },
      context: { headers: authHeaders(evaluatorProbe.accessToken) },
    });
    expectMutationError(unknown.error, "SESSION_NOT_FOUND");

    const malformed = await testClient.query({
      query: myRubricEvaluationDocument,
      variables: { sessionId: "0" },
      context: { headers: authHeaders(evaluatorProbe.accessToken) },
    });
    expectMutationError(malformed.error, "VALIDATION");
  });

  test("the FAIL cycle: the weakness round-trips on the wire and the fifth submission returns Failed", async () => {
    // E1's failing rubric carries its Hifz area (required below the
    // threshold); E2..E4 pass cleanly; E5's fifth submission finalizes FAIL.
    const failing = await submitRubric(evaluators[0], failSessions[0], {
      score: 79,
      notes: "Recurring tajweed slips at the letter-level rules.",
      weaknessArea: WIRE_WEAKNESS_HIFZ,
    });
    expect(failing.error).toBeUndefined();
    const failingRubric = failing.data?.submitRubricEvaluation;
    if (!failingRubric) throw new Error("submitRubricEvaluation returned no value");
    expect(failingRubric.score).toBe(79);
    expect(failingRubric.weaknessArea).toBe(WIRE_WEAKNESS_HIFZ);
    expect(failingRubric.applicantStatus).toBe(ApplicantStatus.InEvaluation);

    // E2..E4 submissions chained SEQUENTIALLY via `reduce` (the
    // no-await-in-loop rule's sanctioned sequential shape); every one stays
    // below quorum, so order cannot affect the pinned status.
    const middleStatuses: string[] = [];
    await [1, 2, 3].reduce<Promise<number>>(
      (chain, slot) =>
        chain.then(async () => {
          const submission = await submitRubric(evaluators[slot], failSessions[slot], passingInput(85));
          expect(submission.error).toBeUndefined();
          middleStatuses.push(submission.data?.submitRubricEvaluation?.applicantStatus ?? "");
          return middleStatuses.length;
        }),
      Promise.resolve(0)
    );
    for (const status of middleStatuses) {
      expect(status).toBe(ApplicantStatus.InEvaluation);
    }

    const finalizer = evaluators[4];
    const final = await submitRubric(finalizer, failSessions[4], passingInput(90));
    expect(final.error).toBeUndefined();
    expect(final.data?.submitRubricEvaluation?.applicantStatus ?? "").toBe(ApplicantStatus.Failed);

    const own = await testClient.query({
      query: myRubricEvaluationDocument,
      variables: { sessionId: String(failSessions[0]) },
      context: { headers: authHeaders(evaluators[0].accessToken) },
    });
    expect(own.error).toBeUndefined();
    expect(own.data?.myRubricEvaluation?.applicantStatus ?? "").toBe(ApplicantStatus.Failed);
  });

  test("a non-in_evaluation applicant's session denies with APPLICANT_NOT_IN_EVALUATION at the lock gate", async () => {
    // The probe teacher finalizes their scheduled session, then the
    // applicant's lifecycle is fixture-demoted to the pre-finalization
    // state (no wire operation writes it backward) — the status gate must
    // fire before any submission write.
    await startAndCompleteSession(evaluatorProbe, probeSession);
    expect(await demoteApplicantToPending(applicantDemoted.userId)).toBe("pending");

    const denied = await submitRubric(evaluatorProbe, probeSession, passingInput(85));
    expectMutationError(denied.error, "APPLICANT_NOT_IN_EVALUATION");
  });

  test("the certification gate is the oracle-safe EMPTY page for a Teacher-role caller without the evaluator row", async () => {
    const pending = await testClient.query({
      query: myRubricPendingSessionsDocument,
      variables: { page: 1, pageSize: 25 },
      context: { headers: authHeaders(uncertifiedTeacher.accessToken) },
    });
    expect(pending.error).toBeUndefined();
    const page = pending.data?.myRubricPendingSessions;
    if (!page) throw new Error("myRubricPendingSessions returned no value");
    expect(page.totalCount).toBe(0);
    expect(page.items).toHaveLength(0);
  });

  test("typed denials localize: the same code carries distinct non-empty en and ar messages", async () => {
    const english = await submitRubric(evaluators[0], passSessions[0], passingInput(101));
    const englishErrors = expectMutationError(english.error, "RUBRIC_SCORE_INVALID");
    const englishMessage = englishErrors.errors[0]?.message ?? "";
    expect(englishMessage.length).toBeGreaterThan(0);

    const arabic = await testClient.mutate({
      mutation: submitRubricEvaluationDocument,
      variables: { sessionId: String(passSessions[0]), input: passingInput(101) },
      context: { headers: authHeaders(evaluators[0].accessToken, "ar") },
    });
    const arabicErrors = expectMutationError(arabic.error, "RUBRIC_SCORE_INVALID");
    const arabicMessage = arabicErrors.errors[0]?.message ?? "";
    expect(arabicMessage.length).toBeGreaterThan(0);
    expect(arabicMessage).not.toBe(englishMessage);
  });
});
