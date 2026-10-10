/**
 * Paired self-validation test for the deployed-schema constraint-inventory
 * probe — mapped-row inventory, expected-inventory consistency, the full
 * all-PASS matrix against seeded catalog fixtures, every drift/negative
 * branch (missing, wrong-kind, extra, disabled, non-amended guard), the
 * CLI surface, and the secret-scrubbing discipline. The database handle is
 * fully stubbed through the `ProbeDb` seam (zero type casts): no live
 * connection is opened here — the probe CLI's own dev-DB run is recorded
 * separately as the runner self-validation.
 */

import { describe, expect, it } from "bun:test";
import { CONSTRAINT_ROW_IDS, EXPECTED_CONSTRAINTS, main, probeConstraints } from "@/scripts/launch/probe-constraints";
import type { ProbeLine } from "@/scripts/launch/shared/launch-types";
import type { ProbeDb } from "@/scripts/launch/shared/probe-cli";

const CONNECTION_ROW_ID = "probe-constraints.connection";
const STUDENTS_CHECKS_ROW_ID = "probe-constraints.students-balance-checks";
const IMMUTABILITY_ROW_ID = "probe-constraints.immutability-triggers";
const SETTLEMENT_ROW_ID = "probe-constraints.settlement-function";
const DRIFT_ROW_ID = "probe-constraints.inventory-drift";

/** One queued stub response per statement the probe issues, in issue order. */
interface StubResponse {
  readonly rows?: readonly Record<string, unknown>[];
  readonly error?: Error;
}

/**
 * Stub read-only handle answering the probe's statements in issue order:
 * the liveness probe first, then the constraint catalog, the trigger
 * catalog, and the settlement-function catalog query.
 */
function catalogDb(responses: readonly StubResponse[]): ProbeDb {
  const pending = [...responses];
  return {
    async execute() {
      const next = pending.shift();
      if (next === undefined)
        throw new Error("stub exhausted: the probe issued more statements than it was seeded with");
      if (next.error !== undefined) throw next.error;
      return { rows: [...(next.rows ?? [])] };
    },
  };
}

function constraintRow(name: string, contype: string, table: string, definition: string): Record<string, unknown> {
  return { constraint_name: name, contype, table_name: table, definition };
}

function triggerRow(name: string, tgenabled: string, functionName: string): Record<string, unknown> {
  return { trigger_name: name, tgenabled, function_name: functionName };
}

/** A fully-deployed constraint catalog, incl. PK/FK rows the diff must ignore. */
function fullConstraintCatalog(): Record<string, unknown>[] {
  return [
    constraintRow("wallet_pkey", "p", "wallet", "PRIMARY KEY (id)"),
    constraintRow("wallet_teacher_id_fkey", "f", "wallet", "FOREIGN KEY (teacher_id) REFERENCES teachers(id)"),
    constraintRow("wallet_teacher_id_unique", "u", "wallet", "UNIQUE (teacher_id)"),
    constraintRow("wallet_balance_check", "c", "wallet", "CHECK ((balance >= (0)::numeric))"),
    constraintRow("wallet_total_earning_check", "c", "wallet", "CHECK ((total_earning >= (0)::numeric))"),
    constraintRow("teacher_transaction_amount_check", "c", "teacher_transaction", "CHECK ((amount > (0)::numeric))"),
    constraintRow("students_balance_hifz_check", "c", "students", "CHECK ((balance_hifz >= 0))"),
    constraintRow("students_balance_reviews_check", "c", "students", "CHECK ((balance_reviews >= 0))"),
    constraintRow("students_balance_tajweed_check", "c", "students", "CHECK ((balance_tajweed >= 0))"),
    constraintRow("students_balance_trial_check", "c", "students", "CHECK ((balance_trial >= 0))"),
    constraintRow("students_handshake_code_unique", "u", "students", "UNIQUE (handshake_code)"),
  ];
}

