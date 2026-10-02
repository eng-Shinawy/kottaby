/**
 * TeacherReEvaluationService — pure pre-DB validators and ledger-description
 * composers (module extraction, per the service-layer `.helpers.ts`
 * convention). Nothing here touches the database, opens a transaction, or
 * logs — every function is pure (or throws the canonical typed `VALIDATION`
 * denial).
 *
 * Members:
 *  - the reason normalizer (`normalizeReason`) — trim + length cap:
 *    whitespace-only content rejects with the required-reason denial and
 *    over-limit content rejects with the dedicated too-long denial (both
 *    localized, both pre-DB);
 *  - the description composer (`composeReEvaluationDescription`) — the
 *    machine-distinguishable ledger vocabulary for the paid re-evaluation
 *    charge, never colliding with the manual-adjustment or payout wording.
 */

import { ValidationError } from "@/backend/lib/errors";
import type { getServerTranslations } from "@/shared/locale/server-graphql";

/**
 * A free-text re-evaluation reason longer than this is rejected before any
 * DB work. The cap is the `teacher_transaction.description` column capacity
 * (`varchar(255)`) minus the composed-prefix headroom: the ledger description
 * is the sanctioned reason store and prepends a 19-char marker, so a longer
 * reason would overflow the column inside the mutation (Postgres 22001
 * surfacing as a generic internal error instead of the typed VALIDATION
 * denial).
 */
const MAX_REASON_LENGTH = 229;

/** Localized-error bundle type (the errorsTranslations namespace). */
type ErrorsTranslations = ReturnType<typeof getServerTranslations>["errorsTranslations"];

/**
 * Normalizes a REQUIRED free-text re-evaluation reason: trims, then rejects
 * whitespace-only content with the required-reason denial and over-limit
 * content with the too-long denial (both pre-DB `VALIDATION` rejections,
 * each carrying its own localized copy). The trimmed value feeds the ledger
 * description marker — the audit details never record the reason text.
 */
export function normalizeReason(value: string, t: ErrorsTranslations): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new ValidationError(t.reEvaluationReasonRequired);
  }
  if (trimmed.length > MAX_REASON_LENGTH) {
    throw new ValidationError(t.reEvaluationReasonTooLong);
  }
  return trimmed;
}

/**
 * Composes the re-evaluation fee ledger description: the
 * machine-distinguishable marker followed by the normalized reason. The
 * ledger row is the ONLY place the reason text is stored (write-once at
 * order time). The marker keeps `MAX_REASON_LENGTH` reasons inside the
 * description column's capacity, and its wording can never be confused with
 * a teacher-filed payout request or a manual admin adjustment.
 */
export function composeReEvaluationDescription(reason: string): string {
  return `Re-evaluation fee: ${reason}`;
}
