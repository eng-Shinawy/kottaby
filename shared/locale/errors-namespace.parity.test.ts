/**
 * `errors`-namespace transport-message key verification
 * · ar+en parity gate + machine-constant exemption pinning.
 *
 * WHAT THIS LOCKS
 *   1. RUNTIME PARITY BELT — the ar/en `errors` leaf maps expose IDENTICAL key
 *      sets with non-empty string values (belt #2: the PRIMARY parity gate is
 *      the compile-time `MessageSchema`/`Translations` typing where BOTH leaf
 *      consts are typed `ErrorsLabels`; any missing key fails `bun tsgo`.
 *      This suite keeps the guarantee enforced even if someone loosens that
 *      typing later).
 *   2. ROUTE EMITTER COVERAGE — EVERY message key the GraphQL gateway transport
 *      actually emits is enumerated DYNAMICALLY from the route SOURCE DISK
 *      (`app/api/graphql/route.ts` seven-step gateway pipeline)
 *      by scanning its `errorsTranslations.<key>` consumption sites — both the
 *      direct-chain and held-variable realization forms — so any new emitter
 *      auto-enters this gate without editing the suite — and every discovered
 *      key MUST exist on BOTH locales.
 *   3. MACHINE-CONSTANT EXEMPTION (negative space) — ZERO locale keys are minted for the
 *      `_health` payload constants: the operator-facing machine payload
 *      (`status/service/version/timestamp`) is deliberately i18n-exempt, so no
 *      `*health*` key may EVER appear in either locale's `errors` map.
 *   4. IMPORT HYGIENE PINS — the touched surface (route.ts) contains ZERO
 *      `next-intl` imports / `getBackendTranslations` / `shared/messages`
 *      references: ONLY the compile-time system via `getServerTranslations`
 *      consumes these labels.
 *   5. DOMAIN-SERVICE KEY PINS — the session-report/homework and
 *      student→teacher evaluation error keys (conflict + validation denials
 *      emitted by the domain services, NOT by the transport gateway) are
 *      pinned explicitly in BOTH locales, since the route-source discovery
 *      above cannot see service-tier consumers.
 *      The session-arbitration denial keys (disputeResolutionMismatch,
 *      partialRefundAmountInvalid — emitted by the arbitration service and
 *      surfaced verbatim inside the admin resolve dialog) are pinned with
 *      the same belt.
 *   6. RUBRIC-SCORING KEY PINS — the seven rubric-submission denials
 *      (five pre-DB validation rejections + two state-conflict rejections)
 *      are pinned in BOTH locales as flat, placeholder-free copy.
 *   7. PASSWORD-SURFACE KEY PINS — the forced-reset gate deny
 *      (passwordChangeRequired) and the two self-service change-password
 *      validation rejects (currentPasswordInvalid, newPasswordSameAsCurrent)
 *      are pinned in BOTH locales as flat, placeholder-free copy (emitted by
 *      the Apollo gate plugin + the auth domain service, not by route.ts).
 *
 * ENVELOPE LOCALIZATION (rendering-path evidence): behavioral proof that the
 * transport rejection envelopes carry the LOCALIZED value (never a literal) is
 * owned by `app/api/graphql/test/graphql-route.transport.test.ts` — it resolves
 * `getServerTranslations("en"|"ar").errorsTranslations.badRequest` and asserts
 * equality against the WIRE message for every 400/405/413 rejection (ar parity
 * rows included).
 *
 * Pure unit tier — NO server boot, NO network, NO DB. Runs via the mandated
 * runner: `bun run test/scripts/run-test.ts shared/locale/errors-namespace.parity.test.ts`.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { errorsAr } from "@/shared/locale/ar/errors";
import { errorsEn } from "@/shared/locale/en/errors";
import type { ErrorMessageKey, ErrorsLabels } from "@/shared/locale/types/errors";

// ─── Route-source emission discovery ─────────────────────────────────────────

/** Consumption-site scanner: every `errorsTranslations.<key>` use in route.ts.
 *  Matches BOTH realization forms the gateway ships: direct chains
 *  (`getServerTranslations(…).errorsTranslations.<key>`) and the held-variable
 *  form (`const t = …errorsTranslations; message: t.<key>`). */
