/**
 * Billing schema gates (DEV1-005 Task 3.4) — persistent, CI-enforceable
 * schema-contract gates for the plan-catalog surface:
 *
 *  - **INV-PC3 no-delete surface** — `deletePlan` / `removePlan` are absent
 *    from the GraphQL API surface (REQ-020: the catalog domain is
 *    lifecycle-only — deactivation via `setPlanActiveStatus`, never
 *    deletion). Asserted twice ON PURPOSE:
 *      1. against the LIVE schema printed from the code-first builder
 *         (self-contained — does NOT depend on codegen having run), and
 *      2. against the COMMITTED `frontend/graphql/generated/schema.graphql`
 *         artifact (catches manual/hand edits to the generated SDL).
 *  - **REQ-060 byte-for-byte SDL shape** — the exact committed SDL blocks
 *    for `type Plan`, `CreatePlanInput`, `UpdatePlanInput`, the two query
 *    root fields, the three mutation root fields, and `scalar DateTime`,
 *    plus the live-schema nullability map for the same surface.
 *  - **SEC root-field scope audit** — every NEW root field carries its
 *    sanctioned authScopes conjunction (read from the builder's runtime
 *    field extensions — the scopes are runtime config, not SDL), and the
 *    pre-existing mutations keep their unchanged (scopeless) posture. The
 *    three mutations are admin-gated; `planCatalog` is authenticated-any-
 *    role; `adminPlans` is admin-gated. No ungated NEW surface exists.
 *
 * Pure unit tier — NO server boot, NO network, NO DB. The committed SDL is
 * read from disk (read-only); the live schema comes straight from
 * `@/backend/graphql/gqlSchema`. Runs via the mandated runner:
 * `bun run test/scripts/run-test.ts backend/graphql/test/billing/schema-gates.test.ts`.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  GraphQLInputObjectType,
  GraphQLObjectType,
  GraphQLScalarType,
  lexicographicSortSchema,
  printSchema,
} from "graphql";
import { UserRole } from "@/backend/enum/users/user-role.enum";
import { graphQLSchema } from "@/backend/graphql/gqlSchema";

/** The committed generated SDL (tracked in git — present in CI checkouts). */
const COMMITTED_SDL_PATH = resolve(process.cwd(), "frontend/graphql/generated/schema.graphql");
const committedSdl = readFileSync(COMMITTED_SDL_PATH, "utf8");

/** Fresh deterministic emission from the live code-first schema (self-contained). */
const liveSdl = printSchema(lexicographicSortSchema(graphQLSchema));

/** INV-PC3 — the forbidden delete-surface identifiers (case-insensitive). */
const NO_DELETE_SURFACE_PATTERN = /deleteplan|removeplan/i;

/**
 * REQ-060 contract — the byte-for-byte SDL blocks for the billing surface,
 * expressed in the builder's lexicographic emission order (the committed
 * artifact is generated with `lexicographicSortSchema`, so blocks are
 * deterministic across runs).
 */
const REQ_060_COMMITTED_BLOCKS = {
  planObject: `type Plan {
  createdAt: DateTime!
  currency: String!
  deactivatedAt: DateTime
  id: ID!
  intervalDays: Int!
  isActive: Boolean!
  price: String!
  sessionCount: Int!
  title: String!
  updatedAt: DateTime!
}`,
  createPlanInput: `input CreatePlanInput {
  currency: String!
  intervalDays: Int!
  price: String!
  sessionCount: Int!
  title: String!
}`,
  updatePlanInput: `input UpdatePlanInput {
  currency: String
  intervalDays: Int
  price: String
  sessionCount: Int
  title: String
}`,
  /** Exact root-field signature lines within their root type blocks. */
  rootFieldLines: [
    "adminPlans(includeInactive: Boolean = true): [Plan!]!",
    "planCatalog: [Plan!]!",
    "createPlan(input: CreatePlanInput!): Plan!",
    "setPlanActiveStatus(id: ID!, isActive: Boolean!): Plan!",
    "updatePlan(id: ID!, input: UpdatePlanInput!): Plan!",
  ],
  scalarLine: "scalar DateTime",
} as const;

/** Sanctioned authScopes conjunctions (runtime config, not SDL — see SEC note). */
const ADMIN_GATE = { $all: { authenticated: true, role: [UserRole.Admin] } };
const AUTHENTICATED_GATE = { $all: { authenticated: true } };
/**
 * DEV1-006 Phase A — the storefront subscriber gate: authenticated members
 * of the THREE subscriber roles (admins manage the catalog, never
 * subscribe). Same explicit-$all conjunction discipline as the admin gate.
 */
