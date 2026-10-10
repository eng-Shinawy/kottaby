#!/usr/bin/env bun
/**
 * Read-only live-database probe for the deployed-schema constraint
 * inventory (checklist section 5's named-constraint rows) — the launch
 * gate spawns it through the row registry's canonical command.
 *
 * Probe contract (shared across the launch probes):
 *   • Read-only — every statement is a catalog SELECT (`pg_constraint`,
 *     `pg_trigger`, `pg_proc`); the probe never writes to the database,
 *     the filesystem, or any cache.
 *   • Emits one `ProbeLine` JSON record per stdout line
 *     (`{rowId, result, detail}`) and exits 0 iff every line is PASS.
 *   • Never silently skips: an unreachable database is a named FAIL line
 *     and a non-zero exit, and every catalog mismatch (missing, wrong
 *     kind, disabled, unexpected extra) is a named FAIL line of its own.
 *
 * Inventory asserted against the deployed schema (no schema-code
 * involvement — the expected names below are the documented inventory):
 *   • the named wallet/ledger CHECK + unique constraints, one per mapped
 *     registry row (`wallet_balance_check`, `wallet_total_earning_check`,
 *     `wallet_teacher_id_unique`, `teacher_transaction_amount_check`);
 *   • the four `students_balance_*_check` CHECK constraints;
 *   • both immutability trigger families on the wallet ledger — the
 *     UPDATE guard and the DELETE guard — present AND enabled;
 *   • the settlement-amended `prevent_teacher_transaction_update`
 *     function (the pending-withdrawal settlement exception, not the
 *     strict block-everything guard);
 *   • an inventory diff: the deployed CHECK/unique constraints on the
 *     probed tables and the user triggers on the ledger table must match
 *     the expected sets exactly — missing AND unexpected-extra names are
 *     both named FAILs, so schema drift is never silent.
 *
 * Lines for checks that map to no registry row (the connection probe, the
 * students-balance checks, the trigger/function families, the inventory
 * diff) carry probe-internal rowIds prefixed `probe-constraints.`.
 *
 * Usage:
 *   bun run scripts/launch/probe-constraints.ts [--help]
 *
 * Exit codes: 0 = every emitted line PASS; 1 = any line FAIL.
 */

import { type SQLWrapper, sql } from "drizzle-orm";
import { logger } from "@/backend/lib/logger";
import type { ProbeLine } from "@/scripts/launch/shared/launch-types";
import {
  type DbProbeCliOptions,
  type ProbeDb,
  probeDbConnection,
  rowIdsForCommand,
  runDbProbeCli,
} from "@/scripts/launch/shared/probe-cli";
import { scrubDsnSecrets } from "@/scripts/ops/_shared";
import { errorMessage } from "@/scripts/ops/backup-toolchain";

/** This probe's own invocation — the registry rows cite it verbatim. */
const PROBE_COMMAND = "bun run scripts/launch/probe-constraints.ts";

/** Checklist rows this probe proves — derived from the row registry. */
export const CONSTRAINT_ROW_IDS: readonly string[] = rowIdsForCommand(PROBE_COMMAND);

/** rowId of the connection line (a named FAIL line when the database is unreachable). */
const CONNECTION_ROW_ID = "probe-constraints.connection";
/** rowId for the 4 `students_balance_*_check` CHECK constraints (INV-B1's DB floor). */
const STUDENTS_CHECKS_ROW_ID = "probe-constraints.students-balance-checks";
/** rowId for the wallet-ledger immutability trigger families (present AND enabled). */
const IMMUTABILITY_ROW_ID = "probe-constraints.immutability-triggers";
/** rowId for the settlement-amended UPDATE-guard function. */
const SETTLEMENT_ROW_ID = "probe-constraints.settlement-function";
/** rowId for the deployed-vs-expected inventory diff (missing AND extra names). */
const DRIFT_ROW_ID = "probe-constraints.inventory-drift";

/** The wallet ledger table both immutability trigger families guard. */
const LEDGER_TABLE = "teacher_transaction";

