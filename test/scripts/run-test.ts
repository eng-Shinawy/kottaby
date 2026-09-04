import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, relative, sep } from "node:path";
import { loadTestEnvFile, withProcessLock } from "@/scripts/lib";

const BUN_BIN = join(homedir(), ".bun", "bin", "bun");
const PROJECT_ROOT = process.cwd();
const LOGS_DIR = join(PROJECT_ROOT, "logs");
const FEEDBACK_DIR = join(PROJECT_ROOT, "test", "scripts", "feedback");

function logInfo(message: string): void {
  process.stderr.write(`[run-test] ${message}\n`);
}

function logError(message: string): void {
  process.stderr.write(`[run-test] ERROR: ${message}\n`);
}

function formatTimestampDir(date: Date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const seconds = String(date.getSeconds()).padStart(2, "0");
  return `${year}-${month}-${day}T${hours}-${minutes}-${seconds}`;
}

function formatTimestampFile(date: Date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const seconds = String(date.getSeconds()).padStart(2, "0");
  const ms = String(date.getMilliseconds()).padStart(3, "0");
  return `${year}-${month}-${day}T${hours}-${minutes}-${seconds}-${ms}`;
}

function printHelp(): void {
  const help = `
run-test.ts - Run bun tests with log capture

USAGE
  bun run test/scripts/run-test.ts [flags] <test-path>

DESCRIPTION
  Runs bun test for a given file or directory, captures the full output,
  and saves it to logs/<timestamp>/<relative-path>.log for later retrieval.

FLAGS
  -h, --help          Print this help message and exit
  --last              Show the last test result for the given path
                      (optimized for AI agent consumption)
  --focus <str>       Used with --last: filter output to tests matching <str>
                      (case-insensitive substring match on test names)
  --feedback <text>   Submit feedback about this script (saves to feedback/ dir)
  --context <text>    Optional context for --feedback (why the feedback matters)
  --list-feedback     List all open feedback items

ARGUMENTS
  <test-path>         Path to a test file or directory, relative to project root

EXAMPLES
  bun run test/scripts/run-test.ts backend/db/test/repo/parent.repository.test.ts
  bun run test/scripts/run-test.ts --last backend/db/test/repo/parent.repository.test.ts
  bun run test/scripts/run-test.ts --last --focus "deactivateParent" backend/db/test/repo/parent.repository.test.ts
  bun run test/scripts/run-test.ts --feedback "The --last output should include test duration" --context "When debugging slow tests, knowing duration helps prioritize"
  bun run test/scripts/run-test.ts --list-feedback
  bun run test/scripts/run-test.ts -h
`;
  process.stdout.write(help);
}

interface ParsedArgs {
  help: boolean;
  last: boolean;
  focus: string | null;
  feedback: string | null;
  context: string | null;
  listFeedback: boolean;
  testPath: string | null;
}

function requireStringArg(args: string[], index: number, flagName: string): string {
  if (index + 1 < args.length) {
    return args[index + 1];
  }
  logError(`${flagName} requires a string argument`);
  process.exit(1);
  return "";
}

function parseArgs(args: string[]): ParsedArgs {
  let help = false;
  let last = false;
  let focus: string | null = null;
  let feedback: string | null = null;
  let context: string | null = null;
  let shouldListFeedback = false;
  let testPath: string | null = null;

  let i = 0;
  while (i < args.length) {
    const arg = args[i];
    if (arg === "-h" || arg === "--help") {
      help = true;
    } else if (arg === "--last") {
      last = true;
    } else if (arg === "--focus") {
      focus = requireStringArg(args, i, "--focus");
      i++;
    } else if (arg === "--feedback") {
      feedback = requireStringArg(args, i, "--feedback");
      i++;
    } else if (arg === "--context") {
      context = requireStringArg(args, i, "--context");
      i++;
    } else if (arg === "--list-feedback") {
      shouldListFeedback = true;
    } else if (!arg.startsWith("-")) {
      testPath = arg;
    } else {
      logError(`Unknown flag: ${arg}`);
      process.exit(1);
    }
    i++;
  }

  return { help, last, focus, feedback, context, listFeedback: shouldListFeedback, testPath };
}

