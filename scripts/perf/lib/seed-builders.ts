/**
 * Row builders for the seeded people and catalog tables: teacher and student
 * accounts (users rows plus their role-child rows), the single admin
 * identity, teacher wallets, and the plan catalog. Every generated teacher
 * satisfies the matching pipeline's baseline eligibility (online, certified,
 * governed-free owner); distributions over recitations, subjects, languages,
 * countries, and ratings come from the injected seeded PRNG, so rows are
 * reproducible for a given run identity.
 */

import { UserRole } from "@/backend/enum/users/user-role.enum";
import { adminEmail, intInRange, padSeedIndex, pickRandom } from "@/scripts/perf/lib/seed-random";
import type {
  PlanSeedRow,
  StudentRoleSeedRow,
  TeacherRoleSeedRow,
  UserSeedRow,
  WalletSeedRow,
} from "@/scripts/perf/lib/seed-shapes";
import { RecitationReading } from "@/shared/constants/recitation-reading.enum";

/** Country distribution for synthetic accounts (free text + ISO alpha-2 code). */
const SEED_COUNTRIES: readonly (readonly [country: string, code: string])[] = [
  ["Egypt", "EG"],
  ["Saudi Arabia", "SA"],
  ["United Arab Emirates", "AE"],
  ["Jordan", "JO"],
  ["Kuwait", "KW"],
  ["Qatar", "QA"],
  ["United Kingdom", "GB"],
  ["United States", "US"],
  ["France", "FR"],
  ["Germany", "DE"],
];

/** Non-Arabic language tokens teachers may be fluent in (lowercase, JSON-array members). */
const SEED_LANGUAGES: readonly string[] = ["english", "french", "german", "urdu", "turkish"];

/** Subject sets drawn from the session-intent vocabulary the matching filter matches on. */
const SEED_SUBJECT_SETS: readonly (readonly string[])[] = [["hifz"], ["tajweed"], ["hifz", "tajweed"]];

/** Recitation readings the synthetic teachers are certified in. */
const SEED_RECITATIONS: readonly RecitationReading[] = [
  RecitationReading.HAFS_AN_ASIM,
  RecitationReading.WARSH_AN_NAFI,
  RecitationReading.QALUN_AN_NAFI,
  RecitationReading.AL_DURI_AN_ABI_AMR,
  RecitationReading.KHALAF_AN_HAMZAH,
  RecitationReading.SHUBAH_AN_ASIM,
];

/** Share of teachers left unrated (a rating floor excludes them by construction). */
const UNRATED_SHARE = 0.1;
/** Hours of synthetic last-activity spread. */
const LAST_ACTIVE_SPREAD_HOURS = 72;
/** Milliseconds per hour used by the timestamp spreads. */
const HOUR_MS = 60 * 60 * 1000;

