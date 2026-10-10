/**
 * Static locks — SQL-injection regression surfaces.
 *
 * Pure filesystem tier — ZERO server boot, ZERO DB access (read-only
 * `node:fs` traversal, the parent-link static-locks precedent). The suite
 * converts the codebase's verified SQL-parameterization discipline into
 * CI-enforced regression locks:
 *
 *  (a) `sql.raw(` ZERO-TOLERANCE: no production file under the repository
 *      layer (`backend/db/repo/`) or the service layer
 *      (`backend/services/`) may construct SQL via `sql.raw(...)` — every
 *      statement must flow through the parameterized Drizzle builders or
 *      the `sql` template-literal binder. The only `sql.raw` call sites in
 *      the tree are the dev migration tooling (`backend/db/scripts/`),
 *      which sits outside both scan roots by design.
 *  (b) `ilike()` CENSUS PIN + BARE-`like(` ZERO-TOLERANCE: the repository
 *      layer's `ilike(` call sites are pinned file-by-file, line-by-line
 *      and occurrence-by-occurrence below. Every pinned site receives its
 *      pattern from the service layer AFTER the canonical
 *      `escapeLikeWildcards` escape, so a call site OUTSIDE the census
 *      means an unreviewed wildcard-injection surface and FAILS the lock
 *      — extending the census requires an explicit pin edit reviewed as
 *      a PR note. The companion lock holds the OTHER construction the
 *      escape discipline must govern: a bare `like(` call form (the
 *      case-sensitive predicate — distinct from `ilike`, whose prefix
 *      letter blocks the word boundary) must yield ZERO matches across
 *      the same comment-stripped repository corpus; the codebase routes
 *      every wildcard search through the pinned `ilike` sites, so any
 *      bare `like` site is by construction an unreviewed
 *      wildcard-injection surface and fails without a census to join.
 *  (c) SINGLE-SANITIZER PIN: across `backend/` and `shared/`, the ONLY
 *      definition of a LIKE-wildcard sanitizer is the canonical
 *      `escapeLikeWildcards` in `backend/lib/db/escape-like-wildcards.ts`;
 *      every other hit is an import/usage of it, and no variant
 *      identifier (`escapeWildcard(s)`, `LIKE_ESCAPE`) exists anywhere.
 *  (d) DOCBLOCK TRUTH: the canonical sanitizer still declares itself the
 *      ONLY sanitizer and forbids re-implementation — the documentation
 *      contract the single-sanitizer discipline rests on.
 *
 * COMMENT-STRIPPING SEMANTICS (lock b): `ilike` and bare-`like` sites are
 * matched on a comment-stripped corpus. Stripping is string-aware:
 * `/* … *\/` block comments and `//` line tails are removed ONLY outside
 * string/template literals (a `//` inside a URL string is code, not a
 * comment), and every newline inside a block comment is preserved so
 * stripped-content line numbers stay aligned with the source file.
 * Docblock prose mentioning `ilike(column, pattern)` therefore never
 * counts as a call site. STRING AND TEMPLATE-LITERAL CONTENT IS SCANNED
 * VERBATIM — stripping removes comments, never string payloads — so a
 * string literal containing `ilike(` (or `like(`) COUNTS as a call site.
 * That is the fail-closed direction: the lock would rather flag a benign
 * in-string mention for a human look than let a construction hide
 * behind a quote.
 *
 * NON-VACUITY: every scanner is a pure function over (label → content)
 * pairs and is also exercised against crafted in-memory fixtures that
 * MUST produce violations, plus benign fixtures that MUST NOT — the
 * Tier-4 negative proofs never touch real production sources.
 *
 * DETERMINISM: file discovery sorts names with `localeCompare` at read
 * time; repeated traversals yield identical orderings.
 *
 * ROOT PIN: the repo root is derived RELATIVELY from this suite's own
 * location (`test/config/` → two levels up) — never from `process.cwd()` —
 * so the scan paths are environment-insensitive. A corpus guard proves
 * the derivation resolved the real repo root.
 *
 * LEXICAL CAVEAT (accepted by design, static-locks precedent): a
 * text-level scan can miss intentionally obfuscated call shapes
 * (`sql["raw"]`, aliased imports), which fail review anyway; false
 * positives are visible and cheap. The lock's value is catching the
 * ordinary drift — a new search feature adding an unescaped `ilike`
 * binding without the census edit.
 */

