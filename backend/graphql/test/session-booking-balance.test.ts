/**
 * Session-booking balance denial over the LIVE GraphQL boundary
 * (`setupTestServerLifecycle` + `testClient` harness) — the transport pin
 * for the zero-balance booking rejection.
 *
 * Pins the `createSession` denial ladder end-to-end over the wire:
 *  - A zero-balance student (trial lane AND the intent's own lane both
 *    empty) → `errors[0].extensions.code = "INSUFFICIENT_BALANCE"` with the
 *    localized `insufficientBalance` message (verified against the shared
 *    server-translation bundle — never a hardcoded English string).
 *  - Zero side-effect rows: the denial rolls the booking transaction back,
 *    so NO `sessions` row exists for the fixture student/teacher pair and
 *    no idempotency claim is burned (a failed booking keeps its key).
 *  - Success control: a funded student books through the same wire and
 *    receives a live `Session` payload (Scheduled + feeHeld) — the denial
 *    is balance-specific, never a transport artifact.
 *  - Unauthenticated call → `UNAUTHORIZED` (the `authenticated` leg fires
 *    the 401 channel before any resolver runs).
 *  - Teacher-role caller → `FORBIDDEN` (the explicit `$all` role leg —
 *    booking is student-only, no role bypass).
 *  - SEC: the denied response payload carries no lane-balance values (no
 *    `balance*` field ever appears in the serialized denial body).
 *
 * Fixtures: a real committed cast via the journey helpers (real `users.role`
 * + role-child rows) with per-run `jrn_*` idempotency keys; identity rides
 * minted-but-real access tokens (same `signAccessToken` the auth layer
 * issues; the spawned server verifies them with the same env) — nothing is
 * monkey-patched. Every created session id is registered for the FK-safe
 * hard-delete cleanup.
 *
 * Run:
 *   bun run test/scripts/run-test.ts backend/graphql/test/session-booking-balance.test.ts
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { ApolloClient, gql, HttpLink, InMemoryCache } from "@apollo/client";
import { and, eq } from "drizzle-orm";
import { db } from "@/backend/db";
import { session } from "@/backend/db/schema/classes/session";
import { sessionRequestIdempotency } from "@/backend/db/schema/classes/session-request-idempotency";
import { signAccessToken } from "@/backend/lib/auth/jwt";
import { getServerTranslations } from "@/shared/locale/server-graphql";
import { expectMutationError, setupTestServerLifecycle, TEST_PORT, testClient } from "@/test/helpers";
import {
  buildSessionJourneyCast,
  createSessionFixtureRegistry,
  journeyPrefix,
  type SessionJourneyCast,
} from "@/test/workflows/helpers";

// ─── Harness state ───────────────────────────────────────────────────────────

/** Spawns (or reuses) the live test server before any wire call. */
setupTestServerLifecycle();

/** Per-run prefix — unique user labels AND idempotency keys per suite run. */
const PREFIX = journeyPrefix("bookbal");

const KEY_DENIAL = `${PREFIX}-key-denial`;
const KEY_FUNDED = `${PREFIX}-key-funded`;
const KEY_LEAK = `${PREFIX}-key-leak`;

/** Localized denial message — the shared server-translation bundle, never inline copy. */
const T_INSUFFICIENT_BALANCE = getServerTranslations("en").errorsTranslations.insufficientBalance;

/** The fixture registry — every created session id is hard-deleted in afterAll. */
const registry = createSessionFixtureRegistry();

let cast: SessionJourneyCast;

// Actor-scoped clients (Bearer identity + fixed idempotency key per client).
let zeroBalanceStudent: ApolloClient; // empty student — the denial actor
let fundedStudent: ApolloClient; // funded control actor
let teacherCaller: ApolloClient; // certified teacher (role leg probe)
let leakProbe: ApolloClient; // zero-balance, fresh key — SEC payload probe

// ─── Documents ───────────────────────────────────────────────────────────────

const CREATE_SESSION_DOC = gql`
  mutation CreateSession($input: CreateSessionInput!) {
    createSession(input: $input) {
      id
      teacherId
      studentId
      status
      sessionType
      intent
      fee
      feeHeld
      createdAt
      updatedAt
    }
  }
`;

