/**
 * QA session top-up — restores the LIFECYCLE QA fixtures on a live demo DB
 * WITHOUT a full rebuild (the full `qa-session-fixtures.ts` pipeline is
 * idempotent and skips once its marker row exists, and a full rebuild would
 * wipe the accumulated demo state: the parent↔child link, the arbitration
 * history, the wallet ledger). Two writes:
 *
 *  1. The STARTED demo session (tajweed, hold live) gets its clock
 *     refreshed — `started_at` 20 minutes ago, `confirmation_deadline` 45
 *     minutes ahead — and BOTH completion stamps cleared, so the teacher's
 *     Complete CTA and the student's subsequent Confirm affordance are
 *     exercisable with honest (not pre-set) stamps.
 *  2. ONE fresh SCHEDULED session is inserted (hifz lane, 100 EGP, hold
 *     live, deadline +24 h, student booking-acknowledge stamp set — the
 *     original fixture row's shape) and the student's hifz lane is debited
 *     by the fee (escrow semantics: a hold debits its lane).
 *
 * Idempotent: skips when a scheduled session already exists for the demo
 * pair (the marker), but ALWAYS refreshes the started row's clock — rerun
 * any time the deadline went stale (the round-4 finding).
 *
 * Run while the dev server is STOPPED (pglite is single-process).
 * Usage: bun run scripts/qa-session-topup.ts
 */
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";

const DB_URL = "file://" + join(process.cwd(), "db/pglite");
const TEACHER_EMAIL = "teacher@demo.local";
const STUDENT_EMAIL = "student@demo.local";

const MINUTE = 60_000;

/** Clock-refresh + completion-stamp clear on the started demo row. Returns the row id. */
async function refreshStartedSession(pg: PGlite, teacherId: number, studentId: number): Promise<number | null> {
  const refreshed = await pg.query<{ id: number }>(
    `UPDATE session
     SET started_at = $1, confirmation_deadline = $2,
         confirmed_by_student_at = NULL, confirmed_by_teacher_at = NULL,
         updated_at = $3
     WHERE id = (
       SELECT id FROM session
       WHERE teacher_id = $4 AND student_id = $5 AND status = 'started'
       ORDER BY id LIMIT 1
     )
     RETURNING id`,
    [
      new Date(Date.now() - 20 * MINUTE).toISOString(),
      new Date(Date.now() + 45 * MINUTE).toISOString(),
      new Date().toISOString(),
      teacherId,
      studentId,
    ]
  );
  return refreshed.rows[0]?.id ?? null;
}

/**
 * One fresh scheduled row (hifz hold live) + the matching lane debit —
 * ATOMIC: both statements run in one transaction and the debit must
 * actually move a lane row (the student's hifz balance must cover the
 * fee) or the whole thing rolls back, so a `fee_held` session can never
 * exist without its escrow debit.
 * Returns the inserted session row id.
 */
async function insertScheduledSession(pg: PGlite, teacherId: number, studentId: number): Promise<number> {
  return pg.transaction(async tx => {
    const inserted = await tx.query<{ id: number }>(
      `INSERT INTO session (
         teacher_id, student_id, status, session_type, intent, fee, fee_held,
         held_balance_lane, started_at, ended_at, confirmed_by_student_at,
         confirmed_by_teacher_at, confirmation_deadline, cancel_reason,
         dispute_reason, disputed_at, resolution_note, resolved_at, created_at
       ) VALUES ($1, $2, 'scheduled', 'student_session', 'hifz', 100.00, true,
         'hifz', NULL, NULL, $3, NULL, $4, NULL, NULL, NULL, NULL, NULL, $5)
       RETURNING id`,
      [
        teacherId,
        studentId,
        new Date(Date.now() - 60 * MINUTE).toISOString(),
        new Date(Date.now() + 1440 * MINUTE).toISOString(),
        new Date(Date.now() - 90 * MINUTE).toISOString(),
      ]
    );
    // RETURNING on the debit: zero rows means the balance guard failed —
    // throw so the transaction (including the session INSERT) rolls back.
    const debited = await tx.query<{ id: number }>(
      "UPDATE students SET balance_hifz = balance_hifz - 100 WHERE id = $1 AND balance_hifz >= 100 RETURNING id",
      [studentId]
    );
    if (debited.rows.length !== 1) {
      throw new Error(
        "hifz lane debit matched zero rows (balance_hifz below the 100 fee) — rolled back, no fee_held session left behind"
      );
    }
    return inserted.rows[0].id;
  });
}

async function main(): Promise<void> {
  const pg = new PGlite(DB_URL);

  const pair = await pg.query<{ tid: number; sid: number }>(
    `SELECT t.id AS tid, s.id AS sid
     FROM users u
     JOIN teacher t ON t.id = u.id
     JOIN users u2 ON u2.email = $2
     JOIN students s ON s.id = u2.id
     WHERE u.email = $1`,
    [TEACHER_EMAIL, STUDENT_EMAIL]
  );
  const teacherId = pair.rows[0]?.tid;
  const studentId = pair.rows[0]?.sid;
  if (!teacherId || !studentId) throw new Error("demo teacher/student pair not found");

  // 1 — refresh the started row: clock + cleared completion stamps.
  const startedId = await refreshStartedSession(pg, teacherId, studentId);
  console.log(
    startedId !== null
      ? `[qa-session-topup] started session #${startedId} clock refreshed, stamps cleared`
      : "[qa-session-topup] no started session found — clock refresh skipped"
  );

  // 2 — the fresh scheduled row (skip when one already exists: idempotence).
  const existing = await pg.query<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM session
     WHERE teacher_id = $1 AND student_id = $2 AND status = 'scheduled'`,
    [teacherId, studentId]
  );
  if (existing.rows[0].n > 0) {
    console.log("[qa-session-topup] scheduled session already present — insert skipped");
  } else {
    const scheduledId = await insertScheduledSession(pg, teacherId, studentId);
    console.log(`[qa-session-topup] scheduled session #${scheduledId} inserted (hifz hold live, lane debited 100)`);
  }

  const counts = await pg.query<{ status: string; n: number }>(
    `SELECT status::text AS status, COUNT(*)::int AS n FROM session
     WHERE teacher_id = $1 GROUP BY status ORDER BY status`,
    [teacherId]
  );
  console.log("[qa-session-topup] demo pair statuses:", counts.rows.map(r => `${r.status}=${r.n}`).join(", "));
  await pg.close();
}

main().catch(err => {
  console.error("[qa-session-topup] FAILED:", err);
  process.exit(1);
});
