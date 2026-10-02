/**
 * Read-only invariant oracle registry for the restore-verify tool.
 *
 * The registry below is PURE DATA: each entry is a static SQL query run
 * against the restored scratch target via `psql -Atc`. Adding a new oracle
 * is a data append ONLY — the generic evaluator in {@link runOracles} never
 * changes.
 *
 * SQL safety: every statement is a static string constant. No user input,
 * connection string, or file content is ever interpolated into oracle SQL;
 * the DSN travels exclusively through psql's argv.
 *
 * Oracle kinds (data-driven — the evaluator branches ONLY on
 * {@link OracleDefinition.expected}):
 *   - no `expected` → COUNT oracle: the query returns an INTEGER (the number
 *     of offending rows) and passes iff it is 0. A non-integer output on a
 *     count oracle fails closed (ERROR, not "0 offending rows").
 *   - `expected: { kind: "migrationJournalHash" }` → VALUE oracle: the query
 *     returns a value that must equal the expected value resolved from the
 *     run context (used by OR-MIG to compare the trailing migrations hash).
 *     A value oracle may declare a {@link OracleDefinition.fallbackSql}
 *     fallback query and a terminal {@link OracleDefinition.absentValue}:
 *     PostgreSQL plans every statically referenced relation up front, so a
 *     query touching a conditionally-existing table (e.g. a migrations table
 *     absent in push-managed databases) cannot be expressed as one static
 *     statement — psql runs `-Atc` with `ON_ERROR_STOP=1` and `DO $$…$$`/`\if`
 *     workarounds are unavailable (DO leaks a command tag into stdout, `\if`
 *     is not processed in `-c` mode). The ladder is therefore: `sql`, then
 *     `fallbackSql` if `sql` errored with SQLSTATE 42P01 (relation absence),
 *     then `absentValue` if the fallback errored with 42P01 too. ANY OTHER
 *     error class (auth, network, permission) is not an absence signal: the
 *     oracle FAILS CLOSED (errored oracle) instead of descending.
 *
 * A failing psql invocation is an ERROR (distinct from a clean pass) and
 * fails the oracle with the {@link ORACLE_ERROR_OFFENDING_COUNT} sentinel.
 */

import { MIGRATIONS_ABSENT_HASH } from "@/scripts/ops/backup-artifacts";
import type { PsqlOutcome, PsqlRunner } from "@/scripts/ops/restore-shared";

/** Identifies where a value-oracle's expected value comes from in the run context. */
export interface OracleExpectedValue {
  kind: "migrationJournalHash";
}

/** One invariant oracle definition. The array below is the registry. */
export interface OracleDefinition {
  id: string;
  description: string;
  /** Anchor of the invariant this oracle verifies (invariant-doc reference). */
  invariantAnchor: string;
  /** Static, read-only SQL evaluated with `psql -Atc`. */
  sql: string;
  /**
   * Present → VALUE oracle; absent → COUNT oracle. Resolved generically in
   * the evaluator, so a future value oracle is a data append.
   */
  expected?: OracleExpectedValue;
  /**
   * VALUE oracles only: static fallback query evaluated when {@link sql}
   * errors with SQLSTATE 42P01 (relation absence — the ONLY error class that
   * descends the ladder; auth/network/permission errors fail closed). Primary
   * and fallback must cover disjoint table layouts — e.g. `drizzle.` vs
   * `public.` migration tables.
   */
  fallbackSql?: string;
  /**
   * VALUE oracles only: the value assumed when both {@link sql} and
   * {@link fallbackSql} error with SQLSTATE 42P01 — the
   * conditionally-referenced tables exist in no supported layout (e.g. no
   * migration tracking at all).
   */
  absentValue?: string;
}

/** Result of one executed oracle (persisted in restore-report.json). */
export interface OracleResult {
  id: string;
  description: string;
  passed: boolean;
  /** Offending-row count; -1 when the oracle itself errored. */
  offendingCount: number;
}

/** Sentinel offendingCount marking an errored oracle (distinct from a clean 0). */
export const ORACLE_ERROR_OFFENDING_COUNT = -1;

/** Values the value-oracle comparison needs for the whole run. */
export interface OracleRunContext {
  /**
   * Expected trailing migration hash recorded by the backup: the SHA-256 of
   * the terminal journal migration's `migration.sql` (drizzle-orm
   * derivation), or {@link MIGRATIONS_ABSENT_HASH} for a journal with no
   * migrations.
   */
  journalHash: string;
}

