/**
 * GraphQL schema contract tests for Plan Catalog — DEV1-005 Task 3.4.TE
 *
 * Verifies:
 *  - REQ-060: Plan SDL shape matches contract (`price: String!`, `deactivatedAt` nullable String, etc.)
 *  - INV-PC3 / REQ-020: Forward-only lifecycle guarantee — no `deletePlan`/`removePlan` mutation in SDL
 *  - Codegen sync: `schema.graphql` matches `printSchema(lexicographicSortSchema(graphQLSchema))`
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { GraphQLObjectType, lexicographicSortSchema, printSchema } from "graphql";
import { graphQLSchema } from "@/backend/graphql/gqlSchema";

describe("Plan Catalog GraphQL Schema", () => {
  test("Plan object type has exact expected fields and types", () => {
    const planType = graphQLSchema.getType("Plan");
    expect(planType).toBeInstanceOf(GraphQLObjectType);
    if (!(planType instanceof GraphQLObjectType)) return;

    const fields = planType.getFields();
    const expectedTypes: Record<string, string> = {
      id: "ID!",
      title: "String!",
      sessionCount: "Int!",
      price: "String!",
      currency: "String!",
      intervalDays: "Int!",
      isActive: "Boolean!",
      deactivatedAt: "String",
      createdAt: "String!",
      updatedAt: "String!",
    };

    for (const [name, expectedType] of Object.entries(expectedTypes)) {
      expect(fields[name]?.type.toString()).toBe(expectedType);
    }
  });

  test("Query root exposes planCatalog and adminPlans queries", () => {
    const queryType = graphQLSchema.getQueryType();
    expect(queryType).toBeDefined();
    const fields = queryType?.getFields();
    expect(fields?.planCatalog).toBeDefined();
    expect(fields?.adminPlans).toBeDefined();
  });

  test("Mutation root exposes createPlan, updatePlan, setPlanActiveStatus", () => {
    const mutationType = graphQLSchema.getMutationType();
    expect(mutationType).toBeDefined();
    const fields = mutationType?.getFields();
    expect(fields?.createPlan).toBeDefined();
    expect(fields?.updatePlan).toBeDefined();
    expect(fields?.setPlanActiveStatus).toBeDefined();
  });

  test("INV-PC3 / REQ-020: NO deletePlan or removePlan mutation exists in SDL", () => {
    const schemaPath = resolve(process.cwd(), "frontend/graphql/generated/schema.graphql");
    const sdl = readFileSync(schemaPath, "utf-8");

    expect(sdl).not.toMatch(/deletePlan/i);
    expect(sdl).not.toMatch(/removePlan/i);
    expect(sdl).not.toMatch(/destroyPlan/i);
  });

  test("Committed schema.graphql matches live code-first graphQLSchema exactly", () => {
    const schemaPath = resolve(process.cwd(), "frontend/graphql/generated/schema.graphql");
    const committedSdl = readFileSync(schemaPath, "utf-8").trim();
    const liveSdl = printSchema(lexicographicSortSchema(graphQLSchema)).trim();

    expect(committedSdl).toBe(liveSdl);
  });
});