const SUBSCRIBER_GATE = {
  $all: { authenticated: true, role: [UserRole.Student, UserRole.Parent, UserRole.Teacher] },
};

/** Pre-existing mutations whose scopeless posture predates DEV1-005 (unchanged). */
const PRE_EXISTING_MUTATIONS = ["login", "logout", "refreshToken", "registerUser"] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * Reads the `authScopes` declaration off one root field through the Pothos
 * extension snapshot (mirrors frontend/graphql/test/gateway/
 * allowlist-coverage.test.ts). Returns `undefined` for any field authored
 * WITHOUT a scope block (= scopeless-by-source).
 */
function declaredAuthScopes(field: { extensions?: unknown }): unknown {
  const extensions: unknown = Reflect.get(field, "extensions");
  if (!isRecord(extensions)) return undefined;
  const pothosOptions: unknown = Reflect.get(extensions, "pothosOptions");
  if (!isRecord(pothosOptions)) return undefined;
  return Reflect.get(pothosOptions, "authScopes");
}

function authScopesOf(operation: "query" | "mutation", fieldName: string): unknown {
  // graphql-js getRootType takes the LOWERCASE operation name.
  const fields = graphQLSchema.getRootType(operation)?.getFields();

  if (!fields) {
    throw new Error(`Schema must define a root ${operation} type`);
  }
  const field = Object.values(fields).find(candidate => candidate.name === fieldName);

  if (!field) {
    throw new Error(`${operation}.${fieldName} must be registered on the schema`);
  }
  // Pothos keeps the ORIGINAL field config under the `pothosOptions`
  // extension — the authScopes plugin reads its scope map from there at
  // resolve time (scopes are runtime, never printed into the SDL).
  return declaredAuthScopes(field);
}

/** Structural view of a root field — enough to pin names, types, and args. */
type RootFieldLike = {
  name: string;
  type: { toString(): string };
  args: readonly { name: string; type: { toString(): string }; defaultValue?: unknown }[];
};

/** Resolves a root field by name, failing loudly if the surface vanished. */
function rootField(operation: "query" | "mutation", fieldName: string): RootFieldLike {
  const fields = graphQLSchema.getRootType(operation)?.getFields() ?? {};
  const candidates: readonly RootFieldLike[] = Object.values(fields);
  const field = candidates.find(candidate => candidate.name === fieldName);

  if (!field) {
    throw new Error(`Root ${operation} field ${fieldName} must be registered on the schema`);
  }
  return field;
}

/** Resolves a field argument by name (graphql-js 17 keeps `args` positional). */
function argumentOf(field: RootFieldLike, argumentName: string): RootFieldLike["args"][number] | undefined {
  return field.args.find(argument => argument.name === argumentName);
}

describe("INV-PC3 — no delete surface on the plan catalog (REQ-020)", () => {
  test("live schema: deletePlan/removePlan appear NOWHERE in the printed SDL", () => {
    expect(NO_DELETE_SURFACE_PATTERN.test(liveSdl)).toBe(false);
  });

  test("committed artifact: deletePlan/removePlan appear NOWHERE in schema.graphql", () => {
    expect(NO_DELETE_SURFACE_PATTERN.test(committedSdl)).toBe(false);
  });

  test("no Query/Mutation root field name carries a delete/remove verb", () => {
    for (const operation of ["query", "mutation"] as const) {
      const fields = graphQLSchema.getRootType(operation)?.getFields() ?? {};

      for (const name of Object.keys(fields)) {
        expect(/delete|remove/i.test(name)).toBe(false);
      }
    }
  });

  test("the only lifecycle mutation is setPlanActiveStatus (deactivate, never delete)", () => {
    const mutationFields = Object.keys(graphQLSchema.getMutationType()?.getFields() ?? {});

    expect(mutationFields).toContain("setPlanActiveStatus");
    expect(mutationFields).not.toContain("deletePlan");
    expect(mutationFields).not.toContain("removePlan");
  });
});

