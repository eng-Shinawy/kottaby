/**
 * Paired self-validation test for the decisions probe — mapped-row
 * inventory, line-emission shape, drift plants (a planted catalog drift
 * MUST fail its named line, never silently), exit codes, credential
 * scrubbing, and error containment. The database handle is a
 * query-content-keyed fake catalog: no live connection is opened here
 * (the probe CLI's own dev-DB run is recorded separately as the runner
 * self-validation).
 *
 * The fixtures below are pinned independently of the probe's own
 * expectations (both mirror the same canonical census): a probe-side
 * expectation edit must surface here as a failure, not pass silently.
 */

import { describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SQLWrapper } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { DECISION_ROW_IDS, main, probeDecisions } from "@/scripts/launch/probe-decisions";
import type { ProbeLine } from "@/scripts/launch/shared/launch-types";
import type { ProbeDb } from "@/scripts/launch/shared/probe-cli";

const CONNECTION_ROW_ID = "probe-decisions.connection";

/** Probe-scoped corroboration lines, in emission order after the mapped rows. */
const CORROBORATION_ROW_IDS: readonly string[] = [
  "probe-decisions.audit-logs-immutability-triggers",
  "probe-decisions.applicants-shared-pk",
  "probe-decisions.users-governance-columns",
  "probe-decisions.user-role-members",
  "probe-decisions.dispute-resolution-members",
  "probe-decisions.evaluations-reviewer-fks",
  "probe-decisions.recitation-session-unique",
  "probe-decisions.reports-teacher-id-absent",
  "probe-decisions.surah-juz-ref-member-count",
];

// ─── Fake catalog fixtures ───────────────────────────────────────────────────

/** Canonical pgEnum member sets (order-sensitive), as the live catalog reports them. */
const ENUM_MEMBERS: Readonly<Record<string, readonly string[]>> = {
  dispute_resolution: ["Cancel", "Complete", "Refund", "PartialRefund", "Uphold"],
  payment_gateway: [
    "stripe",
    "paypal",
    "paymob",
    "fawery",
    "offline_cash",
    "bank_transfer",
    "scholarship",
    "other",
    "mock",
  ],
  session_intent: ["hifz", "tajweed", "evaluation"],
  session_type: ["student_session", "teacher_evaluation", "re_evaluation"],
  subscription_status: ["active", "pending", "expired", "cancelled", "suspended"],
  surah_juz_ref: [
    ...Array.from({ length: 114 }, (_, index) => `surah_${index + 1}`),
    ...Array.from({ length: 30 }, (_, index) => `juz_${index + 1}`),
  ],
  teacher_request_preference: ["queue", "reject", "offer_alternatives"],
  user_role: ["admin", "teacher", "student", "parent"],
};

type EnumFixtureRow = { enum_name: string; sort_order: number; member: string };

function enumFixtureRows(): EnumFixtureRow[] {
  const rows: EnumFixtureRow[] = [];
  for (const [name, members] of Object.entries(ENUM_MEMBERS)) {
    for (const [index, member] of members.entries()) {
      rows.push({ enum_name: name, sort_order: index + 1, member });
    }
  }
  return rows;
}

