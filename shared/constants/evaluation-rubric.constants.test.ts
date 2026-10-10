/**
 * Evaluation rubric scoring constants pins.
 * Pure unit tier — NO DB, NO network, NO env reads.
 * Tier 1 (pass threshold): `RUBRIC_PASS_THRESHOLD === 80` — the per-evaluation
 *         minimum score every one of the five rubric submissions must reach
 *         (80 passes, 79 fails — a per-submission minimum, not a mean), and
 *         an `as const` literal type so tsgo fails if a maintainer ever
 *         widens it. A silent pricing/threshold edit before launch fails
 *         loudly here.
 * Tier 1 (cooldowns): the re-application cooldowns are exact day-count
 *         primitives: tajweed 30 days, hifz 90 days (the product's stated
 *         1-month / 3-month minimums, pinned in day-count form), and both
 *         are `as const` literal types so tsgo fails if a maintainer ever
 *         widens them.
 * Tier 2/3/4: N/A for this slice — the behavioral exactness of the stamps
 *         (the failed applicant's `cooldown_until` landing at now+30d /
 *         now+90d, admin extension bounds, expiry boundary) is owned by
 *         the services and journey suites and is deliberately not
 *         duplicated here; these constants have no input surface to abuse.
 *
 * Runs via the mandated runner:
 * `bun run test/scripts/run-test.ts shared/constants/evaluation-rubric.constants.test.ts`.
 */
import { describe, expect, test } from "bun:test";
import {
  HIFZ_COOLDOWN_DAYS,
  RUBRIC_PASS_THRESHOLD,
  TAJWEED_COOLDOWN_DAYS,
} from "@/shared/constants/evaluation-rubric.constants";

// Compile-time pins (conformance-suite idiom): the pass threshold and both
// cooldowns must be exact `as const` literal types — a widened `number`
// declaration fails tsgo here, before any runtime assertion can run.
type Equals<A, B> = [A, B] extends [B, A] ? true : false;
const passThresholdIsExactLiteral: Equals<typeof RUBRIC_PASS_THRESHOLD, 80> = true;
const tajweedDaysAreExactLiteral: Equals<typeof TAJWEED_COOLDOWN_DAYS, 30> = true;
const hifzDaysAreExactLiteral: Equals<typeof HIFZ_COOLDOWN_DAYS, 90> = true;

/** Consumes pin values so tsgo's unused-variable rule stays satisfied. */
const consumePin = (x: unknown): boolean => Boolean(x);

describe("evaluation rubric scoring constants", () => {
  test("RUBRIC_PASS_THRESHOLD === 80 (per-evaluation minimum, frozen — literal-type tripwire)", () => {
    expect(RUBRIC_PASS_THRESHOLD).toBe(80);
    expect(consumePin(passThresholdIsExactLiteral)).toBe(true);
  });

  test("INV-TV4: TAJWEED_COOLDOWN_DAYS === 30 and HIFZ_COOLDOWN_DAYS === 90 (literal-type tripwire)", () => {
    expect(TAJWEED_COOLDOWN_DAYS).toBe(30);
    expect(HIFZ_COOLDOWN_DAYS).toBe(90);
    expect(consumePin(tajweedDaysAreExactLiteral)).toBe(true);
    expect(consumePin(hifzDaysAreExactLiteral)).toBe(true);
  });
});
