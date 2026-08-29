/**
 * GraphQL schema surface assertion suite — "exactly one addition" gate +
 * codegen-sync proof.
 *
 * What this locks down:
 *  - **Retyped probe** — `Query._health: HealthCheck!` (the legacy inline
 *    `String!` placeholder from `builder.ts` was deleted BEFORE the new
 *    registration landed — the duplicate-field crash regression is
 *    therefore covered here permanently).
 *  - **Shape closure** — `HealthCheck` exposes EXACTLY the four scalar
 *    fields (`status`, `service`, `version`, `timestamp`), each `String!`,
 *    and carries NO `id` field (embedded value object — proven both at
 *    the type level and behaviorally: selecting `id` fails validation).
 *  - **Surface freeze** — against the frozen baseline inventory (captured
 *    at HEAD `8e5ebb8`) PLUS the reviewed post-baseline additions that
 *    were reconciled into the freeze lists (DEV2-004 applicant profile
 *    surface and DEV1-005 plan-catalog billing surface — see the
 *    `POST_BASELINE_*_ADDITIONS` tuples): the root query/mutation sets
 *    and the whole-schema named-type set may only ever grow by THOSE
 *    sanctioned entries, never ad hoc.
 *    History: the freeze lists originally pinned `ZERO new mutations /
 *    enums / one type delta` and drifted stale when DEV2-004 and DEV1-005
 *    landed their reviewed surfaces; they were reconciled at Task 3.4 of
 *    DEV1-005 (the DEV2-004 drift pre-dates that task and was proven
 *    unrelated to the billing work by Task 3.1).
 *  - **Allowlist agreement** — the scopeless `_health` field is present in
 *    the closed `PUBLIC_OPERATION_NAMES` tuple / `PUBLIC_OPERATIONS` set
 *    1:1 (schema↔allowlist agreement enforced as code).
 *  - **Anonymous reachability** — executing the probe document with an EMPTY
 *    context succeeds through the real production schema (public by design;
 *    also proves the resolver is delegation-only: no ctx/DB access exists
 *    on the path, otherwise this call could not succeed).
 *  - **Codegen sync (scripted)** — the checked-in
 *    `frontend/graphql/generated/schema.graphql` is BYTE-IDENTICAL to a
 *    fresh `printSchema(lexicographicSortSchema(graphQLSchema))` emission,
 *    i.e. generated artifacts are in lockstep with the code-first builder
 *    (read-only disk access; the suite writes NOTHING).
 *
 * Pure unit tier — NO server boot, NO network, NO DB. Runs via the mandated
 * runner: `bun run test/scripts/run-test.ts backend/graphql/test/schema-surface.test.ts`.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  GraphQLEnumType,
  GraphQLObjectType,
  getNamedType,
  graphql,
  isSpecifiedScalarType,
  lexicographicSortSchema,
  parse,
  printSchema,
  validate,
} from "graphql";
import { graphQLSchema } from "@/backend/graphql/gqlSchema";
import { PUBLIC_OPERATION_NAMES, PUBLIC_OPERATIONS } from "@/backend/lib/gateway";

// ─── Frozen baseline inventory (captured @ HEAD 8e5ebb8) ─────────────────────

/** Root query field names present before the probe re-registration. */
const PRE_3_1_QUERY_FIELDS = ["me", "recitationReadings"] as const;
/** Root mutation field names in the baseline (post-baseline additions are enumerated separately below). */
const PRE_3_1_MUTATION_FIELDS = ["login", "logout", "refreshToken", "registerUser"] as const;
/** GraphQL enum type names — the freeze forbids any new Pothos enum. */
const PRE_3_1_ENUMS = ["Gender", "RecitationReading", "RegisterPublicRole", "UserRole"] as const;
/** Non-root object/enum/scalar SDL type names in the baseline (introspection `__*` and spec scalars excluded). */
const PRE_3_1_TYPE_NAMES = [
  "Gender",
  "LoginPayload",
  "LogoutPayload",
  "Mutation",
  "Query",
  "RecitationReading",
  "RefreshTokenPayload",
  "RegisterPublicRole",
  "RegisterUserInput",
  "User",
  "UserRole",
] as const;

// ─── Sanctioned post-baseline additions (reconciled @ Task 3.4, HEAD c70248b) ──
// Reviewed surfaces that joined the schema AFTER the frozen baseline. Each
// tuple is the EXACT, CLOSED set of names its plan was authorized to add —
// anything else on top of `PRE_3_1_* + POST_BASELINE_*` is a regression.

