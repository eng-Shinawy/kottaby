/**
 * Admin session-governance query wire-tier suite — the two admin-only
 * reads (`adminSessions` directory + `adminSession` browse detail) over the
 * LIVE GraphQL pipeline (mandated runner at the bottom).
 *
 * HARNESS ADAPTATION (single-process full pipeline) — mirrors the admin
 * governance mutation suite: the canonical live-wire harness spawns the
 * Next.js dev server in a SECOND OS process, which is structurally
 * impossible under the sandbox's sanctioned `DB_PROVIDER=pglite` provider
 * (single-connection WASM Postgres — each process opening the data dir
 * gets its OWN instance and the second opener aborts; see
 * `test/helpers/skip-when-pglite.ts`). The adaptation executes THE
 * PRODUCTION ROUTE PIPELINE IN-PROCESS: `POST` from
 * `@/app/api/graphql/route` driven by synthesized `NextRequest` objects —
 * transport guards → rate-limit wrapper (fail-open stub) → Apollo engine
 * (validate → scope-auth/authScopes → resolver) with the REAL
 * `createGraphQLContext` (Bearer-token verification + requestId) →
 * `SessionAdminGovernanceService` → PostgreSQL → `finalizeGraphqlErrors`.
 * The only absent stage is the HTTP socket itself.
 *
 * Cells locked down over the real pipeline:
 *  - **Directory happy path** — the admin call returns the paged
 *    `SessionPage` with the honest `totalCount`, the echoed window, and
 *    the fixture rows; scoped filters (participant ids, lifecycle
 *    vocabulary, creation-instant window) narrow the set exactly; rows
 *    order newest-first.
 *  - **Server-derived attention badge** — directory rows carry
 *    `needsAttention` computed per read: the disputed fixture is `true`,
 *    plain scheduled rows are `false`, and a scheduled row whose
 *    confirmation deadline has lapsed flips to `true` under the frozen
 *    clock (the sanctioned `setSystemTime` seam) and back to `false` once
 *    the clock is restored — the badge is computed per request, never
 *    persisted.
 *  - **Browse detail** — the row for ANY id; unknown and malformed ids
 *    resolve to `null` with NO errors (null-not-error browse posture).
 *  - **Tier 4 — 401/403 byte-identical to the admin reference query** —
 *    `adminDisputedSessions` is the existing admin-gated QUERY reference:
 *    anonymous callers get the SAME localized UNAUTHORIZED denial, and
 *    every authenticated non-admin caller — the three non-admin members
 *    of the persisted `users.role` vocabulary (student / teacher /
 *    parent) PLUS the "applicant" (a teacher-role user carrying an
 *    `applicants` row; not a role member itself — `supervisor` is not a
 *    `user_role` enum member either) —
 *    gets the SAME localized FORBIDDEN denial. "Byte-identical" = the
 *    finalized error item's `message`, `extensions.code`, and extension
 *    KEY SET are equal (the per-request `extensions.requestId`
 *    correlation value and the failing root field's `path` are the only
 *    deliberate per-op differences). Denials ride the scope gate BEFORE
 *    the resolver.
 *  - **Read-only guarantee** — executing BOTH queries (directory +
 *    detail) appends ZERO audit rows (per session entity AND by the
 *    admin actor) and leaves a tracked session row byte-identical: no
 *    session mutation, no audit write, no notification write anywhere on
 *    the read path.
 *
 * Fixtures: a real committed cast (real `users.role` + role-child rows via
 * `@/test/workflows/helpers` builders) + three booked sessions (plain
 * scheduled, disputed by its student, lapsed-deadline probe); every
 * created session id is registered for the FK-safe hard-delete cleanup.
 * Identity rides minted-but-real access tokens (same `signAccessToken`
 * the auth layer issues; the pipeline verifies them with the same env) —
 * nothing is monkey-patched. `afterAll` closes the DB pool so the
 * single-connection PGlite data dir is released cleanly for the next
 * suite (a stale `postmaster.pid` bricks subsequent initializations).
 *
 * Run:
 *   bun run test/scripts/run-test.ts backend/graphql/test/admin-session-governance.query.test.ts
 */

