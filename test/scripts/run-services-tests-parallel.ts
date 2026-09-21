// Parallel Test Runner for Backend Services (prevents Bun module registry/mock pollution across service test files).
import { runParallelTests } from "@/test/scripts/run-parallel-tests";

// Each worker creates a pg pool (max: 3 in test env via factory.ts).
// Cap workers so total connections stay well within PostgreSQL's max_connections.
// With max 3 per pool: 8 workers x 3 = 24 connections (leaves headroom for other clients).
// Embedded providers (sqlite, PGlite) serialize instead — PGlite is a single
// in-process instance whose serialized query queue widens each file's
// read→write window; parallel workers then trip cross-file fixture races
// (see the PR #56 broadcast race note below for the same class of problem).
const isEmbeddedDb = ["sqlite", "pglite"].includes(process.env.DB_PROVIDER?.toLowerCase() ?? "");

await runParallelTests({
  pattern: "**/*.test.ts",
  cwd: "backend/services",
  maxWorkers: isEmbeddedDb ? 1 : 8,
  label: "backend service",
  timeoutMs: 60_000,
  // The ALL-cohort broadcast fans one notifications row out per governed user
  // read from the SHARED test database. Parallel chaos/own-commit files keep
  // committed fixture users alive for their whole file and hard-delete them in
  // afterAll cleanup — when such a delete commits between the cohort read and
  // the batch insert, the FK check fails with 23503 (proved deterministically;
  // see PR #56 CI). Running this file alone after the pool drains closes the
  // race without touching the production read→write contract.
  // The admin-governance suite's `listAll` counts the WHOLE session table;
  // a concurrently-running own-commit fixture file (session-lifecycle chaos)
  // keeps committed session rows alive through its beforeAll/afterAll window,
  // so the total drifts by that many rows. Serializing it to the tail lane
  // (run alone, after the pool drains) restores a deterministic empty-table
  // baseline for the global count without changing the production read path.
  // The admin cold-start certification chaos suite provisions committed fixtures
  // and in afterAll calls deleteUsersByIds, which executes DDL
  // (`ALTER TABLE audit_logs DISABLE/ENABLE TRIGGER`). Running DDL against
  // audit_logs concurrently with other test workers creates table-level lock
  // and trigger state races against the immutable audit table. Serializing it
  // to the tail lane runs it alone after the worker pool drains.
  // The dispute suites (arbitration + dispute-notification) fan the
  // `session_dispute_opened` wave out to EVERY committed admin user while
  // their own fixtures stay uncommitted. Any parallel own-commit file whose
  // afterAll hard-deletes its committed users can land that delete between
  // the admin-cohort read and the batch insert — the FK key-share check
  // reads live data, not the snapshot, so it fails with 23503 (observed:
  // `notifications_user_id_users_id_fkey`, user created/deleted by a peer
  // file). Serializing both fanout victims to the tail lane closes the race.
  sequentialTailPatterns: [
    "notifications/admin-broadcast.service.test.ts",
    "classes/session-admin-governance.service.test.ts",
    "admin/cold-start-certification.chaos.test.ts",
    "classes/session-arbitration.service.test.ts",
    "classes/session-dispute-notification.service.test.ts",
  ],
});
