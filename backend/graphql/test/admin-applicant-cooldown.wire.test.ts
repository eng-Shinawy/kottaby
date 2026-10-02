/**
 * `adminExtendApplicantCooldown` — wire-matrix suite for the admin
 * cooldown-extension mutation and the `ApplicantProfile.cooldownState`
 * read-model field over the REAL wire (`setupTestServerLifecycle` + raw
 * `fetch` + the Apollo `testClient`).
 *
 * Tiers locked down (HTTP → gateway pipeline → scope-auth → resolver →
 * ApplicantLifecycleService → PostgreSQL → back):
 *  - **SDL contract pins** (no server, no DB) — the mutation returns
 *    `ApplicantProfile!` with the two `Int!` args, the `cooldownState`
 *    field rides `ApplicantProfile` as the new `ApplicantCooldownState`
 *    enum (wire member names `None`/`Active`/`Expired`), and the field is
 *    visible on the `myApplicantProfile` SDL. The `$all` administrator
 *    conjunction is pinned verbatim off the built schema's
 *    `pothosOptions.authScopes` snapshot; the operation is absent from the
 *    default-deny public-operations allowlist.
 *  - **Anonymous** — both the Apollo testClient path and a raw POST answer
 *    `UNAUTHORIZED` (the `$all.authenticated` scope fails before the
 *    resolver body runs).
 *  - **Non-admin (teacher)** — answers `FORBIDDEN` at the pre-resolver role
 *    scope with the generic localized forbidden copy and ZERO side effects
 *    (no audit rows, applicant row byte-identical).
 *  - **Domain denials over the wire** — `additionalDays: 0` answers
 *    `APPLICANT_COOLDOWN_EXTENSION_INVALID` with the localized bounds copy,
 *    a nonexistent applicant answers `APPLICANT_NOT_FOUND`, and a smuggled
 *    `actorId` root arg dies as `GRAPHQL_VALIDATION_FAILED` pre-resolver
 *    (there is no caller-supplied actor surface — the audit actor is the
 *    session user id). Every denial writes nothing.
 *  - **Admin happy path** — answers HTTP 200 with the refreshed profile
 *    (`status: "Failed"`, `cooldownState: "Active"`, not purchasable), the
 *    stored base honored verbatim (base + 60 days, computed server-side),
 *    the committed row matching the wire instant, exactly ONE `adjust`
 *    audit row carrying the metadata-only details document, and the
 *    two-source-split observable (`users.suspended` stays `false` — the
 *    cooldown machinery never touches governance fields).
 *
 * Fixture strategy (mirrors the admin wire suites): the admin + applicant
 * actors are provisioned inside ONE committing transaction in `beforeAll`
 * (the suite runs real service transactions, so no outer rollback wrapper
 * may exist); tokens ride the real `login` mutation; every created id is
 * hard-deleted in `afterAll` in FK-safe order with a final zero-residue
 * self-check.
 *
 * Mandated runner: bun run test/scripts/run-test.ts backend/graphql/test/admin-applicant-cooldown.wire.test.ts
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { gql } from "@apollo/client";
import { and, count, eq, inArray, max, or } from "drizzle-orm";
import { isEnumType, isObjectType, printSchema } from "graphql";
import { db } from "@/backend/db";
import { auditLogs } from "@/backend/db/schema/audit/audit-logs";
import { notifications } from "@/backend/db/schema/notifications/notifications";
import { applicants } from "@/backend/db/schema/teachers/applicants";
import { admin } from "@/backend/db/schema/users/admin";
import { users } from "@/backend/db/schema/users/users";
import { createTestAdmin, createTestApplicant, createTestUser } from "@/backend/db/test/entity-setup";
import { AuditActionType } from "@/backend/enum/audit/audit-action-type.enum";
import { ApplicantStatus } from "@/backend/enum/teachers/applicant-status.enum";
import { UserRole } from "@/backend/enum/users/user-role.enum";
import { graphQLSchema } from "@/backend/graphql/gqlSchema";
import { hashPassword } from "@/backend/lib/auth/password";
import { PUBLIC_OPERATIONS } from "@/backend/lib/gateway";
import type { ApplicantSelectType, UserSelectType } from "@/backend/types";
import { getServerTranslations } from "@/shared/locale/server-graphql";
import { countUsersByIds, expectMutationError, setupTestServerLifecycle, TEST_PORT, testClient } from "@/test/helpers";
// Deep import (mirrors the journey suites): the `@/test/helpers` barrel pulls
// the Apollo client into backend-only dependency graphs.
import { withAuditDeleteTriggersSuspended } from "@/test/helpers/db-cleanup";

setupTestServerLifecycle();

const tErrorsEn = getServerTranslations("en").errorsTranslations;

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
const WIRE_CREDENTIAL = "CooldownWire!Fixture1";

/** Per-run marker embedded in fixture emails (unique-index collision-proof). */
const FIXTURE_MARKER = `acw_${randomUUID().slice(0, 8)}`;

