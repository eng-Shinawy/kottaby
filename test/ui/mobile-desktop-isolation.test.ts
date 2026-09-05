/**
 * Mobile/desktop isolation — static import-boundary scans ONLY (no server,
 * no browser, no DOM). Guards the responsive-layer boundaries documented in
 * `test/ui/AGENTS.md` ("Static checks | test/ui/mobile-desktop-isolation.test.ts
 * | Import-boundary scans only."):
 *
 *  1. E2E specs must NOT import the Happy-DOM preload — Happy-DOM installs a
 *     fake DOM that conflicts with Playwright's real browser runtime.
 *  2. Application code (`app/`, `frontend/`) must never import from `test/` —
 *     test helpers must never ship inside a client/server bundle.
 *  3. Viewport-variant modules (`*.mobile.*` / `*.desktop.*`) must never be
 *     statically imported TOGETHER by the same module — viewport-isolated
 *     trees are only ever entered through a single boundary (CSS display
 *     toggles / ViewportProvider), so both variants loading at once means the
 *     isolation contract is broken.
 *
 * Scans are text-based over `node:fs` walks — deterministic, dependency-free.
 * Directories absent from a checkout make the corresponding scan vacuous.
 */
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";

const REPO_ROOT = join(import.meta.dir, "..", "..");

function walkSources(dir: string, out: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out; // directory absent in this checkout — nothing to scan
  }
  for (const entry of entries) {
    const full = join(dir, entry);
    let stats: ReturnType<typeof statSync>;
    try {
      stats = statSync(full);
    } catch {
      continue;
    }
    if (stats.isDirectory()) {
      if (entry === "node_modules" || entry === ".next" || entry === ".next-test-prod" || entry === ".git") {
        continue;
      }
      walkSources(full, out);
    } else if (/\.(ts|tsx|js|jsx|mjs)$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

/** Extracts static import/export-from module specifiers + dynamic `import("...")`. */
function extractImports(source: string): string[] {
  const specs: string[] = [];
  // `from "spec"` covers single- AND multi-line static imports/export-from;
  // `import "spec"` catches bare side-effect imports (no `from` clause);
  // a separate pattern catches dynamic `import("spec")`. The side-effect
  // pattern cannot collide with the dynamic form (`import(`) because a paren
  // between the keyword and the quote fails `\s*["']`.
  const patterns = [/from\s*["']([^"']+)["']/g, /import\s*["']([^"']+)["']/g, /import\(\s*["']([^"']+)["']\s*\)/g];
  for (const re of patterns) {
    for (const match of source.matchAll(re)) {
      if (match[1]) specs.push(match[1]);
    }
  }
  return specs;
}

/**
 * True when a specifier refers into the repository `test/` directory —
 * either the aliased form (`@/test/...`) or a relative specifier resolved
 * against the importing file (e.g. `../../test/ui/e2e/x` from `test/ui/`).
 */
function refersIntoTestDir(spec: string, importingFile: string): boolean {
  if (spec.startsWith("@/test/")) {
    return true;
  }
  if (spec.startsWith("./") || spec.startsWith("../")) {
    const resolved = resolve(dirname(importingFile), spec);
    const testDir = join(REPO_ROOT, "test");
    return resolved === testDir || resolved.startsWith(testDir + sep);
  }
  return false;
}

describe("mobile/desktop isolation — import-boundary scans", () => {
  test("E2E specs never import the Happy-DOM preload", () => {
    const e2eFiles = walkSources(join(REPO_ROOT, "test", "ui", "e2e"));
    const offenders = e2eFiles.filter(file => {
      const source = readFileSync(file, "utf8");
      return extractImports(source).some(spec => spec.includes("happydom-preload"));
    });
    expect(offenders).toEqual([]);
  });

  test("application modules never import from test/", () => {
    const appFiles = [...walkSources(join(REPO_ROOT, "app")), ...walkSources(join(REPO_ROOT, "frontend"))];
    const offenders = appFiles
      .filter(file => !file.split(sep).includes("test")) // test specs inside frontend/ are not application modules
      .filter(file => {
        const source = readFileSync(file, "utf8");
        return extractImports(source).some(spec => refersIntoTestDir(spec, file));
      })
      .map(file => relative(REPO_ROOT, file).split(sep).join("/"));
    expect(offenders).toEqual([]);
  });

  test("viewport-variant modules are never co-imported by the same module", () => {
    const allSources = [...walkSources(join(REPO_ROOT, "frontend")), ...walkSources(join(REPO_ROOT, "app"))];
    const offenders: string[] = [];
    for (const file of allSources) {
      const source = readFileSync(file, "utf8");
      const specs = extractImports(source);
      const importsMobile = specs.some(spec => /\.mobile(\.|$)/.test(spec));
      const importsDesktop = specs.some(spec => /\.desktop(\.|$)/.test(spec));
      if (importsMobile && importsDesktop) {
        offenders.push(relative(REPO_ROOT, file).split(sep).join("/"));
      }
    }
    expect(offenders).toEqual([]);
  });
});
