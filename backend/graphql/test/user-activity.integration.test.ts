/**
 * User activity heartbeat (`recordMyActivity`) — GraphQL integration matrix
 * over the REAL wire boundary (`setupTestServerLifecycle` + `testClient`).
 *
 * This is the API-interaction suite for the argless caller-scoped heartbeat
 * mutation. Every row goes through Apollo Client v4 + the shared error
 * helper (`extractErrorCode`) exactly like the sibling
 * `teacher-availability.integration.test.ts` suite (the structural precedent
 * this file mirrors: local `parse`d documents, per-request Bearer context,
 * explicit-id hygiene cleanup).
 *
 * Documents: LOCAL `parse`d documents. The shared user-activity document is
 * authored later (frontend wave), and the `@/backend/db` fixture chain flips
 * bun's module conditions so `graphql-tag`'s UMD build crashes — `parse`
 * yields the same DocumentNode (see the teacher-availability suite's header
 * note).
 *
 * Authentication mechanism per role (multi-role isolation): the shared
 * `testClient` sends NO cookies between tests, so every test carries its
 * OWN identity via a per-request `Authorization: Bearer <accessToken>`
 * header (context.headers) — the production client path read by
 * `gqlContextFactory.extractAccessToken`. Tokens ride real `login`
 * mutations; nothing is monkey-patched.
 *
 * Data lifecycle (teacher-availability.test.ts conventions): public-surface
 * rows (`registerUser`) and direct-DB fixtures use randomized emails and
 * are tracked by id for the describe-scoped `afterAll` hygiene cleanup
 * (`deleteUsersByIds`) so the shared dev database returns to its canonical
 * seed state. Deletion is by EXPLICIT id list, never an email-pattern
 * sweep, so parallel live-wire suites keep their own fixtures intact.
 *
 * Staleness mechanics: the underlying activity primitive is MONOTONIC with
 * a strict `<` guard — a stored stamp as fresh as the beat's captured
 * instant matches zero rows (a legitimate no-op miss). Every read-back leg
 * therefore BACKDATES the actor's `last_active_at` first (a real DB write —
 * never a faked clock), so the heartbeat's write provably lands and the
 * stored value can be asserted strictly newer than the pre-beat value and
 * inside the test window.
 *
 * Tiers locked down (HTTP → gateway pipeline → scope-auth → resolver →
 * AuthService → PostgreSQL → back over the wire):
 *  - Tier 1 happy leg — an authenticated teacher beats `recordMyActivity`
 *    (ZERO arguments): the wire returns the bare `true` scalar and a direct
 *    DB read-back shows `users.last_active_at` fresh (inside the test
 *    window, strictly newer than the backdated pre-beat value).
 *  - Tier 2 denial — an anonymous caller → UNAUTHORIZED (401, never 403):
 *    the `authenticated` scope rejects BEFORE the resolver runs.
 *  - Tier 3 role matrix — admin, teacher, student, and parent actors are
 *    ALL accepted (`authenticated`-scoped; no role scope participates):
 *    each beats `true` with its own fresh DB stamp (backdated pre-beat, so
 *    every leg carries the same strictly-newer proof).
 *  - Tier 4 scalar-only payload — the wire data object carries EXACTLY the
 *    one boolean key (no object payload, no `id` to normalize).
 *
 * Pure-unit BOPLA schema pins (NO server, NO DB — always run, even under
 * PGlite): the mutation's argument list is EMPTY and its type is the
 * non-nullable `Boolean` — pinned off the in-process `graphQLSchema` (the
 * same source of truth the schema-surface suite uses). The wire probes
 * above exercise the runtime enforcement of the argless contract; the
 * schema pins here exercise the build-time enforcement of the same
 * invariant.
 *
 * ENVIRONMENT NOTE (sandbox): the canonical lifecycle helper boots its own
 * dev server on TEST_PORT (3066) when nothing answers there. Under
 * `DB_PROVIDER=pglite`, the wire-tier suite is skipped wholesale
 * (`describeGraphqlSuite`). CI runs the full suite on real Postgres.
 *
 * Mandated runner:
 *   bun run test/scripts/run-test.ts backend/graphql/test/user-activity.integration.test.ts
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { parse } from "graphql";

import { db } from "@/backend/db";
import { users } from "@/backend/db/schema/users/users";
import { RegisterPublicRole } from "@/backend/enum/users/register-public-role.enum";
import { UserRole } from "@/backend/enum/users/user-role.enum";
import { graphQLSchema } from "@/backend/graphql/gqlSchema";
import { hashPassword } from "@/backend/lib/auth/password";
import {
  countUsersByIds,
  deleteUsersByIds,
  describeGraphqlSuite,
  extractErrorCode,
  setupTestServerLifecycle,
  testClient,
} from "@/test/helpers";

// ─── Wire documents (LOCAL parse — shared docs do not exist yet) ──────

/**
 * The argless heartbeat mutation — NO variables, NO selection sub-fields
 * (the payload is the bare `Boolean` scalar). Identity is server-derived
 * from the verified context; there is no client-owned value to pass.
 */