/** table, column, data_type, udt_name, max_length, is_nullable */
const COLUMN_FIXTURES: readonly (readonly [string, string, string, string, string | null, "YES" | "NO"])[] = [
  ["admin", "id", "integer", "int4", null, "NO"],
  ["applicants", "id", "integer", "int4", null, "NO"],
  ["audit_logs", "id", "integer", "int4", null, "NO"],
  ["evaluations", "evaluated_id", "integer", "int4", null, "NO"],
  ["evaluations", "evaluator_id", "integer", "int4", null, "NO"],
  ["notifications", "type", "USER-DEFINED", "notification_type", null, "NO"],
  ["parents", "id", "integer", "int4", null, "NO"],
  ["reports", "created_at", "timestamp without time zone", "timestamp", null, "NO"],
  ["reports", "id", "integer", "int4", null, "NO"],
  ["reports", "session_id", "integer", "int4", null, "NO"],
  ["reports", "student_rating_by_teacher", "integer", "int4", null, "YES"],
  ["reports", "teacher_notes", "text", "text", null, "YES"],
  ["reports", "updated_at", "timestamp without time zone", "timestamp", null, "NO"],
  ["session", "intent", "USER-DEFINED", "session_intent", null, "YES"],
  ["session", "resolution_outcome", "USER-DEFINED", "dispute_resolution", null, "YES"],
  ["session", "session_type", "USER-DEFINED", "session_type", null, "NO"],
  ["students", "parent_id", "integer", "int4", null, "YES"],
  ["subscriptions", "payment_method", "USER-DEFINED", "payment_gateway", null, "YES"],
  ["subscriptions", "payment_reference", "character varying", "varchar", "255", "YES"],
  ["subscriptions", "payment_verified_at", "timestamp without time zone", "timestamp", null, "YES"],
  ["subscriptions", "status", "USER-DEFINED", "subscription_status", null, "NO"],
  ["subscriptions", "user_id", "integer", "int4", null, "NO"],
  ["teacher", "request_preference", "USER-DEFINED", "teacher_request_preference", null, "YES"],
  ["teacher", "subjects", "character varying", "varchar", "255", "YES"],
  ["users", "blocked_at", "timestamp without time zone", "timestamp", null, "YES"],
  ["users", "deleted_at", "timestamp without time zone", "timestamp", null, "YES"],
  ["users", "is_blocked", "boolean", "bool", null, "YES"],
  ["users", "is_deleted", "boolean", "bool", null, "YES"],
  ["users", "role", "USER-DEFINED", "user_role", null, "NO"],
  ["users", "suspended", "boolean", "bool", null, "YES"],
  ["users", "suspended_at", "timestamp without time zone", "timestamp", null, "YES"],
  ["users", "suspended_period_days", "integer", "int4", null, "YES"],
];

type ColumnFixtureRow = {
  table_name: string;
  column_name: string;
  data_type: string;
  udt_name: string;
  max_length: string | null;
  is_nullable: string;
};

function columnFixtureRows(): ColumnFixtureRow[] {
  return COLUMN_FIXTURES.map(([table, column, dataType, udtName, maxLength, isNullable]) => ({
    table_name: table,
    column_name: column,
    data_type: dataType,
    udt_name: udtName,
    max_length: maxLength,
    is_nullable: isNullable,
  }));
}

/** name, table, fk_columns, ref_table, on_delete */
const FK_FIXTURES: readonly (readonly [string, string, string, string, string])[] = [
  ["applicants_id_users_id_fkey", "applicants", "id", "users", "c"],
  ["evaluations_evaluated_id_users_id_fkey", "evaluations", "evaluated_id", "users", "c"],
  ["evaluations_evaluator_id_users_id_fkey", "evaluations", "evaluator_id", "users", "r"],
  ["parents_id_users_id_fkey", "parents", "id", "users", "c"],
  ["students_parent_id_users_id_fkey", "students", "parent_id", "users", "n"],
  ["subscriptions_user_id_users_id_fkey", "subscriptions", "user_id", "users", "r"],
];

type FkFixtureRow = { name: string; table_name: string; fk_columns: string; ref_table: string; on_delete: string };

function fkFixtureRows(): FkFixtureRow[] {
  return FK_FIXTURES.map(([name, table, columns, refTable, onDelete]) => ({
    name,
    table_name: table,
    fk_columns: columns,
    ref_table: refTable,
    on_delete: onDelete,
  }));
}

/** name, table, definition */
const UNIQUE_FIXTURES: readonly (readonly [string, string, string])[] = [
  ["recitation_session_id_unique", "recitation", "UNIQUE (session_id)"],
  ["students_handshake_code_unique", "students", "UNIQUE (handshake_code)"],
];

type UniqueFixtureRow = { name: string; table_name: string; definition: string };

function uniqueFixtureRows(): UniqueFixtureRow[] {
  return UNIQUE_FIXTURES.map(([name, table, definition]) => ({ name, table_name: table, definition }));
}

/** name, tgenabled, definition */
const TRIGGER_FIXTURES: readonly (readonly [string, string, string])[] = [
  [
    "prevent_audit_logs_delete_trigger",
    "O",
    "CREATE TRIGGER prevent_audit_logs_delete_trigger BEFORE DELETE ON public.audit_logs",
  ],
  [
    "prevent_audit_logs_update_trigger",
    "O",
    "CREATE TRIGGER prevent_audit_logs_update_trigger BEFORE UPDATE ON public.audit_logs",
  ],
];

function triggerFixtureRows(): Record<string, unknown>[] {
  return TRIGGER_FIXTURES.map(([name, tgenabled, definition]) => ({ name, tgenabled, definition }));
}

function indexFixtureRows(): Record<string, unknown>[] {
  return [
    {
      name: "subscriptions_payment_reference_unique",
      definition:
        "CREATE UNIQUE INDEX subscriptions_payment_reference_unique ON public.subscriptions USING btree (payment_reference) WHERE (payment_reference IS NOT NULL)",
    },
  ];
}

