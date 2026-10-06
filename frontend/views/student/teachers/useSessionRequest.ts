"use client";

/**
 * useSessionRequest — the request-session write path behind the student
 * teacher-directory CTA, mirroring the `useEvaluationBooking` precedent
 * (the hook in its own module for Fast Refresh + max-lines).
 *
 * Owns the dialog's intent select state, the per-open idempotency-key
 * lifecycle, and the outcome lanes of the confirm gate:
 *
 * - Confirm executes `createSession` (the shared scheduling document from
 *   the `sharedDocuments` barrel) carrying the per-OPEN
 *   `x-idempotency-key` context header: the key is minted fresh on every
 *   open (kept until success or close) and stable across in-place retries
 *   so a domain rejection replays the SAME claim server-side
 *   (`docs/IDEMPOTENCY.md`).
 * - Outcome lanes (`extensions.code` branch via `extractErrorCode`,
 *   localized copy only):
 *   success → directory refetch + success notice + close + route to the
 *   student's sessions page (the booking landed there);
 *   `DUPLICATE_REQUEST` → idempotent success — the request already landed
 *   server-side — info notice + refetch + close + the same route;
 *   `INSUFFICIENT_BALANCE` / `SUBSCRIPTION_EXPIRED` /
 *   `TEACHER_NOT_CERTIFIED` / `TEACHER_NOT_FOUND` / `FORBIDDEN` → typed
 *   localized denial through the existing `errors` keys, dialog STAYS
 *   OPEN (the caller may change the subject or pick another teacher);
 *   everything else (transport, unreachable `VALIDATION` boundary guards,
 *   masked 500s) → the generic `requestGenericFailure` lane, dialog stays
 *   open, retry replays the SAME kept idempotency key in place.
 *
 * The intent select preselects the APPLIED browse filter's intent on every
 * open (the close/settle path resets it, mirroring the booking precedent).
 *
 * While the dialog is OPEN, the hook also runs the caller's own
 * `mySessionBalance` observer (skipToken while closed — no request, the
 * booking precedent's evaluator-picker read) and hands the RESOLVED
 * payload to the dialog's credits strip; loading and error both collapse
 * to `null` so the strip renders nothing (silent honest degradation —
 * booking still works, the server remains authoritative).
 *
 * Apollo hooks come from `@apollo/client/react` (never `useLazyQuery`);
 * every user-facing string resolves through the compile-time
 * `TeacherDirectory`/`Errors` handles (property access only).
 */

import { skipToken, useMutation, useQuery } from "@apollo/client/react";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import type { MySessionBalanceQuery_mySessionBalance } from "@/frontend/graphql/generated/gql/graphql";
import { createSessionMutationDocument, mySessionBalanceQueryDocument } from "@/frontend/graphql/sharedDocuments";
import { extractErrorCode } from "@/frontend/lib/graphql-error-utils";
import type { BrowseIntent } from "@/frontend/views/student/teachers/teacherDirectoryPresentation";
import { Errors, TeacherDirectory, useAppTranslation } from "@/shared/locale";
import type { ErrorsLabels } from "@/shared/locale/types/errors";
import type { TeacherDirectoryLabels } from "@/shared/locale/types/teacherDirectory";

/** The post-booking destination — the surface that owns the created session. */
const STUDENT_SESSIONS_ROUTE = "/student/sessions";

/** The transient request notice record rendered through the shared notice slot. */
type RequestNotice = { readonly message: string; readonly severity: "success" | "info" | "error" };

/** Everything the module-scope outcome lanes need to settle one request result. */
interface RequestSettleWiring {
  /** Compile-time localized copy handles (property access only). */
  readonly t: TeacherDirectoryLabels;
  readonly te: ErrorsLabels;
  /** Closes the dialog — rotates the claim key and resets the intent. */
  readonly closeDialog: () => void;
  /** Refetches the browse page so settled/started states re-render honestly. */
  readonly refetchDirectory: () => Promise<unknown>;
  readonly setNotice: (notice: RequestNotice) => void;
  /** Routes to the student's sessions page (the post-booking destination). */
  readonly navigateToSessions: () => void;
}

/**
 * The `extensions.code` → `errors`-namespace denial table for the booking
 * domain (every code `createSession` can surface that the constrained UI
 * can actually provoke — the boundary `VALIDATION` guards are unreachable
 * through the whitelisted select/id surfaces and stay on the generic lane).
 */
const DENIAL_MESSAGE_BY_CODE: Readonly<Record<string, (te: ErrorsLabels) => string>> = {
  FORBIDDEN: te => te.forbidden,
  INSUFFICIENT_BALANCE: te => te.insufficientBalance,
  SUBSCRIPTION_EXPIRED: te => te.subscriptionExpired,
  TEACHER_NOT_CERTIFIED: te => te.teacherNotCertified,
  TEACHER_NOT_FOUND: te => te.teacherNotFound,
};

/**
 * The settled-success shape (shared by the real success and the
 * idempotent-replay success): the browse refetches FIRST (a refetch
 * failure folds silently — it must not mask the notice), then notice +
 * close + the route to the sessions page.
 */
async function settleSuccess(
  message: string,
  severity: "success" | "info",
  wiring: RequestSettleWiring
): Promise<void> {
  await wiring.refetchDirectory().catch(() => undefined);
  wiring.setNotice({ message, severity });
  wiring.closeDialog();
  wiring.navigateToSessions();
}

