/**
 * DB SSL configuration pins — the database client's TLS posture, verified
 * at the config tier: ZERO server boot, ZERO database access (pure
 * `node:fs` reads of `backend/db/client.ts` and `.env.example`, the
 * config-test precedent).
 *
 * What is pinned:
 *
 *  (a) PREDICATE IDENTITY — the client's `shouldUseSsl` predicate is
 *      extracted from source and asserted token-identical (modulo
 *      whitespace) to the mirror evaluated below, so the truth table
 *      exercises the REAL predicate, not a description of it. Any drift
 *      in the client's predicate fails this suite until the mirror is
 *      consciously updated.
 *  (b) TRUTH TABLE — `sslmode=require` enables SSL; a `*.neon.tech` host
 *      enables SSL with or without the parameter (case-insensitive host,
 *      case-SENSITIVE parameter name); every other connection string —
 *      including a plain production-shaped URL with no `sslmode`
 *      parameter — gets NO TLS. That last row is the recorded hazard:
 *      TLS is opt-in via the connection string, so the production
 *      `DATABASE_URL` MUST carry `sslmode=require`.
 *  (c) POOL WIRING — the pool applies `ssl` exactly when the predicate
 *      says so, and the enabled posture is `rejectUnauthorized: false`:
 *      the connection is encrypted but NOT certificate-verified. That is
 *      the as-built posture, recorded here verbatim — this suite pins it,
 *      it does not bless it as fully verified TLS.
 *  (d) ENV TEMPLATE — the env example's active default connection string
 *      is the local no-TLS shape, and its production (Neon) template
 *      carries `sslmode=require` (with a `verify-full` variant for Neon
 *      integration tests) — the documented production requirement.
 *
 * Determinism / hygiene: the suite never reads `process.env`, never opens
 * a database handle, and never prints file contents — every fixture below
 * is a synthetic connection string; the env template assertions check
 * placeholder template lines only.
 */

import { describe, expect, it } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** Repo root derived relatively from this suite's own location (never `process.cwd()`). */
const REPO_ROOT = join(import.meta.dir, "..", "..");

const CLIENT_PATH = join(REPO_ROOT, "backend/db/client.ts");
const ENV_EXAMPLE_PATH = join(REPO_ROOT, ".env.example");

/** Collapses all whitespace runs so formatting never breaks a pin. */
function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/gu, " ").trim();
}

/** Whitespace-insensitive containment (both sides normalized). */
function normalizedContains(haystack: string, needle: string): boolean {
  return normalizeWhitespace(haystack).includes(normalizeWhitespace(needle));
}

// ─── The mirror — token-identical to the client's real predicate ──────────────

/**
 * The client's SSL predicate, mirrored for evaluation. The identity test
 * below proves the client's `shouldUseSsl` is token-identical (modulo
 * whitespace) to CANONICAL_PREDICATE_SOURCE; this mirror is that exact
 * text re-typed and must be updated together with it, so the truth table
 * runs the real semantics. (A runtime `toString` comparison is not usable
 * here: the Bun transpiler strips types and minifies literals before
 * `Function.prototype.toString` sees the function.)
 */
const CANONICAL_PREDICATE_SOURCE = String.raw`function shouldUseSsl(connectionString: string): boolean {
  try {
    const parsed = new URL(connectionString);
    return parsed.searchParams.get("sslmode") === "require" || /\.neon\.tech$/i.test(parsed.hostname);
  } catch {
    return false;
  }
}`;

/** The mirror of CANONICAL_PREDICATE_SOURCE — keep both in lockstep. */
function shouldUseSslMirror(connectionString: string): boolean {
  try {
    const parsed = new URL(connectionString);
    return parsed.searchParams.get("sslmode") === "require" || /\.neon\.tech$/i.test(parsed.hostname);
  } catch {
    return false;
  }
}

/** Extracts the `shouldUseSsl` function source from the client module. */
function extractClientPredicateSource(clientSource: string): string | null {
  const match = /function shouldUseSsl\(connectionString: string\): boolean \{[\s\S]*?\n\}/.exec(clientSource);
  return match === null ? null : match[0];
}

// ─── Corpus guards — the pins must never be vacuous ──────────────────────────

describe("db-ssl config — corpus guards", () => {
  it("resolves the real repo root and the pinned config sources", () => {
    expect(existsSync(join(REPO_ROOT, "package.json"))).toBe(true);
    expect(existsSync(CLIENT_PATH)).toBe(true);
    expect(existsSync(ENV_EXAMPLE_PATH)).toBe(true);
  });

  it("the client source contains exactly one shouldUseSsl definition", () => {
    const source = readFileSync(CLIENT_PATH, "utf8");
    const occurrences = source.match(/function shouldUseSsl\b/g) ?? [];
    expect(occurrences).toHaveLength(1);
    expect(extractClientPredicateSource(source)).not.toBeNull();
  });
});

// ─── (a) Predicate identity — the mirror IS the real predicate ───────────────

describe("db-ssl config — predicate identity", () => {
  it("the client's shouldUseSsl is token-identical to the canonical predicate the truth table evaluates", () => {
    const clientSource = readFileSync(CLIENT_PATH, "utf8");
    const clientPredicate = extractClientPredicateSource(clientSource);
    expect(clientPredicate).not.toBeNull();
    expect(normalizeWhitespace(clientPredicate ?? "")).toBe(normalizeWhitespace(CANONICAL_PREDICATE_SOURCE));
  });
});

