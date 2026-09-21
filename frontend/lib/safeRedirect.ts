/**
 * Open-redirect prevention helpers.
 *
 * `isSafeRedirect` validates that a user-supplied redirect URL is same-origin
 * (starts with `/` and has no protocol/host) before the app navigates to it.
 * This blocks `?redirect=https://evil.com` attacks where a malicious link
 * would bounce an authenticated user to an attacker-controlled site.
 *
 * `buildLoginHref` constructs the `/login?redirect=...` URL the errorLink uses
 * when a UNAUTHENTICATED response forces a hard redirect back to sign-in.
 */

/**
 * Returns `true` only if `url` is a same-origin path (starts with `/` but not
 * `//`) — safe to pass to `window.location.href` or `router.replace`.
 *
 * Rejects: absolute URLs (`https://...`), protocol-relative URLs (`//host`),
 * raw backslashes (WHATWG parsing folds `"/\\host"` into `//host` — same
 * foreign-origin escape), and any value that could escape the origin via a
 * scheme (`javascript:`).
 *
 * Implemented as a type guard (`url is string`) so callers can use the
 * narrowed type after the check without an unsafe `as` assertion.
 */
function hasControlOrBackslashChar(raw: string): boolean {
  for (let i = 0; i < raw.length; i++) {
    const code = raw.charCodeAt(i);
    // 92 is '\\', <= 31 includes ASCII control chars (tab, newline, CR, null, etc.)
    // 127-159 is C1 control codes.
    if (code === 92 || code <= 31 || (code >= 127 && code <= 159)) {
      return true;
    }
  }
  return false;
}

export function isSafeRedirect(url: string | null | undefined): url is string {
  if (!url) return false;
  // Must start with a single slash — protocol-relative `//host` is blocked.
  if (!url.startsWith("/")) return false;
  if (url.startsWith("//")) return false;
  // Backslash or ASCII/C1 control characters anywhere → fail closed.
  // WHATWG URL parsing strips control characters (e.g., "/\tevil.com" ≡ "//evil.com"
  // or "http://evil.com/") and folds backslashes into slashes ("/\\evil.com" ≡ "//evil.com").
  if (hasControlOrBackslashChar(url)) return false;
  // Block scheme-prefixed values (`javascript:`, `data:`, etc.) even if
  // leading whitespace was used to smuggle them past the first check.
  const trimmed = url.trimStart().toLowerCase();
  if (trimmed.includes(":") && !trimmed.startsWith("/")) return false;
  return true;
}

/**
 * Build a `/login?redirect=<encoded>` URL, including the redirect param only
 * when `redirectUrl` is a safe same-origin path.
 *
 * If `redirectUrl` is null/empty/unsafe, returns bare `/login` (no redirect
 * param) so the user lands on a clean sign-in page.
 */
export function buildLoginHref(redirectUrl?: string | null): string {
  if (!isSafeRedirect(redirectUrl)) {
    return "/login";
  }
  // After the type guard, redirectUrl is narrowed to `string`.
  const encoded = encodeURIComponent(redirectUrl);
  return `/login?redirect=${encoded}`;
}
