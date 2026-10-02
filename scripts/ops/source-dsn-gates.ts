/**
 * Raw source-DSN gate scans for the backup bootstrap (`backup-database.ts`,
 * sequenced by the `backupSourceDsnRefusal` dispatcher in `_shared.ts`).
 *
 * Extracted from `_shared.ts` to honor the repo's `max-lines` budget
 * (configured in oxlint.config.mts); behavior is verbatim, moved not copied.
 * Everything here is a pure string scan — no env access, no I/O, no imports —
 * so the gates stay unit-testable in isolation and the dispatcher remains the
 * only module that sequences them and renders the `[env]` refusal messages.
 *
 * The module owns the fail-closed source-DSN gate channels the backup
 * bootstrap assesses, in assessment order:
 *
 *  1. `rawDsnHasAmbiguousAuthority` — raw unassessable `?`/`#`/control
 *     characters across the authority, path, and query spans (the
 *     backup-side mirror of the restore guard's raw-authority, raw-#, and
 *     control channels in `restore-guard-url.ts`);
 *  2. `rawDsnPathHasDotSegments` — raw or percent-encoded `.`/`..` path
 *     segments (the WHATWG parser normalizes them away while libpq treats
 *     the raw path as the literal database name);
 *  3. `rawDsnHasMultiHostEndpoints` — comma-separated host lists in the
 *     authority host span or a query `host=`/`hostaddr=` value;
 *  4. `rawDsnQueryHasEndpointOverride` — endpoint-deciding query keys
 *     (`host`, `hostaddr`, `port`), with the `service`
 *     connection-service-file indirection sliced out separately
 *     (`rawDsnQueryHasServiceIndirection`) for its own refusal message.
 *
 * The percent-segment decoder (`decodeUrlSegment`) and the dot-segment
 * helper (`hasDotSegments`) the gates scan with are defined here too and
 * re-exported through `_shared.ts`, so the label pipeline, the
 * database-component rule, and the credential scrubber keep decoding through
 * the same one definition.
 */

/**
 * Percent-decodes one URL path/userinfo segment. A malformed escape
 * (`%ZZ`) degrades to the raw input rather than throwing — callers that
 * need strict decoding must validate separately.
 */
