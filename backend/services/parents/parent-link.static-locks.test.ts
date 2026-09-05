/**
 * Static locks — single-writer, no-LIKE, no-audit, no-console,
 * single-notifications-writer.
 *
 * Pure filesystem tier — ZERO server boot, ZERO DB access (read-only
 * `node:fs` traversal, `handshake-code-immutability-scan` precedent).
 * Every assert is load-bearing for INV-P1 (`linkParentIfUnlinked` is the
 * ONLY non-null `students.parent_id` producer), zero audit writes off the
 * admin path, no-LIKE discovery, engine-only notifications — this suite IS
 * the security audit for those invariants.
 *
 * WHAT THIS LOCKS:
 *  (a) `students.parent_id` single-writer: across the backend production
 *      trees, the ONLY non-null `students.parent_id` write is the guarded
 *      `UPDATE students SET parent_id … WHERE id AND parent_id IS NULL`
 *      inside `StudentRepository.linkParentIfUnlinked`
 *      (`backend/db/repo/students/student.repository.ts`), and its ONLY
 *      production caller is `ParentLinkRequestService.respondToLinkRequest`.
 *      Allowed-with-cause (test-janitorial):
 *      `backend/db/test/entity-setup.ts` and `backend/db/seeds/**` — both
 *      currently write `parentId: null` or nothing, so the live violation
 *      set is EMPTY with the allowlist merely as future-proofing; any new
 *      writer requires an explicit allowlist edit reviewed as a PR note.
 *  (b) zero-LIKE: NO `ilike(`/`like(` construction in any new module —
 *      `backend/services/parents/`, `backend/db/repo/parents/parent-link-request.repository.ts`,
 *      `backend/graphql/{query,mutation,pothos}/parents/`, the parent-link
 *      frontend trees and lib helpers (discovery is exact-match on the
 *      handshake code).
 *  (c) zero `auditLogs` writes in the new modules (audit writes live on
 *      the admin path only) — no insert shape, no raw insert, no audit-module
 *      import. Docblock MENTIONS of `audit_logs` are not writes and do not
 *      fire the write-shape scanners.
 *  (d) zero `console.*` calls in all new/modified source files, backend and
 *      frontend — INCLUDING the new parent-link test files (tests use the test
 *      runner's `testLogger` facilities per `.agents/instructions/tests.instructions.md`;
 *      never `console.*`). The scanner matches call-form only, so a docblock
 *      mention of `console.*` cannot trip it and, symmetrically, cannot
 *      smuggle a real usage past the gate.
 *  (e) single-notifications-writer: the parent-link modules reference ONLY
 *      `NotificationEngine.emitForUser` / `NotificationEngine.publishReceipts`
 *      (per `backend/services/AGENTS.md` — the engine is the ONLY writer of
 *      `notifications` rows) and import/call NO direct notifications insert
 *      path. Repo-wide, the direct `insert(notifications)` shape exists in
 *      EXACTLY ONE production file: the engine's own repository.
 *
 * NON-VACUITY: every scanner is a pure function over (path → content) maps
 * and is also exercised against crafted in-memory fixtures that MUST
 * produce violations, plus benign fixtures that MUST NOT.
 *
 * DETERMINISM: file discovery sorts names with `localeCompare` at read
 * time; repeated traversals yield identical orderings.
 *
 * ROOT PIN: the repo root is derived RELATIVELY from this suite's
 * own location (`backend/services/parents/` → three levels up) — never from
 * `process.cwd()` — so the scan paths are environment-insensitive. A corpus
 * guard proves the derivation resolved the real repo root.
 *
 * LEXICAL CAVEAT (accepted by design, immutability-scan precedent):
 * text-level scans can flag occurrences inside comments/strings; false
 * positives are visible and cheap, false negatives require intentionally
 * obfuscated code which fails review anyway. Scan targets EXCLUDE
 * `*.test.ts` except where lock (d) deliberately includes the named new
 * parent-link test files (console ban applies to tests too).
 * `backend/drizzle/**` migration snapshots are data, not source, and are
 * outside the scanned trees by design.
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
const REPO_ROOT = join(import.meta.dir, "..", "..", "..");

/**
 * Recursively lists `.ts`/`.tsx` files under `rootDir`, deterministically
 * sorted (skips missing roots — a missing CONTRACTED tree is surfaced by
 * the corpus guards, not silently dropped). Tests can be excluded; each
 * file is labeled repo-relative so violations name the owning file.
 */
