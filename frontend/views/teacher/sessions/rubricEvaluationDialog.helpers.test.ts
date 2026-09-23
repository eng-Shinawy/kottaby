/**
 * Pure-unit tests for the rubric dialog's draft helpers — currently the
 * saved-at provenance pair (`rubricSavedAtStamps`), the two-line stamp
 * composition the restored notice renders (bounded relative glance +
 * deterministic absolute stamp). NO DOM, NO window — the locale and the
 * rendering clock are plain parameters, the seam the suite pins.
 *
 * Pure unit tier: runs via the mandated runner:
 * `bun run test/scripts/run-test.ts frontend/views/teacher/sessions/rubricEvaluationDialog.helpers.test.ts`.
 */

import { describe, expect, test } from "bun:test";
import { formatApplicantDate } from "@/frontend/lib/i18n/format-date";
import { rubricSavedAtStamps } from "@/frontend/views/teacher/sessions/rubricEvaluationDialog.helpers";

/** The pinned rendering clock — 2026-09-23T12:00:00.000Z. */
const NOW = Date.UTC(2026, 8, 23, 12, 0, 0, 0);

/** The shared 7-day relative window, mirrored from the relative-time module. */
const RELATIVE_WINDOW_MS = 7 * 86_400_000;

describe("rubricSavedAtStamps — relative glance", () => {
  test("a fresh stamp renders the relative glance (non-null inside the window)", () => {
    const stamps = rubricSavedAtStamps(NOW - 5_000, "en", NOW);
    expect(stamps.relative).not.toBeNull();
    expect(stamps.relative).toMatch(/second|now/i);
  });

  test("a stamp exactly at the 7-day window edge still renders relatively", () => {
    const stamps = rubricSavedAtStamps(NOW - RELATIVE_WINDOW_MS, "en", NOW);
    expect(stamps.relative).not.toBeNull();
  });

  test("a stamp one millisecond beyond the window folds the relative glance to null", () => {
    const stamps = rubricSavedAtStamps(NOW - RELATIVE_WINDOW_MS - 1, "en", NOW);
    expect(stamps.relative).toBeNull();
  });

  test("a future-dated stamp never renders a relative glance (a relative future would lie)", () => {
    const stamps = rubricSavedAtStamps(NOW + 30_000, "en", NOW);
    expect(stamps.relative).toBeNull();
  });
});

describe("rubricSavedAtStamps — absolute precision stamp", () => {
  test("the absolute stamp is deterministic and delegates to the shared formatter", () => {
    const savedAtMs = NOW - 5_000;
    const stamps = rubricSavedAtStamps(savedAtMs, "en", NOW);
    expect(stamps.absolute).toBe(formatApplicantDate(new Date(savedAtMs).toISOString(), "en"));
    expect(stamps.absolute).toMatch(/^\d{2}\/\d{2}\/\d{4}, \d{2}:\d{2}$/);
  });

  test("the absolute stamp renders regardless of the relative glance's fate", () => {
    // Out-of-window: the glance is gone, the precision value survives —
    // the composition the out-of-window value slot falls back to.
    const outOfWindow = rubricSavedAtStamps(NOW - RELATIVE_WINDOW_MS - 1, "en", NOW);
    expect(outOfWindow.relative).toBeNull();
    expect(outOfWindow.absolute).not.toBe("");
    // Future: same contract.
    const future = rubricSavedAtStamps(NOW + 60_000, "en", NOW);
    expect(future.absolute).not.toBe("");
  });

  test("the absolute stamp carries locale digits — Latin under `en`, Arabic-Indic under `ar`", () => {
    const savedAtMs = NOW - 60_000;
    const en = rubricSavedAtStamps(savedAtMs, "en", NOW);
    const ar = rubricSavedAtStamps(savedAtMs, "ar", NOW);
    expect(en.absolute).toMatch(/\d/);
    expect(en.absolute).not.toMatch(/[\u0660-\u0669]/);
    expect(ar.absolute).toMatch(/[\u0660-\u0669]/);
  });

  test("the relative glance also resolves per locale (same instant, different ladders)", () => {
    const savedAtMs = NOW - 3_600_000; // one hour old
    const en = rubricSavedAtStamps(savedAtMs, "en", NOW);
    const ar = rubricSavedAtStamps(savedAtMs, "ar", NOW);
    expect(en.relative).not.toBeNull();
    expect(ar.relative).not.toBeNull();
    expect(en.relative).not.toBe(ar.relative);
  });
});
