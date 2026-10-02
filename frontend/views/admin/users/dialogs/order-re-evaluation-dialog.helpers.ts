/**
 * Order-re-evaluation dialog helpers — pure functions extracted from
 * `OrderReEvaluationDialog` so the component file stays a Fast-Refresh
 * component-only module (the `rateTeacherMutationError` /
 * `governance-actions-helpers` seam precedent).
 *
 * Covers the denial-code → localized-copy matrix and the client-mirrored
 * mandatory-reason gate of the `adminOrderTeacherReEvaluation` order
 * dialog.
 */

import type { ErrorsLabels } from "@/shared/locale/types/errors";

/**
 * Maps the closed re-evaluation denial codes to their `Errors` transport
 * copy — the `extensions.code` discipline, never an HTTP-status branch:
 *  - `WALLET_INSUFFICIENT_FUNDS` → `insufficientBalance` (the existing
 *    shared funds-denial leaf, reused verbatim — no new key);
 *  - `TEACHER_NOT_CERTIFIED` → `teacherNotCertified`;
 *  - `APPLICANT_NOT_AWAITING_RE_EVALUATION` → `applicantNotAwaitingReEvaluation`;
 *  - `VALIDATION` → the server's own localized validation message when one
 *    traveled with the error (it distinguishes the blank-reason denial from
 *    the over-limit denial), falling back to the `reEvaluationReasonRequired`
 *    leaf;
 *  - the admin-gate `FORBIDDEN` / `UNAUTHORIZED` rows;
 *  - anything else → generic `internalServerError`.
 */
export function orderReEvaluationErrorCopy(
  code: string | null,
  t: ErrorsLabels,
  serverMessage?: string | null
): string {
  const copyByCode: Record<string, (labels: ErrorsLabels) => string> = {
    APPLICANT_NOT_AWAITING_RE_EVALUATION: labels => labels.applicantNotAwaitingReEvaluation,
    FORBIDDEN: labels => labels.forbidden,
    TEACHER_NOT_CERTIFIED: labels => labels.teacherNotCertified,
    UNAUTHORIZED: labels => labels.unauthorized,
    VALIDATION: labels => labels.reEvaluationReasonRequired,
    WALLET_INSUFFICIENT_FUNDS: labels => labels.insufficientBalance,
  };
  if (code === "VALIDATION" && typeof serverMessage === "string" && serverMessage.trim() !== "") {
    return serverMessage;
  }
  return (code !== null ? copyByCode[code] : undefined)?.(t) ?? t.internalServerError;
}

/**
 * Client mirror of the server-side MANDATORY reason gate (trim +
 * non-empty). The server's own MAX-LENGTH bound has no shared constant to
 * mirror client-side (no cross-layer import), so an over-limit reason is
 * honestly rejected server-side with `VALIDATION` and the dialog renders
 * the server's localized over-limit copy for that code.
 */
export function isOrderReEvaluationReasonValid(raw: string): boolean {
  return raw.trim() !== "";
}