// ─── Narrowing helpers (runtime-guarded — zero casts) ────────────────────────

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Extracts the root-field payload object of a happy-path mutation result. */
function payloadOf(result: { readonly data?: unknown }, rootField: string): Record<string, unknown> {
  if (!isRecord(result.data)) {
    throw new Error(`missing data for ${rootField} (error: ${String(result.data)})`);
  }
  const payload: unknown = result.data[rootField];
  if (!isRecord(payload)) {
    throw new Error(`missing ${rootField} payload in response data`);
  }
  return payload;
}

/** Builds an actor-scoped client — real Bearer identity + optional key header. */
function clientFor(accessToken: string | null, idempotencyKey: string | null = null): ApolloClient {
  return new ApolloClient({
    link: new HttpLink({
      uri: `http://localhost:${TEST_PORT}/api/graphql`,
      headers: {
        ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
        ...(idempotencyKey ? { "x-idempotency-key": idempotencyKey } : {}),
      },
    }),
    cache: new InMemoryCache(),
    defaultOptions: {
      query: { errorPolicy: "all", fetchPolicy: "no-cache" },
      mutate: { errorPolicy: "all", fetchPolicy: "no-cache" },
      watchQuery: { errorPolicy: "all", fetchPolicy: "no-cache" },
    },
  });
}

/** Mints a REAL access token for a cast user (verified by the live server). */
async function tokenFor(userId: number, role: string): Promise<string> {
  return signAccessToken({ userId, role });
}

/** Registers a created session id for FK-safe cleanup. */
function trackSession(id: string): void {
  registry.track("session", Number(id));
}

/**
 * Counts the persisted `sessions` rows for the fixture student/teacher pair
 * (delta assertions are scoped to fixture ids — pre-existing data in the
 * shared test database can never satisfy or break them).
 */
async function countSessionsFor(teacherId: number, studentId: number): Promise<number> {
  return db.$count(session, and(eq(session.teacherId, teacherId), eq(session.studentId, studentId)));
}

/**
 * Counts the idempotency claims the fixture student holds — the denial must
 * burn no key (its claim rolls back with the booking).
 */
async function countClaimsFor(studentId: number): Promise<number> {
  return db.$count(sessionRequestIdempotency, eq(sessionRequestIdempotency.userId, studentId));
}

// ─── Fixtures (committed cast) ───────────────────────────────────────────────

beforeAll(async () => {
  // Committed cast — the PRIMARY student is the zero-balance denial actor
  // (ALL lanes empty, the cast builder's default profile); the SECOND
  // student is the funded control (one hifz unit, exactly one booking).
  await db.transaction(async tx => {
    cast = await buildSessionJourneyCast(tx, registry, {
      prefix: PREFIX,
      primaryStudent: {},
      secondStudent: { hifz: 1 },
    });
  });

  const [tokenZero, tokenFunded, tokenTeacher, tokenLeakProbe] = await Promise.all([
    tokenFor(cast.primaryStudent.userId, cast.primaryStudent.user.role),
    tokenFor(cast.secondStudent.userId, cast.secondStudent.user.role),
    tokenFor(cast.teacher.userId, cast.teacher.user.role),
    tokenFor(cast.primaryStudent.userId, cast.primaryStudent.user.role),
  ]);

  zeroBalanceStudent = clientFor(tokenZero, KEY_DENIAL);
  fundedStudent = clientFor(tokenFunded, KEY_FUNDED);
  teacherCaller = clientFor(tokenTeacher);
  leakProbe = clientFor(tokenLeakProbe, KEY_LEAK);
}, 240_000);

afterAll(async () => {
  await registry.cleanup();
});

// ─── Section 1 — the zero-balance denial over the wire ──────────────────────