import { afterAll, beforeAll, describe, expect, setSystemTime, test } from "bun:test";
import { gql } from "@apollo/client";
import { and, eq, inArray, sql } from "drizzle-orm";
import { closePool, db } from "@/backend/db";
import { auditLogs } from "@/backend/db/schema/audit/audit-logs";
import { session as sessionTable } from "@/backend/db/schema/classes/session";
import {
  countAuditForSession,
  expectDenialIdenticalToReference,
  fingerprintOf,
  firstWireItem,
  isRecord,
  payloadOf,
  wireGraphQL,
} from "@/backend/graphql/test/helpers/admin-session-governance.wire";
import { signAccessToken } from "@/backend/lib/auth/jwt";
// Deep import (same rationale as the journey cleanup helper — the
// `test/helpers` barrel pulls the Apollo test client into backend-only
// graphs; this suite needs the audit-trigger suspension wrapper directly).
import { withAuditDeleteTriggersSuspended } from "@/test/helpers/db-cleanup";
import {
  buildSessionJourneyCast,
  createSessionFixtureRegistry,
  journeyPrefix,
  type SessionJourneyCast,
} from "@/test/workflows/helpers";

// ─── Harness state ───────────────────────────────────────────────────────────

/** Per-run prefix — unique user labels AND idempotency keys per suite run. */
const PREFIX = journeyPrefix("admgovq");

const KEY_BOOK_PLAIN = `${PREFIX}-book-plain`;
const KEY_BOOK_DISPUTED = `${PREFIX}-book-disputed`;
const KEY_BOOK_LAPSED = `${PREFIX}-book-lapsed`;

/** Large unused id — the pre-resolver denial/absence target (ID args). */
const UNKNOWN_SESSION_ID = "999999999";
/** Numeric twin of the unknown id — the Int-typed filter probe value. */
const UNKNOWN_USER_ID = 999999999;

/** The fixture registry — every created session id is hard-deleted in afterAll. */
const registry = createSessionFixtureRegistry();

let cast: SessionJourneyCast;

/** Minted-but-real access tokens (verified by the pipeline's context factory). */
let adminToken = "";
let studentAToken = "";
let teacherTToken = "";
let applicantToken = "";
let parentToken = "";

/**
 * The authenticated non-admin callers this matrix exercises: the three
 * non-admin members of the persisted `users.role` vocabulary
 * {admin, teacher, student, parent} PLUS the "applicant" — NOT a role
 * member but a teacher-role user carrying an `applicants` row and no
 * `teacher` row, minted through the same real-token path.
 */
const NON_ADMIN_ROLES = ["student", "teacher", "parent", "applicant"] as const;
type NonAdminRole = (typeof NON_ADMIN_ROLES)[number];
const roleTokens = new Map<NonAdminRole, string>();

/** Booked-session ids shared across the query legs. */
let sessionPlainScheduledId = "";
let sessionDisputedId = "";
let sessionLapsedId = "";

/** Every session id this suite created (the read-only + teardown probes). */
function fixtureSessionIds(): number[] {
  return [sessionPlainScheduledId, sessionDisputedId, sessionLapsedId].filter(id => id !== "").map(id => Number(id));
}

// ─── Documents ───────────────────────────────────────────────────────────────

const ADMIN_SESSIONS_DOC = gql`
  query AdminSessions($filter: AdminSessionListFilterInput!, $page: Int, $pageSize: Int) {
    adminSessions(filter: $filter, page: $page, pageSize: $pageSize) {
      items {
        id
        status
        needsAttention
        studentId
        teacherId
        confirmationDeadline
        createdAt
      }
      totalCount
      page
      pageSize
    }
  }
`;

const ADMIN_SESSION_DOC = gql`
  query AdminSession($id: ID!) {
    adminSession(id: $id) {
      id
      status
      needsAttention
      feeHeld
    }
  }
`;

/** The byte-identical REFERENCE op — the existing admin-gated arbitration query. */
const ADMIN_DISPUTED_REFERENCE_DOC = gql`
  query AdminDisputedSessionsReference($filter: SessionListFilterInput) {
    adminDisputedSessions(filter: $filter, limit: 25, offset: 0) {
      totalCount
    }
  }
`;

const CREATE_SESSION_DOC = gql`
  mutation CreateSession($input: CreateSessionInput!) {
    createSession(input: $input) {
      id
      status
    }
  }
`;

const OPEN_DISPUTE_DOC = gql`
  mutation OpenSessionDispute($id: ID!, $reason: String!) {
    openSessionDispute(id: $id, reason: $reason) {
      id
      status
    }
  }
`;