const FULL_TRIGGERS: readonly Record<string, unknown>[] = [
  triggerRow("prevent_teacher_transaction_update_trigger", "O", "prevent_teacher_transaction_update"),
  triggerRow("prevent_teacher_transaction_delete_trigger", "O", "prevent_teacher_transaction_delete"),
];

/** The settlement-amended guard: carries the pending-withdrawal exception. */
const AMENDED_FUNCTION_DEF = [
  "CREATE OR REPLACE FUNCTION public.prevent_teacher_transaction_update()",
  " RETURNS trigger",
  " LANGUAGE plpgsql",
  "AS $function$",
  "BEGIN",
  "    IF OLD.status = 'pending'",
  "       AND OLD.type = 'withdrawal'",
  "       AND NEW.status IN ('completed', 'failed')",
  "    THEN",
  "        RETURN NEW;",
  "    END IF;",
  "    RAISE EXCEPTION 'teacher_transaction is immutable';",
  "END;",
  "$function$",
].join("\n");

/** The strict block-everything guard the amended one replaces. */
const STRICT_FUNCTION_DEF = [
  "CREATE OR REPLACE FUNCTION public.prevent_teacher_transaction_update()",
  " RETURNS trigger",
  " LANGUAGE plpgsql",
  "AS $function$",
  "BEGIN",
  "    RAISE EXCEPTION 'teacher_transaction is immutable — UPDATE is not permitted';",
  "END;",
  "$function$",
].join("\n");

/** A reachable database whose three catalogs are fully deployed. */
function happyDb(): ProbeDb {
  return catalogDb([
    { rows: [{ alive: 1 }] },
    { rows: fullConstraintCatalog() },
    { rows: FULL_TRIGGERS },
    { rows: [{ definition: AMENDED_FUNCTION_DEF }] },
  ]);
}

function lineByRowId(lines: readonly ProbeLine[], rowId: string): ProbeLine {
  const matches = lines.filter(line => line.rowId === rowId);
  expect(matches).toHaveLength(1);
  return matches[0];
}

/** Stdout capture: every emitted line, in order. */
function captureStdout(): { lines: string[]; write: (line: string) => void } {
  const lines: string[] = [];
  return { lines, write: line => lines.push(line) };
}

/** Structural guard for reading emitted JSON records back without unsafe casts. */
function isProbeLine(value: unknown): value is ProbeLine {
  if (typeof value !== "object" || value === null) return false;
  const rowId = Reflect.get(value, "rowId");
  const result = Reflect.get(value, "result");
  const detail = Reflect.get(value, "detail");
  return typeof rowId === "string" && (result === "PASS" || result === "FAIL") && typeof detail === "string";
}

/** Parses the JSON record lines a run emitted (all but the trailing summary line). */
function parseRecordLines(lines: readonly string[]): ProbeLine[] {
  const parsed: unknown[] = lines.slice(0, -1).map(line => JSON.parse(line));
  return parsed.filter(isProbeLine);
}

