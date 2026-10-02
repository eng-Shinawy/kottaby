/**
 * Pure URL/host normalization pipeline for the restore guard
 * (`restore-guard.ts`).
 *
 * Extracted from the guard to honor the repo's `max-lines` budget
 * (configured in oxlint.config.mts); behavior is verbatim,
 * moved not copied. Everything here is a pure string/URL function — no env
 * access, no I/O — so the guard stays the only module that seats targets in
 * `DATABASE_URL` and runs the destructive-db assessment.
 *
 * Two concerns live here:
 *
 *  1. The LIBPQ-EFFECTIVE host pipeline: libpq percent-decodes the host of a
 *     connection URI and treats trailing dots as DNS-equal, while the WHATWG
 *     URL parser keeps non-special-scheme hosts opaque — the guard must
 *     analyze the host libpq would actually connect to, so hosts are
 *     percent-decoded, trailing-dot-stripped, charset-gated and round-tripped
 *     through `new URL()` before marker matching.
 *
 *  2. The URI QUERY-STRING host channels: libpq applies `?host=`/`?hostaddr=`
 *     parameters ON TOP of the authority (overriding the connection target),
 *     so the raw query string is parsed with libpq semantics (percent-decoded
 *     names and values, `+` literal, last occurrence wins, malformed escape
 *     refuses) and one assess URL per channel is produced for the caller to
 *     run through the same pipeline. Raw control characters and `#` in the
 *     query (and in the raw host substring) refuse before any URL parsing —
 *     the WHATWG parser strips what libpq keeps, so the assessed URL must be
 *     the URL libpq sees. The query's `dbname` parameter is extracted with
 *     the same semantics — the database-override channel the guard's
 *     database-component rule consumes (that rule and the shared URL/segment
 *     utilities it rests on live in `_shared.ts`).
 *
 *  3. The RAW AUTHORITY-SPAN gate: on a PATHED URI libpq scans the authority
 *     to the FIRST `/` of the raw string and splits userinfo at the LAST `@`
 *     inside that span, while the WHATWG parser ends the authority at the
 *     first `?`/`#` — `postgresql://postgres:?@prod.example.com/db` parses
 *     with host `postgres` under WHATWG but libpq connects to
 *     `prod.example.com`. On a PATHLESS URI, though, the first `?` IS the
 *     query delimiter in both parsers (`postgresql://localhost:5432?sslmode=disable`),
 *     so the span ends there and the query flows to the normal query-channel
 *     assessment. A raw `?`/`#`/control character inside the span proper, or
 *     a userinfo that percent-decodes into an `@`/`/`, is unassessable and
 *     refuses the run before any URL parsing (fail closed). Its PATH mirror
 *     ({@link assessRawUriPath}) refuses a raw `#` in the raw path span:
 *     libpq has no fragment delimiter and reads THROUGH it, so the database
 *     libpq names is not the path any URL-derived view sees.
 */

import { POSTGRES_PROTOCOLS } from "@/scripts/ops/_shared";

/**
 * The charset a host VALUE may carry to be assessable. Anything outside it
 * (a `/` unix-socket directory, a `%` reshaping the synthesized URL, …) is
 * unassessable and refuses the run (fail closed).
 */
export const CONNINFO_HOST_PATTERN = /^[A-Za-z0-9._\-[\]:]+$/;

/** Result of libpq-style percent-decoding of a URI host. */
export type DecodedHost = { kind: "ok"; decoded: string } | { kind: "refuse"; reason: string };

/** Brackets a bare IPv6-ish host token so it survives the URL round-trip. */
export function toUrlHostToken(host: string): string {
  return host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
}

/**
 * Strips ALL trailing dots from a hostname. DNS treats `host.example.` and
 * `host.example` as the same name, but the managed/production marker
 * patterns are suffix-anchored — the dot would hide the marker while libpq
 * still connects to the managed host. Applied to URL hosts and conninfo
 * host values alike, before marker matching.
 */
export function stripTrailingDots(host: string): string {
  let end = host.length;
  while (end > 0 && host.charCodeAt(end - 1) === 46) {
    end -= 1;
  }
  return host.slice(0, end);
}

/**
 * Percent-decodes a URI host the way libpq does, label by label. libpq
 * percent-decodes the host of a connection URI before connecting, so an
 * encoded label (`…co%6d`) must be assessed in its DECODED form; the WHATWG
 * URL parser keeps non-special-scheme hosts opaque, which is exactly the gap
 * a marker-dodging DSN exploits. A malformed escape (`%ZZ`) means the host
 * cannot be reasoned about and refuses the run (fail closed).
 */
