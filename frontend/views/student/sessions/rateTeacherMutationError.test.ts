/**
 * Paired suite — the submit-error arms of the student's teacher-rating
 * mutation (`handleRateTeacherMutationError`).
 *
 * WHAT THIS LOCKS
 *   1. EXCLUSIVE branch dispatch: each wire `extensions.code` lands on
 *      exactly ONE arm — the not-found eviction arm (`SESSION_NOT_FOUND`
 *      family), the two typed notice arms (`EVALUATION_ALREADY_SUBMITTED`,
 *      `EVALUATION_SESSION_NOT_COMPLETED`), the inline rating-field arm,
 *      and the localized toast fallbacks (`FORBIDDEN`, everything else).
 *      A code can never double-fire (no notice rides along with a toast,
 *      no toast rides along with an eviction).
 *   2. `SESSION_NOT_FOUND` → `evictSessionFromListFields` receives the
 *      arms' cache, the session id, and the STUDENT role list fields (the
 *      eviction helper's own cache semantics are the sibling helpers' and
 *      their consumers' business — the arms' contract here is the
 *      invocation wiring), then `onSessionMissing` drops the row UI-side.
 *      The cache-eviction helper is a module-boundary recording fake (the
 *      sweep-sessions route suite's mock precedent): the REAL list-field
 *      constants stay live so the "right field list" assertion is honest.
 *   3. `VALIDATION` with a `rating`-addressed `extensions.fields[]` pair →
 *      the server-localized wire message echoed VERBATIM onto the inline
 *      field arm (the paired `mutationFieldErrors` suite owns the
 *      projection's own filtering semantics); a VALIDATION carrying only
 *      foreign field paths falls through to the localized validation toast.
 *   4. Unknown codes, legacy-aliased codes with no arm of their own
 *      (`RATE_LIMIT_EXCEEDED` normalizes onto the unhandled `RATE_LIMITED`
 *      row), and code-less failures all degrade to the generic toast —
 *      never an eviction, never a typed notice.
 *
 * FIXTURES: genuine Apollo Client v4 `CombinedGraphQLErrors` containers —
 * exactly what the mutation result hands the `onError` handler — mirroring
 * `error-link.map.test.ts`. Fixture field texts are technical test data,
 * never rendered UI copy; every expected
 * user-facing COPY the arms echo resolves through the real locale objects
 * (en resolved + ar parity-probed, same mechanism as the paired suites).
 *
 * RUNS VIA (in-sandbox): bun run test/scripts/run-test.ts
 * frontend/views/student/sessions/rateTeacherMutationError.test.ts — pure
 * unit tier, no server boot, no DB, no React render.
 */

import { beforeEach, describe, expect, mock, test } from "bun:test";
import { type ApolloCache, CombinedGraphQLErrors, InMemoryCache } from "@apollo/client";
import * as sessionListCacheEviction from "@/frontend/views/student/sessions/sessionListCacheEviction";

// ---------------------------------------------------------------------------
// Module-boundary recording fake (sweep-sessions route precedent)
//
// The arms must exercise ONLY their own code dispatch here; the eviction
// helper's cache-modify semantics belong to `sessionListCacheEviction.ts`
// and the suites that drive it against a real cache. The REAL list-field
// constants are re-exported so the arms' field-list wiring stays pinned.

const evictionCalls: Array<{ cache: ApolloCache; sessionId: string; listFields: readonly string[] }> = [];

void mock.module("@/frontend/views/student/sessions/sessionListCacheEviction", () => ({
  ...sessionListCacheEviction,
  evictSessionFromListFields: (cache: ApolloCache, sessionId: string, listFields: readonly string[]): void => {
    evictionCalls.push({ cache, sessionId, listFields });
  },
}));

// The module-under-test import MUST trail its mock.module registration
// (bun evaluates the module registry in import order — the same ordering
// contract the sweep-sessions route suite documents).
import { handleRateTeacherMutationError } from "@/frontend/views/student/sessions/rateTeacherMutationError";
import { getDefaultTranslations, loadAllTranslations } from "@/shared/locale/server";

// ---------------------------------------------------------------------------
// Translation-backed expectations (never hardcoded copy)

const enErrorsTranslations = getDefaultTranslations().errorsTranslations;
const enSessionsTranslations = getDefaultTranslations().sessionsTranslations;

const enMessages = {
  validation: enErrorsTranslations.validation,
  forbidden: enErrorsTranslations.forbidden,
  genericError: enSessionsTranslations.genericError,
};

