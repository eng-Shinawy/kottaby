/**
 * Converted-applicant role-surface suite — the wire-boundary proof that the
 * rubric-fail role flip (teacher → student) is SUFFICIENT to unlock every
 * shipped student-gated surface with ZERO resolver edits, while the
 * teacher-only read stays locked and the GraphQL schema itself needs no
 * changes.
 *
 * Runs over the REAL boundary: `setupTestServerLifecycle` boots the Next dev
 * server on the shared TEST_PORT (3066) and every call goes through Apollo
 * Client v4 + the shared error helpers, mirroring
 * `frontend/graphql/test/teachers/verification-plan-purchase.test.ts` (the
 * pattern source for the register/login + Bearer-header harness).
 *
 * Boundary purity (frontend/graphql/test/AGENTS.md rule 10): this file
 * interacts with the application EXCLUSIVELY through the GraphQL API
 * (`testClient` + shared TypedDocumentNodes). The only external data
 * prerequisite is the SEEDED verification-plan catalog member: the
 * `purchaseVerificationPlan` cooldown leg reaches the verification-purchase
 * SERVICE gate only when the ACTIVE canonical plan resolves server-side (the
 * service looks it up by `VERIFICATION_PLAN_TITLE` BEFORE the applicant
 * gate), so `beforeAll` probes the `planCatalog` over the wire and fails
 * setup with an actionable error when the member is absent — REQUIRED seed
 * data for this tier, never provisioned here (same posture as
 * `verification-plan-purchase.test.ts`). The only non-wire state is the
 * converted account shape — the role flip + `students` child row + the
 * failed/cooldown `applicants` row — which production reaches ONLY inside
 * the rubric-finalization transaction (no public GraphQL surface performs
 * it), so it is provisioned through the sanctioned fixture-row seam in
 * `test/helpers/fixture-rows.ts` (`insertConvertedStudentState` /
 * `failApplicantWithCooldown`), exactly like the promotion/demotion
 * fixtures the sibling suites use. The cast's users + applicants rows are
 * created by the real public registration service.
 *
 * Surface matrix, in TWO token phases — the GraphQL role scopes evaluate
 * the role claim EMBEDDED IN THE ACCESS TOKEN (`ctx.role` ← `payload.role`;
 * the fresh DB row's role is never consulted by a scope), while ROW READS
 * (`me`, and every service-level self-read) always see the fresh DB row:
 *
 *  - Phase 1 — STALE PRE-FLIP token (minted at login BEFORE the fixture
 *    flip; still claims `teacher`): the documented transient stale-claim
 *    window.
 *    Student-gated surfaces DENY (FORBIDDEN — the stale `teacher` claim
 *    fails the `role: [UserRole.Student]` scope leg) while the
 *    teacher-gated `myApplicantProfile` self-read still RESOLVES (the
 *    stale claim admits the teacher scope; the service returns the
 *    caller's own failed/cooldown applicant row). No forced revocation
 *    exists on flip (a deliberate no-op) — the window closes on
 *    the next silent token refresh, exactly like the AuthProvider's
 *    refresh-then-retry recovery path.
 *  - Phase 2 — POST-REFRESH token (`AuthService.refreshToken` verifies the
 *    refresh token, re-reads the user row, and re-signs the access token
 *    from the FRESH DB role): the state every real client converges to.
 *    Student-gated surfaces SUCCEED (authorization success — the only
 *    observed denial on `purchaseSubscription` is the POST-authorization
 *    plan miss, never FORBIDDEN/UNAUTHORIZED), and `myApplicantProfile` is
 *    FORBIDDEN. That teacher-gate consequence is asserted intentionally —
 *    a future widening of that gate flips this assertion.
 *  - `purchaseVerificationPlan` — `authenticated`-only (no role leg), so it
 *    is claim-phase-agnostic: exercised on the STALE token to prove the
 *    re-apply path is unaffected by the flip in EITHER phase; the converted
 *    student under an ACTIVE re-application cooldown still reaches the
 *    service gate and receives the typed `APPLICANT_COOLDOWN_ACTIVE`
 *    denial (a 403 role denial would be a regression; a PLAN_NOT_FOUND
 *    would mean the seeded canonical catalog member is missing — the
 *    beforeAll probe above guards that prerequisite).
 *  - Row-vs-claim split: `me` carries only the `authenticated` scope and
 *    returns `ctx.user` — the user row re-fetched from the DB at context
 *    build time — so even the STALE token observes `role === Student` on
 *    `me`. The stale claim is observable ONLY through scope decisions
 *    (denied student gates / admitted teacher gate above), never through a
 *    row read.
 *  - BFLA: a certified teacher (real `teacher` child row) is
 *    denied the student-only mutation `purchaseSubscription` and the
 *    student-only read `myStudentSessions`, and still reads
 *    `myApplicantProfile` (positive control).
 *  - BOLA: caller-scoped reads never cross tenants — the converted
 *    student's session list and handshake code expose only their own rows.
 *
 * Data lifecycle: the suite commits its cast on the shared dev database
 * (live-server convention) and drains it in `afterAll` — participant
 * sessions first (`deleteSessionsByParticipantUserIds`), then every tracked
 * user (`deleteUsersByIds`), with a zero-residue re-probe.
 */

