/**
 * Paired suite — the portal root's completion-notification deep-link
 * resolution flow (`ParentChildrenRootContainer.helpers`), the pure
 * decision layer `useSessionResolution` and the container's auto-select
 * effect navigate by.
 *
 * WHAT THIS LOCKS
 *   1. SINGLE-WRITER NAVIGATION: the two navigation arms are mutually
 *      exclusive in every derivable state — the session-resolution flow
 *      owns navigation while a `?session=` pointer is present and
 *      unresolved (the pre-existing first-child auto-select is
 *      suppressed), a success pass hands navigation to the one landing
 *      replace, and a failure pass releases ownership back to the
 *      pre-existing auto-select predicate.
 *   2. THE THREE FLOW BRANCHES: success → the report landing replace
 *      `/parent/children/<studentId>?tab=reports&session=<id>`; failure
 *      (denial, network, or unusable pointer) → the transient localized
 *      notice + auto-select fallback; no pointer → the byte-preserved
 *      pre-feature rule (auto-select per the original predicate, zero
 *      notice, zero extra reads).
 *   3. EXACTLY-ONCE LANDING: the landing replace is due only for a pair
 *      whose session id the ledger has not recorded yet — re-renders and
 *      dev-mode effect re-invocations stay navigation-free after the
 *      first write.
 *   4. POINTER BOUNDARIES: the `?session=` value is usable only as a
 *      positive safe integer. An empty, non-numeric, non-positive, or
 *      out-of-range value resolves to `null` and takes the failure path —
 *      the notice + fallback — without a network probe and without ever
 *      throwing. Values beyond the wire's integer width stay
 *      client-parseable; their rejection surfaces as the same failure
 *      path on the read's error arm.
 *   5. PROBE POSTURE: a failed resolution (foreign / nonexistent /
 *      unlinked / severed pointer — indistinguishable behind the constant
 *      denial) arms NO navigation and exposes NO pair — the decision
 *      object carries nothing renderable beyond the constant notice flag,
 *      so the root can never echo the probed id or its (non-)child back.
 *
 * FIXTURES: plain literal inputs (the module is pure) + the real locale
 * leaves for the notice copy — technical test data only, never rendered
 * UI copy. The exact landing URL shape is pinned as a full string.
 *
 * RUNS VIA (in-sandbox): bun run test/scripts/run-test.ts
 * frontend/views/parent/monitoring/ParentChildrenRootContainer.helpers.test.ts
 * — pure unit tier, no server boot, no DB, no React render.
 */

import { describe, expect, test } from "bun:test";
import {
  autoSelectPermitted,
  buildSessionLandingUrl,
  landingReplaceDue,
  parseSessionId,
  resolveSessionFlow,
  type SessionResolutionInputs,
  type SessionTarget,
} from "@/frontend/views/parent/monitoring/ParentChildrenRootContainer.helpers";
import { getDefaultTranslations, loadAllTranslations } from "@/shared/locale/server";

// ---------------------------------------------------------------------------
// The resolved pair fixture — the closed two-field read answer

const PAIR = { sessionId: 2077, studentId: 314 };
const PAIR_COPY: SessionTarget = { ...PAIR };

/** Baseline decision inputs: the pre-feature root with no pointer. */
function inputs(overrides: Partial<SessionResolutionInputs> = {}): SessionResolutionInputs {
  return {
    sessionPresent: false,
    sessionId: null,
    target: undefined,
    targetFailed: false,
    ...overrides,
  };
}

/** A pointer entry whose resolution read answered FORBIDDEN (or failed). */
function deniedInputs(overrides: Partial<SessionResolutionInputs> = {}): SessionResolutionInputs {
  return inputs({ sessionPresent: true, sessionId: PAIR.sessionId, targetFailed: true, ...overrides });
}

