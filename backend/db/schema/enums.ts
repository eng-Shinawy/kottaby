import { pgEnum } from "drizzle-orm/pg-core";

/**
 * pgEnum registry — single source of truth for all 21 PostgreSQL enums.
 * Values + order are canonical and mirrored in the matching
 * TypeScript enums under `backend/enum/`.
 */

export const userRole = pgEnum("user_role", ["admin", "teacher", "student", "parent"]);

export const gender = pgEnum("gender", ["male", "female"]);

/**
 * App locale for per-user UI/copy preference (`users.locale`).
 *
 * Values mirror `shared/locale/AppLocale.ts` (`locales = ["ar","en"]`) — the
 * shared const array stays the i18n runtime source of truth; this pgEnum is
 * the database-side closed set, following the same convention as `gender`
 * (a nullable, closed, user-preference enum).
 */
export const appLocale = pgEnum("app_locale", ["ar", "en"]);

export const sessionStatus = pgEnum("session_status", ["scheduled", "started", "completed", "cancelled", "disputed"]);

/**
 * The formal arbitration outcome — persisted on `session.resolution_outcome`
 * when an admin resolves a dispute (either escrow family). Values are
 * wire-identical to the GraphQL `DisputeResolution` enum (the TS enum is the
 * registration source; this pgEnum is the storage mirror). Nullable: rows
 * never disputed (or resolved before the column existed) stay NULL.
 */
export const disputeResolution = pgEnum("dispute_resolution", [
  "Cancel",
  "Complete",
  "Refund",
  "PartialRefund",
  "Uphold",
]);

export const sessionType = pgEnum("session_type", ["student_session", "teacher_evaluation", "re_evaluation"]);

export const sessionIntent = pgEnum("session_intent", ["hifz", "tajweed", "evaluation"]);

/**
 * Primary weakness area recorded on a rubric evaluation
 * (`evaluations.weakness_area`). Unlike `session_intent` — which classifies a
 * session's purpose — this is a failure-area vocabulary: it names the Quranic
 * discipline the evaluated applicant was weakest in, and drives the
 * re-application cooldown length on a failed verification cycle. Nullable at
 * the column level: only rubric submissions record one; student ratings
 * (which share the table) leave it NULL.
 */
export const rubricWeaknessArea = pgEnum("rubric_weakness_area", ["tajweed", "hifz"]);

export const paymentStatus = pgEnum("payment_status", ["pending", "paid", "failed", "refunded"]);

/**
 * Ledger entry vocabulary. `arbitration_reversal` is the compensating
 * teacher-side clawback written when an admin arbitrates a dispute with a
 * refund outcome — it is NOT a withdrawal (no payout request, different
 * provenance: the arbitration service is the only writer).
 */
export const transactionType = pgEnum("transaction_type", ["earning", "withdrawal", "bonus", "arbitration_reversal"]);

export const transactionStatus = pgEnum("transaction_status", ["pending", "completed", "failed"]);

export const paymentGateway = pgEnum("payment_gateway", [
  "stripe",
  "paypal",
  "paymob",
  "fawry",
  "offline_cash",
  "bank_transfer",
  "scholarship",
  "other",
  "mock",
]);

export const subscriptionStatus = pgEnum("subscription_status", [
  "active",
  "pending",
  "expired",
  "cancelled",
  "suspended",
]);

/**
 * Balance lane a subscription plan credits on activation (`plans.balance_lane`).
 *
 * Each plan designates exactly one student balance lane its full
 * `session_count` is credited to when the subscription activates:
 * `hifz` and `tajweed` are the two memorization lesson lanes, `reviews`
 * is the revision-session lane. Nullable at the column level so catalog
 * rows created before a lane was chosen stay valid; purchasing a plan
 * whose lane is still unset fails closed instead of guessing.
 */
export const subscriptionCreditLane = pgEnum("subscription_credit_lane", ["hifz", "tajweed", "reviews"]);

export const linkStatus = pgEnum("link_status", ["pending", "confirmed", "rejected", "expired"]);

export const notificationType = pgEnum("notification_type", [
  "session_request",
  "session_completion",
  "session_cancellation",
  "parent_link_request",
  "system_broadcast",
  "payment_confirmation",
  "evaluation_result",
  "session_dispute_opened",
  "session_dispute_resolved",
  "applicant_outcome",
]);

export const auditActionType = pgEnum("audit_action_type", [
  "create",
  "update",
  "delete",
  "override",
  "adjust",
  "suspend",
  "reactivate",
]);