import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

// ─── Root pin + traversal helpers ────────────────────────────────────────────

/** Virtual file unit fed to scanners (repo-relative label + content). */
interface SourceFile {
  readonly label: string;
  readonly content: string;
}

/** Repo root derived relatively from this suite's own location (SR pin). */
const REPO_ROOT = join(import.meta.dir, "..", "..");

/**
 * Generated trees never contribute scanable source: bundler output
 * (`.next*`, `node_modules`) and co-located test suites (`__tests__/`).
 * The exclusion runs at directory level so a generated subtree can never
 * leak a file into a production corpus.
 */
function isExcludedDirectoryName(name: string): boolean {
  return name === "node_modules" || name === "__tests__" || name.startsWith(".next");
}

function isTestFileName(name: string): boolean {
  return (
    name.endsWith(".test.ts") || name.endsWith(".test.tsx") || name.endsWith(".spec.ts") || name.endsWith(".spec.tsx")
  );
}

/**
 * Recursively lists `.ts`/`.tsx` files under `rootDir`, deterministically
 * sorted (a missing root yields an EMPTY corpus — the corpus guards
 * surface that, the scanners never guess). `excludeTests` drops
 * `*.test.ts`/`*.spec.ts` files for the production corpora.
 */
function listSourceFiles(rootLabel: string, rootDir: string, options?: { excludeTests?: boolean }): SourceFile[] {
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
        if (!isExcludedDirectoryName(entry.name)) {
          walk(childAbsolute, childSegments);
        }
        continue;
      }
      if (!entry.isFile() || (!entry.name.endsWith(".ts") && !entry.name.endsWith(".tsx"))) {
        continue;
      }
      if (options?.excludeTests && isTestFileName(entry.name)) {
        continue;
      }
      collected.push({
        label: `${rootLabel}/${childSegments.join("/")}`,
        content: readFileSync(childAbsolute, "utf8"),
      });
    }
  };
  walk(rootDir, []);
  return collected;
}

/** Lists a single (possibly non-existent) file as a one-element corpus. */
function listSingleFile(relativePath: string): SourceFile[] {
  const absolute = join(REPO_ROOT, relativePath);
  return existsSync(absolute) && statSync(absolute).isFile()
    ? [{ label: relativePath, content: readFileSync(absolute, "utf8") }]
    : [];
}

// ─── Comment stripping (string-aware, newline-preserving) ────────────────────

/**
 * Strips `/* … *\/` block comments and `//` line tails from TypeScript
 * source while (1) tracking string/template-literal state so a `//` or
 * `/*` INSIDE a string literal survives and a comment opener inside a
 * string never starts a comment, and (2) emitting every newline a block
 * comment spans so line numbers computed on the stripped text match the
 * original source line numbers. Backslash escapes inside strings and
 * templates are passed through verbatim. STRING/TEMPLATE-LITERAL CONTENT
 * IS EMITTED VERBATIM — never stripped — so a string containing `ilike(`
 * (or `like(`) SURVIVES stripping and counts as a call-site hit for the
 * scanners above: the fail-closed direction (a benign in-string mention
 * costs a human look; a hidden construction never slips through). Lexical
 * limits (accepted by design): regex literals are not modeled, and
 * `${…}` interpolation inside template literals is treated as opaque
 * string text.
 */

/** One stripper step: the emitted text plus the cursor position after it. */
interface StripStep {
  readonly out: string;
  readonly index: number;
}

/** Skips a `//` line tail; the newline itself stays for the main loop to emit. */
function consumeLineComment(content: string, index: number): StripStep {
  let cursor = index + 2;
  while (cursor < content.length && content.charCodeAt(cursor) !== 10) {
    cursor += 1;
  }
  return { out: "", index: cursor };
}

/** Skips a block comment, emitting ONLY the newlines it spans (line-number alignment). */
function consumeBlockComment(content: string, index: number): StripStep {
  let cursor = index + 2;
  let newlines = "";
  while (cursor < content.length) {
    if (content[cursor] === "*" && content[cursor + 1] === "/") {
      return { out: newlines, index: cursor + 2 };
    }
    if (content.charCodeAt(cursor) === 10) {
      newlines += "\n";
    }
    cursor += 1;
  }
  return { out: newlines, index: cursor };
}