/** Deterministic date-of-birth string derived from the row index. */
function dateOfBirthFor(index: number): string {
  const year = 1975 + (index % 30);
  const month = String(1 + (index % 12)).padStart(2, "0");
  const day = String(1 + (index % 28)).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** Builds the shared account fields every synthetic user carries. */
function userAccountFields(
  index: number,
  now: Date,
  random: () => number
): Pick<UserSeedRow, "dateOfBirth" | "gender" | "country" | "countryCode" | "locale" | "lastActiveAt"> {
  const [country, countryCode] = pickRandom(random, SEED_COUNTRIES);
  return {
    dateOfBirth: dateOfBirthFor(index),
    gender: random() < 0.5 ? "male" : "female",
    country,
    countryCode,
    locale: random() < 0.7 ? "ar" : "en",
    lastActiveAt: new Date(now.getTime() - random() * LAST_ACTIVE_SPREAD_HOURS * HOUR_MS),
  };
}

/**
 * Generates the `users` rows for the teacher volume (one row per teacher).
 *
 * @yields {UserSeedRow} one prefixed teacher account row
 */
export function* generateTeacherUserRows(
  prefix: string,
  count: number,
  passwordHash: string,
  now: Date,
  random: () => number
): Generator<UserSeedRow> {
  for (let index = 0; index < count; index += 1) {
    yield {
      fullName: `${prefix}Teacher ${padSeedIndex(index)}`,
      email: `${prefix}teacher${padSeedIndex(index)}@test.local`,
      phone: `+2010${String(index).padStart(7, "0")}`,
      passwordHash,
      mustChangePassword: false,
      role: UserRole.Teacher,
      isDeleted: false,
      suspended: false,
      isBlocked: false,
      ...userAccountFields(index, now, random),
    };
  }
}

/** Draws one to three distinct certified recitations for a teacher. */
function pickRandomCertifications(random: () => number): RecitationReading[] {
  const chosen = new Set<RecitationReading>();
  const wanted = intInRange(random, 1, 3);
  while (chosen.size < wanted && chosen.size < SEED_RECITATIONS.length) {
    chosen.add(pickRandom(random, SEED_RECITATIONS));
  }
  return [...chosen];
}

/** Draws zero to three non-Arabic language tokens for a teacher. */
function pickRandomLanguages(random: () => number): string[] {
  const chosen = new Set<string>();
  const wanted = intInRange(random, 0, 3);
  while (chosen.size < wanted) {
    chosen.add(pickRandom(random, SEED_LANGUAGES));
  }
  return [...chosen];
}

/** Builds the `teacher` role rows for the created teacher user ids (index-aligned). */
export function buildTeacherRoleRows(teacherUserIds: readonly number[], random: () => number): TeacherRoleSeedRow[] {
  const rows: TeacherRoleSeedRow[] = [];
  for (const id of teacherUserIds) {
    rows.push({
      id,
      isApproved: true,
      isEvaluator: false,
      isOnline: true,
      averageRating: random() < UNRATED_SHARE ? null : (random() * 5).toFixed(2),
      subjects: JSON.stringify(pickRandom(random, SEED_SUBJECT_SETS)),
      recitations: JSON.stringify(pickRandomCertifications(random)),
      languages: JSON.stringify(pickRandomLanguages(random)),
    });
  }
  return rows;
}

/**
 * Generates the `users` rows for the student volume (one row per student).
 *
 * @yields {UserSeedRow} one prefixed student account row
 */
export function* generateStudentUserRows(
  prefix: string,
  count: number,
  passwordHash: string,
  now: Date,
  random: () => number
): Generator<UserSeedRow> {
  for (let index = 0; index < count; index += 1) {
    yield {
      fullName: `${prefix}Student ${padSeedIndex(index)}`,
      email: `${prefix}student${padSeedIndex(index)}@test.local`,
      phone: `+2011${String(index).padStart(7, "0")}`,
      passwordHash,
      mustChangePassword: false,
      role: UserRole.Student,
      isDeleted: false,
      suspended: false,
      isBlocked: false,
      ...userAccountFields(index, now, random),
    };
  }
}

/** Builds the `students` role rows; every student is funded for at least one session. */
export function buildStudentRoleRows(
  prefix: string,
  studentUserIds: readonly number[],
  random: () => number
): StudentRoleSeedRow[] {
  const rows: StudentRoleSeedRow[] = [];
  for (const [index, id] of studentUserIds.entries()) {
    rows.push({
      id,
      balanceHifz: intInRange(random, 4, 20),
      balanceReviews: random() < 0.4 ? intInRange(random, 2, 10) : 0,
      balanceTajweed: random() < 0.4 ? intInRange(random, 2, 10) : 0,
      balanceTrial: 0,
      handshakeCode: `${prefix}KSB-${padSeedIndex(index)}`,
      primaryLanguage: random() < 0.8 ? "arabic" : "english",
    });
  }
  return rows;
}

/** Builds the `plans` catalog rows (three balance lanes, prefix in every title). */
export function buildPlanRows(prefix: string): PlanSeedRow[] {
  return [
    {
      title: `${prefix}Hifz Plan`,
      sessionCount: 8,
      price: "200.00",
      currency: "EGP",
      intervalDays: 30,
      balanceLane: "hifz",
      isActive: true,
    },
    {
      title: `${prefix}Tajweed Plan`,
      sessionCount: 8,
      price: "200.00",
      currency: "EGP",
      intervalDays: 30,
      balanceLane: "tajweed",
      isActive: true,
    },
    {
      title: `${prefix}Reviews Plan`,
      sessionCount: 8,
      price: "200.00",
      currency: "EGP",
      intervalDays: 30,
      balanceLane: "reviews",
      isActive: true,
    },
  ];
}

/** Builds the `wallet` rows (one per teacher, zero balances). */
export function buildWalletRows(teacherUserIds: readonly number[]): WalletSeedRow[] {
  return teacherUserIds.map(teacherId => ({ teacherId, balance: "0.00", totalEarning: "0.00" }));
}

/** Builds the single admin `users` row for the run. */
export function buildAdminUserRow(prefix: string, passwordHash: string, now: Date): UserSeedRow {
  return {
    fullName: `${prefix}Admin`,
    email: adminEmail(prefix),
    phone: "+20120000000",
    passwordHash,
    mustChangePassword: false,
    role: UserRole.Admin,
    dateOfBirth: "1990-06-15",
    gender: "male",
    country: "Egypt",
    countryCode: "EG",
    locale: "en",
    isDeleted: false,
    suspended: false,
    isBlocked: false,
    lastActiveAt: now,
  };
}
