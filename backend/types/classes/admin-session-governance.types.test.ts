/**
 * Type-shape suite — admin session governance canonical types.
 *
 * Runtime half: zod boundary round-trips — valid payloads parse through,
 * invalid payloads fail with at least one issue (bad identifiers, broken
 * window pairing, oversized reason, unknown enum members, out-of-window
 * pagination, unknown-key stripping).
 *
 * Compile-time half: schema↔interface identity and closed-shape pins,
 * validated by `bun tsgo` over this same file — positives via `satisfies`
 * and tuple-equality witnesses, negatives via targeted `@ts-expect-error`.
 */
import { describe, expect, test } from "bun:test";
import type { z } from "zod";
import { SessionStatus } from "@/backend/enum/scheduling/session-status.enum";
import { SessionType } from "@/backend/enum/scheduling/session-type.enum";
import {
  type AdminSessionCancelInput,
  AdminSessionCancelInputSchema,
  type AdminSessionDetail,
  type AdminSessionJoinInput,
  AdminSessionJoinInputSchema,
  type AdminSessionListFilterInput,
  AdminSessionListFilterInputSchema,
  type AdminSessionReassignInput,
  AdminSessionReassignInputSchema,
  type AdminSessionRescheduleInput,
  AdminSessionRescheduleInputSchema,
  type AdminSessionRowReturnType,
} from "@/backend/types/classes/admin-session-governance.types";
import type { SessionReturnType } from "@/backend/types/classes/session.types";

/** Exact type-identity probe: tuple-wrapped mutual assignability (no widening). */
type Equals<A, B> = [A, B] extends [B, A] ? true : false;

/** Consumes compile-time witness values (keeps `noUnusedLocals` quiet). */
const v = (x: unknown): boolean => Boolean(x);

/** Asserts a safeParse result accepted and returns the parsed data. */
function expectAcceptance<T>(result: z.ZodSafeParseResult<T>): T {
  expect(result.success).toBe(true);
  if (!result.success) {
    throw new Error(`expected schema acceptance, got ${result.error.issues.length} issue(s)`);
  }
  return result.data;
}

/** Asserts a safeParse result rejected and carries at least one issue. */
function expectRejection<T>(result: z.ZodSafeParseResult<T>): void {
  expect(result.success).toBe(false);
  if (!result.success) {
    expect(result.error.issues.length).toBeGreaterThan(0);
  }
}

// ===== Compile-time: schema output ≡ canonical interface (no drift) =====

const filterSchemaOut: Equals<z.output<typeof AdminSessionListFilterInputSchema>, AdminSessionListFilterInput> = true;
v(filterSchemaOut);

const rescheduleSchemaOut: Equals<
  z.output<typeof AdminSessionRescheduleInputSchema>,
  AdminSessionRescheduleInput
> = true;
v(rescheduleSchemaOut);

const cancelSchemaOut: Equals<z.output<typeof AdminSessionCancelInputSchema>, AdminSessionCancelInput> = true;
v(cancelSchemaOut);

const reassignSchemaOut: Equals<z.output<typeof AdminSessionReassignInputSchema>, AdminSessionReassignInput> = true;
v(reassignSchemaOut);

const joinSchemaOut: Equals<z.output<typeof AdminSessionJoinInputSchema>, AdminSessionJoinInput> = true;
v(joinSchemaOut);

// ===== Compile-time: canonical read-shape pins =====

/** A fully-populated canonical session read row (exact column typing). */
const baseRow = {
  id: 11,
  teacherId: 22,
  studentId: 33,
  status: SessionStatus.Scheduled,
  sessionType: SessionType.StudentSession,
  intent: null,
  fee: "25.00",
  feeHeld: true,
  heldBalanceLane: null,
  startedAt: null,
  endedAt: null,
  confirmedByStudentAt: null,
  confirmedByTeacherAt: null,
  confirmationDeadline: null,
  cancelReason: null,
  disputeReason: null,
  disputedAt: null,
  resolutionNote: null,
  resolutionOutcome: null,
  resolvedAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
} satisfies SessionReturnType;
v(baseRow);

