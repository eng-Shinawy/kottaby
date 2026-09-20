import { sql } from "drizzle-orm";

import { db } from "@/backend/db";

/**
 * Targeted post-suite cleanup for live-wire GraphQL integration tests.
 *
 * Deletes `users` rows by EXPLICIT id list (never by email pattern — a
 * pattern sweep would also delete rows created by OTHER integration
 * suites running in parallel against the same database) together with
 * every row that would otherwise block or orphan the delete:
 *
 *  - `audit_logs` rows written BY the fixtures (`actor_id` FK RESTRICT)
 *    and rows ABOUT the fixtures (`entity_type = 'user'` +
 *    `entity_id` — no FK, but leaving them clutters the audit trail).
 *  - `subscriptions.user_id` + `evaluations.evaluator_id` — the two
 *    remaining RESTRICT FKs; defensive (this suite creates neither).
 *
 * Everything else (admin, teacher, wallet, teacher_verification,
 * parents, students, student_subscriptions, progress, applicants,
 * notifications, evaluations.evaluator_id targets) cascades from the
 * `users` delete via PostgreSQL FK actions.
 *
 * Suites that never hard-delete their own fixtures can assert
 * `deleted === ids.length` afterwards; `countUsersByIds` is provided
 * for the stronger "zero remain" self-check.
 *
 * TRIGGER AWARENESS (resolves QA 6-QA-4 P2-1): `bun db push`-provisioned
 * databases (the dev sandbox + `.env.test`) carry NO trigger on
 * `audit_logs`, so the DELETE below succeeds there directly.
 * Migrate-provisioned environments install the append-only immutability
 * trigger from `backend/db/migration/3-immutability-triggers.sql`
 * (`BEFORE DELETE` → RAISE EXCEPTION), which would make this helper
 * throw. The audit-row pre-clean therefore runs under
 * `withAuditDeleteTriggersSuspended`: every USER (non-internal) trigger
 * on `audit_logs` is discovered via `pg_trigger`, DISABLEd for the
 * duration of the DELETE, and restored to its EXACT prior firing state
 * (`tgenabled` O/D/R/A) in a `finally` block — a trigger that was
 * already disabled before cleanup stays disabled afterwards. Test-env
 * scoping: this path ONLY relaxes the immutability guard inside the
 * test-harness cleanup transaction window; production runtime code
 * never imports this helper.
 */

/**
 * One `pg_trigger` row's firing state for `audit_logs`, captured before
 * the cleanup suspends it. `tgenabled` semantics (PostgreSQL docs):
 *  - `'O'` — trigger fires for non-replica origins ("origin", the default)
 *  - `'D'` — trigger is disabled
 *  - `'R'` — trigger fires only on replica nodes ("replica")
 *  - `'A'` — trigger fires always ("always")
 */
interface AuditTriggerState {
  readonly name: string;
  readonly enabled: string;
}

/** Maps a captured `tgenabled` state back to its restoring DDL clause. */
function restoreClause(state: AuditTriggerState): ReturnType<typeof sql> {
  switch (state.enabled) {
    case "D":
      return sql`ALTER TABLE audit_logs DISABLE TRIGGER ${sql.identifier(state.name)}`;
    case "R":
      return sql`ALTER TABLE audit_logs ENABLE REPLICA TRIGGER ${sql.identifier(state.name)}`;
    case "A":
      return sql`ALTER TABLE audit_logs ENABLE ALWAYS TRIGGER ${sql.identifier(state.name)}`;
    default:
      return sql`ALTER TABLE audit_logs ENABLE TRIGGER ${sql.identifier(state.name)}`;
  }
}

/**
 * Runs `fn` with every USER (non-internal) trigger on `audit_logs`
 * disabled, restoring each trigger's exact prior firing state afterwards
 * (even on failure — the restore lives in `finally`). When the table
 * carries no user triggers (push-provisioned dev/test databases), `fn`
 * runs directly with zero DDL round-trips.
 *
 * Exported for cross-suite reuse: `test/workflows/helpers/journey-cleanup.ts`
 * wraps its two audit-log deletes in the same suspension wrapper instead of
 * re-implementing the trigger dance (single source of truth).
 */
export async function withAuditDeleteTriggersSuspended<T>(fn: () => Promise<T>): Promise<T> {
  const discovered = await db.execute<{ tgname: string; tgenabled: string }>(
    sql`SELECT tgname, tgenabled FROM pg_trigger WHERE tgrelid = 'audit_logs'::regclass AND NOT tgisinternal`
  );
  const triggers: AuditTriggerState[] = discovered.rows.map(row => ({
    name: row.tgname,
    enabled: row.tgenabled,
  }));
  if (triggers.length === 0) {
    return fn();
  }
  // Disable all discovered triggers in parallel — `pg_trigger` rows are
  // independent (no DDL ordering requirement between them), so `Promise.all`
  // satisfies `eslint(no-await-in-loop)` without changing semantics.
  await Promise.all(
    triggers.map(trigger => db.execute(sql`ALTER TABLE audit_logs DISABLE TRIGGER ${sql.identifier(trigger.name)}`))
  );
  try {
    return await fn();
  } finally {
    // Restore each trigger's exact prior firing state — independent DDL
    // statements, safe to run in parallel via `Promise.all` (satisfies
    // `eslint(no-await-in-loop)`; restore order does not matter since
    // each trigger's `tgenabled` is set to its own captured value).
    await Promise.all(triggers.map(trigger => db.execute(restoreClause(trigger))));
  }
}

