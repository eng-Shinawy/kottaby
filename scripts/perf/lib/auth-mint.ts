/**
 * Authenticated-session minting for the performance harness.
 *
 * Mints REAL sessions by driving the application's own `login` GraphQL
 * mutation over HTTP and harvesting the httpOnly cookies the auth route emits
 * (`access_token`, `refresh_token`, `session_id` — the same `Set-Cookie`
 * values a browser receives). Nothing is forged: the returned cookie header
 * is the server's own verdict that the credentials are valid, and it lives
 * only in harness memory for the lifetime of the virtual user — never
 * logged, never written to a report file, never persisted.
 *
 * Secret hygiene: this module contains no logging and no filesystem access.
 * Submitted credentials are sent byte-for-byte and never echoed in error
 * messages (server-provided GraphQL error text is scrubbed of them first);
 * response bodies are never echoed at all.
 */

/** A real authenticated session minted through the login mutation. */
export interface MintedSession {
  userId: number;
  email: string;
  cookieHeader: string;
}

/** Raised for every minting failure: bad arguments, transport errors, credential rejections. */
export class AuthMintError extends Error {}

/** The httpOnly cookie carrying the short-lived access token (backend auth cookie name). */
export const ACCESS_TOKEN_COOKIE_NAME = "access_token";

/** Auth cookies harvested into the session jar, in canonical emission order. */
const AUTH_COOKIE_ORDER = ["access_token", "refresh_token", "session_id"] as const;

/**
 * The login mutation document sent to the GraphQL endpoint. Selects only the
 * authenticated user id — the session tokens travel exclusively in the
 * httpOnly cookies, so they never appear in the JSON body.
 */
export const LOGIN_MUTATION_DOCUMENT =
  "mutation PerfHarnessMintLogin($email: String!, $password: String!) { login(email: $email, password: $password) { user { id } } }";

/** Cap on server-provided error text surfaced in a minting error message. */
const MAX_ERROR_DETAIL_LENGTH = 300;

/** Runtime narrowing to a plain object (arrays are shape violations; no unsafe casts anywhere). */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Extracts the `name=value` pair from one `Set-Cookie` header value. Only the
 * first `;`-separated segment is the pair — everything after it (Expires with
 * its embedded comma, Path, HttpOnly, …) is attributes. The value keeps any
 * embedded `=` characters (e.g. base64 padding) intact. Returns null for
 * attribute-only headers and empty names/values (a deletion cookie is not a
 * usable session).
 */
export function parseSetCookiePair(header: string): { name: string; value: string } | null {
  const pairEnd = header.indexOf(";");
  const pair = pairEnd === -1 ? header : header.slice(0, pairEnd);
  const equalsIndex = pair.indexOf("=");
  if (equalsIndex <= 0) {
    return null;
  }
  const name = pair.slice(0, equalsIndex).trim();
  const value = pair.slice(equalsIndex + 1).trim();
  if (name.length === 0 || value.length === 0) {
    return null;
  }
  return { name, value };
}

/**
 * Collects the pairs of every `Set-Cookie` header into a jar. Duplicate names
 * keep their first position but their last value (browser jar semantics).
 */
export function collectCookiePairs(setCookieHeaders: readonly string[]): ReadonlyMap<string, string> {
  const jar = new Map<string, string>();
  for (const header of setCookieHeaders) {
    const pair = parseSetCookiePair(header);
    if (pair !== null) {
      jar.set(pair.name, pair.value);
    }
  }
  return jar;
}

/** Validates the base URL and derives the GraphQL endpoint (server root gains `/api/graphql`). */
function resolveGraphqlEndpoint(baseUrl: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(baseUrl);
  } catch {
    throw new AuthMintError("baseUrl must be an absolute http(s) URL pointing at the server root");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new AuthMintError("baseUrl must use the http or https protocol");
  }
  const path = parsed.pathname === "/" || parsed.pathname === "" ? "/api/graphql" : parsed.pathname;
  return new URL(path, parsed.origin);
}

