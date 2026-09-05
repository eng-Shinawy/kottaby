/**
 * Deterministic full-name masking for minimal student-identity disclosure.
 *
 * `maskFullName` discloses only the first Unicode grapheme cluster of every
 * whitespace-separated name part and replaces the remainder of each part with
 * a fixed mask cluster, so the output carries no length-of-remainder signal:
 * `أحمد محمد` → `أ*** م***`, `Yusuf` → `Y***`, `ع` → `ع***`.
 *
 * Contract:
 * - **Total** — accepts any string, never throws, performs no I/O.
 * - **Deterministic** — the same input always yields the same mask; no clock,
 *   environment, network, or randomness is consulted.
 * - **Grapheme-aware** — the leading cluster is segmented with
 *   `Intl.Segmenter` at `grapheme` granularity (locale-free), which keeps
 *   combining marks (`e` + U+0301), emoji ZWJ sequences, skin-tone modifiers,
 *   and regional-indicator pairs attached to their base cluster. When
 *   `Intl.Segmenter` is unavailable, a code-point fallback (`Array.from`) is
 *   used instead — it still never throws and never splits surrogate pairs.
 *
 * Pure shared helper: safe for both server-side and client-side surfaces.
 */

/** Fixed cluster appended after the leading grapheme of each masked name part. */
const MASK_CLUSTER = "***";

/** Fixed placeholder returned when the input has no visible characters. */
const MASK_EMPTY_PLACEHOLDER = "***";

/** Whitespace runs (spaces, tabs, newlines, Unicode spaces) separate name parts. */
const NAME_PART_SEPARATOR = /\s+/u;

/**
 * Extracts the first grapheme cluster of a name part.
 *
 * `part` is guaranteed non-empty by the caller (a trimmed, non-empty string
 * split on whitespace runs never yields empty parts), so both extraction
 * paths always return a string and never throw.
 */
function firstGrapheme(part: string): string {
  if (typeof Intl.Segmenter === "function") {
    const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
    const [leadingSegment] = segmenter.segment(part);
    return leadingSegment.segment;
  }
  return Array.from(part)[0];
}

/**
 * Masks a full name, disclosing at most the first grapheme cluster of each
 * whitespace-separated part. Whitespace runs collapse to single spaces, and
 * an input that is empty after trimming returns the fixed placeholder mask.
 */
export function maskFullName(fullName: string): string {
  const trimmed = fullName.trim();
  if (trimmed.length === 0) {
    return MASK_EMPTY_PLACEHOLDER;
  }
  return trimmed
    .split(NAME_PART_SEPARATOR)
    .map(part => `${firstGrapheme(part)}${MASK_CLUSTER}`)
    .join(" ");
}
