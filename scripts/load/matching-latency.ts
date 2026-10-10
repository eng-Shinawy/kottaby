#!/usr/bin/env bun

/**
 * Matching-latency probe — the row 6.2 CLI.
 *
 * Seeds `--teachers` eligible teachers plus one browsing student inside a
 * deliberate ROLLBACK-ONLY transaction (the `qa-directory-fixtures.ts`
 * teacher-row pattern: approved, online, shared Qira'ah recitation,
 * JSON-encoded subjects/languages, rating deliberately NULL — unrated
 * rows are window-safe for the repo's ordering assertions), then times
 * the REAL matching browse (`TeacherMatchingService.browseAvailableTeachers`
 * → single bulk `TeacherRepository.listMatchingCandidates` query) over
 * `--runs` passes.
 *
 * The recorded duration is the honest dev-scale number (REQ-008 AC-6):
 * the probe FAILs only above a GENEROUS multiple of the 200ms row-6.2
 * budget so CI never gets a brittle wall-clock gate — the raw per-run
 * durations travel in the artifact for the launch report.
 *
 * Zero residue: the fixture transaction always rolls back, so the dev
 * database is untouched (no fixture rows survive, nothing to clean up).
 *
 * Usage:
 *   bun run scripts/load/matching-latency.ts [--teachers 100] [--page-size 25] [--runs 3] [--out <path>]
 *
 * Exit codes: 0 = probe completed under the generous bound; 1 = failure.
 */

import type { DBTransaction } from "@/backend/types";
import { applyEnvFile } from "@/scripts/dbActions/envFile";
import { writeLoadArtifact } from "@/scripts/load/lib/artifact";
import { type LoadArgSpec, parseLoadCliArgs } from "@/scripts/load/lib/cli";

const ARGS: readonly LoadArgSpec[] = [
  { name: "teachers", kind: "number", default: 100, help: "Eligible teachers to seed (target: 100+)" },
  { name: "page-size", kind: "number", default: 25, help: "Matching browse page size per run" },
  { name: "runs", kind: "number", default: 3, help: "Timed browse passes (min/median/worst reported)" },
  { name: "out", kind: "string", help: "Explicit artifact output path (default: scratch/load/<stamp>.json)" },
];

/** Row 6.2 target: the matching browse budget in milliseconds. */
const ROW_62_BUDGET_MS = 200;
/** Generous CI multiple — the probe FAILs only above this (never at 200ms). */
const GENEROUS_BUDGET_MULTIPLE = 10;

/** The shared profile tokens: the one Qira'ah reading + JSON-in-varchar encoder. */
const RECITATION_TOKENS = '["hafs_an_asim"]';
const SUBJECTS_PAYLOAD = '["hifz"]';
const LANGUAGES_PAYLOAD = '["arabic","english"]';

/** Measurement carried out of the rolled-back transaction. */
interface ProbeResult {
  readonly seededTeachers: number;
  readonly eligibleOnline: number;
  readonly candidateRows: number;
  readonly totalMatched: number;
  readonly runDurationsMs: readonly number[];
}

/** Marker carrying the measurement through the deliberate rollback throw. */
const RESULT_KEY = Symbol("matching-latency.result");

/** Structural guard for the carried measurement (no assertions needed). */
function isProbeResult(value: unknown): value is ProbeResult {
  return (
    typeof value === "object" &&
    value !== null &&
    "seededTeachers" in value &&
    "eligibleOnline" in value &&
    "candidateRows" in value &&
    "totalMatched" in value &&
    "runDurationsMs" in value
  );
}

/** Narrows a thrown value to the carried measurement without assertions. */
function carriedResultOf(error: unknown): ProbeResult | undefined {
  if (typeof error === "object" && error !== null && RESULT_KEY in error) {
    const carried: unknown = error[RESULT_KEY];
    if (isProbeResult(carried)) {
      return carried;
    }
  }
  return undefined;
}