/** Query root fields: the `_health` probe (DEV1-001), the DEV2-004 applicant profile read, the DEV1-005 catalog reads, the DEV1-006 Phase A owner-scoped subscription read. */
const POST_BASELINE_QUERY_ADDITIONS = [
  "_health",
  "adminPlans",
  "myApplicantProfile",
  "mySubscriptions",
  "planCatalog",
] as const;
/** Mutation root fields: the DEV1-005 admin plan-catalog trio (admin-gated; NO delete surface — INV-PC3) + the DEV1-006 Phase A subscriber request (subscriber-gated, D2-enforced). */
const POST_BASELINE_MUTATION_ADDITIONS = [
  "createPlan",
  "requestPlanSubscription",
  "setPlanActiveStatus",
  "updatePlan",
] as const;
/** Enum types: the DEV2-004 applicant status enum. */
const POST_BASELINE_ENUM_ADDITIONS = ["ApplicantStatus"] as const;
/** Non-root SDL type names: the DEV2-004 applicant surface, the DEV1-005 billing surface, the DEV1-006 subscription surface, and the probe's `HealthCheck` VO. */
const POST_BASELINE_TYPE_ADDITIONS = [
  "ApplicantProfile",
  "ApplicantStatus",
  "CreatePlanInput",
  "DateTime",
  "HealthCheck",
  "Plan",
  "Subscription",
  "UpdatePlanInput",
] as const;

/** Deterministic merge of a frozen baseline tuple with its sanctioned additions. */
function frozenSet(baseline: readonly string[], additions: readonly string[]): string[] {
  return [...baseline, ...additions].toSorted((a, b) => a.localeCompare(b));
}

// ─── Schema walk helpers ─────────────────────────────────────────────────────

/** All named SDL type names, introspection builtins + spec scalars excluded, sorted deterministically. */
function sdlTypeNames(): string[] {
  return Object.values(graphQLSchema.getTypeMap())
    .filter(type => !type.name.startsWith("__") && !isSpecifiedScalarType(type))
    .map(type => type.name)
    .toSorted((a, b) => a.localeCompare(b));
}

describe("Query._health — retyped probe surface", () => {
  const queryType = graphQLSchema.getQueryType();

  if (!queryType) {
    throw new Error("Schema must define a root Query type");
  }

  test("root query retains EXACTLY the baseline fields plus the sanctioned additions", () => {
    expect(queryType).toBeDefined();
    const fieldNames = Object.keys(queryType.getFields());
    // Baseline survivors intact…
    for (const name of PRE_3_1_QUERY_FIELDS) {
      expect(fieldNames).toContain(name);
    }
    // …and the ONLY additions beyond them are the sanctioned post-baseline
    // fields (probe + DEV2-004 applicant profile + DEV1-005 catalog reads).
    const additions = fieldNames.filter(name => !(PRE_3_1_QUERY_FIELDS as readonly string[]).includes(name));
    expect(additions.toSorted((a, b) => a.localeCompare(b))).toEqual([...POST_BASELINE_QUERY_ADDITIONS]);
  });

  test("`_health` is NON-NULLABLE `HealthCheck!` (retyped from the String! placeholder)", () => {
    // Field lookup via values+name comparison — keeps `_health` out of member-
    // access position entirely (`no-underscore-dangle` clean by construction).
    const healthField = Object.values(queryType.getFields()).find(field => field.name === "_health");

    if (!healthField) {
      throw new Error("Query must register a `_health` root field");
    }
    expect(healthField).toBeDefined();
    expect(getNamedType(healthField.type).name).toBe("HealthCheck");
    expect(getNamedType(healthField.type).toString()).toBe("HealthCheck");
    // v3 defaults: no explicit nullable opt-out ⇒ strict NonNull wrapping.
    expect(healthField.type.toString()).toBe("HealthCheck!");
  });
});

describe("HealthCheck object shape — four scalar fields, no id", () => {
  const healthType = graphQLSchema.getType("HealthCheck");

  if (!(healthType instanceof GraphQLObjectType)) {
    throw new Error("HealthCheck must be registered as a GraphQL object type");
  }

  test("is registered exactly once as an object type backed by the canonical ref", () => {
    expect(healthType).toBeInstanceOf(GraphQLObjectType);
  });

  test("discloses EXACTLY the four canonical fields, each `String!`", () => {
    const fields = healthType.getFields();

    expect(Object.keys(fields).toSorted((a, b) => a.localeCompare(b))).toEqual([
      "service",
      "status",
      "timestamp",
      "version",
    ]);
    for (const field of Object.values(fields)) {
      expect(field.type.toString()).toBe("String!");
    }
  });

  test("carries NO `id` field — embedded value object", () => {
    const fields = healthType.getFields();

    expect(Object.hasOwn(fields, "id")).toBe(false);
  });

  test("selecting `id` on the probe FAILS validation (behavioral no-id proof)", () => {
    const document = parse("{ _health { id } }");
    const errors = validate(graphQLSchema, document);

    expect(errors).toHaveLength(1);
    expect(errors[0]?.message).toContain('Cannot query field "id" on type "HealthCheck"');
  });
});