// ─── Narrowing helpers (runtime-guarded — zero casts) ────────────────────────

/** Narrows a SessionPage payload's items list with a guard. */
function itemsOf(pagePayload: Record<string, unknown>): Array<Record<string, unknown>> {
  const items: unknown = pagePayload.items;
  if (!Array.isArray(items)) {
    throw new Error("SessionPage payload must carry an items list");
  }
  return items.filter(isRecord);
}

/** Narrows one row's id (string on the ID wire) with a guard. */
function rowIdOf(row: Record<string, unknown>): string {
  const id: unknown = row.id;
  if (typeof id !== "string" && typeof id !== "number") {
    throw new Error("row payload carries no id");
  }
  return String(id);
}

// ─── Wire helpers (single-process full pipeline — see header) ────────────────

/** Mints a REAL access token for a cast user (verified by the live pipeline). */
async function tokenFor(userId: number, role: string): Promise<string> {
  return signAccessToken({ userId, role });
}

/** Books one scheduled session over the pipeline under a UNIQUE idempotency key. */
async function bookSession(accessToken: string, key: string, teacherId: number): Promise<string> {
  const result = await wireGraphQL(CREATE_SESSION_DOC, {
    token: accessToken,
    idempotencyKey: key,
    variables: { input: { teacherId, intent: "Hifz" } },
  });
  const payload = payloadOf(result, "createSession");
  const id: unknown = payload.id;
  if (typeof id !== "string" && typeof id !== "number") {
    throw new Error("createSession returned no id");
  }
  const booked = String(id);
  registry.track("session", Number(booked));
  return booked;
}

/** Counts every `audit_logs` row written BY one actor (the read-only probe). */
async function countAuditByActor(actorId: number): Promise<number> {
  const result = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(auditLogs)
    .where(eq(auditLogs.actorId, actorId));
  return result[0]?.count ?? 0;
}

/** Reads the full canonical row of one session (the byte-identical probe). */
async function readSessionRow(sessionId: number): Promise<Record<string, unknown>> {
  const rows = await db.select().from(sessionTable).where(eq(sessionTable.id, sessionId));
  const row: unknown = rows[0];
  if (!isRecord(row)) {
    throw new Error(`no session row found for id ${String(sessionId)}`);
  }
  return row;
}

/** Sums the audit rows across every fixture session. */
async function totalAuditAcrossFixtures(): Promise<number> {
  const ids = fixtureSessionIds();
  const counts = await Promise.all(ids.map(id => countAuditForSession(id)));
  return counts.reduce((sum, count) => sum + count, 0);
}

/** Runs one directory call filtered to the fixture student's rows. */
async function directoryForFixtures(extraFilter: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
  const result = await wireGraphQL(ADMIN_SESSIONS_DOC, {
    token: adminToken,
    variables: { filter: { studentUserId: cast.primaryStudent.userId, ...extraFilter } },
  });
  return payloadOf(result, "adminSessions");
}

// ─── Fixtures (committed cast + pre-booked directory rows) ──────────────────

beforeAll(async () => {
  // Committed cast — the primary student funds THREE bookings (trial lane
  // first, then the hifz lane, mirroring the booking ladder's lane order).
  await db.transaction(async tx => {
    cast = await buildSessionJourneyCast(tx, registry, {
      prefix: PREFIX,
      primaryStudent: { trial: 1, hifz: 3 },
    });
  });

  // Real access tokens for every actor (same signer the auth layer uses).
  const [tokenAdmin, tokenStudentA, tokenTeacherT, tokenApplicant, tokenParent] = await Promise.all([
    tokenFor(cast.admin.userId, cast.admin.user.role),
    tokenFor(cast.primaryStudent.userId, cast.primaryStudent.user.role),
    tokenFor(cast.teacher.userId, cast.teacher.user.role),
    tokenFor(cast.applicant.userId, cast.applicant.user.role),
    tokenFor(cast.parent.userId, cast.parent.user.role),
  ]);

  adminToken = tokenAdmin;
  studentAToken = tokenStudentA;
  teacherTToken = tokenTeacherT;
  applicantToken = tokenApplicant;
  parentToken = tokenParent;
  roleTokens.set("student", studentAToken);
  roleTokens.set("teacher", teacherTToken);
  roleTokens.set("parent", parentToken);
  roleTokens.set("applicant", applicantToken);

  // Pre-book the three directory rows under DISTINCT per-run keys.
  // Sequential — the booking ladder's lane order matters (trial first).
  sessionPlainScheduledId = await bookSession(studentAToken, KEY_BOOK_PLAIN, cast.teacher.userId);
  sessionDisputedId = await bookSession(studentAToken, KEY_BOOK_DISPUTED, cast.teacher.userId);
  sessionLapsedId = await bookSession(studentAToken, KEY_BOOK_LAPSED, cast.teacher.userId);

  // Move the second row into `disputed` — its owner student disputes it
  // (scheduled rows are dispute-eligible; the dispute is the badge's first arm).
  const disputed = await wireGraphQL(OPEN_DISPUTE_DOC, {
    token: studentAToken,
    variables: { id: sessionDisputedId, reason: "directory badge probe" },
  });
  const disputedPayload = payloadOf(disputed, "openSessionDispute");
  expect(disputedPayload.status).toBe("Disputed");
}, 240_000);

