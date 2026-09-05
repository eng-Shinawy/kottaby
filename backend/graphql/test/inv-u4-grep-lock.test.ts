/**
 * INV-U4 grep-lock suite — proves NO production-code hard-delete writer
 * exists for the five protected identity tables (`users`, `students`,
 * `teacher`, `parents`, `applicants`) and that the built GraphQL schema
 * exposes ZERO `hardDelete*` / `deleteUser`-class Mutation fields.
 *
 * What this locks down:
 *  - **Production write-path scan** — walks `backend/db/repo/**` and
 *    `backend/services/**` (the two layers permitted to issue Drizzle
 *    DML), reads each non-test `.ts` file, strips comments, and asserts
 *    that NO `.delete(` call site targets one of the protected
 *    identifiers within a tight 60-char argument window (catches
 *    `db.delete(users)`, `db.delete(schema.users)`, `tx.delete(usersTable)`,
 *    `db.delete(users).where(...)` — and skips the unrelated `Map.delete()`
 *    on the ioredis-fanout-client because the `messageHandlers` token does
 *    not carry any protected-entity name).
 *  - **Test-janitorial whitelist (explicit, enumerated)** — the three
 *    paths listed below are the ONLY locations in the repository where a
 *    hard-delete against `users`/`students`/`teacher`/`parents`/
 *    `applicants` is sanctioned. Every entry has a documented rationale;
 *    no glob-by-convenience. Adding a new whitelisted path requires
 *    editing this test in the same change (a stale whitelist asserts a
 *    false contract).
 *  - **Schema-surface cross-reference** — the live Mutation root
 *    inventory is already pinned via an EXACT-MATCH `toEqual` assertion
 *    in `schema-surface.test.ts` (the 23-op list includes no
 *    `hardDelete*` / `deleteUser` field). This suite re-asserts the
 *    negative form (no destructive root field exists by name) as
 *    defense-in-depth — a future addition of `hardDeleteUser` /
 *    `deleteStudentAccount` would fail BOTH the schema-surface
 *    inventory test AND the test below.
 *
 * Pure static source-scan tier — NO server boot, NO network, NO DB. Runs
 * via the mandated runner:
 * `bun run test/scripts/run-test.ts backend/graphql/test/inv-u4-grep-lock.test.ts`
 */

import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { graphQLSchema } from "@/backend/graphql/gqlSchema";

// ─── Scan configuration ──────────────────────────────────────────────────────

/**
 * Production layers permitted to issue Drizzle DML (the repo + service
 * layers). Anything outside these two layers is structurally barred
 * from issuing DB writes (per `backend/AGENTS.md`:
 * schema→types→repo→service→graphql→test; only repo + service touch
 * `db` / `tx`). The scanner walks these two trees recursively.
 */
const PRODUCTION_LAYERS = ["backend/db/repo", "backend/services"] as const;

/**
 * The five protected identity tables. Hard-delete against any of these
 * violates INV-U4. Names match the `pgTable(...)` declarations in
 * `backend/db/schema/**` verbatim (note: `teacher` is singular — the
 * table is named `teacher`, not `teachers`; `applicants` lives under
 * `backend/db/schema/teachers/applicants.ts` but is a standalone table).
 */
const PROTECTED_ENTITIES = ["users", "students", "teacher", "parents", "applicants"] as const;

/**
 * Test-janitorial whitelist — the EXPLICIT, ENUMERATED list of paths
 * where a hard-delete against the protected entities is sanctioned.
 * Each entry has a documented rationale; NO glob-by-convenience. The
 * scanner does NOT walk these paths (they sit outside
 * `PRODUCTION_LAYERS`), but the whitelist is enumerated here so:
 *
 *   (a) a future contributor adding a new whitelisted path is forced to
 *       edit this test in the same change (the rationale must be
 *       documented inline);
 *   (b) a future contributor reading the scan can see, at a glance,
 *       the COMPLETE set of sanctioned hard-delete locations — there
 *       is no hidden allowance outside this list.
 *
 * Rationale per entry:
 *  - `backend/db/migration` — DDL hard-delete is migration-only. The
 *    immutability-triggers migration (`3-immutability-triggers.sql`)
 *    installs `BEFORE DELETE` guards on `audit_logs`; the migration
 *    lane owns schema-level DDL. INV-U4 is an application-layer
 *    invariant; migration DDL is out of scope.
 *  - `test/helpers/db-cleanup.ts` — journey teardown helpers
 *    (`withAuditDeleteTriggersSuspended`, `deleteUsersByIds`). These
 *    helpers are imported ONLY by `test/workflows/**` afterAll
 *    cleanup blocks; production runtime code never imports this
 *    module (verified by the `prod-imports-not-from-test-helpers`
 *    probe below).
 *  - `test/workflows` — journey test fixtures use hard-delete for
 *    committed-fixture teardown only (committed fixtures are
 *    intentionally NOT rolled back; they require explicit delete to
 *    avoid polluting subsequent runs).
 */