/** Interpolates an explicit, parameterized id list (`1, 4, 9`). */
function idList(ids: readonly number[]): ReturnType<typeof sql> {
  return sql.join(
    ids.map(id => sql`${id}`),
    sql`, `
  );
}

/**
 * Deletes the given users plus their RESTRICT-gated references.
 * Returns the number of `users` rows actually deleted.
 */
export async function deleteUsersByIds(ids: readonly number[]): Promise<number> {
  if (ids.length === 0) return 0;
  const list = idList(ids);
  await withAuditDeleteTriggersSuspended(() =>
    db.execute(
      sql`DELETE FROM audit_logs WHERE actor_id IN (${list}) OR (entity_type = 'user' AND entity_id IN (${list}))`
    )
  );
  await db.execute(sql`DELETE FROM subscriptions WHERE user_id IN (${list})`);
  await db.execute(sql`DELETE FROM evaluations WHERE evaluator_id IN (${list})`);
  const result = await db.execute<{ count: number }>(
    sql`WITH deleted AS (DELETE FROM users WHERE id IN (${list}) RETURNING 1) SELECT count(*)::int AS count FROM deleted`
  );
  // `count` is typed as `number` via the `<{ count: number }>` generic on
  // `db.execute`; the previous `Number(...)` wrapper was redundant (flagged
  // by `no-unnecessary-type-conversion`).
  return result.rows[0]?.count ?? 0;
}

/** Counts how many of the given user ids still exist (post-cleanup check). */
export async function countUsersByIds(ids: readonly number[]): Promise<number> {
  if (ids.length === 0) return 0;
  const result = await db.execute<{ count: number }>(
    sql`SELECT count(*)::int AS count FROM users WHERE id IN (${idList(ids)})`
  );
  // Same as above — `count` is already typed as `number`.
  return result.rows[0]?.count ?? 0;
}

/**
 * Generalized immutability-trigger suspension for APPEND-ONLY tables.
 *
 * `student_payments` and `teacher_transaction` carry the same append-only
 * immutability trigger family as `audit_logs` (BEFORE UPDATE/DELETE →
 * RAISE EXCEPTION, installed by the `3-immutability-triggers` migration),
 * and both restrict-delete their way into `students`/`wallet` — so a
 * journey teardown that tracked ledger rows (its own fixture payments and
 * payouts) cannot delete them through any FK-safe ordering without first
 * suspending the guards. This helper is the same sanctioned
 * disable→run→restore dance as {@link withAuditDeleteTriggersSuspended},
 * generalized by table:
 *
 *  - For EACH named table, every USER (non-internal) trigger is discovered
 *    via `pg_trigger` (resolved with `to_regclass`, so an unknown table
 *    simply discovers nothing) and its EXACT prior firing state
 *    (`tgenabled` O/D/R/A) is captured.
 *  - Every discovered trigger is DISABLEd (across all listed tables)
 *    before `fn` runs, and restored to its exact prior state in a
 *    `finally` block — a trigger that was already disabled before the
 *    suspension stays disabled afterwards. Discovery, disable, and
 *    restore are independent statements, so each phase runs via
 *    `Promise.all` (no await-in-loop).
 *  - When NO listed table carries user triggers (push-provisioned dev/test
 *    databases), `fn` runs directly with zero DDL round-trips.
 *  - Executes on the global `db` (no tx parameter) — journey teardown runs
 *    outside any rollback wrapper per `test/workflows/AGENTS.md` rule 1,
 *    exactly like the audit helper. This deliberately touches ONLY the
 *    named tables' non-internal triggers (never `session_replication_role`,
 *    which would also suspend referential-integrity triggers).
 *
 * Test-env scoping: this path ONLY relaxes the append-only guards inside
 * the test-harness teardown window; production runtime code never imports
 * this helper.
 */

/** One `pg_trigger` row's firing state for one suspended table. */
interface ImmutableTableTriggerState {
  readonly table: string;
  readonly name: string;
  readonly enabled: string;
}

/**
 * Maps a captured `tgenabled` state to its restoring DDL builder for one
 * table (data-driven so each firing mode stays explicit; any other state
 * falls through to the plain enable, mirroring the audit helper's default).
 */
