"use client";

/**
 * Per-session rubric draft persistence for the evaluator's rubric dialog —
 * the crash/accidental-close safety net for the keyed-mount draft. The
 * dialog is keyed by session id, so a dismissal (backdrop/Escape) or a page
 * reload discards everything the evaluator typed; these helpers park the
 * in-progress draft under a namespaced, versioned `localStorage` key so the
 * NEXT open of the SAME session can offer it back.
 *
 * Trust boundary — the writer is the dialog (dumb serialize + guarded
 * write), the READER is paranoid: every field of a loaded envelope is
 * re-validated against the same rules the live draft enforces (strict
 * decimal-integer score grammar, notes cap, the weakness iff-rule band),
 * and any malformed shape folds to "nothing to restore" instead of seeding
 * illegal state. Storage itself is optional: every entry point degrades to
 * a no-op when `localStorage` is unavailable (SSR, privacy modes, quota
 * errors) so persistence can never break the submission flow.
 *
 * Pure helpers — the dialog owns WHEN to load/save/clear and the
 * pending-read hook owns the storage-hygiene pass
 * (`pruneOrphanedRubricDrafts`); the unit suite
 * (`rubricDraftStorage.helpers.test.ts`) drives every branch through an
 * injected `Pick<Storage, …>` fake, so no DOM is required to test them.
 */

import {
  RubricWeaknessArea,
  type RubricWeaknessArea as RubricWeaknessAreaType,
} from "@/frontend/graphql/generated/gql/graphql";
import { parseRubricScore } from "@/frontend/views/teacher/sessions/rubricEvaluationDialog.helpers";
import { RUBRIC_NOTES_MAX_LENGTH, RUBRIC_PASS_THRESHOLD } from "@/shared/constants";

/** The storage surface the draft helpers need — injectable for tests. */
export type RubricDraftStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/** One persisted draft snapshot (the same fields the dialog drafts with). */
export interface StoredRubricDraft {
  /** The raw score text as typed. */
  readonly scoreText: string;
  /** The raw notes text as typed. */
  readonly notes: string;
  /** The picked weakness area — only ever restored inside its legal band. */
  readonly weaknessArea: RubricWeaknessAreaType | null;
  /**
   * Epoch milliseconds of the last persist — the saved-at provenance stamp
   * the restored notice renders as a relative caption. Written by the saver
   * itself (never trusted from the caller's draft) and re-validated by the
   * reader; absent on envelopes parked before the stamp existed, and the
   * restore flow treats that absence as "caption hidden", never as an error.
   */
  readonly savedAtMs?: number;
}

/** Envelope version — a mismatch folds the stored draft to null. */
export const RUBRIC_DRAFT_STORAGE_VERSION = 1;

/**
 * How far AHEAD of the reading clock a stored saved-at stamp may sit and
 * still be believed — a small belt for devices whose clock ticks between
 * the persist and the next open. Anything further ahead is tampering or a
 * broken clock; the reader strips the stamp (the draft itself survives)
 * rather than rendering a "saved in the future" caption.
 */
export const RUBRIC_DRAFT_CLOCK_SKEW_TOLERANCE_MS = 60_000;

/**
 * The shared namespace prefix of every parked-draft key. Shared with the
 * hygiene module (its namespace sweeps must match the writer's key shape).
 */
export const RUBRIC_DRAFT_KEY_PREFIX = "kottaby.rubricDraft.";

/** The namespaced, versioned key for one session's draft. */
export function rubricDraftStorageKey(sessionId: string): string {
  return `${RUBRIC_DRAFT_KEY_PREFIX}v${RUBRIC_DRAFT_STORAGE_VERSION}.${sessionId}`;
}

/**
 * Parses a parked-draft key back to its session id — null for keys outside
 * the draft namespace or malformed tails. Deliberately version-agnostic
 * (`v\d+\.`) so the hygiene pass also sweeps superseded versions' leftovers.
 */
export function sessionIdOfRubricDraftKey(key: string): string | null {
  if (!key.startsWith(RUBRIC_DRAFT_KEY_PREFIX)) return null;
  const match = /^v\d+\.(.+)$/.exec(key.slice(RUBRIC_DRAFT_KEY_PREFIX.length));
  const sessionId = match?.[1];
  return sessionId ?? null;
}

/**
 * Resolves the ambient storage, or null when it is unavailable (SSR) or
 * inaccessible (privacy modes throw on mere property access). Shared with
 * the hygiene module, whose entry points default to it the same way.
 */
export function resolveAmbientRubricDraftStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/**
 * The envelope-shape guard — the sanitizer's trust boundary rests on it.
 * A user-defined predicate (not an assertion) keeps the read typed.
 */