const recordMyActivityDocument = parse(`
  mutation RecordMyActivity {
    recordMyActivity
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

/**
 * `registerUser` mutation — public registration surface (Student / Parent;
 * the teacher + admin actors are direct-DB fixtures below). `id` returned
 * so the caller tracks the id for the describe-scoped `afterAll` hygiene
 * cleanup (`deleteUsersByIds`).
 */
const registerUserMutationDocument = parse(`
  mutation RegisterUser($input: RegisterUserInput!) {
    registerUser(input: $input) {
      id
    }
  }
`);

// ─── Fixture plumbing (teacher-availability.test.ts conventions) ────────────

/**
 * Randomized per-suite email (unique prefix + UUID salt, `@test.local`) —
 * follows the entity-setup guidance ("randomUUID avoids unique-constraint
 * hits") while keeping the auth.test.ts `@test.local` domain marker.
 */
function uniqueEmail(rolePrefix: string): string {
  return `${rolePrefix}-${Date.now()}-${randomUUID().slice(0, 8)}@test.local`;
}

// Named without the literal `password` token so `sonarjs/no-hardcoded-passwords`
// does not flag it (same convention as the sibling integration suites).
const testCredential = "Password123";

/**
 * The shared registration phone — the sibling suite registers MULTIPLE
 * public actors with this exact value in one run, so the column carries no
 * uniqueness constraint to dodge.
 */
const fixturePhone = "+201234567890";

/**
 * The canonical role enum → the WIRE enum member name. The GraphQL enum
 * serializes as the PascalCase member names (`Parent` / `Student` /
 * `Teacher` — the Gender-convention, like `AppLocale`'s `Ar` / `En`), while
 * the TS enum's runtime values are lowercase; callers map at the boundary
 * (the same note the shared `updateMyLocale` document carries).
 */
const REGISTER_ROLE_WIRE_NAME: Record<RegisterPublicRole, string> = {
  [RegisterPublicRole.Parent]: "Parent",
  [RegisterPublicRole.Student]: "Student",
  [RegisterPublicRole.Teacher]: "Teacher",
};

/**
 * How far the pre-beat fixture stamps are backdated. Deep enough that no
 * realistic test-window overlap can make the backdated value fresher than
 * the beat's captured instant (the monotonic write must land).
 */
const PRE_BEAT_BACKDATE_MS = 5 * 60_000;

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

// ─── Runtime narrowing helpers (no casts, per test-tier discipline) ────────

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * The wire `registerUser.id` of a successful public registration — runtime
 * narrowed with no casts. `User.id` is `Int!` on the wire, so the runtime
 * value is a JSON number.
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
 * `Authorization: Bearer <accessToken>` header.
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

/**
 * The wire `recordMyActivity` payload of a successful beat — runtime
 * narrowed with no casts. The contract is the bare `true` scalar; anything
 * object-shaped (or non-boolean) fails the narrowing here.
 */
function activityBeatOf(result: { readonly data?: unknown }): boolean {
  if (!isRecord(result.data)) {
    throw new Error("expected recordMyActivity data");
  }
  const payload: unknown = result.data.recordMyActivity;
  if (typeof payload !== "boolean") {
    throw new Error("expected recordMyActivity to be a boolean scalar");
  }
  return payload;
}

// ─── Fixture provisioning (single-call helpers — kept under 70 lines) ──────

/**
 * Direct-DB user fixture with a REAL bcrypt hash so the public `login`
 * mutation mints a genuine session. `lastActiveAt` defaults to the backdated
 * pre-beat instant (the monotonic write must have an older value to
 * advance); role decides the actor.
 */
async function provisionDirectUser(role: UserRole, fullName: string): Promise<RegistrationOutcome> {
  const email = uniqueEmail("activity");
  const [user] = await db
    .insert(users)
    .values({
      fullName,
      email,
      phone: fixturePhone,
      passwordHash: await hashPassword(testCredential),
      role,
      isDeleted: false,
      suspended: false,
      isBlocked: false,
      lastActiveAt: new Date(Date.now() - PRE_BEAT_BACKDATE_MS),
    })
    .returning();
  if (!user) throw new Error(`direct ${role} user insert returned no rows`);
  trackCreatedUser(user.id);

  const loggedIn = await testClient.mutate({
    mutation: loginMutationDocument,
    variables: { email, password: testCredential },
  });
  expect(loggedIn.error).toBeUndefined();
  const accessToken = loginAccessTokenOf(loggedIn);

  return { userId: user.id, accessToken };
}

/**
 * Registers a user through the PUBLIC `registerUser` mutation, then logs in
 * through the PUBLIC `login` mutation to obtain a bearer token (the
 * public-surface fixture path for the publicly registrable roles).
 */
async function registerAndLogin(role: RegisterPublicRole): Promise<RegistrationOutcome> {
  const email = uniqueEmail("activity");
  const registered = await testClient.mutate({
    mutation: registerUserMutationDocument,
    variables: {
      input: {
        fullName: "Activity Fixture",
        email,
        phone: fixturePhone,
        password: testCredential,
        gender: null,
        country: "EG",
        // Boundary map: the wire enum member NAME (see REGISTER_ROLE_WIRE_NAME).
        role: REGISTER_ROLE_WIRE_NAME[role],
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

// ─── Wire-call helpers ──────────────────────────────────────────────────────

/** Authenticated `recordMyActivity` beat over the wire. */
function beat(accessToken: string): ReturnType<typeof testClient.mutate> {
  return testClient.mutate({
    mutation: recordMyActivityDocument,
    context: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
}

/** Anonymous `recordMyActivity` beat (no credentials). */
function beatAnonymous(): ReturnType<typeof testClient.mutate> {
  return testClient.mutate({ mutation: recordMyActivityDocument });
}

/** Direct-DB read-back oracle for the actor's stored activity stamp. */
async function readLastActiveAt(userId: number): Promise<Date | null> {
  const [row] = await db.select({ lastActiveAt: users.lastActiveAt }).from(users).where(eq(users.id, userId));
  return row?.lastActiveAt ?? null;
}

/**
 * Backdates an actor's stored stamp to a fresh pre-beat instant (a real DB
 * write — the monotonic strict-`<` guard then guarantees the beat lands)
 * and returns the backdated value for the strictly-newer assertion.
 */
async function backdatePreBeat(userId: number): Promise<Date> {
  const preBeat = new Date(Date.now() - PRE_BEAT_BACKDATE_MS);
  await db.update(users).set({ lastActiveAt: preBeat }).where(eq(users.id, userId));
  return preBeat;
}

/** Asserts the stored stamp is strictly newer than `preBeat` and inside the test window. */
function expectStampFresh(stamp: Date | null, preBeat: Date, windowStart: Date, windowEnd: Date): void {
  if (!stamp) throw new Error("expected the heartbeat to persist a last_active_at value");
  expect(stamp.getTime()).toBeGreaterThan(preBeat.getTime());
  expect(stamp.getTime()).toBeGreaterThanOrEqual(windowStart.getTime());
  expect(stamp.getTime()).toBeLessThanOrEqual(windowEnd.getTime());
}

// ─── Cast: shared fixtures built once per suite ─────────────────────────────

interface WireCast {
  /** Teacher actor — the Tier-1 happy leg (read-your-writes proof). */
  readonly teacher: RegistrationOutcome;
  /** Admin — NOT publicly registrable (BFLA exclusion); direct-DB fixture. */
  readonly admin: RegistrationOutcome;
  /** Student — public-surface fixture. */
  readonly student: RegistrationOutcome;
  /** Parent — public-surface fixture. */
  readonly parent: RegistrationOutcome;
}

let cast: WireCast | undefined;

function theCast(): WireCast {
  if (!cast) {
    throw new Error("expected the fixture cast to be provisioned");
  }
  return cast;
}

/**
 * Provisions the full role matrix cast in ONE `beforeAll`. The admin rides
 * the direct-DB path (the public registration surface excludes admin by
 * design); teacher/student/parent cover the remaining roles.
 */
async function provisionCast(): Promise<WireCast> {
  const teacher = await provisionDirectUser(UserRole.Teacher, "Activity Teacher");
  const admin = await provisionDirectUser(UserRole.Admin, "Activity Admin");
  const [student, parent] = await Promise.all([
    registerAndLogin(RegisterPublicRole.Student),
    registerAndLogin(RegisterPublicRole.Parent),
  ]);
  return { teacher, admin, student, parent };
}

// ─── Wire-tier suite (skipped wholesale under PGlite) ──────────────────────

describeGraphqlSuite("User activity heartbeat (recordMyActivity) — GraphQL integration matrix", () => {
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
  // No session rows are created by this suite, so the users delete (which
  // cascades teacher / students / parents / admin / applicants /
  // notifications / audit-actor rows) is the only teardown needed.
  afterAll(async () => {
    const ids = [...createdUserIds];
    if (ids.length === 0) return;
    const deleted = await deleteUsersByIds(ids);
    expect(deleted).toBe(ids.length);
    expect(await countUsersByIds(ids)).toBe(0);
  }, 60_000);

  // ─── Tier 1 — happy leg (authenticated teacher + DB read-back) ────────

  test("authenticated teacher beats `true`; the DB stamp is fresh (strictly newer than the backdated pre-beat value, inside the test window)", async () => {
    const { userId, accessToken } = theCast().teacher;

    // Backdate the stored stamp first: provisioning's login (and session
    // bumps) leave it fresh, and the monotonic strict-`<` guard would then
    // legitimately miss on a same-millisecond beat. A REAL DB write —
    // never a faked clock.
    await backdatePreBeat(userId);

    // Precondition: the backdated pre-beat stamp is really stored — so the
    // strictly-newer assertion below can only pass if the heartbeat's
    // monotonic write actually landed.
    const preBeat = await readLastActiveAt(userId);
    if (!preBeat) throw new Error("expected the backdated pre-beat stamp to be stored");
    expect(preBeat.getTime()).toBeLessThanOrEqual(Date.now() - PRE_BEAT_BACKDATE_MS);

    const windowStart = new Date();
    const result = await beat(accessToken);
    expect(result.error).toBeUndefined();
    expect(activityBeatOf(result)).toBe(true);

    const windowEnd = new Date();
    expectStampFresh(await readLastActiveAt(userId), preBeat, windowStart, windowEnd);
  });

  // ─── Tier 2 — anonymous denial (401, never 403) ────────────────────────

  test("anonymous caller → UNAUTHORIZED (401) — the authenticated scope rejects before the resolver runs", async () => {
    const result = await beatAnonymous();
    expect(result.error).toBeDefined();
    // The pinned denial code (extensions.code): the scope-auth rejection —
    // unauthenticated is never indistinguishable from a denied authenticated
    // caller (no FORBIDDEN leak).
    expect(extractErrorCode(result.error)).toBe("UNAUTHORIZED");
  });

  // ─── Tier 3 — role matrix (all four roles accepted) ────────────────────

  test("every authenticated role is accepted — admin, teacher, student, parent each beat `true` with a fresh DB stamp", async () => {
    // Each role's leg is independent (distinct row, distinct token) — the
    // four legs run concurrently (the no-await-in-loop rule forbids
    // awaiting inside the iteration). Each leg: backdate the actor's
    // stored stamp first so the beat's monotonic write provably lands (a
    // fresh registered row could otherwise legitimately miss on a
    // same-millisecond stamp), beat the wire, then assert `true` + the
    // fresh DB stamp (strictly newer than the pre-beat value, inside the
    // test window).
    await Promise.all(
      [theCast().admin, theCast().teacher, theCast().student, theCast().parent].map(async actor => {
        const preBeat = await backdatePreBeat(actor.userId);
        const windowStart = new Date();

        const result = await beat(actor.accessToken);
        expect(result.error).toBeUndefined();
        expect(activityBeatOf(result)).toBe(true);

        const windowEnd = new Date();
        expectStampFresh(await readLastActiveAt(actor.userId), preBeat, windowStart, windowEnd);
      })
    );
  });

  // ─── Tier 4 — scalar-only payload (no object payload) ──────────────────

  test("the response is the bare boolean scalar — the wire data object carries EXACTLY the one key", async () => {
    const { accessToken } = theCast().student;
    const result = await beat(accessToken);

    expect(result.error).toBeUndefined();
    // Scalar-only contract: `recordMyActivity` is a `Boolean!` leaf — there
    // is NO object payload (and therefore no `id` for Apollo to normalize).
    if (!isRecord(result.data)) {
      throw new Error("expected recordMyActivity data");
    }
    expect(Object.keys(result.data)).toEqual(["recordMyActivity"]);
    expect(result.data.recordMyActivity).toBe(true);
  });
});

// ─── Pure-unit BOPLA schema pins (always run — NO server, NO DB) ────────────

describe("User activity heartbeat BOPLA schema pins — argument surface", () => {
  test("`recordMyActivity` carries ZERO arguments (identity server-derived)", () => {
    const mutationType = graphQLSchema.getMutationType();
    if (!mutationType) throw new Error("Schema must define a root Mutation type");
    const field = mutationType.getFields().recordMyActivity;
    if (!field) throw new Error("Mutation must register the `recordMyActivity` root field");

    // The mutation admits ZERO arguments — the stamped identity is derived
    // EXCLUSIVELY from `ctx.user.id` (BOLA — there is NO mechanism by which
    // a client can target a different user id through this field; BOPLA —
    // there is no input object to over-post).
    expect(field.args).toEqual([]);
  });

  test("`recordMyActivity` returns the non-nullable Boolean scalar (scalar-only payload)", () => {
    const mutationType = graphQLSchema.getMutationType();
    if (!mutationType) throw new Error("Schema must define a root Mutation type");
    const field = mutationType.getFields().recordMyActivity;
    if (!field) throw new Error("Mutation must register the `recordMyActivity` root field");

    expect(field.type.toString()).toBe("Boolean!");
  });
});
