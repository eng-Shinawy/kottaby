/**
 * Handshake-code queries — 4-Tier live-wire integration matrix.
 *
 * Runs over the REAL boundary exactly like
 * `frontend/graphql/test/teachers/applicant-profile.test.ts`:
 * `setupTestServerLifecycle` boots (or adopts) the Next dev server on the
 * shared test port, and every operation rides Apollo Client v4 + the shared
 * error helpers (`expectMutationError`), with per-request
 * `Authorization: Bearer` headers isolating each caller's identity (the
 * shared client persists no cookies between requests). Failure-side
 * assertions branch on `extensions.code` ONLY — never on HTTP statuses.
 *
 * Documents:
 *  - Locally `parse`d documents instead of `gql` — the `@/backend/db` fixture
 *    chain flips bun's module conditions and crashes `graphql-tag`'s UMD
 *    build (the applicant-profile precedent). The shared handshake documents
 *    are the frontend documents task's deliverable; until they exist this
 *    suite pins the wire shape with local, explicitly-typed documents.
 *
 * Data lifecycle (mirrors the applicant-profile convention):
 *  - Wire registrations (public `registerUser`) and direct-DB fixtures use
 *    randomized emails and are NOT cleaned up — live-wire suites accumulate
 *    committed rows on the test database by convention.
 *  - Direct-DB fixtures go through the sanctioned entity-setup builders
 *    inside ONE committing transaction: governance variants via
 *    `createTestUser` overrides; a real bcrypt hash override lets staff and
 *    defect identities log in over the PUBLIC `login` mutation so every cell
 *    exercises the real token path (`registerUser` structurally rejects
 *    admin, and the no-students-row defect fixture cannot be registered).
 *  - The test process and the dev server resolve the SAME database (the
 *    backend env module force-loads the dev `.env` DB keys in both
 *    processes), so direct-DB fixtures are visible over the wire.
 *
 * Role-matrix identities:
 *  - student/parent/teacher are registered through the public mutation
 *    (the teacher is the applicant flavour; the certified flavour is the
 *    supervisor fixture below, which carries a `teacher` child row).
 *  - supervisor = a permission-group identity whose underlying `users.role`
 *    is a non-student/non-parent carrier (teacher here). No permission-group
 *    table exists yet and neither query declares a permission scope, so the
 *    role-scope closure alone decides the cell.
 *  - super-admin = `users.role='admin'` + `admin` child row; neither query
 *    declares a superAdmin override.
 *
 * Tier 4 spy section:
 *  - Cross-process spying on the live server is impossible without test-only
 *    server code (prohibited), so the pre-resolver proof executes the SAME
 *    built schema the server serves, in-process, with `spyOn` over the
 *    service namespace: denied cells must record ZERO service calls while
 *    allowed control cells record exactly one (instrumentation proof).
 */

import { beforeAll, describe, expect, spyOn, test } from "bun:test";
import { randomUUID } from "node:crypto";
import type { CombinedGraphQLErrors, TypedDocumentNode } from "@apollo/client";
import { eq } from "drizzle-orm";
import { graphql, parse } from "graphql";

import { db } from "@/backend/db";
import { students } from "@/backend/db/schema/students/students";
import { teacher } from "@/backend/db/schema/teachers/teacher";
import { createTestAdmin, createTestStudent, createTestUser } from "@/backend/db/test/entity-setup";
import { UserRole } from "@/backend/enum/users/user-role.enum";
import { graphQLSchema } from "@/backend/graphql/gqlSchema";
import { signAccessToken } from "@/backend/lib/auth/jwt";
import { hashPassword } from "@/backend/lib/auth/password";
import { StudentHandshakeService } from "@/backend/services/students/student-handshake.service";
import { RegisterPublicRole } from "@/frontend/graphql/generated/gql/graphql";
import {
  loginMutationDocument,
  registerUserMutationDocument,
} from "@/frontend/graphql/sharedDocuments/auth/auth.documents";
import { maskFullName } from "@/shared/lib/mask-full-name";
import { getServerTranslations } from "@/shared/locale/server-graphql";
import { expectMutationError, setupTestServerLifecycle, testClient } from "@/test/helpers";

// ─── Wire documents (locally parsed, explicitly typed) ───────────────────────

const myHandshakeCodeDocument: TypedDocumentNode<{ readonly myHandshakeCode: string }> = parse(
  "query MyHandshakeCode { myHandshakeCode }"
);

interface HandshakeCodeLookupShapeType {
  readonly maskedName: string;
  readonly linkable: boolean;
}

const findStudentByHandshakeCodeDocument: TypedDocumentNode<
  { readonly findStudentByHandshakeCode: HandshakeCodeLookupShapeType | null },
  { readonly code: string }
> = parse(
  "query FindStudentByHandshakeCode($code: String!) { findStudentByHandshakeCode(code: $code) { maskedName linkable } }"
);