describe("REQ-060 — committed SDL is byte-for-byte the billing contract", () => {
  test("`type Plan` block matches the ten-field contract verbatim", () => {
    expect(committedSdl).toContain(REQ_060_COMMITTED_BLOCKS.planObject);
  });

  test("`CreatePlanInput` block: EXACTLY five REQUIRED fields incl. price: String!", () => {
    expect(committedSdl).toContain(REQ_060_COMMITTED_BLOCKS.createPlanInput);
    // BOPLA: lifecycle fields are unrepresentable on the create wire.
    expect(committedSdl).not.toMatch(/input CreatePlanInput \{[^}]*isActive/);
    expect(committedSdl).not.toMatch(/input CreatePlanInput \{[^}]*deactivatedAt/);
  });

  test("`UpdatePlanInput` block: EXACTLY five OPTIONAL fields", () => {
    expect(committedSdl).toContain(REQ_060_COMMITTED_BLOCKS.updatePlanInput);
    expect(committedSdl).not.toMatch(/input UpdatePlanInput \{[^}]*isActive/);
    expect(committedSdl).not.toMatch(/input UpdatePlanInput \{[^}]*deactivatedAt/);
  });

  test("query root fields: planCatalog + adminPlans(includeInactive default true)", () => {
    for (const line of REQ_060_COMMITTED_BLOCKS.rootFieldLines.slice(0, 2)) {
      expect(committedSdl).toContain(line);
    }
  });

  test("mutation root fields: createPlan + updatePlan + setPlanActiveStatus", () => {
    for (const line of REQ_060_COMMITTED_BLOCKS.rootFieldLines.slice(2)) {
      expect(committedSdl).toContain(line);
    }
  });

  test("`scalar DateTime` is declared in the committed artifact", () => {
    expect(committedSdl).toContain(REQ_060_COMMITTED_BLOCKS.scalarLine);
  });
});

describe("REQ-060 — live schema nullability map (codegen-independent cross-check)", () => {
  const planType = graphQLSchema.getType("Plan");

  if (!(planType instanceof GraphQLObjectType)) {
    throw new Error("Plan must be registered as a GraphQL object type");
  }

  test("Plan discloses EXACTLY the ten contract fields with the exact types", () => {
    const fields = planType.getFields();

    expect(Object.keys(fields).toSorted((a, b) => a.localeCompare(b))).toEqual([
      "createdAt",
      "currency",
      "deactivatedAt",
      "id",
      "intervalDays",
      "isActive",
      "price",
      "sessionCount",
      "title",
      "updatedAt",
    ]);
    expect(fields.id?.type.toString()).toBe("ID!");
    expect(fields.title?.type.toString()).toBe("String!");
    expect(fields.sessionCount?.type.toString()).toBe("Int!");
    expect(fields.price?.type.toString()).toBe("String!");
    expect(fields.currency?.type.toString()).toBe("String!");
    expect(fields.intervalDays?.type.toString()).toBe("Int!");
    expect(fields.isActive?.type.toString()).toBe("Boolean!");
    expect(fields.deactivatedAt?.type.toString()).toBe("DateTime");
    expect(fields.createdAt?.type.toString()).toBe("DateTime!");
    expect(fields.updatedAt?.type.toString()).toBe("DateTime!");
  });

  test("input objects expose exactly the five wire fields with correct nullability", () => {
    const createPlanInput = graphQLSchema.getType("CreatePlanInput");
    const updatePlanInput = graphQLSchema.getType("UpdatePlanInput");

    if (!(createPlanInput instanceof GraphQLInputObjectType && updatePlanInput instanceof GraphQLInputObjectType)) {
      throw new Error("CreatePlanInput/UpdatePlanInput must be registered as input object types");
    }
    const createFields = createPlanInput.getFields();
    const updateFields = updatePlanInput.getFields();

    expect(Object.keys(createFields).toSorted((a, b) => a.localeCompare(b))).toEqual([
      "currency",
      "intervalDays",
      "price",
      "sessionCount",
      "title",
    ]);
    expect(Object.keys(updateFields).toSorted((a, b) => a.localeCompare(b))).toEqual([
      "currency",
      "intervalDays",
      "price",
      "sessionCount",
      "title",
    ]);
    // Create: every field REQUIRED (v3 defaults) — price is the decimal
    // String!, never a Float.
    expect(createFields.title?.type.toString()).toBe("String!");
    expect(createFields.sessionCount?.type.toString()).toBe("Int!");
    expect(createFields.price?.type.toString()).toBe("String!");
    expect(createFields.currency?.type.toString()).toBe("String!");
    expect(createFields.intervalDays?.type.toString()).toBe("Int!");
    // Update: every field OPTIONAL (nullable) — the partial-patch contract.
    expect(updateFields.title?.type.toString()).toBe("String");
    expect(updateFields.sessionCount?.type.toString()).toBe("Int");
    expect(updateFields.price?.type.toString()).toBe("String");
    expect(updateFields.currency?.type.toString()).toBe("String");
    expect(updateFields.intervalDays?.type.toString()).toBe("Int");
  });

  test("root query/mutation fields carry the exact signatures", () => {
    const planCatalog = rootField("query", "planCatalog");
    const adminPlans = rootField("query", "adminPlans");
    const createPlan = rootField("mutation", "createPlan");
    const updatePlan = rootField("mutation", "updatePlan");
    const setPlanActiveStatus = rootField("mutation", "setPlanActiveStatus");

    expect(planCatalog.type.toString()).toBe("[Plan!]!");
    expect(adminPlans.type.toString()).toBe("[Plan!]!");
    expect(argumentOf(adminPlans, "includeInactive")?.type.toString()).toBe("Boolean");
    expect(argumentOf(adminPlans, "includeInactive")?.defaultValue).toBe(true);

    expect(createPlan.type.toString()).toBe("Plan!");
    expect(argumentOf(createPlan, "input")?.type.toString()).toBe("CreatePlanInput!");
    expect(updatePlan.type.toString()).toBe("Plan!");
    expect(argumentOf(updatePlan, "id")?.type.toString()).toBe("ID!");
    expect(argumentOf(updatePlan, "input")?.type.toString()).toBe("UpdatePlanInput!");
    expect(setPlanActiveStatus.type.toString()).toBe("Plan!");
    expect(argumentOf(setPlanActiveStatus, "id")?.type.toString()).toBe("ID!");
    expect(argumentOf(setPlanActiveStatus, "isActive")?.type.toString()).toBe("Boolean!");
  });

  test("DateTime is a registered custom scalar on the live schema", () => {
    expect(graphQLSchema.getType("DateTime")).toBeInstanceOf(GraphQLScalarType);
  });
});

