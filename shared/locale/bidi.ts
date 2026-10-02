/**
 * Unicode bidi isolation for interpolated runs inside localized sentences.
 *
 * Person names and other user-supplied runs frequently use the opposite
 * script from the surrounding sentence (a Latin name inside Arabic copy or
 * vice versa). Without isolation the Unicode BiDi algorithm reorders the
 * adjacent words around such runs, visually scrambling the sentence. FSI
 * (U+2068) / PDI (U+2069) isolate the run so it always renders in its own
 * internal order without affecting the sentence flow.
 */
const BIDI_CONTROL_RE = /[\u202A-\u202E\u2066-\u2069]/g;

export function isolateBidiRun(text: string): string {
  if (!text) return text;
  const sanitized = text.replace(BIDI_CONTROL_RE, "");
  return `\u2068${sanitized}\u2069`;
}

/**
 * Right-to-left mark (zero-width, strong RTL).
 *
 * When a sentence begins with an isolated opposite-script run, engines that
 * resolve `dir: auto` from the first strong character can pick the wrong
 * base direction (Chromium does not skip isolates during auto-resolution).
 * Prefixing the sentence's first run with RLM pins the paragraph to RTL.
 */
export const RLM = "\u200F";

/**
 * Left-to-right mark (zero-width, strong LTR) — mirror of {@link RLM} for
 * LTR sentences whose first interpolated run may be Arabic.
 */
export const LRM = "\u200E";