const WHITELIST = ["backend/db/migration", "test/helpers/db-cleanup.ts", "test/workflows"] as const;

// ─── File-system traversal ───────────────────────────────────────────────────

/**
 * Walks `dir` recursively and returns every `.ts` file path, EXCLUDING
 * `.test.ts` / `.test-d.ts` files (test code is not production code).
 * Returns paths relative to the repo root for stable whitelist
 * comparison.
 */
function listProductionTsFiles(dir: string, repoRoot: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      out.push(...listProductionTsFiles(full, repoRoot));
      continue;
    }
    if (!entry.endsWith(".ts")) continue;
    if (entry.endsWith(".test.ts")) continue;
    if (entry.endsWith(".test-d.ts")) continue;
    // `relative` produces a stable `backend/db/repo/users/...` form
    // regardless of where the test runner's CWD is set.
    out.push(relative(repoRoot, full));
  }
  return out;
}

/**
 * Strips JSDoc (`/** ... *\/`), block (`/* ... *\/`), and line (`// ...`)
 * comments from `src` so the regex probes run against CODE only.
 * Comments often cite the forbidden patterns as documentation
 * (e.g. "never `db.delete(users)`...") — scanning them would yield
 * false positives.
 */
function stripComments(src: string): string {
  return src
    .replace(/\/\*\*[\s\S]*?\*\//g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "");
}

// ─── Repository root (resolved from the test file's location) ───────────────

const REPO_ROOT = resolveRepoRoot();
function resolveRepoRoot(): string {
  // `process.cwd()` is the repo root when invoked via the mandated
  // `bun run test/scripts/run-test.ts <path>` runner. Fall back to
  // a relative walk from the test file's `__dirname` if needed.
  return process.cwd();
}

// ─── Static probe: production write-path scan ───────────────────────────────

/**
 * Builds the per-entity regex: matches `.delete(` followed (within a
 * 60-char argument window) by an identifier CONTAINING the protected
 * entity name. The window is tight enough to avoid matching unrelated
 * `.delete()` calls (e.g. `Map.delete(channel)`, `array.delete(idx)`)
 * but loose enough to catch:
 *   - `db.delete(users)`
 *   - `db.delete(schema.users)`
 *   - `tx.delete(usersTable)`
 *   - `db.delete(users).where(...)`
 * The identifier-boundary `\b\w*${entity}\w*\b` token ensures the
 * match targets the entity name (e.g. `users`, `usersTable`,
 * `schema.users`) rather than a substring of an unrelated identifier.
 */
function buildDeleteProbe(entity: string): RegExp {
  return new RegExp(`\\.delete\\s*\\([^)]{0,60}\\b\\w*${entity}\\w*\\b`, "i");
}

// ─── Static probe: schema-surface hard-delete rejection ──────────────────────

/**
 * The Mutation root inventory in `schema-surface.test.ts` is already
 * pinned via an EXACT-MATCH `toEqual` assertion (the 23-op list
 * includes no `hardDelete*` / `deleteUser` field — see the
 * `DEV3_017_ADMIN_GOVERNANCE_MUTATION_FIELDS` reconciliation note).
 * The probe below is the negative-form defense-in-depth: it asserts
 * that NO live Mutation field name starts with `hardDelete` or matches
 * the `deleteUser` / `deleteAccount` class. A future addition of
 * `hardDeleteUser` / `deleteStudentAccount` would fail BOTH the
 * schema-surface exact-match assertion AND this probe.
 */
function isDestructiveMutationName(name: string): boolean {
  return /^hardDelete/i.test(name) || /^delete(?:User|Account|Student|Teacher|Parent|Applicant)/i.test(name);
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("INV-U4 grep-lock — no production hard-delete writer for protected entities", () => {
  test("PRODUCTION_LAYERS each resolve to a non-empty file set (scan has a subject)", () => {
    for (const layer of PRODUCTION_LAYERS) {
      const files = listProductionTsFiles(layer, REPO_ROOT);
      expect(files.length).toBeGreaterThan(0);
    }
  });

  test("WHITELIST is an explicit, enumerated list (no glob-by-convenience)", () => {
    // The whitelist MUST stay an explicit literal array — no `**` /
    // `*` glob tokens that would silently absorb new paths. Each
    // entry must be a directory or file path with rationale
    // documented in the JSDoc above.
    expect(WHITELIST).toHaveLength(3);
    for (const entry of WHITELIST) {
      expect(typeof entry).toBe("string");
      expect(entry.length).toBeGreaterThan(0);
      // Glob tokens are forbidden — the whitelist is enumerated, not
      // pattern-matched. A future contributor adding a `**` entry
      // would silently absorb paths they did not audit.
      expect(entry).not.toContain("**");
      expect(entry).not.toMatch(/\*[^/]/);
    }
  });

  test("scans backend/db/repo + backend/services for .delete() targeting protected entities — ZERO findings", () => {
    const findings: string[] = [];
    for (const layer of PRODUCTION_LAYERS) {
      const files = listProductionTsFiles(layer, REPO_ROOT);
      for (const file of files) {
        // Belt-and-braces: even though `listProductionTsFiles` already
        // excludes `.test.ts`, the whitelist check below is the
        // canonical gate (it would also catch a whitelisted path that
        // somehow ended up under a production layer).
        if (WHITELIST.some(w => file.startsWith(w))) continue;

        const raw = readFileSync(file, "utf-8");
        const code = stripComments(raw);
        for (const entity of PROTECTED_ENTITIES) {
          const probe = buildDeleteProbe(entity);
          if (probe.test(code)) {
            findings.push(`${file}: .delete() targeting protected entity "${entity}"`);
          }
        }
      }
    }
    // ZERO findings = no production-code hard-delete writer exists for
    // any of the five protected entities. A non-empty findings list is
    // a regression that MUST be resolved (either by removing the
    // hard-delete call site or by adding the file to WHITELIST with a
    // documented rationale in the SAME change).
    expect(findings).toEqual([]);
  });

  test("production runtime code never imports from the test-janitorial whitelist (whitelist bypass prevention)", () => {
    // The whitelist exists for test teardown — production runtime
    // code MUST NOT import `test/helpers/db-cleanup.ts` (the only
    // sanctioned hard-delete path). An import from a production layer
    // would silently bypass INV-U4 by delegating the hard-delete to a
    // helper. This probe scans the production layers for the
    // `db-cleanup` import specifier and asserts ZERO matches.
    const forbiddenSpecifiers = ["test/helpers/db-cleanup", "@/test/helpers/db-cleanup"];
    const offenders: string[] = [];
    for (const layer of PRODUCTION_LAYERS) {
      const files = listProductionTsFiles(layer, REPO_ROOT);
      for (const file of files) {
        const raw = readFileSync(file, "utf-8");
        const code = stripComments(raw);
        for (const specifier of forbiddenSpecifiers) {
          if (code.includes(specifier)) {
            offenders.push(`${file}: imports "${specifier}"`);
          }
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  test("the built schema exposes ZERO hardDelete*/deleteUser-class Mutation fields", () => {
    // Cross-reference the schema-surface.test.ts exact-match
    // Mutation root inventory assertion. The probe below is the
    // negative-form defense-in-depth: assert no live Mutation field
    // name matches the destructive class.
    const mutationFields = Object.keys(graphQLSchema.getMutationType()?.getFields() ?? {});
    const destructive = mutationFields.filter(isDestructiveMutationName);
    expect(destructive).toEqual([]);
  });

  test("the built schema exposes ZERO hardDelete*/deleteUser-class Query fields (no anonymous destructive read)", () => {
    // Belt-and-braces: a destructive root field should never exist on
    // the Query type either (an anonymous "delete by query" would be
    // a BOLA vector). The probe below asserts ZERO matches on the
    // Query root.
    const queryFields = Object.keys(graphQLSchema.getQueryType()?.getFields() ?? {});
    const destructive = queryFields.filter(isDestructiveMutationName);
    expect(destructive).toEqual([]);
  });
});
