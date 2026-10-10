/**
 * Invariant-census anti-drift oracle — a static, DB-free proof that the
 * canonical state-machine invariants doc, the machine-readable census
 * (`invariant-census.catalog.ts`), and the named test files the census binds
 * stay in exact bijection.
 *
 * Four mechanisms:
 *
 *  1. Doc extraction — every `INV-[A-Z]+digits` token is collected from the
 *     canonical doc into a set, with a corpus-sanity floor (>= 60 unique ids)
 *     so a broken scanner can never fake green on an empty corpus.
 *
 *  2. Bijection — the doc's id set must equal the census id set in BOTH
 *     directions: a doc invariant without a census row fails, and a census
 *     row whose id left the doc fails.
 *
 *  3. Completeness — the registry is well-formed: exactly 67 rows under 12
 *     machine keys with the pinned per-machine split, verdicts and
 *     dispositions inside their closed value sets with the recorded tallies,
 *     >= 1 binding per row, doc-drift recorded on exactly the drifted rows,
 *     and every PIN row's ledger pointer live in the deferred-items ledger.
 *
 *  4. Binding resolution — every row's every binding must resolve on disk:
 *     the `testPath` exists inside the repo and the `testName` fragment is
 *     greppable in that file's content. Bindings for suites that have not
 *     landed yet stay RED here by design — the red is the anti-drift
 *     property (a row can never silently lose its proof), and the oracle
 *     goes green row-by-row as the owning suites land. No assertion is ever
 *     weakened to force green.
 *
 * NON-VACUITY: the extraction, bijection, and resolution helpers are pure
 * and injectable; the negative self-test feeds them fabricated drift (a
 * fake doc id, a phantom citation, an escaping path, a dead ledger pointer)
 * and requires every mismatch to be reported — so a broken oracle can never
 * fake green.
 *
 * DETERMINISM: no directory traversal and no whole-repo scans — the oracle
 * reads exactly three scoped surfaces: the canonical doc, the deferred-items
 * ledger, and the specific test files the census names. Repeated runs yield
 * identical results under a concurrently changing tree.
 *
 * DB SAFETY: zero database operations — pure filesystem + set proof; no
 * `runInRollback` wrapper and no seed data are involved.
 */

import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  CENSUS_DOC_PATH,
  CENSUS_ROWS,
  INVARIANT_CENSUS,
  type InvariantCensusBinding,
  type InvariantCensusEntry,
  type InvariantDisposition,
  type InvariantMachine,
  type InvariantVerdict,
} from "@/backend/db/test/logic/invariants/invariant-census.catalog";

// ─── Contracts under pin ─────────────────────────────────────────────────────

/** Repo root, resolved the same way the audit census-drift oracle resolves it. */
const REPO_ROOT = process.cwd();

/** The deferred-items ledger the PIN rows' `ledgerRef` pointers must trace into. */
const DEFERRED_LEDGER_PATH = "ai/plans/milestone_4/state_machine_invariant_verification/deferred-items.md";

/** Extracts one `INV-` token; the doc is the canonical id corpus. */
const INV_TOKEN_PATTERN = /INV-[A-Z]+\d+/gu;

/** Non-global twin for single-id validity checks (a /g flag makes `.test` stateful). */
const INV_TOKEN_SINGLE_PATTERN = /^INV-[A-Z]+\d+$/u;

/** Minimum number of unique doc ids the corpus must yield (anti-blind-spot floor). */
const MIN_DOC_INV_IDS = 60;

/** A deferred-ledger row id, e.g. "D-401". */
const LEDGER_REF_PATTERN = /^D-\d{3}$/u;

/** The twelve machine groups, pinned so key drift is reported, never guessed. */
const MACHINE_KEYS: readonly InvariantMachine[] = ["S", "TV", "A", "B", "W", "U", "P", "PAY", "HW", "PR", "E", "PC"];