/** Inserts the fixture student (users + students child row); returns its id. */
async function seedStudent(tx: DBTransaction, stamp: string, passwordHash: string): Promise<number> {
  const { users } = await import("@/backend/db/schema/users/users");
  const { students } = await import("@/backend/db/schema/students/students");
  const { UserRole } = await import("@/backend/enum/users/user-role.enum");

  const inserted = await tx
    .insert(users)
    .values({
      fullName: `Load Latency Student ${stamp}`,
      email: `load-latency-student-${stamp}@draftacademy.local`,
      phone: `+2010000${stamp.replace(/-/g, "").slice(0, 6)}`,
      passwordHash,
      role: UserRole.Student,
      isDeleted: false,
      suspended: false,
      isBlocked: false,
      lastActiveAt: new Date(),
      country: "Egypt",
      countryCode: "EG",
    })
    .returning({ id: users.id });
  const studentUser = inserted.at(0);
  if (studentUser === undefined) {
    throw new Error("student users insert returned no rows");
  }
  await tx.insert(students).values({
    id: studentUser.id,
    handshakeCode: `LL${stamp.replace(/-/g, "").slice(0, 12)}`,
    balanceTrial: 0,
  });
  return studentUser.id;
}

/** Inserts `teacherCount` eligible teacher fixtures (two bulk inserts). */
async function seedTeachers(
  tx: DBTransaction,
  teacherCount: number,
  stamp: string,
  passwordHash: string
): Promise<void> {
  const { users } = await import("@/backend/db/schema/users/users");
  const { teacher } = await import("@/backend/db/schema/teachers/teacher");
  const { UserRole } = await import("@/backend/enum/users/user-role.enum");

  const userRows = Array.from({ length: teacherCount }, (_, index) => ({
    fullName: `Load Latency Teacher ${stamp}${index}`,
    email: `load-latency-teacher-${stamp}${index}@draftacademy.local`,
    phone: `+2010000${String(index).padStart(6, "0").slice(0, 6)}`,
    passwordHash,
    role: UserRole.Teacher,
    isDeleted: false,
    suspended: false,
    isBlocked: false,
    lastActiveAt: new Date(),
    country: "Egypt",
    countryCode: "EG",
  }));
  const createdRows = await tx.insert(users).values(userRows).returning({ id: users.id });
  await tx.insert(teacher).values(
    createdRows.map(created => ({
      id: created.id,
      isApproved: true,
      isOnline: true,
      subjects: SUBJECTS_PAYLOAD,
      recitations: RECITATION_TOKENS,
      languages: LANGUAGES_PAYLOAD,
    }))
  );
}

/** Times `runs` real matching browse passes on the seeded set (async recursion). */
async function timeBrowseRuns(
  tx: DBTransaction,
  studentId: number,
  pageSize: number,
  runs: number
): Promise<{ candidateRows: number; totalMatched: number; runDurationsMs: readonly number[] }> {
  const { TeacherMatchingService } = await import("@/backend/services/teachers/teacher-matching.service");
  const { TeacherMatchingSort } = await import("@/backend/enum/teachers/teacher-matching-sort.enum");

  const input = {
    recitation: null,
    intent: null,
    page: 1,
    pageSize,
    search: null,
    minRating: null,
    sort: TeacherMatchingSort.RatingDesc,
  };
  const runDurationsMs: number[] = [];
  let candidateRows = 0;
  let totalMatched = 0;

  const runOnce = async (remaining: number): Promise<void> => {
    if (remaining === 0) {
      return;
    }
    const startedAt = performance.now();
    const page = await TeacherMatchingService.browseAvailableTeachers(studentId, input, "en", tx);
    runDurationsMs.push(performance.now() - startedAt);
    candidateRows = page.items.length;
    totalMatched = page.total;
    await runOnce(remaining - 1);
  };
  await runOnce(runs);
  return { candidateRows, totalMatched, runDurationsMs };
}

