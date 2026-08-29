import { type ChildProcess, spawn as spawnChild } from "node:child_process";
import { createWriteStream, existsSync, statSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { spawn as bunSpawn, Glob, type Subprocess } from "bun";
import { killListenersOnPort } from "@/test/helpers/port-helpers";
import { deduplicateLines, renderProgressBar, stripAnsiCodes } from "@/test/scripts/runner-helpers";

const DEFAULT_PORT = 3066;
const DEFAULT_TEST_PATH = "frontend/graphql/test/";
const SERVER_READY_TIMEOUT_MS = 180_000;
const TUI_REFRESH_INTERVAL_MS = 250;

interface CliOptions {
  port: number;
  bail: boolean;
  coverage: boolean;
  e2e: boolean;
  testPaths: string[];
  help: boolean;
}

interface TestState {
  startTime: number;
  currentFile: string;
  currentTest: string;
  passedTests: number;
  failedTests: number;
  totalExpects: number;
  totalFilesScheduled: number;
  filesPassed: Set<string>;
  filesFailed: Set<string>;
  completedFiles: Set<string>;
  lastServerAction: string;
  failureReason: string;
  failingFile: string;
  failingTest: string;
  serverWarnings: Map<string, number>;
  serverErrors: Map<string, number>;
  rawTestOutput: string[];
}

async function discoverTestFiles(testPaths: string[]): Promise<string[]> {
  const files: string[] = [];
  for (const p of testPaths) {
    if (!existsSync(p)) continue;
    const st = statSync(p);
    if (st.isDirectory()) {
      const glob = new Glob("**/*.test.{ts,tsx}");
      for (const file of glob.scanSync({ cwd: p })) {
        files.push(join(p, file));
      }
    } else if (p.endsWith(".test.ts") || p.endsWith(".test.tsx")) {
      files.push(p);
    }
  }
  return files;
}

function parseCliArgs(args: string[]): CliOptions {
  let port = DEFAULT_PORT;
  let bail = true;
  let coverage = false;
  let e2e = false;
  const testPaths: string[] = [];
  let help = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (
      arg === "test" ||
      arg === "run" ||
      arg.endsWith("run-server-tests.ts") ||
      arg.endsWith("run-graphql-tests.ts")
    ) {
      continue;
    }
    if (arg === "-h" || arg === "--help") {
      help = true;
    } else if (arg === "--port" && i + 1 < args.length) {
      port = Number(args[++i]) || DEFAULT_PORT;
    } else if (arg === "--no-bail") {
      bail = false;
    } else if (arg === "--coverage" || arg === "-c") {
      coverage = true;
    } else if (arg === "--e2e") {
      e2e = true;
    } else if (arg.startsWith("--port=")) {
      port = Number(arg.split("=")[1]) || DEFAULT_PORT;
    } else if (!arg.startsWith("-")) {
      testPaths.push(arg);
    }
  }

  if (testPaths.length === 0) {
    testPaths.push(DEFAULT_TEST_PATH);
  }

  if (testPaths.some(p => p.includes("test/ui/e2e") || p.includes("test/ui/"))) {
    e2e = true;
  }

  return { port, bail, coverage, e2e, testPaths, help };
}

function printHelp(): void {
  process.stdout.write(`
run-server-tests.ts - Unified Clean TUI Runner for GraphQL Integration & E2E Tests

USAGE:
  bun run test/scripts/run-server-tests.ts [options] [test-files...]

OPTIONS:
  --port <number>     Port for the dedicated test server (default: ${DEFAULT_PORT})
  --e2e               Run E2E suite with Playwright preloads and 5-min timeout
  --coverage, -c      Run tests with coverage instrumentation
  --no-bail           Do not stop immediately on first test failure (default: bails on error)
  -h, --help          Show this help message

EXAMPLES:
  # Run all GraphQL integration tests:
  bun run test:graphql

  # Run all E2E tests:
  bun run test:ui:e2e

  # Run a specific test file:
  bun run test:graphql frontend/graphql/test/auth/impersonation.test.ts
\n`);
}

