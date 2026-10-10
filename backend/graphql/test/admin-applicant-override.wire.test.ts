/**
 * `adminOverrideApplicantEvaluation` — wire-matrix suite for the admin
 * evaluation-override mutation (docs/planning/TICKETS.md "Admin Override of
 * Evaluation Results") over the REAL wire (`setupTestServerLifecycle` + raw
 * `fetch` + the Apollo `testClient`).
 *
 * Tiers locked down (HTTP → gateway pipeline → scope-auth → resolver →
 * ApplicantLifecycleService → PostgreSQL → back):
 *  - **SDL contract pins** (no server, no DB) — the mutation returns
 *    `ApplicantProfile!` with the two required args (`action` riding the
 *    `AdminApplicantOverrideAction` enum, `applicantId: Int!`) and the
 *    OPTIONAL nullable `cooldownDays: Int` (the `adminSetUserSuspended`
 *    period precedent: validated on the reject direction, ignored on the
 *    others). The `$all` administrator conjunction is pinned verbatim off
 *    the built schema's `pothosOptions.authScopes` snapshot; the operation
 *    is absent from the default-deny public-operations allowlist; the enum
 *    carries exactly the three wire members (`Certify` / `GrantReEvaluation`
 *    / `Reject`).
 *  - **Anonymous** — both the Apollo testClient path and a raw POST answer
 *    `UNAUTHORIZED` (the `$all.authenticated` scope fails before the
 *    resolver body runs).
 *  - **Non-admin (teacher)** — answers `FORBIDDEN` at the pre-resolver role
 *    scope with the generic localized forbidden copy and ZERO side effects
 *    (no audit rows, applicant row byte-identical).
 *  - **Domain denials over the wire** — reject on a non-passed applicant
 *    answers `APPLICANT_OVERRIDE_NOT_PASSED`, a reject `cooldownDays: 0`
 *    answers `APPLICANT_OVERRIDE_COOLDOWN_INVALID` (bounds fire before any
 *    write), a grant without a stamped cooldown answers
 *    `APPLICANT_NO_ACTIVE_COOLDOWN`, a certify of an already-`passed`
 *    applicant answers `APPLICANT_ALREADY_CERTIFIED`, a nonexistent
 *    applicant answers `APPLICANT_NOT_FOUND`, and a smuggled `actorId` root
 *    arg dies as `GRAPHQL_VALIDATION_FAILED` pre-resolver (there is no
 *    caller-supplied actor surface — the audit actor is the session user
 *    id). Every denial writes nothing.
 *  - **Admin happy paths** — certify a `failed` applicant answers HTTP 200
 *    with the refreshed profile (`status: "Passed"`, `cooldownState:
 *    "None"`, not purchasable), commits a certified `teacher` row
 *    (`is_approved=true`, `is_evaluator=false`), exactly ONE `override`
 *    audit row carrying the composed details document, and exactly ONE
 *    `applicant_outcome` notification row to the applicant (the #287
 *    fan-out: composed in the recipient's persisted locale, pointed at the
 *    applicants row, unread); reject a `passed` applicant (WITH
 *    `cooldownDays`) flips the row to `failed` with the stamped cooldown,
 *    demotes the teacher row, and the audit details carry
 *    `cooldownUntil` + `cooldownDays`; grant re-evaluation clears an active
 *    cooldown without touching the status. The cooldownDays-optional
 *    contract is proven by certifying WITHOUT the arg.
 *
 * Fixture strategy (mirrors the admin wire suites): the admin + applicant
 * actors are provisioned inside ONE committing transaction in `beforeAll`
 * (the suite runs real service transactions, so no outer rollback wrapper
 * may exist); tokens ride the real `login` mutation; every created id is
 * hard-deleted in `afterAll` in FK-safe order with a final zero-residue
 * self-check. Each state-changing happy path owns a DEDICATED applicant so
 * no test's precondition depends on another test's write.
 *
 * Mandated runner: bun run test/scripts/run-test.ts backend/graphql/test/admin-applicant-override.wire.test.ts
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { gql } from "@apollo/client";
import { and, count, eq, inArray, max, or } from "drizzle-orm";
import { isEnumType, printSchema } from "graphql";
import { db } from "@/backend/db";
import { auditLogs } from "@/backend/db/schema/audit/audit-logs";
import { notifications } from "@/backend/db/schema/notifications/notifications";
import { applicants } from "@/backend/db/schema/teachers/applicants";
import { teacher } from "@/backend/db/schema/teachers/teacher";
import { admin } from "@/backend/db/schema/users/admin";
import { users } from "@/backend/db/schema/users/users";
import {
  createTestAdmin,
  createTestApplicant,
  createTestTeacherRow,
  createTestUser,
} from "@/backend/db/test/entity-setup";
import { AuditActionType } from "@/backend/enum/audit/audit-action-type.enum";
import { NotificationType } from "@/backend/enum/notifications/notification-type.enum";
import { ApplicantStatus } from "@/backend/enum/teachers/applicant-status.enum";
import { UserRole } from "@/backend/enum/users/user-role.enum";
import { graphQLSchema } from "@/backend/graphql/gqlSchema";
import { hashPassword } from "@/backend/lib/auth/password";
import { PUBLIC_OPERATIONS } from "@/backend/lib/gateway";
import type { ApplicantSelectType, UserSelectType } from "@/backend/types";
import { defaultLocale } from "@/shared/locale/AppLocale";
import { getServerTranslations } from "@/shared/locale/server-graphql";
import { countUsersByIds, expectMutationError, setupTestServerLifecycle, TEST_PORT, testClient } from "@/test/helpers";
// Deep import (mirrors the journey suites): the `@/test/helpers` barrel pulls
// the Apollo client into backend-only dependency graphs.
import { withAuditDeleteTriggersSuspended } from "@/test/helpers/db-cleanup";

setupTestServerLifecycle();

const tErrorsEn = getServerTranslations("en").errorsTranslations;

/**
 * The applicant_outcome notification type widened to its primitive string
 * value — the DB column infers a string union, so comparisons go through
 * this constant.
 */
