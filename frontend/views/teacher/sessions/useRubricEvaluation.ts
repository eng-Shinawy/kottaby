"use client";

/**
 * useRubricEvaluation — the rubric-scoring arms of the teacher sessions
 * surface, composed by `useTeacherLifecycleMutations`:
 *
 * - The PENDING-READ arm runs a stateful `useQuery` over
 *   `myRubricPendingSessions` (the caller's own still-owed rubric sessions;
 *   no `useLazyQuery`). Its id set is the row-affordance gate: a completed
 *   evaluation row offers the submit-evaluation action IFF its id is still
 *   in this set, and the post-success refetch below is what makes a scored
 *   row lose the action.
 * - The MUTATION arm files one rubric verdict through
 *   `submitRubricEvaluation`. The sealed wire contract carries ONLY the
 *   session locator plus the score/notes/weakness payload — evaluator and
 *   evaluated identities are server-resolved, never client-supplied.
 * - Denials surface through the SINGLE error-mapping table
 *   (`error-link.map.ts`): every typed `extensions.code` of this flow has a
 *   row there, so the localized toast/notice renders app-scope without any
 *   hook-owned copy. The hook still surfaces the normalized typed code as
 *   the submit outcome so callers can see WHICH denial settled while the
 *   dialog stays open for an in-place retry.
 * - The submit latch spans the WHOLE attempt (mutation + pending-refetch
 *   tail): the `submitting` gate stays raised until the attempt fully
 *   settles, a second submit issued during the tail is a no-op, and dialog
 *   dismissal stays gated uniformly for as long as any leg is on the wire.
 * - Success refetches the pending read (the scored row leaves the set) and
 *   raises the localized success snackbar through the container's notice
 *   lane — a refetch failure folds silently so it can never mask the
 *   success copy. A settled-FAILED pending read is never silent either:
 *   the query's error state rides the returned arms as `pendingError` and
 *   the localized generic error notice renders through the same notice
 *   lane — an empty id set alone must never read as "nothing owed".
 * - Storage hygiene: whenever the pending read settles clean, parked drafts
 *   whose session id left the pending set are pruned from `localStorage`
 *   (`pruneOrphanedRubricDrafts`) — a draft whose submit affordance is gone
 *   is unreachable through the UI, so it is dead weight. The pass is
 *   fail-closed: a data-less first render or a settled-FAILED read never
 *   prunes. The pass is NOT silent: a sweep that actually removed keys
 *   raises the localized hygiene diagnostics line through the same notice
 *   lane (an `info` notice naming how many stale drafts were cleaned), so
 *   storage losing entries is an OBSERVED event rather than an invisible
 *   side effect; a sweep that removed nothing stays quiet.
 *
 * Apollo hooks come from `@apollo/client/react`; every user-facing string
 * resolves through the compile-time `Sessions` namespace handle (property
 * access only). Cache convergence is the normalized mutation receipt plus
 * the one pending refetch — no cache surgery, no refetchQueries spray.
 */

import { useMutation, useQuery } from "@apollo/client/react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { RubricEvaluationSubmitInput } from "@/frontend/graphql/generated/gql/graphql";
import {
  myRubricPendingSessionsQueryDocument,
  submitRubricEvaluationMutationDocument,
} from "@/frontend/graphql/sharedDocuments";
import { extractErrorCode } from "@/frontend/lib/graphql-error-utils";
import { normalizeGraphQLErrorCode } from "@/frontend/providers/apollo/error-link.map";
import { pruneOrphanedRubricDrafts } from "@/frontend/views/teacher/sessions/rubricDraftStorage.helpers";
import type { ContainerNotice } from "@/frontend/views/teacher/sessions/teacherSessionSlots";
import { Sessions, useAppTranslation } from "@/shared/locale";

/**
 * The outcome of one submit attempt: `ok` settles the dialog (closed on
 * success, open for retry otherwise) and `code` surfaces the normalized
 * typed `extensions.code` of a rejection (null when the transport masked
 * it). The denial's localized toast itself renders app-scope through the
 * error-mapping table — the code here is purely informational: it exists
 * so the caller (and the suites) can see WHICH denial settled while the
 * dialog stays open for an in-place retry, and it is never re-mapped,
 * re-toasted, or branched on for behavior.
 */
export interface RubricSubmitOutcome {
  readonly ok: boolean;
  readonly code: string | null;
}

/** Wiring the rubric arms need from the composing hook / container. */
export interface RubricEvaluationWiring {
  /** The container's notice lane (the success snackbar; denials toast app-scope). */
  readonly setNotice: (notice: ContainerNotice) => void;
}

/** The rubric arms exposed to the container and the dialog mount. */
export interface RubricEvaluationArms {
  /**
   * Session ids that still owe a rubric submission (from the pending read)
   * — the affordance gate for completed evaluation rows.
   */
  readonly pendingSessionIds: ReadonlySet<string>;
  /**
   * Files one rubric verdict for the given session. Resolves `ok: true`
   * after the pending read refetched and the success notice landed; any
   * typed denial resolves `ok: false` with the surfaced code and the
   * dialog stays open for an in-place retry. A call issued while another
   * attempt is still in flight is a no-op resolving `ok: false` — the
   * first attempt owns the settlement.
   */
  readonly submitEvaluation: (sessionId: string, input: RubricEvaluationSubmitInput) => Promise<RubricSubmitOutcome>;
  /** `true` while the whole submit attempt (mutation + pending refetch) is in flight. */
  readonly submitting: boolean;
  /**
   * The pending read's settled error (`undefined` while the read is in
   * flight or settled clean). Surfaced so a failed initial read is
   * observable instead of silently emptying the affordance gate: the
   * localized notice itself renders through the container's notice lane
   * below, and this member keeps the raw state caller-visible (the same
   * `unknown` convention the container's body error prop carries).
   */
  readonly pendingError: unknown;
}

