/**
 * Handshake-code GraphQL surface assertion suite — the unit-tier schema gate
 * for the two student-handshake queries and their `HandshakeCodeLookup`
 * object.
 *
 * What this locks down:
 *  - **Field surface** — `myHandshakeCode: String!` with ZERO arguments
 *    (identity is context-derived only — there is structurally no
 *    caller-supplied lookup surface); `findStudentByHandshakeCode(code:
 *    String!): HandshakeCodeLookup` with a NULLABLE payload (miss and
 *    governance collapse both answer `null`, never an error) and exactly ONE
 *    argument — the code is the ONLY client-controllable input.
 *  - **Declared scopes** — both fields carry EXACTLY
 *    `{ $all: { authenticated: true, role: [UserRole.Student|Parent] } }`
 *    (read off the built schema's `pothosOptions.authScopes` snapshot, the
 *    same introspection substrate as `allowlist-coverage.test.ts`), with the
 *    `$all` conjunction shape pinned (ANY-semantics plain maps are the
 *    documented wrong answer) and the sibling/teacher/admin roles provably
 *    ABSENT from each field's role set (no admin/supervisor read override).
 *  - **Object shape closure** — `HandshakeCodeLookup` exposes EXACTLY
 *    `maskedName: String!` + `linkable: Boolean!` and carries NO `id` field
 *    (embedded value type; proven at the type level AND behaviorally —
 *    selecting `id` fails validation).
 *  - **Scope evaluation over the real engine** — anonymous callers receive
 *    `UNAUTHORIZED` (401 semantics) and authenticated wrong-role callers
 *    (sibling role on each query, teacher, admin) receive `FORBIDDEN` (403
 *    semantics), executed through the built schema with the scope-auth
 *    plugin. The denial fires BEFORE any resolver execution — evidenced by
 *    the scope error codes themselves (a leaky scope map would run the
 *    resolver and surface the service's outcome instead). The full
 *    end-to-end role matrix over real tokens lives in the integration tier.
 *  - **Allowlist posture** — both names are scoped operations, absent from
 *    the closed `PUBLIC_OPERATIONS` registry (which itself stays exactly the
 *    frozen six — this ticket adds no anonymous surface).
 *
 * Pure unit tier — NO server boot, NO network, NO DB (scope denials fire
 * pre-resolver; happy paths are integration-tier territory). Runs via the
 * mandated runner:
 * `bun run test/scripts/run-test.ts backend/graphql/test/handshake-code-surface.test.ts`
 */

import { describe, expect, test } from "bun:test";
import { GraphQLObjectType, graphql, parse, validate } from "graphql";
import { UserRole } from "@/backend/enum/users/user-role.enum";
import { graphQLSchema } from "@/backend/graphql/gqlSchema";
import { PUBLIC_OPERATION_NAMES, PUBLIC_OPERATIONS } from "@/backend/lib/gateway";

// ─── Introspection helpers (guarded — no unsafe casts, per test-tier discipline) ──

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * Reads the `authScopes` declaration off one root field through the Pothos
 * extension snapshot. Returns `undefined` for any field authored WITHOUT a
 * scope block (see `allowlist-coverage.test.ts` for the same technique).
 */
function declaredAuthScopes(rootField: unknown): unknown {
  const extensions: unknown = Reflect.get(isRecord(rootField) ? rootField : {}, "extensions");
  if (!isRecord(extensions)) return undefined;
  const pothosOptions: unknown = Reflect.get(extensions, "pothosOptions");
  if (!isRecord(pothosOptions)) return undefined;
  return Reflect.get(pothosOptions, "authScopes");
}

/** The role array inside a field's `$all` scope conjunction (empty when absent). */
function scopeRoles(scopes: unknown): readonly string[] {
  if (!isRecord(scopes)) return [];
  const all: unknown = Reflect.get(scopes, "$all");
  if (!isRecord(all)) return [];
  const roles: unknown = Reflect.get(all, "role");
  return Array.isArray(roles) ? roles : [];
}

/** The key names inside a field's `$all` scope conjunction (empty when absent). */
function scopeKeys(scopes: unknown): readonly string[] {
  if (!isRecord(scopes)) return [];
  const all: unknown = Reflect.get(scopes, "$all");
  if (!isRecord(all)) return [];
  return Object.keys(all).toSorted((a, b) => a.localeCompare(b));
}

function queryField(name: string) {
  const fields = graphQLSchema.getQueryType()?.getFields();
  if (!fields) {
    throw new Error("Schema must define a root Query type");
  }
  const field = fields[name];
  if (!field) {
    throw new Error(`Query must register a \`${name}\` root field`);
  }
  return field;
}

