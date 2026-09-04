/**
 * Shared parallel test runner for all unit, repository, and service test suites.
 * Provides compact, agent-friendly output, bail-on-first-failure, and live TUI progress.
 */
import { availableParallelism } from "node:os";
import { Glob, type Subprocess } from "bun";
import { isTestCi } from "@/backend/lib/test-ci-env";
import { loadTestEnvFile, TEST_ENV_FILE, withProcessLock } from "@/scripts/lib";
import { deduplicateLines, renderProgressBar, stripAnsiCodes } from "@/test/scripts/runner-helpers";

const DEFAULT_TIMEOUT_MS = 60_000;
const TUI_REFRESH_INTERVAL_MS = 200;

export interface RunParallelTestsConfig {
  pattern: string;
  cwd: string;
  maxWorkers: number;
  label: string;
  timeoutMs?: number;
}

export interface TestRunResult {
  passed: number;
  failed: number;
  duration: number;
  errors: Error[];
}

interface CliOptions {
  bail: boolean;
  coverage: boolean;
  timeoutMs?: number;
  filterPaths: string[];
}

interface TestStats {
  passes: number;
  fails: number;
  expects: number;
  tests: number;
}

interface WorkerState {
  activeFile: string;
  activeTest: string;
}

interface RunState {
  startTime: number;
  label: string;
  totalFilesScheduled: number;
  filesCompletedCount: number;
  filesPassedCount: number;
  filesFailedCount: number;
  totalPasses: number;
  totalFails: number;
  totalExpects: number;
  totalTestsRun: number;
  isAborted: boolean;
  failingFile: string;
  failingTest: string;
  failureReason: string;
  rawFailureOutput: string[];
  workers: Map<number, WorkerState>;
}

function parseCliArgs(args: string[]): CliOptions {
  let bail = true;
  let coverage = false;
  let timeoutMs: number | undefined;
  const filterPaths: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--no-bail") {
      bail = false;
    } else if (arg === "--coverage" || arg === "-c") {
      coverage = true;
    } else if (arg.startsWith("--timeout=")) {
      timeoutMs = Number.parseInt(arg.split("=")[1], 10);
    } else if (arg === "--timeout" && i + 1 < args.length) {
      timeoutMs = Number.parseInt(args[++i], 10);
    } else if (!arg.startsWith("-")) {
      filterPaths.push(arg);
    }
  }

  return { bail, coverage, timeoutMs, filterPaths };
}

function extractSummaryStats(line: string, stats: TestStats): boolean {
  const clean = stripAnsiCodes(line).trim();

  const passMatch = /^\s*(\d+)\s+pass/i.exec(clean);
  if (passMatch) {
    stats.passes = Number.parseInt(passMatch[1], 10);
    return true;
  }
  const failMatch = /^\s*(\d+)\s+fail/i.exec(clean);
  if (failMatch) {
    stats.fails = Number.parseInt(failMatch[1], 10);
    return true;
  }
  const expectMatch = /^\s*(\d+)\s+expect\(\)\s+calls/i.exec(clean);
  if (expectMatch) {
    stats.expects = Number.parseInt(expectMatch[1], 10);
    return true;
  }
  const runMatch = /^\s*Ran\s+(\d+)\s+tests?\s+across/i.exec(clean);
  if (runMatch) {
    stats.tests = Number.parseInt(runMatch[1], 10);
    return true;
  }
  return false;
}

function parseTestOutput(combinedOutput: string): { stats: TestStats; failureTrace: string; failingTestName: string } {
  const lines = combinedOutput.split(/\r?\n/);
  const stats: TestStats = { passes: 0, fails: 0, expects: 0, tests: 0 };
  const traceLines: string[] = [];
  let failingTestName = "";
  let isCapturingTrace = false;

  for (const rawLine of lines) {
    const clean = stripAnsiCodes(rawLine).trim();
    if (!clean) continue;

    if (extractSummaryStats(clean, stats)) continue;

    // Filter out common noise
    if (clean.includes("bun test v") || clean.includes("DeprecationWarning:")) continue;
    if (clean.includes("internal:util/deprecate") || clean.includes("node_modules/pg/")) continue;

    if (clean.startsWith("✓ ") || clean.startsWith("(pass) ")) {
      continue;
    }

    if (clean.startsWith("✗ ") || clean.startsWith("(fail) ") || clean.startsWith("FAIL ")) {
      failingTestName = clean.replace(/^(?:✗|\(fail\)|FAIL)\s+/, "").trim();
      isCapturingTrace = true;
      traceLines.push(clean);
      continue;
    }

    if (isCapturingTrace || clean.startsWith("error:") || clean.includes("expect(")) {
      isCapturingTrace = true;
      traceLines.push(rawLine);
    }
  }

  stats.tests = stats.tests || stats.passes + stats.fails;
  return {
    stats,
    failureTrace: traceLines.join("\n"),
    failingTestName,
  };
}

