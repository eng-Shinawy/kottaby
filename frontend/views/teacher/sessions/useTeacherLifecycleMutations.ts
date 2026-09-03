/**
 * useTeacherLifecycleMutations — the start/complete mutation wiring,
 * extracted verbatim from `TeacherSessionsContainer` (the max-lines split).
 *
 * Per-call options carry the session id in scope so every outcome arm can
 * address ITS row (row alerts, in-flight clearing) precisely. Cache
 * convergence is NORMALIZATION ONLY (NO refetch): every returned `Session!`
 * payload selects `id` first, and each mutation rewrites the transitioned
 * fields onto the `Session:<id>` entity (belt-and-braces over the automatic
 * normalized merge). Errors route through the shared
 * `handleLifecycleMutationError` table.
 */

import { useApolloClient, useMutation } from "@apollo/client/react";
import { useCallback } from "react";
import { completeSessionMutationDocument, startSessionMutationDocument } from "@/frontend/graphql/sharedDocuments";
import {
  handleLifecycleMutationError,
  rewriteSessionFields,
} from "@/frontend/views/teacher/sessions/teacherSessionCacheArms";
import {
  type ContainerNotice,
  dropRowAlert,
  type RowActionKind,
} from "@/frontend/views/teacher/sessions/teacherSessionSlots";
import { Errors, Sessions, useAppTranslation } from "@/shared/locale";

/** Wiring the mutations need from the container (slot handling + surfaces). */
export interface TeacherLifecycleMutationsWiring {
  readonly setRowAlerts: (
    updater: (prev: Readonly<Record<string, string>>) => Readonly<Record<string, string>>
  ) => void;
  readonly setNotice: (notice: ContainerNotice) => void;
  /** Opens the row's slot for the given kind while its request is on the wire. */
  readonly claimSlot: (sessionId: string, kind: RowActionKind) => void;
  readonly clearStart: (sessionId: string) => void;
  readonly clearComplete: (sessionId: string) => void;
}

export interface TeacherLifecycleMutations {
  /** startSession (Scheduled → Started) intent handler for one row. */
  readonly handleStart: (sessionId: string) => void;
  /** completeSession (Started → Completed) intent handler for one row. */
  readonly handleComplete: (sessionId: string) => void;
}

/** The start/complete mutation wiring — see the module docblock. */
export function useTeacherLifecycleMutations(wiring: TeacherLifecycleMutationsWiring): TeacherLifecycleMutations {
  const t = useAppTranslation(Sessions);
  const te = useAppTranslation(Errors);
  const client = useApolloClient();
  const { setRowAlerts, setNotice, claimSlot, clearStart, clearComplete } = wiring;

  const [startSession] = useMutation(startSessionMutationDocument);

  const handleStart = useCallback(
    (sessionId: string): void => {
      claimSlot(sessionId, "start");
      void startSession({
        variables: { id: sessionId },
        update(cache, { data: resultData }) {
          const started = resultData?.startSession;
          if (!started) return;
          rewriteSessionFields(cache, started.id, { status: started.status, startedAt: started.startedAt });
        },
        onCompleted: result => {
          clearStart(sessionId);
          setRowAlerts(prev => dropRowAlert(prev, result.startSession.id));
          setNotice({ message: t.sessionStartedNotice, severity: "success" });
        },
        onError: mutationError =>
          handleLifecycleMutationError(mutationError, {
            cache: client.cache,
            sessionId,
            t,
            te,
            clearInFlight: () => clearStart(sessionId),
            setRowAlerts,
            setNotice,
          }),
      });
    },
    [startSession, client, t, te, claimSlot, clearStart, setRowAlerts, setNotice]
  );

  const [completeSession] = useMutation(completeSessionMutationDocument);

  const handleComplete = useCallback(
    (sessionId: string): void => {
      claimSlot(sessionId, "complete");
      void completeSession({
        variables: { id: sessionId },
        update(cache, { data: resultData }) {
          const completed = resultData?.completeSession;
          if (!completed) return;
          rewriteSessionFields(cache, completed.id, {
            status: completed.status,
            endedAt: completed.endedAt,
            confirmedByTeacherAt: completed.confirmedByTeacherAt,
          });
        },
        onCompleted: result => {
          clearComplete(sessionId);
          setRowAlerts(prev => dropRowAlert(prev, result.completeSession.id));
          setNotice({ message: t.sessionCompletedNotice, severity: "success" });
        },
        onError: mutationError =>
          handleLifecycleMutationError(mutationError, {
            cache: client.cache,
            sessionId,
            t,
            te,
            clearInFlight: () => clearComplete(sessionId),
            setRowAlerts,
            setNotice,
          }),
      });
    },
    [completeSession, client, t, te, claimSlot, clearComplete, setRowAlerts, setNotice]
  );

  return { handleStart, handleComplete };
}
