/**
 * Matching-pipeline benchmark (`perf:bench-matching`).
 *
 * Measures the REAL student browse pipeline end to end —
 * `TeacherMatchingService.browseAvailableTeachers(studentUserId, input,
 * locale)` called directly (no HTTP, no GraphQL) through the global
 * database handle — across the volume × sort × filter-variant matrix, and
 * gates the launch regime: p95 < `--gate-ms` (default 200ms) with ZERO
 * assertion errors at the 100-teacher cells only; every other volume is
 * scale-evolution evidence, never a gate. Runs against the newest
 * COMPLETED seed run; a volume cell benchmarks the FIRST `volume`
 * seed-scoped eligible teachers (teacher id ascending), with teachers
 * beyond the window temporarily marked offline and restored on every
 * path, and two resolved seeded callers (no-filter / language; a
 * prefix-stamped bench caller is inserted when absent — the run's
 * prefix-scoped cleanup removes it).
 *
 * Safety contract, in order: (1) the destructive-target guard runs FIRST
 * — the client, the matching service, and every repository module are
 * imported dynamically only after the guard allows the run; (2) every
 * query and write is scoped to the seed run's escaped prefix pattern (the
 * only writes are the reversible window flips and bench caller inserts);
 * (3) every sampled call is verified per-sample (envelope consistency + the
 * in-session exclusion oracle — a violated oracle, a thrown browse, or a
 * broken clock marks the sample as an error and fails the cell's gate);
 * (4) the report lands through the shared redacting writer and the
 * `VERDICT` line through the shared emitter.
 *
 * Exit codes: 0 = every gate passed (or a gate-free self-check ran clean),
 * 1 = a gate failed or a runtime failure occurred, 2 = usage refusal,
 * guard refusal, or an unusable/insufficient seed run.
 */

import type { TeacherMatchingPageReturnType, TeacherMatchingSubmitInput } from "@/backend/types";
import { type BenchCellSpec, buildSelfCheckCell, enumerateCells } from "@/scripts/perf/lib/bench-matching-cells";
import {
  type BenchMatchingCliOptions,
  isBenchMatchingCliUsageError,
  parseBenchMatchingCli,
} from "@/scripts/perf/lib/bench-matching-cli";
import { type BenchDatabase, ensureCallers, type ResolvedBenchCallers } from "@/scripts/perf/lib/bench-matching-db";
import { BenchManifestError, selectBenchSeedPlan } from "@/scripts/perf/lib/bench-matching-manifest";
import {
  type MatrixRunContext,
  runSelfCheckMatrix,
  runVolumeMatrix,
} from "@/scripts/perf/lib/bench-matching-matrix-run";
import { buildVolumeSteps, planCallers } from "@/scripts/perf/lib/bench-matching-plan";
import {
  assembleBenchReport,
  type BenchReportFacts,
  buildBenchSummaryLines,
} from "@/scripts/perf/lib/bench-matching-report";
import {
  listSeedManifestEntries,
  PERF_LOGS_ROOT,
  type RawCleanupManifestEntry,
} from "@/scripts/perf/lib/cleanup-manifest";
import { assertTestDatabaseTarget, type DatabaseTargetOk } from "@/scripts/perf/lib/db-target-guard";
import { emitVerdict, openRunDirectory, type PerfRunContext, writeReport } from "@/scripts/perf/lib/report";
import type { GateResult } from "@/scripts/perf/lib/stats";

const SCRIPT_LABEL = "perf:bench-matching";
const TOOL_ID = "bench-matching";
const EXIT_USAGE = 2;
const EXIT_FAILURE = 1;

/** Fixed mini-run counts for `--self-check` (plumbing proof, never a gate). */
const SELF_CHECK_SAMPLES = 3;
const SELF_CHECK_WARMUP = 1;

/** Refusal with an actionable operator message (usage-class exit). */
export class BenchMatchingRefusalError extends Error {}

/** Environment + effectful seams the benchmark orchestrates over. */
export interface BenchMatchingIo {
  env(): { databaseUrl: string };
  assertTarget(databaseUrl: string): DatabaseTargetOk;
  listManifests(): readonly RawCleanupManifestEntry[];
  connect(): Promise<BenchDatabase>;
  openRun(): { runDir: string; runId: string };
  writeReport(ctx: PerfRunContext, gates: readonly GateResult[], sections: Record<string, unknown>): void;
  now(): number;
  browse(
    studentUserId: number,
    input: TeacherMatchingSubmitInput,
    locale: string
  ): Promise<TeacherMatchingPageReturnType>;
}

/** Terminal outcome of one benchmark run; main() turns it into stdout + exit code. */
export interface BenchMatchingOutcome {
  readonly passed: boolean;
  readonly runId: string;
  readonly runDir: string;
  readonly gates: readonly GateResult[];
  readonly sections: Record<string, unknown>;
  readonly summaryLines: readonly string[];
}

/** The prepared execution inputs once census, oracle, and callers resolve. */
interface BenchPreparation {
  readonly ctx: MatrixRunContext;
  readonly callers: ResolvedBenchCallers;
  readonly selfCheckCell: BenchCellSpec | null;
}

