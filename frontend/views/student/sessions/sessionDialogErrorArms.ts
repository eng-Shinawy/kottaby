import type { ApolloCache } from "@apollo/client";
import { extractErrorCode } from "@/frontend/lib/graphql-error-utils";
import {
  isNotFoundErrorFamily,
  mapGraphQLErrorByCode,
  normalizeGraphQLErrorCode,
} from "@/frontend/providers/apollo/error-link.map";
import {
  CANCEL_ROLE_SESSION_LIST_FIELDS,
  evictSessionFromListFields,
} from "@/frontend/views/student/sessions/sessionListCacheEviction";

/**
 * Mutation-error classifiers for the two confirm-and-reason session dialogs
 * (`CancelSessionConfirmDialog` / `SessionDisputeConfirmDialog`). The code →
 * coarse behavior classification runs through the SINGLE
 * `mapGraphQLErrorByCode` table (`frontend/providers/apollo/error-link.map.ts`)
 * — the server `message` is NEVER echoed; the localized copy resolves at the
 * call sites through the sessions/errors namespaces.
 */

/** Unmapped lifecycle-reject code (the mapping table defines NO row for it). */
const SESSION_INVALID_TRANSITION_CODE = "SESSION_INVALID_TRANSITION";

export interface CancelSessionErrorArms {
  /** The Apollo cache — the not-found arm evicts the cancelled row. */
  readonly cache: ApolloCache;
  readonly sessionId: string;
  /** `SESSION_NOT_FOUND` — the container should drop the row UI-side (cache is evicted here). */
  readonly onSessionMissing: (sessionId: string) => void;
  /** `SESSION_INVALID_TRANSITION` — the container raises the row-scoped inline alert. */
  readonly onInvalidTransition: (sessionId: string) => void;
  /** `DUPLICATE_REQUEST` replay — informational, success-equivalent. */
  readonly onDuplicateReplay: () => void;
  /** Everything else — error toast; the dialog stays open for a retry. */
  readonly onFailure: (message: string) => void;
  /** `errors.forbidden` — resolved by the caller (compile-time i18n handle). */
  readonly forbiddenCopy: string;
  /** `sessions.genericError` — resolved by the caller. */
  readonly genericErrorCopy: string;
}

/**
 * Cancel-dialog error arms (plan §5 — cancel flow), branch order preserved:
 * not-found family → role-list eviction + `onSessionMissing`;
 * `DUPLICATE_REQUEST` (map row: success-equivalent) → `onDuplicateReplay`
 * (never an error treatment — docs/IDEMPOTENCY.md §3);
 * `SESSION_INVALID_TRANSITION` (no mapping row — the documented
 * "caller keeps pre-existing behavior" arm) → the local inline alert;
 * `FORBIDDEN` → `onFailure(forbiddenCopy)`; everything else →
 * `onFailure(genericErrorCopy)` with the dialog kept open for a retry.
 */
export function handleCancelSessionMutationError(error: unknown, arms: CancelSessionErrorArms): void {
  const rawCode = extractErrorCode(error);
  const code = rawCode === null ? "" : normalizeGraphQLErrorCode(rawCode);

  if (isNotFoundErrorFamily(code)) {
    evictSessionFromListFields(arms.cache, arms.sessionId, CANCEL_ROLE_SESSION_LIST_FIELDS);
    arms.onSessionMissing(arms.sessionId);
    return;
  }

  const action = mapGraphQLErrorByCode(code, { contextKind: "mutation", hasForm: false });

  if (action?.duplicateSuccessEquivalent === true) {
    arms.onDuplicateReplay();
    return;
  }
  if (code === SESSION_INVALID_TRANSITION_CODE) {
    arms.onInvalidTransition(arms.sessionId);
    return;
  }
  if (action?.kind === "toast" && action.messageKey === "forbidden") {
    arms.onFailure(arms.forbiddenCopy);
    return;
  }
  arms.onFailure(arms.genericErrorCopy);
}

export interface DisputeSessionErrorArms {
  readonly sessionId: string;
  /** `SESSION_NOT_FOUND` — error snackbar; the row stays (see the dialog docblock). */
  readonly onSessionMissing: (sessionId: string) => void;
  /** `SESSION_INVALID_TRANSITION` — error snackbar; the row stays. */
  readonly onInvalidTransition: (sessionId: string) => void;
  /** Everything else — error toast; the dialog stays open for a retry. */
  readonly onFailure: (message: string) => void;
  /** `errors.validation` — resolved by the caller. */
  readonly validationCopy: string;
  /** `errors.forbidden` — resolved by the caller. */
  readonly forbiddenCopy: string;
  /** `sessions.genericError` — resolved by the caller. */
  readonly genericErrorCopy: string;
}

/**
 * Dispute-dialog error arms (plan §3.1/§4 — the dispute vocabulary is
 * snackbar-mapped), branch order preserved: not-found family →
 * `onSessionMissing` (deliberately NO eviction arm — a dispute denial never
 * mutates the caller's list); `SESSION_INVALID_TRANSITION` →
 * `onInvalidTransition`; server `VALIDATION` (rejected reason) →
 * `onFailure(validationCopy)`; `FORBIDDEN` → `onFailure(forbiddenCopy)`;
 * everything else → `onFailure(genericErrorCopy)` — the dialog stays open
 * for a retry on every failure arm.
 */
export function handleDisputeSessionMutationError(error: unknown, arms: DisputeSessionErrorArms): void {
  const rawCode = extractErrorCode(error);
  const code = rawCode === null ? "" : normalizeGraphQLErrorCode(rawCode);

  if (isNotFoundErrorFamily(code)) {
    arms.onSessionMissing(arms.sessionId);
    return;
  }
  if (code === SESSION_INVALID_TRANSITION_CODE) {
    arms.onInvalidTransition(arms.sessionId);
    return;
  }
  if (code === "VALIDATION") {
    arms.onFailure(arms.validationCopy);
    return;
  }
  if (code === "FORBIDDEN") {
    arms.onFailure(arms.forbiddenCopy);
    return;
  }
  arms.onFailure(arms.genericErrorCopy);
}