// ─── Stub plumbing ───────────────────────────────────────────────────────────

/** Query-content-keyed catalog rows: SQL needle → result rows. */
type CatalogRows = Record<string, Record<string, unknown>[]>;

const dialect = new PgDialect();

/** Renders a probe query to its SQL text so the stub can route by content. */
function renderedSql(query: SQLWrapper | string): string {
  return typeof query === "string" ? query : dialect.sqlToQuery(query.getSQL()).sql;
}

/** Stub read-only handle routing each statement to its needle's fixture rows. */
function catalogDb(catalog: CatalogRows): ProbeDb {
  return {
    async execute(query) {
      const text = renderedSql(query);
      for (const [needle, rows] of Object.entries(catalog)) {
        if (text.includes(needle)) return { rows };
      }
      return { rows: [] };
    },
  };
}

/** The healthy live catalog: every probe expectation holds. */
function happyCatalog(): CatalogRows {
  return {
    "select 1": [{ alive: 1 }],
    pg_enum: enumFixtureRows(),
    "information_schema.columns": columnFixtureRows(),
    "information_schema.tables": [],
    "contype = 'f'": fkFixtureRows(),
    "contype = 'u'": uniqueFixtureRows(),
    pg_indexes: indexFixtureRows(),
    pg_trigger: triggerFixtureRows(),
  };
}

