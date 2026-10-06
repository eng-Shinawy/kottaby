/**
 * `browseAvailableTeachers` — client-tier wire integration suite for the
 * student-facing teacher-directory browse (the "Available Teachers" read).
 *
 * Mirrors the `frontend/graphql/test/teachers/teacher-availability.test.ts`
 * precedent — every operation goes through Apollo Client v4 + the shared
 * error helpers (`expectMutationError`), driving the REAL wire boundary
 * (`setupTestServerLifecycle` boots the Next dev server on the shared
 * TEST_PORT 3066). Real role tokens (no monkey-patched permissions) ride
 * the public `login` mutation; the per-request `Authorization: Bearer`
 * header is the production client path per `gqlContextFactory.extractAccessToken`.
 *
 * Documents (the WIRE-BOUNDARY document, NOT a local `parse`d string):
 *  - `browseAvailableTeachersQueryDocument` — the shared TypedDocumentNode
 *    the production container consumes (identity is server-derived; the
 *    variables are the six per-browse CHOICES — the hard pair, the
 *    optional name search / rating floor / ordering trio, and the page
 *    bounds — with `id` first inside `items` for Apollo cache
 *    normalization).
 *  - The Tier-4 BOPLA wire probe keeps a LOCAL `parse`d document: it is a
 *    deliberately INVALID operation (a smuggled `userId` argument) that
 *    must die at schema validation; the shared document cannot express it
 *    (the same precedent as the availability suite's Tier-4 probes).
 *
 * Data lifecycle (mirrors the sibling suites): every user this suite
 * creates — public registrations, direct-DB fixtures — is tracked by id
 * and deleted in a describe-scoped `afterAll` via the shared
 * `deleteUsersByIds` helper (RESTRICT-gated `session` rows drained FIRST
 * via `deleteSessionsByParticipantUserIds`, then the users; child rows
 * cascade). Deletion is by EXPLICIT id list, never an email-pattern
 * sweep, so parallel live-wire suites keep their own fixtures intact.
 *
 * Tiers:
 *  - Tier 1  happy read — a registered STUDENT browses BEFORE this suite
 *            seeds any directory teacher and asserts the PAGE ENVELOPE
 *            shape (items array + the four envelope numbers; the shared
 *            dev database may legitimately carry zero matches — the
 *            envelope, never non-emptiness, is the contract). After the
 *            DB fixtures land, the same student's browse RETURNS the
 *            seeded eligible teachers (`hafs_an_asim` certification +
 *            `hifz` subject + online) and EXCLUDES the profiled teacher
 *            currently inside a `started` session (the compose rule of
 *            record: eligibility NEVER rides `is_online` alone).
 *  - Tier 3  denial matrix — anonymous caller → UNAUTHORIZED (401, never
 *            403); the student token is the ONE role that reads; a
 *            registered TEACHER actor → FORBIDDEN (403, role scope).
 *  - Tier 4  BOPLA wire probe — a smuggled `userId` identity argument
 *            dies as GRAPHQL_VALIDATION_FAILED before any resolver runs
 *            (the schema admits NO identity surface).
 *
 * DB fixture path (direct drizzle inserts, sibling-suite conventions):
 * the `teacher` child row carries the raw stored JSON-array-in-varchar
 * profile columns (`recitations`, `subjects`, `languages`) exactly the
 * way the quoted-token read path expects (`["hafs_an_asim"]`,
 * `["hifz"]`); the started-session row rides the shared `insertSessionRow`
 * helper. Cleanup in `afterAll` (sessions drained, then users).
 *
 * ENVIRONMENT NOTE (sandbox): under `DB_PROVIDER=pglite`, the wire-tier
 * suite is skipped wholesale (`describeGraphqlSuite`) — the test process
 * and the dev server run separate in-memory PGlite instances. GREEN in
 * CI / production-PG environments.
 *
 * Mandated runner:
 *   bun run test/scripts/run-test.ts frontend/graphql/test/teachers/teacher-matching.test.ts
 */

