/**
 * Shared helpers for the database ops scripts (backup-database.ts and
 * restore-verify.ts).
 *
 * Contract: no script output (stdout, stderr, JSON artifacts, error tails)
 * may contain a raw connection string, a username, or a password. DSNs are
 * rendered as `dbName@host(redacted-user)` — the database name, host, and
 * port are kept for operator readability; every credential-bearing portion
 * is replaced by a fixed marker. Anything that is not a parseable Postgres
 * URL degrades to the fixed `redacted-dsn` placeholder rather than being
 * echoed back.
 *
 * The module also owns the tiny URL/segment utilities the CLIs need (the
 * Postgres protocol set, the raw URI path substring, the backup-eligible DSN
 * parse, the manifest-safe database-name extraction and the restore guard's
 * URI database-component rule) and the `--env` path resolution — one
 * definition each, imported by both tools. (The restore guard's host/query
 * URL pipeline lives in `restore-guard-url.ts`, and the backup source-DSN
 * gate scans live in `source-dsn-gates.ts` — both extracted to honor the
 * oxlint `max-lines` budget; the percent-segment decoder and the raw gate
 * scans are re-exported from here, so the CLIs' import paths are unchanged.)
 */

import { basename, dirname, resolve } from "node:path";
import { isValidDatabaseUrl } from "@/scripts/dbActions/envFile";
import {
  decodeUrlSegment,
  hasDotSegments,
  rawDsnHasAmbiguousAuthority,
  rawDsnHasMultiHostEndpoints,
  rawDsnPathHasDotSegments,
  rawDsnQueryHasEndpointOverride,
  rawDsnQueryHasServiceIndirection,
} from "@/scripts/ops/source-dsn-gates";

/** Placeholder emitted when a value cannot be safely rendered. */
export const REDACTED_DSN = "redacted-dsn";

/** The URL protocols both tools treat as Postgres DSNs. */
export const POSTGRES_PROTOCOLS = new Set(["postgresql:", "postgres:"]);

/**
 * Re-exports keeping the historical `_shared` import paths working after the
 * `source-dsn-gates.ts` extraction: the percent-segment decoder and the four
 * public raw gate scans physically live there, while the backup bootstrap's
 * refusal dispatcher (`backupSourceDsnRefusal` below) and the unit suite
 * still reach them through this module.
 */
export {
  decodeUrlSegment,
  rawDsnHasAmbiguousAuthority,
  rawDsnHasMultiHostEndpoints,
  rawDsnPathHasDotSegments,
  rawDsnQueryHasEndpointOverride,
};

/**
 * The RAW path substring of a postgres URI: the characters after the
 * authority span (from the first `/` of the raw string) up to the first
 * `?`/`#`, leading `/` included. The `?` end is libpq's own query
 * delimiter; the `#` end is the WHATWG view — libpq has NO fragment
 * delimiter and READS THROUGH a raw `#` (it is part of the literal database
 * name, live-proven: `…/db#x` restores into `db#x`), so on a raw-fragment
 * path this substring is the TRUNCATED view, not libpq's. The restore guard
 * refuses raw-fragment paths before any run (fail closed —
 * `assessRawUriPath` in `restore-guard-url.ts`), so label consumers of this
 * substring never see a target whose libpq name differs from the truncated
 * label. The WHATWG URL parser also normalizes `.`/`..` dot-segments in its
 * `pathname` (and recognizes their percent-encoded forms), while libpq
 * treats the raw path as the LITERAL database name, so any component that
 * names the target database must derive it from this raw view, never from
 * `URL#pathname`. A URI whose first `?`/`#` precedes any `/` (pathless) has
 * no raw path.
 */
export function rawUriPathSubstring(target: string): string {
  const schemeEnd = target.indexOf("://");
  const authorityStart = schemeEnd < 0 ? 0 : schemeEnd + 3;
  let pathEnd = target.length;
  for (const stop of ["?", "#"]) {
    const stopAt = target.indexOf(stop, authorityStart);
    if (stopAt >= 0 && stopAt < pathEnd) {
      pathEnd = stopAt;
    }
  }
  const slashAt = target.indexOf("/", authorityStart);
  if (slashAt < 0 || slashAt >= pathEnd) {
    return "";
  }
  return target.slice(slashAt, pathEnd);
}

/** Refusal for a URI-form target whose raw path carries dot-segments. */
const DOT_SEGMENT_PATH_REFUSAL =
  "target URL path contains dot-segments (./..) — the URL parser normalizes them away while libpq treats the " +
  "raw path as the literal database name — dot-segment path is unassessable — cannot assess target safety";

