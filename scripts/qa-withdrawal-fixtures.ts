/**
 * QA fixtures for the withdrawal workflow visual pass:
 *  - tops up the demo teacher's wallet with several completed earnings
 *  - one PENDING withdrawal (admin/finances queue shows a pending card)
 *  - one COMPLETED withdrawal (ledger shows a settled payout)
 * Idempotent-ish: skips when the marker description already exists.
 * Run while the dev server is STOPPED (pglite is single-process).
 * Usage: bun run scripts/qa-withdrawal-fixtures.ts
 */
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";

const DB_URL = "file://" + join(process.cwd(), "db/pglite");

/**
 * Derive wallet totals from the ENTIRE ledger — pre-existing rows (e.g.
 * ui-audit-seed-2's wallet + ledger) plus the fixture rows just inserted —
 * so totals always converge with history. The fixture amounts are folded
 * into a ledger-wide aggregate, never applied as an absolute overwrite
 * (a wallet that already existed keeps totals consistent with its rows).
 * Balance semantics mirror the original fixture formula: completed
 * earnings minus completed AND pending withdrawals (pending payouts hold
 * funds). Returns the DB-stored balance (UPDATE ... RETURNING) so logs
 * report the value the database actually persisted.
 */
async function reconcileWalletTotals(pg: PGlite, walletId: number): Promise<string> {
  const totals = await pg.query<{ total_earning: string; balance: string }>(
    `SELECT
       COALESCE(SUM(amount) FILTER (WHERE type = 'earning' AND status = 'completed'), 0)::text AS total_earning,
       (
         COALESCE(SUM(amount) FILTER (WHERE type = 'earning' AND status = 'completed'), 0)
         - COALESCE(SUM(amount) FILTER (WHERE type = 'withdrawal' AND status = 'completed'), 0)
         - COALESCE(SUM(amount) FILTER (WHERE type = 'withdrawal' AND status = 'pending'), 0)
       )::text AS balance
     FROM teacher_transaction
     WHERE wallet_id = $1`,
    [walletId]
  );
  const { total_earning, balance } = totals.rows[0];
  const updated = await pg.query<{ balance: string }>(
    "UPDATE wallet SET balance = $2, total_earning = $3, updated_at = now() WHERE id = $1 RETURNING balance",
    [walletId, balance, total_earning]
  );
  return updated.rows[0].balance;
}

async function main() {
  const pg = new PGlite(DB_URL);
  const now = Date.now();
  const iso = (offsetMin: number) => new Date(now - offsetMin * 60_000).toISOString();

  const teacher = await pg.query<{ id: number }>("SELECT id FROM users WHERE email = $1", ["teacher@demo.local"]);
  const teacherId = teacher.rows[0]?.id;
  if (!teacherId) throw new Error("demo teacher not found");

  const walletRow = await pg.query<{ id: number; balance: string }>(
    "SELECT id, balance FROM wallet WHERE teacher_id = $1",
    [teacherId]
  );
  let walletId = walletRow.rows[0]?.id;
  if (!walletId) {
    const ins = await pg.query<{ id: number }>(
      "INSERT INTO wallet (teacher_id, balance, total_earning) VALUES ($1, 0, 0) RETURNING id",
      [teacherId]
    );
    walletId = ins.rows[0].id;
  }

  const marker = await pg.query<{ n: number }>(
    "SELECT COUNT(*)::int AS n FROM teacher_transaction WHERE wallet_id = $1 AND description LIKE '%Quran circle%'",
    [walletId]
  );
  if (marker.rows[0].n > 0) {
    console.log("[qa-fixtures] already present — skipping");
    await pg.close();
    return;
  }

  // Completed earnings spread across days (ledger variety) — one bulk
  // INSERT (pglite is single-connection; a per-row await loop is both
  // slower and a lint violation).
  const earnings: Array<[string, string, number]> = [
    ["Quran circle — session payout", "150.00", 60 * 24 * 9],
    ["Quran circle — session payout", "180.00", 60 * 24 * 7],
    ["Tajweed intensive — session payout", "220.00", 60 * 24 * 5],
    ["Hifz revision circle — session payout", "140.00", 60 * 24 * 3],
    ["Quran circle — session payout", "160.00", 60 * 24 * 1],
  ];
  // Param layout: $1 = wallet id, then per earning a (desc, amount, ts)
  // triple at $[2+3i], $[3+3i], $[4+3i] — the ts placeholder is reused for
  // both created_at and updated_at.
  const tuples = earnings.map(
    (_, i) => `($1, $${2 + i * 3}, $${3 + i * 3}, 'earning', 'completed', $${4 + i * 3}, $${4 + i * 3})`
  );
  const params: Array<string | number> = [walletId];
  for (const [desc, amount, minsAgo] of earnings) {
    params.push(desc, amount, iso(minsAgo));
  }
  await pg.query(
    `INSERT INTO teacher_transaction (wallet_id, description, amount, type, status, created_at, updated_at)
     VALUES ${tuples.join(", ")}`,
    params
  );
  // Completed withdrawal (settled 12h ago)
  await pg.query(
    `INSERT INTO teacher_transaction (wallet_id, description, amount, type, status, created_at, updated_at)
     VALUES ($1, 'Bank payout — weekly settlement', '200.00', 'withdrawal', 'completed', $2, $2)`,
    [walletId, iso(60 * 12)]
  );

  // Pending withdrawal (the live admin-approval queue item)
  await pg.query(
    `INSERT INTO teacher_transaction (wallet_id, description, amount, type, status, created_at, updated_at)
     VALUES ($1, 'Bank payout — teacher request', '300.00', 'withdrawal', 'pending', $2, $2)`,
    [walletId, iso(45)]
  );

  const storedBalance = await reconcileWalletTotals(pg, walletId);

  const final = await pg.query(
    "SELECT type, status, amount FROM teacher_transaction WHERE wallet_id = $1 ORDER BY created_at DESC",
    [walletId]
  );
  console.log("[qa-fixtures] wallet balance:", storedBalance, "rows:", final.rows.length);
  await pg.close();
}

main().catch(e => {
  console.error("[qa-fixtures] FATAL:", e);
  process.exit(1);
});
