/**
 * Forced-reset operation gate contract tests — paired with
 * `backend/graphql/passwordChangeGate.ts`.
 *
 * Scope: the gate's PURE seams — the closed exemption allowlist, the
 * root-field extraction (fragment spreads flattened), the deny predicate,
 * and the denial carrier — PLUS the REAL Apollo listener glue
 * (`requestDidStart → didResolveOperation` driven end-to-end with a full
 * request context) and the static source scan of the plugin's ONE
 * registration site in `app/api/graphql/apollo-server.ts` — light-harness
 * style, zero DB/boot requirements. The boundary pass-through of the denial
 * is proven through the real `finalizeGraphqlErrors` classifier; the
 * live-wire tier over the booted server belongs to the journey suite.
 *
 * Branch matrix locked here:
 *  - allowlist membership: all 7 exempt names in, closed-set probes out;
 *  - deny predicate: anonymous / un-flagged → no-op; flagged + gated field →
 *    deny; flagged + EACH exempt field → allow; flagged + multi-root
 *    (one exempt + one gated) → deny (per-operation allowlist);
 *  - extraction: direct fields, inline fragments, named spreads (incl. a
 *    root-level spread — the bypass vector), nested spreads, cycle guard;
 *  - denial: FORBIDDEN family + PASSWORD_CHANGE_REQUIRED code + HTTP-200
 *    channel + localized message + ZERO trigger-detail leak;
 *  - REAL listener glue: flagged + gated root → the localized denial thrown
 *    OUT of `didResolveOperation`; un-flagged / allowlisted roots → the
 *    listener resolves untouched (the three live behaviors the pure
 *    predicates cannot prove); registration: `createPasswordChangeGatePlugin(),`
 *    pinned INSIDE the ApolloServer plugins array by source scan.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { type GraphQLRequestContextDidResolveOperation, HeaderMap } from "@apollo/server";
import { buildSchema, type DocumentNode, type GraphQLSchema, type OperationDefinitionNode, parse } from "graphql";
import type { Context } from "@/backend/graphql/gqlContextFactory";
import {
  buildPasswordChangeRequiredDenial,
  createPasswordChangeGatePlugin,
  extractOperationRootFieldNames,
  isExemptRootField,
  isPasswordChangeRequired,
  PASSWORD_CHANGE_EXEMPT_ROOT_FIELDS,
} from "@/backend/graphql/passwordChangeGate";
import { DomainError, ForbiddenError, finalizeGraphqlErrors } from "@/backend/lib/errors";
import type { RegistrationReturnType } from "@/backend/types";
import { getServerTranslations } from "@/shared/locale/server-graphql";

// ─── Fixtures ────────────────────────────────────────────────────────────────

function firstOperationOf(source: string): OperationDefinitionNode {
  const document: DocumentNode = parse(source);
  const operation = document.definitions.find(definition => definition.kind === "OperationDefinition");
  if (operation?.kind !== "OperationDefinition") {
    throw new Error("fixture document carries no operation definition");
  }
  return operation;
}

function flagIdentity(mustChangePassword: boolean): { readonly mustChangePassword: boolean } {
  return { mustChangePassword };
}

/** Assertion-free record guard (the graphqlErrorsFinalizer isRecordValue pattern). */
function isRecordBag(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Runtime-guarded reader for the finalized wire item (no casts). */
function finalizedErrorItem(result: unknown): Record<string, unknown> {
  if (!isRecordBag(result)) {
    throw new Error("expected record-shaped finalized result");
  }
  const errors = result.errors;
  if (!Array.isArray(errors) || errors.length !== 1) {
    throw new Error("expected exactly one finalized error item");
  }
  const item: unknown = errors[0];
  if (!isRecordBag(item)) {
    throw new Error("expected record-shaped error item");
  }
  return item;
}

/** Path to the Apollo engine factory — the plugin's ONE registration site (static source scan, no boot). */
const APOLLO_SERVER_FILE_PATH = "@/app/api/graphql/apollo-server.ts".replace(/^@/, `${process.cwd()}/`);

/**
 * Strips JSDoc + line comments before source scans so pattern matches run
 * against CODE only (the `user-governance.service.test.ts` static-scan
 * precedent — comments often cite the scanned patterns as documentation).
 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*\*[\s\S]*?\*\//g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "");
}

// ─── Closed exemption allowlist ──────────────────────────────────────────────

describe("passwordChangeGate — closed exemption allowlist", () => {
  test("the allowlist constant is the documented closed set, in contract order", () => {
    expect([...PASSWORD_CHANGE_EXEMPT_ROOT_FIELDS]).toEqual([
      "me",
      "changeMyPassword",
      "logout",
      "updateMyLocale",
      "login",
      "registerUser",
      "refreshToken",
    ]);
  });

  test.each([...PASSWORD_CHANGE_EXEMPT_ROOT_FIELDS])("root field `%s` is exempt", fieldName => {
    expect(isExemptRootField(fieldName)).toBe(true);
  });

  test("the allowlist is closed: casing variants, suffixes, and unknown names are gated", () => {
    expect(isExemptRootField("Me")).toBe(false);
    expect(isExemptRootField("ME")).toBe(false);
    expect(isExemptRootField("changeMyPasswords")).toBe(false);
    expect(isExemptRootField("changeMyPasword")).toBe(false);
    expect(isExemptRootField("adminSetUserPassword")).toBe(false);
    expect(isExemptRootField("users")).toBe(false);
    expect(isExemptRootField("adminUsersDirectory")).toBe(false);
    expect(isExemptRootField("")).toBe(false);
  });
});

// ─── Root-field extraction (the fragment-flattening bypass pin) ──────────────

describe("passwordChangeGate — root-field extraction", () => {
  test("collects direct root fields of a multi-root operation", () => {
    const operation = firstOperationOf(`
      query Mixed {
        me { id }
        adminUsersDirectory { id }
      }
    `);
    expect([...extractOperationRootFieldNames(operation, null)].toSorted((a, b) => a.localeCompare(b))).toEqual([
      "adminUsersDirectory",
      "me",
    ]);
  });

  test("flattens INLINE fragments at the root (a gated field cannot hide inside one)", () => {
    const operation = firstOperationOf(`
      mutation Sneaky {
        ... on Mutation {
          adminSetUserPassword(id: 1, input: { password: "x", mustChangePassword: true }) { id }
        }
      }
    `);
    expect([...extractOperationRootFieldNames(operation, null)]).toEqual(["adminSetUserPassword"]);
  });

  test("flattens NAMED fragment spreads at the root — the bypass vector", () => {
    const source = `
      query Sneaky {
        ...RootFields
      }
      fragment RootFields on Query {
        adminUsersDirectory { id }
      }
    `;
    const document = parse(source);
    const operation = firstOperationOf(source);
    expect([...extractOperationRootFieldNames(operation, document)]).toEqual(["adminUsersDirectory"]);
  });

  test("flattens nested fragment spreads transitively", () => {
    const source = `
      mutation Sneaky {
        ...Outer
      }
      fragment Outer on Mutation {
        ...Inner
        logout { success }
      }
      fragment Inner on Mutation {
        adminSetUserDeleted(id: 1, deleted: true) { id }
      }
    `;
    const document = parse(source);
    const operation = firstOperationOf(source);
    expect([...extractOperationRootFieldNames(operation, document)].toSorted((a, b) => a.localeCompare(b))).toEqual([
      "adminSetUserDeleted",
      "logout",
    ]);
  });

  test("visits each spread once — self-referential fragments terminate (defensive cycle guard)", () => {
    const source = `
      query Sneaky {
        ...Loop
      }
      fragment Loop on Query {
        ...Loop
      }
    `;
    const document = parse(source);
    const operation = firstOperationOf(source);
    expect([...extractOperationRootFieldNames(operation, document)]).toEqual([]);
  });

  test("unknown spread names are skipped (GraphQL validation rejects them earlier)", () => {
    const source = `
      query Sneaky {
        ...DoesNotExist
        me { id }
      }
    `;
    const document = parse(source);
    const operation = firstOperationOf(source);
    expect([...extractOperationRootFieldNames(operation, document)]).toEqual(["me"]);
  });

  test("a missing operation yields the empty set (nothing inspectable → nothing gated here)", () => {
    expect([...extractOperationRootFieldNames(null, null)]).toEqual([]);
    expect([...extractOperationRootFieldNames(undefined, undefined)]).toEqual([]);
  });
});

// ─── Deny predicate (per-operation allowlist semantics) ──────────────────────

describe("passwordChangeGate — deny predicate", () => {
  test("anonymous identity is a strict no-op (the scope layer owns the anonymous denial)", () => {
    expect(isPasswordChangeRequired(null, new Set(["adminUsersDirectory"]))).toBe(false);
    expect(isPasswordChangeRequired(undefined, new Set(["users"]))).toBe(false);
  });

  test("an identity without the flag is a strict no-op — zero behavior change", () => {
    expect(isPasswordChangeRequired(flagIdentity(false), new Set(["users"]))).toBe(false);
    expect(isPasswordChangeRequired({}, new Set(["adminUsersDirectory"]))).toBe(false);
  });

  test("a flagged caller is denied on a non-exempt root field", () => {
    expect(isPasswordChangeRequired(flagIdentity(true), new Set(["users"]))).toBe(true);
    expect(isPasswordChangeRequired(flagIdentity(true), new Set(["adminSetUserPassword"]))).toBe(true);
  });

  test.each([...PASSWORD_CHANGE_EXEMPT_ROOT_FIELDS])(
    "a flagged caller stays allowed on the exempt root field `%s`",
    fieldName => {
      expect(isPasswordChangeRequired(flagIdentity(true), new Set([fieldName]))).toBe(false);
    }
  );

  test("the allowlist is per-OPERATION: one exempt + one gated root field denies the whole operation", () => {
    expect(isPasswordChangeRequired(flagIdentity(true), new Set(["me", "users"]))).toBe(true);
    expect(isPasswordChangeRequired(flagIdentity(true), new Set(["changeMyPassword", "logout"]))).toBe(false);
  });

  test("an operation with no inspectable root fields does not deny a flagged caller by itself", () => {
    expect(isPasswordChangeRequired(flagIdentity(true), new Set())).toBe(false);
  });
});

// ─── Denial carrier + boundary pass-through (the wire contract) ──────────────

describe("passwordChangeGate — denial carrier", () => {
  test("is a ForbiddenError-family DomainError carrying the specific forced-reset code", () => {
    const denial = buildPasswordChangeRequiredDenial("You must change your password first.");
    expect(denial).toBeInstanceOf(ForbiddenError);
    expect(denial).toBeInstanceOf(DomainError);
    expect(denial.code).toBe("PASSWORD_CHANGE_REQUIRED");
    expect(denial.extensions.code).toBe("PASSWORD_CHANGE_REQUIRED");
  });

  test("rides the HTTP-200 domain-denial channel (Apollo consumes extensions.http into the status)", () => {
    const denial = buildPasswordChangeRequiredDenial("denied");
    const http: unknown = denial.extensions.http;
    if (!isRecordBag(http)) {
      throw new Error("expected the extensions.http head on the denial");
    }
    expect(http.status).toBe(200);
  });

  test("carries a CONSTANT shape — no requested field name, operation name, or other trigger detail", () => {
    const denial = buildPasswordChangeRequiredDenial(
      getServerTranslations("en").errorsTranslations.passwordChangeRequired
    );
    expect(Object.keys(denial.extensions).toSorted((a, b) => a.localeCompare(b))).toEqual(["code", "http"]);
    expect(denial.message).toBe("You must change your password before you can perform this action.");
    expect(denial.message.includes("adminUsersDirectory")).toBe(false);
    expect(denial.path).toBeUndefined();
  });
});

describe("passwordChangeGate — boundary pass-through of the denial (real finalizer)", () => {
  const tEn = getServerTranslations("en").errorsTranslations;
  const tAr = getServerTranslations("ar").errorsTranslations;

  test("the EN denial passes through with code PASSWORD_CHANGE_REQUIRED, requestId attached, zero leak", () => {
    const denial = buildPasswordChangeRequiredDenial(tEn.passwordChangeRequired);
    const finalized = finalizeGraphqlErrors({ errors: [denial] }, { locale: "en", requestId: "gate-req-en" });
    const item = finalizedErrorItem(finalized);
    expect(item.message).toBe(tEn.passwordChangeRequired);
    const extensions: unknown = item.extensions;
    if (!isRecordBag(extensions)) {
      throw new Error("expected record-shaped extensions on the wire item");
    }
    // `http` is consumed into the HTTP response status and deleted from the
    // item by Apollo's own error enrichment BEFORE the finalizer runs on the
    // live wire — this direct invocation sees the pre-consumption item. The
    // wire carrier therefore carries code + requestId ONLY, plus the
    // localized message: no field, operation, or path trigger detail.
    expect(Object.keys(extensions).toSorted((a, b) => a.localeCompare(b))).toEqual(["code", "http", "requestId"]);
    expect(extensions.code).toBe("PASSWORD_CHANGE_REQUIRED");
    expect(extensions.requestId).toBe("gate-req-en");
    expect(item.path).toBeUndefined();
  });

  test("the AR denial localizes through the same per-request translation seam", () => {
    const denial = buildPasswordChangeRequiredDenial(tAr.passwordChangeRequired);
    const finalized = finalizeGraphqlErrors({ errors: [denial] }, { locale: "ar", requestId: "gate-req-ar" });
    const item = finalizedErrorItem(finalized);
    expect(item.message).toBe(tAr.passwordChangeRequired);
    const extensions: unknown = item.extensions;
    if (!isRecordBag(extensions)) {
      throw new Error("expected record-shaped extensions on the wire item");
    }
    expect(extensions.code).toBe("PASSWORD_CHANGE_REQUIRED");
  });
});

// ─── Plugin registration surface ─────────────────────────────────────────────

describe("passwordChangeGate — plugin registration surface", () => {
  test("factory exposes exactly the requestDidStart hook (guard fires before execution)", () => {
    const plugin = createPasswordChangeGatePlugin();
    const keys = Object.keys(plugin);
    expect(keys).toHaveLength(1);
    expect(keys[0]).toBe("requestDidStart");
    expect(typeof plugin.requestDidStart).toBe("function");
  });

  test("apollo-server.ts registers createPasswordChangeGatePlugin() INSIDE the ApolloServer plugins array (the one enforcement seam)", () => {
    // Static source scan over the engine factory (the
    // user-governance.service.test.ts withTransaction-census precedent):
    // the plugin's composition is the enforcement seam — an unregistered
    // gate enforces nothing, and no wire suite logs in a FLAGGED caller, so
    // this scan is the ONLY executable pin of the registration.
    const source = stripComments(readFileSync(APOLLO_SERVER_FILE_PATH, "utf8"));
    // The gate module is imported by the engine factory…
    expect(source.includes(`from "@/backend/graphql/passwordChangeGate"`)).toBe(true);
    // …and the trailing-comma invocation is the REGISTRATION itself — a
    // mere import (or a comment mention) enforces nothing. Exactly once.
    expect(source.split("createPasswordChangeGatePlugin(),").length - 1).toBe(1);
    // …and the invocation sits INSIDE the `plugins: [...]` literal, between
    // the array opening and its closing bracket.
    const pluginsStart = source.indexOf("plugins: [");
    if (pluginsStart < 0) {
      throw new Error("expected the plugins array literal in apollo-server.ts");
    }
    const pluginsArrayEnd = source.indexOf("],", pluginsStart);
    if (pluginsArrayEnd < 0) {
      throw new Error("expected the plugins array literal to close");
    }
    const registration = source.indexOf("createPasswordChangeGatePlugin(),");
    expect(registration > pluginsStart && registration < pluginsArrayEnd).toBe(true);
  });
});

// ─── REAL listener glue (requestDidStart → didResolveOperation) ──────────────

/** Any schema satisfies the request-context contract — the gate never inspects it. */
const minimalSchema: GraphQLSchema = buildSchema("type Query { _gateFixture: Boolean }");

/**
 * A full `RegistrationReturnType` user row (the exact `ctx.user` shape —
 * `passwordHash` structurally omitted, `preferredRecitation` always
 * materialized) with ONLY the forced-reset flag parameterized. Field set
 * mirrors the `parent-monitoring.helpers.test.ts` `baseUser` row fixture.
 */
function gateUserRow(mustChangePassword: boolean): RegistrationReturnType {
  return {
    id: 4242,
    fullName: "Gate Fixture",
    email: "gate-fixture@test.local",
    phone: null,
    mustChangePassword,
    role: "student",
    dateOfBirth: null,
    gender: null,
    country: null,
    countryCode: null,
    locale: "en",
    isDeleted: false,
    deletedAt: null,
    suspended: false,
    suspendedAt: null,
    suspendedPeriodDays: null,
    isBlocked: false,
    blockedAt: null,
    lastActiveAt: null,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    preferredRecitation: null,
  };
}

/**
 * Minimal but COMPLETE `Context` literal — the gate reads `ctx.user` and
 * `ctx.locale` ONLY; every other member exists so the literal satisfies the
 * production `Context` contract without any unsafe type assertion.
 */
function gateContext(user: RegistrationReturnType | null): Context {
  return {
    locale: "en",
    requestId: "gate-req",
    idempotencyKey: null,
    t: async () => {
      throw new Error("ctx.t is never consulted by the gate plugin");
    },
    user,
    safeUser: user,
    permissions: [],
    isSuperAdmin: false,
    role: null,
    cookies: {},
    // Per-request Set-Cookie accumulator — empty: the gate performs no writes.
    authCookieOut: [],
  };
}

/**
 * Builds the FULL `didResolveOperation`-stage request context Apollo hands
 * the listener — every member of the production shape, minimally valued.
 * The literal is checked against the real
 * `GraphQLRequestContextDidResolveOperation<Context>` contract (no casts);
 * the same object is also a valid `requestDidStart` argument, since that
 * stage's context is the strictly-narrower base shape.
 */
function gateRequestContext(
  source: string,
  user: RegistrationReturnType | null
): GraphQLRequestContextDidResolveOperation<Context> {
  const document: DocumentNode = parse(source);
  const operation = document.definitions.find(
    (definition): definition is OperationDefinitionNode => definition.kind === "OperationDefinition"
  );
  if (!operation) {
    throw new Error("gate fixture document carries no operation definition");
  }
  return {
    logger: { debug() {}, info() {}, warn() {}, error() {} },
    cache: { get: async () => undefined, set: async () => {}, delete: async () => false },
    request: { query: source, operationName: operation.name?.value, variables: {} },
    response: { http: { status: 200, headers: new HeaderMap() } },
    schema: minimalSchema,
    contextValue: gateContext(user),
    source,
    queryHash: "password-change-gate-fixture",
    operationName: operation.name?.value ?? null,
    operation,
    document,
    metrics: {},
    overallCachePolicy: { replace: () => {}, restrict: () => {}, policyIfCacheable: () => null },
    requestIsBatched: false,
  };
}

/**
 * Drives the REAL glue exactly as Apollo's request pipeline does:
 * `createPasswordChangeGatePlugin()` → `requestDidStart(...)` → the returned
 * listener's `didResolveOperation(...)` — the seam that runs AFTER
 * parse/validation and BEFORE any resolver.
 */
async function invokeGateDidResolveOperation(source: string, user: RegistrationReturnType | null): Promise<void> {
  const plugin = createPasswordChangeGatePlugin();
  const requestContext = gateRequestContext(source, user);
  const listener = await plugin.requestDidStart?.(requestContext);
  if (!listener) {
    throw new Error("the gate plugin must return a request listener from requestDidStart");
  }
  const didResolveOperation = listener.didResolveOperation;
  if (!didResolveOperation) {
    throw new Error("the gate listener must expose didResolveOperation");
  }
  await didResolveOperation.call(listener, requestContext);
}

/** Captures a rejection as a value (no-cast error capture). */
async function rejectionOf(promise: Promise<void>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("expected the operation to be rejected");
}

describe("passwordChangeGate — REAL listener glue (requestDidStart → didResolveOperation)", () => {
  const tEn = getServerTranslations("en").errorsTranslations;

  test("a FLAGGED caller on a non-allowlisted root field is denied by the REAL listener with the constant PASSWORD_CHANGE_REQUIRED shape", async () => {
    const denial = await rejectionOf(
      invokeGateDidResolveOperation("query Sneaky { adminUsersDirectory { id } }", gateUserRow(true))
    );
    if (!(denial instanceof ForbiddenError)) {
      throw new Error("expected a ForbiddenError-family denial from the gate listener");
    }
    expect(denial).toBeInstanceOf(DomainError);
    expect(denial.code).toBe("PASSWORD_CHANGE_REQUIRED");
    expect(denial.extensions.code).toBe("PASSWORD_CHANGE_REQUIRED");
    // Constant shape — exactly the localized message + code + 200 channel:
    // ZERO trigger-detail leak (no requested field name, no operation name,
    // no path), so the denial cannot be used as a field-discovery oracle.
    expect(Object.keys(denial.extensions).toSorted((a, b) => a.localeCompare(b))).toEqual(["code", "http"]);
    expect(denial.message).toBe(tEn.passwordChangeRequired);
    expect(denial.message.includes("adminUsersDirectory")).toBe(false);
    expect(denial.path).toBeUndefined();
  });

  test("an UN-FLAGGED caller on the same gated root field passes the REAL listener untouched (zero behavior change)", async () => {
    // A denial would reject out of the await and fail the test; the
    // lexically visible expect() pins the resolved-void outcome.
    const resolved = await invokeGateDidResolveOperation(
      "query Sneaky { adminUsersDirectory { id } }",
      gateUserRow(false)
    );
    expect(resolved).toBeUndefined();
  });

  test("a FLAGGED caller on allowlisted root fields passes the REAL listener untouched (the self-service escape hatches stay reachable)", async () => {
    const meResolved = await invokeGateDidResolveOperation("query SessionRestore { me { id } }", gateUserRow(true));
    expect(meResolved).toBeUndefined();
    const changeResolved = await invokeGateDidResolveOperation(
      `mutation ClearFlag { changeMyPassword(input: { currentPassword: "irrelevant", newPassword: "irrelevant2" }) { id } }`,
      gateUserRow(true)
    );
    expect(changeResolved).toBeUndefined();
  });
});