describe("SEC — root-field authScopes audit (runtime config, not SDL)", () => {
  test("the three plan mutations carry the EXPLICIT admin $all conjunction", () => {
    for (const mutation of ["createPlan", "updatePlan", "setPlanActiveStatus"] as const) {
      expect(authScopesOf("mutation", mutation)).toEqual(ADMIN_GATE);
    }
  });

  test("planCatalog is authenticated-any-role; adminPlans is admin-gated", () => {
    expect(authScopesOf("query", "planCatalog")).toEqual(AUTHENTICATED_GATE);
    expect(authScopesOf("query", "adminPlans")).toEqual(ADMIN_GATE);
  });

  test("pre-existing mutations keep their pre-DEV1-005 scopeless posture", () => {
    for (const mutation of PRE_EXISTING_MUTATIONS) {
      expect(authScopesOf("mutation", mutation)).toBeUndefined();
    }
  });

  test("mutation root set is EXACTLY baseline + the three plan mutations + the subscription family", () => {
    const names = Object.keys(graphQLSchema.getMutationType()?.getFields() ?? {}).toSorted((a, b) =>
      a.localeCompare(b)
    );

    expect(names).toEqual(
      [
        ...PRE_EXISTING_MUTATIONS,
        "createPlan",
        "setPlanActiveStatus",
        "updatePlan",
        // DEV1-006 Phase A — the storefront's real subscribe action.
        "requestPlanSubscription",
        // DEV1-006 Phase B — the admin payment-verification transition.
        "verifySubscriptionPayment",
        // DEV1-009 — the admin cancel transition.
        "adminCancelSubscription",
      ].toSorted((a, b) => a.localeCompare(b))
    );
  });

  test("requestPlanSubscription carries the EXPLICIT subscriber $all conjunction", () => {
    expect(authScopesOf("mutation", "requestPlanSubscription")).toEqual(SUBSCRIBER_GATE);
    expect(authScopesOf("query", "mySubscriptions")).toEqual(SUBSCRIBER_GATE);
  });

  test("verifySubscriptionPayment + adminPendingSubscriptionRequests carry the EXPLICIT admin $all conjunction (DEV1-006 Phase B)", () => {
    expect(authScopesOf("mutation", "verifySubscriptionPayment")).toEqual(ADMIN_GATE);
    expect(authScopesOf("query", "adminPendingSubscriptionRequests")).toEqual(ADMIN_GATE);
  });

  test("adminAuditLogs carries the EXPLICIT admin $all conjunction (DEV3-020 Phase 1)", () => {
    expect(authScopesOf("query", "adminAuditLogs")).toEqual(ADMIN_GATE);
  });

  test("adminSubscriptions + adminCancelSubscription carry the EXPLICIT admin $all conjunction (DEV1-009)", () => {
    expect(authScopesOf("query", "adminSubscriptions")).toEqual(ADMIN_GATE);
    expect(authScopesOf("mutation", "adminCancelSubscription")).toEqual(ADMIN_GATE);
  });
});
