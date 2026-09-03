/**
 * Admin broadcast mutation — wire-tier integration suite for
 * `adminBroadcastNotification` over the REAL GraphQL boundary
 * (`setupTestServerLifecycle` + raw fetch with Bearer auth).
 *
 * The REQ-072 matrix (one compact suite):
 *  - **BFLA pre-resolver denials** — anonymous → UNAUTHORIZED;
 *    student/teacher/parent → FORBIDDEN (all BEFORE the resolver body —
 *    evidenced by the scope error codes themselves).
 *  - **Admin happy path** — audience `{ type: All }` returns the persisted
 *    recipient count (`Int!` ≥ 1) and the direct-DB oracle shows EXACTLY
 *    that many `system_broadcast` rows carrying the run-unique title.
 *  - **Idempotency-key propagation** — the gateway-captured
 *    `X-Idempotency-Key` rides the header into the service; over the
 *    lifecycle server's hermetic (cache-less) default the DOCUMENTED
 *    fail-open posture applies: the deterministic cohort answers the SAME
 *    count on every accepted emission and each emission lands EXACTLY one
 *    cohort of rows. SCOPE NOTE: over the cache-less wire the key is
 *    behaviorally unobservable, so THIS suite cannot fail on a regression
 *    that drops header propagation — that seam is pinned at the service
 *    tier (context-headers consumption in the service behavior matrix) and
 *    the cache-backed same-key/zero-new-rows contract is
 *    proven at the service tier with a scripted claim cache).
 *  - **BOPLA wire probes** — an unknown field smuggled into
 *    `BroadcastAudienceInput` and an unknown root identity arg both die as
 *    GRAPHQL_VALIDATION_FAILED before any resolver runs.
 *  - **Schema posture pins** — the field's `authScopes` extension snapshot
 *    equals EXACTLY `{ $all: { authenticated: true, role: [UserRole.Admin] } }`
 *    (the `$all` conjunction is load-bearing) and the field accepts EXACTLY
 *    ONE argument (`input`) — structurally zero identity-arg surface.
 *
 * Fixture strategy (minimal committed fixtures):
 *  - All four actors are the SEEDED users (admin/teacher/parent/student —
 *    real login path, real password hashes; candidate credential list
 *    resolved once in `beforeAll`).
 *  - The single accepted broadcast is tagged with a run-unique title
 *    marker; `afterAll` deletes ONLY those notification rows under
 *    `withAuditDeleteTriggersSuspended` (append-only `audit_logs` rows
 *    written by the broadcast remain by design).
 *
 * Mandated runner: bun run test/scripts/run-test.ts backend/graphql/test/admin-broadcast.integration.test.ts
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/backend/db";
import { notifications } from "@/backend/db/schema/notifications/notifications";
import { BroadcastAudienceType } from "@/backend/enum/notifications/broadcast-audience-type.enum";
import { UserRole } from "@/backend/enum/users/user-role.enum";
import { graphQLSchema } from "@/backend/graphql/gqlSchema";
import { setupTestServerLifecycle, TEST_PORT } from "@/test/helpers";
import { withAuditDeleteTriggersSuspended } from "@/test/helpers/db-cleanup";

setupTestServerLifecycle();

// ─── Runtime guards (no casts, per test-tier discipline) ─────────────────────

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function recordOf(value: unknown, message: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new Error(message);
  }
  return value;
}

// ─── Wire helpers ────────────────────────────────────────────────────────────

const GRAPHQL_URL = `http://localhost:${TEST_PORT}/api/graphql`;

const LOGIN_DOCUMENT = `
  mutation WireBroadcastLogin($email: String!, $password: String!) {
    login(email: $email, password: $password) {
      accessToken
    }
  }
`;

const BROADCAST_DOCUMENT = `
  mutation WireAdminBroadcast($input: AdminBroadcastNotificationInput!) {
    adminBroadcastNotification(input: $input)
  }
`;

/** The GraphQL wire NAME of a canonical broadcast-audience runtime value. */
function wireNameOf(value: BroadcastAudienceType): string {
  const entry = Object.entries(BroadcastAudienceType).find(([, candidate]) => candidate === value);
  if (entry === undefined) {
    throw new Error(`no wire name for audience kind ${value}`);
  }
  return entry[0];
}

