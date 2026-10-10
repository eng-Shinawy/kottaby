/**
 * Retention anti-drift static census — sessions, reports, recitations,
 * homework submissions, and evaluation records are retained permanently
 * (production-readiness checklist rows 1.4.1/1.4.3,
 * docs/planning/PRODUCTION_READINESS.md).
 *
 * Until this census existed, retention was verified only by grep-absence:
 * nothing prevented a future `sweep-*` cron route, ops script, or repository
 * delete method from purging history. This DB-free file pins the contract so
 * such drift trips a test instead of slipping through review:
 *
 *  - The scanned corpus is the three retention-adjacent production surfaces:
 *    `backend/db/repo/**` (the only layer allowed to touch tables), the
 *    `app/api/cron/` sweep/reconcile routes, and the `scripts/ops/`
 *    operational scripts. Colocated test files and `test`/`__tests__`
 *    directories are excluded — rollback-contained or run-and-record code,
 *    not production source.
 *
 *  - Hard-delete callsite bijection: a Drizzle `.delete(` builder call is
 *    lexically visible, and the ONLY sanctioned callsites in the corpus are
 *    the two allowlisted ones (curriculum lesson delete, notification
 *    retraction). Any new delete path — against a retention table or not —
 *    must consciously extend the allowlist or remove the callsite. Every
 *    allowlist entry must stay live (no dead entries).
 *
 *  - Retention-targeted zero: no `.delete(<retention-table>)` Drizzle shape
 *    and no raw `DELETE FROM <retention-table>` statement (any casing,
 *    optional `public.` prefix, optional quoting) may appear anywhere in the
 *    corpus — the allowlist cannot cover them.
 *
 * NON-VACUITY: every scanner is a pure function over (label → content) pairs
 * and is exercised against crafted in-memory fixtures that MUST fire, plus
 * benign shapes (reads, the bare `delete` keyword, FK-clause vocabulary,
 * same-prefix tables like `session_request_idempotency`) that MUST stay
 * silent. The negative-control run (a planted temporary `.delete(` in each
 * surface, removed immediately after) is recorded in the launch evidence.
 *
 * DETERMINISM: file discovery sorts names with `localeCompare` at read time;
 * repeated traversals yield identical orderings.
 *
 * LEXICAL CAVEAT (accepted by design, same as the audit-immutability census):
 * text-level scans flag occurrences inside comments/strings and JS
 * collection `.delete(...)` uses; false positives are visible and cheap,
 * false negatives require intentionally obfuscated code which fails review
 * anyway.
 *
 * DB SAFETY: this file opens no database connection — it imports only
 * `bun:test` and `node:fs`/`node:path`, so it runs identically under the
 * PostgreSQL and PGlite providers.
 */

import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

// ─── Contracts under pin ─────────────────────────────────────────────────────

/**
 * The retention-critical Drizzle table identifiers (the exported schema
 * variable names). A stored record in any of these tables is permanent.
 */
const RETENTION_DRIZZLE_IDENTIFIERS = ["evaluations", "homeWork", "recitation", "reports", "session"] as const;

/** The same tables' SQL names (`homeWork` → `home_work`; the rest match). */
const RETENTION_SQL_TABLE_NAMES = ["evaluations", "home_work", "recitation", "reports", "session"] as const;