/** Seeds fixtures + times the browse inside the caller's rollback transaction. */
async function seedInside(tx: DBTransaction, teacherCount: number, pageSize: number, runs: number): Promise<never> {
  const { randomUUID } = await import("node:crypto");
  const { eq } = await import("drizzle-orm");
  const { teacher } = await import("@/backend/db/schema/teachers/teacher");
  const { hashPassword } = await import("@/backend/lib/auth/password");

  const stamp = randomUUID().slice(0, 18);
  const passwordHash = await hashPassword(`load-latency-${stamp}`);
  const studentId = await seedStudent(tx, stamp, passwordHash);
  await seedTeachers(tx, teacherCount, stamp, passwordHash);
  const eligibleOnline = await tx.$count(teacher, eq(teacher.isOnline, true));
  const measured = await timeBrowseRuns(tx, studentId, pageSize, runs);

  throw Object.assign(new Error("deliberate rollback"), {
    [RESULT_KEY]: {
      seededTeachers: teacherCount,
      eligibleOnline,
      candidateRows: measured.candidateRows,
      totalMatched: measured.totalMatched,
      runDurationsMs: measured.runDurationsMs,
    } satisfies ProbeResult,
  });
}

async function main(): Promise<number> {
  const args = parseLoadCliArgs("matching-latency.ts", ARGS);
  if (args === null) {
    return 1;
  }
  const teacherCount = args.number("teachers") ?? 100;
  const pageSize = args.number("page-size") ?? 25;
  const runs = args.number("runs") ?? 3;

  applyEnvFile(".env");
  const { db, closePool } = await import("@/backend/db");

  let result: ProbeResult | undefined;
  try {
    await db.transaction(tx => seedInside(tx, teacherCount, pageSize, runs));
  } catch (error) {
    result = carriedResultOf(error);
    if (result === undefined) {
      console.error("[matching-latency] FAILED:", error);
      await closePool();
      return 1;
    }
  }
  await closePool();

  if (result === undefined) {
    console.error("[matching-latency] FAILED — no measurement carried out of the transaction");
    return 1;
  }

  const sorted = [...result.runDurationsMs].toSorted((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
  const worst = sorted[sorted.length - 1] ?? 0;
  const generousBoundMs = ROW_62_BUDGET_MS * GENEROUS_BUDGET_MULTIPLE;
  console.log(
    `[matching-latency] seeded=${result.seededTeachers} teachers (eligible online set incl. pre-existing: ${result.eligibleOnline}); browse page ${pageSize} → ${result.candidateRows} rows (total ${result.totalMatched}); runs=[${result.runDurationsMs.map(ms => ms.toFixed(1)).join(", ")}]ms median=${median.toFixed(1)}ms`
  );
  console.log(
    `[matching-latency] row-6.2 budget: ${ROW_62_BUDGET_MS}ms; generous FAIL bound: ${generousBoundMs}ms (x${GENEROUS_BUDGET_MULTIPLE}); worst run: ${worst.toFixed(1)}ms`
  );

  const payload = {
    tool: "matching-latency",
    seededTeachers: result.seededTeachers,
    eligibleOnline: result.eligibleOnline,
    pageSize,
    candidateRows: result.candidateRows,
    totalMatched: result.totalMatched,
    runDurationsMs: result.runDurationsMs.map(ms => Number(ms.toFixed(3))),
    medianMs: Number(median.toFixed(3)),
    worstMs: Number(worst.toFixed(3)),
    row62BudgetMs: ROW_62_BUDGET_MS,
    generousFailBoundMs: generousBoundMs,
  };
  const artifact = args.string("out") ?? writeLoadArtifact("matching-latency", payload);
  console.log(`[matching-latency] artifact: ${artifact}`);

  if (result.seededTeachers < 100) {
    console.error(
      `[matching-latency] FAIL — seeded only ${result.seededTeachers} teachers (100+ required for the row-6.2 probe)`
    );
    return 1;
  }
  if (worst > generousBoundMs) {
    console.error(
      `[matching-latency] FAIL — worst run ${worst.toFixed(1)}ms exceeds the generous bound ${generousBoundMs}ms`
    );
    return 1;
  }
  console.log("[matching-latency] PASS — recorded under the generous bound");
  return 0;
}

main()
  .then(code => process.exit(code))
  .catch(error => {
    console.error("[matching-latency] FAILED:", error);
    process.exit(1);
  });
