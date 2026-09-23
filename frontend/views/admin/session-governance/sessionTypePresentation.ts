import { SessionIntent, SessionType } from "@/frontend/graphql/generated/gql/graphql";

/**
 * Shared non-component presentation helpers for the admin session-governance
 * surface (`AdminSessionRow` + `AdminSessionDetailDrawer` + the governance
 * dialogs).
 *
 * Every table is keyed by the server enum member STRINGS through
 * `Record<string, …>` lookups (the `sessionRowPresentation` convention —
 * oxlint `no-unsafe-enum-comparison` bans direct enum comparisons), so raw
 * wire tokens NEVER reach the rendered copy: both namespaces carry the
 * human labels (`typeStudentSession` … / `intentHifz` …). The consuming
 * lookups pin a neutral fallback (the status chip's defensive-corrupt arm
 * shape): an untabled wire token renders the generic type label or the
 * nullable-value placeholder, never an undefined render.
 */

/** Governance-namespace type option label keys (the filter select's vocabulary). */
type SessionTypeLabelKey = "typeStudentSession" | "typeTeacherEvaluation" | "typeReEvaluation";

/** Type-cell label key per wire token. */
export const SESSION_TYPE_LABEL_KEY: Record<string, SessionTypeLabelKey> = {
  [SessionType.StudentSession]: "typeStudentSession",
  [SessionType.TeacherEvaluation]: "typeTeacherEvaluation",
  [SessionType.ReEvaluation]: "typeReEvaluation",
};

/** Governance-namespace intent value label keys. */
type SessionIntentLabelKey = "intentHifz" | "intentTajweed" | "intentEvaluation";

/** Intent-cell label key per wire token (the wire member is nullable — callers render the placeholder). */
export const SESSION_INTENT_LABEL_KEY: Record<string, SessionIntentLabelKey> = {
  [SessionIntent.Hifz]: "intentHifz",
  [SessionIntent.Tajweed]: "intentTajweed",
  [SessionIntent.Evaluation]: "intentEvaluation",
};

/** Two-digit zero-pad for the `datetime-local` token's numeric date/time fields. */
function pad(value: number): string {
  return String(value).padStart(2, "0");
}

/**
 * ISO wire instant → local `datetime-local` token (the reschedule dialog's
 * prefill converter). An absent or unparseable instant yields the empty
 * token (the native date input's cleared state). Lives beside the wire-enum
 * tables as the surface's shared non-component presentation module — the
 * component file keeps only component exports (react-refresh discipline).
 */
export function isoToDatetimeLocalToken(iso: string | null): string {
  if (iso === null) return "";
  const instant = new Date(iso);
  if (Number.isNaN(instant.getTime())) return "";
  return `${instant.getFullYear()}-${pad(instant.getMonth() + 1)}-${pad(instant.getDate())}T${pad(
    instant.getHours()
  )}:${pad(instant.getMinutes())}`;
}