const NOTIFICATION_TYPE_APPLICANT_OUTCOME: string = NotificationType.ApplicantOutcome;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

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
const WIRE_CREDENTIAL = "OverrideWire!Fixture1";

/** Per-run marker embedded in fixture emails (unique-index collision-proof). */
const FIXTURE_MARKER = `aow_${randomUUID().slice(0, 8)}`;

const OVERRIDE_DOCUMENT = `
  mutation OverrideWire($applicantId: Int!, $action: AdminApplicantOverrideAction!, $cooldownDays: Int) {
    adminOverrideApplicantEvaluation(applicantId: $applicantId, action: $action, cooldownDays: $cooldownDays) {
      id
      status
      verificationAttempts
      cooldownUntil
      cooldownActive
      canPurchaseVerification
      cooldownState
    }
  }
`;

const LOGIN_DOCUMENT = `
  mutation OverrideWireLogin($email: String!, $credential: String!) {
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
): Promise<{ readonly status: number; readonly body: Record<string, unknown> }> {
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
  return {
    status: response.status,
    body: recordOf(await response.json(), "expected a JSON object response"),
  };
}

/** One `adminOverrideApplicantEvaluation` call over the wire. */
function overrideOverWire(
  accessToken: string | null,
  applicantId: number,
  action: "Certify" | "Reject" | "GrantReEvaluation",
  cooldownDays?: number
) {
  const variables: Record<string, unknown> = { applicantId, action };
  if (cooldownDays !== undefined) {
    variables.cooldownDays = cooldownDays;
  }
  return postWire(OVERRIDE_DOCUMENT, accessToken, variables);
}

/** Logs a fixture actor in over the wire and returns its access token. */
async function loginOverWire(email: string): Promise<string> {
  const { body } = await postWire(LOGIN_DOCUMENT, null, { email, credential: WIRE_CREDENTIAL });
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

/** The wire `ApplicantProfile` payload of a successful override. */
function overridePayloadOf(body: Record<string, unknown>): Record<string, unknown> {
  const data = recordOf(recordOf(body, "expected a body").data, "expected a data object");
  return recordOf(data.adminOverrideApplicantEvaluation, "expected the override payload");
}

// ─── Direct-DB oracles (never routed through the service layer) ──────────────

async function applicantRowOf(userId: number): Promise<ApplicantSelectType | null> {
  const [row] = await db.select().from(applicants).where(eq(applicants.id, userId)).limit(1);
  return row ?? null;
}

async function teacherRowOf(userId: number) {
  const [row] = await db.select().from(teacher).where(eq(teacher.id, userId)).limit(1);
  return row ?? null;
}

/** Override-trail rows attributed to an applicant target. */
async function auditRowsAboutApplicantTarget(targetId: number) {
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
    .where(and(eq(auditLogs.entityType, "applicant"), eq(auditLogs.entityId, targetId)));
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
      title: notifications.title,
      body: notifications.body,
      isRead: notifications.isRead,
      relatedEntityType: notifications.relatedEntityType,
      relatedEntityId: notifications.relatedEntityId,
    })
    .from(notifications)
    .where(eq(notifications.userId, userId));
}

// ─── Fixtures ────────────────────────────────────────────────────────────────

interface OverrideFixtureApplicant {
  readonly user: UserSelectType;
  readonly row: ApplicantSelectType;
}

interface WireCast {
  readonly adminUser: UserSelectType;
  /** The `failed` + active-cooldown applicant — the CERTIFY happy path. */
  readonly certifyTarget: OverrideFixtureApplicant;
  /** The `passed` applicant with a certified teacher row — REJECT + terminal probes. */
  readonly rejectTarget: OverrideFixtureApplicant;
  /** The `failed` + active-cooldown applicant — the GRANT happy path. */
  readonly grantTarget: OverrideFixtureApplicant;
  /** The `pending`, no-cooldown applicant — the pre-state denial probes. */
  readonly denialTarget: OverrideFixtureApplicant;
  readonly cooldownBase: Date;
}

interface WireTokens {
  readonly admin: string;
  /** A NON-admin (teacher) token — the FORBIDDEN scope probe. */
  readonly nonAdmin: string;
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

/**
 * Provisions every actor inside ONE committing transaction (the suite runs
 * real service transactions, so no outer rollback wrapper may exist). Each
 * happy-path target carries its own pre-state so no test depends on another
 * test's write.
 */
async function provisionWireCast(): Promise<WireCast> {
  const credentialHash = await hashPassword(WIRE_CREDENTIAL);
  const cooldownBase = new Date(Date.now() + 30 * MS_PER_DAY);
  return db.transaction(async tx => {
    const adminUser = await createTestUser(tx, {
      fullName: `${FIXTURE_MARKER} admin`,
      email: fixtureEmail("admin"),
      passwordHash: credentialHash,
      role: "admin",
    });
    await createTestAdmin(tx, adminUser.id);

    const nonAdminUser = await createTestUser(tx, {
      fullName: `${FIXTURE_MARKER} non-admin`,
      email: fixtureEmail("non-admin"),
      passwordHash: credentialHash,
      role: "teacher",
    });
    await createTestApplicant(tx, nonAdminUser.id, { status: ApplicantStatus.Failed, cooldownUntil: cooldownBase });

    const certifyUser = await createTestUser(tx, {
      fullName: `${FIXTURE_MARKER} certify`,
      email: fixtureEmail("certify"),
      passwordHash: credentialHash,
      role: "teacher",
    });
    const certifyRow = await createTestApplicant(tx, certifyUser.id, {
      status: ApplicantStatus.Failed,
      cooldownUntil: cooldownBase,
    });

    const rejectUser = await createTestUser(tx, {
      fullName: `${FIXTURE_MARKER} reject`,
      email: fixtureEmail("reject"),
      passwordHash: credentialHash,
      role: "teacher",
    });
    const rejectRow = await createTestApplicant(tx, rejectUser.id, {
      status: ApplicantStatus.Passed,
      cooldownUntil: null,
    });
    await createTestTeacherRow(tx, rejectUser.id, { isApproved: true, isEvaluator: false });

    const grantUser = await createTestUser(tx, {
      fullName: `${FIXTURE_MARKER} grant`,
      email: fixtureEmail("grant"),
      passwordHash: credentialHash,
      role: "teacher",
    });
    const grantRow = await createTestApplicant(tx, grantUser.id, {
      status: ApplicantStatus.Failed,
      cooldownUntil: cooldownBase,
    });

    const denialUser = await createTestUser(tx, {
      fullName: `${FIXTURE_MARKER} denial`,
      email: fixtureEmail("denial"),
      passwordHash: credentialHash,
      role: "teacher",
    });
    const denialRow = await createTestApplicant(tx, denialUser.id, {
      status: ApplicantStatus.Pending,
      cooldownUntil: null,
    });

    return {
      adminUser,
      certifyTarget: { user: certifyUser, row: certifyRow },
      rejectTarget: { user: rejectUser, row: rejectRow },
      grantTarget: { user: grantUser, row: grantRow },
      denialTarget: { user: denialUser, row: denialRow },
      cooldownBase,
    };
  });
}

beforeAll(async () => {
  cast = await provisionWireCast();
  const the = theCast();
  const [adminToken, nonAdminToken] = await Promise.all([
    loginOverWire(the.adminUser.email),
    loginOverWire(the.grantTarget.user.email),
  ]);
  tokens = { admin: adminToken, nonAdmin: nonAdminToken };
}, 180_000);

afterAll(async () => {
  if (!cast) {
    return;
  }
  const the = theCast();
  const ids = [
    the.adminUser.id,
    the.certifyTarget.user.id,
    the.rejectTarget.user.id,
    the.grantTarget.user.id,
    the.denialTarget.user.id,
  ];
  await withAuditDeleteTriggersSuspended(async () => {
    await db
      .delete(auditLogs)
      .where(
        or(
          inArray(auditLogs.actorId, ids),
          and(eq(auditLogs.entityType, "applicant"), inArray(auditLogs.entityId, ids))
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

// ─── SDL contract pins (no server, no DB) ────────────────────────────────────

const MUTATION_FIELD_NAME = "adminOverrideApplicantEvaluation";

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
 * extension snapshot (the same substrate the admin wire suites pin their
 * conjunctions from).
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

function enumValueNamesOf(name: string): readonly string[] {
  const type = graphQLSchema.getType(name);
  if (!type || !isEnumType(type)) {
    throw new Error(`expected the \`${name}\` enum in the built schema`);
  }
  return type.getValues().map(value => value.name);
}