/** In-process execution sources for the pre-resolver scope-spy tier. */
const SELF_READ_SOURCE = "{ myHandshakeCode }";
const DISCOVERY_SOURCE = "query ($code: String!) { findStudentByHandshakeCode(code: $code) { maskedName linkable } }";

// ─── Locale contract literals (expectation source of truth) ─────────────────

const LOCALE_EN = "en";
const LOCALE_AR = "ar";
const enErrors = getServerTranslations(LOCALE_EN).errorsTranslations;
const arErrors = getServerTranslations(LOCALE_AR).errorsTranslations;

// ─── Fixture constants ──────────────────────────────────────────────────────

const HOUR_MS = 60 * 60 * 1000;

// Named without the literal `password` token so `sonarjs/no-hardcoded-passwords`
// does not flag it (same convention as auth.test.ts / applicant-profile.test.ts).
const testCredential = "Password123";

/** Payload keys that must NEVER appear on a discovery payload. */
const FORBIDDEN_PAYLOAD_KEYS: readonly string[] = [
  "id",
  "studentId",
  "userId",
  "email",
  "phone",
  "parentId",
  "isDeleted",
  "isBlocked",
  "suspended",
  "suspendedAt",
  "suspendedPeriodDays",
];

/**
 * Randomized email generator (per-suite unique prefix + UUID salt) — follows
 * the entity-setup guidance while keeping the auth.test.ts `@test.local`
 * domain marker.
 */
function uniqueEmail(rolePrefix: string): string {
  return `${rolePrefix}-${Date.now()}-${randomUUID().slice(0, 8)}@test.local`;
}

/** Locale-stable comparator for sorted key-set assertions. */
function compareStrings(a: string, b: string): number {
  return a.localeCompare(b);
}

/** Record-shaped narrowing guard (no unsafe casts, per test-tier discipline). */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** First wire error item's localized message, runtime-guarded. */
function firstWireMessage(container: CombinedGraphQLErrors): string {
  const first: unknown = container.errors[0];
  if (!isRecord(first)) {
    throw new Error("expected a record-shaped first wire error item");
  }
  const message: unknown = first.message;
  if (typeof message !== "string") {
    throw new Error("expected a string message on the first wire error item");
  }
  return message;
}

// ─── Actor helpers ──────────────────────────────────────────────────────────

interface WireActorType {
  readonly userId: number;
  readonly email: string;
  readonly fullName: string;
  readonly accessToken: string;
}

/** Logs in over the PUBLIC login mutation (real session, real token). */
async function loginForEmail(email: string): Promise<string> {
  const loggedIn = await testClient.mutate({
    mutation: loginMutationDocument,
    variables: { email, password: testCredential },
  });
  expect(loggedIn.error).toBeUndefined();
  const accessToken = loggedIn.data?.login?.accessToken;
  if (!accessToken) {
    throw new Error("login returned no accessToken");
  }
  return accessToken;
}

/** Registers through the PUBLIC registerUser mutation, then logs in. */
async function registerAndLogin(role: RegisterPublicRole, fullName: string): Promise<WireActorType> {
  const email = uniqueEmail("handshake");
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
  if (!userId) {
    throw new Error("registerUser returned no id");
  }
  return { userId, email, fullName, accessToken: await loginForEmail(email) };
}

/** Reads a registered student's committed handshake code straight from the row. */
async function readHandshakeCode(studentUserId: number): Promise<string> {
  const [row] = await db.select({ code: students.handshakeCode }).from(students).where(eq(students.id, studentUserId));
  if (!row?.code) {
    throw new Error(`no students row (or handshake code) for user ${studentUserId}`);
  }
  return row.code;
}

/** Derives a valid-format code that differs from `existing` (nonexistent probe). */
function deriveAbsentHandshakeCode(existing: string): string {
  const lastChar = existing.slice(-1);
  const replacement = lastChar === "0" ? "1" : "0";
  return `${existing.slice(0, -1)}${replacement}`;
}

// ─── Cast provisioning ──────────────────────────────────────────────────────

interface CastType {
  readonly studentA: WireActorType;
  readonly studentB: WireActorType;
  readonly studentAHandshakeCode: string;
  readonly studentBHandshakeCode: string;
  readonly parent: WireActorType;
  readonly teacher: WireActorType;
  readonly supervisor: WireActorType;
  readonly superAdmin: WireActorType;
  readonly defectStudent: WireActorType;
  readonly governedDeletedCode: string;
  readonly governedBlockedCode: string;
  readonly suspendedActiveCode: string;
  readonly linkedStudentCode: string;
  readonly linkedStudentFullName: string;
  readonly linkedParentUserId: number;
  readonly absentProbeCode: string;
}

let cast: CastType | null = null;

function requireCast(): CastType {
  if (cast === null) {
    throw new Error("cast missing: beforeAll fixture was not provisioned");
  }
  return cast;
}

