/**
 * Safety gate for the restore-verify tool.
 *
 * The restore DESTROYS and recreates public objects in the target database
 * (`pg_restore --clean --if-exists`), so the exact connection string handed
 * to pg_restore must pass the repo's destructive-database guard, and the
 * operator must have confirmed the run with `--yes-i-understand`.
 *
 * Target normalization (this module ONLY — the shared guard lib is never
 * modified): the destructive-db guard analyzes host signals from a
 * `postgresql://` URL, but operators may pass PostgreSQL keyword/value
 * conninfo strings (`host=x.rds.amazonaws.com dbname=y`). Before assessment
 * the target is normalized:
 *
 *   - a `postgresql://`/`postgres://` URL is assessed via its LIBPQ-EFFECTIVE
 *     host: libpq percent-decodes the host component of a connection URI,
 *     while WHATWG URL parsers do NOT decode the host of non-special schemes
 *     — so `postgresql://prod.rds.amazonaws.co%6d/db` parses with the ENCODED
 *     host and would slip past marker analysis while libpq connects to the
 *     decoded managed host. Each `.`-separated host label carrying a `%` is
 *     therefore percent-decoded (a malformed escape is UNASSESSABLE and
 *     refuses the run) and ALL trailing dots are stripped (`prod.rds…com.`
 *     is DNS-equal to `prod.rds…com` but invisible to suffix markers); the
 *     guard assesses the decoded, dot-stripped host;
 *   - a key=value conninfo string has its `host`/`hostaddr`/`dbname`
 *     keywords extracted with libpq LAST-OCCURRENCE semantics (libpq applies
 *     repeated keywords in order, so `host=a host=b` connects to `b`) and
 *     synthesized into `postgresql://<host>/<db>` URL(s) for the guard's
 *     HOST-SIGNAL analysis only; every synthesized URL is round-tripped
 *     through `new URL()` — a value that cannot form a valid URL (malformed
 *     host characters) refuses the run, because the downstream guard silently
 *     SKIPS its host analysis on unparseable URLs. Trailing dots are stripped
 *     from conninfo host values too, for the same suffix-marker reason;
 *   - a conninfo `hostaddr` must name a LOOPBACK address (127.0.0.0/8, ::1):
 *     hostaddr is the endpoint libpq actually CONNECTS to (host is
 *     verification-only), so a remote numeric endpoint has no assessable
 *     host signal and refuses the run — the same rule the URI query
 *     `hostaddr` channel enforces; a conninfo with `hostaddr` but NO `host`
 *     is refused outright — a bare-IP target with no assessable host signal
 *     cannot be reasoned about (URL-form DSNs with IP hosts remain the
 *     supported drill path);
 *   - a `service=` parameter — in a URI query or as a conninfo keyword — is
 *     libpq SERVICE INDIRECTION: the named service file would decide the
 *     endpoint, so any target naming a service is unassessable and refuses
 *     the run;
 *   - the target's DATABASE component must be explicit: a URI whose path
 *     database is empty or absent, and a conninfo with no `dbname=` keyword,
 *     refuse the run — with an under-specified DSN libpq completes the
 *     endpoint from the ambient environment (PGDATABASE), so pg_restore
 *     would silently land in an operator-unintended database. A URI query
 *     `?dbname=` parameter IS the explicit database (libpq applies query
 *     parameters on top of the parsed URI): it is honored when the path is
 *     empty, and when the path AND query both name a database they must
 *     AGREE — the libpq URI families disagree on which component wins, so a
 *     disagreement refuses the run as target-database ambiguity;
 *   - the RAW AUTHORITY SPAN of a URI-form target (after `//`, up to the
 *     first `/` of the raw string — or, on a pathless URI, up to the first
 *     `?`, which is there the query delimiter both libpq and WHATWG agree
 *     on) must be clean: on a pathed URI libpq scans the authority to that
 *     first `/` and splits userinfo at the last `@` inside the span, while
 *     the WHATWG parser ends the authority at the first `?`/`#` —
 *     `postgresql://postgres:?@prod.example.com/db` parses with host
 *     `postgres` under WHATWG but libpq connects to `prod.example.com`. A
 *     raw `?`/`#`/control character in the span, or a userinfo that
 *     percent-decodes into an `@`/`/` (libpq decodes userinfo before use),
 *     is unassessable and refuses the run before any URL parsing (fail
 *     closed: no RFC-legal URL puts raw `?`/`#` in the authority); a
 *     pathless query (`postgresql://localhost:5432?sslmode=disable`) is the
 *     one agreed form and flows to the normal query-channel assessment;
 *   - the RAW PATH of a URI-form target (first `/` of the raw string to the
 *     first `?`) must carry no raw `#`: libpq has no fragment delimiter and
 *     reads THROUGH it — `…/db#x` would restore into the literal `db#x`
 *     database while URL parsers (and every label derived from the truncated
 *     path) end the path at the `#` — so such a target is unassessable and
 *     refuses the run before any URL parsing (fail closed, the authority-span
 *     gate's path mirror). Dot-segment paths (`.`/`..`) refuse the same way
 *     (WHATWG normalizes them, libpq restores literally); percent-encoded
 *     forms (`%2e`, `%23`) are assessed by their DECODED value — libpq
 *     percent-decodes the path database before use;
 *   - when `hostaddr` is present alongside `host`, BOTH values are assessed
 *     (libpq connects to `hostaddr` while using `host` for verification), so
 *     token order can never hide one of the two host signals;
 *   - a `postgresql://`/`postgres://` URL's QUERY STRING is a second host
 *     channel: libpq applies `?host=`/`?hostaddr=` query parameters ON TOP of
 *     the authority (overriding the connection target), so the guard parses
 *     the RAW query string, percent-decodes names and values the way libpq
 *     does (`+` stays literal, a malformed escape refuses, last occurrence
 *     wins) and assesses EVERY channel — the authority hostname, the query
 *     `host`, and the query `hostaddr` — through the SAME pipeline (charset
 *     gate, trailing-dot strip, percent-decode re-assessment, `new URL()`
 *     round-trip, managed-marker matching). An EMPTY query `host` (libpq
 *     would fall back to the default socket), a query `hostaddr` naming a
 *     non-loopback address (hostaddr is the endpoint libpq actually connects
 *     to — a remote numeric endpoint has no assessable host signal), or any
 *     other unassessable channel refuses the run; a query host decoding to a
 *     plain local hostname/IP keeps drills working;
 *   - the WHATWG URL parser strips raw tab/newline characters from URLs
 *     while libpq does not, so a URI-form target whose RAW host substring
 *     (or raw query string) carries a raw \t/\n/\r — or whose query carries
 *     a fragment delimiter libpq would fold into a parameter value — refuses
 *     before any URL parsing (fail closed: the assessed URL must be the URL
 *     libpq sees);
 *   - anything else is UNASSESSABLE and refuses the run (fail closed) —
 *     a target whose safety cannot be reasoned about is never restored to.
 *
 * TOCTOU note: the target DSN is parsed ONCE on the CLI, held in a single
 * variable, threaded through this assessment, and later passed UNCHANGED to
 * pg_restore — the assessed string and the executed string are the same
 * object; the synthesized URL exists only inside the guard analysis, and
 * there is no re-parse between gate and spawn.
 */