function routeEmittedErrorsKeys(): string[] {
  const source = readFileSync(resolve(process.cwd(), "app/api/graphql/route.ts"), "utf8");
  const seen = new Set<string>();
  const consumptionSite = /errorsTranslations\.([A-Za-z]\w*)/g;
  let match = consumptionSite.exec(source);
  while (match !== null) {
    if (typeof match[1] === "string") {
      seen.add(match[1]);
    }
    match = consumptionSite.exec(source);
  }
  return [...seen].toSorted((a, b) => a.localeCompare(b));
}

/**
 * Reads one non-empty-string value slot off a locale map — throws otherwise.
 * Reserved for transport emitter rows that always resolve to top-level leaf
 * strings (the route gateway never emits a grouped sub-block handle).
 */
function nonEmptyLabelOf(localeMap: ErrorsLabels, key: string, localeName: string): string {
  const value: unknown = Reflect.get(localeMap, key);
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`errors.${localeName}.${key} must be a non-empty localized string`);
  }
  return value;
}

/** Every `{name}` ICU placeholder occurring in a template, deduplicated + sorted. */
function icuPlaceholdersOf(template: string): string[] {
  const seen = new Set<string>();
  const placeholder = /\{([A-Za-z]\w*)\}/g;
  let match = placeholder.exec(template);
  while (match !== null) {
    if (typeof match[1] === "string") {
      seen.add(match[1]);
    }
    match = placeholder.exec(template);
  }
  return [...seen].toSorted((a, b) => a.localeCompare(b));
}

/**
 * Walks a locale map depth-first and throws on the first violation: any leaf
 * that is not a non-empty string. Grouped sub-blocks (object-valued slots)
 * keep the same zero-dead-key discipline as top-level string slots — every
 * nested leaf must be a non-empty localized string. Cross-map leaf-key drift
 * is caught by the compile-time `ErrorsLabels` typing (the primary gate)
 * together with the top-level key-set assertion in the suite below.
 */
function assertEveryLeafNonEmpty(localeMap: object, localeName: string, pathPrefix = `errors.${localeName}`): void {
  for (const key of Object.keys(localeMap)) {
    const value: unknown = Reflect.get(localeMap, key);
    const path = `${pathPrefix}.${key}`;
    if (typeof value === "string") {
      if (value.length === 0) {
        throw new Error(`${path} must be a non-empty localized string`);
      }
      continue;
    }
    if (value !== null && typeof value === "object") {
      assertEveryLeafNonEmpty(value, localeName, path);
      continue;
    }
    throw new Error(`${path} must be a non-empty localized string or a grouped labels block`);
  }
}

// ===========================================================================
describe("compile-time parity mirror — ar/en key sets agree", () => {
  test("identical sorted key sets across BOTH locale sources", () => {
    const arKeys = Object.keys(errorsAr).toSorted((a, b) => a.localeCompare(b));
    const enKeys = Object.keys(errorsEn).toSorted((a, b) => a.localeCompare(b));

    expect(arKeys.length).toBeGreaterThan(0);
    expect(enKeys).toEqual(arKeys);
  });

  test("every leaf value on BOTH maps is a non-empty localized string (zero dead keys)", () => {
    expect(() => assertEveryLeafNonEmpty(errorsAr, "ar")).not.toThrow();
    expect(() => assertEveryLeafNonEmpty(errorsEn, "en")).not.toThrow();
  });
});

// ─── Session-report/homework domain-service key pins ───────────────────────

/**
 * The `errors` keys minted for the session-report/homework service surface.
 * The route-discovery gate above only scans the transport gateway's own
 * emission sites; these keys are consumed by the domain services through
 * `getServerTranslations(locale).errorsTranslations`, so they are pinned
 * here — removing a key from BOTH locale maps simultaneously still fails
 * this suite (the same belt the mandated inventories in the sibling
 * namespace suites provide).
 */
const SESSION_REPORT_HOMEWORK_KEYS = [
  "sessionReportAlreadyExists",
  "homeworkAlreadyGraded",
  "sessionReportNotesRequired",
  "sessionReportNotesTooLong",
  "sessionRatingRange",
  "homeworkGradeRange",
  "homeworkAyahRangeInvalid",
  "homeworkSurahJuzInvalid",
  "homeworkAssignmentBlocksRequired",
  "homeworkRequiresReport",
] as const;

