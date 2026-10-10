/**
 * Colocated bun:test suite for the harness report lifecycle module.
 *
 * Pure unit tests — no DB, no network: run directories and report files are
 * created under the repository's gitignored `logs/perf/` scratch tree and
 * removed again in teardown. Security tier proves the redaction contract
 * (credentials/DSNs/cookies never serialize) and path confinement (no tool/run
 * id can traverse outside `logs/perf/`).
 */

import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";

import {
  emitVerdict,
  openRunDirectory,
  PerfReportError,
  type PerfRunContext,
  redactSecrets,
  writeReport,
} from "@/scripts/perf/lib/report";
import type { GateResult } from "@/scripts/perf/lib/stats";

const PERF_LOGS_DIR = join(import.meta.dir, "..", "..", "..", "logs", "perf");
const SECRET_PASSWORD = "s3cret-hunter2-pw";
const SECRET_JWT = ["eyJhbGciOiJIUzI1NiJ9", "eyJzdWIiOiIxMjM0NTY3ODkwIn0", "dozjgNryPFOJ3jAMNHjt1QNWdhF5c4O1XJ0"].join(
  "."
);
const SECRET_VENDOR_KEY = "sk_live_abc123def456ghi789";
const SECRET_COOKIE = "access_token=opaque-opaque-opaque; Path=/; HttpOnly";

const createdRunDirs: string[] = [];

function trackRunDir(runDir: string): void {
  createdRunDirs.push(runDir);
}

function openTrackedRun(tool: string): { runDir: string; runId: string } {
  const opened = openRunDirectory(tool);
  trackRunDir(opened.runDir);
  return opened;
}

function passGate(id: string): GateResult {
  return { id, passed: true, observed: { count: 3, p95: 12 }, breaches: [] };
}

function failGate(id: string, breaches: string[]): GateResult {
  return { id, passed: false, observed: { count: 3, p95: 900 }, breaches };
}

function runContext(runId: string, tool: string): PerfRunContext {
  return { runId, tool, startedAt: "2026-10-09T01:02:03.000Z", args: {} };
}

function isArgsRecord(value: unknown): value is PerfRunContext["args"] {
  return typeof value === "object" && value !== null;
}

function isReportJson(value: unknown): value is { verdict: string; gates: Array<{ id: string; passed: boolean }> } {
  if (typeof value !== "object" || value === null) return false;
  if (!("verdict" in value) || !("gates" in value)) return false;
  return Array.isArray(value.gates);
}

function readReportBodies(runDir: string): { json: unknown; jsonBody: string; markdown: string } {
  const jsonBody = readFileSync(join(runDir, "report.json"), "utf8");
  const markdown = readFileSync(join(runDir, "report.md"), "utf8");
  return { json: JSON.parse(jsonBody), jsonBody, markdown };
}

