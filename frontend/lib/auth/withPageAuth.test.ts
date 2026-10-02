/**
 * `withPageAuth` forced-reset fence contract tests (paired with
 * `frontend/lib/auth/withPageAuth.ts`).
 *
 * Scope: the PURE decision seam `shouldRedirectToChangePassword` — the exact
 * branch the SSR guard consumes between the authentication check and the
 * role check. The full redirect flow (which calls `next/navigation.redirect`
 * and the cached `getServerUserContext`) is an SSR-harness behavior; the
 * decision logic here locks its branch matrix:
 *  - a flagged user is redirected whenever the page has not opted out;
 *  - `allowMustChangePassword: true` (the `/change-password` page itself)
 *    exempts the caller — including flagged ones;
 *  - un-flagged / anonymous identities are a strict no-op.
 */

import { describe, expect, test } from "bun:test";
import { shouldRedirectToChangePassword } from "@/frontend/lib/auth/withPageAuth";

function flaggedUser(mustChangePassword: boolean): { readonly mustChangePassword: boolean } {
  return { mustChangePassword };
}

describe("shouldRedirectToChangePassword — forced-reset page fence", () => {
  test("a flagged user is redirected while the default (unset option) holds", () => {
    expect(shouldRedirectToChangePassword(flaggedUser(true), undefined)).toBe(true);
    expect(shouldRedirectToChangePassword(flaggedUser(true), false)).toBe(true);
  });

  test("an un-flagged user is never redirected — zero behavior change", () => {
    expect(shouldRedirectToChangePassword(flaggedUser(false), undefined)).toBe(false);
    expect(shouldRedirectToChangePassword(flaggedUser(false), false)).toBe(false);
    expect(shouldRedirectToChangePassword(flaggedUser(false), true)).toBe(false);
  });

  test("allowMustChangePassword: true exempts the caller (the /change-password page itself)", () => {
    expect(shouldRedirectToChangePassword(flaggedUser(true), true)).toBe(false);
  });

  test("anonymous / missing identities are a no-op (the anonymous check owns that redirect)", () => {
    expect(shouldRedirectToChangePassword(null, undefined)).toBe(false);
    expect(shouldRedirectToChangePassword(null, true)).toBe(false);
    expect(shouldRedirectToChangePassword(undefined, undefined)).toBe(false);
  });
});