function isRecordLike(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** The weakness-membership guard — a string is the enum only when the
 *  option table contains it (the fail-closed read the dialog trusts). */
function isWeaknessAreaValue(value: string): value is RubricWeaknessAreaType {
  return WEAKNESS_OPTION_VALUES.includes(value);
}

/** The strict decimal-integer grammar — mirrors the live score draft. */
const STORED_SCORE_TEXT_PATTERN = /^\d{0,3}$/;

/** The weakness options in their stable wire order (runtime membership check). */
const WEAKNESS_OPTION_VALUES: readonly string[] = Object.values(RubricWeaknessArea);

/**
 * Re-validates one parsed envelope against the live draft's rules and
 * returns the sanitized draft — or null when the envelope itself is
 * malformed (wrong shape/version) or the sanitized draft is pristine
 * (nothing worth restoring).
 *
 * The saved-at stamp is validated LENIENTLY by design: a bogus stamp is
 * STRIPPED (folded to absent) while the draft payload survives — the
 * score/notes/weakness fields are the restoration contract, and a tampered
 * provenance caption must never cost the evaluator their parked draft.
 * `now` is injectable so suites can pin the clock-skew tolerance.
 */
export function sanitizeStoredRubricDraft(raw: unknown, now: number = Date.now()): StoredRubricDraft | null {
  if (!isRecordLike(raw)) return null;
  const record = raw;
  if (record.v !== RUBRIC_DRAFT_STORAGE_VERSION) return null;
  if (typeof record.scoreText !== "string" || typeof record.notes !== "string") return null;

  // Saved-at stamp: keep only a positive whole number that does not sit
  // further ahead than the clock-skew tolerance; anything else folds to
  // absent (NOT to a null draft — see the leniency note above).
  const rawSavedAtMs = record.savedAtMs;
  const savedAtMs =
    typeof rawSavedAtMs === "number" &&
    Number.isInteger(rawSavedAtMs) &&
    rawSavedAtMs > 0 &&
    rawSavedAtMs <= now + RUBRIC_DRAFT_CLOCK_SKEW_TOLERANCE_MS
      ? rawSavedAtMs
      : undefined;

  // Score text: keep only spellings the live grammar accepts (the empty
  // draft and strict decimal integers inside the band); anything else —
  // partial spellings, exponents, oversized numbers — folds to empty.
  const scoreText = STORED_SCORE_TEXT_PATTERN.test(record.scoreText) ? record.scoreText : "";
  const parsedScore = parseRubricScore(scoreText);

  // Notes: keep verbatim while within the cap; an oversized stored value
  // (hand-tampered — the input enforces the cap live) folds to empty.
  const notes = record.notes.length <= RUBRIC_NOTES_MAX_LENGTH ? record.notes : "";

  // Weakness: only a real option, and only while the score draft sits in
  // the below-threshold band (the iff rule) — otherwise null.
  const storedWeakness = record.weaknessArea;
  const weaknessArea =
    typeof storedWeakness === "string" &&
    isWeaknessAreaValue(storedWeakness) &&
    parsedScore !== null &&
    parsedScore < RUBRIC_PASS_THRESHOLD
      ? storedWeakness
      : null;

  const draft: StoredRubricDraft =
    savedAtMs === undefined ? { scoreText, notes, weaknessArea } : { scoreText, notes, weaknessArea, savedAtMs };
  const pristine = draft.scoreText === "" && draft.notes === "" && draft.weaknessArea === null;
  return pristine ? null : draft;
}

/**
 * Loads one session's stored draft — null when nothing usable is stored
 * (missing key, unavailable storage, malformed envelope, pristine draft).
 */
export function loadStoredRubricDraft(
  sessionId: string,
  storage: RubricDraftStorage | null = resolveAmbientRubricDraftStorage()
): StoredRubricDraft | null {
  if (storage === null) return null;
  let raw: string | null;
  try {
    raw = storage.getItem(rubricDraftStorageKey(sessionId));
  } catch {
    return null;
  }
  if (raw === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
  return sanitizeStoredRubricDraft(parsed);
}

/**
 * Parks one draft snapshot for the session. Dumb serialization on purpose —
 * the reader owns validation; a failing write (quota, privacy mode) is
 * swallowed so persistence can never break the submission flow. The
 * envelope's saved-at stamp is written HERE (the persist moment is the
 * save moment) and always wins — a stale stamp riding along on the
 * caller's draft can never masquerade as fresh provenance.
 */
export function saveStoredRubricDraft(
  sessionId: string,
  draft: StoredRubricDraft,
  storage: RubricDraftStorage | null = resolveAmbientRubricDraftStorage()
): void {
  if (storage === null) return;
  try {
    storage.setItem(
      rubricDraftStorageKey(sessionId),
      JSON.stringify({ v: RUBRIC_DRAFT_STORAGE_VERSION, ...draft, savedAtMs: Date.now() })
    );
  } catch {
    // Quota exceeded / storage disabled — the draft simply stays in memory.
  }
}

/** Clears one session's parked draft (no-op when nothing is stored). */
export function clearStoredRubricDraft(
  sessionId: string,
  storage: RubricDraftStorage | null = resolveAmbientRubricDraftStorage()
): void {
  if (storage === null) return;
  try {
    storage.removeItem(rubricDraftStorageKey(sessionId));
  } catch {
    // Already-unavailable storage — nothing to clear.
  }
}

export type { EnumerableRubricDraftStorage } from "@/frontend/views/teacher/sessions/rubricDraftHygiene.helpers";
// The hygiene-pass members live beside this module
// (`rubricDraftHygiene.helpers.ts`) to keep both under the lint line cap —
// re-exported here so every consumer import path is unchanged.
export {
  parkedRubricDraftSessionIds,
  pruneOrphanedRubricDrafts,
} from "@/frontend/views/teacher/sessions/rubricDraftHygiene.helpers";
