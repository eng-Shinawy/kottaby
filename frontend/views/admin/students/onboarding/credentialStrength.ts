/**
 * credentialStrength — the onboarding credential's pure scoring and the
 * strong-credential generator. Presentation-free so the strength row and
 * any future consumer share ONE definition of "strong" for the initial
 * credential.
 */

/** The scale the strength row renders — stable keys double as index-free React keys. */
export const CREDENTIAL_STRENGTH_SEGMENT_KEYS: readonly string[] = ["s1", "s2", "s3", "s4"];

/** The scorer's output — a clamped 0–4 strength level. */
export type CredentialStrengthLevel = 0 | 1 | 2 | 3 | 4;

/** Character-class probes the scorer counts (lower / upper / digit / symbol). */
const CLASS_PROBES: readonly RegExp[] = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z\d]/];

/** Clamps a raw running score into the 0–4 level union (early returns — no nested conditionals). */
const clampLevel = (raw: number): CredentialStrengthLevel => {
  if (raw >= 4) return 4;
  if (raw === 3) return 3;
  if (raw === 2) return 2;
  if (raw === 1) return 1;
  return 0;
};

/**
 * Scores a candidate credential on the quiet 0–4 scale: two length bands
 * (8+, 12+) plus character-class variety (2 classes, then 3+). The empty
 * value scores 0 — the strength row renders nothing for it.
 */
export function scoreCredential(value: string): CredentialStrengthLevel {
  let raw = 0;
  if (value.length >= 8) raw += 1;
  if (value.length >= 12) raw += 1;
  const classes = CLASS_PROBES.filter(probe => probe.test(value)).length;
  if (classes >= 2) raw += 1;
  if (classes >= 3) raw += 1;
  return clampLevel(raw);
}

/** Zero-ambiguity alphabet groups — one guaranteed pick per group. */
const ALPHABET_GROUPS: readonly string[] = [
  "abcdefghijkmnpqrstuvwxyz",
  "ABCDEFGHJKLMNPQRSTUVWXYZ",
  "23456789",
  "!@#$%^&*-_=+",
];

/** Uniform pick from one alphabet group (the payment reference's modulo idiom). */
const pick = (alphabet: string, byte: number): string => alphabet[byte % alphabet.length];

/**
 * Generates a 16-character credential with ≥1 character from every
 * alphabet group, then Fisher–Yates-shuffles with fresh randomness so the
 * guaranteed picks don't sit in predictable slots. A data-entry accelerator
 * only — the result lands in the form state like any other edit, and it
 * never persists anywhere else (the draft mirror strips the credential).
 */
export function generateStrongCredential(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  const chars: string[] = ALPHABET_GROUPS.map((group, index) => pick(group, bytes[index]));
  for (let index = ALPHABET_GROUPS.length; index < bytes.length; index += 1) {
    chars.push(pick(ALPHABET_GROUPS.join(""), bytes[index]));
  }
  const shuffles = new Uint8Array(chars.length);
  crypto.getRandomValues(shuffles);
  for (let from = chars.length - 1; from > 0; from -= 1) {
    const to = shuffles[from] % (from + 1);
    const swap = chars[from];
    chars[from] = chars[to];
    chars[to] = swap;
  }
  return chars.join("");
}