function renderTuiFrame(state: RunState, isTty: boolean): void {
  if (!isTty) return;

  const elapsed = ((performance.now() - state.startTime) / 1000).toFixed(1);
  const width = Math.min(80, process.stdout.columns || 80);
  const rule = "─".repeat(width);

  // Pick the latest active file and test across workers
  let activeFile = "";
  let activeTest = "";
  for (const w of state.workers.values()) {
    if (w.activeFile) {
      activeFile = w.activeFile;
      activeTest = w.activeTest;
    }
  }

  const file = activeFile.length > 55 ? `...${activeFile.slice(-52)}` : activeFile;
  const test = activeTest.length > 55 ? `...${activeTest.slice(-52)}` : activeTest;
  const progressBar = renderProgressBar(state.filesCompletedCount, state.totalFilesScheduled);

  let out = "\x1b[H\x1b[0J";
  out += `\x1b[36m\x1b[1m⚡ Kottaby Test Runner\x1b[0m \x1b[90m[${state.label}]\x1b[0m \x1b[33m${elapsed}s elapsed\x1b[0m\n`;
  out += `\x1b[90m${rule}\x1b[0m\n`;
  out += `  \x1b[1m📁 File:\x1b[0m    \x1b[34m${file || "Starting workers..."}\x1b[0m\n`;
  out += `  \x1b[1m▶ Test:\x1b[0m    \x1b[37m${test || "Initializing..."}\x1b[0m\n`;
  const assertsBadge = state.totalExpects > 0 ? ` • \x1b[90m${state.totalExpects} asserts\x1b[0m` : "";
  out += `  \x1b[1m📊 Tests:\x1b[0m   \x1b[32m${state.totalPasses} passed\x1b[0m • \x1b[31m${state.totalFails} failed\x1b[0m${assertsBadge}\n`;
  out += `  \x1b[1m📦 Files:\x1b[0m   ${progressBar}\n`;
  out += `\x1b[90m${rule}\x1b[0m\n`;

  process.stdout.write(out);
}