// ===========================================================================
describe("session-report/homework service keys — pinned in BOTH locales", () => {
  test("the domain inventory is exhaustive (no silent drift on the pinned session-report keys)", () => {
    const pinned = new Set<string>(SESSION_REPORT_HOMEWORK_KEYS);
    for (const key of Object.keys(errorsAr)) {
      if (key.startsWith("sessionReport") || key.startsWith("homework") || key === "sessionRatingRange") {
        expect(pinned.has(key)).toBe(true);
      }
    }
  });

  test.each([...SESSION_REPORT_HOMEWORK_KEYS])("domain key `%s` resolves non-empty in BOTH ar and en maps", key => {
    expect(nonEmptyLabelOf(errorsAr, key, "ar").length).toBeGreaterThan(0);
    expect(nonEmptyLabelOf(errorsEn, key, "en").length).toBeGreaterThan(0);
    // Key must be part of the COMPILE-TIME schema too — Reflect-only
    // additions (untyped holes) are prohibited by the ErrorsLabels contract.
    expect(Object.hasOwn(errorsEn, key)).toBe(true);
  });
});

// ─── Teacher-evaluation domain-service key pins ─────────────────────────────

/**
 * The `errors` keys minted for the student→teacher evaluation service
 * surface. Like the session-report/homework pins above, these are consumed
 * by the domain services through `getServerTranslations(locale)
 * .errorsTranslations`, so the route-source discovery cannot see them —
 * they are pinned here: removing a key from BOTH locale maps
 * simultaneously still fails this suite.
 */
const TEACHER_EVALUATION_KEYS = [
  "evaluationSessionNotCompleted",
  "evaluationAlreadySubmitted",
  "teacherRatingInvalid",
] as const;

// ===========================================================================
describe("teacher-evaluation service keys — pinned in BOTH locales", () => {
  test("the domain inventory is exhaustive (no silent drift on the pinned evaluation keys)", () => {
    const pinned = new Set<string>(TEACHER_EVALUATION_KEYS);
    const bookingPinned = new Set<string>(EVALUATION_BOOKING_KEYS);
    for (const key of Object.keys(errorsAr)) {
      // The evaluation-BOOKING denials live in their own pinned inventory
      // below — the rating-surface pin stays exclusive to its own keys.
      if ((key.startsWith("evaluation") && !bookingPinned.has(key)) || key.startsWith("teacherRating")) {
        expect(pinned.has(key)).toBe(true);
      }
    }
  });

  test.each([...TEACHER_EVALUATION_KEYS])("domain key `%s` resolves non-empty in BOTH ar and en maps", key => {
    expect(nonEmptyLabelOf(errorsAr, key, "ar").length).toBeGreaterThan(0);
    expect(nonEmptyLabelOf(errorsEn, key, "en").length).toBeGreaterThan(0);
    // Key must be part of the COMPILE-TIME schema too — Reflect-only
    // additions (untyped holes) are prohibited by the ErrorsLabels contract.
    expect(Object.hasOwn(errorsEn, key)).toBe(true);
  });
});

// ─── Applicant-lifecycle domain-service key pins ───────────────────────────

/**
 * The `errors` keys minted for the applicant-lifecycle service surface
 * (profile + purchase-guard + re-application + admin-cooldown-extension +
 * admin evaluation-override denials). Like the session-report inventory
 * above, these are consumed by the domain service through
 * `getServerTranslations(locale).errorsTranslations`, so the route-source
 * discovery cannot see them — they are pinned here in BOTH locales
 * (removing a key from both maps simultaneously still fails).
 */
const APPLICANT_LIFECYCLE_KEYS = [
  "applicantNotFound",
  "applicantCooldownActive",
  "applicantStatusCorrupt",
  "applicantAlreadyCertified",
  "applicantCooldownExtensionInvalid",
  "applicantOverrideCooldownInvalid",
  "applicantOverrideNotPassed",
  "applicantNoActiveCooldown",
] as const;