import { afterAll, beforeAll, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { type OperationDefinitionNode, parse, type TypeNode } from "graphql";

import { db } from "@/backend/db";
import { teacher } from "@/backend/db/schema/teachers/teacher";
import { users } from "@/backend/db/schema/users/users";
import { SessionStatus } from "@/backend/enum/scheduling/session-status.enum";
import { UserRole } from "@/backend/enum/users/user-role.enum";
import { hashPassword } from "@/backend/lib/auth/password";
import {
  RecitationReading,
  RegisterPublicRole,
  SessionIntent,
  TeacherMatchingSort,
} from "@/frontend/graphql/generated/gql/graphql";
import {
  loginMutationDocument,
  registerUserMutationDocument,
} from "@/frontend/graphql/sharedDocuments/auth/auth.documents";
import { browseAvailableTeachersQueryDocument } from "@/frontend/graphql/sharedDocuments/teachers/teacher-matching.documents";
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

/** Ids of the seeded eligible teacher users (assertion targets). */
const eligibleTeacherIds: number[] = [];

/** Id of the seeded in-session teacher user (exclusion assertion target). */
let inSessionTeacherId: number | null = null;

/**
 * Registers a user through the PUBLIC `registerUser` mutation, then logs in
 * through the PUBLIC `login` mutation to obtain a bearer token.
 */
async function registerAndLogin(
  role: RegisterPublicRole.Student | RegisterPublicRole.Teacher
): Promise<RegistrationOutcome> {
  const email = uniqueEmail("matching");
  const registered = await testClient.mutate({
    mutation: registerUserMutationDocument,
    variables: {
      input: {
        fullName: "Test Matching Actor",
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
 * Serializes a JSON-array column payload exactly the way the quoted-token
 * read path expects (`["hafs_an_asim"]` — each element anchored by
 * surrounding quotes).
 */
function jsonColumnPayload(tokens: readonly string[]): string {
  return JSON.stringify([...tokens]);
}

/**
 * Provisions one directory teacher (users.role=teacher + `teacher` child
 * row carrying the raw stored JSON-array-in-varchar profile columns) via
 * direct DB inserts. Returns the teacher's user id (the card's `id` on
 * the wire).
 */
async function provisionDirectoryTeacher(profile: {
  readonly recitations: readonly string[];
  readonly subjects: readonly string[];
  readonly languages: readonly string[] | null;
  readonly averageRating: string | null;
  readonly isOnline: boolean;
}): Promise<number> {
  const email = uniqueEmail("directory");
  const [user] = await db
    .insert(users)
    .values({
      fullName: "Directory Teacher",
      email,
      phone: "+201234567894",
      passwordHash: await hashPassword(testCredential),
      role: UserRole.Teacher,
      isDeleted: false,
      suspended: false,
      isBlocked: false,
      lastActiveAt: new Date(),
      country: "Egypt",
      countryCode: "EG",
    })
    .returning();
  if (!user) throw new Error("directory-teacher user insert returned no rows");
  trackCreatedUser(user.id);
  const [teacherRow] = await db
    .insert(teacher)
    .values({
      id: user.id,
      isApproved: true,
      isOnline: profile.isOnline,
      averageRating: profile.averageRating,
      subjects: jsonColumnPayload(profile.subjects),
      recitations: jsonColumnPayload(profile.recitations),
      languages: profile.languages === null ? null : jsonColumnPayload(profile.languages),
    })
    .returning({ id: teacher.id });
  if (!teacherRow) throw new Error("directory-teacher child-row insert returned no rows");
  return user.id;
}

/**
 * Provisions the eligible pair + the in-session exclusion target + the
 * `started` session that disqualifies the latter. The eligible pair: both
 * online, `hafs_an_asim`-certified, `hifz`-subjected — one rated, one
 * unrated (the honest-null rating projection). The exclusion target is
 * profiled identically (so ONLY the active session disqualifies it) and
 * bound into a Started session with the browsing student as participant.
 */
async function provisionDirectoryFixtures(studentUserId: number): Promise<void> {
  const rated = await provisionDirectoryTeacher({
    recitations: ["hafs_an_asim"],
    subjects: ["hifz"],
    languages: ["english"],
    averageRating: "4.50",
    isOnline: true,
  });
  const unrated = await provisionDirectoryTeacher({
    recitations: ["hafs_an_asim"],
    subjects: ["hifz"],
    languages: null,
    averageRating: null,
    isOnline: true,
  });
  const inSession = await provisionDirectoryTeacher({
    recitations: ["hafs_an_asim"],
    subjects: ["hifz"],
    languages: null,
    averageRating: "3.00",
    isOnline: true,
  });
  eligibleTeacherIds.push(rated, unrated);
  inSessionTeacherId = inSession;
  await insertSessionRow({ teacherId: inSession, studentId: studentUserId, status: SessionStatus.Started });
}

// ─── Runtime narrowing helpers (no casts, per test-tier discipline) ────────

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** The wire page envelope — runtime narrowed with no casts. */
interface BrowsePagePayload {
  readonly total: number;
  readonly page: number;
  readonly pageSize: number;
  readonly pageCount: number;
  readonly items: readonly number[];
}

/**
 * The wire `browseAvailableTeachers` payload of a successful read —
 * runtime narrowed with no casts. Items reduce to their numeric ids (the
 * suites assert membership, never payload identity).
 */
function browsePayloadOf(result: { readonly data?: unknown }): BrowsePagePayload {
  if (!isRecord(result.data)) {
    throw new Error("expected browseAvailableTeachers data");
  }
  const payload: unknown = result.data.browseAvailableTeachers;
  if (!isRecord(payload)) {
    throw new Error("expected a browseAvailableTeachers payload");
  }
  const total: unknown = payload.total;
  const page: unknown = payload.page;
  const pageSize: unknown = payload.pageSize;
  const pageCount: unknown = payload.pageCount;
  const rawItems: unknown = payload.items;
  if (
    typeof total !== "number" ||
    typeof page !== "number" ||
    typeof pageSize !== "number" ||
    typeof pageCount !== "number" ||
    !Array.isArray(rawItems)
  ) {
    throw new Error("expected the { total, page, pageSize, pageCount, items } envelope");
  }
  const items: number[] = [];
  for (const entry of rawItems) {
    if (!isRecord(entry) || typeof entry.id !== "number") {
      throw new Error("expected every item to carry a numeric id");
    }
    items.push(entry.id);
  }
  return { total, page, pageSize, pageCount, items };
}

// ─── Wire-call helpers ──────────────────────────────────────────────────────

/** Authenticated `browseAvailableTeachers` read over the wire (optional trio forwardable). */
function browse(
  accessToken: string,
  recitation: RecitationReading,
  intent: SessionIntent,
  optional: { minRating?: number | null; search?: string | null; sort?: TeacherMatchingSort } = {}
): ReturnType<typeof testClient.query> {
  return testClient.query({
    query: browseAvailableTeachersQueryDocument,
    // The optional trio is spread FIRST and pinned to `undefined` after it:
    // codegen's `Exact<...>` requires every key to be PRESENT (value may be
    // undefined), which a bare optional spread cannot satisfy.
    variables: {
      ...optional,
      intent,
      page: 1,
      pageSize: 25,
      recitation,
      minRating: optional.minRating,
      search: optional.search,
      sort: optional.sort,
    },
    context: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
}

/** Anonymous `browseAvailableTeachers` read (no credentials). */
function browseAnonymous(recitation: RecitationReading, intent: SessionIntent): ReturnType<typeof testClient.query> {
  return testClient.query({
    query: browseAvailableTeachersQueryDocument,
    // Optional filters are pinned explicitly (null = filter absent) so the
    // variables object satisfies codegen's `Exact<...>` key-presence rule.
    variables: { intent, page: 1, pageSize: 25, recitation, minRating: null, search: null, sort: null },
  });
}

/** Renders a TypeNode's SDL text (NamedType → its name; NonNull → `T!`). */
function typeText(node: TypeNode): string {
  if (node.kind === "NonNullType") {
    return `${typeText(node.type)}!`;
  }
  return node.kind === "ListType" ? `[${typeText(node.type)}]` : node.name.value;
}

// ─── Cast: shared fixtures built once per suite ─────────────────────────────

interface WireCast {
  /** The browsing student (the ONE role the read grants). */
  readonly student: RegistrationOutcome;
  /** Teacher-role actor — the Tier-3 FORBIDDEN probe. */
  readonly teacherActor: RegistrationOutcome;
}

let cast: WireCast | undefined;

function theCast(): WireCast {
  if (!cast) {
    throw new Error("expected the fixture cast to be provisioned");
  }
  return cast;
}

// ─── Wire-tier suite (skipped wholesale under PGlite) ──────────────────────

describeGraphqlSuite("Teacher matching browse — GraphQL integration (client tier)", () => {
  // Memory-constrained sandbox adaptation: setting TEST_SERVER_EXTERNAL=1 +
  // GRAPHQL_TEST_PORT=<already-running server> runs the suite against that
  // warm server instead of spawning a second `next dev`. CI never sets the
  // flag and keeps the standard boot-on-3066 lifecycle.
  if (process.env.TEST_SERVER_EXTERNAL !== "1") {
    setupTestServerLifecycle();
  }

  beforeAll(async () => {
    cast = {
      student: await registerAndLogin(RegisterPublicRole.Student),
      teacherActor: await registerAndLogin(RegisterPublicRole.Teacher),
    };
  }, 180_000);

  // ─── Hygiene: restore the shared dev database to the canonical seed state.
  // The RESTRICT-gated `session` FKs block the users delete — drain those
  // FIRST via the shared helper, then delete the users (child rows cascade).
  afterAll(async () => {
    const ids = [...createdUserIds];
    if (ids.length === 0) return;
    await deleteSessionsByParticipantUserIds(ids);
    const deleted = await deleteUsersByIds(ids);
    expect(deleted).toBe(ids.length);
    expect(await countUsersByIds(ids)).toBe(0);
  }, 60_000);

  // ─── Tier 1 — happy read (envelope BEFORE fixtures land) ───────────────

  test("registered student browses → honest page envelope (assert the envelope, not non-emptiness)", async () => {
    const result = await browse(theCast().student.accessToken, RecitationReading.HafsAnAsim, SessionIntent.Hifz);
    expect(result.error).toBeUndefined();
    const payload = browsePayloadOf(result);
    // The envelope contract — items is a real array, the pagination echo is
    // the requested window, and pageCount is the honest ceil(total/pageSize).
    // Zero matches is a VALID browse state (the shared dev database may be
    // at its canonical seed with no eligible teachers), so `total` is only
    // pinned to its arithmetic, never to a specific count.
    expect(Array.isArray(payload.items)).toBe(true);
    expect(payload.items.length).toBeLessThanOrEqual(25);
    expect(payload.page).toBe(1);
    expect(payload.pageSize).toBe(25);
    expect(payload.total).toBeGreaterThanOrEqual(0);
    expect(payload.pageCount).toBe(Math.ceil(payload.total / payload.pageSize));
  });

  // ─── DB fixture path — the directory profiles + the exclusion target ───

  test("fixtures: eligible pair + in-session teacher land in the database", async () => {
    await provisionDirectoryFixtures(theCast().student.userId);
    expect(eligibleTeacherIds).toHaveLength(2);
    expect(inSessionTeacherId).not.toBeNull();
  });

  test("browse RETURNS the seeded eligible teachers and EXCLUDES the in-session teacher (compose rule)", async () => {
    const result = await browse(theCast().student.accessToken, RecitationReading.HafsAnAsim, SessionIntent.Hifz);
    expect(result.error).toBeUndefined();
    const payload = browsePayloadOf(result);
    expect(payload.page).toBe(1);
    expect(payload.pageSize).toBe(25);
    expect(payload.pageCount).toBe(Math.ceil(payload.total / payload.pageSize));
    for (const eligibleId of eligibleTeacherIds) {
      expect(payload.items).toContain(eligibleId);
    }
    if (inSessionTeacherId !== null) {
      expect(payload.items).not.toContain(inSessionTeacherId);
    }
    // The honest total counts the eligible set (the exclusion target is
    // already out), so the page carries every eligible teacher.
    expect(payload.total).toBeGreaterThanOrEqual(eligibleTeacherIds.length);
  });

  test("the document carries the optional trio as typed variables (search: String, minRating: Float, sort: TeacherMatchingSort)", () => {
    // The shared document IS the production wire surface — its variable
    // definitions are the contract the container compiles against. Walk
    // the TypedDocumentNode's AST (runtime narrowing, no casts) and pin
    // the three optional trio declarations verbatim.
    const operation = browseAvailableTeachersQueryDocument.definitions.find(
      (definition): definition is OperationDefinitionNode => definition.kind === "OperationDefinition"
    );
    if (!operation) {
      throw new Error("expected the BrowseAvailableTeachers operation definition");
    }
    // Walk the TypedDocumentNode's AST (runtime narrowing, no casts) and
    // pin the three optional trio declarations verbatim — via the
    // module-scope `typeText` SDL renderer.
    const declared = new Map(
      (operation.variableDefinitions ?? []).map(variable => [variable.variable.name.value, typeText(variable.type)])
    );
    expect(declared.get("search")).toBe("String");
    expect(declared.get("minRating")).toBe("Float");
    expect(declared.get("sort")).toBe("TeacherMatchingSort");
  });

  test("a minimum-rating floor narrows the seeded pair (the unrated honest null drops out)", async () => {
    // The rated fixture (4.50) clears the 3.0 floor; the unrated one is a
    // NULL rating — the honest SQL >= never admits it, regardless of what
    // else the shared dev database carries.
    const result = await browse(theCast().student.accessToken, RecitationReading.HafsAnAsim, SessionIntent.Hifz, {
      minRating: 3,
    });
    expect(result.error).toBeUndefined();
    const payload = browsePayloadOf(result);
    const [ratedId, unratedId] = eligibleTeacherIds;
    expect(payload.items).toContain(ratedId);
    expect(payload.items).not.toContain(unratedId);
  });

  test("an explicit sort rides the wire (the document forwards the ordering choice)", async () => {
    const result = await browse(theCast().student.accessToken, RecitationReading.HafsAnAsim, SessionIntent.Hifz, {
      sort: TeacherMatchingSort.Newest,
    });
    expect(result.error).toBeUndefined();
    const payload = browsePayloadOf(result);
    // The envelope stays honest under a non-default sort — every seeded
    // eligible teacher still surfaces (NEWEST only reorders, never filters).
    for (const eligibleId of eligibleTeacherIds) {
      expect(payload.items).toContain(eligibleId);
    }
  });

  // ─── Tier 3 — denial matrix ────────────────────────────────────────────

  test("anonymous caller → UNAUTHORIZED (401, never FORBIDDEN)", async () => {
    const result = await browseAnonymous(RecitationReading.HafsAnAsim, SessionIntent.Hifz);
    expect(result.error).toBeDefined();
    expectMutationError(result.error, "UNAUTHORIZED");
  });

  test("TEACHER caller → FORBIDDEN (role gate — the student-only read)", async () => {
    const result = await browse(theCast().teacherActor.accessToken, RecitationReading.HafsAnAsim, SessionIntent.Hifz);
    expect(result.error).toBeDefined();
    expectMutationError(result.error, "FORBIDDEN");
  });

  // ─── Tier 4 — BOPLA wire probe (smuggled identity arg) ─────────────────

  test("smuggled `userId` arg → GRAPHQL_VALIDATION_FAILED (BOLA no-surface proof)", async () => {
    const { accessToken } = theCast().student;
    const result = await testClient.query({
      fetchPolicy: "no-cache",
      query: parse(`
        query SmuggleUserIdOnBrowse($userId: Int!, $intent: SessionIntent!, $recitation: RecitationReading!) {
          browseAvailableTeachers(intent: $intent, page: 1, pageSize: 25, recitation: $recitation, userId: $userId) {
            items {
              id
            }
            total
            page
            pageSize
            pageCount
          }
        }
      `),
      variables: {
        userId: 999_999,
        intent: SessionIntent.Hifz,
        recitation: RecitationReading.HafsAnAsim,
      },
      context: { headers: { Authorization: `Bearer ${accessToken}` } },
    });
    // Unknown argument on Query.browseAvailableTeachers → the request never
    // executes; the resolver NEVER runs.
    expect(result.error).toBeDefined();
    expectMutationError(result.error, "GRAPHQL_VALIDATION_FAILED");
  });
});
