/**
 * Classes-domain Pothos barrel — re-exports the lesson, session-report/homework
 * object definitions and the report-submission input types.
 *
 * The top-level `backend/graphql/pothos/index.ts` re-exports this module, and
 * `gqlSchema.ts` side-effect-imports that top-level barrel so these object
 * types are registered on `gqlSchemaBuilder` BEFORE `toSchema()` finalizes
 * the SDL. Resolvers import the objects/inputs directly from the leaf
 * modules (e.g. `@/backend/graphql/pothos/classes/report.pothos`), matching
 * the existing domain conventions.
 *
 * The pre-existing session objects (`session.pothos.ts`,
 * `session-filter-input.pothos.ts`, `create-session-input.pothos.ts`) stay
 * resolver-transitive and are deliberately NOT re-exported here — their
 * registration rides their own query/mutation modules.
 */
export * from "./home-work.pothos";
export * from "./lesson.pothos";
export * from "./report.pothos";
export * from "./session-report-input.pothos";