/** Resolves census, exclusion oracle, callers, volume validation, and the cell list. */
async function prepareBenchRun(
  database: BenchDatabase,
  io: BenchMatchingIo,
  seed: { readonly runId: string; readonly prefix: string; readonly passwordHash: string },
  options: BenchMatchingCliOptions
): Promise<BenchPreparation> {
  const censusIds = await database.findEligibleTeacherIds(seed.prefix);
  const startedIds = await database.findStartedTeacherIds(seed.prefix);
  const studentRows = await database.listStudentCandidates(seed.prefix);
  const callerPlan = planCallers(studentRows, seed.prefix, seed.passwordHash);
  const callers = await ensureCallers(database, callerPlan, message => new BenchMatchingRefusalError(message), 0, {
    noFilter: callerPlan.noFilterCallerId,
    language: callerPlan.languageCallerId,
    inserted: 0,
  });
  if (!options.selfCheck) {
    const largestVolume = options.volumes[0] ?? 0;
    if (largestVolume > censusIds.length) {
      throw new BenchMatchingRefusalError(
        `seed run ${seed.runId} exposes only ${censusIds.length} eligible teachers (seed-run scoped) — ` +
          `volume ${largestVolume} exceeds it; re-run the seeder with more teachers`
      );
    }
  }
  return {
    ctx: {
      database,
      seam: io,
      now: () => io.now(),
      startedTeacherIds: startedIds,
      censusIds,
      callerIds: { noFilter: callers.noFilter, language: callers.language },
      warmup: options.selfCheck ? SELF_CHECK_WARMUP : options.warmup,
      samples: options.selfCheck ? SELF_CHECK_SAMPLES : options.samples,
      gateEnabled: !options.selfCheck,
    },
    callers,
    selfCheckCell: options.selfCheck ? buildSelfCheckCell(censusIds.length) : null,
  };
}

/** Drives one complete benchmark run; the guard is the first effectful call. */
export async function runBenchMatching(
  options: BenchMatchingCliOptions,
  io: BenchMatchingIo
): Promise<BenchMatchingOutcome> {
  const target = io.assertTarget(io.env().databaseUrl);
  let database: BenchDatabase | null = null;
  try {
    const seed = selectBenchSeedPlan(io.listManifests());
    database = await io.connect();
    const prep = await prepareBenchRun(database, io, seed, options);
    const cells = prep.selfCheckCell === null ? enumerateCells(options.volumes) : [prep.selfCheckCell];
    const run = io.openRun();
    const matrix =
      prep.selfCheckCell === null
        ? await runVolumeMatrix(buildVolumeSteps(options.volumes, prep.ctx.censusIds), cells, prep.ctx)
        : await runSelfCheckMatrix(prep.selfCheckCell, prep.ctx);
    const facts: BenchReportFacts = {
      databaseName: target.dbName,
      seedRunId: seed.runId,
      prefix: seed.prefix,
      eligibleCensus: prep.ctx.censusIds.length,
      startedTeacherCount: prep.ctx.startedTeacherIds.length,
      callerNoFilterId: prep.ctx.callerIds.noFilter,
      callerLanguageId: prep.ctx.callerIds.language,
      benchSeededCallerCount: prep.callers.inserted,
      selfCheck: options.selfCheck,
      samplesPerCell: prep.ctx.samples,
      warmupPerCell: prep.ctx.warmup,
    };
    const volumesArg = options.selfCheck ? `self-check@${prep.ctx.censusIds.length}` : options.volumes.join(",");
    const assembled = assembleBenchReport(facts, matrix.windows, matrix.records, volumesArg, options.gateMs);
    io.writeReport(
      {
        runId: run.runId,
        tool: TOOL_ID,
        startedAt: new Date().toISOString(),
        args: {
          volumes: assembled.args.volumes,
          samples: assembled.args.samples,
          warmup: assembled.args.warmup,
          gateMs: assembled.args.gateMs,
          selfCheck: assembled.args.selfCheck,
        },
      },
      assembled.gates,
      assembled.sections
    );
    return {
      passed: assembled.gates.every(gate => gate.passed),
      runId: run.runId,
      runDir: run.runDir,
      gates: assembled.gates,
      sections: assembled.sections,
      summaryLines: buildBenchSummaryLines(facts, matrix.windows, matrix.records.length, run.runDir),
    };
  } finally {
    if (database !== null) {
      await database.close();
    }
  }
}

function createRealIo(): BenchMatchingIo {
  return {
    env: () => ({ databaseUrl: process.env.DATABASE_URL ?? "" }),
    assertTarget: databaseUrl => assertTestDatabaseTarget(databaseUrl),
    listManifests: () => listSeedManifestEntries(PERF_LOGS_ROOT),
    connect: async () => {
      const { db } = await import("@/backend/db/client");
      const { DrizzleBenchDatabase } = await import("@/scripts/perf/lib/bench-matching-db");
      return new DrizzleBenchDatabase(db);
    },
    openRun: () => openRunDirectory(TOOL_ID),
    writeReport: (ctx, gates, sections) => {
      writeReport(ctx, gates, sections);
    },
    now: () => performance.now(),
    browse: async (studentUserId, input, locale) => {
      const { TeacherMatchingService } = await import("@/backend/services/teachers/teacher-matching.service");
      return TeacherMatchingService.browseAvailableTeachers(studentUserId, input, locale);
    },
  };
}

async function main(): Promise<void> {
  const parsed = parseBenchMatchingCli(process.argv.slice(2));
  if (isBenchMatchingCliUsageError(parsed)) {
    console.error(parsed.message);
    process.exit(EXIT_USAGE);
  }
  let outcome: BenchMatchingOutcome;
  try {
    outcome = await runBenchMatching(parsed, createRealIo());
  } catch (error) {
    if (error instanceof BenchManifestError || error instanceof BenchMatchingRefusalError) {
      console.error(`${SCRIPT_LABEL}: ${error.message}`);
      process.exit(EXIT_USAGE);
    }
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(EXIT_FAILURE);
  }
  for (const line of outcome.summaryLines) {
    console.log(line);
  }
  const verdictPassed = emitVerdict(outcome.gates);
  process.exit(outcome.passed && verdictPassed ? 0 : EXIT_FAILURE);
}

if (import.meta.main) {
  void main();
}
