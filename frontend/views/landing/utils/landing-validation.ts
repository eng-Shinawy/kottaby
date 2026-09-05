export const isNumericChar = (ch: string): boolean => (ch >= "0" && ch <= "9") || ch === ",";
export const isDigitChar = (ch: string): boolean => ch >= "0" && ch <= "9";

/** RFC-lite email-shape check for client-side hints: single "@", non-empty
 * local and domain parts, at least one dot in the domain, no whitespace and
 * no further "@" characters. Linear scan — avoids the regex-backtracking
 * class (sonarjs/super-linear-regex) entirely. */
export function isEmailLike(value: string): boolean {
  const at = value.indexOf("@");
  if (at <= 0 || at === value.length - 1) return false;
  const domain = value.slice(at + 1);
  if (domain.includes("@") || /\s/.test(value)) return false;
  const dot = domain.lastIndexOf(".");
  return dot > 0 && dot < domain.length - 1;
}