describe("probe-constraints", () => {
  it("pins the mapped-row inventory (the named-constraint rows)", () => {
    expect(CONSTRAINT_ROW_IDS).toEqual(["5.4.1", "5.4.2", "5.4.3", "5.4.8"]);
  });

  it("binds every mapped row to exactly one expected constraint (no silent drops)", () => {
    for (const rowId of CONSTRAINT_ROW_IDS) {
      expect(EXPECTED_CONSTRAINTS.filter(entry => entry.rowId === rowId)).toHaveLength(1);
    }
    const bound = EXPECTED_CONSTRAINTS.filter(entry => entry.rowId !== undefined);
    expect(bound).toHaveLength(CONSTRAINT_ROW_IDS.length);
  });

  it("emits the full all-PASS inventory against a fully-deployed catalog", async () => {
    const lines = await probeConstraints(happyDb());
    expect(lines.map(line => line.rowId)).toEqual([
      CONNECTION_ROW_ID,
      ...CONSTRAINT_ROW_IDS,
      STUDENTS_CHECKS_ROW_ID,
      IMMUTABILITY_ROW_ID,
      SETTLEMENT_ROW_ID,
      DRIFT_ROW_ID,
    ]);
    expect(lines).toHaveLength(9);
    expect(lines.every(line => line.result === "PASS")).toBe(true);
    expect(lineByRowId(lines, "5.4.1").detail).toContain("wallet_balance_check");
    expect(lineByRowId(lines, "5.4.3").detail).toContain("UNIQUE");
    expect(lineByRowId(lines, STUDENTS_CHECKS_ROW_ID).detail).toContain("students_balance_trial_check");
    expect(lineByRowId(lines, IMMUTABILITY_ROW_ID).detail).toContain("prevent_teacher_transaction_update_trigger");
    expect(lineByRowId(lines, SETTLEMENT_ROW_ID).detail).toContain("settlement exception is armed");
    expect(lineByRowId(lines, DRIFT_ROW_ID).detail).toContain("no missing, no extra");
  });

  it("emits well-formed ProbeLine records (JSON shape)", async () => {
    const lines = await probeConstraints(happyDb());
    for (const line of lines) {
      expect(Object.keys(line).toSorted((a, b) => a.localeCompare(b))).toEqual(["detail", "result", "rowId"]);
      expect(line.detail.length).toBeGreaterThan(0);
    }
  });

  it("emits a named connection-error FAIL line when the database is unreachable", async () => {
    const lines = await probeConstraints(catalogDb([{ error: new Error("connection refused") }]));
    expect(lines).toHaveLength(1);
    expect(lines[0].rowId).toBe(CONNECTION_ROW_ID);
    expect(lines[0].result).toBe("FAIL");
    expect(lines[0].detail).toContain("database connection error");
  });

  it("names a missing mapped constraint as FAIL (planted expected-name absent from the catalog)", async () => {
    const lines = await probeConstraints(
      catalogDb([
        { rows: [{ alive: 1 }] },
        { rows: fullConstraintCatalog().filter(row => String(row.constraint_name) !== "wallet_balance_check") },
        { rows: FULL_TRIGGERS },
        { rows: [{ definition: AMENDED_FUNCTION_DEF }] },
      ])
    );
    const row = lineByRowId(lines, "5.4.1");
    expect(row.result).toBe("FAIL");
    expect(row.detail).toContain('"wallet_balance_check"');
    expect(row.detail).toContain("NOT FOUND");
    const drift = lineByRowId(lines, DRIFT_ROW_ID);
    expect(drift.result).toBe("FAIL");
    expect(drift.detail).toContain("missing constraints: wallet.wallet_balance_check");
  });

  it("names a wrong-kind constraint (unique deployed as CHECK)", async () => {
    const rows = fullConstraintCatalog().map(row =>
      String(row.constraint_name) === "wallet_teacher_id_unique"
        ? constraintRow("wallet_teacher_id_unique", "c", "wallet", "CHECK (true)")
        : row
    );
    const lines = await probeConstraints(
      catalogDb([
        { rows: [{ alive: 1 }] },
        { rows },
        { rows: FULL_TRIGGERS },
        { rows: [{ definition: AMENDED_FUNCTION_DEF }] },
      ])
    );
    const row = lineByRowId(lines, "5.4.3");
    expect(row.result).toBe("FAIL");
    expect(row.detail).toContain("wrong contype 'c'");
    expect(lineByRowId(lines, DRIFT_ROW_ID).detail).toContain("wallet.wallet_teacher_id_unique (contype mismatch)");
  });

  it("names an unexpected extra constraint as drift (never silent)", async () => {
    const lines = await probeConstraints(
      catalogDb([
        { rows: [{ alive: 1 }] },
        { rows: [...fullConstraintCatalog(), constraintRow("wallet_new_audit_check", "c", "wallet", "CHECK (true)")] },
        { rows: FULL_TRIGGERS },
        { rows: [{ definition: AMENDED_FUNCTION_DEF }] },
      ])
    );
    for (const rowId of CONSTRAINT_ROW_IDS) {
      expect(lineByRowId(lines, rowId).result).toBe("PASS");
    }
    const drift = lineByRowId(lines, DRIFT_ROW_ID);
    expect(drift.result).toBe("FAIL");
    expect(drift.detail).toContain("unexpected extra constraints: wallet.wallet_new_audit_check");
  });

  it("names a missing students balance check", async () => {
    const lines = await probeConstraints(
      catalogDb([
        { rows: [{ alive: 1 }] },
        { rows: fullConstraintCatalog().filter(row => String(row.constraint_name) !== "students_balance_hifz_check") },
        { rows: FULL_TRIGGERS },
        { rows: [{ definition: AMENDED_FUNCTION_DEF }] },
      ])
    );
    const row = lineByRowId(lines, STUDENTS_CHECKS_ROW_ID);
    expect(row.result).toBe("FAIL");
    expect(row.detail).toContain("students_balance_hifz_check");
    const drift = lineByRowId(lines, DRIFT_ROW_ID);
    expect(drift.result).toBe("FAIL");
    expect(drift.detail).toContain("missing constraints: students.students_balance_hifz_check");
  });

  it("flags a disabled immutability trigger while the drift line stays PASS (presence ≠ enabled)", async () => {
    const triggers = [
      triggerRow("prevent_teacher_transaction_update_trigger", "D", "prevent_teacher_transaction_update"),
      triggerRow("prevent_teacher_transaction_delete_trigger", "O", "prevent_teacher_transaction_delete"),
    ];
    const lines = await probeConstraints(
      catalogDb([
        { rows: [{ alive: 1 }] },
        { rows: fullConstraintCatalog() },
        { rows: triggers },
        { rows: [{ definition: AMENDED_FUNCTION_DEF }] },
      ])
    );
    const row = lineByRowId(lines, IMMUTABILITY_ROW_ID);
    expect(row.result).toBe("FAIL");
    expect(row.detail).toContain("prevent_teacher_transaction_update_trigger");
    expect(row.detail).toContain("DISABLED");
    expect(lineByRowId(lines, DRIFT_ROW_ID).result).toBe("PASS");
  });

  it("names a missing immutability trigger and its drift", async () => {
    const lines = await probeConstraints(
      catalogDb([
        { rows: [{ alive: 1 }] },
        { rows: fullConstraintCatalog() },
        {
          rows: FULL_TRIGGERS.filter(row => String(row.trigger_name) !== "prevent_teacher_transaction_delete_trigger"),
        },
        { rows: [{ definition: AMENDED_FUNCTION_DEF }] },
      ])
    );
    const row = lineByRowId(lines, IMMUTABILITY_ROW_ID);
    expect(row.result).toBe("FAIL");
    expect(row.detail).toContain("prevent_teacher_transaction_delete_trigger on teacher_transaction: NOT FOUND");
    const drift = lineByRowId(lines, DRIFT_ROW_ID);
    expect(drift.result).toBe("FAIL");
    expect(drift.detail).toContain(
      "missing triggers on teacher_transaction: prevent_teacher_transaction_delete_trigger"
    );
  });

  it("flags an extra user trigger on the ledger as drift", async () => {
    const lines = await probeConstraints(
      catalogDb([
        { rows: [{ alive: 1 }] },
        { rows: fullConstraintCatalog() },
        { rows: [...FULL_TRIGGERS, triggerRow("teacher_transaction_audit_trigger", "O", "audit_row")] },
        { rows: [{ definition: AMENDED_FUNCTION_DEF }] },
      ])
    );
    expect(lineByRowId(lines, IMMUTABILITY_ROW_ID).result).toBe("PASS");
    const drift = lineByRowId(lines, DRIFT_ROW_ID);
    expect(drift.result).toBe("FAIL");
    expect(drift.detail).toContain(
      "unexpected extra user triggers on teacher_transaction: teacher_transaction_audit_trigger"
    );
  });

  it("names a trigger executing the wrong function", async () => {
    const triggers = [
      triggerRow("prevent_teacher_transaction_update_trigger", "O", "prevent_wrong_function"),
      triggerRow("prevent_teacher_transaction_delete_trigger", "O", "prevent_teacher_transaction_delete"),
    ];
    const lines = await probeConstraints(
      catalogDb([
        { rows: [{ alive: 1 }] },
        { rows: fullConstraintCatalog() },
        { rows: triggers },
        { rows: [{ definition: AMENDED_FUNCTION_DEF }] },
      ])
    );
    const row = lineByRowId(lines, IMMUTABILITY_ROW_ID);
    expect(row.result).toBe("FAIL");
    expect(row.detail).toContain("executes prevent_wrong_function");
  });

  it("rejects the strict block-everything guard (settlement exception missing)", async () => {
    const lines = await probeConstraints(
      catalogDb([
        { rows: [{ alive: 1 }] },
        { rows: fullConstraintCatalog() },
        { rows: FULL_TRIGGERS },
        { rows: [{ definition: STRICT_FUNCTION_DEF }] },
      ])
    );
    const row = lineByRowId(lines, SETTLEMENT_ROW_ID);
    expect(row.result).toBe("FAIL");
    expect(row.detail).toContain("NOT the settlement-amended guard");
  });

  it("names the settlement function when absent", async () => {
    const lines = await probeConstraints(
      catalogDb([{ rows: [{ alive: 1 }] }, { rows: fullConstraintCatalog() }, { rows: FULL_TRIGGERS }, { rows: [] }])
    );
    const row = lineByRowId(lines, SETTLEMENT_ROW_ID);
    expect(row.result).toBe("FAIL");
    expect(row.detail).toContain("prevent_teacher_transaction_update");
    expect(row.detail).toContain("NOT FOUND");
  });

  it("contains a constraint-catalog query error into named FAIL lines (no crash)", async () => {
    const lines = await probeConstraints(
      catalogDb([
        { rows: [{ alive: 1 }] },
        { error: new Error("permission denied for pg_constraint") },
        { rows: FULL_TRIGGERS },
        { rows: [{ definition: AMENDED_FUNCTION_DEF }] },
      ])
    );
    expect(lines).toHaveLength(9);
    for (const rowId of [...CONSTRAINT_ROW_IDS, STUDENTS_CHECKS_ROW_ID, DRIFT_ROW_ID]) {
      const row = lineByRowId(lines, rowId);
      expect(row.result).toBe("FAIL");
      expect(row.detail).toContain("catalog query error");
    }
    expect(lineByRowId(lines, IMMUTABILITY_ROW_ID).result).toBe("PASS");
    expect(lineByRowId(lines, SETTLEMENT_ROW_ID).result).toBe("PASS");
  });

  it("names duplicate catalog rows for a mapped constraint (expected exactly 1)", async () => {
    const duplicated = [
      ...fullConstraintCatalog(),
      constraintRow("wallet_balance_check", "c", "wallet", "CHECK ((balance >= (0)::numeric))"),
    ];
    const lines = await probeConstraints(
      catalogDb([
        { rows: [{ alive: 1 }] },
        { rows: duplicated },
        { rows: FULL_TRIGGERS },
        { rows: [{ definition: AMENDED_FUNCTION_DEF }] },
      ])
    );
    const row = lineByRowId(lines, "5.4.1");
    expect(row.result).toBe("FAIL");
    expect(row.detail).toContain("2 catalog rows (expected 1)");
  });

  it("names duplicate catalog rows for an expected trigger", async () => {
    const duplicated = [
      ...FULL_TRIGGERS,
      triggerRow("prevent_teacher_transaction_update_trigger", "O", "prevent_teacher_transaction_update"),
    ];
    const lines = await probeConstraints(
      catalogDb([
        { rows: [{ alive: 1 }] },
        { rows: fullConstraintCatalog() },
        { rows: duplicated },
        { rows: [{ definition: AMENDED_FUNCTION_DEF }] },
      ])
    );
    const row = lineByRowId(lines, IMMUTABILITY_ROW_ID);
    expect(row.result).toBe("FAIL");
    expect(row.detail).toContain("2 catalog rows (expected 1)");
  });

  it("contains a trigger-catalog query error into named FAIL lines (no crash)", async () => {
    const lines = await probeConstraints(
      catalogDb([
        { rows: [{ alive: 1 }] },
        { rows: fullConstraintCatalog() },
        { error: new Error("permission denied for pg_trigger") },
        { rows: [{ definition: AMENDED_FUNCTION_DEF }] },
      ])
    );
    expect(lines).toHaveLength(9);
    for (const rowId of [IMMUTABILITY_ROW_ID, DRIFT_ROW_ID]) {
      const row = lineByRowId(lines, rowId);
      expect(row.result).toBe("FAIL");
      expect(row.detail).toContain("catalog query error");
    }
    for (const rowId of [...CONSTRAINT_ROW_IDS, STUDENTS_CHECKS_ROW_ID, SETTLEMENT_ROW_ID]) {
      expect(lineByRowId(lines, rowId).result).toBe("PASS");
    }
  });

  it("main exits 0 with the all-PASS inventory and the 9-line summary", async () => {
    const out = captureStdout();
    const exit = await main([], { db: happyDb(), stdout: out.write });
    expect(exit).toBe(0);
    const records = parseRecordLines(out.lines);
    expect(records).toHaveLength(9);
    expect(records.every(line => line.result === "PASS")).toBe(true);
    expect(out.lines.at(-1)).toContain("probe-constraints: 9 line(s) — 9 PASS, 0 FAIL");
  });

  it("main exits non-zero when any line FAILs", async () => {
    const out = captureStdout();
    const exit = await main([], {
      db: catalogDb([
        { rows: [{ alive: 1 }] },
        { rows: fullConstraintCatalog().filter(row => String(row.constraint_name) !== "wallet_balance_check") },
        { rows: FULL_TRIGGERS },
        { rows: [{ definition: AMENDED_FUNCTION_DEF }] },
      ]),
      stdout: out.write,
    });
    expect(exit).toBe(1);
    const records = parseRecordLines(out.lines);
    expect(records.filter(line => line.result === "FAIL").map(line => line.rowId)).toEqual(["5.4.1", DRIFT_ROW_ID]);
    expect(out.lines.at(-1)).toContain("7 PASS, 2 FAIL");
  });

  it("--help prints usage and exits 0", async () => {
    const out = captureStdout();
    const exit = await main(["--help"], { db: happyDb(), stdout: out.write });
    expect(exit).toBe(0);
    expect(out.lines[0]).toContain("Usage: bun run scripts/launch/probe-constraints.ts");
  });

  it("unknown arguments are usage errors (exit 1, no probe lines emitted)", async () => {
    const out = captureStdout();
    const exit = await main(["--nope"], { db: happyDb(), stdout: out.write });
    expect(exit).toBe(1);
    expect(out.lines).toHaveLength(0);
  });

  it("scrubs credential material from catalog query errors before any line is emitted", async () => {
    const lines = await probeConstraints(
      catalogDb([
        { rows: [{ alive: 1 }] },
        { error: new Error("catalog query failed: postgres://kottaby:hunter2@db.example.com:5432/prod") },
        { rows: FULL_TRIGGERS },
        { rows: [{ definition: AMENDED_FUNCTION_DEF }] },
      ])
    );
    const joined = lines.map(line => line.detail).join("\n");
    expect(joined).toContain("***:***@");
    expect(joined).not.toContain("hunter2");
  });
});
