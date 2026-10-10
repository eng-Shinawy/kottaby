#!/usr/bin/env bun
/**
 * EXPLAIN (ANALYZE, BUFFERS) probe — the row 6.4 CLI.
 *
 * Runs the platform's critical query set through the REAL service paths
 * (directory browse, student/teacher session lists, notification inbox,
 * escrow balance read) with an in-process SQL capture installed, then
 * re-executes every captured statement under `EXPLAIN (ANALYZE, BUFFERS)`
 * against the live database.
 *
 * Verdict rule (REQ-008 AC-2): a `Seq Scan` node on the surface's DRIVING
 * table FAILs when that table holds at least `--min-rows` live rows — the
 * driving table is the primary entity being listed (teacher / session /
 * notifications / wallet); join partners and sub-threshold tables are
 * recorded as notes, never failures. All statements are read-only SELECTs,
 * so the ANALYZE execution is safe against any environment.
 *
 * Usage:
 *   bun run scripts/load/probe-explain-analyze.ts [--min-rows 100] [--out <path>]
 *
 * Exit codes: 0 = no Seq Scan on any qualifying driving table; 1 = failure.
 */

import { applyEnvFile } from "@/scripts/dbActions/envFile";
import { writeLoadArtifact } from "@/scripts/load/lib/artifact";
import { type LoadArgSpec, parseLoadCliArgs } from "@/scripts/load/lib/cli";
import { type CapturedStatement, installSqlCapture } from "@/scripts/load/lib/sql-capture";

const ARGS: readonly LoadArgSpec[] = [
  { name: "min-rows", kind: "number", default: 100, help: "Live rows a table needs before a Seq Scan on it FAILs" },
  { name: "out", kind: "string", help: "Explicit artifact output path (default: scratch/load/<stamp>.json)" },
];

/** One probed surface: label + the captured statements it emitted. */
interface SurfaceStatements {
  readonly surface: string;
  readonly statements: readonly CapturedStatement[];
}

/** Per-statement EXPLAIN outcome. */
interface ExplainOutcome {
  readonly surface: string;
  readonly seqScans: readonly { readonly table: string; readonly liveRows: number }[];
  readonly executionMs: number | null;
}

/** Renders a captured bound value as a literal for the EXPLAIN re-run. */
function renderLiteral(value: unknown): string {
  if (value === null || value === undefined) {
    return "NULL";
  }
  if (typeof value === "number") {
    return String(value);
  }
  if (typeof value === "boolean") {
    return value ? "TRUE" : "FALSE";
  }
  if (typeof value === "string") {
    return `'${value.replaceAll("'", "''")}'`;
  }
  throw new Error(`refusing to inline a ${typeof value} parameter into EXPLAIN`);
}

/** Substitutes $n placeholders with literals (EXPLAIN cannot bind parameters). */
function renderStatement(statement: CapturedStatement): string {
  let text = statement.text;
  for (let index = statement.values.length; index >= 1; index -= 1) {
    text = text.replaceAll(`$${index}`, `(${renderLiteral(statement.values[index - 1])})`);
  }
  return text;
}

/** Extracts `Seq Scan on <table>` relations from an EXPLAIN plan. */
/** Extracts `Seq Scan on <table>` relations from an EXPLAIN plan. */
function seqScanTables(planLines: readonly string[]): string[] {
  const tables: string[] = [];
  for (const line of planLines) {
    const pattern = /Seq Scan(?:\+\w+)? on (?:public\.)?([a-z_][a-z0-9_]*)/g;
    let match: RegExpExecArray | null = pattern.exec(line);
    while (match !== null) {
      tables.push(match[1]);
      match = pattern.exec(line);
    }
  }
  return tables;
}

/**
 * The driving table of each probed surface — the primary entity being
 * listed (AC-2's "driving tables"). Join partners (e.g. `users` in the
 * directory browse's name/country join) are recorded but never FAIL the
 * probe: the planner's hash-join seq scan over a join partner is an
 * optimal choice at any realistic scale, and the point-lookup paths into
 * those tables are PK-indexed by construction.
 */
const DRIVING_TABLES: Readonly<Record<string, string>> = {
  "directory-browse": "teacher",
  "student-session-list": "session",
  "teacher-session-list": "session",
  "notification-inbox": "notifications",
  "escrow-balance-read": "wallet",
};
/** Parses the trailing `Execution Time: N ms` plan line. */
function executionTimeOf(planLines: readonly string[]): number | null {
  for (let index = planLines.length - 1; index >= 0; index -= 1) {
    const line = planLines.at(index);
    if (line === undefined) {
      continue;
    }
    const match = /Execution Time: ([0-9.]+) ms/.exec(line);
    if (match?.[1] !== undefined) {
      return Number(match[1]);
    }
  }
  return null;
}