// ===========================================================================
describe("applicant-lifecycle service keys — pinned in BOTH locales", () => {
  test("the domain inventory is exhaustive (no silent drift on the pinned applicant keys)", () => {
    const pinned = new Set<string>(APPLICANT_LIFECYCLE_KEYS);
    const bookingPinned = new Set<string>(EVALUATION_BOOKING_KEYS);
    const rubricPinned = new Set<string>(EVALUATION_RUBRIC_SCORING_KEYS);
    for (const key of Object.keys(errorsAr)) {
      // The evaluation-booking governance denial and the rubric finalization
      // denial each live in their own pinned inventories below — the
      // lifecycle pin stays exclusive to its own keys.
      if (key.startsWith("applicant") && !bookingPinned.has(key) && !rubricPinned.has(key)) {
        expect(pinned.has(key)).toBe(true);
      }
    }
  });

  test.each([...APPLICANT_LIFECYCLE_KEYS])("domain key `%s` resolves non-empty in BOTH ar and en maps", key => {
    expect(nonEmptyLabelOf(errorsAr, key, "ar").length).toBeGreaterThan(0);
    expect(nonEmptyLabelOf(errorsEn, key, "en").length).toBeGreaterThan(0);
    // Key must be part of the COMPILE-TIME schema too — Reflect-only
    // additions (untyped holes) are prohibited by the ErrorsLabels contract.
    expect(Object.hasOwn(errorsEn, key)).toBe(true);
  });

  test("applicantAlreadyCertified carries ZERO ICU placeholders in BOTH locales", () => {
    // The certified denial is a flat copy consumed verbatim by every
    // caller — no interpolation slot may ever slip into either locale.
    expect(icuPlaceholdersOf(nonEmptyLabelOf(errorsAr, "applicantAlreadyCertified", "ar"))).toEqual([]);
    expect(icuPlaceholdersOf(nonEmptyLabelOf(errorsEn, "applicantAlreadyCertified", "en"))).toEqual([]);
  });

  test("applicantCooldownExtensionInvalid carries ZERO ICU placeholders in BOTH locales", () => {
    // The extension bounds are stated inside the copy itself — a static
    // leaf, so no interpolation slot may ever slip into either locale.
    expect(icuPlaceholdersOf(nonEmptyLabelOf(errorsAr, "applicantCooldownExtensionInvalid", "ar"))).toEqual([]);
    expect(icuPlaceholdersOf(nonEmptyLabelOf(errorsEn, "applicantCooldownExtensionInvalid", "en"))).toEqual([]);
  });

  test("the three override leaves carry ZERO ICU placeholders in BOTH locales", () => {
    // Every override denial is flat copy consumed verbatim by the mutation's
    // error boundary — the bounds are stated inside the sentence itself and
    // no identifier may ever slip into either locale.
    for (const key of [
      "applicantOverrideCooldownInvalid",
      "applicantOverrideNotPassed",
      "applicantNoActiveCooldown",
    ] as const) {
      expect(icuPlaceholdersOf(nonEmptyLabelOf(errorsAr, key, "ar"))).toEqual([]);
      expect(icuPlaceholdersOf(nonEmptyLabelOf(errorsEn, key, "en"))).toEqual([]);
    }
  });
});

// ─── Evaluation-booking domain-service key pins ──────────────────────────────

/**
 * The `errors` keys minted for the evaluation-booking service surface (the
 * five-session loop's loop-complete, capacity, distinctness, governance,
 * and cycle denials). Like the pins above, these are consumed by the domain
 * service through `getServerTranslations(locale).errorsTranslations`, so
 * the route-source discovery cannot see them — they are pinned here in
 * BOTH locales (removing a key from both maps simultaneously still fails).
 */
const EVALUATION_BOOKING_KEYS = [
  "evaluationLoopComplete",
  "noEvaluationCreditsRemaining",
  "evaluatorAlreadyUsed",
  "applicantNotInEvaluation",
  "verificationSubscriptionNotActive",
] as const;

// ===========================================================================
describe("evaluation-booking service keys — pinned in BOTH locales", () => {
  test.each([...EVALUATION_BOOKING_KEYS])("domain key `%s` resolves non-empty in BOTH ar and en maps", key => {
    expect(nonEmptyLabelOf(errorsAr, key, "ar").length).toBeGreaterThan(0);
    expect(nonEmptyLabelOf(errorsEn, key, "en").length).toBeGreaterThan(0);
    // Key must be part of the COMPILE-TIME schema too — Reflect-only
    // additions (untyped holes) are prohibited by the ErrorsLabels contract.
    expect(Object.hasOwn(errorsEn, key)).toBe(true);
  });

  test("the five booking denials carry ZERO ICU placeholders in BOTH locales", () => {
    // Each denial is flat copy consumed verbatim by the booking dialog's
    // error mapping — no interpolated value may ever slip into either locale.
    for (const key of EVALUATION_BOOKING_KEYS) {
      expect(icuPlaceholdersOf(nonEmptyLabelOf(errorsAr, key, "ar"))).toEqual([]);
      expect(icuPlaceholdersOf(nonEmptyLabelOf(errorsEn, key, "en"))).toEqual([]);
    }
  });
});

// ─── Rubric-scoring domain-service key pins ───────────────────────────────

