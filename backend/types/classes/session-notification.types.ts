import type { SessionIntent } from "@/backend/enum/scheduling/session-intent.enum";
import type { AppLocale } from "@/shared/locale/AppLocale";

/** Closed wave vocabulary — the six lifecycle notifications of a session request. */
export type SessionRequestWaveKind =
  | "teacher_request"
  | "outcome_accepted"
  | "outcome_declined"
  | "outcome_auto_rejected"
  | "outcome_queued"
  | "outcome_alternatives_offered";

/** Raw joined read row (intent is STILL untrusted storage at this layer). */
export interface SessionWaveContextRow {
  readonly sessionId: number;
  readonly intent: string | null;
  readonly studentUserId: number;
  readonly studentFullName: string;
  readonly studentLocale: AppLocale | null;
  readonly teacherUserId: number;
  readonly teacherFullName: string;
  readonly teacherLocale: AppLocale | null;
}

/** Service-level, guard-validated wave context — intent is a real SessionIntent here. */
export interface SessionWaveParticipantContext {
  readonly userId: number;
  readonly fullName: string;
  readonly locale: AppLocale | null;
}

export interface SessionWaveContext {
  readonly sessionId: number;
  readonly intent: SessionIntent;
  readonly student: SessionWaveParticipantContext;
  readonly teacher: SessionWaveParticipantContext;
}
