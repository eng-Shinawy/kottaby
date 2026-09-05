/**
 * Type-Level Conformance Suite — session canonical types.
 * Validated by `bun tsgo` (the compiler is the test runner).
 * `.test-d.ts` suffix = outside bun test runner glob.
 *
 * POSITIVES use `satisfies` — must compile.
 * NEGATIVES use `@ts-expect-error` directly before the offending line.
 */
import { HeldBalanceLane } from "@/backend/enum/scheduling/held-balance-lane.enum";
import { SessionIntent } from "@/backend/enum/scheduling/session-intent.enum";
import { SessionStatus } from "@/backend/enum/scheduling/session-status.enum";
import { SessionType } from "@/backend/enum/scheduling/session-type.enum";
import type {
  SessionListFilterInput,
  SessionPageReturnType,
  SessionReturnType,
  SessionSelectType,
  SessionStudentIntentType,
  SessionSubmitInput,
  SessionTransitionProbeRowType,
} from "@/backend/types/classes/session.types";
import type {
  SessionRequestIdempotencyInsertType,
  SessionRequestIdempotencySelectType,
} from "@/backend/types/classes/session-request-idempotency.types";
import {
  SESSION_REQUEST_SESSION_TYPE,
  type SessionRequestContract,
} from "@/backend/types/contracts/session-request.contract.types";

/** Helper to consume variables for TS6133. */
const v = (x: unknown): boolean => Boolean(x);

/** Exact type-identity probe: tuple-wrapped mutual assignability (no widening, no distribution). */
type Equals<A, B> = [A, B] extends [B, A] ? true : false;

// ========== CANONICAL READ SHAPE (SessionReturnType) ==========

// Positive — the read shape IS the derived select row (never re-declared, never forked)
const sameRow: Equals<SessionReturnType, SessionSelectType> = true;
v(sameRow);

// Negative — the read shape must stay the derived select row
// @ts-expect-error — SessionReturnType must remain the derived select row
const forkedRow: Equals<SessionReturnType, SessionSelectType> = false;
v(forkedRow);

// Positive — the escrow provenance lane flows into the read shape via the column's $type<>() binding
const laneTyped: Equals<SessionReturnType["heldBalanceLane"], HeldBalanceLane | null> = true;
v(laneTyped);

// Negative — the lane must stay enum-typed (a raw string would mean the marker was lost)
// @ts-expect-error — heldBalanceLane is HeldBalanceLane | null, never a raw string
const laneRaw: Equals<SessionReturnType["heldBalanceLane"], string | null> = true;
v(laneRaw);

// Positive — full canonical read shape (every column, exact enum/nullable typing)
v({
  id: 1,
  teacherId: 2,
  studentId: 3,
  status: SessionStatus.Scheduled,
  sessionType: SessionType.StudentSession,
  intent: SessionIntent.Hifz,
  fee: "25.00",
  feeHeld: true,
  heldBalanceLane: HeldBalanceLane.Trial,
  startedAt: null,
  endedAt: null,
  confirmedByStudentAt: null,
  confirmedByTeacherAt: null,
  confirmationDeadline: new Date(),
  cancelReason: null,
  disputeReason: null,
  disputedAt: null,
  resolutionNote: null,
  resolvedAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
} satisfies SessionReturnType);

// ========== SESSION STUDENT INTENT (Hifz | Tajweed) ==========

// Positive — both members are valid student intents
const hifzIntent: SessionStudentIntentType = SessionIntent.Hifz;
const tajweedIntent: SessionStudentIntentType = SessionIntent.Tajweed;
v(hifzIntent);
v(tajweedIntent);

// Positive — the student intent vocabulary equals the contract's intent invariant
const intentAligned: Equals<SessionStudentIntentType, SessionRequestContract["intent"]> = true;
v(intentAligned);

// Negative — evaluation is structurally unreachable from a session submission
// @ts-expect-error — evaluation is not a student intent
const evalIntent: SessionStudentIntentType = SessionIntent.Evaluation;
v(evalIntent);

// Negative — raw member strings are rejected (string-enum closedness)
// @ts-expect-error — enum members only, never raw strings
const rawIntent: SessionStudentIntentType = "hifz";
v(rawIntent);

// ========== SUBMIT INPUT (closed client whitelist) ==========

// Positive — the closed whitelist for both bookable intents
v({ teacherId: 2, intent: SessionIntent.Hifz } satisfies SessionSubmitInput);
v({ teacherId: 3, intent: SessionIntent.Tajweed } satisfies SessionSubmitInput);

