"use client";

import { useMutation } from "@apollo/client/react";
import { useCallback, useEffect } from "react";
import { UserRole } from "@/frontend/graphql/generated/gql/graphql";
import { recordMyActivityMutationDocument } from "@/frontend/graphql/sharedDocuments/auth/auth.documents";
import { useAuth } from "@/frontend/hooks/auth";
import { logger } from "@/frontend/lib/logger";

/**
 * `useTeacherPresenceHeartbeat` — the client presence heartbeat.
 *
 * A teacher with the app open must never read as stale; a teacher who
 * closes or backgrounds the app must. This hook owns the client half of
 * that contract: while a SETTLED, authenticated TEACHER session is mounted
 * in the dashboard shell, it fires the argless `recordMyActivity` mutation
 * every `TEACHER_PRESENCE_HEARTBEAT_INTERVAL_MS` while (and only while)
 * `document.visibilityState === "visible"`.
 *
 * Lifecycle contract:
 *  - Teacher gate — the session must be authenticated, past its loading
 *    state, and carry `UserRole.Teacher`. Any other role (or a still
 *    loading / anonymous session) mounts NOTHING: no timer, no beat, no
 *    cost. A logout flips the gate and React runs the teardown, clearing
 *    the pending timer.
 *  - Visibility gating — the schedule pauses the moment the document is
 *    hidden (the pending timer is cleared, no trailing beat) and resumes
 *    with a fresh full interval when it becomes visible again. A hidden or
 *    closed app therefore goes silent and reads as inactive server-side.
 *  - Failure silence — a rejected (or synchronously throwing) beat is
 *    logged through the frontend logger and swallowed. A flaky beat never
 *    breaks the schedule and never surfaces UI; the hook renders nothing,
 *    holds no render state, and returns `void`.
 *  - Deterministic teardown — unmount clears the timer and removes the
 *    `visibilitychange` listener; a remount starts a fresh session, so no
 *    listener or timer can ever double-fire.
 *
 * The React-free session body (`startTeacherPresenceHeartbeatSession`) is
 * exported so the cadence/visibility/failure contract is testable with
 * stubbed timer + `document` globals — the sibling precedent of the
 * realtime notification session.
 */

/**
 * Heartbeat cadence in milliseconds. One missed beat must be tolerated by
 * the server-side inactivity threshold, so the interval stays comfortably
 * below half of it (5 min < 15 min / 2).
 */
export const TEACHER_PRESENCE_HEARTBEAT_INTERVAL_MS = 5 * 60_000;

/** The auth slice the presence gate reads (narrowed from `useAuth()`). */
export interface TeacherPresenceHeartbeatAuth {
  readonly isAuthenticated: boolean;
  readonly isLoading: boolean;
  readonly user: { readonly role: UserRole } | null;
}

/** The beat runner — issues the argless activity mutation. */
export type TeacherPresenceHeartbeatBeat = () => Promise<unknown>;

/** Contained beat-failure log: the error NAME only, never a UI surface. */
function logBeatFailure(error: unknown): void {
  logger.warn(
    { caller: "useTeacherPresenceHeartbeat" },
    "[TeacherPresenceHeartbeat] Beat failed; the schedule continues",
    { errorName: error instanceof Error ? error.name : typeof error }
  );
}

/**
 * Runs the visibility-gated heartbeat session for an auth snapshot and
 * returns its deterministic teardown — or `undefined` when the gate keeps
 * the session unmounted. The return value plugs straight into `useEffect`.
 */
export function startTeacherPresenceHeartbeatSession(
  auth: TeacherPresenceHeartbeatAuth,
  sendBeat: TeacherPresenceHeartbeatBeat
): (() => void) | undefined {
  // Teacher gate: only a settled, authenticated teacher session may own a
  // timer — every other role mounts nothing at all.
  if (!auth.isAuthenticated || auth.isLoading || auth.user?.role !== UserRole.Teacher) {
    return undefined;
  }

  let disposed = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  // The async boundary turns a synchronously throwing beat seam into a
  // handled rejection (the tick's `.catch` owns both failure shapes).
  const runBeat = async (): Promise<void> => {
    await sendBeat();
  };

  const armCadence = (): void => {
    if (disposed || timer !== null) {
      return;
    }
    timer = setTimeout(runCadenceTick, TEACHER_PRESENCE_HEARTBEAT_INTERVAL_MS);
  };

  const runCadenceTick = (): void => {
    timer = null;
    // The tick fires the beat ONLY on a visible document. A hidden tab
    // stays silent (its transition usually paused the schedule already —
    // this re-check is the belt-and-braces for a missed event) and the
    // schedule remains paused until the visibility resume re-arms it.
    if (disposed || document.visibilityState !== "visible") {
      return;
    }
    // Failure containment: the async runner converts a rejected (or
    // synchronously throwing) beat into a handled rejection — logged and
    // swallowed. Silence is the contract; the schedule never breaks.
    void runBeat().catch(logBeatFailure);
    armCadence();
  };

  const handleVisibilityChange = (): void => {
    if (disposed) {
      return;
    }
    if (document.visibilityState === "visible") {
      // Resume: a fresh full interval — no immediate catch-up burst. The
      // freshness margin still holds: a hidden stretch keeps the stored
      // stamp under the threshold as long as it stays under a beat window
      // plus the interval, which is the documented "backgrounded goes
      // inactive" semantics.
      armCadence();
      return;
    }
    // Pause: clear the pending timer so a hidden tab issues no beat — no
    // trailing mutation after the transition.
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };

  document.addEventListener("visibilitychange", handleVisibilityChange);
  armCadence();

  return () => {
    disposed = true;
    document.removeEventListener("visibilitychange", handleVisibilityChange);
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };
}

/**
 * Mounts the presence heartbeat for the enclosing dashboard shell. Mount
 * ONCE per shell (the dashboard layout) — it is teacher-gated, silent, and
 * renders nothing.
 */
export function useTeacherPresenceHeartbeat(): void {
  const { isAuthenticated, isLoading, user } = useAuth();
  const [recordMyActivity] = useMutation(recordMyActivityMutationDocument);

  // The cadence closes over this runner; its identity changes only when
  // Apollo swaps the mutation function, so unrelated renders never restart
  // the schedule.
  const sendBeat = useCallback((): Promise<unknown> => recordMyActivity(), [recordMyActivity]);

  // The auth snapshot is re-read per effect run: a role change, a logout,
  // or the auth state settling flips the gate — React runs the previous
  // session's teardown before mounting (or skipping) the next one.
  useEffect(
    () => startTeacherPresenceHeartbeatSession({ isAuthenticated, isLoading, user }, sendBeat),
    [isAuthenticated, isLoading, user, sendBeat]
  );
}