/** Runs the critical read set with the capture patch installed. */
async function captureCriticalSet(db: Awaited<typeof import("@/backend/db")>["db"]): Promise<SurfaceStatements[]> {
  const { sql } = await import("drizzle-orm");
  const { TeacherMatchingService } = await import("@/backend/services/teachers/teacher-matching.service");
  const { SessionLifecycleService } = await import("@/backend/services/classes/session-lifecycle.service");
  const { NotificationEngine } = await import("@/backend/services/notifications/notification-engine.service");
  const { WalletRepository } = await import("@/backend/db/repo");
  const { TeacherMatchingSort } = await import("@/backend/enum/teachers/teacher-matching-sort.enum");

  const pickStudentWithProfile = async (): Promise<number | null> => {
    const found = await db.execute<{ id: number }>(sql`
      SELECT s.id FROM students s
      JOIN users u ON u.id = s.id
      WHERE u.role = 'student' AND u.is_deleted = false
      ORDER BY s.id LIMIT 1`);
    return found.rows[0]?.id ?? null;
  };
  const pickTeacherWithProfile = async (): Promise<number | null> => {
    const found = await db.execute<{ id: number }>(sql`
      SELECT t.id FROM teacher t
      JOIN users u ON u.id = t.id
      WHERE u.role = 'teacher' AND u.is_deleted = false
      ORDER BY t.id LIMIT 1`);
    return found.rows[0]?.id ?? null;
  };

  const capture = installSqlCapture();
  const surfaces: SurfaceStatements[] = [];
  try {
    const studentId = await pickStudentWithProfile();
    if (studentId === null) {
      throw new Error("no live student user (with a students child row) found for the directory/session surfaces");
    }
    const beforeDirectory = capture.statements().length;
    await TeacherMatchingService.browseAvailableTeachers(
      studentId,
      {
        recitation: null,
        intent: null,
        page: 1,
        pageSize: 25,
        search: null,
        minRating: null,
        sort: TeacherMatchingSort.RatingDesc,
      },
      "en"
    );
    surfaces.push({ surface: "directory-browse", statements: capture.statements().slice(beforeDirectory) });

    const beforeSessions = capture.statements().length;
    await SessionLifecycleService.listMyStudentSessions(studentId, {}, 1, 25);
    surfaces.push({ surface: "student-session-list", statements: capture.statements().slice(beforeSessions) });

    const teacherId = await pickTeacherWithProfile();
    if (teacherId !== null) {
      const beforeTeacher = capture.statements().length;
      await SessionLifecycleService.listMyTeacherSessions(teacherId, {}, 1, 25);
      surfaces.push({ surface: "teacher-session-list", statements: capture.statements().slice(beforeTeacher) });
    } else {
      throw new Error("no live teacher user found for the teacher session list surface");
    }

    const userId = studentId;
    const beforeInbox = capture.statements().length;
    await NotificationEngine.listMyNotifications(userId, { limit: 20, offset: 0 }, "en");
    surfaces.push({ surface: "notification-inbox", statements: capture.statements().slice(beforeInbox) });

    const beforeWallet = capture.statements().length;
    await WalletRepository.findByTeacherId(teacherId);
    surfaces.push({ surface: "escrow-balance-read", statements: capture.statements().slice(beforeWallet) });
  } finally {
    capture.uninstall();
  }
  return surfaces;
}

async function main(): Promise<number> {
  const args = parseLoadCliArgs("probe-explain-analyze.ts", ARGS);
  if (args === null) {
    return 1;
  }
  const minRows = args.number("min-rows") ?? 100;

  applyEnvFile(".env");
  const { db, closePool } = await import("@/backend/db");
  const { sql } = await import("drizzle-orm");

  const outcomes: ExplainOutcome[] = [];
  let failures = 0;
  const capturedSurfaces = await captureCriticalSet(db);
  const explanations = await Promise.all(
    capturedSurfaces.flatMap(({ surface, statements }) =>
      statements
        .filter(statement => /^\s*select/i.test(statement.text))
        .map(async statement => {
          const explainResult = await db.execute<{ "QUERY PLAN": string }>(
            sql.raw(`EXPLAIN (ANALYZE, BUFFERS) ${renderStatement(statement)}`)
          );
          const planLines = explainResult.rows.map(row => row["QUERY PLAN"]);
          const tables = seqScanTables(planLines);
          const seqScans = await Promise.all(
            tables.map(async table => {
              const counted = await db.execute<{ n: string }>(sql.raw(`SELECT count(*)::text AS n FROM ${table}`));
              return { table, liveRows: Number(counted.rows[0]?.n ?? 0) };
            })
          );
          return { surface, seqScans, executionMs: executionTimeOf(planLines) } satisfies ExplainOutcome;
        })
    )
  );
  outcomes.push(...explanations);

  for (const outcome of outcomes) {
    const drivingTable = DRIVING_TABLES[outcome.surface];
    const offending = outcome.seqScans.filter(scan => scan.table === drivingTable && scan.liveRows >= minRows);
    if (offending.length > 0) {
      failures += 1;
      for (const scan of offending) {
        console.log(`FAIL  ${outcome.surface}: Seq Scan on ${scan.table} (${scan.liveRows} live rows ≥ ${minRows})`);
      }
    } else {
      const notes = outcome.seqScans.map(scan => `${scan.table} (${scan.liveRows} rows)`).join(", ");
      const scanSummary = outcome.seqScans.length === 0 ? "index paths only" : `non-driving/table scans: ${notes}`;
      const timing = outcome.executionMs !== null ? ` — ${outcome.executionMs}ms` : "";
      console.log(`PASS  ${outcome.surface}: ${scanSummary}${timing}`);
    }
  }
  await closePool();

  const payload = {
    tool: "probe-explain-analyze",
    minRows,
    surfaces: outcomes.map(outcome => ({
      surface: outcome.surface,
      drivingTable: DRIVING_TABLES[outcome.surface] ?? null,
      executionMs: outcome.executionMs,
      seqScans: outcome.seqScans,
    })),
  };
  const artifact = args.string("out") ?? writeLoadArtifact("probe-explain-analyze", payload);
  console.log(`[probe-explain-analyze] artifact: ${artifact}`);

  if (failures > 0) {
    console.error(`[probe-explain-analyze] FAIL — ${failures} statement(s) seq-scan a qualifying driving table`);
    return 1;
  }
  console.log("[probe-explain-analyze] PASS — no Seq Scan on any qualifying driving table");
  return 0;
}

main()
  .then(code => process.exit(code))
  .catch(error => {
    console.error("[probe-explain-analyze] FAILED:", error);
    process.exit(1);
  });
