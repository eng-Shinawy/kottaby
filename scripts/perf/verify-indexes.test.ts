import { describe, expect, it } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import {
  analyzeHotColumnCoverage,
  computeFkColumnCoverage,
  DOCUMENTED_UNCOVERED_FK_COLUMNS,
  type FkColumnRow,
  findCompositeEligibilityIndex,
  groupFkConstraints,
  HOT_COLUMN_TABLE,
  type IndexRow,
  parseIndexDefinition,
} from "@/scripts/perf/lib/index-audit";
import {
  collectRelationScans,
  extractExplainPlan,
  summarizeMatchingPlan,
} from "@/scripts/perf/lib/index-audit-planner";
import {
  buildFkCoverageGate,
  FK_COVERAGE_GATE_ID,
  renderCoverageMarkdownTable,
} from "@/scripts/perf/lib/index-audit-report";
import { createSeededRandom, pickRandom } from "@/scripts/perf/lib/seed-random";
import { isVerifyIndexesCliUsageError, parseVerifyIndexesCli } from "@/scripts/perf/lib/verify-indexes-cli";
import {
  FK_COLUMNS_SQL,
  INDEXES_SQL,
  MATCHING_EXPLAIN_SQL,
  runVerifyIndexesAudit,
  type VerifyIndexesIo,
} from "@/scripts/perf/verify-indexes";

const REPO_ROOT = join(import.meta.dir, "..", "..");
const VERIFY_INDEXES_SCRIPT_PATH = join(REPO_ROOT, "scripts", "perf", "verify-indexes.ts");
const PERF_LOGS_DIR = join(REPO_ROOT, "logs", "perf");
const ENTRY_SOURCE = readFileSync(VERIFY_INDEXES_SCRIPT_PATH, "utf8");

/** Foreign-key column rows for one constraint, ordinals 1..n in declaration order. */
function fkRows(
  constraint: string,
  table: string,
  columns: readonly string[],
  schema = "public"
): readonly FkColumnRow[] {
  return columns.map((column, position) => ({
    constraintName: constraint,
    schemaName: schema,
    tableName: table,
    ordinal: position + 1,
    columnName: column,
  }));
}

/** Builds an `pg_indexes`-shaped row for a plain btree index over the given key parts. */
function indexRow(
  name: string,
  table: string,
  keyParts: readonly string[],
  params: { unique?: boolean; method?: string; schema?: string; where?: string } = {}
): IndexRow {
  const unique = params.unique === true ? "UNIQUE " : "";
  const method = params.method ?? "btree";
  const schema = params.schema ?? "public";
  const where = params.where === undefined ? "" : ` WHERE ${params.where}`;
  return {
    schemaName: schema,
    tableName: table,
    indexName: name,
    indexDefinition: `CREATE ${unique}INDEX ${name} ON ${schema}.${table} USING ${method} (${keyParts.join(", ")})${where}`,
  };
}

