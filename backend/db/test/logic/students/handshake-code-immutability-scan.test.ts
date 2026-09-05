/**
 * Handshake-code immutability static scan — repo-shape invariant enforced as
 * a bun:test scan with ZERO server boot and ZERO DB access (read-only
 * node:fs traversal over the production trees allowed to hold write
 * statements).
 *
 * WHAT THIS LOCKS:
 *  - `handshake_code` is written EXACTLY ONCE, at student creation, by the
 *    registration insert path. No Drizzle `.set({ handshakeCode: … })`
 *    payload, no raw SQL `SET handshake_code =` clause, no upsert
 *    `onConflictDoUpdate` set payload, and no mutation-named identifier may
 *    target the column anywhere under the repository, service, GraphQL or
 *    seeds trees.
 *  - The registration insert path itself (`.values({ handshakeCode })`
 *    inserts, including the bounded retry's repeated inserts) is creation,
 *    NOT mutation — allowed by construction and pinned by a negative control.
 *
 * NON-VACUITY: every scanner is a pure function over (path → content) maps
 * and is also exercised against crafted in-memory fixtures that MUST produce
 * violations; a creation-shaped fixture MUST NOT produce a violation.
 *
 * DETERMINISM: file discovery sorts names with `localeCompare` at read time;
 * repeated traversals yield identical orderings.
 *
 * LEXICAL CAVEAT (accepted by design): text-level scans can flag occurrences
 * inside comments/strings; false positives are visible and cheap, false
 * negatives require intentionally obfuscated code which fails review anyway.
 * Scan targets EXCLUDE `*.test.ts` — test fixtures legitimately construct
 * handshake-code write shapes to prove constraint-level enforcement.
 */

import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

// ─── Read-only traversal helpers ─────────────────────────────────────────────

/** Virtual file unit fed to scanners (tree label + relative path + content). */
interface SourceFile {
  readonly label: string;
  readonly content: string;
}

/**
 * Recursively lists `.ts` files under `rootDir`, deterministically sorted
 * (skips missing roots). Each file is labeled `<tree>/<relative-path>` so
 * violations name the owning tree.
 */
