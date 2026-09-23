"use client";

/**
 * useOnboardingCopyFeedback — the success screen's one honest copy
 * feedback machine, extracted so the handoff box and the details button
 * share it: ONE copied field + ONE failed field, each self-clearing on
 * its own rhythm (the confirmation in 2s, the failure hint in 4s) and
 * both torn down with the component. Every write verdict arrives from
 * the caller's clipboard seam — this hook only owns the display state.
 */

import { useEffect, useRef, useState } from "react";
import { copyTextToClipboard } from "@/frontend/views/admin/students/onboarding/clipboardCopy";

/** The copy-feedback state machine: one copied field + one failed field, each self-clearing. */
type CopyFeedbackField = "code" | "details";

/** The hook's display state + the copy action bound to the clipboard seam. */
export interface OnboardingCopyFeedback {
  /** The field whose confirmation is on screen (`null` when none). */
  readonly copiedField: CopyFeedbackField | null;
  /** The field whose failure hint is on screen (`null` when none). */
  readonly failedField: CopyFeedbackField | null;
  /** One clipboard write for one field — honest verdicts only. */
  readonly handleCopyText: (text: string, field: CopyFeedbackField) => void;
}

export function useOnboardingCopyFeedback(): OnboardingCopyFeedback {
  const [copiedField, setCopiedField] = useState<CopyFeedbackField | null>(null);
  const [failedField, setFailedField] = useState<CopyFeedbackField | null>(null);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const failedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (copiedTimer.current) clearTimeout(copiedTimer.current);
      if (failedTimer.current) clearTimeout(failedTimer.current);
    },
    []
  );
  const handleCopyText = (text: string, field: CopyFeedbackField): void => {
    void (async () => {
      const copied = await copyTextToClipboard(text);
      setCopiedField(copied ? field : null);
      setFailedField(copied ? null : field);
      if (copiedTimer.current) clearTimeout(copiedTimer.current);
      if (failedTimer.current) clearTimeout(failedTimer.current);
      const delay = copied ? 2000 : 4000;
      const schedule = copied ? setCopiedField : setFailedField;
      const timer = copied ? copiedTimer : failedTimer;
      timer.current = setTimeout(() => schedule(null), delay);
    })();
  };
  return { copiedField, failedField, handleCopyText };
}
