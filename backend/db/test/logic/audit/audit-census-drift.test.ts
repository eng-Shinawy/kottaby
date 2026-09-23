/**
 * Admin-mutation ↔ audit-census anti-drift lock — a static, DB-free proof
 * that the shipped admin-gated GraphQL mutation inventory and the admin
 * action census (`test/workflows/admin/audit-completeness.catalog.ts`) stay
 * in exact bijection.
 *
 * Three mechanisms:
 *
 *  1. Corpus walk — a read-only, deterministically sorted `node:fs` traverse
 *     over `backend/graphql/mutation/**` collects every mutation source file
 *     (pattern shared with the sibling `audit-immutability.test.ts` suite by
 *     design decision; the suites stay siblings — this one pins the census
 *     contract, that one pins the append-only contract).
 *
 *  2. Gate classification — each `gqlSchemaBuilder.mutationField("<name>", …)`
 *     registration forms one chunk; the chunk's `authScopes` object literal is
 *     classified as admin-gated when a `role: [UserRole.Admin]` leg is
 *     present — in BOTH accepted forms (plain map and the `$all` conjunction).
 *     A gate the classifier cannot resolve (non-literal `authScopes` value,
 *     unbalanced literal, non-static role member) is RECORDED as a skip note,
 *     never silently dropped, and the skip ledger must stay empty for the
 *     current corpus.
 *
 *  3. Bijection — the extracted admin-gated field set must equal the census
 *     `wired` field set in BOTH directions: an unaudited admin mutation
 *     shipped without a census row fails, and a census row outliving its
 *     mutation fails. Deferred rows are excluded from the bijection (they
 *     name future surfaces) but must trace to an existing ledger row id in
 *     `DEFERRED_ADMIN_ACTION_IDS`.
 *
 * NON-VACUITY: the classifier and the bijection helper are pure functions
 * over (path → content) maps and are exercised against crafted in-memory
 * fixtures that MUST fire — plain-map and `$all` admin gates, non-admin and
 * public shapes, unresolvable gates, and drift injected in both directions —
 * so a broken scanner can never fake green.
 *
 * LEXICAL CAVEAT (accepted by design, mirroring the sibling suite): the scan
 * is text-level. A quoted field name inside a comment would be treated as a
 * registration (visible, cheap false positive); a variable-named registration
 * is deliberately obfuscated code that fails review anyway.
 *
 * DETERMINISM: file discovery sorts names with `localeCompare` at read time;
 * repeated traversals yield identical orderings.
 *
 * DB SAFETY: this suite performs ZERO database operations — pure filesystem +
 * regex proof; no `runInRollback` wrapper and no seed data are involved.
 */

import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { AuditActionType } from "@/backend/enum/audit/audit-action-type.enum";
import {
  ACTION_TYPE_COVERAGE,
  ADMIN_ACTION_CENSUS,
  type AdminActionCensusEntry,
  DEFERRED_ADMIN_ACTION_IDS,
} from "@/test/workflows/admin/audit-completeness.catalog";

// ─── Contracts under pin ─────────────────────────────────────────────────────

/** Root of the production mutation corpus (repo-relative, resolved from the repo root). */
const MUTATION_CORPUS_ROOT = join(process.cwd(), "backend", "graphql", "mutation");

/** Minimum number of admin-gated mutation fields the corpus must yield (anti-blind-spot floor). */
const MIN_ADMIN_MUTATION_FIELDS = 15;

/** Minimum number of source files the mutation corpus must contain (anti-blind-spot floor). */
const MIN_MUTATION_CORPUS_FILES = 10;

/** Production files that MUST be inside the scanned corpus (anti-blind-spot sentinels). */
const CORPUS_SENTINEL_PATHS = [
  "admin/admin-users.mutation.ts",
  "admin/admin-governance.mutation.ts",
  "admin/admin-teachers.mutation.ts",
  "notifications/admin-broadcast.mutation.ts",
  "classes/session-lifecycle.mutation.ts",
  "plan-catalog.mutation.ts",
] as const;

/**
 * Matches one mutation-field registration carrying a quoted field name. The
 * quote is REQUIRED so comment mentions like
 * `gqlSchemaBuilder.mutationField(...)` never split a chunk.
 */