import { assessDestructiveDbCommandSafety, formatDestructiveDbBlockMessage } from "@/scripts/lib/destructiveDbGuard";
import { assessUriDatabaseComponent } from "@/scripts/ops/_shared";
import { RestoreUsageError } from "@/scripts/ops/restore-cli";
import {
  assessRawUriAuthority,
  assessRawUriPath,
  CONNINFO_HOST_PATTERN,
  isLoopbackHostaddr,
  libpqEffectiveAssessUrl,
  parsesAsPostgresUrl,
  rawUriHostSubstring,
  stripTrailingDots,
  toUrlHostToken,
  uriQueryChannelAssessUrls,
} from "@/scripts/ops/restore-guard-url";

/** Assessment result for the restore target. */
export interface RestoreGuardAssessment {
  blocked: boolean;
  reasons: string[];
}

/** Confirmation flag required on every (non-interactive) restore run. */
export const CONFIRMATION_FLAG = "--yes-i-understand";

const UNASSESSABLE_REASON =
  "target is not a postgresql:// URL and not an assessable host=<host> [dbname=<db>] conninfo string — " +
  "cannot assess target safety";

const CONNINFO_DBNAME_KEY = "dbname";
/** libpq service indirection keyword — the endpoint is decided by a service file. */
const SERVICE_CONNINFO_KEY = "service";