export function decodeUrlSegment(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/**
 * True when `path` (leading `/` already stripped) carries a dot-segment —
 * a whole `.` or `..` path segment. The WHATWG parser normalizes such
 * segments away (so `URL#pathname` mislabels the database libpq connects
 * to); libpq does not, and would restore into a bizarre literal
 * dot-segment database name. Such a target is unassessable.
 */
export function hasDotSegments(path: string): boolean {
  return path.split("/").some(segment => segment === "." || segment === "..");
}

/**
 * Whether ANY of the three raw spans of a DSN string is unassessable — a
 * delimiter libpq reads one way while every WHATWG-derived view reads it
 * another — the backup-side mirror of the restore guard's raw-authority
 * and raw-# channels in `restore-guard-url.ts`:
 *
 *  1. the RAW AUTHORITY SPAN — after `//` up to the first `/` of the raw
 *     string (with the guard's pathless refinement: on a pathless URI a
 *     first `?` followed by no later `@` is the query delimiter both
 *     parsers agree on, so the span ends there). A raw `?` OR `#` OR
 *     control character inside the span is UNASSESSABLE: libpq scans the
 *     authority to that `/` and splits userinfo at the last `@` inside it,
 *     while WHATWG ends the authority at the first `?`/`#` —
 *     `…//postgres?k@host:5432/db` dumps as role `postgres?k` at
 *     `host:5432` while the WHATWG view parses host `postgres`
 *     (live-proven R11 shape: manifest `(default)` while dumping a named
 *     database); `…//ops_owner#k:pw@host/db` dumps as role `ops_owner#k`
 *     while the WHATWG view parses host `ops_owner`;
 *  2. the RAW PATH SPAN — from the first `/` to the first `?`. libpq has
 *     no fragment delimiter and reads the raw path as the LITERAL database
 *     name (`…/pt9b#k`), while the WHATWG pathname ends at the `#`. A raw
 *     control character there diverges the same way: WHATWG strips
 *     tab/newline/CR outright (db `r12ptab<TAB>k` labels `r12ptabk` —
 *     live-proven R12 shape) and percent-encodes the other C0 controls,
 *     while libpq dumps the literal bytes;
 *  3. the RAW QUERY STRING — after the first `?`. A raw `#` there is a
 *     fragment delimiter to WHATWG but a literal parameter-value character
 *     to libpq (`?dbname=app_db#k` dumps `app_db#k` while the WHATWG query
 *     value is `app_db`); a raw tab/newline/CR is stripped by WHATWG and
 *     kept by libpq — the guard's query-channel rule.
 *
 * Control characters follow the guard's authority-span rule (C0 range plus
 * DEL) in the authority and path spans. Any of the three channels makes the
 * database (or role) pg_dump connects as diverge from every URL-derived
 * label, so the backup bootstrap refuses such DSNs fail-closed instead of
 * letting the manifest mislabel the dump. A percent-encoded escape is fine:
 * libpq percent-decodes each channel before use and the label decodes to
 * the same literal value (`%23`, `%09`). One parity exception is accepted
 * deliberately: a percent-encoded `%40`/`%2F` in the USERINFO decodes INTO
 * a raw-looking `@` or `/` — a userinfo sub-channel intentionally NOT
 * mirrored here, because the raw last-`@` userinfo split is identical on
 * both parsers (each splits the RAW span before decoding, so a decoded
 * delimiter re-splits neither view) and the decoded role is never rendered
 * (the label marks any userinfo as `(redacted-user)`). The label functions
 * above are untouched: refusal upstream (backup bootstrap / restore guard)
 * prevents the divergence they cannot see.
 */
/** True when `span` carries an ASCII control character (C0 range or DEL) — the restore guard's rule. */
function hasControlCharacter(span: string): boolean {
  for (let index = 0; index < span.length; index += 1) {
    const code = span.charCodeAt(index);
    if (code < 0x20 || code === 0x7f) {
      return true;
    }
  }
  return false;
}

/**
 * The raw AUTHORITY SPAN of a DSN string — after `//` up to the first `/` of
 * the raw string (with the guard's pathless refinement: on a pathless URI a
 * first `?` followed by no later `@` is the query delimiter both parsers
 * agree on, so the span ends there) — plus the raw `/` and `?` indices the
 * span-based gates need for their own channel slices. One definition shared
 * verbatim by every raw-span gate below (the restore guard's
 * `assessRawUriAuthority` span math).
 */
type RawDsnAuthoritySpan = { span: string; slashAt: number; questionAt: number };

function rawDsnAuthoritySpan(trimmedDsn: string): RawDsnAuthoritySpan {
  const schemeEnd = trimmedDsn.indexOf("://");
  const authorityStart = schemeEnd < 0 ? 0 : schemeEnd + 3;
  const slashAt = trimmedDsn.indexOf("/", authorityStart);
  const questionAt = trimmedDsn.indexOf("?", authorityStart);
  let authorityEnd = trimmedDsn.length;
  if (slashAt >= 0) {
    authorityEnd = slashAt;
  } else if (questionAt >= 0 && trimmedDsn.indexOf("@", questionAt) < 0) {
    authorityEnd = questionAt;
  }
  return { span: trimmedDsn.slice(authorityStart, authorityEnd), slashAt, questionAt };
}

export function rawDsnHasAmbiguousAuthority(trimmedDsn: string): boolean {
  const { span: authoritySpan, slashAt, questionAt } = rawDsnAuthoritySpan(trimmedDsn);
  // Channel 1 — raw authority span: the restore guard's span math
  // (`assessRawUriAuthority`, the shared `rawDsnAuthoritySpan` slice),
  // control characters included.
  if (authoritySpan.includes("?") || authoritySpan.includes("#") || hasControlCharacter(authoritySpan)) {
    return true;
  }
  // Channel 2 — raw path span (`assessRawUriPath` mirror): first `/` to
  // the first `?`, the span libpq reads as the path. Control characters
  // follow the guard's C0 rule: WHATWG strips tab/newline/CR and
  // percent-encodes the rest, libpq keeps the literal bytes.
  if (slashAt >= 0) {
    const rawPath = trimmedDsn.slice(slashAt, questionAt < 0 ? trimmedDsn.length : questionAt);
    if (rawPath.includes("#") || hasControlCharacter(rawPath)) {
      return true;
    }
  }
  // Channel 3 — raw query string (the restore guard's query-channel
  // rule): everything after the first `?` to the end of the string. A raw
  // tab/newline/CR is exactly what WHATWG strips and libpq keeps.
  if (questionAt >= 0) {
    const rawQuery = trimmedDsn.slice(questionAt + 1);
    if (rawQuery.includes("#") || /[\t\n\r]/.test(rawQuery)) {
      return true;
    }
  }
  return false;
}

/**
 * Whether the RAW path span of a DSN string carries a dot-segment — a whole
 * `.` or `..` path segment, raw OR percent-decoded — the backup-side mirror
 * of the restore guard's dot-segment rule (`hasDotSegments` inside
 * `assessUriDatabaseComponent` in `_shared.ts`). The span is libpq's path view: from
 * the first `/` after the authority to the first `?` (a raw `#` stays INSIDE
 * the span — libpq has no fragment delimiter — and is separately refused by
 * {@link rawDsnHasAmbiguousAuthority}). The WHATWG parser normalizes
 * dot-segments away in its `pathname` (recognizing their percent-encoded
 * forms too) while libpq treats the raw path as the LITERAL database name
 * (live-proven: `…/a/../db` dumps the literal `a/../db` database while the
 * WHATWG pathname records `db`), so the decoded span is gated exactly like
 * the raw one and a dot-segment path is unassessable either way.
 */
export function rawDsnPathHasDotSegments(trimmedDsn: string): boolean {
  const { slashAt, questionAt } = rawDsnAuthoritySpan(trimmedDsn);
  if (slashAt < 0) {
    return false;
  }
  const rawPathDatabase = trimmedDsn.slice(slashAt, questionAt < 0 ? trimmedDsn.length : questionAt).replace(/^\//, "");
  if (hasDotSegments(rawPathDatabase)) {
    return true;
  }
  // A percent-encoded dot-segment (%2e) is normalized by WHATWG exactly like
  // a literal one, so the decoded view is gated the same way (a malformed
  // escape degrades to the raw span — nothing new to normalize there).
  return hasDotSegments(decodeUrlSegment(rawPathDatabase));
}

/**
 * Whether the DSN names MULTI-HOST endpoints — a comma (raw or
 * percent-decoded) in the authority HOST span or in a query
 * `host=`/`hostaddr=` value — the backup-side mirror of the restore guard's
 * assessable-host charset (`CONNINFO_HOST_PATTERN` in `restore-guard-url.ts`,
 * which excludes the comma). libpq accepts comma-separated host LISTS in the
 * URI authority and in query `host=`/`hostaddr=` values, and it
 * percent-decodes the host BEFORE the list is split, so the connection no
 * longer has one endpoint while every URL-derived label — the redacted
 * provenance line and the manifest's authority view among them — renders
 * only the FIRST authority host (live-proven R16 shape:
 * `postgresql://postgres@127.0.0.1,8.8.8.8:5432/db` completed a real backup
 * through libpq failover while the manifest labeled only `127.0.0.1`, and
 * the restore guard refuses the identical shape). The gate runs BEFORE the
 * endpoint-override gate so a comma-carrying query host is refused with THIS
 * message rather than the generic override one. A comma in the USERINFO, the
 * path database, or a non-endpoint query parameter is untouched, and a
 * bracketed IPv6 host (`[::1]`) names one host and passes. Each channel is
 * ONE percent-decode: `decodeUrlSegment` preserves literal commas and
 * degrades malformed escapes to the raw span, so a comma in the decoded
 * value is exactly a raw or percent-encoded comma.
 */
export function rawDsnHasMultiHostEndpoints(trimmedDsn: string): boolean {
  const { span: authoritySpan, questionAt } = rawDsnAuthoritySpan(trimmedDsn);
  // libpq splits the userinfo at the LAST `@` inside the span; a span with
  // no `@` is all host (lastIndexOf −1 + 1 → slice from 0).
  const hostSpan = authoritySpan.slice(authoritySpan.lastIndexOf("@") + 1);
  if (decodeUrlSegment(hostSpan).includes(",")) {
    return true;
  }
  const rawQuery = questionAt < 0 ? "" : trimmedDsn.slice(questionAt + 1);
  for (const pair of rawQuery.split("&")) {
    const equals = pair.indexOf("=");
    const key = equals < 0 ? "" : decodeUrlSegment(pair.slice(0, equals)).toLowerCase();
    const value = equals < 0 ? "" : pair.slice(equals + 1);
    if ((key === "host" || key === "hostaddr") && decodeUrlSegment(value).includes(",")) {
      return true;
    }
  }
  return false;
}

/**
 * The endpoint-deciding RAW query keys: the three direct overrides plus the
 * `service` key (connection-service-file indirection — see
 * {@link rawDsnQueryHasEndpointOverride}).
 */
const RAW_DSN_ENDPOINT_OVERRIDE_QUERY_KEYS = ["host", "hostaddr", "port", "service"] as const;

/**
 * Whether the RAW query string of a DSN string carries an endpoint-override
 * parameter — a `host`, `hostaddr`, `port`, or `service` key (case-insensitive,
 * percent-decoded key match; a valueless key counts as present) — the
 * backup-side completion of the restore guard's query-channel rule (restore
 * targets have assessed `?host=`/`?hostaddr=` through the guard pipeline
 * since R2; the backup source DSN had no equivalent gate). libpq applies URI
 * query parameters ON TOP of the parsed authority, so a query `?host=`/
 * `?port=` names the endpoint pg_dump actually connects to while every
 * URL-derived view — the redacted provenance line and the manifest's
 * authority label among them — renders the DSN authority (live-proven: a
 * `?host=…&port=…` source backed up with the authority label naming a dead
 * endpoint, and `?hostaddr=8.8.8.8` would ship the dump off-box entirely).
 * `service` is the same indirection one step removed: libpq resolves the
 * value through the connection-service file (`~/.pg_service.conf` /
 * `PGSERVICEFILE`), whose `host=`/`port=` decide the endpoint nothing in
 * the URL view sees (live-proven: `…@127.0.0.1/db?service=x` with a
 * redirected service file made psql connect on port 5999). The authority
 * is the only supported endpoint channel, so the backup bootstrap refuses
 * such DSNs fail-closed — `backupSourceDsnRefusal` in `_shared.ts`
 * renders the
 * `service` shape with its own "service indirection" message (via
 * {@link rawDsnQueryHasServiceIndirection}) and the other three keys with
 * the endpoint-override one. Plain query parameters (`dbname`, `sslmode`,
 * `application_name`, …) are untouched: only the four endpoint keys refuse,
 * matched EXACTLY (a `localhost` key is not a `host` key). Keys are
 * compared after percent-decoding (libpq decodes parameter names before
 * matching; a malformed escape degrades to the raw text and simply does
 * not match) and case-folding (libpq keyword matching is case-insensitive),
 * so `?HOST=` and `?%68ost=` refuse like `?host=`.
 */
export function rawDsnQueryHasEndpointOverride(trimmedDsn: string): boolean {
  return rawDsnQueryHasKey(trimmedDsn, RAW_DSN_ENDPOINT_OVERRIDE_QUERY_KEYS);
}

/**
 * Whether the RAW query string of a DSN string carries a `service` key —
 * the same decoded, case-insensitive, valueless-counts match as
 * {@link rawDsnQueryHasEndpointOverride}, sliced out so
 * `backupSourceDsnRefusal` in `_shared.ts` can render the service-file shape with its
 * own refusal message: the remediation is naming the endpoint in the DSN
 * authority, not the host/port keys the generic override message names.
 */
export function rawDsnQueryHasServiceIndirection(trimmedDsn: string): boolean {
  return rawDsnQueryHasKey(trimmedDsn, ["service"]);
}

/**
 * The raw-query key scan shared by the endpoint-override and service gates.
 * The whole raw tail after the first `?` is libpq's query view (a raw `#`
 * inside it is a separate refusal in `rawDsnHasAmbiguousAuthority`). One
 * linear pass, split on `&`, first `=` separates a decoded, case-folded
 * KEY from its value — the value is never endpoint-deciding here.
 */
function rawDsnQueryHasKey(trimmedDsn: string, keys: readonly string[]): boolean {
  const questionAt = trimmedDsn.indexOf("?");
  if (questionAt < 0) {
    return false;
  }
  for (const pair of trimmedDsn.slice(questionAt + 1).split("&")) {
    if (pair.length === 0) {
      continue;
    }
    const equals = pair.indexOf("=");
    const key = decodeUrlSegment(equals < 0 ? pair : pair.slice(0, equals)).toLowerCase();
    if (keys.includes(key)) {
      return true;
    }
  }
  return false;
}
