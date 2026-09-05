/**
 * Side-effect imports that register all Pothos types, queries, and mutations
 * on `gqlSchemaBuilder`.
 *
 * Kept in a dedicated module so `pothos/builder.ts` can dynamically import it
 * in development. That dynamic import creates an HMR dependency edge: when any
 * schema definition changes, the builder module is invalidated too, yielding a
 * fresh SchemaBuilder before types re-register (see hayes/pothos#49).
 *
 * Ordering mirrors the wiring order documented in `gqlSchema.ts`:
 * object barrel → scalar registry → enum registry → mutation barrel →
 * query barrel.
 */
import "@/backend/graphql/pothos";
import "@/backend/graphql/pothos/shared/scalar.pothos";
import "@/backend/graphql/pothos/shared/enum.pothos";
import "@/backend/graphql/mutation";
import "@/backend/graphql/query";
