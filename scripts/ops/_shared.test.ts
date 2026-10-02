import { describe, expect, it } from "bun:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  decodeUrlSegment,
  POSTGRES_PROTOCOLS,
  REDACTED_DSN,
  rawDsnHasAmbiguousAuthority,
  rawDsnHasMultiHostEndpoints,
  rawDsnPathHasDotSegments,
  rawDsnQueryHasEndpointOverride,
  redactDsn,
  resolveEnvFilePath,
  scrubDsnSecrets,
} from "@/scripts/ops/_shared";

const FIXTURE_DSN = "postgresql://ops_owner:supersecret-pw@db.internal.example:5432/ops_db?sslmode=require";

describe("shared URL helpers", () => {
  it("exposes the Postgres protocol set both tools share", () => {
    expect([...POSTGRES_PROTOCOLS].toSorted((a, b) => a.localeCompare(b))).toEqual(["postgres:", "postgresql:"]);
  });

  it("decodes a percent-encoded segment and degrades on malformed escapes", () => {
    expect(decodeUrlSegment("my%20db")).toBe("my db");
    expect(decodeUrlSegment("%31%32%37")).toBe("127");
    expect(decodeUrlSegment("plain")).toBe("plain");
    expect(decodeUrlSegment("%ZZ")).toBe("%ZZ");
  });
});

describe("rawDsnHasAmbiguousAuthority", () => {
  it("refuses a raw # in the authority span (pathed, pathless, and mid-span ?)", () => {
    expect(rawDsnHasAmbiguousAuthority("postgresql://ops_owner#k:pw@host.example:5432/app_db")).toBe(true);
    expect(rawDsnHasAmbiguousAuthority("postgresql://db#x")).toBe(true);
    expect(rawDsnHasAmbiguousAuthority("postgresql://host.example?user=a@b#f")).toBe(true);
  });

  it("refuses a raw ? inside the authority span — WHATWG ends it, libpq scans on", () => {
    // Live-proven R11 shape: WHATWG parses host `postgres` (empty path →
    // the `(default)` label) while libpq scans the authority to the `/`
    // and dumps the named database as role `postgres?k`.
    expect(rawDsnHasAmbiguousAuthority("postgresql://postgres?k@127.0.0.1:5432/app_db")).toBe(true);
    // Pathless with a later `@`: the span never ends at the `?` for libpq
    // (it would swallow the `@` into the userinfo), so the ambiguity stands.
    expect(rawDsnHasAmbiguousAuthority("postgresql://host.example?user=a@b")).toBe(true);
  });

  it("refuses a raw # in the raw path span", () => {
    expect(rawDsnHasAmbiguousAuthority("postgresql://u:p@host.example:5432/pt9b#k")).toBe(true);
    expect(rawDsnHasAmbiguousAuthority("postgresql://u:p@host.example:5432/pt9b#k?x=1")).toBe(true);
  });

  it("refuses a raw # in the raw query string", () => {
    expect(rawDsnHasAmbiguousAuthority("postgresql://u:p@host.example:5432/?dbname=app_db#k")).toBe(true);
    expect(rawDsnHasAmbiguousAuthority("postgresql://host.example:5432?dbname=app_db#k")).toBe(true);
  });

  it("refuses a raw control character in the authority span or the raw path span", () => {
    // WHATWG strips tab/newline/CR outright and percent-encodes the other
    // C0 controls, while libpq keeps the literal bytes — a raw control in
    // either span is unassessable (the guard's C0-plus-DEL rule).
    expect(rawDsnHasAmbiguousAuthority("postgresql://ops\towner:pw@host.example:5432/app_db")).toBe(true);
    expect(rawDsnHasAmbiguousAuthority("postgresql://ops_owner:pw@ho\u0001st.example:5432/app_db")).toBe(true);
    expect(rawDsnHasAmbiguousAuthority("postgresql://u:p@host.example:5432/app\rdb")).toBe(true);
    // Live-proven R12 shape: the database is literally named
    // `r12ptab<TAB>k`; WHATWG strips the tab (label `r12ptabk`) while libpq
    // dumps the tab byte.
    expect(rawDsnHasAmbiguousAuthority("postgresql://u:p@host.example:5432/r12ptab\tk")).toBe(true);
    expect(rawDsnHasAmbiguousAuthority("postgresql://u:p@host.example:5432/app\u007fdb")).toBe(true);
  });

  it("refuses a raw tab/newline/CR in the raw query string (WHATWG strips, libpq keeps)", () => {
    expect(rawDsnHasAmbiguousAuthority("postgresql://u:p@host.example:5432/app_db?dbname=app\tk")).toBe(true);
    expect(rawDsnHasAmbiguousAuthority("postgresql://u:p@host.example:5432/app_db?x=a\nb")).toBe(true);
  });

  it("allows percent-encoded fragments, pathless queries, and benign DSNs", () => {
    expect(rawDsnHasAmbiguousAuthority("postgresql://u:p@host.example:5432/app%23db")).toBe(false);
    expect(rawDsnHasAmbiguousAuthority("postgresql://u:p@host.example:5432/?dbname=app%23db")).toBe(false);
    // A percent-encoded tab decodes to the same literal on every channel —
    // never ambiguous.
    expect(rawDsnHasAmbiguousAuthority("postgresql://u:p@host.example:5432/r12ptab%09k")).toBe(false);
    expect(rawDsnHasAmbiguousAuthority("postgresql://u:p@host.example:5432/?dbname=app%09db")).toBe(false);
    // Pathless with no later `@`: the `?` is the query delimiter both
    // parsers agree on (the guard's pathless refinement) — not ambiguous.
    expect(rawDsnHasAmbiguousAuthority("postgresql://host.example:5432?sslmode=disable")).toBe(false);
    expect(rawDsnHasAmbiguousAuthority("postgresql://u:p@host.example:5432/app_db?sslmode=require")).toBe(false);
  });
});