// Positive — the badge flag extends the canonical row shape
v({ ...baseRow, needsAttention: true } satisfies AdminSessionRowReturnType);
v({ ...baseRow, needsAttention: false } satisfies AdminSessionRowReturnType);

// Negative — the badge flag is mandatory on the directory row
// @ts-expect-error — needsAttention is mandatory
const noBadgeRow: AdminSessionRowReturnType = baseRow;
v(noBadgeRow);

// Negative — the badge flag is boolean-only (styling flag, never a code string)
v({
  ...baseRow,
  // @ts-expect-error — needsAttention is a boolean
  needsAttention: "disputed",
} satisfies AdminSessionRowReturnType);

// Positive — the browse read is the row or null
const detailNull: AdminSessionDetail = null;
v(detailNull);
const detailRow: AdminSessionDetail = baseRow;
v(detailRow);

// Negative — an absent row is null, never undefined
// @ts-expect-error — undefined is not part of the browse-read shape
const detailUndefined: AdminSessionDetail = undefined;
v(detailUndefined);

// ===== Compile-time: closed input shapes =====

// Positive — every filter member is optional; a present member narrows
v({} satisfies AdminSessionListFilterInput);
v({ status: SessionStatus.Disputed } satisfies AdminSessionListFilterInput);
v({ type: SessionType.TeacherEvaluation, page: 3, pageSize: 25 } satisfies AdminSessionListFilterInput);
v({ teacherUserId: 4, studentUserId: 5 } satisfies AdminSessionListFilterInput);

// Negative — the filters are enum members, never raw strings
v({
  // @ts-expect-error — status filter is a SessionStatus member
  status: "completed",
} satisfies AdminSessionListFilterInput);
v({
  // @ts-expect-error — type filter is a SessionType member
  type: "student_session",
} satisfies AdminSessionListFilterInput);

// Negative — the filter shape is closed
v({
  // @ts-expect-error — unknown filter keys are rejected
  teacherRowId: 2,
} satisfies AdminSessionListFilterInput);

// Positive — reschedule, cancel, reassign, join whitelists
v({ sessionId: 7, startedAt: new Date(), endedAt: new Date() } satisfies AdminSessionRescheduleInput);
v({ sessionId: 7 } satisfies AdminSessionCancelInput);
v({ sessionId: 7, reason: "operational hold" } satisfies AdminSessionCancelInput);
v({ sessionId: 7, newTeacherUserId: 9 } satisfies AdminSessionReassignInput);
v({ sessionId: 7 } satisfies AdminSessionJoinInput);

// Negative — required members and closed shapes
// @ts-expect-error — the session id is mandatory
const missingJoinId: AdminSessionJoinInput = {};
v(missingJoinId);

v({
  // @ts-expect-error — the session id is a number, never a string
  sessionId: "7",
} satisfies AdminSessionJoinInput);

// @ts-expect-error — the end instant is mandatory
const noEnd: AdminSessionRescheduleInput = { sessionId: 7, startedAt: new Date() };
v(noEnd);

v({
  sessionId: 7,
  // @ts-expect-error — the cancel reason is a string, never a number
  reason: 42,
} satisfies AdminSessionCancelInput);

// @ts-expect-error — the candidate teacher id is mandatory
const noTeacher: AdminSessionReassignInput = { sessionId: 7 };
v(noTeacher);

// ===== Runtime: zod boundary round-trips =====

const WINDOW_START = new Date("2026-03-01T10:00:00.000Z");
const WINDOW_END = new Date("2026-03-01T12:00:00.000Z");
const SESSION_START = new Date("2026-03-05T09:00:00.000Z");
const SESSION_END = new Date("2026-03-05T10:30:00.000Z");
const REASON_AT_LIMIT = "r".repeat(330);
const REASON_OVER_LIMIT = "r".repeat(331);

