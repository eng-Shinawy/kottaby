/**
 * Canonical recitation-reading (Qira'ah) catalog — the single source of truth
 * for all recitation-reading values across the platform.
 *
 * Values are stable lowercase snake_case API values.
 * Labels are translated (never stored in code) — see `shared/locale/types/recitation/`.
 *
 * Schema guardrail: the physical `recitation` table is session-linked
 * (`session_id UNIQUE NOT NULL`, 1:1 with `session`). This catalog is for
 * user-preference selection only — it MUST NOT be used to create user-linked
 * `recitation` rows. Session recitation rows are created by the session
 * workflow, not through this catalog.
 *
 * The 10 canonical Qira'at (the 7 canonical + 3 Shadhah variants):
 *  - Hafs `an Asim (the most widely practiced reading)
 *  - Warsh `an Nafi
 *  - Qalun `an Nafi
 *  - Al-Duri `an Abu Amr
 *  - Al-Susi `an Abu Amr
 *  - Khalaf `an Hamzah
 *  - Khallad `an Asim
 *  - Shubah `an Asim
 *  - Al-Bazzi `an Ibn Kathir
 *  - Qunbul `an Ibn Kathir
 *
 * @see docs/auth/qiraah-selection-and-c5.md
 */

/**
 * Stable API values for recitation readings (Qira'at).
 *
 * Values are lowercase snake_case to match the GraphQL enum convention.
 * Labels (display names) live in `shared/locale/{en,ar}/recitation/` and are
 * resolved at runtime via `useAppTranslation(Recitation)` (client) or
 * `getServerTranslations(locale).recitationTranslations` (server).
 */
export enum RecitationReading {
  /** Hafs `an Asim — the most widely practiced reading globally */
  HAFS_AN_ASIM = "hafs_an_asim",
  /** Warsh `an Nafi — common in North/West Africa */
  WARSH_AN_NAFI = "warsh_an_nafi",
  /** Qalun `an Nafi — common in Libya/Tunisia */
  QALUN_AN_NAFI = "qalun_an_nafi",
  /** Al-Duri `an Abu Amr — common in Sudan/East Africa */
  AL_DURI_AN_ABI_AMR = "al_duri_an_abi_amr",
  /** Al-Susi `an Abu Amr */
  AL_SUSI_AN_ABI_AMR = "al_susi_an_abi_amr",
  /** Khalaf `an Hamzah */
  KHALAF_AN_HAMZAH = "khalaf_an_hamzah",
  /** Khallad `an Asim */
  KHALLAD_AN_ASIM = "khallad_an_asim",
  /** Shubah `an Asim */
  SHUBAH_AN_ASIM = "shubah_an_asim",
  /** Al-Bazzi `an Ibn Kathir */
  AL_BAZZI_AN_IBN_KATHIR = "al_bazzi_an_ibn_kathir",
  /** Qunbul `an Ibn Kathir */
  QUNBUL_AN_IBN_KATHIR = "qunbul_an_ibn_kathir",
}

/**
 * The canonical ordered list of recitation readings.
 *
 * Order is significant: `HAFS_AN_ASIM` is first because it is the default
 * selection for most users (the most widely practiced reading). The list is
 * consumed by `RecitationCatalogService.listReadings()` and by the public
 * `recitationReadings` GraphQL query.
 */
export const RECITATION_READINGS: ReadonlyArray<RecitationReading> = Object.freeze(Object.values(RecitationReading));

/** Pre-allocated lookup set for O(1) membership check without per-call array allocations. */
const RECITATION_READING_MEMBERS: ReadonlySet<string> = new Set(Object.values(RecitationReading));

/**
 * Type guard: returns `true` if `value` is a valid `RecitationReading` enum
 * value (string). Used by the catalog service + registration validation to
 * safely validate unknown input without unsafe `as` casts.
 *
 * @example
 * if (isRecitationReading(input.preferredRecitation)) { ... }
 */
export function isRecitationReading(value: unknown): value is RecitationReading {
  return typeof value === "string" && RECITATION_READING_MEMBERS.has(value);
}