function formatFinalReport(state: RunState, success: boolean, isTty: boolean): string {
  const elapsed = ((performance.now() - state.startTime) / 1000).toFixed(2);
  const width = Math.min(80, process.stdout.columns || 80);
  const rule = "═".repeat(width);
  const thinRule = "─".repeat(width);

  let out = isTty ? "\x1b[H\x1b[0J\n" : "\n";
  out += `${rule}\n`;

  if (success) {
    out += `\x1b[32m\x1b[1m✅ ALL TESTS PASSED\x1b[0m\n`;
    out += `${thinRule}\n`;
    out += `  • \x1b[1mTest Files:\x1b[0m    \x1b[32m${state.totalFilesScheduled} passed\x1b[0m / ${state.totalFilesScheduled} total (100%)\n`;
    out += `  • \x1b[1mTotal Tests:\x1b[0m   \x1b[32m${state.totalPasses} passed\x1b[0m (0 failed)\n`;
    if (state.totalExpects > 0) {
      out += `  • \x1b[1mAssertions:\x1b[0m    ${state.totalExpects} expect() calls\n`;
    }
    out += `  • \x1b[1mTotal Time:\x1b[0m    \x1b[33m${elapsed}s\x1b[0m (from runner start to teardown)\n`;
    out += `${rule}\n`;
    return out;
  }

  out += `\x1b[31m\x1b[1m❌ TEST FAILURE DETECTED\x1b[0m\n`;
  out += `${thinRule}\n`;
  if (state.failingFile) {
    out += `  \x1b[1m📁 Failed File:\x1b[0m \x1b[34m${state.failingFile}\x1b[0m\n`;
  }
  if (state.failingTest) {
    out += `  \x1b[1m▶ Failed Test:\x1b[0m \x1b[31m${state.failingTest}\x1b[0m\n`;
  }

  out += `\n\x1b[1m🔍 ERROR DETAILS:\x1b[0m\n`;
  out += `${thinRule}\n`;
  const errDetails = state.failureReason || state.rawFailureOutput.join("\n") || "Process exited with non-zero status.";
  out += `${deduplicateLines(errDetails)}\n`;
  out += `${thinRule}\n`;

  out += `  • \x1b[1mTest Files:\x1b[0m    \x1b[32m${state.filesPassedCount} passed\x1b[0m, \x1b[31m${Math.max(1, state.filesFailedCount)} failed\x1b[0m \x1b[90m(${state.filesCompletedCount} / ${state.totalFilesScheduled} completed)\x1b[0m\n`;
  out += `  • \x1b[1mTotal Tests:\x1b[0m   \x1b[32m${state.totalPasses} passed\x1b[0m, \x1b[31m${Math.max(1, state.totalFails)} failed\x1b[0m\n`;
  if (state.totalExpects > 0) {
    out += `  • \x1b[1mAssertions:\x1b[0m    ${state.totalExpects} expect() calls\n`;
  }
  out += `  • \x1b[1mTotal Time:\x1b[0m    \x1b[33m${elapsed}s\x1b[0m (from runner start to teardown)\n`;
  out += `${rule}\n`;

  return out;
}

