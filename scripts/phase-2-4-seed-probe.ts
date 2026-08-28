/**
 * Phase 2.4 seed-parity probe — exercises the demo-student trial-grant
 * reconcile step under three states to verify the find-then-grant-if-null
 * safety net behaves correctly:
 *
 *  1. FRESH DB: `bun run db seed` creates the demo student via registration
 *     (which applies the grant inside the registration transaction); the
 *     reconcile step then observes the marker set and skips.
 *  2. PARTIAL STATE: the trial marker is cleared manually (simulating a
 *     legacy row that pre-dates the grant hook); the next seed run must
 *     invoke the production grant entry point and restore `balance_trial = 1`
 *     with the marker set.
 *  3. IDEMPOTENT RE-RUN: a follow-up seed run must observe the marker set
 *     and skip without surfacing a re-grant conflict; the balance stays at
 *     exactly 1 (not 2).
 *
 * Run with: `bun --env-file=.env run scripts/phase-2-4-seed-probe.ts`
 */

import { queryDb } from "@/backend/db";
import { runAllSeeds } from "@/backend/db/seeds";
import { loadSeedConfig } from "@/backend/db/seeds/lib";

const DEMO_STUDENT_EMAIL = "student@draftacademy.local";

interface StudentState {
  id: number;
  balance_trial: number;
  trial_granted_at: Date | null;
}

async function readStudentState(): Promise<StudentState | null> {
  const result = await queryDb<StudentState>(
    `SELECT s.id, s.balance_trial, s.trial_granted_at
     FROM students s
     JOIN users u ON s.id = u.id
     WHERE u.email = $1`,
    [DEMO_STUDENT_EMAIL]
  );
  return result.rows[0] ?? null;
}

async function clearTrialMarker(): Promise<void> {
  await queryDb(
    `UPDATE students
     SET balance_trial = 0, trial_granted_at = NULL
     WHERE id = (SELECT id FROM users WHERE email = $1)`,
    [DEMO_STUDENT_EMAIL]
  );
}

async function truncateUsers(): Promise<void> {
  await queryDb("TRUNCATE users CASCADE");
}

function formatState(label: string, state: StudentState | null): string {
  if (!state) {
    return `${label}: <no student row>`;
  }
  return `${label}: id=${state.id} balance_trial=${state.balance_trial} trial_granted_at=${
    state.trial_granted_at ? state.trial_granted_at.toISOString() : "NULL"
  }`;
}

async function runSeed(label: string): Promise<void> {
  console.log(`\n--- ${label} ---`);
  await runAllSeeds(loadSeedConfig());
}

async function main(): Promise<void> {
  console.log("=== Phase 2.4 seed-parity probe ===");

  // Scenario 1: fresh DB — registration creates the demo student + applies
  // the grant; the reconcile step should observe the marker set and skip.
  await truncateUsers();
  await runSeed("Run 1: fresh DB (registration applies grant)");
  const stateAfterRun1 = await readStudentState();
  console.log(formatState("State after run 1", stateAfterRun1));
  if (stateAfterRun1?.balance_trial !== 1 || !stateAfterRun1.trial_granted_at) {
    throw new Error("Scenario 1 failed: expected balance_trial=1 and marker set after fresh seed");
  }

  // Scenario 2: partial state — clear the marker to simulate a legacy row;
  // the reconcile step must invoke the production grant entry point.
  await clearTrialMarker();
  const stateAfterClear = await readStudentState();
  console.log(formatState("State after manual marker clear", stateAfterClear));
  if (stateAfterClear?.balance_trial !== 0 || stateAfterClear.trial_granted_at) {
    throw new Error("Setup failed: marker clear did not produce balance_trial=0 / NULL marker");
  }
  await runSeed("Run 2: partial state (safety net must apply grant)");
  const stateAfterRun2 = await readStudentState();
  console.log(formatState("State after run 2", stateAfterRun2));
  if (stateAfterRun2?.balance_trial !== 1 || !stateAfterRun2.trial_granted_at) {
    throw new Error("Scenario 2 failed: expected balance_trial=1 and marker set after safety-net seed");
  }

  // Scenario 3: idempotent re-run — the marker is set; the reconcile step
  // must skip and the balance must remain exactly 1 (not 2).
  const markerAfterRun2 = stateAfterRun2.trial_granted_at;
  await runSeed("Run 3: idempotent re-run (reconcile must skip)");
  const stateAfterRun3 = await readStudentState();
  console.log(formatState("State after run 3", stateAfterRun3));
  if (stateAfterRun3?.balance_trial !== 1) {
    throw new Error("Scenario 3 failed: expected balance_trial=1 (not 2) after idempotent re-run");
  }
  const markerAfterRun3 = stateAfterRun3.trial_granted_at;
  if (!markerAfterRun2 || !markerAfterRun3 || markerAfterRun3.getTime() !== markerAfterRun2.getTime()) {
    throw new Error("Scenario 3 failed: marker timestamp must be byte-identical across idempotent re-runs");
  }

  console.log("\n=== All probe scenarios passed ===");
}

main()
  .then(() => process.exit(0))
  .catch(err => {
    console.error("Probe failed:", err);
    process.exit(1);
  });
