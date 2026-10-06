/**
 * Teacher availability toggle — GraphQL integration matrix over the REAL
 * wire boundary (`setupTestServerLifecycle` + `testClient`).
 *
 * This is the API-interaction suite for the two teacher-availability root
 * fields (`myTeacherAvailability` query + `setTeacherAvailability`
 * mutation). Every row goes through Apollo Client v4 + the shared error
 * helpers (`expectMutationError` / `extractErrorCode`) exactly like the
 * sibling `frontend/graphql/test/teachers/applicant-profile.test.ts` suite.
 *
 * Documents: LOCAL `parse`d documents. The shared teacher-availability
 * documents do not exist yet (their dedicated `sharedDocuments` file is
 * authored later), and the `@/backend/db` fixture chain flips bun's
 * module conditions so `graphql-tag`'s UMD build crashes — `parse`
 * yields the same DocumentNode (see the applicant-profile.test.ts
 * header note).
 *
 * Authentication mechanism per role (multi-role isolation): the shared
 * `testClient` sends NO cookies between tests, so every test carries its
 * OWN identity via a per-request `Authorization: Bearer <accessToken>`
 * header (context.headers) — the production client path read by
 * `gqlContextFactory.extractAccessToken`. Tokens ride real `login`
 * mutations; nothing is monkey-patched.
 *
 * Data lifecycle (mirrors applicant-profile.test.ts): public-surface rows
 * (`registerUser`) and direct-DB fixtures use randomized emails and are
 * tracked by id for the describe-scoped `afterAll` hygiene cleanup
 * (`deleteSessionsByParticipantUserIds` → `deleteUsersByIds`) so the shared
 * dev database returns to its canonical seed state. Deletion is by
 * EXPLICIT id list, never an email-pattern sweep, so parallel live-wire
 * suites keep their own fixtures intact.
 *
 * Tiers locked down (HTTP → gateway pipeline → scope-auth → resolver →
 * TeacherAvailabilityService → PostgreSQL → back over the wire):
 *  - Tier 1 happy pair — certified teacher reads own availability projection
 *    (`{ id, isOnline, isApproved }` matching the fixture row); toggles
 *    `setTeacherAvailability(isOnline: false)` (already offline — idempotent
 *    same-value write) and `setTeacherAvailability(isOnline: true)` (the
 *    Available happy path); the second write is re-read via a follow-up
 *    `myTeacherAvailability` query to prove persistence on the wire.
 *  - Tier 2 boundary booleans — round-trip toggle (true → false → true)
 *    with each leg's wire projection pinned; same-value idempotency
 *    (`false` → `false`) returns the row byte-stable.
 *  - Tier 3 denial matrix — the full BFLA + BOLA + INV-A1 + INV-A2 +
 *    TEACHER_NOT_FOUND wire tier:
 *      · Anonymous caller on BOTH ops → UNAUTHORIZED (401, never 403).
 *      · Authenticated STUDENT on BOTH ops → FORBIDDEN (403, role scope).
 *      · Authenticated ADMIN on BOTH ops → FORBIDDEN (403, role scope).
 *      · Uncertified teacher (teacher row present, `isApproved = false`)
 *        on `setTeacherAvailability(isOnline: true)` → FORBIDDEN (the
 *        service-side certification gate — INV-A1 — re-verified past the
 *        role scope); the same teacher on `setTeacherAvailability(isOnline:
 *        false)` succeeds (Unavailable skips BOTH gates).
 *      · Certified teacher with a `started` session on
 *        `setTeacherAvailability(isOnline: true)` →
 *        TEACHER_IN_ACTIVE_SESSION (409, INV-A2); the response carries NO
 *        session id, status, or counterparty (oracle safety).
 *      · Authenticated teacher-role user with NO `teacher` row on BOTH
 *        ops → TEACHER_NOT_FOUND (404 — the row-absent path; a teacher
 *        probing their own state never sees another teacher's row).
 *  - Tier 4 BOPLA wire probes — smuggled identity arguments
 *    (`teacherId` on the mutation, `userId` on the query) die as
 *    GRAPHQL_VALIDATION_FAILED before any resolver runs (the schema
 *    admits NO identity surface — there is no way to target a different
 *    teacher id).
 *
 * Pure-unit BOPLA schema pins (NO server, NO DB — always run, even under
 * PGlite): the mutation's argument list is EXACTLY `["isOnline"]` and the
 * query's argument list is EMPTY — pinned off the in-process
 * `graphQLSchema` (the same source of truth the schema-surface suite
 * uses). The wire probes above exercise the runtime enforcement of this
 * pin through the live gateway; the schema pins here exercise the
 * build-time enforcement of the same invariant.
 *
 * ENVIRONMENT NOTE (sandbox): the canonical lifecycle helper boots its own
 * dev server on TEST_PORT (3066) when nothing answers there. Under
 * `DB_PROVIDER=pglite`, the wire-tier suite is skipped wholesale
 * (`describeGraphqlSuite` — the test process and the dev server run
 * separate in-memory PGlite instances and do not share uncommitted writes;
 * the 4 GB sandbox RAM budget cannot keep both processes alive at once).
 * The pure-unit BOPLA schema pins stay green under PGlite (they touch
 * neither the server nor the DB). CI runs the full suite on real Postgres.
 *
 * Mandated runner:
 *   bun run test/scripts/run-test.ts backend/graphql/test/teacher-availability.integration.test.ts
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { parse } from "graphql";

import { db } from "@/backend/db";
import { teacher } from "@/backend/db/schema/teachers/teacher";
import { users } from "@/backend/db/schema/users/users";
import { SessionStatus } from "@/backend/enum/scheduling/session-status.enum";
import { RegisterPublicRole } from "@/backend/enum/users/register-public-role.enum";
import { UserRole } from "@/backend/enum/users/user-role.enum";
import { graphQLSchema } from "@/backend/graphql/gqlSchema";
import { hashPassword } from "@/backend/lib/auth/password";
import {
  countUsersByIds,
  deleteSessionsByParticipantUserIds,
  deleteUsersByIds,
  describeGraphqlSuite,
  expectMutationError,
  insertCertifiedTeacherRow,
  insertSessionRow,
  setupTestServerLifecycle,
  testClient,
} from "@/test/helpers";

// ─── Wire documents (LOCAL parse — shared docs do not exist yet) ──────

/** Selection shape for the read query — `id` FIRST (Apollo normalization). */
const myTeacherAvailabilityDocument = parse(`
  query MyTeacherAvailability {
    myTeacherAvailability {
      id
      isOnline
      isApproved
    }
  }
`);

