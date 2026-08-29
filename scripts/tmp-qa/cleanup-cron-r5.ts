/**
 * CRON-R5 QA-data cleanup — removes integration-test fixtures that leaked
 * into the DEV database (`kottaby`) via the test:graphql gate's `.env`-bound
 * server boot, plus this round's own E2E rows.
 *
 * Order matters (FK restrict): notifications → subscriptions → applicants →
 * evaluations → audit_logs → role child tables (admin/teacher/students/
 * parents) → users; subscriptions referencing QA plans first, then the QA
 * plans themselves. Seed users (ids 1-4) and the 4 seed plans (ids 137-140)
 * are preserved.
 *
 * Idempotent: every delete is a no-op when the rows are already gone.
 */
import { Pool } from "pg";

const pool = new Pool({ connectionString: "postgresql://postgres@127.0.0.1:5432/kottaby" });

const SEED_USER_IDS = [1, 2, 3, 4];
const SEED_PLAN_IDS = [137, 138, 139, 140];

const qaUsers = await pool.query("select id from users where id <> all($1)", [SEED_USER_IDS]);
const qaPlanRows = await pool.query("select id from plans where id <> all($1)", [SEED_PLAN_IDS]);
const qaUserIds = qaUsers.rows.map(r => r.id);
const qaPlanIds = qaPlanRows.rows.map(r => r.id);
console.log(`QA users: ${qaUserIds.length}, QA plans: ${qaPlanIds.length}`);

if (qaUserIds.length > 0) {
  await pool.query("delete from notifications where user_id = any($1)", [qaUserIds]);
  await pool.query("delete from subscriptions where user_id = any($1)", [qaUserIds]);
  // applicants: shared-PK child of users (no separate user_id column).
  await pool.query("delete from applicants where id = any($1)", [qaUserIds]);
  await pool.query("delete from evaluations where evaluated_id = any($1)", [qaUserIds]);
  await pool.query("delete from evaluations where evaluator_id = any($1)", [qaUserIds]);
  // audit_logs references the actor, not a user_id.
  await pool.query("delete from audit_logs where actor_id = any($1)", [qaUserIds]);
  await pool.query("delete from admin where id = any($1)", [qaUserIds]);
  await pool.query("delete from teacher where id = any($1)", [qaUserIds]);
  await pool.query("delete from wallet where teacher_id = any($1)", [qaUserIds]);
  await pool.query("delete from students where id = any($1)", [qaUserIds]);
  await pool.query("delete from parents where id = any($1)", [qaUserIds]);
  const delUsers = await pool.query("delete from users where id = any($1)", [qaUserIds]);
  console.log(`deleted users: ${delUsers.rowCount}`);
}

if (qaPlanIds.length > 0) {
  // Any remaining subscriptions tied to QA plans (e.g. this round's E2E row
  // for the seed student) must go before their plans.
  const delSubs = await pool.query("delete from subscriptions where plan_id = any($1)", [qaPlanIds]);
  console.log(`deleted subscriptions (E2E + QA): ${delSubs.rowCount}`);
  await pool.query("delete from lessons where plan_id = any($1)", [qaPlanIds]);
  const delPlans = await pool.query("delete from plans where id = any($1)", [qaPlanIds]);
  console.log(`deleted plans: ${delPlans.rowCount}`);
}

const plansLeft = await pool.query("select id, title from plans order by id");
console.log("REMAINING PLANS:", JSON.stringify(plansLeft.rows.map(r => r.title)));
const usersLeft = await pool.query("select count(*)::int as c from users");
console.log(`REMAINING USERS: ${usersLeft.rows[0]?.c}`);
const subsLeft = await pool.query("select count(*)::int as c from subscriptions");
console.log(`REMAINING SUBSCRIPTIONS: ${subsLeft.rows[0]?.c}`);

await pool.end();
