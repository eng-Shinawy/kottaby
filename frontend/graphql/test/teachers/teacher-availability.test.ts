/**
 * `myTeacherAvailability` + `setTeacherAvailability` — client-tier wire
 * integration suite for the certified-teacher availability toggle.
 *
 * Mirrors the `frontend/graphql/test/teachers/applicant-profile.test.ts`
 * precedent — every row goes through Apollo Client v4 + the shared error
 * helpers (`expectMutationError`), driving the REAL wire boundary
 * (`setupTestServerLifecycle` boots the Next dev server on the shared
 * TEST_PORT 3066). Real role tokens (no monkey-patched permissions) ride
 * the public `login` mutation; the per-request `Authorization: Bearer`
 * header is the production client path per `gqlContextFactory.extractAccessToken`.
 *
 * Documents (the WIRE-BOUNDARY documents, NOT local `parse`d strings):
 *  - `myTeacherAvailabilityQueryDocument` — the shared TypedDocumentNode the
 *    production card consumes (zero-arg query selecting `id`, `isOnline`,
 *    `isApproved` — `id` first for Apollo cache normalization).
 *  - `setTeacherAvailabilityMutationDocument` — the shared TypedDocumentNode
 *    (the `$isOnline: Boolean!` toggle mutation, selecting the same three
 *    fields for cache normalization).
 *  - The Tier-4 BOPLA wire probes keep LOCAL `parse`d documents: they are
 *    deliberately INVALID operations (unknown `teacherId` / `userId`
 *    argument) that must die at schema validation; the shared documents
 *    cannot express them (the same precedent as the applicant-profile
 *    suite's Tier-4 BOLA probes).
 *
 * Data lifecycle (mirrors the sibling suites — `applicant-profile.test.ts`
 * + `verification-plan-purchase.test.ts`): every user this suite creates —
 * public registrations, direct-DB fixtures — is tracked by id and deleted
 * in a describe-scoped `afterAll` via the shared `deleteUsersByIds` helper
 * (RESTRICT-gated `session` rows drained FIRST via
 * `deleteSessionsByParticipantUserIds`, then the users; child rows
 * cascade). Deletion is by EXPLICIT id list, never an email-pattern sweep,
 * so parallel live-wire suites keep their own fixtures intact.
 *
 * Tiers:
 *  - Tier 1  happy pair — certified teacher reads own availability
 *            projection (`{ id, isOnline, isApproved }` matching the
 *            fixture row); toggles `setTeacherAvailability(isOnline:
 *            false)` (the Unavailable direction, skips BOTH the
 *            certification gate and the in-session gate) AND re-reads via
 *            a follow-up `myTeacherAvailability` query (read-your-writes
 *            oracle on the wire boundary); toggles Available (the happy
 *            path) and re-reads again.
 *  - Tier 2  boundary — round-trip toggle true → false → true with the
 *            projection pinned at every leg (the toggle toggled twice
 *            case).
 *  - Tier 3  denial matrix — the full BFLA + INV-A1 + INV-A2 +
 *            TEACHER_NOT_FOUND wire tier:
 *      · Anonymous caller on BOTH ops → UNAUTHORIZED (401, never 403).
 *      · Authenticated STUDENT on BOTH ops → FORBIDDEN (403, role scope).
 *      · Authenticated ADMIN on BOTH ops → FORBIDDEN (403, staff roles
 *        excluded).
 *      · Uncertified teacher (teacher row present, `isApproved = false`)
 *        on `setTeacherAvailability(isOnline: true)` → FORBIDDEN (the
 *        service-side certification gate — INV-A1 — re-verified past the
 *        role scope); the same teacher on `setTeacherAvailability(isOnline:
 *        false)` succeeds (Unavailable skips BOTH gates); the same
 *        teacher on `myTeacherAvailability` reads the projection honestly
 *        (the read path runs NO certification gate).
 *      · Certified teacher with a `started` session on
 *        `setTeacherAvailability(isOnline: true)` →
 *        TEACHER_IN_ACTIVE_SESSION (409, INV-A2); the response carries NO
 *        session id, status, or counterparty (oracle safety).
 *      · Authenticated teacher-role user with NO `teacher` row on BOTH
 *        ops → TEACHER_NOT_FOUND (404 — the row-absent path).
 *  - Tier 4  BOPLA wire probes — smuggled identity arguments
 *    (`teacherId` on the mutation, `userId` on the query) die as
 *    GRAPHQL_VALIDATION_FAILED before any resolver runs (the schema
 *    admits NO identity surface — there is no way to target a different
 *    teacher id).
 *
 * ENVIRONMENT NOTE (sandbox): the canonical lifecycle helper boots its own
 * dev server on TEST_PORT (3066) when nothing answers there. Under
 * `DB_PROVIDER=pglite`, the wire-tier suite is skipped wholesale
 * (`describeGraphqlSuite` — the test process and the dev server run
 * separate in-memory PGlite instances and do not share uncommitted writes;
 * the 4 GB sandbox RAM budget cannot keep both processes alive at once).
 * The wire-tier suite is GREEN in CI / production-PG environments — the
 * same skip convention adopted by the sibling `applicant-profile.test.ts`
 * + `session-lifecycle-queries.test.ts` suites.
 *
 * Mandated runner:
 *   bun run test/scripts/run-test.ts frontend/graphql/test/teachers/teacher-availability.test.ts
 */

