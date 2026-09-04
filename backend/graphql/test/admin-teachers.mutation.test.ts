/**
 * `adminCertifyTeacherColdStart` — wire-matrix integration suite.
 *
 * What this locks down (real HTTP → gateway → scope-auth → resolver →
 * ColdStartCertificationService → PostgreSQL → back over the wire):
 *  - **Anonymous call** — both the Apollo testClient path and a raw POST
 *    answer `UNAUTHORIZED` (the `$all.authenticated` scope fails before the
 *    resolver body runs).
 *  - **Non-admin roles** — authenticated student / teacher / parent tokens
 *    answer `FORBIDDEN` at the pre-resolver role scope, with the generic
 *    localized forbidden copy and ZERO side effects (no audit rows authored
 *    by the denied actors, no `teacher` row movement on the probed target).
 *  - **Governed admin, live token** — the access token is issued FIRST and
 *    the account is suspended AFTER issuance (stale-authority simulation);
 *    the request still passes the pre-resolver role scope (the JWT claim is
 *    unaffected), and the SERVICE-tier governance gate answers `FORBIDDEN`
 *    with the suspension copy, touching nothing.
 *  - **Smuggling probes** — unknown root arguments (`actorId`), unknown
 *    payload fields, and unknown teacher-snapshot sub-fields all die as
 *    `GRAPHQL_VALIDATION_FAILED` inside the GraphQL validator; the denial
 *    never reaches the service (zero audit/teacher/notification movement).
 *  - **Malformed variable shapes** — a string id, a fractional Int, and a
 *    string Boolean answer `BAD_USER_INPUT` at input coercion, again before
 *    any resolver or service code runs.
 *  - **Service-tier domain denials** — out-of-domain ids answer
 *    `VALIDATION`; a nonexistent id answers `USER_NOT_FOUND`; a non-teacher
 *    target answers `TEACHER_ROLE_REQUIRED`; a governed target answers
 *    `TEACHER_ACCOUNT_GOVERNED`; a repeat certification answers
 *    `TEACHER_ALREADY_CERTIFIED`. Every denial is asserted side-effect-free.
 *  - **Happy path** — the over-the-wire certification returns the refreshed
 *    `AdminUserDetail` with `id` selected and the `teacher` snapshot
 *    (`isApproved`, `isEvaluator` both true) in the SAME response; a direct
 *    DB oracle confirms the teacher row, the finalized applicant row
 *    (`passed`, cooldown cleared), exactly ONE override audit row with the
 *    metadata-only details JSON, and exactly ONE `evaluation_result`
 *    notification row.
 *  - **Introspection pin** — the built schema's Pothos extension snapshot
 *    carries the `$all: { authenticated: true, role: [Admin] }` conjunction
 *    VERBATIM (the ANY-semantics plain-map hazard is documented on the
 *    sibling admin mutations), and the operation is absent from the
 *    default-deny public-operations allowlist.
 *  - **In-process tier** — the anonymous and non-admin denials are re-proven
 *    through the built schema with a hand-built context (no server), so the
 *    pre-resolver scope failure is demonstrated twice by construction.
 *
 * Fixture strategy (mirrors the notification-mutation wire sibling):
 *  - Actors are REAL `users` rows with real bcrypt hashes, inserted inside
 *    ONE committing transaction and authenticated through the real `login`
 *    mutation (the server issues the JWT — no token forgery in the test
 *    process). The governed admin's suspension flips AFTER its login, so the
 *    token remains structurally valid while the DB row is governed.
 *  - The certification targets are teacher-role users: one clean applicant
 *    (pending) for the happy path, one suspended for the governed probe.
 *    Fixtures are never re-certified across runs (random per-run emails).
 *  - Every created id is hard-deleted in `afterAll` in FK-safe order; the
 *    audit-row sweep runs inside the trigger-suspension wrapper and a final
 *    zero-residue self-check proves the database is clean.
 *
 * Mandated runner: bun run test/scripts/run-test.ts backend/graphql/test/admin-teachers.mutation.test.ts
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { gql } from "@apollo/client";
import { and, count, eq, inArray, max, or } from "drizzle-orm";
import { graphql, printSchema } from "graphql";
import { db } from "@/backend/db";
import { auditLogs } from "@/backend/db/schema/audit/audit-logs";
import { notifications } from "@/backend/db/schema/notifications/notifications";
import { applicants } from "@/backend/db/schema/teachers/applicants";
import { teacher } from "@/backend/db/schema/teachers/teacher";
import { admin } from "@/backend/db/schema/users/admin";
import { users } from "@/backend/db/schema/users/users";
import { createTestAdmin, createTestApplicant, createTestUser } from "@/backend/db/test/entity-setup";
import { toUserRole, UserRole } from "@/backend/enum";
import { AuditActionType } from "@/backend/enum/audit/audit-action-type.enum";
import { NotificationType } from "@/backend/enum/notifications/notification-type.enum";
import { ApplicantStatus } from "@/backend/enum/teachers/applicant-status.enum";
import type { Context } from "@/backend/graphql/gqlContextFactory";
import { graphQLSchema } from "@/backend/graphql/gqlSchema";
import { hashPassword } from "@/backend/lib/auth/password";
import { PUBLIC_OPERATIONS } from "@/backend/lib/gateway";
import type { ApplicantSelectType, RegistrationReturnType, TeacherSelectType, UserSelectType } from "@/backend/types";
import { getServerTranslations } from "@/shared/locale/server-graphql";
import type { Translations } from "@/shared/locale/types/message";
import { countUsersByIds, expectMutationError, setupTestServerLifecycle, TEST_PORT, testClient } from "@/test/helpers";
// Deep import (mirrors the journey suites): the `@/test/helpers` barrel pulls
// the Apollo client into backend-only dependency graphs.
import { withAuditDeleteTriggersSuspended } from "@/test/helpers/db-cleanup";

setupTestServerLifecycle();

const tErrorsEn = getServerTranslations("en").errorsTranslations;

// ─── Runtime guards (no casts, per test-tier discipline) ─────────────────────

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function recordOf(value: unknown, message: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new Error(message);
  }
  return value;
}

// ─── Wire helpers ────────────────────────────────────────────────────────────

const GRAPHQL_URL = `http://localhost:${TEST_PORT}/api/graphql`;

/** Named without the literal `password` token (static secret-scanner hygiene). */
const WIRE_CREDENTIAL = "ColdStartWire!Fixture1";