const arErrorsTranslations = loadAllTranslations("ar").errorsTranslations;
const arSessionsTranslations = loadAllTranslations("ar").sessionsTranslations;

// ---------------------------------------------------------------------------
// Fixtures — genuine Apollo v4 containers, mirroring error-link.map.test.ts

type FixtureItem = { readonly message: string; readonly extensions?: Record<string, unknown> };

/** Builds the genuine Apollo v4 container from wire-shaped error items. */
function combinedError(items: readonly FixtureItem[]): CombinedGraphQLErrors {
  return new CombinedGraphQLErrors({
    errors: items.map(item => ({
      message: item.message,
      ...(item.extensions === undefined ? {} : { extensions: item.extensions }),
    })),
  });
}

const SESSION_ID = "9211";

/** Wire code item with only `extensions.code` set (masked transport surface). */
function codedError(code: string): CombinedGraphQLErrors {
  return combinedError([{ message: `${code} (masked transport surface)`, extensions: { code } }]);
}

/** The server-localized `rating` field pair echoed verbatim (fixture DATA). */
const RATING_WIRE_MESSAGE = "rating field server-localized wire pair (masked transport surface)";

const RATING_FIELD_PAIR = { field: "rating", code: "TEACHER_RATING_INVALID", message: RATING_WIRE_MESSAGE };

function validationError(fields: readonly unknown[]): CombinedGraphQLErrors {
  return combinedError([
    { message: "Submission failed validation.", extensions: { code: "VALIDATION", fields: [...fields] } },
  ]);
}

// ---------------------------------------------------------------------------
// Arms recorder — every arm captured, everything else assertably untouched

interface ArmRecorder {
  readonly missing: string[];
  readonly notCompleted: string[];
  readonly alreadySubmitted: string[];
  readonly ratingFieldMessages: string[];
  readonly failures: string[];
}

function recordArms(): ArmRecorder {
  return { missing: [], notCompleted: [], alreadySubmitted: [], ratingFieldMessages: [], failures: [] };
}

/** Builds the arms with a FRESH cache per call and every arm recorded. */
function arms(rec: ArmRecorder): {
  cache: ApolloCache;
  sessionId: string;
  onSessionMissing: (sessionId: string) => void;
  onSessionNotCompleted: (sessionId: string) => void;
  onAlreadySubmitted: (sessionId: string) => void;
  onRatingFieldError: (message: string) => void;
  onFailure: (message: string) => void;
  validationCopy: string;
  forbiddenCopy: string;
  genericErrorCopy: string;
} {
  return {
    cache: new InMemoryCache(),
    sessionId: SESSION_ID,
    onSessionMissing: sessionId => {
      rec.missing.push(sessionId);
    },
    onSessionNotCompleted: sessionId => {
      rec.notCompleted.push(sessionId);
    },
    onAlreadySubmitted: sessionId => {
      rec.alreadySubmitted.push(sessionId);
    },
    onRatingFieldError: message => {
      rec.ratingFieldMessages.push(message);
    },
    onFailure: message => {
      rec.failures.push(message);
    },
    validationCopy: enMessages.validation,
    forbiddenCopy: enMessages.forbidden,
    genericErrorCopy: enMessages.genericError,
  };
}

/** The unset arms of a dispatch — the exclusivity half of every assertion. */
function unsetArms(rec: ArmRecorder, fired: keyof ArmRecorder): void {
  for (const key of ["missing", "notCompleted", "alreadySubmitted", "ratingFieldMessages", "failures"] as const) {
    if (key === fired) continue;
    expect(rec[key]).toEqual([]);
  }
}

beforeEach(() => {
  evictionCalls.length = 0;
});