function decodePercentEncodedHost(host: string): DecodedHost {
  if (!host.includes("%")) {
    return { kind: "ok", decoded: host };
  }
  try {
    const decoded = host
      .split(".")
      .map(label => (label.includes("%") ? decodeURIComponent(label) : label))
      .join(".");
    return { kind: "ok", decoded };
  } catch {
    return {
      kind: "refuse",
      reason: "target URL host carries a malformed percent-escape — cannot assess target safety",
    };
  }
}

/**
 * Derives the LIBPQ-EFFECTIVE host of a URI-form target: percent-decode each
 * label carrying an escape, then strip trailing dots. The decoded host must
 * stay within the assessable charset and form a parseable postgres URL —
 * anything else is unassessable and refuses the run, because the downstream
 * guard would otherwise analyze (or skip) a host libpq never connects to.
 */
export function libpqEffectiveAssessUrl(url: URL): { kind: "ok"; url: string } | { kind: "refuse"; reason: string } {
  const decoded = decodePercentEncodedHost(url.hostname);
  if (decoded.kind === "refuse") {
    return decoded;
  }
  const effectiveHost = stripTrailingDots(decoded.decoded);
  if (effectiveHost.length === 0 || !CONNINFO_HOST_PATTERN.test(effectiveHost)) {
    return {
      kind: "refuse",
      reason:
        "target URL host decodes to a value outside the assessable host character set — cannot assess target safety",
    };
  }
  const assessUrl = `postgresql://${toUrlHostToken(effectiveHost)}/`;
  if (!parsesAsPostgresUrl(assessUrl)) {
    return {
      kind: "refuse",
      reason:
        "target URL host does not form a valid postgresql:// URL (malformed host value) — cannot assess target safety",
    };
  }
  return { kind: "ok", url: assessUrl };
}

export function parsesAsPostgresUrl(target: string): boolean {
  try {
    const url = new URL(target.trim());
    return POSTGRES_PROTOCOLS.has(url.protocol) && url.hostname.length > 0;
  } catch {
    return false;
  }
}

/** Numeric IPv4 loopback (127.0.0.0/8) — the only IPv4 `hostaddr` a local drill may name. */
const LOOPBACK_IPV4_PATTERN = /^127(?:\.\d{1,3}){3}$/;

/**
 * True for the numeric loopback addresses (IPv4 127.0.0.0/8, IPv6 ::1).
 * libpq CONNECTS to `hostaddr` directly, so a non-loopback hostaddr makes
 * the socket endpoint a remote numeric address that no host marker can
 * reason about — such a channel is unassessable and the run refuses.
 */
export function isLoopbackHostaddr(value: string): boolean {
  const bare = value.startsWith("[") && value.endsWith("]") ? value.slice(1, -1) : value;
  return LOOPBACK_IPV4_PATTERN.test(bare) || bare === "::1";
}

/**
 * Percent-decodes one URI query name/value the way libpq does: `%XX` bytes
 * decode, `+` stays literal, and a malformed escape (`%ZZ`) makes the query
 * — and therefore the whole target — unassessable (libpq itself rejects the
 * URI). decodeURIComponent matches exactly these semantics for the values
 * libpq would accept as host tokens.
 */
function decodeUriQueryComponent(component: string): DecodedHost {
  if (!component.includes("%")) {
    return { kind: "ok", decoded: component };
  }
  try {
    return { kind: "ok", decoded: decodeURIComponent(component) };
  } catch {
    return {
      kind: "refuse",
      reason: "target URL query carries a malformed percent-escape — cannot assess target safety",
    };
  }
}

/** Result of extracting the libpq host channels from a URI query string. */
type UriQueryChannels =
  | { kind: "ok"; host: string | undefined; hostaddr: string | undefined; dbname: string | undefined; service: boolean }
  | { kind: "refuse"; reason: string };