/** The pinned registry totals (mirroring the shipped census). */
const EXPECTED_TOTAL_ROWS = 67;
const EXPECTED_MACHINE_COUNT = 12;
const EXPECTED_PER_MACHINE: Readonly<Record<InvariantMachine, number>> = {
  S: 8,
  TV: 7,
  A: 4,
  B: 8,
  W: 8,
  U: 5,
  P: 4,
  PAY: 7,
  HW: 4,
  PR: 3,
  E: 6,
  PC: 3,
};
const EXPECTED_VERDICTS: Readonly<Record<InvariantVerdict, number>> = { COVERED: 45, PARTIAL: 18, GAP: 4 };
const EXPECTED_DISPOSITIONS: Readonly<Record<InvariantDisposition, number>> = {
  "VERIFY-BY-REFERENCE": 32,
  EXTEND: 24,
  "NEW-PROBE": 5,
  "PIN-APP-LAYER+DOC-DRIFT": 6,
};
const EXPECTED_DOC_DRIFT_ROWS = 16;

// ─── Pure helpers (each also exercised against crafted fixtures) ────────────

/** Extracts the set of unique `INV-` tokens from doc-like content. */
function extractInvIds(content: string): Set<string> {
  return new Set([...content.matchAll(INV_TOKEN_PATTERN)].map(match => match[0]));
}

/** Both drift directions between a doc id corpus and a census id list. */
interface BijectionReport {
  /** Doc ids with no census row (a documented invariant the census lost). */
  readonly missingFromCensus: readonly string[];
  /** Census ids the doc no longer documents (a census row outliving the doc). */
  readonly missingFromDoc: readonly string[];
}

/**
 * Compares a doc id corpus with the census id list in both directions.
 * Pure and injectable: the negative self-test feeds it fabricated ids and
 * requires the mismatch to be reported.
 */
function diffInvIdBijection(docIds: ReadonlySet<string>, censusIds: readonly string[]): BijectionReport {
  const census = new Set(censusIds);
  return {
    missingFromCensus: [...docIds].filter(id => !census.has(id)).toSorted((a, b) => a.localeCompare(b)),
    missingFromDoc: censusIds.filter(id => !docIds.has(id)).toSorted((a, b) => a.localeCompare(b)),
  };
}

/**
 * True when `path` is a safe repo-root-relative POSIX path: non-empty,
 * relative, no back-slashes, and no parent-directory segment. Bindings are
 * data — a hostile or malformed entry must be reported, never followed
 * outside the repo.
 */
function isSafeRepoRelativePath(path: string): boolean {
  if (path.length === 0 || path.startsWith("/") || path.includes("\\")) {
    return false;
  }
  return !path.split("/").includes("..");
}

/** How one census binding resolved against the filesystem view. */
type BindingResolution =
  | { readonly status: "ok" }
  | { readonly status: "unsafe-path"; readonly testPath: string }
  | { readonly status: "missing-file"; readonly testPath: string }
  | { readonly status: "name-not-found"; readonly testPath: string; readonly testName: string };

/**
 * Resolves one binding against an injectable file view: `readFileAt` maps a
 * repo-relative POSIX path to file content, or undefined when the file does
 * not exist. A safe path whose file exists must contain the `testName`
 * fragment verbatim — renamed or deleted tests fail here.
 */
function resolveBinding(
  readFileAt: (repoRelativePath: string) => string | undefined,
  binding: InvariantCensusBinding
): BindingResolution {
  if (!isSafeRepoRelativePath(binding.testPath)) {
    return { status: "unsafe-path", testPath: binding.testPath };
  }
  const content = readFileAt(binding.testPath);
  if (content === undefined) {
    return { status: "missing-file", testPath: binding.testPath };
  }
  if (!content.includes(binding.testName)) {
    return { status: "name-not-found", testPath: binding.testPath, testName: binding.testName };
  }
  return { status: "ok" };
}

/** Human-readable one-line diagnosis for a failed binding, else null. */
function describeBindingFailure(resolution: BindingResolution): string | null {
  switch (resolution.status) {
    case "unsafe-path":
      return `unsafe testPath (must be repo-relative POSIX): ${resolution.testPath}`;
    case "missing-file":
      return `testPath does not exist on disk: ${resolution.testPath}`;
    case "name-not-found":
      return `testName not greppable in ${resolution.testPath}: "${resolution.testName}"`;
    case "ok":
      return null;
  }
  return null;
}