afterAll(async () => {
  // This suite's QUERIES write nothing, but the SETUP mutations (bookings,
  // the dispute) may have appended immutable `audit_logs` rows. The fixture
  // registry's tracked vocabulary deliberately EXCLUDES `audit_logs`, so
  // the rows are removed explicitly under the trigger-suspension wrapper
  // (the mutation-suite teardown precedent) BEFORE the FK-ordered cast
  // delete below.
  await withAuditDeleteTriggersSuspended(async () => {
    const ids = fixtureSessionIds();
    if (ids.length > 0) {
      await db.delete(auditLogs).where(and(eq(auditLogs.entityType, "session"), inArray(auditLogs.entityId, ids)));
    }
  });
  await registry.cleanup();
  // Release the single-connection PGlite data dir cleanly — an abrupt exit
  // leaves `postmaster.pid` behind, which bricks every subsequent PGlite
  // initialization in this sandbox (WASM abort on the next open).
  await closePool();
});

// ─── Section 1 — directory happy path + filter whitelist (admin) ─────────────

describe("adminSessions — directory happy path (admin)", () => {
  test("returns the fixture rows with the honest total, the echoed defaults window, and newest-first ordering", async () => {
    const page = await directoryForFixtures();
    // Honest total over the SAME filtered predicate — exactly the three
    // fixture rows belong to the cast student.
    expect(page.totalCount).toBe(3);
    // SDL defaults echoed honestly (no page/pageSize variables sent).
    expect(page.page).toBe(1);
    expect(page.pageSize).toBe(25);

    const items = itemsOf(page);
    expect(items).toHaveLength(3);
    const ids = items.map(rowIdOf);
    // Newest first — the last booking sits at the head of the list.
    expect(ids[0]).toBe(sessionLapsedId);
    expect(ids.toSorted((a, b) => a.localeCompare(b))).toEqual(
      [sessionPlainScheduledId, sessionDisputedId, sessionLapsedId].toSorted((a, b) => a.localeCompare(b))
    );
    // The canonical projection: every row carries the lifecycle vocabulary
    // and the derived badge member on the wire.
    for (const row of items) {
      expect(typeof row.status).toBe("string");
      expect(typeof row.needsAttention).toBe("boolean");
    }
  });

  test("the badge matrix at real-time clock: disputed row true, scheduled rows false", async () => {
    const page = await directoryForFixtures();
    const byId = new Map(itemsOf(page).map(row => [rowIdOf(row), row]));
    const disputed = byId.get(sessionDisputedId);
    const plain = byId.get(sessionPlainScheduledId);
    const lapsed = byId.get(sessionLapsedId);
    if (!disputed || !plain || !lapsed) {
      throw new Error("directory did not return all three fixture rows");
    }
    expect(disputed.needsAttention).toBe(true);
    expect(plain.needsAttention).toBe(false);
    expect(lapsed.needsAttention).toBe(false);
  });

  test("the badge flips per read under a lapsed confirmation deadline (frozen clock), then flips back", async () => {
    // Jump one confirmation window (24h) plus a margin past the deadlines:
    // every scheduled fixture row is now "scheduled with a lapsed
    // confirmation deadline" — the badge's second arm. The read performs
    // NO writes, so the clock jump touches nothing but the comparison.
    setSystemTime(Date.now() + 25 * 60 * 60 * 1000);
    try {
      // The pre-minted tokens are EXPIRED under the jumped clock (their
      // `exp` is wall-clock bound) — a fresh token minted inside the jump
      // carries the jumped-clock lifetime and verifies normally.
      const jumpedAdminToken = await tokenFor(cast.admin.userId, cast.admin.user.role);
      const lapsedResult = await wireGraphQL(ADMIN_SESSIONS_DOC, {
        token: jumpedAdminToken,
        variables: { filter: { studentUserId: cast.primaryStudent.userId } },
      });
      const lapsedPage = payloadOf(lapsedResult, "adminSessions");
      const byId = new Map(itemsOf(lapsedPage).map(row => [rowIdOf(row), row]));
      const lapsed = byId.get(sessionLapsedId);
      const plain = byId.get(sessionPlainScheduledId);
      const disputed = byId.get(sessionDisputedId);
      if (!lapsed || !plain || !disputed) {
        throw new Error("directory did not return all three fixture rows under the frozen clock");
      }
      expect(lapsed.needsAttention).toBe(true);
      expect(plain.needsAttention).toBe(true);
      expect(disputed.needsAttention).toBe(true);
    } finally {
      // Restore the real clock — the suite must never leak frozen time.
      setSystemTime();
    }
    // A fresh read at the real clock answers with the original matrix —
    // the badge is computed PER REQUEST from live state, never persisted.
    const restoredPage = await directoryForFixtures();
    const restoredById = new Map(itemsOf(restoredPage).map(row => [rowIdOf(row), row]));
    const restoredPlain = restoredById.get(sessionPlainScheduledId);
    if (!restoredPlain) {
      throw new Error("directory did not return the plain fixture row after clock restore");
    }
    expect(restoredPlain.needsAttention).toBe(false);
  });

  test("scoped filters narrow the set: lifecycle vocabulary, teacher ids, and the window pair", async () => {
    // Lifecycle vocabulary (the registered SessionStatus enum on the wire).
    const disputedPage = await directoryForFixtures({ status: "Disputed" });
    expect(disputedPage.totalCount).toBe(1);
    expect(itemsOf(disputedPage).map(rowIdOf)).toEqual([sessionDisputedId]);

    // Teacher participant id — all three fixtures sit with the cast teacher.
    const teacherPage = await wireGraphQL(ADMIN_SESSIONS_DOC, {
      token: adminToken,
      variables: { filter: { teacherUserId: cast.teacher.userId } },
    });
    const teacherPayload = payloadOf(teacherPage, "adminSessions");
    expect(teacherPayload.totalCount).toBe(3);

    // A straddling creation window (half-open) includes every fixture row.
    const windowFrom = new Date(Date.now() - 3_600_000).toISOString();
    const windowTo = new Date(Date.now() + 3_600_000).toISOString();
    const windowPage = await directoryForFixtures({ dateFrom: windowFrom, dateTo: windowTo });
    expect(windowPage.totalCount).toBe(3);

    // An unknown participant id filters to the honest empty page.
    const unknownTeacherPage = await wireGraphQL(ADMIN_SESSIONS_DOC, {
      token: adminToken,
      variables: { filter: { teacherUserId: UNKNOWN_USER_ID } },
    });
    const unknownTeacherPayload = payloadOf(unknownTeacherPage, "adminSessions");
    expect(unknownTeacherPayload.totalCount).toBe(0);
    expect(itemsOf(unknownTeacherPayload)).toEqual([]);
  });

  test("an explicit null filter member drops out (same semantics as absence)", async () => {
    const page = await directoryForFixtures({ status: null, type: null });
    expect(page.totalCount).toBe(3);
  });
});