/**
 * Extracts the libpq host channels from the RAW query string of a URI-form
 * target. libpq applies query parameters on top of the parsed authority —
 * `?host=`/`?hostaddr=` OVERRIDE the connection target — so both are
 * independent channels an authority-only assessment would miss. Names and
 * values are percent-decoded (libpq decodes both) with LAST-OCCURRENCE-WINS
 * semantics; names match case-insensitively (fail closed: whether libpq ends
 * up rejecting the odd casing as an unknown option or applying it, refusing
 * is never wrong), and a valueless `?host` counts as libpq's empty value.
 * A `service` key is tracked separately: it names a libpq service whose
 * service file — not this target string — would decide the endpoint:
 * indirection the guard cannot assess. A `dbname` key is extracted the same
 * way — the database libpq applies ON TOP of the URI path database — for the
 * caller's database-component rule.
 */
function extractUriQueryChannels(rawQuery: string): UriQueryChannels {
  let host: string | undefined;
  let hostaddr: string | undefined;
  let dbname: string | undefined;
  let service = false;
  for (const pair of rawQuery.split("&")) {
    if (pair.length === 0) {
      continue;
    }
    const equals = pair.indexOf("=");
    const decodedName = decodeUriQueryComponent(equals < 0 ? pair : pair.slice(0, equals));
    if (decodedName.kind === "refuse") {
      return decodedName;
    }
    const decodedValue = decodeUriQueryComponent(equals < 0 ? "" : pair.slice(equals + 1));
    if (decodedValue.kind === "refuse") {
      return decodedValue;
    }
    const key = decodedName.decoded.toLowerCase();
    if (key === "host") {
      host = decodedValue.decoded;
    } else if (key === "hostaddr") {
      hostaddr = decodedValue.decoded;
    } else if (key === "dbname") {
      dbname = decodedValue.decoded;
    } else if (key === "service") {
      service = true;
    }
  }
  return { kind: "ok", host, hostaddr, dbname, service };
}

/**
 * Assesses ONE URI query channel (`host` or `hostaddr` from the query
 * string) through the SAME pipeline as the authority host: charset gate,
 * trailing-dot strip, percent-decode re-assessment and `new URL()` round-trip
 * (inside {@link libpqEffectiveAssessUrl}), then managed-marker matching by
 * the caller. An EMPTY value is unassessable and refuses; a decoded value
 * outside the assessable host charset refuses (this also covers unix-socket
 * directory hosts, which carry `/`). A `hostaddr` channel must additionally
 * name a LOOPBACK address: hostaddr is the endpoint libpq actually connects
 * to, and a remote numeric endpoint has no assessable host signal.
 */
function assessQueryChannel(
  label: "host" | "hostaddr",
  value: string
): { kind: "ok"; url: string } | { kind: "refuse"; reason: string } {
  if (value.length === 0) {
    return {
      kind: "refuse",
      reason:
        label === "host"
          ? "target URL query host is empty — libpq would fall back to the default socket — cannot assess target safety"
          : "target URL query hostaddr is empty — libpq would ignore the empty address, leaving the channel unassessed — cannot assess target safety",
    };
  }
  // Charset gate BEFORE synthesis: a decoded value carrying URL-structural
  // characters (`/`, `?`, `#`, `@`, `%`, …) would otherwise reshape the
  // synthesized URL instead of being analyzed as a host token.
  if (!CONNINFO_HOST_PATTERN.test(value)) {
    return {
      kind: "refuse",
      reason: `target URL query ${label} decodes to a value outside the assessable host character set — cannot assess target safety`,
    };
  }
  const synthesized = `postgresql://${toUrlHostToken(value)}/`;
  if (!parsesAsPostgresUrl(synthesized)) {
    return {
      kind: "refuse",
      reason: `target URL query ${label} does not form a valid postgresql:// URL (malformed host value) — cannot assess target safety`,
    };
  }
  const effective = libpqEffectiveAssessUrl(new URL(synthesized));
  if (effective.kind === "refuse") {
    return effective;
  }
  if (label === "hostaddr" && !isLoopbackHostaddr(value)) {
    return {
      kind: "refuse",
      reason:
        "target URL query hostaddr names a non-loopback address — the connection endpoint has no assessable host signal — cannot assess target safety",
    };
  }
  return effective;
}

/**
 * The RAW host substring of a postgres URI: the authority after the last `@`
 * (userinfo separator in both libpq and WHATWG), up to the first path/query/
 * fragment delimiter. Control characters here are the fail-closed signal for
 * the WHATWG-strips/libpq-keeps divergence.
 */