/**
 * THE REGISTRY. Pure data — append a new entry to add an oracle.
 *
 * Table/column names reflect the live schema (backend/db/schema/): `wallet`,
 * `teacher_transaction`, `session`, `audit_logs`, `session_request_idempotency`,
 * `users`, `__drizzle_migrations` (drizzle migrations table, either schema —
 * column names pinned to the migrator source: `id`, `hash`).
 *
 * OR-MIG hash-domain note: `__drizzle_migrations.hash` stores the SHA-256 of
 * the LAST applied migration's raw `migration.sql` content (drizzle-orm
 * `readMigrationFiles`), so the expected value is the manifest's
 * `journalHash` — derived by the backup from the terminal journal folder,
 * never a whole-directory aggregate. The drizzle-orm pg migrator pins the
 * `drizzle` schema (backend/db/scripts/runDrizzleMigrations.ts), so `sql`
 * reads that table; `fallbackSql` hedges a `public`-schema layout, and
 * `absentValue` covers a restored database that tracks no migrations at all
 * (no table, or table without rows — COALESCE in each query): the comparison
 * is STRICT — absence matches ONLY a manifest that itself recorded
 * `MIGRATIONS_ABSENT_HASH` (journal-less source); against a real expected
 * hash, absent tracking means the restore lost its migration rows and the
 * oracle FAILS (zero-tolerance: an unverifiable identity is a divergence).
 */
export const ORACLES: OracleDefinition[] = [
  {
    id: "OR-W1",
    description: "no wallet row with a negative balance",
    invariantAnchor: "INV-W1",
    sql: "SELECT COUNT(*) FROM wallet WHERE balance < 0",
  },
  {
    id: "OR-W2",
    description: "every teacher_transaction row joins an existing wallet",
    invariantAnchor: "INV-W3",
    sql: "SELECT COUNT(*) FROM teacher_transaction t LEFT JOIN wallet w ON w.id = t.wallet_id WHERE w.id IS NULL",
  },
  {
    id: "OR-B1",
    description:
      "session holds are non-negative and carry valid balance-lane provenance (no negative hold, no held row without a lane, no lane outside the vocabulary)",
    invariantAnchor: "INV-B1/B8",
    sql: [
      "SELECT COUNT(*) FROM session WHERE",
      "(fee_held = TRUE AND fee < 0)",
      "OR (fee_held = TRUE AND held_balance_lane IS NULL)",
      "OR (held_balance_lane IS NOT NULL AND held_balance_lane NOT IN ('trial', 'hifz', 'tajweed'))",
    ].join(" "),
  },
  {
    id: "OR-U1",
    description: "no audit_logs row with a null or dangling actor reference",
    invariantAnchor: "A.5/INV-U1",
    sql: "SELECT COUNT(*) FROM audit_logs a LEFT JOIN users u ON u.id = a.actor_id WHERE a.actor_id IS NULL OR u.id IS NULL",
  },
  {
    id: "OR-U2",
    description: "soft-deleted users retain their audit history rows",
    invariantAnchor: "INV-U4/U5",
    sql: [
      "SELECT COUNT(*) FROM users u WHERE u.is_deleted = TRUE",
      "AND NOT EXISTS (SELECT 1 FROM audit_logs a WHERE a.entity_type = 'user' AND a.entity_id = u.id)",
    ].join(" "),
  },
  {
    id: "OR-REQ",
    description: "every session_request_idempotency row references an existing user",
    invariantAnchor: "workflow 02",
    sql: "SELECT COUNT(*) FROM session_request_idempotency r LEFT JOIN users u ON u.id = r.user_id WHERE u.id IS NULL",
  },
  {
    id: "OR-MIG",
    description:
      "restored __drizzle_migrations trailing hash matches the backup's trailing journal migration hash " +
      "(no migration tracking in the restored database is also faithful: a push-managed source never writes migration rows)",
    invariantAnchor: "migration-journal",
    expected: { kind: "migrationJournalHash" },
    // NOTE: PostgreSQL resolves every statically referenced relation at plan
    // time, so each query below may touch ONLY a table guaranteed to exist
    // when it is reached; absence falls down the fallback ladder instead.
    sql: [
      "SELECT COALESCE(",
      "(SELECT hash FROM drizzle.__drizzle_migrations ORDER BY id DESC LIMIT 1),",
      `'${MIGRATIONS_ABSENT_HASH}')`,
    ].join(" "),
    fallbackSql: [
      "SELECT COALESCE(",
      "(SELECT hash FROM public.__drizzle_migrations ORDER BY id DESC LIMIT 1),",
      `'${MIGRATIONS_ABSENT_HASH}')`,
    ].join(" "),
    absentValue: MIGRATIONS_ABSENT_HASH,
  },
];

/**
 * SQLSTATE 42P01 (undefined_object) — the ONLY psql error class the absence
 * ladder may descend on. psql runs with `VERBOSITY=verbose` (restore-shared
 * PSQL_ARGS) so the SQLSTATE is present in stderr; any other stderr (auth,
 * network, permission) must fail the oracle closed instead of falling through
 * to a fallback that could pass spuriously.
 */
const SQLSTATE_RELATION_ABSENT = "42P01";

