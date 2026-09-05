/**
 * Top-level Pothos object barrel — domain export registry.
 *
 * `gqlSchema.ts` side-effect-imports this module so every domain exported
 * here is registered on `gqlSchemaBuilder` BEFORE `toSchema()` finalizes the
 * schema. Re-exporting also evaluates the leaf modules, and ESM module
 * identity guarantees the types register exactly once no matter how many
 * consumers import them.
 *
 * Domains whose objects are registered transitively through their resolvers
 * (`users`, `teachers`, `auth`) keep that convention; this barrel carries the
 * notifications domain, whose objects land ahead of their resolvers — the
 * objects ship first, the query/mutation fields follow.
 */
export * from "./notifications";