/**
 * The `errors` keys minted for the rubric-scoring service surface: the five
 * pre-DB validation denials (score range, notes bound, the
 * weakness-iff-failing rule in both directions, and the fail-closed
 * weakness guard) plus the two state-conflict denials (uncompleted session,
 * already-finalized application). Like the pins above, these are consumed
 * by the domain service through `getServerTranslations(locale)
 * .errorsTranslations`, so the route-source discovery cannot see them —
 * they are pinned here in BOTH locales (removing a key from both maps
 * simultaneously still fails).
 */
const EVALUATION_RUBRIC_SCORING_KEYS = [
  "rubricScoreInvalid",
  "rubricNotesRequired",
  "rubricWeaknessRequired",
  "rubricWeaknessNotAllowed",
  "rubricWeaknessInvalid",
  "rubricSessionNotCompleted",
  "applicantAlreadyFinalized",
] as const;

// ===========================================================================
describe("rubric-scoring service keys — pinned in BOTH locales", () => {
  test("the domain inventory is exhaustive (no silent drift on the pinned rubric keys)", () => {
    const pinned = new Set<string>(EVALUATION_RUBRIC_SCORING_KEYS);
    for (const key of Object.keys(errorsAr)) {
      if (key.startsWith("rubric") || key === "applicantAlreadyFinalized") {
        expect(pinned.has(key)).toBe(true);
      }
    }
  });

  test.each([...EVALUATION_RUBRIC_SCORING_KEYS])("domain key `%s` resolves non-empty in BOTH ar and en maps", key => {
    expect(nonEmptyLabelOf(errorsAr, key, "ar").length).toBeGreaterThan(0);
    expect(nonEmptyLabelOf(errorsEn, key, "en").length).toBeGreaterThan(0);
    // Key must be part of the COMPILE-TIME schema too — Reflect-only
    // additions (untyped holes) are prohibited by the ErrorsLabels contract.
    expect(Object.hasOwn(errorsEn, key)).toBe(true);
    expect(Object.hasOwn(errorsAr, key)).toBe(true);
  });

  test("the seven rubric denials carry ZERO ICU placeholders in BOTH locales", () => {
    // Each denial is flat copy consumed verbatim by the evaluator dialog's
    // error mapping — no interpolated value may ever slip into either locale.
    for (const key of EVALUATION_RUBRIC_SCORING_KEYS) {
      expect(icuPlaceholdersOf(nonEmptyLabelOf(errorsAr, key, "ar"))).toEqual([]);
      expect(icuPlaceholdersOf(nonEmptyLabelOf(errorsEn, key, "en"))).toEqual([]);
    }
  });
});

// ===========================================================================
describe("session-arbitration denial keys — flat domain additions on BOTH locales", () => {
  // The arbitration service resolves these denials through
  // `getServerTranslations(locale).errorsTranslations` and the admin resolve
  // dialog raises the same two slots client-side — the route-discovery gate
  // sees neither consumer, so the inventory is pinned here.
  const arbitrationDenialKeys = ["disputeResolutionMismatch", "partialRefundAmountInvalid"];

  test.each(arbitrationDenialKeys)("domain key `%s` resolves non-empty in BOTH ar and en maps", key => {
    expect(nonEmptyLabelOf(errorsAr, key, "ar").length).toBeGreaterThan(0);
    expect(nonEmptyLabelOf(errorsEn, key, "en").length).toBeGreaterThan(0);
    // Key must be part of the COMPILE-TIME schema too — Reflect-only
    // additions (untyped holes) are prohibited by the ErrorsLabels contract.
    expect(Object.hasOwn(errorsEn, key)).toBe(true);
    expect(Object.hasOwn(errorsAr, key)).toBe(true);
  });
});

// ─── Password-surface domain-service key pins ─────────────────────────────

/**
 * The `errors` keys minted for the password-governance surface: the
 * forced-reset gate deny (FORBIDDEN / PASSWORD_CHANGE_REQUIRED, emitted by
 * the Apollo operation-guard plugin) plus the two self-service
 * change-password validation rejects (CURRENT_PASSWORD_INVALID,
 * NEW_PASSWORD_SAME_AS_CURRENT, emitted by the auth domain service). The
 * route-source discovery cannot see these consumers — they are pinned here
 * in BOTH locales (removing a key from both maps simultaneously still
 * fails).
 */
const PASSWORD_SURFACE_KEYS = ["passwordChangeRequired", "currentPasswordInvalid", "newPasswordSameAsCurrent"] as const;

