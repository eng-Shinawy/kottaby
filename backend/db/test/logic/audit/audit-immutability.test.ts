/**
 * Audit-log append-only proof triple — three independent tiers pin the
 * immutability contract of the `audit_logs` trail:
 *
 *  1. Static source tier — a read-only `node:fs` walk over the whole
 *     `backend/` tree proves ZERO production callsites of Drizzle
 *     `update(auditLogs)` / `delete(auditLogs)` and ZERO raw-SQL
 *     `UPDATE audit_logs` / `DELETE FROM audit_logs` statements, plus a
 *     module-surface lock proving `AuditService` exports ONLY the
 *     append-only `createAuditLog` writer. In-backend test layers are
 *     excluded by exact path (every DB test there runs inside
 *     `runInRollback` per `backend/db/test/AGENTS.md`, so their writes
 *     never commit). The repo-root `test/` tree — where COMMITTED
 *     teardown deletes live — is governed by a path-exact allowlist: any
 *     file that mutates `audit_logs` there must be explicitly allowlisted,
 *     and every allowlist entry must currently match (no dead entries, no
 *     unlisted mutators).
 *
 *  2. Database trigger tier (environment-branched) — probes `pg_trigger`
 *     (same probe shape as `test/helpers/db-cleanup.ts`) for the two
 *     immutability triggers on `audit_logs`. With the triggers installed
 *     and enabled (migrate-provisioned PostgreSQL), a fixture audit row is
 *     INSERTed inside a rolled-back transaction — the append path stays
 *     open — and direct `tx.update(...)` / `tx.delete(...)` attempts MUST
 *     throw, asserted via the `expectRepoError` try/catch helper (NEVER
 *     `rejects.toThrow`, which deadlocks the rollback wrapper). Without
 *     them (push-provisioned environments never apply custom SQL
 *     migrations) the static source tier is the only application-level
 *     guard — that branch re-asserts the scan result; the push-vs-migrate
 *     gap is a documented operations concern. The tier is skipped
 *     wholesale under the in-process PGlite provider.
 *
 *  3. Migration-DDL pin — the canonical trigger SQL is read from disk and
 *     asserted idempotent (`CREATE OR REPLACE FUNCTION` + `DROP TRIGGER IF
 *     EXISTS`), blocking both mutation paths while leaving the append path
 *     untouched, and carrying the exact trigger names the `pg_trigger`
 *     probe relies on.
 *
 * NON-VACUITY: every scanner is a pure function over (path → content)
 * maps and is exercised against crafted in-memory fixtures that MUST
 * fire; the teardown allowlist holds live positive controls (the real
 * teardown helpers DO match and ARE the exact allowlist contents).
 *
 * DETERMINISM: file discovery sorts names with `localeCompare` at read
 * time; repeated traversals yield identical orderings.
 *
 * LEXICAL CAVEAT (accepted by design): text-level scans can flag
 * occurrences inside comments/strings; false positives are visible and
 * cheap, false negatives require intentionally obfuscated code which
 * fails review anyway.
 *
 * DB SAFETY: every database statement in this file runs inside
 * `runInRollback` — the fixture audit row never commits.
 */

import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { eq, sql } from "drizzle-orm";
import { auditLogs } from "@/backend/db/schema/audit/audit-logs";
import { createTestUser } from "@/backend/db/test/entity-setup";
import { expectRepoError, runInRollback } from "@/backend/db/test/test-utils";
import { AuditActionType } from "@/backend/enum/audit/audit-action-type.enum";
import { AuditService } from "@/backend/services/admin/audit.service";
import type { DBTransaction } from "@/backend/types";
import { isPgliteProvider } from "@/test/helpers/skip-when-pglite";

// ─── Contracts under pin ─────────────────────────────────────────────────────

/** The two immutability triggers the canonical migration installs on `audit_logs`. */
const AUDIT_UPDATE_TRIGGER_NAME = "prevent_audit_logs_update_trigger";
const AUDIT_DELETE_TRIGGER_NAME = "prevent_audit_logs_delete_trigger";

/** Canonical source of the trigger DDL (relative to the repo root). */
const TRIGGER_MIGRATION_PATH = join(process.cwd(), "backend", "db", "migration", "3-immutability-triggers.sql");

/**
 * The in-backend test layers, as EXACT directory paths (never globs).
 * Everything under them is rollback-contained test code, not production
 * source — excluded from the production corpus.
 */