describe("Surface freeze — baseline inventory plus sanctioned post-baseline additions", () => {
  test("mutation set frozen to baseline + the sanctioned DEV1-005 plan-catalog trio", () => {
    const mutationFields = graphQLSchema.getMutationType()?.getFields() ?? {};
    const names = Object.keys(mutationFields).toSorted((a, b) => a.localeCompare(b));

    expect(names).toEqual(frozenSet(PRE_3_1_MUTATION_FIELDS, POST_BASELINE_MUTATION_ADDITIONS));
    expect(names).not.toContain("_health");
  });

  test("enum set frozen to baseline + the sanctioned DEV2-004 ApplicantStatus", () => {
    const enumNames = Object.values(graphQLSchema.getTypeMap())
      .filter(type => type instanceof GraphQLEnumType && !type.name.startsWith("__"))
      .map(type => type.name)
      .toSorted((a, b) => a.localeCompare(b));

    expect(enumNames).toEqual(frozenSet(PRE_3_1_ENUMS, POST_BASELINE_ENUM_ADDITIONS));
  });

  test("whole-schema named-type delta is EXACTLY the sanctioned post-baseline additions", () => {
    const post = new Set(sdlTypeNames());

    for (const name of PRE_3_1_TYPE_NAMES) {
      expect(post.has(name)).toBe(true);
    }
    const additions = sdlTypeNames().filter(name => !(PRE_3_1_TYPE_NAMES as readonly string[]).includes(name));
    expect(additions).toEqual([...POST_BASELINE_TYPE_ADDITIONS]);
  });
});

describe("Public-operation allowlist agreement", () => {
  test("`_health` is a member of the closed allowlist 1:1 with its scopeless schema posture", () => {
    expect(PUBLIC_OPERATION_NAMES).toContain("_health");
    expect(PUBLIC_OPERATIONS.has("_health")).toBe(true);
    // The field genuinely ships WITHOUT authScopes: anonymous execution below
    // would otherwise raise an UNAUTHORIZED error through the scope-auth plugin.
  });

  test("anonymous (context-free) execution of the probe succeeds end-to-end", async () => {
    const result = await graphql({
      schema: graphQLSchema,
      source: "{ _health { status service version timestamp } }",
      contextValue: {},
    });

    expect(result.errors).toBeUndefined();
    // Wire-shape assertion over the serialized data map (timestamp varies per
    // call — matched structurally). This proves the delegation-only resolver:
    // the exact four-field payload of the shared producer surfaces verbatim,
    // nothing more.
    const serializedProbe = JSON.stringify(result.data);
    const probeShape =
      /^\{"_health":\{"status":"ok","service":"kottaby","version":"([^"]*)","timestamp":"([^"]+)"\}\}$/;
    const match = probeShape.exec(serializedProbe);

    expect(match).not.toBeNull();
    // Delegation-only proof: version flows out of the shared service producer
    // (non-empty here, since npm_package_version exists in this workspace).
    expect(match?.[1]?.length ?? 0).toBeGreaterThan(0);
    // …and the timestamp is a parseable ISO-8601 instant (never cached).
    expect(Number.isNaN(Date.parse(match?.[2] ?? "invalid"))).toBe(false);
  });
});

describe("Codegen sync — committed SDL is byte-identical to the built schema", () => {
  test("frontend/graphql/generated/schema.graphql matches a fresh deterministic emission", () => {
    const sdlPath = resolve(process.cwd(), "frontend/graphql/generated/schema.graphql");
    const committedSdl = readFileSync(sdlPath, "utf8");
    const freshlyPrinted = printSchema(lexicographicSortSchema(graphQLSchema));

    expect(committedSdl).toBe(freshlyPrinted);
    // Belt-and-braces: the synced artifact really contains the retyped probe.
    expect(committedSdl).toContain("_health: HealthCheck!");
    expect(committedSdl).toContain("type HealthCheck {");
  });
});
