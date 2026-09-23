import type { ApolloCache } from "@apollo/client";
import { extractErrorCode } from "@/frontend/lib/graphql-error-utils";
import { projectMutationFieldErrors } from "@/frontend/lib/mutationFieldErrors";
import { isNotFoundErrorFamily, normalizeGraphQLErrorCode } from "@/frontend/providers/apollo/error-link.map";
import {
  evictSessionFromListFields,
  STUDENT_SESSION_LIST_FIELDS,
} from "@/frontend/views/student/sessions/sessionListCacheEviction";

/**
 * Submit-error classification for the student's teacher-rating mutation —
 * the code → behavior arms behind `RateTeacherDialog`, kept module-scope so
 * the dialog component stays the seam only.
 */

/** Wire field path the VALIDATION `extensions.fields[]` pairs address. */
const RATING_FIELD = "rating";

/** Write-once arbiter rejection (the mapping table carries its notice row). */
const EVALUATION_ALREADY_SUBMITTED_CODE = "EVALUATION_ALREADY_SUBMITTED";

/** Dual-confirmation gate rejection (the mapping table carries its notice row). */
const EVALUATION_SESSION_NOT_COMPLETED_CODE = "EVALUATION_SESSION_NOT_COMPLETED";

/** Localized error-arms contract for one failed submit. */
export interface RateTeacherErrorArms {
  /** The Apollo cache — the not-found arm evicts the rated row. */
  readonly cache: ApolloCache;
  readonly sessionId: string;
  /** `SESSION_NOT_FOUND` — the row has been evicted; the container drops it UI-side. */
  readonly onSessionMissing: (sessionId: string) => void;
  /** Gate reject — the container closes the dialog slot; the notice renders app-scope. */
  readonly onSessionNotCompleted: (sessionId: string) => void;
  /** Write-once reject — the container marks the row rated; the notice renders app-scope. */
  readonly onAlreadySubmitted: (sessionId: string) => void;
  /** Server-localized `rating` field pair — rendered inline under the stars. */
  readonly onRatingFieldError: (message: string) => void;
  /** Everything else — error toast; the dialog stays open for a retry. */
  readonly onFailure: (message: string) => void;
  /** `errors.validation` — resolved by the caller (compile-time i18n handle). */
  readonly validationCopy: string;
  /** `errors.forbidden` — resolved by the caller. */
  readonly forbiddenCopy: string;
  /** `sessions.genericError` — resolved by the caller. */
  readonly genericErrorCopy: string;
}

/**
 * Submit-error arms, branch order preserved: not-found family → eviction +
 * `onSessionMissing`; write-once reject → `onAlreadySubmitted`; gate reject
 * → `onSessionNotCompleted`; server VALIDATION addressed at the rating
 * field → the inline field error; `FORBIDDEN` → `onFailure(forbiddenCopy)`;
 * everything else → `onFailure(genericErrorCopy)`.
 */
export function handleRateTeacherMutationError(error: unknown, arms: RateTeacherErrorArms): void {
  const rawCode = extractErrorCode(error);
  const code = rawCode === null ? "" : normalizeGraphQLErrorCode(rawCode);

  if (isNotFoundErrorFamily(code)) {
    evictSessionFromListFields(arms.cache, arms.sessionId, STUDENT_SESSION_LIST_FIELDS);
    arms.onSessionMissing(arms.sessionId);
    return;
  }
  if (code === EVALUATION_ALREADY_SUBMITTED_CODE) {
    arms.onAlreadySubmitted(arms.sessionId);
    return;
  }
  if (code === EVALUATION_SESSION_NOT_COMPLETED_CODE) {
    arms.onSessionNotCompleted(arms.sessionId);
    return;
  }
  if (code === "VALIDATION") {
    const ratingFieldError = projectMutationFieldErrors(error).find(pair => pair.field === RATING_FIELD);
    if (ratingFieldError !== undefined) {
      arms.onRatingFieldError(ratingFieldError.message);
      return;
    }
    arms.onFailure(arms.validationCopy);
    return;
  }
  if (code === "FORBIDDEN") {
    arms.onFailure(arms.forbiddenCopy);
    return;
  }
  arms.onFailure(arms.genericErrorCopy);
}