/** Refusal for any target that names a libpq service (URI query or conninfo). */
const SERVICE_INDIRECTION_REFUSAL =
  "target carries a service= parameter — service indirection is unassessable (the service file decides the " +
  "connection endpoint) — cannot assess target safety";

/** Refusal for any target that does not name its database explicitly. */
const UNSPECIFIED_DATABASE_REFUSAL =
  "target database is unspecified — the connection string names no database, so ambient libpq environment " +
  "(PGDATABASE) would decide the restore target — the operator must name the target database explicitly — " +
  "cannot assess target safety";

/** Refusal for a URI whose path database and query `dbname=` disagree. */
const AMBIGUOUS_DATABASE_REFUSAL =
  "target database ambiguity between path and query — the URI path and the query dbname= parameter name " +
  "different databases (the libpq URI families disagree on which one wins) — the operator must name the " +
  "target database in one place only — cannot assess target safety";

/**
 * Splits a keyword/value conninfo string into unquoted tokens (libpq rules:
 * whitespace-separated, single quotes quote literally with `''` escapes).
 * Returns null for strings that cannot be tokenized (unterminated quote).
 */
function tokenizeConninfo(target: string): string[] | null {
  const tokens: string[] = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < target.length; index += 1) {
    const char = target[index];
    if (quoted) {
      if (char === "'") {
        if (target[index + 1] === "'") {
          current += "'";
          index += 1;
        } else {
          quoted = false;
        }
        continue;
      }
      current += char;
      continue;
    }
    if (char === "'") {
      quoted = true;
      continue;
    }
    if (/\s/.test(char ?? " ")) {
      if (current.length > 0) {
        tokens.push(current);
        current = "";
      }
      continue;
    }
    current += char;
  }
  if (quoted) {
    return null;
  }
  if (current.length > 0) {
    tokens.push(current);
  }
  return tokens;
}

/**
 * The host-signal keywords extracted from a conninfo target. libpq applies
 * repeated keywords LAST-WINS (`host=a host=b` connects to `b`), so the
 * extraction below overwrites on every repeat exactly as libpq does — the
 * assessed host is always the host libpq would actually use. A `service=`
 * keyword is libpq SERVICE INDIRECTION (the named service file — not this
 * target string — would decide the endpoint), so it is extracted as a
 * refusal instead of a signal.
 */
interface ConninfoSignal {
  host: string | undefined;
  hostaddr: string | undefined;
  dbname: string | undefined;
}

type ConninfoSignalExtraction = { kind: "ok"; signal: ConninfoSignal } | { kind: "service" } | { kind: "none" };

function extractConninfoSignal(target: string): ConninfoSignalExtraction {
  const tokens = tokenizeConninfo(target);
  if (tokens === null || tokens.length === 0) {
    return { kind: "none" };
  }

  const signal: ConninfoSignal = { host: undefined, hostaddr: undefined, dbname: undefined };
  for (const token of tokens) {
    const equals = token.indexOf("=");
    if (equals <= 0) {
      return { kind: "none" };
    }
    const key = token.slice(0, equals).toLowerCase();
    const value = token.slice(equals + 1);
    if (value.length === 0) {
      return { kind: "none" };
    }
    if (key === SERVICE_CONNINFO_KEY) {
      return { kind: "service" };
    }
    if (key === "host") {
      signal.host = value;
    } else if (key === "hostaddr") {
      signal.hostaddr = value;
    } else if (key === CONNINFO_DBNAME_KEY) {
      signal.dbname = value;
    }
  }
  if (signal.host === undefined && signal.hostaddr === undefined) {
    return { kind: "none" };
  }
  return { kind: "ok", signal };
}

/** Result of extracting the assessable host URL(s) from a conninfo target. */
export type ConninfoAssessUrls = { kind: "ok"; urls: string[] } | { kind: "refuse"; reason: string };