async function pollServerReady(url: string, deadline: number): Promise<boolean> {
  if (Date.now() >= deadline) return false;
  try {
    const res = await fetch(url, { method: "HEAD" });
    if (res.status === 204) return true;
  } catch {
    // Server not ready yet
  }
  await new Promise(resolve => setTimeout(resolve, 500));
  return pollServerReady(url, deadline);
}

/**
 * Returns a copy of process.env with DB-related vars dropped, so the spawned
 * `next dev --env-file=<envFile>` is the sole source of truth for DB config.
 * Without this, `bun` auto-loads `.env` (dev env) into process.env, and the
 * spread would override the test env file DB settings.
 */
function buildDbEnv(): Record<string, string | undefined> {
  const env = { ...process.env } as Record<string, string | undefined>;
  delete env.DATABASE_URL;
  delete env.DB_FILE_NAME;
  delete env.DB_PROVIDER;
  delete env.DB_CONNECTION_MODE;
  return env;
}

function spawnTestServer(port: number, logStream: NodeJS.WritableStream): ChildProcess {
  const bunBin = process.execPath;
  const envFile = process.env.TEST_ENV_FILE ?? ".env.test";
  const isProductionMode = process.env.TEST_SERVER_MODE === "production";
  const distDir = isProductionMode ? ".next-test-prod" : ".next-test-dev";
  const nodeEnv = isProductionMode ? "production" : "development";

  // Drop DB env vars from the parent process so the spawned `next dev --env-file=.env.test`
  // is the sole source of truth. Without this, `bun` auto-loads `.env` (the dev env
  // pointing at the `kottaby` DB) into process.env, and the spread below would override
  // the `.env.test` DATABASE_URL (pointing at `kottaby_test`), causing tests to run
  // against the wrong database.
  const parentEnv = buildDbEnv();

  const serverEnv: NodeJS.ProcessEnv = {
    ...parentEnv,
    NODE_ENV: nodeEnv,
    NEXT_DIST_DIR: distDir,
    IS_DEMO: "true",
    TEST_SERVER: "1",
    PORT: String(port),
    GRAPHQL_TEST_PORT: String(port),
    TEST_SERVER_PORT: String(port),
    DISABLE_RATE_LIMITING: "true",
  };

  const args = isProductionMode
    ? [`--env-file=${envFile}`, "run", "next", "start", "-p", String(port), "-H", "0.0.0.0"]
    : [`--env-file=${envFile}`, "run", "next", "dev", "--turbopack", "-p", String(port), "-H", "0.0.0.0"];

  const proc = spawnChild(bunBin, args, {
    cwd: process.cwd(),
    env: serverEnv,
    stdio: ["ignore", "pipe", "pipe"],
    // Own process group: `next dev` spawns a `next-server` child that owns
    // the listen socket. In the DEFAULT group the child would SURVIVE the
    // wrapper's SIGKILL (orphaned, still bound to the port) and the NEXT
    // runner invocation dies with EADDRINUSE — cleanup signals the whole
    // group via negative pid (see cleanup below).
    detached: true,
  });

  proc.stdout?.pipe(logStream, { end: false });
  proc.stderr?.pipe(logStream, { end: false });

  return proc;
}