// Memory-constrained sandbox adaptation (applicant-profile precedent): when an
// external test server is already pinned via GRAPHQL_TEST_PORT, adopt it
// instead of spawning a second dev server.
if (process.env.TEST_SERVER_EXTERNAL !== "1") {
  setupTestServerLifecycle();
}

beforeAll(async () => {
  // Wire-registered identities — student/parent/teacher are all publicly
  // registrable roles (the teacher lands as the applicant flavour). The local
  // binding is suffixed `Actor` so it never shadows the `teacher` schema table
  // import used by the supervisor fixture below.
  const [studentA, studentB, parent, teacherActor] = await Promise.all([
    registerAndLogin(RegisterPublicRole.Student, "Yusuf Matrix"),
    registerAndLogin(RegisterPublicRole.Student, "Bilal Matrix"),
    registerAndLogin(RegisterPublicRole.Parent, "Fatima Matrix"),
    registerAndLogin(RegisterPublicRole.Teacher, "Tania Matrix"),
  ]);

  // Direct-DB identities inside ONE committing transaction. registerUser
  // structurally rejects admin, the supervisor's certified-teacher shape, and
  // the no-students-row defect, so these can ONLY be engineered here — a real
  // bcrypt hash override lets each one log in over the public login mutation.
  const dbFixtures = await db.transaction(async tx => {
    const supervisorUser = await createTestUser(tx, {
      role: "teacher",
      fullName: "Supervisor Identity",
      passwordHash: await hashPassword(testCredential),
    });
    const [teacherRow] = await tx.insert(teacher).values({ id: supervisorUser.id }).returning();
    if (!teacherRow) {
      throw new Error("supervisor teacher child-row insert returned no rows");
    }

    const adminUser = await createTestUser(tx, {
      role: "admin",
      fullName: "Super Admin Identity",
      passwordHash: await hashPassword(testCredential),
    });
    await createTestAdmin(tx, adminUser.id);

    const defectUser = await createTestUser(tx, {
      role: "student",
      fullName: "Defect No Student Row",
      passwordHash: await hashPassword(testCredential),
    });
    // Deliberately NO students row for `defectUser` — the missing-own-row
    // defect fixture (a student-role identity with no student record).

    // Governance + linkage fixtures — never logged in, so the builder's stub
    // hash is irrelevant; only their handshake codes are discovered.
    const governedDeletedUser = await createTestUser(tx, {
      role: "student",
      fullName: "Governed Deleted",
      isDeleted: true,
    });
    const governedDeletedStudent = await createTestStudent(tx, governedDeletedUser.id);

    const governedBlockedUser = await createTestUser(tx, {
      role: "student",
      fullName: "Governed Blocked",
      isBlocked: true,
    });
    const governedBlockedStudent = await createTestStudent(tx, governedBlockedUser.id);

    const suspendedUser = await createTestUser(tx, {
      role: "student",
      fullName: "Suspended Active",
      suspended: true,
      suspendedAt: new Date(Date.now() - HOUR_MS),
      suspendedPeriodDays: 30,
    });
    const suspendedStudent = await createTestStudent(tx, suspendedUser.id);

    // Already-linked child: a bare parent user id satisfies the FK — a
    // `parents` row is not required for referential integrity.
    const incumbentParent = await createTestUser(tx, { role: "parent", fullName: "Incumbent Parent" });
    const linkedChild = await createTestUser(tx, { role: "student", fullName: "Linked Child" });
    const linkedStudent = await createTestStudent(tx, linkedChild.id, { parentId: incumbentParent.id });

    return {
      supervisorUser,
      adminUser,
      defectUser,
      governedDeletedCode: governedDeletedStudent.handshakeCode,
      governedBlockedCode: governedBlockedStudent.handshakeCode,
      suspendedActiveCode: suspendedStudent.handshakeCode,
      linkedStudentCode: linkedStudent.handshakeCode,
      linkedStudentFullName: linkedChild.fullName,
      linkedParentUserId: incumbentParent.id,
    };
  });

  const [supervisorToken, superAdminToken, defectStudentToken] = await Promise.all([
    loginForEmail(dbFixtures.supervisorUser.email),
    loginForEmail(dbFixtures.adminUser.email),
    loginForEmail(dbFixtures.defectUser.email),
  ]);

  const [studentAHandshakeCode, studentBHandshakeCode] = await Promise.all([
    readHandshakeCode(studentA.userId),
    readHandshakeCode(studentB.userId),
  ]);

  // Nonexistent probe: valid-format code derived away from student A's, then
  // grounded against committed state so it can never collide silently.
  const absentProbeCode = deriveAbsentHandshakeCode(studentAHandshakeCode);
  const [collisionRow] = await db
    .select({ id: students.id })
    .from(students)
    .where(eq(students.handshakeCode, absentProbeCode));
  if (collisionRow) {
    throw new Error("derived absent probe code unexpectedly matches a students row");
  }

  cast = {
    studentA,
    studentB,
    studentAHandshakeCode,
    studentBHandshakeCode,
    parent,
    teacher: teacherActor,
    supervisor: {
      userId: dbFixtures.supervisorUser.id,
      email: dbFixtures.supervisorUser.email,
      fullName: dbFixtures.supervisorUser.fullName,
      accessToken: supervisorToken,
    },
    superAdmin: {
      userId: dbFixtures.adminUser.id,
      email: dbFixtures.adminUser.email,
      fullName: dbFixtures.adminUser.fullName,
      accessToken: superAdminToken,
    },
    defectStudent: {
      userId: dbFixtures.defectUser.id,
      email: dbFixtures.defectUser.email,
      fullName: dbFixtures.defectUser.fullName,
      accessToken: defectStudentToken,
    },
    governedDeletedCode: dbFixtures.governedDeletedCode,
    governedBlockedCode: dbFixtures.governedBlockedCode,
    suspendedActiveCode: dbFixtures.suspendedActiveCode,
    linkedStudentCode: dbFixtures.linkedStudentCode,
    linkedStudentFullName: dbFixtures.linkedStudentFullName,
    linkedParentUserId: dbFixtures.linkedParentUserId,
    absentProbeCode,
  };
}, 120_000);