describe("applicant-override surface — SDL contract pins", () => {
  test("return type and argument set are contract-exact (cooldownDays the ONLY nullable arg)", () => {
    const field = mutationField(MUTATION_FIELD_NAME);
    expect(field.type.toString()).toBe("ApplicantProfile!");
    expect(field.args.map(arg => arg.name).toSorted((a, b) => a.localeCompare(b))).toEqual([
      "action",
      "applicantId",
      "cooldownDays",
    ]);
    expect(argNamed(MUTATION_FIELD_NAME, "action").type.toString()).toBe("AdminApplicantOverrideAction!");
    expect(argNamed(MUTATION_FIELD_NAME, "applicantId").type.toString()).toBe("Int!");
    expect(argNamed(MUTATION_FIELD_NAME, "cooldownDays").type.toString()).toBe("Int");
    expect(printSchema(graphQLSchema)).toContain(
      "adminOverrideApplicantEvaluation(action: AdminApplicantOverrideAction!, applicantId: Int!, cooldownDays: Int): ApplicantProfile!"
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

  test("the override enum carries EXACTLY the three wire members (member-KEY names)", () => {
    expect(enumValueNamesOf("AdminApplicantOverrideAction").toSorted((a, b) => a.localeCompare(b))).toEqual([
      "Certify",
      "GrantReEvaluation",
      "Reject",
    ]);
  });
});

// ─── Wire tier: anonymous + non-admin denials ────────────────────────────────

describe("applicant-override wire denials — anonymous and non-admin", () => {
  test("anonymous callers answer UNAUTHORIZED through the Apollo testClient", async () => {
    const result = await testClient.mutate({
      mutation: gql`
        mutation OverrideAnonymousProbe($applicantId: Int!, $action: AdminApplicantOverrideAction!) {
          adminOverrideApplicantEvaluation(applicantId: $applicantId, action: $action) {
            id
          }
        }
      `,
      variables: { applicantId: theCast().certifyTarget.user.id, action: "Certify" },
    });
    const error = expectMutationError(result.error, "UNAUTHORIZED");
    expect(error.errors).toHaveLength(1);
  });

  test("anonymous callers over raw HTTP answer UNAUTHORIZED with null data", async () => {
    const { body } = await overrideOverWire(null, theCast().certifyTarget.user.id, "Certify");
    expect(errorCodeOf(soleErrorItemOf(body))).toBe("UNAUTHORIZED");
    expect(body.data).toBeNull();
  });

  test("a teacher token answers FORBIDDEN with the scope copy and zero side effects", async () => {
    const the = theCast();
    const applicantBefore = await applicantRowOf(the.certifyTarget.user.id);
    const auditBefore = await auditCountByActors([the.adminUser.id, the.grantTarget.user.id]);
    const { body } = await overrideOverWire(theTokens().nonAdmin, the.certifyTarget.user.id, "Certify");
    const item = soleErrorItemOf(body);
    expect(errorCodeOf(item)).toBe("FORBIDDEN");
    // The generic forbidden copy proves the pre-resolver role scope fired —
    // no service-tier denial (which would carry a domain-specific message).
    expect(errorMessageOf(item)).toBe(tErrorsEn.forbidden);
    expect(body.data).toBeNull();
    expect(await auditCountByActors([the.adminUser.id, the.grantTarget.user.id])).toBe(auditBefore);
    expect(JSON.stringify(await applicantRowOf(the.certifyTarget.user.id))).toBe(JSON.stringify(applicantBefore));
  });
});

// ─── Wire tier: domain denials (admin actor) ─────────────────────────────────

describe("applicant-override wire denials — domain rules", () => {
  test("reject on a non-passed applicant answers APPLICANT_OVERRIDE_NOT_PASSED and writes nothing", async () => {
    const the = theCast();
    const applicantBefore = await applicantRowOf(the.denialTarget.user.id);
    const auditBefore = await auditCountByActors([the.adminUser.id]);
    const { body } = await overrideOverWire(theTokens().admin, the.denialTarget.user.id, "Reject", 30);
    const item = soleErrorItemOf(body);
    expect(errorCodeOf(item)).toBe("APPLICANT_OVERRIDE_NOT_PASSED");
    expect(errorMessageOf(item)).toBe(tErrorsEn.applicantOverrideNotPassed);
    expect(body.data).toBeNull();
    expect(JSON.stringify(await applicantRowOf(the.denialTarget.user.id))).toBe(JSON.stringify(applicantBefore));
    expect(await auditRowsAboutApplicantTarget(the.denialTarget.user.id)).toHaveLength(0);
    expect(await auditCountByActors([the.adminUser.id])).toBe(auditBefore);
  });

  test("reject with cooldownDays 0 answers APPLICANT_OVERRIDE_COOLDOWN_INVALID with the bounds copy and zero writes", async () => {
    const the = theCast();
    const applicantBefore = await applicantRowOf(the.rejectTarget.user.id);
    const { body } = await overrideOverWire(theTokens().admin, the.rejectTarget.user.id, "Reject", 0);
    const item = soleErrorItemOf(body);
    expect(errorCodeOf(item)).toBe("APPLICANT_OVERRIDE_COOLDOWN_INVALID");
    expect(errorMessageOf(item)).toBe(tErrorsEn.applicantOverrideCooldownInvalid);
    expect(body.data).toBeNull();
    expect(JSON.stringify(await applicantRowOf(the.rejectTarget.user.id))).toBe(JSON.stringify(applicantBefore));
    expect(await auditRowsAboutApplicantTarget(the.rejectTarget.user.id)).toHaveLength(0);
  });

  test("grant without a stamped cooldown answers APPLICANT_NO_ACTIVE_COOLDOWN and writes nothing", async () => {
    const the = theCast();
    const { body } = await overrideOverWire(theTokens().admin, the.denialTarget.user.id, "GrantReEvaluation");
    expect(errorCodeOf(soleErrorItemOf(body))).toBe("APPLICANT_NO_ACTIVE_COOLDOWN");
    expect(errorMessageOf(soleErrorItemOf(body))).toBe(tErrorsEn.applicantNoActiveCooldown);
    expect(body.data).toBeNull();
    expect(await auditRowsAboutApplicantTarget(the.denialTarget.user.id)).toHaveLength(0);
  });

  test("certify an already-passed applicant answers APPLICANT_ALREADY_CERTIFIED", async () => {
    const the = theCast();
    const auditBefore = await auditCountByActors([the.adminUser.id]);
    const { body } = await overrideOverWire(theTokens().admin, the.rejectTarget.user.id, "Certify");
    expect(errorCodeOf(soleErrorItemOf(body))).toBe("APPLICANT_ALREADY_CERTIFIED");
    expect(body.data).toBeNull();
    expect(await auditRowsAboutApplicantTarget(the.rejectTarget.user.id)).toHaveLength(0);
    expect(await auditCountByActors([the.adminUser.id])).toBe(auditBefore);
  });

  test("a nonexistent applicant id answers APPLICANT_NOT_FOUND", async () => {
    const [stats] = await db.select({ maxId: max(users.id) }).from(users);
    const absentId = (stats?.maxId ?? 0) + 1_000_000;
    const { body } = await overrideOverWire(theTokens().admin, absentId, "Certify");
    expect(errorCodeOf(soleErrorItemOf(body))).toBe("APPLICANT_NOT_FOUND");
    expect(body.data).toBeNull();
    expect(await auditRowsAboutApplicantTarget(absentId)).toHaveLength(0);
  });

  test("a smuggled actorId arg dies as GRAPHQL_VALIDATION_FAILED pre-resolver", async () => {
    const the = theCast();
    const auditBefore = await auditCountByActors([the.adminUser.id]);
    // Identity smuggle — there is no caller-supplied actor surface; the
    // audit actor is the session user id only.
    const { body } = await postWire(
      "mutation { adminOverrideApplicantEvaluation(applicantId: 1, action: Certify, actorId: 2) { id } }",
      theTokens().admin
    );
    expect(errorCodeOf(soleErrorItemOf(body))).toBe("GRAPHQL_VALIDATION_FAILED");
    expect(await auditCountByActors([the.adminUser.id])).toBe(auditBefore);
  });
});

// ─── Wire tier: admin happy paths ─────────────────────────────────────────────

describe("applicant-override wire happy paths", () => {
  test("certify (WITHOUT cooldownDays — the optional-arg contract) returns the refreshed profile, inserts the certified teacher row, and commits the override audit row", async () => {
    const the = theCast();
    const { status, body } = await overrideOverWire(theTokens().admin, the.certifyTarget.user.id, "Certify");
    expect(status).toBe(200);
    expect(body.errors).toBeUndefined();

    const payload = overridePayloadOf(body);
    expect(payload.id).toBe(the.certifyTarget.user.id);
    // Enum-object registration keeps the registered member name as the wire value.
    expect(payload.status).toBe("Passed");
    expect(payload.cooldownState).toBe("None");
    expect(payload.cooldownActive).toBe(false);
    expect(payload.canPurchaseVerification).toBe(false);

    // DB oracle — the teacher row was created certified (cold start).
    const teacherRow = await teacherRowOf(the.certifyTarget.user.id);
    if (!teacherRow) {
      throw new Error("expected the certify override to create the teacher row");
    }
    expect(teacherRow.isApproved).toBe(true);
    expect(teacherRow.isEvaluator).toBe(false);

    // DB oracle — the applicant was finalized with the cooldown cleared.
    const row = await applicantRowOf(the.certifyTarget.user.id);
    expect(row?.status).toBe(ApplicantStatus.Passed);
    expect(row?.cooldownUntil).toBeNull();

    // Exactly ONE override audit row, attributed to the admin actor,
    // carrying the composed details document.
    const auditRows = await auditRowsAboutApplicantTarget(the.certifyTarget.user.id);
    expect(auditRows).toHaveLength(1);
    const auditRow = auditRows.at(0);
    if (!auditRow) {
      throw new Error("expected the override audit row");
    }
    expect(auditRow.actorId).toBe(the.adminUser.id);
    expect(auditRow.actionType).toBe(AuditActionType.Override);
    expect(auditRow.entityType).toBe("applicant");
    expect(auditRow.entityId).toBe(the.certifyTarget.user.id);
    if (typeof auditRow.details !== "string") {
      throw new Error("expected the audit details payload");
    }
    const parsedDetails: unknown = JSON.parse(auditRow.details);
    expect(parsedDetails).toEqual({
      action: "certify",
      field: "status",
      from: ApplicantStatus.Failed,
      to: ApplicantStatus.Passed,
    });

    // #287 fan-out — the certify override persists exactly ONE notification
    // row to the applicant's inbox and it IS the `applicant_outcome` verdict
    // row (no other type fans out): composed in the RECIPIENT's persisted
    // locale (never the acting admin's; the fixture carries no locale, so
    // the emitter's default-locale fallback applies), pointed at the
    // applicants row, unread.
    const outcomeRows = await notificationRowsOf(the.certifyTarget.user.id);
    expect(outcomeRows).toHaveLength(1);
    const applicantOutcomeRows = outcomeRows.filter(outcome => outcome.type === NOTIFICATION_TYPE_APPLICANT_OUTCOME);
    expect(applicantOutcomeRows).toHaveLength(1);
    const outcomeRow = applicantOutcomeRows[0];
    if (!outcomeRow) {
      throw new Error("expected the certify override to persist an applicant_outcome notification");
    }
    const recipientLocale = the.certifyTarget.user.locale ?? defaultLocale;
    const recipientCopy = getServerTranslations(recipientLocale).notificationsTranslations;
    expect(outcomeRow.title).toBe(recipientCopy.eventApplicantOverrideCertifiedTitle);
    expect(outcomeRow.body).toBe(recipientCopy.eventApplicantOverrideCertifiedBody);
    expect(outcomeRow.isRead).toBe(false);
    expect(outcomeRow.relatedEntityType).toBe("applicants");
    expect(outcomeRow.relatedEntityId).toBe(the.certifyTarget.user.id);
  });

  test("reject WITH cooldownDays flips the passed applicant to failed with the stamped cooldown, demotes the teacher row, and the audit carries the cooldown members", async () => {
    const the = theCast();
    const cooldownDays = 45;
    const before = Date.now();
    const { status, body } = await overrideOverWire(
      theTokens().admin,
      the.rejectTarget.user.id,
      "Reject",
      cooldownDays
    );
    expect(status).toBe(200);
    expect(body.errors).toBeUndefined();
    const after = Date.now();

    const payload = overridePayloadOf(body);
    expect(payload.status).toBe("Failed");
    expect(payload.cooldownState).toBe("Active");
    expect(payload.cooldownActive).toBe(true);
    expect(payload.canPurchaseVerification).toBe(false);

    // DB oracle — the applicant row carries the stamped instant.
    const row = await applicantRowOf(the.rejectTarget.user.id);
    expect(row?.status).toBe(ApplicantStatus.Failed);
    const stampedMs = row?.cooldownUntil?.getTime();
    expect(stampedMs).toBeGreaterThanOrEqual(before + cooldownDays * MS_PER_DAY);
    expect(stampedMs).toBeLessThanOrEqual(after + cooldownDays * MS_PER_DAY);

    // DB oracle — the teacher row was demoted (certification withdrawn).
    const teacherRow = await teacherRowOf(the.rejectTarget.user.id);
    expect(teacherRow?.isApproved).toBe(false);
    expect(teacherRow?.isEvaluator).toBe(false);

    // Exactly ONE override audit row carrying the stamped instant + length.
    const auditRows = await auditRowsAboutApplicantTarget(the.rejectTarget.user.id);
    expect(auditRows).toHaveLength(1);
    const auditRow = auditRows.at(0);
    if (!auditRow) {
      throw new Error("expected the override audit row");
    }
    expect(auditRow.actionType).toBe(AuditActionType.Override);
    expect(auditRow.actorId).toBe(the.adminUser.id);
    if (typeof auditRow.details !== "string") {
      throw new Error("expected the audit details payload");
    }
    const parsedDetails: unknown = JSON.parse(auditRow.details);
    const details = recordOf(parsedDetails, "expected a record-shaped details document");
    expect(details.action).toBe("reject");
    expect(details.field).toBe("status");
    expect(details.from).toBe(ApplicantStatus.Passed);
    expect(details.to).toBe(ApplicantStatus.Failed);
    expect(details.cooldownDays).toBe(cooldownDays);
    const auditedMs = Date.parse(typeof details.cooldownUntil === "string" ? details.cooldownUntil : "");
    expect(auditedMs).toBeGreaterThanOrEqual(before + cooldownDays * MS_PER_DAY);
    expect(auditedMs).toBeLessThanOrEqual(after + cooldownDays * MS_PER_DAY);
  });

  test("grant re-evaluation clears an active cooldown WITHOUT touching the status (purchasability flips true)", async () => {
    const the = theCast();
    const { status, body } = await overrideOverWire(theTokens().admin, the.grantTarget.user.id, "GrantReEvaluation");
    expect(status).toBe(200);
    expect(body.errors).toBeUndefined();

    const payload = overridePayloadOf(body);
    expect(payload.status).toBe("Failed");
    expect(payload.cooldownUntil).toBeNull();
    expect(payload.cooldownState).toBe("None");
    expect(payload.cooldownActive).toBe(false);
    expect(payload.canPurchaseVerification).toBe(true);

    // DB oracle — the status is untouched; only the cooldown cleared.
    const row = await applicantRowOf(the.grantTarget.user.id);
    expect(row?.status).toBe(ApplicantStatus.Failed);
    expect(row?.cooldownUntil).toBeNull();

    // Exactly ONE override audit row carrying the cleared instant.
    const auditRows = await auditRowsAboutApplicantTarget(the.grantTarget.user.id);
    expect(auditRows).toHaveLength(1);
    const auditRow = auditRows.at(0);
    if (!auditRow) {
      throw new Error("expected the override audit row");
    }
    expect(auditRow.actionType).toBe(AuditActionType.Override);
    expect(auditRow.actorId).toBe(the.adminUser.id);
    if (typeof auditRow.details !== "string") {
      throw new Error("expected the audit details payload");
    }
    const parsedDetails: unknown = JSON.parse(auditRow.details);
    expect(parsedDetails).toEqual({
      action: "grant_re_evaluation",
      field: "cooldown_until",
      from: the.cooldownBase.toISOString(),
      to: null,
    });
  });
});
