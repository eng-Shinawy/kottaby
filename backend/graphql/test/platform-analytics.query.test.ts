/**
 * `adminPlatformAnalytics` — in-process wire matrix over the REAL built
 * schema (the handshake-code-surface execution pattern: `graphql()` drives
 * the full scope-auth plugin → resolver → service → PostgreSQL pipeline
 * inside the test process, no HTTP server).
 *
 * Tier decision: every cell runs in-process. The deny-before-execute pins
 * observe a service-call spy, which is only meaningful inside the test
 * process — the `setupTestServerLifecycle` HTTP tier boots the pipeline in
 * a separate `next dev` child process where test-process spies cannot see
 * resolver/service invocations. The surface also adds nothing only the
 * wire can prove (zero arguments — nothing to smuggle or coerce), and the
 * HTTP envelope mechanics are already pinned by the wire siblings. The one
 * transport-tier observable — the `GRAPHQL_VALIDATION_FAILED` extensions
 * code Apollo assigns to validator rejections — is protocol behavior
 * pinned repo-wide by `error-contract-matrix.test.ts` over the live
 * pipeline; this suite proves the same cells at the tier where they are
 * observable: the validator (pre-resolver, spy at zero) plus the
 * structural zero-argument introspection pin.
 *
 * What this locks down:
 *  - **Closed input surface** — `adminPlatformAnalytics: PlatformAnalytics!`
 *    declares ZERO arguments; ANY argument in a client document dies in the
 *    GraphQL validator before the resolver can run; selecting `id` anywhere
 *    in the subtree fails validation (aggregate anonymity).
 *  - **Deny-before-execute (scope tier)** — anonymous callers receive
 *    `UNAUTHORIZED` and authenticated non-admin roles (student / teacher /
 *    parent) receive `FORBIDDEN`, both BEFORE the resolver body runs —
 *    evidenced by the error codes themselves AND by the service-call spy
 *    staying at zero.
 *  - **Admin happy path** — one active-admin read through the REAL service
 *    (a single call carrying exactly the actor id and locale) returns the
 *    full CLOSED snapshot: every top-level section present with EXACTLY the
 *    documented key set (no extra, no missing), every counter resolving as
 *    a number, rating averages present-and-nullable, `generatedAt` and
 *    every trend bucket riding the DateTime scalar (a valid Date instance
 *    in-process, the ISO-8601 UTC wire string over the JSON transport), the
 *    session trend carrying the full 30-day skeleton, and both trend
 *    fields arriving as arrays.
 *  - **Governed admins (service tier)** — deleted / blocked / suspended
 *    admins pass the pre-resolver role scope (the stale-identity window)
 *    and are denied by the service's governance gate: `FORBIDDEN` with the
 *    exact canonical localized copy, a bounded error item (message +
 *    transport framing + `extensions.code` only), and `data` fully nulled —
 *    no aggregate partial-disclosure.
 *
 * Contexts are built through the in-bundle context factory shape (the
 * plan-catalog role-matrix factory: real translations bound to `"en"`, the
 * fixture user as `user`/`safeUser`, role derived through `toUserRole`).
 * Pre-resolver cells synthesize contexts WITHOUT database rows (the
 * handshake precedent — those denials fire before any data access); the
 * happy-path and governed cells run REAL admin rows provisioned through
 * the entity-setup factories inside ONE committing transaction (the
 * service opens its own transaction, so no outer rollback wrapper may
 * exist) and are hard-deleted in `afterAll` with a zero-residue check.
 *
 * Mandated runner: bun run test/scripts/run-test.ts backend/graphql/test/platform-analytics.query.test.ts
 */