// Positive — the whitelist is exactly { teacherId, intent }
type SubmitKeys = keyof SessionSubmitInput;
const closedKeys: Equals<SubmitKeys, "teacherId" | "intent"> = true;
v(closedKeys);

// Negative — studentId is resolved server-side from the caller's context
v({
  teacherId: 2,
  intent: SessionIntent.Hifz,
  // @ts-expect-error — studentId is server-controlled
  studentId: 1,
} satisfies SessionSubmitInput);

// Negative — row identity is server-generated
v({
  teacherId: 2,
  intent: SessionIntent.Hifz,
  // @ts-expect-error — id is server-controlled
  id: 99,
} satisfies SessionSubmitInput);

// Negative — lifecycle status is server-controlled
v({
  teacherId: 2,
  intent: SessionIntent.Hifz,
  // @ts-expect-error — status is server-controlled
  status: SessionStatus.Scheduled,
} satisfies SessionSubmitInput);

// Negative — session type is pinned server-side
v({
  teacherId: 2,
  intent: SessionIntent.Hifz,
  // @ts-expect-error — sessionType is server-controlled
  sessionType: SessionType.StudentSession,
} satisfies SessionSubmitInput);

// Negative — the platform fee is server-owned
v({
  teacherId: 2,
  intent: SessionIntent.Hifz,
  // @ts-expect-error — fee is server-controlled
  fee: "25.00",
} satisfies SessionSubmitInput);

// Negative — the hold marker is server-controlled
v({
  teacherId: 2,
  intent: SessionIntent.Hifz,
  // @ts-expect-error — feeHeld is server-controlled
  feeHeld: true,
} satisfies SessionSubmitInput);

// Negative — the held lane is internal provenance
v({
  teacherId: 2,
  intent: SessionIntent.Hifz,
  // @ts-expect-error — heldBalanceLane is server-controlled
  heldBalanceLane: HeldBalanceLane.Trial,
} satisfies SessionSubmitInput);

// Negative — the confirmation deadline is computed by the producing service
v({
  teacherId: 2,
  intent: SessionIntent.Hifz,
  // @ts-expect-error — confirmationDeadline is server-controlled
  confirmationDeadline: new Date(),
} satisfies SessionSubmitInput);

// Negative — student confirmation stamp is server-written
v({
  teacherId: 2,
  intent: SessionIntent.Hifz,
  // @ts-expect-error — confirmedByStudentAt is server-controlled
  confirmedByStudentAt: new Date(),
} satisfies SessionSubmitInput);

// Negative — teacher confirmation stamp is server-written
v({
  teacherId: 2,
  intent: SessionIntent.Hifz,
  // @ts-expect-error — confirmedByTeacherAt is server-controlled
  confirmedByTeacherAt: new Date(),
} satisfies SessionSubmitInput);

// Negative — lifecycle start stamp is server-written
v({
  teacherId: 2,
  intent: SessionIntent.Hifz,
  // @ts-expect-error — startedAt is server-controlled
  startedAt: new Date(),
} satisfies SessionSubmitInput);

// Negative — lifecycle end stamp is server-written
v({
  teacherId: 2,
  intent: SessionIntent.Hifz,
  // @ts-expect-error — endedAt is server-controlled
  endedAt: new Date(),
} satisfies SessionSubmitInput);

// Negative — creation stamp is server-written
v({
  teacherId: 2,
  intent: SessionIntent.Hifz,
  // @ts-expect-error — createdAt is server-controlled
  createdAt: new Date(),
} satisfies SessionSubmitInput);

// Negative — update stamp is server-written
v({
  teacherId: 2,
  intent: SessionIntent.Hifz,
  // @ts-expect-error — updatedAt is server-controlled
  updatedAt: new Date(),
} satisfies SessionSubmitInput);

// Negative — the persisted cancellation reason is server-written
v({
  teacherId: 2,
  intent: SessionIntent.Hifz,
  // @ts-expect-error — cancelReason is server-controlled
  cancelReason: "changed plans",
} satisfies SessionSubmitInput);

// Negative — the dispute reason is server-written
v({
  teacherId: 2,
  intent: SessionIntent.Hifz,
  // @ts-expect-error — disputeReason is server-controlled
  disputeReason: "teacher no-show",
} satisfies SessionSubmitInput);

// Negative — the dispute stamp is server-written
v({
  teacherId: 2,
  intent: SessionIntent.Hifz,
  // @ts-expect-error — disputedAt is server-controlled
  disputedAt: new Date(),
} satisfies SessionSubmitInput);