/** Shape-validated view of the login mutation response body. */
interface LoginMutationOutcome {
  errorMessages: string[];
  userId: number | null;
}

/** Extracts GraphQL error messages; a malformed `errors` value is a shape violation. */
function extractErrorMessages(value: unknown): string[] {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new AuthMintError("the login response had an unexpected shape");
  }
  const messages: string[] = [];
  for (const entry of value) {
    if (!isRecord(entry) || typeof entry.message !== "string") {
      throw new AuthMintError("the login response had an unexpected shape");
    }
    messages.push(entry.message);
  }
  return messages;
}

/** Parses and shape-validates the response body without ever echoing it. */
function parseLoginResponseBody(bodyText: string): LoginMutationOutcome {
  let parsed: unknown;
  try {
    parsed = JSON.parse(bodyText);
  } catch {
    throw new AuthMintError("the login response was not valid JSON");
  }
  if (!isRecord(parsed)) {
    throw new AuthMintError("the login response had an unexpected shape");
  }
  const errorMessages = extractErrorMessages(parsed.errors);
  const dataValue = parsed.data;
  const loginValue = isRecord(dataValue) ? dataValue.login : null;
  const userValue = isRecord(loginValue) ? loginValue.user : null;
  const idValue = isRecord(userValue) ? userValue.id : null;
  const userId = typeof idValue === "number" && Number.isInteger(idValue) && idValue > 0 ? idValue : null;
  return { errorMessages, userId };
}

/** Removes submitted credential substrings from server-provided text, then caps its length. */
function scrubCredentials(text: string, secrets: readonly string[]): string {
  let scrubbed = text;
  for (const secret of secrets) {
    if (secret.length > 0) {
      scrubbed = scrubbed.split(secret).join("[REDACTED]");
    }
  }
  return scrubbed.length > MAX_ERROR_DETAIL_LENGTH ? scrubbed.slice(0, MAX_ERROR_DETAIL_LENGTH) : scrubbed;
}

/**
 * Mints one authenticated session through the real `login` mutation.
 *
 * The credentials are sent byte-for-byte (a password is never trimmed or
 * transformed). On success the returned `cookieHeader` is a ready-to-send
 * `Cookie` request header value carrying the server-issued httpOnly auth
 * cookies; it exists only in the caller's memory.
 */
export async function mintSessionCookie(baseUrl: string, email: string, password: string): Promise<MintedSession> {
  const endpoint = resolveGraphqlEndpoint(baseUrl);
  if (email.trim().length === 0) {
    throw new AuthMintError("the login email must be a non-empty string");
  }
  if (password.length === 0) {
    throw new AuthMintError("the login password must be a non-empty string");
  }
  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: LOGIN_MUTATION_DOCUMENT, variables: { email, password } }),
    });
  } catch (cause) {
    throw new AuthMintError("the login request could not reach the server (network failure)", { cause });
  }
  if (!response.ok) {
    throw new AuthMintError(`the login request failed with HTTP status ${response.status}`);
  }
  let bodyText: string;
  try {
    bodyText = await response.text();
  } catch (cause) {
    throw new AuthMintError("the login response body could not be read", { cause });
  }
  const outcome = parseLoginResponseBody(bodyText);
  if (outcome.errorMessages.length > 0) {
    const detail = scrubCredentials(outcome.errorMessages.join("; "), [email, password]);
    throw new AuthMintError(`the login mutation was rejected: ${detail}`);
  }
  const { userId } = outcome;
  if (userId === null) {
    throw new AuthMintError("the login response did not include the authenticated user id");
  }
  const jar = collectCookiePairs(response.headers.getSetCookie());
  if (jar.get(ACCESS_TOKEN_COOKIE_NAME) === undefined) {
    throw new AuthMintError("the login response did not set a usable access_token cookie — no session to mint");
  }
  const parts: string[] = [];
  for (const name of AUTH_COOKIE_ORDER) {
    const value = jar.get(name);
    if (value !== undefined) {
      parts.push(`${name}=${value}`);
    }
  }
  return { userId, email, cookieHeader: parts.join("; ") };
}