describe("rawDsnPathHasDotSegments", () => {
  it("refuses a raw dot-segment in the raw path span", () => {
    // Live-proven R13 shape: libpq dumps the literal `a/../db` database
    // while the WHATWG pathname records the normalized `db`.
    expect(rawDsnPathHasDotSegments("postgresql://postgres@127.0.0.1:5432/a/../db")).toBe(true);
    expect(rawDsnPathHasDotSegments("postgresql://u:p@host.example:5432/../db")).toBe(true);
    expect(rawDsnPathHasDotSegments("postgresql://u:p@host.example:5432/./db")).toBe(true);
    expect(rawDsnPathHasDotSegments("postgresql://u:p@host.example:5432/db/../..//x")).toBe(true);
  });

  it("refuses a percent-encoded dot-segment by its decoded value", () => {
    // WHATWG normalizes %2e exactly like a literal dot — the decoded span
    // is gated the same way as the raw one.
    expect(rawDsnPathHasDotSegments("postgresql://u:p@host.example:5432/a/%2e%2e/db")).toBe(true);
    expect(rawDsnPathHasDotSegments("postgresql://u:p@host.example:5432/%2e/db")).toBe(true);
  });

  it("leaves benign paths, partial-dot names, pathless, and query-only DSNs unchanged", () => {
    expect(rawDsnPathHasDotSegments("postgresql://u:p@host.example:5432/app_db")).toBe(false);
    // A dot INSIDE a segment is not a dot-SEGMENT: WHATWG normalizes none
    // of these, so the raw path is the label libpq agrees with.
    expect(rawDsnPathHasDotSegments("postgresql://u:p@host.example:5432/..db")).toBe(false);
    expect(rawDsnPathHasDotSegments("postgresql://u:p@host.example:5432/a../db")).toBe(false);
    expect(rawDsnPathHasDotSegments("postgresql://u:p@host.example:5432/app_db?sslmode=require")).toBe(false);
    expect(rawDsnPathHasDotSegments("postgresql://host.example:5432?sslmode=disable")).toBe(false);
    expect(rawDsnPathHasDotSegments("postgresql://u:p@host.example:5432")).toBe(false);
  });
});