async function runSingleTestFile(
  workerId: number,
  file: string,
  timeoutMs: number,
  coverage: boolean,
  bail: boolean,
  state: RunState,
  queue: string[],
  activeProcs: Set<Subprocess>
): Promise<void> {
  if (state.isAborted && bail) return;

  state.workers.set(workerId, { activeFile: file, activeTest: "Running..." });

  try {
    const workerEnv: Record<string, string | undefined> = {
      ...process.env,
      FORCE_COLOR: "1",
      NODE_ENV: "test",
      KOTTABY_TEST_RUNNER_OK: "1",
    };

    if (!isTestCi()) {
      // PIN the worker's database to the TEST database explicitly. Bun
      // auto-loads a cwd `.env` whose values would otherwise fill in any env
      // var the child does not already have — silently pointing test workers
      // at the DEV database (env-file isolation is NOT authoritative for
      // keys the parent unset). An explicitly-set env var beats every env
      // file (dotenv precedence), so this pin is authoritative.
      workerEnv.DATABASE_URL = loadTestEnvFile().DATABASE_URL;
    }

    const bunArgs = ["bun", `--env-file=${TEST_ENV_FILE}`, "test", file, `--timeout=${timeoutMs}`];
    if (coverage) {
      bunArgs.push("--coverage");
    }

    const proc = Bun.spawn(bunArgs, {
      stdout: "pipe",
      stderr: "pipe",
      env: workerEnv,
    });
    activeProcs.add(proc);

    const [stdoutText, stderrText, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    activeProcs.delete(proc);

    const combinedOutput = stdoutText + "\n" + stderrText;
    const { stats, failureTrace, failingTestName } = parseTestOutput(combinedOutput);

    state.totalPasses += stats.passes;
    state.totalFails += stats.fails;
    state.totalExpects += stats.expects;
    state.totalTestsRun += stats.tests;
    state.filesCompletedCount++;

    if (exitCode !== 0 || stats.fails > 0) {
      state.filesFailedCount++;
      state.failingFile = state.failingFile || file;
      state.failingTest = state.failingTest || failingTestName;
      if (failureTrace) {
        state.failureReason = state.failureReason || failureTrace;
      }
      state.rawFailureOutput.push(combinedOutput);

      if (bail) {
        state.isAborted = true;
        queue.length = 0; // Abort remaining tests immediately
      }
    } else {
      state.filesPassedCount++;
    }
  } catch (err: unknown) {
    state.filesCompletedCount++;
    state.filesFailedCount++;
    state.failingFile = state.failingFile || file;
    state.failingTest = state.failingTest || "Process crashed";
    state.failureReason = err instanceof Error ? err.message : String(err);

    if (bail) {
      state.isAborted = true;
      queue.length = 0;
    }
  } finally {
    state.workers.set(workerId, { activeFile: "", activeTest: "" });
  }
}

async function processQueue(
  workerId: number,
  queue: string[],
  timeoutMs: number,
  coverage: boolean,
  bail: boolean,
  state: RunState,
  activeProcs: Set<Subprocess>
): Promise<void> {
  if (state.isAborted && bail) return;

  const file = queue.shift();
  if (!file) return;

  await runSingleTestFile(workerId, file, timeoutMs, coverage, bail, state, queue, activeProcs);

  if (state.isAborted && bail) return;
  return processQueue(workerId, queue, timeoutMs, coverage, bail, state, activeProcs);
}

export async function runParallelTests(config: RunParallelTestsConfig): Promise<TestRunResult> {
  const { pattern, cwd, maxWorkers, label, timeoutMs: defaultTimeout = DEFAULT_TIMEOUT_MS } = config;
  const { bail, coverage, timeoutMs: cliTimeout, filterPaths } = parseCliArgs(process.argv.slice(2));
  const timeoutMs = cliTimeout ?? defaultTimeout;

  return withProcessLock(`test-suite: ${label}`, async () => {
    const glob = new Glob(pattern);
    const discoveredFiles: string[] = [];

    for await (const file of glob.scan({ cwd })) {
      const fullPath = `${cwd}/${file}`;
      if (filterPaths.length > 0) {
        const matches = filterPaths.some(p => fullPath.includes(p) || file.includes(p));
        if (matches) {
          discoveredFiles.push(fullPath);
        }
      } else {
        discoveredFiles.push(fullPath);
      }
    }

    discoveredFiles.sort((a, b) => a.localeCompare(b));
    const totalFiles = discoveredFiles.length;

    if (totalFiles === 0) {
      globalThis.console.log(`\x1b[33mNo test files found matching pattern "${pattern}" in "${cwd}"\x1b[0m`);
      process.exit(0);
    }

    const parallelism = availableParallelism();
    const effectiveWorkers = Math.min(parallelism, totalFiles, maxWorkers);
    const isTty = process.stdout.isTTY && !isTestCi();

    const state: RunState = {
      startTime: performance.now(),
      label,
      totalFilesScheduled: totalFiles,
      filesCompletedCount: 0,
      filesPassedCount: 0,
      filesFailedCount: 0,
      totalPasses: 0,
      totalFails: 0,
      totalExpects: 0,
      totalTestsRun: 0,
      isAborted: false,
      failingFile: "",
      failingTest: "",
      failureReason: "",
      rawFailureOutput: [],
      workers: new Map<number, WorkerState>(),
    };

    if (isTty) {
      process.stdout.write("\x1b[?25l"); // Hide cursor
    }

    const activeProcs = new Set<Subprocess>();
    const cleanup = () => {
      if (isTty) {
        process.stdout.write("\x1b[?25h"); // Restore cursor
      }
      for (const p of activeProcs) {
        try {
          p.kill();
        } catch {
          // ignore
        }
      }
    };

    process.on("SIGINT", () => {
      cleanup();
      process.exit(1);
    });
    process.on("SIGTERM", () => {
      cleanup();
      process.exit(1);
    });

    const ticker = setInterval(() => renderTuiFrame(state, isTty), TUI_REFRESH_INTERVAL_MS);
    renderTuiFrame(state, isTty);

    const queue = [...discoveredFiles];
    const workers: Promise<void>[] = [];

    for (let i = 0; i < effectiveWorkers; i++) {
      workers.push(processQueue(i, queue, timeoutMs, coverage, bail, state, activeProcs));
    }

    await Promise.all(workers);

    clearInterval(ticker);
    cleanup();

    const isSuccess = state.filesFailedCount === 0 && state.totalFails === 0 && !state.isAborted;
    const report = formatFinalReport(state, isSuccess, isTty);
    process.stdout.write(report);

    process.exit(isSuccess ? 0 : 1);
  });
}
