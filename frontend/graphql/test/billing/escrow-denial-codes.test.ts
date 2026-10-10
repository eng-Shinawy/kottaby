/**
 * Escrow denial wire pins — the two §2 financial denials over the LIVE
 * GraphQL boundary (`setupTestServerLifecycle` + `testClient`), pinning
 * `extensions.code` for the AS-BUILT escrow denial vocabulary:
 *
 *  - `createSession` → `INSUFFICIENT_BALANCE`: a zero-balance student
 *    (trial lane AND the intent's own lane both empty) misses the
 *    trial-first debit ladder and the booking transaction rolls back — the
 *    service throws `ValidationError("INSUFFICIENT_BALANCE")` with the
 *    localized `insufficientBalance` message.
 *  - `requestWithdrawal` → `WALLET_INSUFFICIENT_FUNDS`: a certified
 *    teacher with an empty wallet passes auth, governance, profile, and
 *    the amount-validation matrix, then misses the guarded balance debit —
 *    the service throws `ConflictError("WALLET_INSUFFICIENT_FUNDS")` (the
 *    same localized `insufficientBalance` copy) and the request rolls
 *    back with zero rows.
 *
 * The pin is the wire half of the error-code re-map for the launch
 * checklist's two "rejected with 422" rows: the denials surface as typed
 * GraphQL error codes (never an HTTP status vocabulary), proven here at
 * the transport.
 *
 * Also pins per leg:
 *  - Zero side effects: the booking denial commits NO `sessions` row and
 *    burns NO idempotency claim; the withdrawal denial commits NO wallet
 *    row and NO ledger row (both flows roll back atomically).
 *  - Success control: a funded student books the same teacher through the
 *    same wire and receives a live `Session` payload (Scheduled +
 *    feeHeld) — the booking denial is balance-specific, never a transport
 *    artifact. The withdrawal denial is balance-specific by its code
 *    alone: `WALLET_INSUFFICIENT_FUNDS` is reachable only past the
 *    auth/governance/profile/amount gates, at the funds guard.
 *  - Auth scope: unauthenticated calls → `UNAUTHORIZED`; wrong-role callers
 *    → `FORBIDDEN` (booking is student-only, withdrawal is teacher-only —
 *    explicit `$all` role conjunctions, no bypass).
 *  - SEC: each denial body carries ONLY the standard GraphQL error fields
 *    with `extensions` limited to the machine code + requestId — no
 *    lane-balance or wallet-internal field name or value is ever
 *    serialized into a denial payload.
 *
 * Fixtures: a committed cast via the journey helpers (real `users.role` +
 * role-child rows) with per-run `jrn_*` idempotency keys; identity rides
 * minted-but-real access tokens (the same `signAccessToken` the auth
 * layer issues; the spawned server verifies them with the same env) —
 * nothing is monkey-patched. Direct-DB use is limited to fixture
 * provisioning, the registry hygiene teardown, and fixture-scoped count
 * oracles (the sibling-suite documented exception). The created session id
 * is registered for the FK-safe hard-delete cleanup.
 *
 * Run:
 *   bun run test:graphql frontend/graphql/test/billing/escrow-denial-codes.test.ts
 */

import { afterAll, beforeAll, expect, test } from "bun:test";
import type { CombinedGraphQLErrors } from "@apollo/client";
import { and, eq } from "drizzle-orm";

import { db } from "@/backend/db";
import { session } from "@/backend/db/schema/classes/session";
import { sessionRequestIdempotency } from "@/backend/db/schema/classes/session-request-idempotency";
import { signAccessToken } from "@/backend/lib/auth/jwt";
import { SessionIntent, SessionStatus } from "@/frontend/graphql/generated/gql/graphql";
import { requestWithdrawalMutationDocument } from "@/frontend/graphql/sharedDocuments/billing/wallet.documents";
import { createSessionMutationDocument } from "@/frontend/graphql/sharedDocuments/scheduling/session-lifecycle.documents";
import { getServerTranslations } from "@/shared/locale/server-graphql";
import { describeGraphqlSuite, expectMutationError, setupTestServerLifecycle, testClient } from "@/test/helpers";
import {
  buildSessionJourneyCast,
  countTeacherTransactionsForTeacher,
  countWalletsForTeacher,
  createSessionFixtureRegistry,
  journeyPrefix,
  type SessionJourneyCast,
} from "@/test/workflows/helpers";

// ─── Harness state ───────────────────────────────────────────────────────────

