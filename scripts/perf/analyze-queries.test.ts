import { describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { Client } from "pg";
import {
  AnalyzeQueriesError,
  type AnalyzeQueriesIo,
  EXPLAIN_PREFIX,
  runAnalyzeQueries,
  writeExplainArtifactFile,
} from "@/scripts/perf/analyze-queries";
import {
  DEFAULT_SCAN_THRESHOLD_ROWS,
  isAnalyzeQueriesCliUsageError,
  MAX_SCAN_THRESHOLD_ROWS,
  parseAnalyzeQueriesCli,
} from "@/scripts/perf/lib/analyze-queries-cli";
import {
  buildAnalyzeSections,
  buildAnalyzeSummaryLines,
  buildMatchingSessionIndexGate,
  buildScanGate,
  type EntryRecord,
  MATCHING_SESSION_INDEX_GATE_ID,
  renderExplainArtifact,
  SCAN_GATE_ID,
} from "@/scripts/perf/lib/analyze-report";
import {
  analyzeExplainRows,
  EXPECTED_MATCHING_SESSION_INDEX,
  isSeqScanNodeType,
  seqScanBreachesThreshold,
} from "@/scripts/perf/lib/explain-scan";
import { captureQueryStatements, type PgQueryBase, QueryCaptureError } from "@/scripts/perf/lib/query-capture";
import {
  assertValidRegistryIds,
  CANONICAL_QUERY_REGISTRY,
  QueryRegistryError,
  REGISTRY_ID_PATTERN,
  type RegistryEntry,
} from "@/scripts/perf/lib/query-registry";
import { createSeededRandom } from "@/scripts/perf/lib/seed-random";

const REPO_ROOT = join(import.meta.dir, "..", "..");
const ANALYZE_SCRIPT_PATH = join(REPO_ROOT, "scripts", "perf", "analyze-queries.ts");
const PERF_LOGS_DIR = join(REPO_ROOT, "logs", "perf");
const SOURCE_FILES: readonly { readonly label: string; readonly path: string }[] = [
  { label: "entrypoint", path: ANALYZE_SCRIPT_PATH },
  { label: "registry", path: join(REPO_ROOT, "scripts", "perf", "lib", "query-registry.ts") },
  { label: "capture", path: join(REPO_ROOT, "scripts", "perf", "lib", "query-capture.ts") },
  { label: "explain-scan", path: join(REPO_ROOT, "scripts", "perf", "lib", "explain-scan.ts") },
  { label: "report", path: join(REPO_ROOT, "scripts", "perf", "lib", "analyze-report.ts") },
  { label: "cli", path: join(REPO_ROOT, "scripts", "perf", "lib", "analyze-queries-cli.ts") },
];

/** Wraps a plan node into the row shape a queryDb EXPLAIN read returns. */
function explainRowsOf(node: unknown): unknown {
  return [{ "QUERY PLAN": [{ Plan: node }] }];
}

function seqScanNode(relation: string, rows: number, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { "Node Type": "Seq Scan", "Relation Name": relation, "Plan Rows": rows, "Total Cost": 12.5, ...extra };
}

function indexScanNode(nodeType: string, relation: string, indexName: string, rows: number): Record<string, unknown> {
  return {
    "Node Type": nodeType,
    "Relation Name": relation,
    "Index Name": indexName,
    "Plan Rows": rows,
    "Total Cost": 4.2,
  };
}

function fakeBase(): { base: PgQueryBase; received: { thisArg: unknown; args: unknown[][] } } {
  const received: { thisArg: unknown; args: unknown[][] } = { thisArg: undefined, args: [] };
  const base: PgQueryBase = function fakePgQuery(this: unknown, ...args: unknown[]): unknown {
    received.thisArg = this;
    received.args.push(args);
    return Promise.resolve({ rows: [] });
  };
  return { base, received };
}

function withTempRunDir(test: (runDir: string) => void): void {
  mkdirSync(PERF_LOGS_DIR, { recursive: true, mode: 0o700 });
  const runDir = mkdtempSync(join(PERF_LOGS_DIR, "aq-artifact-test-"));
  try {
    test(runDir);
  } finally {
    rmSync(runDir, { recursive: true, force: true });
  }
}

/** Narrows unknown section/payload members to a record (typed guard, no assertions). */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function recordOf(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new Error("expected a record-shaped report member");
  }
  return value;
}

/** The matching-shaped plan fixture: a join tree whose NOT EXISTS subplan rides the expected index. */
function matchingPlanFixture(teacherRows: number, usersRows: number): Record<string, unknown> {
  return {
    "Node Type": "Limit",
    "Total Cost": 100,
    Plans: [
      {
        "Node Type": "Sort",
        Plans: [
          {
            "Node Type": "Hash Join",
            Plans: [
              seqScanNode("teacher", teacherRows),
              seqScanNode("users", usersRows),
              indexScanNode("Index Only Scan", "session", "session_teacher_id_status_idx", 42),
            ],
          },
        ],
      },
    ],
  };
}

async function captureErrorOf(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (error) {
    return error instanceof Error ? error : new Error(String(error));
  }
  throw new Error("expected the promise to reject");
}

// ---------------------------------------------------------------------------
// CLI contract
// ---------------------------------------------------------------------------

