/**
 * Pure-unit tests for the rubric dialog's per-session draft persistence —
 * the crash/accidental-close safety net behind the evaluator dialog's
 * "Unsubmitted draft restored" notice.
 *
 * Every branch drives the helpers through an injected
 * `Pick<Storage, …>` fake (Map-backed), so the suite needs NO DOM, NO
 * window, NO network — the storage parameter is the seam. Pure unit tier:
 * runs via the mandated runner:
 * `bun run test/scripts/run-test.ts frontend/views/teacher/sessions/rubricDraftStorage.helpers.test.ts`.
 */

import { describe, expect, test } from "bun:test";
import { RubricWeaknessArea } from "@/frontend/graphql/generated/gql/graphql";
import {
  clearStoredRubricDraft,
  type EnumerableRubricDraftStorage,
  loadStoredRubricDraft,
  parkedRubricDraftSessionIds,
  pruneOrphanedRubricDrafts,
  RUBRIC_DRAFT_CLOCK_SKEW_TOLERANCE_MS,
  RUBRIC_DRAFT_STORAGE_VERSION,
  rubricDraftStorageKey,
  sanitizeStoredRubricDraft,
  saveStoredRubricDraft,
  sessionIdOfRubricDraftKey,
} from "@/frontend/views/teacher/sessions/rubricDraftStorage.helpers";

/** A Map-backed storage fake exposing exactly the surface the helpers use. */
function fakeStorage(entries: Map<string, string> = new Map()): EnumerableRubricDraftStorage {
  return {
    getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => {
      entries.set(key, value);
    },
    removeItem: (key: string) => {
      entries.delete(key);
    },
    get length(): number {
      return entries.size;
    },
    key: (index: number) => [...entries.keys()][index] ?? null,
  };
}

/** A storage fake whose every method throws — the quota/privacy-mode guard. */
function throwingStorage(): EnumerableRubricDraftStorage {
  return {
    getItem: () => {
      throw new Error("SecurityError");
    },
    setItem: () => {
      throw new Error("QuotaExceededError");
    },
    removeItem: () => {
      throw new Error("SecurityError");
    },
    get length(): number {
      throw new Error("SecurityError");
    },
    key: () => {
      throw new Error("SecurityError");
    },
  };
}

/** The canonical below-threshold draft used across round-trip tests. */
const FAILING_DRAFT = { scoreText: "65", notes: "Two hifz slips.", weaknessArea: RubricWeaknessArea.Hifz };

describe("rubricDraftStorage — round trip", () => {
  test("save then load preserves every field verbatim (plus the saver's saved-at stamp)", () => {
    const storage = fakeStorage();
    saveStoredRubricDraft("s1", FAILING_DRAFT, storage);
    expect(loadStoredRubricDraft("s1", storage)).toEqual({ ...FAILING_DRAFT, savedAtMs: expect.any(Number) });
  });

  test("the key is namespaced by version AND session id", () => {
    expect(rubricDraftStorageKey("s1")).toBe(`kottaby.rubricDraft.v${RUBRIC_DRAFT_STORAGE_VERSION}.s1`);
    const storage = fakeStorage();
    saveStoredRubricDraft("s1", FAILING_DRAFT, storage);
    saveStoredRubricDraft("s2", FAILING_DRAFT, storage);
    // Two sessions never collide; clearing one leaves the other intact.
    clearStoredRubricDraft("s1", storage);
    expect(loadStoredRubricDraft("s1", storage)).toBeNull();
    expect(loadStoredRubricDraft("s2", storage)).toEqual({ ...FAILING_DRAFT, savedAtMs: expect.any(Number) });
  });
});

