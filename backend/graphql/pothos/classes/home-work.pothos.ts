/**
 * SessionHomeWorkPothosObject — the single canonical GraphQL object type for
 * a per-session homework row (both parallel tracks: current = Jadid, revision
 * = Madi).
 *
 * Single Canonical Object Type Pattern (`backend/graphql/AGENTS.md`):
 *  - Backed EXCLUSIVELY by the canonical `HomeWorkReturnType` from
 *    `@/backend/types` (the `home_work` table's derived select row) — no
 *    local type definitions here. There is NO business logic in this module.
 *  - `SessionHomeWork` exposes `id` FIRST (Apollo cache normalization), then
 *    the session join id, the two assignment tracks, and the row stamps.
 *  - The full column set is exposed (every column is consumer-safe by
 *    construction) and nothing beyond it.
 *
 * Enum fields map the `surah_juz_ref` pgEnum string unions carried by the
 * canonical select row onto the `SurahJuzRef` TS enum registered ONCE in
 * `shared/enum.pothos.ts` through a fail-closed vocabulary-guard mapper —
 * never `as` casts. The mapper is a single membership guard over the shared
 * `SurahJuzRef` vocabulary, so the mapping stays total and lint-clean at any
 * vocabulary size; an unrecognized value (a pgEnum ahead of the TS enum)
 * cannot pass through silently — it surfaces as a resolver error at runtime.
 * The guard's runtime totality is machine-compensated by the pgEnum↔TS
 * mirror-parity test and the locale-completeness conformance test, which
 * replace the retired compile-time switch-exhaustiveness check. Timestamps
 * use the `DateTime` scalar (registered in `shared/scalar.pothos.ts`, backed
 * by `DateTimeResolver` from `graphql-scalars`): `Date` on the canonical
 * shape, ISO-8601 UTC on the wire.
 *
 * Consumed by the session-report query/mutation resolver modules, whose
 * imports transitively register the type through the `gqlSchema.ts`
 * side-effect chain.
 */
import { isSurahJuzRef, type SurahJuzRef } from "@/backend/enum/shared/surah-juz-ref.enum";
import { gqlSchemaBuilder } from "@/backend/graphql/pothos/builder";
import { SurahJuzRefPothosEnum } from "@/backend/graphql/pothos/shared/enum.pothos";
import type { HomeWorkReturnType, StudentHomeworkPageReturnType } from "@/backend/types";

/**
 * Maps the `surah_juz_ref` pgEnum value carried by the canonical row onto
 * the `SurahJuzRef` TS enum. The shipped pgEnum string union and the TS
 * enum values are byte-identical, so the fail-closed vocabulary guard is
 * the whole mapping; an unrecognized value (a DB enum ahead of the TS
 * vocabulary) surfaces as a resolver error instead of passing through.
 * Vocabulary totality is enforced by the pgEnum↔TS mirror-parity test and
 * the locale-completeness conformance test.
 */
function toSurahJuzRef(value: NonNullable<HomeWorkReturnType["currentSurahJuz"]>): SurahJuzRef {
  if (isSurahJuzRef(value)) {
    return value;
  }
  throw new Error(`Unexpected surah/juz ref: ${value}`);
}

/**
 * The canonical `SessionHomeWork` GraphQL object. Producers return
 * `HomeWorkReturnType` (the home_work table's derived select row). Field
 * order: `id` first (Apollo cache normalization), session join, then the two
 * parallel tracks (current/Jadid, revision/Madi), then row timestamps. Every
 * assignment field is nullable: an assigned-but-ungraded or block-less track
 * is a normal stored state.
 */
export const SessionHomeWorkPothosObject = gqlSchemaBuilder.objectRef<HomeWorkReturnType>("SessionHomeWork").implement({
  fields: t => ({
    // ID FIRST — Apollo cache normalization requires `id` on every
    // entity-shaped object (identity PK, surfaced as GraphQL `ID!`).
    id: t.exposeID("id"),
    // The one-to-one session join id (UNIQUE column) — `Int!`.
    sessionId: t.exposeInt("sessionId"),
    // Current (Jadid) track — all four legs nullable at the DB level.
    currentFromAyah: t.exposeInt("currentFromAyah", { nullable: true }),
    currentToAyah: t.exposeInt("currentToAyah", { nullable: true }),
    currentGrade: t.exposeInt("currentGrade", { nullable: true }),
    // Mapped onto the registered `SurahJuzRef` enum through the fail-closed
    // vocabulary guard; an unmapped value throws a resolver error.
    currentSurahJuz: t.field({
      type: SurahJuzRefPothosEnum,
      nullable: true,
      resolve: parent => {
        if (parent.currentSurahJuz === null) return null;
        return toSurahJuzRef(parent.currentSurahJuz);
      },
    }),
    // Revision (Madi) track — same shape as the current track.
    revisionFromAyah: t.exposeInt("revisionFromAyah", { nullable: true }),
    revisionToAyah: t.exposeInt("revisionToAyah", { nullable: true }),
    revisionGrade: t.exposeInt("revisionGrade", { nullable: true }),
    revisionSurahJuz: t.field({
      type: SurahJuzRefPothosEnum,
      nullable: true,
      resolve: parent => {
        if (parent.revisionSurahJuz === null) return null;
        return toSurahJuzRef(parent.revisionSurahJuz);
      },
    }),
    // Row timestamps — NOT NULL columns, non-nullable `DateTime!`.
    createdAt: t.expose("createdAt", { type: "DateTime" }),
    updatedAt: t.expose("updatedAt", { type: "DateTime" }),
  }),
});

/**
 * The sanctioned list-wrapper for the teacher-scoped student homework
 * history read. The wrapper carries NO `id` (it is a pagination envelope,
 * not an entity), so consumers MUST register `StudentHomeworkPage:
 * { keyFields: false }` in the Apollo cache `typePolicies` to silence
 * normalization warnings (the precedent is `ParentHomeworkPage`).
 *
 * The `items` field exposes the CANONICAL `SessionHomeWork` object — no
 * duplicate homework projection. The page metadata trio (`totalCount`,
 * `page`, `pageSize`) is exposed as `Int!` so an out-of-range page yields
 * an empty `items` array next to the honest `totalCount` and the
 * service-clamped effective values echo back to the caller.
 */
export const StudentHomeworkPagePothosObject = gqlSchemaBuilder
  .objectRef<StudentHomeworkPageReturnType>("StudentHomeworkPage")
  .implement({
    fields: t => ({
      items: t.field({
        type: [SessionHomeWorkPothosObject],
        resolve: page => page.items,
      }),
      totalCount: t.exposeInt("totalCount"),
      page: t.exposeInt("page"),
      pageSize: t.exposeInt("pageSize"),
    }),
  });