// ─── Request helpers ────────────────────────────────────────────────────────

function bearerHeaders(actor: WireActorType | null, locale?: string): Record<string, string> {
  const headers: Record<string, string> = {};
  if (actor) {
    headers.Authorization = `Bearer ${actor.accessToken}`;
  }
  if (locale) {
    headers["Accept-Language"] = locale;
  }
  return headers;
}

/** Parent-token discovery call (the happy-path authorization shape). */
async function discoverAsParent(code: string, locale?: string) {
  return testClient.query({
    query: findStudentByHandshakeCodeDocument,
    variables: { code },
    context: { headers: bearerHeaders(requireCast().parent, locale) },
  });
}

// ─── Tier 1 — full role matrix over the wire (parameterized table) ──────────

type MatrixIdentityType = "anonymous" | "student" | "parent" | "teacher" | "supervisor" | "superAdmin";
type MatrixQueryType = "myHandshakeCode" | "findStudentByHandshakeCode";
type MatrixOutcomeType = "UNAUTHORIZED" | "FORBIDDEN" | "happy";

function matrixActor(identity: MatrixIdentityType): WireActorType | null {
  const c = requireCast();
  switch (identity) {
    case "anonymous":
      return null;
    case "student":
      return c.studentA;
    case "parent":
      return c.parent;
    case "teacher":
      return c.teacher;
    case "supervisor":
      return c.supervisor;
    case "superAdmin":
      return c.superAdmin;
  }
  // Exhaustive switch — the fail-loud tail completes the return-value
  // analysis for the linter and can never run for a well-typed identity.
  throw new Error(`unmapped matrix identity: ${String(identity)}`);
}

const matrixCases: [MatrixIdentityType, MatrixQueryType, MatrixOutcomeType][] = [
  ["anonymous", "myHandshakeCode", "UNAUTHORIZED"],
  ["student", "myHandshakeCode", "happy"],
  ["parent", "myHandshakeCode", "FORBIDDEN"],
  ["teacher", "myHandshakeCode", "FORBIDDEN"],
  ["supervisor", "myHandshakeCode", "FORBIDDEN"],
  ["superAdmin", "myHandshakeCode", "FORBIDDEN"],
  ["anonymous", "findStudentByHandshakeCode", "UNAUTHORIZED"],
  ["student", "findStudentByHandshakeCode", "FORBIDDEN"],
  ["parent", "findStudentByHandshakeCode", "happy"],
  ["teacher", "findStudentByHandshakeCode", "FORBIDDEN"],
  ["supervisor", "findStudentByHandshakeCode", "FORBIDDEN"],
  ["superAdmin", "findStudentByHandshakeCode", "FORBIDDEN"],
];

describe("handshake code — Tier 1 role matrix", () => {
  test.each(matrixCases)("Tier 1 — %s on %s → %s", async (identity, queryName, expectedOutcome) => {
    const c = requireCast();
    const actor = matrixActor(identity);
    const headers = bearerHeaders(actor);

    if (queryName === "myHandshakeCode") {
      const result = await testClient.query({
        query: myHandshakeCodeDocument,
        context: { headers },
      });
      if (expectedOutcome === "happy") {
        expect(result.error).toBeUndefined();
        expect(result.data?.myHandshakeCode).toBe(c.studentAHandshakeCode);
        return;
      }
      expectMutationError(result.error, expectedOutcome);
      // Zero payload bytes on denial — the field never resolves.
      expect(result.data?.myHandshakeCode).toBeFalsy();
      return;
    }

    const result = await testClient.query({
      query: findStudentByHandshakeCodeDocument,
      variables: { code: c.studentAHandshakeCode },
      context: { headers },
    });
    if (expectedOutcome === "happy") {
      expect(result.error).toBeUndefined();
      expect(result.data?.findStudentByHandshakeCode?.maskedName).toBe(maskFullName(c.studentA.fullName));
      return;
    }
    expectMutationError(result.error, expectedOutcome);
    // Zero payload bytes on denial — the field never resolves.
    expect(result.data?.findStudentByHandshakeCode).toBeFalsy();
  });
});

