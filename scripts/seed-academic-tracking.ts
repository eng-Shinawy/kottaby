/**
 * Academic-tracking visual-audit seed: fills the PGlite dir with the data the
 * two /admin/academic-tracking pages render — a teacher child row, extra
 * students, completed sessions, and graded home_work rows on both tracks
 * (Jadid = current_*, Madi = revision_*).
 *
 * Run AFTER pglite-bootstrap.ts + ui-audit-seed.ts, with the dev server
 * STOPPED (PGlite data dirs are exclusive per process).
 *
 * Usage: bun run scripts/seed-academic-tracking.ts
 */
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";

const DB_URL = "file://" + join(process.cwd(), "db/pglite");

const STUDENTS: Array<{ email: string; fullName: string }> = [
  { email: "ahmed.hassan@demo.local", fullName: "Ahmed Hassan" },
  { email: "youssef.ibrahim@demo.local", fullName: "يوسف إبراهيم" },
  { email: "mariam.abdullah@demo.local", fullName: "مريم عبد الله" },
  { email: "omar.farouk@demo.local", fullName: "Omar Farouk" },
  { email: "hana.khalid@demo.local", fullName: "Hana Khalid" },
  { email: "zaid.mahmoud@demo.local", fullName: "Zaid Mahmoud" },
  { email: "laya.saleh@demo.local", fullName: "Laya Saleh" },
];

/** Deterministic per-student academic profile: surah/juz + ayah + grades. */
const PROFILES = [
  {
    cur: "juz_2",
    curFrom: 1,
    curTo: 12,
    curGrade: 92,
    rev: "surah_al_baqarah",
    revFrom: 141,
    revTo: 152,
    revGrade: 88,
  },
  { cur: "juz_5", curFrom: 4, curTo: 18, curGrade: 85, rev: "juz_3", revFrom: 22, revTo: 31, revGrade: 90 },
  { cur: "juz_21", curFrom: 1, curTo: 22, curGrade: 78, rev: "juz_17", revFrom: 2, revTo: 11, revGrade: 82 },
  { cur: "juz_29", curFrom: 8, curTo: 19, curGrade: 95, rev: "juz_28", revFrom: 1, revTo: 20, revGrade: 93 },
  { cur: "juz_30", curFrom: 1, curTo: 15, curGrade: 66, rev: "juz_29", revFrom: 1, revTo: 9, revGrade: 71 },
  { cur: "juz_12", curFrom: 5, curTo: 16, curGrade: 88, rev: "juz_11", revFrom: 61, revTo: 72, revGrade: 84 },
  { cur: "juz_1", curFrom: 1, curTo: 7, curGrade: null, rev: "surah_al_fatihah", revFrom: 1, revTo: 7, revGrade: 90 },
];

/** Deterministic history anchors: three weekly session dates at 10:00 UTC. */
function historyDate(daysAgo: number): Date {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - daysAgo);
  d.setUTCHours(10, 0, 0, 0);
  return d;
}

const JUZ = [
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
];

async function ensureTeacher(pg: PGlite): Promise<number> {
  const teacher = await pg.query<{ id: number }>("SELECT id FROM users WHERE email = $1", ["teacher@demo.local"]);
  if (teacher.rows.length === 0) throw new Error("teacher@demo.local not found — run ui-audit-seed first");
  const teacherId = teacher.rows[0].id;
  await pg.query(
    `INSERT INTO teacher (id, is_approved, is_evaluator, subjects, created_at, updated_at)
     SELECT $1, true, true, '["hifz","tajweed"]', NOW(), NOW()
     WHERE NOT EXISTS (SELECT 1 FROM teacher WHERE id = $1)`,
    [teacherId]
  );
  await pg.query(
    `INSERT INTO wallet (teacher_id, balance, created_at, updated_at)
     SELECT $1, 1500.00, NOW(), NOW() WHERE NOT EXISTS (SELECT 1 FROM wallet WHERE teacher_id = $1)`,
    [teacherId]
  );
  console.log(`[seed-academic] teacher child row + wallet ensured (teacherId=${teacherId})`);
  return teacherId;
}

async function ensureStudents(pg: PGlite): Promise<number[]> {
  const studentIds: number[] = [];
  const base = await pg.query<{ id: number }>("SELECT id FROM users WHERE email = $1", ["student@demo.local"]);
  studentIds.push(base.rows[0].id);
  for (const s of STUDENTS) {
    const existing = await pg.query<{ id: number }>("SELECT id FROM users WHERE email = $1", [s.email]);
    let id: number;
    if (existing.rows.length > 0) {
      id = existing.rows[0].id;
      // Keep the display name in step with the fixture (renames are data, not drift).
      await pg.query(`UPDATE users SET full_name = $2, updated_at = NOW() WHERE id = $1`, [id, s.fullName]);
    } else {
      const ins = await pg.query<{ id: number }>(
        `INSERT INTO users (email, password_hash, full_name, role, is_deleted, suspended, is_blocked, locale, created_at, updated_at)
         VALUES ($1, (SELECT password_hash FROM users WHERE email = 'student@demo.local'), $2, 'student', false, false, false, 'en', NOW(), NOW())
         RETURNING id`,
        [s.email, s.fullName]
      );
      id = ins.rows[0].id;
      // Stagger createdAt so the dashboard's desc(createdAt) order is stable.
      const staggered = new Date(Date.now() - studentIds.length * 86400000);
      await pg.query(`UPDATE users SET created_at = $2, updated_at = $2 WHERE id = $1`, [id, staggered]);
    }
    await pg.query(
      `INSERT INTO students (id, handshake_code, balance_trial, created_at, updated_at)
       SELECT $1, 'KSB-' || upper(substr(md5(random()::text), 1, 8)), 0, NOW(), NOW()
       WHERE NOT EXISTS (SELECT 1 FROM students WHERE id = $1)`,
      [id]
    );
    studentIds.push(id);
  }
  console.log(`[seed-academic] students ready: ${studentIds.length}`);
  return studentIds;
}

