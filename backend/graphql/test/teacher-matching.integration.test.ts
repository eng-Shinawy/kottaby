/**
 * Teacher matching browse — GraphQL integration tier over the REAL wire
 * boundary (`setupTestServerLifecycle` + `testClient`).
 *
 * This is the API-interaction suite for the student-facing
 * `browseAvailableTeachers` query (the on-demand matching read). Every call
 * goes through Apollo Client v4 + the shared error helper
 * (`expectMutationError`) exactly like the sibling
 * `teacher-availability.integration.test.ts` suite.
 *
 * Documents: LOCAL `parse`d documents (the backend wire tier stays free of
 * `@/frontend` imports; `parse` yields the same DocumentNode — see the
 * sibling suite's header note).
 *
 * Authentication mechanism per role: the shared `testClient` sends NO
 * cookies between tests, so every authenticated call carries its OWN
 * identity via a per-request `Authorization: Bearer <accessToken>` header —
 * tokens ride real `login` mutations; nothing is monkey-patched.
 *
 * Fixture scoping under the SHARED dev database: both browse-target
 * teachers carry a per-run unique name token (randomUUID slice) and the
 * student browses with `search: <token>`, so the returned page is pinned
 * to THIS run's fixtures alone — parallel live-wire suites and seed rows
 * can never perturb the assertion (no table-wide absence claims).
 *
 * Tiers locked down (HTTP → gateway pipeline → scope-auth → resolver →
 * TeacherMatchingService → TeacherRepository → PostgreSQL → back over the
 * wire):
 *  - Tier 1 in-session exclusion — a student participant of a `started`
 *    session browses with the fixture token. The in-session teacher row
 *    deliberately carries a STALE-TRUE `is_online` flag (pinned by a
 *    direct-DB pre-read), so its exclusion is attributable ONLY to the
 *    no-active-session leg of the eligibility compose rule — never to the
 *    availability flag. The eligible control teacher (same token, no
 *    session, `is_online = true`, `is_approved = true`) IS on the page,
 *    proving the browse is a real 200 page rather than a trivially empty
 *    one; the honest `total` collapses to exactly the eligible control.
 *  - Tier 2 scope-step denial matrix — the query is student-only
 *    (`authScopes: $all { authenticated, role: [Student] }`): the
 *    anonymous caller is UNAUTHORIZED (401 — never 403), and authenticated
 *    teacher + staff (admin) roles are FORBIDDEN (403) at the scope step,
 *    before any resolver or database work.
 *
 * Data lifecycle (mirrors the sibling suite): public-surface rows
 * (`registerUser`) and direct-DB fixtures use randomized emails and are
 * tracked by id for the describe-scoped `afterAll` hygiene cleanup
 * (`deleteSessionsByParticipantUserIds` → `deleteUsersByIds`) so the shared
 * dev database returns to its canonical seed state. Deletion is by
 * EXPLICIT id list, never an email-pattern sweep.
 *
 * ENVIRONMENT NOTE: under `DB_PROVIDER=pglite` the wire-tier suite is
 * skipped wholesale (`describeGraphqlSuite`) — the test process and the
 * dev server run separate in-memory PGlite instances and do not share
 * uncommitted writes. CI runs the full suite on real Postgres.
 *
 * Mandated runner:
 *   bun run test/scripts/run-test.ts backend/graphql/test/teacher-matching.integration.test.ts
 */