describe("parseAnalyzeQueriesCli", () => {
  it("defaults the scan threshold to the documented value", () => {
    const parsed = parseAnalyzeQueriesCli([]);
    expect(isAnalyzeQueriesCliUsageError(parsed)).toBe(false);
    if (!isAnalyzeQueriesCliUsageError(parsed)) {
      expect(parsed.scanThresholdRows).toBe(DEFAULT_SCAN_THRESHOLD_ROWS);
      expect(DEFAULT_SCAN_THRESHOLD_ROWS).toBe(1000);
    }
  });

  it("parses a provided threshold and lets a repeated flag win last", () => {
    const parsed = parseAnalyzeQueriesCli(["--scan-threshold-rows", "250", "--scan-threshold-rows", "5000"]);
    expect(isAnalyzeQueriesCliUsageError(parsed)).toBe(false);
    if (!isAnalyzeQueriesCliUsageError(parsed)) {
      expect(parsed.scanThresholdRows).toBe(5000);
    }
  });

  it("accepts the threshold at its upper bound and refuses anything above it", () => {
    const atBound = parseAnalyzeQueriesCli(["--scan-threshold-rows", String(MAX_SCAN_THRESHOLD_ROWS)]);
    expect(isAnalyzeQueriesCliUsageError(atBound)).toBe(false);
    const aboveBound = parseAnalyzeQueriesCli(["--scan-threshold-rows", String(MAX_SCAN_THRESHOLD_ROWS + 1)]);
    expect(isAnalyzeQueriesCliUsageError(aboveBound)).toBe(true);
  });

  it("refuses a missing flag value, including when the next token is another flag", () => {
    for (const argv of [["--scan-threshold-rows"], ["--scan-threshold-rows", "--other"]] as const) {
      const parsed = parseAnalyzeQueriesCli([...argv]);
      expect(isAnalyzeQueriesCliUsageError(parsed)).toBe(true);
      if (isAnalyzeQueriesCliUsageError(parsed)) {
        expect(parsed.message).toContain("requires a value");
      }
    }
  });

  it("refuses non-integer and non-positive threshold values", () => {
    for (const raw of ["12.5", "abc", "-3", "0", ""]) {
      const parsed = parseAnalyzeQueriesCli(["--scan-threshold-rows", raw]);
      expect(isAnalyzeQueriesCliUsageError(parsed)).toBe(true);
    }
  });

  it("refuses unknown flags, listing the accepted flags and reporting each distinct flag once", () => {
    const parsed = parseAnalyzeQueriesCli(["--bogus", "stray-value", "--bogus"]);
    expect(isAnalyzeQueriesCliUsageError(parsed)).toBe(true);
    if (!isAnalyzeQueriesCliUsageError(parsed)) {
      throw new Error("expected a usage refusal");
    }
    expect(parsed.message).toContain("--bogus");
    expect(parsed.message).toContain("--scan-threshold-rows");
    expect(parsed.message.match(/--bogus/g)?.length).toBe(1);
    expect(parsed.unknownFlags).toEqual(["--bogus"]);
  });

  it("treats a bare `--` token as an unknown flag", () => {
    expect(isAnalyzeQueriesCliUsageError(parseAnalyzeQueriesCli(["--"]))).toBe(true);
  });

  it("ignores stray non-flag tokens that are not flag values", () => {
    const parsed = parseAnalyzeQueriesCli(["leftover", "--scan-threshold-rows", "7", "another"]);
    expect(isAnalyzeQueriesCliUsageError(parsed)).toBe(false);
    if (!isAnalyzeQueriesCliUsageError(parsed)) {
      expect(parsed.scanThresholdRows).toBe(7);
    }
  });
});

// ---------------------------------------------------------------------------
// Canonical query registry
// ---------------------------------------------------------------------------

/** A minimal registry entry for validation probes (module scope — no closure capture). */
function registryEntryOf(id: string): RegistryEntry {
  return {
    id,
    minVolumeNote: "note",
    requiresSessionIndexCheck: false,
    run: async () => [],
  };
}

