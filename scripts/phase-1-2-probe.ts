/**
 * Phase 1.2 probe — verify the live `students_balance_trial_check` CHECK constraint
 * rejects negative `balance_trial` writes and accepts the happy-path insert of 0.
 *
 * Strategy:
 *   - Acquire a single `pg.PoolClient`.
 *   - Run everything inside `BEGIN ... ROLLBACK` so no persistent state is left
 *     in the dev database (the users + students probe rows are discarded on
 *     rollback). Equivalent in intent to `runInRollback` but without pulling
 *     the test harness into a one-off probe.
 *   - Insert a real `users` row with `role = 'student'` (FK requirement for
 *     `students.id`), then a `students` row with `balance_trial = 0`
 *     (happy path — must succeed).
 *   - Issue an `UPDATE students SET balance_trial = -1 ...` against the probe
 *     row (adversarial path — must fail with SQLSTATE 23514, the standard
 *     PostgreSQL code for `new_violates_check_constraint`).
 *
 * Exit codes:
 *   0 — happy path succeeded AND adversarial path was rejected with 23514
 *   1 — any other outcome
 *
 * Run via: `bun --env-file=.env run scripts/phase-1-2-probe.ts`
 */
import { getPool } from "@/backend/db";

const PROBE_EMAIL = "phase-1-2-probe@example.com";
const PROBE_HANDSHAKE = "PHASE_1_2_PROBE";
const ADVERSARIAL_BALANCE = -1;

function banner(label: string): void {
  console.log(`\n=== ${label} ===`);
}

async function main(): Promise<number> {
  const pool = getPool();
  const client = await pool.connect();

  try {
    banner("BEGIN transaction (will ROLLBACK at end — no persistent state)");
    await client.query("BEGIN");

    banner("Step 1 — insert probe users row (role='student')");
    const userInsert = await client.query<{
      id: number;
    }>(
      `INSERT INTO users (full_name, email, password_hash, role)
       VALUES ('Phase 1.2 Probe', $1, $2, 'student')
       RETURNING id`,
      [PROBE_EMAIL, "$2a$10$probepasswordhashplaceholderforphase12only"],
    );
    const userId = userInsert.rows[0]?.id;
    if (typeof userId !== "number") {
      throw new Error("probe users insert returned no id");
    }
    console.log(`  → users row inserted, id = ${userId}`);

    banner("Step 2 — insert students row with balance_trial = 0 (happy path)");
    const studentInsert = await client.query<{
      balance_trial: number;
    }>(
      `INSERT INTO students (id, handshake_code, balance_trial)
       VALUES ($1, $2, 0)
       RETURNING balance_trial`,
      [userId, PROBE_HANDSHAKE],
    );
    const insertedBalance = studentInsert.rows[0]?.balance_trial;
    console.log(`  → students row inserted, balance_trial = ${insertedBalance}`);
    if (insertedBalance !== 0) {
      throw new Error(
        `happy-path insert did not return balance_trial=0 (got ${insertedBalance})`,
      );
    }

    banner(
      "Step 3 — UPDATE students SET balance_trial = -1 (adversarial — expect CHECK rejection)",
    );
    let adversarialRejected = false;
    let adversarialSqlState: string | null = null;
    let adversarialMessage: string | null = null;
    try {
      await client.query(
        `UPDATE students SET balance_trial = $1 WHERE id = $2`,
        [ADVERSARIAL_BALANCE, userId],
      );
      // If we reach here the CHECK constraint did NOT fire — failure.
      adversarialRejected = false;
      console.log(
        "  ✗ FAIL — UPDATE with balance_trial = -1 was NOT rejected by the CHECK constraint",
      );
    } catch (err) {
      const e = err as { code?: string; message?: string };
      adversarialSqlState = e.code ?? null;
      adversarialMessage = e.message ?? null;
      adversarialRejected = adversarialSqlState === "23514";
      console.log(
        `  → UPDATE rejected — SQLSTATE = ${adversarialSqlState}, message = ${adversarialMessage}`,
      );
    }

    banner("ROLLBACK transaction (discard probe rows)");
    await client.query("ROLLBACK");

    banner("Verdict");
    const happyPathOk = insertedBalance === 0;
    const adversarialOk = adversarialRejected;
    console.log(`  Happy-path insert (balance_trial = 0): ${happyPathOk ? "PASS" : "FAIL"}`);
    console.log(
      `  Adversarial UPDATE (balance_trial = -1) rejected by CHECK (SQLSTATE 23514): ${adversarialOk ? "PASS" : "FAIL"}`,
    );
    const ok = happyPathOk && adversarialOk;
    console.log(`\nOVERALL: ${ok ? "PASS" : "FAIL"}`);
    return ok ? 0 : 1;
  } finally {
    client.release();
    await pool.end();
  }
}

main()
  .then((exitCode) => {
    process.exit(exitCode);
  })
  .catch((err) => {
    console.error("probe crashed:", err);
    process.exit(1);
  });