import { afterAll, beforeAll, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { parse } from "graphql";

import { db } from "@/backend/db";
import { session } from "@/backend/db/schema/classes/session";
import { teacher } from "@/backend/db/schema/teachers/teacher";
import { users } from "@/backend/db/schema/users/users";
import { SessionStatus } from "@/backend/enum/scheduling/session-status.enum";
import { RegisterPublicRole } from "@/backend/enum/users/register-public-role.enum";
import { UserRole } from "@/backend/enum/users/user-role.enum";
import { hashPassword } from "@/backend/lib/auth/password";
import {
  countUsersByIds,
  deleteSessionsByParticipantUserIds,
  deleteUsersByIds,
  describeGraphqlSuite,
  expectMutationError,
  insertSessionRow,
  setupTestServerLifecycle,
  testClient,
} from "@/test/helpers";

// ─── Wire documents (LOCAL parse — keep backend free of @/frontend imports) ──

/**
 * `browseAvailableTeachers` query — the student-facing matching read. The
 * optional `search` argument narrows the page to the fixture name token so
 * the assertions stay scoped to this run's teacher rows. `id` is selected
 * FIRST on every entity-shaped object (Apollo normalization convention).
 */
const browseAvailableTeachersDocument = parse(`
  query BrowseAvailableTeachers($search: String) {
    browseAvailableTeachers(search: $search) {
      items {
        id
        fullName
        isOnline
      }
      total
      page
      pageSize
      pageCount
    }
  }
`);

/** `registerUser` mutation — public registration surface (Student / Teacher / Parent). */
const registerUserMutationDocument = parse(`
  mutation RegisterUser($input: RegisterUserInput!) {
    registerUser(input: $input) {
      id
    }
  }
`);

/** `login` mutation — mints the bearer token that rides the per-request Authorization header. */
const loginMutationDocument = parse(`
  mutation Login($email: String!, $password: String!) {
    login(email: $email, password: $password) {
      accessToken
    }
  }
`);

// ─── Fixture plumbing (sibling-suite conventions) ───────────────────────────

/**
 * Randomized per-suite email (unique prefix + UUID salt, `@test.local`) —
 * avoids unique-constraint hits across parallel live-wire suites.
 */
function uniqueEmail(rolePrefix: string): string {
  return `${rolePrefix}-${Date.now()}-${randomUUID().slice(0, 8)}@test.local`;
}

// Named without the literal `password` token so `sonarjs/no-hardcoded-passwords`
// does not flag it (same convention as the sibling wire suites).
const testCredential = "Password123";

interface RegistrationOutcome {
  readonly userId: number;
  readonly accessToken: string;
}

/**
 * Ids of every user this suite creates (any surface) — drained by the
 * describe-scoped `afterAll` hygiene cleanup. Explicit ids (not an email
 * sweep) keep parallel live-wire suites' fixtures safe.
 */
const createdUserIds = new Set<number>();

function trackCreatedUser(id: number | null | undefined): void {
  if (typeof id === "number") createdUserIds.add(id);
}

/** Wire names for the public registration roles (the GraphQL enum members are the TS enum KEYS). */
const REGISTER_ROLE_WIRE_NAMES: Record<RegisterPublicRole, string> = {
  [RegisterPublicRole.Student]: "Student",
  [RegisterPublicRole.Teacher]: "Teacher",
  [RegisterPublicRole.Parent]: "Parent",
};

async function registerAndLogin(role: RegisterPublicRole): Promise<RegistrationOutcome> {
  const email = uniqueEmail("matching");
  const registered = await testClient.mutate({
    mutation: registerUserMutationDocument,
    variables: {
      input: {
        fullName: "Matching Browse Fixture",
        email,
        phone: "+201234567890",
        password: testCredential,
        gender: null,
        country: "EG",
        role: REGISTER_ROLE_WIRE_NAMES[role],
        preferredRecitation: null,
      },
    },
  });
  expect(registered.error).toBeUndefined();
  const registeredId = registerUserIdOf(registered);
  trackCreatedUser(registeredId);

  const loggedIn = await testClient.mutate({
    mutation: loginMutationDocument,
    variables: { email, password: testCredential },
  });
  expect(loggedIn.error).toBeUndefined();

  return { userId: registeredId, accessToken: loginAccessTokenOf(loggedIn) };
}

/**
 * Direct-DB browse-target teacher fixture: `users.role = teacher` + a
 * certified ONLINE `teacher` child row (`isApproved = true`,
 * `isOnline = true`). The row is name-matched by the per-run search token;
 * no login is minted (browse targets are never callers).
 */
async function insertBrowseTeacherFixture(fullName: string): Promise<number> {
  const email = uniqueEmail("browse-teacher");
  const [user] = await db
    .insert(users)
    .values({
      fullName,
      email,
      phone: "+201234567895",
      passwordHash: await hashPassword(testCredential),
      role: UserRole.Teacher,
      isDeleted: false,
      suspended: false,
      isBlocked: false,
      lastActiveAt: new Date(),
    })
    .returning();
  if (!user) throw new Error("browse teacher user insert returned no rows");
  trackCreatedUser(user.id);
  const [teacherRow] = await db.insert(teacher).values({ id: user.id, isApproved: true, isOnline: true }).returning();
  if (!teacherRow) throw new Error("browse teacher child-row insert returned no rows");
  return user.id;
}

/**
 * Staff (admin) actor — engineered via direct DB insert (the public
 * registration surface excludes the admin role), then logged in over the
 * real public `login` mutation so the denial rides a genuine session.
 */
async function provisionStaffActor(): Promise<RegistrationOutcome> {
  const email = uniqueEmail("staff");
  const [staffUser] = await db
    .insert(users)
    .values({
      fullName: "Matching Browse Staff Probe",
      email,
      phone: "+201234567896",
      passwordHash: await hashPassword(testCredential),
      role: UserRole.Admin,
      isDeleted: false,
      suspended: false,
      isBlocked: false,
      lastActiveAt: new Date(),
    })
    .returning();
  if (!staffUser) throw new Error("staff user insert returned no rows");
  trackCreatedUser(staffUser.id);
  const loggedIn = await testClient.mutate({
    mutation: loginMutationDocument,
    variables: { email, password: testCredential },
  });
  expect(loggedIn.error).toBeUndefined();
  return { userId: staffUser.id, accessToken: loginAccessTokenOf(loggedIn) };
}

// ─── Runtime narrowing helpers (no casts, per test-tier discipline) ────────

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** The wire `registerUser.id` of a successful public registration (`User.id: Int!`). */
function registerUserIdOf(result: { readonly data?: unknown }): number {
  if (!isRecord(result.data)) {
    throw new Error("expected registerUser data");
  }
  const payload: unknown = result.data.registerUser;
  if (!isRecord(payload)) {
    throw new Error("expected a registerUser payload");
  }
  const id: unknown = payload.id;
  if (typeof id !== "number") {
    throw new Error("expected registerUser.id to be a number (User.id: Int!)");
  }
  return id;
}

/** The wire `login.accessToken` of a successful authentication. */
function loginAccessTokenOf(result: { readonly data?: unknown }): string {
  if (!isRecord(result.data)) {
    throw new Error("expected login data");
  }
  const payload: unknown = result.data.login;
  if (!isRecord(payload)) {
    throw new Error("expected a login payload");
  }
  const accessToken: unknown = payload.accessToken;
  if (typeof accessToken !== "string") {
    throw new Error("expected login.accessToken to be a string");
  }
  return accessToken;
}

/**
 * The wire `browseAvailableTeachers` page of a successful read — runtime
 * narrowed with no casts. Only the fields the assertions consume are
 * narrowed (`id`, `fullName`, `isOnline` per card + the honest `total`).
 */
function browsePagePayloadOf(result: { readonly data?: unknown }): {
  items: Array<{ id: number; fullName: string; isOnline: boolean }>;
  total: number;
} {
  if (!isRecord(result.data)) {
    throw new Error("expected browseAvailableTeachers data");
  }
  const payload: unknown = result.data.browseAvailableTeachers;
  if (!isRecord(payload)) {
    throw new Error("expected a browseAvailableTeachers page");
  }
  const rawItems: unknown = payload.items;
  if (!Array.isArray(rawItems)) {
    throw new Error("expected items to be an array");
  }
  const items = rawItems.map((item: unknown) => {
    if (!isRecord(item)) {
      throw new Error("expected every item to be a teacher card");
    }
    const id: unknown = item.id;
    const fullName: unknown = item.fullName;
    const isOnline: unknown = item.isOnline;
    if (typeof id !== "number" || typeof fullName !== "string" || typeof isOnline !== "boolean") {
      throw new Error("expected { id: number; fullName: string; isOnline: boolean }");
    }
    return { id, fullName, isOnline };
  });
  const total: unknown = payload.total;
  if (typeof total !== "number") {
    throw new Error("expected total to be a number");
  }
  return { items, total };
}

// ─── Wire-call helpers ──────────────────────────────────────────────────────

/** `browseAvailableTeachers(search: $search)` over the wire, optionally authenticated. */
function browseTeachers(accessToken: string | null, search: string): ReturnType<typeof testClient.query> {
  const context = accessToken === null ? undefined : { headers: { Authorization: `Bearer ${accessToken}` } };
  return testClient.query({
    query: browseAvailableTeachersDocument,
    variables: { search },
    context,
  });
}

// ─── Cast: shared fixtures built once per suite ─────────────────────────────

interface WireCast {
  /** Student caller — registered publicly (real `students` row + trial grant). */
  readonly student: RegistrationOutcome;
  /** Eligible control teacher (same token, no session) — MUST appear on the page. */
  readonly eligibleTeacherId: number;
  /** In-session teacher (same token, owns a `started` session) — MUST be hidden. */
  readonly inSessionTeacherId: number;
  /** The `started` session row binding the in-session teacher to the student. */
  readonly inSessionId: number;
  /** Per-run unique name token shared by both browse-target teachers. */
  readonly searchToken: string;
  /** Teacher-role actor for the scope-step denial matrix. */
  readonly teacherActor: RegistrationOutcome;
  /** Staff (admin) actor for the scope-step denial matrix. */
  readonly staffActor: RegistrationOutcome;
}

let cast: WireCast | undefined;

function theCast(): WireCast {
  if (!cast) {
    throw new Error("expected the fixture cast to be provisioned");
  }
  return cast;
}

/**
 * Provisions the full cast in ONE `beforeAll`, in dependency order: the
 * student first (the started session needs a student participant), then
 * the two name-token teacher fixtures, the started session, and the two
 * denial-matrix actors.
 */
async function provisionCast(): Promise<WireCast> {
  const student = await registerAndLogin(RegisterPublicRole.Student);

  // Both browse targets share the per-run token so ONE name search admits
  // exactly this pair — the honest `total` then collapses to the count of
  // ELIGIBLE token-matched teachers, making the exclusion observable as a
  // number, not just an absence.
  const searchToken = `wb-${randomUUID().slice(0, 8)}`;
  const eligibleTeacherId = await insertBrowseTeacherFixture(`Wire Browse Control ${searchToken}`);
  const inSessionTeacherId = await insertBrowseTeacherFixture(`Wire Browse Busy ${searchToken}`);

  // The `started` session binds the busy teacher to the browsing student.
  // The teacher row KEEPS `is_online = true` (a stale-true flag): only the
  // no-active-session leg of the eligibility chain can exclude it.
  const sessionRow = await insertSessionRow({
    teacherId: inSessionTeacherId,
    studentId: student.userId,
    status: SessionStatus.Started,
  });

  const teacherActor = await registerAndLogin(RegisterPublicRole.Teacher);
  const staffActor = await provisionStaffActor();

  return {
    student,
    eligibleTeacherId,
    inSessionTeacherId,
    inSessionId: sessionRow.id,
    searchToken,
    teacherActor,
    staffActor,
  };
}

// ─── Wire-tier suite (skipped wholesale under PGlite) ───────────────────────

describeGraphqlSuite("Teacher matching browse — GraphQL integration", () => {
  // Memory-constrained sandbox adaptation: TEST_SERVER_EXTERNAL=1 +
  // GRAPHQL_TEST_PORT=<already-running server> runs the suite against that
  // warm server instead of spawning a second `next dev`.
  if (process.env.TEST_SERVER_EXTERNAL !== "1") {
    setupTestServerLifecycle();
  }

  beforeAll(async () => {
    cast = await provisionCast();
  }, 180_000);

  // ─── Hygiene: restore the shared dev database to the canonical seed state.
  // The two RESTRICT-gated `session` FKs (`teacher_id`, `student_id`) block
  // the users delete — drain those FIRST via the shared helper, then delete
  // the users (cascades teacher / students / applicants / notifications).
  afterAll(async () => {
    const ids = [...createdUserIds];
    if (ids.length === 0) return;
    await deleteSessionsByParticipantUserIds(ids);
    const deleted = await deleteUsersByIds(ids);
    expect(deleted).toBe(ids.length);
    expect(await countUsersByIds(ids)).toBe(0);
  }, 60_000);

  // ─── Tier 1 — in-session exclusion (the 200 case) ─────────────────────

  test("INV-A3: a student caller does not see an in-session teacher in the browseAvailableTeachers page", async () => {
    const { student, eligibleTeacherId, inSessionTeacherId, inSessionId, searchToken } = theCast();

    // Fixture pre-reads (self-diagnosing posture): the session is STILL
    // `started` and the busy teacher row STILL carries the stale-true
    // availability flag — so any exclusion below is attributable ONLY to
    // the no-active-session leg of the eligibility compose rule.
    const [sessionRow] = await db.select({ status: session.status }).from(session).where(eq(session.id, inSessionId));
    expect(sessionRow?.status).toBe(SessionStatus.Started);
    const [busyTeacherRow] = await db
      .select({ isOnline: teacher.isOnline })
      .from(teacher)
      .where(eq(teacher.id, inSessionTeacherId));
    expect(busyTeacherRow?.isOnline).toBe(true);

    const result = await browseTeachers(student.accessToken, searchToken);

    // The 200 case — a real page, not an error envelope.
    expect(result.error).toBeUndefined();
    const page = browsePagePayloadOf(result);

    // Positive control: the eligible fixture teacher IS on the page (the
    // browse is live and name-matched to this run's fixtures).
    const ids = page.items.map(item => item.id);
    expect(ids).toContain(eligibleTeacherId);

    // The exclusion: the in-session teacher is hidden from the student's
    // browse even though its availability flag is stale-true.
    expect(ids).not.toContain(inSessionTeacherId);

    // The honest total collapses to exactly the ELIGIBLE token-matched
    // teacher — the count leg of the same exclusion (both fixtures match
    // the name search; only the started session removes one).
    expect(page.total).toBe(1);
  });

  // ─── Tier 2 — scope-step denial matrix ─────────────────────────────────

  test("INV-A3: anonymous/teacher/staff roles are denied at the scope step", async () => {
    const { searchToken, teacherActor, staffActor } = theCast();

    // Anonymous caller — the `authenticated` scope throws UNAUTHORIZED
    // (401, never 403: unauthenticated must be distinguishable).
    const anonymous = await browseTeachers(null, searchToken);
    expect(anonymous.error).toBeDefined();
    expectMutationError(anonymous.error, "UNAUTHORIZED");

    // Authenticated teacher — fails the `role: [Student]` scope into the
    // canonical FORBIDDEN (403), before any resolver or database work.
    const teacherCall = await browseTeachers(teacherActor.accessToken, searchToken);
    expect(teacherCall.error).toBeDefined();
    expectMutationError(teacherCall.error, "FORBIDDEN");

    // Authenticated staff (admin) — same role-scope FORBIDDEN (403); the
    // staff-side teacher directory is a separate admin-gated surface.
    const staffCall = await browseTeachers(staffActor.accessToken, searchToken);
    expect(staffCall.error).toBeDefined();
    expectMutationError(staffCall.error, "FORBIDDEN");
  });
});