function isRelationAbsenceError(stderr: string): boolean {
  return stderr.includes(SQLSTATE_RELATION_ABSENT);
}

/**
 * Runs one oracle query, converting a throwing runner into a failed outcome.
 * The failed outcome carries UNKNOWN stderr, which can never qualify as
 * relation absence — a throwing runner therefore always fails closed.
 */
async function tryPsql(psql: PsqlRunner, sql: string): Promise<PsqlOutcome> {
  try {
    return await psql(sql);
  } catch {
    return { ok: false, value: "", stderr: "" };
  }
}

const INTEGER_OUTPUT_PATTERN = /^-?\d+$/;

function parseIntegerOutput(value: string): number | null {
  if (!INTEGER_OUTPUT_PATTERN.test(value)) {
    return null;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function toResult(oracle: OracleDefinition, passed: boolean, offendingCount: number): OracleResult {
  return { id: oracle.id, description: oracle.description, passed, offendingCount };
}

/**
 * Resolves a value-oracle's expected value from the run context. Returns
 * null for an unknown kind (a registry/evaluator version skew), which the
 * evaluator turns into an errored oracle rather than a false pass.
 */
function resolveExpectedValue(expected: OracleExpectedValue, context: OracleRunContext): string | null {
  if (expected.kind === "migrationJournalHash") {
    return context.journalHash;
  }
  return null;
}

/**
 * Executes the registry against the restored target. Registry-driven: the
 * mapping below is identical for every oracle — adding an entry (count or
 * value oracle) never touches this control flow. Results preserve registry
 * order.
 */
export async function runOracles(
  psql: PsqlRunner,
  context: OracleRunContext,
  registry: OracleDefinition[] = ORACLES
): Promise<OracleResult[]> {
  return Promise.all(registry.map(async oracle => evaluateOracle(psql, oracle, context)));
}

async function evaluateOracle(
  psql: PsqlRunner,
  oracle: OracleDefinition,
  context: OracleRunContext
): Promise<OracleResult> {
  const outcome = await tryPsql(psql, oracle.sql);

  // Fail closed on a psql error. The absence fallback ladder (fallbackSql /
  // absentValue) descends ONLY on relation-absence errors (SQLSTATE 42P01 in
  // stderr) — the one condition the ladder exists for. Any other error class
  // (auth, network, permission) fails the oracle closed instead of reaching a
  // fallback that could turn an unverifiable check into a false pass.
  const declaresAbsenceLadder = oracle.fallbackSql !== undefined || oracle.absentValue !== undefined;
  if (!outcome.ok && !(declaresAbsenceLadder && isRelationAbsenceError(outcome.stderr))) {
    return toResult(oracle, false, ORACLE_ERROR_OFFENDING_COUNT);
  }

  if (oracle.expected === undefined) {
    const offendingCount = parseIntegerOutput(outcome.value);
    if (offendingCount === null) {
      // A count oracle MUST return an integer; anything else is an
      // evaluation error, never a clean pass.
      return toResult(oracle, false, ORACLE_ERROR_OFFENDING_COUNT);
    }
    return toResult(oracle, offendingCount === 0, offendingCount);
  }

  const expected = resolveExpectedValue(oracle.expected, context);
  if (expected === null) {
    return toResult(oracle, false, ORACLE_ERROR_OFFENDING_COUNT);
  }

  // Value-oracle fallback ladder (see OracleDefinition.fallbackSql):
  // `sql` → `fallbackSql` → `absentValue`. Only reached when the primary
  // query errored with SQLSTATE 42P01 (gated above); a successful query's
  // value is compared as-is. Each further rung likewise requires 42P01 to
  // descend — a non-42P01 fallback error fails closed.
  let value = outcome.value;
  if (!outcome.ok) {
    if (oracle.fallbackSql !== undefined) {
      const fallbackOutcome = await tryPsql(psql, oracle.fallbackSql);
      if (fallbackOutcome.ok) {
        value = fallbackOutcome.value;
      } else if (isRelationAbsenceError(fallbackOutcome.stderr) && oracle.absentValue !== undefined) {
        value = oracle.absentValue;
      } else {
        return toResult(oracle, false, ORACLE_ERROR_OFFENDING_COUNT);
      }
    } else if (oracle.absentValue !== undefined) {
      value = oracle.absentValue;
    } else {
      return toResult(oracle, false, ORACLE_ERROR_OFFENDING_COUNT);
    }
  }

  if (value === expected) {
    return toResult(oracle, true, 0);
  }
  // NO sentinel tolerance: an absent tracking table against a REAL expected
  // hash is exactly the divergence OR-MIG exists to catch (a restore that
  // lost its migration rows must fail, never pass). Absence matches only
  // when the backup itself recorded absence (journal-less source) — that
  // case already passed the strict `value === expected` comparison above,
  // because the manifest carries MIGRATIONS_ABSENT_HASH for it.
  return toResult(oracle, false, 1);
}