/** Spawns (or reuses) the live test server before any wire call. */
setupTestServerLifecycle();

/** Per-run prefix — unique user labels AND idempotency keys per suite run. */
const PREFIX = journeyPrefix("escrowdeny");

const KEY_DENIAL = `${PREFIX}-key-denial`;
const KEY_FUNDED = `${PREFIX}-key-funded`;
const KEY_LEAK = `${PREFIX}-key-leak`;

/** Localized denial message — the shared server-translation bundle, never inline copy. */
const T_INSUFFICIENT_BALANCE = getServerTranslations("en").errorsTranslations.insufficientBalance;

/** The fixture registry — every created session id is hard-deleted in afterAll. */
const registry = createSessionFixtureRegistry();

let cast: SessionJourneyCast;

// Actor tokens (Bearer identity; booking keys ride the request headers).
let zeroBalanceStudentToken: string;
let fundedStudentToken: string;
let teacherToken: string;

// ─── Fixture-scoped oracles (never global counts) ────────────────────────────

/**
 * Counts the persisted `sessions` rows for the fixture student/teacher pair
 * (delta assertions are scoped to fixture ids — pre-existing data in the
 * shared test database can never satisfy or break them).
 */
async function countSessionsFor(teacherId: number, studentId: number): Promise<number> {
  return db.$count(session, and(eq(session.teacherId, teacherId), eq(session.studentId, studentId)));
}

/**
 * Counts the idempotency claims the fixture student holds — the booking
 * denial must burn no key (its claim rolls back with the booking).
 */
async function countClaimsFor(studentId: number): Promise<number> {
  return db.$count(sessionRequestIdempotency, eq(sessionRequestIdempotency.userId, studentId));
}

// ─── Wire helpers ─────────────────────────────────────────────────────────────

/** Record-shaped narrowing guard (no unsafe casts, per test-tier discipline). */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** First wire error item's localized message, runtime-guarded. */
function firstWireMessage(container: CombinedGraphQLErrors): string {
  const first: unknown = container.errors[0];
  if (!isRecord(first)) {
    throw new Error("expected a record-shaped first wire error item");
  }
  const message: unknown = first.message;
  if (typeof message !== "string") {
    throw new Error("expected a string message on the first wire error item");
  }
  return message;
}

/** Booking request headers — Bearer identity plus the logical-attempt key. */
function bookingContext(token: string, idempotencyKey: string): { headers: Record<string, string> } {
  return {
    headers: {
      authorization: `Bearer ${token}`,
      "x-idempotency-key": idempotencyKey,
    },
  };
}

/** Bearer-only request headers (no idempotency key needed). */
function bearerContext(token: string): { headers: Record<string, string> } {
  return { headers: { authorization: `Bearer ${token}` } };
}

/** The booking variables for the fixture teacher over the hifz intent. */
function bookingInput(teacherId: number): { input: { teacherId: string; intent: SessionIntent } } {
  return { input: { teacherId: String(teacherId), intent: SessionIntent.Hifz } };
}

/** The withdrawal request for the given amount, as a decimal string. */
function withdrawalInput(amount: string): { input: { amount: string } } {
  return { input: { amount } };
}

/** Registers a created session id for FK-safe cleanup. */
function trackSession(id: string): void {
  registry.track("session", Number(id));
}

// ─── Fixtures (committed cast) ────────────────────────────────────────────────

beforeAll(async () => {
  // Committed cast — the PRIMARY student is the zero-balance denial actor
  // (ALL lanes empty); the SECOND student is the funded control (one hifz
  // unit, exactly one booking). The certified teacher hosts the bookings
  // AND is the withdrawal-denial actor (no wallet row exists yet).
  await db.transaction(async tx => {
    cast = await buildSessionJourneyCast(tx, registry, {
      prefix: PREFIX,
      primaryStudent: {},
      secondStudent: { hifz: 1 },
    });
  });

  [zeroBalanceStudentToken, fundedStudentToken, teacherToken] = await Promise.all([
    signAccessToken({ userId: cast.primaryStudent.userId, role: cast.primaryStudent.user.role }),
    signAccessToken({ userId: cast.secondStudent.userId, role: cast.secondStudent.user.role }),
    signAccessToken({ userId: cast.teacher.userId, role: cast.teacher.user.role }),
  ]);
}, 240_000);

afterAll(async () => {
  await registry.cleanup();
});

// ─── Section 1 — the zero-balance booking denial over the wire ──────────────