/**
 * Extracts the host-signal keywords from a keyword/value conninfo string and
 * synthesizes the `postgresql://<host>/<dbname>` URL(s) the guard can analyze.
 *
 * Returns null when the string is not a conninfo string or carries no
 * assessable host keyword, `{ kind: "refuse" }` when the target cannot be
 * assessed — a `service=` keyword (libpq service indirection), `hostaddr`
 * naming a non-loopback address (hostaddr is the endpoint libpq actually
 * connects to; a remote numeric endpoint has no host signal), `hostaddr`
 * without a `host` (a bare-IP target with no host signal), a missing
 * `dbname=` keyword (the ambient environment would complete the endpoint),
 * a host value outside the assessable charset, or a value that cannot round-trip through
 * `new URL()` (the downstream guard SKIPS its host analysis on unparseable
 * URLs, so an unparseable synthesis must refuse rather than assess as "no
 * signal") — and `{ kind: "ok" }` with ONE URL PER host value otherwise:
 * `host` and `hostaddr` are independent libpq signals (hostaddr names the
 * address actually connected; host is used for verification), so both are
 * assessed regardless of token order.
 */
export function conninfoAssessUrls(target: string): ConninfoAssessUrls | null {
  const extraction = extractConninfoSignal(target);
  if (extraction.kind === "none") {
    return null;
  }
  // libpq service indirection: the named service file — not this target
  // string — would decide the endpoint, so any target naming a service is
  // unassessable and refuses (fail closed).
  if (extraction.kind === "service") {
    return { kind: "refuse", reason: SERVICE_INDIRECTION_REFUSAL };
  }
  const signal = extraction.signal;

  // A conninfo with `hostaddr` but no `host` names a bare IP with no
  // assessable host signal — refused outright (fail closed). URL-form DSNs
  // with IP hosts are the supported drill path and are unaffected.
  if (signal.host === undefined) {
    return {
      kind: "refuse",
      reason:
        "target conninfo carries hostaddr without a host keyword — bare-IP targets are unassessable — cannot assess target safety",
    };
  }

  // The database component must be explicit: without `dbname=` libpq
  // completes the endpoint from the ambient environment (PGDATABASE) and
  // pg_restore would land in an operator-unintended database — refuse
  // (fail closed); the operator must name the target database.
  if (signal.dbname === undefined) {
    return { kind: "refuse", reason: UNSPECIFIED_DATABASE_REFUSAL };
  }

  // `dbname` is narrowed to a string by the refusal above; the suffix always
  // carries it (encodeURIComponent keeps the synthesized URL well-formed).
  const suffix = `/${encodeURIComponent(signal.dbname)}`;
  const urls: string[] = [];
  for (const [channel, rawHostValue] of [
    ["host", signal.host],
    ["hostaddr", signal.hostaddr],
  ] as const) {
    if (rawHostValue === undefined) {
      continue;
    }
    // hostaddr IS the endpoint libpq connects to (host is verification-only
    // and libpq validates the pair against each other), so a conninfo
    // hostaddr must name a LOOPBACK address — the same rule the URI query
    // hostaddr channel enforces. A remote numeric endpoint has no assessable
    // host signal and refuses the run (fail closed).
    if (channel === "hostaddr" && !isLoopbackHostaddr(rawHostValue)) {
      return {
        kind: "refuse",
        reason:
          "target conninfo hostaddr names a non-loopback address — the connection endpoint has no assessable host signal — cannot assess target safety",
      };
    }
    // Trailing dots are DNS-invisible but suffix-marker-invisible too; strip
    // them so `host=prod.rds.amazonaws.com.` assesses as the managed host.
    const hostValue = stripTrailingDots(rawHostValue);
    if (hostValue.length === 0 || !CONNINFO_HOST_PATTERN.test(hostValue)) {
      return {
        kind: "refuse",
        reason:
          "target conninfo carries a host value outside the assessable host character set — " +
          "cannot assess target safety",
      };
    }
    const url = `postgresql://${toUrlHostToken(hostValue)}${suffix}`;
    // Round-trip gate: the downstream guard SKIPS its host analysis when the
    // seated DATABASE_URL does not parse, so a synthesis that cannot
    // round-trip through `new URL()` must refuse here instead of assessing
    // as "no host signal".
    if (!parsesAsPostgresUrl(url)) {
      return {
        kind: "refuse",
        reason:
          "target conninfo host value does not form a valid postgresql:// URL (malformed host value) — " +
          "cannot assess target safety",
      };
    }
    urls.push(url);
  }
  return { kind: "ok", urls };
}