// Negative — the arbitration note is server-written
v({
  teacherId: 2,
  intent: SessionIntent.Hifz,
  // @ts-expect-error — resolutionNote is server-controlled
  resolutionNote: "refunded in full",
} satisfies SessionSubmitInput);

// Negative — the arbitration stamp is server-written
v({
  teacherId: 2,
  intent: SessionIntent.Hifz,
  // @ts-expect-error — resolvedAt is server-controlled
  resolvedAt: new Date(),
} satisfies SessionSubmitInput);

// Negative — evaluation intent is not bookable through the submit input
v({
  teacherId: 2,
  // @ts-expect-error — evaluation intent is forbidden on the submit input
  intent: SessionIntent.Evaluation,
} satisfies SessionSubmitInput);

// ========== LIST FILTER INPUT ==========

// Positive — absent members drop out, null filters to unclassified rows, a member narrows
v({} satisfies SessionListFilterInput);
v({ status: null } satisfies SessionListFilterInput);
v({ status: SessionStatus.Completed } satisfies SessionListFilterInput);

// Negative — the filter must be a SessionStatus member, never a raw string
v({
  // @ts-expect-error — status filter must be a SessionStatus member
  status: "completed",
} satisfies SessionListFilterInput);

// Negative — the filter carries only status (closed filter shape)
v({
  // @ts-expect-error — unknown filter keys are rejected
  teacherId: 2,
} satisfies SessionListFilterInput);

// ========== PAGE RETURN SHAPE ==========

// Positive — honest pagination echo over derived read rows
const pageItems: readonly SessionReturnType[] = [];
v({
  items: pageItems,
  totalCount: 0,
  page: 1,
  pageSize: 25,
} satisfies SessionPageReturnType);

// Negative — the honest count is mandatory
// @ts-expect-error — totalCount mandatory
const noCount: SessionPageReturnType = {
  items: pageItems,
  page: 1,
  pageSize: 25,
};
v(noCount);

// Negative — pagination numbers are numbers
v({
  items: pageItems,
  totalCount: 0,
  // @ts-expect-error — page is a number
  page: "1",
  pageSize: 25,
} satisfies SessionPageReturnType);

// ========== TRANSITION PROBE ROW ==========

// Positive — the cold-path probe projection (exact columns, exact types)
v({
  id: 1,
  status: SessionStatus.Started,
  startedAt: null,
  studentId: 1,
  teacherId: 2,
} satisfies SessionTransitionProbeRowType);

// Positive — the probe is a projection of the canonical select row
type ProbeKeys = keyof SessionTransitionProbeRowType;
const probeProjection: Equals<
  SessionTransitionProbeRowType,
  Pick<SessionSelectType, "id" | "status" | "startedAt" | "studentId" | "teacherId">
> = true;
const probeKeys: Equals<ProbeKeys, "id" | "status" | "startedAt" | "studentId" | "teacherId"> = true;
v(probeProjection);
v(probeKeys);

// Negative — the probe row stays minimal (fee is not part of the classification)
v({
  id: 1,
  status: SessionStatus.Started,
  startedAt: null,
  studentId: 1,
  teacherId: 2,
  // @ts-expect-error — the probe row projects only the five classification columns
  fee: "25.00",
} satisfies SessionTransitionProbeRowType);

// Negative — the status column is mandatory for classification
// @ts-expect-error — status mandatory on the probe row
const noStatusProbe: SessionTransitionProbeRowType = {
  id: 1,
  startedAt: null,
  studentId: 1,
  teacherId: 2,
};
v(noStatusProbe);

// ========== SESSION REQUEST CONTRACT (planned insert shape) ==========

// Positive — planned insert shape (Hifz): feeHeld literal true, non-null fee/deadline, key carried
v({
  studentId: 1,
  teacherId: 2,
  intent: SessionIntent.Hifz,
  sessionType: SESSION_REQUEST_SESSION_TYPE,
  fee: "25.00",
  feeHeld: true as const,
  confirmationDeadline: new Date(),
  idempotencyKey: "sr-hifz-1",
} satisfies SessionRequestContract);

// Positive — planned insert shape (Tajweed)
v({
  studentId: 1,
  teacherId: 2,
  intent: SessionIntent.Tajweed,
  sessionType: SESSION_REQUEST_SESSION_TYPE,
  fee: "25.00",
  feeHeld: true as const,
  confirmationDeadline: new Date(),
  idempotencyKey: "sr-tajweed-1",
} satisfies SessionRequestContract);

// Positive — contract invariants are exactly the select row's columns narrowed
const feeNarrowed: Equals<SessionRequestContract["fee"], NonNullable<SessionSelectType["fee"]>> = true;
const deadlineNarrowed: Equals<
  SessionRequestContract["confirmationDeadline"],
  NonNullable<SessionSelectType["confirmationDeadline"]>
