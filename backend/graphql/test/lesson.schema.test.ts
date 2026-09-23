/**
 * GraphQL schema contract tests for Lessons (Curriculum CRUD)
 *
 * Verifies:
 *  - REQ-050/051: Lesson SDL shape matches contract (`id: "ID!"`, `planId`
 *    NULLABLE String-like Int for standalone lessons, etc.)
 *  - REQ-016: `planLessons` on the Query root (non-nullable list, `planId: ID!`)
 *  - REQ-030/051: `createLesson`/`updateLesson`/`deleteLesson` on the Mutation
 *    root — this ticket deliberately ADDS the delete that the plans catalog
 *    forbids for plans (INV-PC3 stays intact for plans)
 *  - Codegen sync: `schema.graphql` matches `printSchema(lexicographicSortSchema(graphQLSchema))`
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { GraphQLInputObjectType, GraphQLObjectType, lexicographicSortSchema, printSchema } from "graphql";
import { graphQLSchema } from "@/backend/graphql/gqlSchema";

describe("Lessons GraphQL Schema", () => {
  test("Lesson object type has exact expected fields and types", () => {
    const lessonType = graphQLSchema.getType("Lesson");
    expect(lessonType).toBeInstanceOf(GraphQLObjectType);
    if (!(lessonType instanceof GraphQLObjectType)) return;

    const fields = lessonType.getFields();
    const expectedTypes: Record<string, string> = {
      id: "ID!",
      planId: "Int",
      title: "String",
      createdAt: "String!",
      updatedAt: "String!",
    };

    for (const [name, expectedType] of Object.entries(expectedTypes)) {
      expect(fields[name]?.type.toString()).toBe(expectedType);
    }
  });

  test("Lesson input types have exact expected fields and types", () => {
    const createInput = graphQLSchema.getType("CreateLessonInput");
    const updateInput = graphQLSchema.getType("UpdateLessonInput");
    expect(createInput).toBeInstanceOf(GraphQLInputObjectType);
    expect(updateInput).toBeInstanceOf(GraphQLInputObjectType);
    if (!(createInput instanceof GraphQLInputObjectType) || !(updateInput instanceof GraphQLInputObjectType)) return;

    const createFields = createInput.toConfig().fields;
    expect(createFields.planId?.type.toString()).toBe("Int!");
    expect(createFields.title?.type.toString()).toBe("String!");

    const updateFields = updateInput.toConfig().fields;
    expect(updateFields.planId?.type.toString()).toBe("Int");
    expect(updateFields.title?.type.toString()).toBe("String");
  });

  test("Query root exposes planLessons with non-nullable list and ID! planId", () => {
    const queryType = graphQLSchema.getQueryType();
    expect(queryType).toBeDefined();
    const field = queryType?.getFields().planLessons;
    expect(field).toBeDefined();
    expect(field?.type.toString()).toBe("[Lesson!]!");
    expect(field?.args.find(arg => field && arg.name === "planId")?.type.toString()).toBe("ID!");
  });

  test("Mutation root exposes createLesson, updateLesson, deleteLesson with exact arg maps", () => {
    const mutationType = graphQLSchema.getMutationType();
    expect(mutationType).toBeDefined();
    const fields = mutationType?.getFields();

    const expectedArgMaps: Record<string, Record<string, string>> = {
      createLesson: { input: "CreateLessonInput!" },
      updateLesson: { id: "ID!", input: "UpdateLessonInput!" },
      deleteLesson: { id: "ID!" },
    };

    for (const [fieldName, argMap] of Object.entries(expectedArgMaps)) {
      const field = fields?.[fieldName];
      expect(field).toBeDefined();
      expect(field?.type.toString()).toBe("Lesson!");
      const actualArgs: Record<string, string> = {};
      for (const arg of field?.args ?? []) {
        actualArgs[arg.name] = arg.type.toString();
      }
      expect(actualArgs).toEqual(argMap);
    }
  });

  test("REQ-030/051: deleteLesson EXISTS in SDL (plans catalog forbids deletePlan; lessons deliberately add delete)", () => {
    const schemaPath = resolve(process.cwd(), "frontend/graphql/generated/schema.graphql");
    const sdl = readFileSync(schemaPath, "utf-8");

    expect(sdl).toMatch(/deleteLesson/);
  });

  test("Committed schema.graphql matches live code-first graphQLSchema exactly", () => {
    const schemaPath = resolve(process.cwd(), "frontend/graphql/generated/schema.graphql");
    const committedSdl = readFileSync(schemaPath, "utf-8").trim();
    const liveSdl = printSchema(lexicographicSortSchema(graphQLSchema)).trim();

    expect(committedSdl).toBe(liveSdl);
  });
});
