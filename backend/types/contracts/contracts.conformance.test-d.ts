/**
 * Type-Level Conformance Suite.
 * Validated by `bun tsgo` (the compiler is the test runner).
 * `.test-d.ts` suffix = outside bun test runner glob.
 *
 * POSITIVES use `satisfies` — must compile.
 * NEGATIVES use `@ts-expect-error` directly before the offending line.
 */
import { AuditActionType } from "@/backend/enum/audit/audit-action-type.enum";
import { TransactionType } from "@/backend/enum/billing/transaction-type.enum";
import { NotificationType } from "@/backend/enum/notifications/notification-type.enum";
import { SessionIntent } from "@/backend/enum/scheduling/session-intent.enum";
import { SessionType } from "@/backend/enum/scheduling/session-type.enum";
import { TeacherRequestPreference } from "@/backend/enum/teachers/teacher-request-preference.enum";
import { UserRole } from "@/backend/enum/users/user-role.enum";
import type { ActorContextRef, AuditLogWriteContract } from "@/backend/types/contracts/admin-audit.contract.types";
import {
  EVALUATION_SESSION_INTENT,
  type EvaluationSessionContract,
} from "@/backend/types/contracts/evaluation-session.contract.types";
import {
  type DualConfirmationState,
  type EscrowReleaseContract,
  type EscrowTriggerContract,
  WALLET_CREDIT_TRANSACTION_STATUS,
  WALLET_CREDIT_TRANSACTION_TYPE,
  type WalletCreditContract,
} from "@/backend/types/contracts/session-completion-escrow.contract.types";
import type {
  SessionEventNotificationContract,
  SessionEventNotificationType,
} from "@/backend/types/contracts/session-notification.contract.types";
import {
  SESSION_REQUEST_SESSION_TYPE,
  type SessionRequestContract,
} from "@/backend/types/contracts/session-request.contract.types";
import type {
  TeacherAvailabilitySnapshotContract,
  TeacherSubjectsParsed,
} from "@/backend/types/contracts/teacher-availability.contract.types";

// Helper to consume variables for TS6133
const v = (x: unknown): boolean => Boolean(x);

// ========== POSITIVES (must compile) ==========

// Positive — SessionRequest (Hifz)
v({
  studentId: 1,
  teacherId: 2,
  intent: SessionIntent.Hifz,
  sessionType: SESSION_REQUEST_SESSION_TYPE,
  fee: "25.00",
  feeHeld: true as const,
  confirmationDeadline: new Date(),
  idempotencyKey: "sr-1",
} satisfies SessionRequestContract);

// Positive — SessionRequest (Tajweed)
v({
  studentId: 1,
  teacherId: 2,
  intent: SessionIntent.Tajweed,
  sessionType: SESSION_REQUEST_SESSION_TYPE,
  fee: "25.00",
  feeHeld: true as const,
  confirmationDeadline: new Date(),
  idempotencyKey: "sr-2",
} satisfies SessionRequestContract);

// Positive — TeacherAvailabilitySnapshot
v({
  teacherId: 1,
  isOnline: true,
  averageRating: "4.50",
  subjects: ["Quran", "Tajweed"] as TeacherSubjectsParsed,
  requestPreference: TeacherRequestPreference.Queue,
  country: "EG",
  languages: { primaryLanguage: "ar", anotherLanguage: "en" },
} satisfies TeacherAvailabilitySnapshotContract);

// Positive — TeacherAvailabilitySnapshot with null rating
v({
  teacherId: 1,
  isOnline: false,
  averageRating: null,
  subjects: [] as TeacherSubjectsParsed,
  requestPreference: TeacherRequestPreference.Reject,
  country: "SA",
  languages: { primaryLanguage: "ar", anotherLanguage: null },
} satisfies TeacherAvailabilitySnapshotContract);

// Positive — EvaluationSession (TeacherEvaluation)
v({
  sessionType: SessionType.TeacherEvaluation,
  intent: EVALUATION_SESSION_INTENT,
  evaluatedId: 10,
  evaluatorId: 20,
  completedEvaluatorIds: [20, 21] as const,
  idempotencyKey: "eval-1",
} satisfies EvaluationSessionContract);

// Positive — EvaluationSession (ReEvaluation)
v({
  sessionType: SessionType.ReEvaluation,
  intent: EVALUATION_SESSION_INTENT,
  evaluatedId: 10,
  evaluatorId: 30,
  completedEvaluatorIds: [] as const,
  idempotencyKey: "eval-2",
} satisfies EvaluationSessionContract);

