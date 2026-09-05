/**
 * Barrel for shared GraphQL resolver helpers (cross-cutting guards used by
 * both the query and mutation layers). Not side-effect wiring — consumers
 * import the helpers directly from `@/backend/graphql/shared`.
 */
export * from "./resolver-guards";