/**
 * Assesses the URI DATABASE COMPONENT against the query `dbname=` override
 * channel. The path database is derived from the RAW path substring (via
 * {@link rawUriPathSubstring}, leading `/` stripped) — libpq's literal view —
 * never from the WHATWG `pathname`, which normalizes dot-segments away.
 * libpq applies query parameters ON TOP of the parsed URI, so a query
 * `dbname=` IS the database the connection uses:
 *
 *   - a raw path carrying dot-segments (`.`/`..` as whole segments, raw or
 *     percent-encoded) REFUSES: the WHATWG pathname would silently rename the
 *     target libpq restores into — unassessable, fail closed;
 *   - no query `dbname=` → the path rule stands (an empty/absent path
 *     database is under-specified — the ambient environment would complete
 *     it);
 *   - query `dbname=` AND a path database → both must AGREE: the libpq URI
 *     families disagree on which component wins, so a disagreement is an
 *     ambiguity no assessment can resolve (`ambiguous: true`, fail closed).
 *     The comparison happens on DECODED values (libpq percent-decodes the
 *     path database before use); a malformed escape refuses the run;
 *   - query `dbname=` over an empty/absent path → the query value IS the
 *     explicit target database (`unspecified: false`) — unless the value is
 *     EMPTY, which names nothing and stays under-specified.
 */
export function assessUriDatabaseComponent(
  rawTarget: string,
  queryDbname: string | undefined
): { kind: "ok"; unspecified: boolean; ambiguous: boolean } | { kind: "refuse"; reason: string } {
  const rawPathDatabase = rawUriPathSubstring(rawTarget).replace(/^\//, "");
  if (rawPathDatabase.length === 0) {
    return {
      kind: "ok",
      unspecified: queryDbname === undefined || queryDbname.length === 0,
      ambiguous: false,
    };
  }
  if (hasDotSegments(rawPathDatabase)) {
    return { kind: "refuse", reason: DOT_SEGMENT_PATH_REFUSAL };
  }
  let decodedPathDatabase: string;
  try {
    decodedPathDatabase = decodeURIComponent(rawPathDatabase);
  } catch {
    return {
      kind: "refuse",
      reason: "target URL path database carries a malformed percent-escape — cannot assess target safety",
    };
  }
  // A percent-encoded dot-segment (%2e) is normalized by WHATWG exactly like
  // a literal one, so the decoded view is gated the same way.
  if (hasDotSegments(decodedPathDatabase)) {
    return { kind: "refuse", reason: DOT_SEGMENT_PATH_REFUSAL };
  }
  if (queryDbname === undefined) {
    return { kind: "ok", unspecified: false, ambiguous: false };
  }
  return { kind: "ok", unspecified: false, ambiguous: decodedPathDatabase !== queryDbname };
}

/**
 * Parses a DATABASE_URL that is eligible for backup: a valid postgres URL
 * with a hostname. Reuses the shared env-file validator first (it rejects
 * placeholders and empty values), then enforces the Postgres-only dialect.
 */
export function parsePostgresDatabaseUrl(value: string | undefined): URL | null {
  if (!isValidDatabaseUrl(value)) {
    return null;
  }
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "postgresql:" && url.protocol !== "postgres:") {
      return null;
    }
    return url.hostname ? url : null;
  } catch {
    return null;
  }
}

/**
 * Effective database name of a parsed Postgres DSN: the query `dbname=`
 * parameter when it carries a value, else the URI path database.
 *
 * libpq applies URI query parameters ON TOP of the parsed URI, so a query
 * `dbname=` names the database the backup family (pg_dump) actually connects
 * to — with an empty/absent path the query is the ONLY database signal, and
 * when both are present the query wins (the manifest must record the
 * database pg_dump dumps, not the path the URI happens to carry). The raw
 * query is scanned with libpq keyword semantics — LAST occurrence wins,
 * names matched case-insensitively, values percent-decoded — deliberately
 * NOT via `URLSearchParams`, which would decode `+` as a space libpq never
 * does. An explicitly EMPTY query value (`?dbname=`) names nothing: libpq
 * completes an empty dbname from the USER name (never from the path), so
 * the path fallback does not apply and the empty string is returned — the
 * under-specified shape the backup bootstrap refuses (the unnamed-source
 * gate); a valueless `?dbname` counts as the same empty value. Returned
 * WITHOUT a fallback — callers decide what an empty name renders as.
 *
 * The path fallback reads the WHATWG `pathname` (decoded) — the label-side
 * view, kept deliberately for non-guard uses: libpq reads THROUGH a raw `#`
 * in the path (part of the literal database name) and normalizes nothing,
 * so a raw-fragment or dot-segment path would mislabel here; the restore
 * guard refuses such targets upstream before any run (fail closed), so a
 * restore label can never diverge from the database libpq restores into.
 * The backup bootstrap treats an EMPTY effective name as an unspecified
 * source database and refuses it (the unnamed-source gate).
 */