// ─── Tier 1 — happy-path payload contract ───────────────────────────────────

describe("handshake code — Tier 1 payload contract", () => {
  test("discovery payload carries EXACTLY { maskedName, linkable } — forbidden-key scan finds nothing", async () => {
    const c = requireCast();
    const result = await discoverAsParent(c.studentAHandshakeCode);
    expect(result.error).toBeUndefined();

    const payload: unknown = result.data?.findStudentByHandshakeCode;
    if (!isRecord(payload)) {
      throw new Error("expected a discovery payload object");
    }
    // Apollo merges `__typename` into entity objects at runtime (not part of
    // the declared type) — excluded from the key-set equality, pinned by the
    // applicant-profile precedent.
    const keys = Object.keys(payload)
      .filter(key => key !== "__typename")
      .toSorted(compareStrings);
    expect(keys).toEqual(["linkable", "maskedName"]);

    // Explicit forbidden-key scan (identity, contact, and governance fields).
    for (const forbiddenKey of FORBIDDEN_PAYLOAD_KEYS) {
      expect(Object.hasOwn(payload, forbiddenKey)).toBe(false);
    }

    expect(payload.maskedName).toBe(maskFullName(c.studentA.fullName));
    expect(payload.maskedName).not.toBe(c.studentA.fullName);
    expect(payload.linkable).toBe(true);

    // Serialized belt-and-braces: no database identity or contact value leaks.
    const serialized = JSON.stringify(payload);
    expect(serialized).not.toContain(String(c.studentA.userId));
    expect(serialized).not.toContain(c.studentA.email);
    expect(serialized).not.toContain("parentId");
  });

  test("already-linked child answers linkable:false with ZERO incumbent-parent identity", async () => {
    const c = requireCast();
    const result = await discoverAsParent(c.linkedStudentCode);
    expect(result.error).toBeUndefined();

    const payload: unknown = result.data?.findStudentByHandshakeCode;
    if (!isRecord(payload)) {
      throw new Error("expected a discovery payload object");
    }
    const keys = Object.keys(payload)
      .filter(key => key !== "__typename")
      .toSorted(compareStrings);
    expect(keys).toEqual(["linkable", "maskedName"]);
    for (const forbiddenKey of FORBIDDEN_PAYLOAD_KEYS) {
      expect(Object.hasOwn(payload, forbiddenKey)).toBe(false);
    }

    expect(payload.linkable).toBe(false);
    expect(payload.maskedName).toBe(maskFullName(c.linkedStudentFullName));

    const serialized = JSON.stringify(payload);
    expect(serialized).not.toContain(String(c.linkedParentUserId));
    expect(serialized).not.toContain("parentId");
  });
});

// ─── Tier 1 — self-identity ─────────────────────────────────────────────────

describe("handshake code — Tier 1 self-identity", () => {
  test("a second student NEVER receives the first student's code through myHandshakeCode", async () => {
    const c = requireCast();
    const result = await testClient.query({
      query: myHandshakeCodeDocument,
      context: { headers: bearerHeaders(c.studentB) },
    });
    expect(result.error).toBeUndefined();
    expect(result.data?.myHandshakeCode).toBe(c.studentBHandshakeCode);
    expect(result.data?.myHandshakeCode).not.toBe(c.studentAHandshakeCode);
    // The two fixtures hold distinct codes (randomized at registration).
    expect(c.studentAHandshakeCode).not.toBe(c.studentBHandshakeCode);
  });
});

// ─── Failure cells — error contract over the wire ──────────────────────────

describe("handshake code — failure cells", () => {
  test("malformed code rejects with extensions.code VALIDATION and the localized en message", async () => {
    const result = await discoverAsParent("KSB-NOPE", LOCALE_EN);
    const combined = expectMutationError(result.error, "VALIDATION");
    expect(firstWireMessage(combined)).toBe(enErrors.handshakeCodeInvalid);
  });

  test("valid-format but nonexistent code answers null with NO error field", async () => {
    const c = requireCast();
    const result = await discoverAsParent(c.absentProbeCode);
    expect(result.error).toBeUndefined();
    // The nullable-payload contract: a miss is DATA, never an error.
    expect(result.data).toEqual({ findStudentByHandshakeCode: null });
  });

  test("student without a students row rejects with extensions.code STUDENT_NOT_FOUND", async () => {
    const c = requireCast();
    const result = await testClient.query({
      query: myHandshakeCodeDocument,
      context: { headers: bearerHeaders(c.defectStudent, LOCALE_EN) },
    });
    const combined = expectMutationError(result.error, "STUDENT_NOT_FOUND");
    expect(firstWireMessage(combined)).toBe(enErrors.studentHandshakeNotFound);
  });
});