> = true;
v(feeNarrowed);
v(deadlineNarrowed);

// Negative — the fee is ALWAYS held at request time
v({
  studentId: 1,
  teacherId: 2,
  intent: SessionIntent.Hifz,
  sessionType: SESSION_REQUEST_SESSION_TYPE,
  fee: "25.00",
  // @ts-expect-error — feeHeld must be the literal true
  feeHeld: false,
  confirmationDeadline: new Date(),
  idempotencyKey: "sr-1",
} satisfies SessionRequestContract);

// Negative — the fee is non-null (platform constant for the intent)
v({
  studentId: 1,
  teacherId: 2,
  intent: SessionIntent.Hifz,
  sessionType: SESSION_REQUEST_SESSION_TYPE,
  // @ts-expect-error — fee must be non-null
  fee: null,
  feeHeld: true as const,
  confirmationDeadline: new Date(),
  idempotencyKey: "sr-1",
} satisfies SessionRequestContract);

// Negative — the confirmation deadline is non-null (computed by the producing service)
v({
  studentId: 1,
  teacherId: 2,
  intent: SessionIntent.Hifz,
  sessionType: SESSION_REQUEST_SESSION_TYPE,
  fee: "25.00",
  feeHeld: true as const,
  // @ts-expect-error — deadline must be non-null
  confirmationDeadline: null,
  idempotencyKey: "sr-1",
} satisfies SessionRequestContract);

// Negative — evaluation intent is forbidden on the session request
v({
  studentId: 1,
  teacherId: 2,
  // @ts-expect-error — evaluation intent forbidden
  intent: SessionIntent.Evaluation,
  sessionType: SESSION_REQUEST_SESSION_TYPE,
  fee: "25.00",
  feeHeld: true as const,
  confirmationDeadline: new Date(),
  idempotencyKey: "sr-1",
} satisfies SessionRequestContract);

// Negative — the idempotency key is mandatory
// @ts-expect-error — idempotencyKey mandatory
const noKeyInsert: SessionRequestContract = {
  studentId: 1,
  teacherId: 2,
  intent: SessionIntent.Hifz,
  sessionType: SESSION_REQUEST_SESSION_TYPE,
  fee: "25.00",
  feeHeld: true as const,
  confirmationDeadline: new Date(),
};
v(noKeyInsert);

// ========== CLAIM TABLE TYPES (session request idempotency) ==========

// Positive — claim insert: key + owner only (identity/timestamp server-set, session backfilled later)
v({ idempotencyKey: "claim-1", userId: 1 } satisfies SessionRequestIdempotencyInsertType);
v({ idempotencyKey: "claim-2", userId: 1, sessionId: null } satisfies SessionRequestIdempotencyInsertType);

// Positive — claim select shape (all columns, exact nullability)
v({
  id: 1,
  idempotencyKey: "claim-3",
  userId: 1,
  sessionId: 7,
  createdAt: new Date(),
} satisfies SessionRequestIdempotencySelectType);

// Positive — claim column typings (opaque key, owner-bound, nullable session join)
const claimKeyTyped: Equals<SessionRequestIdempotencySelectType["idempotencyKey"], string> = true;
const claimOwnerTyped: Equals<SessionRequestIdempotencySelectType["userId"], number> = true;
const claimSessionTyped: Equals<SessionRequestIdempotencySelectType["sessionId"], number | null> = true;
v(claimKeyTyped);
v(claimOwnerTyped);
v(claimSessionTyped);

// Negative — the key is mandatory on a claim insert
// @ts-expect-error — idempotencyKey mandatory
const noKeyClaim: SessionRequestIdempotencyInsertType = { userId: 1 };
v(noKeyClaim);

// Negative — the owner is mandatory on a claim insert
// @ts-expect-error — userId mandatory
const noOwnerClaim: SessionRequestIdempotencyInsertType = { idempotencyKey: "claim-4" };
v(noOwnerClaim);

// Negative — the claim insert is closed (no server-managed extras)
v({
  idempotencyKey: "claim-5",
  userId: 1,
  // @ts-expect-error — no server-managed columns on the claim input
  balanceHifz: 5,
} satisfies SessionRequestIdempotencyInsertType);

// Negative — the session join is a number or null, never a string
v({
  idempotencyKey: "claim-6",
  userId: 1,
  // @ts-expect-error — sessionId is number | null
  sessionId: "7",
} satisfies SessionRequestIdempotencyInsertType);