// ===========================================================================
describe("handleRateTeacherMutationError — exclusive arm dispatch", () => {
  test("SESSION_NOT_FOUND → student-list eviction wired with the arms' cache, id, and field list, then onSessionMissing", () => {
    const rec = recordArms();
    const wiredArms = arms(rec);

    handleRateTeacherMutationError(codedError("SESSION_NOT_FOUND"), wiredArms);

    expect(rec.missing).toEqual([SESSION_ID]);
    // The eviction is invoked with EXACTLY the student role list fields —
    // the SAME array the real helper module exports (reference identity).
    expect(evictionCalls).toHaveLength(1);
    expect(evictionCalls[0]?.cache).toBe(wiredArms.cache);
    expect(evictionCalls[0]?.sessionId).toBe(SESSION_ID);
    expect(evictionCalls[0]?.listFields).toBe(sessionListCacheEviction.STUDENT_SESSION_LIST_FIELDS);
    expect(evictionCalls[0]?.listFields).toEqual(["myStudentSessions"]);
    // No second arm fired: no notice, no toast, no inline field error.
    unsetArms(rec, "missing");
  });

  test("the not-found FAMILY predicate holds (canonical NOT_FOUND evicts too)", () => {
    const rec = recordArms();

    handleRateTeacherMutationError(codedError("NOT_FOUND"), arms(rec));

    expect(rec.missing).toEqual([SESSION_ID]);
    expect(evictionCalls).toHaveLength(1);
    expect(evictionCalls[0]?.sessionId).toBe(SESSION_ID);
    unsetArms(rec, "missing");
  });

  test("EVALUATION_ALREADY_SUBMITTED → the write-once notice arm ONLY (no eviction, no toast)", () => {
    const rec = recordArms();

    handleRateTeacherMutationError(codedError("EVALUATION_ALREADY_SUBMITTED"), arms(rec));

    expect(rec.alreadySubmitted).toEqual([SESSION_ID]);
    unsetArms(rec, "alreadySubmitted");
    // The rating EXISTS — the cache must stay untouched.
    expect(evictionCalls).toHaveLength(0);
  });

  test("EVALUATION_SESSION_NOT_COMPLETED → the gate-reject notice arm ONLY (no eviction, no toast)", () => {
    const rec = recordArms();

    handleRateTeacherMutationError(codedError("EVALUATION_SESSION_NOT_COMPLETED"), arms(rec));

    expect(rec.notCompleted).toEqual([SESSION_ID]);
    unsetArms(rec, "notCompleted");
    expect(evictionCalls).toHaveLength(0);
  });

  test("VALIDATION with a rating-addressed fields[] pair → the wire message inline, foreign pairs ignored", () => {
    const rec = recordArms();

    handleRateTeacherMutationError(
      validationError([
        { field: "notes", code: "NOTES_INVALID", message: "notes field wire pair must never surface" },
        RATING_FIELD_PAIR,
      ]),
      arms(rec)
    );

    expect(rec.ratingFieldMessages).toEqual([RATING_WIRE_MESSAGE]);
    unsetArms(rec, "ratingFieldMessages");
    expect(evictionCalls).toHaveLength(0);
  });

  test("VALIDATION with NO rating-addressed pair → the localized validation toast fallback", () => {
    const rec = recordArms();

    handleRateTeacherMutationError(
      validationError([{ field: "notes", code: "NOTES_INVALID", message: "a foreign field wire pair" }]),
      arms(rec)
    );

    expect(rec.failures).toEqual([enMessages.validation]);
    unsetArms(rec, "failures");
    expect(evictionCalls).toHaveLength(0);
  });

  test("FORBIDDEN → the localized forbidden toast fallback only", () => {
    const rec = recordArms();

    handleRateTeacherMutationError(codedError("FORBIDDEN"), arms(rec));

    expect(rec.failures).toEqual([enMessages.forbidden]);
    unsetArms(rec, "failures");
    expect(evictionCalls).toHaveLength(0);
  });

  test("unknown codes, legacy aliases without an arm, and code-less failures degrade to the generic toast", () => {
    for (const fallbackError of [
      codedError("TOTALLY_UNKNOWN_CODE"),
      codedError("RATE_LIMIT_EXCEEDED"), // normalizes onto the unhandled RATE_LIMITED row
      combinedError([{ message: "no extensions at all" }]),
      new Error("Failed to fetch"),
    ]) {
      const rec = recordArms();
      handleRateTeacherMutationError(fallbackError, arms(rec));
      expect(rec.failures).toEqual([enMessages.genericError]);
      unsetArms(rec, "failures");
      expect(evictionCalls).toHaveLength(0);
    }
  });
});

// ===========================================================================
describe("reuse audit — the three fallback copy keys exist in BOTH locales", () => {
  test("validation / forbidden / genericError resolve non-empty copy in en + ar", () => {
    for (const key of ["validation", "forbidden"] as const) {
      expect(enMessages[key].length).toBeGreaterThan(0);
      expect(arErrorsTranslations[key].length).toBeGreaterThan(0);
    }
    expect(enMessages.genericError.length).toBeGreaterThan(0);
    expect(arSessionsTranslations.genericError.length).toBeGreaterThan(0);
  });
});