/** Selection shape for the toggle mutation — `id` FIRST. */
const setTeacherAvailabilityDocument = parse(`
  mutation SetTeacherAvailability($isOnline: Boolean!) {
    setTeacherAvailability(isOnline: $isOnline) {
      id
      isOnline
      isApproved
    }
  }
`);

// ─── Auth documents (LOCAL parse — keep backend free of @/frontend imports) ─

/**
 * `registerUser` mutation — public registration surface (Student / Teacher
 * applicant / Parent). `id` returned FIRST so Apollo Client normalizes the
 * new User cache entry; the caller tracks the id for the describe-scoped
 * `afterAll` hygiene cleanup (`deleteUsersByIds`). Mirrors the inline
 * `parse(\`...\`)` idiom of the teacher-availability documents above
 * (the sibling `admin-broadcast.integration.test.ts` does the same for
 * its `LOGIN_DOCUMENT`).
 */
const registerUserMutationDocument = parse(`
  mutation RegisterUser($input: RegisterUserInput!) {
    registerUser(input: $input) {
      id
    }
  }
`);

/**
 * `login` mutation — authenticates with email + password and returns the
 * `accessToken` that rides the per-request `Authorization: Bearer ...`
 * header (the shared `testClient` sends NO cookies between tests). The
 * minimal selection keeps the wire payload focused on what the suite
 * actually reads (`loggedIn.data?.login?.accessToken`).
 */
const loginMutationDocument = parse(`
  mutation Login($email: String!, $password: String!) {
    login(email: $email, password: $password) {
      accessToken
    }
  }
`);

// ─── Fixture plumbing (applicant-profile.test.ts conventions) ───────────────

/**
 * Randomized per-suite email (unique prefix + UUID salt, `@test.local`) —
 * follows the entity-setup guidance ("randomUUID avoids unique-constraint
 * hits") while keeping the auth.test.ts `@test.local` domain marker.
 */
function uniqueEmail(rolePrefix: string): string {
  return `${rolePrefix}-${Date.now()}-${randomUUID().slice(0, 8)}@test.local`;
}

// Named without the literal `password` token so `sonarjs/no-hardcoded-passwords`
// does not flag it (same convention as auth.test.ts / applicant-profile.test.ts).
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
 * Normalizes a wire `ID` to the numeric PK for DB fixtures. GraphQL's ID
 * scalar serializes to a string on the wire even where the codegen types
 * say `number`, so the runtime value is widened here and the conversion is
 * decided by the actual typeof branch (no cast).
 */