interface WireResponse {
  readonly data?: unknown;
  readonly errors?: unknown;
}

async function postDocument(
  query: string,
  accessToken: string | null,
  variables?: Record<string, unknown>,
  idempotencyKey?: string
): Promise<WireResponse> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (accessToken !== null) {
    headers.authorization = `Bearer ${accessToken}`;
  }
  if (idempotencyKey !== undefined) {
    headers["x-idempotency-key"] = idempotencyKey;
  }
  const response = await fetch(GRAPHQL_URL, {
    method: "POST",
    headers,
    body: JSON.stringify(variables === undefined ? { query } : { query, variables }),
    signal: AbortSignal.timeout(30_000),
  });
  const parsed: unknown = await response.json();
  if (!isRecord(parsed)) {
    throw new Error("expected a JSON object response");
  }
  const wireBody: WireResponse = parsed;
  return wireBody;
}

/** First error's `extensions.code` — read straight off the wire JSON item (the raw transport shape; the shared `extractErrorCode` targets in-process GraphQLError instances). */
function firstErrorCode(body: WireResponse): string {
  if (!Array.isArray(body.errors) || body.errors.length === 0) {
    throw new Error("expected an errors array");
  }
  const first = recordOf(body.errors[0], "expected a record-shaped error item");
  const extensions = recordOf(Reflect.get(first, "extensions"), "expected record-shaped extensions");
  const code = Reflect.get(extensions, "code");
  if (typeof code !== "string") {
    throw new Error("expected a string error code");
  }
  return code;
}

function dataFieldOf(body: WireResponse, field: string): unknown {
  const data = recordOf(body.data, "expected a data object in the response");
  return Reflect.get(data, field);
}

// ─── Seeded-actor credentials (resolved once, real login path) ────────────────

const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? "admin@app.local";
const CREDENTIAL_CANDIDATES = [process.env.ADMIN_PASSWORD ?? "adminpassword123", "Seed_Pass1!"];

/** Extracts the access token from a login response (runtime-guarded). */
function accessTokenFrom(body: WireResponse): string | undefined {
  const payload = dataFieldOf(body, "login");
  if (!isRecord(payload)) {
    return undefined;
  }
  const token = Reflect.get(payload, "accessToken");
  return typeof token === "string" && token.length > 0 ? token : undefined;
}

/**
 * Logs one seeded actor in over the wire: the env-configured credential
 * first, then the seed's own documented fallback — two explicit attempts,
 * no loop.
 */
async function loginActor(email: string): Promise<string> {
  const primary = await postDocument(LOGIN_DOCUMENT, null, { email, password: CREDENTIAL_CANDIDATES[0] });
  const primaryToken = accessTokenFrom(primary);
  if (primaryToken !== undefined) {
    return primaryToken;
  }
  const fallback = await postDocument(LOGIN_DOCUMENT, null, { email, password: CREDENTIAL_CANDIDATES[1] });
  const fallbackToken = accessTokenFrom(fallback);
  if (fallbackToken !== undefined) {
    return fallbackToken;
  }
  throw new Error(`could not log seeded actor in (${email}) with any candidate credential`);
}

// ─── Direct-DB oracle (never routed through the engine) ──────────────────────

async function oracleBroadcastRowCount(): Promise<number> {
  const rows = await db.select({ id: notifications.id }).from(notifications).where(eq(notifications.title, MARKER));
  return rows.length;
}

// ─── Fixtures ────────────────────────────────────────────────────────────────

