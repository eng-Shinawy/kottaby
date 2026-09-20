/**
 * QA fixtures for the SESSION surface (teacher/student/admin scheduling):
 *  - six demo sessions in every lifecycle status (scheduled, started,
 *    completed x2, cancelled, disputed) between the demo teacher and the
 *    demo student
 *  - homework rows for the started + one completed session
 *  - a submitted report (notes + rating) for one completed session —
 *    the other completed session stays report-less so the teacher's
 *    "submit report" CTA is exercisable
 *  - keeps the student's balance lanes consistent with the escrow
 *    semantics (a hold debits its lane; cancel refunds it)
 * Idempotent: skips when the fixture watermark already exists — the
 * disputed fixture row is identified by its fee AND its dedicated
 * QA-authored dispute reason (never by fee alone, which a real session
 * could match). The inserted session ids are captured with RETURNING and
 * passed EXACTLY to the dependent-record seeder, so homework/reports can
 * never land on pre-existing sessions. All mutations run in ONE
 * transaction: a failed dependent insert rolls the whole fixture back.
 * Run while the dev server is STOPPED (pglite is single-process).
 * Usage: bun run scripts/qa-session-fixtures.ts
 */
import { join } from "node:path";
import { PGlite, type Transaction } from "@electric-sql/pglite";

const DB_URL = "file://" + join(process.cwd(), "db/pglite");
const TEACHER_EMAIL = "teacher@demo.local";
const STUDENT_EMAIL = "student@demo.local";
const PARENT_EMAIL = "parent@demo.local";

/** The disputed fixture row's QA-authored dispute reason — the fixture watermark identity. */
const FIXTURE_DISPUTE_REASON = "Session ended early — half the planned material was not covered.";

/** Structural query client — both `PGlite` and its `Transaction` (single-connection script). */
type PgClient = PGlite | Transaction;

/** The exact ids the dependent-record seeder attaches to (from the INSERT's RETURNING). */
interface FixtureSessionRefs {
  startedId: number | null;
  gradedCompletedId: number | null;
}

/** Column stride for the bulk session INSERT below. */
type SessionRow = Array<string | number | boolean | null>;

/** The six lifecycle rows: (status, type, intent, fee, feeHeld, lane, started, ended, confirmedS, confirmedT, deadline, cancelReason, disputeReason, disputedAt, resolutionNote, resolvedAt, created). */
const SESSIONS: SessionRow[] = [
  // 1 — scheduled, upcoming tomorrow, hold live on the hifz lane
  [
    "scheduled",
    "student_session",
    "hifz",
    "100.00",
    true,
    "hifz",
    null,
    null,
    "iso:60",
    null,
    "ahead:1440",
    null,
    null,
    null,
    null,
    null,
    "iso:90",
  ],
  // 2 — started 20 minutes ago, hold live on the tajweed lane
  [
    "started",
    "student_session",
    "tajweed",
    "100.00",
    true,
    "tajweed",
    "iso:20",
    null,
    "iso:4320",
    "iso:4320",
    "ahead:45",
    null,
    null,
    null,
    null,
    null,
    "iso:4350",
  ],
  // 3 — completed 2 days ago WITH report + graded homework (hold consumed)
  [
    "completed",
    "student_session",
    "hifz",
    "100.00",
    false,
    "hifz",
    "iso:3000",
    "iso:2880",
    "iso:4320",
    "iso:4320",
    null,
    null,
    null,
    null,
    null,
    null,
    "iso:4320",
  ],
  // 4 — completed yesterday WITHOUT a report (teacher CTA exercisable)
  [
    "completed",
    "student_session",
    "tajweed",
    "100.00",
    false,
    "tajweed",
    "iso:1500",
    "iso:1440",
    "iso:2880",
    "iso:2880",
    null,
    null,
    null,
    null,
    null,
    null,
    "iso:2880",
  ],
  // 5 — cancelled (hold refunded → lane net zero), reason persisted
  [
    "cancelled",
    "student_session",
    "hifz",
    "100.00",
    false,
    "hifz",
    null,
    null,
    "iso:5760",
    null,
    null,
    "Family schedule conflict — rescheduling next week.",
    null,
    null,
    null,
    null,
    "iso:5760",
  ],
  // 6 — disputed after completion (the admin arbitration queue's demo row;
  // its dispute reason doubles as the fixture watermark identity)
  [
    "disputed",
    "student_session",
    "tajweed",
    "150.00",
    true,
    "tajweed",
    "iso:8880",
    "iso:8640",
    "iso:10080",
    "iso:10080",
    null,
    null,
    FIXTURE_DISPUTE_REASON,
    "iso:7200",
    null,
    null,
    "iso:10080",
  ],
];