describeGraphqlSuite("createSession — INSUFFICIENT_BALANCE wire pin", () => {
  test("empty student books against a certified teacher → INSUFFICIENT_BALANCE with the localized message", async () => {
    const result = await testClient.mutate({
      mutation: createSessionMutationDocument,
      variables: bookingInput(cast.teacher.userId),
      context: bookingContext(zeroBalanceStudentToken, KEY_DENIAL),
    });
    const combined = expectMutationError(result.error, "INSUFFICIENT_BALANCE");
    expect(firstWireMessage(combined)).toBe(T_INSUFFICIENT_BALANCE);
  });

  test("the rolled-back booking leaves zero sessions rows and burns no idempotency key", async () => {
    const sessionsBefore = await countSessionsFor(cast.teacher.userId, cast.primaryStudent.userId);
    const claimsBefore = await countClaimsFor(cast.primaryStudent.userId);
    const result = await testClient.mutate({
      mutation: createSessionMutationDocument,
      variables: bookingInput(cast.teacher.userId),
      context: bookingContext(zeroBalanceStudentToken, KEY_DENIAL),
    });
    expectMutationError(result.error, "INSUFFICIENT_BALANCE");
    const sessionsAfter = await countSessionsFor(cast.teacher.userId, cast.primaryStudent.userId);
    const claimsAfter = await countClaimsFor(cast.primaryStudent.userId);
    expect(sessionsAfter).toBe(sessionsBefore);
    expect(sessionsAfter).toBe(0);
    expect(claimsAfter).toBe(claimsBefore);
    expect(claimsAfter).toBe(0);
  });
});

// ─── Section 2 — funded-lane success control ─────────────────────────────────

describeGraphqlSuite("createSession — funded-lane success control", () => {
  test("funded student books the same teacher → live Session payload (the denial is balance-specific)", async () => {
    const result = await testClient.mutate({
      mutation: createSessionMutationDocument,
      variables: bookingInput(cast.teacher.userId),
      context: bookingContext(fundedStudentToken, KEY_FUNDED),
    });
    expect(result.error).toBeUndefined();
    const payload = result.data?.createSession;
    if (!payload) {
      throw new Error("createSession returned no payload");
    }
    trackSession(payload.id);
    expect(payload.status).toBe(SessionStatus.Scheduled);
    expect(payload.feeHeld).toBe(true);
    expect(payload.teacherId).toBe(String(cast.teacher.userId));
    expect(payload.studentId).toBe(String(cast.secondStudent.userId));
  });
});

// ─── Section 3 — the insufficient-funds withdrawal denial over the wire ──────

describeGraphqlSuite("requestWithdrawal — WALLET_INSUFFICIENT_FUNDS wire pin", () => {
  test("certified teacher with an empty wallet requests a payout → WALLET_INSUFFICIENT_FUNDS with the localized message", async () => {
    const result = await testClient.mutate({
      mutation: requestWithdrawalMutationDocument,
      variables: withdrawalInput("25.00"),
      context: bearerContext(teacherToken),
    });
    const combined = expectMutationError(result.error, "WALLET_INSUFFICIENT_FUNDS");
    // The wallet denial shares the localized insufficient-balance copy —
    // the typed machine code is what distinguishes the two denials.
    expect(firstWireMessage(combined)).toBe(T_INSUFFICIENT_BALANCE);
  });

  test("the rolled-back request commits zero wallet rows and zero ledger rows", async () => {
    const walletsBefore = await countWalletsForTeacher(cast.teacher.userId);
    const ledgerBefore = await countTeacherTransactionsForTeacher(cast.teacher.userId);
    const result = await testClient.mutate({
      mutation: requestWithdrawalMutationDocument,
      variables: withdrawalInput("25.00"),
      context: bearerContext(teacherToken),
    });
    expectMutationError(result.error, "WALLET_INSUFFICIENT_FUNDS");
    const walletsAfter = await countWalletsForTeacher(cast.teacher.userId);
    const ledgerAfter = await countTeacherTransactionsForTeacher(cast.teacher.userId);
    expect(walletsAfter).toBe(walletsBefore);
    expect(walletsAfter).toBe(0);
    expect(ledgerAfter).toBe(ledgerBefore);
    expect(ledgerAfter).toBe(0);
  });
});

// ─── Section 4 — auth-scope probes (401 / 403 split over the wire) ────────────