const IMMUTABLE_TRIGGER_RESTORE_DDL: Record<string, (table: string, name: string) => ReturnType<typeof sql>> = {
  D: (table, name) => sql`ALTER TABLE ${sql.identifier(table)} DISABLE TRIGGER ${sql.identifier(name)}`,
  R: (table, name) => sql`ALTER TABLE ${sql.identifier(table)} ENABLE REPLICA TRIGGER ${sql.identifier(name)}`,
  A: (table, name) => sql`ALTER TABLE ${sql.identifier(table)} ENABLE ALWAYS TRIGGER ${sql.identifier(name)}`,
};

/** Builds the restore statement that returns one trigger to its captured state. */
function immutableTriggerRestoreClause(state: ImmutableTableTriggerState): ReturnType<typeof sql> {
  const build = IMMUTABLE_TRIGGER_RESTORE_DDL[state.enabled];
  if (build) {
    return build(state.table, state.name);
  }
  return sql`ALTER TABLE ${sql.identifier(state.table)} ENABLE TRIGGER ${sql.identifier(state.name)}`;
}

/**
 * Runs `fn` with every USER (non-internal) trigger on each of `tables`
 * disabled, restoring each trigger's exact prior firing state afterwards
 * (even when `fn` rejects). When none of the listed tables carries user
 * triggers (push-provisioned dev/test databases), `fn` runs directly with
 * zero DDL round-trips.
 *
 * Error semantics: a rejected `fn` always wins — the callback error is
 * captured before restoration and rethrown verbatim. Restoration DDL runs
 * via `allSettled` so it can never mask the callback error; if any restore
 * fails, an `AggregateError` is thrown listing every restore reason (plus
 * the callback error when one exists), so teardown failures are surfaced,
 * never logged-and-swallowed.
 */
export async function withImmutabilityTriggersSuspended<T>(
  tables: readonly string[],
  fn: () => Promise<T>
): Promise<T> {
  const discoveredPerTable = await Promise.all(
    tables.map(async table => ({
      table,
      rows: (
        await db.execute<{ tgname: string; tgenabled: string }>(
          sql`SELECT tgname, tgenabled FROM pg_trigger WHERE tgrelid = to_regclass(${table}) AND NOT tgisinternal`
        )
      ).rows,
    }))
  );
  const triggers: ImmutableTableTriggerState[] = discoveredPerTable.flatMap(discovered =>
    discovered.rows.map(row => ({ table: discovered.table, name: row.tgname, enabled: row.tgenabled }))
  );
  if (triggers.length === 0) {
    return fn();
  }
  // Disable all discovered triggers in parallel — independent DDL
  // statements with no ordering requirement between them.
  await Promise.all(
    triggers.map(trigger =>
      db.execute(sql`ALTER TABLE ${sql.identifier(trigger.table)} DISABLE TRIGGER ${sql.identifier(trigger.name)}`)
    )
  );
  let outcome: { ok: true; value: T } | { ok: false; error: unknown };
  try {
    outcome = { ok: true, value: await fn() };
  } catch (error) {
    outcome = { ok: false, error };
  }
  // Restore each trigger's exact prior firing state — independent DDL
  // statements, safe in parallel (restore order does not matter since
  // each trigger is set to its own captured `tgenabled`). `allSettled`
  // keeps every restore failure observable without discarding the
  // callback's own error.
  const restorations = await Promise.allSettled(
    triggers.map(trigger => db.execute(immutableTriggerRestoreClause(trigger)))
  );
  const restoreReasons = restorations
    .filter((restoration): restoration is PromiseRejectedResult => restoration.status === "rejected")
    .map(restoration => restoration.reason);
  if (restoreReasons.length > 0) {
    throw new AggregateError(
      outcome.ok ? restoreReasons : [outcome.error, ...restoreReasons],
      `Failed to restore ${restoreReasons.length} immutability trigger(s) on: ${[...new Set(triggers.map(trigger => trigger.table))].join(", ")}`
    );
  }
  if (!outcome.ok) {
    throw outcome.error;
  }
  return outcome.value;
}

/**
 * Deletes `session` rows whose teacher OR student participant is in the id
 * list. Both of `session`'s user-facing FKs (`teacher_id`, `student_id`)
 * RESTRICT-delete their user, so `deleteUsersByIds` fails while any such
 * session survives; suites that create sessions over the live wire must
 * call this first. Every other reference to `session.id` is SET NULL or
 * CASCADE (idempotency claims, evaluations, ledger transactions, child
 * artifacts), so no further delete ordering is needed. Returns the number
 * of session rows deleted.
 */
export async function deleteSessionsByParticipantUserIds(ids: readonly number[]): Promise<number> {
  if (ids.length === 0) return 0;
  const list = idList(ids);
  const result = await db.execute<{ count: number }>(
    sql`WITH deleted AS (DELETE FROM session WHERE teacher_id IN (${list}) OR student_id IN (${list}) RETURNING 1) SELECT count(*)::int AS count FROM deleted`
  );
  return result.rows[0]?.count ?? 0;
}