describe("rawDsnQueryHasEndpointOverride", () => {
  it("refuses the host/hostaddr/port endpoint-override keys in the raw query", () => {
    // Live-proven R14 shape: libpq applies query parameters ON TOP of the
    // authority, so `?host=`/`?port=` can point the dump at an endpoint the
    // authority label never names.
    expect(rawDsnQueryHasEndpointOverride("postgresql://u:p@db.example:5432/app_db?host=127.0.0.1")).toBe(true);
    expect(rawDsnQueryHasEndpointOverride("postgresql://u:p@db.example:5432/app_db?hostaddr=8.8.8.8")).toBe(true);
    expect(rawDsnQueryHasEndpointOverride("postgresql://u:p@db.example:5432/app_db?port=5433")).toBe(true);
    expect(rawDsnQueryHasEndpointOverride("postgresql://u:p@db.example:5432/app_db?host=127.0.0.1&port=5432")).toBe(
      true
    );
    // Mixed with benign parameters — the endpoint key still refuses.
    expect(rawDsnQueryHasEndpointOverride("postgresql://u:p@db.example:5432/app_db?dbname=app_db&port=5433")).toBe(
      true
    );
  });

  it("matches endpoint keys case-insensitively, percent-decoded, and valueless", () => {
    expect(rawDsnQueryHasEndpointOverride("postgresql://u:p@db.example:5432/app_db?HOST=127.0.0.1")).toBe(true);
    expect(rawDsnQueryHasEndpointOverride("postgresql://u:p@db.example:5432/app_db?HostAddr=8.8.8.8")).toBe(true);
    expect(rawDsnQueryHasEndpointOverride("postgresql://u:p@db.example:5432/app_db?%68ost=x")).toBe(true);
    expect(rawDsnQueryHasEndpointOverride("postgresql://u:p@db.example:5432/app_db?host")).toBe(true);
    expect(rawDsnQueryHasEndpointOverride("postgresql://u:p@db.example:5432/app_db?port")).toBe(true);
  });

  it("refuses the service key — decoded, case-insensitive, valueless counts", () => {
    // libpq resolves `?service=` through the connection-service file
    // (~/.pg_service.conf / PGSERVICEFILE), whose host/port decide the
    // endpoint nothing in the URL view sees — live-proven:
    // `postgresql://postgres@127.0.0.1/db?service=x` with a redirected
    // service file made psql connect on port 5999.
    expect(rawDsnQueryHasEndpointOverride("postgresql://u:p@db.example:5432/app_db?service=x")).toBe(true);
    expect(rawDsnQueryHasEndpointOverride("postgresql://u:p@db.example:5432/app_db?SERVICE=x")).toBe(true);
    expect(rawDsnQueryHasEndpointOverride("postgresql://u:p@db.example:5432/app_db?%73ervice=x")).toBe(true);
    // A valueless key counts as present — both `?service` and `?service=`.
    expect(rawDsnQueryHasEndpointOverride("postgresql://u:p@db.example:5432/app_db?service")).toBe(true);
    expect(rawDsnQueryHasEndpointOverride("postgresql://u:p@db.example:5432/app_db?service=")).toBe(true);
    // Mixed with benign parameters the service key still refuses.
    expect(rawDsnQueryHasEndpointOverride("postgresql://u:p@db.example:5432/app_db?sslmode=disable&service=x")).toBe(
      true
    );
    // Benign parameters stay allowed — the key is matched EXACTLY.
    expect(rawDsnQueryHasEndpointOverride("postgresql://u:p@db.example:5432/app_db?sslmode=disable")).toBe(false);
    expect(rawDsnQueryHasEndpointOverride("postgresql://u:p@db.example:5432/app_db?servername=hint")).toBe(false);
  });

  it("allows plain query parameters and benign DSNs unchanged", () => {
    expect(rawDsnQueryHasEndpointOverride("postgresql://u:p@db.example:5432/app_db?dbname=&sslmode=disable")).toBe(
      false
    );
    expect(
      rawDsnQueryHasEndpointOverride("postgresql://u:p@db.example:5432/app_db?sslmode=disable&application_name=x")
    ).toBe(false);
    expect(rawDsnQueryHasEndpointOverride("postgresql://u:p@db.example:5432/app_db?dbname=other")).toBe(false);
    // An exact-key match only: `localhost` is not a `host` key.
    expect(rawDsnQueryHasEndpointOverride("postgresql://u:p@db.example:5432/app_db?localhost=hint")).toBe(false);
    expect(rawDsnQueryHasEndpointOverride("postgresql://u:p@db.example:5432/app_db")).toBe(false);
    expect(rawDsnQueryHasEndpointOverride("postgresql://u:p@db.example:5432/app_db?sslmode=require")).toBe(false);
  });
});