describe("rubricDraftStorage — load guards", () => {
  test("a missing key loads as null", () => {
    expect(loadStoredRubricDraft("absent", fakeStorage())).toBeNull();
  });

  test("null storage (SSR / privacy mode) loads as null and writes are no-ops", () => {
    expect(loadStoredRubricDraft("s1", null)).toBeNull();
    expect(() => saveStoredRubricDraft("s1", FAILING_DRAFT, null)).not.toThrow();
    expect(() => clearStoredRubricDraft("s1", null)).not.toThrow();
  });

  test("corrupted JSON loads as null (never throws)", () => {
    const storage = fakeStorage();
    storage.setItem(rubricDraftStorageKey("s1"), "{not json");
    expect(loadStoredRubricDraft("s1", storage)).toBeNull();
  });

  test("a wrong envelope version loads as null", () => {
    const storage = fakeStorage();
    storage.setItem(
      rubricDraftStorageStorageKeyHelper("s1"),
      JSON.stringify({ v: RUBRIC_DRAFT_STORAGE_VERSION + 1, scoreText: "65", notes: "x", weaknessArea: null })
    );
    expect(loadStoredRubricDraft("s1", storage)).toBeNull();
  });

  test("a non-object envelope loads as null", () => {
    const storage = fakeStorage();
    storage.setItem(rubricDraftStorageKey("s1"), JSON.stringify("just a string"));
    expect(loadStoredRubricDraft("s1", storage)).toBeNull();
  });

  test("a pristine (all-empty) draft loads as null — nothing worth restoring", () => {
    const storage = fakeStorage();
    saveStoredRubricDraft("s1", { scoreText: "", notes: "", weaknessArea: null }, storage);
    expect(loadStoredRubricDraft("s1", storage)).toBeNull();
  });

  test("a throwing storage folds every entry point (quota / privacy guards)", () => {
    const storage = throwingStorage();
    expect(loadStoredRubricDraft("s1", storage)).toBeNull();
    expect(() => saveStoredRubricDraft("s1", FAILING_DRAFT, storage)).not.toThrow();
    expect(() => clearStoredRubricDraft("s1", storage)).not.toThrow();
  });
});

describe("rubricDraftStorage — sanitize re-validation (the paranoid reader)", () => {
  test("keeps a legal in-band score text verbatim", () => {
    expect(sanitizeStoredRubricDraft({ v: 1, scoreText: "0", notes: "", weaknessArea: null })).toEqual({
      scoreText: "0",
      notes: "",
      weaknessArea: null,
    });
    expect(sanitizeStoredRubricDraft({ v: 1, scoreText: "100", notes: "", weaknessArea: null })).toEqual({
      scoreText: "100",
      notes: "",
      weaknessArea: null,
    });
  });

  test("folds out-of-grammar score spellings to empty (tamper resistance)", () => {
    for (const hostile of ["abc", "1234", "-5", "1.5", "1e2", " 65", "65 "]) {
      const draft = sanitizeStoredRubricDraft({ v: 1, scoreText: hostile, notes: "", weaknessArea: null });
      expect(draft?.scoreText ?? "").toBe("");
    }
  });

  test("folds notes beyond the cap to empty", () => {
    const oversized = "x".repeat(2001);
    expect(sanitizeStoredRubricDraft({ v: 1, scoreText: "65", notes: oversized, weaknessArea: null })).toEqual({
      scoreText: "65",
      notes: "",
      weaknessArea: null,
    });
  });

  test("keeps the weakness ONLY inside its legal below-threshold band (the iff rule)", () => {
    const below = sanitizeStoredRubricDraft({ v: 1, scoreText: "79", notes: "", weaknessArea: "Tajweed" });
    expect(below?.weaknessArea).toBe(RubricWeaknessArea.Tajweed);
    const atThreshold = sanitizeStoredRubricDraft({ v: 1, scoreText: "80", notes: "", weaknessArea: "Tajweed" });
    expect(atThreshold?.weaknessArea).toBeNull();
    const above = sanitizeStoredRubricDraft({ v: 1, scoreText: "95", notes: "", weaknessArea: "Hifz" });
    expect(above?.weaknessArea).toBeNull();
    // The unscored leg carries non-empty notes so the sanitized struct
    // survives the pristine fold (an unscored AND empty draft folds to
    // null — asserted by the pristine test above).
    const unscored = sanitizeStoredRubricDraft({
      v: 1,
      scoreText: "",
      notes: "pending observations",
      weaknessArea: "Hifz",
    });
    expect(unscored?.weaknessArea).toBeNull();
    expect(unscored?.notes).toBe("pending observations");
  });

  test("folds an unknown weakness value to null", () => {
    const draft = sanitizeStoredRubricDraft({ v: 1, scoreText: "65", notes: "", weaknessArea: "Makharij" });
    expect(draft?.weaknessArea).toBeNull();
  });

  test("a sanitized-but-pristine result folds to null (nothing to restore)", () => {
    expect(sanitizeStoredRubricDraft({ v: 1, scoreText: "not-a-score", notes: "", weaknessArea: null })).toBeNull();
  });

  test("non-string score/notes members fold to null (wrong shape)", () => {
    expect(sanitizeStoredRubricDraft({ v: 1, scoreText: 65, notes: "", weaknessArea: null })).toBeNull();
    expect(sanitizeStoredRubricDraft({ v: 1, scoreText: "65", notes: 7, weaknessArea: null })).toBeNull();
  });
});