// ===========================================================================
describe("resolveSessionFlow — the three flow branches", () => {
  test("success — the resolved pair is the landing target, with no notice", () => {
    const decision = resolveSessionFlow(inputs({ sessionPresent: true, sessionId: PAIR.sessionId, target: PAIR_COPY }));

    expect(decision.phase).toBe("succeeded");
    expect(decision.landingTarget).toEqual(PAIR);
    expect(decision.showUnavailableNotice).toBe(false);
  });

  test("failure — a denial arms no navigation, shows the notice, and releases navigation ownership", () => {
    const decision = resolveSessionFlow(deniedInputs());

    expect(decision.phase).toBe("failed");
    expect(decision.landingTarget).toBeNull();
    expect(decision.showUnavailableNotice).toBe(true);
    expect(autoSelectPermitted(decision.phase, false, true)).toBe(true);
  });

  test("no pointer — the pre-feature shape: idle phase, no notice, no landing", () => {
    const decision = resolveSessionFlow(inputs());

    expect(decision.phase).toBe("idle");
    expect(decision.landingTarget).toBeNull();
    expect(decision.showUnavailableNotice).toBe(false);
  });

  test("pointer in flight — the pending phase stays silent and arms nothing", () => {
    const decision = resolveSessionFlow(inputs({ sessionPresent: true, sessionId: PAIR.sessionId }));

    expect(decision.phase).toBe("pending");
    expect(decision.landingTarget).toBeNull();
    expect(decision.showUnavailableNotice).toBe(false);
  });
});

// ===========================================================================
describe("autoSelectPermitted — the single-writer navigation gate (the race pins)", () => {
  test("resolution pending ⇒ the auto-select is suppressed even with children ready", () => {
    expect(autoSelectPermitted("pending", false, true)).toBe(false);
  });

  test("resolution succeeded ⇒ the auto-select stays suppressed after the landing replace", () => {
    expect(autoSelectPermitted("succeeded", false, true)).toBe(false);
  });

  test("resolution failed ⇒ ownership releases to the pre-existing predicate", () => {
    expect(autoSelectPermitted("failed", false, true)).toBe(true);
  });

  test("no pointer ⇒ the pre-feature predicate governs unchanged", () => {
    expect(autoSelectPermitted("idle", false, true)).toBe(true);
    expect(autoSelectPermitted("idle", true, true)).toBe(false);
    expect(autoSelectPermitted("idle", false, false)).toBe(false);
    expect(autoSelectPermitted("idle", true, false)).toBe(false);
  });

  test("the two navigation arms are mutually exclusive in every derivable state", () => {
    const pointerStates: Array<SessionResolutionInputs> = [
      inputs(),
      inputs({ sessionPresent: true, sessionId: null }), // unusable pointer
      inputs({ sessionPresent: true, sessionId: PAIR.sessionId }), // pending
      deniedInputs(), // denied
      inputs({ sessionPresent: true, sessionId: PAIR.sessionId, target: PAIR_COPY }), // resolved
    ];
    for (const pointerState of pointerStates) {
      const decision = resolveSessionFlow(pointerState);
      // When the landing replace is armed (a resolved pair is due), the
      // auto-select gate must be closed for every children/param shape.
      const landingArmed = landingReplaceDue(decision.landingTarget, null);
      for (const hasStudentParam of [false, true]) {
        for (const childrenReady of [false, true]) {
          const autoSelect = autoSelectPermitted(decision.phase, hasStudentParam, childrenReady);
          if (landingArmed) {
            expect(autoSelect).toBe(false);
          }
          if (autoSelect) {
            expect(decision.landingTarget).toBeNull();
            expect(decision.phase === "idle" || decision.phase === "failed").toBe(true);
            expect(hasStudentParam).toBe(false);
            expect(childrenReady).toBe(true);
          }
        }
      }
    }
  });
});

// ===========================================================================
describe("landingReplaceDue — the exactly-once ledger", () => {
  test("the landing replace is due exactly once per resolved pointer", () => {
    expect(landingReplaceDue(PAIR_COPY, null)).toBe(true);
    expect(landingReplaceDue(PAIR_COPY, PAIR.sessionId)).toBe(false);
    expect(landingReplaceDue(null, null)).toBe(false);
    expect(landingReplaceDue(null, PAIR.sessionId)).toBe(false);
  });

  test("a different pointer re-arms the navigation (each resolution lands its own id)", () => {
    expect(landingReplaceDue({ sessionId: 5, studentId: 9 }, PAIR.sessionId)).toBe(true);
  });
});

