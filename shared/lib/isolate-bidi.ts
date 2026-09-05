/**
 * Bidirectional-isolation wrapper for interpolated display names.
 *
 * Wraps `name` between FSI (U+2066, FIRST-STRONG ISOLATE) and PDI (U+2069,
 * POP DIRECTIONAL ISOLATE) so the name forms its own directional island: the
 * run takes its direction from its own first strong character, and the
 * surrounding text's neutrals (spaces, punctuation, mask asterisks) can never
 * leak across the name's boundary in either direction.
 *
 * Needed wherever a display name is interpolated into a STORED string that
 * downstream viewers render without a directional wrapper (plain-text
 * notification bodies, for example): a mixed RTL/LTR feed would otherwise
 * let the paragraph direction resolve the neutrals between runs and scramble
 * the display order. Interactive surfaces get the equivalent first-strong
 * isolation at the presentation layer via `dir="auto"` (the handshake result
 * card precedent); the two mechanisms are complementary, not redundant.
 *
 * Pure shared helper: safe for both server-side and client-side surfaces.
 */

/** FSI — U+2066 FIRST-STRONG ISOLATE: opens the directional island. */
const FSI = "\u2066";

/** PDI — U+2069 POP DIRECTIONAL ISOLATE: closes the directional island. */
const PDI = "\u2069";

export function isolateBidi(name: string): string {
  return `${FSI}${name}${PDI}`;
}