/** One expected named constraint in the deployed schema (`pg_constraint`). */
interface ExpectedConstraint {
  /** Mapped registry row this constraint proves, when it maps to one. */
  readonly rowId?: string;
  readonly name: string;
  /** Table the constraint must live on (`pg_class.relname`). */
  readonly table: string;
  /** `c` = CHECK, `u` = UNIQUE (`pg_constraint.contype`). */
  readonly contype: "c" | "u";
}

/**
 * The expected named CHECK/unique inventory on the probed tables. The
 * `rowId`-carrying entries prove the mapped registry rows; the
 * `students_handshake_code_unique` entry maps to no row of this probe but
 * is a known-good constraint on a probed table, so the inventory diff
 * fails only on genuine drift, never on it.
 */
export const EXPECTED_CONSTRAINTS: readonly ExpectedConstraint[] = [
  { rowId: "5.4.1", name: "wallet_balance_check", table: "wallet", contype: "c" },
  { rowId: "5.4.2", name: "wallet_total_earning_check", table: "wallet", contype: "c" },
  { rowId: "5.4.3", name: "wallet_teacher_id_unique", table: "wallet", contype: "u" },
  { rowId: "5.4.8", name: "teacher_transaction_amount_check", table: LEDGER_TABLE, contype: "c" },
  { name: "students_balance_hifz_check", table: "students", contype: "c" },
  { name: "students_balance_reviews_check", table: "students", contype: "c" },
  { name: "students_balance_tajweed_check", table: "students", contype: "c" },
  { name: "students_balance_trial_check", table: "students", contype: "c" },
  { name: "students_handshake_code_unique", table: "students", contype: "u" },
];

/** One expected user trigger in the deployed schema (`pg_trigger`). */
interface ExpectedTrigger {
  readonly name: string;
  /** Function the trigger must execute (`pg_proc.proname`). */
  readonly functionName: string;
}

/**
 * The two immutability trigger families on the wallet ledger: the UPDATE
 * guard and the DELETE guard. Both must be present AND enabled
 * (`pg_trigger.tgenabled <> 'D'`).
 */
const EXPECTED_TRIGGERS: readonly ExpectedTrigger[] = [
  { name: "prevent_teacher_transaction_update_trigger", functionName: "prevent_teacher_transaction_update" },
  { name: "prevent_teacher_transaction_delete_trigger", functionName: "prevent_teacher_transaction_delete" },
];

/** The settlement-amended UPDATE-guard function's name. */
const SETTLEMENT_FUNCTION_NAME = "prevent_teacher_transaction_update";
/** Literal body markers distinguishing the amended guard from the strict one. */
const SETTLEMENT_MARKERS: readonly string[] = ["OLD.status = 'pending'", "NEW.status IN ('completed', 'failed')"];

const USAGE = `Usage: bun run scripts/launch/probe-constraints.ts [--help]

Read-only live-database probe for the deployed-schema constraint inventory.
Emits one {rowId, result, detail} line per mapped row plus probe-internal
connection/students-balance/immutability/settlement/inventory-diff lines;
exits 0 iff every line is PASS.`;

// ─── Catalog Queries (read-only) ──────────────────────────────────────────────

/** CHECK/unique constraint catalog rows for the three probed tables. */
const CONSTRAINT_CATALOG_SQL = sql`
  SELECT c.conname AS constraint_name,
         c.contype AS contype,
         t.relname AS table_name,
         pg_get_constraintdef(c.oid) AS definition
  FROM pg_constraint c
  JOIN pg_class t ON t.oid = c.conrelid
  JOIN pg_namespace n ON n.oid = t.relnamespace
  WHERE n.nspname = 'public'
    AND t.relname IN ('wallet', 'teacher_transaction', 'students')
`;

/** User (non-internal) trigger catalog rows for the wallet ledger table. */
const TRIGGER_CATALOG_SQL = sql`
  SELECT tg.tgname AS trigger_name,
         tg.tgenabled AS tgenabled,
         p.proname AS function_name
  FROM pg_trigger tg
  JOIN pg_class t ON t.oid = tg.tgrelid
  JOIN pg_namespace n ON n.oid = t.relnamespace
  JOIN pg_proc p ON p.oid = tg.tgfoid
  WHERE n.nspname = 'public'
    AND t.relname = 'teacher_transaction'
    AND NOT tg.tgisinternal
`;