function renderTuiFrame(state: TestState, port: number, isTty: boolean): void {
  if (!isTty) return;

  const elapsed = ((performance.now() - state.startTime) / 1000).toFixed(1);
  const width = Math.min(80, process.stdout.columns || 80);
  const rule = "─".repeat(width);

  const file = state.currentFile.length > 55 ? `...${state.currentFile.slice(-52)}` : state.currentFile;
  const test = state.currentTest.length > 55 ? `${state.currentTest.slice(0, 52)}...` : state.currentTest;
  const action =
    state.lastServerAction.length > 55 ? `${state.lastServerAction.slice(0, 52)}...` : state.lastServerAction;

  const filesDone = state.completedFiles.size;
  const totalFiles = Math.max(filesDone, state.totalFilesScheduled);
  const progressBar = renderProgressBar(filesDone, totalFiles);

  let out = "\x1b[H\x1b[0J";
  out += `\x1b[36m\x1b[1m⚡ Kottaby Test Runner\x1b[0m \x1b[90m[Port ${port}]\x1b[0m \x1b[33m${elapsed}s elapsed\x1b[0m\n`;
  out += `\x1b[90m${rule}\x1b[0m\n`;
  out += `  \x1b[1m📁 File:\x1b[0m    \x1b[34m${file || "Starting..."}\x1b[0m\n`;
  out += `  \x1b[1m▶ Test:\x1b[0m    \x1b[37m${test || "Initializing..."}\x1b[0m\n`;
  const assertsBadge = state.totalExpects > 0 ? ` • \x1b[90m${state.totalExpects} asserts\x1b[0m` : "";
  out += `  \x1b[1m📊 Tests:\x1b[0m   \x1b[32m${state.passedTests} passed\x1b[0m • \x1b[31m${state.failedTests} failed\x1b[0m${assertsBadge}\n`;
  out += `  \x1b[1m📦 Files:\x1b[0m   ${progressBar}\n`;
  out += `  \x1b[1m📡 Server:\x1b[0m  \x1b[90m${action || "Idle"}\x1b[0m\n`;
  out += `\x1b[90m${rule}\x1b[0m\n`;

  process.stdout.write(out);
}

function parseServerChunk(chunk: Buffer | string): string {
  const text = chunk.toString();
  const lines = text.split("\n").filter(l => l.trim());
  if (lines.length === 0) return "";
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (line.includes("POST /api/graphql") || line.includes("HEAD /api/graphql")) {
      return line.replace(/^.*?((?:POST|HEAD) \/api\/graphql.*)$/, "$1");
    }
    if (line.includes("Executed resolver")) {
      return line.replace(/^.*?Executed resolver (.*? in .*)$/, "$1");
    }
  }
  return lines[lines.length - 1].slice(0, 60);
}

function formatLogMap(map: Map<string, number>, label: string, colorCode: string): string {
  if (map.size === 0) return "";
  let out = `\n${colorCode}\x1b[1m${label}\x1b[0m\n`;
  out += `────────────────────────────────────────────────────────────────────────────────\n`;
  for (const [msg, count] of map.entries()) {
    const countBadge = count > 1 ? ` \x1b[33m(x${count} occurrences)\x1b[0m` : "";
    out += `  • ${msg}${countBadge}\n`;
  }
  return out;
}

function stripLogPrefix(line: string, tag: string): string {
  const idx = line.indexOf(tag);
  if (idx === -1) return line;
  return line.slice(idx + tag.length).replace(/^\s+/, "");
}

function stripJsonObjectSuffix(line: string): string {
  const braceIdx = line.indexOf("{");
  if (braceIdx === -1) return line.trim();
  return line.slice(0, braceIdx).trimEnd().trim();
}

function recordServerLogs(chunk: Buffer | string, state: TestState): void {
  const text = chunk.toString();
  const lines = text.split("\n");
  for (const line of lines) {
    const clean = line.trim();
    if (!clean) continue;
    if (clean.includes("[WARN]")) {
      const msg = stripJsonObjectSuffix(stripLogPrefix(clean, "[WARN]"));
      if (msg) {
        state.serverWarnings.set(msg, (state.serverWarnings.get(msg) ?? 0) + 1);
      }
    } else if (clean.includes("[ERROR]")) {
      const msg = stripJsonObjectSuffix(stripLogPrefix(clean, "[ERROR]"));
      if (msg) {
        state.serverErrors.set(msg, (state.serverErrors.get(msg) ?? 0) + 1);
      }
    }
  }
}