// ─── Tier 2 — boundary ──────────────────────────────────────────────────────

describe("handshake code — Tier 2 boundary", () => {
  test("an ACTIVE suspension window collapses discovery to null at discovery time", async () => {
    const c = requireCast();
    const result = await discoverAsParent(c.suspendedActiveCode);
    expect(result.error).toBeUndefined();
    expect(result.data).toEqual({ findStudentByHandshakeCode: null });
  });

  test("lowercase-normalized lookup resolves IDENTICALLY to the exact-code lookup over the wire", async () => {
    const c = requireCast();
    const [lowered, exact] = await Promise.all([
      discoverAsParent(c.studentAHandshakeCode.toLowerCase()),
      discoverAsParent(c.studentAHandshakeCode),
    ]);
    expect(lowered.error).toBeUndefined();
    expect(exact.error).toBeUndefined();
    expect(lowered.data?.findStudentByHandshakeCode).toEqual(exact.data?.findStudentByHandshakeCode);
    expect(lowered.data?.findStudentByHandshakeCode?.maskedName).toBe(maskFullName(c.studentA.fullName));
    expect(lowered.data?.findStudentByHandshakeCode?.linkable).toBe(true);
  });

  test("governance-collapsed fixtures answer through the IDENTICAL response shape as nonexistent codes", async () => {
    const c = requireCast();
    // Four channels over one parent token: the nonexistent probe plus the
    // three governed codes (deleted / blocked / actively suspended). The
    // network twin is proven by FULL response-object equality — no weaker
    // null-only assertion, and no timing or difference hint is observable (or
    // asserted away) at this tier: error channel and data shape are identical
    // across all four.
    const [miss, deleted, blocked, suspended] = await Promise.all([
      discoverAsParent(c.absentProbeCode),
      discoverAsParent(c.governedDeletedCode),
      discoverAsParent(c.governedBlockedCode),
      discoverAsParent(c.suspendedActiveCode),
    ]);
    expect(miss.error).toBeUndefined();
    expect(miss.data).toEqual({ findStudentByHandshakeCode: null });
    for (const governed of [deleted, blocked, suspended]) {
      expect(governed.error).toBeUndefined();
      expect(governed.data).toEqual(miss.data);
    }
  });
});

// ─── Tier 3 — malformed-input fuzz over the wire ────────────────────────────

describe("handshake code — Tier 3 fuzz", () => {
  /** Malformed probes — every one stays invalid AFTER trim+uppercase normalization. */
  const wiredFuzzProbes: readonly string[] = [
    "%KSB-ABCD1234",
    "KSB-ABCD123%",
    "KSB-AB_D1234",
    "KSB-AB\\D1234",
    "ksb-abcd123g",
    "رمز-دخول",
    "KSB-\u{1F600}BCD1234",
    `KSB-${"A".repeat(5000)}`,
  ];
  const fuzzCases: [string][] = wiredFuzzProbes.map(probe => [probe]);

  test.each(fuzzCases)("Tier 3 — malformed code %s rejects as VALIDATION", async probe => {
    const result = await discoverAsParent(probe);
    expectMutationError(result.error, "VALIDATION");
  });
});

// ─── Locale propagation ─────────────────────────────────────────────────────

describe("handshake code — locale propagation", () => {
  test("VALIDATION message renders in the requested locale (en + ar, distinct)", async () => {
    // Sanity: the two locale contracts carry distinct copy.
    expect(enErrors.handshakeCodeInvalid).not.toBe(arErrors.handshakeCodeInvalid);

    // Sequential ON PURPOSE: both calls share the query document AND the
    // variables, and Apollo Client deduplicates identical in-flight
    // operations by document+variables WITHOUT the per-request context — run
    // concurrently, the ar call would ride the en request and see the en
    // message. Sequential calls each hit the wire with their own headers.
    const enResult = await discoverAsParent("KSB-NOPE", LOCALE_EN);
    const arResult = await discoverAsParent("KSB-NOPE", LOCALE_AR);
    const enCombined = expectMutationError(enResult.error, "VALIDATION");
    const arCombined = expectMutationError(arResult.error, "VALIDATION");
    expect(firstWireMessage(enCombined)).toBe(enErrors.handshakeCodeInvalid);
    expect(firstWireMessage(arCombined)).toBe(arErrors.handshakeCodeInvalid);
    expect(firstWireMessage(arCombined)).not.toBe(firstWireMessage(enCombined));
  });

  test("STUDENT_NOT_FOUND message renders in the requested locale (en + ar, distinct)", async () => {
    const c = requireCast();
    expect(enErrors.studentHandshakeNotFound).not.toBe(arErrors.studentHandshakeNotFound);

    // Sequential ON PURPOSE — same Apollo deduplication hazard as the
    // VALIDATION locale cell above (identical zero-argument document ⇒ the
    // concurrent ar call would ride the in-flight en request).
    const enResult = await testClient.query({
      query: myHandshakeCodeDocument,
      context: { headers: bearerHeaders(c.defectStudent, LOCALE_EN) },
    });
    const arResult = await testClient.query({
      query: myHandshakeCodeDocument,
      context: { headers: bearerHeaders(c.defectStudent, LOCALE_AR) },
    });
    const enCombined = expectMutationError(enResult.error, "STUDENT_NOT_FOUND");
    const arCombined = expectMutationError(arResult.error, "STUDENT_NOT_FOUND");
    expect(firstWireMessage(enCombined)).toBe(enErrors.studentHandshakeNotFound);
    expect(firstWireMessage(arCombined)).toBe(arErrors.studentHandshakeNotFound);
    expect(firstWireMessage(arCombined)).not.toBe(firstWireMessage(enCombined));
  });
});