/** Flags ANY Drizzle delete-builder callsite: `.delete(…` (dot, optional space). */
const DRIZZLE_DELETE_CALLSITE_PATTERN = /\.\s*delete\s*\(/u;

/** Global twin of the callsite pattern for per-file callsite counting. */
const DRIZZLE_DELETE_CALLSITE_GLOBAL_PATTERN = /\.\s*delete\s*\(/gu;

/** Flags a Drizzle delete call whose target is a retention table identifier. */
const DRIZZLE_RETENTION_DELETE_PATTERN = new RegExp(
  String.raw`\.\s*delete\s*\(\s*(?:${RETENTION_DRIZZLE_IDENTIFIERS.join("|")})\b`,
  "u"
);

/**
 * Flags a raw SQL purge of a retention table. The trailing lookahead rejects
 * same-prefix tables (`session_request_idempotency` is NOT `session`).
 */
const RAW_SQL_RETENTION_DELETE_PATTERN = new RegExp(
  String.raw`\bDELETE\s+FROM\s+(?:public\.)?"?(?:${RETENTION_SQL_TABLE_NAMES.join("|")})"?(?![\w"])`,
  "iu"
);

/** Directory names never treated as production source during traversal. */
const EXCLUDED_DIRECTORY_NAMES = new Set(["node_modules", "__tests__", "test"]);

const SCANNED_EXTENSIONS = [".ts", ".tsx"] as const;

/**
 * The three retention-adjacent production surfaces, with per-surface floors
 * (anti-blind-spot: a silently mis-rooted or emptied surface must fail).
 */
const RETENTION_SURFACES = [
  { label: "backend/db/repo", root: join(process.cwd(), "backend", "db", "repo"), minFiles: 50 },
  { label: "app/api/cron", root: join(process.cwd(), "app", "api", "cron"), minFiles: 4 },
  { label: "scripts/ops", root: join(process.cwd(), "scripts", "ops"), minFiles: 10 },
] as const;

/**
 * The ONLY sanctioned hard-delete callsites in the corpus. `callsite` is the
 * live code text re-spot-checked against the file at assertion time — the
 * allowlist cannot rot into a dead entry, and a reshaped callsite (renamed
 * executor, different table) must be consciously re-reviewed.
 */
const DELETE_CALLSITE_ALLOWLIST = [
  {
    path: "backend/db/repo/classes/lesson.repository.ts",
    callsite: "executor.delete(lessons)",
    reason: "curriculum lesson delete — the lessons table, ON DELETE SET NULL, never cascades into history",
  },
  {
    path: "backend/db/repo/notifications/notification.repository.ts",
    callsite: ".delete(notifications)",
    reason: "notification retraction — inbox table scoped by (related_entity_type, related_entity_id)",
  },
] as const;

/** Production files that MUST be inside the scanned corpus (anti-blind-spot sentinels). */
const CORPUS_SENTINEL_PATHS = [
  "backend/db/repo/classes/session.repository.ts",
  "backend/db/repo/classes/report.repository.ts",
  "backend/db/repo/classes/recitation.repository.ts",
  "backend/db/repo/classes/home-work.repository.ts",
  "backend/db/repo/teachers/evaluation.repository.ts",
  "backend/db/repo/classes/lesson.repository.ts",
  "backend/db/repo/notifications/notification.repository.ts",
  "app/api/cron/sweep-sessions/route.ts",
  "app/api/cron/expire-subscriptions/route.ts",
  "app/api/cron/reconcile-paymob-payments/route.ts",
  "app/api/cron/sweep-inactive-teachers/route.ts",
  "scripts/ops/sweep-expired-link-requests.ts",
] as const;

// ─── Read-only traversal (deterministic, test-file-free) ──────────────────────

/** Virtual file unit fed to scanners (tree label + content). */
interface SourceFile {
  readonly label: string;
  readonly content: string;
}

function isExcludedFileName(name: string): boolean {
  return (
    name.endsWith(".test.ts") ||
    name.endsWith(".test.tsx") ||
    name.endsWith(".spec.ts") ||
    name.endsWith(".spec.tsx") ||
    !SCANNED_EXTENSIONS.some(extension => name.endsWith(extension))
  );
}

/**
 * Recursively lists production source files under one surface, deterministically
 * sorted (skips missing roots, excluded directories, and test files). Each file
 * is labeled `<surface>/<relative-path>` so any violation names its surface.
 */
function listSurfaceFiles(surfaceLabel: string, rootDir: string): SourceFile[] {
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
        if (EXCLUDED_DIRECTORY_NAMES.has(entry.name)) {
          continue;
        }
        walk(childAbsolute, childSegments);
        continue;
      }
      if (!entry.isFile() || isExcludedFileName(entry.name)) {
        continue;
      }
      collected.push({
        label: `${surfaceLabel}/${childSegments.join("/")}`,
        content: readFileSync(childAbsolute, "utf8"),
      });
    }
  };
  walk(rootDir, []);
  return collected;
}