export function rawUriHostSubstring(target: string): string {
  const schemeEnd = target.indexOf("://");
  const authorityStart = schemeEnd < 0 ? 0 : schemeEnd + 3;
  let authorityEnd = target.length;
  for (const stop of ["/", "?", "#"]) {
    const stopAt = target.indexOf(stop, authorityStart);
    if (stopAt >= 0 && stopAt < authorityEnd) {
      authorityEnd = stopAt;
    }
  }
  const authority = target.slice(authorityStart, authorityEnd);
  const atSign = authority.lastIndexOf("@");
  return atSign < 0 ? authority : authority.slice(atSign + 1);
}

/** True when `span` carries an ASCII control character (C0 range or DEL). */
function hasControlCharacter(span: string): boolean {
  for (let index = 0; index < span.length; index += 1) {
    const code = span.charCodeAt(index);
    if (code < 0x20 || code === 0x7f) {
      return true;
    }
  }
  return false;
}

/** Result of the raw authority-span assessment of a URI-form target. */
export type RawAuthorityAssessment = { kind: "ok" } | { kind: "refuse"; reason: string };

/**
 * Assesses the RAW AUTHORITY SPAN of a URI-form target: the substring after
 * `//` up to the first delimiter both parsers agree on — the FIRST `/` of
 * the raw string on a pathed URI (libpq scans the authority to that `/` and
 * splits userinfo at the LAST `@` inside the span, while the WHATWG parser
 * ends the authority at the first `?`/`#`, so
 * `postgresql://postgres:?@prod.example.com/db` parses with host `postgres`
 * under WHATWG but libpq connects to `prod.example.com`), or — on a PATHLESS
 * URI with no later `@` — the FIRST `?`, which is there the query delimiter
 * libpq AND WHATWG agree on (`postgresql://localhost:5432?sslmode=disable`);
 * such a query flows to the normal query-channel assessment. No RFC-legal
 * URL puts a raw `?`/`#` (or a control character) inside the authority span
 * itself, so a span carrying one is UNASSESSABLE and refuses the run before
 * any URL parsing (fail closed) — the assessed URL must be the URL libpq
 * sees. The same holds for a userinfo that percent-decodes into an `@` or
 * `/`: libpq percent-decodes the userinfo before use, so a decoded authority
 * delimiter makes the DSN's parsing ambiguous across libpq versions.
 */
export function assessRawUriAuthority(trimmedTarget: string): RawAuthorityAssessment {
  const schemeEnd = trimmedTarget.indexOf("://");
  const authorityStart = schemeEnd < 0 ? 0 : schemeEnd + 3;
  const slashAt = trimmedTarget.indexOf("/", authorityStart);
  const questionAt = trimmedTarget.indexOf("?", authorityStart);
  // Span end: the first `/` wins on a pathed URI (any `?`/`#` before it is
  // mid-span and ambiguous). On a pathless URI a `?` followed by no `@` is
  // the query delimiter both parsers honor (libpq would otherwise swallow a
  // later `@` into the userinfo, and only then does the parsers' view of the
  // authority diverge); anything else spans to the end of the string.
  let authorityEnd = trimmedTarget.length;
  if (slashAt >= 0) {
    authorityEnd = slashAt;
  } else if (questionAt >= 0 && trimmedTarget.indexOf("@", questionAt) < 0) {
    authorityEnd = questionAt;
  }
  const authoritySpan = trimmedTarget.slice(authorityStart, authorityEnd);
  if (authoritySpan.includes("?") || authoritySpan.includes("#") || hasControlCharacter(authoritySpan)) {
    return {
      kind: "refuse",
      reason:
        "target URL raw authority span carries a raw ?/# delimiter or control character — WHATWG and libpq " +
        "disagree on where the authority ends — unassessable authority — cannot assess target safety",
    };
  }
  const atSign = authoritySpan.lastIndexOf("@");
  if (atSign < 0 || !authoritySpan.slice(0, atSign).includes("%")) {
    return { kind: "ok" };
  }
  let decodedUserinfo: string;
  try {
    decodedUserinfo = decodeURIComponent(authoritySpan.slice(0, atSign));
  } catch {
    return {
      kind: "refuse",
      reason:
        "target URL userinfo carries a malformed percent-escape — unassessable authority — cannot assess target safety",
    };
  }
  if (decodedUserinfo.includes("@") || decodedUserinfo.includes("/")) {
    return {
      kind: "refuse",
      reason:
        "target URL userinfo percent-decodes to a value containing an authority delimiter (@ or /) — " +
        "unassessable authority — cannot assess target safety",
    };
  }
  return { kind: "ok" };
}