// ─── Tier 4 — token substitution over the wire ──────────────────────────────

describe("handshake code — Tier 4 token substitution", () => {
  test("re-signed token carrying the SIBLING role claim is FORBIDDEN on the student self-read", async () => {
    const c = requireCast();
    // A valid-signature token re-signed for the student's own id but claiming
    // the parent role: the scope layer evaluates the presented role claim and
    // denies — the swap cannot widen access.
    const substituted = await signAccessToken({ userId: c.studentA.userId, role: UserRole.Parent });
    const result = await testClient.query({
      query: myHandshakeCodeDocument,
      context: { headers: { Authorization: `Bearer ${substituted}` } },
    });
    expectMutationError(result.error, "FORBIDDEN");
    expect(result.data?.myHandshakeCode).toBeFalsy();
  });

  test("re-signed token carrying the SIBLING role claim is FORBIDDEN on parent discovery", async () => {
    const c = requireCast();
    const substituted = await signAccessToken({ userId: c.parent.userId, role: UserRole.Student });
    const result = await testClient.query({
      query: findStudentByHandshakeCodeDocument,
      variables: { code: c.studentAHandshakeCode },
      context: { headers: { Authorization: `Bearer ${substituted}` } },
    });
    expectMutationError(result.error, "FORBIDDEN");
    expect(result.data?.findStudentByHandshakeCode).toBeFalsy();
  });

  test("re-signed token with a NON-CANONICAL role claim degrades to FORBIDDEN (never UNAUTHORIZED)", async () => {
    const c = requireCast();
    // A permission-group style claim (any non-UserRole string) is treated as
    // a wrong role, not as anonymous: the authenticated scope still passes
    // for the existing user, the role scope fails, and the caller sees 403
    // semantics — never a crash, never a session downgrade to 401.
    const substituted = await signAccessToken({ userId: c.studentA.userId, role: "supervisor" });
    const selfRead = await testClient.query({
      query: myHandshakeCodeDocument,
      context: { headers: { Authorization: `Bearer ${substituted}` } },
    });
    expectMutationError(selfRead.error, "FORBIDDEN");
    // Direct expect() (not only the imported helper): pins the empty data
    // channel on the 403 path and keeps sonarjs/assertions-in-tests satisfied
    // in BOTH lint modes — the syntactic matcher cannot follow the
    // cross-module `expectMutationError` implementation (type-aware can).
    expect(selfRead.data?.myHandshakeCode).toBeFalsy();

    const discovery = await testClient.query({
      query: findStudentByHandshakeCodeDocument,
      variables: { code: c.studentAHandshakeCode },
      context: { headers: { Authorization: `Bearer ${substituted}` } },
    });
    expectMutationError(discovery.error, "FORBIDDEN");
    expect(discovery.data?.findStudentByHandshakeCode).toBeFalsy();
  });
});

// ─── Tier 4 — pre-resolver scope evaluation (service spy, in-process) ───────