/** The retention corpus: every production file across the three surfaces. */
const retentionCorpus: SourceFile[] = RETENTION_SURFACES.flatMap(surface =>
  listSurfaceFiles(surface.label, surface.root)
);

// ─── Pure scanners (each also exercised against crafted fixtures) ────────────

/** Flags files containing ANY Drizzle `.delete(` builder callsite. */
function scanDeleteCallsites(files: readonly SourceFile[]): string[] {
  return files.flatMap(file => (DRIZZLE_DELETE_CALLSITE_PATTERN.test(file.content) ? [file.label] : []));
}

/** Flags files carrying any delete path against a retention table. */
function scanRetentionDeletePaths(files: readonly SourceFile[]): string[] {
  return files.flatMap(file =>
    DRIZZLE_RETENTION_DELETE_PATTERN.test(file.content) || RAW_SQL_RETENTION_DELETE_PATTERN.test(file.content)
      ? [file.label]
      : []
  );
}

const byLabel = (a: string, b: string): number => a.localeCompare(b);

// ─── The census ───────────────────────────────────────────────────────────────

describe("retention anti-drift census — static source scan", () => {
  test("the corpus is populated and covers every surface (no blind spots)", () => {
    expect(retentionCorpus.length).toBeGreaterThanOrEqual(75);
    for (const surface of RETENTION_SURFACES) {
      const surfaceFiles = retentionCorpus.filter(file => file.label.startsWith(`${surface.label}/`));
      expect(surfaceFiles.length).toBeGreaterThanOrEqual(surface.minFiles);
    }
    const labels = retentionCorpus.map(file => file.label);
    for (const sentinel of CORPUS_SENTINEL_PATHS) {
      expect(labels).toContain(sentinel);
    }
  });

  test("the corpus excludes test files, test directories, and this census's own tree", () => {
    for (const file of retentionCorpus) {
      const segments = file.label.split("/");
      const underTestDirectory = segments.some(segment => segment === "__tests__" || segment === "test");
      expect(underTestDirectory).toBe(false);
      expect(isExcludedFileName(file.label.split("/").at(-1) ?? "")).toBe(false);
    }
    // Self-exclusion proof: this file (which embeds delete shapes in its
    // fixtures by design) lives outside every scanned surface.
    expect(retentionCorpus.some(file => file.label.startsWith("backend/db/test/"))).toBe(false);
  });

  test("every hard-delete callsite is exactly allowlisted — and every allowlist entry is live", () => {
    const mutatingFiles = scanDeleteCallsites(retentionCorpus).toSorted(byLabel);
    const allowlisted = DELETE_CALLSITE_ALLOWLIST.map(entry => entry.path).toSorted(byLabel);
    // Exact bijection: no un-allowlisted delete path, no dead allowlist entry.
    expect(mutatingFiles).toEqual(allowlisted);
    for (const entry of DELETE_CALLSITE_ALLOWLIST) {
      expect(existsSync(join(process.cwd(), entry.path))).toBe(true);
    }
  });

  test("each allowlisted entry's callsite is live in the corpus (single occurrence, exact shape)", () => {
    const corpusByLabel = new Map(retentionCorpus.map(file => [file.label, file]));
    for (const entry of DELETE_CALLSITE_ALLOWLIST) {
      const file = corpusByLabel.get(entry.path);
      if (!file) {
        throw new Error(`allowlisted file missing from the corpus: ${entry.path}`);
      }
      const callsiteCount = [...file.content.matchAll(DRIZZLE_DELETE_CALLSITE_GLOBAL_PATTERN)].length;
      expect(callsiteCount).toBe(1);
      expect(file.content).toContain(entry.callsite);
    }
  });

  test("zero delete paths target the retention tables (Drizzle shape and raw SQL)", () => {
    expect(scanRetentionDeletePaths(retentionCorpus)).toEqual([]);
  });
});