// ─── Section 2 — pagination window bounds (admin) ────────────────────────────

describe("adminSessions — pagination window", () => {
  test("pageSize 1 returns the newest row next to the UNBOUNDED honest total", async () => {
    const result = await wireGraphQL(ADMIN_SESSIONS_DOC, {
      token: adminToken,
      variables: { filter: { studentUserId: cast.primaryStudent.userId }, page: 1, pageSize: 1 },
    });
    const page = payloadOf(result, "adminSessions");
    expect(page.page).toBe(1);
    expect(page.pageSize).toBe(1);
    expect(page.totalCount).toBe(3);
    const items = itemsOf(page);
    expect(items).toHaveLength(1);
    // Newest first — the window head is the last booking.
    expect(rowIdOf(items[0] ?? {})).toBe(sessionLapsedId);
  });

  test("pageSize 50 is honored verbatim (the upper bound)", async () => {
    const result = await wireGraphQL(ADMIN_SESSIONS_DOC, {
      token: adminToken,
      variables: { filter: { studentUserId: cast.primaryStudent.userId }, pageSize: 50 },
    });
    const page = payloadOf(result, "adminSessions");
    expect(page.page).toBe(1);
    expect(page.pageSize).toBe(50);
    expect(page.totalCount).toBe(3);
    expect(itemsOf(page)).toHaveLength(3);
  });

  test("a page past the window yields the honest remainder (no phantom empties)", async () => {
    const result = await wireGraphQL(ADMIN_SESSIONS_DOC, {
      token: adminToken,
      variables: { filter: { studentUserId: cast.primaryStudent.userId }, page: 2, pageSize: 2 },
    });
    const page = payloadOf(result, "adminSessions");
    expect(page.page).toBe(2);
    expect(page.pageSize).toBe(2);
    expect(page.totalCount).toBe(3);
    expect(itemsOf(page)).toHaveLength(1);
  });

  test("an explicit null page/pageSize restores the declared SDL defaults", async () => {
    const result = await wireGraphQL(ADMIN_SESSIONS_DOC, {
      token: adminToken,
      variables: { filter: { studentUserId: cast.primaryStudent.userId }, page: null, pageSize: null },
    });
    const page = payloadOf(result, "adminSessions");
    expect(page.page).toBe(1);
    expect(page.pageSize).toBe(25);
  });

  test("a zero-width creation window (dateFrom == dateTo) answers empty with the honest zero total", async () => {
    // Half-open over createdAt: >= dateFrom AND < dateTo — an equal pair
    // excludes every instant. The window sits in the past so no row can
    // race into it.
    const boundary = new Date(Date.now() - 3_600_000).toISOString();
    const page = await directoryForFixtures({ dateFrom: boundary, dateTo: boundary });
    expect(page.totalCount).toBe(0);
    expect(itemsOf(page)).toEqual([]);
    expect(page.page).toBe(1);
    expect(page.pageSize).toBe(25);
  });
});