function formatFinalReport(state: TestState, success: boolean, logPath: string, isTty: boolean): string {
  const elapsed = ((performance.now() - state.startTime) / 1000).toFixed(2);
  const width = Math.min(80, process.stdout.columns || 80);
  const rule = "═".repeat(width);
  const thinRule = "─".repeat(width);

  // Mark currently active file as passed if not failed
  if (state.currentFile && !state.filesFailed.has(state.currentFile)) {
    state.filesPassed.add(state.currentFile);
    state.completedFiles.add(state.currentFile);
  }

  const filesPassedCount = state.filesPassed.size;
  const totalFiles = Math.max(state.completedFiles.size, state.totalFilesScheduled);

  let out = isTty ? "\x1b[H\x1b[0J\n" : "\n";
  out += `${rule}\n`;
  if (success) {
    out += `\x1b[32m\x1b[1m✅ ALL TESTS PASSED\x1b[0m\n`;
    out += `${thinRule}\n`;
    out += `  • \x1b[1mTest Files:\x1b[0m    \x1b[32m${totalFiles} passed\x1b[0m / ${totalFiles} total (100%)\n`;
    out += `  • \x1b[1mTotal Tests:\x1b[0m   \x1b[32m${state.passedTests} passed\x1b[0m (0 failed)\n`;
    if (state.totalExpects > 0) {
      out += `  • \x1b[1mAssertions:\x1b[0m    ${state.totalExpects} expect() calls\n`;
    }
    out += `  • \x1b[1mTotal Time:\x1b[0m    \x1b[33m${elapsed}s\x1b[0m (from runner start to teardown)\n`;
    out += `  • \x1b[1mServer Log:\x1b[0m    \x1b[90m${logPath}\x1b[0m\n`;

    if (state.serverWarnings.size > 0) {
      out += formatLogMap(state.serverWarnings, "⚠️  SERVER WARNINGS (AGGREGATED):", "\x1b[33m");
    }
    if (state.serverErrors.size > 0) {
      out += formatLogMap(state.serverErrors, "❌ SERVER ERRORS (AGGREGATED):", "\x1b[31m");
    }

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
  const errDetails =
    state.failureReason ||
    state.rawTestOutput
      .filter(l => l.includes("fail") || l.includes("error:") || l.includes("Expected") || l.includes("Received"))
      .join("\n") ||
    "Server reported an unhandled exception.";
  out += `${deduplicateLines(errDetails)}\n`;
  out += `${thinRule}\n`;

  if (state.serverWarnings.size > 0) {
    out += formatLogMap(state.serverWarnings, "⚠️  SERVER WARNINGS (AGGREGATED):", "\x1b[33m");
    out += `${thinRule}\n`;
  }
  if (state.serverErrors.size > 0) {
    out += formatLogMap(state.serverErrors, "❌ SERVER ERRORS (AGGREGATED):", "\x1b[31m");
    out += `${thinRule}\n`;
  }

  out += `  • \x1b[1mTest Files:\x1b[0m    \x1b[32m${filesPassedCount} passed\x1b[0m, \x1b[31m${Math.max(1, state.filesFailed.size)} failed\x1b[0m \x1b[90m(${state.completedFiles.size} / ${totalFiles} completed)\x1b[0m\n`;
  out += `  • \x1b[1mTotal Tests:\x1b[0m   \x1b[32m${state.passedTests} passed\x1b[0m, \x1b[31m${Math.max(1, state.failedTests)} failed\x1b[0m\n`;
  if (state.totalExpects > 0) {
    out += `  • \x1b[1mAssertions:\x1b[0m    ${state.totalExpects} expect() calls\n`;
  }
  out += `  • \x1b[1mTotal Time:\x1b[0m    \x1b[33m${elapsed}s\x1b[0m (from runner start to teardown)\n`;
  out += `  • \x1b[1mServer Log:\x1b[0m    \x1b[90m${logPath}\x1b[0m\n`;
  out += `${rule}\n`;

  return out;
}

function isTestFileBoundary(clean: string): boolean {
  return (
    clean.endsWith(".test.ts:") ||
    clean.endsWith(".test.ts") ||
    clean.endsWith(".test.tsx:") ||
    clean.endsWith(".test.tsx")
  );
}

function handleTestFileBoundary(clean: string, state: TestState): void {
  const nextFile = clean.replace(/:$/, "").trim();
  if (state.currentFile && state.currentFile !== nextFile) {
    if (!state.filesFailed.has(state.currentFile)) {
      state.filesPassed.add(state.currentFile);
    }
    state.completedFiles.add(state.currentFile);
  }
  state.currentFile = nextFile;
  state.completedFiles.add(nextFile);
}

function stripTimingSuffix(text: string): string {
  const trimmed = text.trimEnd();
  const bracketIdx = trimmed.lastIndexOf("[");
  if (bracketIdx === -1) return trimmed;
  const suffix = trimmed.slice(bracketIdx + 1);
  if (!suffix.endsWith("]")) return trimmed;
  const inner = suffix.slice(0, -1);
  const lastChar = inner.slice(-1);
  if (lastChar !== "m" && lastChar !== "s") return trimmed;
  const numPart = inner.slice(0, -1);
  return numPart.length > 0 && /^[0-9.]+$/.test(numPart) ? trimmed.slice(0, bracketIdx).trimEnd() : trimmed;
}

function handlePassMatch(clean: string, state: TestState): void {
  state.passedTests++;
  const withoutPrefix = clean.replace(/^(?:✓|\(pass\)|\(fail\))\s+/, "");
  const trimmed = stripTimingSuffix(withoutPrefix);
  state.currentTest = trimmed.trim();
  if (state.currentFile) {
    state.completedFiles.add(state.currentFile);
  }
}

function handleFailMatch(clean: string, state: TestState, onFail: (reason: string) => void): void {
  state.failedTests++;
  state.failingFile = state.currentFile;
  state.failingTest = clean.replace(/^(?:✗|FAIL)\s+/, "").trim();
  if (state.currentFile) {
    state.filesFailed.add(state.currentFile);
    state.completedFiles.add(state.currentFile);
  }
  onFail(clean);
}

function handleSummaryStats(clean: string, state: TestState): boolean {
  const passMatch = /^\s*(\d+)\s+pass/i.exec(clean);
  if (passMatch) {
    state.passedTests = Math.max(state.passedTests, Number.parseInt(passMatch[1], 10));
    return true;
  }

  const failMatch = /^\s*(\d+)\s+fail/i.exec(clean);
  if (failMatch) {
    state.failedTests = Math.max(state.failedTests, Number.parseInt(failMatch[1], 10));
    return true;
  }

  const expectMatch = /^\s*(\d+)\s+expect\(\)\s+calls/i.exec(clean);
  if (expectMatch) {
    state.totalExpects = Number.parseInt(expectMatch[1], 10);
    return true;
  }

  const runMatch = /^\s*Ran\s+(\d+)\s+tests?\s+across\s+(\d+)\s+files?/i.exec(clean);
  if (runMatch) {
    state.passedTests = Math.max(state.passedTests, Number.parseInt(runMatch[1], 10));
    const finishedFileCount = Number.parseInt(runMatch[2], 10);
    if (state.filesFailed.size === 0) {
      for (let i = 0; i < finishedFileCount; i++) {
        state.filesPassed.add(`file-${i}`);
      }
    }
    return true;
  }

  return false;
}

function processTestOutputLine(line: string, state: TestState, onFail: (reason: string) => void): void {
  state.rawTestOutput.push(line);
  const clean = stripAnsiCodes(line).trim();

  if (clean.includes("DeprecationWarning:") || clean.includes("internal:util/deprecate")) {
    return;
  }

  if (isTestFileBoundary(clean)) {
    handleTestFileBoundary(clean, state);
    return;
  }

  if (clean.startsWith("✓ ") || clean.startsWith("(pass) ") || clean.startsWith("(fail) ")) {
    handlePassMatch(clean, state);
    return;
  }

  if (clean.startsWith("✗ ") || clean.startsWith("FAIL ") || clean === "FAIL") {
    if (!state.failingTest) {
      handleFailMatch(clean, state, onFail);
      return;
    }
  }

  const matchedSummary = handleSummaryStats(clean, state);

  if (
    (state.failingTest || state.failedTests > 0 || clean.startsWith("error:")) &&
    clean.length > 0 &&
    !matchedSummary &&
    state.failureReason.length < 6000
  ) {
    state.failureReason += `\n${clean}`;
  }
}

function isReadableStream(stream: unknown): stream is ReadableStream<Uint8Array> {
  return (
    typeof stream === "object" &&
    stream !== null &&
    "getReader" in stream &&
    typeof (stream as Record<string, unknown>).getReader === "function"
  );
}

async function setupTestParser(
  testProc: Subprocess,
  state: TestState,
  onFail: (reason: string) => void
): Promise<void> {
  const handleTestOutput = async (stream: unknown) => {
    if (!isReadableStream(stream)) return;
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    const readLoop = async (): Promise<void> => {
      const { done, value } = await reader.read();
      if (done) return;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        processTestOutputLine(line, state, onFail);
      }
      return readLoop();
    };

    await readLoop();
    if (buffer.length > 0) {
      processTestOutputLine(buffer, state, onFail);
    }
  };

  await Promise.all([handleTestOutput(testProc.stdout), handleTestOutput(testProc.stderr), testProc.exited]);
}