/** The rubric-scoring arms — see the module docblock. */
export function useRubricEvaluation(wiring: RubricEvaluationWiring): RubricEvaluationArms {
  const t = useAppTranslation(Sessions);
  const { setNotice } = wiring;

  // The pending read is STATEFUL and always on — it owns the row-affordance
  // gate, so it cannot be dialog-scoped. This is a MEMBERSHIP-SET read, not
  // a browsing page: the id set must cover every still-owed session, so the
  // read requests the pending list's maximum normalized page size (the
  // service's 1..100 clamp) — a smaller default window would silently drop
  // the affordance for rows beyond it. Page stays an explicit null (the
  // service normalizes it to the first page), mirroring the sibling
  // session-list read.
  const {
    data: pendingData,
    error: pendingError,
    refetch: refetchPendingSessions,
  } = useQuery(myRubricPendingSessionsQueryDocument, {
    variables: { page: null, pageSize: 100 },
  });

  // A settled-failed initial pending read would otherwise hide every
  // submit affordance silently (the empty id set renders no CTA). The
  // container's notice lane — the established transient host this hook
  // already wires for the success snackbar — carries the surface's
  // localized generic error copy for it; the raw state stays on the
  // returned arms as `pendingError`.
  useEffect(() => {
    if (pendingError === undefined) return;
    setNotice({ message: t.genericError, severity: "error" });
  }, [pendingError, setNotice, t.genericError]);

  const pendingSessionIds = useMemo(
    () => new Set((pendingData?.myRubricPendingSessions.items ?? []).map(item => item.id)),
    [pendingData]
  );

  // The parked-draft hygiene pass — a draft whose session id left the
  // pending set can never be reopened through the UI (its submit affordance
  // is gated by the SAME set), so it is dead weight in storage. Gated on a
  // SETTLED clean read, fail-closed: the read starts data-less (an
  // unguarded pass would run against the transient empty set and wipe every
  // parked draft) and a settled-FAILED read must never be read as "nothing
  // is owed". A sweep that actually removed keys surfaces the localized
  // hygiene diagnostics line through the notice lane — deliberately an
  // unconditional set: a removal only ever happens when the pending set
  // shrank, and the just-submitted session's own draft was cleared BEFORE
  // its refetch lands, so the success notice is never competing content in
  // the only realistic sweep-during-submit window.
  useEffect(() => {
    if (pendingData === undefined || pendingError !== undefined) return;
    const removedKeys = pruneOrphanedRubricDrafts(pendingSessionIds);
    if (removedKeys.length === 0) return;
    setNotice({ message: t.rubricDraftsPrunedLine(removedKeys.length), severity: "info" });
  }, [pendingData, pendingError, pendingSessionIds, setNotice, t]);

  const [submitRubricEvaluation] = useMutation(submitRubricEvaluationMutationDocument);

  // The in-flight latch spans the WHOLE submit attempt — the mutation AND
  // the pending-refetch tail — so the dialog's submitting gate (CTA loading
  // + dismissal guard) stays raised until the attempt fully settles. The
  // ref is the authoritative latch (state alone reads stale across
  // same-tick re-entries); the mirrored state drives the render gate.
  const [submitAttemptInFlight, setSubmitAttemptInFlight] = useState(false);
  const submitAttemptInFlightRef = useRef(false);

  const submitEvaluation = async (
    sessionId: string,
    input: RubricEvaluationSubmitInput
  ): Promise<RubricSubmitOutcome> => {
    if (submitAttemptInFlightRef.current) {
      // A second submit while the attempt is still in flight (e.g. during
      // the refetch tail) is a no-op — the first attempt owns the
      // settlement, and the raised submitting gate keeps the dialog's CTA
      // inert for it anyway.
      return { ok: false, code: null };
    }
    submitAttemptInFlightRef.current = true;
    setSubmitAttemptInFlight(true);
    try {
      const result = await submitRubricEvaluation({
        variables: { sessionId, input },
      });
      if (!result.data?.submitRubricEvaluation) {
        // Transport-masked settle without a receipt — the mapped
        // INTERNAL_SERVER_ERROR row already toasted app-scope; the dialog
        // stays open for an in-place retry.
        return { ok: false, code: null };
      }
      // The verdict committed: converge the pending set (the scored row
      // loses its affordance) WITHOUT letting a refetch failure mask the
      // success copy, then raise the localized success snackbar.
      await refetchPendingSessions().catch(() => undefined);
      setNotice({ message: t.rubricSubmittedSuccess, severity: "success" });
      return { ok: true, code: null };
    } catch (mutationError: unknown) {
      // Every typed denial of this flow carries its own error-map row, so
      // the localized toast/notice already rendered app-scope. Surface the
      // normalized code and keep the dialog open for retry.
      const rawCode = extractErrorCode(mutationError);
      return { ok: false, code: rawCode === null ? null : normalizeGraphQLErrorCode(rawCode) };
    } finally {
      submitAttemptInFlightRef.current = false;
      setSubmitAttemptInFlight(false);
    }
  };

  return { pendingSessionIds, submitEvaluation, submitting: submitAttemptInFlight, pendingError };
}