const selfRead = queryField("myHandshakeCode");
const discovery = queryField("findStudentByHandshakeCode");

/** Selection used for scope-evaluation probes (never executes on denied cells). */
const DISCOVERY_SOURCE = "query ($code: String!) { findStudentByHandshakeCode(code: $code) { maskedName linkable } }";

// ─── Field surface ──────────────────────────────────────────────────────────

describe("handshake query surface — field types & argument contracts", () => {
  test("`myHandshakeCode` is NON-NULLABLE `String!`", () => {
    expect(selfRead.type.toString()).toBe("String!");
  });

  test("`myHandshakeCode` accepts ZERO arguments (no caller-supplied identity surface)", () => {
    expect(selfRead.args).toHaveLength(0);
  });

  test("`findStudentByHandshakeCode` is NULLABLE `HandshakeCodeLookup` (miss/governed → null)", () => {
    expect(discovery.type.toString()).toBe("HandshakeCodeLookup");
  });

  test("`findStudentByHandshakeCode` takes EXACTLY one argument: `code: String!`", () => {
    expect(discovery.args.map(arg => arg.name)).toEqual(["code"]);
    expect(discovery.args[0]?.type.toString()).toBe("String!");
  });
});

// ─── Declared scopes ────────────────────────────────────────────────────────

describe("handshake query scopes — documented authScopes pinned", () => {
  test("`myHandshakeCode` carries the student `$all` conjunction verbatim", () => {
    expect(declaredAuthScopes(selfRead)).toEqual({
      $all: { authenticated: true, role: [UserRole.Student] },
    });
  });

  test("`findStudentByHandshakeCode` carries the parent `$all` conjunction verbatim", () => {
    expect(declaredAuthScopes(discovery)).toEqual({
      $all: { authenticated: true, role: [UserRole.Parent] },
    });
  });

  test("both fields use the explicit `$all` shape with EXACTLY the authenticated+role keys", () => {
    // A plain scope map combines with ANY semantics (the documented wrong
    // answer) — the conjunction key must be present on both fields.
    expect(scopeKeys(declaredAuthScopes(selfRead))).toEqual(["authenticated", "role"]);
    expect(scopeKeys(declaredAuthScopes(discovery))).toEqual(["authenticated", "role"]);
  });

  test("NO admin/supervisor read override — sibling, teacher, and admin roles are absent from each role set", () => {
    // Sibling-role denials are part of the design: parents cannot self-read,
    // students cannot discover.
    expect(scopeRoles(declaredAuthScopes(selfRead))).toEqual([UserRole.Student]);
    expect(scopeRoles(declaredAuthScopes(selfRead))).not.toContain(UserRole.Parent);
    expect(scopeRoles(declaredAuthScopes(discovery))).toEqual([UserRole.Parent]);
    expect(scopeRoles(declaredAuthScopes(discovery))).not.toContain(UserRole.Student);
    for (const scopes of [declaredAuthScopes(selfRead), declaredAuthScopes(discovery)]) {
      expect(scopeRoles(scopes)).not.toContain(UserRole.Teacher);
      expect(scopeRoles(scopes)).not.toContain(UserRole.Admin);
    }
  });
});

// ─── Object shape closure ───────────────────────────────────────────────────

describe("HandshakeCodeLookup object shape — two fields, no id", () => {
  const lookupType = graphQLSchema.getType("HandshakeCodeLookup");

  test("is registered as an object type backed by the canonical ref", () => {
    expect(lookupType).toBeInstanceOf(GraphQLObjectType);
  });

  test("discloses EXACTLY `maskedName: String!` and `linkable: Boolean!`", () => {
    if (!(lookupType instanceof GraphQLObjectType)) {
      throw new Error("HandshakeCodeLookup must be registered as a GraphQL object type");
    }
    const fields = lookupType.getFields();

    expect(Object.keys(fields).toSorted((a, b) => a.localeCompare(b))).toEqual(["linkable", "maskedName"]);
    expect(fields.maskedName?.type.toString()).toBe("String!");
    expect(fields.linkable?.type.toString()).toBe("Boolean!");
  });

  test("carries NO `id` field — embedded value object with no database identity", () => {
    if (!(lookupType instanceof GraphQLObjectType)) {
      throw new Error("HandshakeCodeLookup must be registered as a GraphQL object type");
    }
    expect(Object.hasOwn(lookupType.getFields(), "id")).toBe(false);
  });

  test("selecting `id` on a discovery result FAILS validation (behavioral no-id proof)", () => {
    const document = parse("query ($code: String!) { findStudentByHandshakeCode(code: $code) { id } }");
    const errors = validate(graphQLSchema, document);

    expect(errors).toHaveLength(1);
    expect(errors[0]?.message).toContain('Cannot query field "id" on type "HandshakeCodeLookup"');
  });

  test("selecting `maskedName linkable` validates clean (the closed payload surface)", () => {
    const errors = validate(graphQLSchema, parse(DISCOVERY_SOURCE));
    expect(errors).toHaveLength(0);
  });
});