/** Refusal for a URI-form target whose raw path carries a fragment character. */
export const FRAGMENT_PATH_REFUSAL =
  "target URL path carries a raw fragment character (#) — libpq has no fragment delimiter and reads the raw " +
  "path as the literal database name while URL parsers end the path at the # — fragment character in path is " +
  "unassessable — cannot assess target safety";

/**
 * Assesses the RAW PATH of a URI-form target — the substring from the first
 * `/` to the first `?` of the raw string, the span libpq reads as the path.
 * libpq has NO fragment delimiter: it reads THROUGH a raw `#`, so `…/db#x`
 * restores into the literal database `db#x`, while the WHATWG parser (and
 * every raw-path/label helper that stops at the first `?`/`#`) ends the path
 * at the `#` and sees `db`. That divergence cannot be assessed around, so a
 * raw `#` in the path span is UNASSESSABLE and refuses the run before any
 * URL parsing (fail closed) — the {@link assessRawUriAuthority} mirror for
 * the path. A percent-encoded `%23` is fine: libpq percent-decodes the path
 * database before use, so the decoded name is exactly what every assessor
 * and label sees. A `#` AFTER the first `?` is a query-string fragment
 * delimiter and refuses through the query-channel rule instead.
 */
export function assessRawUriPath(trimmedTarget: string): RawAuthorityAssessment {
  const schemeEnd = trimmedTarget.indexOf("://");
  const authorityStart = schemeEnd < 0 ? 0 : schemeEnd + 3;
  const slashAt = trimmedTarget.indexOf("/", authorityStart);
  if (slashAt < 0) {
    return { kind: "ok" };
  }
  const questionAt = trimmedTarget.indexOf("?", authorityStart);
  const rawPath = trimmedTarget.slice(slashAt, questionAt < 0 ? trimmedTarget.length : questionAt);
  if (rawPath.includes("#")) {
    return { kind: "refuse", reason: FRAGMENT_PATH_REFUSAL };
  }
  return { kind: "ok" };
}

/**
 * Parses the RAW query string of a URI-form target into one assess URL per
 * query host channel, plus the extracted `dbname` parameter (the
 * database-override channel the caller's database-component rule consumes).
 * Parsing happens on the raw string — NOT on WHATWG's `url.search`, which
 * already stripped raw control characters libpq keeps — and anything the two
 * parsers must disagree on refuses before assessment.
 */
export function uriQueryChannelAssessUrls(trimmedTarget: string):
  | {
      kind: "ok";
      urls: string[];
      dbname: string | undefined;
    }
  | { kind: "refuse"; reason: string } {
  const queryStart = trimmedTarget.indexOf("?");
  if (queryStart < 0) {
    return { kind: "ok", urls: [], dbname: undefined };
  }
  const rawQuery = trimmedTarget.slice(queryStart + 1);
  if (/[\t\n\r]/.test(rawQuery)) {
    return {
      kind: "refuse",
      reason:
        "target URL query carries a raw control character (tab/newline) that the URL parser strips but libpq does not — cannot assess target safety",
    };
  }
  if (rawQuery.includes("#")) {
    return {
      kind: "refuse",
      reason:
        "target URL query carries a fragment delimiter libpq would fold into a parameter value — cannot assess target safety",
    };
  }
  const channels = extractUriQueryChannels(rawQuery);
  if (channels.kind === "refuse") {
    return channels;
  }
  // Service indirection: the `service` parameter names an entry in a
  // service file, and that file — not this target string — decides the
  // effective host/port/database. A target whose endpoint is chosen
  // elsewhere cannot be assessed and refuses the run.
  if (channels.service) {
    return {
      kind: "refuse",
      reason:
        "target URL query carries a service= parameter — service indirection is unassessable (the service file " +
        "decides the connection endpoint) — cannot assess target safety",
    };
  }
  const urls: string[] = [];
  for (const [label, value] of [
    ["host", channels.host],
    ["hostaddr", channels.hostaddr],
  ] as const) {
    if (value === undefined) {
      continue;
    }
    const assessed = assessQueryChannel(label, value);
    if (assessed.kind === "refuse") {
      return assessed;
    }
    urls.push(assessed.url);
  }
  return { kind: "ok", urls, dbname: channels.dbname };
}