/** Emits a string/template literal verbatim (escapes included) to its closing quote. */
function consumeStringLiteral(content: string, index: number): StripStep {
  const quote = content[index];
  let cursor = index + 1;
  let text = quote;
  while (cursor < content.length) {
    const char = content[cursor];
    if (char === "\\") {
      text += char + (content[cursor + 1] ?? "");
      cursor += 2;
      continue;
    }
    text += char;
    cursor += 1;
    if (char === quote) {
      break;
    }
  }
  return { out: text, index: cursor };
}

function stripComments(content: string): string {
  let out = "";
  let index = 0;
  while (index < content.length) {
    const char = content[index];
    const next = content[index + 1];
    if (char === "/" && next === "/") {
      const step = consumeLineComment(content, index);
      out += step.out;
      index = step.index;
    } else if (char === "/" && next === "*") {
      const step = consumeBlockComment(content, index);
      out += step.out;
      index = step.index;
    } else if (char === "'" || char === '"' || char === "`") {
      const step = consumeStringLiteral(content, index);
      out += step.out;
      index = step.index;
    } else {
      out += char;
      index += 1;
    }
  }
  return out;
}

// ─── Lock (a) — sql.raw zero-tolerance scanner ────────────────────────────────

/** `sql.raw(` call-form — any whitespace between the member tokens counts. */
const SQL_RAW_CALL = /sql\s*\.\s*raw\s*\(/u;

function scanSqlRaw(files: readonly SourceFile[]): string[] {
  return files.flatMap(file => (SQL_RAW_CALL.test(file.content) ? [file.label] : []));
}

// ─── Lock (b) — ilike census scanner ─────────────────────────────────────────

/** `ilike(` call-form on the word boundary (`alike(` / `ilikelike(` never fire). */
const ILIKE_CALL_FORM = /\bilike\s*\(/gu;

/** Non-global twin for boolean probes (`/g` `.test()` advances `lastIndex`). */
const ILIKE_SEARCH = /\bilike\s*\(/u;

/** Call sites of one file as sorted `[line, occurrenceCount]` pairs. */
function ilikeSitesByLine(content: string): [number, number][] {
  const countsByLine = new Map<number, number>();
  let line = 1;
  let newlineCursor = 0;
  for (const match of content.matchAll(ILIKE_CALL_FORM)) {
    const matchIndex = match.index ?? 0;
    for (let i = newlineCursor; i < matchIndex; i += 1) {
      if (content.charCodeAt(i) === 10) {
        line += 1;
      }
    }
    newlineCursor = matchIndex;
    countsByLine.set(line, (countsByLine.get(line) ?? 0) + 1);
  }
  return Array.from(countsByLine, ([siteLine, count]): [number, number] => [siteLine, count]).toSorted(
    (a, b) => a[0] - b[0]
  );
}

/** Every file's ilike call sites, keyed by label — only files WITH sites appear. */
function scanIlikeCensus(files: readonly SourceFile[]): Map<string, [number, number][]> {
  const sitesByFile = new Map<string, [number, number][]>();
  for (const file of files) {
    const sites = ilikeSitesByLine(stripComments(file.content));
    if (sites.length > 0) {
      sitesByFile.set(file.label, sites);
    }
  }
  return sitesByFile;
}

/**
 * THE CENSUS — the repository layer's complete, verified `ilike` call-site
 * inventory: file → [line, occurrence count]. Every listed site binds a
 * search pattern the service layer already escaped through the canonical
 * `escapeLikeWildcards` and `%…%`-wrapped before the repository sees it.
 * Extending admin search means editing THIS pin in the same change — a new
 * call site outside the census fails the lock until it is reviewed in.
 */
const ILIKE_CENSUS: ReadonlyMap<string, [number, number][]> = new Map([
  ["backend/db/repo/admin/academic-tracking.repository.ts", [[119, 2]]],
  [
    "backend/db/repo/admin/admin-user-query-helpers.ts",
    [
      [100, 1],
      [101, 1],
      [104, 1],
      [183, 2],
    ],
  ],
  ["backend/db/repo/billing/student-payment.repository.ts", [[135, 1]]],
  ["backend/db/repo/notifications/broadcast.repository.ts", [[138, 1]]],
  ["backend/db/repo/students/student.repository.directory.helpers.ts", [[103, 2]]],
  ["backend/db/repo/teachers/applicant.repository.ts", [[120, 2]]],
  ["backend/db/repo/teachers/teacher.repository.directory.helpers.ts", [[90, 2]]],
  [
    "backend/db/repo/teachers/teacher.repository.matching.helpers.ts",
    [
      [138, 1],
      [139, 1],
      [141, 1],
      [142, 1],
    ],
  ],
]);

const EXPECTED_ILIKE_FILES = 8;
const EXPECTED_ILIKE_CALL_SITE_LINES = 14;
const EXPECTED_ILIKE_OCCURRENCES = 19;

/** Per-site comparison: any line or count drift between pin and reality. */
function censusSitesDiffer(
  pinned: readonly (readonly [number, number])[],
  actual: readonly (readonly [number, number])[]
): boolean {
  return (
    pinned.length !== actual.length ||
    pinned.some(([line, count], index) => actual[index][0] !== line || actual[index][1] !== count)
  );
}

/**
 * Files with `ilike` sites that the census does not pin exactly (unknown
 * file, missing file, or drifted lines/counts) — the violation list the
 * lock asserts empty over the full repository corpus. Missing-file flags
 * only make sense when the corpus actually contains the repository tree;
 * partial corpora use `unknownIlikeFiles` instead.
 */
function censusViolations(files: readonly SourceFile[]): string[] {
  const found = scanIlikeCensus(files);
  const violations: string[] = [];
  for (const [label, pinned] of ILIKE_CENSUS) {
    const actual = found.get(label);
    if (actual === undefined || censusSitesDiffer(pinned, actual)) {
      violations.push(label);
    }
  }
  for (const label of found.keys()) {
    if (!ILIKE_CENSUS.has(label)) {
      violations.push(label);
    }
  }
  return violations.toSorted((a, b) => a.localeCompare(b));
}

/** Files carrying `ilike` sites that the census does not pin at all. */
function unknownIlikeFiles(files: readonly SourceFile[]): string[] {
  return Array.from(scanIlikeCensus(files).keys())
    .filter(label => !ILIKE_CENSUS.has(label))
    .toSorted((a, b) => a.localeCompare(b));
}

// ─── Lock (b) companion — bare `like(` zero-tolerance scanner ────────────────

/**
 * Bare `like(` call form — the case-sensitive predicate. Disjoint from
 * the census scanner by construction: in `ilike(` the prefix `i` and the
 * `l` are adjacent word characters, so `\blike` finds no boundary there
 * and never fires. Word-boundary matching keeps `*Like(`/` alike(`
 * look-alikes silent.
 */
const BARE_LIKE_SEARCH = /\blike\s*\(/u;

/** Files carrying at least one bare `like(` site on the comment-stripped corpus. */
function scanBareLikeFiles(files: readonly SourceFile[]): string[] {
  return files.flatMap(file => (BARE_LIKE_SEARCH.test(stripComments(file.content)) ? [file.label] : []));
}

// ─── Lock (c) — single-sanitizer scanners ─────────────────────────────────────

/** The canonical sanitizer module — the ONLY permitted definition site. */
const SANITIZER_FILE = "backend/lib/db/escape-like-wildcards.ts";

/** Any sanitizer-family identifier (canonical name or known variants). */
const SANITIZER_IDENTIFIER = /\b(?:escapeLikeWildcards|escapeWildcards?|LIKE_ESCAPE)\b/u;

/** Variant identifiers — a second sanitizer under ANY of these names. */
const SANITIZER_VARIANT_IDENTIFIER = /\b(?:escapeWildcards?|LIKE_ESCAPE)\b/u;

/** Definition shapes: a `function escapeLikeWildcards` declaration or a value binding. */
const SANITIZER_DEFINITION = /(?:function\s+escapeLikeWildcards\b|\bescapeLikeWildcards\s*=)/u;

/** Call-form usage of the canonical sanitizer. */
const SANITIZER_CALL_FORM = /\bescapeLikeWildcards\s*\(/u;

/** Import of the canonical sanitizer module (any specifier suffix). */
const CANONICAL_SANITIZER_IMPORT = /from\s+["'][^"']*escape-like-wildcards["']/u;

/** Files DEFINING a sanitizer-family member (canonical or imposter). */
function scanSanitizerDefinitions(files: readonly SourceFile[]): string[] {
  return files.flatMap(file =>
    SANITIZER_IDENTIFIER.test(file.content) && SANITIZER_DEFINITION.test(file.content) ? [file.label] : []
  );
}

/** Files carrying a sanitizer-variant identifier the codebase never sanctioned. */
function scanSanitizerVariants(files: readonly SourceFile[]): string[] {
  return files.flatMap(file => (SANITIZER_VARIANT_IDENTIFIER.test(file.content) ? [file.label] : []));
}

/** Files CALLING the canonical sanitizer without importing its module. */
function scanSanitizerUsagesWithoutCanonicalImport(files: readonly SourceFile[]): string[] {
  return files.flatMap(file =>
    file.label !== SANITIZER_FILE &&
    SANITIZER_CALL_FORM.test(file.content) &&
    !CANONICAL_SANITIZER_IMPORT.test(file.content)
      ? [file.label]
      : []
  );
}

// ─── Lock (d) — docblock truth predicate ─────────────────────────────────────

/** The canonical module's exclusivity claim: ONLY sanitizer for LIKE/ILIKE. */
const ONLY_SANITIZER_CLAIM = /this is the ONLY sanitizer for LIKE\/ILIKE/u;

/** The canonical module's prohibition: import it, never re-implement. */
const REIMPLEMENTATION_BAN = /MUST import this helper rather than re-implementing/u;

/** Probes the claims on normalized text (docblock line-wrap gutters are irrelevant). */
function onlySanitizerDocblockHolds(content: string): boolean {
  const collapsed = content.replace(/[\s*]+/g, " ");
  return ONLY_SANITIZER_CLAIM.test(collapsed) && REIMPLEMENTATION_BAN.test(collapsed);
}

// ─── Scanned corpora (explicit, environment-independent) ─────────────────────

/** Production sources: repository + service layers, tests excluded. */
const repositoryProductionSources = listSourceFiles("backend/db/repo", join(REPO_ROOT, "backend/db/repo"), {
  excludeTests: true,
});
const serviceProductionSources = listSourceFiles("backend/services", join(REPO_ROOT, "backend/services"), {
  excludeTests: true,
});

/** Repository layer (production files only) — the lock-(b) census corpus. */
const repositoryCensusCorpus = repositoryProductionSources;

/** Whole backend + shared trees (tests INCLUDED — imports/usages hold there too). */
const backendSources = listSourceFiles("backend", join(REPO_ROOT, "backend"));
const sharedSources = listSourceFiles("shared", join(REPO_ROOT, "shared"));
const sanitizerCorpus = backendSources.concat(sharedSources);

/** Dev migration tooling — the sanctioned `sql.raw` sites, OUTSIDE the lock-(a) scan roots. */
const DEV_MIGRATION_TOOLING: readonly string[] = [
  "backend/db/scripts/runDrizzleMigrations.ts",
  "backend/db/scripts/ensureIdempotentMigrations.ts",
];

// ─── Corpus guards — the scans must never be vacuously empty ─────────────────

describe("static locks — corpus guards (the scans have subjects)", () => {
  test("root pin resolves the real repo root (relative derivation, not cwd)", () => {
    expect(existsSync(join(REPO_ROOT, "package.json"))).toBe(true);
    expect(existsSync(join(REPO_ROOT, "backend"))).toBe(true);
    expect(existsSync(join(REPO_ROOT, "shared"))).toBe(true);
  });

  test("the production corpora are populated and carry no test files or generated trees", () => {
    expect(repositoryProductionSources.length).toBeGreaterThanOrEqual(50);
    expect(serviceProductionSources.length).toBeGreaterThanOrEqual(100);
    for (const file of repositoryProductionSources.concat(serviceProductionSources)) {
      expect(isTestFileName(file.label), `${file.label} must not sit in a production corpus`).toBe(false);
      expect(file.label.includes("__tests__/"), `${file.label} must not sit in a production corpus`).toBe(false);
    }
  });

  test("the sanitizer corpus covers the whole backend and shared trees", () => {
    expect(backendSources.length).toBeGreaterThanOrEqual(700);
    expect(sharedSources.length).toBeGreaterThanOrEqual(200);
  });

  test("every census file is present in the scanned repository corpus", () => {
    const labels = new Set(repositoryCensusCorpus.map(file => file.label));
    for (const label of ILIKE_CENSUS.keys()) {
      expect(labels.has(label), `${label} must exist in the repository corpus`).toBe(true);
    }
  });

  test("the dev migration tooling still holds the sanctioned sql.raw sites — outside the scan roots", () => {
    // Proves the lock-(a) zero is a property of the scanned trees, not
    // regex blindness: the same matcher fires on the out-of-scope tooling.
    for (const toolingPath of DEV_MIGRATION_TOOLING) {
      const corpus = listSingleFile(toolingPath);
      expect(corpus, `${toolingPath} must exist`).toHaveLength(1);
      expect(scanSqlRaw(corpus)).toEqual([toolingPath]);
      expect(
        repositoryProductionSources.concat(serviceProductionSources).some(file => file.label === toolingPath),
        `${toolingPath} must stay outside the lock-(a) scan roots`
      ).toBe(false);
    }
  });
});

// ─── Lock (a) — sql.raw zero-tolerance ────────────────────────────────────────

describe("lock (a) — zero sql.raw in repository and service production sources", () => {
  test("no production file under backend/db/repo or backend/services calls sql.raw", () => {
    expect(scanSqlRaw(repositoryProductionSources.concat(serviceProductionSources))).toEqual([]);
  });
});

// ─── Lock (b) — ilike census pin ─────────────────────────────────────────────

describe("lock (b) — repository ilike call sites equal the pinned census exactly", () => {
  test("the stripped-corpus match set is EXACTLY the census files", () => {
    const found = scanIlikeCensus(repositoryCensusCorpus);
    const foundLabels = Array.from(found.keys()).toSorted((a, b) => a.localeCompare(b));
    const pinnedLabels = Array.from(ILIKE_CENSUS.keys()).toSorted((a, b) => a.localeCompare(b));
    expect(foundLabels).toEqual(pinnedLabels);
    expect(foundLabels).toHaveLength(EXPECTED_ILIKE_FILES);
  });

  test("every census file's lines and occurrence counts match the pin", () => {
    const found = scanIlikeCensus(repositoryCensusCorpus);
    for (const [label, pinned] of ILIKE_CENSUS) {
      expect([label, found.get(label) ?? []]).toEqual([label, pinned]);
    }
  });

  test("the census totals hold: 8 files / 14 call-site lines / 19 occurrences", () => {
    const found = scanIlikeCensus(repositoryCensusCorpus);
    const callSiteLines = Array.from(found.values()).reduce((total, sites) => total + sites.length, 0);
    const occurrences = Array.from(found.values()).reduce(
      (total, sites) => total + sites.reduce((sum, [, count]) => sum + count, 0),
      0
    );
    expect(found.size).toBe(EXPECTED_ILIKE_FILES);
    expect(callSiteLines).toBe(EXPECTED_ILIKE_CALL_SITE_LINES);
    expect(occurrences).toBe(EXPECTED_ILIKE_OCCURRENCES);
  });

  test("no file with ilike sites escapes the census (the lock's drift tripwire)", () => {
    expect(censusViolations(repositoryCensusCorpus)).toEqual([]);
  });

  test("ZERO bare like( call sites exist in the stripped repository corpus (companion lock)", () => {
    // Every wildcard search routes through the pinned `ilike` sites; a
    // bare `like(` site would be an unreviewed wildcard-injection
    // surface with no census row to join — the lock holds at zero, not
    // at a pin.
    expect(scanBareLikeFiles(repositoryCensusCorpus)).toEqual([]);
  });

  test("docblock prose matches the raw regex but never the stripped corpus", () => {
    // The repository layer documents its ilike discipline in docblocks;
    // stripping is load-bearing — these mentions are NOT call sites.
    const proseOnlyFiles = [
      "backend/db/repo/admin/admin-user.repository.ts",
      "backend/db/repo/admin/admin-user-row-types.ts",
    ];
    for (const label of proseOnlyFiles) {
      const file = repositoryCensusCorpus.find(source => source.label === label);
      expect(file, `${label} must exist`).toBeDefined();
      expect(ILIKE_SEARCH.test(file?.content ?? "")).toBe(true);
      expect(ilikeSitesByLine(stripComments(file?.content ?? ""))).toEqual([]);
    }
  });
});

// ─── Lock (c) — single canonical sanitizer ────────────────────────────────────

describe("lock (c) — one LIKE-wildcard sanitizer definition across backend and shared", () => {
  test("the ONLY sanitizer definition site is the canonical module", () => {
    expect(scanSanitizerDefinitions(sanitizerCorpus)).toEqual([SANITIZER_FILE]);
  });

  test("no variant sanitizer identifier exists anywhere (escapeWildcard(s), LIKE_ESCAPE)", () => {
    expect(scanSanitizerVariants(sanitizerCorpus)).toEqual([]);
  });

  test("every canonical-sanitizer caller imports the canonical module", () => {
    expect(scanSanitizerUsagesWithoutCanonicalImport(sanitizerCorpus)).toEqual([]);
  });

  test("the canonical module exports the sanitizer under its canonical name", () => {
    const canonical = listSingleFile(SANITIZER_FILE);
    expect(canonical).toHaveLength(1);
    expect(SANITIZER_DEFINITION.test(canonical[0]?.content ?? "")).toBe(true);
  });
});

// ─── Lock (d) — canonical docblock truth ──────────────────────────────────────

describe("lock (d) — the canonical sanitizer still declares itself the ONLY sanitizer", () => {
  test("the docblock holds its exclusivity claim and its re-implementation ban", () => {
    const canonical = listSingleFile(SANITIZER_FILE);
    expect(canonical).toHaveLength(1);
    expect(onlySanitizerDocblockHolds(canonical[0]?.content ?? "")).toBe(true);
  });
});

// ─── Negative fixtures — every scanner provably fires (Tier-4 proofs) ─────────

describe("negative fixtures — seeded violations fail the locks, benign shapes do not", () => {
  test("a seeded sql.raw hit FAILS lock (a) — the scanner is not blind", () => {
    const seeded = [
      {
        label: "fixture/unsafe.repository.ts",
        content: `const rows = await tx.execute(sql.raw(\`SELECT * FROM students WHERE name = '\${raw}'\`));`,
      },
    ];
    // Lock (a) asserts the violation list is EMPTY over the production
    // corpora — a seeded hit must appear in that same list shape.
    expect(scanSqlRaw(seeded)).toEqual(["fixture/unsafe.repository.ts"]);
    expect(scanSqlRaw(repositoryProductionSources.concat(serviceProductionSources))).toEqual([]);
  });

  test("a new ilike call site outside the census FAILS lock (b)", () => {
    const seeded = [
      {
        label: "fixture/new-search.repository.ts",
        content: [
          "export function search(tx, pattern) {",
          "  const conditions = [];",
          "  conditions.push(ilike(users.fullName, pattern));",
          "  return tx.select().from(users).where(or(...conditions));",
          "}",
        ].join("\n"),
      },
    ];
    // The site lands on line 3 — the census does not pin this file, so the
    // drift tripwire must flag it.
    expect(scanIlikeCensus(seeded)).toEqual(new Map([["fixture/new-search.repository.ts", [[3, 1]]]]));
    expect(unknownIlikeFiles(seeded)).toEqual(["fixture/new-search.repository.ts"]);
    expect(unknownIlikeFiles(repositoryCensusCorpus)).toEqual([]);
  });

  test("a seeded bare like( site FAILS the companion lock — and never trips the census scanner", () => {
    const seeded = [
      {
        label: "fixture/case-sensitive-search.repository.ts",
        content: [
          "export function search(tx, pattern) {",
          "  return tx.select().from(users).where(like(users.fullName, pattern));",
          "}",
        ].join("\n"),
      },
    ];
    // The companion lock asserts the violation list is EMPTY over the
    // repository corpus — a seeded bare site must appear in that same
    // list shape.
    expect(scanBareLikeFiles(seeded)).toEqual(["fixture/case-sensitive-search.repository.ts"]);
    // Disjointness, both directions: the bare site is NOT an ilike site…
    expect(scanIlikeCensus(seeded)).toEqual(new Map());
    // …and the pinned ilike files never trip the bare-like scanner.
    expect(scanBareLikeFiles(repositoryCensusCorpus)).toEqual([]);
  });

  test("docblock-only ilike prose never counts — stripping keeps prose out of the census", () => {
    const proseOnly = [
      {
        label: "fixture/documented.repository.ts",
        content: [
          "/**",
          " * The repo binds this directly to its `ilike(column, pattern)` predicate",
          " * — never re-escaping.",
          " */",
          "export function findById(tx, id) { return tx.query.users.findFirst(id); }",
        ].join("\n"),
      },
    ];
    expect(scanIlikeCensus(proseOnly)).toEqual(new Map());
    expect(unknownIlikeFiles(proseOnly)).toEqual([]);
  });

  test("a second sanitizer implementation FAILS lock (c) — both definition shapes fire", () => {
    const imposters = [
      {
        label: "fixture/second-sanitizer.helpers.ts",
        content:
          "export function escapeLikeWildcards(input: string): string {\n  return input.replace(/%/g, '\\\\%');\n}\n",
      },
      {
        label: "fixture/arrow-sanitizer.helpers.ts",
        content: "export const escapeLikeWildcards = (input: string) => input.replace(/_/g, '\\\\_');\n",
      },
    ];
    expect(scanSanitizerDefinitions(imposters)).toEqual([
      "fixture/second-sanitizer.helpers.ts",
      "fixture/arrow-sanitizer.helpers.ts",
    ]);
    expect(scanSanitizerDefinitions(sanitizerCorpus)).toEqual([SANITIZER_FILE]);
  });

  test("a variant-named sanitizer FAILS lock (c) even without the canonical name", () => {
    const variants = [
      {
        label: "fixture/variant.helpers.ts",
        content: "export function escapeWildcards(input: string) { return input; }",
      },
      { label: "fixture/constant.helpers.ts", content: "export const LIKE_ESCAPE = '\\\\';" },
    ];
    expect(scanSanitizerVariants(variants)).toEqual(["fixture/variant.helpers.ts", "fixture/constant.helpers.ts"]);
    expect(scanSanitizerVariants(sanitizerCorpus)).toEqual([]);
  });

  test("a caller that uses the sanitizer without importing the canonical module FAILS lock (c)", () => {
    const rogueCaller = [
      {
        label: "fixture/rogue-caller.service.ts",
        content: `export function search(raw: string) {\n  return \`%\${escapeLikeWildcards(raw)}%\`;\n}\n`,
      },
    ];
    expect(scanSanitizerUsagesWithoutCanonicalImport(rogueCaller)).toEqual(["fixture/rogue-caller.service.ts"]);
    expect(scanSanitizerUsagesWithoutCanonicalImport(sanitizerCorpus)).toEqual([]);
  });

  test("a docblock that drops the exclusivity claim FAILS lock (d)", () => {
    const mutatedDocblock = [
      "/**",
      " * Some LIKE-pattern helper among others in this codebase.",
      " * Callers may freely re-implement escaping locally.",
      " */",
      "export function escapeLikeWildcards(input: string): string {\n  return input;\n}\n",
    ].join("\n");
    expect(onlySanitizerDocblockHolds(mutatedDocblock)).toBe(false);
  });

  test("comment stripping is string-aware and preserves source line numbers", () => {
    const sample = [
      "const a = 1; // trailing ilike( prose never counts", // 1
      "/* block ilike( prose */ const b = 2;", // 2
      'const url = "https://example.com/x"; // real comment tail', // 3
      "/*", // 4
      " * multi-line block ilike( prose", // 5
      " */", // 6
      "const site = ilike(users.fullName, pattern);", // 7
      'const doc = "binds ilike( patterns verbatim";', // 8
    ].join("\n");
    const stripped = stripComments(sample);
    // Line 3's in-string `//` is code, not a comment — the string survives.
    expect(stripped).toContain('"https://example.com/x"');
    // All prose is gone; the real call site keeps its SOURCE line number.
    // Line 8's IN-STRING mention also counts — string content is scanned
    // verbatim (fail-closed: a benign mention costs a look, never a miss).
    expect(ilikeSitesByLine(stripped)).toEqual([
      [7, 1],
      [8, 1],
    ]);
    // The verbatim-string rule holds for the bare-like companion lock too.
    expect(BARE_LIKE_SEARCH.test(stripComments('const doc = "binds like( patterns";'))).toBe(true);
    // Line tails after a real comment are dropped.
    expect(stripped).toContain("const a = 1; ");
    expect(stripped).not.toContain("trailing ilike(");
  });
});