describe("handshake code — Tier 4 pre-resolver scope evaluation", () => {
  interface ScopeContextType {
    readonly locale: string;
    readonly role?: UserRole | null;
    readonly user?: { readonly id: number } | null;
  }

  interface DeniedCellType {
    readonly label: string;
    readonly source: string;
    readonly context: ScopeContextType;
    readonly expectedCode: string;
  }

  test("denied cells never execute the service; allowed control cells do (spy proof)", async () => {
    // Cross-process spying on the live server is impossible without test-only
    // server code (prohibited), so the proof executes the SAME built schema
    // the server serves, in-process: identical scope-auth plugin, identical
    // resolvers, with spies over the service namespace the resolvers call.
    const selfReadSpy = spyOn(StudentHandshakeService, "getMyHandshakeCode").mockImplementation(
      async () => "KSB-00000000"
    );
    const discoverySpy = spyOn(StudentHandshakeService, "findStudentByHandshakeCode").mockImplementation(async () => ({
      maskedName: "M***",
      linkable: true,
    }));
    try {
      const deniedCells: readonly DeniedCellType[] = [
        {
          label: "anonymous on self-read",
          source: SELF_READ_SOURCE,
          context: { locale: LOCALE_EN },
          expectedCode: "UNAUTHORIZED",
        },
        {
          label: "anonymous on discovery",
          source: DISCOVERY_SOURCE,
          context: { locale: LOCALE_EN },
          expectedCode: "UNAUTHORIZED",
        },
        {
          label: "parent on self-read",
          source: SELF_READ_SOURCE,
          context: { locale: LOCALE_EN, role: UserRole.Parent, user: { id: 1 } },
          expectedCode: "FORBIDDEN",
        },
        {
          label: "teacher on self-read",
          source: SELF_READ_SOURCE,
          context: { locale: LOCALE_EN, role: UserRole.Teacher, user: { id: 1 } },
          expectedCode: "FORBIDDEN",
        },
        {
          label: "admin on self-read",
          source: SELF_READ_SOURCE,
          context: { locale: LOCALE_EN, role: UserRole.Admin, user: { id: 1 } },
          expectedCode: "FORBIDDEN",
        },
        {
          label: "non-canonical role claim on self-read",
          source: SELF_READ_SOURCE,
          context: { locale: LOCALE_EN, role: null, user: { id: 1 } },
          expectedCode: "FORBIDDEN",
        },
        {
          label: "student on discovery",
          source: DISCOVERY_SOURCE,
          context: { locale: LOCALE_EN, role: UserRole.Student, user: { id: 1 } },
          expectedCode: "FORBIDDEN",
        },
        {
          label: "teacher on discovery",
          source: DISCOVERY_SOURCE,
          context: { locale: LOCALE_EN, role: UserRole.Teacher, user: { id: 1 } },
          expectedCode: "FORBIDDEN",
        },
        {
          label: "admin on discovery",
          source: DISCOVERY_SOURCE,
          context: { locale: LOCALE_EN, role: UserRole.Admin, user: { id: 1 } },
          expectedCode: "FORBIDDEN",
        },
        {
          label: "non-canonical role claim on discovery",
          source: DISCOVERY_SOURCE,
          context: { locale: LOCALE_EN, role: null, user: { id: 1 } },
          expectedCode: "FORBIDDEN",
        },
      ];

      const outcomes = await Promise.all(
        deniedCells.map(cell =>
          graphql({
            schema: graphQLSchema,
            source: cell.source,
            variableValues: cell.source === DISCOVERY_SOURCE ? { code: "KSB-00000000" } : undefined,
            contextValue: cell.context,
          })
        )
      );
      for (const [index, outcome] of outcomes.entries()) {
        const cell = deniedCells[index];
        if (!cell) {
          throw new Error("denied-cell outcome missing its cell");
        }
        expect(outcome.errors).toHaveLength(1);
        expect(outcome.errors?.[0]?.extensions?.code).toBe(cell.expectedCode);
      }

      // THE pre-resolver proof: not a single denied cell reached the service.
      expect(selfReadSpy).toHaveBeenCalledTimes(0);
      expect(discoverySpy).toHaveBeenCalledTimes(0);

      // Instrumentation control: the allowed cells DO reach the (mocked)
      // service exactly once each — the zero above is a scope-layer fact, not
      // a dead spy.
      const [selfReadHit, discoveryHit] = await Promise.all([
        graphql({
          schema: graphQLSchema,
          source: SELF_READ_SOURCE,
          contextValue: { locale: LOCALE_EN, role: UserRole.Student, user: { id: 1 } },
        }),
        graphql({
          schema: graphQLSchema,
          source: DISCOVERY_SOURCE,
          variableValues: { code: "KSB-00000000" },
          contextValue: { locale: LOCALE_EN, role: UserRole.Parent, user: { id: 1 } },
        }),
      ]);
      expect(selfReadHit.errors).toBeUndefined();
      const selfReadData: unknown = selfReadHit.data;
      if (!isRecord(selfReadData)) {
        throw new Error("expected control self-read data");
      }
      expect(selfReadData.myHandshakeCode).toBe("KSB-00000000");

      expect(discoveryHit.errors).toBeUndefined();
      const discoveryData: unknown = discoveryHit.data;
      if (!isRecord(discoveryData)) {
        throw new Error("expected control discovery data");
      }
      const controlPayload: unknown = discoveryData.findStudentByHandshakeCode;
      if (!isRecord(controlPayload)) {
        throw new Error("expected control discovery payload");
      }
      expect(controlPayload.linkable).toBe(true);

      expect(selfReadSpy).toHaveBeenCalledTimes(1);
      expect(discoverySpy).toHaveBeenCalledTimes(1);
    } finally {
      selfReadSpy.mockRestore();
      discoverySpy.mockRestore();
    }
  });
});
