"use client";

/**
 * useDirectoryCohortPanels — the students directory's device-scoped cohort
 * UI state: the highlight-recent mode (PERSISTED through the versioned
 * localStorage preference, so an admin's choice survives reloads) and the
 * onboarding-history dialog's open flag. Reading localStorage inside the
 * lazy state initializer mirrors `useOnboardStudentRecent`'s trust model.
 */

import { useState } from "react";
import { readHighlightPreference, writeHighlightPreference } from "@/frontend/views/admin/students/highlightPreference";

export interface DirectoryCohortPanels {
  /** Highlight mode — dims rows/cards outside the recent-onboarding set. */
  readonly highlightRecent: boolean;
  /** Flips the mode AND persists it (one user gesture, one write). */
  readonly toggleHighlightRecent: () => void;
  /** Whether the onboarding-history dialog is open. */
  readonly historyOpen: boolean;
  readonly openHistory: () => void;
  readonly closeHistory: () => void;
}

export function useDirectoryCohortPanels(): DirectoryCohortPanels {
  const [highlightRecent, setHighlightRecent] = useState(() => readHighlightPreference());
  const [historyOpen, setHistoryOpen] = useState(false);
  const toggleHighlightRecent = (): void => {
    // Event context — the persistence write rides the same user gesture.
    const next = !highlightRecent;
    setHighlightRecent(next);
    writeHighlightPreference(next);
  };
  return {
    highlightRecent,
    toggleHighlightRecent,
    historyOpen,
    openHistory: () => setHistoryOpen(true),
    closeHistory: () => setHistoryOpen(false),
  };
}