function listSourceFiles(root: string, rootDir: string, options?: { excludeTests?: boolean }): SourceFile[] {
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
        walk(childAbsolute, childSegments);
        continue;
      }
      if (!entry.isFile() || (!entry.name.endsWith(".ts") && !entry.name.endsWith(".tsx"))) {
        continue;
      }
      if (options?.excludeTests && entry.name.endsWith(".test.ts")) {
        continue;
      }
      collected.push({
        label: `${root}/${childSegments.join("/")}`,
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

/** Filters a corpus down to the files whose label sits in the allowlist. */
function allowedFiles(violations: readonly string[], allow: ReadonlySet<string>): string[] {
  return violations.filter(label => !allow.has(label));
}

// ─── Scanned corpora (explicit, reviewed, environment-independent) ──────────

/** Backend production trees for lock (a) — NON-NULL parent_id write shapes. */
const BACKEND_PROD_TREES: readonly (readonly [string, string])[] = [
  ["backend/db/repo", "backend/db/repo"],
  ["backend/db/seeds", "backend/db/seeds"],
  ["backend/services", "backend/services"],
  ["backend/graphql", "backend/graphql"],
  ["backend/lib", "backend/lib"],
];

/** Test-janitorial path allowance (entity-setup fixtures). */
const ENTITY_SETUP: readonly (readonly [string, string])[] = [
  ["backend/db/test/entity-setup.ts", "backend/db/test/entity-setup.ts"],
];

/**
 * The new parent-link backend modules — locks (b), (c), (e). Exactly the
 * created surfaces: parents service tree (production sources only), the
 * parent-link request repository file, and the three GraphQL parents dirs.
 */
const NEW_BACKEND_MODULE_TREES: readonly (readonly [string, string])[] = [
  ["backend/services/parents", "backend/services/parents"],
  ["backend/graphql/query/parents", "backend/graphql/query/parents"],
  ["backend/graphql/mutation/parents", "backend/graphql/mutation/parents"],
  ["backend/graphql/pothos/parents", "backend/graphql/pothos/parents"],
];

const PARENT_LINK_REQUEST_REPOSITORY = "backend/db/repo/parents/parent-link-request.repository.ts";
const PARENT_LINK_REQUEST_REPOSITORY_CORPUS: readonly (readonly [string, string])[] = [
  [PARENT_LINK_REQUEST_REPOSITORY, PARENT_LINK_REQUEST_REPOSITORY],
];

/**
 * Frontend new/modified corpus for locks (b)/(d). The parent-link view trees
 * shipped on this ticket are
 * `frontend/views/parent/handshake/` and `frontend/views/students/link-requests/`
 * (the generic `frontend/views/parents/` convention does not exist in this
 * repo) and are scanned here alongside the
 * `frontend/graphql/sharedDocuments/parents/` tree, the new lib
 * helpers plus the one modified nav file.
 */
const FRONTEND_NEW_TREES: readonly (readonly [string, string])[] = [
  ["frontend/views/parent/handshake", "frontend/views/parent/handshake"],
  ["frontend/views/students/link-requests", "frontend/views/students/link-requests"],
  ["frontend/graphql/sharedDocuments/parents", "frontend/graphql/sharedDocuments/parents"],
];

const FRONTEND_NEW_FILES: readonly (readonly [string, string])[] = [
  ["frontend/lib/parent-link-denials.ts", "frontend/lib/parent-link-denials.ts"],
  ["frontend/lib/parent-link-request-status.ts", "frontend/lib/parent-link-request-status.ts"],
  ["frontend/views/dashboard/nav/navItems.ts", "frontend/views/dashboard/nav/navItems.ts"],
  ["frontend/graphql/sharedDocuments/index.ts", "frontend/graphql/sharedDocuments/index.ts"],
];

/** The new/modified backend files outside the parents module trees. */
const BACKEND_NEW_FILES: readonly (readonly [string, string])[] = [
  ["backend/db/repo/students/student.repository.ts", "backend/db/repo/students/student.repository.ts"],
  ["backend/services/index.ts", "backend/services/index.ts"],
  ["backend/graphql/mutation/index.ts", "backend/graphql/mutation/index.ts"],
  ["backend/graphql/query/index.ts", "backend/graphql/query/index.ts"],
  ["backend/graphql/pothos/shared/enum.pothos.ts", "backend/graphql/pothos/shared/enum.pothos.ts"],
  ["backend/enum/shared/link-status.enum.ts", "backend/enum/shared/link-status.enum.ts"],
  ["backend/types/parents/parent-link-request.types.ts", "backend/types/parents/parent-link-request.types.ts"],
  ["backend/db/schema/parents/parent-link-requests.ts", "backend/db/schema/parents/parent-link-requests.ts"],
];

/**
 * The new parent-link test files — lock (d) bans `console.*` here too (tests
 * use `testLogger`, never `console.*`; a docblock MENTION like the one in
 * `student.repository.test.ts` is not a call and does not fire).
 */
const NEW_TEST_FILES: readonly (readonly [string, string])[] = [
  [
    "backend/services/parents/parent-link-request.service.test.ts",
    "backend/services/parents/parent-link-request.service.test.ts",
  ],
  [
    "backend/services/parents/parent-link-request.chaos.test.ts",
    "backend/services/parents/parent-link-request.chaos.test.ts",
  ],
  [
    "backend/services/parents/parent-link.static-locks.test.ts",
    "backend/services/parents/parent-link.static-locks.test.ts",
  ],
  ["backend/graphql/test/parent-link.wire.test.ts", "backend/graphql/test/parent-link.wire.test.ts"],
  [
    "backend/db/test/repo/students/student.repository.test.ts",
    "backend/db/test/repo/students/student.repository.test.ts",
  ],
  [
    "test/workflows/parents/parent-link-request.journey.test.ts",
    "test/workflows/parents/parent-link-request.journey.test.ts",
  ],
  [
    "frontend/graphql/sharedDocuments/parents/parent-link.documents.test.ts",
    "frontend/graphql/sharedDocuments/parents/parent-link.documents.test.ts",
  ],
];

function collect(corpus: readonly (readonly [string, string])[], excludeTests: boolean): SourceFile[] {
  return corpus.flatMap(([root, path]) =>
    path.includes(".") ? listSingleFile(path) : listSourceFiles(root, join(REPO_ROOT, path), { excludeTests })
  );
}

const backendProdSources: SourceFile[] = collect(BACKEND_PROD_TREES, true).concat(collect(ENTITY_SETUP, true));
const newBackendModuleSources: SourceFile[] = collect(NEW_BACKEND_MODULE_TREES, true).concat(
  collect(PARENT_LINK_REQUEST_REPOSITORY_CORPUS, true)
);
const frontendNewSources: SourceFile[] = collect(FRONTEND_NEW_TREES, true).concat(collect(FRONTEND_NEW_FILES, true));
const backendNewFileSources: SourceFile[] = collect(BACKEND_NEW_FILES, true);
const newTestFileSources: SourceFile[] = collect(NEW_TEST_FILES, false);

/**
 * Extracts the bounded window following every anchor match — bounded lazy
 * quantifiers (`[\s\S]{0,400}?`) are replaced by code-level slicing so the
 * scanners stay linear and lint-clean.
 */
function anchoredWindows(content: string, anchor: RegExp, span: number): string[] {
  const windows: string[] = [];
  for (const match of content.matchAll(anchor)) {
    const start = (match.index ?? 0) + match[0].length;
    windows.push(content.slice(start, start + span));
  }
  return windows;
}

/**
 * A captured value token counts as NON-NULL unless it is a literal
 * null/undefined. `caseInsensitive` covers the SQL context (`NULL`), the
 * default is the TS-identifier context (only the exact literals are null).
 */
function isNonNullValueToken(token: string | undefined, caseInsensitive = false): boolean {
  if (token === undefined) {
    return false;
  }
  return caseInsensitive ? !/^(?:null|undefined)$/i.test(token) : !/^(?:null|undefined)$/u.test(token);
}

// ─── Lock (a) — single-writer scanners for students.parent_id ────────────────

/** EXHAUSTIVE allowlist: the guarded production writer + the test-janitorial paths. */
const PARENT_ID_WRITER_ALLOWLIST: ReadonlySet<string> = new Set([
  "backend/db/repo/students/student.repository.ts", // linkParentIfUnlinked — THE writer (INV-P1)
  "backend/db/test/entity-setup.ts", // test janitorial (currently parentId: null only)
]);

/**
 * Drizzle update-set scanner — flags a `.set({ … })` payload whose own
 * braces assign `parentId` a NON-NULL value: either the shorthand
 * `parentId,` or an explicit `parentId: <token>` whose captured value
 * token is not a null/undefined literal. The `[^{}]*` window cannot cross
 * the payload's closing brace, keeping read projections and plain object
 * literals out of the match.
 */
const SET_PARENT_ID_SHORTHAND = /\.set\(\s*\{[^{}]*\bparentId\s*[,}]/u;
const SET_PARENT_ID_VALUE = /\.set\(\s*\{[^{}]*\bparentId\s*:\s*([^\s,}]+)/gu;

function scanDrizzleSetParentIdNonNull(files: readonly SourceFile[]): string[] {
  return files.flatMap(file => {
    const shorthand = SET_PARENT_ID_SHORTHAND.test(file.content);
    const explicit = [...file.content.matchAll(SET_PARENT_ID_VALUE)].some(match => isNonNullValueToken(match[1]));
    return shorthand || explicit ? [file.label] : [];
  });
}

/**
 * Students-insert scanner — every `.insert(students)` chain's bounded
 * values window is probed for a `parentId` payload that is non-null
 * (shorthand or an explicit non-null-literal token).
 */
const STUDENTS_INSERT_ANCHOR = /insert\(\s*students\s*\)/gu;
const VALUES_PARENT_ID_SHORTHAND = /\bparentId\s*[,}]/u;
const VALUES_PARENT_ID_VALUE = /\bparentId\s*:\s*([^\s,}]+)/gu;

function scanDrizzleStudentsInsertParentIdNonNull(files: readonly SourceFile[]): string[] {
  return files.flatMap(file => {
    const fired = anchoredWindows(file.content, STUDENTS_INSERT_ANCHOR, 400).some(
      window =>
        VALUES_PARENT_ID_SHORTHAND.test(window) ||
        [...window.matchAll(VALUES_PARENT_ID_VALUE)].some(match => isNonNullValueToken(match[1]))
    );
    return fired ? [file.label] : [];
  });
}

/**
 * Raw-SQL update scanner — captures each `SET parent_id = <token>` value
 * token and flags the statement when the token is not a null literal.
 */
const RAW_SET_PARENT_ID = /\bset\s+parent_id\s*=\s*([^\s,;)]+)/giu;

function scanRawSqlSetParentIdNonNull(files: readonly SourceFile[]): string[] {
  return files.flatMap(file =>
    [...file.content.matchAll(RAW_SET_PARENT_ID)].some(match => isNonNullValueToken(match[1], true)) ? [file.label] : []
  );
}

/** Raw-SQL students-insert scanner — ANY raw `insert into students` that mentions `parent_id` is a review event. */
const RAW_STUDENTS_INSERT_ANCHOR = /insert\s+into\s+students\b/giu;

function scanRawSqlStudentsInsertParentId(files: readonly SourceFile[]): string[] {
  return files.flatMap(file =>
    anchoredWindows(file.content, RAW_STUDENTS_INSERT_ANCHOR, 400).some(window => /\bparent_id\b/iu.test(window))
      ? [file.label]
      : []
  );
}

/** Union of every lock-(a) scanner. */
function scanAllParentIdWriters(files: readonly SourceFile[]): string[] {
  return [
    ...scanDrizzleSetParentIdNonNull(files),
    ...scanDrizzleStudentsInsertParentIdNonNull(files),
    ...scanRawSqlSetParentIdNonNull(files),
    ...scanRawSqlStudentsInsertParentId(files),
  ]
    .filter((label, index, all) => all.indexOf(label) === index)
    .toSorted((a, b) => a.localeCompare(b));
}

// ─── Lock (b) — zero-LIKE scanner ────────────────────────────────────────────

/**
 * LIKE-construction scanner — flags `ilike(` / `like(` call-form (Drizzle
 * `ilike`/`like` operators, raw SQL `ILIKE (`). The `\b` keeps
 * `alike(`/`ilikex(`-shaped identifiers out; English prose like "works
 * like (" would fire visibly and is not present in these modules.
 */
function scanLikeConstructions(files: readonly SourceFile[]): string[] {
  return files.flatMap(file => (/\b(?:ilike|like)\s*\(/iu.test(file.content) ? [file.label] : []));
}

// ─── Lock (c) — zero-audit scanners ──────────────────────────────────────────

/** Drizzle audit-insert scanner — flags `.insert(auditLogs)` call-form. */
function scanDrizzleAuditInserts(files: readonly SourceFile[]): string[] {
  return files.flatMap(file => (/\binsert\s*\(\s*auditLogs\s*\)/u.test(file.content) ? [file.label] : []));
}

/** Raw audit-insert scanner — flags `insert into audit_logs`. */
function scanRawSqlAuditInserts(files: readonly SourceFile[]): string[] {
  return files.flatMap(file => (/\binsert\s+into\s+audit_logs\b/iu.test(file.content) ? [file.label] : []));
}

/** Audit-module import scanner — flags imports resolving to any `audit` module (schema, repo, service). */
function scanAuditModuleImports(files: readonly SourceFile[]): string[] {
  return files.flatMap(file =>
    /from\s+["'][^"']*\/audit(?:[-/][^"']*)?["']|\b(?:AuditService|AuditLogRepository)\b/u.test(file.content)
      ? [file.label]
      : []
  );
}

/** Union of every lock-(c) scanner. */
function scanAllAuditWriters(files: readonly SourceFile[]): string[] {
  return [...scanDrizzleAuditInserts(files), ...scanRawSqlAuditInserts(files), ...scanAuditModuleImports(files)]
    .filter((label, index, all) => all.indexOf(label) === index)
    .toSorted((a, b) => a.localeCompare(b));
}

// ─── Lock (d) — zero-console scanner ─────────────────────────────────────────

/**
 * Console-call scanner — call-form only (docblock mentions of `console.*`
 * never fire). The member alternation is trimmed to the sixteen console
 * methods that can appear in reviewed application code; exotic ones
 * (`dirxml`, `timeStamp`, `timeLog`, `groupCollapsed`, `profile`,
 * `profileEnd`) are out of the lexical scope by design.
 */
const CONSOLE_CALL =
  /console\s*\.\s*(?:log|warn|error|info|debug|trace|dir|table|group|groupEnd|time|timeEnd|assert|count|countReset|clear)\s*\(/u;

function scanConsoleCalls(files: readonly SourceFile[]): string[] {
  return files.flatMap(file => (CONSOLE_CALL.test(file.content) ? [file.label] : []));
}

// ─── Lock (e) — single-notifications-writer scanners ─────────────────────────

/** Direct notifications-insert scanner — Drizzle `.insert(notifications)` call-form. */
function scanDrizzleNotificationsInserts(files: readonly SourceFile[]): string[] {
  return files.flatMap(file => (/\binsert\s*\(\s*notifications\s*\)/u.test(file.content) ? [file.label] : []));
}

/** Raw notifications-insert scanner — flags `insert into notifications`. */
function scanRawSqlNotificationsInserts(files: readonly SourceFile[]): string[] {
  return files.flatMap(file => (/\binsert\s+into\s+notifications\b/iu.test(file.content) ? [file.label] : []));
}

/** Notifications data-layer import scanner — flags imports of the notifications schema or repository. */
function scanNotificationsDataLayerImports(files: readonly SourceFile[]): string[] {
  return files.flatMap(file =>
    /from\s+["'][^"']*db\/(?:schema|repo)\/notifications/u.test(file.content) ? [file.label] : []
  );
}

/** Union of the direct-insert scanners (the shape the engine exclusively owns via its repository). */
function scanAllNotificationsDirectInserts(files: readonly SourceFile[]): string[] {
  return [...scanDrizzleNotificationsInserts(files), ...scanRawSqlNotificationsInserts(files)]
    .filter((label, index, all) => all.indexOf(label) === index)
    .toSorted((a, b) => a.localeCompare(b));
}

/** Every `NotificationEngine.<member>` reference in a corpus (call-form AND docblock mentions — fail-closed). */
function scanNotificationEngineMembers(files: readonly SourceFile[]): Map<string, string[]> {
  const byFile = new Map<string, string[]>();
  for (const file of files) {
    const members = [...file.content.matchAll(/NotificationEngine\s*\.\s*(\w+)/gu)].map(match => match[1]);
    if (members.length > 0) {
      byFile.set(file.label, members);
    }
  }
  return byFile;
}

/** The ONLY members of the engine surface the parent-link modules may use. */
const ALLOWED_ENGINE_MEMBERS: ReadonlySet<string> = new Set(["emitForUser", "publishReceipts"]);

// ─── Corpus guards — the scans must never be vacuously empty ─────────────────

describe("static locks — corpus guards (the scans have subjects)", () => {
  test("root pin resolves the real repo root (relative derivation, not cwd)", () => {
    expect(existsSync(join(REPO_ROOT, "package.json"))).toBe(true);
    expect(existsSync(join(REPO_ROOT, "backend"))).toBe(true);
    expect(existsSync(join(REPO_ROOT, "frontend"))).toBe(true);
  });

  test("every backend production tree contributes sources (guard against silent root drift)", () => {
    for (const [root] of BACKEND_PROD_TREES) {
      const count = backendProdSources.filter(file => file.label.startsWith(`${root}/`)).length;
      expect(count, `${root} must contribute scanned sources`).toBeGreaterThanOrEqual(3);
    }
  });

  test("every new backend parents module tree contributes sources", () => {
    for (const [root] of NEW_BACKEND_MODULE_TREES) {
      const count = newBackendModuleSources.filter(file => file.label.startsWith(`${root}/`)).length;
      expect(count, `${root} must contribute scanned sources`).toBeGreaterThanOrEqual(1);
    }
    expect(newBackendModuleSources.map(file => file.label)).toContain(PARENT_LINK_REQUEST_REPOSITORY);
  });

  test("the frontend new/modified corpus is populated with the shipped parent-link files", () => {
    const labels = frontendNewSources.map(file => file.label);
    expect(labels).toContain("frontend/views/parent/handshake/HandshakeDiscoveryContainer.tsx");
    expect(labels).toContain("frontend/views/students/link-requests/StudentLinkRequestsContainer.tsx");
    expect(labels).toContain("frontend/graphql/sharedDocuments/parents/parent-link.documents.ts");
    expect(labels).toContain("frontend/lib/parent-link-denials.ts");
    expect(labels).toContain("frontend/lib/parent-link-request-status.ts");
    expect(labels).toContain("frontend/views/dashboard/nav/navItems.ts");
  });

  test("the guarded parent_id writer and the engine-only notification writers are in the scanned corpora", () => {
    const backendLabels = backendProdSources.concat(backendNewFileSources).map(file => file.label);
    expect(backendLabels).toContain("backend/db/repo/students/student.repository.ts");
    expect(backendLabels).toContain("backend/services/parents/parent-link-request.service.ts");
    expect(backendLabels).toContain("backend/db/repo/notifications/notification.repository.ts");
  });

  test("the new parent-link test files exist for the console lock (d)", () => {
    expect(newTestFileSources).toHaveLength(NEW_TEST_FILES.length);
  });
});

// ─── Lock (a) — students.parent_id single-writer ─────────────────────────────

describe("lock (a) — students.parent_id single-writer (INV-P1)", () => {
  test("linkParentIfUnlinked exists and is the guarded single-statement writer", () => {
    const writer = backendProdSources.find(file => file.label === "backend/db/repo/students/student.repository.ts");
    expect(writer).toBeDefined();
    const content = writer?.content ?? "";
    expect(content).toContain("linkParentIfUnlinked");
    // The guarded UPDATE: predicate and mutation in ONE statement —
    // `UPDATE students SET parent_id … WHERE id = … AND parent_id IS NULL`.
    expect(content).toMatch(/\.update\(\s*students\s*\)/u);
    expect(content).toMatch(/\bisNull\(\s*students\s*\.\s*parentId\s*\)/u);
    expect(content).toMatch(/\.set\(\s*\{\s*parentId/u);
    expect(content).toMatch(/\.returning\(\)/u);
  });

  test("zero non-null parent_id .set payloads outside the EXHAUSTIVE allowlist", () => {
    const violations = scanDrizzleSetParentIdNonNull(backendProdSources);
    // The one live match IS the sanctioned writer — visible, not assumed.
    expect(violations).toEqual(["backend/db/repo/students/student.repository.ts"]);
    expect(allowedFiles(violations, PARENT_ID_WRITER_ALLOWLIST)).toEqual([]);
  });

  test("zero students inserts assign a non-null parent_id", () => {
    const violations = scanDrizzleStudentsInsertParentIdNonNull(backendProdSources);
    expect(allowedFiles(violations, PARENT_ID_WRITER_ALLOWLIST)).toEqual([]);
  });

  test("zero raw SQL SET parent_id = <non-null> clauses outside the EXHAUSTIVE allowlist", () => {
    const violations = scanRawSqlSetParentIdNonNull(backendProdSources);
    // The one live match is the sanctioned writer's OWN docblock quoting its
    // guarded SQL (`UPDATE students SET parent_id = $2 … parent_id IS NULL`)
    // — visible, not assumed; a SECOND raw-SQL writer would surface here.
    expect(violations).toEqual(["backend/db/repo/students/student.repository.ts"]);
    expect(allowedFiles(violations, PARENT_ID_WRITER_ALLOWLIST)).toEqual([]);
  });

  test("zero raw SQL insert into students statements mention parent_id", () => {
    expect(scanRawSqlStudentsInsertParentId(backendProdSources)).toEqual([]);
  });

  test("union of parent_id write scanners collapses to the allowlist exactly", () => {
    const union = scanAllParentIdWriters(backendProdSources);
    expect(allowedFiles(union, PARENT_ID_WRITER_ALLOWLIST)).toEqual([]);
    expect(union).toEqual(["backend/db/repo/students/student.repository.ts"]);
  });

  test("linkParentIfUnlinked is referenced in production by ONLY its definition and the sanctioned service caller", () => {
    const references = backendProdSources
      .filter(file => /\blinkParentIfUnlinked\b/u.test(file.content))
      .map(file => file.label)
      .toSorted((a, b) => a.localeCompare(b));
    expect(references).toEqual([
      "backend/db/repo/students/student.repository.ts",
      "backend/services/parents/parent-link-request.service.ts",
    ]);
  });
});

// ─── Lock (b) — zero-LIKE on the new modules ─────────────────────────────────

describe("lock (b) — zero LIKE/ilike construction in the new modules", () => {
  test("zero LIKE constructions across the new backend parents modules", () => {
    expect(scanLikeConstructions(newBackendModuleSources)).toEqual([]);
  });

  test("zero LIKE constructions across the parent-link frontend trees and helpers", () => {
    expect(scanLikeConstructions(frontendNewSources)).toEqual([]);
  });

  test("zero LIKE constructions across the remaining new/modified backend files", () => {
    expect(scanLikeConstructions(backendNewFileSources)).toEqual([]);
  });
});

// ─── Lock (c) — zero auditLogs writes in the new modules ─────────────────────

describe("lock (c) — zero auditLogs writes in the new modules (admin-path only)", () => {
  test("zero Drizzle auditLogs inserts in the new backend modules", () => {
    expect(scanDrizzleAuditInserts(newBackendModuleSources)).toEqual([]);
  });

  test("zero raw SQL audit_logs inserts in the new backend modules", () => {
    expect(scanRawSqlAuditInserts(newBackendModuleSources)).toEqual([]);
  });

  test("zero audit-module imports or audit-service identifiers in the new backend modules", () => {
    expect(scanAuditModuleImports(newBackendModuleSources)).toEqual([]);
  });

  test("union of audit scanners is empty across the new modules (docblock mentions are not writes)", () => {
    // The service docblocks deliberately document the ZERO-audit guarantee —
    // those MENTIONS of `audit_logs` must not (and do not) fire the
    // write-shape scanners above.
    expect(scanAllAuditWriters(newBackendModuleSources)).toEqual([]);
  });
});

// ─── Lock (d) — zero console.* in new/modified sources (and new tests) ──────

describe("lock (d) — zero console.* calls (frontend + backend + new tests)", () => {
  test("zero console calls in the new backend parents modules and modified backend files", () => {
    expect(scanConsoleCalls(newBackendModuleSources.concat(backendNewFileSources))).toEqual([]);
  });

  test("zero console calls in the parent-link frontend trees, helpers and nav file", () => {
    expect(scanConsoleCalls(frontendNewSources)).toEqual([]);
  });

  test("zero console calls in the new parent-link test files (testLogger only)", () => {
    expect(scanConsoleCalls(newTestFileSources)).toEqual([]);
  });
});

// ─── Lock (e) — single-notifications-writer ──────────────────────────────────

describe("lock (e) — single notifications writer (engine path only)", () => {
  test("the parents modules import NO notifications data-layer module", () => {
    expect(scanNotificationsDataLayerImports(newBackendModuleSources)).toEqual([]);
  });

  test("the parents modules contain NO direct notifications insert shape", () => {
    expect(scanAllNotificationsDirectInserts(newBackendModuleSources)).toEqual([]);
  });

  test("repo-wide, the direct notifications insert shape exists ONLY in the engine's repository", () => {
    const violations = scanAllNotificationsDirectInserts(backendProdSources);
    expect(violations).toEqual(["backend/db/repo/notifications/notification.repository.ts"]);
  });

  test("every NotificationEngine member used by the parents modules is emitForUser or publishReceipts", () => {
    const membersByFile = scanNotificationEngineMembers(
      newBackendModuleSources.filter(file => file.label.startsWith("backend/services/parents/"))
    );
    expect(membersByFile.size).toBeGreaterThanOrEqual(2); // service + helpers both touch the engine
    for (const [label, members] of membersByFile) {
      const foreign = members.filter(member => !ALLOWED_ENGINE_MEMBERS.has(member));
      expect(foreign, `${label} uses non-engine-contract members`).toEqual([]);
    }
  });

  test("the engine path is positively present: emitForUser in-tx emission and publishReceipts post-commit", () => {
    const engineSources = newBackendModuleSources.filter(file => file.label.startsWith("backend/services/parents/"));
    const service = engineSources.find(
      file => file.label === "backend/services/parents/parent-link-request.service.ts"
    );
    const helpers = engineSources.find(
      file => file.label === "backend/services/parents/parent-link-request.helpers.ts"
    );
    expect(service?.content).toMatch(/from\s+["'][^"']*services\/notifications\/notification-engine\.service["']/u);
    expect(helpers?.content).toMatch(/from\s+["'][^"']*services\/notifications\/notification-engine\.service["']/u);
    expect((service?.content.match(/\bemitForUser\b/gu) ?? []).length).toBeGreaterThanOrEqual(1);
    expect((service?.content.match(/\bpublishReceipts\b/gu) ?? []).length).toBeGreaterThanOrEqual(1);
    expect((helpers?.content.match(/\bemitForUser\b/gu) ?? []).length).toBeGreaterThanOrEqual(1);
  });
});

// ─── Negative fixtures — every scanner provably fires (non-vacuity) ──────────

describe("negative fixtures — every scanner fires on crafted input and spares benign shapes", () => {
  test("set-scanner fires on a mutating students .set payload and on the shorthand form", () => {
    const bad = [
      {
        label: "fixture/mutating.repository.ts",
        content: `await tx.update(students).set({ parentId: parentId }).where(eq(students.id, id));`,
      },
      {
        label: "fixture/shorthand.repository.ts",
        content: `.update(students).set({ parentId, updatedAt: sql\`now()\` })`,
      },
    ];
    expect(scanDrizzleSetParentIdNonNull(bad).toSorted((a, b) => a.localeCompare(b))).toEqual([
      "fixture/mutating.repository.ts",
      "fixture/shorthand.repository.ts",
    ]);
  });

  test("set-scanner spares null writes, read predicates, projections and plain object literals", () => {
    const benign = [
      {
        label: "fixture/unlink.repository.ts",
        content: `await tx.update(students).set({ parentId: null }).where(eq(students.id, id));`,
      },
      {
        label: "fixture/read.repository.ts",
        content: `const rows = await tx.select({ parentId: students.parentId }).from(students).where(eq(students.parentId, value));`,
      },
      {
        label: "fixture/mapper.service.ts",
        content: `return { id: row.id, parentId: row.studentParentId, fullName };`,
      },
    ];
    expect(scanDrizzleSetParentIdNonNull(benign)).toEqual([]);
  });

  test("students-insert scanner fires on a non-null payload and spares the registration null payload", () => {
    const bad = [
      {
        label: "fixture/insert.service.ts",
        content: `.insert(students).values({ id: userId, parentId: 42, balanceHifz: 0 });`,
      },
    ];
    expect(scanDrizzleStudentsInsertParentIdNonNull(bad)).toEqual(["fixture/insert.service.ts"]);
    const benign = [
      {
        label: "fixture/registration.repository.ts",
        content: `.insert(students)\n.values({\n id: userId,\n handshakeCode,\n balanceHifz: 0,\n balanceTajweed: 0,\n balanceReviews: 0,\n parentId: null,\n })\n.returning();`,
      },
      // THE discrimination pin: the parent-link REQUEST insert carries a
      // non-null parentId — for parent_link_requests, never for students.
      {
        label: "fixture/request.helpers.ts",
        content: `.insert(parentLinkRequests).values({ parentId: parentActorId, studentId, expiresAt });`,
      },
    ];
    expect(scanDrizzleStudentsInsertParentIdNonNull(benign)).toEqual([]);
  });

  test("raw-SQL scanners fire on non-null SET and parent_id-bearing students inserts, spare NULL sets", () => {
    expect(
      scanRawSqlSetParentIdNonNull([
        { label: "fixture/raw.repository.ts", content: `UPDATE students SET parent_id = $1 WHERE id = $2` },
      ])
    ).toEqual(["fixture/raw.repository.ts"]);
    expect(
      scanRawSqlSetParentIdNonNull([
        { label: "fixture/null.repository.ts", content: `UPDATE students SET parent_id = NULL` },
      ])
    ).toEqual([]);
    expect(
      scanRawSqlStudentsInsertParentId([
        { label: "fixture/rawinsert.repository.ts", content: `INSERT INTO students (id, parent_id) VALUES ($1, $2)` },
      ])
    ).toEqual(["fixture/rawinsert.repository.ts"]);
    expect(
      scanRawSqlStudentsInsertParentId([
        {
          label: "fixture/plaininsert.repository.ts",
          content: `INSERT INTO students (id, handshake_code) VALUES ($1, $2)`,
        },
      ])
    ).toEqual([]);
  });

  test("LIKE scanner fires on ilike(/like( call-form and spares alike(, ilikex( and equality", () => {
    const bad = [
      {
        label: "fixture/fuzzy.repository.ts",
        content: `const rows = await tx.select().from(students).where(ilike(students.fullName, pattern));`,
      },
      { label: "fixture/rawfuzzy.repository.ts", content: `SELECT * FROM students WHERE full_name LIKE($1)` },
    ];
    expect(scanLikeConstructions(bad).toSorted((a, b) => a.localeCompare(b))).toEqual([
      "fixture/fuzzy.repository.ts",
      "fixture/rawfuzzy.repository.ts",
    ]);
    const benign = [
      {
        label: "fixture/exact.repository.ts",
        content: `const rows = await tx.select().from(students).where(eq(students.handshakeCode, code));`,
      },
      {
        label: "fixture/prose.service.ts",
        content: `// behaves alike (same shape) — and an ilikex( identifier is not LIKE`,
      },
    ];
    expect(scanLikeConstructions(benign)).toEqual([]);
  });

  test("audit scanners fire on insert(auditLogs), raw inserts and audit imports — spare docblock mentions", () => {
    const bad = [
      { label: "fixture/audited.service.ts", content: `await tx.insert(auditLogs).values({ actorId, action });` },
      { label: "fixture/audited.raw.ts", content: `INSERT INTO audit_logs (actor_id, action) VALUES ($1, $2)` },
      {
        label: "fixture/audited.import.ts",
        content: `import { AuditService } from "@/backend/services/admin/audit.service";`,
      },
    ];
    expect(scanAllAuditWriters(bad)).toHaveLength(3);
    const benign = [
      {
        label: "fixture/docblock.service.ts",
        content: `/** Zero audit rows: nothing on this surface writes \`audit_logs\` by design. */`,
      },
    ];
    expect(scanAllAuditWriters(benign)).toEqual([]);
  });

  test("console scanner fires on call-form and spares backticked docblock mentions", () => {
    // The firing shapes are CONSTRUCTED via join so this scanner file stays
    // clean under its own lock (d) — it is itself one of the scanned new
    // test files, and must contain no literal console call-form.
    const consoleErrorCall = `${["console", "error"].join(".")}(`;
    const consoleDebugCall = `${["console", "debug"].join(".")}(`;
    const bad = [
      { label: "fixture/logger.service.ts", content: `${consoleErrorCall}"unexpected failure", error);` },
      { label: "fixture/debug.view.tsx", content: `useEffect(() => { ${consoleDebugCall}state); }, [state]);` },
    ];
    expect(scanConsoleCalls(bad)).toHaveLength(2);
    expect(scanConsoleCalls(newTestFileSources)).toEqual([]);
    const benign = [
      {
        label: "fixture/docblock.test.ts",
        content: `* Uses \`bun:test\`; no \`console.*\`; no \`expect(...).rejects.toThrow()\``,
      },
    ];
    expect(scanConsoleCalls(benign)).toEqual([]);
  });

  test("notifications scanners fire on data-layer imports and direct inserts, spare the engine import", () => {
    const bad = [
      { label: "fixture/direct.service.ts", content: `await tx.insert(notifications).values(insert);` },
      { label: "fixture/raw.service.ts", content: `INSERT INTO notifications (user_id, title) VALUES ($1, $2)` },
      {
        label: "fixture/import.service.ts",
        content: `import { notifications } from "@/backend/db/schema/notifications/notifications";`,
      },
    ];
    expect(scanAllNotificationsDirectInserts(bad)).toHaveLength(2);
    expect(scanNotificationsDataLayerImports(bad)).toEqual(["fixture/import.service.ts"]);
    const benign = [
      {
        label: "fixture/engine.helpers.ts",
        content: `import { NotificationEngine } from "@/backend/services/notifications/notification-engine.service";\nawait NotificationEngine.emitForUser(input, locale, tx);`,
      },
    ];
    expect(scanAllNotificationsDirectInserts(benign)).toEqual([]);
    expect(scanNotificationsDataLayerImports(benign)).toEqual([]);
  });
});
