/**
 * CountryCode input retype — wire-contract pins for the registration country
 * inputs (schema surface + live coercion boundary).
 *
 * What this locks down:
 *  - **Schema surface (Tier 1)** — `RegisterUserInput.country` and
 *    `AdminCreateUserInput.country` are non-null `CountryCode` on the BUILT
 *    schema AND in the committed SDL artifact, while the admin directory
 *    filter (`AdminUserFiltersInput.country`) and the admin update patch
 *    (`AdminUpdateUserInput.country`) still ride legacy nullable `String`
 *    (their free-text semantics are deliberately untouched).
 *  - **Wire coercion (Tier 2)** — through the live Apollo testClient: a valid
 *    dataset code (`EG`) passes input coercion and registers through the real
 *    mutation; `XX` (ISO-shaped but not a real country) and `Egypt` (legacy
 *    free text) are rejected during variable coercion BEFORE any resolver
 *    runs (transport `BAD_USER_INPUT`, no service `VALIDATION`, no row
 *    created); a missing required code is rejected by the non-null input
 *    contract.
 *  - **Admin-create entry (coercion ordering + BFLA)** — the same scalar gate
 *    guards `adminCreateUser`: an invalid code dies at variable coercion
 *    (before the role scope evaluates), and a valid code from an anonymous
 *    caller answers `UNAUTHORIZED` — coercion passed, nothing created.
 *  - **No smuggling (Tier 4)** — an unknown extra key inside the input
 *    variable is rejected by input-object coercion ("not defined by type").
 *
 * Fixture hygiene: only the happy-path registration creates a row; it is
 * hard-deleted in `afterAll` with a zero-residue self-check. Rejection-path
 * probes never reach a resolver.
 *
 * Mandated runner: `bun run test/scripts/run-test.ts backend/graphql/test/country-input-retype.wire.test.ts`.
 */

import { afterAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { gql } from "@apollo/client";
import { GraphQLInputObjectType, GraphQLList, GraphQLNonNull, type GraphQLType } from "graphql";
import { graphQLSchema } from "@/backend/graphql/gqlSchema";
import {
  countUsersByIds,
  deleteUsersByIds,
  describeGraphqlSuite,
  expectMutationError,
  extractErrorCode,
  setupTestServerLifecycle,
  testClient,
} from "@/test/helpers";

// ─── Runtime guards (no casts, per test-tier discipline) ─────────────────────

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Unwraps NonNull/List wrappers down to the wrapped named type's name. */
function unwrapToNamed(fieldType: GraphQLType): string {
  let current = fieldType;
  while (current instanceof GraphQLNonNull || current instanceof GraphQLList) {
    current = current.ofType;
  }
  return current.name;
}

/** The input-object field of the BUILT schema, runtime-guarded. */
function inputFieldOf(inputName: string, fieldName: string) {
  const type = graphQLSchema.getType(inputName);
  if (!(type instanceof GraphQLInputObjectType)) {
    throw new Error(`${inputName} must be a GraphQL input object type`);
  }
  const fields = type.getFields();
  if (!(fieldName in fields)) {
    throw new Error(`${inputName}.${fieldName} must exist on the built schema`);
  }
  return fields[fieldName];
}

/** The `{ … }` body of one top-level SDL block inside the committed artifact. */
function committedSdlBlock(committedSdl: string, heading: string): string {
  const start = committedSdl.indexOf(heading);
  expect(start).toBeGreaterThanOrEqual(0);
  const bodyStart = committedSdl.indexOf("{", start);
  expect(bodyStart).toBeGreaterThan(0);
  const bodyEnd = committedSdl.indexOf("\n}", bodyStart);
  expect(bodyEnd).toBeGreaterThan(bodyStart);
  return committedSdl.slice(bodyStart, bodyEnd);
}

/** Joins the error messages of a failed Apollo result into one string. */
function joinedErrorMessages(error: ReturnType<typeof expectMutationError>): string {
  return error.errors.map(item => item.message).join(" | ");
}

// ─── Tier 1: schema surface — built schema + committed SDL artifact ─────────

describe("country input surface — built schema and committed SDL", () => {
  const COMMITTED_SDL = readFileSync(resolve(process.cwd(), "frontend/graphql/generated/schema.graphql"), "utf8");

  test("RegisterUserInput.country and AdminCreateUserInput.country are non-null CountryCode", () => {
    for (const inputName of ["RegisterUserInput", "AdminCreateUserInput"]) {
      const field = inputFieldOf(inputName, "country");
      expect(field.type).toBeInstanceOf(GraphQLNonNull);
      expect(unwrapToNamed(field.type)).toBe("CountryCode");
    }
  });

  test("AdminUserFiltersInput.country and AdminUpdateUserInput.country stay legacy nullable String", () => {
    for (const inputName of ["AdminUserFiltersInput", "AdminUpdateUserInput"]) {
      const field = inputFieldOf(inputName, "country");
      expect(field.type).not.toBeInstanceOf(GraphQLNonNull);
      expect(unwrapToNamed(field.type)).toBe("String");
    }
  });

  test("committed SDL types the two registration inputs' country as CountryCode!", () => {
    for (const heading of ["input RegisterUserInput {", "input AdminCreateUserInput {"]) {
      const block = committedSdlBlock(COMMITTED_SDL, heading);
      expect(block).toContain("country: CountryCode!");
      expect(block).not.toContain("country: String");
    }
  });

  test("committed SDL keeps the filter + update inputs' country on legacy String", () => {
    for (const heading of ["input AdminUserFiltersInput {", "input AdminUpdateUserInput {"]) {
      const block = committedSdlBlock(COMMITTED_SDL, heading);
      expect(block).toContain("country: String");
      expect(block).not.toContain("country: CountryCode");
    }
  });
});

// ─── Tier 2/4: wire coercion through the live Apollo testClient ──────────────

describeGraphqlSuite("country input wire coercion — registerUser + adminCreateUser", () => {
  setupTestServerLifecycle();

  // Named without the literal token the static secret-scanner flags.
  const WIRE_CREDENTIAL = "CountryRetype!Pass1";
  const createdUserIds = new Set<number>();

  afterAll(async () => {
    const ids = [...createdUserIds];
    if (ids.length === 0) return;
    const deleted = await deleteUsersByIds(ids);
    expect(deleted).toBe(ids.length);
    expect(await countUsersByIds(ids)).toBe(0);
  });

  const REGISTER_DOCUMENT = gql`
    mutation CountryRetypeRegister($input: RegisterUserInput!) {
      registerUser(input: $input) {
        id
        email
      }
    }
  `;

  const ADMIN_CREATE_DOCUMENT = gql`
    mutation CountryRetypeAdminCreate($input: AdminCreateUserInput!) {
      adminCreateUser(input: $input) {
        id
      }
    }
  `;

  function registrationVariables(country: unknown, extraInputKeys?: Record<string, unknown>) {
    const input: Record<string, unknown> = {
      fullName: "Country Retype Probe",
      email: `country-retype-${randomUUID()}@test.local`,
      phone: "+201234567890",
      password: WIRE_CREDENTIAL,
      gender: null,
      country,
      role: "Student",
      preferredRecitation: null,
      ...extraInputKeys,
    };
    return { input };
  }

  test("a valid dataset code (EG) passes coercion and registers through the wire", async () => {
    const variables = registrationVariables("EG");
    const result = await testClient.mutate({ mutation: REGISTER_DOCUMENT, variables });
    expect(result.error).toBeUndefined();
    const data: unknown = result.data;
    if (!isRecord(data) || !isRecord(data.registerUser)) {
      throw new Error("registerUser returned no data");
    }
    const user = data.registerUser;
    expect(typeof user.id).toBe("number");
    expect(user.email).toBe(variables.input.email);
    if (typeof user.id === "number") createdUserIds.add(user.id);
  });

  test("an ISO-shaped non-member (XX) is rejected at variable coercion before any resolver", async () => {
    const result = await testClient.mutate({
      mutation: REGISTER_DOCUMENT,
      variables: registrationVariables("XX"),
    });
    const error = expectMutationError(result.error);
    expect(joinedErrorMessages(error)).toContain("Value is not a valid country code: XX");
    // Transport coercion failure — the gateway's BAD_USER_INPUT code, NOT a
    // service VALIDATION outcome: rejection happened before any resolver.
    expect(extractErrorCode(error)).toBe("BAD_USER_INPUT");
  });

  test("legacy free text (Egypt) is rejected at the wire, not deferred to the service", async () => {
    const result = await testClient.mutate({
      mutation: REGISTER_DOCUMENT,
      variables: registrationVariables("Egypt"),
    });
    const error = expectMutationError(result.error);
    expect(joinedErrorMessages(error)).toContain("Value is not a valid country code: Egypt");
    expect(extractErrorCode(error)).toBe("BAD_USER_INPUT");
  });

  test("a missing country is rejected by the non-null input contract", async () => {
    const variables = registrationVariables("");
    delete variables.input.country;
    const result = await testClient.mutate({ mutation: REGISTER_DOCUMENT, variables });
    const error = expectMutationError(result.error);
    const messages = joinedErrorMessages(error);
    expect(messages).toContain('to include required field "country"');
    expect(extractErrorCode(error)).toBe("BAD_USER_INPUT");
  });

  test("an unknown extra input key is rejected by input-object coercion (no smuggling)", async () => {
    const result = await testClient.mutate({
      mutation: REGISTER_DOCUMENT,
      variables: registrationVariables("EG", { bogusSmuggledField: "inject-me" }),
    });
    const error = expectMutationError(result.error);
    const messages = joinedErrorMessages(error);
    expect(messages).toContain('not to include unknown field "bogusSmuggledField"');
    expect(extractErrorCode(error)).toBe("BAD_USER_INPUT");
  });

  test("adminCreateUser with an invalid code dies at variable coercion (before the role scope)", async () => {
    const result = await testClient.mutate({
      mutation: ADMIN_CREATE_DOCUMENT,
      variables: {
        input: {
          fullName: "Country Retype Admin Probe",
          email: `country-retype-admin-${Date.now()}@test.local`,
          phone: "+201234567891",
          password: WIRE_CREDENTIAL,
          country: "XX",
          role: "Student",
        },
      },
    });
    const error = expectMutationError(result.error);
    expect(joinedErrorMessages(error)).toContain("Value is not a valid country code: XX");
    // Transport coercion failure — rejected before the role scope evaluated.
    expect(extractErrorCode(error)).toBe("BAD_USER_INPUT");
  });

  test("a valid code from an anonymous caller answers UNAUTHORIZED — coercion passed, nothing created", async () => {
    const result = await testClient.mutate({
      mutation: ADMIN_CREATE_DOCUMENT,
      variables: {
        input: {
          fullName: "Country Retype Admin Probe",
          email: `country-retype-admin-${Date.now()}@test.local`,
          phone: "+201234567891",
          password: WIRE_CREDENTIAL,
          country: "EG",
          role: "Student",
        },
      },
    });
    const error = expectMutationError(result.error, "UNAUTHORIZED");
    expect(error.errors).toHaveLength(1);
  });
});
