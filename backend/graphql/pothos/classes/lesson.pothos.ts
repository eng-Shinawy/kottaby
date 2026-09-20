/**
 * LessonPothosObject — canonical GraphQL object type and inputs for `Lesson`.
 *
 * Backed exclusively by `LessonReturnType` from `@/backend/types` (zero local
 * types). The lessons row carries no pgEnum columns and no forbidden fields,
 * so every column is consumer-safe by construction and nothing beyond it:
 * payload = `{id, planId, title, createdAt, updatedAt}` (REQ-033). No
 * business logic in this module — resolvers delegate to the services layer.
 *
 * `planId` and `title` stay nullable on the wire (a standalone lesson whose
 * plan was deleted — SET NULL — and a title-less row are normal stored
 * states). Timestamps are NOT NULL columns serialized via `toISOString()`
 * onto the `String` scalar, mirroring the `plan.pothos.ts` billing precedent.
 *
 * Consumed by the lessons query/mutation resolver modules, whose
 * side-effect imports register the type through the `gqlSchema.ts`
 * side-effect chain.
 */
import { gqlSchemaBuilder } from "@/backend/graphql/pothos/builder";
import type { LessonReturnType } from "@/backend/types";

/**
 * The canonical `Lesson` GraphQL object type.
 */
export const LessonPothosObject = gqlSchemaBuilder.objectRef<LessonReturnType>("Lesson").implement({
  description: "A lesson: a discrete teaching unit optionally tied to a subscription plan.",
  fields: t => ({
    id: t.exposeID("id", {
      description: "Unique lesson identifier (Apollo cache normalization key).",
    }),
    planId: t.exposeInt("planId", {
      nullable: true,
      description: "Identifier of the subscription plan this lesson belongs to, or null while standalone.",
    }),
    title: t.exposeString("title", {
      nullable: true,
      description: "Short human-readable label of the lesson, or null when untitled.",
    }),
    createdAt: t.string({
      description: "Timestamp when the lesson record was created.",
      resolve: parent => parent.createdAt.toISOString(),
    }),
    updatedAt: t.string({
      description: "Timestamp when the lesson record was last modified.",
      resolve: parent => parent.updatedAt.toISOString(),
    }),
  }),
});

/**
 * Input type for creating a new lesson.
 */
export const CreateLessonInput = gqlSchemaBuilder.inputType("CreateLessonInput", {
  description: "Input fields required to create a new lesson.",
  fields: t => ({
    planId: t.int({
      required: true,
      description: "Identifier of the subscription plan this lesson belongs to.",
    }),
    title: t.string({
      required: true,
      description: "Short human-readable label of the lesson.",
    }),
  }),
});

/**
 * Input type for updating an existing lesson — both fields optional; the
 * service builds the patch field-by-field (an empty patch is rejected).
 */
export const UpdateLessonInput = gqlSchemaBuilder.inputType("UpdateLessonInput", {
  description: "Input fields accepted when updating an existing lesson.",
  fields: t => ({
    planId: t.int({
      description: "New identifier of the subscription plan this lesson belongs to.",
    }),
    title: t.string({
      description: "New short human-readable label of the lesson.",
    }),
  }),
});