/**
 * Branches a rejected `createSession` confirmation onto its typed outcome
 * lane: the idempotent replay settles as success, a typed denial stays
 * open with its localized message, everything else lands on the generic
 * retryable-in-place lane (a retry replays the SAME kept key).
 */
async function settleRejection(code: string | null, wiring: RequestSettleWiring): Promise<void> {
  if (code === "DUPLICATE_REQUEST") {
    // Same-key replay: the first request already landed server-side —
    // surface it as already-received (calm info lane).
    await settleSuccess(wiring.t.requestDuplicateNotice, "info", wiring);
    return;
  }
  const resolveDenial = code === null ? undefined : DENIAL_MESSAGE_BY_CODE[code];
  if (resolveDenial !== undefined) {
    wiring.setNotice({ message: resolveDenial(wiring.te), severity: "error" });
    return;
  }
  wiring.setNotice({ message: wiring.t.requestGenericFailure, severity: "error" });
}

interface SessionRequestWiring {
  /**
   * Whether the dialog is open — gates the hook's ONE open-gated read,
   * the caller's prepaid-credit balance for the credits strip (skipToken
   * while closed, mirroring the booking precedent's evaluator picker).
   */
  readonly open: boolean;
  /**
   * The requested teacher's id (`null` while the dialog is closed). The
   * identity surfaces to the wire ONLY inside the `createSession` input.
   */
  readonly teacherId: number | null;
  /** The intent preselected on every open — the applied filter's intent. */
  readonly initialIntent: BrowseIntent;
  /** Closes the dialog (every settle lane + dismiss affordance routes here). */
  readonly onClose: () => void;
  /** Refetches the directory browse after outcomes that change it. */
  readonly refetchDirectory: () => Promise<unknown>;
}

interface SessionRequest {
  /** The dialog's selected subject intent (reset per open). */
  readonly intent: BrowseIntent;
  /** Marks one intent as the confirm target (pre-narrowed by the dialog). */
  readonly selectIntent: (intent: BrowseIntent) => void;
  /** `true` while the create mutation is in flight. */
  readonly submitting: boolean;
  /**
   * Closes the dialog from ANY dismiss affordance — rotates the claim key
   * and resets the intent so a reopen starts from the applied filter.
   */
  readonly closeRequest: () => void;
  /** The transient request notice (null = idle; survives the dialog close). */
  readonly notice: RequestNotice | null;
  /** Confirms the request against the selected teacher + intent. */
  readonly confirmRequest: () => Promise<void>;
  /** Dismisses the transient notice. */
  readonly dismissNotice: () => void;
  /**
   * The caller's resolved prepaid credit lanes for the dialog's credits
   * strip — `null` while the balance read is loading or failed (both
   * states render nothing; the strip is a courtesy read, never a gate).
   */
  readonly sessionBalance: MySessionBalanceQuery_mySessionBalance | null;
}

/** The request-session write path — see the module docblock. */
export function useSessionRequest(wiring: SessionRequestWiring): SessionRequest {
  const t = useAppTranslation(TeacherDirectory);
  const te = useAppTranslation(Errors);
  const router = useRouter();
  const { teacherId, initialIntent, onClose, refetchDirectory } = wiring;
  const [notice, setNotice] = useState<RequestNotice | null>(null);
  const [intent, setIntent] = useState<BrowseIntent>(initialIntent);
  // Per-open idempotency key — minted on every close/settle (kept until
  // success or close), stable across in-place retries so domain
  // rejections replay the same claim server-side.
  const idempotencyKeyRef = useRef<string>(crypto.randomUUID());
  const [createSession, { loading: submitting }] = useMutation(createSessionMutationDocument);

  // Open-gated balance read for the credits strip: skipToken while the
  // dialog is closed (standby policy — no request, same undefined-data
  // observable as skip). Loading AND error collapse to `null`: the strip
  // renders only a resolved payload (silent honest degradation — the
  // server's debit ladder remains the sole booking authority).
  const balanceResult = useQuery(mySessionBalanceQueryDocument, wiring.open ? {} : skipToken);
  const sessionBalance = balanceResult.data?.mySessionBalance ?? null;

  const navigateToSessions = (): void => {
    router.push(STUDENT_SESSIONS_ROUTE);
  };

  const closeRequest = (): void => {
    idempotencyKeyRef.current = crypto.randomUUID();
    setIntent(initialIntent);
    onClose();
  };

  const settleWiring: RequestSettleWiring = {
    t,
    te,
    closeDialog: closeRequest,
    refetchDirectory,
    setNotice,
    navigateToSessions,
  };

  const confirmRequest = async (): Promise<void> => {
    if (teacherId === null || submitting) {
      return;
    }
    try {
      const result = await createSession({
        variables: { input: { teacherId, intent } },
        context: { headers: { "x-idempotency-key": idempotencyKeyRef.current } },
      });
      const payload = result.data?.createSession;
      if (!payload) {
        // Transport-masked settle without data — the same retryable
        // generic lane as the catch arm. The dialog stays open.
        setNotice({ message: t.requestGenericFailure, severity: "error" });
        return;
      }
      await settleSuccess(t.requestSuccessNotice, "success", settleWiring);
    } catch (mutationError: unknown) {
      await settleRejection(extractErrorCode(mutationError), settleWiring);
    }
  };

  const dismissNotice = (): void => setNotice(null);

  return {
    intent,
    selectIntent: setIntent,
    submitting,
    closeRequest,
    notice,
    confirmRequest,
    dismissNotice,
    sessionBalance,
  };
}