// Positive — DualConfirmationState
v({
  sessionId: 1,
  confirmedByTeacherAt: new Date(),
  confirmedByStudentAt: new Date(),
  confirmationDeadline: new Date(),
} satisfies DualConfirmationState);

// Positive — EscrowTrigger
v({
  sessionId: 1,
  confirmedByTeacherAt: new Date(),
  confirmedByStudentAt: new Date(),
  idempotencyKey: "esc-1",
} satisfies EscrowTriggerContract);

// Positive — WalletCredit
v({
  walletId: 1,
  sessionId: 1,
  amount: "25.00",
  type: WALLET_CREDIT_TRANSACTION_TYPE,
  status: WALLET_CREDIT_TRANSACTION_STATUS,
  idempotencyKey: "wc-1",
} satisfies WalletCreditContract);

// Positive — EscrowRelease with hold reference
v({
  sessionId: 1,
  releaseReason: "CancellationConfirmed" as const,
  holdIdempotencyKey: "hold-1",
  idempotencyKey: "er-1",
} satisfies EscrowReleaseContract);

// Positive — EscrowRelease without hold reference
v({
  sessionId: 1,
  releaseReason: "ConfirmationTimeout" as const,
  idempotencyKey: "er-2",
} satisfies EscrowReleaseContract);

// Positive — Notification with entityRef
v({
  userId: 1,
  type: NotificationType.SessionRequest as SessionEventNotificationType,
  title: "Session Request",
  body: "A new session...",
  idempotencyKey: "n-1",
  entityRef: { relatedEntityType: "session", relatedEntityId: 1 },
} satisfies SessionEventNotificationContract);

// Positive — Notification without entityRef
v({
  userId: 1,
  type: NotificationType.SessionCompletion as SessionEventNotificationType,
  title: "Done",
  body: "Completed.",
  entityRef: {},
} satisfies SessionEventNotificationContract);

// Positive — AuditWrite
v({
  actorId: 1,
  actionType: AuditActionType.Create,
  entityType: "session",
  entityId: 1,
  details: "{}",
} satisfies AuditLogWriteContract);

// Positive — AuditWrite: entity-less broadcasts (no single backing row)
// write a NULL entityId — the contract admits entities without one.
v({
  actorId: 1,
  actionType: AuditActionType.Create,
  entityType: "notification_broadcast",
  entityId: null,
  details: "{}",
} satisfies AuditLogWriteContract);

// Positive — ActorContext
v({ userId: 1, role: UserRole.Admin } satisfies ActorContextRef);

// Anchor — requestPreference: OfferAlternatives
v({
  teacherId: 1,
  isOnline: true,
  averageRating: null,
  subjects: [] as TeacherSubjectsParsed,
  requestPreference: TeacherRequestPreference.OfferAlternatives,
  country: "EG",
  languages: { primaryLanguage: "ar", anotherLanguage: null },
} satisfies TeacherAvailabilitySnapshotContract);

// Anchor — evaluation FKs point to users.id
v({
  sessionType: SessionType.TeacherEvaluation,
  intent: EVALUATION_SESSION_INTENT,
  evaluatedId: 5,
  evaluatorId: 6,
  completedEvaluatorIds: [6] as const,
  idempotencyKey: "x",
} satisfies EvaluationSessionContract);

// ========== NEGATIVES (@ts-expect-error immediately before the error) ==========

// Negative — passwordHash forbidden on SessionRequestContract
v({
  studentId: 1,
  teacherId: 2,
  intent: SessionIntent.Hifz,
  sessionType: SESSION_REQUEST_SESSION_TYPE,
  fee: "25.00",
  feeHeld: true as const,
  confirmationDeadline: new Date(),
  idempotencyKey: "x",
  // @ts-expect-error — credentials forbidden
  passwordHash: "hash",
} satisfies SessionRequestContract);

// Negative — isDeleted governance flag forbidden
v({
  teacherId: 1,
  isOnline: true,
  averageRating: "4.50",
  subjects: [] as TeacherSubjectsParsed,
  requestPreference: TeacherRequestPreference.Queue,
  country: "EG",
  languages: { primaryLanguage: "ar", anotherLanguage: "en" },
  // @ts-expect-error — governance flags forbidden
  isDeleted: false,
} satisfies TeacherAvailabilitySnapshotContract);