// ─── Scanner non-vacuity — crafted fixtures fire, benign shapes stay silent ──

describe("scanner non-vacuity — crafted fixtures fire, benign shapes stay silent", () => {
  test("the callsite scanner fires on any `.delete(` callsite", () => {
    const mutating = [
      {
        label: "fixture/purge.repository.ts",
        content: "const [row] = await executor.delete(lessons).where(eq(lessons.id, id)).returning();",
      },
      {
        label: "fixture/whitespace.helper.ts",
        content: "await tx\n  .delete (expiredRows)\n  .where(inArray(expiredRows.id, ids));",
      },
    ];
    expect(scanDeleteCallsites(mutating).toSorted(byLabel)).toEqual([
      "fixture/purge.repository.ts",
      "fixture/whitespace.helper.ts",
    ]);
  });

  test("the callsite scanner ignores writes, reads, and the bare `delete` keyword", () => {
    const benign = [
      { label: "fixture/writer.repository.ts", content: "await tx.insert(session).values(row);" },
      { label: "fixture/updater.repository.ts", content: "await tx.update(reports).set({ status });" },
      { label: "fixture/reader.repository.ts", content: "const rows = await db.select().from(recitation).limit(1);" },
      { label: "fixture/env-cleaner.script.ts", content: "delete process.env.DATABASE_URL;" },
    ];
    expect(scanDeleteCallsites(benign)).toEqual([]);
  });

  test("the retention scanner fires on every retention Drizzle identifier", () => {
    const mutating = RETENTION_DRIZZLE_IDENTIFIERS.map((identifier, index) => ({
      label: `fixture/purge-${index}.repository.ts`,
      content: `await tx.delete(${identifier}).where(gt(${identifier}.id, 0));`,
    }));
    expect(scanRetentionDeletePaths(mutating).toSorted(byLabel)).toEqual(
      mutating.map(file => file.label).toSorted(byLabel)
    );
  });

  test("the retention scanner fires on raw DELETE FROM statements in every lexical shape", () => {
    const mutating = [
      {
        label: "fixture/raw-upper.repository.ts",
        content: "await tx.execute(sql`DELETE FROM session WHERE id = $1`);",
      },
      {
        label: "fixture/raw-lower.ops.ts",
        content: "delete from home_work where submitted_at < now() - interval '30 days'",
      },
      { label: "fixture/raw-quoted.repository.ts", content: 'DELETE FROM public."reports"' },
      { label: "fixture/raw-recitation.repository.ts", content: "DELETE FROM recitation" },
      { label: "fixture/raw-evaluations.repository.ts", content: "DELETE FROM evaluations" },
    ];
    expect(scanRetentionDeletePaths(mutating).toSorted(byLabel)).toEqual(
      mutating.map(file => file.label).toSorted(byLabel)
    );
  });

  test("the retention scanner ignores other tables, same-prefix tables, FK clauses, and docblock SQL", () => {
    const benign = [
      { label: "fixture/other-table.repository.ts", content: "DELETE FROM users WHERE id = $1" },
      {
        label: "fixture/same-prefix.repository.ts",
        content: "DELETE FROM session_request_idempotency WHERE claimed_at < now()",
      },
      {
        label: "fixture/fk-comment.repository.ts",
        content: "Because reports.session_id is NOT NULL with ON DELETE CASCADE and",
      },
      {
        label: "fixture/docblock.repository.ts",
        content: "set-based DELETE … WHERE related_entity_type = ? AND related_entity_id = ?",
      },
      { label: "fixture/read.repository.ts", content: 'SELECT count(*) FROM "session"' },
      {
        label: "fixture/allowlisted.repository.ts",
        content: "const [row] = await executor.delete(lessons).where(eq(lessons.id, id)).returning();",
      },
    ];
    expect(scanRetentionDeletePaths(benign)).toEqual([]);
  });
});