/** Run-unique marker — every artifact of this suite carries it. */
const MARKER = `Int3-Broadcast-${randomUUID()}`;
const AUDIENCE_ALL = { type: wireNameOf(BroadcastAudienceType.All) };
const COMPOSE_INPUT = { title: MARKER, body: "Wire-tier broadcast body", audience: AUDIENCE_ALL };
const REPLAY_KEY = randomUUID();

let adminToken = "";
let studentToken = "";
let teacherToken = "";
let parentToken = "";

beforeAll(async () => {
  const tokens = await Promise.all([
    loginActor(ADMIN_EMAIL),
    loginActor("student@draftacademy.local"),
    loginActor("teacher@draftacademy.local"),
    loginActor("parent@draftacademy.local"),
  ]);
  adminToken = tokens[0] ?? "";
  studentToken = tokens[1] ?? "";
  teacherToken = tokens[2] ?? "";
  parentToken = tokens[3] ?? "";
}, 120_000);

afterAll(async () => {
  // ONLY this suite's notification rows (run-unique title) — the audit row
  // the broadcast legitimately wrote is append-only trail and stays.
  await withAuditDeleteTriggersSuspended(async () => {
    await db.delete(notifications).where(eq(notifications.title, MARKER));
  });
});

// ─── REQ-072 matrix ──────────────────────────────────────────────────────────