export const surahJuzRef = pgEnum("surah_juz_ref", [
  "surah_al_fatihah",
  "surah_al_baqarah",
  "surah_aal_imran",
  "surah_an_nisa",
  "surah_al_maidah",
  "surah_al_anam",
  "surah_al_araf",
  "surah_al_anfal",
  "surah_at_tawbah",
  "surah_yunus",
  "surah_hud",
  "surah_yusuf",
  "surah_ar_rad",
  "surah_ibrahim",
  "surah_al_hijr",
  "surah_an_nahl",
  "surah_al_isra",
  "surah_al_kahf",
  "surah_maryam",
  "surah_ta_ha",
  "surah_al_anbiya",
  "surah_al_hajj",
  "surah_al_muminun",
  "surah_an_nur",
  "surah_al_furqan",
  "surah_ash_shuara",
  "surah_an_naml",
  "surah_al_qasas",
  "surah_al_ankabut",
  "surah_ar_rum",
  "surah_luqman",
  "surah_as_sajdah",
  "surah_al_ahzab",
  "surah_saba",
  "surah_fatir",
  "surah_ya_sin",
  "surah_as_saffat",
  "surah_sad",
  "surah_az_zumar",
  "surah_ghafir",
  "surah_fussilat",
  "surah_ash_shura",
  "surah_az_zukhruf",
  "surah_ad_dukhan",
  "surah_al_jathiyah",
  "surah_al_ahqaf",
  "surah_muhammad",
  "surah_al_fath",
  "surah_al_hujurat",
  "surah_qaf",
  "surah_ad_dhariyat",
  "surah_at_tur",
  "surah_an_najm",
  "surah_al_qamar",
  "surah_ar_rahman",
  "surah_al_waqiah",
  "surah_al_hadid",
  "surah_al_mujadilah",
  "surah_al_hashr",
  "surah_al_mumtahanah",
  "surah_as_saff",
  "surah_al_jumuah",
  "surah_al_munafiqun",
  "surah_at_taghabun",
  "surah_at_talaq",
  "surah_at_tahrim",
  "surah_al_mulk",
  "surah_al_qalam",
  "surah_al_haqqah",
  "surah_al_maarij",
  "surah_nuh",
  "surah_al_jinn",
  "surah_al_muzzammil",
  "surah_al_muddaththir",
  "surah_al_qiyamah",
  "surah_al_insan",
  "surah_al_mursalat",
  "surah_an_naba",
  "surah_an_naziat",
  "surah_abasa",
  "surah_at_takwir",
  "surah_al_infitar",
  "surah_al_mutaffifin",
  "surah_al_inshiqaq",
  "surah_al_buruj",
  "surah_at_tariq",
  "surah_al_ala",
  "surah_al_ghashiyah",
  "surah_al_fajr",
  "surah_al_balad",
  "surah_ash_shams",
  "surah_al_layl",
  "surah_ad_duha",
  "surah_ash_sharh",
  "surah_at_tin",
  "surah_al_alaq",
  "surah_al_qadr",
  "surah_al_bayyinah",
  "surah_az_zalzalah",
  "surah_al_adiyat",
  "surah_al_qariah",
  "surah_at_takathur",
  "surah_al_asr",
  "surah_al_humazah",
  "surah_al_fil",
  "surah_quraysh",
  "surah_al_maun",
  "surah_al_kawthar",
  "surah_al_kafirun",
  "surah_an_nasr",
  "surah_al_masad",
  "surah_al_ikhlas",
  "surah_al_falaq",
  "surah_an_nas",
  "juz_1",
  "juz_2",
  "juz_3",
  "juz_4",
  "juz_5",
  "juz_6",
  "juz_7",
  "juz_8",
  "juz_9",
  "juz_10",
  "juz_11",
  "juz_12",
  "juz_13",
  "juz_14",
  "juz_15",
  "juz_16",
  "juz_17",
  "juz_18",
  "juz_19",
  "juz_20",
  "juz_21",
  "juz_22",
  "juz_23",
  "juz_24",
  "juz_25",
  "juz_26",
  "juz_27",
  "juz_28",
  "juz_29",
  "juz_30",
]);

export const teacherRequestPreference = pgEnum("teacher_request_preference", ["queue", "reject", "offer_alternatives"]);

/**
 * One-way lifecycle state of a first-class broadcast header
 * (`broadcasts.status`). A broadcast is born `active` when its send
 * transaction commits and may transition exactly once to `stopped` (the stop
 * retracts the broadcast's notification rows); `stopped` is terminal — no
 * reactivate path exists. Mirrors the canonical TS enum
 * (`backend/enum/notifications/broadcast-status.enum.ts`) byte-for-byte.
 */
export const broadcastStatus = pgEnum("broadcast_status", ["active", "stopped"]);

/**
 * Persisted cohort snapshot of a first-class broadcast header
 * (`broadcasts.audience_type`) — one row per send records the cohort the
 * broadcast targeted. The runtime audience selector stays TS-only
 * (individual notification rows record the resolved recipient, not the
 * cohort); this pgEnum merely persists what happened on the header. Values
 * mirror the canonical TS enum
 * (`backend/enum/notifications/broadcast-audience-type.enum.ts`)
 * byte-for-byte. Nullable at the column level: historical rows whose audit
 * snapshot is missing or unrecognized stay valid instead of blocking a
 * backfill.
 */
export const broadcastAudienceType = pgEnum("broadcast_audience_type", ["all", "role", "country", "plan"]);
