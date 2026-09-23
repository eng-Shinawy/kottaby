"use client";

/**
 * The parked-draft hygiene pass + the parked-chip membership read — split
 * out of `rubricDraftStorage.helpers.ts` (lint line cap), same contract:
 * every entry point takes an injectable enumerable storage, degrades to a
 * no-op / empty result on failure, and never throws (the chip and the
 * sweep are niceties that must never surface as errors).
 */

import {
  RUBRIC_DRAFT_KEY_PREFIX,
  type RubricDraftStorage,
  resolveAmbientRubricDraftStorage,
  rubricDraftStorageKey,
  sessionIdOfRubricDraftKey,
} from "@/frontend/views/teacher/sessions/rubricDraftStorage.helpers";

/** The enumerable storage surface the hygiene pass needs (index iteration). */
export type EnumerableRubricDraftStorage = RubricDraftStorage & Pick<Storage, "key" | "length">;

/**
 * The parked-draft chip's membership read — every parked-draft session id
 * that still sits in the given valid (pending) set, so the pending rows can
 * name which of them carry a restorable draft WITHOUT opening the dialog.
 * Only keys on the CURRENT envelope version count: the chip promises "a
 * restorable draft exists", and superseded-version leftovers are not
 * restorable through the reader (the hygiene pass sweeps them separately).
 * Enumerates the namespace, parses each key, intersects with the valid set;
 * a failing storage folds to [] — never throws (the chip is a nicety, its
 * absence must never surface as an error).
 */
export function parkedRubricDraftSessionIds(
  validSessionIds: ReadonlySet<string>,
  storage: EnumerableRubricDraftStorage | null = resolveAmbientRubricDraftStorage()
): readonly string[] {
  if (storage === null) return [];
  try {
    const parked: string[] = [];
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (!key?.startsWith(RUBRIC_DRAFT_KEY_PREFIX)) continue;
      const sessionId = sessionIdOfRubricDraftKey(key);
      if (sessionId === null || !validSessionIds.has(sessionId)) continue;
      if (key === rubricDraftStorageKey(sessionId)) parked.push(sessionId);
    }
    return parked;
  } catch {
    return [];
  }
}

/**
 * The parked-draft hygiene pass — removes every draft key whose session id
 * is NOT in the given pending set, plus any unparseable key under the draft
 * namespace. The pending set is the affordance gate: a draft whose submit
 * CTA can no longer render is unreachable through the UI, so keeping it is
 * dead weight. Enumerates collect-first, removes second (no index drift
 * mid-deletion); a failing storage folds to the partially-applied result —
 * never throws. Returns the removed keys verbatim — the pending-read hook
 * turns the COUNT into the surface's hygiene diagnostics notice.
 */
export function pruneOrphanedRubricDrafts(
  pendingSessionIds: ReadonlySet<string>,
  storage: EnumerableRubricDraftStorage | null = resolveAmbientRubricDraftStorage()
): readonly string[] {
  if (storage === null) return [];
  try {
    const staleKeys: string[] = [];
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (!key?.startsWith(RUBRIC_DRAFT_KEY_PREFIX)) continue;
      const sessionId = sessionIdOfRubricDraftKey(key);
      if (sessionId !== null && pendingSessionIds.has(sessionId)) continue;
      staleKeys.push(key);
    }
    for (const key of staleKeys) {
      storage.removeItem(key);
    }
    return staleKeys;
  } catch {
    return [];
  }
}
