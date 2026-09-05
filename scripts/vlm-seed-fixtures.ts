/**
 * Seed a minimal admin + student + teacher fixture set directly via PGlite.
 * Bypasses RegistrationService (which uses pg-pool) and inserts straight
 * into the DB via the WASM Postgres instance.
 *
 * Run AFTER pglite-bootstrap.ts.
 */
import { PGlite } from "@electric-sql/pglite";
import { hash } from "bcryptjs";

const DB_URL = "file:///home/z/my-project/db/pglite";

async function main() {
  const pg = new PGlite(DB_URL);

  // Use a fixed timestamp for reproducibility
  const now = new Date();

  // Check existing
  const existing = await pg.query("SELECT COUNT(*)::int as n FROM users WHERE email LIKE $1", ["vlm-test-%"]);
  if (existing.rows[0].n > 0) {
    console.log(`[seed-fixtures] ${existing.rows[0].n} vlm-test users already exist; aborting to prevent dupes`);
    await pg.close();
    return;
  }

  const adminPasswordHash = await hash("AdminPass123!", 12);
  const studentPasswordHash = await hash("StudentPass123!", 12);
  const teacherPasswordHash = await hash("TeacherPass123!", 12);
  const governedPasswordHash = await hash("GovernedPass123!", 12);

  // 1. Admin A (the actor who will perform governance mutations)
  const adminA = await pg.query(
    `INSERT INTO users (email, password_hash, full_name, role, is_deleted, suspended, is_blocked, locale, created_at, updated_at)
     VALUES ($1, $2, $3, $4, false, false, false, 'en', $5, $5)
     RETURNING id`,
    ["vlm-test-admin-a@app.local", adminPasswordHash, "VLM Test Admin A", "admin", now]
  );
  const adminAId = adminA.rows[0].id;
  console.log(`[seed-fixtures] Admin A id=${adminAId} email=vlm-test-admin-a@app.local password=AdminPass123!`);

  // 2. Admin B (cross-actor visibility — observes governance actions by A)
  const adminB = await pg.query(
    `INSERT INTO users (email, password_hash, full_name, role, is_deleted, suspended, is_blocked, locale, created_at, updated_at)
     VALUES ($1, $2, $3, $4, false, false, false, 'en', $5, $5)
     RETURNING id`,
    ["vlm-test-admin-b@app.local", adminPasswordHash, "VLM Test Admin B", "admin", now]
  );
  const adminBId = adminB.rows[0].id;
  console.log(`[seed-fixtures] Admin B id=${adminBId} email=vlm-test-admin-b@app.local password=AdminPass123!`);

  // 3. Student S (the governance TARGET — gets suspended/blocked/etc.)
  const studentS = await pg.query(
    `INSERT INTO users (email, password_hash, full_name, role, is_deleted, suspended, is_blocked, locale, created_at, updated_at)
     VALUES ($1, $2, $3, $4, false, false, false, 'en', $5, $5)
     RETURNING id`,
    ["vlm-test-student-s@app.local", studentPasswordHash, "VLM Test Student S", "student", now]
  );
  const studentSId = studentS.rows[0].id;
  console.log(`[seed-fixtures] Student S id=${studentSId} email=vlm-test-student-s@app.local password=StudentPass123!`);

  // 4. Teacher T (cross-role containment control — byte-identical across journey)
  const teacherT = await pg.query(
    `INSERT INTO users (email, password_hash, full_name, role, is_deleted, suspended, is_blocked, locale, created_at, updated_at)
     VALUES ($1, $2, $3, $4, false, false, false, 'en', $5, $5)
     RETURNING id`,
    ["vlm-test-teacher-t@app.local", teacherPasswordHash, "VLM Test Teacher T", "teacher", now]
  );
  const teacherTId = teacherT.rows[0].id;
  console.log(`[seed-fixtures] Teacher T id=${teacherTId} email=vlm-test-teacher-t@app.local password=TeacherPass123!`);

  // 5. Governed Admin G (isBlocked=true — proves strict actor guard denies governed actor)
  const adminG = await pg.query(
    `INSERT INTO users (email, password_hash, full_name, role, is_deleted, suspended, is_blocked, blocked_at, locale, created_at, updated_at)
     VALUES ($1, $2, $3, $4, false, false, true, $5, 'en', $5, $5)
     RETURNING id`,
    ["vlm-test-governed-g@app.local", governedPasswordHash, "VLM Test Governed Admin G", "admin", now]
  );
  const adminGId = adminG.rows[0].id;
  console.log(
    `[seed-fixtures] Governed Admin G id=${adminGId} email=vlm-test-governed-g@app.local password=GovernedPass123! (isBlocked=true)`
  );

  // Seed the applicants row for the teacher (required for handshake helpers)
  try {
    await pg.query(
      `INSERT INTO applicants (user_id, status, created_at, updated_at)
       VALUES ($1, 'pending', $2, $2)`,
      [teacherTId, now]
    );
    console.log(`[seed-fixtures] applicants row seeded for teacher T`);
  } catch (e) {
    console.warn(
      `[seed-fixtures] applicants seed skipped: ${String((e instanceof Error ? e.message : null) ?? e).slice(0, 150)}`
    );
  }

  // Seed the students row for student S (required for student-handshake)
  try {
    await pg.query(
      `INSERT INTO students (user_id, created_at, updated_at)
       VALUES ($1, $2, $2)`,
      [studentSId, now]
    );
    console.log(`[seed-fixtures] students row seeded for student S`);
  } catch (e) {
    console.warn(
      `[seed-fixtures] students seed skipped: ${String((e instanceof Error ? e.message : null) ?? e).slice(0, 150)}`
    );
  }

  console.log("\n[seed-fixtures] SUMMARY — fixture cast for VLM cross-user verification:");
  console.log(
    "  Admin A     (governance actor)            email=vlm-test-admin-a@app.local      pwd=AdminPass123!   id=" +
      adminAId
  );
  console.log(
    "  Admin B     (cross-actor observer)        email=vlm-test-admin-b@app.local      pwd=AdminPass123!   id=" +
      adminBId
  );
  console.log(
    "  Student S   (governance target)           email=vlm-test-student-s@app.local   pwd=StudentPass123! id=" +
      studentSId
  );
  console.log(
    "  Teacher T   (cross-role containment ctrl) email=vlm-test-teacher-t@app.local   pwd=TeacherPass123! id=" +
      teacherTId
  );
  console.log(
    "  Governed G  (blocked — strict guard test) email=vlm-test-governed-g@app.local  pwd=GovernedPass123! id=" +
      adminGId
  );

  await pg.close();
}

main().catch(e => {
  console.error("[seed-fixtures] FATAL:", e);
  process.exit(1);
});
