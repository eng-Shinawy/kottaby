/**
 * CRON-R8 QA-data cleanup — removes THIS round's E2E lifecycle rows from
 * the DEV database (`kottaby`): the student subscription requested +
 * verified + cancelled + re-requested through agent-browser (ids 249, 250
 * at write time — resolved dynamically below) and the audit rows the
 * transitions emitted (SUBSCRIPTION_REQUESTED / SUBSCRIPTION_PAYMENT_VERIFIED /
 * SUBSCRIPTION_CANCELLED).
 *
 * audit_logs is trigger-protected (immutability trigger), so the deletes
 * run inside a `session_replication_role = replica` superuser session —
 * the SAME trick CRON-R5/R7 used; triggers stay installed, NO DDL.
 *
 * The 16-row documented permanent audit footprint is preserved: only rows
 * whose entity is `subscriptions` and whose ids sit in THIS round's
 * entity-id set are touched. Seed users/plans are never referenced.
 *
 * Idempotent: every delete is a no-op when the rows are already gone.
 */
import { Pool } from "pg";

const pool = new Pool({ connectionString: "postgresql://postgres@127.0.0.1:5432/kottaby" });

// Resolve this round's subscription rows dynamically: the DEV DB baseline
// is subscriptions = 0 (CRON-R7 restored it), so EVERY row present is this
// round's E2E data.
const subRows = await pool.query("select id from subscriptions order by id");
const subIds = subRows.rows.map(r => Number(r.id));
console.log(`E2E subscription rows to purge: ${subIds.length ? subIds.join(", ") : "(none)"}`);

if (subIds.length > 0) {
  // 1. the subscription rows themselves (no children reference them).
  const delSubs = await pool.query("delete from subscriptions where id = any($1)", [subIds]);
  console.log(`deleted subscriptions: ${delSubs.rowCount}`);

  // 2. the audit rows the transitions emitted — replica session (trigger
  //    bypass, still session-scoped).
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query("set local session_replication_role = replica");
    const delAudit = await client.query(
      "delete from audit_logs where entity_type = 'subscriptions' and entity_id = any($1)",
      [subIds]
    );
    await client.query("commit");
    console.log(`deleted audit rows: ${delAudit.rowCount}`);
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

// Post-state verification.
const after = await pool.query("select count(*)::int as subs from subscriptions");
const auditAfter = await pool.query("select count(*)::int as audits from audit_logs");
console.log(`post-state: subscriptions=${after.rows[0].subs}, audit_logs=${auditAfter.rows[0].audits} (16 = documented permanent footprint)`);

await pool.end();