describe("createSession — zero-balance denial (transport pin)", () => {
  test("empty student books against a certified teacher → INSUFFICIENT_BALANCE with the localized message", async () => {
    // Trial lane = 0 AND the intent's own lane (hifz) = 0 — the trial-first
    // ladder misses both, and the booking transaction rolls back.
    const result = await zeroBalanceStudent.mutate({
      mutation: CREATE_SESSION_DOC,
      variables: { input: { teacherId: cast.teacher.userId, intent: "Hifz" } },
    });
    const combined = expectMutationError(result.error, "INSUFFICIENT_BALANCE");
    const firstError: unknown = combined.errors[0];
    if (!isRecord(firstError)) {
      throw new Error("expected record-shaped first error item");
    }
    expect(firstError.message).toBe(T_INSUFFICIENT_BALANCE);
  });

  test("the rolled-back booking leaves zero sessions rows and burns no idempotency key", async () => {
    const sessionsBefore = await countSessionsFor(cast.teacher.userId, cast.primaryStudent.userId);
    const claimsBefore = await countClaimsFor(cast.primaryStudent.userId);
    const result = await zeroBalanceStudent.mutate({
      mutation: CREATE_SESSION_DOC,
      variables: { input: { teacherId: cast.teacher.userId, intent: "Hifz" } },
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

// ─── Section 2 — funded-lane success control ────────────────────────────────

describe("createSession — funded-lane success control", () => {
  test("funded student books the same teacher → live Session payload (the denial is balance-specific)", async () => {
    const result = await fundedStudent.mutate({
      mutation: CREATE_SESSION_DOC,
      variables: { input: { teacherId: cast.teacher.userId, intent: "Hifz" } },
    });
    const payload = payloadOf(result, "createSession");
    const id: unknown = payload.id;
    if (typeof id !== "string" && typeof id !== "number") {
      throw new Error("createSession returned no id");
    }
    trackSession(String(id));
    expect(payload.status).toBe("Scheduled");
    expect(payload.feeHeld).toBe(true);
    expect(payload.teacherId).toBe(String(cast.teacher.userId));
    expect(payload.studentId).toBe(String(cast.secondStudent.userId));
  });
});

// ─── Section 3 — auth-scope probes (401 / 403) ──────────────────────────────

describe("createSession — auth-scope probes", () => {
  test("unauthenticated call → UNAUTHORIZED (pre-resolver)", async () => {
    const result = await testClient.mutate({
      mutation: CREATE_SESSION_DOC,
      variables: { input: { teacherId: cast.teacher.userId, intent: "Hifz" } },
    });
    expect(result.error).toBeDefined();
    expectMutationError(result.error, "UNAUTHORIZED");
  });

  test("certified teacher call → FORBIDDEN (booking is student-only, no role bypass)", async () => {
    const result = await teacherCaller.mutate({
      mutation: CREATE_SESSION_DOC,
      variables: { input: { teacherId: cast.teacher.userId, intent: "Hifz" } },
    });
    expect(result.error).toBeDefined();
    expectMutationError(result.error, "FORBIDDEN");
  });
});

// ─── Section 4 — SEC: the denial payload leaks no balance values ────────────

describe("createSession — denied-payload security probe", () => {
  test("the INSUFFICIENT_BALANCE denial body carries no lane-balance field or value", async () => {
    const result = await leakProbe.mutate({
      mutation: CREATE_SESSION_DOC,
      variables: { input: { teacherId: cast.teacher.userId, intent: "Hifz" } },
    });
    const combined = expectMutationError(result.error, "INSUFFICIENT_BALANCE");
    // Allowlist over the raw GraphQL error entries: each error may carry
    // only the standard fields, and extensions only the machine code — this
    // also rejects renamed or nested balance metadata that a denylist of
    // field names would miss.
    const ALLOWED_ERROR_KEYS = new Set(["message", "locations", "path", "extensions"]);
    for (const rawError of combined.errors) {
      expect(Object.keys(rawError).every(key => ALLOWED_ERROR_KEYS.has(key))).toBe(true);
      if (rawError.extensions !== undefined) {
        expect(Object.keys(rawError.extensions).toSorted((a, b) => a.localeCompare(b))).toEqual(["code", "requestId"]);
      }
    }
    const wireBody: unknown = JSON.parse(JSON.stringify(combined)) ?? combined;
    if (!isRecord(wireBody)) {
      throw new Error("expected record-shaped serialized denial body");
    }
    const serialized = JSON.stringify(wireBody) ?? "";
    // NO lane-balance field name or raw numeric lane value may appear in the
    // serialized denial payload — the denial channel exposes the localized
    // message and its extensions.code only.
    for (const leakNeedle of ["balanceTrial", "balanceHifz", "balanceTajweed", "balanceReviews"]) {
      expect(serialized.includes(leakNeedle)).toBe(false);
    }
  });
});