const BACKEND_TEST_LAYER_PATHS = [
  "backend/db/test",
  "backend/graphql/test",
  "backend/lib/api/test",
  "backend/lib/errors/test",
  "backend/db/repo/students/__tests__",
  "backend/services/auth/__tests__",
  "backend/services/students/__tests__",
] as const;

/**
 * Teardown infrastructure allowed to remove audit rows — EXACT repo-root
 * file paths only. All three delete under suspended immutability triggers
 * (committed teardown, outside any rollback). Adding an entry requires the
 * file to actually mutate `audit_logs` (the live-match assertion below
 * fails otherwise), so the allowlist cannot rot.
 */
const TEARDOWN_ALLOWLIST_PATHS = [
  "test/helpers/db-cleanup.ts",
  "test/workflows/admin/audit-trail.journey.test.ts",
  "test/workflows/helpers/journey-cleanup.ts",
] as const;

/** Production files that MUST be inside the scanned corpus (anti-blind-spot sentinels). */
const PRODUCTION_SENTINEL_PATHS = [
  "backend/services/admin/audit.service.ts",
  "backend/db/repo/admin/admin-user.repository.ts",
  "backend/db/schema/audit/audit-logs.ts",
  "backend/graphql/pothos/admin/admin-user.pothos.ts",
] as const;

// ─── Read-only traversal helpers ─────────────────────────────────────────────

/** Virtual file unit fed to scanners (tree label + repo-relative path + content). */
interface SourceFile {
  readonly label: string;
  readonly content: string;
}

const SCANNED_EXTENSIONS = [".ts", ".tsx"] as const;

/**
 * Recursively lists source files under `rootDir`, deterministically sorted
 * (skips missing roots and `node_modules`). Each file is labeled
 * `<tree>/<relative-path>` so any violation names the owning tree.
 */
function listSourceFiles(tree: string, rootDir: string): SourceFile[] {
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
        if (entry.name === "node_modules") {
          continue;
        }
        walk(childAbsolute, childSegments);
        continue;
      }
      if (!entry.isFile() || !SCANNED_EXTENSIONS.some(extension => entry.name.endsWith(extension))) {
        continue;
      }
      collected.push({
        label: `${tree}/${childSegments.join("/")}`,
        content: readFileSync(childAbsolute, "utf8"),
      });
    }
  };
  walk(rootDir, []);
  return collected;
}

/** Production corpus: the whole `backend/` tree minus the exact test layers. */
const productionSources: SourceFile[] = listSourceFiles("backend", join(process.cwd(), "backend")).filter(
  file =>
    !BACKEND_TEST_LAYER_PATHS.some(prefix => file.label.startsWith(`${prefix}/`)) &&
    !file.label.endsWith(".test.ts") &&
    !file.label.endsWith(".test.tsx")
);

/** Teardown corpus: the repo-root `test/` tree (committed-cleanup surface). */
const testTreeSources: SourceFile[] = listSourceFiles("test", join(process.cwd(), "test"));

// ─── Pure scanners (each also exercised against crafted fixtures) ────────────