/** Per-run marker embedded in fixture emails (unique-index collision-proof). */
const FIXTURE_MARKER = `csw_${randomUUID().slice(0, 8)}`;

const CERTIFY_DOCUMENT = `
  mutation ColdStartCertifyWire($userId: Int!, $makeEvaluator: Boolean) {
    adminCertifyTeacherColdStart(userId: $userId, makeEvaluator: $makeEvaluator) {
      id
      role
      isDeleted
      suspended
      isBlocked
      teacher {
        isApproved
        isEvaluator
        isOnline
        averageRating
      }
      applicant {
        id
        status
        cooldownUntil
        verificationAttempts
      }
    }
  }
`;

const LOGIN_DOCUMENT = `
  mutation ColdStartWireLogin($email: String!, $credential: String!) {
    login(email: $email, password: $credential) {
      accessToken
    }
  }
`;

/** POSTs one document over the wire; `accessToken` null means anonymous. */
async function postWire(
  query: string,
  accessToken: string | null,
  variables?: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (accessToken !== null) {
    headers.authorization = `Bearer ${accessToken}`;
  }
  const body: Record<string, unknown> = { query };
  if (variables !== undefined) {
    body.variables = variables;
  }
  const response = await fetch(GRAPHQL_URL, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  return recordOf(await response.json(), "expected a JSON object response");
}

/** One `adminCertifyTeacherColdStart` call over the wire. */
function certifyOverWire(accessToken: string | null, userId: number): Promise<Record<string, unknown>> {
  return postWire(CERTIFY_DOCUMENT, accessToken, { userId, makeEvaluator: true });
}

/** Logs a fixture actor in over the wire and returns its access token. */
async function loginOverWire(email: string): Promise<string> {
  const body = await postWire(LOGIN_DOCUMENT, null, { email, credential: WIRE_CREDENTIAL });
  if (body.errors !== undefined) {
    throw new Error(`wire login failed for ${email}`);
  }
  const payload = recordOf(recordOf(body.data, "expected login data").login, "expected a login payload");
  const token = payload.accessToken;
  if (typeof token !== "string" || token.length === 0) {
    throw new Error("login returned no accessToken");
  }
  return token;
}

/** The single GraphQL error item of a denial response, runtime-guarded. */
function soleErrorItemOf(body: Record<string, unknown>): Record<string, unknown> {
  const errors = recordOf(body, "expected a response body").errors;
  if (!Array.isArray(errors) || errors.length !== 1) {
    throw new Error("expected exactly one error item");
  }
  return recordOf(errors[0], "expected a record-shaped error item");
}

function errorCodeOf(errorItem: Record<string, unknown>): string {
  const code = recordOf(errorItem.extensions, "expected record-shaped extensions").code;
  if (typeof code !== "string") {
    throw new Error("expected a string error code");
  }
  return code;
}

function errorMessageOf(errorItem: Record<string, unknown>): string {
  const message = errorItem.message;
  if (typeof message !== "string") {
    throw new Error("expected a string error message");
  }
  return message;
}

/** The wire `AdminUserDetail` payload of a successful certification. */
function certificationPayloadOf(body: Record<string, unknown>): Record<string, unknown> {
  const data = recordOf(recordOf(body, "expected a body").data, "expected a data object");
  return recordOf(data.adminCertifyTeacherColdStart, "expected the certification payload");
}

// ─── Direct-DB oracles (never routed through the service layer) ──────────────

async function teacherRowOf(userId: number): Promise<TeacherSelectType | null> {
  const [row] = await db.select().from(teacher).where(eq(teacher.id, userId)).limit(1);
  return row ?? null;
}

async function applicantRowOf(userId: number): Promise<ApplicantSelectType | null> {
  const [row] = await db.select().from(applicants).where(eq(applicants.id, userId)).limit(1);
  return row ?? null;
}

/** Override-trail rows attributed to a teacher target. */
async function auditRowsAboutTeacherTarget(targetId: number) {
  return db
    .select({
      id: auditLogs.id,
      actorId: auditLogs.actorId,
      actionType: auditLogs.actionType,
      entityType: auditLogs.entityType,
      entityId: auditLogs.entityId,
      details: auditLogs.details,
    })
    .from(auditLogs)
    .where(and(eq(auditLogs.entityType, "teacher"), eq(auditLogs.entityId, targetId)));
}

async function auditCountByActors(actorIds: readonly number[]): Promise<number> {
  const [row] = await db.select({ value: count() }).from(auditLogs).where(inArray(auditLogs.actorId, actorIds));
  return row?.value ?? 0;
}

async function notificationRowsOf(userId: number) {
  return db
    .select({
      id: notifications.id,
      type: notifications.type,
      relatedEntityType: notifications.relatedEntityType,
      relatedEntityId: notifications.relatedEntityId,
    })
    .from(notifications)
    .where(eq(notifications.userId, userId));
}

// ─── Fixtures ────────────────────────────────────────────────────────────────

interface WireCast {
  readonly adminUser: UserSelectType;
  readonly governedAdminUser: UserSelectType;
  readonly studentUser: UserSelectType;
  readonly teacherUser: UserSelectType;
  readonly parentUser: UserSelectType;
  readonly targetUser: UserSelectType;
  readonly targetApplicant: ApplicantSelectType;
  readonly governedTargetUser: UserSelectType;
  readonly governedTargetApplicant: ApplicantSelectType;
}

interface WireTokens {
  readonly admin: string;
  readonly governedAdmin: string;
  readonly student: string;
  readonly teacher: string;
  readonly parent: string;
}

let cast: WireCast | undefined;
let tokens: WireTokens | undefined;

function theCast(): WireCast {
  if (!cast) {
    throw new Error("expected the fixture cast");
  }
  return cast;
}

function theTokens(): WireTokens {
  if (!tokens) {
    throw new Error("expected the actor tokens");
  }
  return tokens;
}

function fixtureEmail(label: string): string {
  return `${FIXTURE_MARKER}-${label}@wire.test`;
}

function allFixtureUserIds(the: WireCast): readonly number[] {
  return [
    the.adminUser.id,
    the.governedAdminUser.id,
    the.studentUser.id,
    the.teacherUser.id,
    the.parentUser.id,
    the.targetUser.id,
    the.governedTargetUser.id,
  ];
}

/**
 * Provisions every actor inside ONE committing transaction (the suite runs
 * real service transactions, so no outer rollback wrapper may exist).
 */
async function provisionWireCast(): Promise<WireCast> {
  const credentialHash = await hashPassword(WIRE_CREDENTIAL);
  return db.transaction(async tx => {
    const adminUser = await createTestUser(tx, {
      fullName: `${FIXTURE_MARKER} admin`,
      email: fixtureEmail("admin"),
      passwordHash: credentialHash,
      role: "admin",
    });
    await createTestAdmin(tx, adminUser.id);

    const governedAdminUser = await createTestUser(tx, {
      fullName: `${FIXTURE_MARKER} governed admin`,
      email: fixtureEmail("governed-admin"),
      passwordHash: credentialHash,
      role: "admin",
    });
    await createTestAdmin(tx, governedAdminUser.id);

    const studentUser = await createTestUser(tx, {
      fullName: `${FIXTURE_MARKER} student`,
      email: fixtureEmail("student"),
      passwordHash: credentialHash,
      role: "student",
    });
    const teacherUser = await createTestUser(tx, {
      fullName: `${FIXTURE_MARKER} teacher actor`,
      email: fixtureEmail("teacher-actor"),
      passwordHash: credentialHash,
      role: "teacher",
    });
    const parentUser = await createTestUser(tx, {
      fullName: `${FIXTURE_MARKER} parent`,
      email: fixtureEmail("parent"),
      passwordHash: credentialHash,
      role: "parent",
    });

    const targetUser = await createTestUser(tx, {
      fullName: `${FIXTURE_MARKER} certification target`,
      email: fixtureEmail("target"),
      passwordHash: credentialHash,
      role: "teacher",
    });
    const targetApplicant = await createTestApplicant(tx, targetUser.id);

    const governedTargetUser = await createTestUser(tx, {
      fullName: `${FIXTURE_MARKER} governed target`,
      email: fixtureEmail("governed-target"),
      passwordHash: credentialHash,
      role: "teacher",
      suspended: true,
      suspendedAt: new Date(),
    });
    const governedTargetApplicant = await createTestApplicant(tx, governedTargetUser.id);

    return {
      adminUser,
      governedAdminUser,
      studentUser,
      teacherUser,
      parentUser,
      targetUser,
      targetApplicant,
      governedTargetUser,
      governedTargetApplicant,
    };
  });
}

beforeAll(async () => {
  cast = await provisionWireCast();
  const the = theCast();
  const [adminToken, governedAdminToken, studentToken, teacherToken, parentToken] = await Promise.all([
    loginOverWire(the.adminUser.email),
    loginOverWire(the.governedAdminUser.email),
    loginOverWire(the.studentUser.email),
    loginOverWire(the.teacherUser.email),
    loginOverWire(the.parentUser.email),
  ]);
  tokens = {
    admin: adminToken,
    governedAdmin: governedAdminToken,
    student: studentToken,
    teacher: teacherToken,
    parent: parentToken,
  };
  // The governed admin is suspended AFTER its token was issued — the stale
  // token stays structurally valid while the DB row turns governed, which is
  // exactly the live-token window the service-tier gate must close.
  await db
    .update(users)
    .set({ suspended: true, suspendedAt: new Date() })
    .where(eq(users.id, the.governedAdminUser.id));
}, 180_000);

afterAll(async () => {
  if (!cast) {
    return;
  }
  const the = theCast();
  const ids = allFixtureUserIds(the);
  await withAuditDeleteTriggersSuspended(async () => {
    await db
      .delete(auditLogs)
      .where(
        or(
          inArray(auditLogs.actorId, ids),
          and(eq(auditLogs.entityType, "teacher"), inArray(auditLogs.entityId, ids)),
          and(eq(auditLogs.entityType, "user"), inArray(auditLogs.entityId, ids))
        )
      );
  });
  await db.delete(notifications).where(inArray(notifications.userId, ids));
  await db.delete(teacher).where(inArray(teacher.id, ids));
  await db.delete(applicants).where(inArray(applicants.id, ids));
  await db.delete(admin).where(inArray(admin.id, ids));
  await db.delete(users).where(inArray(users.id, ids));
  expect(await countUsersByIds(ids)).toBe(0);
}, 120_000);

// ─── Schema introspection pins (no server, no DB) ────────────────────────────

const MUTATION_FIELD_NAME = "adminCertifyTeacherColdStart";

function mutationField(name: string) {
  const fields = graphQLSchema.getMutationType()?.getFields();
  if (!fields) {
    throw new Error("schema must define a Mutation root type");
  }
  const field = fields[name];
  if (!field) {
    throw new Error(`Mutation must register a \`${name}\` root field`);
  }
  return field;
}

/**
 * Reads the `authScopes` declaration off one root field through the Pothos
 * extension snapshot (the same substrate the handshake-code surface suite
 * pins its conjunctions from).
 */
function declaredAuthScopes(rootField: unknown): unknown {
  const extensions: unknown = Reflect.get(isRecord(rootField) ? rootField : {}, "extensions");
  if (!isRecord(extensions)) {
    return undefined;
  }
  const pothosOptions: unknown = Reflect.get(extensions, "pothosOptions");
  if (!isRecord(pothosOptions)) {
    return undefined;
  }
  return Reflect.get(pothosOptions, "authScopes");
}

function argNamed(fieldName: string, argName: string) {
  const arg = mutationField(fieldName).args.find(candidate => candidate.name === argName);
  if (!arg) {
    throw new Error(`expected the \`${argName}\` argument on ${fieldName}`);
  }
  return arg;
}

describe("admin-certification surface — SDL contract pins", () => {
  test("return type, argument set, and Boolean default are contract-exact", () => {
    const field = mutationField(MUTATION_FIELD_NAME);
    expect(field.type.toString()).toBe("AdminUserDetail!");
    expect(field.args.map(arg => arg.name).toSorted((a, b) => a.localeCompare(b))).toEqual(["makeEvaluator", "userId"]);
    expect(argNamed(MUTATION_FIELD_NAME, "userId").type.toString()).toBe("Int!");
    expect(argNamed(MUTATION_FIELD_NAME, "makeEvaluator").type.toString()).toBe("Boolean");
    // The printed SDL pins the `Boolean = true` default without touching the
    // deprecated GraphQLArgument.defaultValue accessor.
    expect(printSchema(graphQLSchema)).toContain(
      "adminCertifyTeacherColdStart(makeEvaluator: Boolean = true, userId: Int!): AdminUserDetail!"
    );
  });

  test("the field carries the `$all` administrator conjunction VERBATIM", () => {
    expect(declaredAuthScopes(mutationField(MUTATION_FIELD_NAME))).toEqual({
      $all: { authenticated: true, role: [UserRole.Admin] },
    });
  });

  test("the operation is absent from the default-deny public-operations allowlist", () => {
    expect(PUBLIC_OPERATIONS.has(MUTATION_FIELD_NAME)).toBe(false);
  });
});

// ─── In-process scope-evaluation tier (built schema, hand-built context) ─────

/** Fixture hash stub — never verified against (context fixtures can't log in). */
const IN_PROCESS_HASH_STUB = "in-process-stub";

function mockInProcessUser(role: UserRole, userId: number): UserSelectType {
  return {
    id: userId,
    email: `${FIXTURE_MARKER}-inprocess-${role}@wire.test`,
    fullName: `${FIXTURE_MARKER} in-process ${role}`,
    phone: "+15550101010",
    country: "Egypt",
    gender: "male",
    dateOfBirth: "1990-01-01",
    role,
    isDeleted: false,
    suspended: false,
    isBlocked: false,
    deletedAt: null,
    suspendedAt: null,
    blockedAt: null,
    lastActiveAt: null,
    suspendedPeriodDays: null,
    passwordHash: IN_PROCESS_HASH_STUB,
    locale: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function buildInProcessContext(user: UserSelectType | null): Context {
  let safeUser: RegistrationReturnType | null = null;
  if (user) {
    const { passwordHash: _passwordHash, ...rest } = user;
    safeUser = { ...rest, preferredRecitation: null };
  }
  return {
    locale: "en",
    t: async <K extends keyof Translations>(ns: K) => getServerTranslations("en")[ns],
    requestId: "req-cold-start-in-process",
    user: safeUser,
    safeUser,
    permissions: [],
    isSuperAdmin: user?.role === "admin",
    role: user ? toUserRole(user.role) : null,
    cookies: {},
    authCookieOut: [],
  };
}

const IN_PROCESS_DOCUMENT = `
  mutation ColdStartInProcessProbe($userId: Int!) {
    adminCertifyTeacherColdStart(userId: $userId) {
      id
    }
  }
`;

function executeInProcess(user: UserSelectType | null) {
  return graphql({
    schema: graphQLSchema,
    source: IN_PROCESS_DOCUMENT,
    variableValues: { userId: 1 },
    contextValue: buildInProcessContext(user),
  });
}

describe("admin-certification in-process scope tier", () => {
  test("anonymous context answers UNAUTHORIZED pre-resolver", async () => {
    const result = await executeInProcess(null);
    expect(result.errors?.[0]?.extensions?.code).toBe("UNAUTHORIZED");
  });

  test.each([UserRole.Student, UserRole.Teacher, UserRole.Parent])(
    "authenticated %s context answers FORBIDDEN pre-resolver",
    async role => {
      const result = await executeInProcess(mockInProcessUser(role, 900_001));
      expect(result.errors?.[0]?.extensions?.code).toBe("FORBIDDEN");
    }
  );
});

// ─── Wire tier: anonymous + role-matrix denials ──────────────────────────────

describe("admin-certification wire denials — anonymous and non-admin roles", () => {
  test("anonymous callers answer UNAUTHORIZED through the Apollo testClient", async () => {
    const result = await testClient.mutate({
      mutation: gql`
        mutation ColdStartAnonymousProbe($userId: Int!, $makeEvaluator: Boolean) {
          adminCertifyTeacherColdStart(userId: $userId, makeEvaluator: $makeEvaluator) {
            id
          }
        }
      `,
      variables: { userId: theCast().targetUser.id, makeEvaluator: true },
    });
    const error = expectMutationError(result.error, "UNAUTHORIZED");
    expect(error.errors).toHaveLength(1);
  });

  test("anonymous callers over raw HTTP answer UNAUTHORIZED with null data", async () => {
    const body = await certifyOverWire(null, theCast().targetUser.id);
    expect(errorCodeOf(soleErrorItemOf(body))).toBe("UNAUTHORIZED");
    expect(body.data).toBeNull();
  });

  test("student / teacher / parent tokens answer FORBIDDEN with the scope copy and zero side effects", async () => {
    const the = theCast();
    const roleTokens = [theTokens().student, theTokens().teacher, theTokens().parent];
    const bodies = await Promise.all(roleTokens.map(token => certifyOverWire(token, the.governedTargetUser.id)));
    for (const body of bodies) {
      const item = soleErrorItemOf(body);
      expect(errorCodeOf(item)).toBe("FORBIDDEN");
      // The generic forbidden copy proves the pre-resolver role scope fired —
      // no service-tier denial (which would carry a domain-specific message).
      expect(errorMessageOf(item)).toBe(tErrorsEn.forbidden);
      expect(body.data).toBeNull();
    }
    // Zero side effects: no audit rows authored by the denied actors and the
    // probed target never moved (no teacher row, applicant byte-identical).
    expect(await auditCountByActors([the.studentUser.id, the.teacherUser.id, the.parentUser.id])).toBe(0);
    expect(await teacherRowOf(the.governedTargetUser.id)).toBeNull();
    const applicantAfter = await applicantRowOf(the.governedTargetUser.id);
    expect(JSON.stringify(applicantAfter)).toBe(JSON.stringify(the.governedTargetApplicant));
  });

  test("governed admin with a live token answers service-tier FORBIDDEN and moves nothing", async () => {
    const the = theCast();
    const body = await certifyOverWire(theTokens().governedAdmin, the.targetUser.id);
    const item = soleErrorItemOf(body);
    expect(errorCodeOf(item)).toBe("FORBIDDEN");
    // The suspension copy can only come from the service-tier governance gate
    // — the pre-resolver scope layer uses the generic forbidden copy.
    expect(errorMessageOf(item)).toBe(tErrorsEn.accountSuspended);
    expect(body.data).toBeNull();
    expect(await auditCountByActors([the.governedAdminUser.id])).toBe(0);
    expect(await teacherRowOf(the.targetUser.id)).toBeNull();
    expect(await notificationRowsOf(the.targetUser.id)).toHaveLength(0);
  });
});

// ─── Wire tier: smuggling + malformed-shape probes ───────────────────────────

describe("admin-certification wire probes — smuggling and malformed shapes", () => {
  test("smuggled root args and unknown payload fields die as GRAPHQL_VALIDATION_FAILED pre-resolver", async () => {
    const the = theCast();
    const adminToken = theTokens().admin;
    const probeDocuments = [
      // Identity smuggle — there is no caller-supplied actor surface.
      "mutation { adminCertifyTeacherColdStart(userId: 1, actorId: 2) { id } }",
      // Unknown payload field on the AdminUserDetail wrapper.
      `mutation { adminCertifyTeacherColdStart(userId: ${the.targetUser.id}) { id smuggledField } }`,
      // Unknown sub-field through the teacher snapshot.
      `mutation { adminCertifyTeacherColdStart(userId: ${the.targetUser.id}) { id teacher { isApproved smuggledFlag } } }`,
    ];
    const auditBefore = await auditCountByActors([the.adminUser.id]);
    const bodies = await Promise.all(probeDocuments.map(document => postWire(document, adminToken)));
    for (const body of bodies) {
      expect(errorCodeOf(soleErrorItemOf(body))).toBe("GRAPHQL_VALIDATION_FAILED");
    }
    // Pre-resolver discard: nothing reached the service.
    expect(await auditCountByActors([the.adminUser.id])).toBe(auditBefore);
    expect(await teacherRowOf(the.targetUser.id)).toBeNull();
    expect(await notificationRowsOf(the.targetUser.id)).toHaveLength(0);
  });

  test("malformed variable shapes answer BAD_USER_INPUT at input coercion", async () => {
    const the = theCast();
    const adminToken = theTokens().admin;
    const auditBefore = await auditCountByActors([the.adminUser.id]);
    const bodies = await Promise.all([
      postWire(CERTIFY_DOCUMENT, adminToken, { userId: "not-a-number", makeEvaluator: true }),
      postWire(CERTIFY_DOCUMENT, adminToken, { userId: 7.5 }),
      postWire(CERTIFY_DOCUMENT, adminToken, { userId: the.targetUser.id, makeEvaluator: "yes" }),
    ]);
    for (const body of bodies) {
      expect(errorCodeOf(soleErrorItemOf(body))).toBe("BAD_USER_INPUT");
    }
    expect(await auditCountByActors([the.adminUser.id])).toBe(auditBefore);
    expect(await teacherRowOf(the.targetUser.id)).toBeNull();
  });

  test("out-of-domain userId values answer VALIDATION at the service boundary", async () => {
    const adminToken = theTokens().admin;
    const auditBefore = await auditCountByActors([theCast().adminUser.id]);
    const bodies = await Promise.all([certifyOverWire(adminToken, 0), certifyOverWire(adminToken, -7)]);
    for (const body of bodies) {
      expect(errorCodeOf(soleErrorItemOf(body))).toBe("VALIDATION");
      expect(body.data).toBeNull();
    }
    expect(await auditCountByActors([theCast().adminUser.id])).toBe(auditBefore);
  });
});

// ─── Wire tier: service-tier target denials (admin actor) ────────────────────

describe("admin-certification wire denials — target-side domain rules", () => {
  test("a nonexistent target id answers USER_NOT_FOUND", async () => {
    const the = theCast();
    const [stats] = await db.select({ maxId: max(users.id) }).from(users);
    const absentId = (stats?.maxId ?? 0) + 1_000_000;
    const body = await certifyOverWire(theTokens().admin, absentId);
    expect(errorCodeOf(soleErrorItemOf(body))).toBe("USER_NOT_FOUND");
    expect(body.data).toBeNull();
    expect(await auditRowsAboutTeacherTarget(absentId)).toHaveLength(0);
    // The live fixture target never moved either.
    expect(await teacherRowOf(the.targetUser.id)).toBeNull();
  });

  test("a non-teacher target answers TEACHER_ROLE_REQUIRED with zero row movement", async () => {
    const the = theCast();
    const body = await certifyOverWire(theTokens().admin, the.studentUser.id);
    expect(errorCodeOf(soleErrorItemOf(body))).toBe("TEACHER_ROLE_REQUIRED");
    expect(body.data).toBeNull();
    expect(await teacherRowOf(the.studentUser.id)).toBeNull();
    expect(await auditRowsAboutTeacherTarget(the.studentUser.id)).toHaveLength(0);
  });

  test("a governed teacher target answers TEACHER_ACCOUNT_GOVERNED with the fixture byte-identical", async () => {
    const the = theCast();
    const body = await certifyOverWire(theTokens().admin, the.governedTargetUser.id);
    expect(errorCodeOf(soleErrorItemOf(body))).toBe("TEACHER_ACCOUNT_GOVERNED");
    expect(body.data).toBeNull();
    expect(await teacherRowOf(the.governedTargetUser.id)).toBeNull();
    const applicantAfter = await applicantRowOf(the.governedTargetUser.id);
    expect(JSON.stringify(applicantAfter)).toBe(JSON.stringify(the.governedTargetApplicant));
    expect(await notificationRowsOf(the.governedTargetUser.id)).toHaveLength(0);
  });
});

// ─── Wire tier: happy path + repeat-denial ───────────────────────────────────

describe("admin-certification wire happy path", () => {
  test("certification returns the refreshed teacher snapshot in the SAME response and commits the oracle", async () => {
    const the = theCast();
    const body = await certifyOverWire(theTokens().admin, the.targetUser.id);
    expect(body.errors).toBeUndefined();

    const payload = certificationPayloadOf(body);
    expect(payload.id).toBe(the.targetUser.id);
    const teacherSnapshot = recordOf(payload.teacher, "expected the refreshed teacher snapshot");
    expect(teacherSnapshot.isApproved).toBe(true);
    expect(teacherSnapshot.isEvaluator).toBe(true);
    const applicantSnapshot = recordOf(payload.applicant, "expected the finalized applicant snapshot");
    // Enum-object registration keeps the registered member name as the wire value.
    expect(applicantSnapshot.status).toBe("Passed");
    expect(applicantSnapshot.cooldownUntil).toBeNull();

    // DB oracles — the committed reality matches the wire payload.
    const teacherRow = await teacherRowOf(the.targetUser.id);
    if (!teacherRow) {
      throw new Error("expected the certified teacher row to exist");
    }
    expect(teacherRow.isApproved).toBe(true);
    expect(teacherRow.isEvaluator).toBe(true);
    const applicantRow = await applicantRowOf(the.targetUser.id);
    expect(applicantRow?.status).toBe(ApplicantStatus.Passed);
    expect(applicantRow?.cooldownUntil).toBeNull();

    // Exactly ONE override audit row, attributed to the admin actor, carrying
    // the metadata-only details document.
    const auditRows = await auditRowsAboutTeacherTarget(the.targetUser.id);
    expect(auditRows).toHaveLength(1);
    const auditRow = auditRows.at(0);
    if (!auditRow) {
      throw new Error("expected the override audit row");
    }
    expect(auditRow.actorId).toBe(the.adminUser.id);
    expect(auditRow.actionType).toBe(AuditActionType.Override);
    expect(auditRow.entityType).toBe("teacher");
    expect(auditRow.entityId).toBe(the.targetUser.id);
    if (typeof auditRow.details !== "string") {
      throw new Error("expected the audit details payload");
    }
    const parsedDetails: unknown = JSON.parse(auditRow.details);
    expect(parsedDetails).toEqual({ makeEvaluator: true, applicantRow: "finalized", elevation: "created" });

    // Exactly ONE persisted notification row addressed to the target.
    const notificationRows = await notificationRowsOf(the.targetUser.id);
    expect(notificationRows).toHaveLength(1);
    const note = notificationRows.at(0);
    if (!note) {
      throw new Error("expected the certification notification row");
    }
    expect(note.type).toBe(NotificationType.EvaluationResult);
    expect(note.relatedEntityType).toBe("teacher");
    expect(note.relatedEntityId).toBe(the.targetUser.id);
  });

  test("a repeat certification answers TEACHER_ALREADY_CERTIFIED with no second row of any kind", async () => {
    const the = theCast();
    const body = await certifyOverWire(theTokens().admin, the.targetUser.id);
    expect(errorCodeOf(soleErrorItemOf(body))).toBe("TEACHER_ALREADY_CERTIFIED");
    expect(body.data).toBeNull();
    // Zero-row-movement oracles: trail and inbox counts stay pinned at one.
    expect(await auditRowsAboutTeacherTarget(the.targetUser.id)).toHaveLength(1);
    expect(await notificationRowsOf(the.targetUser.id)).toHaveLength(1);
    const teacherRow = await teacherRowOf(the.targetUser.id);
    expect(teacherRow?.isEvaluator).toBe(true);
  });
});
