/**
 * Shared homework-track GraphQL object factory — the ONE field projection
 * for a single homework track (Jadid or Madi) behind both read surfaces
 * that model it: `ParentHomeworkTrack` (parent monitoring) and
 * `AdminAcademicHomeworkTrack` (admin academic tracking).
 *
 * The two canonical return types are structurally the same closed value
 * object — surah/juz reference, optional ayah range, write-once nullable
 * grade — so the field registration is shared verbatim here: same field
 * names, EXACT per-field nullability, and the ONCE-registered
 * `SurahJuzRefPothosEnum` (per `backend/graphql/pothos/AGENTS.md` — enums
 * are never re-registered in domain files, and object fields stay pure
 * structural passthroughs with zero resolve-time logic). The factory
 * creates the ref on the shared builder singleton and implements the four
 * fields generically, so each surface keeps its own typed ref and owns its
 * GraphQL object name — the wire shape is byte-identical to the
 * pre-extraction schema.
 */

import type { SurahJuzRef } from "@/backend/enum";
import { gqlSchemaBuilder } from "@/backend/graphql/pothos/builder";
import { SurahJuzRefPothosEnum } from "@/backend/graphql/pothos/shared/enum.pothos";

/** The structural contract every homework-track return type satisfies. */
interface HomeworkTrackShape {
  readonly surahJuz: SurahJuzRef | null;
  readonly fromAyah: number | null;
  readonly toAyah: number | null;
  readonly grade: number | null;
}

/**
 * Creates and implements a homework-track object ref on the shared
 * builder. Generic over the canonical return type (`AdminAcademicHomeworkTrackReturnType`
 * / `ParentHomeworkTrackReturnType`) so each surface keeps its own typed
 * ref with no casts; callers own the GraphQL object name. Each field is a
 * pure structural passthrough resolved from the parent's own property —
 * the `t.field` form keeps the generic ref type-safe (the `t.expose`
 * shorthand cannot prove its `keyof T` contract over an unresolved
 * generic) while producing the byte-identical SDL.
 */
export function implementHomeworkTrackObject<T extends HomeworkTrackShape>(name: string) {
  return gqlSchemaBuilder.objectRef<T>(name).implement({
    fields: t => ({
      // Surah/juz reference — nullable `SurahJuzRef`; null when the track
      // has no assignment recorded (per-field nullability is preserved
      // when only some legs are unset).
      surahJuz: t.field({ type: SurahJuzRefPothosEnum, nullable: true, resolve: parent => parent.surahJuz }),
      // Ayah range — nullable `Int` legs (null when the track records a
      // reference without a numeric range).
      fromAyah: t.field({ type: "Int", nullable: true, resolve: parent => parent.fromAyah }),
      toAyah: t.field({ type: "Int", nullable: true, resolve: parent => parent.toAyah }),
      // Recorded grade — nullable `Int` on the [0, 100] scale, null until
      // the teacher records it (NEVER fabricated to 0).
      grade: t.field({ type: "Int", nullable: true, resolve: parent => parent.grade }),
    }),
  });
}