/** Builds a `pg_catalog`-shaped EXPLAIN result row wrapping the given plan. */
function explainRows(plan: unknown): unknown {
  return [{ "QUERY PLAN": [{ Plan: plan }] }];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sectionArray(value: unknown): unknown[] {
  if (!Array.isArray(value)) {
    throw new Error("expected a report section array");
  }
  return value;
}

function fieldString(value: unknown): string {
  if (typeof value !== "string") {
    throw new Error("expected a string field");
  }
  return value;
}

/** A fake `VerifyIndexesIo` recording every seam call and written artifact. */
function fakeIo(catalog: { fk?: readonly FkColumnRow[]; indexes?: readonly IndexRow[]; explain?: unknown }): {
  io: VerifyIndexesIo;
  calls: string[];
  artifacts: { fileName: string; contents: string }[];
} {
  const calls: string[] = [];
  const artifacts: { fileName: string; contents: string }[] = [];
  const io: VerifyIndexesIo = {
    env: () => {
      calls.push("env");
      return { databaseUrl: "postgres://user:secret@example.com/kottaby_test" };
    },
    assertTarget: databaseUrl => {
      calls.push(`assertTarget:${databaseUrl}`);
      return { ok: true, dbName: "kottaby_test" };
    },
    listFkColumns: async () => {
      calls.push("listFkColumns");
      return catalog.fk ?? [];
    },
    listIndexes: async () => {
      calls.push("listIndexes");
      return catalog.indexes ?? [];
    },
    explainMatchingQuery: async () => {
      calls.push("explainMatchingQuery");
      return catalog.explain ?? [];
    },
    openRun: () => {
      calls.push("openRun");
      return { runDir: "logs/perf/fake-run", runId: "2026-10-09T00-00-00_verify-indexes" };
    },
    writeReport: (_ctx, _gates, _sections) => {
      calls.push("writeReport");
    },
    writeArtifact: (_runDir, fileName, contents) => {
      calls.push("writeArtifact");
      artifacts.push({ fileName, contents });
    },
    closeDatabase: async () => {
      calls.push("closeDatabase");
    },
  };
  return { io, calls, artifacts };
}

describe("parseVerifyIndexesCli", () => {
  it("defaults to human output with no flags", () => {
    const parsed = parseVerifyIndexesCli([]);
    expect(isVerifyIndexesCliUsageError(parsed)).toBe(false);
    if (!isVerifyIndexesCliUsageError(parsed)) {
      expect(parsed.json).toBe(false);
    }
  });

  it("parses --json and tolerates repeated occurrences and stray values", () => {
    const parsed = parseVerifyIndexesCli(["--json", "stray", "--json"]);
    expect(isVerifyIndexesCliUsageError(parsed)).toBe(false);
    if (!isVerifyIndexesCliUsageError(parsed)) {
      expect(parsed.json).toBe(true);
    }
  });

  it("refuses unknown flags with the accepted list", () => {
    const parsed = parseVerifyIndexesCli(["--json", "--evil-flag", "value"]);
    expect(isVerifyIndexesCliUsageError(parsed)).toBe(true);
    if (isVerifyIndexesCliUsageError(parsed)) {
      expect(parsed.unknownFlags).toEqual(["--evil-flag"]);
      expect(parsed.message).toContain("--evil-flag");
      expect(parsed.message).toContain("--json");
    }
  });

  it("reports each distinct unknown flag once", () => {
    const parsed = parseVerifyIndexesCli(["--a", "--a", "--b"]);
    expect(isVerifyIndexesCliUsageError(parsed)).toBe(true);
    if (isVerifyIndexesCliUsageError(parsed)) {
      expect(parsed.unknownFlags).toEqual(["--a", "--b"]);
    }
  });
});

describe("parseIndexDefinition", () => {
  it("parses a plain single-column btree index", () => {
    const parsed = parseIndexDefinition(indexRow("t_a_idx", "t", ["a"]));
    expect(parsed).not.toBeNull();
    if (parsed) {
      expect(parsed.accessMethod).toBe("btree");
      expect(parsed.elements).toEqual(["a"]);
    }
  });

  it("parses composite indexes preserving declaration order", () => {
    const parsed = parseIndexDefinition(indexRow("t_ab_idx", "t", ["teacher_id", "status"]));
    expect(parsed?.elements).toEqual(["teacher_id", "status"]);
  });

  it("parses unique and primary-key-shaped definitions", () => {
    expect(parseIndexDefinition(indexRow("t_pkey", "t", ["id"], { unique: true }))?.elements).toEqual(["id"]);
  });

  it("parses partial indexes (the WHERE clause stays outside the key list)", () => {
    const parsed = parseIndexDefinition(indexRow("t_active_idx", "t", ["user_id"], { where: "is_read = false" }));
    expect(parsed?.elements).toEqual(["user_id"]);
  });

  it("treats expression key parts as non-column elements", () => {
    const parsed = parseIndexDefinition(indexRow("t_expr_idx", "t", ["(lower(full_name))", "id"]));
    expect(parsed?.elements).toEqual([null, "id"]);
  });

  it("marks an expression-leading index as having no leading column", () => {
    const parsed = parseIndexDefinition(indexRow("t_expr2_idx", "t", ["((col_a || col_b))", "created_at"]));
    expect(parsed?.elements[0]).toBeNull();
    expect(parsed?.elements[1]).toBe("created_at");
  });

  it("parses quoted identifiers, including doubled-quote escapes", () => {
    const parsed = parseIndexDefinition({
      schemaName: "public",
      tableName: "Weird",
      indexName: 'weird_"q"_idx',
      indexDefinition: `CREATE INDEX weird_"q"_idx ON public."Weird" USING btree ("Camel Col", "we""ird")`,
    });
    expect(parsed?.elements).toEqual(["Camel Col", 'we"ird']);
  });

  it("parses ordering, collation, and opclass qualifiers as plain columns", () => {
    const parsed = parseIndexDefinition(
      indexRow("t_qual_idx", "t", [
        "a DESC",
        'b COLLATE pg_catalog."C"',
        "full_name varchar_pattern_ops",
        "c NULLS LAST",
      ])
    );
    expect(parsed?.elements).toEqual(["a", "b", "full_name", "c"]);
  });

  it("captures the access method so non-btree indexes can be excluded", () => {
    const parsed = parseIndexDefinition(indexRow("t_gin_idx", "t", ["payload"], { method: "gin" }));
    expect(parsed?.accessMethod).toBe("gin");
  });

  it("returns null for definitions without a USING clause", () => {
    expect(
      parseIndexDefinition({
        schemaName: "public",
        tableName: "t",
        indexName: "bad",
        indexDefinition: "CREATE INDEX bad ON t (a)",
      })
    ).toBeNull();
  });

  it("returns null for an unbalanced key list", () => {
    expect(
      parseIndexDefinition({
        schemaName: "public",
        tableName: "t",
        indexName: "bad",
        indexDefinition: "CREATE INDEX bad ON t USING btree (a",
      })
    ).toBeNull();
  });

  it("yields no elements for an empty key list", () => {
    const parsed = parseIndexDefinition({
      schemaName: "public",
      tableName: "t",
      indexName: "empty_idx",
      indexDefinition: "CREATE INDEX empty_idx ON t USING btree ()",
    });
    expect(parsed?.elements).toEqual([]);
  });
});

describe("groupFkConstraints", () => {
  it("orders constraint columns by declaration ordinal across shuffled input", () => {
    const grouped = groupFkConstraints([
      ...fkRows("t_fk", "t", ["b"], "public").map(row => Object.assign({}, row, { ordinal: 2 })),
      ...fkRows("t_fk", "t", ["a"], "public").map(row => Object.assign({}, row, { ordinal: 1 })),
    ]);
    expect(grouped).toHaveLength(1);
    expect(grouped[0]?.columns).toEqual(["a", "b"]);
  });

  it("deduplicates repeated (constraint, ordinal) rows", () => {
    const rows = [...fkRows("t_fk", "t", ["a", "b"]), ...fkRows("t_fk", "t", ["a", "b"])];
    const grouped = groupFkConstraints(rows);
    expect(grouped).toHaveLength(1);
    expect(grouped[0]?.columns).toEqual(["a", "b"]);
  });

  it("keeps constraints on the same table apart and tolerates duplicate constraint names on different tables", () => {
    const grouped = groupFkConstraints([...fkRows("same_fk", "t1", ["x"]), ...fkRows("same_fk", "t2", ["y"])]);
    expect(grouped.map(constraint => constraint.tableName)).toEqual(["t1", "t2"]);
  });

  it("returns no constraints for an empty catalog", () => {
    expect(groupFkConstraints([])).toEqual([]);
  });
});

describe("computeFkColumnCoverage (coverage rule)", () => {
  it("covers a column that leads some index", () => {
    const coverage = computeFkColumnCoverage(fkRows("t_a_fkey", "t", ["a"]), [
      indexRow("t_a_idx", "t", ["a"]),
      indexRow("t_ba_idx", "t", ["b", "a"]),
    ]);
    expect(coverage).toHaveLength(1);
    expect(coverage[0]?.covered).toBe(true);
    expect(coverage[0]?.coveringIndexNames).toEqual(["t_a_idx"]);
  });

  it("does not cover a column that only appears in a trailing index position", () => {
    const coverage = computeFkColumnCoverage(fkRows("t_a_fkey", "t", ["a"]), [indexRow("t_ba_idx", "t", ["b", "a"])]);
    expect(coverage[0]?.covered).toBe(false);
  });

  it("covers every column of a composite FK whose columns prefix an index", () => {
    const coverage = computeFkColumnCoverage(fkRows("t_ab_fkey", "t", ["a", "b"]), [
      indexRow("t_abc_idx", "t", ["a", "b", "c"]),
    ]);
    expect(coverage.map(column => column.covered)).toEqual([true, true]);
  });

  it("leaves the second column uncovered when only the first is a leading index", () => {
    const coverage = computeFkColumnCoverage(fkRows("t_ab_fkey", "t", ["a", "b"]), [indexRow("t_a_idx", "t", ["a"])]);
    expect(coverage.map(column => column.covered)).toEqual([true, false]);
  });

  it("counts PK/unique-constraint backing (the composite primary-key shape)", () => {
    const coverage = computeFkColumnCoverage(fkRows("t_a_fkey", "t", ["a"]), [
      indexRow("t_pkey", "t", ["a", "b"], { unique: true }),
    ]);
    expect(coverage[0]?.covered).toBe(true);
    expect(coverage[0]?.coveringIndexNames).toEqual(["t_pkey"]);
  });

  it("counts partial indexes as coverage", () => {
    const coverage = computeFkColumnCoverage(fkRows("t_a_fkey", "t", ["a"]), [
      indexRow("t_a_partial_idx", "t", ["a"], { where: "status = 'active'" }),
    ]);
    expect(coverage[0]?.covered).toBe(true);
  });

  it("ignores non-btree indexes entirely", () => {
    const coverage = computeFkColumnCoverage(fkRows("t_a_fkey", "t", ["a"]), [
      indexRow("t_gin_idx", "t", ["a"], { method: "gin" }),
    ]);
    expect(coverage[0]?.covered).toBe(false);
  });

  it("ignores unparseable index definitions (conservative non-coverage)", () => {
    const coverage = computeFkColumnCoverage(fkRows("t_a_fkey", "t", ["a"]), [
      { schemaName: "public", tableName: "t", indexName: "broken", indexDefinition: "garbage" },
    ]);
    expect(coverage[0]?.covered).toBe(false);
  });

  it("never covers across tables even with matching column names", () => {
    const coverage = computeFkColumnCoverage(fkRows("t2_a_fkey", "t2", ["a"]), [indexRow("t1_a_idx", "t1", ["a"])]);
    expect(coverage[0]?.covered).toBe(false);
  });

  it("passes an empty catalog vacuously (zero columns, zero uncovered)", () => {
    const coverage = computeFkColumnCoverage([], []);
    expect(coverage).toEqual([]);
  });

  it("reports the documented pre-remediation shape: exactly the four historical gaps, everything else covered", () => {
    const coverage = computeFkColumnCoverage(
      [
        ...fkRows("session_request_idempotency_session_id_fkey", "session_request_idempotency", ["session_id"]),
        ...fkRows("session_request_idempotency_user_id_fkey", "session_request_idempotency", ["user_id"]),
        ...fkRows("subscription_purchase_idempotency_subscription_id_fkey", "subscription_purchase_idempotency", [
          "subscription_id",
        ]),
        ...fkRows("subscription_purchase_idempotency_user_id_fkey", "subscription_purchase_idempotency", ["user_id"]),
        ...fkRows("broadcasts_sent_by_id_fkey", "broadcasts", ["sent_by_id"]),
        ...fkRows("broadcasts_stopped_by_id_fkey", "broadcasts", ["stopped_by_id"]),
        ...fkRows("student_subscriptions_student_id_fkey", "student_subscriptions", ["student_id"]),
      ],
      [
        indexRow("session_request_idempotency_pkey", "session_request_idempotency", ["id"], { unique: true }),
        indexRow("session_request_idempotency_user_id_idx", "session_request_idempotency", ["user_id"]),
        indexRow("subscription_purchase_idempotency_pkey", "subscription_purchase_idempotency", ["id"], {
          unique: true,
        }),
        indexRow("subscription_purchase_idempotency_user_id_idx", "subscription_purchase_idempotency", ["user_id"]),
        indexRow("broadcasts_pkey", "broadcasts", ["id"], { unique: true }),
        indexRow("broadcasts_sent_at_idx", "broadcasts", ["sent_at"]),
        indexRow("student_subscriptions_pkey", "student_subscriptions", ["student_id", "subscription_id"], {
          unique: true,
        }),
      ]
    );
    const uncovered = coverage
      .filter(column => !column.covered)
      .map(column => `${column.tableName}.${column.columnName}`);
    expect(uncovered).toEqual([
      "broadcasts.sent_by_id",
      "broadcasts.stopped_by_id",
      "session_request_idempotency.session_id",
      "subscription_purchase_idempotency.subscription_id",
    ]);
    expect(uncovered.toSorted((a, b) => a.localeCompare(b))).toEqual(
      [...DOCUMENTED_UNCOVERED_FK_COLUMNS].toSorted((a, b) => a.localeCompare(b))
    );
  });
});

describe("hot-column analysis", () => {
  it("reports no leading indexes for every driving column when the table has none", () => {
    const report = analyzeHotColumnCoverage([indexRow("users_email_unique", "users", ["email"], { unique: true })]);
    expect(report).toHaveLength(3);
    for (const column of report) {
      expect(column.table).toBe(HOT_COLUMN_TABLE);
      expect(column.leadingIndexNames).toEqual([]);
    }
    expect(findCompositeEligibilityIndex([indexRow("users_email_unique", "users", ["email"])])).toBeNull();
  });

  it("detects the composite eligibility shape and a leading rating index", () => {
    const indexes = [
      indexRow("teacher_matching_idx", "teacher", ["is_online", "is_approved"]),
      indexRow("teacher_rating_idx", "teacher", ["average_rating"]),
    ];
    const report = analyzeHotColumnCoverage(indexes);
    const byColumn = new Map(report.map(column => [column.column, column.leadingIndexNames]));
    expect(byColumn.get("is_online")).toEqual(["teacher_matching_idx"]);
    expect(byColumn.get("is_approved")).toEqual([]);
    expect(byColumn.get("average_rating")).toEqual(["teacher_rating_idx"]);
    expect(findCompositeEligibilityIndex(indexes)).toBe("teacher_matching_idx");
  });

  it("ignores non-leading hot-column appearances and non-btree methods", () => {
    const report = analyzeHotColumnCoverage([
      indexRow("teacher_trailing_idx", "teacher", ["id", "is_online"]),
      indexRow("teacher_gin_idx", "teacher", ["is_approved"], { method: "gin" }),
    ]);
    expect(report.every(column => column.leadingIndexNames.length === 0)).toBe(true);
  });
});

describe("EXPLAIN plan parsing", () => {
  it("extracts the root plan from the queryDb row shape", () => {
    const root = extractExplainPlan(
      explainRows({
        "Node Type": "Sort",
        "Relation Name": null,
        Plans: [{ "Node Type": "Seq Scan", "Relation Name": "teacher", "Index Name": null }],
      })
    );
    if (root === null) {
      throw new Error("plan should parse");
    }
    expect(root.nodeType).toBe("Sort");
    expect(collectRelationScans(root)).toEqual([{ nodeType: "Seq Scan", relationName: "teacher", indexName: null }]);
  });

  it("walks nested subplans (the NOT EXISTS shape) depth-first", () => {
    const root = extractExplainPlan(
      explainRows({
        "Node Type": "Limit",
        Plans: [
          {
            "Node Type": "Index Scan",
            "Relation Name": "teacher",
            "Index Name": "teacher_matching_idx",
            Plans: [
              {
                "Node Type": "Index Only Scan",
                "Relation Name": "session",
                "Index Name": "session_teacher_id_status_idx",
              },
            ],
          },
        ],
      })
    );
    const summary = summarizeMatchingPlan(root);
    expect(summary.scans.map(scan => scan.relationName)).toEqual(["teacher", "session"]);
    expect(summary.teacherScan?.indexName).toBe("teacher_matching_idx");
    expect(summary.sessionScan?.indexName).toBe("session_teacher_id_status_idx");
  });

  it("reports a seq scan with no index honestly", () => {
    const root = extractExplainPlan(explainRows({ "Node Type": "Seq Scan", "Relation Name": "teacher" }));
    expect(summarizeMatchingPlan(root).teacherScan).toEqual({
      nodeType: "Seq Scan",
      relationName: "teacher",
      indexName: null,
    });
  });

  it("tolerates malformed shapes without crashing (report, not throw)", () => {
    expect(extractExplainPlan(null)).toBeNull();
    expect(extractExplainPlan([])).toBeNull();
    expect(extractExplainPlan([{}])).toBeNull();
    expect(extractExplainPlan([{ "QUERY PLAN": [] }])).toBeNull();
    expect(extractExplainPlan([{ "QUERY PLAN": [{}] }])).toBeNull();
    expect(extractExplainPlan([{ "QUERY PLAN": [{ Plan: "not a node" }] }])).toBeNull();
    expect(extractExplainPlan([{ "QUERY PLAN": [{ Plan: { "Node Type": 7 } }] }])).toBeNull();
    expect(extractExplainPlan([{ "QUERY PLAN": [{ Plan: { Plans: "nope" } }] }])).toBeNull();
  });

  it("summarizes an unreadable plan as an empty scan list", () => {
    const summary = summarizeMatchingPlan(extractExplainPlan("garbage"));
    expect(summary.scans).toEqual([]);
    expect(summary.teacherScan).toBeNull();
    expect(summary.sessionScan).toBeNull();
  });
});

describe("gate + report assembly", () => {
  const coveredCatalog = computeFkColumnCoverage(fkRows("t_a_fkey", "t", ["a"]), [indexRow("t_a_idx", "t", ["a"])]);

  it("passes the gate on zero uncovered columns", () => {
    const gate = buildFkCoverageGate(coveredCatalog);
    expect(gate.id).toBe(FK_COVERAGE_GATE_ID);
    expect(gate.passed).toBe(true);
    expect(gate.breaches).toEqual([]);
  });

  it("fails the gate listing every uncovered column as a breach", () => {
    const gate = buildFkCoverageGate(computeFkColumnCoverage(fkRows("t_a_fkey", "t", ["a"]), []));
    expect(gate.passed).toBe(false);
    expect(gate.breaches).toEqual(["public.t.a (t_a_fkey)"]);
  });

  it("renders the full covered/uncovered Markdown table", () => {
    const table = renderCoverageMarkdownTable([
      ...coveredCatalog,
      ...computeFkColumnCoverage(fkRows("t_b_fkey", "t", ["b"]), []),
    ]);
    expect(table).toContain("| Schema | Table | Constraint | Column | Covered | Covering indexes |");
    expect(table).toContain("| public | t | t_a_fkey | a | yes | t_a_idx |");
    expect(table).toContain("| public | t | t_b_fkey | b | NO | — |");
  });

  it("escapes pipe characters from quoted identifiers in table cells", () => {
    const table = renderCoverageMarkdownTable(computeFkColumnCoverage(fkRows("weird_fk", "we|ird", ["a"]), []));
    expect(table).toContain("we\\|ird");
  });
});

describe("runVerifyIndexesAudit (fake io orchestration)", () => {
  function sectionRecord(value: unknown): Record<string, unknown> {
    if (!isRecord(value)) {
      throw new Error("expected a report section object");
    }
    return value;
  }

  function fkCoverageSection(sections: Record<string, unknown>): {
    uncovered: { table: string; column: string; constraint: string }[];
  } {
    const section = sectionRecord(sections.fkCoverage);
    return {
      uncovered: sectionArray(section.uncovered).map(entry => {
        const record = sectionRecord(entry);
        return {
          table: fieldString(record.table),
          column: fieldString(record.column),
          constraint: fieldString(record.constraint),
        };
      }),
    };
  }

  function baselineSection(sections: Record<string, unknown>): {
    observedMatchesBaseline: boolean;
    uncoveredFkColumns: string[];
  } {
    const section = sectionRecord(sections.documentedBaseline);
    const matches = section.observedMatchesBaseline;
    if (typeof matches !== "boolean") {
      throw new Error("expected a boolean observedMatchesBaseline");
    }
    return {
      observedMatchesBaseline: matches,
      uncoveredFkColumns: sectionArray(section.uncoveredFkColumns).map(fieldString),
    };
  }

  function hotColumnsSection(sections: Record<string, unknown>): {
    columns: { column: string; leadingIndexNames: string[] }[];
    plannerChoice: { relation: string; nodeType: string; indexName: string | null }[];
  } {
    const section = sectionRecord(sections.hotColumns);
    const columns = sectionArray(section.columns).map(entry => {
      const record = sectionRecord(entry);
      return {
        column: fieldString(record.column),
        leadingIndexNames: sectionArray(record.leadingIndexNames).map(fieldString),
      };
    });
    const plannerChoice = sectionArray(section.plannerChoice).map(entry => {
      const record = sectionRecord(entry);
      return {
        relation: fieldString(record.relation),
        nodeType: fieldString(record.nodeType),
        indexName: typeof record.indexName === "string" ? record.indexName : null,
      };
    });
    return { columns, plannerChoice };
  }

  const coveredCatalog = {
    fk: fkRows("t_a_fkey", "t", ["a"]),
    indexes: [indexRow("t_a_idx", "t", ["a"])],
  };

  it("audits a fully covered catalog to a passing outcome, writing report and artifact", async () => {
    const { io, calls, artifacts } = fakeIo(coveredCatalog);
    const outcome = await runVerifyIndexesAudit({ json: false }, io);
    expect(outcome.passed).toBe(true);
    expect(outcome.runId).toBe("2026-10-09T00-00-00_verify-indexes");
    expect(outcome.gates[0]?.passed).toBe(true);
    expect(calls).toEqual([
      "env",
      "assertTarget:postgres://user:secret@example.com/kottaby_test",
      "listFkColumns",
      "listIndexes",
      "explainMatchingQuery",
      "openRun",
      "writeReport",
      "writeArtifact",
      "closeDatabase",
    ]);
    expect(artifacts).toHaveLength(1);
    expect(artifacts[0]?.fileName).toBe("fk-coverage.md");
    expect(artifacts[0]?.contents).toContain("t_a_fkey");
  });

  it("fails the outcome and the gate when an FK column is uncovered", async () => {
    const { io } = fakeIo({
      fk: fkRows("t_b_fkey", "t", ["b"]),
      indexes: [indexRow("t_a_idx", "t", ["a"])],
    });
    const outcome = await runVerifyIndexesAudit({ json: true }, io);
    expect(outcome.passed).toBe(false);
    expect(outcome.gates[0]?.passed).toBe(false);
    expect(outcome.gates[0]?.breaches).toContain("public.t.b (t_b_fkey)");
    expect(fkCoverageSection(outcome.sections).uncovered).toEqual([
      { table: "t", column: "b", constraint: "t_b_fkey" },
    ]);
  });

  it("marks the observed gap set against the documented baseline", async () => {
    const fourGapFk = [
      ...fkRows("f1", "session_request_idempotency", ["session_id"]),
      ...fkRows("f2", "subscription_purchase_idempotency", ["subscription_id"]),
      ...fkRows("f3", "broadcasts", ["sent_by_id"]),
      ...fkRows("f4", "broadcasts", ["stopped_by_id"]),
    ];
    const { io } = fakeIo({ fk: fourGapFk, indexes: [] });
    const outcome = await runVerifyIndexesAudit({ json: false }, io);
    const baseline = baselineSection(outcome.sections);
    expect(baseline.observedMatchesBaseline).toBe(true);
    expect(baseline.uncoveredFkColumns).toEqual([...DOCUMENTED_UNCOVERED_FK_COLUMNS]);
    const drifted = await runVerifyIndexesAudit(
      { json: false },
      fakeIo({ fk: fkRows("novel_fk", "novel_table", ["x"]), indexes: [] }).io
    );
    expect(baselineSection(drifted.sections).observedMatchesBaseline).toBe(false);
  });

  it("reports the planner choice and hot columns in the evidence sections", async () => {
    const { io } = fakeIo({
      ...coveredCatalog,
      explain: [{ "QUERY PLAN": [{ Plan: { "Node Type": "Seq Scan", "Relation Name": "teacher" } }] }],
    });
    const outcome = await runVerifyIndexesAudit({ json: false }, io);
    const hot = hotColumnsSection(outcome.sections);
    expect(hot.columns.map(column => column.column)).toEqual(["is_online", "is_approved", "average_rating"]);
    expect(hot.plannerChoice).toEqual([{ relation: "teacher", nodeType: "Seq Scan", indexName: null }]);
    expect(
      outcome.summaryLines.some(line => line.includes("matching plan scans") && line.includes("teacher: Seq Scan"))
    ).toBe(true);
  });

  it("never reaches any catalog seam or report write when the guard refuses", async () => {
    const calls: string[] = [];
    const io: VerifyIndexesIo = {
      env: () => ({ databaseUrl: "postgres://user:secret@example.com/kottaby" }),
      assertTarget: () => {
        calls.push("assertTarget");
        throw new Error("guard refused");
      },
      listFkColumns: async () => {
        calls.push("listFkColumns");
        return [];
      },
      listIndexes: async () => {
        calls.push("listIndexes");
        return [];
      },
      explainMatchingQuery: async () => {
        calls.push("explainMatchingQuery");
        return [];
      },
      openRun: () => {
        calls.push("openRun");
        return { runDir: "logs/perf/fake-run", runId: "x" };
      },
      writeReport: () => {
        calls.push("writeReport");
      },
      writeArtifact: () => {
        calls.push("writeArtifact");
      },
      closeDatabase: async () => {
        calls.push("closeDatabase");
      },
    };
    let errorCaught: unknown = null;
    try {
      await runVerifyIndexesAudit({ json: false }, io);
    } catch (error) {
      errorCaught = error;
    }
    expect(errorCaught).not.toBeNull();
    expect(calls).toEqual(["assertTarget"]);
  });

  it("closes the database connection even when a catalog read fails mid-run", async () => {
    const calls: string[] = [];
    const io: VerifyIndexesIo = {
      env: () => ({ databaseUrl: "postgres://user@localhost/kottaby_test" }),
      assertTarget: () => ({ ok: true, dbName: "kottaby_test" }),
      listFkColumns: async () => {
        calls.push("listFkColumns");
        throw new Error("catalog unavailable");
      },
      listIndexes: async () => {
        calls.push("listIndexes");
        return [];
      },
      explainMatchingQuery: async () => {
        calls.push("explainMatchingQuery");
        return [];
      },
      openRun: () => ({ runDir: "logs/perf/fake-run", runId: "x" }),
      writeReport: () => {
        calls.push("writeReport");
      },
      writeArtifact: () => {
        calls.push("writeArtifact");
      },
      closeDatabase: async () => {
        calls.push("closeDatabase");
      },
    };
    let errorCaught: unknown = null;
    try {
      await runVerifyIndexesAudit({ json: false }, io);
    } catch (error) {
      errorCaught = error;
    }
    expect(errorCaught).not.toBeNull();
    expect(calls).toEqual(["listFkColumns", "listIndexes", "explainMatchingQuery", "closeDatabase"]);
  });
});

describe("audit robustness (seeded fuzz over synthetic catalogs)", () => {
  const random = createSeededRandom("verify-indexes:fuzz");
  const columnPool = [
    "id",
    "user_id",
    "session_id",
    "teacher_id",
    "status",
    "Camel Col",
    'we"ird',
    "col_a",
    "col_b",
    "x",
  ];
  const qualifierPool = ["", " DESC", " ASC", ' COLLATE pg_catalog."C"', " varchar_pattern_ops", " NULLS LAST"];

  it("never throws on fuzzed catalog shapes and keeps covered columns pointing at real indexes", () => {
    for (let trial = 0; trial < 40; trial += 1) {
      const table = `t${trial}`;
      const columns = ["id", "a", "b"].slice(0, 1 + Math.floor(random() * 3));
      const fk = fkRows(`t${trial}_fkey`, table, columns);
      const part = pickRandom(random, columnPool);
      const qualifier = pickRandom(random, qualifierPool);
      const indexes = [
        indexRow(`t${trial}_idx`, table, [`${part}${qualifier}`, "(lower(x))"]),
        {
          schemaName: "public",
          tableName: table,
          indexName: `t${trial}_broken`,
          indexDefinition: "not an index at all",
        },
      ];
      const coverage = computeFkColumnCoverage(fk, indexes);
      for (const column of coverage) {
        if (column.covered) {
          expect(column.coveringIndexNames.length).toBeGreaterThan(0);
          expect(column.coveringIndexNames).toEqual([`t${trial}_idx`]);
        }
        expect(columns).toContain(column.columnName);
      }
    }
  });
});

describe("audit security posture (Tier 4)", () => {
  interface ProcessResult {
    exitCode: number | null;
    stdout: string;
    stderr: string;
  }

  function runScriptProcess(args: readonly string[], env: Record<string, string>): ProcessResult {
    const proc = Bun.spawnSync({
      cmd: [process.execPath, VERIFY_INDEXES_SCRIPT_PATH, ...args],
      cwd: REPO_ROOT,
      env: { ...process.env, ...env },
      stdout: "pipe",
      stderr: "pipe",
    });
    const decoder = new TextDecoder();
    return {
      exitCode: proc.exitCode,
      stdout: decoder.decode(proc.stdout),
      stderr: decoder.decode(proc.stderr),
    };
  }

  function perfRunDirCount(): number {
    return existsSync(PERF_LOGS_DIR) ? readdirSync(PERF_LOGS_DIR).length : 0;
  }

  it("refuses a non-test database target in a real subprocess before any client or run directory exists", () => {
    const before = perfRunDirCount();
    const dsn = "postgres://perf_probe:hunter2@127.0.0.1:5432/kottaby";
    const result = runScriptProcess([], { DATABASE_URL: dsn });
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("kottaby");
    expect(result.stderr).toContain("guard refused");
    const output = `${result.stdout}${result.stderr}`;
    expect(output).not.toContain(dsn);
    expect(output).not.toContain("postgres://");
    expect(output).not.toContain("hunter2");
    expect(perfRunDirCount()).toBe(before);
  });

  it("refuses unknown flags with the accepted list before touching the guard or the database", () => {
    const result = runScriptProcess(["--bogus"], { DATABASE_URL: "postgres://u@127.0.0.1:5432/kottaby_test" });
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("--bogus");
    expect(result.stderr).toContain("--json");
    expect(result.stderr).not.toContain("guard refused");
  });

  it("never statically imports the database client module (guard-first client construction)", () => {
    const staticImportLines = ENTRY_SOURCE.split("\n").filter(
      line => /^import\b/.test(line) && line.includes("@/backend/db/client")
    );
    expect(staticImportLines).toEqual([]);
    expect(ENTRY_SOURCE).toContain('await import("@/backend/db/client")');
  });

  it("keeps every catalog SQL statement static and parameterized (no interpolation seam)", () => {
    for (const sql of [FK_COLUMNS_SQL, INDEXES_SQL, MATCHING_EXPLAIN_SQL]) {
      expect(sql).not.toContain("${");
      expect(sql).toContain("$1");
    }
  });
});
