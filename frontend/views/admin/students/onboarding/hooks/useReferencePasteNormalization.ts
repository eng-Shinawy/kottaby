"use client";

/**
 * useReferencePasteNormalization — the reference field's paste hygiene:
 * intercepts paste on the payment-reference input, splices the NORMALIZED
 * clipboard text at the current selection, and raises a self-clearing
 * "cleaned" flag whenever normalization actually changed the text (honest
 * feedback — the admin sees exactly when the value was touched, and the
 * helper line confirms it instead of silently rewriting).
 */

import { type ClipboardEvent, useCallback, useEffect, useRef, useState } from "react";
import {
  needsReferenceNormalization,
  normalizePastedReference,
} from "@/frontend/views/admin/students/onboarding/referenceNormalization";

/** How long the one-shot "cleaned" notice stays up before reverting. */
const CLEANED_NOTICE_MS = 2600;

interface ReferencePasteNormalization {
  /** True while the one-shot cleaned notice should show. */
  readonly cleaned: boolean;
  /** The paste interceptor — ride the TextField's `onPaste`. */
  readonly onPaste: (event: ClipboardEvent<HTMLInputElement>) => void;
}

export function useReferencePasteNormalization(
  /** Reads the field's current controlled value (the draft). */
  readValue: () => string,
  /** Writes the field's next value (the draft setter). */
  writeValue: (next: string) => void
): ReferencePasteNormalization {
  const [cleaned, setCleaned] = useState(false);
  const timerRef = useRef<number | null>(null);

  // Clear the notice timer on unmount — a dangling timer would write state
  // of an unmounted field.
  useEffect(
    () => () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    },
    []
  );

  const onPaste = useCallback(
    (event: ClipboardEvent<HTMLInputElement>) => {
      const pasted = event.clipboardData?.getData("text") ?? "";
      if (!needsReferenceNormalization(pasted)) return;
      event.preventDefault();
      const input = event.currentTarget;
      const value = readValue();
      const start = input.selectionStart ?? value.length;
      const end = input.selectionEnd ?? start;
      writeValue(value.slice(0, start) + normalizePastedReference(pasted) + value.slice(end));
      setCleaned(true);
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(() => setCleaned(false), CLEANED_NOTICE_MS);
    },
    [readValue, writeValue]
  );

  return { cleaned, onPaste };
}
