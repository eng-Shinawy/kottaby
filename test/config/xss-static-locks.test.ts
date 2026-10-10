/**
 * XSS static locks — zero dangerous-HTML-sink scanner.
 *
 * Pure filesystem tier — ZERO server boot, ZERO DB access (read-only
 * `node:fs` traversal, `parent-link.static-locks.test.ts` precedent). The
 * platform's entire XSS defense is architectural: notification copy and
 * every other emitter-derived string renders as React TEXT nodes
 * (auto-escaped), and no sanitizer dependency exists by design. This suite
 * makes that architecture machine-enforced — a raw-HTML sink introduced
 * anywhere in the client or server component trees fails CI here instead
 * of passing every quality gate silently.
 *
 * WHAT THIS LOCKS: no production `*.ts`/`*.tsx` file under `app/` (server
 * components, layouts, API routes) or `frontend/` (client components,
 * views, stores, lib) may contain ANY of the raw-HTML injection sinks:
 * `dangerouslySetInnerHTML`, `innerHTML`, `outerHTML`,
 * `insertAdjacentHTML`, `document.write(`, `eval(`, `new Function(`,
 * `srcDoc`. Every one of these bypasses React's text-node escaping and
 * turns an emitter-controlled string into executable markup.
 *
 * SCOPE EXCLUSIONS (not contracts, just non-production corpora):
 * `*.test.ts(x)` / `*.spec.ts(x)` (fixtures legitimately assert on sink
 * names — e.g. the CountrySelector escape probe), `*.stories.tsx`
 * (Storybook fixtures), `frontend/graphql/generated/` (codegen output),
 * `node_modules` and any `.next*` build directory (defensive — none
 * currently live under the scanned roots).
 *
 * LEXICAL CAVEAT (accepted by design, same precedent): text-level scans
 * can flag occurrences inside comments/strings; false positives are
 * visible and cheap, false negatives require intentionally obfuscated
 * code which fails review anyway. The zero-match state is verified real
 * on this tree — comments in production sources therefore do not name
 * these sink tokens.
 *
 * NON-VACUITY: the matcher is a pure function over (label → content)
 * pairs and is exercised against crafted in-memory fixtures that MUST
 * produce violations (one per sink) plus benign look-alike fixtures
 * (`retrieval(`, `medieval(`, …) that MUST NOT — proving the lock can
 * actually fire before trusting its green run.
 *
 * DETERMINISM: file discovery sorts names with `localeCompare` at read
 * time; repeated traversals yield identical orderings.
 *
 * ROOT PIN: the repo root is derived RELATIVELY from this suite's own
 * location (`test/config/` → two levels up) — never from `process.cwd()` —
 * so the scan paths are environment-insensitive. A corpus guard proves
 * the derivation resolved the real repo root.
 */

import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

// ─── Root pin + traversal helpers ────────────────────────────────────────────

/** Repo root derived relatively from this suite's own location (ROOT PIN). */
const REPO_ROOT = join(import.meta.dir, "..", "..");

/** Virtual file unit fed to the matcher (repo-relative label + content). */
interface SourceFile {
  readonly label: string;
  readonly content: string;
}

/** One detected raw-HTML sink occurrence — names the owning file and line. */
interface SinkViolation {
  readonly label: string;
  readonly sink: string;
  readonly line: number;
  readonly excerpt: string;
}

/** Directory names never traversed inside the scanned roots. */
function isExcludedDirectoryName(name: string): boolean {
  return name === "node_modules" || name.startsWith(".next");
}

/** Repo-relative directory paths never traversed (codegen output). */
const EXCLUDED_RELATIVE_DIR_PATHS: ReadonlySet<string> = new Set(["frontend/graphql/generated"]);

/** Test/spec/storybook corpora are excluded — only production sources lock. */
function isExcludedFileName(name: string): boolean {
  return (
    name.endsWith(".test.ts") ||
    name.endsWith(".test.tsx") ||
    name.endsWith(".spec.ts") ||
    name.endsWith(".spec.tsx") ||
    name.endsWith(".stories.tsx")
  );
}

function isProductionSourceFile(name: string): boolean {
  return (name.endsWith(".ts") || name.endsWith(".tsx")) && !isExcludedFileName(name);
}

/**
 * File-list provider — recursively collects production `*.ts`/`*.tsx`
 * sources under one root, deterministically sorted, labeled repo-relative
 * so violations name the owning file. Pure `node:fs` reads; no server
 * boot, no DB access.
 */