/**
 * Assesses the restore target through the existing destructive-database
 * guard, normalizing keyword/value conninfo targets first (see module doc).
 *
 * A conninfo target synthesizes ONE guard URL PER host-signal value (`host`
 * and `hostaddr`), and every URL must pass: the first blocking assessment
 * wins. A URI-form target is assessed via its libpq-effective host
 * (percent-decoded, trailing dots stripped) so the analyzed host is always
 * the host libpq would actually connect to — and its query string adds one
 * channel per `?host=`/`?hostaddr=` parameter (libpq applies query
 * parameters on top of the authority), each assessed through the same
 * pipeline; the query's `dbname=` parameter feeds the database-component
 * rule (a path/query dbname disagreement refuses fail-closed — a query-only
 * `dbname=` is the explicit, recorded target database); a raw control
 * character in the raw host substring or query (WHATWG strips what libpq
 * keeps) refuses before parsing.
 *
 * The guard reads `DATABASE_URL` from the process environment for its
 * host-pattern analysis. Rather than duplicating the guard's managed-host and
 * production-marker pattern sets, each (normalized) URL is temporarily seated
 * in `DATABASE_URL` for the duration of its call (previous value restored in
 * a `finally`), so the guard evaluates the host of THE connection string
 * pg_restore will receive — plus the ambient env signals (NODE_ENV,
 * providers) loaded from the operator's env file. An unassessable or
 * ambiguous target refuses the run.
 */
