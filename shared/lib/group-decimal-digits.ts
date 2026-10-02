/**
 * Exact-decimal money formatting — shared display helper for every surface
 * that renders an exact decimal STRING amount (the analytics revenue rows,
 * the plan catalog cards, the subscriptions list).
 *
 * The digits are grouped WITHOUT ever constructing a number — a character
 * loop keeps the value byte-exact and float-free. Sign and fraction digits
 * are preserved verbatim; the wire value is never rewritten.
 */

/**
 * Groups the integer digits of an exact decimal string (`"1234567.89"` →
 * `"1,234,567.89"`). Sign and fraction digits pass through verbatim.
 */
export function groupDecimalDigits(value: string): string {
  const sign = value.startsWith("-") ? "-" : "";
  const unsigned = sign ? value.slice(1) : value;
  const dotIndex = unsigned.indexOf(".");
  const integerPart = dotIndex === -1 ? unsigned : unsigned.slice(0, dotIndex);
  const fractionPart = dotIndex === -1 ? "" : unsigned.slice(dotIndex);

  let grouped = "";
  for (let index = 0; index < integerPart.length; index += 1) {
    const remaining = integerPart.length - index;
    if (index > 0 && remaining % 3 === 0) {
      grouped += ",";
    }
    grouped += integerPart[index];
  }
  return `${sign}${grouped}${fractionPart}`;
}