/** True when the ledger content carries `ref` as a live table row id. */
function ledgerRefIsLive(ledgerContent: string, ref: string): boolean {
  return LEDGER_REF_PATTERN.test(ref) && ledgerContent.includes(`| ${ref} `);
}

// ─── Scoped live reads (module-level, deterministic) ───────────────────────

/**
 * Live file view for binding resolution: repo-root-anchored reads with a
 * per-run content cache. Only the files the census names are ever read —
 * no traversal, so a concurrently changing tree cannot perturb the scan.
 */
const bindingFileCache = new Map<string, string | undefined>();
function liveReadFileAt(repoRelativePath: string): string | undefined {
  if (!bindingFileCache.has(repoRelativePath)) {
    const absolute = join(REPO_ROOT, repoRelativePath);
    bindingFileCache.set(repoRelativePath, existsSync(absolute) ? readFileSync(absolute, "utf8") : undefined);
  }
  return bindingFileCache.get(repoRelativePath);
}

const docContent: string = readFileSync(join(REPO_ROOT, CENSUS_DOC_PATH), "utf8");
const ledgerContent: string = readFileSync(join(REPO_ROOT, DEFERRED_LEDGER_PATH), "utf8");
const docInvIds: ReadonlySet<string> = extractInvIds(docContent);
const censusIds: readonly string[] = CENSUS_ROWS.map(row => row.id);