function listTsFiles(tree: string, rootDir: string): SourceFile[] {
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
      if (!entry.isFile() || !entry.name.endsWith(".ts")) {
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

/** Production trees allowed to contain write statements. */
const WRITE_TREES = [
  { tree: "backend/db/repo", path: join(process.cwd(), "backend", "db", "repo") },
  { tree: "backend/services", path: join(process.cwd(), "backend", "services") },
  { tree: "backend/graphql", path: join(process.cwd(), "backend", "graphql") },
  { tree: "backend/db/seeds", path: join(process.cwd(), "backend", "db", "seeds") },
] as const;

/** Every production source in the write trees (tests excluded by design). */
const productionSources: SourceFile[] = WRITE_TREES.flatMap(tree =>
  listTsFiles(tree.tree, tree.path).filter(file => !file.label.endsWith(".test.ts"))
);

// ─── Pure scanners (each also exercised against negative fixtures) ──────────

/**
 * Drizzle update-set scanner — flags a `.set({ … })` payload whose own braces
 * contain `handshakeCode:` in KEY position. Requiring the colon keeps read
 * mentions (e.g. an `eq(students.handshakeCode, …)` predicate after the
 * payload) out of the match window; the `[^{}]*` window cannot cross the
 * payload's closing brace.
 */
function scanDrizzleSetWrites(files: readonly SourceFile[]): string[] {
  return files.flatMap(file => (/\.set\(\s*\{[^{}]*?\bhandshakeCode\s*:/u.test(file.content) ? [file.label] : []));
}

/** Raw-SQL update scanner — flags `SET handshake_code =` clauses. */
function scanRawSqlSetWrites(files: readonly SourceFile[]): string[] {
  return files.flatMap(file => (/\bset\s+handshake_code\s*=/iu.test(file.content) ? [file.label] : []));
}

/** Upsert scanner — flags `onConflictDoUpdate` set payloads targeting the column. */
function scanUpsertSetWrites(files: readonly SourceFile[]): string[] {
  return files.flatMap(file =>
    /onConflictDoUpdate\s*\(\s*\{[\s\S]{0,200}?set:\s*\{[^{}]*?\bhandshakeCode\s*:/u.test(file.content)
      ? [file.label]
      : []
  );
}

/** Mutation-name scanner — flags rewrite-named identifiers for the column. */
function scanMutationNamedWrites(files: readonly SourceFile[]): string[] {
  return files.flatMap(file =>
    /\b(?:update|rotate|regenerate|reset|change|set)HandshakeCode\b/iu.test(file.content) ? [file.label] : []
  );
}

/** Runs every write-shape scanner and flattens the union of violations. */
function scanAllWriteShapes(files: readonly SourceFile[]): string[] {
  return [
    ...scanDrizzleSetWrites(files),
    ...scanRawSqlSetWrites(files),
    ...scanUpsertSetWrites(files),
    ...scanMutationNamedWrites(files),
  ].toSorted((a, b) => a.localeCompare(b));
}

// ─── Corpus guards (the scan must never be vacuously empty) ─────────────────

describe("immutability scan — corpus is populated", () => {
  test("every write tree contributes sources (guard against silent root drift)", () => {
    for (const tree of WRITE_TREES) {
      const count = productionSources.filter(file => file.label.startsWith(`${tree.tree}/`)).length;
      expect(count).toBeGreaterThanOrEqual(4);
    }
  });

  test("the registration creation path is inside the scanned corpus", () => {
    const labels = productionSources.map(file => file.label);
    expect(labels).toContain("backend/db/repo/students/student.repository.ts");
    expect(labels).toContain("backend/services/auth/registration.service.ts");
  });
});

// ─── Real-tree immutability lock ─────────────────────────────────────────────

describe("immutability lock — no write statement targets handshake_code outside creation", () => {
  test("zero Drizzle .set payloads target the column", () => {
    expect(scanDrizzleSetWrites(productionSources)).toEqual([]);
  });

  test("zero raw SQL SET clauses target the column", () => {
    expect(scanRawSqlSetWrites(productionSources)).toEqual([]);
  });

  test("zero upsert set payloads target the column", () => {
    expect(scanUpsertSetWrites(productionSources)).toEqual([]);
  });

  test("zero rewrite-named identifiers exist for the column", () => {
    expect(scanMutationNamedWrites(productionSources)).toEqual([]);
  });

  test("union of all write-shape scanners is empty across the production trees", () => {
    expect(scanAllWriteShapes(productionSources)).toEqual([]);
  });
});

// ─── Negative fixtures — non-vacuity proof per scanner (in-memory only) ──────

describe("negative fixtures — every scanner provably fires on crafted input", () => {
  test("Drizzle .set scanner fires on an update payload targeting the column", () => {
    const bad = [
      {
        label: "fixture/mutating.repository.ts",
        content: `await tx.update(students).set({ handshakeCode: freshCode }).where(eq(students.id, id));`,
      },
    ];
    expect(scanDrizzleSetWrites(bad)).toEqual(["fixture/mutating.repository.ts"]);
  });

  test("Drizzle .set scanner does NOT fire on a creation insert or a read predicate", () => {
    const benign = [
      {
        label: "fixture/creation.repository.ts",
        content: [
          `await tx.insert(students).values({ id: userId, handshakeCode, balanceHifz: 0 });`,
          `await tx.update(students).set({ parentId: parentId }).where(eq(students.handshakeCode, code));`,
        ].join("\n"),
      },
    ];
    expect(scanDrizzleSetWrites(benign)).toEqual([]);
  });

  test("raw SQL scanner fires on a SET clause targeting the column", () => {
    const bad = [
      {
        label: "fixture/raw-mutating.repository.ts",
        content: `await queryDb("UPDATE students SET handshake_code = $1 WHERE id = $2", [code, id]);`,
      },
    ];
    expect(scanRawSqlSetWrites(bad)).toEqual(["fixture/raw-mutating.repository.ts"]);
  });

  test("upsert scanner fires on an onConflictDoUpdate payload targeting the column", () => {
    const bad = [
      {
        label: "fixture/upsert.repository.ts",
        content: `.onConflictDoUpdate({ target: students.id, set: { handshakeCode: code } });`,
      },
    ];
    expect(scanUpsertSetWrites(bad)).toEqual(["fixture/upsert.repository.ts"]);
  });

  test("mutation-name scanner fires on rewrite-named identifiers", () => {
    const bad = [
      {
        label: "fixture/rotating.service.ts",
        content: `export async function rotateHandshakeCode(userId: number, tx: DBTransaction): Promise<void> {}`,
      },
    ];
    expect(scanMutationNamedWrites(bad)).toEqual(["fixture/rotating.service.ts"]);
    const badUpdate = [
      {
        label: "fixture/updating.service.ts",
        content: `const result = await StudentRepository.updateHandshakeCode(userId, code, tx);`,
      },
    ];
    expect(scanMutationNamedWrites(badUpdate)).toEqual(["fixture/updating.service.ts"]);
  });

  test("mutation-name scanner does NOT fire on the creation generator", () => {
    const benign = [
      {
        label: "fixture/generating.service.ts",
        content: `const handshakeCode = generateHandshakeCode();`,
      },
    ];
    expect(scanMutationNamedWrites(benign)).toEqual([]);
  });

  test("union scanner aggregates every firing fixture", () => {
    const bad = [
      {
        label: "fixture/b.set.ts",
        content: `.set({ handshakeCode: code })`,
      },
      {
        label: "fixture/a.set.sql.ts",
        content: `UPDATE students SET handshake_code = $1`,
      },
    ];
    expect(scanAllWriteShapes(bad)).toEqual(["fixture/a.set.sql.ts", "fixture/b.set.ts"]);
  });
});