// ─── Section 3 — browse detail: found, absent, malformed ─────────────────────

describe("adminSession — any-state browse read", () => {
  test("returns the disputed row for ANY lifecycle state (projection boundary: the badge is directory-only)", async () => {
    const result = await wireGraphQL(ADMIN_SESSION_DOC, {
      token: adminToken,
      variables: { id: sessionDisputedId },
    });
    const payload = payloadOf(result, "adminSession");
    const id: unknown = payload.id;
    expect(String(id)).toBe(sessionDisputedId);
    expect(payload.status).toBe("Disputed");
    // The browse read returns the plain canonical row — the attention badge
    // is a DIRECTORY projection (list styling), so the detail resolves the
    // field to its absent-producer default.
    expect(payload.needsAttention).toBe(false);
  });

  test("an unknown id resolves to null — data, not a thrown not-found error", async () => {
    const result = await wireGraphQL(ADMIN_SESSION_DOC, {
      token: adminToken,
      variables: { id: UNKNOWN_SESSION_ID },
    });
    expect(result.data).toEqual({ adminSession: null });
    expect(result.error).toBeUndefined();
  });

  test("a malformed id resolves to the SAME null (oracle-safe shape guard, pre-read)", async () => {
    const result = await wireGraphQL(ADMIN_SESSION_DOC, {
      token: adminToken,
      variables: { id: "not-a-number" },
    });
    expect(result.data).toEqual({ adminSession: null });
    expect(result.error).toBeUndefined();
  });
});

// ─── Section 4 — read-only guarantee (no audit rows, byte-identical rows) ────