/** Tallies one string-valued census field into a count map. */
function tallyField(field: "machine" | "verdict" | "disposition"): Map<string, number> {
  const counts = new Map<string, number>();
  for (const row of CENSUS_ROWS) {
    const value = row[field];
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return counts;
}

// ─── Tier 1: doc extraction ──────────────────────────────────────────────────

describe("invariant doc — extraction", () => {
  test("the doc id corpus meets the sanity floor (a broken scanner cannot fake green)", () => {
    expect(docInvIds.size).toBeGreaterThanOrEqual(MIN_DOC_INV_IDS);
  });

  test("the extractor collects real invariant ids, not prose fragments", () => {
    for (const id of docInvIds) {
      expect(INV_TOKEN_SINGLE_PATTERN.test(id)).toBe(true);
    }
    expect(docInvIds.has("INV-S1")).toBe(true);
    expect(docInvIds.has("INV-PC3")).toBe(true);
  });
});

// ─── Tier 1b: doc line pins ─────────────────────────────────────────────────

describe("invariant doc — statement line pins", () => {
  /**
   * Maps every doc table row to its 1-based line: each statement row
   * starts the line with `| INV-<machine><n> |`. First occurrence wins —
   * a duplicate id here would fail the bijection tier's uniqueness check
   * anyway.
   */
  const statementLineById = new Map<string, number>();
  docContent.split("\n").forEach((line, index) => {
    const match = line.match(/^\| (INV-[A-Z]+\d+) \|/u);
    if (match && !statementLineById.has(match[1])) {
      statementLineById.set(match[1], index + 1);
    }
  });

  test("every doc table row is discovered at its line (a broken scanner cannot fake green)", () => {
    expect(statementLineById.size).toBe(docInvIds.size);
  });

  test("every census docLine pin matches the invariant's statement row in the doc", () => {
    const mismatches: readonly string[] = CENSUS_ROWS.flatMap(row => {
      const actual = statementLineById.get(row.id);
      return actual === row.docLine
        ? []
        : [`${row.id}: census docLine ${row.docLine}, doc line ${actual ?? "MISSING"}`];
    });
    expect(mismatches).toEqual([]);
  });
});

// ─── Tier 2: doc ↔ census bijection ─────────────────────────────────────────

describe("bijection — doc ids ≡ census ids", () => {
  test("every doc id has a census row and every census id is still documented (BOTH directions)", () => {
    const report = diffInvIdBijection(docInvIds, censusIds);
    expect(report.missingFromCensus).toEqual([]);
    expect(report.missingFromDoc).toEqual([]);
  });

  test("census ids are unique across the registry", () => {
    expect(new Set(censusIds).size).toBe(censusIds.length);
  });
});

// ─── Tier 3: completeness oracle ─────────────────────────────────────────────

describe("completeness oracle — the registry is well-formed", () => {
  test("exactly 67 rows under 12 non-empty machine keys", () => {
    expect(CENSUS_ROWS).toHaveLength(EXPECTED_TOTAL_ROWS);
    const machineKeys = Object.keys(INVARIANT_CENSUS);
    expect(machineKeys).toHaveLength(EXPECTED_MACHINE_COUNT);
    expect(machineKeys.toSorted((a, b) => a.localeCompare(b))).toEqual(
      [...MACHINE_KEYS].toSorted((a, b) => a.localeCompare(b))
    );
    for (const key of MACHINE_KEYS) {
      expect(INVARIANT_CENSUS[key].length).toBeGreaterThan(0);
    }
  });

  test("every row sits under its declared machine key, and the flat view is the exact union", () => {
    const flattened: InvariantCensusEntry[] = [];
    for (const key of MACHINE_KEYS) {
      for (const row of INVARIANT_CENSUS[key]) {
        expect(row.machine).toBe(key);
        flattened.push(row);
      }
    }
    expect(flattened).toHaveLength(EXPECTED_TOTAL_ROWS);
    expect(new Set(flattened)).toEqual(new Set(CENSUS_ROWS));
  });

  test("per-machine counts match the pinned split", () => {
    const counts = tallyField("machine");
    for (const [machine, expected] of Object.entries(EXPECTED_PER_MACHINE)) {
      expect(counts.get(machine)).toBe(expected);
    }
  });

  test("verdicts stay inside the closed value set with the pinned tallies", () => {
    const counts = tallyField("verdict");
    expect([...counts.keys()].toSorted((a, b) => a.localeCompare(b))).toEqual(
      Object.keys(EXPECTED_VERDICTS).toSorted((a, b) => a.localeCompare(b))
    );
    for (const [verdict, expected] of Object.entries(EXPECTED_VERDICTS)) {
      expect(counts.get(verdict)).toBe(expected);
    }
  });

  test("dispositions stay inside the four legal values with the pinned tallies", () => {
    const counts = tallyField("disposition");
    expect([...counts.keys()].toSorted((a, b) => a.localeCompare(b))).toEqual(
      Object.keys(EXPECTED_DISPOSITIONS).toSorted((a, b) => a.localeCompare(b))
    );
    for (const [disposition, expected] of Object.entries(EXPECTED_DISPOSITIONS)) {
      expect(counts.get(disposition)).toBe(expected);
    }
  });

  test("every row carries at least one named test binding", () => {
    for (const row of CENSUS_ROWS) {
      expect(row.bindings.length).toBeGreaterThan(0);
    }
  });

  test("doc drift is recorded on exactly the drifted rows", () => {
    const drifted = CENSUS_ROWS.filter(row => row.docDrift !== undefined);
    expect(drifted).toHaveLength(EXPECTED_DOC_DRIFT_ROWS);
  });

  test("every PIN row carries a ledger pointer (non-PIN rows may carry one too)", () => {
    for (const row of CENSUS_ROWS) {
      if (row.disposition === "PIN-APP-LAYER+DOC-DRIFT") {
        expect(row.ledgerRef).toBeDefined();
      }
    }
  });

  test("every ledger pointer on any row is well-formed and live in the deferred-items ledger", () => {
    const referenced = CENSUS_ROWS.filter(row => row.ledgerRef !== undefined);
    expect(referenced.length).toBeGreaterThan(0);
    for (const row of referenced) {
      // A missing pointer falls back to an id no ledger row can ever carry,
      // so the liveness assertion fails loudly.
      const ref = row.ledgerRef ?? "";
      expect(ledgerRefIsLive(ledgerContent, ref)).toBe(true);
    }
  });
});

// ─── Tier 4: binding resolution — one test per census row ──────────────────

describe("binding resolution — every census row's named tests exist on disk", () => {
  for (const row of CENSUS_ROWS) {
    test(`${row.id} — every binding resolves (testPath exists, testName greppable)`, () => {
      const failures: string[] = [];
      for (const binding of row.bindings) {
        const diagnosis = describeBindingFailure(resolveBinding(liveReadFileAt, binding));
        if (diagnosis !== null) {
          failures.push(diagnosis);
        }
      }
      expect(failures).toEqual([]);
    });
  }
});

// ─── Tier 5: negative self-test harness — injected drift must go red ────────

describe("negative self-test — the oracle catches injected drift", () => {
  test("a fake doc id is reported as missing from the census (and nothing else)", () => {
    const injected = new Set(docInvIds);
    injected.add("INV-ZZ9");
    const report = diffInvIdBijection(injected, censusIds);
    expect(report.missingFromCensus).toEqual(["INV-ZZ9"]);
    expect(report.missingFromDoc).toEqual([]);
  });

  test("a census id that left the doc is reported as missing from the doc (and nothing else)", () => {
    const report = diffInvIdBijection(docInvIds, [...censusIds, "INV-QQ1"]);
    expect(report.missingFromDoc).toEqual(["INV-QQ1"]);
    expect(report.missingFromCensus).toEqual([]);
  });

  test("a phantom citation on an existing file is reported as name-not-found", () => {
    const phantom: InvariantCensusBinding = {
      testPath: "backend/db/test/logic/invariants/invariant-census.catalog.ts",
      testName: "phantom test title that exists nowhere in the corpus",
    };
    expect(resolveBinding(liveReadFileAt, phantom)).toEqual({
      status: "name-not-found",
      testPath: phantom.testPath,
      testName: phantom.testName,
    });
  });

  test("a binding naming a file that does not exist is reported as missing-file", () => {
    const phantom: InvariantCensusBinding = {
      testPath: "backend/db/test/logic/invariants/no-such-suite.test.ts",
      testName: "anything",
    };
    expect(resolveBinding(liveReadFileAt, phantom)).toEqual({
      status: "missing-file",
      testPath: phantom.testPath,
    });
  });

  test("path-escape attempts are reported as unsafe, never read", () => {
    const parentEscape: InvariantCensusBinding = { testPath: "../outside-the-repo.test.ts", testName: "x" };
    const absoluteEscape: InvariantCensusBinding = { testPath: "/etc/passwd", testName: "x" };
    expect(resolveBinding(liveReadFileAt, parentEscape)).toEqual({
      status: "unsafe-path",
      testPath: parentEscape.testPath,
    });
    expect(resolveBinding(liveReadFileAt, absoluteEscape)).toEqual({
      status: "unsafe-path",
      testPath: absoluteEscape.testPath,
    });
  });

  test("a well-formed binding resolves ok against the injectable file view", () => {
    const view = new Map<string, string>([["some/suite.test.ts", "test('the real title', () => {});"]]);
    const good: InvariantCensusBinding = { testPath: "some/suite.test.ts", testName: "the real title" };
    expect(resolveBinding(path => view.get(path), good)).toEqual({ status: "ok" });
  });

  test("a dead ledger pointer is rejected and a live row id is accepted", () => {
    expect(ledgerRefIsLive(ledgerContent, "D-999")).toBe(false);
    expect(ledgerRefIsLive(ledgerContent, "not-a-ref")).toBe(false);
    const livePinRefs = CENSUS_ROWS.filter(
      row => row.disposition === "PIN-APP-LAYER+DOC-DRIFT" && row.ledgerRef !== undefined
    ).map(row => row.ledgerRef ?? "");
    expect(livePinRefs.length).toBeGreaterThan(0);
    for (const ref of livePinRefs) {
      expect(ledgerRefIsLive(ledgerContent, ref)).toBe(true);
    }
  });
});
