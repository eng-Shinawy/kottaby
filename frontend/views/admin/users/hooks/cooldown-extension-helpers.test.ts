/**
 * Unit tier — the admin applicant-cooldown extension helpers. Locks:
 *
 *  1. `isValidExtensionDays` mirrors the server-side bounds gate exactly —
 *     whole numbers 1..3650 only (the server rejects anything else, so an
 *     invalid value must never cross the wire);
 *  2. `buildExtensionRouteError` routes the extension mutation's typed
 *     domain rejections: FORBIDDEN is suppressed inline (global toast path),
 *     `APPLICANT_ALREADY_CERTIFIED` + other typed codes surface as an
 *     inline info alert carrying the SERVER-localized message, and the
 *     generic VALIDATION class lands on the field helperText lane.
 *
 * Pure unit tier — NO server boot, NO network, NO DB. Runs via the mandated
 * runner: `bun run test/scripts/run-test.ts frontend/views/admin/users/hooks/cooldown-extension-helpers.test.ts`.
 */

import { describe, expect, test } from "bun:test";
import {
  buildExtensionRouteError,
  EXTENSION_MAX_DAYS,
  EXTENSION_MIN_DAYS,
  isValidExtensionDays,
} from "@/frontend/views/admin/users/hooks/cooldown-extension-helpers";

/** Minimal Apollo-shaped error carrying a typed domain code. */
function wireError(
  code: string,
  message: string
): { errors: Array<{ message: string; extensions: { code: string } }> } {
  return { errors: [{ message, extensions: { code } }] };
}

describe("isValidExtensionDays", () => {
  test("accepts the inclusive server bounds (1..3650)", () => {
    expect(EXTENSION_MIN_DAYS).toBe(1);
    expect(EXTENSION_MAX_DAYS).toBe(3650);
    expect(isValidExtensionDays("1")).toBe(true);
    expect(isValidExtensionDays("30")).toBe(true);
    expect(isValidExtensionDays("3650")).toBe(true);
  });

  test("rejects out-of-bounds, non-integer, and non-numeric input", () => {
    expect(isValidExtensionDays("0")).toBe(false);
    expect(isValidExtensionDays("3651")).toBe(false);
    expect(isValidExtensionDays("-5")).toBe(false);
    expect(isValidExtensionDays("3.5")).toBe(false);
    expect(isValidExtensionDays("")).toBe(false);
    expect(isValidExtensionDays("   ")).toBe(false);
    expect(isValidExtensionDays("abc")).toBe(false);
    expect(isValidExtensionDays("12abc")).toBe(false);
  });
});

describe("buildExtensionRouteError", () => {
  test("FORBIDDEN is suppressed inline (rides the global toast path)", () => {
    // `null as T` initializer — keeps the DECLARED type at read sites (a bare
    // `null` initializer narrows reads to `null` and closure writes back are
    // invisible to control-flow analysis).
    let daysErr = null as string | null;
    let alert = null as { severity: string; message: string } | null;
    buildExtensionRouteError(
      v => (daysErr = v),
      a => (alert = a)
    )(wireError("FORBIDDEN", "denied"));
    expect(daysErr).toBeNull();
    expect(alert).toBeNull();
  });

  test("APPLICANT_ALREADY_CERTIFIED surfaces as an info alert with the server message", () => {
    // `null as T` initializer — keeps the DECLARED type at read sites (a bare
    // `null` initializer narrows reads to `null` and closure writes back are
    // invisible to control-flow analysis).
    let daysErr = null as string | null;
    let alert = null as { severity: string; message: string } | null;
    buildExtensionRouteError(
      v => (daysErr = v),
      a => (alert = a)
    )(wireError("APPLICANT_ALREADY_CERTIFIED", "المتقدم معتمد بالفعل"));
    expect(daysErr).toBeNull();
    expect(alert?.severity).toBe("info");
    expect(alert?.message).toBe("المتقدم معتمد بالفعل");
  });

  test("other typed domain rejections surface as info alerts (server-localized message)", () => {
    let alert = null as { severity: string; message: string } | null;
    buildExtensionRouteError(
      () => undefined,
      a => (alert = a)
    )(wireError("APPLICANT_COOLDOWN_EXTENSION_INVALID", "Extension days must be a whole number between 1 and 3650."));
    expect(alert?.severity).toBe("info");
    expect(alert?.message).toBe("Extension days must be a whole number between 1 and 3650.");
  });

  test("the generic VALIDATION class lands on the field helperText lane", () => {
    // `null as T` initializer — keeps the DECLARED type at read sites (a bare
    // `null` initializer narrows reads to `null` and closure writes back are
    // invisible to control-flow analysis).
    let daysErr = null as string | null;
    let alert = null as { severity: string; message: string } | null;
    buildExtensionRouteError(
      v => (daysErr = v),
      a => (alert = a)
    )(wireError("VALIDATION", "days must be positive"));
    expect(daysErr).toBe("days must be positive");
    expect(alert).toBeNull();
  });
});
