import { skipToken, useMutation, useQuery } from "@apollo/client/react";
import { useState } from "react";
import {
  findStudentByHandshakeCodeQueryDocument,
  myOutgoingParentLinkRequestsQueryDocument,
  requestParentChildLinkMutationDocument,
} from "@/frontend/graphql/sharedDocuments";
import { extractErrorCode } from "@/frontend/lib/graphql-error-utils";
import {
  deriveHandshakeResultState,
  type HandshakeResultState,
} from "@/frontend/views/parent/handshake/deriveHandshakeResultState";
import type { SendOutcomeState } from "@/frontend/views/parent/handshake/HandshakeSendRequestAffordance";
import { isHandshakeCode, normalizeHandshakeCode } from "@/shared/constants";
import { ParentLink, useAppTranslation } from "@/shared/locale";

/** The resting send outcome — the affordance resets to this after edits. */
const SEND_OUTCOME_IDLE: SendOutcomeState = { kind: "idle" };

export interface UseHandshakeDiscoveryResult {
  readonly codeInput: string;
  readonly formatError: boolean;
  readonly serverValidationError: boolean;
  readonly errorCode: string | null;
  readonly resultState: HandshakeResultState;
  readonly sendOutcome: SendOutcomeState;
  readonly sendToast: string | null;
  readonly handleCodeInputChange: (value: string) => void;
  readonly handleSubmit: () => void;
  readonly handleSend: () => void;
  readonly handleToastClose: () => void;
}

/**
 * Encapsulates the state and data fetching logic for the parent handshake discovery page.
 */
export function useHandshakeDiscovery(): UseHandshakeDiscoveryResult {
  const tp = useAppTranslation(ParentLink);
  const [codeInput, setCodeInput] = useState("");
  const [validatedCode, setValidatedCode] = useState<string | null>(null);
  const [formatError, setFormatError] = useState(false);
  const [sendOutcome, setSendOutcome] = useState<SendOutcomeState>(SEND_OUTCOME_IDLE);
  const [sendToast, setSendToast] = useState<string | null>(null);

  const { data, error, loading, refetch } = useQuery(
    findStudentByHandshakeCodeQueryDocument,
    // `network-only`: discovery is a POINT-IN-TIME lookup — the student's
    // linkage state can change between searches (another parent may link
    // them at any moment), so the cache has no value here. Without this, an
    // edit → re-enter-the-SAME-code → resubmit cycle would re-activate the
    // query and cache-first would replay the stale `maskedName`/`linkable`
    // without a network round-trip. The skip gate stays the sole authority
    // over whether a query exists at all; `network-only` only governs how an
    // activated query resolves (always over the wire; results still write
    // back through the normal cache policies).
    validatedCode === null ? skipToken : { fetchPolicy: "network-only", variables: { code: validatedCode } }
  );

  const errorCode = error === undefined ? null : extractErrorCode(error);
  // The server re-judges the code shape (`VALIDATION`) — surfaced at the field
  // with the same format-teaching copy as the client gate. Fully derived (no
  // effect needed): the flag clears itself the moment a new search replaces
  // the rejected operation.
  const serverValidationError = errorCode === "VALIDATION";

  // The derived outcome of the gated discovery query (pure — see
  // `deriveHandshakeResultState`); the send affordance keys off its `found` +
  // `linkable` branch.
  const resultState = deriveHandshakeResultState({ validatedCode, loading, error, data });

  // The send mutation. The outgoing-list query (mounted
  // by `OutgoingLinkRequestsSection` below) is refetched after EVERY completed
  // send — including the collapsed `null` payload (a collapse writes zero
  // rows, so the refetch is a harmless no-op read; keeping it unconditional
  // avoids per-payload branching in the Apollo options).
  const [sendRequest] = useMutation(requestParentChildLinkMutationDocument, {
    refetchQueries: [{ query: myOutgoingParentLinkRequestsQueryDocument }],
  });

  const handleCodeInputChange = (value: string) => {
    setCodeInput(value);
    setFormatError(false);
    // A fresh edit invalidates the previous search — the result region
    // returns to idle (the skip gate keeps this transition network-free) and
    // the send affordance resets with it.
    setValidatedCode(null);
    setSendOutcome(SEND_OUTCOME_IDLE);
  };

  const handleSubmit = () => {
    const normalized = normalizeAndValidate(codeInput);
    if (normalized === null) {
      setFormatError(true);
      return;
    }
    setFormatError(false);
    // Resubmitting the UNCHANGED code (the retry path after a generic error
    // leaves the field untouched): `validatedCode` already holds this exact
    // value, so re-setting it is a no-op state update the query never sees —
    // the stale error would persist forever. Force the retry through
    // `refetch` instead (still no `useLazyQuery`; the skip gate remains the
    // only authority over when a query exists at all).
    if (normalized === validatedCode) {
      void refetch({ code: normalized });
      return;
    }
    setValidatedCode(normalized);
  };

  /**
   * Send-affordance submit. The ONLY-nullable payload is
   * collapsed at THIS boundary: `null` → the `sendUnavailableNotice`
   * info state (code miss ≡ governed target — same surface, no oracle); a row
   * → the `requestPendingNotice` info state + the localized success toast.
   * Errors project into the localized inline Alert — never an unhandled
   * rejection.
   */
  const handleSend = (): void => {
    if (validatedCode === null || sendOutcome.kind === "in-flight") {
      return;
    }
    setSendOutcome({ kind: "in-flight" });
    void sendRequest({ variables: { code: validatedCode } })
      .then(result => {
        // `result.data` is `TData | undefined` (never null) — the collapse
        // rides the ONLY-nullable `requestParentChildLink` payload below.
        const payload = result.data === undefined ? null : result.data.requestParentChildLink;
        if (payload === null) {
          setSendOutcome({ kind: "unavailable" });
          return null;
        }
        setSendOutcome({ kind: "pending" });
        setSendToast(tp.sendRequestSuccessToast);
        return payload;
      })
      .catch((mutationError: unknown) => {
        setSendOutcome({ kind: "denied", code: extractErrorCode(mutationError) });
      });
  };

  const handleToastClose = () => setSendToast(null);

  return {
    codeInput,
    formatError,
    serverValidationError,
    errorCode,
    resultState,
    sendOutcome,
    sendToast,
    handleCodeInputChange,
    handleSubmit,
    handleSend,
    handleToastClose,
  };
}

/**
 * Canonical client gate: normalize first (trim + uppercase), then validate
 * against the shared shape guard. Returns the normalized code, or `null`
 * when the input can never be a handshake code.
 */
function normalizeAndValidate(raw: string): string | null {
  const normalized = normalizeHandshakeCode(raw);
  return isHandshakeCode(normalized) ? normalized : null;
}
