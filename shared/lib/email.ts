/**
 * Two-step email shape validation helper.
 *
 * Implemented as a two-step check (split on `@` + verify domain has a dot)
 * to avoid super-linear regex backtracking on patterns like
 * `/^[^\s@]+@[^\s@]+\.[^\s@]+$/` (the dot can be matched by `[^\s@]+`,
 * forcing the engine to backtrack).
 */
export function isValidEmail(email: string): boolean {
  if (email.length === 0 || email.length > 254) return false;
  const atIdx = email.indexOf("@");
  if (atIdx < 1) return false;
  if (atIdx !== email.lastIndexOf("@")) return false; // exactly one `@`
  const local = email.slice(0, atIdx);
  const domain = email.slice(atIdx + 1);
  if (domain.length < 3) return false; // need at least "x.y"
  const dotIdx = domain.indexOf(".");
  if (dotIdx < 1 || dotIdx === domain.length - 1) return false; // dot not at start/end
  // No whitespace anywhere (covers `\s` without a complex regex).
  if (/\s/.test(local) || /\s/.test(domain)) return false;
  return true;
}