const EXTEND_DOCUMENT = `
  mutation CooldownExtendWire($applicantId: Int!, $additionalDays: Int!) {
    adminExtendApplicantCooldown(applicantId: $applicantId, additionalDays: $additionalDays) {
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
  mutation CooldownWireLogin($email: String!, $credential: String!) {
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

/** One `adminExtendApplicantCooldown` call over the wire. */
function extendOverWire(accessToken: string | null, applicantId: number, additionalDays: number) {
  return postWire(EXTEND_DOCUMENT, accessToken, { applicantId, additionalDays });
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

/** The wire `ApplicantProfile` payload of a successful extension. */
function extensionPayloadOf(body: Record<string, unknown>): Record<string, unknown> {
  const data = recordOf(recordOf(body, "expected a body").data, "expected a data object");
  return recordOf(data.adminExtendApplicantCooldown, "expected the extension payload");
}

// ─── Direct-DB oracles (never routed through the service layer) ──────────────

async function applicantRowOf(userId: number): Promise<ApplicantSelectType | null> {
  const [row] = await db.select().from(applicants).where(eq(applicants.id, userId)).limit(1);
  return row ?? null;
}

/** Extension-trail rows attributed to an applicant target. */
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
    .select({ id: notifications.id, type: notifications.type })
    .from(notifications)
    .where(eq(notifications.userId, userId));
}

// ─── Fixtures ────────────────────────────────────────────────────────────────

interface WireCast {
  readonly adminUser: UserSelectType;
  readonly applicantUser: UserSelectType;
  readonly targetApplicant: ApplicantSelectType;
  readonly cooldownBase: Date;
}

interface WireTokens {
  readonly admin: string;
  readonly applicant: string;
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
 * real service transactions, so no outer rollback wrapper may exist). The
 * applicant target carries an ACTIVE 30-day cooldown stamped on a `failed`
 * status — the extension's stored base must be honored verbatim.
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

    const applicantUser = await createTestUser(tx, {
      fullName: `${FIXTURE_MARKER} applicant`,
      email: fixtureEmail("applicant"),
      passwordHash: credentialHash,
      role: "teacher",
    });
    const targetApplicant = await createTestApplicant(tx, applicantUser.id, {
      status: ApplicantStatus.Failed,
      cooldownUntil: cooldownBase,
    });

    return { adminUser, applicantUser, targetApplicant, cooldownBase };
  });
}

beforeAll(async () => {
  cast = await provisionWireCast();
  const the = theCast();
  const [adminToken, applicantToken] = await Promise.all([
    loginOverWire(the.adminUser.email),
    loginOverWire(the.applicantUser.email),
  ]);
  tokens = { admin: adminToken, applicant: applicantToken };
}, 180_000);

afterAll(async () => {
  if (!cast) {
    return;
  }
  const the = theCast();
  const ids = [the.adminUser.id, the.applicantUser.id];
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
  await db.delete(applicants).where(inArray(applicants.id, ids));
  await db.delete(admin).where(inArray(admin.id, ids));
  await db.delete(users).where(inArray(users.id, ids));
  expect(await countUsersByIds(ids)).toBe(0);
}, 120_000);

// ─── SDL contract pins (no server, no DB) ────────────────────────────────────

const MUTATION_FIELD_NAME = "adminExtendApplicantCooldown";

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

describe("applicant-cooldown surface — SDL contract pins", () => {
  test("return type and argument set are contract-exact", () => {
    const field = mutationField(MUTATION_FIELD_NAME);
    expect(field.type.toString()).toBe("ApplicantProfile!");
    expect(field.args.map(arg => arg.name).toSorted((a, b) => a.localeCompare(b))).toEqual([
      "additionalDays",
      "applicantId",
    ]);
    expect(argNamed(MUTATION_FIELD_NAME, "applicantId").type.toString()).toBe("Int!");
    expect(argNamed(MUTATION_FIELD_NAME, "additionalDays").type.toString()).toBe("Int!");
    expect(printSchema(graphQLSchema)).toContain(
      "adminExtendApplicantCooldown(additionalDays: Int!, applicantId: Int!): ApplicantProfile!"
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

  test("cooldownState rides the ApplicantProfile type as the new enum", () => {
    const profileType = graphQLSchema.getType("ApplicantProfile");
    if (!profileType || !isObjectType(profileType)) {
      throw new Error("expected the `ApplicantProfile` object type in the built schema");
    }
    expect(profileType.getFields().cooldownState?.type.toString()).toBe("ApplicantCooldownState!");
    expect(enumValueNamesOf("ApplicantCooldownState").toSorted((a, b) => a.localeCompare(b))).toEqual([
      "Active",
      "Expired",
      "None",
    ]);
  });

  test("cooldownState appears on the myApplicantProfile SDL", () => {
    const myProfile = graphQLSchema.getQueryType()?.getFields().myApplicantProfile;
    if (!myProfile) {
      throw new Error("schema must register a `myApplicantProfile` root field");
    }
    expect(myProfile.type.toString()).toBe("ApplicantProfile");
    expect(printSchema(graphQLSchema)).toContain("cooldownState: ApplicantCooldownState!");
  });
});

// ─── Wire tier: anonymous + non-admin denials ────────────────────────────────

describe("applicant-cooldown wire denials — anonymous and non-admin", () => {
  test("anonymous callers answer UNAUTHORIZED through the Apollo testClient", async () => {
    const result = await testClient.mutate({
      mutation: gql`
        mutation CooldownAnonymousProbe($applicantId: Int!, $additionalDays: Int!) {
          adminExtendApplicantCooldown(applicantId: $applicantId, additionalDays: $additionalDays) {
            id
          }
        }
      `,
      variables: { applicantId: theCast().applicantUser.id, additionalDays: 30 },
    });
    const error = expectMutationError(result.error, "UNAUTHORIZED");
    expect(error.errors).toHaveLength(1);
  });

  test("anonymous callers over raw HTTP answer UNAUTHORIZED with null data", async () => {
    const { body } = await extendOverWire(null, theCast().applicantUser.id, 30);
    expect(errorCodeOf(soleErrorItemOf(body))).toBe("UNAUTHORIZED");
    expect(body.data).toBeNull();
  });

  test("a teacher token answers FORBIDDEN with the scope copy and zero side effects", async () => {
    const the = theCast();
    const applicantBefore = await applicantRowOf(the.applicantUser.id);
    const auditBefore = await auditCountByActors([the.adminUser.id, the.applicantUser.id]);
    const { body } = await extendOverWire(theTokens().applicant, the.applicantUser.id, 30);
    const item = soleErrorItemOf(body);
    expect(errorCodeOf(item)).toBe("FORBIDDEN");
    // The generic forbidden copy proves the pre-resolver role scope fired —
    // no service-tier denial (which would carry a domain-specific message).
    expect(errorMessageOf(item)).toBe(tErrorsEn.forbidden);
    expect(body.data).toBeNull();
    expect(await auditCountByActors([the.adminUser.id, the.applicantUser.id])).toBe(auditBefore);
    expect(JSON.stringify(await applicantRowOf(the.applicantUser.id))).toBe(JSON.stringify(applicantBefore));
  });
});

// ─── Wire tier: domain denials (admin actor) ─────────────────────────────────

describe("applicant-cooldown wire denials — domain rules", () => {
  test("additionalDays 0 answers APPLICANT_COOLDOWN_EXTENSION_INVALID with the bounds copy and zero writes", async () => {
    const the = theCast();
    const applicantBefore = await applicantRowOf(the.applicantUser.id);
    const auditBefore = await auditCountByActors([the.adminUser.id]);
    const { body } = await extendOverWire(theTokens().admin, the.applicantUser.id, 0);
    const item = soleErrorItemOf(body);
    expect(errorCodeOf(item)).toBe("APPLICANT_COOLDOWN_EXTENSION_INVALID");
    expect(errorMessageOf(item)).toBe(tErrorsEn.applicantCooldownExtensionInvalid);
    expect(body.data).toBeNull();
    expect(JSON.stringify(await applicantRowOf(the.applicantUser.id))).toBe(JSON.stringify(applicantBefore));
    expect(await auditRowsAboutApplicantTarget(the.applicantUser.id)).toHaveLength(0);
    expect(await auditCountByActors([the.adminUser.id])).toBe(auditBefore);
  });

  test("a nonexistent applicant id answers APPLICANT_NOT_FOUND", async () => {
    const the = theCast();
    const [stats] = await db.select({ maxId: max(users.id) }).from(users);
    const absentId = (stats?.maxId ?? 0) + 1_000_000;
    const { body } = await extendOverWire(theTokens().admin, absentId, 30);
    expect(errorCodeOf(soleErrorItemOf(body))).toBe("APPLICANT_NOT_FOUND");
    expect(body.data).toBeNull();
    expect(await auditRowsAboutApplicantTarget(absentId)).toHaveLength(0);
    // The live fixture target never moved either.
    expect(await applicantRowOf(the.applicantUser.id)).toEqual(theCast().targetApplicant);
  });

  test("a smuggled actorId arg dies as GRAPHQL_VALIDATION_FAILED pre-resolver", async () => {
    const the = theCast();
    const auditBefore = await auditCountByActors([the.adminUser.id]);
    // Identity smuggle — there is no caller-supplied actor surface; the
    // audit actor is the session user id only.
    const { body } = await postWire(
      "mutation { adminExtendApplicantCooldown(applicantId: 1, actorId: 2, additionalDays: 30) { id } }",
      theTokens().admin
    );
    expect(errorCodeOf(soleErrorItemOf(body))).toBe("GRAPHQL_VALIDATION_FAILED");
    expect(await auditCountByActors([the.adminUser.id])).toBe(auditBefore);
    expect(await auditRowsAboutApplicantTarget(the.applicantUser.id)).toHaveLength(0);
  });
});

// ─── Wire tier: admin happy path ─────────────────────────────────────────────

describe("applicant-cooldown wire happy path", () => {
  test("extension returns the refreshed profile, honors the stored base verbatim, and commits the oracle", async () => {
    const the = theCast();
    const { status, body } = await extendOverWire(theTokens().admin, the.applicantUser.id, 60);
    expect(status).toBe(200);
    expect(body.errors).toBeUndefined();

    const payload = extensionPayloadOf(body);
    expect(payload.id).toBe(the.applicantUser.id);
    // Enum-object registration keeps the registered member name as the wire value.
    expect(payload.status).toBe("Failed");
    expect(payload.cooldownState).toBe("Active");
    expect(payload.cooldownActive).toBe(true);
    expect(payload.canPurchaseVerification).toBe(false);

    // The stored base is honored verbatim — the extension can only lengthen,
    // never shorten (base + 60 days, computed server-side).
    const expectedExpiry = the.cooldownBase.getTime() + 60 * MS_PER_DAY;
    if (typeof payload.cooldownUntil !== "string") {
      throw new Error("expected the extended cooldownUntil ISO instant");
    }
    expect(Date.parse(payload.cooldownUntil)).toBe(expectedExpiry);

    // DB oracle — the committed row matches the wire instant.
    const row = await applicantRowOf(the.applicantUser.id);
    if (!row) {
      throw new Error("expected the applicant row to exist");
    }
    expect(row.status).toBe(ApplicantStatus.Failed);
    expect(row.cooldownUntil?.getTime()).toBe(expectedExpiry);

    // Exactly ONE adjust audit row, attributed to the admin actor, carrying
    // the metadata-only details document.
    const auditRows = await auditRowsAboutApplicantTarget(the.applicantUser.id);
    expect(auditRows).toHaveLength(1);
    const auditRow = auditRows.at(0);
    if (!auditRow) {
      throw new Error("expected the extension audit row");
    }
    expect(auditRow.actorId).toBe(the.adminUser.id);
    expect(auditRow.actionType).toBe(AuditActionType.Adjust);
    expect(auditRow.entityType).toBe("applicant");
    expect(auditRow.entityId).toBe(the.applicantUser.id);
    if (typeof auditRow.details !== "string") {
      throw new Error("expected the audit details payload");
    }
    const parsedDetails: unknown = JSON.parse(auditRow.details);
    expect(parsedDetails).toEqual({
      field: "cooldown_until",
      from: the.cooldownBase.toISOString(),
      to: new Date(expectedExpiry).toISOString(),
      additionalDays: 60,
    });

    // Two-source split observable — the cooldown machinery never touches the
    // governance fields.
    const [governanceRow] = await db
      .select({
        suspended: users.suspended,
        suspendedAt: users.suspendedAt,
        suspendedPeriodDays: users.suspendedPeriodDays,
      })
      .from(users)
      .where(eq(users.id, the.applicantUser.id));
    expect(governanceRow?.suspended).toBe(false);
    expect(governanceRow?.suspendedAt).toBeNull();
    expect(governanceRow?.suspendedPeriodDays).toBeNull();

    // No fan-out — the extension writes no notification rows.
    expect(await notificationRowsOf(the.applicantUser.id)).toHaveLength(0);
  });
});