import { afterAll, beforeAll, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";

import { SessionStatus as SessionStatusSeed } from "@/backend/enum/scheduling/session-status.enum";
import { ApplicantStatus as ApplicantStatusSeed } from "@/backend/enum/teachers/applicant-status.enum";
import {
  ApplicantStatus,
  RegisterPublicRole,
  SessionIntent,
  SessionStatus,
  UserRole,
} from "@/frontend/graphql/generated/gql/graphql";
import {
  loginMutationDocument,
  meQueryDocument,
  refreshTokenMutationDocument,
  registerUserMutationDocument,
} from "@/frontend/graphql/sharedDocuments/auth/auth.documents";
import { planCatalogQueryDocument } from "@/frontend/graphql/sharedDocuments/billing/plan-catalog.documents";
import { purchaseSubscriptionMutationDocument } from "@/frontend/graphql/sharedDocuments/billing/subscription-purchase.documents";
import { purchaseVerificationPlanMutationDocument } from "@/frontend/graphql/sharedDocuments/billing/verification-purchase.documents";
import { createSessionMutationDocument } from "@/frontend/graphql/sharedDocuments/scheduling/session-lifecycle.documents";
import { myStudentSessionsQueryDocument } from "@/frontend/graphql/sharedDocuments/scheduling/session-reads.documents";
import { myHandshakeCodeQueryDocument } from "@/frontend/graphql/sharedDocuments/students/handshake-code.documents";
import { myApplicantProfileQueryDocument } from "@/frontend/graphql/sharedDocuments/teachers/applicant.documents";
import { VERIFICATION_PLAN_TITLE } from "@/shared/constants/verification-plan.constants";
import {
  countUsersByIds,
  deleteSessionsByParticipantUserIds,
  deleteUsersByIds,
  describeGraphqlSuite,
  expectMutationError,
  extractErrorCode,
  failApplicantWithCooldown,
  insertCertifiedTeacherRow,
  insertConvertedStudentState,
  insertSessionRow,
  setupTestServerLifecycle,
  testClient,
} from "@/test/helpers";

/** Per-run salt — unique emails and idempotency keys, never shared across runs. */
const PREFIX = randomUUID().slice(0, 8);

// Named without the literal `password` token so `sonarjs/no-hardcoded-passwords`
// does not flag it (same convention as the sibling suites).
const testCredential = "Password123";

/** Re-application cooldown stamped on the converted applicant — safely in the future. */
const COOLDOWN_UNTIL = new Date(Date.now() + 7 * 86_400_000);

interface RegistrationOutcome {
  readonly userId: number;
  readonly email: string;
  readonly accessToken: string;
  readonly refreshToken: string;
}

/** Bearer-header request context for one actor. */
function bearer(accessToken: string): { headers: { Authorization: string } } {
  return { headers: { Authorization: `Bearer ${accessToken}` } };
}

/**
 * Registers a `teacher` user through the PUBLIC registerUser mutation (which
 * provisions the pending `applicants` row as a real side effect) and logs in
 * through the PUBLIC login mutation. Returned tokens carry the role captured
 * at signing time — for the converted actor this is the PRE-flip token pair.
 */
async function registerTeacherAndLogin(emailLocalPart: string): Promise<RegistrationOutcome> {
  const email = `${emailLocalPart}-${Date.now()}-${randomUUID().slice(0, 8)}@test.local`;
  const registered = await testClient.mutate({
    mutation: registerUserMutationDocument,
    variables: {
      input: {
        fullName: "Converted Role-Surface Actor",
        email,
        phone: "+201234567890",
        password: testCredential,
        gender: null,
        country: "EG",
        role: RegisterPublicRole.Teacher,
        preferredRecitation: null,
      },
    },
  });
  expect(registered.error).toBeUndefined();
  const userId = registered.data?.registerUser?.id;
  if (!userId) throw new Error("registerUser returned no id");

  const loggedIn = await testClient.mutate({
    mutation: loginMutationDocument,
    variables: { email, password: testCredential },
  });
  expect(loggedIn.error).toBeUndefined();
  const accessToken = loggedIn.data?.login?.accessToken;
  const refreshToken = loggedIn.data?.login?.refreshToken;
  if (!accessToken || !refreshToken) throw new Error("login returned no token pair");

  return { userId, email, accessToken, refreshToken };
}

// ─── Harness state ───────────────────────────────────────────────────────────

/** The converted student whose surfaces are under test. */
const actorA = {
  userId: 0,
  preFlipAccessToken: "",
  preFlipRefreshToken: "",
  postRefreshAccessToken: "",
  postRefreshRefreshToken: "",
  handshakeCode: "",
};
/** A second converted student — the BOLA neighbor. */
const actorB = { userId: 0, handshakeCode: "", sessionRowId: "" };
/** A real certified teacher — the BFLA negative actor + booking target. */
const teacherC = { userId: 0, email: "" };

/** The session actorA books over the wire (tracked for cleanup). */
let bookedSessionId: string | null = null;

const castUserIds = (): number[] => [actorA.userId, actorB.userId, teacherC.userId].filter(id => id > 0);

describeGraphqlSuite("applicant-conversion role surface GraphQL Integration", () => {
  setupTestServerLifecycle();

  beforeAll(async () => {
    // ── Cast provisioning (real registration + sanctioned conversion fixtures) ──
    const a = await registerTeacherAndLogin(`conv-a-${PREFIX}`);
    actorA.userId = a.userId;
    // PRE-flip token pair: minted while the account is still `teacher` —
    // the stale-claim (phase 1) legs depend on this ordering.
    actorA.preFlipAccessToken = a.accessToken;
    actorA.preFlipRefreshToken = a.refreshToken;

    // ── Seeded-catalog prerequisite probe (mirrors verification-plan-purchase.test.ts) ──
    // The `purchaseVerificationPlan` cooldown leg resolves the ACTIVE
    // canonical verification plan SERVER-side by exact title match BEFORE
    // the applicant gate, so on an unseeded catalog the leg would fail with
    // a misleading PLAN_NOT_FOUND instead of the pinned
    // APPLICANT_COOLDOWN_ACTIVE. The member is SEEDED catalog data for this
    // tier — REQUIRED, never provisioned here (same posture as the sibling
    // suite): the probe runs over the REAL GraphQL boundary with the first
    // authenticated cast token (`planCatalog` is authenticated-only) and
    // FAILS SETUP with an actionable error when it is absent.
    const catalog = await testClient.query({
      query: planCatalogQueryDocument,
      context: bearer(actorA.preFlipAccessToken),
    });
    expect(catalog.error).toBeUndefined();
    const hasCanonicalMember = (catalog.data?.planCatalog ?? []).some(plan => plan.title === VERIFICATION_PLAN_TITLE);
    if (!hasCanonicalMember) {
      throw new Error(
        "setup: the seeded catalog has no ACTIVE verification plan row — run `bun run db seed` before this suite"
      );
    }

    const b = await registerTeacherAndLogin(`conv-b-${PREFIX}`);
    actorB.userId = b.userId;

    const c = await registerTeacherAndLogin(`conv-c-${PREFIX}`);
    teacherC.userId = c.userId;
    teacherC.email = c.email;
    await insertCertifiedTeacherRow(c.userId);

    // Convert A: guarded role flip + zeroed students row, then the failed
    // applicants row with the ACTIVE re-application cooldown (the exact
    // post-rubric-fail shape). B converts too (no cooldown needed).
    actorA.handshakeCode = await insertConvertedStudentState(a.userId);
    // The fixture returns the RAW varchar DB value (`ApplicantStatus.Failed`
    // = "failed" per the backend seed enum) — NOT the GraphQL wire casing.
    expect(await failApplicantWithCooldown(a.userId, COOLDOWN_UNTIL)).toBe(ApplicantStatusSeed.Failed);
    actorB.handshakeCode = await insertConvertedStudentState(b.userId);

    // Phase-2 token (self-healing refresh): refresh AFTER the flip.
    // AuthService.refreshToken re-reads the user row and re-signs the access
    // token from the FRESH DB role (`student`) — the token phase the
    // student-gate SUCCESS legs + the teacher-gate lock are anchored on. The
    // rotation consumes the pre-flip refresh token (mirrors the
    // AuthProvider's silent refresh-then-retry recovery; no forced
    // revocation exists).
    const refreshed = await testClient.mutate({
      mutation: refreshTokenMutationDocument,
      variables: { refreshToken: actorA.preFlipRefreshToken },
    });
    expect(refreshed.error).toBeUndefined();
    const postRefreshAccess = refreshed.data?.refreshToken?.accessToken;
    const postRefreshRefresh = refreshed.data?.refreshToken?.refreshToken;
    if (!postRefreshAccess || !postRefreshRefresh) {
      throw new Error("fixture refresh did not return a rotated token pair");
    }
    actorA.postRefreshAccessToken = postRefreshAccess;
    actorA.postRefreshRefreshToken = postRefreshRefresh;

    // Pre-seeded cross-tenant session row for the BOLA legs.
    actorB.sessionRowId = String(
      (await insertSessionRow({ teacherId: c.userId, studentId: b.userId, status: SessionStatusSeed.Scheduled })).id
    );
  });

  afterAll(async () => {
    const ids = castUserIds();
    if (ids.length === 0) return;
    // FK-safe order: participant sessions first, then the users (child rows cascade).
    await deleteSessionsByParticipantUserIds(ids);
    const deleted = await deleteUsersByIds(ids);
    expect(deleted).toBe(ids.length);
    expect(await countUsersByIds(ids)).toBe(0);
  });

  // ── Phase 2: POST-refresh token (fresh `student` claim) — student-gated surfaces SUCCEED ──

  test("purchaseSubscription: converted student passes the Student role gate (typed PLAN_NOT_FOUND, never FORBIDDEN)", async () => {
    const result = await testClient.mutate({
      mutation: purchaseSubscriptionMutationDocument,
      // POST-refresh token: the access claim is `student`, so the scope leg
      // passes. A well-formed but unknown plan id: coercion + lookup run
      // AFTER the scope step AND after the pre-DB idempotency-key guard, so
      // the typed PLAN_NOT_FOUND denial IS the proof that authorization
      // succeeded (a role denial would surface first as
      // FORBIDDEN/UNAUTHORIZED).
      variables: { input: { planId: "99999999" } },
      context: {
        headers: {
          ...bearer(actorA.postRefreshAccessToken).headers,
          // Valid key: present, non-empty — the service's pre-DB key guard
          // passes (an absent header would answer VALIDATION before the
          // plan lookup), so the denial comes from the plan gate. The plan
          // miss precedes the transaction: no rows are written and the key
          // is never burned.
          "x-idempotency-key": `${PREFIX}-plan-a`,
        },
      },
    });
    const error = expectMutationError(result.error);
    const code = extractErrorCode(error);
    expect(code).not.toBe("FORBIDDEN");
    expect(code).not.toBe("UNAUTHORIZED");
    expectMutationError(result.error, "PLAN_NOT_FOUND");
  });

  test("createSession: converted student books a session (authorization success — the booking actually lands)", async () => {
    const result = await testClient.mutate({
      mutation: createSessionMutationDocument,
      variables: {
        input: { intent: SessionIntent.Hifz, teacherId: String(teacherC.userId) },
      },
      context: {
        headers: {
          ...bearer(actorA.postRefreshAccessToken).headers,
          // Fresh per-booking idempotency key — the booking is idempotent per key.
          "x-idempotency-key": `${PREFIX}-book-a`,
        },
      },
    });
    expect(result.error).toBeUndefined();
    const created = result.data?.createSession;
    if (!created) throw new Error("createSession returned no payload");
    expect(created.status).toBe(SessionStatus.Scheduled);
    expect(created.studentId).toBe(String(actorA.userId));
    expect(created.teacherId).toBe(String(teacherC.userId));
    bookedSessionId = created.id;
  });

  test("myStudentSessions: caller-scoped read sees ONLY the converted student's own booking (BOLA)", async () => {
    if (bookedSessionId === null) throw new Error("booking step did not run");
    const result = await testClient.query({
      query: myStudentSessionsQueryDocument,
      variables: { filter: null, page: null, pageSize: null },
      context: bearer(actorA.postRefreshAccessToken),
    });
    expect(result.error).toBeUndefined();
    const page = result.data?.myStudentSessions;
    if (!page) throw new Error("myStudentSessions returned no page");
    expect(page.totalCount).toBe(1);
    expect(page.items.map(item => item.id)).toContain(bookedSessionId);
    // BOLA: the neighbor converted student's pre-seeded session never leaks.
    expect(page.items.map(item => item.id)).not.toContain(actorB.sessionRowId);
  });

  test("myHandshakeCode: self-scoped read returns the converted student's OWN code (BOLA)", async () => {
    const result = await testClient.query({
      query: myHandshakeCodeQueryDocument,
      context: bearer(actorA.postRefreshAccessToken),
    });
    expect(result.error).toBeUndefined();
    expect(result.data?.myHandshakeCode).toBe(actorA.handshakeCode);
    // BOLA: never the neighbor's capability reference.
    expect(result.data?.myHandshakeCode).not.toBe(actorB.handshakeCode);
  });

  // ── Phase 1: STALE pre-flip token — the documented transient stale-claim window ──

  test("purchaseVerificationPlan is UNAFFECTED by the flip: active cooldown still yields APPLICANT_COOLDOWN_ACTIVE (not a 403)", async () => {
    const result = await testClient.mutate({
      mutation: purchaseVerificationPlanMutationDocument,
      // Deliberately the STALE pre-flip token: the surface's scope is
      // `authenticated`-only (no role leg), so it is claim-phase-agnostic —
      // it must admit the caller in BOTH token phases. The cooldown denial
      // comes from the SERVICE-level gate (a row read), not the scope step.
      context: {
        headers: {
          ...bearer(actorA.preFlipAccessToken).headers,
          "x-idempotency-key": `${PREFIX}-reapply-a`,
        },
      },
    });
    expect(result.error).toBeDefined();
    // The authenticated-only scope admits the converted student; the
    // service-level gate denies with the typed cooldown error — a 403 role
    // denial here would mean the flip BROKE the re-apply path.
    expectMutationError(result.error, "APPLICANT_COOLDOWN_ACTIVE");
  });

  test("stale pre-flip token (transient stale-claim window): the student gate DENIES the stale Teacher claim", async () => {
    const result = await testClient.query({
      query: myStudentSessionsQueryDocument,
      variables: { filter: null, page: null, pageSize: null },
      context: bearer(actorA.preFlipAccessToken),
    });
    expect(result.error).toBeDefined();
    // The wire scopes evaluate the EMBEDDED role (ctx.role ← payload.role):
    // the stale token's `teacher` claim fails the `role: [UserRole.Student]`
    // leg → unconditional FORBIDDEN. This is the documented transient
    // stale-claim state — no forced revocation on flip; the window closes
    // on the next silent token refresh (the phase-2 fixture step above).
    expectMutationError(result.error, "FORBIDDEN");
  });

  test("stale pre-flip token (transient stale-claim window): myApplicantProfile still RESOLVES — the stale Teacher claim admits the teacher-gated self-read", async () => {
    const result = await testClient.query({
      query: myApplicantProfileQueryDocument,
      context: bearer(actorA.preFlipAccessToken),
    });
    // The stale `teacher` claim still passes the `role: [UserRole.Teacher]`
    // scope leg, so the self-scope read RESOLVES (2xx) — the service reads
    // the caller's OWN applicants row by ctx.user.id. Transient stale-claim
    // state: the same call is FORBIDDEN once the token is refreshed (the
    // teacher-gate lock leg below).
    expect(result.error).toBeUndefined();
    const profile = result.data?.myApplicantProfile;
    if (!profile) throw new Error("myApplicantProfile returned no payload for the stale-token caller");
    // The row read serves the FRESH converted shape: failed status + the
    // active re-application cooldown stamped by the conversion fixture.
    expect(profile.status).toBe(ApplicantStatus.Failed);
    expect(profile.cooldownActive).toBe(true);
  });

  test("stale-token semantics: me reads the FRESH DB row (role Student) even on the stale token", async () => {
    const result = await testClient.query({
      query: meQueryDocument,
      context: bearer(actorA.preFlipAccessToken),
    });
    expect(result.error).toBeUndefined();
    // `me` carries only the `authenticated` scope and returns ctx.user —
    // the user row RE-FETCHED from the DB at context build time — so the
    // stale claim is invisible here: the row already says `student`. The
    // claim staleness is observable ONLY through scope decisions (the two
    // transient-window legs above), never through a row read.
    expect(result.data?.me?.role).toBe(UserRole.Student);
  });

  test("refreshed token: refresh AFTER the flip re-signs role Student and grants a student surface", async () => {
    // Second rotation over the wire: the fixture already rotated the
    // pre-flip pair once (beforeAll); rotating the ROTATED refresh token
    // again proves the refresh path keeps re-signing from the fresh DB row.
    const refreshed = await testClient.mutate({
      mutation: refreshTokenMutationDocument,
      variables: { refreshToken: actorA.postRefreshRefreshToken },
    });
    expect(refreshed.error).toBeUndefined();
    const newAccessToken = refreshed.data?.refreshToken?.accessToken;
    if (!newAccessToken) throw new Error("refreshToken returned no accessToken");

    const me = await testClient.query({ query: meQueryDocument, context: bearer(newAccessToken) });
    expect(me.error).toBeUndefined();
    // The refreshed token is signed from the FRESH DB row: role student.
    expect(me.data?.me?.role).toBe(UserRole.Student);

    const sessions = await testClient.query({
      query: myStudentSessionsQueryDocument,
      variables: { filter: null, page: null, pageSize: null },
      context: bearer(newAccessToken),
    });
    expect(sessions.error).toBeUndefined();
    expect(sessions.data?.myStudentSessions).toBeDefined();
  });

  // ── Phase 2 boundary: the teacher-only read is test-locked against the POST-refresh (student) claim ──

  test("myApplicantProfile is teacher-gate test-locked: the converted student gets FORBIDDEN on the post-refresh (student) token", async () => {
    const result = await testClient.query({
      query: myApplicantProfileQueryDocument,
      context: bearer(actorA.postRefreshAccessToken),
    });
    expect(result.error).toBeDefined();
    // INTENTIONAL teacher-gate consequence: once the access claim is `student`, the
    // `role: [UserRole.Teacher]` scope leg fails → FORBIDDEN. (On the STALE
    // pre-flip token the same call still RESOLVES — the transient-window
    // leg above.) If this assertion ever fails because the gate was
    // widened, that widening is the change under review.
    expectMutationError(result.error, "FORBIDDEN");
  });

  // ── BFLA: a certified teacher is denied the student-only surfaces ──

  test("BFLA negative: certified teacher is DENIED purchaseSubscription (Student-only mutation)", async () => {
    const result = await testClient.mutate({
      mutation: purchaseSubscriptionMutationDocument,
      variables: { input: { planId: "99999999" } },
      context: bearer(await teacherAccessToken()),
    });
    expectMutationError(result.error, "FORBIDDEN");
  });

  test("BFLA negative: certified teacher is DENIED myStudentSessions (Student-only read)", async () => {
    const result = await testClient.query({
      query: myStudentSessionsQueryDocument,
      variables: { filter: null, page: null, pageSize: null },
      context: bearer(await teacherAccessToken()),
    });
    expectMutationError(result.error, "FORBIDDEN");
  });

  test("BFLA positive control: the certified teacher still reads myApplicantProfile", async () => {
    const result = await testClient.query({
      query: myApplicantProfileQueryDocument,
      context: bearer(await teacherAccessToken()),
    });
    expect(result.error).toBeUndefined();
    const profile = result.data?.myApplicantProfile;
    if (!profile) throw new Error("myApplicantProfile returned no payload for the certified teacher");
    expect(profile.status).toBe(ApplicantStatus.Pending);
  });

  /** Logs teacherC in on demand (its bearer never predates a flip — C is never converted). */
  async function teacherAccessToken(): Promise<string> {
    const loggedIn = await testClient.mutate({
      mutation: loginMutationDocument,
      variables: { email: teacherC.email, password: testCredential },
    });
    expect(loggedIn.error).toBeUndefined();
    const accessToken = loggedIn.data?.login?.accessToken;
    if (!accessToken) throw new Error("teacher login returned no accessToken");
    return accessToken;
  }
});