/** Resolves one "iso:<minutes-ago>" / "ahead:<minutes-hence>" token (or passes the literal through). */
function resolveStampToken(token: string, now: number): string {
  const isAhead = token.startsWith("ahead:");
  if (!isAhead && !token.startsWith("iso:")) return token;
  const minutes = Number(token.slice(token.indexOf(":") + 1));
  return new Date(isAhead ? now + minutes * 60_000 : now - minutes * 60_000).toISOString();
}

/** Passes non-string cells through untouched; string cells may be relative-time tokens. */
function stamp(token: string | number | boolean | null, now: number): string | number | boolean | null {
  return typeof token === "string" ? resolveStampToken(token, now) : token;
}

async function resolveDemoPair(pg: PgClient): Promise<{ teacherId: number; studentId: number }> {
  const teacher = await pg.query<{ tid: number }>(
    "SELECT u.id AS tid FROM users u JOIN teacher t ON t.id = u.id WHERE u.email = $1",
    [TEACHER_EMAIL]
  );
  const teacherId = teacher.rows[0]?.tid;
  if (!teacherId) throw new Error("demo teacher not found");
  const student = await pg.query<{ sid: number }>(
    "SELECT u.id AS sid FROM users u JOIN students s ON s.id = u.id WHERE u.email = $1",
    [STUDENT_EMAIL]
  );
  const studentId = student.rows[0]?.sid;
  if (!studentId) throw new Error("demo student not found");
  return { teacherId, studentId };
}

/** The DB rebuild wipes the parent↔child link (the parent monitoring portal renders empty without it). Idempotent. */
async function relinkParent(pg: PgClient, studentId: number): Promise<void> {
  await pg.query(
    `UPDATE students SET parent_id = (SELECT id FROM users WHERE email = $1)
     WHERE id = $2 AND parent_id IS NULL`,
    [PARENT_EMAIL, studentId]
  );
}

/** Pre-hold balances: the two live holds debited up front; the cancelled hold already refunded. */
async function setStudentBalanceLanes(pg: PgClient, studentId: number): Promise<void> {
  await pg.query(
    "UPDATE students SET balance_hifz = 400, balance_tajweed = 150, balance_trial = 0, balance_reviews = 0 WHERE id = $1",
    [studentId]
  );
}

/**
 * One bulk INSERT of the six lifecycle rows (pglite is single-connection).
 * The inserted ids come back via RETURNING and are resolved to the exact
 * fixture references — dependent records never re-query by status, so a
 * pre-existing started/completed session can never receive fixture homework.
 */