describeGraphqlSuite("escrow denials — auth-scope probes", () => {
  test("unauthenticated booking → UNAUTHORIZED (pre-resolver)", async () => {
    const result = await testClient.mutate({
      mutation: createSessionMutationDocument,
      variables: bookingInput(cast.teacher.userId),
      context: { headers: { "x-idempotency-key": `${PREFIX}-key-anon` } },
    });
    const combined = expectMutationError(result.error, "UNAUTHORIZED");
    // Pre-resolver auth denials surface exactly one wire error item.
    expect(combined.errors).toHaveLength(1);
  });

  test("certified teacher booking → FORBIDDEN (booking is student-only, no role bypass)", async () => {
    const result = await testClient.mutate({
      mutation: createSessionMutationDocument,
      variables: bookingInput(cast.teacher.userId),
      context: bookingContext(teacherToken, `${PREFIX}-key-teacher-role`),
    });
    const combined = expectMutationError(result.error, "FORBIDDEN");
    expect(combined.errors).toHaveLength(1);
  });

  test("unauthenticated withdrawal → UNAUTHORIZED (pre-resolver)", async () => {
    const result = await testClient.mutate({
      mutation: requestWithdrawalMutationDocument,
      variables: withdrawalInput("25.00"),
    });
    const combined = expectMutationError(result.error, "UNAUTHORIZED");
    expect(combined.errors).toHaveLength(1);
  });

  test("student withdrawal → FORBIDDEN (withdrawal is teacher-only, no role bypass)", async () => {
    const result = await testClient.mutate({
      mutation: requestWithdrawalMutationDocument,
      variables: withdrawalInput("25.00"),
      context: bearerContext(fundedStudentToken),
    });
    const combined = expectMutationError(result.error, "FORBIDDEN");
    expect(combined.errors).toHaveLength(1);
  });
});

// ─── Section 5 — SEC: the denial payloads leak no balance internals ───────────

describeGraphqlSuite("escrow denials — denied-payload security probes", () => {
  /** The standard GraphQL error fields — extensions may carry the code only. */
  const ALLOWED_ERROR_KEYS = new Set(["message", "locations", "path", "extensions"]);

  /** Asserts one denial container carries only the allowlisted shape. */
  function expectAllowlistedDenialBody(combined: CombinedGraphQLErrors): string {
    for (const rawError of combined.errors) {
      expect(Object.keys(rawError).every(key => ALLOWED_ERROR_KEYS.has(key))).toBe(true);
      if (rawError.extensions !== undefined) {
        expect(Object.keys(rawError.extensions).toSorted((a, b) => a.localeCompare(b))).toEqual(["code", "requestId"]);
      }
    }
    const wireBody: unknown = JSON.parse(JSON.stringify(combined)) ?? combined;
    if (!isRecord(wireBody)) {
      throw new Error("expected a record-shaped serialized denial body");
    }
    return JSON.stringify(wireBody) ?? "";
  }

  test("the INSUFFICIENT_BALANCE denial body carries no lane-balance field or value", async () => {
    const result = await testClient.mutate({
      mutation: createSessionMutationDocument,
      variables: bookingInput(cast.teacher.userId),
      context: bookingContext(zeroBalanceStudentToken, KEY_LEAK),
    });
    const combined = expectMutationError(result.error, "INSUFFICIENT_BALANCE");
    const serialized = expectAllowlistedDenialBody(combined);
    // Allowlist over the serialized body: no lane-balance field name (or a
    // renamed/nested variant a denylist of exact keys would miss) and no
    // raw numeric lane value may ride the denial channel.
    for (const leakNeedle of ["balanceTrial", "balanceHifz", "balanceTajweed", "balanceReviews"]) {
      expect(serialized.includes(leakNeedle)).toBe(false);
    }
  });

  test("the WALLET_INSUFFICIENT_FUNDS denial body carries no wallet-internal field or value", async () => {
    const result = await testClient.mutate({
      mutation: requestWithdrawalMutationDocument,
      variables: withdrawalInput("25.00"),
      context: bearerContext(teacherToken),
    });
    const combined = expectMutationError(result.error, "WALLET_INSUFFICIENT_FUNDS");
    const serialized = expectAllowlistedDenialBody(combined);
    // The wallet denial channel exposes the localized message and its
    // extensions.code ONLY — the requested document's wallet fields stay
    // null-absent, and no wallet identifier or earning total leaks. (The
    // localized message legitimately contains the word "balance" — the
    // needles are wallet-internal field names, never user-facing copy.)
    for (const leakNeedle of ["totalEarning", "walletId", "teacherId", "transactions"]) {
      expect(serialized.includes(leakNeedle)).toBe(false);
    }
  });
});