/** Definition of the wallet-ledger UPDATE-guard function. */
const SETTLEMENT_FUNCTION_SQL = sql`
  SELECT pg_get_functiondef(p.oid) AS definition
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'prevent_teacher_transaction_update'
`;

/** One catalog query's outcome: its rows, or a scrubbed error detail. */
interface CatalogResult {
  readonly rows: readonly Record<string, unknown>[];
  readonly error: string | null;
}

/** Runs one read-only catalog statement, containing errors into the result. */
async function runCatalogQuery(db: ProbeDb, query: SQLWrapper): Promise<CatalogResult> {
  try {
    const result = await db.execute(query);
    return { rows: result.rows, error: null };
  } catch (error) {
    const detail = scrubDsnSecrets(errorMessage(error));
    logger.error("probe-constraints catalog query failed", { detail });
    return { rows: [], error: detail };
  }
}

/** Reads one catalog text column (`""` when the driver returned a non-string). */
const text = (row: Record<string, unknown>, key: string): string => {
  const value = row[key];
  return typeof value === "string" ? value : "";
};

// ─── Line Builders ────────────────────────────────────────────────────────────

const pass = (rowId: string, detail: string): ProbeLine => ({ rowId, result: "PASS", detail });
const fail = (rowId: string, detail: string): ProbeLine => ({ rowId, result: "FAIL", detail });
const catalogErrorLine = (rowId: string, catalog: CatalogResult): ProbeLine | null =>
  catalog.error === null ? null : fail(rowId, `catalog query error: ${catalog.error}`);

/** One deployed catalog constraint row as a plain text record. */
interface DeployedConstraint {
  readonly name: string;
  readonly contype: string;
  readonly table: string;
  readonly definition: string;
}

const deployedConstraints = (rows: readonly Record<string, unknown>[]): readonly DeployedConstraint[] =>
  rows.map(row => ({
    name: text(row, "constraint_name"),
    contype: text(row, "contype"),
    table: text(row, "table_name"),
    definition: text(row, "definition"),
  }));

const sortedList = (names: readonly string[]): string => names.toSorted((a, b) => a.localeCompare(b)).join(", ");

/** One mapped registry row's named-constraint assertion. */
function namedConstraintLine(rowId: string, expected: ExpectedConstraint, catalog: CatalogResult): ProbeLine {
  const errorLine = catalogErrorLine(rowId, catalog);
  if (errorLine !== null) return errorLine;
  const kind = expected.contype === "u" ? "UNIQUE" : "CHECK";
  const matches = deployedConstraints(catalog.rows).filter(
    entry => entry.name === expected.name && entry.table === expected.table
  );
  const where = `constraint "${expected.name}" on ${expected.table}`;
  if (matches.length !== 1) {
    const found = matches.length === 0 ? "NOT FOUND in schema public" : `${matches.length} catalog rows (expected 1)`;
    return fail(rowId, `${where} (${kind}): ${found}`);
  }
  if (matches[0].contype !== expected.contype) {
    return fail(rowId, `${where}: wrong contype '${matches[0].contype}' (expected '${expected.contype}' = ${kind})`);
  }
  const detail = `${where}: contype='${expected.contype}' (${kind}), definition='${matches[0].definition}'`;
  return pass(rowId, detail);
}

/** The four `students_balance_*_check` CHECK constraints (INV-B1's DB floor). */
function studentsBalanceChecksLine(catalog: CatalogResult): ProbeLine {
  const errorLine = catalogErrorLine(STUDENTS_CHECKS_ROW_ID, catalog);
  if (errorLine !== null) return errorLine;
  const expectedNames = EXPECTED_CONSTRAINTS.filter(e => e.table === "students" && e.contype === "c").map(e => e.name);
  const deployed = deployedConstraints(catalog.rows);
  const missing = expectedNames.filter(
    name => !deployed.some(entry => entry.name === name && entry.table === "students" && entry.contype === "c")
  );
  if (missing.length > 0) {
    return fail(
      STUDENTS_CHECKS_ROW_ID,
      `students_balance_*_check CHECK constraints missing on students: ${missing.join(", ")}`
    );
  }
  const detail = `all ${expectedNames.length} students_balance_*_check CHECK constraints present on students: ${expectedNames.join(", ")}`;
  return pass(STUDENTS_CHECKS_ROW_ID, detail);
}

