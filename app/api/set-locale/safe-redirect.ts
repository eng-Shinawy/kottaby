/**
 * Origin/redirect safety helpers for the `/api/set-locale` routes — extracted
 * verbatim from `app/api/set-locale/route.ts` (oversized-file split). This
 * module owns the host/origin allow-list, the open-redirect path guard, and
 * the safe redirect-origin resolver; the route only composes them. Behavior
 * is unchanged from the pre-extraction route.
 */

import type { NextRequest } from "next/server";
import { optionalEnv } from "@/backend/lib/env";

export const ALLOWED_ORIGINS = new Set(
  [
    optionalEnv("NEXT_PUBLIC_BASE_URL", ""),
    optionalEnv("ALLOWED_ORIGIN", ""),
    "http://localhost:3000",
    "http://127.0.0.1:3000",
  ].filter((v): v is string => typeof v === "string" && v.length > 0)
);

function hasControlOrBackslashChar(raw: string): boolean {
  for (let i = 0; i < raw.length; i++) {
    const code = raw.charCodeAt(i);
    if (code === 92 || code <= 31 || (code >= 127 && code <= 159)) {
      return true;
    }
  }
  return false;
}

/** Only allow same-origin relative paths (block open redirects). */
export function safeRedirectPath(raw: string | null, fallback = "/"): string {
  if (!raw || typeof raw !== "string") {
    return fallback;
  }
  let decoded: string;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    return fallback;
  }

  // Backslash or ASCII control characters (tab, newline, CR, etc.) anywhere —
  // checked on both the raw and URL-decoded forms, since browsers/frameworks
  // decode percent-encoded bypasses (%5C, %2f%2f, %0d%0a) on redirect → fail closed.
  if (
    !raw.startsWith("/") ||
    !decoded.startsWith("/") ||
    hasControlOrBackslashChar(raw) ||
    hasControlOrBackslashChar(decoded)
  ) {
    return fallback;
  }
  try {
    const dummyBase = "http://localhost:3000";
    const parsed = new URL(raw, dummyBase);
    if (parsed.origin !== dummyBase || !parsed.pathname.startsWith("/")) {
      return fallback;
    }
    const decodedParsed = new URL(decoded, dummyBase);
    if (decodedParsed.origin !== dummyBase || !decodedParsed.pathname.startsWith("/")) {
      return fallback;
    }
    return parsed.pathname + parsed.search + parsed.hash;
  } catch {
    return fallback;
  }
}

/**
 * Resolves a validated, safe redirect origin to prevent Host header injection and
 * open redirects to untrusted external domains.
 */
export function resolveSafeOrigin(request: NextRequest): string {
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  const protoHeader = request.headers.get("x-forwarded-proto");
  const proto = protoHeader ?? request.nextUrl.protocol.replace(":", "");
  const fallbackOrigin = request.nextUrl.origin.replace("://0.0.0.0", "://localhost");

  if (host) {
    const candidateOrigin = `${proto}://${host}`;
    if (candidateOrigin === request.nextUrl.origin || ALLOWED_ORIGINS.has(candidateOrigin)) {
      return candidateOrigin;
    }
  }

  return fallbackOrigin;
}