describe("Admin Session Governance Types — zod boundary round-trips", () => {
  describe("directory filter", () => {
    test("accepts the full valid payload and echoes every member", () => {
      const parsed = expectAcceptance(
        AdminSessionListFilterInputSchema.safeParse({
          teacherUserId: 4,
          studentUserId: 5,
          type: SessionType.ReEvaluation,
          status: SessionStatus.Started,
          dateFrom: WINDOW_START,
          dateTo: WINDOW_END,
          page: 2,
          pageSize: 25,
        })
      );
      expect(parsed.teacherUserId).toBe(4);
      expect(parsed.studentUserId).toBe(5);
      expect(parsed.type).toBe(SessionType.ReEvaluation);
      expect(parsed.status).toBe(SessionStatus.Started);
      expect(parsed.dateFrom).toBe(WINDOW_START);
      expect(parsed.dateTo).toBe(WINDOW_END);
      expect(parsed.page).toBe(2);
      expect(parsed.pageSize).toBe(25);
    });

    test("accepts the empty filter (every member optional)", () => {
      const parsed = expectAcceptance(AdminSessionListFilterInputSchema.safeParse({}));
      expect(parsed.status).toBeUndefined();
      expect(parsed.page).toBeUndefined();
      expect(parsed.pageSize).toBeUndefined();
    });

    test("accepts the window page-size boundaries 1 and 50", () => {
      expectAcceptance(AdminSessionListFilterInputSchema.safeParse({ page: 1, pageSize: 1 }));
      expectAcceptance(AdminSessionListFilterInputSchema.safeParse({ page: 1, pageSize: 50 }));
    });

    test("accepts the zero-width creation window (dateFrom == dateTo)", () => {
      const parsed = expectAcceptance(
        AdminSessionListFilterInputSchema.safeParse({ dateFrom: WINDOW_START, dateTo: WINDOW_START })
      );
      expect(parsed.dateFrom).toBe(WINDOW_START);
    });

    test("rejects unknown enum members for type and status", () => {
      expectRejection(AdminSessionListFilterInputSchema.safeParse({ type: "bogus_type" }));
      expectRejection(AdminSessionListFilterInputSchema.safeParse({ status: "archived" }));
    });

    test("rejects out-of-window pagination", () => {
      expectRejection(AdminSessionListFilterInputSchema.safeParse({ page: 0 }));
      expectRejection(AdminSessionListFilterInputSchema.safeParse({ page: -1 }));
      expectRejection(AdminSessionListFilterInputSchema.safeParse({ page: 1.5 }));
      expectRejection(AdminSessionListFilterInputSchema.safeParse({ pageSize: 0 }));
      expectRejection(AdminSessionListFilterInputSchema.safeParse({ pageSize: 51 }));
    });

    test("rejects malformed identifiers", () => {
      expectRejection(AdminSessionListFilterInputSchema.safeParse({ teacherUserId: 0 }));
      expectRejection(AdminSessionListFilterInputSchema.safeParse({ studentUserId: -5 }));
      expectRejection(AdminSessionListFilterInputSchema.safeParse({ teacherUserId: 2.5 }));
    });

    test("rejects an inverted creation window but accepts an ordered one", () => {
      expectRejection(AdminSessionListFilterInputSchema.safeParse({ dateFrom: WINDOW_END, dateTo: WINDOW_START }));
      expectAcceptance(AdminSessionListFilterInputSchema.safeParse({ dateFrom: WINDOW_START, dateTo: WINDOW_END }));
    });

    test("rejects transport strings where Date instants are required", () => {
      expectRejection(AdminSessionListFilterInputSchema.safeParse({ dateFrom: "2026-03-01T10:00:00.000Z" }));
      expectRejection(AdminSessionListFilterInputSchema.safeParse({ dateTo: "2026-03-01T12:00:00.000Z" }));
    });

    test("strips client-supplied unknown keys (whitelist in, extras dropped)", () => {
      const parsed = expectAcceptance(
        AdminSessionListFilterInputSchema.safeParse({
          status: SessionStatus.Cancelled,
          feeHeld: true,
          heldBalanceLane: "trial",
        })
      );
      expect(Object.keys(parsed)).toEqual(["status"]);
    });
  });

  describe("reschedule", () => {
    test("accepts an ordered timing pair", () => {
      const parsed = expectAcceptance(
        AdminSessionRescheduleInputSchema.safeParse({
          sessionId: 7,
          startedAt: SESSION_START,
          endedAt: SESSION_END,
        })
      );
      expect(parsed.sessionId).toBe(7);
      expect(parsed.startedAt).toBe(SESSION_START);
      expect(parsed.endedAt).toBe(SESSION_END);
    });

    test("rejects an equal timing pair (zero-length session)", () => {
      expectRejection(
        AdminSessionRescheduleInputSchema.safeParse({
          sessionId: 7,
          startedAt: SESSION_START,
          endedAt: SESSION_START,
        })
      );
    });

    test("rejects an inverted timing pair", () => {
      expectRejection(
        AdminSessionRescheduleInputSchema.safeParse({
          sessionId: 7,
          startedAt: SESSION_END,
          endedAt: SESSION_START,
        })
      );
    });

    test("rejects malformed session ids", () => {
      const pair = { startedAt: SESSION_START, endedAt: SESSION_END };
      expectRejection(AdminSessionRescheduleInputSchema.safeParse({ sessionId: 0, ...pair }));
      expectRejection(AdminSessionRescheduleInputSchema.safeParse({ sessionId: -7, ...pair }));
      expectRejection(AdminSessionRescheduleInputSchema.safeParse({ sessionId: 7.5, ...pair }));
      expectRejection(AdminSessionRescheduleInputSchema.safeParse({ sessionId: Number.NaN, ...pair }));
      expectRejection(AdminSessionRescheduleInputSchema.safeParse({ sessionId: "7", ...pair }));
    });

    test("rejects missing or non-Date instants", () => {
      expectRejection(AdminSessionRescheduleInputSchema.safeParse({ sessionId: 7, startedAt: SESSION_START }));
      expectRejection(
        AdminSessionRescheduleInputSchema.safeParse({
          sessionId: 7,
          startedAt: SESSION_START,
          endedAt: SESSION_END.getTime(),
        })
      );
    });
  });

  describe("cancel", () => {
    test("accepts the bare payload and the payload with a reason", () => {
      const bare = expectAcceptance(AdminSessionCancelInputSchema.safeParse({ sessionId: 3 }));
      expect(bare.reason).toBeUndefined();
      const withReason = expectAcceptance(
        AdminSessionCancelInputSchema.safeParse({ sessionId: 3, reason: "duplicate booking" })
      );
      expect(withReason.reason).toBe("duplicate booking");
    });

    test("accepts a reason at the 330-character boundary — the serialized audit envelope fits", () => {
      const parsed = expectAcceptance(
        AdminSessionCancelInputSchema.safeParse({ sessionId: 3, reason: REASON_AT_LIMIT })
      );
      expect(parsed.reason).toHaveLength(330);
      // The serialized-length contract, proven at the worst schema-legal
      // escape input: 330 backslashes expand 2× under JSON.stringify, and
      // even that envelope fits the 2000-char audit-details column.
      const worstCaseSerialized = JSON.stringify({ action: "cancel", reason: "\\".repeat(330) });
      expect(worstCaseSerialized.length).toBeLessThanOrEqual(2000);
      expect(worstCaseSerialized).toHaveLength(31 + 660);
    });

    test("rejects a reason beyond the 330-character boundary", () => {
      expectRejection(AdminSessionCancelInputSchema.safeParse({ sessionId: 3, reason: REASON_OVER_LIMIT }));
    });

    test("rejects control characters (the charset rule that bounds the JSON escape multiplier)", () => {
      expectRejection(AdminSessionCancelInputSchema.safeParse({ sessionId: 3, reason: "bell\u0007ring" }));
      expectRejection(AdminSessionCancelInputSchema.safeParse({ sessionId: 3, reason: "tab\tstop" }));
      expectRejection(AdminSessionCancelInputSchema.safeParse({ sessionId: 3, reason: "line\nbreak" }));
      expectRejection(AdminSessionCancelInputSchema.safeParse({ sessionId: 3, reason: "null\u0000byte" }));
      expectRejection(AdminSessionCancelInputSchema.safeParse({ sessionId: 3, reason: "del\u007Fchar" }));
      expectRejection(AdminSessionCancelInputSchema.safeParse({ sessionId: 3, reason: "c1\u009Fchar" }));
    });

    test("rejects a malformed or missing session id", () => {
      expectRejection(AdminSessionCancelInputSchema.safeParse({}));
      expectRejection(AdminSessionCancelInputSchema.safeParse({ sessionId: 0 }));
    });
  });

  describe("reassign teacher", () => {
    test("accepts the payload with both ids", () => {
      const parsed = expectAcceptance(AdminSessionReassignInputSchema.safeParse({ sessionId: 7, newTeacherUserId: 9 }));
      expect(parsed.newTeacherUserId).toBe(9);
    });

    test("rejects malformed candidate ids and missing members", () => {
      expectRejection(AdminSessionReassignInputSchema.safeParse({ sessionId: 7, newTeacherUserId: 0 }));
      expectRejection(AdminSessionReassignInputSchema.safeParse({ sessionId: 7, newTeacherUserId: 1.5 }));
      expectRejection(AdminSessionReassignInputSchema.safeParse({ newTeacherUserId: 9 }));
    });
  });

  describe("join observation", () => {
    test("accepts the single-id payload", () => {
      const parsed = expectAcceptance(AdminSessionJoinInputSchema.safeParse({ sessionId: 7 }));
      expect(parsed.sessionId).toBe(7);
    });

    test("rejects missing or malformed session ids", () => {
      expectRejection(AdminSessionJoinInputSchema.safeParse({}));
      expectRejection(AdminSessionJoinInputSchema.safeParse({ sessionId: -1 }));
      expectRejection(AdminSessionJoinInputSchema.safeParse({ sessionId: Number.POSITIVE_INFINITY }));
    });
  });

  test("rejects identifiers beyond the explicit safe-integer pin (> 2^53 - 1)", () => {
    // The ceiling is deliberate (zod-downgrade insurance): 2^53 is an exact
    // integer any `.int()` alone admits, and every id-bearing input schema
    // must still fail closed on it via the explicit `Number.isSafeInteger`
    // refine on the shared identifier gate.
    expectAcceptance(AdminSessionJoinInputSchema.safeParse({ sessionId: Number.MAX_SAFE_INTEGER }));
    expectRejection(AdminSessionJoinInputSchema.safeParse({ sessionId: Number.MAX_SAFE_INTEGER + 1 }));
    expectRejection(AdminSessionReassignInputSchema.safeParse({ sessionId: 7, newTeacherUserId: 2 ** 53 }));
    expectRejection(
      AdminSessionRescheduleInputSchema.safeParse({
        sessionId: 2 ** 53,
        startedAt: SESSION_START,
        endedAt: SESSION_END,
      })
    );
    expectRejection(AdminSessionCancelInputSchema.safeParse({ sessionId: 2 ** 53 }));
  });

  test("every input schema strips unknown keys before any write path sees them", () => {
    const join = expectAcceptance(
      AdminSessionJoinInputSchema.safeParse({ sessionId: 7, status: "completed", actorRole: "admin" })
    );
    expect(Object.keys(join)).toEqual(["sessionId"]);
    const cancel = expectAcceptance(
      AdminSessionCancelInputSchema.safeParse({ sessionId: 7, teacherId: 2, fee: "25.00" })
    );
    expect(Object.keys(cancel)).toEqual(["sessionId"]);
  });
});