describe("rubricDraftStorage — orphan pruning (the hygiene pass)", () => {
  test("prunes ONLY drafts whose session id is absent from the pending set", () => {
    const storage = fakeStorage();
    for (const id of ["a", "b", "c"])
      saveStoredRubricDraft(id, { scoreText: "65", notes: "x", weaknessArea: null }, storage);
    const removed = pruneOrphanedRubricDrafts(new Set(["a", "c"]), storage);
    expect(loadStoredRubricDraft("a", storage)).not.toBeNull();
    expect(loadStoredRubricDraft("c", storage)).not.toBeNull();
    expect(loadStoredRubricDraft("b", storage)).toBeNull();
    expect(removed).toEqual([rubricDraftStorageKey("b")]);
  });

  test("a legitimately-empty pending set prunes every parked draft", () => {
    const storage = fakeStorage();
    saveStoredRubricDraft("a", { scoreText: "65", notes: "x", weaknessArea: null }, storage);
    saveStoredRubricDraft("b", { scoreText: "90", notes: "", weaknessArea: null }, storage);
    const removed = pruneOrphanedRubricDrafts(new Set<string>(), storage);
    expect(removed).toEqual([rubricDraftStorageKey("a"), rubricDraftStorageKey("b")]);
    expect(storage).toHaveLength(0);
  });

  test("an unparseable key under the draft namespace is treated as an orphan", () => {
    const storage = fakeStorage();
    storage.setItem("kottaby.rubricDraft.garbage", "{}");
    saveStoredRubricDraft("a", { scoreText: "65", notes: "x", weaknessArea: null }, storage);
    const removed = pruneOrphanedRubricDrafts(new Set(["a"]), storage);
    expect(removed).toEqual(["kottaby.rubricDraft.garbage"]);
    expect(loadStoredRubricDraft("a", storage)).not.toBeNull();
  });

  test("keys outside the draft namespace are never touched", () => {
    const storage = fakeStorage();
    storage.setItem("other.app.key", "keep me");
    storage.setItem("kottaby.unrelated.v1.x", "keep me too");
    const removed = pruneOrphanedRubricDrafts(new Set<string>(), storage);
    expect(removed).toEqual([]);
    expect(storage.getItem("other.app.key")).toBe("keep me");
    expect(storage.getItem("kottaby.unrelated.v1.x")).toBe("keep me too");
  });

  test("null storage is a no-op returning []", () => {
    expect(pruneOrphanedRubricDrafts(new Set<string>(), null)).toEqual([]);
  });

  test("a throwing storage never throws and returns []", () => {
    expect(pruneOrphanedRubricDrafts(new Set<string>(), throwingStorage())).toEqual([]);
  });
});

describe("rubricDraftStorage — saved-at provenance stamp", () => {
  test("the saver stamps the envelope itself — a stale caller-supplied stamp never wins", () => {
    const storage = fakeStorage();
    saveStoredRubricDraft("s1", { ...FAILING_DRAFT, savedAtMs: 1 }, storage);
    const loaded = loadStoredRubricDraft("s1", storage);
    // The persist moment (the saver's own Date.now()), never the caller's value.
    expect(loaded?.savedAtMs).toBeGreaterThan(1);
  });

  test("the sanitizer keeps a legal past stamp (pinned clock)", () => {
    const now = 1_700_000_000_000;
    const draft = sanitizeStoredRubricDraft(
      { v: 1, scoreText: "65", notes: "x", weaknessArea: null, savedAtMs: now - 5_000 },
      now
    );
    expect(draft?.savedAtMs).toBe(now - 5_000);
  });

  test("the sanitizer keeps a stamp within the clock-skew tolerance (pinned clock)", () => {
    const now = 1_700_000_000_000;
    const skewed = now + RUBRIC_DRAFT_CLOCK_SKEW_TOLERANCE_MS;
    const draft = sanitizeStoredRubricDraft(
      { v: 1, scoreText: "65", notes: "x", weaknessArea: null, savedAtMs: skewed },
      now
    );
    expect(draft?.savedAtMs).toBe(skewed);
  });

  test("the sanitizer strips a stamp beyond the clock-skew tolerance WITHOUT folding the draft", () => {
    const now = 1_700_000_000_000;
    const draft = sanitizeStoredRubricDraft(
      {
        v: 1,
        scoreText: "65",
        notes: "x",
        weaknessArea: null,
        savedAtMs: now + RUBRIC_DRAFT_CLOCK_SKEW_TOLERANCE_MS + 1,
      },
      now
    );
    expect(draft?.savedAtMs).toBeUndefined();
    expect(draft?.scoreText).toBe("65");
    expect(draft?.notes).toBe("x");
  });

  test("the sanitizer strips every bogus stamp shape WITHOUT folding the draft", () => {
    for (const bogus of [0, -42, 1.5, "now", true, Number.NaN, Number.POSITIVE_INFINITY]) {
      // The JSON round-trip mints the deliberately-invalid envelope without
      // an unsafe assertion (NaN/Infinity serialize to null — still a bogus
      // stamp shape, still stripped).
      const draft = sanitizeStoredRubricDraft(
        JSON.parse(JSON.stringify({ v: 1, scoreText: "65", notes: "x", weaknessArea: null, savedAtMs: bogus }))
      );
      expect(draft?.savedAtMs).toBeUndefined();
      expect(draft?.scoreText).toBe("65");
      expect(draft?.notes).toBe("x");
    }
  });

  test("an envelope parked before the stamp existed still loads (backward compat)", () => {
    const storage = fakeStorage();
    storage.setItem(
      rubricDraftStorageKey("s1"),
      JSON.stringify({ v: 1, scoreText: "65", notes: "x", weaknessArea: null })
    );
    const loaded = loadStoredRubricDraft("s1", storage);
    expect(loaded?.scoreText).toBe("65");
    expect(loaded?.savedAtMs).toBeUndefined();
  });
});

