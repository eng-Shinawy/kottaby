/**
 * Plan schema surface assertion suite (DEV1-005 Task 3.1.TE) — locks the
 * REQ-060 SDL contract for the `Plan` object and the `DateTime` scalar
 * gate amendment.
 *
 * What this locks down:
 *  - **Field closure** — `Plan` discloses EXACTLY the ten REQ-060 fields,
 *    in contract order.
 *  - **Nullability map** — `id: ID!` (Apollo normalization), `price:
 *    String!` (decimal string — no Float), and the single nullable field
 *    `deactivatedAt: DateTime` beside non-nullable `createdAt`/`updatedAt`.
 *  - **Byte-for-byte SDL** — the printed `type Plan { ... }` block matches
 *    the REQ-060 target verbatim.
 *  - **Scalar amendment** — `DateTime` is registered as a real GraphQL
 *    scalar (ISO-8601 UTC serialization contract) and appears in the SDL.
 *  - **Least privilege** — no user/subscription/financial/governance fields
 *    leak onto the payload (REQ-033).
 *
 * Registration note: this suite side-effect-imports the billing Pothos
 * barrel BEFORE `gqlSchema` so `Plan`/`DateTime` are registered on the
 * shared builder prior to `toSchema()` (the schema chain itself does not
 * include the billing domain until Tasks 3.2/3.3 wire the resolvers in).
 *
 * Pure unit tier — NO server boot, NO network, NO DB. Runs via the mandated
 * runner: `bun run test/scripts/run-test.ts backend/graphql/test/billing/plan-schema-surface.test.ts`.
 */

import { describe, expect, test } from "bun:test";
import { GraphQLObjectType, GraphQLScalarType, printSchema } from "graphql";
import "@/backend/graphql/pothos/billing";
import { graphQLSchema } from "@/backend/graphql/gqlSchema";

/**
 * REQ-060 contract — the byte-for-byte SDL target for `Plan`, expressed in
 * the builder's canonical emission order. Pothos's `toSchema()` prints
 * object fields LEXICOGRAPHICALLY SORTED (default `sortSchema: true`), so
 * the printed artifact orders fields alphabetically; names, types, and
 * nullability are exactly the REQ-060 contract.
 */
const REQ_060_PLAN_SDL = `type Plan {
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
}`;

/** Field names prohibited on the payload by REQ-033 least privilege. */
const FORBIDDEN_JOIN_FIELDS = [
  "user",
  "subscriptions",
  "subscription",
  "payments",
  "invoices",
  "createdBy",
  "updatedBy",
] as const;

describe("Plan object — REQ-060 SDL contract", () => {
  const planType = graphQLSchema.getType("Plan");

  if (!(planType instanceof GraphQLObjectType)) {
    throw new Error("Plan must be registered as a GraphQL object type");
  }

  test("discloses EXACTLY the ten REQ-060 fields", () => {
    const fields = planType.getFields();

    // The builder emits fields lexicographically sorted — compare sorted sets.
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
  });

  test("nullability map matches REQ-060 field-for-field", () => {
    const fields = planType.getFields();

    expect(fields.id?.type.toString()).toBe("ID!");
    expect(fields.title?.type.toString()).toBe("String!");
    expect(fields.sessionCount?.type.toString()).toBe("Int!");
    expect(fields.price?.type.toString()).toBe("String!");
    expect(fields.currency?.type.toString()).toBe("String!");
    expect(fields.intervalDays?.type.toString()).toBe("Int!");
    expect(fields.isActive?.type.toString()).toBe("Boolean!");
    // The ONLY nullable field in the contract —…
    expect(fields.deactivatedAt?.type.toString()).toBe("DateTime");
    // …every timestamp besides it is non-nullable.
    expect(fields.createdAt?.type.toString()).toBe("DateTime!");
    expect(fields.updatedAt?.type.toString()).toBe("DateTime!");
  });

  test("printed SDL matches the REQ-060 byte-for-byte target", () => {
    const printed = printSchema(graphQLSchema);

    expect(printed).toContain(REQ_060_PLAN_SDL);
  });

  test("exposes NO user/financial/governance joins (REQ-033 least privilege)", () => {
    const fields = planType.getFields();

    for (const forbidden of FORBIDDEN_JOIN_FIELDS) {
      expect(Object.hasOwn(fields, forbidden)).toBe(false);
    }
  });
});

describe("DateTime scalar — Task 3.1 gate amendment", () => {
  test("is registered on the schema as a custom scalar", () => {
    const scalar = graphQLSchema.getType("DateTime");

    expect(scalar).toBeInstanceOf(GraphQLScalarType);
  });

  test("appears in the printed SDL", () => {
    expect(printSchema(graphQLSchema)).toContain("scalar DateTime");
  });

  test("serializes Date values to ISO-8601 UTC strings", () => {
    const scalar = graphQLSchema.getType("DateTime");

    if (!(scalar instanceof GraphQLScalarType)) {
      throw new Error("DateTime must be a registered GraphQL scalar");
    }

    expect(scalar.serialize(new Date("2025-01-15T09:30:00.000Z"))).toBe("2025-01-15T09:30:00.000Z");
    expect(scalar.serialize(new Date(0))).toBe("1970-01-01T00:00:00.000Z");
  });

  test("parses valid ISO-8601 variable values and rejects invalid ones", () => {
    const scalar = graphQLSchema.getType("DateTime");

    if (!(scalar instanceof GraphQLScalarType)) {
      throw new Error("DateTime must be a registered GraphQL scalar");
    }

    expect((scalar.parseValue("2025-01-15T09:30:00.000Z") as Date).toISOString()).toBe(
      "2025-01-15T09:30:00.000Z",
    );
    expect(() => scalar.parseValue("not-a-date")).toThrow();
    expect(() => scalar.parseValue("2025-13-45T99:00:00.000Z")).toThrow();
  });
});