describe("rawDsnHasMultiHostEndpoints", () => {
  it("refuses a comma in the authority host span — raw and percent-decoded", () => {
    // Live-proven R16 shape: libpq failover connects to the SECOND host in
    // the comma list while every URL-derived label renders only the first
    // authority host; the list split happens after the host is
    // percent-decoded, so %2C hides the second endpoint exactly like a
    // literal comma.
    expect(rawDsnHasMultiHostEndpoints("postgresql://postgres@127.0.0.1,8.8.8.8:5432/app_db")).toBe(true);
    expect(rawDsnHasMultiHostEndpoints("postgresql://127.0.0.1,8.8.8.8:5432/app_db")).toBe(true);
    expect(rawDsnHasMultiHostEndpoints("postgresql://postgres@127.0.0.1%2C8.8.8.8:5432/app_db")).toBe(true);
    // Pathless: the host span ends at the query delimiter both parsers agree on.
    expect(rawDsnHasMultiHostEndpoints("postgresql://127.0.0.1,8.8.8.8:5432?dbname=app_db")).toBe(true);
  });

  it("refuses a comma in a query host=/hostaddr= value — raw and percent-decoded", () => {
    expect(rawDsnHasMultiHostEndpoints("postgresql://u:p@db.example:5432/app_db?host=127.0.0.1,8.8.8.8")).toBe(true);
    expect(rawDsnHasMultiHostEndpoints("postgresql://u:p@db.example:5432/app_db?host=127.0.0.1%2C8.8.8.8")).toBe(true);
    expect(rawDsnHasMultiHostEndpoints("postgresql://u:p@db.example:5432/app_db?hostaddr=8.8.8.8,9.9.9.9")).toBe(true);
    // Key matching mirrors the endpoint-override gate: percent-decoded and case-insensitive.
    expect(rawDsnHasMultiHostEndpoints("postgresql://u:p@db.example:5432/app_db?%68ost=127.0.0.1,8.8.8.8")).toBe(true);
  });

  it("never flags a comma outside the host spans (userinfo, path, benign query)", () => {
    expect(rawDsnHasMultiHostEndpoints("postgresql://us,er@host.example:5432/app_db")).toBe(false);
    expect(rawDsnHasMultiHostEndpoints("postgresql://u:p@host.example:5432/db,name")).toBe(false);
    expect(
      rawDsnHasMultiHostEndpoints("postgresql://u:p@host.example:5432/app_db?dbname=a,b&application_name=x,y")
    ).toBe(false);
  });

  it("allows bracketed IPv6 hosts and single-endpoint DSNs unchanged", () => {
    expect(rawDsnHasMultiHostEndpoints("postgresql://postgres@[::1]:5432/app_db")).toBe(false);
    expect(rawDsnHasMultiHostEndpoints("postgresql://postgres@127.0.0.1:5432/app_db")).toBe(false);
    expect(rawDsnHasMultiHostEndpoints("postgresql://host.example:5432?sslmode=disable")).toBe(false);
    expect(rawDsnHasMultiHostEndpoints("postgresql://u:p@host.example:5432/app_db?sslmode=require")).toBe(false);
  });
});

describe("resolveEnvFilePath", () => {
  it("passes an absolute --env value through as-is", () => {
    const scratchEnv = join(tmpdir(), "ops", "scratch.env");
    const resolved = resolveEnvFilePath(scratchEnv);
    expect(resolved).toEqual({ fileName: "scratch.env", rootDir: join(tmpdir(), "ops") });
  });

  it("resolves a relative --env value against the process cwd", () => {
    const resolved = resolveEnvFilePath("nested/dir/.env");
    expect(resolved).toEqual({ fileName: ".env", rootDir: join(process.cwd(), "nested/dir") });
  });
});