async function runTest(testPath: string): Promise<number> {
  if (testPath.includes("frontend/graphql/test") || testPath.includes("test/ui/e2e")) {
    const proc = Bun.spawn([BUN_BIN, "run", "test/scripts/run-server-tests.ts", testPath], {
      stdout: "inherit",
      stderr: "inherit",
      env: { ...process.env, KOTTABY_TEST_RUNNER_OK: "1" },
      cwd: PROJECT_ROOT,
    });
    return await proc.exited;
  }

  const timestamp = formatTimestampDir();
  const logDir = join(LOGS_DIR, timestamp);
  const relativePath = relative(PROJECT_ROOT, testPath);
  const logFile = join(logDir, `${relativePath}.log`);
  const logFileDir = join(logDir, relativePath.split(sep).slice(0, -1).join(sep));

  mkdirSync(logFileDir, { recursive: true });

  logInfo(`Running: bun test ${testPath}`);

  const proc = Bun.spawn([BUN_BIN, "--env-file=.env.test", "test", testPath, "--timeout=60000"], {
    stdout: "pipe",
    stderr: "pipe",
    // PIN DATABASE_URL to the TEST database explicitly (dotenv precedence:
    // an explicitly-set env var beats Bun's auto-loaded cwd `.env`, which
    // would otherwise silently point single-file runs at the DEV database).
    env: {
      ...process.env,
      DATABASE_URL: loadTestEnvFile().DATABASE_URL,
      FORCE_COLOR: "0",
      NODE_ENV: "test",
      KOTTABY_TEST_RUNNER_OK: "1",
    },
    cwd: PROJECT_ROOT,
  });

  const stdoutText = await new Response(proc.stdout).text();
  const stderrText = await new Response(proc.stderr).text();
  const exitCode = await proc.exited;

  const combinedOutput = stdoutText + "\n" + stderrText;

  writeFileSync(logFile, combinedOutput, "utf8");
  logInfo(`Log saved to: ${logFile}`);

  process.stdout.write(combinedOutput);

  return exitCode;
}

interface ParsedResult {
  exitCode: number;
  passes: number;
  fails: number;
  failedTests: string[];
  errorDetails: Map<string, string[]>;
  logFilePath: string;
}

const ANSI_RE = new RegExp(`${String.fromCharCode(27)}\\[[\\d;]{0,20}m`, "g");

function stripAnsi(str: string): string {
  return str.replace(ANSI_RE, "");
}

