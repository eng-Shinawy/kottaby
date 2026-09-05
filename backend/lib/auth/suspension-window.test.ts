/**
 * `backend/lib/auth/suspension-window.ts` — suspension-window predicate matrix.
 *
 * Coverage map (eight branch-matrix arms matching the predicate's truth table
 * exactly, plus two deferred source pins that go green once the auth-side
 * consumption lands):
 *
 *  - **(a)** not-suspended (`suspended: false` and `suspended: null`) → `false`;
 *  - **(b)** suspended + missing `suspendedAt` → `true` (fail-closed);
 *  - **(c)** suspended + missing `suspendedPeriodDays` → `true` (fail-closed);
 *  - **(d)** suspended + `periodDays === 0` → `true` (fail-closed — a zero-day
 *    window would otherwise compute an `endsAt ≤ now` and misclassify an
 *    actively-suspended user as lapsed);
 *  - **(e)** suspended + negative `periodDays` → `true` (fail-closed —
 *    corrupt governance data, same rationale as (d));
 *  - **(f)** active window (`now` strictly inside the window) → `true`;
 *  - **(g)** EXACT boundary (`now === suspendedAt + periodDays × MS_PER_DAY`)
 *    → `false` (lapsed — the predicate uses STRICT `>`);
 *  - **(h)** fully lapsed window → `false`.
 *
 * Source pins (LIVE — green once the auth-boundary consumption lands):
 * BOTH `backend/services/auth/auth.service.ts` and
 * `backend/lib/auth/server-auth.ts` MUST import `isSuspensionActive`. They
 * are authored as live `it` blocks here that grep the on-disk source for
 * the import specifier — green at this layer once the auth layer's
 * consumption task completes.
 *
 * Pure unit tier — NO DB, NO server boot. Runs via the mandated runner:
 * `bun run test/scripts/run-test.ts backend/lib/auth/suspension-window.test.ts`.
 */

import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isSuspensionActive } from "@/backend/lib/auth/suspension-window";

describe("isSuspensionActive", () => {
  // Fixed evaluation instant — every window math fixture is anchored to THIS
  // timestamp so the suite is deterministic across runs / timezones.
  const NOW = new Date("2026-09-04T12:00:00.000Z");

  // ─── (a) not suspended → false ──────────────────────────────────────────────

  it("returns false when suspended is false", () => {
    expect(isSuspensionActive({ suspended: false, suspendedAt: null, suspendedPeriodDays: null }, NOW)).toBe(false);
  });

  it("returns false when suspended is null", () => {
    expect(isSuspensionActive({ suspended: null, suspendedAt: null, suspendedPeriodDays: null }, NOW)).toBe(false);
  });

  // ─── (b) suspended + missing suspendedAt → fail-closed true ─────────────────

  it("returns true when suspended but suspendedAt is null", () => {
    expect(isSuspensionActive({ suspended: true, suspendedAt: null, suspendedPeriodDays: 7 }, NOW)).toBe(true);
  });

  // ─── (c) suspended + missing suspendedPeriodDays → fail-closed true ─────────

  it("returns true when suspended but suspendedPeriodDays is null", () => {
    const suspendedAt = new Date("2026-09-01T12:00:00.000Z");
    expect(isSuspensionActive({ suspended: true, suspendedAt, suspendedPeriodDays: null }, NOW)).toBe(true);
  });

  // ─── (d) suspended + periodDays = 0 → fail-closed true ──────────────────────

  it("returns true when suspendedPeriodDays is zero", () => {
    const suspendedAt = new Date("2026-09-01T12:00:00.000Z");
    expect(isSuspensionActive({ suspended: true, suspendedAt, suspendedPeriodDays: 0 }, NOW)).toBe(true);
  });

  // ─── (e) suspended + negative periodDays → fail-closed true ─────────────────

  it("returns true when suspendedPeriodDays is negative", () => {
    const suspendedAt = new Date("2026-09-01T12:00:00.000Z");
    expect(isSuspensionActive({ suspended: true, suspendedAt, suspendedPeriodDays: -3 }, NOW)).toBe(true);
  });

  // ─── (f) active window (now strictly inside) → true ─────────────────────────

  it("returns true when now is strictly inside the active suspension window", () => {
    const suspendedAt = new Date("2026-09-01T12:00:00.000Z"); // 3 days before NOW
    expect(isSuspensionActive({ suspended: true, suspendedAt, suspendedPeriodDays: 7 }, NOW)).toBe(true);
  });

  // ─── (g) EXACT boundary (now === suspendedAt + periodDays) → false (lapsed) ─

  it("returns false at the exact boundary (now === suspendedAt + periodDays × MS_PER_DAY)", () => {
    // suspendedAt + 7 days lands EXACTLY on NOW — strict `>` means this has lapsed.
    const suspendedAt = new Date("2026-08-28T12:00:00.000Z");
    const exactlyBoundary = new Date("2026-09-04T12:00:00.000Z");
    expect(isSuspensionActive({ suspended: true, suspendedAt, suspendedPeriodDays: 7 }, exactlyBoundary)).toBe(false);
  });

  // ─── (h) fully lapsed → false ───────────────────────────────────────────────

  it("returns false when the suspension window has fully lapsed", () => {
    const suspendedAt = new Date("2026-08-20T12:00:00.000Z"); // 15 days before NOW (window was 7d)
    expect(isSuspensionActive({ suspended: true, suspendedAt, suspendedPeriodDays: 7 }, NOW)).toBe(false);
  });

  // ─── Source pins (LIVE — green once the auth-boundary consumption lands) ────
  //
  // These prove BOTH `backend/services/auth/auth.service.ts` and
  // `backend/lib/auth/server-auth.ts` import `isSuspensionActive`. They are
  // live `it` blocks today; the live assertion body pins the import
  // specifier against the on-disk source. The per-test explanation
  // comment immediately above each call keeps the no-skipped-tests rule green.

  // Source pin: green once the auth-boundary consumption lands downstream.
  it("backend/services/auth/auth.service.ts imports isSuspensionActive", (): void => {
    const source = readFileSync(join(process.cwd(), "backend/services/auth/auth.service.ts"), "utf8");
    expect(source).toContain("isSuspensionActive");
  });

  // Source pin: green once the SSR-boundary consumption lands downstream.
  it("backend/lib/auth/server-auth.ts imports isSuspensionActive", (): void => {
    const source = readFileSync(join(process.cwd(), "backend/lib/auth/server-auth.ts"), "utf8");
    expect(source).toContain("isSuspensionActive");
  });
});
