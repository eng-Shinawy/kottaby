/**
 * CRON-R8 TEST-DB audit purge — removes the 15 COMMITTED QA-fixture audit
 * rows that leaked into `kottaby_test` during the CRON-R7 round's failed
 * test:graphql server boots (created 11:21:43-46, actor names "Plan Catalog
 * {Matrix,Concurrency,} Admin", entities plans#314-323).
 *
 * The audit service suite (DEV3-020) pins absolute-zero / absolute-total
 * expectations inside runInRollback, so ANY committed row in this table
 * breaks it — this is the same environmental class CRON-R7 reported and
 * purged once already; the failed graphql boots re-leaked it.
 *
 * audit_logs is trigger-protected, so the delete runs inside a
 * `session_replication_role = replica` superuser session — triggers stay
 * installed, NO DDL. The QA users/plans the rows reference are LEFT IN
 * PLACE (CRON-R7 ruling: harmless, not absolutely asserted).
 *
 * Idempotent: the delete is a no-op when the rows are already gone.
 */
import { Pool } from "pg";

const pool = new Pool({ connectionString: "postgresql://postgres@127.0.0.1:5432/kottaby_test" });

const before = await pool.query("select count(*)::int as n from audit_logs");
console.log(`kottaby_test audit rows before: ${before.rows[0].n}`);

const client = await pool.connect();
try {
  await client.query("begin");
  await client.query("set local session_replication_role = replica");
  // Only QA-fixture actors — never the seeded admin (actor ids resolved
  // from the leaked actor names, so seed rows cannot match).
  const del = await client.query(
    `delete from audit_logs a using users u
     where a.actor_id = u.id and u.full_name in
       ('Plan Catalog Matrix Admin', 'Plan Catalog Admin', 'Plan Catalog Concurrency Admin')`
  );
  await client.query("commit");
  console.log(`deleted leaked QA audit rows: ${del.rowCount}`);
} catch (error) {
  await client.query("rollback");
  throw error;
} finally {
  client.release();
}

const after = await pool.query("select count(*)::int as n from audit_logs");
console.log(`kottaby_test audit rows after: ${after.rows[0].n}`);

await pool.end();