function findLatestLog(testPath: string): string | null {
  if (!existsSync(LOGS_DIR)) return null;

  const relativePath = relative(PROJECT_ROOT, testPath);
  const expectedLogName = `${relativePath}.log`;

  const timestampDirs = readdirSync(LOGS_DIR)
    .filter(entry => {
      const fullPath = join(LOGS_DIR, entry);
      return existsSync(fullPath) && existsSync(`${fullPath}${sep}`) ? true : existsSync(fullPath);
    })
    .toSorted((a, b) => a.localeCompare(b))
    .toReversed();

  for (const tsDir of timestampDirs) {
    const candidate = join(LOGS_DIR, tsDir, expectedLogName);
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

const FAIL_INDICATORS = ["\u2717", "\u00D7", "FAIL", "(fail)"];

function isSummaryLine(trimmed: string): boolean {
  return /^\d+\s+(pass|fail|expect)/.test(trimmed);
}

function applyFocusFilter(result: ParsedResult, focusStr: string): void {
  const lowerFocus = focusStr.toLowerCase();
  result.failedTests = result.failedTests.filter(name => name.toLowerCase().includes(lowerFocus));
  const filteredErrors = new Map<string, string[]>();
  for (const [name, details] of result.errorDetails) {
    if (name.toLowerCase().includes(lowerFocus)) {
      filteredErrors.set(name, details);
    }
  }
  result.errorDetails = filteredErrors;
}

function extractTestName(trimmed: string): string {
  let testName = trimmed;
  for (const ind of FAIL_INDICATORS) {
    testName = testName.replace(ind, "");
  }
  testName = testName.replace(/^\(fail\)\s*/, "").trim();
  return testName;
}

function isFailResultLine(trimmed: string): boolean {
  return trimmed.startsWith("(fail)");
}

function isPassResultLine(trimmed: string): boolean {
  return trimmed.startsWith("(pass)");
}

interface FailEntry {
  testName: string;
  errorStartLine: number;
  failLineIndex: number;
}

function isResultOrSummaryLine(trimmed: string): boolean {
  return isFailResultLine(trimmed) || isPassResultLine(trimmed) || isSummaryLine(trimmed);
}

const CODE_SNIPPET_RE = /^\s*\d+\s*\|/;

function isErrorContentLine(lineStr: string): boolean {
  const trimmed = lineStr.trim();
  return (
    CODE_SNIPPET_RE.test(lineStr) ||
    trimmed.startsWith("error:") ||
    trimmed.startsWith("Expected") ||
    trimmed.startsWith("Received") ||
    trimmed.startsWith("-") ||
    trimmed.startsWith("+") ||
    trimmed.startsWith("{") ||
    /^\s*at\s/.test(trimmed)
  );
}

function collectErrorDetails(lines: string[], entry: FailEntry): string[] {
  const detailLines: string[] = [];
  let started = false;
  for (let i = entry.errorStartLine; i < entry.failLineIndex; i++) {
    if (!started && isErrorContentLine(lines[i])) {
      started = true;
    }
    if (started) {
      detailLines.push(lines[i].trimEnd());
    }
  }
  return detailLines;
}

function computeErrorStartLines(failEntries: FailEntry[], sortedResultIndices: number[]): void {
  for (let fi = 0; fi < failEntries.length; fi++) {
    const entry = failEntries[fi];
    const resultPosition = sortedResultIndices.indexOf(entry.failLineIndex);
    entry.errorStartLine = resultPosition > 0 ? sortedResultIndices[resultPosition - 1] + 1 : 0;
  }
}

interface ScanResult {
  passes: number;
  fails: number;
  failEntries: FailEntry[];
  resultLineIndices: number[];
}

function scanLines(lines: string[]): ScanResult {
  let passes = 0;
  let fails = 0;
  const failEntries: FailEntry[] = [];
  const resultLineIndices: number[] = [];

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();

    const passMatch = /^(\d+)\s+pass/.exec(trimmed);
    if (passMatch) passes = Number.parseInt(passMatch[1], 10);

    const failMatch = /^(\d+)\s+fail/.exec(trimmed);
    if (failMatch) fails = Number.parseInt(failMatch[1], 10);

    if (isResultOrSummaryLine(trimmed)) resultLineIndices.push(i);

    if (isFailResultLine(trimmed)) {
      const testName = extractTestName(trimmed);
      if (testName) failEntries.push({ testName, errorStartLine: -1, failLineIndex: i });
    }
  }

  return { passes, fails, failEntries, resultLineIndices };
}

function parseTestLog(logContent: string, logFilePath: string, focusStr: string | null): ParsedResult {
  const clean = stripAnsi(logContent);
  const lines = clean.split(/\r?\n/);

  const { passes, fails, failEntries, resultLineIndices } = scanLines(lines);

  const sortedResultIndices = [...resultLineIndices].toSorted((a, b) => a - b);
  computeErrorStartLines(failEntries, sortedResultIndices);

  const failedTests: string[] = [];
  const errorDetails = new Map<string, string[]>();

  for (const entry of failEntries) {
    failedTests.push(entry.testName);
    const detailLines = collectErrorDetails(lines, entry);
    if (detailLines.some(l => l.trim() !== "")) {
      errorDetails.set(entry.testName, detailLines);
    }
  }

  const exitCode = fails === 0 && failedTests.length === 0 ? 0 : 1;
  const result: ParsedResult = {
    exitCode,
    passes,
    fails,
    failedTests,
    errorDetails,
    logFilePath,
  };

  if (focusStr) {
    applyFocusFilter(result, focusStr);
  }

  return result;
}

function appendFailedTestLines(lines: string[], result: ParsedResult): void {
  for (const name of result.failedTests) {
    lines.push(`  - ${name} [FAIL]`);
    const details = result.errorDetails.get(name);
    if (details && details.length > 0) {
      for (const detailLine of details) {
        lines.push(`    ${detailLine}`);
      }
    }
  }
}

function showLastResult(testPath: string, focusStr: string | null): void {
  const logFile = findLatestLog(testPath);

  if (!logFile) {
    process.stdout.write(`No previous test run found for: ${testPath}\n`);
    process.exit(1);
    return;
  }

  const logContent = readFileSync(logFile, "utf8");
  const result = parseTestLog(logContent, logFile, focusStr);

  const relativePath = relative(PROJECT_ROOT, testPath);
  const lines: string[] = [];

  lines.push("=== Last Test Result ===");
  lines.push(`Test File: ${relativePath}`);
  lines.push(`Exit Code: ${result.exitCode}`);
  lines.push(`Pass: ${result.passes}`);
  lines.push(`Fail: ${result.fails}`);

  if (result.failedTests.length > 0) {
    lines.push("");
    lines.push("Failed Tests:");
    appendFailedTestLines(lines, result);
  } else if (result.exitCode === 0) {
    lines.push("");
    lines.push("Status: ALL PASSED");
  } else {
    lines.push("");
    lines.push("Status: FAILED (no individual test failures parsed — check full log)");
  }

  lines.push("");
  lines.push(`Log File: ${logFile}`);

  process.stdout.write(lines.join("\n") + "\n");
}

function saveFeedback(feedbackText: string, contextText: string | null): void {
  mkdirSync(FEEDBACK_DIR, { recursive: true });

  const now = new Date();
  const timestamp = formatTimestampFile(now);
  const filename = `feedback-${timestamp}.md`;
  const filePath = join(FEEDBACK_DIR, filename);

  const isoTimestamp = now.toISOString();
  const sections: string[] = [
    `# Feedback`,
    ``,
    `**Timestamp**: ${isoTimestamp}`,
    `**Status**: open`,
    ``,
    `## Feedback`,
    ``,
    feedbackText,
  ];

  if (contextText) {
    sections.push("", "## Context", "", contextText);
  }

  sections.push("");

  writeFileSync(filePath, sections.join("\n"), "utf8");
  process.stdout.write(`Feedback saved to: ${filePath}\n`);
}

function extractFeedbackText(content: string): string {
  const sectionStart = content.indexOf("## Feedback");
  if (sectionStart === -1) return "(no text)";

  const afterHeader = content.indexOf("\n\n", sectionStart);
  if (afterHeader === -1) return "(no text)";

  const nextSection = content.indexOf("\n## ", afterHeader + 2);
  const sectionEnd = nextSection !== -1 ? nextSection : content.length;
  return content
    .slice(afterHeader + 2, sectionEnd)
    .trim()
    .split("\n")[0];
}

function getFeedbackFiles(): string[] {
  if (!existsSync(FEEDBACK_DIR)) return [];

  return readdirSync(FEEDBACK_DIR)
    .filter(f => f.startsWith("feedback-") && f.endsWith(".md"))
    .toSorted((a, b) => a.localeCompare(b))
    .toReversed();
}

function listFeedback(): void {
  const files = getFeedbackFiles();

  if (files.length === 0) {
    process.stdout.write("No feedback items found.\n");
    return;
  }

  const lines: string[] = ["=== Feedback Items ===", ""];

  for (const file of files) {
    const content = readFileSync(join(FEEDBACK_DIR, file), "utf8");
    const statusMatch = /\*\*Status\*\*:\s*(\w+)/.exec(content);
    const status = statusMatch ? statusMatch[1] : "unknown";
    const timestampMatch = /\*\*Timestamp\*\*:\s*(.+)/.exec(content);
    const timestamp = timestampMatch ? timestampMatch[1].trim() : "unknown";
    const feedbackText = extractFeedbackText(content);

    lines.push(`File:         ${file}`);
    lines.push(`Timestamp:    ${timestamp}`);
    lines.push(`Status:       ${status}`);
    lines.push(`Feedback:     ${feedbackText}`);
    lines.push("");
  }

  process.stdout.write(lines.join("\n") + "\n");
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const { help, last, focus, feedback, context, listFeedback: showFeedbackList, testPath } = parseArgs(args);

  if (help) {
    printHelp();
    process.exit(0);
    return;
  }

  if (showFeedbackList) {
    listFeedback();
    process.exit(0);
    return;
  }

  if (feedback) {
    saveFeedback(feedback, context);
    process.exit(0);
    return;
  }

  if (!testPath) {
    logError("No test path provided. Use --help for usage.");
    process.exit(1);
    return;
  }

  const resolvedPath = join(PROJECT_ROOT, testPath);

  if (last) {
    showLastResult(testPath, focus);
    return;
  }

  const exitCode = await withProcessLock(`run-test: ${testPath}`, async () => {
    return await runTest(resolvedPath);
  });
  process.exit(exitCode);
}

main().catch((err: unknown) => {
  logError(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