function captureConsoleLog(action: () => void): string[] {
  const lines: string[] = [];
  const original = console.log;
  console.log = ((...args: unknown[]) => {
    lines.push(args.join(" "));
  }) as typeof console.log;
  try {
    action();
  } finally {
    console.log = original;
  }
  return lines;
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function stampOf(date: Date): string {
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`
  );
}

afterAll(() => {
  for (const runDir of createdRunDirs) {
    rmSync(runDir, { recursive: true, force: true });
  }
});

describe("report: run directory lifecycle", () => {
  test("openRunDirectory creates a timestamped directory under logs/perf (mode 0700)", () => {
    const opened = openTrackedRun("bench-matching");
    expect(opened.runId).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}_bench-matching$/);
    expect(opened.runDir.startsWith(PERF_LOGS_DIR)).toBe(true);
    expect(existsSync(opened.runDir)).toBe(true);
    expect(statSync(opened.runDir).mode & 0o777).toBe(0o700);
  });

  test("same-second collisions are suffixed so directories are never shared", () => {
    const first = openTrackedRun("load-api");
    const second = openTrackedRun("load-api");
    expect(first.runId).not.toBe(second.runId);
    expect(existsSync(first.runDir)).toBe(true);
    expect(existsSync(second.runDir)).toBe(true);
    // Same-second invocation is the normal case → the suffix branch fires;
    // a second-boundary crossing merely yields a fresh timestamp.
    if (first.runId.slice(0, 19) === second.runId.slice(0, 19)) {
      expect(second.runId).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d+_load-api$/);
    }
  });

  test("a pre-existing stamp directory is always avoided, whatever the clock says", () => {
    const now = new Date();
    const precreated = new Set<string>();
    for (let offset = 0; offset < 5; offset += 1) {
      const runId = `${stampOf(new Date(now.getTime() + offset * 1000))}_suffix-probe`;
      const runDir = join(PERF_LOGS_DIR, runId);
      mkdirSync(runDir, { recursive: true, mode: 0o700 });
      precreated.add(runId);
      trackRunDir(runDir);
    }
    const opened = openTrackedRun("suffix-probe");
    expect(precreated.has(opened.runId)).toBe(false);
    expect(existsSync(opened.runDir)).toBe(true);
  });

  test("a fully-occupied same-second suffix ladder is climbed via the atomic-create EEXIST arm", () => {
    // Simulates same-second racers that already took the unsuffixed name and
    // the first two suffixes: the atomic mkdir must fail with EEXIST on each
    // occupied rung and land on the next free one, never sharing a directory.
    const now = Date.now();
    const stamps = [stampOf(new Date(now)), stampOf(new Date(now + 1000))];
    const precreated = new Set<string>();
    for (const stamp of stamps) {
      for (const suffix of ["", "-2", "-3"]) {
        const runId = `${stamp}${suffix}_ladder-probe`;
        const runDir = join(PERF_LOGS_DIR, runId);
        mkdirSync(runDir, { recursive: true, mode: 0o700 });
        precreated.add(runId);
        trackRunDir(runDir);
      }
    }
    const opened = openTrackedRun("ladder-probe");
    expect(precreated.has(opened.runId)).toBe(false);
    expect(stamps.map(stamp => `${stamp}-4_ladder-probe`)).toContain(opened.runId);
    expect(existsSync(opened.runDir)).toBe(true);
  });

  test("invalid tool ids are rejected before any directory is created", () => {
    const invalid = [
      "../evil",
      "..",
      ".",
      "",
      "a/b",
      "UPPER",
      "with space",
      "-leading-dash",
      `too-long-${"a".repeat(60)}`,
    ];
    for (const tool of invalid) {
      expect(() => openRunDirectory(tool)).toThrow(PerfReportError);
    }
    expect(existsSync(join(PERF_LOGS_DIR, "..", "evil"))).toBe(false);
    expect(existsSync(join(PERF_LOGS_DIR, "evil"))).toBe(false);
  });
});

describe("report: report writers", () => {
  test("writeReport persists report.json + report.md with the full contract shape", () => {
    const opened = openTrackedRun("verify-indexes");
    const ctx = runContext(opened.runId, "verify-indexes");
    writeReport(ctx, [passGate("fk-coverage")], { environment: { db: "kottaby_test", serverMode: "production" } });

    const { json, jsonBody, markdown } = readReportBodies(opened.runDir);
    expect(json).toEqual({
      tool: "verify-indexes",
      runId: opened.runId,
      startedAt: ctx.startedAt,
      args: {},
      gates: [passGate("fk-coverage")],
      sections: { environment: { db: "kottaby_test", serverMode: "production" } },
      verdict: "PASS",
    });
    expect(jsonBody).toContain("kottaby_test");
    expect(markdown).toContain("# Performance Run Report");
    expect(markdown).toContain("- **Tool:** verify-indexes");
    expect(markdown).toContain("## Gates");
    expect(markdown).toContain("| fk-coverage | PASS | — |");
    expect(markdown).toContain("## environment");
    expect(statSync(join(opened.runDir, "report.json")).mode & 0o777).toBe(0o600);
    expect(statSync(join(opened.runDir, "report.md")).mode & 0o777).toBe(0o600);
  });

  test("failed gates flip the recorded verdict and render breaches in the table", () => {
    const opened = openTrackedRun("analyze-queries");
    writeReport(
      runContext(opened.runId, "analyze-queries"),
      [passGate("plan-cost"), failGate("seq-scan", ["session_request seq scan 5000 rows"])],
      {}
    );
    const { json, markdown } = readReportBodies(opened.runDir);
    expect(json).toEqual(expect.objectContaining({ verdict: "FAIL" }));
    expect(markdown).toContain("| seq-scan | FAIL | session_request seq scan 5000 rows |");
    expect(markdown).toContain("- **Verdict:** FAIL");
  });

  test("arguments are echoed into both files, including huge counts", () => {
    const opened = openTrackedRun("load-api");
    writeReport({ ...runContext(opened.runId, "load-api"), args: { vus: 1e9, durationS: 120, gateMs: 500 } }, [], {});
    const { jsonBody, markdown } = readReportBodies(opened.runDir);
    expect(jsonBody).toContain('"vus": 1000000000');
    expect(markdown).toContain("`--vus` = 1000000000");
    expect(markdown).toContain("`--gateMs` = 500");
  });

  test("unicode and RTL section titles round-trip through both report files", () => {
    const opened = openTrackedRun("load-ws");
    writeReport(runContext(opened.runId, "load-ws"), [passGate("بوابة-الاتصال")], {
      "التقارير العربية 📊": { p95: 42 },
      日本語のセクション: [1, 2, 3],
    });
    const { jsonBody, markdown } = readReportBodies(opened.runDir);
    expect(jsonBody).toContain("التقارير العربية 📊");
    expect(markdown).toContain("## التقارير العربية 📊");
    expect(markdown).toContain("بوابة-الاتصال");
    expect(markdown).toContain("## 日本語のセクション");
  });

  test("malformed run contexts are rejected before any file is written", () => {
    const opened = openTrackedRun("seed");
    const valid = runContext(opened.runId, "seed");
    expect(() => writeReport({ ...valid, runId: "../../escape" }, [], {})).toThrow(PerfReportError);
    expect(() => writeReport({ ...valid, runId: "2026-10-09T01-02-03_../evil" }, [], {})).toThrow(PerfReportError);
    expect(() => writeReport({ ...valid, runId: "2026-10-09T01-02-03-99999_seed" }, [], {})).toThrow(PerfReportError);
    expect(() => writeReport({ ...valid, startedAt: "not-a-date" }, [], {})).toThrow(PerfReportError);
    const smuggled: unknown = JSON.parse('{"smuggled": {}}');
    expect(() => writeReport({ ...valid, args: isArgsRecord(smuggled) ? smuggled : {} }, [], {})).toThrow(
      PerfReportError
    );
    expect(existsSync(join(opened.runDir, "report.json"))).toBe(false);
    expect(existsSync(join(PERF_LOGS_DIR, "..", "..", "escape"))).toBe(false);
  });

  test("reports are immutable: a second write into the same run directory refuses", () => {
    const opened = openTrackedRun("cleanup");
    const ctx = runContext(opened.runId, "cleanup");
    writeReport(ctx, [passGate("residue")], {});
    expect(() => writeReport(ctx, [passGate("residue")], {})).toThrow(PerfReportError);
    const { json } = readReportBodies(opened.runDir);
    expect(json).toEqual(expect.objectContaining({ verdict: "PASS" }));
  });

  test("concurrent writers all land in distinct run directories with intact reports", async () => {
    const settled = await Promise.allSettled(
      Array.from({ length: 6 }, (_unused, index) => {
        const opened = openTrackedRun("load-ws");
        return Promise.resolve(
          writeReport(runContext(opened.runId, "load-ws"), [passGate(`conn-${index}`)], { v: index })
        ).then(() => opened.runId);
      })
    );
    expect(settled.every(result => result.status === "fulfilled")).toBe(true);
    const runIds = settled.map(result => (result.status === "fulfilled" ? result.value : ""));
    expect(new Set(runIds).size).toBe(6);
    for (const runId of runIds) {
      const { json } = readReportBodies(join(PERF_LOGS_DIR, runId));
      expect(json).toEqual(expect.objectContaining({ verdict: "PASS" }));
    }
  });
});

describe("report: verdict emission", () => {
  test("all-passing gates print VERDICT: PASS and return true", () => {
    const lines = captureConsoleLog(() => {
      expect(emitVerdict([passGate("a"), passGate("b")])).toBe(true);
    });
    expect(lines).toEqual(["VERDICT: PASS"]);
  });

  test("an empty gate list passes vacuously", () => {
    const lines = captureConsoleLog(() => {
      expect(emitVerdict([])).toBe(true);
    });
    expect(lines).toEqual(["VERDICT: PASS"]);
  });

  test("failed gates print VERDICT: FAIL with each gate id and its breaches", () => {
    const lines = captureConsoleLog(() => {
      expect(emitVerdict([passGate("ok"), failGate("p95-500", ["p95 900ms is not below the 500ms limit"])])).toBe(
        false
      );
    });
    expect(lines[0]).toBe("VERDICT: FAIL");
    expect(lines[1]).toContain("[p95-500]");
    expect(lines[1]).toContain("p95 900ms is not below the 500ms limit");
  });

  test("breach lines are redacted too (verdict output is operator-visible)", () => {
    const lines = captureConsoleLog(() => {
      expect(emitVerdict([failGate("cookie-gate", [`minted ${SECRET_COOKIE} leaked into a breach`])])).toBe(false);
    });
    const joined = lines.join("\n");
    expect(joined).not.toContain("opaque-opaque-opaque");
    expect(joined).toContain("[REDACTED]");
  });
});

describe("report: secret redaction", () => {
  test("redactSecrets strips each credential shape", () => {
    expect(redactSecrets(`postgresql://perf_user:${SECRET_PASSWORD}@127.0.0.1:5432/kottaby_test`)).not.toContain(
      SECRET_PASSWORD
    );
    expect(redactSecrets(`Authorization: Bearer opaque-token-value-123`)).not.toContain("opaque-token-value-123");
    expect(redactSecrets(`token = ${SECRET_JWT}`)).not.toContain(SECRET_JWT);
    expect(redactSecrets(`"api_key": "${SECRET_VENDOR_KEY}"`)).not.toContain(SECRET_VENDOR_KEY);
    expect(redactSecrets(`Set-Cookie: ${SECRET_COOKIE}`)).not.toContain("opaque-opaque-opaque");
    expect(redactSecrets(`password=hunter2`)).not.toContain("hunter2");
  });

  test("benign content survives redaction untouched", () => {
    const benign = '{"tool":"load-api","count":4021,"note":"stable run"}';
    expect(redactSecrets(benign)).toBe(benign);
  });

  test("array-valued key-named members stay intact and parseable (EXPLAIN `Sort Key` shape)", () => {
    const planBody = '{"Plan":{"Sort Key":["teacher.id DESC","users.full_name ASC"],"Plan Rows":25}}';
    const redacted = redactSecrets(planBody);
    expect(redacted).toBe(planBody);
    expect(() => JSON.parse(redacted)).not.toThrow();
  });

  test("quoted key-named values still redact (the container exclusion narrows only bare values)", () => {
    const redacted = redactSecrets('{"api_key": "opaque_assignment_value_123"}');
    expect(redacted).not.toContain("opaque_assignment_value_123");
    expect(redacted).toContain("[REDACTED]");
    expect(() => JSON.parse(redacted)).not.toThrow();
  });

  test("PROOF: DSNs, tokens, cookies, and API keys never appear in persisted reports", () => {
    const opened = openTrackedRun("load-api");
    writeReport(
      {
        ...runContext(opened.runId, "load-api"),
        args: { target: `postgresql://perf_user:${SECRET_PASSWORD}@127.0.0.1:5432/kottaby_test` },
      },
      [
        failGate("auth-gate", [`minted cookie ${SECRET_COOKIE} rejected`, `bearer ${SECRET_JWT} expired`]),
        passGate("latency"),
      ],
      {
        identities: {
          adminKey: SECRET_VENDOR_KEY,
          sessionCookie: SECRET_COOKIE,
          dsn: `postgresql://u:${SECRET_PASSWORD}@h/db`,
        },
        note: `password=${SECRET_PASSWORD}`,
      }
    );

    const { jsonBody, markdown } = readReportBodies(opened.runDir);
    for (const body of [jsonBody, markdown]) {
      expect(body).not.toContain(SECRET_PASSWORD);
      expect(body).not.toContain("hunter2");
      expect(body).not.toContain(SECRET_JWT);
      expect(body).not.toContain(SECRET_VENDOR_KEY);
      expect(body).not.toContain("opaque-opaque-opaque");
      expect(body).not.toContain("postgresql://perf_user");
      expect(body).toContain("[REDACTED");
    }

    // The redacted machine report stays parseable and keeps its gate rows.
    const parsed = readReportBodies(opened.runDir).json;
    expect(isReportJson(parsed)).toBe(true);
    if (!isReportJson(parsed)) throw new Error("unreachable: report shape checked above");
    expect(parsed.verdict).toBe("FAIL");
    expect(parsed.gates.map(gate => gate.id)).toEqual(["auth-gate", "latency"]);
    expect(parsed.gates.map(gate => gate.passed)).toEqual([false, true]);
  });
});
