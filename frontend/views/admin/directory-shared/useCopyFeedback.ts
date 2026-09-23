"use client";

/**
 * useCopyFeedback — the shared copy quick-action state machine of the admin
 * surfaces (the audit trail's per-row copy-entity-reference, the student
 * drawer's copy-id + copy-digest actions): writes one text to the
 * clipboard, flags a transient copied state, and self-reverts it.
 *
 * Posture (the directory's copy-email convention, watched by the jscpd
 * clone gate through this single home):
 *  - insecure contexts expose NO Clipboard API at all — `copy` is a no-op;
 *  - a rejected write stays silent — the button never announces a copy
 *    that did not happen;
 *  - the check-icon copied state is a 1.5s transient that self-reverts
 *    (the rows are dense, the state never sticks).
 */

import { useEffect, useState } from "react";

/** How long the check-icon copied state stays flagged before reverting. */
const COPIED_RESET_MS = 1500;

/** The copy quick-action contract the admin copy buttons consume. */
export interface CopyFeedback {
  /** True while the copied flag is up (icon swapped, success tint). */
  readonly copied: boolean;
  /** Copies `text` silently; no-op without a Clipboard API or on rejection. */
  readonly copy: (text: string) => void;
}

export function useCopyFeedback(): CopyFeedback {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const timer = copied ? setTimeout(() => setCopied(false), COPIED_RESET_MS) : null;
    return () => {
      if (timer !== null) {
        clearTimeout(timer);
      }
    };
  }, [copied]);

  const copy = (text: string): void => {
    if (!("clipboard" in navigator)) {
      return;
    }
    void navigator.clipboard
      .writeText(text)
      .then(() => setCopied(true))
      .catch(() => undefined);
  };

  return { copied, copy };
}