export function effectiveDatabaseName(url: URL): string {
  let queryDatabase: string | undefined;
  for (const pair of url.search.replace(/^\?/, "").split("&")) {
    if (pair.length === 0) {
      continue;
    }
    const equals = pair.indexOf("=");
    if (equals < 0) {
      // A valueless `?dbname` counts as libpq's empty value (the restore
      // guard's convention) — it names nothing rather than the path db.
      if (decodeUrlSegment(pair).toLowerCase() === "dbname") {
        queryDatabase = "";
      }
      continue;
    }
    if (decodeUrlSegment(pair.slice(0, equals)).toLowerCase() === "dbname") {
      queryDatabase = decodeUrlSegment(pair.slice(equals + 1));
    }
  }
  // An explicitly present (valueless or empty) query dbname= NEVER falls
  // back to the path: libpq completes an empty dbname from the USER name,
  // so the path db would mislabel the dump.
  if (queryDatabase !== undefined) {
    return queryDatabase;
  }
  return decodeUrlSegment(url.pathname.replace(/^\//, ""));
}

/**
 * Database name from a parsed DSN for the manifest's `database` field: the
 * effective database ({@link effectiveDatabaseName}) — the query `dbname=`
 * parameter when it carries a value, else the path database — so the
 * manifest names the database pg_dump actually dumps. An explicitly empty
 * `dbname=` names nothing (libpq completes it from the USER name; the
 * backup bootstrap refuses it) and renders the fixed "(default)" marker —
 * which is NEVER the userinfo either: the URL username is a
 * credential-adjacent value and must not leak into a persisted manifest (or
 * anywhere else).
 */
export function databaseNameFromDsn(url: URL): string {
  return effectiveDatabaseName(url) || "(default)";
}

/**
 * The source-DSN refusal (the exit-2 `[env]` message) for a BACKUP source
 * DSN — `null` when the DSN is assessable and backup-eligible. One
 * dispatcher for the five fail-closed gates the backup bootstrap applies,
 * in assessment order, before any out-dir, staging, dump, or manifest side
 * effect (the bootstrap prints the message; this function owns the rules):
 *
 *  1. RAW unassessable-authority/fragment/control gate — the backup-side
 *     mirror of the restore guard's raw-authority, raw-#, and control
 *     character channels (`assessRawUriAuthority`, `assessRawUriPath`, and
 *     the query-string rule in `restore-guard-url.ts`). libpq has no
 *     fragment delimiter and reads THROUGH a raw `#` in any span, and
 *     WHATWG and libpq DISAGREE on where the authority ends when a raw `?`
 *     sits inside it: libpq dumps the literal `…/pt9b#k` path database,
 *     connects as the literal `user#k` authority role, and folds
 *     `?dbname=app_db#k` into the parameter value, while every
 *     WHATWG-derived view (the `effectiveDatabaseName` label among them)
 *     ends that span at the `?`/`#` — breaking the _shared contract that
 *     the manifest records the database pg_dump dumps (live-proven R11
 *     shape: `postgres?k@host:5432/db` → manifest `(default)` while
 *     dumping a named database). A raw control character diverges the same
 *     way: WHATWG strips tab/newline/CR outright and percent-encodes the
 *     other C0 controls, while libpq keeps the literal bytes (live-proven
 *     R12 shape: a database literally named `r12ptab<TAB>k` in the path —
 *     the manifest labeled `r12ptabk` while the dump contains the tab). A
 *     percent-encoded escape (`%23`, `%09`) is fine — libpq percent-decodes
 *     each channel and the label decodes to the same literal name, so the
 *     manifest matches what was dumped.
 *  2. Dot-segment path gate — the backup-side mirror of the restore
 *     guard's dot-segment refusal ({@link assessUriDatabaseComponent}): the
 *     WHATWG parser normalizes `.`/`..` path segments away (raw or
 *     percent-encoded) while libpq treats the raw path as the LITERAL
 *     database name (live-proven: `…/a/../db` dumps the literal `a/../db`
 *     database while the manifest's WHATWG-derived label records `db`) —
 *     the manifest would rename the source. One message covers both the
 *     raw and the percent-encoded shape: percent-encoding a dot-segment is
 *     normalized away exactly like the literal one, so the remediation is
 *     the literal database name, not an escape.
 *  3. Multi-host endpoint gate (`rawDsnHasMultiHostEndpoints` in
 *     `source-dsn-gates.ts`) — the
 *     backup-side mirror of the restore guard's assessable-host charset
 *     (`CONNINFO_HOST_PATTERN` in `restore-guard-url.ts`, which excludes the
 *     comma). libpq accepts comma-separated host LISTS in the URI authority
 *     and in query `host=`/`hostaddr=` values and percent-decodes the host
 *     before the list is split, so the dump no longer has one endpoint while
 *     every URL-derived label renders only the first authority host
 *     (live-proven R16 shape: `postgresql://postgres@127.0.0.1,8.8.8.8:5432/db`
 *     completed a real backup via libpq failover while the manifest labeled
 *     only `127.0.0.1` — and restore refuses the identical shape). A
 *     bracketed IPv6 host (`[::1]`) names one host and does not trip.
 *  4. Endpoint-override query gate (`rawDsnQueryHasEndpointOverride` in
 *     `source-dsn-gates.ts`)
 *     — the backup-side completion of the restore guard's query channels
 *     (restore targets have assessed `?host=`/`?hostaddr=` since R2; the
 *     backup source DSN had no equivalent gate). libpq applies URI query
 *     parameters ON TOP of the parsed authority, so `?host=`/`?hostaddr=`/
 *     `?port=` name the endpoint pg_dump actually connects to while every
 *     URL-derived label (the redacted provenance line, the manifest's
 *     authority view among them) renders the DSN authority — live-proven:
 *     a `?host=…&port=…` source backed up with the authority label naming
 *     a dead endpoint, and `?hostaddr=8.8.8.8` would ship the dump
 *     off-box entirely. The `service` key is the same indirection one
 *     step removed — libpq resolves it through the connection-service file
 *     (`~/.pg_service.conf` / `PGSERVICEFILE`), whose entries decide the
 *     endpoint nothing in the URL view sees (live-proven:
 *     `…@127.0.0.1/db?service=x` with a redirected service file made psql
 *     connect on port 5999) — and gets its own "service indirection"
 *     message. The authority is the only supported endpoint channel; plain
 *     query parameters (`dbname`, `sslmode`, `application_name`, …) are
 *     untouched.
 *  5. Unnamed-database gate — the backup-side mirror of the restore
 *     guard's target-naming rule (R5: a target whose database is
 *     under-specified refuses). A db-less source DSN (no path database, no
 *     `?dbname=` query) AND an explicitly EMPTY `?dbname=` value are the
 *     same under-specified endpoint: libpq completes an empty dbname from
 *     the USER name (never from the path; live-proven: the dump header
 *     said `dbname: postgres` while a path-fallback label said the path
 *     database), so the dump's provenance is unverifiable and the manifest
 *     would mislabel it with the `(default)` marker.
 */
export function backupSourceDsnRefusal(trimmedDsn: string, dsnUrl: URL): string | null {
  if (rawDsnHasAmbiguousAuthority(trimmedDsn)) {
    return "source DSN contains an unassessable character sequence — percent-encode special characters";
  }
  if (rawDsnPathHasDotSegments(trimmedDsn)) {
    return "source DSN path contains dot-segments — use the literal database name";
  }
  if (rawDsnHasMultiHostEndpoints(trimmedDsn)) {
    return "source DSN multi-host endpoints are not supported — name a single host in the authority";
  }
  if (rawDsnQueryHasEndpointOverride(trimmedDsn)) {
    // The service key is endpoint indirection through the connection-service
    // file, so it gets its own remediation message before the generic
    // host/port one (a query carrying both keys reports the service shape).
    return rawDsnQueryHasServiceIndirection(trimmedDsn)
      ? "source DSN service indirection is not supported — name the endpoint in the DSN authority"
      : "source DSN endpoint override in query string is not supported — put host/port in the DSN authority";
  }
  if (effectiveDatabaseName(dsnUrl).length === 0) {
    return "source database name is unspecified — name the database explicitly";
  }
  return null;
}

/**
 * Resolves an operator-supplied `--env` value against the process cwd.
 *
 * `applyEnvFile` joins its fileName argument onto a root directory (default
 * cwd), so an ABSOLUTE `--env` path passed through that join would be
 * re-rooted under cwd and silently miss the file. The value is resolved
 * here — absolute values as-is, relative values against cwd — and split
 * back into (rootDir, fileName) for `applyEnvFile(fileName, rootDir)`.
 */
export function resolveEnvFilePath(value: string): { fileName: string; rootDir: string } {
  const resolved = resolve(process.cwd(), value);
  return { fileName: basename(resolved), rootDir: dirname(resolved) };
}

/**
 * Renders a Postgres DSN in a credential-free form: `dbName@host(redacted-user)`.
 *
 * - The username and password are never echoed; a DSN carrying either is
 *   marked `(redacted-user)`, one without userinfo is marked `(no-user)`.
 * - The port is kept (not a credential); query parameters are dropped.
 * - The rendered database name is the EFFECTIVE database
 *   ({@link effectiveDatabaseName}): a query `dbname=` parameter is libpq's
 *   override channel and wins over the path component, matching what the
 *   backup family actually connects to (an explicitly empty `dbname=`
 *   names nothing and renders host-only — the bootstrap refuses it).
 * - A DSN without a database name renders as `host(...)`.
 * - Empty, malformed, or non-Postgres values render as `redacted-dsn`.
 */
export function redactDsn(dsn: string | undefined): string {
  if (!dsn?.trim()) {
    return REDACTED_DSN;
  }

  let url: URL;
  try {
    url = new URL(dsn.trim());
  } catch {
    return REDACTED_DSN;
  }

  if (!POSTGRES_PROTOCOLS.has(url.protocol) || !url.hostname) {
    return REDACTED_DSN;
  }

  const dbName = effectiveDatabaseName(url);
  const host = url.port ? `${url.hostname}:${url.port}` : url.hostname;
  const userMarker = url.username || url.password ? "redacted-user" : "no-user";
  const target = dbName ? `${dbName}@${host}` : host;
  return `${target}(${userMarker})`;
}

/** Single-character classes for the embedded-userinfo sweep (no quantifiers, so no backtracking). */
const SCHEME_HEAD = /[A-Za-z]/;
const SCHEME_CHAR = /[A-Za-z0-9+.-]/;
const USERINFO_BOUNDARY = /[\s@/]/;

function isSchemeToken(text: string): boolean {
  if (text.length === 0 || !SCHEME_HEAD.test(text[0] ?? "")) {
    return false;
  }
  for (const char of text) {
    if (!SCHEME_CHAR.test(char)) {
      return false;
    }
  }
  return true;
}

/**
 * Replaces every `scheme://userinfo@` occurrence with `scheme://***:***@`.
 * A linear scan anchored on `://` instead of a quantified regex, so hostile
 * tool output can never trigger super-linear redaction cost.
 */
function redactEmbeddedUserinfo(text: string): string {
  let redacted = "";
  let cursor = 0;
  for (;;) {
    const schemeEnd = text.indexOf("://", cursor);
    if (schemeEnd < 0) {
      return `${redacted}${text.slice(cursor)}`;
    }
    let schemeStart = schemeEnd;
    while (schemeStart > cursor && SCHEME_CHAR.test(text[schemeStart - 1] ?? "")) {
      schemeStart -= 1;
    }
    let userInfoEnd = schemeEnd + 3;
    while (userInfoEnd < text.length && !USERINFO_BOUNDARY.test(text[userInfoEnd] ?? "")) {
      userInfoEnd += 1;
    }
    const hasUserinfo = userInfoEnd < text.length && text[userInfoEnd] === "@" && userInfoEnd > schemeEnd + 3;
    if (hasUserinfo && isSchemeToken(text.slice(schemeStart, schemeEnd))) {
      redacted += `${text.slice(cursor, schemeEnd + 3)}***:***@`;
      cursor = userInfoEnd + 1;
      continue;
    }
    cursor = schemeEnd + 3;
  }
}

/**
 * Strips credential material from tool output before it is printed.
 *
 * In order: the exact DSN string is replaced by its redacted rendering, the
 * decoded username and password substrings are replaced by `***` (an empty
 * credential is skipped — a blanket replace of "" would corrupt the text),
 * and finally a generic `scheme://userinfo@` sweep (userinfo rendered as
 * `***:***`) catches partial echoes from error messages produced by external
 * tools.
 */
export function scrubDsnSecrets(text: string, dsn?: string): string {
  let scrubbed = text;

  if (dsn) {
    scrubbed = scrubbed.split(dsn).join(redactDsn(dsn));
    try {
      const url = new URL(dsn.trim());
      if (POSTGRES_PROTOCOLS.has(url.protocol)) {
        const password = decodeUrlSegment(url.password);
        if (password.length > 0) {
          scrubbed = scrubbed.split(password).join("***");
        }
        const username = decodeUrlSegment(url.username);
        if (username.length > 0) {
          scrubbed = scrubbed.split(username).join("***");
        }
      }
    } catch {
      // Not a parseable URL — the generic sweep below still applies.
    }
  }

  return redactEmbeddedUserinfo(scrubbed);
}