// ─── (b) Truth table — which connection strings get TLS ───────────────────────

describe("db-ssl config — shouldUseSsl truth table", () => {
  const cases: ReadonlyArray<{ readonly label: string; readonly url: string; readonly ssl: boolean }> = [
    {
      label: "sslmode=require enables SSL",
      url: "postgresql://user:pass@db.example.com:5432/kottaby?sslmode=require",
      ssl: true,
    },
    {
      label: "a *.neon.tech host enables SSL even without the parameter",
      url: "postgresql://user@ep-example-123456.us-east-1.aws.neon.tech/neondb",
      ssl: true,
    },
    {
      label: "the neon.tech host suffix matches case-insensitively",
      url: "postgresql://user@ep-example-123456.US-EAST-1.AWS.NEON.TECH/neondb",
      ssl: true,
    },
    {
      label: "sslmode=require enables SSL wherever it sits in the query string",
      url: "postgresql://user@db.example.com:5432/kottaby?foo=bar&sslmode=require",
      ssl: true,
    },
    {
      label: "HAZARD — a plain connection string gets NO SSL (TLS is opt-in via the string)",
      url: "postgresql://postgres@127.0.0.1:5432/kottaby",
      ssl: false,
    },
    {
      label: "sslmode=prefer does NOT enable SSL (only the exact value require does)",
      url: "postgresql://user@db.example.com:5432/kottaby?sslmode=prefer",
      ssl: false,
    },
    {
      label: "an uppercase SSLMODE parameter name does not enable SSL (name is case-sensitive)",
      url: "postgresql://user@db.example.com:5432/kottaby?SSLMODE=require",
      ssl: false,
    },
    {
      label: "a merely neon-adjacent host does not enable SSL (suffix must be .neon.tech)",
      url: "postgresql://user@neon.example.com:5432/kottaby",
      ssl: false,
    },
    {
      label: "a non-Neon host with no parameter gets NO SSL",
      url: "postgresql://user@db.example.com:5432/kottaby",
      ssl: false,
    },
    {
      label: "a malformed connection string fails closed (never throws)",
      url: "not a url at all",
      ssl: false,
    },
    {
      label: "an empty connection string fails closed (never throws)",
      url: "",
      ssl: false,
    },
  ];

  it("covers every documented variant of the predicate", () => {
    expect(cases).toHaveLength(11);
    expect(cases.filter(row => row.ssl)).toHaveLength(4);
    expect(cases.filter(row => !row.ssl)).toHaveLength(7);
  });

  for (const row of cases) {
    it(row.label, () => {
      expect(shouldUseSslMirror(row.url)).toBe(row.ssl);
    });
  }
});

// ─── (c) Pool wiring — the posture the client actually ships ──────────────────

describe("db-ssl config — pool wiring posture", () => {
  const clientSource = readFileSync(CLIENT_PATH, "utf8");

  it("the pool consults the predicate at construction time", () => {
    expect(normalizedContains(clientSource, "const requiresSsl = shouldUseSsl(connectionString);")).toBe(true);
  });

  it("the enabled posture is rejectUnauthorized: false — encrypted, NOT certificate-verified", () => {
    // The verbatim as-built posture: TLS is applied exactly when the
    // predicate says so, and the handshake skips certificate verification.
    // Pinning this line records the posture; changing it (e.g. to a
    // CA-verified setting) is a deliberate act that must update this pin.
    expect(normalizedContains(clientSource, "ssl: requiresSsl ? { rejectUnauthorized: false } : undefined,")).toBe(
      true
    );
  });

  it("no other ssl option construction exists in the client", () => {
    const sslOptionLines = clientSource.split(/\r?\n/u).filter(line => line.trimStart().startsWith("ssl:"));
    expect(sslOptionLines).toHaveLength(1);
  });
});

// ─── (d) Env template — the documented production requirement ───────────────

describe("db-ssl config — env example template posture", () => {
  const envExample = readFileSync(ENV_EXAMPLE_PATH, "utf8");

  it("the active default connection string is the local no-TLS shape", () => {
    const active = envExample.split(/\r?\n/u).filter(line => line.startsWith("DATABASE_URL="));
    expect(active).toHaveLength(1);
    expect(active[0]).toBe("DATABASE_URL=postgresql://postgres@127.0.0.1:5432/kottaby");
    expect(active[0]).not.toContain("sslmode=");
  });

  it("the production (Neon) template carries sslmode=require — the documented requirement", () => {
    const neonTemplate = envExample
      .split(/\r?\n/u)
      .find(line => line.includes("neon.tech/neondb") && line.includes("sslmode=") && !line.includes("NEON_TEST"));
    expect(neonTemplate).toBeDefined();
    expect(neonTemplate).toContain("sslmode=require");
  });

  it("the Neon integration-test template carries the stricter verify-full mode", () => {
    const testTemplate = envExample.split(/\r?\n/u).find(line => line.includes("NEON_TEST_DATABASE_URL"));
    expect(testTemplate).toBeDefined();
    expect(testTemplate).toContain("sslmode=verify-full");
  });
});