describe("CANONICAL_QUERY_REGISTRY", () => {
  const ids = CANONICAL_QUERY_REGISTRY.map(entry => entry.id);
  const matchingIds = ids.filter(id => id.startsWith("matching-"));

  it("registers every id exactly once, file-name safe", () => {
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) {
      expect(REGISTRY_ID_PATTERN.test(id)).toBe(true);
    }
  });

  it("covers every matching sort x filter variant plus the named list and context reads", () => {
    const expectedMatching = [
      "matching-rating-desc-plain",
      "matching-rating-desc-subject-language",
      "matching-rating-desc-name-search",
      "matching-rating-desc-min-rating",
      "matching-name-asc-plain",
      "matching-name-asc-subject-language",
      "matching-name-asc-name-search",
      "matching-name-asc-min-rating",
      "matching-newest-plain",
      "matching-newest-subject-language",
      "matching-newest-name-search",
      "matching-newest-min-rating",
    ];
    expect(matchingIds).toHaveLength(expectedMatching.length);
    for (const id of expectedMatching) {
      expect(matchingIds.includes(id)).toBe(true);
    }
    for (const id of [
      "my-subscriptions",
      "admin-student-subscriptions",
      "notifications-list",
      "sessions-student-list",
      "sessions-teacher-list",
      "user-find-by-id",
    ]) {
      expect(ids.includes(id)).toBe(true);
    }
  });

  it("scopes the NOT EXISTS index check to the matching entries only", () => {
    for (const entry of CANONICAL_QUERY_REGISTRY) {
      expect(entry.requiresSessionIndexCheck).toBe(entry.id.startsWith("matching-"));
    }
  });

  it("gives every entry a volume note and a capture runner", () => {
    for (const entry of CANONICAL_QUERY_REGISTRY) {
      expect(entry.minVolumeNote.length).toBeGreaterThan(0);
      expect(typeof entry.run).toBe("function");
    }
  });

  it("rejects duplicate and unsafe ids when validating a registry", () => {
    expect(() => assertValidRegistryIds([registryEntryOf("ok-entry")])).not.toThrow();
    let duplicateThrown: unknown = null;
    try {
      assertValidRegistryIds([registryEntryOf("ok-entry"), registryEntryOf("ok-entry")]);
    } catch (error) {
      duplicateThrown = error;
    }
    expect(duplicateThrown).toBeInstanceOf(QueryRegistryError);
    let unsafeThrown: unknown = null;
    try {
      assertValidRegistryIds([registryEntryOf("../escape")]);
    } catch (error) {
      unsafeThrown = error;
    }
    expect(unsafeThrown).toBeInstanceOf(QueryRegistryError);
  });
});

// ---------------------------------------------------------------------------
// Capture seam (injected base — no database, no network)
// ---------------------------------------------------------------------------

describe("captureQueryStatements", () => {
  const realDescriptor = Object.getOwnPropertyDescriptor(Client.prototype, "query");

  it("captures the plain string + values form with its bound parameters", async () => {
    const { base } = fakeBase();
    const statements = await captureQueryStatements(
      async () => {
        const client = new Client();
        await client.query("SELECT id FROM users WHERE id = $1", [7]);
      },
      { baseQuery: base }
    );
    expect(statements).toHaveLength(1);
    expect(statements[0]?.sql).toBe("SELECT id FROM users WHERE id = $1");
    expect(statements[0]?.params).toEqual([7]);
  });

  it("captures the config-object form (text + values inside the config)", async () => {
    const { base } = fakeBase();
    const statements = await captureQueryStatements(
      async () => {
        const client = new Client();
        await client.query({ text: "SELECT 1", values: [1, 2] });
      },
      { baseQuery: base }
    );
    expect(statements[0]?.sql).toBe("SELECT 1");
    expect(statements[0]?.params).toEqual([1, 2]);
  });

  it("captures the submittable-query form and defaults missing values to an empty list", async () => {
    const { base } = fakeBase();
    const statements = await captureQueryStatements(
      async () => {
        const client = new Client();
        await client.query({ text: "SELECT 2", values: [5] });
        client.query({ submit: () => undefined, text: "SELECT 3" });
      },
      { baseQuery: base }
    );
    expect(statements).toHaveLength(2);
    expect(statements[0]?.params).toEqual([5]);
    expect(statements[1]?.params).toEqual([]);
  });

  it("records statements in invocation order, including a concurrent burst", async () => {
    const { base } = fakeBase();
    const statements = await captureQueryStatements(
      async () => {
        const client = new Client();
        const first = client.query("SELECT 10");
        const second = client.query("SELECT 20");
        const third = client.query("SELECT 30");
        await Promise.all([first, second, third]);
      },
      { baseQuery: base }
    );
    expect(statements.map(statement => statement.sql)).toEqual(["SELECT 10", "SELECT 20", "SELECT 30"]);
  });

  it("delegates to the base with the original arguments and receiver", async () => {
    const { base, received } = fakeBase();
    await captureQueryStatements(
      async () => {
        const client = new Client();
        await client.query("SELECT 40", [9]);
      },
      { baseQuery: base }
    );
    expect(received.args).toHaveLength(1);
    expect(received.args[0]).toEqual(["SELECT 40", [9]]);
    expect(received.thisArg).toBeInstanceOf(Client);
  });

  it("fails loudly when a query carries no extractable SQL text", async () => {
    const { base } = fakeBase();
    const error = await captureErrorOf(
      captureQueryStatements(
        async () => {
          const method: unknown = new Client().query;
          if (typeof method !== "function") {
            throw new Error("client query method is unexpectedly missing");
          }
          await Reflect.apply(method, undefined, [42]);
        },
        { baseQuery: base }
      )
    );
    expect(error).toBeInstanceOf(QueryCaptureError);
    expect(Object.getOwnPropertyDescriptor(Client.prototype, "query")).toEqual(realDescriptor);
  });

  it("propagates an invocation failure, restores the prototype, and frees the window", async () => {
    const { base } = fakeBase();
    const failure = new Error("repository read failed");
    const error = await captureErrorOf(
      captureQueryStatements(
        async () => {
          throw failure;
        },
        { baseQuery: base }
      )
    );
    expect(error).toBe(failure);
    expect(Object.getOwnPropertyDescriptor(Client.prototype, "query")).toEqual(realDescriptor);
    const second = await captureQueryStatements(async () => [], { baseQuery: base });
    expect(second).toEqual([]);
  });

  it("refuses a second concurrent window (single-owner discipline)", async () => {
    const { base } = fakeBase();
    const releaseFirst: { current: () => void } = { current: () => {} };
    const first = captureQueryStatements(
      () =>
        new Promise<void>(resolve => {
          releaseFirst.current = resolve;
        }),
      { baseQuery: base }
    );
    const secondError = await captureErrorOf(captureQueryStatements(async () => [], { baseQuery: base }));
    expect(secondError).toBeInstanceOf(QueryCaptureError);
    releaseFirst.current();
    expect(await first).toEqual([]);
    expect(Object.getOwnPropertyDescriptor(Client.prototype, "query")).toEqual(realDescriptor);
  });
});