function wireIdToPk(id: string | number): number {
  return typeof id === "number" ? id : Number(id);
}

/**
 * Registers a user through the PUBLIC `registerUser` mutation, then logs in
 * through the PUBLIC `login` mutation to obtain a bearer token. Returns
 * both so the caller can derive direct-DB fixtures keyed by the user id.
 */
/**
 * Wire names for the public registration roles. The GraphQL enum's members
 * are the TS enum KEYS (Student | Teacher | Parent), not the TS string
 * values (student | teacher | parent) — and the runtime cannot reverse-map
 * (bun's enum lowering drops the reverse index), so the mapping is spelled
 * out explicitly.
 */
const REGISTER_ROLE_WIRE_NAMES: Record<RegisterPublicRole, string> = {
  [RegisterPublicRole.Student]: "Student",
  [RegisterPublicRole.Teacher]: "Teacher",
  [RegisterPublicRole.Parent]: "Parent",
};

async function registerAndLogin(role: RegisterPublicRole): Promise<RegistrationOutcome> {
  const email = uniqueEmail("availability");
  const registered = await testClient.mutate({
    mutation: registerUserMutationDocument,
    variables: {
      input: {
        fullName: "Availability Fixture",
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
  const accessToken = loginAccessTokenOf(loggedIn);

  return { userId: wireIdToPk(registeredId), accessToken };
}

/**
 * Provisions a certified teacher (users.role=teacher + `teacher` child row
 * with `isApproved=true`) with a REAL bcrypt hash so the public `login`
 * mutation mints a genuine session. Mirrors the applicant-profile.test.ts
 * Tier-2 fixture pattern (the only divergence: we want the teacher row to
 * exist for the availability toggle, NOT to be absent).
 */
async function provisionCertifiedTeacher(): Promise<RegistrationOutcome> {
  const email = uniqueEmail("certified");
  const [user] = await db
    .insert(users)
    .values({
      fullName: "Certified Teacher",
      email,
      phone: "+201234567891",
      passwordHash: await hashPassword(testCredential),
      role: UserRole.Teacher,
      isDeleted: false,
      suspended: false,
      isBlocked: false,
      lastActiveAt: new Date(),
    })
    .returning();
  if (!user) throw new Error("certified-teacher user insert returned no rows");
  trackCreatedUser(user.id);
  await insertCertifiedTeacherRow(user.id);

  const loggedIn = await testClient.mutate({
    mutation: loginMutationDocument,
    variables: { email, password: testCredential },
  });
  expect(loggedIn.error).toBeUndefined();
  const accessToken = loginAccessTokenOf(loggedIn);

  return { userId: user.id, accessToken };
}

/**
 * Provisions an UNCERTIFIED teacher (users.role=teacher + `teacher` child
 * row with `isApproved=false`). The certification gate fires on the
 * Available direction; the Unavailable direction is always allowed.
 */
async function provisionUncertifiedTeacher(): Promise<RegistrationOutcome> {
  const email = uniqueEmail("uncertified");
  const [user] = await db
    .insert(users)
    .values({
      fullName: "Uncertified Teacher",
      email,
      phone: "+201234567892",
      passwordHash: await hashPassword(testCredential),
      role: UserRole.Teacher,
      isDeleted: false,
      suspended: false,
      isBlocked: false,
      lastActiveAt: new Date(),
    })
    .returning();
  if (!user) throw new Error("uncertified-teacher user insert returned no rows");
  trackCreatedUser(user.id);
  // Direct insert — the teacher row exists but isApproved=false. Mirrors
  // the journey suite's `createTestTeacherRow(tx, id, { isApproved: false })`.
  const [teacherRow] = await db.insert(teacher).values({ id: user.id, isApproved: false }).returning();
  if (!teacherRow) throw new Error("uncertified teacher child-row insert returned no rows");

  const loggedIn = await testClient.mutate({
    mutation: loginMutationDocument,
    variables: { email, password: testCredential },
  });
  expect(loggedIn.error).toBeUndefined();
  const accessToken = loginAccessTokenOf(loggedIn);

  return { userId: user.id, accessToken };
}

/**
 * Provisions a certified teacher who is currently inside a `started`
 * session — the INV-A2 gate target. The Started session row is inserted
 * directly (full column control over lifecycle state); the gate sees the
 * row and refuses the Available toggle.
 */
async function provisionCertifiedTeacherInSession(
  studentUserId: number
): Promise<{ teacherActor: RegistrationOutcome; sessionId: number }> {
  const teacherActor = await provisionCertifiedTeacher();
  const sessionRow = await insertSessionRow({
    teacherId: teacherActor.userId,
    studentId: studentUserId,
    status: SessionStatus.Started,
  });
  return { teacherActor, sessionId: sessionRow.id };
}

// ─── Runtime narrowing helpers (no casts, per test-tier discipline) ────────

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * The wire `myTeacherAvailability` payload of a successful read — runtime
 * narrowed with no casts.
 */
function availabilityPayloadOf(result: { readonly data?: unknown }): {
  id: number;
  isOnline: boolean;
  isApproved: boolean;
} {
  if (!isRecord(result.data)) {
    throw new Error("expected myTeacherAvailability data");
  }
  const payload: unknown = result.data.myTeacherAvailability;
  if (!isRecord(payload)) {
    throw new Error("expected a myTeacherAvailability payload");
  }
  const id: unknown = payload.id;
  const isOnline: unknown = payload.isOnline;
  const isApproved: unknown = payload.isApproved;
  if (typeof id !== "number" || typeof isOnline !== "boolean" || typeof isApproved !== "boolean") {
    throw new Error("expected { id: number; isOnline: boolean; isApproved: boolean }");
  }
  return { id, isOnline, isApproved };
}

/**
 * The wire `setTeacherAvailability` payload of a successful mutation —
 * runtime narrowed with no casts.
 */
function setAvailabilityPayloadOf(result: { readonly data?: unknown }): {
  id: number;
  isOnline: boolean;
  isApproved: boolean;
} {
  if (!isRecord(result.data)) {
    throw new Error("expected setTeacherAvailability data");
  }
  const payload: unknown = result.data.setTeacherAvailability;
  if (!isRecord(payload)) {
    throw new Error("expected a setTeacherAvailability payload");
  }
  const id: unknown = payload.id;
  const isOnline: unknown = payload.isOnline;
  const isApproved: unknown = payload.isApproved;
  if (typeof id !== "number" || typeof isOnline !== "boolean" || typeof isApproved !== "boolean") {
    throw new Error("expected { id: number; isOnline: boolean; isApproved: boolean }");
  }
  return { id, isOnline, isApproved };
}

/**
 * The wire `registerUser.id` of a successful public registration — runtime
 * narrowed with no casts. `User.id` is `Int!` on the wire, so the runtime
 * value is a JSON number (the codegen `RegisterUserMutation.registerUser.id`
 * also types it `number`). The id feeds `trackCreatedUser` (numeric set) and
 * `wireIdToPk` (idempotent on number input).
 *
 * Replaces the prior typed-document access (`registered.data?.registerUser?.id`
 * when the document was a `TypedDocumentNode<RegisterUserMutation, ...>` from
 * `@/frontend/...`). Now that the document is a LOCAL `parse()` `DocumentNode`
 * (no cross-layer import), the payload is narrowed at runtime — mirroring
 * `availabilityPayloadOf` / `setAvailabilityPayloadOf` above.
 */
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

/**
 * The wire `login.accessToken` of a successful authentication — runtime
 * narrowed with no casts. The token rides the per-request
 * `Authorization: Bearer <accessToken>` header (the shared `testClient`
 * sends NO cookies between tests).
 *
 * Replaces the prior typed-document access (`loggedIn.data?.login?.accessToken`
 * when the document was a `TypedDocumentNode<LoginMutation, ...>` from
 * `@/frontend/...`). Now that the document is a LOCAL `parse()` `DocumentNode`
 * (no cross-layer import), the payload is narrowed at runtime — mirroring
 * `availabilityPayloadOf` / `setAvailabilityPayloadOf` above.
 */
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

// ─── Wire-call helpers (single-call helpers — kept under 70 lines) ────────

/** Authenticated `myTeacherAvailability` read over the wire. */
function readAvailability(accessToken: string): ReturnType<typeof testClient.query> {
  return testClient.query({
    query: myTeacherAvailabilityDocument,
    context: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
}

/** Authenticated `setTeacherAvailability(isOnline: $isOnline)` mutation over the wire. */
function toggleAvailability(accessToken: string, isOnline: boolean): ReturnType<typeof testClient.query> {
  return testClient.mutate({
    mutation: setTeacherAvailabilityDocument,
    variables: { isOnline },
    context: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
}

/** Anonymous `myTeacherAvailability` read (no credentials). */
function readAvailabilityAnonymous(): ReturnType<typeof testClient.query> {
  return testClient.query({ query: myTeacherAvailabilityDocument });
}

/** Anonymous `setTeacherAvailability` mutation (no credentials). */
function toggleAvailabilityAnonymous(isOnline: boolean): ReturnType<typeof testClient.query> {
  return testClient.mutate({
    mutation: setTeacherAvailabilityDocument,
    variables: { isOnline },
  });
}

// ─── Cast: shared fixtures built once per suite ─────────────────────────────

interface WireCast {
  /** Certified teacher with NO active session — the happy-path actor. */
  readonly certifiedTeacher: RegistrationOutcome;
  /** Second certified teacher with a `started` session — INV-A2 target. */
  readonly certifiedTeacherInSession: { teacherActor: RegistrationOutcome; sessionId: number };
  /** Uncertified teacher (teacher row present, `isApproved=false`). */
  readonly uncertifiedTeacher: RegistrationOutcome;
  /** Teacher-role user with NO `teacher` row — TEACHER_NOT_FOUND probe. */
  readonly teacherWithoutRow: RegistrationOutcome;
  /** Student participant for the Started session + the BFLA matrix. */
  readonly student: RegistrationOutcome;
  /** Admin (engineered via direct DB — RegisterPublicRole BFLA exclusion). */
  readonly admin: RegistrationOutcome;
}

let cast: WireCast | undefined;

function theCast(): WireCast {
  if (!cast) {
    throw new Error("expected the fixture cast to be provisioned");
  }
  return cast;
}

/**
 * Provisions the full matrix cast in ONE `beforeAll`. The certified teacher
 * in a Started session depends on the student actor (its session needs a
 * student participant) — provisioned in dependency order.
 */
async function provisionCast(): Promise<WireCast> {
  // The admin is NOT publicly registrable (RegisterPublicRole BFLA
  // exclusion) — engineered via direct DB insert + real hash, then logged
  // in over the public login mutation (real session, real token).
  const adminEmail = uniqueEmail("admin");
  const [adminUser] = await db
    .insert(users)
    .values({
      fullName: "Availability Admin Probe",
      email: adminEmail,
      phone: "+201234567893",
      passwordHash: await hashPassword(testCredential),
      role: UserRole.Admin,
      isDeleted: false,
      suspended: false,
      isBlocked: false,
      lastActiveAt: new Date(),
    })
    .returning();
  if (!adminUser) throw new Error("admin user insert returned no rows");
  trackCreatedUser(adminUser.id);
  const adminLogin = await testClient.mutate({
    mutation: loginMutationDocument,
    variables: { email: adminEmail, password: testCredential },
  });
  expect(adminLogin.error).toBeUndefined();
  const adminAccessToken = loginAccessTokenOf(adminLogin);
  const admin: RegistrationOutcome = { userId: adminUser.id, accessToken: adminAccessToken };

  const [student, certifiedTeacher, uncertifiedTeacher, teacherWithoutRow] = await Promise.all([
    registerAndLogin(RegisterPublicRole.Student),
    provisionCertifiedTeacher(),
    provisionUncertifiedTeacher(),
    registerAndLogin(RegisterPublicRole.Teacher),
  ]);

  // The Started-session fixture depends on the student — provisioned after
  // the student is available.
  const certifiedTeacherInSession = await provisionCertifiedTeacherInSession(student.userId);

  return {
    certifiedTeacher,
    certifiedTeacherInSession,
    uncertifiedTeacher,
    teacherWithoutRow,
    student,
    admin,
  };
}

// ─── Wire-tier suite (skipped wholesale under PGlite) ──────────────────────

describeGraphqlSuite("Teacher availability toggle — GraphQL integration matrix", () => {
  // Memory-constrained sandbox adaptation: setting TEST_SERVER_EXTERNAL=1 +
  // GRAPHQL_TEST_PORT=<already-running server> runs the suite against that
  // warm server instead of spawning a second `next dev`. CI never sets the
  // flag and keeps the standard boot-on-3066 lifecycle.
  if (process.env.TEST_SERVER_EXTERNAL !== "1") {
    setupTestServerLifecycle();
  }

  beforeAll(async () => {
    cast = await provisionCast();
  }, 180_000);

  // ─── Hygiene: restore the shared dev database to the canonical seed state.
  // The two RESTRICT-gated `session` FKs (`teacher_id`, `student_id`)
  // block the users delete — drain those FIRST via the shared helper, then
  // delete the users (cascades teacher / students / parents / admin /
  // applicants / notifications / audit-actor rows).
  afterAll(async () => {
    const ids = [...createdUserIds];
    if (ids.length === 0) return;
    await deleteSessionsByParticipantUserIds(ids);
    const deleted = await deleteUsersByIds(ids);
    expect(deleted).toBe(ids.length);
    expect(await countUsersByIds(ids)).toBe(0);
  }, 60_000);

  // ─── Tier 1 — happy pair ───────────────────────────────────────────────

  test("certified teacher reads own availability projection", async () => {
    const { userId, accessToken } = theCast().certifiedTeacher;
    const result = await readAvailability(accessToken);

    expect(result.error).toBeUndefined();
    const payload = availabilityPayloadOf(result);
    // The fixture row is created via `insertCertifiedTeacherRow` (default
    // `isOnline=false`, `isApproved=true`); the wire projection reflects
    // EXACTLY that row — id is the caller's own users.id, the boolean
    // flags are the canonical fixture values.
    expect(payload).toEqual({ id: userId, isOnline: false, isApproved: true });
  });

  test("certified teacher toggles Unavailable (idempotent same-value write) → isOnline:false on the wire", async () => {
    const { userId, accessToken } = theCast().certifiedTeacher;
    const result = await toggleAvailability(accessToken, false);

    expect(result.error).toBeUndefined();
    const payload = setAvailabilityPayloadOf(result);
    expect(payload).toEqual({ id: userId, isOnline: false, isApproved: true });
  });

  test("certified teacher toggles Available → isOnline:true persisted (re-read via a second query)", async () => {
    const { userId, accessToken } = theCast().certifiedTeacher;
    const mutation = await toggleAvailability(accessToken, true);

    expect(mutation.error).toBeUndefined();
    const mutationPayload = setAvailabilityPayloadOf(mutation);
    expect(mutationPayload).toEqual({ id: userId, isOnline: true, isApproved: true });

    // Re-read via a second query — the persisted state survives a fresh
    // wire round-trip (read-your-writes oracle on the wire boundary).
    const reread = await readAvailability(accessToken);
    expect(reread.error).toBeUndefined();
    expect(availabilityPayloadOf(reread)).toEqual({ id: userId, isOnline: true, isApproved: true });
  });

  // ─── Tier 2 — boundary booleans ─────────────────────────────────────────

  test("round-trip toggle true → false → true returns the row at every leg", async () => {
    const { userId, accessToken } = theCast().certifiedTeacher;

    const toFalse = await toggleAvailability(accessToken, false);
    expect(toFalse.error).toBeUndefined();
    expect(setAvailabilityPayloadOf(toFalse)).toEqual({ id: userId, isOnline: false, isApproved: true });

    const backToTrue = await toggleAvailability(accessToken, true);
    expect(backToTrue.error).toBeUndefined();
    expect(setAvailabilityPayloadOf(backToTrue)).toEqual({ id: userId, isOnline: true, isApproved: true });

    // The final persisted state is the last write — pinned by a fresh read.
    const reread = await readAvailability(accessToken);
    expect(reread.error).toBeUndefined();
    expect(availabilityPayloadOf(reread)).toEqual({ id: userId, isOnline: true, isApproved: true });
  });

  // ─── Tier 3 — denial matrix (BFLA + BOLA + INV-A1 + INV-A2 + NOT_FOUND) ──

  test("anonymous caller on `myTeacherAvailability` → UNAUTHORIZED (401, never FORBIDDEN)", async () => {
    const result = await readAvailabilityAnonymous();
    expect(result.error).toBeDefined();
    expectMutationError(result.error, "UNAUTHORIZED");
  });

  test("anonymous caller on `setTeacherAvailability` → UNAUTHORIZED (401, never FORBIDDEN)", async () => {
    const result = await toggleAvailabilityAnonymous(true);
    expect(result.error).toBeDefined();
    expectMutationError(result.error, "UNAUTHORIZED");
  });

  test("STUDENT caller on `myTeacherAvailability` → FORBIDDEN (BFLA — role scope)", async () => {
    const result = await readAvailability(theCast().student.accessToken);
    expect(result.error).toBeDefined();
    expectMutationError(result.error, "FORBIDDEN");
  });

  test("STUDENT caller on `setTeacherAvailability` → FORBIDDEN (BFLA — role scope)", async () => {
    const result = await toggleAvailability(theCast().student.accessToken, true);
    expect(result.error).toBeDefined();
    expectMutationError(result.error, "FORBIDDEN");
  });

  test("ADMIN caller on `myTeacherAvailability` → FORBIDDEN (BFLA — staff roles excluded)", async () => {
    const result = await readAvailability(theCast().admin.accessToken);
    expect(result.error).toBeDefined();
    expectMutationError(result.error, "FORBIDDEN");
  });

  test("ADMIN caller on `setTeacherAvailability` → FORBIDDEN (BFLA — staff roles excluded)", async () => {
    const result = await toggleAvailability(theCast().admin.accessToken, true);
    expect(result.error).toBeDefined();
    expectMutationError(result.error, "FORBIDDEN");
  });

  test("uncertified teacher → `setTeacherAvailability(isOnline: true)` returns FORBIDDEN (INV-A1, service-side gate)", async () => {
    // The role scope passes (the caller IS a teacher); the service-side
    // certification gate fires next (INV-A1). This is the
    // ticket-accurate 403 "Not certified" outcome — distinct from the
    // booking/rubric `TEACHER_NOT_CERTIFIED` validation toast.
    const result = await toggleAvailability(theCast().uncertifiedTeacher.accessToken, true);
    expect(result.error).toBeDefined();
    expectMutationError(result.error, "FORBIDDEN");
  });

  test("uncertified teacher → `setTeacherAvailability(isOnline: false)` succeeds (Unavailable skips BOTH gates)", async () => {
    // The Unavailable direction (`isOnline === false`) skips the
    // certification gate AND the in-session gate — an uncertified teacher
    // may still go offline (the offline state is the safe default).
    const { userId, accessToken } = theCast().uncertifiedTeacher;
    const result = await toggleAvailability(accessToken, false);
    expect(result.error).toBeUndefined();
    expect(setAvailabilityPayloadOf(result)).toEqual({ id: userId, isOnline: false, isApproved: false });
  });

  test("uncertified teacher → `myTeacherAvailability` returns the projection (read is allowed for any teacher row)", async () => {
    // The READ path runs NO certification gate — a teacher row present
    // with `isApproved=false` is honestly projected back to the caller
    // (the client-side "Available" CTA pre-empts from `isApproved === false`).
    const { userId, accessToken } = theCast().uncertifiedTeacher;
    const result = await readAvailability(accessToken);
    expect(result.error).toBeUndefined();
    expect(availabilityPayloadOf(result)).toEqual({ id: userId, isOnline: false, isApproved: false });
  });

  test("certified teacher with a `started` session → `setTeacherAvailability(isOnline: true)` returns TEACHER_IN_ACTIVE_SESSION (INV-A2)", async () => {
    const { teacherActor, sessionId } = theCast().certifiedTeacherInSession;
    const result = await toggleAvailability(teacherActor.accessToken, true);
    expect(result.error).toBeDefined();
    expectMutationError(result.error, "TEACHER_IN_ACTIVE_SESSION");

    // Oracle safety — the response carries NO session id, status,
    // counterparty, or count. The denial body, when stringified, MUST NOT
    // contain the session id (the canonical localized message is reused
    // verbatim — there is no per-class disclosure of the active session).
    // Oracle safety — check the denial MESSAGE (not the full payload which
    // includes a requestId UUID that may coincidentally contain the session
    // id as a substring). The canonical localized message reuses the shared
    // error key and carries NO session identifier.
    const denialMessage = result.error?.message ?? "";
    expect(denialMessage).not.toContain(String(sessionId));
    // The mutation field on the data channel is null (the non-nullable
    // mutation nulls the WHOLE data object on a resolver throw).
    expect(result.data).toBeNull();
  });

  test("teacher-role user with NO `teacher` row → `myTeacherAvailability` returns TEACHER_NOT_FOUND", async () => {
    // The role scope passes (the caller IS a teacher); the service
    // looks up `TeacherRepository.findById(userId)` → null (no teacher
    // row), throws NotFoundError("TEACHER", …) → 404.
    const result = await readAvailability(theCast().teacherWithoutRow.accessToken);
    expect(result.error).toBeDefined();
    expectMutationError(result.error, "TEACHER_NOT_FOUND");
  });

  test("teacher-role user with NO `teacher` row → `setTeacherAvailability(isOnline: false)` returns TEACHER_NOT_FOUND", async () => {
    // The Unavailable direction skips BOTH gates but NOT the row-presence
    // check — the service still looks up the teacher row before writing.
    // A missing row denies with the same TEACHER_NOT_FOUND shape on BOTH
    // the read and the write paths.
    const result = await toggleAvailability(theCast().teacherWithoutRow.accessToken, false);
    expect(result.error).toBeDefined();
    expectMutationError(result.error, "TEACHER_NOT_FOUND");
  });

  // ─── Tier 4 — BOPLA wire probes (smuggled identity args) ────────────────

  test("smuggled `teacherId` arg on `setTeacherAvailability` → GRAPHQL_VALIDATION_FAILED (BOLA no-surface proof)", async () => {
    const { accessToken } = theCast().certifiedTeacher;
    const result = await testClient.mutate({
      fetchPolicy: "no-cache",
      mutation: parse(`
        mutation SmuggleTeacherIdOnMutation($isOnline: Boolean!, $teacherId: Int!) {
          setTeacherAvailability(isOnline: $isOnline, teacherId: $teacherId) {
            id
            isOnline
            isApproved
          }
        }
      `),
      variables: { isOnline: true, teacherId: 999_999 },
      context: { headers: { Authorization: `Bearer ${accessToken}` } },
    });
    // Unknown argument on Mutation.setTeacherAvailability → the request
    // never executes; the resolver NEVER runs.
    expect(result.error).toBeDefined();
    expectMutationError(result.error, "GRAPHQL_VALIDATION_FAILED");
  });

  test("smuggled `userId` arg on `myTeacherAvailability` → GRAPHQL_VALIDATION_FAILED (BOLA no-surface proof)", async () => {
    const { accessToken } = theCast().certifiedTeacher;
    const result = await testClient.query({
      fetchPolicy: "no-cache",
      query: parse(`
        query SmuggleUserIdOnQuery($userId: Int!) {
          myTeacherAvailability(userId: $userId) {
            id
            isOnline
            isApproved
          }
        }
      `),
      variables: { userId: 999_999 },
      context: { headers: { Authorization: `Bearer ${accessToken}` } },
    });
    expect(result.error).toBeDefined();
    expectMutationError(result.error, "GRAPHQL_VALIDATION_FAILED");
  });
});

// ─── Pure-unit BOPLA schema pins (always run — NO server, NO DB) ────────────

describe("Teacher availability BOPLA schema pins — argument surface", () => {
  test("`setTeacherAvailability` carries EXACTLY one argument: `isOnline: Boolean!`", () => {
    const mutationType = graphQLSchema.getMutationType();
    if (!mutationType) throw new Error("Schema must define a root Mutation type");
    const field = mutationType.getFields().setTeacherAvailability;
    if (!field) throw new Error("Mutation must register the `setTeacherAvailability` root field");

    // The mutation admits EXACTLY ONE argument — `isOnline`. There is NO
    // `teacherId`, NO `userId`, NO `input` wrapper, NO optional fields.
    // The acting teacher id is derived EXCLUSIVELY from the verified
    // access token (BOLA — self-only by construction).
    expect(field.args.map(arg => arg.name).toSorted((a, b) => a.localeCompare(b))).toEqual(["isOnline"]);
    const isOnlineArg = field.args.find(arg => arg.name === "isOnline");
    if (!isOnlineArg) throw new Error("expected the isOnline argument");
    expect(isOnlineArg.type.toString()).toBe("Boolean!");
  });

  test("`myTeacherAvailability` carries ZERO arguments (identity server-derived)", () => {
    const queryType = graphQLSchema.getQueryType();
    if (!queryType) throw new Error("Schema must define a root Query type");
    const field = queryType.getFields().myTeacherAvailability;
    if (!field) throw new Error("Query must register the `myTeacherAvailability` root field");

    // The query admits ZERO arguments — the acting teacher id is derived
    // EXCLUSIVELY from `ctx.user.id` (BOLA — there is NO mechanism by
    // which a client can target a different teacher id through this
    // field).
    expect(field.args).toEqual([]);
  });

  test("`TeacherAvailabilityState` exposes EXACTLY `id`, `isOnline`, `isApproved` (BOPLA shape pin)", () => {
    const type = graphQLSchema.getType("TeacherAvailabilityState");
    if (type === undefined || typeof type !== "object" || !("getFields" in type)) {
      throw new Error("TeacherAvailabilityState must be registered as a GraphQL object type");
    }
    const fields = (
      type as { getFields: () => Record<string, { name: string; type: { toString: () => string } }> }
    ).getFields();
    expect(Object.keys(fields).toSorted((a, b) => a.localeCompare(b))).toEqual(["id", "isApproved", "isOnline"]);
    expect(fields.id?.type.toString()).toBe("Int!");
    expect(fields.isOnline?.type.toString()).toBe("Boolean!");
    expect(fields.isApproved?.type.toString()).toBe("Boolean!");
  });
});
