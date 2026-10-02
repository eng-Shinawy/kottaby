/**
 * Verification seed extension — ensures certified `teacher` rows exist for
 * the UI-audit demo teachers and provisions a second low-balance teacher so
 * BOTH wallet outcomes of the admin-ordered re-evaluation flow can be
 * exercised end-to-end in the browser:
 *
 *  - teacher@demo.local  → wallet 1500.00 EGP (success path, fee is 100.00)
 *  - teacher2@demo.local → wallet 20.00 EGP   (insufficient-funds path)
 *
 * Run AFTER `scripts/pglite-bootstrap.ts` + `scripts/ui-audit-seed.ts`.
 * Usage: bun run scripts/verify-seed-teachers.ts
 */
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { hash } from "bcryptjs";

const DB_URL = "file://" + join(process.cwd(), "db/pglite");
const DEMO_PASSWORD = "Password123!";

async function upsertUser(
  pg: PGlite,
  email: string,
  fullName: string,
  role: string,
  passwordHash: string
): Promise<number> {
  const existing = await pg.query<{ id: number }>("SELECT id FROM users WHERE email = $1", [email]);
  if (existing.rows.length > 0) return existing.rows[0].id;
  const now = new Date();
  const res = await pg.query<{ id: number }>(
    `INSERT INTO users (email, password_hash, full_name, role, is_deleted, suspended, is_blocked, locale, created_at, updated_at)
     VALUES ($1, $2, $3, $4, false, false, false, 'en', $5, $5) RETURNING id`,
    [email, passwordHash, fullName, role, now]
  );
  return res.rows[0].id;
}

async function ensureApplicantPassed(pg: PGlite, id: number): Promise<void> {
  const now = new Date();
  await pg.query(
    `INSERT INTO applicants (id, status, created_at, updated_at)
     VALUES ($1, 'passed', $2, $2)
     ON CONFLICT (id) DO UPDATE SET status = 'passed', updated_at = $2`,
    [id, now]
  );
}

async function ensureTeacherRow(pg: PGlite, id: number): Promise<void> {
  const now = new Date();
  await pg.query(
    `INSERT INTO teacher (id, is_approved, is_evaluator, is_online, subjects, created_at, updated_at)
     VALUES ($1, true, false, false, '["quran","tajweed"]', $2, $2)
     ON CONFLICT (id) DO UPDATE SET is_approved = true, updated_at = $2`,
    [id, now]
  );
}

async function ensureWallet(pg: PGlite, teacherId: number, balance: string): Promise<void> {
  const now = new Date();
  await pg.query(
    `INSERT INTO wallet (teacher_id, balance, total_earning, created_at, updated_at)
     VALUES ($1, $2, $2, $3, $3)
     ON CONFLICT (teacher_id) DO UPDATE SET balance = $2, updated_at = $3`,
    [teacherId, balance, now]
  );
}

async function main(): Promise<void> {
  const pg = new PGlite(DB_URL);
  await pg.query("SELECT 1 AS ok");
  console.log("[verify-seed] connected");

  // Primary teacher comes from ui-audit-seed (applicants 'passed' + wallet 1500).
  const demoHash = await hash(DEMO_PASSWORD, 12);
  const t1 = await upsertUser(pg, "teacher@demo.local", "Demo Teacher", "teacher", demoHash);
  await ensureApplicantPassed(pg, t1);
  await ensureTeacherRow(pg, t1);
  await ensureWallet(pg, t1, "1500.00");

  // Second teacher — certified + passed, but BELOW the 100.00 fee.
  const t2 = await upsertUser(pg, "teacher2@demo.local", "Low Balance Teacher", "teacher", demoHash);
  await ensureApplicantPassed(pg, t2);
  await ensureTeacherRow(pg, t2);
  await ensureWallet(pg, t2, "20.00");

  const summary = await pg.query<{
    id: number;
    email: string;
    role: string;
    status: string | null;
    approved: boolean | null;
    balance: string | null;
  }>(
    `SELECT u.id, u.email, u.role::text AS role, a.status::text AS status, t.is_approved AS approved, w.balance::text AS balance
     FROM users u
     LEFT JOIN applicants a ON a.id = u.id
     LEFT JOIN teacher t ON t.id = u.id
     LEFT JOIN wallet w ON w.teacher_id = u.id
     WHERE u.role::text IN ('admin','teacher') ORDER BY u.id`
  );
  for (const r of summary.rows) {
    console.log(
      `[verify-seed] user#${r.id} ${r.email} role=${r.role} applicant=${r.status ?? "-"} approved=${String(r.approved)} wallet=${r.balance ?? "-"}`
    );
  }
  await pg.close();
  process.exit(0);
}

main().catch(e => {
  console.error("[verify-seed] FATAL:", e);
  process.exit(1);
});