describe("sessionIdOfRubricDraftKey — key parsing", () => {
  test("round-trips the key helper", () => {
    expect(sessionIdOfRubricDraftKey(rubricDraftStorageKey("s9"))).toBe("s9");
    expect(sessionIdOfRubricDraftKey(rubricDraftStorageKey("session-with-dashes"))).toBe("session-with-dashes");
  });

  test("rejects foreign keys, the bare prefix, and an empty tail", () => {
    expect(sessionIdOfRubricDraftKey("other.app.key")).toBeNull();
    expect(sessionIdOfRubricDraftKey("kottaby.rubricDraft.")).toBeNull();
    expect(sessionIdOfRubricDraftKey("kottaby.rubricDraft.garbage")).toBeNull();
    expect(sessionIdOfRubricDraftKey("kottaby.rubricDraft.v1.")).toBeNull();
  });

  test("is version-agnostic (superseded versions sweep too)", () => {
    expect(sessionIdOfRubricDraftKey("kottaby.rubricDraft.v2.old")).toBe("old");
    expect(sessionIdOfRubricDraftKey("kottaby.rubricDraft.v99.newer")).toBe("newer");
  });
});

describe("rubricDraftStorage — parkedRubricDraftSessionIds (the pending-row chip's membership read)", () => {
  test("returns the parked ids that sit inside the valid (pending) set, current version only", () => {
    const storage = fakeStorage();
    saveStoredRubricDraft("s1", FAILING_DRAFT, storage);
    saveStoredRubricDraft("s2", FAILING_DRAFT, storage);
    // A superseded-version leftover for a VALID session — parsed by the
    // version-agnostic key parser, but NOT restorable through the current
    // reader, so the chip must not promise it.
    storage.setItem(`kottaby.rubricDraft.v2.s1`, JSON.stringify({ v: 2, scoreText: "1", notes: "old" }));
    // A foreign key outside the namespace never counts.
    storage.setItem("kottaby.foreign", "keep");
    const parked = parkedRubricDraftSessionIds(new Set(["s1", "s2"]), storage);
    expect(parked).toEqual(["s1", "s2"]);
  });

  test("a session outside the valid set never surfaces (orphan drafts are the prune's business)", () => {
    const storage = fakeStorage();
    saveStoredRubricDraft("gone", FAILING_DRAFT, storage);
    saveStoredRubricDraft("kept", FAILING_DRAFT, storage);
    expect(parkedRubricDraftSessionIds(new Set(["kept"]), storage)).toEqual(["kept"]);
  });

  test("superseded-version leftovers for a valid session are EXCLUDED (chip promises restorability)", () => {
    const storage = fakeStorage();
    storage.setItem(`kottaby.rubricDraft.v2.pending1`, JSON.stringify({ v: 2, scoreText: "1", notes: "old" }));
    expect(parkedRubricDraftSessionIds(new Set(["pending1"]), storage)).toEqual([]);
  });

  test("empty storage and a null storage both fold to an empty read", () => {
    expect(parkedRubricDraftSessionIds(new Set(["s1"]), fakeStorage())).toEqual([]);
    expect(parkedRubricDraftSessionIds(new Set(["s1"]), null)).toEqual([]);
  });

  test("a throwing storage folds to [] instead of surfacing the chip as an error", () => {
    expect(parkedRubricDraftSessionIds(new Set(["s1"]), throwingStorage())).toEqual([]);
  });
});

/**
 * Tiny local alias so the version-mismatch test spells the SAME key helper
 * (kept one-off to avoid a second import in the header block).
 */
function rubricDraftStorageStorageKeyHelper(sessionId: string): string {
  return rubricDraftStorageKey(sessionId);
}