// ---------------------------------------------------------------------------
// Pure plan walking + threshold facts
// ---------------------------------------------------------------------------

describe("analyzeExplainRows", () => {
  it("walks nested join trees depth-first and collects every Seq Scan with its estimate", () => {
    const analysis = analyzeExplainRows(explainRowsOf(matchingPlanFixture(2000, 2100)));
    expect(analysis.readable).toBe(true);
    expect(analysis.rootNodeType).toBe("Limit");
    expect(analysis.totalCost).toBe(100);
    expect(analysis.seqScans).toEqual([
      { relationName: "teacher", estimatedRows: 2000 },
      { relationName: "users", estimatedRows: 2100 },
    ]);
  });

  it("never classifies index-backed, CTE, or gather nodes as Seq Scans", () => {
    const analysis = analyzeExplainRows(
      explainRowsOf({
        "Node Type": "Gather",
        Plans: [
          indexScanNode("Index Scan", "users", "users_pkey", 1),
          indexScanNode("Index Only Scan", "session", "session_teacher_id_status_idx", 40),
          { "Node Type": "CTE Scan", "Relation Name": null, Plans: [] },
        ],
      })
    );
    expect(analysis.seqScans).toEqual([]);
    expect(analysis.parseNotes).toEqual([]);
  });

  it("walks into CTE subplans and flags the materialized Seq Scan behind a CTE Scan", () => {
    const analysis = analyzeExplainRows(
      explainRowsOf({
        "Node Type": "CTE Scan",
        Plans: [{ "Node Type": "Subquery Scan", Plans: [seqScanNode("big", 5000)] }],
      })
    );
    expect(analysis.seqScans).toEqual([{ relationName: "big", estimatedRows: 5000 }]);
  });

  it("reports the first access path scanning the session relation", () => {
    const analysis = analyzeExplainRows(explainRowsOf(matchingPlanFixture(100, 100)));
    expect(analysis.sessionScan).toEqual({
      nodeType: "Index Only Scan",
      indexName: EXPECTED_MATCHING_SESSION_INDEX,
    });
  });

  it("classifies the parallel seq scan variant as a full scan too", () => {
    const analysis = analyzeExplainRows(explainRowsOf(seqScanNode("wide", 3000, { "Node Type": "Parallel Seq Scan" })));
    expect(analysis.seqScans).toHaveLength(1);
    expect(isSeqScanNodeType("Parallel Seq Scan")).toBe(true);
    expect(isSeqScanNodeType("Index Scan")).toBe(false);
  });

  it("breaches at exactly the threshold and one row below it does not (inclusive limit)", () => {
    expect(seqScanBreachesThreshold({ relationName: "t", estimatedRows: 1000 }, 1000)).toBe(true);
    expect(seqScanBreachesThreshold({ relationName: "t", estimatedRows: 999 }, 1000)).toBe(false);
    expect(seqScanBreachesThreshold({ relationName: "t", estimatedRows: 0 }, 1000)).toBe(false);
  });

  it("carries huge row estimates exactly", () => {
    const analysis = analyzeExplainRows(explainRowsOf(seqScanNode("huge", 1e9)));
    expect(analysis.seqScans[0]?.estimatedRows).toBe(1e9);
    expect(seqScanBreachesThreshold(analysis.seqScans[0] ?? { relationName: "x", estimatedRows: null }, 1000)).toBe(
      true
    );
  });

  it("fails closed on a Seq Scan with a missing or unreadable row estimate", () => {
    const analysis = analyzeExplainRows(
      explainRowsOf({ "Node Type": "Seq Scan", "Relation Name": "odd", "Plan Rows": "?" })
    );
    expect(analysis.seqScans).toEqual([{ relationName: "odd", estimatedRows: null }]);
    expect(seqScanBreachesThreshold(analysis.seqScans[0] ?? { relationName: "x", estimatedRows: null }, 1000)).toBe(
      true
    );
    expect(analysis.parseNotes.join(" ")).toContain("unreadable Plan Rows");
  });

  it("tolerates every malformed EXPLAIN shape: report unreadable, never crash", () => {
    const malformed: readonly unknown[] = [
      null,
      [],
      [null],
      [{}],
      [{ "QUERY PLAN": null }],
      [{ "QUERY PLAN": [] }],
      [{ "QUERY PLAN": [null] }],
      [{ "QUERY PLAN": [{}] }],
      [{ "QUERY PLAN": [{ Plan: null }] }],
      [{ "QUERY PLAN": [{ Plan: 7 }] }],
      "not-rows",
      { "QUERY PLAN": [] },
    ];
    for (const rows of malformed) {
      const analysis = analyzeExplainRows(rows);
      expect(analysis.readable).toBe(false);
      expect(analysis.seqScans).toEqual([]);
      expect(analysis.sessionScan).toBeNull();
      expect(analysis.parseNotes.length).toBeGreaterThan(0);
    }
  });

  it("prunes a non-array Plans member with an honest note", () => {
    const analysis = analyzeExplainRows(explainRowsOf({ "Node Type": "Limit", Plans: seqScanNode("t", 10) }));
    expect(analysis.readable).toBe(true);
    expect(analysis.seqScans).toEqual([]);
    expect(analysis.parseNotes.join(" ")).toContain("non-array Plans");
  });

  it("cuts reference cycles instead of walking forever", () => {
    const cyclic: Record<string, unknown> = { "Node Type": "Limit" };
    cyclic.Plans = [cyclic];
    const analysis = analyzeExplainRows(explainRowsOf(cyclic));
    expect(analysis.readable).toBe(true);
    expect(analysis.parseNotes.join(" ")).toContain("cyclic");
  });

  it("walks a thousand-deep chain to its leaf", () => {
    let leaf: Record<string, unknown> = seqScanNode("deep", 1500);
    for (let depth = 0; depth < 1000; depth += 1) {
      leaf = { "Node Type": "Nested Loop", Plans: [leaf] };
    }
    const analysis = analyzeExplainRows(explainRowsOf(leaf));
    expect(analysis.seqScans).toEqual([{ relationName: "deep", estimatedRows: 1500 }]);
  });

  it("never throws on fuzzed plan bodies (seeded trials)", () => {
    const random = createSeededRandom("analyze-queries:explain-fuzz");
    const nodeTypeSoup = ["Seq Scan", "Index Scan", "Limit", 7, null, ""];
    for (let trial = 0; trial < 40; trial += 1) {
      const node: Record<string, unknown> = {};
      const keyCount = 1 + Math.floor(random() * 5);
      for (let key = 0; key < keyCount; key += 1) {
        node[`k${key}`] = random();
      }
      if (random() < 0.7) {
        node["Node Type"] = nodeTypeSoup[Math.floor(random() * nodeTypeSoup.length)];
      }
      if (random() < 0.5) {
        node["Plan Rows"] = Math.floor(random() * 5000) - 100;
      }
      if (random() < 0.4) {
        node.Plans = [random() < 0.5 ? seqScanNode("fuzz", Math.floor(random() * 5000)) : random()];
      }
      const analysis = analyzeExplainRows(explainRowsOf(node));
      if (analysis.readable) {
        for (const fact of analysis.seqScans) {
          expect(isSeqScanNodeType("Seq Scan")).toBe(true);
          expect(fact.estimatedRows === null || fact.estimatedRows >= 0).toBe(true);
        }
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Gates + report assembly
// ---------------------------------------------------------------------------

function entryRecordOf(id: string, plans: readonly unknown[], requiresSessionIndexCheck = false): EntryRecord {
  return {
    id,
    minVolumeNote: "note",
    requiresSessionIndexCheck,
    statements: plans.map(plan => ({ sql: `SELECT ${id}`, analysis: analyzeExplainRows(explainRowsOf(plan)) })),
  };
}

describe("gate construction", () => {
  it("passes the scan gate when no plan reaches the threshold", () => {
    const clean = entryRecordOf("clean", [matchingPlanFixture(900, 950)]);
    const gate = buildScanGate([clean], 1000);
    expect(gate.id).toBe(SCAN_GATE_ID);
    expect(gate.passed).toBe(true);
    expect(gate.breaches).toEqual([]);
    expect(gate.observed.count).toBe(1);
  });

  it("names the offending query, statement, node, and estimate in each breach", () => {
    const hot = entryRecordOf("hot", [matchingPlanFixture(2000, 900)]);
    const gate = buildScanGate([hot], 1000);
    expect(gate.passed).toBe(false);
    expect(gate.breaches).toEqual(["hot#stmt-1: Seq Scan on teacher (2000 >= 1000)"]);
  });

  it("fails closed on unreadable plans and unreadable estimates", () => {
    const unreadable = entryRecordOf("broken", [{ "QUERY PLAN": [] }]);
    const noEstimate = entryRecordOf("odd", [seqScanNode("odd", Number.NaN)]);
    const gate = buildScanGate([unreadable, noEstimate], 1000);
    expect(gate.passed).toBe(false);
    expect(gate.breaches[0]).toContain("plan unreadable");
    expect(gate.breaches[1]).toContain("estimated rows unavailable");
  });

  it("passes the matching index gate when the NOT EXISTS subplan rides the expected index", () => {
    const matching = entryRecordOf("matching-x", [matchingPlanFixture(10, 10)], true);
    const other = entryRecordOf("other", [seqScanNode("teacher", 2000)], false);
    const gate = buildMatchingSessionIndexGate([matching, other]);
    expect(gate.id).toBe(MATCHING_SESSION_INDEX_GATE_ID);
    expect(gate.passed).toBe(true);
    expect(gate.observed.count).toBe(1);
  });

  it("flags a session scan on the wrong access path, on no index, and on no session scan at all", () => {
    const wrongIndex = entryRecordOf(
      "matching-a",
      [
        {
          "Node Type": "Limit",
          Plans: [indexScanNode("Index Scan", "session", "session_pkey", 3)],
        },
      ],
      true
    );
    const seqPath = entryRecordOf("matching-b", [{ "Node Type": "Limit", Plans: [seqScanNode("session", 5)] }], true);
    const absent = entryRecordOf("matching-c", [{ "Node Type": "Limit", Plans: [] }], true);
    const gate = buildMatchingSessionIndexGate([wrongIndex, seqPath, absent]);
    expect(gate.passed).toBe(false);
    expect(gate.breaches[0]).toContain("session NOT EXISTS scan: Index Scan (session_pkey)");
    expect(gate.breaches[0]).toContain(EXPECTED_MATCHING_SESSION_INDEX);
    expect(gate.breaches[1]).toContain("session NOT EXISTS scan: Seq Scan (no index)");
    expect(gate.breaches[2]).toContain("no session scan found");
  });

  it("fails closed when a matching entry captured no statements", () => {
    const empty = entryRecordOf("matching-none", [], true);
    const gate = buildMatchingSessionIndexGate([empty]);
    expect(gate.passed).toBe(false);
    expect(gate.breaches[0]).toContain("no statements captured");
  });

  it("assembles the report sections with the registry census and the plan-cost table", () => {
    const matching = entryRecordOf("matching-x", [matchingPlanFixture(2000, 900)], true);
    const sections = buildAnalyzeSections({
      databaseName: "kottaby_test",
      threshold: 1000,
      entries: [matching],
    });
    expect(sections.database).toBe("kottaby_test");
    expect(sections.scanThresholdRows).toBe(1000);
    const registry = recordOf(sections.registry);
    expect(registry.size).toBe(1);
    expect(registry.ids).toEqual(["matching-x"]);
    const table = Array.isArray(sections.planCostTable) ? sections.planCostTable : [];
    expect(table).toHaveLength(1);
    const firstRow = recordOf(table[0]);
    expect(firstRow.maxSeqScanEstimatedRows).toBe(2000);
    expect(firstRow.sessionScan).toEqual({ nodeType: "Index Only Scan", indexName: EXPECTED_MATCHING_SESSION_INDEX });
    const queries = Array.isArray(sections.queries) ? sections.queries : [];
    const query = recordOf(queries[0]);
    const statements = Array.isArray(query.statements) ? query.statements : [];
    expect(String(recordOf(statements[0]).sql)).toContain("SELECT matching-x");
  });

  it("renders the operator summary lines and the explain artifact body", () => {
    const lines = buildAnalyzeSummaryLines({
      databaseName: "kottaby_test",
      threshold: 1000,
      entryCount: 18,
      scanBreaches: ["b1"],
      matchingBreaches: [],
      runDir: "logs/perf/fixture-run",
      scriptLabel: "perf:analyze-queries",
    });
    expect(lines[0]).toContain("EXPLAIN audit against kottaby_test: 18 registry queries analyzed");
    expect(lines[1]).toContain("1 breach(es)");
    expect(lines[2]).toContain("matching NOT EXISTS index check: clean");
    expect(lines[3]).toContain("report: logs/perf/fixture-run/report.md");
    const body = recordOf(
      JSON.parse(
        renderExplainArtifact("entry-id", "volume note", [
          {
            sql: "SELECT 1",
            params: [7],
            analysis: analyzeExplainRows(explainRowsOf(seqScanNode("t", 5))),
            plan: { raw: true },
          },
        ])
      )
    );
    expect(body.id).toBe("entry-id");
    expect(body.minVolumeNote).toBe("volume note");
    const statements = Array.isArray(body.statements) ? body.statements : [];
    const statement = recordOf(statements[0]);
    expect(statement.sql).toBe("SELECT 1");
    expect(statement.params).toEqual([7]);
    expect(recordOf(statement.plan).raw).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Orchestration (fake io + injected registry — pure, no database)
// ---------------------------------------------------------------------------

interface RecordedIo {
  readonly io: AnalyzeQueriesIo;
  readonly calls: string[];
  readonly explained: { sql: string; params: readonly unknown[] }[];
}

function buildFakeIo(
  explainRowsFor: (statement: { sql: string }) => unknown,
  windowStatements: readonly { sql: string; params: readonly unknown[] }[] = []
): RecordedIo {
  const calls: string[] = [];
  const explained: { sql: string; params: readonly unknown[] }[] = [];
  const io: AnalyzeQueriesIo = {
    env: () => {
      calls.push("env");
      return { databaseUrl: "postgres://fake@127.0.0.1:5432/kottaby_test" };
    },
    assertTarget: databaseUrl => {
      calls.push(`assertTarget:${databaseUrl}`);
      return { ok: true, dbName: "kottaby_test" };
    },
    captureAround: async invoke => {
      calls.push("capture");
      await invoke();
      return windowStatements;
    },
    explain: async statement => {
      calls.push(`explain:${statement.sql}`);
      explained.push({ sql: statement.sql, params: statement.params });
      return explainRowsFor(statement);
    },
    openRun: () => {
      calls.push("openRun");
      return { runDir: "logs/perf/fake-run", runId: "2026-10-09T00-00-00_analyze-queries" };
    },
    writeReport: (ctx, gates, sections) => {
      calls.push(`writeReport:${ctx.runId}:${gates.length}:${Object.keys(sections).length}`);
    },
    writeExplainArtifact: (runDir, entryId) => {
      calls.push(`writeExplainArtifact:${runDir}:${entryId}`);
    },
    closeDatabase: async () => {
      calls.push("closeDatabase");
    },
  };
  return { io, calls, explained };
}

function fakeRegistryEntry(id: string, requiresSessionIndexCheck = false): RegistryEntry {
  return {
    id,
    minVolumeNote: "note",
    requiresSessionIndexCheck,
    // The fake repository read rides the capture window; the window's canned
    // statements live on the io seam (where the real window records them).
    run: captureAround => captureAround(async () => undefined),
  };
}

describe("runAnalyzeQueries (orchestration)", () => {
  const passOptions = { scanThresholdRows: 1000 };

  it("runs the guard before any capture, EXPLAIN, or report write", async () => {
    const refusing = buildFakeIo(() => explainRowsOf(seqScanNode("t", 1)));
    refusing.io.assertTarget = (databaseUrl: string) => {
      refusing.calls.push(`assertTarget:${databaseUrl}`);
      throw new Error("guard refused");
    };
    const error = await captureErrorOf(runAnalyzeQueries(passOptions, refusing.io, [fakeRegistryEntry("e1")]));
    expect(error.message).toBe("guard refused");
    expect(refusing.calls).toEqual(["env", "assertTarget:postgres://fake@127.0.0.1:5432/kottaby_test"]);
  });

  it("analyzes every statement, writes per-query artifacts and the report, and closes last", async () => {
    const rowsFor = (statement: { sql: string }): unknown =>
      statement.sql === "SELECT hot"
        ? explainRowsOf(matchingPlanFixture(2000, 2100))
        : explainRowsOf(matchingPlanFixture(10, 10));
    const recorded = buildFakeIo(rowsFor, [
      { sql: "SELECT hot", params: ["EG"] },
      { sql: "SELECT cold", params: [1, 2] },
    ]);
    const registry = [fakeRegistryEntry("matching-x", true)];
    const outcome = await runAnalyzeQueries(passOptions, recorded.io, registry);
    expect(outcome.passed).toBe(false);
    expect(outcome.runDir).toBe("logs/perf/fake-run");
    expect(recorded.explained).toEqual([
      { sql: "SELECT hot", params: ["EG"] },
      { sql: "SELECT cold", params: [1, 2] },
    ]);
    expect(recorded.calls).toContain("writeExplainArtifact:logs/perf/fake-run:matching-x");
    expect(recorded.calls).toContain("writeReport:2026-10-09T00-00-00_analyze-queries:2:5");
    expect(recorded.calls.at(-1)).toBe("closeDatabase");
    const scanGate = outcome.gates.find(gate => gate.id === SCAN_GATE_ID);
    expect(scanGate?.breaches).toEqual([
      "matching-x#stmt-1: Seq Scan on teacher (2000 >= 1000)",
      "matching-x#stmt-1: Seq Scan on users (2100 >= 1000)",
    ]);
    expect(outcome.summaryLines[0]).toContain("EXPLAIN audit against kottaby_test: 1 registry queries analyzed");
  });

  it("passes both gates on compliant plans", async () => {
    const recorded = buildFakeIo(() => explainRowsOf(matchingPlanFixture(10, 10)), [{ sql: "SELECT ok", params: [] }]);
    const registry = [fakeRegistryEntry("matching-x", true)];
    const outcome = await runAnalyzeQueries(passOptions, recorded.io, registry);
    expect(outcome.passed).toBe(true);
    expect(outcome.gates.every(gate => gate.passed)).toBe(true);
  });

  it("refuses to EXPLAIN ANALYZE a write-shaped capture without issuing any EXPLAIN", async () => {
    const recorded = buildFakeIo(
      () => explainRowsOf(seqScanNode("t", 1)),
      [{ sql: "DELETE FROM users WHERE id = $1", params: [1] }]
    );
    const registry = [fakeRegistryEntry("rogue")];
    const error = await captureErrorOf(runAnalyzeQueries(passOptions, recorded.io, registry));
    expect(error).toBeInstanceOf(AnalyzeQueriesError);
    expect(error.message).toContain("refusing to EXPLAIN ANALYZE a non-SELECT statement");
    expect(recorded.calls.filter(call => call.startsWith("explain:"))).toEqual([]);
    expect(recorded.calls.at(-1)).toBe("closeDatabase");
  });

  it("propagates a capture failure and still closes the database", async () => {
    const recorded = buildFakeIo(() => explainRowsOf(seqScanNode("t", 1)));
    const failing: RegistryEntry = {
      id: "failing",
      minVolumeNote: "note",
      requiresSessionIndexCheck: false,
      run: async () => {
        throw new Error("repository read exploded");
      },
    };
    const error = await captureErrorOf(runAnalyzeQueries(passOptions, recorded.io, [failing]));
    expect(error.message).toBe("repository read exploded");
    expect(recorded.calls.at(-1)).toBe("closeDatabase");
  });
});

// ---------------------------------------------------------------------------
// Explain artifact writer (real filesystem, temp directory)
// ---------------------------------------------------------------------------

describe("writeExplainArtifactFile", () => {
  it("writes a redacted, owner-only artifact under explain/<id>.json", () => {
    withTempRunDir(runDir => {
      const secretPassword = ["captured", "pass"].join("-");
      const body = `{"note": "postgres://perfuser:${secretPassword}@127.0.0.1:5432/kottaby_test"}`;
      writeExplainArtifactFile(runDir, "entry-id", body);
      const written = readFileSync(join(runDir, "explain", "entry-id.json"), "utf8");
      expect(written.includes(secretPassword)).toBe(false);
      expect(written.includes("REDACTED")).toBe(true);
      expect(statSync(join(runDir, "explain")).mode & 0o777).toBe(0o700);
      expect(statSync(join(runDir, "explain", "entry-id.json")).mode & 0o777).toBe(0o600);
    });
  });

  it("refuses traversal-shaped ids before touching the filesystem and clobbers nothing", () => {
    withTempRunDir(runDir => {
      for (const badId of ["../escape", "Upper/Case", "/absolute", "-leading"]) {
        let thrown: unknown = null;
        try {
          writeExplainArtifactFile(runDir, badId, "{}");
        } catch (error) {
          thrown = error;
        }
        expect(thrown).toBeInstanceOf(AnalyzeQueriesError);
      }
      expect(readdirSync(runDir)).toEqual([]);
    });
  });

  it("guards evidence immutability: a second write of the same id refuses", () => {
    withTempRunDir(runDir => {
      writeExplainArtifactFile(runDir, "once", "{}");
      let thrown: unknown = null;
      try {
        writeExplainArtifactFile(runDir, "once", "{}");
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(Error);
    });
  });
});

// ---------------------------------------------------------------------------
// Security: real subprocess refusals + static source pins
// ---------------------------------------------------------------------------

describe("security: guard refusal, usage refusal, and injection-free seams", () => {
  interface ProcessResult {
    exitCode: number | null;
    stdout: string;
    stderr: string;
  }

  function runProcess(args: readonly string[], envOverride: Record<string, string | undefined>): ProcessResult {
    const env: Record<string, string | undefined> = { ...process.env, ...envOverride };
    for (const [key, value] of Object.entries(env)) {
      if (value === undefined) {
        delete env[key];
      }
    }
    const proc = Bun.spawnSync({
      cmd: [process.execPath, ANALYZE_SCRIPT_PATH, ...args],
      cwd: REPO_ROOT,
      stdout: "pipe",
      stderr: "pipe",
      env,
    });
    return {
      exitCode: proc.exitCode,
      stdout: new TextDecoder().decode(proc.stdout),
      stderr: new TextDecoder().decode(proc.stderr),
    };
  }

  it("refuses a non-test database target before any client, run dir, or artifact exists", () => {
    const logsBefore = existsSync(PERF_LOGS_DIR) ? readdirSync(PERF_LOGS_DIR).length : 0;
    const secretPassword = ["refusal", "pass"].join("-");
    const result = runProcess([], {
      DATABASE_URL: `postgres://perfuser:${secretPassword}@127.0.0.1:5432/kottaby`,
    });
    expect(result.exitCode).toBe(2);
    const combined = `${result.stdout}${result.stderr}`;
    expect(combined).toContain("kottaby");
    expect(combined.includes(secretPassword)).toBe(false);
    expect(combined.includes("postgres://")).toBe(false);
    expect(readdirSync(PERF_LOGS_DIR)).toHaveLength(logsBefore);
  });

  it("refuses an unresolvable database name with the guard refusal exit code", () => {
    const result = runProcess([], { DATABASE_URL: "postgres://127.0.0.1:5432/" });
    expect(result.exitCode).toBe(2);
    expect(result.stderr).not.toContain("not implemented");
  });

  it("keeps the exit-2 unknown-flag contract, listing the accepted flag", () => {
    const result = runProcess(["--bogus"], {});
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("--bogus");
    expect(result.stderr).toContain("--scan-threshold-rows");
    expect(result.stderr).not.toContain("not implemented");
  });

  it("holds no static database-client or repository import (guard-first construction)", () => {
    for (const file of SOURCE_FILES) {
      const source = readFileSync(file.path, "utf8");
      const staticBackendImports = source
        .split("\n")
        .filter(line => /^import\b/.test(line) && !/\bimport\s+type\b/.test(line) && line.includes("@/backend/db"));
      expect(staticBackendImports).toEqual([]);
    }
    const registrySource = readFileSync(SOURCE_FILES.find(file => file.label === "registry")?.path ?? "", "utf8");
    expect(registrySource).toContain('await import("@/backend/db/repo/');
  });

  it("keeps the EXPLAIN prologue static and parameter-bound (no interpolation seam)", () => {
    expect(EXPLAIN_PREFIX).toBe("EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ");
    expect(EXPLAIN_PREFIX.includes("${")).toBe(false);
    expect(EXPLAIN_PREFIX.includes("$1")).toBe(false);
    const entrySource = readFileSync(ANALYZE_SCRIPT_PATH, "utf8");
    expect(entrySource).toContain("EXPLAIN_PREFIX + statement.sql");
    expect(entrySource).toContain("[...statement.params]");
    expect(entrySource).toContain("return result.rows");
  });
});
