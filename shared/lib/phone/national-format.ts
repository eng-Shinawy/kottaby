import { AsYouTypeFormatter } from "google-libphonenumber";

export function formatNationalDigits(nationalDigits: string, region: string): string {
  const formatter = new AsYouTypeFormatter(region);
  let formatted = "";
  for (const char of nationalDigits) {
    if (/\d/.test(char)) {
      formatted = formatter.inputDigit(char);
    }
  }
  return formatted;
}

/** Map a display-string index to the corresponding digit index (digits-only positions). */
function mapDisplayIndexToDigitIndex(display: string, displayIndex: number): number {
  let digitIndex = 0;
  for (let index = 0; index < displayIndex && index < display.length; index += 1) {
    if (/\d/.test(display[index] ?? "")) {
      digitIndex += 1;
    }
  }
  return digitIndex;
}

/** Map a digit index back to the display-string index (start of that digit). */
function mapDigitIndexToDisplayIndex(display: string, digitIndex: number): number {
  let seenDigits = 0;
  for (let index = 0; index < display.length; index += 1) {
    if (/\d/.test(display[index] ?? "")) {
      if (seenDigits === digitIndex) {
        return index;
      }
      seenDigits += 1;
    }
  }
  return display.length;
}

/** Next decorative format character the user may type to advance past template punctuation. */
export function getNextFormatChar(display: string, nationalDigits: string, region: string): string | null {
  const fullDisplay = formatNationalDigits(nationalDigits, region);
  if (display.length >= fullDisplay.length) {
    return null;
  }
  const nextChar = fullDisplay[display.length];
  if (nextChar && !/\d/.test(nextChar)) {
    return nextChar;
  }
  return null;
}

/** Clamp a text selection to digit-only character ranges in the formatted display. */
export function clampSelectionToDigits(
  display: string,
  selectionStart: number,
  selectionEnd: number
): { start: number; end: number } {
  const startDigit = mapDisplayIndexToDigitIndex(display, selectionStart);
  const endDigit = mapDisplayIndexToDigitIndex(display, selectionEnd);
  const minDigit = Math.min(startDigit, endDigit);
  const maxDigit = Math.max(startDigit, endDigit);
  return {
    start: mapDigitIndexToDisplayIndex(display, minDigit),
    end: mapDigitIndexToDisplayIndex(display, maxDigit + 1),
  };
}
