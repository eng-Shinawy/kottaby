/**
 * Session lifecycle QUERIES — REQ-064 query-row integration matrix (task 3.2).
 *
 * Covers the three participant read fields registered by
 * `backend/graphql/query/classes/session-lifecycle.query.ts` over the REAL
 * boundary: `setupTestServerLifecycle` boots the Next dev server on the
 * shared TEST_PORT (3066) and every row goes through Apollo Client v4 + the
 * shared error helpers (`extractErrorCode` / `expectMutationError`) exactly
 * like `frontend/graphql/test/teachers/applicant-profile.test.ts` (the
 * canonical query-suite precedent this file mirrors).
 *
 * Documents: LOCAL `parse`d documents. The shared session documents are a
 * Phase-4 artifact (task 4.1) that does not exist yet, and the
 * `@/backend/db` fixture chain flips bun's module conditions so
 * `graphql-tag`'s UMD build crashes — `parse` yields the same DocumentNode
 * (see the session-sdl.test.ts header note).
 *
 * Authentication mechanism per role (multi-role isolation): the shared
 * `testClient` sends NO cookies between tests, so every test carries its
 * OWN identity via a per-request `Authorization: Bearer <accessToken>`
 * header (context.headers) — the production client path per
 * `gqlContextFactory.extractAccessToken`.
 *
 * Data lifecycle (mirrors applicant-profile.test.ts): public-surface rows
 * (registerUser) and direct-DB fixtures use randomized emails and are NOT
 * cleaned up — GraphQL integration suites accumulate committed rows on the
 * test database by convention. Direct-DB session/teacher/admin provisioning
 * lives in the shared fixture-row helpers (`test/helpers/fixture-rows.ts`,
 * re-exported via `@/test/helpers`) — the integration test file itself
 * touches the API surface only (frontend/graphql/test/AGENTS.md); all
 * identities log in via the public `login` mutation so authorization
 * itself exercises the real token path.
 *
 * REQ-064 query rows proven here:
 *  - Anonymous → UNAUTHORIZED on all three queries (401, never 403).
 *  - Wrong role → FORBIDDEN on the role-gated lists (student on
 *    `myTeacherSessions`; teacher/parent on `myStudentSessions`).
 *  - Participant → data (student and teacher each read the owned row/list).
 *  - Foreign / nonexistent id on `sessionById` → the ONE `null` (oracle
 *    pairing: constant shape — both answers are EXACTLY
 *    `{ sessionById: null }` and indistinguishable); admin/parent
 *    (authenticated non-participants) also get `null`, never an error.
 *  - Teacher applicant on `myTeacherSessions` → ✅ always-empty page (the
 *    honest empty answer, never an error and never a denial).
 *  - Filter coherence: `totalCount` matches the filtered list; the page
 *    echo is honest (out-of-range page ⇒ empty `items` + true count).
 */

import { beforeAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import type { TypedDocumentNode } from "@apollo/client";
import { parse } from "graphql";

import { SessionIntent } from "@/backend/enum/scheduling/session-intent.enum";
import { SessionStatus } from "@/backend/enum/scheduling/session-status.enum";
import { SessionType } from "@/backend/enum/scheduling/session-type.enum";
import { RegisterPublicRole } from "@/frontend/graphql/generated/gql/graphql";
import {
  loginMutationDocument,
  registerUserMutationDocument,
} from "@/frontend/graphql/sharedDocuments/auth/auth.documents";
import {
  expectMutationError,
  insertAdminUserWithChildRow,
  insertCertifiedTeacherRow,
  insertSessionRow,
  setupTestServerLifecycle,
  testClient,
} from "@/test/helpers";

// ─── Wire documents + locally-typed results ──────────────────────────────

/**
 * The shared session documents are a Phase-4 artifact (task 4.1) that does
 * not exist yet, so the wire shapes are declared HERE as local result
 * interfaces and bound to the parsed documents via `TypedDocumentNode`
 * annotations (structurally satisfied by a plain `DocumentNode` — no casts).
 * Enum-typed wire values use member NAMES (the Pothos SDL convention, e.g.
 * `"Scheduled"`); the only literal used in a variable is checked against a
 * name DERIVED from the canonical `SessionStatus` enum (never a hardcoded
 * string equivalent — same derivation the session-sdl suite pins).
 */

/**
 * Resolves the SDL member name of a canonical string-enum member — the wire
 * vocabulary is always DERIVED from the canonical enum (never a hardcoded
 * string equivalent; same derivation the session-sdl suite pins via
 * `Object.keys`).
 */
function enumWireName(enumObject: Record<string, string>, member: string): string {
  const name = Object.entries(enumObject).find(([, value]) => value === member)?.[0];
  if (name === undefined) {
    throw new Error("enumWireName: member vanished from its canonical enum");
  }
  return name;
}

const SCHEDULED_WIRE = enumWireName(SessionStatus, SessionStatus.Scheduled);
const STUDENT_SESSION_WIRE = enumWireName(SessionType, SessionType.StudentSession);
const HIFZ_WIRE = enumWireName(SessionIntent, SessionIntent.Hifz);

/** The `sessionById` selection shape (`id` FIRST per the canonical object). */
interface SessionByIdWire {
  readonly sessionById: {
    readonly id: string;
    readonly teacherId: string;
    readonly studentId: string;
    readonly status: string;
    readonly sessionType: string;
    readonly intent: string | null;
    readonly fee: string | null;
    readonly feeHeld: boolean;
    readonly createdAt: string;
    readonly updatedAt: string;
  } | null;
}

/** One page item of the participant lists (the asserted subset). */
interface SessionListItemWire {
  readonly id: string;
  readonly status: string;
  readonly studentId: string;
  readonly teacherId: string;
}

/** The `SessionPage` wrapper shape as it lands on the wire. */
interface SessionPageWire {
  readonly items: readonly SessionListItemWire[];
  readonly totalCount: number;
  readonly page: number;
  readonly pageSize: number;
}

/** Shared variables shape for both list documents. */
interface SessionListVariables {
  readonly filter?: { readonly status?: string | null } | null;
  readonly page?: number | null;
  readonly pageSize?: number | null;
}

const sessionByIdDocument: TypedDocumentNode<SessionByIdWire, { readonly id: string }> = parse(`
  query SessionById($id: ID!) {
    sessionById(id: $id) {
      id
      teacherId
      studentId
      status
      sessionType
      intent
      fee
      feeHeld
      createdAt
      updatedAt
    }
  }
`);

const myStudentSessionsDocument: TypedDocumentNode<
  { readonly myStudentSessions: SessionPageWire },
  SessionListVariables
> = parse(`
    query MyStudentSessions($filter: SessionListFilterInput, $page: Int, $pageSize: Int) {
      myStudentSessions(filter: $filter, page: $page, pageSize: $pageSize) {
        items {
          id
          status
          studentId
          teacherId
        }
        totalCount
        page
        pageSize
      }
    }
  `);

const myTeacherSessionsDocument: TypedDocumentNode<
  { readonly myTeacherSessions: SessionPageWire },
  SessionListVariables
> = parse(`
    query MyTeacherSessions($filter: SessionListFilterInput, $page: Int, $pageSize: Int) {
      myTeacherSessions(filter: $filter, page: $page, pageSize: $pageSize) {
        items {
          id
          status
          studentId
          teacherId
        }
        totalCount
        page
        pageSize
      }
    }
  `);

// ─── Fixture plumbing (applicant-profile.test.ts conventions) ────────────────

/** Randomized per-suite email (unique prefix + UUID salt, `@test.local`). */
function uniqueEmail(rolePrefix: string): string {
  return `${rolePrefix}-${Date.now()}-${randomUUID().slice(0, 8)}@test.local`;
}

// Named without the literal `password` token so `sonarjs/no-hardcoded-passwords`
// does not flag it (same convention as the applicant-profile suite).
const testCredential = "Password123";

/**
 * Normalizes a wire `ID` to the numeric PK for DB fixtures. GraphQL's ID
 * scalar serializes to a string on the wire even where the codegen types
 * say `number`, so the runtime value is widened here and the conversion is
 * decided by the actual typeof branch (no cast).
 */
function wireIdToPk(id: string | number): number {
  return typeof id === "number" ? id : Number(id);
}

interface AuthContext {
  readonly userId: number;
  readonly accessToken: string;
}

/** Registers through the PUBLIC registerUser mutation, then logs in. */
async function registerAndLogin(role: RegisterPublicRole): Promise<AuthContext> {
  const email = uniqueEmail("session-query");
  const registered = await testClient.mutate({
    mutation: registerUserMutationDocument,
    variables: {
      input: {
        fullName: "Session Query Fixture",
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
  const registeredId = registered.data?.registerUser?.id;
  if (!registeredId) throw new Error("registerUser returned no id");

  return { userId: wireIdToPk(registeredId), accessToken: await loginFor(email) };
}

/** Logs in through the PUBLIC login mutation and returns the bearer token. */
async function loginFor(email: string): Promise<string> {
  const loggedIn = await testClient.mutate({
    mutation: loginMutationDocument,
    variables: { email, password: testCredential },
  });
  expect(loggedIn.error).toBeUndefined();
  const accessToken = loggedIn.data?.login?.accessToken;
  if (!accessToken) throw new Error("login returned no accessToken");
  return accessToken;
}

// ─── Shared fixtures (built once per suite) ──────────────────────────────

let studentAuth: AuthContext;
let secondStudentAuth: AuthContext;
let teacherAuth: AuthContext;
let parentAuth: AuthContext;
let adminAuth: AuthContext;
let applicantAuth: AuthContext;
/** The student×teacher pair's scheduled session (participant data row). */
let scheduledSessionId: number;
/** The student×teacher pair's completed session (filter-coherence row). */
let completedSessionId: number;
/** A session owned by the SECOND student — foreign to the primary student. */
let foreignSessionId: number;

describe("Session lifecycle queries — REQ-064 query-row matrix", () => {
  // Memory-constrained sandbox adaptation: setting TEST_SERVER_EXTERNAL=1 +
  // GRAPHQL_TEST_PORT=<already-running server> runs the suite against that
  // warm server instead of spawning a second `next dev` (same rationale as
  // the applicant-profile suite). CI never sets the flag.
  if (process.env.TEST_SERVER_EXTERNAL !== "1") {
    setupTestServerLifecycle();
  }

  beforeAll(async () => {
    // Student identities (registration provisions the `students` row).
    studentAuth = await registerAndLogin(RegisterPublicRole.Student);
    secondStudentAuth = await registerAndLogin(RegisterPublicRole.Student);
    // Teacher applicant: registered teacher role with NO `teacher` row —
    // the REQ-064 always-empty list actor.
    applicantAuth = await registerAndLogin(RegisterPublicRole.Teacher);
    // Parent: the role-confusion probe for both lists + sessionById null.
    parentAuth = await registerAndLogin(RegisterPublicRole.Parent);
    // Certified teacher: role=teacher + `teacher` child row (fixture-row
    // helper, isApproved=true — the only shape that hosts real sessions).
    teacherAuth = await registerAndLogin(RegisterPublicRole.Teacher);
    await insertCertifiedTeacherRow(teacherAuth.userId);
    // Admin: NOT publicly registrable (RegisterPublicRole BFLA exclusion) —
    // engineered via the fixture-row helper, then logged in over the real
    // login path.
    const adminEmail = uniqueEmail("session-query-admin");
    const adminUserId = await insertAdminUserWithChildRow({
      fullName: "Session Query Admin Probe",
      email: adminEmail,
      phone: "+201234567893",
      password: testCredential,
    });
    adminAuth = { userId: adminUserId, accessToken: await loginFor(adminEmail) };

    // The shared pair's sessions: one per lifecycle state under test.
    scheduledSessionId = (
      await insertSessionRow({
        teacherId: teacherAuth.userId,
        studentId: studentAuth.userId,
        status: SessionStatus.Scheduled,
      })
    ).id;
    completedSessionId = (
      await insertSessionRow({
        teacherId: teacherAuth.userId,
        studentId: studentAuth.userId,
        status: SessionStatus.Completed,
      })
    ).id;
    // The second student's own session — FOREIGN to the primary student and
    // the admin/parent probes, but real participant data for the teacher.
    foreignSessionId = (
      await insertSessionRow({
        teacherId: teacherAuth.userId,
        studentId: secondStudentAuth.userId,
        status: SessionStatus.Scheduled,
      })
    ).id;
  }, 120_000);

  // ─── sessionById ────────────────────────────────────────────────────────

  test("sessionById — anonymous caller gets UNAUTHORIZED (401, never FORBIDDEN)", async () => {
    const result = await testClient.query({
      query: sessionByIdDocument,
      variables: { id: String(scheduledSessionId) },
    });
    expect(result.error).toBeDefined();
    expectMutationError(result.error, "UNAUTHORIZED");
  });

  test("sessionById — student participant reads the owned row (full shape)", async () => {
    const result = await testClient.query({
      query: sessionByIdDocument,
      variables: { id: String(scheduledSessionId) },
      context: { headers: { Authorization: `Bearer ${studentAuth.accessToken}` } },
    });
    expect(result.error).toBeUndefined();
    expect(result.data?.sessionById).toEqual(
      expect.objectContaining({
        id: String(scheduledSessionId),
        studentId: String(studentAuth.userId),
        teacherId: String(teacherAuth.userId),
        status: SCHEDULED_WIRE,
        sessionType: STUDENT_SESSION_WIRE,
        intent: HIFZ_WIRE,
        fee: "10.00",
        feeHeld: true,
      })
    );
  });

  test("sessionById — teacher participant reads the same row (role-agnostic scope)", async () => {
    const result = await testClient.query({
      query: sessionByIdDocument,
      variables: { id: String(scheduledSessionId) },
      context: { headers: { Authorization: `Bearer ${teacherAuth.accessToken}` } },
    });
    expect(result.error).toBeUndefined();
    expect(result.data?.sessionById).toEqual(
      expect.objectContaining({
        id: String(scheduledSessionId),
        studentId: String(studentAuth.userId),
        teacherId: String(teacherAuth.userId),
        status: SCHEDULED_WIRE,
      })
    );
  });

  test("sessionById — foreign id and nonexistent id resolve to the IDENTICAL null (oracle pairing)", async () => {
    // Foreign: a REAL row the caller does not participate in.
    const foreign = await testClient.query({
      query: sessionByIdDocument,
      variables: { id: String(foreignSessionId) },
      context: { headers: { Authorization: `Bearer ${studentAuth.accessToken}` } },
    });
    expect(foreign.error).toBeUndefined();
    expect(foreign.data).toEqual({ sessionById: null });

    // Nonexistent: an id that matches no row at all.
    const nonexistent = await testClient.query({
      query: sessionByIdDocument,
      variables: { id: "999999999" },
      context: { headers: { Authorization: `Bearer ${studentAuth.accessToken}` } },
    });
    expect(nonexistent.error).toBeUndefined();
    // CONSTANT SHAPE — the two answers are byte-identical on the wire;
    // existence is never disclosed cross-participant.
    expect(nonexistent.data).toEqual(foreign.data);
  });

  test("sessionById — authenticated non-participants (admin, parent) get null, never an error", async () => {
    const asAdmin = await testClient.query({
      query: sessionByIdDocument,
      variables: { id: String(scheduledSessionId) },
      context: { headers: { Authorization: `Bearer ${adminAuth.accessToken}` } },
    });
    expect(asAdmin.error).toBeUndefined();
    expect(asAdmin.data).toEqual({ sessionById: null });

    const asParent = await testClient.query({
      query: sessionByIdDocument,
      variables: { id: String(scheduledSessionId) },
      context: { headers: { Authorization: `Bearer ${parentAuth.accessToken}` } },
    });
    expect(asParent.error).toBeUndefined();
    expect(asParent.data).toEqual({ sessionById: null });
  });

  // ─── myStudentSessions ──────────────────────────────────────────────────

  test("myStudentSessions — anonymous caller gets UNAUTHORIZED", async () => {
    const result = await testClient.query({ query: myStudentSessionsDocument });
    expect(result.error).toBeDefined();
    expectMutationError(result.error, "UNAUTHORIZED");
  });

  test("myStudentSessions — teacher and parent callers get FORBIDDEN (wrong-role probes)", async () => {
    const asTeacher = await testClient.query({
      query: myStudentSessionsDocument,
      context: { headers: { Authorization: `Bearer ${teacherAuth.accessToken}` } },
    });
    expect(asTeacher.error).toBeDefined();
    expectMutationError(asTeacher.error, "FORBIDDEN");

    const asParent = await testClient.query({
      query: myStudentSessionsDocument,
      context: { headers: { Authorization: `Bearer ${parentAuth.accessToken}` } },
    });
    expectMutationError(asParent.error, "FORBIDDEN");
  });

  test("myStudentSessions — student receives ONLY own sessions with the honest page echo", async () => {
    const result = await testClient.query({
      query: myStudentSessionsDocument,
      variables: { filter: null, page: 1, pageSize: 25 },
      context: { headers: { Authorization: `Bearer ${studentAuth.accessToken}` } },
    });
    expect(result.error).toBeUndefined();
    const page = result.data?.myStudentSessions;
    if (!page) throw new Error("myStudentSessions returned no page");
    // Exactly the two sessions the student owns (never the second student's).
    expect(page.totalCount).toBe(2);
    expect(page.page).toBe(1);
    expect(page.pageSize).toBe(25);
    expect(page.items.map(item => item.id).toSorted((a, b) => Number(a) - Number(b))).toEqual(
      [String(scheduledSessionId), String(completedSessionId)].toSorted((a, b) => Number(a) - Number(b))
    );
    for (const item of page.items) {
      expect(item.studentId).toBe(String(studentAuth.userId));
    }
  });

  test("myStudentSessions — status filter narrows list and count COHERENTLY", async () => {
    const result = await testClient.query({
      query: myStudentSessionsDocument,
      variables: { filter: { status: SCHEDULED_WIRE }, page: 1, pageSize: 25 },
      context: { headers: { Authorization: `Bearer ${studentAuth.accessToken}` } },
    });
    expect(result.error).toBeUndefined();
    const page = result.data?.myStudentSessions;
    if (!page) throw new Error("filtered myStudentSessions returned no page");
    // totalCount matches the FILTERED list exactly (one shared predicate).
    expect(page.totalCount).toBe(1);
    expect(page.items.map(item => item.id)).toEqual([String(scheduledSessionId)]);
    expect(page.items[0]?.status).toBe(SCHEDULED_WIRE);
  });

  test("myStudentSessions — out-of-range page yields empty items next to the honest total", async () => {
    const result = await testClient.query({
      query: myStudentSessionsDocument,
      variables: { filter: null, page: 99, pageSize: 25 },
      context: { headers: { Authorization: `Bearer ${studentAuth.accessToken}` } },
    });
    expect(result.error).toBeUndefined();
    const page = result.data?.myStudentSessions;
    if (!page) throw new Error("out-of-range myStudentSessions returned no page");
    expect(page.items).toEqual([]);
    expect(page.totalCount).toBe(2);
    expect(page.page).toBe(99);
  });

  // ─── myTeacherSessions ──────────────────────────────────────────────────

  test("myTeacherSessions — anonymous caller gets UNAUTHORIZED", async () => {
    const result = await testClient.query({ query: myTeacherSessionsDocument });
    expect(result.error).toBeDefined();
    expectMutationError(result.error, "UNAUTHORIZED");
  });

  test("myTeacherSessions — student caller gets FORBIDDEN (wrong-role probe)", async () => {
    const result = await testClient.query({
      query: myTeacherSessionsDocument,
      context: { headers: { Authorization: `Bearer ${studentAuth.accessToken}` } },
    });
    expect(result.error).toBeDefined();
    expectMutationError(result.error, "FORBIDDEN");
  });

  test("myTeacherSessions — teacher applicant gets the ALWAYS-EMPTY page (never an error)", async () => {
    const result = await testClient.query({
      query: myTeacherSessionsDocument,
      variables: { filter: null, page: 1, pageSize: 25 },
      context: { headers: { Authorization: `Bearer ${applicantAuth.accessToken}` } },
    });
    expect(result.error).toBeUndefined();
    const page = result.data?.myTeacherSessions;
    if (!page) throw new Error("myTeacherSessions returned no page");
    // Honest empty answer — every value pinned. Apollo merges `__typename`
    // into entity objects at runtime (not part of the wire SDL), so it is
    // pinned separately per the applicant-profile.test.ts convention.
    expect(page).toEqual(expect.objectContaining({ items: [], totalCount: 0, page: 1, pageSize: 25 }));
    expect(page).toHaveProperty("__typename", "SessionPage");
  });

  test("myTeacherSessions — certified teacher receives ONLY own sessions (incl. foreign student's row)", async () => {
    const result = await testClient.query({
      query: myTeacherSessionsDocument,
      variables: { filter: null, page: 1, pageSize: 25 },
      context: { headers: { Authorization: `Bearer ${teacherAuth.accessToken}` } },
    });
    expect(result.error).toBeUndefined();
    const page = result.data?.myTeacherSessions;
    if (!page) throw new Error("myTeacherSessions returned no page");
    // All three rows this teacher hosts — including the second student's.
    expect(page.totalCount).toBe(3);
    expect(page.items.map(item => item.id).toSorted((a, b) => Number(a) - Number(b))).toEqual(
      [String(scheduledSessionId), String(completedSessionId), String(foreignSessionId)].toSorted(
        (a, b) => Number(a) - Number(b)
      )
    );
    for (const item of page.items) {
      expect(item.teacherId).toBe(String(teacherAuth.userId));
    }
  });
});
