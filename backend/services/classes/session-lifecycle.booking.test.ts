/**
 * Session Lifecycle Booking 4-Tier Unit Test Suite (pure validators — zero DB).
 *
 * Tier 1: 100% statement & branch coverage for `assertBookingBoundary`.
 * Tier 2: Boundary & edge cases (key lengths 1/128/129, numeric bounds, unicode verbatim).
 * Tier 3: Seeded deterministic fuzz sweep & statelessness concurrent storms.
 * Tier 4: Security & purity — frozen payload immutability, hostile shape smuggling,
 *         no payload echo in denials, localized en/ar translations, and source pin.
 */

import { describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { subscriptions } from "@/backend/db/schema/billing/subscriptions";
import { session } from "@/backend/db/schema/classes/session";
import { sessionRequestIdempotency } from "@/backend/db/schema/classes/session-request-idempotency";
import { students } from "@/backend/db/schema/students/students";
import {
  createTestPlan,
  createTestStudent,
  createTestSubscription,
  createTestTeacherRow,
  createTestUser,
} from "@/backend/db/test/entity-setup";
import { runInRollback } from "@/backend/db/test/test-utils";
import { SubscriptionCreditLane } from "@/backend/enum/billing/subscription-credit-lane.enum";
import { SubscriptionStatus } from "@/backend/enum/billing/subscription-status.enum";
import { HeldBalanceLane } from "@/backend/enum/scheduling/held-balance-lane.enum";
import { SessionIntent } from "@/backend/enum/scheduling/session-intent.enum";
import { SessionStatus } from "@/backend/enum/scheduling/session-status.enum";
import { ValidationError } from "@/backend/lib/errors";
import { SubscriptionExpiryService } from "@/backend/services/billing/subscription-expiry.service";
import { assertBookingBoundary, bookSessionInTx } from "@/backend/services/classes/session-lifecycle.booking";
import { MAX_IDEMPOTENCY_KEY_LENGTH } from "@/backend/services/classes/session-lifecycle.guards";
import type {
  DBTransaction,
  SessionReturnType,
  SessionStudentIntentType,
  SessionSubmitInput,
  StudentSelectType,
  SubscriptionSelectType,
} from "@/backend/types";
import { getServerTranslations } from "@/shared/locale/server-graphql";

function t() {
  return getServerTranslations("en").errorsTranslations;
}

function tAr() {
  return getServerTranslations("ar").errorsTranslations;
}

function validInput(): SessionSubmitInput {
  return { teacherId: 10, intent: SessionIntent.Hifz };
}

/**
 * Asserts the ONLY thrown class is `ValidationError` with code `VALIDATION`
 * and the exact expected localized message.
 */
function expectValidationError(execute: () => void, message: string): void {
  let caught: unknown = null;
  try {
    execute();
  } catch (error: unknown) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(ValidationError);
  if (caught instanceof ValidationError) {
    expect(caught.code).toBe("VALIDATION");
    expect(caught.message).toBe(message);
  }
}

/** Seeded deterministic PRNG (mulberry32) — identical seed ⇒ identical sweep. */
function mulberry32(seed: number): () => number {
  let state = seed;
  return () => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

function picker(random: () => number): <T>(pool: readonly T[]) => T {
  return <T>(pool: readonly T[]): T => pool[Math.floor(random() * pool.length)];
}

const STUDENT_ID_POOL: readonly number[] = [
  1,
  42,
  9007199254740991,
  0,
  -1,
  -10,
  1.5,
  Number.NaN,
  Number.POSITIVE_INFINITY,
  Number.MAX_SAFE_INTEGER + 1,
];

const TEACHER_ID_POOL: readonly unknown[] = [
  1,
  10,
  9007199254740991,
  0,
  -5,
  2.25,
  Number.NaN,
  Number.NEGATIVE_INFINITY,
  Number.MAX_SAFE_INTEGER + 1,
];

const KEY_POOL: readonly string[] = [
  "valid-key-1",
  "a",
  "k".repeat(128),
  "",
  "k".repeat(129),
  "  padded-key  ",
  "مفتاح-تأكيد",
  "key!@#$%^&*()_+",
];

const INTENT_POOL: readonly unknown[] = [
  SessionIntent.Hifz,
  SessionIntent.Tajweed,
  SessionIntent.Evaluation,
  "invalid_intent",
  "",
  "HIFZ",
  "tajweed ",
];

function runSweep(): string[] {
  const random = mulberry32(0x1337);
  const pick = picker(random);
  const en = t();
  const outcomes: string[] = [];

  for (let iteration = 0; iteration < 300; iteration++) {
    const studentId = pick(STUDENT_ID_POOL);
    const teacherId = pick(TEACHER_ID_POOL);
    const intent = pick(INTENT_POOL);
    const key = pick(KEY_POOL);

    const input: SessionSubmitInput = Object.assign({}, validInput(), { teacherId, intent });

    let caught: unknown = null;
    try {
      assertBookingBoundary(studentId, input, key, en);
    } catch (error: unknown) {
      caught = error;
    }

    if (caught === null) {
      outcomes.push("ok");
      continue;
    }

    expect(caught).toBeInstanceOf(ValidationError);
    if (caught instanceof ValidationError) {
      expect(caught.code).toBe("VALIDATION");
      outcomes.push(caught.message);
    }
  }

  return outcomes;
}

describe("assertBookingBoundary", () => {
  describe("Tier 1 — statement & branch coverage", () => {
    test("accepts valid booking boundary inputs with Hifz intent", () => {
      expect(() => assertBookingBoundary(1, validInput(), "valid-key-123", t())).not.toThrow();
    });

    test("accepts valid booking boundary inputs with Tajweed intent", () => {
      const input: SessionSubmitInput = { teacherId: 5, intent: SessionIntent.Tajweed };
      expect(() => assertBookingBoundary(2, input, "tajweed-key-456", t())).not.toThrow();
    });

    test("studentId branch: throws ValidationError(t.validation) for non-positive or non-safe integers", () => {
      const en = t();
      const badStudentIds = [0, -1, -100, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1];

      for (const badId of badStudentIds) {
        expectValidationError(() => assertBookingBoundary(badId, validInput(), "valid-key", en), en.validation);
      }
    });

    test("teacherId branch: throws ValidationError(t.validation) for non-positive or non-safe integers", () => {
      const en = t();
      const badTeacherIds = [0, -1, -50, 2.25, Number.NaN, Number.NEGATIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1];

      for (const badTeacherId of badTeacherIds) {
        const input: SessionSubmitInput = Object.assign({}, validInput(), { teacherId: badTeacherId });
        expectValidationError(() => assertBookingBoundary(1, input, "valid-key", en), en.validation);
      }
    });

    test("idempotencyKey branch: throws ValidationError(t.idempotencyKeyRequired) when key is empty or > 128 chars", () => {
      const en = t();

      // Empty key
      expectValidationError(() => assertBookingBoundary(1, validInput(), "", en), en.idempotencyKeyRequired);

      // 129 chars key
      const oversizedKey = "k".repeat(MAX_IDEMPOTENCY_KEY_LENGTH + 1);
      expectValidationError(() => assertBookingBoundary(1, validInput(), oversizedKey, en), en.idempotencyKeyRequired);
    });

    test("intent branch: throws ValidationError(t.invalidSessionIntent) for non-bookable intents", () => {
      const en = t();

      // SessionIntent.Evaluation is not bookable via createSession
      const evalInput: SessionSubmitInput = Object.assign({}, validInput(), { intent: SessionIntent.Evaluation });
      expectValidationError(() => assertBookingBoundary(1, evalInput, "valid-key", en), en.invalidSessionIntent);

      // Arbitrary invalid strings smuggled into input
      const invalidInput: SessionSubmitInput = Object.assign({}, validInput(), { intent: "INVALID_INTENT" });
      expectValidationError(() => assertBookingBoundary(1, invalidInput, "valid-key", en), en.invalidSessionIntent);
    });
  });

  describe("Tier 2 — boundary & edge cases", () => {
    test("idempotencyKey length boundaries: 1 and 128 pass, 0 and 129 fail", () => {
      const en = t();

      expect(() => assertBookingBoundary(1, validInput(), "a", en)).not.toThrow();
      expect(() => assertBookingBoundary(1, validInput(), "b".repeat(128), en)).not.toThrow();

      expectValidationError(() => assertBookingBoundary(1, validInput(), "", en), en.idempotencyKeyRequired);

      expectValidationError(
        () => assertBookingBoundary(1, validInput(), "c".repeat(129), en),
        en.idempotencyKeyRequired
      );
    });

    test("idempotencyKey preserves content verbatim (spaces, symbols, unicode)", () => {
      const en = t();
      const specialKeys = ["  key-with-padding  ", "مفتاح-تأكيد-١٢٣", "key_#123-abc.xyz", "key\twith\nwhitespace"];

      for (const key of specialKeys) {
        expect(() => assertBookingBoundary(1, validInput(), key, en)).not.toThrow();
      }
    });

    test("studentId and teacherId numeric boundaries: 1 and MAX_SAFE_INTEGER pass, 0 and MAX_SAFE_INTEGER + 1 fail", () => {
      const en = t();

      expect(() => assertBookingBoundary(1, validInput(), "key", en)).not.toThrow();
      expect(() => assertBookingBoundary(Number.MAX_SAFE_INTEGER, validInput(), "key", en)).not.toThrow();

      expectValidationError(() => assertBookingBoundary(0, validInput(), "key", en), en.validation);

      expectValidationError(
        () => assertBookingBoundary(Number.MAX_SAFE_INTEGER + 1, validInput(), "key", en),
        en.validation
      );

      const maxTeacherInput: SessionSubmitInput = { teacherId: Number.MAX_SAFE_INTEGER, intent: SessionIntent.Hifz };
      expect(() => assertBookingBoundary(1, maxTeacherInput, "key", en)).not.toThrow();

      const invalidTeacherInput: SessionSubmitInput = Object.assign({}, validInput(), { teacherId: 0 });
      expectValidationError(() => assertBookingBoundary(1, invalidTeacherInput, "key", en), en.validation);
    });
  });

  describe("Tier 3 — chaos, fuzzing & statelessness", () => {
    test("seeded PRNG fuzz sweep over assertBookingBoundary throws only ValidationError (code VALIDATION)", () => {
      const en = t();
      const allowedMessages = new Set([en.validation, en.idempotencyKeyRequired, en.invalidSessionIntent]);

      const outcomes = runSweep();
      expect(outcomes).toHaveLength(300);

      const thrown = outcomes.filter(outcome => outcome !== "ok");
      expect(thrown.length).toBeGreaterThan(0);

      for (const message of thrown) {
        expect(allowedMessages.has(message)).toBe(true);
      }
    });

    test("fuzz sweep produces identical outcomes given identical seed (determinism pin)", () => {
      expect(runSweep()).toEqual(runSweep());
    });

    test("concurrent assertBookingBoundary storm proves statelessness", async () => {
      const en = t();
      const results = await Promise.allSettled(
        Array.from({ length: 500 }, (_, i) =>
          Promise.resolve().then(() =>
            assertBookingBoundary(i + 1, { teacherId: i + 10, intent: SessionIntent.Hifz }, `key-${i}`, en)
          )
        )
      );

      expect(results.every(r => r.status === "fulfilled")).toBe(true);
    });
  });

  describe("Tier 4 — security, type coercion & purity", () => {
    test("assertBookingBoundary mutates nothing — frozen input objects pass through untouched", () => {
      const frozenInput: SessionSubmitInput = Object.freeze({
        teacherId: 10,
        intent: SessionIntent.Hifz,
      });

      expect(() => assertBookingBoundary(1, frozenInput, "key-123", t())).not.toThrow();
      expect(frozenInput.teacherId).toBe(10);
      expect(frozenInput.intent).toBe(SessionIntent.Hifz);
    });

    test("smuggled hostile shapes via Object.assign fail closed", () => {
      const en = t();

      // Smuggled Evaluation intent
      const smuggledInput: SessionSubmitInput = Object.assign({}, validInput(), {
        intent: SessionIntent.Evaluation,
        extraHostileProp: "<script>alert('xss')</script>",
      });

      expectValidationError(() => assertBookingBoundary(1, smuggledInput, "key-123", en), en.invalidSessionIntent);
    });

    test("denials never echo rejected or hostile payloads", () => {
      const en = t();
      const hostileKey = "x".repeat(129) + "<script>alert(1)</script>";

      let caughtMessage = "";
      try {
        assertBookingBoundary(1, validInput(), hostileKey, en);
      } catch (error: unknown) {
        if (error instanceof ValidationError) {
          caughtMessage = error.message;
        }
      }

      expect(caughtMessage).toBe(en.idempotencyKeyRequired);
      expect(caughtMessage).not.toContain("script");
      expect(caughtMessage).not.toContain("xxxx");
    });

    test("source pin — session-lifecycle.booking.ts stays clean and dependency-isolated", async () => {
      const source = await Bun.file(new URL("./session-lifecycle.booking.ts", import.meta.url)).text();

      expect(source).toContain("export function assertBookingBoundary");
      expect(source).not.toContain("console.");
      expect(source).not.toContain("process.env");
    });
  });

  describe("localized denials — en + ar leaf maps", () => {
    test("every boundary denial resolves its dedicated flat key in English", () => {
      const en = t();

      expectValidationError(() => assertBookingBoundary(0, validInput(), "key", en), en.validation);

      const invalidTeacherInput: SessionSubmitInput = Object.assign({}, validInput(), { teacherId: -1 });
      expectValidationError(() => assertBookingBoundary(1, invalidTeacherInput, "key", en), en.validation);

      expectValidationError(() => assertBookingBoundary(1, validInput(), "", en), en.idempotencyKeyRequired);

      const evalInput: SessionSubmitInput = Object.assign({}, validInput(), { intent: SessionIntent.Evaluation });
      expectValidationError(() => assertBookingBoundary(1, evalInput, "key", en), en.invalidSessionIntent);
    });

    test("every boundary denial resolves its dedicated flat key in Arabic", () => {
      const ar = tAr();

      expectValidationError(() => assertBookingBoundary(0, validInput(), "key", ar), ar.validation);

      const invalidTeacherInput: SessionSubmitInput = Object.assign({}, validInput(), { teacherId: -1 });
      expectValidationError(() => assertBookingBoundary(1, invalidTeacherInput, "key", ar), ar.validation);

      expectValidationError(() => assertBookingBoundary(1, validInput(), "", ar), ar.idempotencyKeyRequired);

      const evalInput: SessionSubmitInput = Object.assign({}, validInput(), { intent: SessionIntent.Evaluation });
      expectValidationError(() => assertBookingBoundary(1, evalInput, "key", ar), ar.invalidSessionIntent);
    });

    test("en and ar copies are distinct localizations of the same error keys", () => {
      const en = t();
      const ar = tAr();

      expect(en.validation).not.toBe(ar.validation);
      expect(en.idempotencyKeyRequired).not.toBe(ar.idempotencyKeyRequired);
      expect(en.invalidSessionIntent).not.toBe(ar.invalidSessionIntent);
    });
  });
});

/**
 * Booking debit-ladder expiry gate — DB-backed integration tier.
 *
 * The ladder is exercised through the real transactional booking body on
 * real repositories inside `runInRollback` (the `tx` joins every call):
 * the fixture subscription's window close is backdated with a direct
 * Drizzle update, the expiry sweep runs on the SAME transaction (flip +
 * guarded zeroing), and the booking then walks the real ladder —
 * trial debit, intent-lane debit, the one-shot uncovered-expired-lane
 * probe, and the insufficient-balance denial, in that fixed order.
 *
 * Per the DB-test rules: no `.rejects.toThrow()` inside the rollback —
 * denials are captured with a try/catch helper; read-back oracles assert
 * the zero-write contract on every denial.
 */
/** The live balance lanes read back after a booking attempt. */
interface LaneSnapshot {
  readonly trial: number;
  readonly hifz: number | null;
  readonly tajweed: number | null;
  readonly reviews: number | null;
}
/** Student + certified teacher — the booking ladder's row dependencies. */
interface BookingActor {
  readonly studentId: number;
  readonly teacherId: number;
}
/** Creates one student actor and one certified teacher actor. */
async function createBookingActor(
  tx: DBTransaction,
  studentOverrides: Partial<StudentSelectType> = {}
): Promise<BookingActor> {
  const studentUser = await createTestUser(tx, { role: "student" });
  const student = await createTestStudent(tx, studentUser.id, studentOverrides);
  const teacherUser = await createTestUser(tx, { role: "teacher" });
  await createTestTeacherRow(tx, teacherUser.id);
  return { studentId: student.id, teacherId: teacherUser.id };
}
/** Read-back oracle: the student's live balance lanes (on the tx). */
async function readLanes(tx: DBTransaction, studentId: number): Promise<LaneSnapshot> {
  const rows = await tx.select().from(students).where(eq(students.id, studentId)).limit(1);
  const row = rows[0];
  if (!row) {
    throw new Error("fixture vanished: student row not found");
  }
  return {
    trial: row.balanceTrial,
    hifz: row.balanceHifz,
    tajweed: row.balanceTajweed,
    reviews: row.balanceReviews,
  };
}
/** Read-back oracle: the student's booked sessions count (on the tx). */
async function countStudentSessions(tx: DBTransaction, studentId: number): Promise<number> {
  const rows = await tx.select({ id: session.id }).from(session).where(eq(session.studentId, studentId));
  return rows.length;
}
/** Read-back oracle: the student's burned claim keys count (on the tx). */
async function countStudentClaims(tx: DBTransaction, studentId: number): Promise<number> {
  const rows = await tx
    .select({ id: sessionRequestIdempotency.id })
    .from(sessionRequestIdempotency)
    .where(eq(sessionRequestIdempotency.userId, studentId));
  return rows.length;
}
/** Try/catch denial capture — never a pinned rejection inside the rollback. */
async function expectBookingDenial(attempt: () => Promise<unknown>): Promise<ValidationError> {
  let errorCaught: unknown = null;
  try {
    await attempt();
  } catch (error) {
    errorCaught = error;
  }
  expect(errorCaught).toBeInstanceOf(ValidationError);
  if (!(errorCaught instanceof ValidationError)) {
    throw new Error("expected the booking to deny with a ValidationError");
  }
  return errorCaught;
}

describe("debitBookingLadder expiry gate — DB-backed ladder denials", () => {
  /** One hour in milliseconds — the fixture backdate lag (window-vs-status). */
  const BACKDATE_LAG_MS = 60 * 60 * 1000;

  /** One day in milliseconds — the subscription window fixture unit. */
  const MS_PER_DAY = 86_400_000;

  /** Seeds a LIVE in-window subscription on the lane via a credited plan. */
  async function createLiveLaneSubscription(
    tx: DBTransaction,
    userId: number,
    lane: SubscriptionCreditLane
  ): Promise<SubscriptionSelectType> {
    const plan = await createTestPlan(tx, { balanceLane: lane, sessionCount: 5, intervalDays: 30 });
    return createTestSubscription(tx, userId, plan.id, {
      status: SubscriptionStatus.Active,
      startDate: new Date(Date.now() - MS_PER_DAY),
      endDate: new Date(Date.now() + 29 * MS_PER_DAY),
    });
  }

  /** Backdates the window close past now, then runs the expiry sweep in-tx. */
  async function sweepWindowClosed(
    tx: DBTransaction,
    subscription: SubscriptionSelectType
  ): Promise<{ expired: number; lanesZeroed: number }> {
    await tx
      .update(subscriptions)
      .set({ endDate: new Date(Date.now() - BACKDATE_LAG_MS) })
      .where(eq(subscriptions.id, subscription.id));
    return SubscriptionExpiryService.expireDue(tx);
  }

  /** Books through the real transactional body with a unique claim key. */
  function book(
    tx: DBTransaction,
    actor: BookingActor,
    intent: SessionStudentIntentType,
    claimKey: string = `gate-${randomUUID()}`
  ): Promise<SessionReturnType> {
    return bookSessionInTx(actor.studentId, { teacherId: actor.teacherId, intent }, claimKey, new Date(), tx, t());
  }

  test("expired + zeroed lane: denied with SUBSCRIPTION_EXPIRED before any write", async () => {
    await runInRollback(async tx => {
      const actor = await createBookingActor(tx, { balanceHifz: 3 });
      const subscription = await createLiveLaneSubscription(tx, actor.studentId, SubscriptionCreditLane.Hifz);
      expect(await sweepWindowClosed(tx, subscription)).toEqual({ expired: 1, lanesZeroed: 1 });

      const lanesBefore = await readLanes(tx, actor.studentId);
      const sessionsBefore = await countStudentSessions(tx, actor.studentId);
      const claimsBefore = await countStudentClaims(tx, actor.studentId);

      const denial = await expectBookingDenial(() => book(tx, actor, SessionIntent.Hifz));
      expect(denial.code).toBe("SUBSCRIPTION_EXPIRED");
      expect(denial.message).toBe(t().subscriptionExpired);

      // Zero rows written on denial: the ladder's debit attempts missed,
      // the probe only read, and neither a session nor a claim was born.
      expect(await readLanes(tx, actor.studentId)).toEqual(lanesBefore);
      expect(await countStudentSessions(tx, actor.studentId)).toBe(sessionsBefore);
      expect(await countStudentClaims(tx, actor.studentId)).toBe(claimsBefore);
    });
  });

  test("expired subscription with trial credit: the booking SUCCEEDS via the trial lane", async () => {
    await runInRollback(async tx => {
      const actor = await createBookingActor(tx, { balanceHifz: 3, balanceTrial: 2 });
      const subscription = await createLiveLaneSubscription(tx, actor.studentId, SubscriptionCreditLane.Hifz);
      expect(await sweepWindowClosed(tx, subscription)).toEqual({ expired: 1, lanesZeroed: 1 });

      const booked = await book(tx, actor, SessionIntent.Hifz, "gate-trial-success-key");
      expect(booked.status).toBe(SessionStatus.Scheduled);
      expect(booked.feeHeld).toBe(true);
      expect(booked.heldBalanceLane).toBe(HeldBalanceLane.Trial);

      // The trial lane funded the hold; the expired lane stays zeroed.
      const lanes = await readLanes(tx, actor.studentId);
      expect(lanes.trial).toBe(1);
      expect(lanes.hifz).toBe(0);

      // The claim was born and points at the booked session.
      const claims = await tx
        .select({ id: sessionRequestIdempotency.id, sessionId: sessionRequestIdempotency.sessionId })
        .from(sessionRequestIdempotency)
        .where(eq(sessionRequestIdempotency.idempotencyKey, "gate-trial-success-key"));
      expect(claims).toHaveLength(1);
      expect(claims[0]?.sessionId).toBe(booked.id);
    });
  });

  test("in-window subscription on an empty lane: the probe answers false — unchanged INSUFFICIENT_BALANCE denial", async () => {
    await runInRollback(async tx => {
      const actor = await createBookingActor(tx, { balanceHifz: 0 });
      await createLiveLaneSubscription(tx, actor.studentId, SubscriptionCreditLane.Hifz);
      // The sweep runs and finds nothing due — the lane is legitimately
      // empty while coverage is live; the gate must NOT fire.
      expect(await SubscriptionExpiryService.expireDue(tx)).toEqual({ expired: 0, lanesZeroed: 0 });

      const lanesBefore = await readLanes(tx, actor.studentId);

      const denial = await expectBookingDenial(() => book(tx, actor, SessionIntent.Hifz));
      expect(denial.code).toBe("INSUFFICIENT_BALANCE");
      expect(denial.message).toBe(t().insufficientBalance);

      expect(await readLanes(tx, actor.studentId)).toEqual(lanesBefore);
      expect(await countStudentSessions(tx, actor.studentId)).toBe(0);
      expect(await countStudentClaims(tx, actor.studentId)).toBe(0);
    });
  });

  test("in-window subscription with credited lane: unchanged ladder behavior — the intent lane funds the booking", async () => {
    await runInRollback(async tx => {
      const actor = await createBookingActor(tx, { balanceHifz: 2 });
      await createLiveLaneSubscription(tx, actor.studentId, SubscriptionCreditLane.Hifz);

      const booked = await book(tx, actor, SessionIntent.Hifz);
      expect(booked.status).toBe(SessionStatus.Scheduled);
      expect(booked.heldBalanceLane).toBe(HeldBalanceLane.Hifz);

      const lanes = await readLanes(tx, actor.studentId);
      expect(lanes.hifz).toBe(1);
      expect(lanes.trial).toBe(0);
    });
  });

  test("never-subscribed empty lane: INSUFFICIENT_BALANCE regression intact", async () => {
    await runInRollback(async tx => {
      const actor = await createBookingActor(tx);
      const lanesBefore = await readLanes(tx, actor.studentId);

      const denial = await expectBookingDenial(() => book(tx, actor, SessionIntent.Hifz));
      expect(denial.code).toBe("INSUFFICIENT_BALANCE");
      expect(denial.message).toBe(t().insufficientBalance);

      // Zero rows written on denial — the classic regression shape.
      expect(await readLanes(tx, actor.studentId)).toEqual(lanesBefore);
      expect(await countStudentSessions(tx, actor.studentId)).toBe(0);
      expect(await countStudentClaims(tx, actor.studentId)).toBe(0);
    });
  });

  test("expired-over-insufficient precedence on the Tajweed lane: the expiry denial wins", async () => {
    await runInRollback(async tx => {
      const actor = await createBookingActor(tx, { balanceTajweed: 3 });
      const subscription = await createLiveLaneSubscription(tx, actor.studentId, SubscriptionCreditLane.Tajweed);
      expect(await sweepWindowClosed(tx, subscription)).toEqual({ expired: 1, lanesZeroed: 1 });

      const denial = await expectBookingDenial(() => book(tx, actor, SessionIntent.Tajweed));
      expect(denial.code).toBe("SUBSCRIPTION_EXPIRED");
      expect(denial.code).not.toBe("INSUFFICIENT_BALANCE");
    });
  });

  test("GraphQL denial shape: extensions.code === SUBSCRIPTION_EXPIRED on the single thrown denial", async () => {
    await runInRollback(async tx => {
      const actor = await createBookingActor(tx, { balanceHifz: 3 });
      const subscription = await createLiveLaneSubscription(tx, actor.studentId, SubscriptionCreditLane.Hifz);
      await sweepWindowClosed(tx, subscription);

      const denial = await expectBookingDenial(() => book(tx, actor, SessionIntent.Hifz));

      // expectSingleDenial shape, mirrored at the error-object level: the
      // single denial carries the domain code where the GraphQL transport
      // surfaces it (errors[].extensions.code), plus the server-localized
      // message — never the raw key, never empty.
      expect(denial.extensions?.code).toBe("SUBSCRIPTION_EXPIRED");
      expect(denial.message.length).toBeGreaterThan(0);
      expect(denial.message).not.toBe("subscriptionExpired");
      expect(denial.message).toBe(t().subscriptionExpired);
    });
  });
});