// Negative — balance excluded from session-request input
v({
  studentId: 1,
  teacherId: 2,
  intent: SessionIntent.Hifz,
  sessionType: SESSION_REQUEST_SESSION_TYPE,
  fee: "25.00",
  feeHeld: true as const,
  confirmationDeadline: new Date(),
  idempotencyKey: "x",
  // @ts-expect-error — balance excluded
  balanceHifz: 5,
} satisfies SessionRequestContract);

// Negative — passwordHash on AuditLogWriteContract
v({
  actorId: 1,
  actionType: AuditActionType.Create,
  entityType: "session",
  entityId: 1,
  details: "{}",
  // @ts-expect-error — credentials forbidden
  passwordHash: "hash",
} satisfies AuditLogWriteContract);

// Negative — email on ActorContextRef
v({
  userId: 1,
  role: UserRole.Student,
  // @ts-expect-error — only userId + role
  email: "test@test.com",
} satisfies ActorContextRef);

// Negative — wrong session type family
v({
  studentId: 1,
  teacherId: 2,
  intent: SessionIntent.Hifz,
  // @ts-expect-error — StudentSession only
  sessionType: SessionType.TeacherEvaluation,
  fee: "25.00",
  feeHeld: true as const,
  confirmationDeadline: new Date(),
  idempotencyKey: "x",
} satisfies SessionRequestContract);

// Negative — Evaluation intent forbidden on session request
v({
  studentId: 1,
  teacherId: 2,
  // @ts-expect-error — evaluation intent forbidden
  intent: SessionIntent.Evaluation,
  sessionType: SESSION_REQUEST_SESSION_TYPE,
  fee: "25.00",
  feeHeld: true as const,
  confirmationDeadline: new Date(),
  idempotencyKey: "x",
} satisfies SessionRequestContract);

// Negative — isRead forbidden on notification
v({
  userId: 1,
  type: NotificationType.SessionRequest as SessionEventNotificationType,
  title: "T",
  body: "B",
  // @ts-expect-error — isRead system-managed
  isRead: false,
  entityRef: {},
} satisfies SessionEventNotificationContract);

// Negative — id forbidden on audit write
v({
  actorId: 1,
  actionType: AuditActionType.Create,
  entityType: "session",
  entityId: 1,
  details: "{}",
  // @ts-expect-error — id system-set
  id: 999,
} satisfies AuditLogWriteContract);

// Negative — createdAt forbidden on audit write
v({
  actorId: 1,
  actionType: AuditActionType.Update,
  entityType: "user",
  entityId: 1,
  details: "{}",
  // @ts-expect-error — createdAt system-set
  createdAt: new Date(),
} satisfies AuditLogWriteContract);

// Negative — null timestamp on EscrowTrigger
v({
  sessionId: 1,
  // @ts-expect-error — both confirmations must be non-null
  confirmedByTeacherAt: null,
  confirmedByStudentAt: new Date(),
  idempotencyKey: "x",
} satisfies EscrowTriggerContract);

// Negative — amount on release
v({
  sessionId: 1,
  releaseReason: "CancellationConfirmed" as const,
  // @ts-expect-error — no amount
  amount: "25.00",
  idempotencyKey: "x",
} satisfies EscrowReleaseContract);

// Negative — walletId on release
v({
  sessionId: 1,
  releaseReason: "ConfirmationTimeout" as const,
  // @ts-expect-error — no walletId
  walletId: 1,
  idempotencyKey: "x",
} satisfies EscrowReleaseContract);

// Negative — inSession forbidden
v({
  teacherId: 1,
  isOnline: true,
  averageRating: "4.50",
  subjects: [] as TeacherSubjectsParsed,
  requestPreference: TeacherRequestPreference.Queue,
  country: "EG",
  languages: { primaryLanguage: "ar", anotherLanguage: "en" },
  // @ts-expect-error — no inSession
  inSession: false,
} satisfies TeacherAvailabilitySnapshotContract);

// Negative — half-populated entityRef
const halfRef: SessionEventNotificationContract = {
  userId: 1,
  type: NotificationType.SessionCancellation,
  title: "Cancel",
  body: "Cancelled",
  // @ts-expect-error — both-or-neither
  entityRef: { relatedEntityType: "session" },
};
v(halfRef);