/** Both immutability trigger families on the wallet ledger — present AND enabled. */
function immutabilityTriggersLine(catalog: CatalogResult): ProbeLine {
  const errorLine = catalogErrorLine(IMMUTABILITY_ROW_ID, catalog);
  if (errorLine !== null) return errorLine;
  const deployed = catalog.rows.map(row => ({
    name: text(row, "trigger_name"),
    enabled: text(row, "tgenabled"),
    functionName: text(row, "function_name"),
  }));
  const armed: string[] = [];
  const problems: string[] = [];
  for (const expected of EXPECTED_TRIGGERS) {
    const matches = deployed.filter(entry => entry.name === expected.name);
    if (matches.length !== 1) {
      const found = matches.length === 0 ? "NOT FOUND" : `${matches.length} catalog rows (expected 1)`;
      problems.push(`${expected.name} on ${LEDGER_TABLE}: ${found}`);
      continue;
    }
    if (matches[0].enabled === "D") {
      problems.push(`${expected.name}: present but DISABLED (tgenabled='D')`);
      continue;
    }
    if (matches[0].functionName !== expected.functionName) {
      problems.push(`${matches[0].name}: executes ${matches[0].functionName} (expected ${expected.functionName})`);
      continue;
    }
    armed.push(`${matches[0].name} (tgenabled='${matches[0].enabled}', executes ${matches[0].functionName})`);
  }
  if (problems.length > 0) {
    return fail(IMMUTABILITY_ROW_ID, `immutability trigger families on ${LEDGER_TABLE}: ${problems.join("; ")}`);
  }
  return pass(
    IMMUTABILITY_ROW_ID,
    `both immutability trigger families present and enabled on ${LEDGER_TABLE}: ${armed.join(", ")}`
  );
}

/** The settlement-amended UPDATE-guard function (not the strict guard). */
function settlementFunctionLine(catalog: CatalogResult): ProbeLine {
  const errorLine = catalogErrorLine(SETTLEMENT_ROW_ID, catalog);
  if (errorLine !== null) return errorLine;
  const definitions = catalog.rows.map(row => text(row, "definition"));
  const amended = definitions.filter(definition => SETTLEMENT_MARKERS.every(marker => definition.includes(marker)));
  if (definitions.length === 0) {
    return fail(
      SETTLEMENT_ROW_ID,
      `settlement-amended function ${SETTLEMENT_FUNCTION_NAME}: NOT FOUND in schema public`
    );
  }
  if (amended.length === 0) {
    return fail(
      SETTLEMENT_ROW_ID,
      `function ${SETTLEMENT_FUNCTION_NAME} exists but is NOT the settlement-amended guard — the pending-withdrawal settlement exception is missing from its definition`
    );
  }
  const detail = `settlement-amended function ${SETTLEMENT_FUNCTION_NAME} present: the pending-withdrawal settlement exception is armed (pending withdrawal → completed|failed, every other column frozen)`;
  return pass(SETTLEMENT_ROW_ID, detail);
}