/** Flags Drizzle builder calls mutating the trail: `.update(auditLogs)` / `.delete(auditLogs)`. */
function scanDrizzleAuditMutations(files: readonly SourceFile[]): string[] {
  return files.flatMap(file => (/\.\s*(?:update|delete)\s*\(\s*auditLogs\b/u.test(file.content) ? [file.label] : []));
}

/** Flags raw-SQL statements mutating the trail: `UPDATE audit_logs …` / `DELETE FROM audit_logs …`. */
function scanRawSqlAuditMutations(files: readonly SourceFile[]): string[] {
  return files.flatMap(file =>
    /\b(?:UPDATE\s+audit_logs\b|DELETE\s+FROM\s+audit_logs\b)/u.test(file.content) ? [file.label] : []
  );
}

/**
 * Runs every mutation-shape scanner and flattens the sorted union of
 * violations. Violations are reported per FILE (a file tripping several
 * scanners appears once) — the allowlist contract below is path-exact.
 */
function scanAllAuditMutationShapes(files: readonly SourceFile[]): string[] {
  return Array.from(new Set([...scanDrizzleAuditMutations(files), ...scanRawSqlAuditMutations(files)])).toSorted(
    (a, b) => a.localeCompare(b)
  );
}

// ─── Tier 1: static source scan + module-surface lock ────────────────────────

describe("audit_logs append-only lock — static source tier", () => {
  test("the production corpus is populated and covers every backend root (no blind spots)", () => {
    expect(productionSources.length).toBeGreaterThanOrEqual(250);
    const labels = productionSources.map(file => file.label);
    for (const sentinel of PRODUCTION_SENTINEL_PATHS) {
      expect(labels).toContain(sentinel);
    }
  });

  test("the production corpus excludes in-backend test layers by exact path", () => {
    const labels = productionSources.map(file => file.label);
    // Self-exclusion proof: this very file (which contains mutation shapes
    // by design) never scans itself.
    expect(labels).not.toContain("backend/db/test/logic/audit/audit-immutability.test.ts");
    for (const file of productionSources) {
      const underTestLayer = BACKEND_TEST_LAYER_PATHS.some(prefix => file.label.startsWith(`${prefix}/`));
      const coLocatedTestFile = file.label.endsWith(".test.ts") || file.label.endsWith(".test.tsx");
      expect(underTestLayer || coLocatedTestFile).toBe(false);
    }
  });

  test("zero Drizzle update(auditLogs) / delete(auditLogs) callsites exist in production sources", () => {
    expect(scanDrizzleAuditMutations(productionSources)).toEqual([]);
  });

  test("zero raw-SQL UPDATE/DELETE statements target audit_logs in production sources", () => {
    expect(scanRawSqlAuditMutations(productionSources)).toEqual([]);
  });

  test("the AuditService module exposes only the append-only writer", () => {
    expect(Object.keys(AuditService).toSorted((a, b) => a.localeCompare(b))).toEqual(["createAuditLog"]);
  });

  test("every audit-mutating teardown file is exactly allowlisted — and every allowlist entry is live", () => {
    const mutatingTestFiles = scanAllAuditMutationShapes(testTreeSources);
    const allowlisted = [...TEARDOWN_ALLOWLIST_PATHS].toSorted((a, b) => a.localeCompare(b));
    // Exact bijection: no un-allowlisted mutator, no dead allowlist entry.
    expect(mutatingTestFiles).toEqual(allowlisted);
    for (const relativePath of TEARDOWN_ALLOWLIST_PATHS) {
      expect(existsSync(join(process.cwd(), relativePath))).toBe(true);
    }
  });

  test("no allowlisted teardown path leaks into the production corpus", () => {
    const labels = new Set(productionSources.map(file => file.label));
    for (const relativePath of TEARDOWN_ALLOWLIST_PATHS) {
      expect(labels.has(relativePath)).toBe(false);
    }
  });

  test("the teardown corpus is populated and contains the allowlisted helpers", () => {
    expect(testTreeSources.length).toBeGreaterThanOrEqual(30);
    const labels = testTreeSources.map(file => file.label);
    for (const relativePath of TEARDOWN_ALLOWLIST_PATHS) {
      expect(labels).toContain(relativePath);
    }
  });
});

// ─── Scanner non-vacuity — crafted fixtures must fire, benign shapes must not ─

describe("scanner non-vacuity — crafted fixtures fire, benign shapes stay silent", () => {
  test("the Drizzle-shape scanner fires on update/delete callsites targeting the trail", () => {
    const mutating = [
      {
        label: "fixture/mutating.repository.ts",
        content: `await tx.update(auditLogs).set({ details: "tamper" }).where(eq(auditLogs.id, id));`,
      },
      {
        label: "fixture/removing.helper.ts",
        content: `await db.delete(auditLogs).where(inArray(auditLogs.actorId, ids));`,
      },
    ];
    expect(scanDrizzleAuditMutations(mutating).toSorted((a, b) => a.localeCompare(b))).toEqual([
      "fixture/mutating.repository.ts",
      "fixture/removing.helper.ts",
    ]);
  });

  test("the Drizzle-shape scanner ignores the append path, read shapes, and other tables", () => {
    const benign = [
      {
        label: "fixture/append-only.writer.ts",
        content: `await tx.insert(auditLogs).values({ actorId, actionType, entityType, entityId, details });`,
      },
      {
        label: "fixture/reading.repository.ts",
        content: [
          `const rows = await db.select({ id: auditLogs.id }).from(auditLogs).where(eq(auditLogs.actorId, actorId));`,
          `const total = await db.$count(auditLogs, eq(auditLogs.entityId, entityId));`,
        ].join("\n"),
      },
      {
        label: "fixture/other-table.updater.ts",
        content: `await tx.update(users).set({ fullName: name }).where(eq(users.id, id));`,
      },
    ];
    expect(scanDrizzleAuditMutations(benign)).toEqual([]);
  });

  test("the raw-SQL scanner fires on UPDATE/DELETE statements targeting the trail", () => {
    const mutating = [
      { label: "fixture/raw-update.repository.ts", content: `UPDATE audit_logs SET details = 'tamper' WHERE id = 1` },
      { label: "fixture/raw-delete.helper.ts", content: `DELETE FROM audit_logs WHERE actor_id = ANY($1::int[])` },
    ];
    expect(scanRawSqlAuditMutations(mutating).toSorted((a, b) => a.localeCompare(b))).toEqual([
      "fixture/raw-delete.helper.ts",
      "fixture/raw-update.repository.ts",
    ]);
  });

  test("the raw-SQL scanner ignores reads and the trigger-DDL vocabulary", () => {
    const benign = [
      { label: "fixture/counter.ts", content: `SELECT count(*)::int AS count FROM audit_logs` },
      {
        label: "fixture/trigger-ddl.probe.ts",
        content: [
          "BEFORE UPDATE ON audit_logs",
          "BEFORE DELETE ON audit_logs",
          "DROP TRIGGER IF EXISTS t ON audit_logs",
        ].join("\n"),
      },
      {
        label: "fixture/trigger-state.helper.ts",
        content: `ALTER TABLE audit_logs DISABLE TRIGGER prevent_audit_logs_update_trigger`,
      },
    ];
    expect(scanRawSqlAuditMutations(benign)).toEqual([]);
  });
});

// ─── Tier 2: database trigger tier (environment-branched) ────────────────────

/** One `pg_trigger` row's identity + firing state for `audit_logs`. */
interface AuditTriggerState {
  readonly name: string;
  readonly enabled: string;
}

/** Same probe shape as `test/helpers/db-cleanup.ts` — non-internal triggers on `audit_logs`. */
async function probeAuditTriggerStates(tx: DBTransaction): Promise<AuditTriggerState[]> {
  const discovered = await tx.execute<{ tgname: string; tgenabled: string }>(
    sql`SELECT tgname, tgenabled FROM pg_trigger WHERE tgrelid = 'audit_logs'::regclass AND NOT tgisinternal`
  );
  return discovered.rows
    .map(row => ({ name: row.tgname, enabled: row.tgenabled }))
    .toSorted((a, b) => a.name.localeCompare(b.name));
}

/** True only when the named trigger is installed AND enabled (a disabled trigger never fires). */
function isTriggerEnforcing(states: readonly AuditTriggerState[], triggerName: string): boolean {
  const state = states.find(candidate => candidate.name === triggerName);
  return state !== undefined && state.enabled !== "D";
}

/**
 * Shared branch gate for the trigger tier. When the named trigger is not
 * installed and enabled (push-provisioned environment), the database tier
 * cannot prove anything behavioral — the application-level static scan is
 * the guard, so it is re-asserted here and the caller returns without the
 * behavioral proof. Returns true only when the trigger WILL fire.
 */
async function requireEnforcingTrigger(tx: DBTransaction, triggerName: string): Promise<boolean> {
  const states = await probeAuditTriggerStates(tx);
  if (isTriggerEnforcing(states, triggerName)) {
    return true;
  }
  expect(scanAllAuditMutationShapes(productionSources)).toEqual([]);
  return false;
}

/**
 * INSERTs one fixture audit row inside the caller's transaction (the append
 * path is NEVER blocked) and returns the persisted row for tamper attempts.
 */
async function insertAuditedFixtureRow(tx: DBTransaction) {
  const user = await createTestUser(tx);
  const [row] = await tx
    .insert(auditLogs)
    .values({
      actorId: user.id,
      actionType: AuditActionType.Create,
      entityType: "user",
      entityId: user.id,
      details: null,
    })
    .returning({
      id: auditLogs.id,
      actorId: auditLogs.actorId,
      actionType: auditLogs.actionType,
      entityType: auditLogs.entityType,
    });
  if (!row) {
    throw new Error("audit fixture insert returned no rows");
  }
  return row;
}

/**
 * Joins the full error-message chain (Drizzle wraps the driver error in a
 * `cause`, same wrapping-layer rationale as `constraintNameOf`) so the
 * DB-enforced message can be asserted regardless of wrapping depth.
 */
function errorMessageChain(error: Error): string {
  const messages: string[] = [error.message];
  let current: Error = error;
  while (current.cause instanceof Error) {
    current = current.cause;
    messages.push(current.message);
  }
  return messages.join("\n");
}

/** Independent read-back oracle on the same tx — proves the fixture row is really there. */
async function expectFixtureRowPresent(tx: DBTransaction, auditRowId: number): Promise<void> {
  const rows = await tx.select({ id: auditLogs.id }).from(auditLogs).where(eq(auditLogs.id, auditRowId)).limit(1);
  expect(rows).toHaveLength(1);
}

const describeTriggerTier = isPgliteProvider() ? describe.skip : describe;

describeTriggerTier("audit_logs append-only lock — database trigger tier", () => {
  test("direct UPDATE on an audit row is rejected by the immutability trigger", async () => {
    await runInRollback(async tx => {
      if (!(await requireEnforcingTrigger(tx, AUDIT_UPDATE_TRIGGER_NAME))) {
        return;
      }
      const fixture = await insertAuditedFixtureRow(tx);
      await expectFixtureRowPresent(tx, fixture.id);
      const error = await expectRepoError(() =>
        tx.update(auditLogs).set({ details: "tamper attempt" }).where(eq(auditLogs.id, fixture.id))
      );
      expect(errorMessageChain(error)).toContain("audit_logs is immutable");
    });
  });

  test("direct DELETE of an audit row is rejected by the immutability trigger", async () => {
    await runInRollback(async tx => {
      if (!(await requireEnforcingTrigger(tx, AUDIT_DELETE_TRIGGER_NAME))) {
        return;
      }
      const fixture = await insertAuditedFixtureRow(tx);
      await expectFixtureRowPresent(tx, fixture.id);
      const error = await expectRepoError(() => tx.delete(auditLogs).where(eq(auditLogs.id, fixture.id)));
      expect(errorMessageChain(error)).toContain("audit_logs is immutable");
    });
  });

  test("the append path stays open — inserting an audit row succeeds", async () => {
    await runInRollback(async tx => {
      // With the triggers installed this doubles as the over-blocking
      // control: BEFORE UPDATE/DELETE triggers must not touch INSERTs.
      const fixture = await insertAuditedFixtureRow(tx);
      await expectFixtureRowPresent(tx, fixture.id);
      expect(fixture.actionType).toBe(AuditActionType.Create);
      expect(fixture.entityType).toBe("user");
    });
  });
});

// ─── Tier 3: migration-DDL pin ───────────────────────────────────────────────

/** Reads the canonical trigger migration from disk (precedent: source-reading DB tests). */
function readTriggerMigrationDdl(): string {
  if (!existsSync(TRIGGER_MIGRATION_PATH)) {
    throw new Error(`Trigger migration not found at ${TRIGGER_MIGRATION_PATH}`);
  }
  return readFileSync(TRIGGER_MIGRATION_PATH, "utf8");
}

describe("audit_logs append-only lock — migration DDL pin", () => {
  test("the canonical trigger migration exists and carries idempotent DDL", () => {
    const ddl = readTriggerMigrationDdl();
    expect(ddl).toContain("CREATE OR REPLACE FUNCTION prevent_audit_logs_update");
    expect(ddl).toContain("CREATE OR REPLACE FUNCTION prevent_audit_logs_delete");
    expect(ddl).toContain(`DROP TRIGGER IF EXISTS ${AUDIT_UPDATE_TRIGGER_NAME} ON audit_logs;`);
    expect(ddl).toContain(`DROP TRIGGER IF EXISTS ${AUDIT_DELETE_TRIGGER_NAME} ON audit_logs;`);
    expect(ddl).toContain(`CREATE TRIGGER ${AUDIT_UPDATE_TRIGGER_NAME}`);
    expect(ddl).toContain(`CREATE TRIGGER ${AUDIT_DELETE_TRIGGER_NAME}`);
  });

  test("the DDL blocks both mutation paths, leaves the append path open, and pins the enforced message", () => {
    const ddl = readTriggerMigrationDdl();
    expect(ddl).toContain("BEFORE UPDATE ON audit_logs");
    expect(ddl).toContain("BEFORE DELETE ON audit_logs");
    expect(ddl).not.toMatch(/BEFORE\s+INSERT\s+ON\s+audit_logs/u);
    // The message the trigger tier asserts on originates here.
    expect(ddl).toContain("audit_logs is immutable");
  });
});
