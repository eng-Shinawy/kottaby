/**
 * useTeacherInFlightSlots — the per-row in-flight slot book hook, extracted
 * verbatim from `TeacherSessionsContainer` (the max-lines split).
 *
 * Owns the `Record<sessionId, Set<actionKind>>` state and exposes narrow,
 * stable claim/release/clear callbacks: a row's CTA disables iff its OWN
 * row+kind slot is open — concurrent same-kind actions on two rows disable
 * BOTH CTAs, and each clears independently on its own resolution. The
 * `dispute` kind is claimed by the dispute-dialog hook (dialog-owned
 * mutation slot); `start`/`complete` are cleared by the lifecycle-mutations
 * hook. State updates are immutable (pure helpers from
 * `teacherSessionSlots`), so every `setState` yields a new snapshot.
 */

import { useCallback, useState } from "react";
import {
  addInFlightAction,
  type InFlightSlots,
  type RowActionKind,
  removeInFlightAction,
} from "@/frontend/views/teacher/sessions/teacherSessionSlots";

export interface TeacherInFlightSlots {
  readonly inFlightSlots: InFlightSlots;
  /** Opens the row's slot for `kind` (used by the dispute-dialog hook). */
  readonly claimSlot: (sessionId: string, kind: RowActionKind) => void;
  /** Closes the row's slot for `kind` (used by the dispute-dialog hook). */
  readonly releaseSlot: (sessionId: string, kind: RowActionKind) => void;
  /** Clears the row's `start` slot after the mutation settles either way. */
  readonly clearStart: (sessionId: string) => void;
  /** Clears the row's `complete` slot after the mutation settles either way. */
  readonly clearComplete: (sessionId: string) => void;
}

/** The per-row in-flight slot book — see the module docblock. */
export function useTeacherInFlightSlots(): TeacherInFlightSlots {
  const [inFlightSlots, setInFlightSlots] = useState<InFlightSlots>({});

  const claimSlot = useCallback((sessionId: string, kind: RowActionKind): void => {
    setInFlightSlots(prev => addInFlightAction(prev, sessionId, kind));
  }, []);

  const releaseSlot = useCallback((sessionId: string, kind: RowActionKind): void => {
    setInFlightSlots(prev => removeInFlightAction(prev, sessionId, kind));
  }, []);

  const clearStart = useCallback((sessionId: string): void => {
    setInFlightSlots(prev => removeInFlightAction(prev, sessionId, "start"));
  }, []);

  const clearComplete = useCallback((sessionId: string): void => {
    setInFlightSlots(prev => removeInFlightAction(prev, sessionId, "complete"));
  }, []);

  return { inFlightSlots, claimSlot, releaseSlot, clearStart, clearComplete };
}