async function seedHistory(pg: PGlite, teacherId: number, studentIds: number[]): Promise<void> {
  // Wipe-first so re-runs never duplicate (the NOT EXISTS guard alone cannot
  // dedupe across runs — Date.now() moves the timestamps every run).
  await pg.query(
    `DELETE FROM home_work WHERE session_id IN (SELECT s.id FROM session s WHERE s.teacher_id = $1 AND s.session_type = 'student_session')`,
    [teacherId]
  );
  await pg.query(`DELETE FROM session WHERE teacher_id = $1 AND session_type = 'student_session'`, [teacherId]);
  console.log("[seed-academic] prior demo sessions wiped");
  let sessionCount = 0;
  let homeworkCount = 0;
  for (let si = 0; si < studentIds.length; si++) {
    const studentId = studentIds[si];
    const p = PROFILES[si % PROFILES.length];
    for (let w = 2; w >= 0; w--) {
      // History rows: older sessions have earlier positions + slightly lower grades.
      const daysAgo = w * 7 + si;
      const startedAt = historyDate(daysAgo);
      const endedAt = new Date(startedAt.getTime() + 3600000);
      const sess = await pg.query<{ id: number }>(
        `INSERT INTO session (teacher_id, student_id, status, session_type, intent, fee, started_at, ended_at, created_at, updated_at)
         SELECT $1, $2, 'completed', 'student_session', 'hifz', 120.00, $3, $4, $3, $3
         WHERE NOT EXISTS (
           SELECT 1 FROM session s JOIN home_work hw ON hw.session_id = s.id
           WHERE s.student_id = $2 AND s.created_at = $3::timestamp
         )
         RETURNING id`,
        [teacherId, studentId, startedAt, endedAt]
      );
      if (sess.rows.length === 0) continue;
      const sessionId = sess.rows[0].id;
      sessionCount++;
      const curGrade = p.curGrade === null ? null : Math.max(50, (p.curGrade ?? 80) - w * 2);
      const revGrade = Math.max(50, p.revGrade - w * 3);
      const curSj = w === 0 ? p.cur : JUZ[Math.min(29, (si + w) % 30)];
      const revSj = w === 0 ? p.rev : JUZ[Math.min(29, (si + w + 7) % 30)];
      await pg.query(
        `INSERT INTO home_work (session_id, current_from_ayah, current_to_ayah, current_grade, current_surah_juz,
                                revision_from_ayah, revision_to_ayah, revision_grade, revision_surah_juz, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10)`,
        [sessionId, p.curFrom, p.curTo, curGrade, curSj, p.revFrom, p.revTo, revGrade, revSj, startedAt]
      );
      homeworkCount++;
    }
  }
  console.log(`[seed-academic] sessions=${sessionCount} homework=${homeworkCount}`);
}

async function seedProgress(pg: PGlite, studentIds: number[]): Promise<void> {
  await pg.query(`DELETE FROM progress WHERE student_id = ANY($1::int[])`, [studentIds]);
  let progressCount = 0;
  for (let i = 0; i < studentIds.length; i++) {
    const rows = 2 + (i % 4);
    for (let r = 0; r < rows; r++) {
      await pg.query(`INSERT INTO progress (student_id, lesson_id, created_at, updated_at) VALUES ($1, NULL, $2, $2)`, [
        studentIds[i],
        historyDate(r * 5 + i),
      ]);
      progressCount++;
    }
  }
  console.log(`[seed-academic] progress rows=${progressCount}`);
}

async function main(): Promise<void> {
  const pg = new PGlite(DB_URL);
  await pg.query("SELECT 1 AS ok");
  console.log("[seed-academic] connected");

  const teacherId = await ensureTeacher(pg);
  const studentIds = await ensureStudents(pg);
  await seedHistory(pg, teacherId, studentIds);
  await seedProgress(pg, studentIds);

  const summary = await pg.query<{ n: number }>(`SELECT COUNT(*)::int AS n FROM users WHERE role = 'student'`);
  console.log(`[seed-academic] FINAL student count: ${summary.rows[0].n}`);
  await pg.close();
  process.exit(0);
}

main().catch(e => {
  console.error("[seed-academic] FATAL:", e);
  process.exit(1);
});