// ===========================================================================
describe("password-surface service keys — pinned in BOTH locales", () => {
  test.each([...PASSWORD_SURFACE_KEYS])("domain key `%s` resolves non-empty in BOTH ar and en maps", key => {
    expect(nonEmptyLabelOf(errorsAr, key, "ar").length).toBeGreaterThan(0);
    expect(nonEmptyLabelOf(errorsEn, key, "en").length).toBeGreaterThan(0);
    // Key must be part of the COMPILE-TIME schema too — Reflect-only
    // additions (untyped holes) are prohibited by the ErrorsLabels contract.
    expect(Object.hasOwn(errorsEn, key)).toBe(true);
    expect(Object.hasOwn(errorsAr, key)).toBe(true);
  });

  test("the three password-surface denials carry ZERO ICU placeholders in BOTH locales", () => {
    // Each denial is flat copy consumed verbatim by the gate plugin / the
    // change-password form's error mapping — no interpolated value may ever
    // slip into either locale.
    for (const key of PASSWORD_SURFACE_KEYS) {
      expect(icuPlaceholdersOf(nonEmptyLabelOf(errorsAr, key, "ar"))).toEqual([]);
      expect(icuPlaceholdersOf(nonEmptyLabelOf(errorsEn, key, "en"))).toEqual([]);
    }
  });
});

// ===========================================================================
describe("route emitters — every transport key exists in BOTH locales", () => {
  const emitted = routeEmittedErrorsKeys();

  test("discovery actually found the known pipeline emitters (suite cannot rot green)", () => {
    // The gateway's seven-step pipeline emits at least these three sites:
    // step-1 transport rejections, the 429 limiter branch, and the POST catch
    // fallback. If even ONE disappears from route.ts the scan itself failed.
    for (const required of ["badRequest", "rateLimitExceeded", "internalServerError"]) {
      expect(emitted).toContain(required);
    }
  });

  test.each(emitted)("emitted key `%s` resolves in BOTH ar and en maps", key => {
    expect(nonEmptyLabelOf(errorsAr, key, "ar").length).toBeGreaterThan(0);
    expect(nonEmptyLabelOf(errorsEn, key, "en").length).toBeGreaterThan(0);
    // Key must be part of the COMPILE-TIME schema too — Reflect-only additions
    // (untyped holes) are prohibited by the ErrorsLabels contract.
    expect(Object.hasOwn(errorsEn, key)).toBe(true);
  });
});

// ===========================================================================
describe("recitation record denial keys — flat domain additions on BOTH locales", () => {
  // Flatness is compile-time proven here: `ErrorMessageKey` admits ONLY
  // `ErrorsLabels` slots typed as plain `string`, so nesting either key under
  // a grouped sub-block fails `bun tsgo` before this suite ever runs.
  const recitationDenialKeys: ErrorMessageKey[] = ["recitationAlreadyExists", "recitationSessionNotWriteable"];

  test.each(recitationDenialKeys)("domain key `%s` is a top-level non-empty string on BOTH locale maps", key => {
    expect(Object.hasOwn(errorsAr, key)).toBe(true);
    expect(Object.hasOwn(errorsEn, key)).toBe(true);
    expect(nonEmptyLabelOf(errorsAr, key, "ar").length).toBeGreaterThan(0);
    expect(nonEmptyLabelOf(errorsEn, key, "en").length).toBeGreaterThan(0);
  });
});

// ===========================================================================
describe("machine-constant exemption — `_health` payload constants stay OUT of locale files", () => {
  test("ZERO health-flavored keys exist in either locale's errors map", () => {
    for (const key of [...Object.keys(errorsAr), ...Object.keys(errorsEn)]) {
      expect(key.toLowerCase().includes("health")).toBe(false);
    }
  });
});

// ===========================================================================
describe("touched-surface import hygiene (route.ts)", () => {
  test("gateway route references ONLY the compile-time system — zero next-intl/getBackendTranslations/shared/messages", () => {
    const source = readFileSync(resolve(process.cwd(), "app/api/graphql/route.ts"), "utf8");

    expect(source.includes("next-intl")).toBe(false);
    expect(source.includes("getBackendTranslations")).toBe(false);
    expect(source.includes("shared/messages")).toBe(false);
    // Positive control — the compile-time consumer it MUST keep using:
    expect(source.includes("getServerTranslations")).toBe(true);
  });
});