describe("redactDsn", () => {
  it("renders the full contract shape: dbName@host(redacted-user)", () => {
    expect(redactDsn(FIXTURE_DSN)).toBe("ops_db@db.internal.example:5432(redacted-user)");
  });

  it("keeps the port when present and drops query parameters", () => {
    expect(redactDsn("postgres://u:p@host.example:5433/db?sslmode=require&application_name=x")).toBe(
      "db@host.example:5433(redacted-user)"
    );
  });

  it("omits the port when absent", () => {
    expect(redactDsn("postgresql://u:p@host.example/db")).toBe("db@host.example(redacted-user)");
  });

  it("marks password-only userinfo as redacted", () => {
    expect(redactDsn("postgresql://:pw@host.example/db")).toBe("db@host.example(redacted-user)");
  });

  it("marks a DSN without userinfo as no-user", () => {
    expect(redactDsn("postgresql://host.example/db")).toBe("db@host.example(no-user)");
  });

  it("renders host only when the database name is missing", () => {
    expect(redactDsn("postgresql://u:p@host.example")).toBe("host.example(redacted-user)");
  });

  it("decodes a percent-encoded database name", () => {
    expect(redactDsn("postgresql://u:p@host.example/my%20db")).toBe("my db@host.example(redacted-user)");
  });

  it("renders the query dbname= as the effective database (libpq override channel)", () => {
    expect(redactDsn("postgresql://u:p@h.example:5432/pathdb?dbname=querydb")).toBe(
      "querydb@h.example:5432(redacted-user)"
    );
    expect(redactDsn("postgresql://u:p@h.example/?dbname=querydb")).toBe("querydb@h.example(redacted-user)");
    // Other keys keep the path database; an explicitly EMPTY dbname= names
    // nothing — libpq completes an empty dbname from the USER name, never
    // the path — so the host-only render replaces the path db.
    expect(redactDsn("postgresql://u:p@h.example/pathdb?sslmode=require")).toBe("pathdb@h.example(redacted-user)");
    expect(redactDsn("postgresql://u:p@h.example/pathdb?dbname=")).toBe("h.example(redacted-user)");
  });

  it("keeps IPv6 host literals", () => {
    expect(redactDsn("postgresql://u:p@[2001:db8::1]:5432/db")).toBe("db@[2001:db8::1]:5432(redacted-user)");
  });

  it("falls back to the placeholder for empty, malformed, and non-Postgres values", () => {
    expect(redactDsn(undefined)).toBe(REDACTED_DSN);
    expect(redactDsn("")).toBe(REDACTED_DSN);
    expect(redactDsn("   ")).toBe(REDACTED_DSN);
    expect(redactDsn("not a dsn")).toBe(REDACTED_DSN);
    expect(redactDsn("file:./dev.db")).toBe(REDACTED_DSN);
    expect(redactDsn("mysql://u:p@host/db")).toBe(REDACTED_DSN);
    expect(redactDsn("postgresql:///db")).toBe(REDACTED_DSN);
  });
});

describe("scrubDsnSecrets", () => {
  it("replaces the exact DSN with its redacted rendering", () => {
    const scrubbed = scrubDsnSecrets(`connection failed for ${FIXTURE_DSN}`, FIXTURE_DSN);
    expect(scrubbed).toBe("connection failed for ops_db@db.internal.example:5432(redacted-user)");
  });

  it("replaces the decoded password substring with ***", () => {
    const scrubbed = scrubDsnSecrets("password supersecret-pw was rejected", FIXTURE_DSN);
    expect(scrubbed).toBe("password *** was rejected");
  });

  it("replaces the decoded username substring with ***", () => {
    const scrubbed = scrubDsnSecrets("role ops_owner has no permission", FIXTURE_DSN);
    expect(scrubbed).toBe("role *** has no permission");
  });

  it("handles percent-encoded credentials in the DSN", () => {
    const dsn = "postgresql://ops%5Fowner:super%40secret@host.example/db";
    const scrubbed = scrubDsnSecrets("auth failed for ops_owner with super@secret", dsn);
    expect(scrubbed).toBe("auth failed for *** with ***");
  });

  it("sweeps generic scheme://user:password@ occurrences from foreign output", () => {
    const scrubbed = scrubDsnSecrets("echo: postgresql://someone:hunter2@elsewhere.example/db");
    expect(scrubbed).toBe("echo: postgresql://***:***@elsewhere.example/db");
  });

  it("is a no-op for text without credentials when the DSN password is empty", () => {
    const text = "server 17.11 listening on 127.0.0.1:5432";
    expect(scrubDsnSecrets(text, "postgresql://postgres@127.0.0.1:5432/app_db")).toBe(text);
  });

  it("degrades gracefully on malformed DSNs via the generic sweep", () => {
    const scrubbed = scrubDsnSecrets("bad: postgresql://u:p@h/db and not-a-url at all", "not a dsn");
    expect(scrubbed).toBe("bad: postgresql://***:***@h/db and not-a-url at all");
  });

  it("never leaks credentials when scrubbing tool stderr containing the whole DSN", () => {
    const stderr = `pg_dump: error: connection to server failed: ${FIXTURE_DSN}\npassword supersecret-pw incorrect`;
    const scrubbed = scrubDsnSecrets(stderr, FIXTURE_DSN);
    expect(scrubbed).not.toContain("supersecret-pw");
    expect(scrubbed).not.toContain("ops_owner");
    expect(scrubbed).not.toContain("postgresql://");
    expect(scrubbed).toContain("***");
  });
});