describe("Admin broadcast mutation — wire-tier REQ-072 matrix", () => {
  test("anonymous caller receives UNAUTHORIZED (scope denial pre-resolver)", async () => {
    const body = await postDocument(BROADCAST_DOCUMENT, null, { input: COMPOSE_INPUT });
    expect(firstErrorCode(body)).toBe("UNAUTHORIZED");
  });

  test("authenticated non-admin callers receive FORBIDDEN (student/teacher/parent)", async () => {
    // Each role denied in its OWN document over the parallel batch: all three
    // scope denials fire pre-resolver with FORBIDDEN.
    const bodies = await Promise.all(
      [studentToken, teacherToken, parentToken].map(token =>
        postDocument(BROADCAST_DOCUMENT, token, { input: COMPOSE_INPUT })
      )
    );
    for (const body of bodies) {
      expect(firstErrorCode(body)).toBe("FORBIDDEN");
    }
    // Pre-resolver proof: no role ever reached the resolver — zero rows.
    expect(await oracleBroadcastRowCount()).toBe(0);
  });

  test("admin happy path returns the persisted count; DB oracle shows the system_broadcast rows", async () => {
    const body = await postDocument(BROADCAST_DOCUMENT, adminToken, { input: COMPOSE_INPUT }, REPLAY_KEY);
    expect(body.errors).toBeUndefined();
    const wireCount = dataFieldOf(body, "adminBroadcastNotification");
    if (typeof wireCount !== "number") {
      throw new Error("expected a numeric adminBroadcastNotification count");
    }
    expect(wireCount).toBeGreaterThanOrEqual(1);

    // DB oracle — EXACTLY that many rows, every one a system_broadcast.
    const rows = await db
      .select({ id: notifications.id, type: notifications.type, title: notifications.title })
      .from(notifications)
      .where(eq(notifications.title, MARKER));
    expect(rows).toHaveLength(wireCount);
    for (const row of rows) {
      expect(row.type).toBe("system_broadcast");
      expect(row.title).toBe(MARKER);
    }
  });

  test("repeat submission with the SAME X-Idempotency-Key over the hermetic (cache-less) default: documented fail-open posture, deterministic cohort", async () => {
    // Wire-tier cache posture: the lifecycle server boots WITHOUT a
    // configured `REDIS_URL`, so the service resolves NO claim cache and the
    // engine's DOCUMENTED fail-open posture applies (single degrade warn,
    // emit anyway — a cache blip never blocks an admin announcement). The
    // cache-backed same-key/zero-new-rows contract is proven at the service
    // tier (the journey suite's scripted claim cache); here the wire proves
    // the honest no-cache behavior: the deterministic cohort yields the SAME
    // count on every accepted emission, and each accepted emission lands
    // EXACTLY one cohort of rows — never a partial or silent write.
    const before = await oracleBroadcastRowCount();
    const body = await postDocument(BROADCAST_DOCUMENT, adminToken, { input: COMPOSE_INPUT }, REPLAY_KEY);
    expect(body.errors).toBeUndefined();
    const firstCount = dataFieldOf(body, "adminBroadcastNotification");
    if (typeof firstCount !== "number") {
      throw new Error("expected a numeric adminBroadcastNotification count");
    }
    expect(firstCount).toBeGreaterThanOrEqual(1);

    const afterFirst = await oracleBroadcastRowCount();
    expect(afterFirst).toBe(before + firstCount);

    const replayBody = await postDocument(BROADCAST_DOCUMENT, adminToken, { input: COMPOSE_INPUT }, REPLAY_KEY);
    expect(replayBody.errors).toBeUndefined();
    expect(dataFieldOf(replayBody, "adminBroadcastNotification")).toBe(firstCount);
    const afterReplay = await oracleBroadcastRowCount();
    expect(afterReplay).toBe(afterFirst + firstCount);
  });

  test("BOPLA: unknown field smuggled into BroadcastAudienceInput dies pre-resolver", async () => {
    // Inline literal → document validation → GRAPHQL_VALIDATION_FAILED.
    const inlineBody = await postDocument(
      `mutation SmuggledField { adminBroadcastNotification(input: { title: "x", audience: { type: ${wireNameOf(BroadcastAudienceType.All)}, userId: 1 } }) }`,
      adminToken
    );
    expect(firstErrorCode(inlineBody)).toBe("GRAPHQL_VALIDATION_FAILED");
    // Same smuggle over the VARIABLES channel → value coercion denies it as
    // BAD_USER_INPUT. Either way the field never reaches a resolver.
    const variablesBody = await postDocument(BROADCAST_DOCUMENT, adminToken, {
      input: { title: MARKER, audience: { type: wireNameOf(BroadcastAudienceType.All), userId: 1 } },
    });
    expect(firstErrorCode(variablesBody)).toBe("BAD_USER_INPUT");
  });

  test("BOPLA: smuggled root identity arg dies as GRAPHQL_VALIDATION_FAILED", async () => {
    const body = await postDocument(
      `mutation Smuggled($input: AdminBroadcastNotificationInput!) { adminBroadcastNotification(input: $input, userId: 123) }`,
      adminToken,
      { input: COMPOSE_INPUT }
    );
    expect(firstErrorCode(body)).toBe("GRAPHQL_VALIDATION_FAILED");
  });

  test("authScopes extension pin equals EXACTLY the $all conjunction (admin + authenticated)", () => {
    const mutationType = graphQLSchema.getMutationType();
    if (!mutationType) {
      throw new Error("Schema must define a root Mutation type");
    }
    const field = mutationType.getFields().adminBroadcastNotification;
    if (!field) {
      throw new Error("Schema must register the adminBroadcastNotification root field");
    }
    const extensions = recordOf(field.extensions, "expected record-shaped field extensions");
    const pothosOptions = recordOf(Reflect.get(extensions, "pothosOptions"), "expected pothosOptions");
    const authScopes = recordOf(Reflect.get(pothosOptions, "authScopes"), "expected authScopes");
    expect(authScopes).toEqual({ $all: { authenticated: true, role: [UserRole.Admin] } });
  });

  test("zero identity-arg surface: the field accepts EXACTLY ONE argument (`input`)", () => {
    const mutationType = graphQLSchema.getMutationType();
    if (!mutationType) {
      throw new Error("Schema must define a root Mutation type");
    }
    const field = mutationType.getFields().adminBroadcastNotification;
    if (!field) {
      throw new Error("Schema must register the adminBroadcastNotification root field");
    }
    expect(field.args).toHaveLength(1);
    expect(field.args[0]?.name).toBe("input");
  });
});