// ===========================================================================
describe("parseSessionId — pointer boundaries", () => {
  test("a numeric string parses to the usable session id", () => {
    expect(parseSessionId("2077")).toBe(2077);
    expect(parseSessionId("1")).toBe(1);
    expect(parseSessionId("2147483647")).toBe(2147483647);
  });

  test("empty, non-numeric, non-positive, fractional, and out-of-range values are unusable (null)", () => {
    expect(parseSessionId("")).toBeNull();
    expect(parseSessionId("abc")).toBeNull();
    expect(parseSessionId("0")).toBeNull();
    expect(parseSessionId("-3")).toBeNull();
    expect(parseSessionId("12.5")).toBeNull();
    expect(parseSessionId("NaN")).toBeNull();
    expect(parseSessionId("Infinity")).toBeNull();
    expect(parseSessionId("99999999999999999999")).toBeNull();
  });

  test("an unusable pointer takes the failure path WITHOUT a network probe and never throws", () => {
    // The read is skipped when the parse yields null, so the decision must
    // reach `failed` from the pointer alone — no target, no error flag.
    for (const raw of ["", "abc", "0", "-3", "12.5"]) {
      const decision = resolveSessionFlow(inputs({ sessionPresent: true, sessionId: parseSessionId(raw) }));
      expect(decision.phase).toBe("failed");
      expect(decision.showUnavailableNotice).toBe(true);
      expect(decision.landingTarget).toBeNull();
      expect(autoSelectPermitted(decision.phase, false, true)).toBe(true);
    }
  });

  test("a beyond-integer-width pointer stays client-parseable — its rejection surfaces on the read's error arm", () => {
    const wide = parseSessionId("2147483648");
    expect(wide).toBe(2147483648);
    const decision = resolveSessionFlow(inputs({ sessionPresent: true, sessionId: wide, targetFailed: true }));
    expect(decision.phase).toBe("failed");
    expect(decision.showUnavailableNotice).toBe(true);
    expect(decision.landingTarget).toBeNull();
  });
});

// ===========================================================================
describe("buildSessionLandingUrl — the canonical report landing", () => {
  test("composes /parent/children/<studentId>?tab=reports&session=<sessionId> from the pair alone", () => {
    expect(buildSessionLandingUrl(PAIR_COPY)).toBe("/parent/children/314?tab=reports&session=2077");
    expect(buildSessionLandingUrl({ sessionId: 1, studentId: 42 })).toBe("/parent/children/42?tab=reports&session=1");
  });

  test("the landing pair is the ONLY success output — no renderable session or child fields", () => {
    const decision = resolveSessionFlow(inputs({ sessionPresent: true, sessionId: PAIR.sessionId, target: PAIR_COPY }));
    expect(decision.showUnavailableNotice).toBe(false);
    // The decision object exposes the pair solely through the landing
    // target; phase + flags carry no session or child identity.
    expect(new Set(Object.keys(decision))).toEqual(new Set(["phase", "landingTarget", "showUnavailableNotice"]));
  });
});

// ===========================================================================
describe("probe posture — a failed resolution reveals nothing beyond the notice", () => {
  test("denial arms no navigation and exposes no pair, whatever the probe hit", () => {
    for (const probeId of [PAIR.sessionId, 1, 2_000_000_000]) {
      const decision = resolveSessionFlow(inputs({ sessionPresent: true, sessionId: probeId, targetFailed: true }));
      expect(decision.phase).toBe("failed");
      expect(decision.landingTarget).toBeNull();
      expect(decision.showUnavailableNotice).toBe(true);
    }
  });

  test("the notice copy is the constant parentMonitoring slot — non-empty in BOTH locales, no digits", () => {
    const en = getDefaultTranslations().parentMonitoringTranslations.sessionTargetUnavailableNotice;
    const ar = loadAllTranslations("ar").parentMonitoringTranslations.sessionTargetUnavailableNotice;
    expect(en.length).toBeGreaterThan(0);
    expect(ar.length).toBeGreaterThan(0);
    expect(/\d/.test(en)).toBe(false);
    expect(/\d/.test(ar)).toBe(false);
  });
});