/** The deployed-vs-expected inventory diff — missing AND extra names are FAILs. */
function inventoryDriftLine(constraints: CatalogResult, triggers: CatalogResult): ProbeLine {
  const problems: string[] = [];
  if (constraints.error !== null) {
    problems.push(`constraint catalog query error: ${constraints.error}`);
  } else {
    const deployed = deployedConstraints(constraints.rows).filter(e => e.contype === "c" || e.contype === "u");
    const present = (name: string, table: string) => deployed.some(e => e.name === name && e.table === table);
    const missing = EXPECTED_CONSTRAINTS.filter(e => !present(e.name, e.table)).map(e => `${e.table}.${e.name}`);
    const extra = deployed
      .filter(e => !EXPECTED_CONSTRAINTS.some(x => x.name === e.name))
      .map(e => `${e.table}.${e.name}`);
    const wrongKind = EXPECTED_CONSTRAINTS.filter(e =>
      deployed.some(x => x.name === e.name && x.table === e.table && x.contype !== e.contype)
    ).map(e => `${e.table}.${e.name} (contype mismatch)`);
    if (missing.length > 0) problems.push(`missing constraints: ${sortedList(missing)}`);
    if (extra.length > 0) problems.push(`unexpected extra constraints: ${sortedList(extra)}`);
    if (wrongKind.length > 0) problems.push(`wrong-kind constraints: ${sortedList(wrongKind)}`);
  }
  if (triggers.error !== null) {
    problems.push(`trigger catalog query error: ${triggers.error}`);
  } else {
    const deployedNames = triggers.rows.map(row => text(row, "trigger_name"));
    const missingTriggers = EXPECTED_TRIGGERS.filter(e => !deployedNames.includes(e.name)).map(e => e.name);
    const extraTriggers = deployedNames.filter(name => !EXPECTED_TRIGGERS.some(e => e.name === name));
    if (missingTriggers.length > 0)
      problems.push(`missing triggers on ${LEDGER_TABLE}: ${sortedList(missingTriggers)}`);
    if (extraTriggers.length > 0) {
      problems.push(`unexpected extra user triggers on ${LEDGER_TABLE}: ${sortedList(extraTriggers)}`);
    }
  }
  if (problems.length > 0) {
    return fail(DRIFT_ROW_ID, `deployed inventory drifts from expectation — ${problems.join("; ")}`);
  }
  const detail = `deployed inventory matches expectation exactly: ${EXPECTED_CONSTRAINTS.length} CHECK/unique constraints on wallet/${LEDGER_TABLE}/students and ${EXPECTED_TRIGGERS.length} user triggers on ${LEDGER_TABLE} — no missing, no extra`;
  return pass(DRIFT_ROW_ID, detail);
}

// ─── Probe Body & CLI ─────────────────────────────────────────────────────────

/**
 * The probe body: the connection probe first (an unreachable database is
 * a single named FAIL row and nothing else runs), then the mapped-row
 * named-constraint assertions, then the probe-internal inventory lines
 * (students-balance checks, immutability trigger families,
 * settlement-amended function, inventory diff).
 */
export async function probeConstraints(db: ProbeDb): Promise<readonly ProbeLine[]> {
  const connection = await probeDbConnection(db, CONNECTION_ROW_ID);
  if (connection.result === "FAIL") return [connection];

  const constraintCatalog = await runCatalogQuery(db, CONSTRAINT_CATALOG_SQL);
  const triggerCatalog = await runCatalogQuery(db, TRIGGER_CATALOG_SQL);
  const settlementCatalog = await runCatalogQuery(db, SETTLEMENT_FUNCTION_SQL);

  const lines: ProbeLine[] = [];
  for (const rowId of CONSTRAINT_ROW_IDS) {
    const bindings = EXPECTED_CONSTRAINTS.filter(entry => entry.rowId === rowId);
    if (bindings.length !== 1) {
      const detail = `row mapped to this probe has ${bindings.length} expected-constraint bindings (expected exactly 1) — update the probe's expected inventory`;
      lines.push(fail(rowId, detail));
      continue;
    }
    lines.push(namedConstraintLine(rowId, bindings[0], constraintCatalog));
  }
  lines.push(studentsBalanceChecksLine(constraintCatalog));
  lines.push(immutabilityTriggersLine(triggerCatalog));
  lines.push(settlementFunctionLine(settlementCatalog));
  lines.push(inventoryDriftLine(constraintCatalog, triggerCatalog));
  return [connection, ...lines];
}

/**
 * CLI entry point. Reads args (the tokens after the interpreter and script
 * path), opens the read-only database handle from the repo `.env` through
 * the shared client, and returns the process exit code.
 */
export async function main(
  args: readonly string[] = process.argv.slice(2),
  options: DbProbeCliOptions = {}
): Promise<number> {
  return runDbProbeCli(
    { probeName: "probe-constraints", usage: USAGE, connectionRowId: CONNECTION_ROW_ID, runProbe: probeConstraints },
    args,
    options
  );
}

if (import.meta.main) {
  main()
    .then(code => process.exit(code))
    .catch((error: unknown) => {
      console.error(error);
      process.exit(1);
    });
}