/** Stub handle that always throws (an unreachable database). */
function unreachableDb(failure: Error): ProbeDb {
  return {
    async execute() {
      throw failure;
    },
  };
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

/** Asserts the exact `ProbeLine` shape — the rowId/result/detail triple and nothing else. */
function assertProbeLineShape(line: ProbeLine): void {
  expect(Object.keys(line).toSorted((a, b) => a.localeCompare(b))).toEqual(["detail", "result", "rowId"]);
}

/** One fixture row with some fields overridden (keeps map callbacks spread-free). */
function patched<T extends object>(row: T, patch: Partial<T>): T {
  return { ...row, ...patch };
}

// ─── Drift plants ────────────────────────────────────────────────────────────

const dropEnumMember = (catalog: CatalogRows, enumName: string, member: string): void => {
  catalog.pg_enum = enumFixtureRows().filter(row => row.enum_name !== enumName || row.member !== member);
};

const dropFk = (catalog: CatalogRows, fkName: string): void => {
  catalog["contype = 'f'"] = fkFixtureRows().filter(row => row.name !== fkName);
};

const retagFkAction = (catalog: CatalogRows, fkName: string, action: string): void => {
  catalog["contype = 'f'"] = fkFixtureRows().map(row =>
    row.name === fkName ? patched(row, { on_delete: action }) : row
  );
};

const dropUnique = (catalog: CatalogRows, constraintName: string): void => {
  catalog["contype = 'u'"] = uniqueFixtureRows().filter(row => row.name !== constraintName);
};

const dropColumn = (catalog: CatalogRows, table: string, column: string): void => {
  catalog["information_schema.columns"] = columnFixtureRows().filter(
    row => !(row.table_name === table && row.column_name === column)
  );
};

const leakColumn = (catalog: CatalogRows, table: string, column: string): void => {
  const rows = columnFixtureRows();
  rows.push({
    table_name: table,
    column_name: column,
    data_type: "boolean",
    udt_name: "bool",
    max_length: null,
    is_nullable: "YES",
  });
  catalog["information_schema.columns"] = rows;
};

/** One surgical catalog drift: plant it, and exactly one named row must FAIL. */
const DRIFT_PLANTS: readonly (readonly [
  label: string,
  plant: (catalog: CatalogRows) => void,
  expectedRowId: string,
  detailNeedle: string,
])[] = [
  [
    "session_type loses a member",
    catalog => dropEnumMember(catalog, "session_type", "re_evaluation"),
    "8.8",
    "expected members",
  ],
  [
    "students_handshake_code_unique is missing",
    catalog => dropUnique(catalog, "students_handshake_code_unique"),
    "8.2",
    "students_handshake_code_unique: missing",
  ],
  [
    "students.parent_id carries the wrong delete action",
    catalog => retagFkAction(catalog, "students_parent_id_users_id_fkey", "c"),
    "8.2",
    "expected SET NULL",
  ],
  [
    "notifications.type is mistyped",
    catalog => {
      catalog["information_schema.columns"] = columnFixtureRows().map(row =>
        row.table_name === "notifications" ? patched(row, { data_type: "character varying", udt_name: "varchar" }) : row
      );
    },
    "8.4",
    "live: character varying/varchar",
  ],
  ["teacher.subjects is missing", catalog => dropColumn(catalog, "teacher", "subjects"), "8.6", "column MISSING"],
  [
    "subscriptions.user_id carries the wrong delete action",
    catalog => retagFkAction(catalog, "subscriptions_user_id_users_id_fkey", "c"),
    "8.18",
    "expected RESTRICT",
  ],
  [
    "payment_gateway loses an offline member",
    catalog => dropEnumMember(catalog, "payment_gateway", "bank_transfer"),
    "8.19",
    "offline_cash, scholarship",
  ],
  [
    "the offline partial unique index is missing",
    catalog => {
      catalog.pg_indexes = [];
    },
    "8.19",
    "subscriptions_payment_reference_unique: missing",
  ],
  [
    "an assignment table appears",
    catalog => {
      catalog["information_schema.tables"] = [{ table_name: "teacher_student_assignments" }];
    },
    "8.20",
    "teacher_student_assignments",
  ],
  [
    "a governance column leaks onto students",
    catalog => leakColumn(catalog, "students", "suspended"),
    "probe-decisions.users-governance-columns",
    "students.suspended",
  ],
  [
    "the audit delete trigger is disabled",
    catalog => {
      catalog.pg_trigger = triggerFixtureRows().map(row =>
        row.name === "prevent_audit_logs_delete_trigger" ? patched(row, { tgenabled: "D" }) : row
      );
    },
    "probe-decisions.audit-logs-immutability-triggers",
    "DISABLED",
  ],
  [
    "reports gains a teacher_id column",
    catalog => leakColumn(catalog, "reports", "teacher_id"),
    "probe-decisions.reports-teacher-id-absent",
    "UNEXPECTEDLY PRESENT",
  ],
  [
    "surah_juz_ref loses members",
    catalog => {
      catalog.pg_enum = enumFixtureRows().filter(row => row.enum_name !== "surah_juz_ref" || row.sort_order <= 141);
    },
    "probe-decisions.surah-juz-ref-member-count",
    "count: 141",
  ],
  [
    "the applicants shared-PK FK is missing",
    catalog => dropFk(catalog, "applicants_id_users_id_fkey"),
    "probe-decisions.applicants-shared-pk",
    "FK: missing",
  ],
  [
    "recitation_session_id_unique is missing",
    catalog => dropUnique(catalog, "recitation_session_id_unique"),
    "probe-decisions.recitation-session-unique",
    "unique: missing",
  ],
  [
    "the evaluator FK carries the wrong delete action",
    catalog => retagFkAction(catalog, "evaluations_evaluator_id_users_id_fkey", "c"),
    "probe-decisions.evaluations-reviewer-fks",
    "expected RESTRICT",
  ],
  [
    "user_role loses the parent member",
    catalog => dropEnumMember(catalog, "user_role", "parent"),
    "probe-decisions.user-role-members",
    "expected members",
  ],
  [
    "dispute_resolution loses an outcome",
    catalog => dropEnumMember(catalog, "dispute_resolution", "Uphold"),
    "probe-decisions.dispute-resolution-members",
    "expected members",
  ],
];

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("probe-decisions", () => {
  it("pins the mapped-row inventory (the decision schema-shape rows)", () => {
    expect(DECISION_ROW_IDS).toEqual([
      "8.1",
      "8.2",
      "8.4",
      "8.6",
      "8.8",
      "8.9",
      "8.10",
      "8.18",
      "8.19",
      "8.20",
      "8.26",
    ]);
  });

  it("emits the connection line, one PASS line per mapped row, then the corroboration lines", async () => {
    const lines = await probeDecisions(catalogDb(happyCatalog()));
    expect(lines).toHaveLength(1 + DECISION_ROW_IDS.length + CORROBORATION_ROW_IDS.length);
    const [connection, ...rest] = lines;
    expect(connection.rowId).toBe(CONNECTION_ROW_ID);
    expect(connection.result).toBe("PASS");
    expect(connection.detail).toContain("database connection established");
    expect(rest.slice(0, DECISION_ROW_IDS.length).map(line => line.rowId)).toEqual([...DECISION_ROW_IDS]);
    expect(rest.slice(DECISION_ROW_IDS.length).map(line => line.rowId)).toEqual([...CORROBORATION_ROW_IDS]);
    for (const line of lines) {
      assertProbeLineShape(line);
      expect(line.result).toBe("PASS");
      expect(line.detail.length).toBeGreaterThan(0);
    }
  });

  it("emits a named connection-error FAIL line when the database is unreachable", async () => {
    const lines = await probeDecisions(unreachableDb(new Error("ECONNREFUSED 127.0.0.1:5432")));
    expect(lines).toHaveLength(1);
    expect(lines[0].rowId).toBe(CONNECTION_ROW_ID);
    expect(lines[0].result).toBe("FAIL");
    expect(lines[0].detail).toContain("database connection error");
    expect(lines[0].detail).toContain("ECONNREFUSED");
  });

  it("scrubs credential material out of connection-error details", async () => {
    const lines = await probeDecisions(
      unreachableDb(new Error("connect failed for postgresql://postgres:hush@db:5432/x"))
    );
    expect(lines[0].detail).not.toContain("hush");
    expect(lines[0].detail).toContain("***");
  });

  it("main exits 0 with all-PASS lines against a healthy (stubbed) catalog", async () => {
    const out = captureStdout();
    const exit = await main([], { db: catalogDb(happyCatalog()), stdout: out.write });
    expect(exit).toBe(0);
    const records = parseRecordLines(out.lines);
    expect(records).toHaveLength(21);
    expect(records[0].rowId).toBe(CONNECTION_ROW_ID);
    expect(records.every(line => line.result === "PASS")).toBe(true);
    expect(out.lines.at(-1)).toContain("probe-decisions: 21 line(s) — 21 PASS, 0 FAIL");
  });

  it("main exits non-zero on a planted FAIL line (unreachable database)", async () => {
    const out = captureStdout();
    const exit = await main([], { db: unreachableDb(new Error("planted connection failure")), stdout: out.write });
    expect(exit).toBe(1);
    const records = parseRecordLines(out.lines);
    expect(records).toHaveLength(1);
    expect(records[0].rowId).toBe(CONNECTION_ROW_ID);
    expect(records[0].result).toBe("FAIL");
  });

  it("main exits non-zero when a catalog drift fails its named row", async () => {
    const catalog = happyCatalog();
    dropEnumMember(catalog, "session_type", "re_evaluation");
    const out = captureStdout();
    const exit = await main([], { db: catalogDb(catalog), stdout: out.write });
    expect(exit).toBe(1);
    expect(out.lines.at(-1)).toContain("20 PASS, 1 FAIL");
  });

  it("main contains an environment/open failure into the named connection FAIL line (never a crash)", async () => {
    const originalCwd = process.cwd();
    const emptyDir = mkdtempSync(join(tmpdir(), "probe-decisions-env-"));
    process.chdir(emptyDir);
    try {
      const out = captureStdout();
      const exit = await main([], { stdout: out.write });
      expect(exit).toBe(1);
      const records = parseRecordLines(out.lines);
      expect(records).toHaveLength(1);
      expect(records[0].rowId).toBe(CONNECTION_ROW_ID);
      expect(records[0].result).toBe("FAIL");
      expect(records[0].detail).toContain("probe harness error");
      expect(records[0].detail).toContain("Env file not found");
    } finally {
      process.chdir(originalCwd);
      rmSync(emptyDir, { recursive: true, force: true });
    }
  });

  it("--help prints usage and exits 0", async () => {
    const out = captureStdout();
    const exit = await main(["--help"], { db: catalogDb(happyCatalog()), stdout: out.write });
    expect(exit).toBe(0);
    expect(out.lines[0]).toContain("Usage: bun run scripts/launch/probe-decisions.ts");
  });

  it("unknown arguments are usage errors (exit 1, no probe lines emitted)", async () => {
    const out = captureStdout();
    const exit = await main(["--nope"], { db: catalogDb(happyCatalog()), stdout: out.write });
    expect(exit).toBe(1);
    expect(out.lines).toHaveLength(0);
  });

  for (const [label, plant, expectedRowId, detailNeedle] of DRIFT_PLANTS) {
    it(`fails its named row on a planted drift: ${label}`, async () => {
      const catalog = happyCatalog();
      plant(catalog);
      const lines = await probeDecisions(catalogDb(catalog));
      const row = lines.find(line => line.rowId === expectedRowId);
      expect(row?.result).toBe("FAIL");
      expect(row?.detail).toContain(detailNeedle);
      expect(lines.filter(line => line.result === "FAIL").map(line => line.rowId)).toEqual([expectedRowId]);
    });
  }
});
