/**
 * Live PostgreSQL introspection library for the Draft Academy / Kottaby DB.
 *
 * Exposes 8 read-only async functions that query the live `kottaby` database
 * (PostgreSQL 17.10 on 127.0.0.1:5432) via the `queryDb` helper from
 * `@/backend/db/index`. All queries target `information_schema` + `pg_catalog`
 * views with parameterized `$1` placeholders — table names are NEVER
 * string-interpolated.
 *
 * Used by the live DB explorer dashboard (`app/page.tsx` + client shell in
 * `app/_components/db-explorer-client.tsx`). Replaces the static hardcoded
 * schema-inventory page of the initial verification build.
 *
 * Security:
 *  - All table-name parameters are validated against `^[a-z_]+$` before
 *    querying (defense-in-depth — even though we use parameterized queries,
 *    identifiers in `information_schema` columns don't accept `$1` in all
 *    positions; we use them as VALUES not identifiers).
 *  - Read-only: no INSERT/UPDATE/DELETE. SELECT-only against catalog views.
 *  - No PII exposure — only schema metadata + aggregate row counts.
 */

export * from "./catalog-queries";
export * from "./constraint-queries";
export * from "./table-queries";
export * from "./types";