// Negative — feeHeld must be true
v({
  studentId: 1,
  teacherId: 2,
  intent: SessionIntent.Hifz,
  sessionType: SESSION_REQUEST_SESSION_TYPE,
  fee: "25.00",
  // @ts-expect-error — feeHeld must be true
  feeHeld: false,
  confirmationDeadline: new Date(),
  idempotencyKey: "x",
} satisfies SessionRequestContract);

// Negative — missing idempotencyKey (use type annotation so error is on const line)
// @ts-expect-error — idempotencyKey mandatory
const noKey: SessionRequestContract = {
  studentId: 1,
  teacherId: 2,
  intent: SessionIntent.Hifz,
  sessionType: SESSION_REQUEST_SESSION_TYPE,
  fee: "25.00",
  feeHeld: true as const,
  confirmationDeadline: new Date(),
};
v(noKey);

// Negative — confirmationDeadline cannot be null
v({
  studentId: 1,
  teacherId: 2,
  intent: SessionIntent.Hifz,
  sessionType: SESSION_REQUEST_SESSION_TYPE,
  fee: "25.00",
  feeHeld: true as const,
  // @ts-expect-error — deadline must be non-null
  confirmationDeadline: null,
  idempotencyKey: "x",
} satisfies SessionRequestContract);

// readonly prevents push
// @ts-expect-error — readonly arrays are immutable (push is rejected)
([1, 2] as readonly number[]).push(3);

// Negative — missing sessionId on wallet credit
// @ts-expect-error — sessionId mandatory
const noSid: WalletCreditContract = {
  walletId: 1,
  amount: "25.00",
  type: WALLET_CREDIT_TRANSACTION_TYPE,
  status: WALLET_CREDIT_TRANSACTION_STATUS,
  idempotencyKey: "x",
};
v(noSid);

// Negative — wrong transaction type on wallet credit
v({
  walletId: 1,
  sessionId: 1,
  amount: "25.00",
  // @ts-expect-error — type must be Earning
  type: TransactionType.Withdrawal,
  status: WALLET_CREDIT_TRANSACTION_STATUS,
  idempotencyKey: "x",
} satisfies WalletCreditContract);

// Negative — missing evaluatorId
// @ts-expect-error — evaluatorId mandatory
const noEvalId: EvaluationSessionContract = {
  sessionType: SessionType.TeacherEvaluation,
  intent: EVALUATION_SESSION_INTENT,
  evaluatedId: 5,
  completedEvaluatorIds: [] as const,
  idempotencyKey: "x",
};
v(noEvalId);

// Negative — wrong notification type
v({
  userId: 1,
  // @ts-expect-error — only session event types
  type: NotificationType.PaymentConfirmation,
  title: "Pay",
  body: "Paid",
  entityRef: {},
} satisfies SessionEventNotificationContract);

// Negative — averageRating as number
const badRating: TeacherAvailabilitySnapshotContract = {
  teacherId: 1,
  isOnline: true,
  // @ts-expect-error — preserve string | null
  averageRating: 4.5,
  subjects: [] as TeacherSubjectsParsed,
  requestPreference: TeacherRequestPreference.Queue,
  country: "EG",
  languages: { primaryLanguage: "ar", anotherLanguage: "en" },
};
v(badRating);

// Negative — missing idempotencyKey on release
// @ts-expect-error — idempotencyKey mandatory on release
const releaseNoKey: EscrowReleaseContract = {
  sessionId: 1,
  releaseReason: "CancellationConfirmed" as const,
};
v(releaseNoKey);

// Negative — StudentSession on evaluation
v({
  // @ts-expect-error — StudentSession forbidden
  sessionType: SessionType.StudentSession,
  intent: EVALUATION_SESSION_INTENT,
  evaluatedId: 5,
  evaluatorId: 6,
  completedEvaluatorIds: [] as const,
  idempotencyKey: "x",
} satisfies EvaluationSessionContract);

// Negative — Hifz intent forbidden on evaluation contract
v({
  sessionType: SessionType.TeacherEvaluation,
  // @ts-expect-error — Hifz intent forbidden on evaluation
  intent: SessionIntent.Hifz,
  evaluatedId: 5,
  evaluatorId: 6,
  completedEvaluatorIds: [] as const,
  idempotencyKey: "x",
} satisfies EvaluationSessionContract);

// Negative — actionType must use enum member, not string literal
v({
  actorId: 1,
  // @ts-expect-error — must use AuditActionType enum member
  actionType: "admin_override",
  entityType: "session",
  entityId: 1,
  details: "{}",
} satisfies AuditLogWriteContract);
