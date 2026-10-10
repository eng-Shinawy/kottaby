/**
 * NotificationType inventory census — a static, DB-free anti-drift lock that
 * keeps the notification-type inventory honest in BOTH directions:
 *
 *  1. Member list is DERIVED from `Object.values(NotificationType)` — never
 *     re-hardcoded — so the census always tracks the shipped enum, and a
 *     member silently added to (or removed from) the enum cannot slip past.
 *  2. For EVERY derived member the census requires, on the real source tree:
 *       - ≥1 production emitter — a non-test service-layer file referencing
 *         the member, because every production emission flows through a
 *         service calling the notification engine (the 6-layer rule: no
 *         resolver, route, or hook emits directly);
 *       - ≥1 exercising test — a test file referencing the member.
 *
 * Both corpora are walked read-only with `node:fs`; a member failing either
 * oracle is reported with its full per-member evidence so the missing side
 * (emitter or test) is named, not just counted.
 *
 * VACUITY GUARDS: the exercising-test oracle excludes this suite's sibling
 * parity test (`notification-type.enum.test.ts`) — it enumerates every member
 * yet exercises no emitter, so counting it would make the oracle pass for any
 * member. Corpus floors plus sentinel emitter files keep a broken walker
 * (empty corpus, wrong root) from faking green.
 *
 * LEXICAL CAVEAT (accepted, same as every fs-scan lock): the scan is
 * text-level — a member referenced only via obfuscated indirection is
 * invisible to it; such code fails review anyway.
 *
 * DB SAFETY: zero database operations — pure filesystem proof; no
 * `runInRollback` wrapper and no seed data are involved.
 */
import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { NotificationType } from "@/backend/enum/notifications/notification-type.enum";

// ─── Contracts under pin ─────────────────────────────────────────────────────

/** Root of the production emitter corpus — the emitting layer. */
const EMITTER_CORPUS_ROOT = join(process.cwd(), "backend", "services");

/** Roots of the exercising-test corpus (backend co-located suites + journeys). */
const TEST_CORPUS_ROOTS = [join(process.cwd(), "backend"), join(process.cwd(), "test")] as const;

/** Sibling parity test excluded from the exercising-test oracle (vacuity guard). */
const EXCLUDED_TEST_LABEL = "enum/notifications/notification-type.enum.test.ts";

/** Anti-blind-spot floor: the emitter corpus must yield at least this many files. */
const MIN_EMITTER_CORPUS_FILES = 10;

/** Anti-blind-spot floor: the exercising-test corpus must yield at least this many files. */
const MIN_TEST_CORPUS_FILES = 50;

/** Production files that MUST be inside the emitter corpus (sentinels — one per emitting flow). */
const EMITTER_SENTINEL_LABELS = [
  "classes/session-request-notification.service.ts",
  "classes/session-report-notification.service.ts",
  "classes/session-dispute-notification.service.ts",
  "notifications/admin-broadcast.service.ts",
  "billing/subscription-activation.service.ts",
  "parents/parent-link-request.service.ts",
  "teachers/applicant-lifecycle.helpers.ts",
] as const;

// ─── Read-only traversal helpers ─────────────────────────────────────────────

/** Virtual file unit fed to the oracles (label relative to its corpus root + content). */
interface SourceFile {
  readonly label: string;
  readonly content: string;
}

/** Matches Bun test files (`*.test.ts` / `*.test.tsx`). */
const TEST_FILE_PATTERN = /\.test\.tsx?$/u;

/**
 * Recursively lists `.ts`/`.tsx` files under `rootDir` (deterministically
 * sorted, skipping `node_modules` and build output). `testFilesOnly` selects
 * Bun test files; otherwise non-test production files are collected.
 */
function listSourceFiles(rootDir: string, testFilesOnly: boolean): SourceFile[] {
  if (!existsSync(rootDir)) {
    return [];
  }
  const collected: SourceFile[] = [];
  const walk = (absoluteDir: string, relativeSegments: string[]): void => {
    const entries = readdirSync(absoluteDir, { withFileTypes: true }).toSorted((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const childSegments = [...relativeSegments, entry.name];
      const childAbsolute = join(absoluteDir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "node_modules" || entry.name === ".next" || entry.name === "generated") {
          continue;
        }
        walk(childAbsolute, childSegments);
        continue;
      }
      if (!entry.isFile() || !(entry.name.endsWith(".ts") || entry.name.endsWith(".tsx"))) {
        continue;
      }
      const isTestFile = TEST_FILE_PATTERN.test(entry.name);
      if (testFilesOnly !== isTestFile) {
        continue;
      }
      collected.push({
        label: childSegments.join("/"),
        content: readFileSync(childAbsolute, "utf8"),
      });
    }
  };
  walk(rootDir, []);
  return collected;
}

// ─── Census corpora + member-derived evidence ───────────────────────────────

/**
 * Every notification-type member, derived from the shipped enum — key + value
 * pairs so findings can name both (`SessionRequest` / `session_request`).
 */
const MEMBERS = Object.entries(NotificationType).map(([key, value]) => ({ key, value }));

/** Non-test production files in the emitter corpus. */
const emitterCorpus = listSourceFiles(EMITTER_CORPUS_ROOT, false);

/** Exercising-test corpus: test files under the roots, minus the excluded enumerator. */
const testCorpus = TEST_CORPUS_ROOTS.flatMap(root =>
  listSourceFiles(root, true).filter(
    file => join(root, file.label) !== join(process.cwd(), "backend", EXCLUDED_TEST_LABEL)
  )
);

/** Labels of emitter files referencing `NotificationType.<Key>` — the emission oracle. */
const emitterHitsFor = (memberKey: string): readonly string[] =>
  emitterCorpus.filter(file => file.content.includes(`NotificationType.${memberKey}`)).map(file => file.label);

/** Labels of exercising-test files referencing `NotificationType.<Key>` — the test oracle. */
const testHitsFor = (memberKey: string): readonly string[] =>
  testCorpus.filter(file => file.content.includes(`NotificationType.${memberKey}`)).map(file => file.label);

describe("notification-type inventory census", () => {
  test("member list is derived from the shipped enum and is non-empty", () => {
    expect(MEMBERS.length).toBeGreaterThan(0);
    expect(new Set(MEMBERS.map(member => member.value)).size).toBe(MEMBERS.length);
  });

  test("emitter corpus is non-vacuous: floor met + sentinel emitters present", () => {
    expect(emitterCorpus.length).toBeGreaterThanOrEqual(MIN_EMITTER_CORPUS_FILES);
    const labels = new Set(emitterCorpus.map(file => file.label));
    for (const sentinel of EMITTER_SENTINEL_LABELS) {
      expect(labels.has(sentinel)).toBe(true);
    }
  });

  test("exercising-test corpus is non-vacuous: floor met", () => {
    expect(testCorpus.length).toBeGreaterThanOrEqual(MIN_TEST_CORPUS_FILES);
  });

  test("every member has ≥1 production emitter and ≥1 exercising test", () => {
    const findings: string[] = [];
    for (const member of MEMBERS) {
      const emitters = emitterHitsFor(member.key);
      const tests = testHitsFor(member.key);
      if (emitters.length === 0) {
        findings.push(`${member.key} (${member.value}): no production emitter in backend/services`);
      }
      if (tests.length === 0) {
        findings.push(`${member.key} (${member.value}): no exercising test`);
      }
    }
    expect(findings).toEqual([]);
  });
});