async function insertSessions(pg: PgClient, teacherId: number, studentId: number): Promise<FixtureSessionRefs> {
  const now = Date.now();
  const col = (i: number) => SESSIONS.map(row => stamp(row[i], now));
  const inserted = await pg.query<{ id: number; status: string }>(
    `INSERT INTO session (
       teacher_id, student_id, status, session_type, intent, fee, fee_held,
       held_balance_lane, started_at, ended_at, confirmed_by_student_at,
       confirmed_by_teacher_at, confirmation_deadline, cancel_reason,
       dispute_reason, disputed_at, resolution_note, resolved_at, created_at
     ) SELECT $1, $2, s.status::session_status, s.session_type::session_type, s.intent::session_intent, s.fee, s.fee_held, s.held_balance_lane, s.started_at, s.ended_at, s.confirmed_by_student_at, s.confirmed_by_teacher_at, s.confirmation_deadline, s.cancel_reason, s.dispute_reason, s.disputed_at, s.resolution_note, s.resolved_at, s.created_at FROM unnest($3::text[], $4::text[], $5::text[], $6::numeric[], $7::boolean[], $8::text[], $9::timestamp[], $10::timestamp[], $11::timestamp[], $12::timestamp[], $13::timestamp[], $14::varchar[], $15::varchar[], $16::timestamp[], $17::varchar[], $18::timestamp[], $19::timestamp[]) AS s(status, session_type, intent, fee, fee_held, held_balance_lane, started_at, ended_at, confirmed_by_student_at, confirmed_by_teacher_at, confirmation_deadline, cancel_reason, dispute_reason, disputed_at, resolution_note, resolved_at, created_at) RETURNING id, status::text AS status`,
    [
      teacherId,
      studentId,
      col(0),
      col(1),
      col(2),
      col(3),
      col(4),
      col(5),
      col(6),
      col(7),
      col(8),
      col(9),
      col(10),
      col(11),
      col(12),
      col(13),
      col(14),
      col(15),
      col(16),
    ]
  );
  // Sequence ids are assigned in unnest (fixture) order — the lowest-id
  // completed row is fixture row 3, the graded one.
  const byId = inserted.rows.toSorted((a, b) => a.id - b.id);
  const startedId = byId.find(r => r.status === "started")?.id ?? null;
  const gradedCompletedId = byId.find(r => r.status === "completed")?.id ?? null;
  return { startedId, gradedCompletedId };
}

/** Homework for the EXACT fixture started + graded completed session ids (from the INSERT's RETURNING). */
async function seedHomeworkAndReport(pg: PgClient, refs: FixtureSessionRefs): Promise<void> {
  const { startedId, gradedCompletedId } = refs;
  if (startedId !== null) {
    await pg.query(
      `INSERT INTO home_work (session_id, current_from_ayah, current_to_ayah, current_surah_juz)
       VALUES ($1, 1, 10, 'juz_29')`,
      [startedId]
    );
  }
  if (gradedCompletedId !== null) {
    await pg.query(
      `INSERT INTO home_work (session_id, current_from_ayah, current_to_ayah, current_grade, current_surah_juz, revision_from_ayah, revision_to_ayah, revision_grade, revision_surah_juz)
       VALUES ($1, 11, 20, 92, 'juz_29', 1, 10, 95, 'juz_29')`,
      [gradedCompletedId]
    );
    await pg.query(
      `INSERT INTO reports (session_id, teacher_notes, student_rating_by_teacher)
       VALUES ($1, $2, 5)`,
      [
        gradedCompletedId,
        "Excellent memorization focus today. Al-Mulk flowing smoothly; revise the last two ayat before the next circle.",
      ]
    );
  }
}

async function main(): Promise<void> {
  const pg = new PGlite(DB_URL);
  const { teacherId, studentId } = await resolveDemoPair(pg);
  // Dedicated fixture identity: the disputed row's fee AND its QA-authored
  // dispute reason (a real 150-fee session without that exact reason text
  // can no longer cause a false skip).
  const marker = await pg.query<{ n: number }>(
    "SELECT COUNT(*)::int AS n FROM session WHERE teacher_id = $1 AND student_id = $2 AND fee = 150 AND dispute_reason = $3",
    [teacherId, studentId, FIXTURE_DISPUTE_REASON]
  );
  if (marker.rows[0].n > 0) {
    console.log("[qa-session-fixtures] already present — skipping");
    await pg.close();
    return;
  }
  // One transaction: a failed dependent insert rolls the whole fixture
  // back (no partial fixture state).
  await pg.transaction(async tx => {
    await relinkParent(tx, studentId);
    await setStudentBalanceLanes(tx, studentId);
    const refs = await insertSessions(tx, teacherId, studentId);
    await seedHomeworkAndReport(tx, refs);
  });
  const counts = await pg.query<{ status: string; n: number }>(
    "SELECT status::text AS status, COUNT(*)::int AS n FROM session WHERE teacher_id = $1 GROUP BY status ORDER BY status",
    [teacherId]
  );
  console.log("[qa-session-fixtures] seeded:", counts.rows.map(r => `${r.status}=${r.n}`).join(", "));
  await pg.close();
}

main().catch(err => {
  console.error("[qa-session-fixtures] FAILED:", err);
  process.exit(1);
});