import { afterAll, afterEach, beforeAll, describe, expect, spyOn, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { graphql, parse, validate } from "graphql";
import { db } from "@/backend/db";
import { users } from "@/backend/db/schema/users/users";
import { createTestUser } from "@/backend/db/test/entity-setup";
import { toUserRole } from "@/backend/enum";
import type { Context } from "@/backend/graphql/gqlContextFactory";
import { graphQLSchema } from "@/backend/graphql/gqlSchema";
import { PlatformAnalyticsService } from "@/backend/services";
import type { RegistrationReturnType, UserSelectType } from "@/backend/types";
import { getServerTranslations } from "@/shared/locale/server-graphql";
import type { Translations } from "@/shared/locale/types/message";
import { countUsersByIds, deleteUsersByIds } from "@/test/helpers";

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

function arrayOf(value: unknown, message: string): readonly unknown[] {
  if (!Array.isArray(value)) {
    throw new Error(message);
  }
  return value;
}

function stringOf(value: unknown, message: string): string {
  if (typeof value !== "string") {
    throw new Error(message);
  }
  return value;
}

/** The graphql-scalars `DateTime` runtime half: a valid `Date` instance. */
function dateInstanceOf(value: unknown, message: string): Date {
  if (!(value instanceof Date)) {
    throw new Error(message);
  }
  return value;
}

/** The transport half: JSON.stringify renders the Date as the wire string. */
function wireStringOf(value: Date, message: string): string {
  return stringOf(JSON.parse(JSON.stringify(value)), message);
}

/** The sorted wire key set of a record-shaped payload node. */
function sortedKeysOf(value: unknown, label: string): string[] {
  return Object.keys(recordOf(value, label)).toSorted((left, right) => left.localeCompare(right));
}

/** Exact-shape assertion: no extra key, no missing key, on one payload node. */
function expectExactKeys(value: unknown, expected: readonly string[], label: string): void {
  expect(sortedKeysOf(value, label)).toEqual([...expected].toSorted((left, right) => left.localeCompare(right)));
}

/** Every documented leaf of the closed snapshot, keyed by payload node. */
const ROOT_KEYS = [
  "generatedAt",
  "users",
  "sessions",
  "revenue",
  "subscriptions",
  "teachers",
  "ratings",
  "health",
  "sessionTrendDaily",
  "revenueTrendDaily",
] as const;

const USER_KEYS = [
  "totalCount",
  "activeCount",
  "suspendedCount",
  "blockedCount",
  "deletedCount",
  "adminsCount",
  "teachersCount",
  "studentsCount",
  "parentsCount",
  "newThisWeekCount",
  "recentlyActive24h",
] as const;

const SESSION_KEYS = [
  "total",
  "today",
  "thisWeek",
  "thisMonth",
  "scheduled",
  "started",
  "completed",
  "cancelled",
  "disputed",
  "awaitingConfirmation",
] as const;

const REVENUE_KEYS = ["gatewayRevenueByCurrency", "offlineActivationsCount"] as const;

const CURRENCY_REVENUE_KEYS = ["currency", "totalAmount", "last30DaysAmount", "paidPaymentsCount"] as const;

const SUBSCRIPTION_KEYS = [
  "total",
  "active",
  "pending",
  "expired",
  "cancelled",
  "suspended",
  "activeInWindowNow",
] as const;

const TEACHER_KEYS = ["certifiedCount", "evaluatorCount", "onlineNowCount"] as const;

const RATING_KEYS = [
  "averageSessionRating",
  "sessionRatingsCount",
  "averageEvaluationScore",
  "evaluationScoresCount",
] as const;

const HEALTH_KEYS = ["pendingDisputes", "pendingWithdrawals"] as const;

const SESSION_TREND_KEYS = ["bucketStart", "sessionCount"] as const;

const REVENUE_TREND_KEYS = ["bucketStart", "currency", "amount"] as const;

/** The two honest-absence members — the ONLY nullable leaves on the surface. */
const NULLABLE_AVERAGES = ["averageSessionRating", "averageEvaluationScore"] as const;

/** Full 30-day UTC-midnight skeleton the session trend always expands to. */
const SESSION_TREND_BUCKET_COUNT = 30;

/** Transport framing keys of a serialized GraphQL error item (bounded set). */
const ERROR_JSON_KEYS = ["extensions", "locations", "message", "path"] as const;

// graphql-scalars DateTime serializes `Date` to an ISO-8601 UTC instant.
const ISO_UTC_DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

// ─── Documents ───────────────────────────────────────────────────────────────

/** The FULL closed selection — every section, every leaf, no `id` anywhere. */
const FULL_SNAPSHOT_DOCUMENT = `
  query WireAdminPlatformAnalytics {
    adminPlatformAnalytics {
      generatedAt
      users {
        totalCount
        activeCount
        suspendedCount
        blockedCount
        deletedCount
        adminsCount
        teachersCount
        studentsCount
        parentsCount
        newThisWeekCount
        recentlyActive24h
      }
      sessions {
        total
        today
        thisWeek
        thisMonth
        scheduled
        started
        completed
        cancelled
        disputed
        awaitingConfirmation
      }
      revenue {
        gatewayRevenueByCurrency {
          currency
          totalAmount
          last30DaysAmount
          paidPaymentsCount
        }
        offlineActivationsCount
      }
      subscriptions {
        total
        active
        pending
        expired
        cancelled
        suspended
        activeInWindowNow
      }
      teachers {
        certifiedCount
        evaluatorCount
        onlineNowCount
      }
      ratings {
        averageSessionRating
        sessionRatingsCount
        averageEvaluationScore
        evaluationScoresCount
      }
      health {
        pendingDisputes
        pendingWithdrawals
      }
      sessionTrendDaily {
        bucketStart
        sessionCount
      }
      revenueTrendDaily {
        bucketStart
        currency
        amount
      }
    }
  }
`;

/** A client document smuggling an argument the field does not declare. */
const SMUGGLED_ARGUMENT_DOCUMENT =
  "query WireSmuggledArgument { adminPlatformAnalytics(filter: { x: 1 }) { generatedAt } }";

/** Aggregate-anonymity probes: `id` is selectable NOWHERE in the subtree. */
const ID_PROBE_SOURCES = [
  "query WireRootId { adminPlatformAnalytics { id } }",
  "query WireSectionId { adminPlatformAnalytics { users { id } } }",
] as const;

// ─── In-bundle test-context factory (plan-catalog role-matrix shape) ─────────

/** Per-run fixture marker (unique emails — collision-proof across runs). */
const FIXTURE_MARKER = `pan-wire-${randomUUID().slice(0, 8)}`;

function buildContextForUser(user: UserSelectType | null): Context {
  let safeUser: RegistrationReturnType | null = null;
  if (user) {
    const { passwordHash: _passwordHash, ...rest } = user;
    safeUser = { ...rest, preferredRecitation: null };
  }
  return {
    locale: "en",
    t: async <K extends keyof Translations>(ns: K) => getServerTranslations("en")[ns],
    requestId: "req-platform-analytics-wire",
    user: safeUser,
    safeUser,
    permissions: [],
    isSuperAdmin: user?.role === "admin",
    role: user ? toUserRole(user.role) : null,
    cookies: {},
    authCookieOut: [],
  };
}

/**
 * Context-only stand-ins for the denied roles — the scope tier denies them
 * before any data access, so no database row is needed (the handshake
 * precedent for pre-resolver cells).
 */
function contextOnlyUser(role: "student" | "teacher" | "parent", userId: number): UserSelectType {
  return {
    id: userId,
    email: `${FIXTURE_MARKER}-${role}@test.local`,
    fullName: `Platform Analytics Wire ${role}`,
    phone: "+10000000000",
    country: "Egypt",
    countryCode: "EG",
    gender: "male",
    dateOfBirth: "1990-01-01",
    mustChangePassword: false,
    role,
    isDeleted: false,
    suspended: false,
    isBlocked: false,
    deletedAt: null,
    suspendedAt: null,
    blockedAt: null,
    lastActiveAt: null,
    suspendedPeriodDays: null,
    passwordHash: "test-stub-hash",
    locale: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

// ─── Spy lifecycle (bun reuses ONE mock per object+method until restored) ────

interface RestorableSpy {
  readonly mockRestore: () => void;
}

const trackedSpies: RestorableSpy[] = [];

function trackSpy<T extends RestorableSpy>(spy: T): T {
  trackedSpies.push(spy);
  return spy;
}

/** Call-through spy on the analytics service — counts invocations only. */
function spyOnAnalyticsService() {
  return trackSpy(spyOn(PlatformAnalyticsService, "getPlatformAnalytics"));
}

afterEach(() => {
  for (const spy of trackedSpies) {
    spy.mockRestore();
  }
  trackedSpies.length = 0;
});

// ─── Execution helpers ───────────────────────────────────────────────────────

function executeForContext(contextValue: Context) {
  return graphql({
    schema: graphQLSchema,
    source: FULL_SNAPSHOT_DOCUMENT,
    contextValue,
  });
}

/** The `adminPlatformAnalytics` wire payload of a successful execution. */
function snapshotPayloadOf(data: unknown): Record<string, unknown> {
  return recordOf(recordOf(data, "expected execution data").adminPlatformAnalytics, "expected the snapshot payload");
}

/** The single error item of a denial execution, runtime-guarded. */
function soleErrorOf(errors: readonly unknown[] | undefined): Record<string, unknown> {
  if (errors?.length !== 1) {
    throw new Error("expected exactly one GraphQL error item");
  }
  return recordOf(errors[0], "expected a record-shaped error item");
}

function errorCodeOf(errorItem: Record<string, unknown>): string {
  const extensions = recordOf(errorItem.extensions, "expected record-shaped extensions");
  return stringOf(extensions.code, "expected a string extensions.code");
}

function messageOf(errorItem: Record<string, unknown>): string {
  return stringOf(errorItem.message, "expected a string error message");
}

/** The serialized (JSON) view of one error item — the payload that ships. */
function jsonViewOf(errorItem: Record<string, unknown>): Record<string, unknown> {
  const toJSON = errorItem.toJSON;
  if (typeof toJSON !== "function") {
    throw new Error("expected a JSON-serializable error item");
  }
  return recordOf(toJSON.call(errorItem), "expected a JSON object view of the error item");
}

// ─── Fixtures (real admin rows — the gate re-reads governance from the DB) ───

interface FixtureCast {
  readonly activeAdmin: UserSelectType;
  readonly governedAdmin: UserSelectType;
}

let cast: FixtureCast | undefined;

function theCast(): FixtureCast {
  if (!cast) {
    throw new Error("expected the fixture cast");
  }
  return cast;
}

type GovernanceState = "deleted" | "blocked" | "suspended";

const GOVERNANCE_STATES: readonly GovernanceState[] = ["deleted", "blocked", "suspended"];

const DENIED_ROLES: readonly ("student" | "teacher" | "parent")[] = ["student", "teacher", "parent"];

/** Canonical denial copy per governance state (deterministic gate order). */
function governanceMessageOf(state: GovernanceState): string {
  const tErrors = getServerTranslations("en").errorsTranslations;
  if (state === "deleted") {
    return tErrors.accountDeleted;
  }
  return state === "blocked" ? tErrors.accountBlocked : tErrors.accountSuspended;
}

/** Flips the governed fixture row to exactly one governance state. */
async function setGovernanceState(state: GovernanceState): Promise<void> {
  const now = new Date();
  await db
    .update(users)
    .set({
      isDeleted: state === "deleted",
      deletedAt: state === "deleted" ? now : null,
      isBlocked: state === "blocked",
      blockedAt: state === "blocked" ? now : null,
      suspended: state === "suspended",
      suspendedAt: state === "suspended" ? now : null,
    })
    .where(eq(users.id, theCast().governedAdmin.id));
}

/**
 * Provisions both admins inside ONE committing transaction — the service
 * opens its own transaction on the happy path, so no outer rollback
 * wrapper may exist (the wire-suite fixture convention).
 */
async function provisionCast(): Promise<FixtureCast> {
  return db.transaction(async tx => ({
    activeAdmin: await createTestUser(tx, {
      fullName: `${FIXTURE_MARKER} active admin`,
      email: `${FIXTURE_MARKER}-active-admin@test.local`,
      role: "admin",
    }),
    governedAdmin: await createTestUser(tx, {
      fullName: `${FIXTURE_MARKER} governed admin`,
      email: `${FIXTURE_MARKER}-governed-admin@test.local`,
      role: "admin",
      isDeleted: true,
      deletedAt: new Date(),
    }),
  }));
}

beforeAll(async () => {
  cast = await provisionCast();
}, 30_000);

afterAll(async () => {
  if (!cast) {
    return;
  }
  const ids = [cast.activeAdmin.id, cast.governedAdmin.id];
  expect(await deleteUsersByIds(ids)).toBe(ids.length);
  expect(await countUsersByIds(ids)).toBe(0);
}, 30_000);

// ─── Schema-tier closed surface ──────────────────────────────────────────────

function queryField(name: string) {
  const fields = graphQLSchema.getQueryType()?.getFields();
  if (!fields) {
    throw new Error("Schema must define a root Query type");
  }
  const field = fields[name];
  if (!field) {
    throw new Error(`Query must register a \`${name}\` root field`);
  }
  return field;
}

describe("platform analytics query — schema-tier closed surface", () => {
  test("`adminPlatformAnalytics` registers NON-NULLABLE with ZERO arguments", () => {
    const field = queryField("adminPlatformAnalytics");
    expect(field.type.toString()).toBe("PlatformAnalytics!");
    expect(field.args).toHaveLength(0);
  });

  test("the full closed selection validates clean against the built schema", () => {
    const errors = validate(graphQLSchema, parse(FULL_SNAPSHOT_DOCUMENT));
    expect(errors).toHaveLength(0);
  });

  test.each(ID_PROBE_SOURCES.map(source => [source]))(
    "selecting `id` anywhere in the subtree fails validation (aggregate anonymity)",
    source => {
      const errors = validate(graphQLSchema, parse(source));
      expect(errors).toHaveLength(1);
      expect(errors[0]?.message).toContain('Cannot query field "id"');
    }
  );
});

// ─── Deny-before-execute: the scope tier (spy pinned at zero) ────────────────

describe("platform analytics query — scope-tier denials fire pre-resolver", () => {
  test("anonymous callers receive UNAUTHORIZED with the service never invoked", async () => {
    const serviceSpy = spyOnAnalyticsService();
    const result = await executeForContext(buildContextForUser(null));

    const errorItem = soleErrorOf(result.errors);
    expect(errorCodeOf(errorItem)).toBe("UNAUTHORIZED");
    expect(result.data).toBeNull();
    expect(serviceSpy.mock.calls).toHaveLength(0);
  });

  test.each(DENIED_ROLES.map(role => [role]))(
    "authenticated %s receives FORBIDDEN with the service never invoked",
    async role => {
      const serviceSpy = spyOnAnalyticsService();
      const result = await executeForContext(buildContextForUser(contextOnlyUser(role, 4_000_000)));

      const errorItem = soleErrorOf(result.errors);
      expect(errorCodeOf(errorItem)).toBe("FORBIDDEN");
      expect(result.data).toBeNull();
      expect(serviceSpy.mock.calls).toHaveLength(0);
    }
  );
});

// ─── Closed input surface: any argument is a validator death ─────────────────

describe("platform analytics query — any argument dies in the validator", () => {
  test("a smuggled `filter` argument rejects pre-resolver with the service never invoked", async () => {
    const serviceSpy = spyOnAnalyticsService();
    const result = await graphql({
      schema: graphQLSchema,
      source: SMUGGLED_ARGUMENT_DOCUMENT,
      contextValue: buildContextForUser(null),
    });

    const errorItem = soleErrorOf(result.errors);
    expect(messageOf(errorItem)).toContain("Unknown argument");
    expect(messageOf(errorItem)).toContain("adminPlatformAnalytics");
    // Validation-tier death: the request never executed, so `data` is
    // absent entirely (not nulled) — nothing was resolved.
    expect(result.data).toBeUndefined();
    expect(serviceSpy.mock.calls).toHaveLength(0);
  });
});

// ─── Admin happy path: the full closed snapshot over the REAL service ────────

describe("platform analytics query — admin happy path (full closed shape)", () => {
  test("answers the whole closed snapshot through EXACTLY one service call", async () => {
    const serviceSpy = spyOnAnalyticsService();
    const result = await executeForContext(buildContextForUser(theCast().activeAdmin));

    expect(result.errors).toBeUndefined();
    expect(serviceSpy.mock.calls).toHaveLength(1);
    expect(serviceSpy.mock.calls[0]).toEqual([theCast().activeAdmin.id, "en"]);

    const payload = snapshotPayloadOf(result.data);
    expectExactKeys(payload, ROOT_KEYS, "root payload");

    expectExactKeys(payload.users, USER_KEYS, "users section");
    expectExactKeys(payload.sessions, SESSION_KEYS, "sessions section");
    expectExactKeys(payload.revenue, REVENUE_KEYS, "revenue section");
    expectExactKeys(payload.subscriptions, SUBSCRIPTION_KEYS, "subscriptions section");
    expectExactKeys(payload.teachers, TEACHER_KEYS, "teachers section");
    expectExactKeys(payload.ratings, RATING_KEYS, "ratings section");
    expectExactKeys(payload.health, HEALTH_KEYS, "health section");

    // Every counter rides `Int!` — each must resolve as a real number.
    const counterSections = [payload.users, payload.sessions, payload.subscriptions, payload.teachers, payload.health];
    for (const section of counterSections) {
      for (const value of Object.values(recordOf(section, "expected a counter section"))) {
        expect(typeof value).toBe("number");
      }
    }

    // Revenue: per-currency rows keep the exact four-leaf shape with
    // decimal-string money; the honesty counter is a number.
    const revenue = recordOf(payload.revenue, "expected the revenue section");
    const gatewayRows = arrayOf(revenue.gatewayRevenueByCurrency, "expected a gatewayRevenueByCurrency array");
    for (const row of gatewayRows) {
      expectExactKeys(row, CURRENCY_REVENUE_KEYS, "currency revenue row");
      const currencyRow = recordOf(row, "expected a currency revenue row");
      expect(typeof currencyRow.currency).toBe("string");
      expect(typeof currencyRow.totalAmount).toBe("string");
      expect(typeof currencyRow.last30DaysAmount).toBe("string");
      expect(typeof currencyRow.paidPaymentsCount).toBe("number");
    }
    expect(typeof revenue.offlineActivationsCount).toBe("number");

    // Ratings: the two averages are PRESENT keys (honest absence is `null`,
    // never a missing member) and are the only nullable leaves.
    const ratings = recordOf(payload.ratings, "expected the ratings section");
    for (const averageKey of NULLABLE_AVERAGES) {
      expect(Object.hasOwn(ratings, averageKey)).toBe(true);
      const average = ratings[averageKey];
      expect(average === null || typeof average === "number").toBe(true);
    }
    expect(typeof ratings.sessionRatingsCount).toBe("number");
    expect(typeof ratings.evaluationScoresCount).toBe("number");
  });

  test("snapshot instants serialize as the DateTime wire format and the trend fields are arrays", async () => {
    const result = await executeForContext(buildContextForUser(theCast().activeAdmin));
    expect(result.errors).toBeUndefined();

    const payload = snapshotPayloadOf(result.data);

    // graphql-scalars `DateTime` hands the transport a valid `Date`
    // instance in-process; the HTTP JSON layer renders it as the ISO-8601
    // UTC wire string — both halves are pinned below.
    const generatedAt = dateInstanceOf(payload.generatedAt, "expected a Date instance generatedAt");
    expect(Number.isNaN(generatedAt.getTime())).toBe(false);
    expect(generatedAt.getTime()).toBeGreaterThan(Date.now() - 60_000);
    const generatedWire = wireStringOf(generatedAt, "expected an ISO wire string generatedAt");
    expect(ISO_UTC_DATETIME.test(generatedWire)).toBe(true);

    // Session trend: a REAL array expanded onto the full 30-day skeleton.
    const sessionTrend = arrayOf(payload.sessionTrendDaily, "expected a sessionTrendDaily array");
    expect(sessionTrend).toHaveLength(SESSION_TREND_BUCKET_COUNT);
    for (const point of sessionTrend) {
      expectExactKeys(point, SESSION_TREND_KEYS, "session trend point");
      const trendPoint = recordOf(point, "expected a session trend point");
      const bucketStart = dateInstanceOf(trendPoint.bucketStart, "expected a Date instance bucketStart");
      expect(ISO_UTC_DATETIME.test(wireStringOf(bucketStart, "expected an ISO wire string bucketStart"))).toBe(true);
      expect(typeof trendPoint.sessionCount).toBe("number");
    }

    // Revenue trend: a REAL array of (day, currency) points; honestly
    // empty when the trailing window observes no currency, exact-shape
    // otherwise.
    const revenueTrend = arrayOf(payload.revenueTrendDaily, "expected a revenueTrendDaily array");
    for (const point of revenueTrend) {
      expectExactKeys(point, REVENUE_TREND_KEYS, "revenue trend point");
      const trendPoint = recordOf(point, "expected a revenue trend point");
      const bucketStart = dateInstanceOf(trendPoint.bucketStart, "expected a Date instance bucketStart");
      expect(ISO_UTC_DATETIME.test(wireStringOf(bucketStart, "expected an ISO wire string bucketStart"))).toBe(true);
      expect(typeof trendPoint.currency).toBe("string");
      expect(typeof trendPoint.amount).toBe("string");
    }
  });
});

// ─── Governed admins: service-tier FORBIDDEN, bounded error payload ──────────

describe("platform analytics query — governed admins denied at the service tier", () => {
  test.each(GOVERNANCE_STATES.map(state => [state]))(
    "a %s admin passes the scope tier and receives FORBIDDEN with the canonical copy only",
    async state => {
      await setGovernanceState(state);
      const serviceSpy = spyOnAnalyticsService();
      // The context mirrors the stale-identity window: identity (id, role)
      // comes from the issued token, governance lives on the DB row the
      // service re-reads.
      const result = await executeForContext(buildContextForUser(theCast().governedAdmin));

      // The resolver DID run — the denial comes from the service tier,
      // past the pre-resolver role scope.
      expect(serviceSpy.mock.calls).toHaveLength(1);

      const errorItem = soleErrorOf(result.errors);
      expect(errorCodeOf(errorItem)).toBe("FORBIDDEN");
      expect(messageOf(errorItem)).toBe(governanceMessageOf(state));

      // Bounded payload: canonical message + transport framing +
      // extensions.code ONLY — no debug echo, no details, no stack — and
      // `data` fully nulled (no aggregate partial-disclosure).
      expect(Object.keys(jsonViewOf(errorItem)).toSorted((left, right) => left.localeCompare(right))).toEqual(
        [...ERROR_JSON_KEYS].toSorted((left, right) => left.localeCompare(right))
      );
      expect(recordOf(errorItem.extensions, "expected record-shaped extensions")).toEqual({ code: "FORBIDDEN" });
      expect(result.data).toBeNull();
    }
  );
});
