/**
 * Paired self-validation test for the secrets-scan probe — target-list
 * boundaries (empty, missing, non-file), `ProbeLine` emission shape, arg
 * parsing, exit codes, the literal-secret detection inventory (planted
 * literals trip the matching rule; placeholder and env-accessor forms
 * pass), and the never-leak-contents discipline: a target carrying
 * planted secret material is identified by path, line number, and rule
 * only — no emitted line may contain the file's contents.
 */

import { afterAll, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LAUNCH_CHECKLIST } from "@/scripts/launch/launch-checklist";
import { findLiteralSecrets, main, SECRETS_SCAN_ROW_IDS, scanSecretsTargets } from "@/scripts/launch/secrets-scan";
import type { ProbeLine } from "@/scripts/launch/shared/launch-types";

const TARGETS_ROW_ID = "secrets-scan.targets";
const tempRoot = mkdtempSync(join(tmpdir(), "secrets-scan-test-"));

afterAll(() => {
  rmSync(tempRoot, { recursive: true, force: true });
});

/** Creates a target file under the temp root and returns its path. */
function writeTarget(name: string, content: string): string {
  const path = join(tempRoot, name);
  writeFileSync(path, content);
  return path;
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

describe("secrets-scan probe", () => {
  it("pins the mapped-row inventory (the hardcoded-secret row)", () => {
    expect(SECRETS_SCAN_ROW_IDS).toEqual(["4.3.5"]);
  });

  it("keeps the registry row's command and the scanner's own invocation in sync (explicit corpus targets)", () => {
    const registryRow = LAUNCH_CHECKLIST.find(row => row.rowId === "4.3.5");
    expect(registryRow).toBeDefined();
    expect(registryRow?.command).toBe("bun run scripts/launch/secrets-scan.ts .env.example backend/lib/env.ts");
  });

  it("emits one line per target plus the mapped row's line for a clean target", async () => {
    const target = writeTarget("report.json", '{"verdict":"PASS"}');
    const lines = scanSecretsTargets([target]);
    expect(lines).toHaveLength(2);
    expect(lines[0].rowId).toBe(target);
    expect(lines[0].result).toBe("PASS");
    expect(lines[0].detail).toContain("target clean");
    expect(lines[1].rowId).toBe("4.3.5");
    expect(lines[1].result).toBe("PASS");
    expect(lines[1].detail).toContain("corpus clean");

    const out = captureStdout();
    const exit = await main([target], { stdout: out.write });
    expect(exit).toBe(0);
    expect(parseRecordLines(out.lines)).toHaveLength(2);
    expect(out.lines.at(-1)).toContain("secrets-scan: 2 line(s) — 2 PASS, 0 FAIL");
  });

  it("an empty target list is a named FAIL line (never a silent skip)", async () => {
    const lines = scanSecretsTargets([]);
    expect(lines).toHaveLength(1);
    expect(lines[0].rowId).toBe(TARGETS_ROW_ID);
    expect(lines[0].result).toBe("FAIL");
    expect(lines[0].detail).toContain("no target paths given");

    const out = captureStdout();
    const exit = await main([], { stdout: out.write });
    expect(exit).toBe(1);
  });

  it("a missing target is a named FAIL line, fails the mapped row too, and exits non-zero", async () => {
    const missing = join(tempRoot, "does-not-exist.json");
    const lines = scanSecretsTargets([missing]);
    expect(lines).toHaveLength(2);
    expect(lines[0].rowId).toBe(missing);
    expect(lines[0].result).toBe("FAIL");
    expect(lines[0].detail).toContain("target unreadable");
    expect(lines[1].rowId).toBe("4.3.5");
    expect(lines[1].result).toBe("FAIL");
    expect(lines[1].detail).toContain("corpus scan incomplete");

    const out = captureStdout();
    const exit = await main([missing], { stdout: out.write });
    expect(exit).toBe(1);
  });

  it("a directory target is a named FAIL line", () => {
    const dir = join(tempRoot, "a-directory");
    mkdirSync(dir);
    const lines = scanSecretsTargets([dir]);
    expect(lines[0].rowId).toBe(dir);
    expect(lines[0].result).toBe("FAIL");
    expect(lines[0].detail).toContain("not a regular file");
  });
});

describe("secrets-scan literal-secret detection inventory", () => {
  it("a planted env-file literal assignment is a finding (line number + rule, never the value)", async () => {
    const plantedToken = "planted-bearer-value-xyz";
    const target = writeTarget("env-leak.env", `CRON_SECRET=${plantedToken}\nCLEAN_ENTRY=ok\n`);
    const findings = findLiteralSecrets(`CRON_SECRET=${plantedToken}\nCLEAN_ENTRY=ok\n`);
    expect(findings).toEqual([{ line: 1, rule: "env-assignment" }]);

    const out = captureStdout();
    const exit = await main([target], { stdout: out.write });
    expect(exit).toBe(1);
    const emitted = out.lines.join("\n");
    expect(emitted).toContain(target);
    expect(emitted).toContain("1 hardcoded secret literal(s) — first at line 1 (env-assignment)");
    expect(emitted).not.toContain(plantedToken);
  });

  it("a planted code-literal binding to a secret-named identifier is a finding", async () => {
    const target = writeTarget(
      "code-leak.ts",
      'const WEBHOOK_TOKEN = "hardcoded-token-12345";\nconst label = "not a secret name";\n'
    );
    const findings = findLiteralSecrets('const WEBHOOK_TOKEN = "hardcoded-token-12345";\n');
    expect(findings).toEqual([{ line: 1, rule: "code-literal" }]);

    const quotedKeyFindings = findLiteralSecrets('{"PAYMOB_SECRET_KEY": "json-keyed-secret-1"}\n');
    expect(quotedKeyFindings).toEqual([{ line: 1, rule: "code-literal" }]);

    const out = captureStdout();
    const exit = await main([target], { stdout: out.write });
    expect(exit).toBe(1);
    const emitted = out.lines.join("\n");
    expect(emitted).toContain("first at line 1 (code-literal)");
    expect(emitted).not.toContain("hardcoded-token-12345");
  });

  it("a credential-bearing connection URL is a finding even without a secret-named key", async () => {
    const plantedDsn = "postgresql://postgres:planted-password@localhost:5432/kottaby";
    const target = writeTarget("dsn-leak.txt", `DATABASE_URL=${plantedDsn}\n`);
    const findings = findLiteralSecrets(`DATABASE_URL=${plantedDsn}\n`);
    expect(findings).toEqual([{ line: 1, rule: "url-credentials" }]);

    const out = captureStdout();
    const exit = await main([target], { stdout: out.write });
    expect(exit).toBe(1);
    const emitted = out.lines.join("\n");
    expect(emitted).toContain("first at line 1 (url-credentials)");
    expect(emitted).not.toContain("planted-password");
  });

  it("placeholder and env-accessor forms all pass (the accessor discipline holds by construction)", () => {
    const dollar = "$";
    const compliant = [
      "CRON_SECRET=<your-cron-secret-here>",
      'PAYMOB_SECRET_KEY="<your-paymob-secret-key-here>"',
      "GOOGLE_FONTS_API_KEY=",
      "ADMIN_PASSWORD='" + dollar + "{ADMIN_PASSWORD}'",
      "secretKey: nullableSecretEnvValue(process.env.PAYMOB_SECRET_KEY),",
      'if (!getEnv("JWT_ACCESS_SECRET") && config.nodeEnv === "production") {',
      "const DSN = process.env.DATABASE_URL;",
      "DATABASE_URL=postgresql://postgres@127.0.0.1:5432/kottaby",
      "DATABASE_URL=postgresql://<user>:<password>@ep-example.aws.neon.tech/neondb?sslmode=require",
    ].join("\n");
    expect(findLiteralSecrets(compliant)).toEqual([]);
  });

  it("commented template lines are skipped uniformly (documented lexical caveat)", () => {
    const commented = [
      "# CRON_EXTERNAL_SECRET=your-external-cron-secret",
      "# DATABASE_URL=postgresql://<user>:<password>@ep-example.aws.neon.tech/neondb?sslmode=require",
      '* const DOC_SECRET = "docblock prose never counts";',
    ].join("\n");
    expect(findLiteralSecrets(commented)).toEqual([]);
  });

  it("a machine launch report passes the pre-commit scan leg (redacted shape, no secret fields)", async () => {
    const report = [
      '{"rowId":"4.3.5","section":4,"modality":"SCRIPT-PROBE","command":"bun run scripts/launch/secrets-scan.ts .env.example backend/lib/env.ts","exitStatus":0,"result":"PASS","evidenceRef":"logs/<run-stamp>/secrets-scan.log","timestamp":"2026-10-09T00:00:00Z"}',
    ].join("\n");
    const target = writeTarget("launch-report.json", report);
    const out = captureStdout();
    const exit = await main([target], { stdout: out.write });
    expect(exit).toBe(0);
    expect(parseRecordLines(out.lines)[0]?.result).toBe("PASS");
  });

  it("--help prints usage and exits 0", async () => {
    const out = captureStdout();
    const exit = await main(["--help"], { stdout: out.write });
    expect(exit).toBe(0);
    expect(out.lines[0]).toContain("Usage: bun run scripts/launch/secrets-scan.ts");
  });

  it("unknown flags are usage errors (exit 1, no probe lines emitted)", async () => {
    const target = writeTarget("anything.txt", "x");
    const out = captureStdout();
    const exit = await main([target, "--nope"], { stdout: out.write });
    expect(exit).toBe(1);
    expect(out.lines).toHaveLength(0);
  });
});