// ─── Scope evaluation over the real engine (anonymous vs wrong role) ───────

describe("scope evaluation — 401 for anonymous, 403 for wrong role (pre-resolver)", () => {
  const DENIED_ROLES_ON_SELF_READ = [UserRole.Parent, UserRole.Teacher, UserRole.Admin] as const;
  const DENIED_ROLES_ON_DISCOVERY = [UserRole.Student, UserRole.Teacher, UserRole.Admin] as const;

  test("anonymous callers receive UNAUTHORIZED (401 semantics) on BOTH queries", async () => {
    const selfReadOutcome = await graphql({
      schema: graphQLSchema,
      source: "{ myHandshakeCode }",
      contextValue: { locale: "en" },
    });
    const discoveryOutcome = await graphql({
      schema: graphQLSchema,
      source: DISCOVERY_SOURCE,
      variableValues: { code: "KSB-00000000" },
      contextValue: { locale: "en" },
    });

    const selfReadErrors = selfReadOutcome.errors;
    const discoveryErrors = discoveryOutcome.errors;
    if (!selfReadErrors || !discoveryErrors) {
      throw new Error("anonymous execution must produce exactly one GraphQL error per query");
    }
    expect(selfReadErrors).toHaveLength(1);
    expect(selfReadErrors[0]?.extensions?.code).toBe("UNAUTHORIZED");
    expect(discoveryErrors).toHaveLength(1);
    expect(discoveryErrors[0]?.extensions?.code).toBe("UNAUTHORIZED");
  });

  test.each(DENIED_ROLES_ON_SELF_READ.map(role => [role]))(
    "authenticated %s on `myHandshakeCode` receives FORBIDDEN (403 semantics)",
    async role => {
      const outcome = await graphql({
        schema: graphQLSchema,
        source: "{ myHandshakeCode }",
        contextValue: { locale: "en", role, user: { id: 1 } },
      });
      const errors = outcome.errors;
      if (!errors) {
        throw new Error("denied execution must produce exactly one GraphQL error");
      }

      expect(errors).toHaveLength(1);
      expect(errors[0]?.extensions?.code).toBe("FORBIDDEN");
    }
  );

  test.each(DENIED_ROLES_ON_DISCOVERY.map(role => [role]))(
    "authenticated %s on `findStudentByHandshakeCode` receives FORBIDDEN (403 semantics)",
    async role => {
      const outcome = await graphql({
        schema: graphQLSchema,
        source: DISCOVERY_SOURCE,
        variableValues: { code: "KSB-00000000" },
        contextValue: { locale: "en", role, user: { id: 1 } },
      });
      const errors = outcome.errors;
      if (!errors) {
        throw new Error("denied execution must produce exactly one GraphQL error");
      }

      expect(errors).toHaveLength(1);
      expect(errors[0]?.extensions?.code).toBe("FORBIDDEN");
    }
  );
});

// ─── Public-operation allowlist posture ─────────────────────────────────────

describe("public-operation allowlist posture — scoped, not anonymous", () => {
  test("both handshake queries are ABSENT from the closed public-operation registry", () => {
    expect(PUBLIC_OPERATIONS.has("myHandshakeCode")).toBe(false);
    expect(PUBLIC_OPERATIONS.has("findStudentByHandshakeCode")).toBe(false);
  });

  test("the allowlist itself stays EXACTLY the frozen six (untouched by this surface)", () => {
    // Typed `string[]` (mutable view) so bun's `toEqual` overload accepts the
    // matcher argument verbatim — same convention as `allowlist-coverage.test.ts`.
    const publicNamesSorted: string[] = [...PUBLIC_OPERATION_NAMES].toSorted((a, b) => a.localeCompare(b));
    const frozenSorted: string[] = [
      "login",
      "refreshToken",
      "logout",
      "registerUser",
      "recitationReadings",
      "_health",
    ].toSorted((a, b) => a.localeCompare(b));

    expect(publicNamesSorted).toEqual(frozenSorted);
  });
});
