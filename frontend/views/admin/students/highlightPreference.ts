/**
 * highlightPreference — the persisted highlight-mode toggle: a versioned
 * localStorage slot with the SAME trust model as the recent-onboardings
 * slot (origin-readable UI preference, narrowed on read, silently default
 * when absent/malformed/unreachable — a broken slot never breaks the page).
 */

/** The slot's storage key — versioned so future shapes migrate cleanly. */
const HIGHLIGHT_STORAGE_KEY = "admin.students.highlight.v1";

/** The persisted shape version this module reads and writes. */
const HIGHLIGHT_VERSION = 1;

/** Narrows one parsed slot of unknown shape, or `null` on any mismatch. */
const readStoredSlot = (parsed: unknown): boolean | null => {
  if (typeof parsed !== "object" || parsed === null) return null;
  const version = "version" in parsed ? Reflect.get(parsed, "version") : undefined;
  const on = "on" in parsed ? Reflect.get(parsed, "on") : undefined;
  if (version !== HIGHLIGHT_VERSION || typeof on !== "boolean") return null;
  return on;
};

/** Reads the persisted preference (default `false` on every failure path). */
export function readHighlightPreference(): boolean {
  try {
    const raw = window.localStorage.getItem(HIGHLIGHT_STORAGE_KEY);
    if (!raw) return false;
    return readStoredSlot(JSON.parse(raw)) === true;
  } catch {
    return false;
  }
}

/** Persists the preference (quota/privacy failures degrade to session-only). */
export function writeHighlightPreference(on: boolean): void {
  try {
    const slot = { version: HIGHLIGHT_VERSION, on };
    window.localStorage.setItem(HIGHLIGHT_STORAGE_KEY, JSON.stringify(slot));
  } catch {
    // Survivable in every failure mode — the toggle still works this session.
  }
}