describe("read-only guarantee — executing the queries writes NOTHING", () => {
  test("directory + detail leave zero audit rows and byte-identical session rows behind", async () => {
    const auditBefore = await totalAuditAcrossFixtures();
    const auditByAdminBefore = await countAuditByActor(cast.admin.userId);
    const plainRowBefore = await readSessionRow(Number(sessionPlainScheduledId));

    // Both reads, happy paths.
    await directoryForFixtures();
    await wireGraphQL(ADMIN_SESSION_DOC, { token: adminToken, variables: { id: sessionDisputedId } });

    expect(await totalAuditAcrossFixtures()).toBe(auditBefore);
    expect(await countAuditByActor(cast.admin.userId)).toBe(auditByAdminBefore);
    expect(auditByAdminBefore).toBe(0);
    // The tracked row is byte-identical after both reads — no lazy
    // side effect touched ANY column (updatedAt included).
    expect(JSON.stringify(await readSessionRow(Number(sessionPlainScheduledId)))).toBe(JSON.stringify(plainRowBefore));
  });
});

// ─── Section 5 — Tier 4: 401 byte-identical to the admin reference query ─────

describe("Tier 4 — anonymous callers: UNAUTHORIZED byte-identical to adminDisputedSessions", () => {
  test("both admin queries answer the SAME localized UNAUTHORIZED denial as the reference admin query", async () => {
    const referenceResult = await wireGraphQL(ADMIN_DISPUTED_REFERENCE_DOC, {
      variables: { filter: {} },
    });
    const reference = fingerprintOf(firstWireItem(referenceResult.error ?? undefined, "UNAUTHORIZED"));

    const anonymousDirectory = await wireGraphQL(ADMIN_SESSIONS_DOC, {
      variables: { filter: {} },
    });
    expect(anonymousDirectory.error).toBeDefined();
    expectDenialIdenticalToReference(anonymousDirectory.error, "UNAUTHORIZED", reference, "adminSessions");

    const anonymousDetail = await wireGraphQL(ADMIN_SESSION_DOC, {
      variables: { id: UNKNOWN_SESSION_ID },
    });
    expect(anonymousDetail.error).toBeDefined();
    expectDenialIdenticalToReference(anonymousDetail.error, "UNAUTHORIZED", reference, "adminSession");
  });

  test("anonymous denials append ZERO audit rows (scope gate precedes the resolver)", async () => {
    const auditBefore = await totalAuditAcrossFixtures();
    await wireGraphQL(ADMIN_SESSIONS_DOC, { variables: { filter: {} } });
    await wireGraphQL(ADMIN_SESSION_DOC, { variables: { id: UNKNOWN_SESSION_ID } });
    expect(await totalAuditAcrossFixtures()).toBe(auditBefore);
    expect(auditBefore).toBe(0);
  });
});

// ─── Section 6 — Tier 4: 403 byte-identical per non-admin role ───────────────

describe("Tier 4 — non-admin roles: FORBIDDEN byte-identical to adminDisputedSessions", () => {
  test.each([...NON_ADMIN_ROLES])(
    "%s caller gets the SAME localized FORBIDDEN denial on both admin queries as the reference admin query",
    async role => {
      const token = roleTokens.get(role);
      if (!token) {
        throw new Error(`no token provisioned for role ${role}`);
      }

      const referenceResult = await wireGraphQL(ADMIN_DISPUTED_REFERENCE_DOC, {
        token,
        variables: { filter: {} },
      });
      const reference = fingerprintOf(firstWireItem(referenceResult.error ?? undefined, "FORBIDDEN"));

      const deniedDirectory = await wireGraphQL(ADMIN_SESSIONS_DOC, {
        token,
        variables: { filter: {} },
      });
      expectDenialIdenticalToReference(deniedDirectory.error, "FORBIDDEN", reference, "adminSessions");

      const deniedDetail = await wireGraphQL(ADMIN_SESSION_DOC, {
        token,
        variables: { id: UNKNOWN_SESSION_ID },
      });
      expectDenialIdenticalToReference(deniedDetail.error, "FORBIDDEN", reference, "adminSession");
    }
  );

  test("non-admin denials append ZERO audit rows (scope gate precedes the resolver)", async () => {
    const auditBefore = await totalAuditAcrossFixtures();
    await Promise.all(
      NON_ADMIN_ROLES.map(role => {
        const token = roleTokens.get(role);
        if (!token) {
          throw new Error(`no token provisioned for role ${role}`);
        }
        return wireGraphQL(ADMIN_SESSIONS_DOC, { token, variables: { filter: {} } });
      })
    );
    expect(await totalAuditAcrossFixtures()).toBe(auditBefore);
    expect(auditBefore).toBe(0);
  });
});