function listProductionSourceFiles(rootLabel: string): SourceFile[] {
  const rootDir = join(REPO_ROOT, rootLabel);
  if (!existsSync(rootDir)) {
    return [];
  }
  const collected: SourceFile[] = [];
  const walk = (absoluteDir: string, relativeSegments: readonly string[]): void => {
    const entries = readdirSync(absoluteDir, { withFileTypes: true }).toSorted((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const childSegments = [...relativeSegments, entry.name];
      const childRelativePath = childSegments.join("/");
      if (entry.isDirectory()) {
        if (
          isExcludedDirectoryName(entry.name) ||
          EXCLUDED_RELATIVE_DIR_PATHS.has(`${rootLabel}/${childRelativePath}`)
        ) {
          continue;
        }
        walk(join(absoluteDir, entry.name), childSegments);
        continue;
      }
      if (!entry.isFile() || !isProductionSourceFile(entry.name)) {
        continue;
      }
      collected.push({
        label: `${rootLabel}/${childRelativePath}`,
        content: readFileSync(join(absoluteDir, entry.name), "utf8"),
      });
    }
  };
  walk(rootDir, []);
  return collected;
}

// ─── Content matcher ──────────────────────────────────────────────────────────

/** A dangerous raw-HTML sink and its stateless line matcher. */
interface SinkMatcher {
  readonly sink: string;
  readonly pattern: RegExp;
}

/**
 * The eight locked sink shapes. The DOM property names are matched as bare
 * word tokens (`\binnerHTML\b`) — they are DOM-specific identifiers with no
 * English-word collision risk, and the bare form also catches bracket
 * access (`el["innerHTML"]`) and string-built markup. `eval(` carries a
 * leading word boundary so `retrieval(`/`medieval(` look-alikes cannot
 * fire; `document.write(`/`new Function(` are call-form with elastic
 * whitespace.
 */
const SINK_MATCHERS: readonly SinkMatcher[] = [
  { sink: "dangerouslySetInnerHTML", pattern: /\bdangerouslySetInnerHTML\b/u },
  { sink: "innerHTML", pattern: /\binnerHTML\b/u },
  { sink: "outerHTML", pattern: /\bouterHTML\b/u },
  { sink: "insertAdjacentHTML", pattern: /\binsertAdjacentHTML\b/u },
  { sink: "document.write(", pattern: /\bdocument\s*\.\s*write\s*\(/u },
  { sink: "eval(", pattern: /\beval\s*\(/u },
  { sink: "new Function(", pattern: /\bnew\s+Function\s*\(/u },
  { sink: "srcDoc", pattern: /\bsrcdoc\b/iu },
];

/**
 * The content matcher — a PURE function over in-memory (label → content)
 * samples: reports every line where any sink pattern fires. Production
 * scans and the synthetic negative-proof fixtures call the SAME function,
 * so a green production run is only trusted after fixtures prove it can
 * go red.
 */
function findHtmlSinkViolations(files: readonly SourceFile[]): SinkViolation[] {
  const violations: SinkViolation[] = [];
  for (const file of files) {
    const lines = file.content.split("\n");
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      for (const matcher of SINK_MATCHERS) {
        if (matcher.pattern.test(line)) {
          violations.push({
            label: file.label,
            sink: matcher.sink,
            line: index + 1,
            excerpt: line.trim().slice(0, 120),
          });
        }
      }
    }
  }
  return violations.toSorted(
    (a, b) => a.label.localeCompare(b.label) || a.line - b.line || a.sink.localeCompare(b.sink)
  );
}

// ─── Scanned corpora (explicit, environment-independent) ─────────────────────

/** Production component trees — server components (`app/`) AND client (`frontend/`). */
const PRODUCTION_SOURCES: readonly SourceFile[] = ["app", "frontend"].flatMap(root => listProductionSourceFiles(root));

/** Sentinel files that MUST be in the corpus — proves the root pin resolved the real repo. */
const REQUIRED_CORPUS_LABELS: readonly string[] = [
  "app/layout.tsx",
  "app/page.tsx",
  "frontend/components/ui/NotificationDrawer.tsx",
  "frontend/views/notifications/feed/NotificationRow.tsx",
  "frontend/views/notifications/feed/NotificationRowContent.tsx",
];

describe("XSS static locks — production corpus shape", () => {
  test("root pin resolved the real repo — both component trees contributed", () => {
    expect(PRODUCTION_SOURCES.length).toBeGreaterThan(1000);
    expect(PRODUCTION_SOURCES.some(file => file.label.startsWith("app/"))).toBe(true);
    expect(PRODUCTION_SOURCES.some(file => file.label.startsWith("frontend/"))).toBe(true);
  });

  test("sentinel files are in the scanned corpus", () => {
    const labels = new Set(PRODUCTION_SOURCES.map(file => file.label));
    for (const required of REQUIRED_CORPUS_LABELS) {
      expect(labels.has(required)).toBe(true);
    }
  });

  test("excluded corpora are absent — tests, stories, codegen output", () => {
    for (const file of PRODUCTION_SOURCES) {
      expect(file.label.endsWith(".test.ts")).toBe(false);
      expect(file.label.endsWith(".test.tsx")).toBe(false);
      expect(file.label.endsWith(".spec.ts")).toBe(false);
      expect(file.label.endsWith(".spec.tsx")).toBe(false);
      expect(file.label.endsWith(".stories.tsx")).toBe(false);
      expect(file.label.startsWith("frontend/graphql/generated/")).toBe(false);
      expect(file.label.includes("node_modules/")).toBe(false);
    }
  });
});

describe("XSS static locks — zero dangerous HTML sinks in production sources", () => {
  test("no production file under app/ or frontend/ contains a raw-HTML sink", () => {
    const violations = findHtmlSinkViolations(PRODUCTION_SOURCES);
    // Each reported entry names the owning file/line, the sink, and the
    // offending excerpt — a non-empty diff is the review checklist.
    const report = violations.map(
      violation => `${violation.label}:${violation.line} [${violation.sink}] ${violation.excerpt}`
    );
    expect(report).toEqual([]);
  });
});

describe("XSS static locks — negative-proof fixtures (the lock can fire)", () => {
  test("a synthetic sample containing dangerouslySetInnerHTML FAILS the zero-match assertion", () => {
    const hostile: SourceFile = {
      label: "synthetic/Hostile.tsx",
      content: "return <div dangerouslySetInnerHTML={{ __html: body }} />;",
    };
    const violations = findHtmlSinkViolations([hostile]);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.sink).toBe("dangerouslySetInnerHTML");
  });

  test("every locked sink shape is detected in synthetic samples", () => {
    const sinkSamples: readonly (readonly [string, string])[] = [
      ["dangerouslySetInnerHTML", "return <div dangerouslySetInnerHTML={{ __html: body }} />;"],
      ["innerHTML", "container.innerHTML = untrustedBody;"],
      ["outerHTML", "node.outerHTML = markup;"],
      ["insertAdjacentHTML", 'host.insertAdjacentHTML("beforeend", fragment);'],
      ["document.write(", "document.write(untrustedBody);"],
      ["eval(", "eval(untrustedPayload);"],
      ["new Function(", "const run = new Function(untrustedPayload);"],
      ["srcDoc", "return <iframe srcDoc={untrustedHtml} />;"],
    ];
    for (const [sink, sample] of sinkSamples) {
      const violations = findHtmlSinkViolations([{ label: `synthetic/${sink}.tsx`, content: sample }]);
      expect(violations).toHaveLength(1);
      expect(violations[0]?.sink).toBe(sink);
    }
  });

  test("benign look-alike content produces zero violations", () => {
    const benign: SourceFile = {
      label: "synthetic/Benign.tsx",
      content: [
        'import { Typography } from "@mui/material";',
        "const rows = retrieval(index);",
        "const era = medievalTimes();",
        "const timer = setTimeout(flush, 30_000);",
        "return <Typography>{untrustedCopy}</Typography>;",
      ].join("\n"),
    };
    expect(findHtmlSinkViolations([benign])).toHaveLength(0);
  });

  test("violations are sorted and carry line numbers for review", () => {
    const multiSink: SourceFile = {
      label: "synthetic/Multi.tsx",
      content: "const first = eval(x);\nconst benign = 1;\nconst second = document.write(y);",
    };
    const violations = findHtmlSinkViolations([multiSink]);
    expect(violations.map(violation => [violation.line, violation.sink])).toEqual([
      [1, "eval("],
      [3, "document.write("],
    ]);
  });
});