export function assessRestoreTargetSafety(targetDsn: string): RestoreGuardAssessment {
  let assessUrls: string[];
  let uriDatabaseUnspecified = false;
  let uriDatabaseAmbiguous = false;
  if (parsesAsPostgresUrl(targetDsn)) {
    const trimmed = targetDsn.trim();
    // RAW AUTHORITY-SPAN gate FIRST: on a pathed URI libpq scans the
    // authority to the first `/` of the raw string and splits userinfo at the
    // last `@` inside that span, while the WHATWG parser ends the authority
    // at the first `?`/`#` — `postgresql://postgres:?@prod.example.com/db`
    // parses with host `postgres` under WHATWG but libpq connects to
    // `prod.example.com`. On a PATHLESS URI the first `?` is the query
    // delimiter both parsers agree on, so the span ends there and the query
    // is assessed below. A raw `?`/`#`/control character in the span (or a
    // userinfo that percent-decodes into an `@`/`/`) makes the authority
    // unassessable and refuses before any URL parsing (fail closed).
    const authority = assessRawUriAuthority(trimmed);
    if (authority.kind === "refuse") {
      return { blocked: true, reasons: [authority.reason] };
    }
    // RAW PATH gate (the authority gate's path mirror): libpq has no
    // fragment delimiter and reads THROUGH a raw `#` — it would restore
    // into the literal `db#x` database — while every WHATWG-derived view
    // (pathname, and the raw-path substring the database rule below uses)
    // ends the path at the `#`. A raw `#` in the path span is unassessable
    // and refuses before any URL parsing (fail closed); a percent-encoded
    // `%23` is assessed by its decoded value (libpq decodes the path db).
    const rawPath = assessRawUriPath(trimmed);
    if (rawPath.kind === "refuse") {
      return { blocked: true, reasons: [rawPath.reason] };
    }
    // WHATWG strips raw tab/newline from URL hosts but libpq does not: a raw
    // control character in the raw host substring means the host about to be
    // parsed is not the host libpq connects to — refuse before parsing.
    if (/[\t\n\r]/.test(rawUriHostSubstring(trimmed))) {
      return {
        blocked: true,
        reasons: [
          "target URL raw host carries a control character (tab/newline) that the URL parser strips but libpq does not — cannot assess target safety",
        ],
      };
    }
    // libpq applies URI query parameters on top of the authority, so the
    // query's host/hostaddr are additional connection channels; EVERY
    // channel below is assessed through the same normalization pipeline.
    const queryChannels = uriQueryChannelAssessUrls(trimmed);
    if (queryChannels.kind === "refuse") {
      return { blocked: true, reasons: [queryChannels.reason] };
    }
    // URI form: assess the libpq-effective host (percent-decoded labels,
    // trailing dots stripped), never the raw encoded form — libpq decodes
    // before connecting, so marker analysis must see the decoded host.
    const parsedTarget = new URL(trimmed);
    const effective = libpqEffectiveAssessUrl(parsedTarget);
    if (effective.kind === "refuse") {
      return { blocked: true, reasons: [effective.reason] };
    }
    assessUrls = [effective.url, ...queryChannels.urls];
    // DB-component flags — evaluated AFTER the channel/host guard loop below,
    // so a smuggled query host keeps its precise refusal reason. The path
    // database is derived from the RAW path substring (libpq's literal view):
    // WHATWG's pathname normalizes `.`/`..` dot-segments, so a dot-segment
    // path would rename the restore target behind the assessment — such a
    // path refuses fail-closed. A URI with an empty or absent path database
    // is under-specified (libpq would complete the endpoint from the ambient
    // environment) UNLESS the query carries an explicit `dbname=` value —
    // libpq applies query parameters ON TOP of the parsed URI, so a query
    // dbname IS the target database. When the path AND the query both name a
    // database they must AGREE: the libpq URI families disagree on which
    // component wins, so a disagreement is an ambiguity no assessment can
    // resolve (fail closed).
    const databaseComponent = assessUriDatabaseComponent(trimmed, queryChannels.dbname);
    if (databaseComponent.kind === "refuse") {
      return { blocked: true, reasons: [databaseComponent.reason] };
    }
    uriDatabaseUnspecified = databaseComponent.unspecified;
    uriDatabaseAmbiguous = databaseComponent.ambiguous;
  } else {
    const extraction = conninfoAssessUrls(targetDsn);
    if (extraction === null) {
      return { blocked: true, reasons: [UNASSESSABLE_REASON] };
    }
    if (extraction.kind === "refuse") {
      return { blocked: true, reasons: [extraction.reason] };
    }
    assessUrls = extraction.urls;
  }

  for (const assessAs of assessUrls) {
    const assessment = assessUrlThroughGuard(assessAs);
    if (assessment.blocked) {
      return assessment;
    }
  }
  if (uriDatabaseAmbiguous) {
    return { blocked: true, reasons: [AMBIGUOUS_DATABASE_REFUSAL] };
  }
  if (uriDatabaseUnspecified) {
    return { blocked: true, reasons: [UNSPECIFIED_DATABASE_REFUSAL] };
  }
  return { blocked: false, reasons: [] };
}

/** Runs the shared guard with `assessAs` seated in DATABASE_URL (restored in `finally`). */
function assessUrlThroughGuard(assessAs: string): RestoreGuardAssessment {
  const previousDatabaseUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL = assessAs;
  try {
    const assessment = assessDestructiveDbCommandSafety();
    return { blocked: assessment.blocked, reasons: assessment.reasons };
  } finally {
    if (previousDatabaseUrl === undefined) {
      delete process.env.DATABASE_URL;
    } else {
      process.env.DATABASE_URL = previousDatabaseUrl;
    }
  }
}

/** Formats a guard refusal for stderr (tagged, multi-line, no credentials). */
export function formatRestoreGuardBlockMessage(assessment: RestoreGuardAssessment): string {
  return `[guard] ${formatDestructiveDbBlockMessage(assessment.reasons)}`;
}

/**
 * Enforces the non-TTY confirmation gate: the restore is destructive and ops
 * tooling runs unattended, so a bare TTY prompt is not trusted — the flag
 * must be present on every invocation, even when the guard passes.
 */
export function assertRestoreConfirmation(confirmed: boolean): void {
  if (!confirmed) {
    throw new RestoreUsageError(
      `refusing to restore without explicit confirmation: pass ${CONFIRMATION_FLAG} to acknowledge ` +
        "that the target database objects will be dropped and recreated"
    );
  }
}
