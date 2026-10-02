"use client";

/**
 * The rubric dialog's draft state — one keyed-mount lifecycle for the
 * score/notes/weakness draft, split out of `RubricEvaluationDialog.tsx`
 * (lint caps). The dialog is mounted keyed by session id, so the hook's
 * mount-time read of the parked draft happens exactly once per open: the
 * controls rehydrate from the last unsubmitted snapshot, the "restored"
 * notice arms once, and every edit re-parks (best-effort autosave) while
 * retiring the notice.
 *
 * The weakness pick follows the iff rule the server enforces: it renders
 * only while the draft carries a legal score BELOW the pass threshold and
 * is forced back to null the moment the draft leaves that band.
 */

import { useMemo, useState } from "react";
import type { RubricWeaknessArea } from "@/frontend/graphql/generated/gql/graphql";
import {
  clearStoredRubricDraft,
  loadStoredRubricDraft,
  type StoredRubricDraft,
  saveStoredRubricDraft,
} from "@/frontend/views/teacher/sessions/rubricDraftStorage.helpers";
import {
  parseRubricScore,
  rubricSavedAtStamps,
} from "@/frontend/views/teacher/sessions/rubricEvaluationDialog.helpers";
import { RUBRIC_PASS_THRESHOLD } from "@/shared/constants";
import { useAppLocale } from "@/shared/locale/localeContext";

/** The draft state + edit intents the rubric dialog renders. */
export function useRubricDraftState(sessionId: string): {
  scoreText: string;
  notes: string;
  weaknessArea: RubricWeaknessArea | null;
  draftErrors: { score: boolean; notes: boolean; weakness: boolean };
  setDraftErrors: React.Dispatch<React.SetStateAction<{ score: boolean; notes: boolean; weakness: boolean }>>;
  score: number | null;
  weaknessRequired: boolean;
  draftRestored: boolean;
  restoredSavedAtStamps: ReturnType<typeof rubricSavedAtStamps> | null;
  handleScoreChange: (value: string) => void;
  handleNotesChange: (value: string) => void;
  handleWeaknessChange: (value: RubricWeaknessArea | null) => void;
  handleDiscardDraft: () => void;
} {
  // The keyed mount remounts per session id — the memo reads the parked
  // draft exactly once per open; the state seeds rehydrate the controls.
  const restoredDraft = useMemo(() => loadStoredRubricDraft(sessionId), [sessionId]);
  const [scoreText, setScoreText] = useState(restoredDraft?.scoreText ?? "");
  const [notes, setNotes] = useState(restoredDraft?.notes ?? "");
  const [weaknessArea, setWeaknessArea] = useState<RubricWeaknessArea | null>(restoredDraft?.weaknessArea ?? null);
  const [draftErrors, setDraftErrors] = useState({ score: false, notes: false, weakness: false });
  // Whether THIS open started from a parked draft — the notice says so once.
  const [draftRestored, setDraftRestored] = useState(restoredDraft !== null);

  // The restored draft's saved-at provenance — the two-line stamp pair the
  // audit trail's When-cell established (pure helper, see
  // `rubricSavedAtStamps`): a RELATIVE "saved ago" glance plus the
  // deterministic ABSOLUTE precision stamp. Resolved ONCE per open
  // (locale-aware, Arabic-Indic digits under `ar`). Mount-frozen on
  // purpose: the notice is provenance-glance copy that the first edit
  // retires, not a ticking clock.
  const locale = useAppLocale();
  const restoredSavedAtStamps = useMemo(() => {
    const savedAtMs = restoredDraft?.savedAtMs;
    return savedAtMs === undefined ? null : rubricSavedAtStamps(savedAtMs, locale);
  }, [restoredDraft, locale]);

  const score = parseRubricScore(scoreText);
  const weaknessRequired = score !== null && score < RUBRIC_PASS_THRESHOLD;

  /** Parks the post-change draft snapshot (best-effort persistence). */
  const persistDraft = (next: StoredRubricDraft): void => saveStoredRubricDraft(sessionId, next);

  const handleScoreChange = (value: string): void => {
    const parsed = parseRubricScore(value);
    // Left the below-threshold band (or not yet a legal score): the
    // weakness pick is meaningless — force it back to null.
    const nextWeakness = parsed === null || parsed >= RUBRIC_PASS_THRESHOLD ? null : weaknessArea;
    setScoreText(value);
    setWeaknessArea(nextWeakness);
    setDraftErrors(prev => ({ ...prev, score: false })); // live validation relief
    setDraftRestored(false);
    persistDraft({ scoreText: value, notes, weaknessArea: nextWeakness });
  };

  const handleNotesChange = (value: string): void => {
    setNotes(value);
    setDraftErrors(prev => ({ ...prev, notes: false })); // live validation relief
    setDraftRestored(false);
    persistDraft({ scoreText, notes: value, weaknessArea });
  };

  const handleWeaknessChange = (value: RubricWeaknessArea | null): void => {
    setWeaknessArea(value);
    setDraftErrors(prev => ({ ...prev, weakness: false })); // live validation relief
    setDraftRestored(false);
    persistDraft({ scoreText, notes, weaknessArea: value });
  };

  /** The restored-draft discard intent — clears the parked snapshot and
   *  resets the dialog to a pristine draft (the notice retires with it;
   *  later edits re-arm autosave for the fresh draft). */
  const handleDiscardDraft = (): void => {
    clearStoredRubricDraft(sessionId);
    setScoreText("");
    setNotes("");
    setWeaknessArea(null);
    setDraftErrors({ score: false, notes: false, weakness: false });
    setDraftRestored(false);
  };

  return {
    scoreText,
    notes,
    weaknessArea,
    draftErrors,
    setDraftErrors,
    score,
    weaknessRequired,
    draftRestored,
    restoredSavedAtStamps,
    handleScoreChange,
    handleNotesChange,
    handleWeaknessChange,
    handleDiscardDraft,
  };
}