function buildTestArgs(bunBin: string, e2e: boolean, coverage: boolean, bail: boolean, testPaths: string[]): string[] {
  const timeout = e2e ? "300000" : "120000";
  const testEnvFile = process.env.TEST_ENV_FILE ?? ".env.test";
  const args = [bunBin, `--env-file=${testEnvFile}`, "test", "--parallel=1", `--timeout=${timeout}`];
  if (e2e) {
    args.push("--preload", "./test/ui/test-env.ts");
  }
  if (coverage) {
    args.push("--coverage");
  }
  if (bail) {
    args.push("--bail=1");
  }
  args.push(...testPaths);
  return args;
}

function handleServerReadyFailure(port: number, ticker: ReturnType<typeof setInterval>, cleanup: () => void): never {
  clearInterval(ticker);
  cleanup();
  process.stderr.write(
    `\n❌ Dev server failed to respond within ${SERVER_READY_TIMEOUT_MS / 1000}s on port ${port}.\n`
  );
  process.exit(1);
}

async function main(): Promise<void> {
  const { port, bail, coverage, e2e, testPaths, help } = parseCliArgs(process.argv.slice(2));

  if (help) {
    printHelp();
    process.exit(0);
  }

  const scheduledFiles = await discoverTestFiles(testPaths);
  const isTty = process.stdout.isTTY;
  const state: TestState = {
    startTime: performance.now(),
    currentFile: "",
    currentTest: "",
    passedTests: 0,
    failedTests: 0,
    totalExpects: 0,
    totalFilesScheduled: scheduledFiles.length > 0 ? scheduledFiles.length : testPaths.length,
    filesPassed: new Set<string>(),
    filesFailed: new Set<string>(),
    completedFiles: new Set<string>(),
    lastServerAction: "Starting server...",
    failureReason: "",
    failingFile: "",
    failingTest: "",
    serverWarnings: new Map<string, number>(),
    serverErrors: new Map<string, number>(),
    rawTestOutput: [],
  };

  const logDir = join(process.cwd(), "logs");
  await mkdir(logDir, { recursive: true });
  const logFilePath = `logs/next-dev-server-${port}.log`;
  const fullLogPath = join(process.cwd(), logFilePath);

  killListenersOnPort(port);
  const logStream = createWriteStream(fullLogPath, { flags: "w" });
  const serverProc = spawnTestServer(port, logStream);

  if (isTty) {
    process.stdout.write("\x1b[?25l"); // Hide cursor
  }

  let isCleanedUp = false;
  let errorCaptured = false;
  let activeTestProc: Subprocess | undefined;

  const cleanup = () => {
    if (isCleanedUp) return;
    isCleanedUp = true;
    if (isTty) {
      process.stdout.write("\x1b[?25h"); // Restore cursor
    }
    try {
      activeTestProc?.kill();
    } catch {
      // ignore
    }
    // Kill the server's WHOLE process group first (negative pid — covers
    // the detached `next dev` wrapper AND its `next-server` socket owner);
    // the direct-pid kill is the fallback when the group already vanished.
    if (serverProc.pid !== undefined) {
      try {
        process.kill(-serverProc.pid, "SIGKILL");
      } catch {
        // group already gone
      }
    }
    try {
      serverProc.kill("SIGKILL");
    } catch {
      // ignore
    }
    logStream.end();
    // lsof-based sweep: resolves nothing in sandboxes that hide the
    // socket→pid map (the group kill above is the real mechanism there),
    // and guarantees a free port on CI where lsof works.
    killListenersOnPort(port);
  };

  process.on("SIGINT", () => {
    cleanup();
    process.exit(1);
  });
  process.on("SIGTERM", () => {
    cleanup();
    process.exit(1);
  });

  const handleAbort = (reason: string) => {
    errorCaptured = true;
    if (!state.failureReason) {
      state.failureReason = reason;
    }
    state.failingFile = state.failingFile || state.currentFile;
    state.failingTest = state.failingTest || state.currentTest;
    if (state.failingFile) {
      state.filesFailed.add(state.failingFile);
    }
  };

  serverProc.stdout?.on("data", (chunk: Buffer) => {
    recordServerLogs(chunk, state);
    const action = parseServerChunk(chunk);
    if (action) {
      state.lastServerAction = action;
    }
  });

  let serverErrBuffer = "";
  serverProc.stderr?.on("data", (chunk: Buffer) => {
    recordServerLogs(chunk, state);
    const text = chunk.toString();
    serverErrBuffer += text;
    if (text.includes("FatalError") || text.includes("panic:") || text.includes("Segmentation fault")) {
      handleAbort(serverErrBuffer.trim());
    }
  });

  serverProc.on("exit", (code, signal) => {
    if (!isCleanedUp && !errorCaptured && code !== 0 && code !== null) {
      handleAbort(`Dev server exited unexpectedly (code: ${code}, signal: ${signal})\n${serverErrBuffer}`);
    }
  });

  const ticker = setInterval(() => renderTuiFrame(state, port, isTty), TUI_REFRESH_INTERVAL_MS);

  try {
    state.lastServerAction = "Waiting for server to become ready...";
    renderTuiFrame(state, port, isTty);

    const isReady = await pollServerReady(`http://localhost:${port}/api/graphql`, Date.now() + SERVER_READY_TIMEOUT_MS);

    if (!isReady) {
      handleServerReadyFailure(port, ticker, cleanup);
    }

    state.lastServerAction = "Server ready. Executing tests...";

    const testArgs = buildTestArgs(process.execPath, e2e, coverage, bail, testPaths);

    const isProductionMode = process.env.TEST_SERVER_MODE === "production";
    const distDir = isProductionMode ? ".next-test-prod" : ".next-test-dev";
    const serverMode = isProductionMode ? "production" : "dev";

    const testProc = bunSpawn(testArgs, {
      cwd: process.cwd(),
      env: {
        ...buildDbEnv(),
        KOTTABY_TEST_RUNNER_OK: "1",
        GRAPHQL_TEST_PORT: String(port),
        TEST_SERVER_PORT: String(port),
        TEST_SERVER_MODE: serverMode,
        TEST_E2E_WARMUP: e2e ? "1" : "0",
        NEXT_DIST_DIR: distDir,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    activeTestProc = testProc;

    await setupTestParser(testProc, state, reason => handleAbort(reason));

    const exitCode = await testProc.exited;
    clearInterval(ticker);
    cleanup();

    const isSuccess = exitCode === 0 && state.filesFailed.size === 0 && state.failedTests === 0;
    const report = formatFinalReport(state, isSuccess, logFilePath, isTty);
    process.stdout.write(report);
    process.exit(isSuccess ? 0 : 1);
  } catch (err) {
    clearInterval(ticker);
    cleanup();
    state.failureReason = err instanceof Error ? err.message : String(err);
    process.stdout.write(formatFinalReport(state, false, logFilePath, isTty));
    process.exit(1);
  }
}

main().catch(err => {
  process.stderr.write(`[run-server-tests] Fatal error: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