import { afterAll, beforeAll, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { parse } from "graphql";

import { db } from "@/backend/db";
import { teacher } from "@/backend/db/schema/teachers/teacher";
import { users } from "@/backend/db/schema/users/users";
import { SessionStatus } from "@/backend/enum/scheduling/session-status.enum";
import { UserRole } from "@/backend/enum/users/user-role.enum";
import { hashPassword } from "@/backend/lib/auth/password";
import { RegisterPublicRole } from "@/frontend/graphql/generated/gql/graphql";
import {
  loginMutationDocument,
  registerUserMutationDocument,
} from "@/frontend/graphql/sharedDocuments/auth/auth.documents";
import {
  myTeacherAvailabilityQueryDocument,
  setTeacherAvailabilityMutationDocument,
} from "@/frontend/graphql/sharedDocuments/teachers/teacher-availability.documents";
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

// ─── Fixture plumbing (applicant-profile.test.ts conventions) ──────────────

/**
 * Randomized per-suite email (unique prefix + UUID salt, `@test.local`) —
 * follows the entity-setup guidance ("randomUUID avoids unique-constraint
 * hits") while keeping the auth.test.ts `@test.local` domain marker.
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

/**
 * Normalizes a wire `ID` to the numeric PK for DB fixtures. GraphQL's ID
 * scalar serializes to a string on the wire even where the codegen types
 * say `number`, so the runtime value is widened here and the conversion
 * is decided by the actual typeof branch (no cast).
 */
function wireIdToPk(id: string | number): number {
  return typeof id === "number" ? id : Number(id);
}

/**
 * Registers a user through the PUBLIC `registerUser` mutation, then logs in
 * through the PUBLIC `login` mutation to obtain a bearer token. Returns
 * both so the caller can derive direct-DB fixtures keyed by the user id.
 */
async function registerAndLogin(
  role: RegisterPublicRole.Student | RegisterPublicRole.Teacher
): Promise<RegistrationOutcome> {
  const email = uniqueEmail("availability");
  const registered = await testClient.mutate({
    mutation: registerUserMutationDocument,
    variables: {
      input: {
        fullName: "Test Availability Actor",
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
  trackCreatedUser(registeredId);

  const loggedIn = await testClient.mutate({
    mutation: loginMutationDocument,
    variables: { email, password: testCredential },
  });
  expect(loggedIn.error).toBeUndefined();
  const accessToken = loggedIn.data?.login?.accessToken;
  if (!accessToken) throw new Error("login returned no accessToken");

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
  const accessToken = loggedIn.data?.login?.accessToken;
  if (!accessToken) throw new Error("login returned no accessToken");

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
  // Direct insert — the teacher row exists but isApproved=false. The
  // certification gate (INV-A1) re-verifies this state on every Available
  // write past the role-scope BFLA gate.
  const [teacherRow] = await db.insert(teacher).values({ id: user.id, isApproved: false }).returning();
  if (!teacherRow) throw new Error("uncertified teacher child-row insert returned no rows");

  const loggedIn = await testClient.mutate({
    mutation: loginMutationDocument,
    variables: { email, password: testCredential },
  });
  expect(loggedIn.error).toBeUndefined();
  const accessToken = loggedIn.data?.login?.accessToken;
  if (!accessToken) throw new Error("login returned no accessToken");

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

/**
 * Provisions an admin user (NOT publicly registrable — RegisterPublicRole
 * BFLA exclusion) via a direct DB insert with a REAL bcrypt hash, then
 * logs in over the public `login` mutation (real session, real token,
 * real scope check).
 */
async function provisionAdmin(): Promise<RegistrationOutcome> {
  const email = uniqueEmail("admin");
  const [adminUser] = await db
    .insert(users)
    .values({
      fullName: "Availability Admin Probe",
      email,
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

  const loggedIn = await testClient.mutate({
    mutation: loginMutationDocument,
    variables: { email, password: testCredential },
  });
  expect(loggedIn.error).toBeUndefined();
  const accessToken = loggedIn.data?.login?.accessToken;
  if (!accessToken) throw new Error("login returned no accessToken");

  return { userId: adminUser.id, accessToken };
}

// ─── Runtime narrowing helpers (no casts, per test-tier discipline) ────────

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** The wire availability payload — runtime narrowed with no casts. */
interface AvailabilityPayload {
  readonly id: number;
  readonly isOnline: boolean;
  readonly isApproved: boolean;
}

/**
 * The wire `myTeacherAvailability` payload of a successful read — runtime
 * narrowed with no casts. The `__typename` field Apollo merges in at
 * runtime is asserted separately (it is not part of the codegen type).
 */
function availabilityPayloadOf(
  result: { readonly data?: unknown },
  rootField: "myTeacherAvailability"
): AvailabilityPayload {
  if (!isRecord(result.data)) {
    throw new Error("expected myTeacherAvailability data");
  }
  const payload: unknown = result.data[rootField];
  if (!isRecord(payload)) {
    throw new Error("expected a myTeacherAvailability payload");
  }
  return narrowAvailabilityPayload(payload);
}

/** The wire `setTeacherAvailability` payload of a successful mutation. */
function setAvailabilityPayloadOf(
  result: { readonly data?: unknown },
  rootField: "setTeacherAvailability"
): AvailabilityPayload {
  if (!isRecord(result.data)) {
    throw new Error("expected setTeacherAvailability data");
  }
  const payload: unknown = result.data[rootField];
  if (!isRecord(payload)) {
    throw new Error("expected a setTeacherAvailability payload");
  }
  return narrowAvailabilityPayload(payload);
}

function narrowAvailabilityPayload(payload: Record<string, unknown>): AvailabilityPayload {
  const id: unknown = payload.id;
  const isOnline: unknown = payload.isOnline;
  const isApproved: unknown = payload.isApproved;
  if (typeof id !== "number" || typeof isOnline !== "boolean" || typeof isApproved !== "boolean") {
    throw new Error("expected { id: number; isOnline: boolean; isApproved: boolean }");
  }
  return { id, isOnline, isApproved };
}

// ─── Wire-call helpers (single-call helpers — kept under 70 lines) ────────

/** Authenticated `myTeacherAvailability` read over the wire. */
function readAvailability(accessToken: string): ReturnType<typeof testClient.query> {
  return testClient.query({
    query: myTeacherAvailabilityQueryDocument,
    context: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
}

/** Authenticated `setTeacherAvailability(isOnline: $isOnline)` mutation over the wire. */
function toggleAvailability(accessToken: string, isOnline: boolean): ReturnType<typeof testClient.mutate> {
  return testClient.mutate({
    mutation: setTeacherAvailabilityMutationDocument,
    variables: { isOnline },
    context: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
}

/** Anonymous `myTeacherAvailability` read (no credentials). */
function readAvailabilityAnonymous(): ReturnType<typeof testClient.query> {
  return testClient.query({ query: myTeacherAvailabilityQueryDocument });
}

/** Anonymous `setTeacherAvailability` mutation (no credentials). */
function toggleAvailabilityAnonymous(isOnline: boolean): ReturnType<typeof testClient.mutate> {
  return testClient.mutate({
    mutation: setTeacherAvailabilityMutationDocument,
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
  const [student, certifiedTeacher, uncertifiedTeacher, teacherWithoutRow, admin] = await Promise.all([
    registerAndLogin(RegisterPublicRole.Student),
    provisionCertifiedTeacher(),
    provisionUncertifiedTeacher(),
    registerAndLogin(RegisterPublicRole.Teacher),
    provisionAdmin(),
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

describeGraphqlSuite("Teacher availability — GraphQL integration (client tier)", () => {
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
    // The fixture row is created via `insertCertifiedTeacherRow` (default
    // `isOnline=false`, `isApproved=true`); the wire projection reflects
    // EXACTLY that row — id is the caller's own users.id, the boolean
    // flags are the canonical fixture values.
    const payload = availabilityPayloadOf(result, "myTeacherAvailability");
    expect(payload).toEqual({ id: userId, isOnline: false, isApproved: true });
    // Apollo merges `__typename` into entity objects at runtime (not part
    // of the codegen type), pinned separately via `toHaveProperty` (no
    // `as` cast — the property check is structurally safe).
    expect(result.data?.myTeacherAvailability).toHaveProperty("__typename", "TeacherAvailabilityState");
  });

  test("certified teacher toggles Unavailable → wire result + re-read via the query", async () => {
    const { userId, accessToken } = theCast().certifiedTeacher;
    const result = await toggleAvailability(accessToken, false);

    expect(result.error).toBeUndefined();
    const payload = setAvailabilityPayloadOf(result, "setTeacherAvailability");
    expect(payload).toEqual({ id: userId, isOnline: false, isApproved: true });

    // Re-read via a second query — the persisted state survives a fresh
    // wire round-trip (read-your-writes oracle on the wire boundary).
    const reread = await readAvailability(accessToken);
    expect(reread.error).toBeUndefined();
    expect(availabilityPayloadOf(reread, "myTeacherAvailability")).toEqual({
      id: userId,
      isOnline: false,
      isApproved: true,
    });
  });

  test("certified teacher toggles Available → wire result + re-read via the query (the happy path)", async () => {
    const { userId, accessToken } = theCast().certifiedTeacher;
    const result = await toggleAvailability(accessToken, true);

    expect(result.error).toBeUndefined();
    expect(setAvailabilityPayloadOf(result, "setTeacherAvailability")).toEqual({
      id: userId,
      isOnline: true,
      isApproved: true,
    });

    // Re-read via a second query — the persisted state survives a fresh
    // wire round-trip (read-your-writes oracle on the wire boundary).
    const reread = await readAvailability(accessToken);
    expect(reread.error).toBeUndefined();
    expect(availabilityPayloadOf(reread, "myTeacherAvailability")).toEqual({
      id: userId,
      isOnline: true,
      isApproved: true,
    });
  });

  // ─── Tier 2 — boundary (the toggle toggled twice case) ──────────────────

  test("round-trip toggle true → false → true returns the row at every leg", async () => {
    const { userId, accessToken } = theCast().certifiedTeacher;

    const toTrue = await toggleAvailability(accessToken, true);
    expect(toTrue.error).toBeUndefined();
    expect(setAvailabilityPayloadOf(toTrue, "setTeacherAvailability")).toEqual({
      id: userId,
      isOnline: true,
      isApproved: true,
    });

    const backToFalse = await toggleAvailability(accessToken, false);
    expect(backToFalse.error).toBeUndefined();
    expect(setAvailabilityPayloadOf(backToFalse, "setTeacherAvailability")).toEqual({
      id: userId,
      isOnline: false,
      isApproved: true,
    });

    // The final persisted state is the last write — pinned by a fresh read.
    const reread = await readAvailability(accessToken);
    expect(reread.error).toBeUndefined();
    expect(availabilityPayloadOf(reread, "myTeacherAvailability")).toEqual({
      id: userId,
      isOnline: false,
      isApproved: true,
    });
  });

  // ─── Tier 3 — denial matrix (BFLA + INV-A1 + INV-A2 + NOT_FOUND) ──

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
    // certification gate fires next (INV-A1).
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
    expect(setAvailabilityPayloadOf(result, "setTeacherAvailability")).toEqual({
      id: userId,
      isOnline: false,
      isApproved: false,
    });
  });

  test("uncertified teacher → `myTeacherAvailability` returns the projection (read is allowed for any teacher row)", async () => {
    // The READ path runs NO certification gate — a teacher row present
    // with `isApproved=false` is honestly projected back to the caller
    // (the client-side "Available" CTA pre-empts from `isApproved === false`).
    const { userId, accessToken } = theCast().uncertifiedTeacher;
    const result = await readAvailability(accessToken);
    expect(result.error).toBeUndefined();
    expect(availabilityPayloadOf(result, "myTeacherAvailability")).toEqual({
      id: userId,
      isOnline: false,
      isApproved: false,
    });
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
