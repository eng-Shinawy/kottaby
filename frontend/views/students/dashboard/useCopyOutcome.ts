"use client";

import { type Dispatch, type SetStateAction, useEffect, useState } from "react";

/** Copy-outcome state machine: idle → copied (transient) | failed (sticky). */
export type CopyOutcome = "idle" | "copied" | "failed";

/** Lifetime of the transient copy confirmation before it self-clears. */
const COPY_CONFIRMATION_RESET_MS = 2000;

/**
 * Copy-outcome state with the transient-success auto-clear baked in.
 *
 * The confirmation self-clears so the live region never keeps announcing a
 * stale state (timer cleanup keeps unmount safe); the sticky failure notice
 * stays visible until the next attempt.
 */
export function useCopyOutcome(): {
  readonly copyOutcome: CopyOutcome;
  readonly setCopyOutcome: Dispatch<SetStateAction<CopyOutcome>>;
} {
  const [copyOutcome, setCopyOutcome] = useState<CopyOutcome>("idle");

  // Transient confirmation: auto-clear the success notice so the live region
  // never keeps announcing a stale state (timer cleanup keeps unmount safe).
  useEffect(() => {
    if (copyOutcome !== "copied") {
      return undefined;
    }
    const timer = setTimeout(() => setCopyOutcome("idle"), COPY_CONFIRMATION_RESET_MS);
    return () => clearTimeout(timer);
  }, [copyOutcome]);

  return { copyOutcome, setCopyOutcome };
}
