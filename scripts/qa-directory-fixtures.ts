/**
 * QA fixtures for the STUDENT TEACHER DIRECTORY browse (`/student/teachers`):
 * seeds exactly THREE clearly-demo teacher accounts so the browse page
 * renders populated results in QA/audit sessions.
 *
 *   - demo.teacher1@draftacademy.local  "Demo Teacher One"    hifz
 *   - demo.teacher2@draftacademy.local  "Demo Teacher Two"    hifz + tajweed
 *   - demo.teacher3@draftacademy.local  "Demo Teacher Three"  tajweed
 *
 * All three carry the default-browse-eligible profile (recitations
 * `["hafs_an_asim"]`, approved, online, EG country — consistent with the
 * other demo users) so teacher1/2 surface under the default Hifz subject
 * filter and teacher2/3 under Tajweed.
 *
 * LOAD-BEARING: `average_rating` MUST stay NULL — DO NOT "helpfully" add
 * ratings to these rows. The repo suite's ordering-window assertions
 * (`backend/db/test/repo/teachers/teacher.repository.test.ts`, the
 * `listMatchingCandidates` "windows the page…" block) read the LIVE
 * `app_db` table (`.env.test` points DATABASE_URL at it) and order by
 * `average_rating DESC NULLS LAST, id DESC`. ANY rated live teacher
 * matching the default filters would sort AHEAD of that test's unrated
 * in-transaction fixtures and break the window assertions — exactly the
 * round-2 pollution incident (worklog cron-webdevreview-2). Unrated demo
 * teachers are window-safe: within the NULLS-LAST group ordering is
 * `id DESC`, and the suite's fixtures are always created later, so they
 * carry higher ids and outrank these rows deterministically.
 *
 * Idempotent + re-runnable (the tracked-id qa-* pattern): users are
 * looked up by email FIRST and inserted only if missing; the teacher
 * child row is upserted by its shared PK (a re-run restores the fixture
 * profile — approval/online/token columns ONLY; the rating column is
 * never written). Nothing is ever deleted. Passwords mirror the standard
 * seed credential (`loadSeedConfig().defaultAdminCredential`, bcrypt 12 —
 * the same `hashPassword` the registration path uses) so QA can LOG IN.
 * The effective password is whatever `loadSeedConfig` resolves at RUN
 * time: the `ADMIN_PASSWORD` env var when set (the sandbox `.env` carries
 * `adminpassword123`), the `Seed_Pass1!` fallback otherwise — the script
 * prints the resolved SOURCE (never the value) after seeding.
 * Usage: bun run scripts/qa-directory-fixtures.ts
 */
import { eq } from "drizzle-orm";
import { closePool, db } from "@/backend/db";
import { teacher } from "@/backend/db/schema/teachers/teacher";
import { users } from "@/backend/db/schema/users/users";
import { loadSeedConfig } from "@/backend/db/seeds/lib";
import { UserRole } from "@/backend/enum/users/user-role.enum";
import { hashPassword } from "@/backend/lib/auth/password";

/** One demo teacher's fixture spec (all match the default browse filters). */
interface DirectoryTeacherSpec {
  readonly email: string;
  readonly fullName: string;
  /** Distinct demo phone (the seed users occupy +201000000001..004). */
  readonly phone: string;
  readonly subjects: readonly string[];
  readonly languages: readonly string[];
}

const DIRECTORY_TEACHERS: readonly DirectoryTeacherSpec[] = [
  {
    email: "demo.teacher1@draftacademy.local",
    fullName: "Demo Teacher One",
    phone: "+201000000011",
    subjects: ["hifz"],
    languages: ["arabic", "english"],
  },
  {
    email: "demo.teacher2@draftacademy.local",
    fullName: "Demo Teacher Two",
    phone: "+201000000012",
    subjects: ["hifz", "tajweed"],
    languages: ["arabic"],
  },
  {
    email: "demo.teacher3@draftacademy.local",
    fullName: "Demo Teacher Three",
    phone: "+201000000013",
    subjects: ["tajweed"],
    languages: ["english", "french"],
  },
];

/** The shared profile tokens: the one Qira'ah reading + the JSON-in-varchar encoder. */
const RECITATION_TOKENS = '["hafs_an_asim"]';
const jsonColumnPayload = (tokens: readonly string[]): string => JSON.stringify([...tokens]);

/**
 * Ensures ONE demo teacher: the users row is looked up by email FIRST and
 * inserted only if missing; the teacher child row is upserted by its
 * shared PK (the rating column is deliberately ABSENT from both arms —
 * see the LOAD-BEARING note above). Returns what happened, for the report.
 */
async function ensureDirectoryTeacher(spec: DirectoryTeacherSpec, passwordHash: string): Promise<string> {
  const existing = await db.select({ id: users.id }).from(users).where(eq(users.email, spec.email)).limit(1);
  const foundUser = existing[0];
  let userId: number;
  let outcome: string;
  if (foundUser) {
    userId = foundUser.id;
    outcome = "found";
  } else {
    const [created] = await db
      .insert(users)
      .values({
        fullName: spec.fullName,
        email: spec.email,
        phone: spec.phone,
        passwordHash,
        role: UserRole.Teacher,
        isDeleted: false,
        suspended: false,
        isBlocked: false,
        lastActiveAt: new Date(),
        country: "Egypt",
        countryCode: "EG",
      })
      .returning({ id: users.id });
    if (!created) throw new Error(`user insert returned no rows for ${spec.email}`);
    userId = created.id;
    outcome = "created";
  }
  await db
    .insert(teacher)
    .values({
      id: userId,
      isApproved: true,
      isOnline: true,
      subjects: jsonColumnPayload(spec.subjects),
      recitations: RECITATION_TOKENS,
      languages: jsonColumnPayload(spec.languages),
    })
    .onConflictDoUpdate({
      target: teacher.id,
      set: {
        isApproved: true,
        isOnline: true,
        subjects: jsonColumnPayload(spec.subjects),
        recitations: RECITATION_TOKENS,
        languages: jsonColumnPayload(spec.languages),
      },
    });
  return `${spec.email}: user ${outcome}, teacher row upserted`;
}

async function main(): Promise<void> {
  // Three explicit sequential calls — deterministic insert order, no
  // awaits-in-a-loop (single-pool writes stay ordered and readable).
  const passwordHash = await hashPassword(loadSeedConfig().defaultAdminCredential);
  console.log(
    `[qa-directory-fixtures] password source: ${process.env.ADMIN_PASSWORD ? "ADMIN_PASSWORD env" : "Seed_Pass1! fallback"}`
  );
  const [first, second, third] = DIRECTORY_TEACHERS;
  if (!first || !second || !third) throw new Error("the directory fixture table must list exactly three teachers");
  console.log(`[qa-directory-fixtures] ${await ensureDirectoryTeacher(first, passwordHash)}`);
  console.log(`[qa-directory-fixtures] ${await ensureDirectoryTeacher(second, passwordHash)}`);
  console.log(`[qa-directory-fixtures] ${await ensureDirectoryTeacher(third, passwordHash)}`);
  await closePool();
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error("[qa-directory-fixtures] FAILED:", error);
    process.exit(1);
  });