const MUTATION_FIELD_DECLARATION_PATTERN = /gqlSchemaBuilder\s*\.\s*mutationField\s*\(\s*"([A-Za-z]\w*)"/gu;

/** Matches one `role: [ … ]` array leg inside an `authScopes` literal. */
const ROLE_LEG_PATTERN = /role\s*:\s*\[([^\]]*)\]/gu;

/** Matches any `role:` scope key inside an `authScopes` literal (array form or not). */
const ROLE_KEY_PATTERN = /\brole\s*:/gu;

/** A statically resolvable role member, e.g. `UserRole.Admin`. */
const STATIC_ROLE_MEMBER_PATTERN = /^UserRole\.[A-Za-z][A-Za-z0-9]*$/u;

/** The role member that marks a chunk as admin-gated. */
const ADMIN_ROLE_MEMBER = "UserRole.Admin";

// ─── Read-only traversal helpers ─────────────────────────────────────────────

/** Virtual file unit fed to scanners (label relative to the corpus root + content). */
interface SourceFile {
  readonly label: string;
  readonly content: string;
}

/**
 * Recursively lists `.ts` files under `rootDir`, deterministically sorted
 * (skips missing roots and `node_modules`). Labels are relative to the root
 * so any drift finding names the owning file.
 */
function listSourceFiles(rootDir: string): SourceFile[] {
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
      if (!entry.isFile() || !entry.name.endsWith(".ts")) {
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

// ─── Pure scanners (each also exercised against crafted fixtures) ────────────

/** How a chunk's authScopes gate resolved. */
type GateClassification = "admin" | "non-admin" | "unclassifiable";

/** One admin-gated field found in the corpus. */
interface AdminMutationField {
  readonly file: string;
  readonly field: string;
}

/** Result of scanning the mutation corpus. */
interface MutationFieldScan {
  /** Statically admin-gated fields, in deterministic file-then-position order. */
  readonly adminFields: readonly AdminMutationField[];
  /**
   * Recorded skip notes (`<file>#<field>`) for registrations whose authScopes
   * block could not be classified. Honest-skip ledger: never silently dropped.
   */
  readonly unclassifiable: readonly string[];
}

/**
 * Extracts the balanced `authScopes: { … }` object literal from a chunk.
 * Returns null when the chunk carries no `authScopes: {` literal at all
 * (either the key is absent or its value is not an object literal) or when
 * the literal is unbalanced — callers decide which of those means what.
 */
function extractAuthScopesLiteral(chunk: string): string | null {
  const match = /authScopes\s*:\s*\{/u.exec(chunk);
  if (match === null) {
    return null;
  }
  const start = match.index + match[0].length - 1;
  let depth = 0;
  for (let index = start; index < chunk.length; index++) {
    const character = chunk[index];
    if (character === "{") {
      depth++;
    } else if (character === "}") {
      depth--;
      if (depth === 0) {
        return chunk.slice(start, index + 1);
      }
    }
  }
  return null;
}

/**
 * Classifies one registration chunk. `admin` when a statically resolvable
 * `role` leg contains `UserRole.Admin` (ANY semantics: one admin leg is
 * enough). `non-admin` when there is no authScopes at all (public field) or
 * the literal carries no admin role leg. `unclassifiable` when the gate
 * cannot be resolved statically — a non-literal `authScopes` value, an
 * unbalanced literal, or a role member that is not a static `UserRole.X`.
 */
function classifyAdminGate(chunk: string): GateClassification {
  if (!/authScopes\s*:/u.test(chunk)) {
    return "non-admin";
  }
  // The key is present: a missing or unbalanced object literal means the
  // gate's value is NOT a statically readable literal (e.g. a shared
  // constant) — recorded as unclassifiable instead of guessed.
  const literal = extractAuthScopesLiteral(chunk);
  if (literal === null) {
    return "unclassifiable";
  }
  const arrayLegs = [...literal.matchAll(ROLE_LEG_PATTERN)];
  // A `role:` key whose value is NOT a bracket array (a function call, a
  // variable, an object) cannot be resolved statically — recorded instead
  // of guessed.
  if ([...literal.matchAll(ROLE_KEY_PATTERN)].length > arrayLegs.length) {
    return "unclassifiable";
  }
  let adminGated = false;
  for (const leg of arrayLegs) {
    for (const member of leg[1]
      .split(",")
      .map(token => token.trim())
      .filter(token => token.length > 0)) {
      if (!STATIC_ROLE_MEMBER_PATTERN.test(member)) {
        return "unclassifiable";
      }
      if (member === ADMIN_ROLE_MEMBER) {
        adminGated = true;
      }
    }
  }
  return adminGated ? "admin" : "non-admin";
}

/**
 * Splits a mutation source file into one chunk per `mutationField("<name>"`
 * registration and classifies each chunk's gate. Registrations whose field
 * name cannot be read, and gates classified `unclassifiable`, land in the
 * recorded skip ledger instead of the admin set.
 */
function scanAdminGatedMutationFields(files: readonly SourceFile[]): MutationFieldScan {
  const adminFields: AdminMutationField[] = [];
  const unclassifiable: string[] = [];
  for (const file of files) {
    const declarations = [...file.content.matchAll(MUTATION_FIELD_DECLARATION_PATTERN)];
    for (const [position, declaration] of declarations.entries()) {
      const chunkStart = declaration.index;
      const chunkEnd = position + 1 < declarations.length ? declarations[position + 1].index : file.content.length;
      const chunk = file.content.slice(chunkStart, chunkEnd);
      const field = declaration[1];
      const classification = classifyAdminGate(chunk);
      if (classification === "admin") {
        adminFields.push({ file: file.label, field });
      } else if (classification === "unclassifiable") {
        unclassifiable.push(`${file.label}#${field}`);
      }
    }
  }
  return { adminFields, unclassifiable };
}

// ─── Bijection helper (pure, injectable — also the negative-test harness) ────

/** Both drift directions between the shipped inventory and the census. */
interface CensusBijectionReport {
  /** Extracted admin-gated fields with NO census `wired` row (unaudited admin mutation shipped). */
  readonly missingFromCensus: readonly string[];
  /** Census `wired` rows whose mutation field is NOT shipped (census ahead of the code). */
  readonly unwiredCensusRows: readonly string[];
}

/**
 * Compares the census `wired` rows with the extracted admin-gated field set
 * in both directions. Pure and injectable: the negative self-test harness
 * feeds it mutated inputs and requires the mismatch to be reported.
 */
function compareCensusWithExtractedFields(
  census: readonly AdminActionCensusEntry[],
  extractedFields: readonly string[]
): CensusBijectionReport {
  const extracted = new Set(extractedFields);
  const wiredFieldNames = census.filter(entry => entry.kind === "wired").map(entry => entry.mutationField);
  const wired = new Set(wiredFieldNames);
  return {
    missingFromCensus: [...extracted].filter(field => !wired.has(field)).toSorted((a, b) => a.localeCompare(b)),
    unwiredCensusRows: wiredFieldNames.filter(field => !extracted.has(field)).toSorted((a, b) => a.localeCompare(b)),
  };
}

// ─── Corpus extraction (module-level, deterministic) ─────────────────────────

const mutationCorpus: SourceFile[] = listSourceFiles(MUTATION_CORPUS_ROOT);
const mutationScan: MutationFieldScan = scanAdminGatedMutationFields(mutationCorpus);
const extractedAdminFieldNames: readonly string[] = mutationScan.adminFields.map(entry => entry.field);

// ─── Tier 1: corpus extraction ───────────────────────────────────────────────

describe("admin mutation corpus — extraction", () => {
  test("the mutation corpus is populated and covers every admin-surface file (no blind spots)", () => {
    expect(mutationCorpus.length).toBeGreaterThanOrEqual(MIN_MUTATION_CORPUS_FILES);
    const labels = mutationCorpus.map(file => file.label);
    for (const sentinel of CORPUS_SENTINEL_PATHS) {
      expect(labels).toContain(sentinel);
    }
  });

  test("every registration chunk is statically classifiable (the skip ledger is empty)", () => {
    expect(mutationScan.unclassifiable).toEqual([]);
  });

  test("extracted admin-gated field names are unique across the corpus", () => {
    expect(new Set(extractedAdminFieldNames).size).toBe(extractedAdminFieldNames.length);
  });

  test("extraction meets the corpus-population floor", () => {
    expect(extractedAdminFieldNames.length).toBeGreaterThanOrEqual(MIN_ADMIN_MUTATION_FIELDS);
  });
});

// ─── Tier 2: bijection — shipped inventory ≡ census wired rows ───────────────

describe("bijection — shipped admin mutations ≡ census wired rows", () => {
  test("the shipped admin-mutation set equals the census wired set in BOTH directions", () => {
    const report = compareCensusWithExtractedFields(ADMIN_ACTION_CENSUS, extractedAdminFieldNames);
    expect(report.missingFromCensus).toEqual([]);
    expect(report.unwiredCensusRows).toEqual([]);
  });

  test("census wired rows carry distinct mutation-field names", () => {
    const wiredFieldNames = ADMIN_ACTION_CENSUS.filter(entry => entry.kind === "wired").map(
      entry => entry.mutationField
    );
    expect(new Set(wiredFieldNames).size).toBe(wiredFieldNames.length);
  });

  test("wired rows name verbs and no ledger ref; deferred rows always name their ledger ref", () => {
    for (const entry of ADMIN_ACTION_CENSUS) {
      if (entry.kind === "wired") {
        expect(entry.expectedActionTypes.length).toBeGreaterThan(0);
        expect(entry.deferredRef).toBeUndefined();
      } else {
        expect(entry.deferredRef).toMatch(/^D-\d{3}$/u);
      }
    }
  });

  test("deferred rows stay outside the shipped mutation namespace", () => {
    for (const entry of ADMIN_ACTION_CENSUS.filter(candidate => candidate.kind === "deferred")) {
      expect(entry.mutationField.startsWith("(future)")).toBe(true);
      expect(extractedAdminFieldNames).not.toContain(entry.mutationField);
    }
  });
});

// ─── Tier 3: deferred-row ledger traceability + enum coverage accounting ─────

describe("deferred rows trace to the canonical deferred set; coverage map stays consistent", () => {
  test("every deferred row references an existing D-0xx ledger row id", () => {
    expect(DEFERRED_ADMIN_ACTION_IDS.length).toBeGreaterThan(0);
    const validIds: readonly string[] = DEFERRED_ADMIN_ACTION_IDS;
    for (const entry of ADMIN_ACTION_CENSUS.filter(candidate => candidate.kind === "deferred")) {
      // A missing ref falls back to an id no ledger row can ever carry,
      // so the containment assertion fails loudly.
      const ledgerRef = entry.deferredRef ?? "";
      expect(validIds).toContain(ledgerRef);
    }
  });

  test("every audit action type is accounted: shipped verbs wired, the fixture-only verb marked fixture", () => {
    expect(ACTION_TYPE_COVERAGE[AuditActionType.Create]).toBe("wired");
    expect(ACTION_TYPE_COVERAGE[AuditActionType.Update]).toBe("wired");
    expect(ACTION_TYPE_COVERAGE[AuditActionType.Delete]).toBe("wired");
    expect(ACTION_TYPE_COVERAGE[AuditActionType.Override]).toBe("wired");
    expect(ACTION_TYPE_COVERAGE[AuditActionType.Suspend]).toBe("wired");
    expect(ACTION_TYPE_COVERAGE[AuditActionType.Reactivate]).toBe("wired");
    expect(ACTION_TYPE_COVERAGE[AuditActionType.Adjust]).toBe("wired");
  });

  test("coverage marked wired is backed by a wired census row emitting that verb", () => {
    for (const entry of ADMIN_ACTION_CENSUS) {
      if (entry.kind !== "wired") {
        continue;
      }
      for (const actionType of entry.expectedActionTypes) {
        expect(ACTION_TYPE_COVERAGE[actionType]).toBe("wired");
      }
    }
  });

  test("coverage converse: every verb marked wired has a producing wired census row", () => {
    for (const member of Object.values(AuditActionType)) {
      if (ACTION_TYPE_COVERAGE[member] !== "wired") {
        continue;
      }
      const produced = ADMIN_ACTION_CENSUS.some(
        row => row.kind === "wired" && row.expectedActionTypes.includes(member)
      );
      expect(produced).toBe(true);
    }
  });
});

// ─── Scanner non-vacuity + negative self-test harness ────────────────────────

/** Builds one synthetic registration chunk (starts at the declaration, like real chunks). */
function registrationChunk(fieldName: string, body: string): string {
  return `gqlSchemaBuilder.mutationField("${fieldName}", t =>\n  t.field({\n${body}\n  })\n);`;
}

describe("negative self-test harness — the lock catches injected drift", () => {
  test("the classifier fires on the plain-map admin gate", () => {
    const chunk = registrationChunk(
      "fakePlainMapAdminField",
      "    authScopes: {\n      role: [UserRole.Admin],\n    },\n    resolve: () => null,"
    );
    expect(classifyAdminGate(chunk)).toBe("admin");
  });

  test("the classifier fires on the $all conjunction form", () => {
    const chunk = registrationChunk(
      "fakeAllFormAdminField",
      "    authScopes: {\n      $all: {\n        authenticated: true,\n        role: [UserRole.Admin],\n      },\n    },\n    resolve: () => null,"
    );
    expect(classifyAdminGate(chunk)).toBe("admin");
  });

  test("the classifier stays silent on permission-gated, role-gated-non-admin, and public fields", () => {
    const permissionGate = registrationChunk(
      "fakeCronField",
      "    authScopes: {\n      permission: AppPermission.CRON_MANAGE,\n    },\n    resolve: () => null,"
    );
    const nonAdminRoleGate = registrationChunk(
      "fakeParentField",
      "    authScopes: {\n      $all: {\n        authenticated: true,\n        role: [UserRole.Parent],\n      },\n    },\n    resolve: () => null,"
    );
    const publicField = registrationChunk("fakePublicField", "    resolve: () => null,");
    expect(classifyAdminGate(permissionGate)).toBe("non-admin");
    expect(classifyAdminGate(nonAdminRoleGate)).toBe("non-admin");
    expect(classifyAdminGate(publicField)).toBe("non-admin");
  });

  test("the classifier records a note instead of guessing on unresolvable gates", () => {
    const sharedConstantGate = registrationChunk("fakeConstGateField", "    authScopes: SHARED_ADMIN_GATE,");
    const dynamicRoleGate = registrationChunk(
      "fakeDynamicRoleField",
      "    authScopes: {\n      role: resolveGateRoles(),\n    },\n    resolve: () => null,"
    );
    expect(classifyAdminGate(sharedConstantGate)).toBe("unclassifiable");
    expect(classifyAdminGate(dynamicRoleGate)).toBe("unclassifiable");
  });

  test("the full scanner extracts injected drift fixtures from crafted files", () => {
    const crafted: readonly SourceFile[] = [
      {
        label: "fixture/plain-map.mutation.ts",
        content: [
          registrationChunk(
            "fixturePlainAdminField",
            "    authScopes: {\n      role: [UserRole.Admin],\n    },\n    resolve: () => null,"
          ),
          registrationChunk(
            "fixtureTeacherField",
            "    authScopes: {\n      $all: {\n        authenticated: true,\n        role: [UserRole.Teacher],\n      },\n    },\n    resolve: () => null,"
          ),
        ].join("\n"),
      },
      {
        label: "fixture/all-form.mutation.ts",
        content: registrationChunk(
          "fixtureAllAdminField",
          "    authScopes: {\n      $all: {\n        authenticated: true,\n        role: [UserRole.Admin],\n      },\n    },\n    resolve: () => null,"
        ),
      },
    ];
    const scan = scanAdminGatedMutationFields(crafted);
    expect(scan.unclassifiable).toEqual([]);
    expect(scan.adminFields.map(entry => entry.field)).toEqual(["fixturePlainAdminField", "fixtureAllAdminField"]);
  });

  test("injecting an extra shipped mutation reports it as missing from the census (and nothing else)", () => {
    const injectedField = "fakeUnauditedAdminMutation";
    const report = compareCensusWithExtractedFields(ADMIN_ACTION_CENSUS, [...extractedAdminFieldNames, injectedField]);
    expect(report.missingFromCensus).toEqual([injectedField]);
    expect(report.unwiredCensusRows).toEqual([]);
  });

  test("injecting an extra wired census row reports it as unwired (and nothing else)", () => {
    const phantomRow: AdminActionCensusEntry = {
      mutationField: "phantomAdminField",
      serviceEntry: "PhantomService.phantomAction",
      expectedActionTypes: [AuditActionType.Create],
      expectedEntityType: "phantom",
      kind: "wired",
    };
    const report = compareCensusWithExtractedFields([...ADMIN_ACTION_CENSUS, phantomRow], extractedAdminFieldNames);
    expect(report.unwiredCensusRows).toEqual([phantomRow.mutationField]);
    expect(report.missingFromCensus).toEqual([]);
  });
});
