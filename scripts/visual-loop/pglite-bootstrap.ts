/**
 * Seed the PGlite data dir (db/pglite) for the visual-improvement-loop.
 * ONLY run while the dev server is NOT holding the data dir (pglite is
 * single-connection, exclusive).
 *
 * Usage:
 *   bun --env-file=.env run scripts/visual-loop/pglite-bootstrap.ts seed
 */

async function main() {
  const mode = process.argv[2] ?? "seed";
  if (mode === "migrate") {
    const { runMigrations } = await import("@/backend/db/scripts/migrate");
    await runMigrations(false);
    console.log("MIGRATIONS DONE");
    process.exit(0);
  }

  const { db } = await import("@/backend/db");
  const { runAllSeeds } = await import("@/backend/db/seeds");
  await runAllSeeds();

  // The minimal seed creates the teacher USER but no teacher PROFILE row —
  // booking requires an approved profile (TeacherRepository.lockForCertificationCheck).
  await db.execute(
    "INSERT INTO teacher (id, is_approved, is_online) VALUES (2, true, true) ON CONFLICT (id) DO UPDATE SET is_approved = true"
  );
  console.log("TEACHER PROFILE ensured");
  console.log("SEEDS DONE");

  const res = await db.execute(
    "SELECT (SELECT COUNT(*) FROM users) AS users, (SELECT COUNT(*) FROM session) AS sessions"
  );
  console.log("COUNTS:", JSON.stringify(res.rows ?? res));
  const { closePool } = await import("@/backend/db");
  await closePool();
  process.exit(0);
}

main().catch(err => {
  console.error("BOOTSTRAP FAILED:", err);
  process.exit(1);
});
