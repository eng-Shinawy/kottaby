// cspell:disable
/**
 * Helper predicates for the no-hardcoded-strings ESLint rule.
 *
 * Extracted from no-hardcoded-strings.mjs — see that file for the rule
 * documentation and visitor implementation.
 */

import { BRAND_NAMES, CSS_KEYWORDS, TECHNICAL_PATTERNS } from "./no-hardcoded-strings.constants.mjs";

// Check if a string is a brand name (exempt from translation).
export function isBrandName(str) {
  return BRAND_NAMES.has(str.trim());
}

// Check if a string looks like a technical value (not user-facing).
export function isTechnicalValue(str) {
  const trimmed = str.trim();
  if (trimmed.length === 0) return true;
  if (trimmed.length <= 2) return true; // single chars, abbreviations
  if (CSS_KEYWORDS.has(trimmed.toLowerCase())) return true;
  for (const pattern of TECHNICAL_PATTERNS) {
    if (pattern.test(trimmed)) return true;
  }
  return false;
}

// Check if a string is a user-facing display string that should be translated.
// A user-facing string:
//   - Starts with an uppercase letter (sentence/label case)
//   - Contains at least one space (multi-word) OR is a known single-word label
//   - Is not a brand name
//   - Is not a technical value
export function isUserFacingString(str) {
  const trimmed = str.trim();
  if (trimmed.length === 0) return false;
  if (isBrandName(trimmed)) return false;
  if (isTechnicalValue(trimmed)) return false;

  // Must start with uppercase letter (user-facing labels are capitalized).
  if (!/^[A-Z]/.test(trimmed)) return false;

  // Must contain at least one space (multi-word label) OR be a known
  // single-word label. Single-word all-caps strings are constants (exempt).
  const hasSpace = /\s/.test(trimmed);
  const isAllCaps = trimmed === trimmed.toUpperCase();
  if (isAllCaps) return false;

  // Multi-word capitalized strings are user-facing labels.
  if (hasSpace) return true;

  // Single-word capitalized strings: check if they look like a label
  // (e.g. "Tables", "Enums", "Triggers", "Domains", "Search").
  // These are user-facing and should be translated.
  // But exclude strings that look like identifiers (camelCase, PascalCase
  // component names, etc.) — those are code, not display text.
  if (/^[A-Z]a-z+$/.test(trimmed)) {
    // Single capitalized word — likely a label. But could also be a
    // component/variable name in a string context. We err on the side of
    // catching it (the developer can suppress if it's a false positive).
    return true;
  }

  return false;
}
