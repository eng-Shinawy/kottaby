/**
 * Query-count regression oracle — row 6.5 (REQ-008 AC-3).
 *
 * The N+1 oracle for the flat-projection GraphQL design: an in-process
 * execution of the paginated hot reads against the REAL schema + REAL
 * GraphQL context + REAL services + REAL PostgreSQL, with a pg-level query
 * spy counting every SQL statement per operation as the page size grows.
 * If any resolver ever fans out per-parent (the classic N+1), the statement
 * count grows with the page size and this suite fails — that failure is
 * the evidence that would justify a DataLoader retrofit (the plugin is
 * installed but intentionally NOT loaded, `backend/graphql/pothos/builder.ts`;
 * the retrofit is waived in the ledger — the flat design stays until THIS
 * oracle goes red).
 *
 * What it locks:
 *  - **Constant statement count per operation across page sizes** —
 *    `myNotifications(limit ∈ {5, 15, 25})` and
 *    `browseAvailableTeachers(pageSize ∈ {5, 15, 25})` each emit the same
 *    number of SQL statements at every size (page size changes the LIMIT
 *    parameter, never the statement count).
 *  - **Non-vacuous counting** — every measured window sees at least one
 *    statement (a flat 0 would make constancy trivially true).
 *  - **Operations genuinely succeed** at every size (data resolves, no
 *    GraphQL errors) — a failed operation cannot testify about counts.
 *
 * Fixture strategy: one committed student user (+ `students` child row, the
 * directory browse requires the student profile) and 25 committed inbox
 * rows, direct inserts — never the emit surface — torn down in `afterAll`
 * (rows → child row → user, FK order). The authenticated context is the
 * REAL `createGraphQLContext` over a signed access token — the same
 * verification path production traffic takes.
 *
 * Counting mechanism: `spyOn(pg.Client.prototype, "query")` — pg's `Pool`
 * borrows a `Client` per query and delegates to that client's `query`
 * method, so the prototype spy sees every pooled and transaction round
 * trip. The spy calls through (the default) and is restored in `afterAll`.
 *
 * Mandated runner: bun run test:graphql backend/graphql/test/query-count-regression.test.ts
 */

import { afterAll, beforeAll, describe, expect, spyOn, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { type ExecutionResult, graphql } from "graphql";
import { Client } from "pg";
import { db } from "@/backend/db";
import { notifications } from "@/backend/db/schema/notifications/notifications";
import { students } from "@/backend/db/schema/students/students";
import { users } from "@/backend/db/schema/users/users";
import { NotificationType } from "@/backend/enum/notifications/notification-type.enum";
import { UserRole } from "@/backend/enum/users/user-role.enum";
import { type Context, createGraphQLContext } from "@/backend/graphql/gqlContextFactory";
import { graphQLSchema } from "@/backend/graphql/gqlSchema";
import { signAccessToken } from "@/backend/lib/auth/jwt";
import { hashPassword } from "@/backend/lib/auth/password";

/** Page sizes the oracle sweeps — the statement count must not grow with them. */
const PAGE_SIZES: readonly number[] = [5, 15, 25];

/** Inbox rows seeded for the fixture student (≥ the largest page size). */
const SEEDED_INBOX_ROWS = 25;

const INBOX_DOCUMENT = `
  query QueryCountInbox($limit: Int) {
    myNotifications(filter: { limit: $limit, offset: 0 }) {
      totalCount
      hasMore
      items { id }
    }
  }
`;

const DIRECTORY_DOCUMENT = `
  query QueryCountDirectory($pageSize: Int) {
    browseAvailableTeachers(page: 1, pageSize: $pageSize) {
      total
      pageCount
    }
  }
`;

/** Fixture state threaded from `beforeAll` into the probes and teardown. */
interface FixtureState {
  readonly userId: number;
  readonly context: Context;
}

let fixture: FixtureState | null = null;
/** Type-only reference for the spy handle (the runtime install is in `beforeAll`). */
type QuerySpyHandle = ReturnType<typeof installQuerySpy>;

let querySpy: QuerySpyHandle | null = null;

/** Minimal structural view of pg's query-bearing prototype. */
interface PgQueryCarrier {
  query: (...args: never[]) => unknown;
}

/** Type guard recovering the query-bearing prototype without assertions. */
function isPgQueryCarrier(value: unknown): value is PgQueryCarrier {
  return typeof value === "object" && value !== null && "query" in value && typeof value.query === "function";
}

/** Installs the pg-level statement counter (calls through; restore in afterAll). */
function installQuerySpy() {
  const candidate: unknown = Client.prototype;
  if (!isPgQueryCarrier(candidate)) {
    throw new Error("pg Client.prototype.query is not spyable");
  }
  return spyOn(candidate, "query");
}

/** Seeds the committed student fixture (users + students + 25 inbox rows). */
async function seedFixture(): Promise<number> {
  const stamp = randomUUID().slice(0, 18);
  const inserted = await db
    .insert(users)
    .values({
      fullName: `Query Count Student ${stamp}`,
      email: `query-count-${stamp}@test.local`,
      phone: `+2010000${stamp.replace(/-/g, "").slice(0, 6)}`,
      passwordHash: await hashPassword(`query-count-${stamp}`),
      role: UserRole.Student,
      isDeleted: false,
      suspended: false,
      isBlocked: false,
      lastActiveAt: new Date(),
      country: "Egypt",
      countryCode: "EG",
    })
    .returning({ id: users.id });
  const user = inserted.at(0);
  if (user === undefined) {
    throw new Error("fixture users insert returned no rows");
  }
  await db.insert(students).values({
    id: user.id,
    handshakeCode: `QC${stamp.replace(/-/g, "").slice(0, 12)}`,
    balanceTrial: 0,
  });
  const now = Date.now();
  await db.insert(notifications).values(
    Array.from({ length: SEEDED_INBOX_ROWS }, (_, index) => ({
      userId: user.id,
      type: NotificationType.SessionCompletion,
      title: `Query count fixture row ${index}`,
      body: `Body ${index}`,
      isRead: index % 2 === 0,
      relatedEntityType: "session",
      relatedEntityId: 88_000 + index,
      createdAt: new Date(now - (SEEDED_INBOX_ROWS - index) * 60_000),
    }))
  );
  return user.id;
}

/** Executes one GraphQL operation in-process over the real schema + context. */
async function runOperation(source: string, variableValues: Record<string, number>): Promise<ExecutionResult> {
  if (fixture === null) {
    throw new Error("fixture not seeded");
  }
  return graphql({
    schema: graphQLSchema,
    source,
    variableValues,
    contextValue: fixture.context,
  });
}

/** Statement delta for one operation execution at one page size. */
async function measuredDelta(source: string, variables: Record<string, number>): Promise<number> {
  if (querySpy === null) {
    throw new Error("query spy not installed");
  }
  const before = querySpy.mock.calls.length;
  const result = await runOperation(source, variables);
  const after = querySpy.mock.calls.length;
  expect(result.errors ?? [], `${source} must execute without GraphQL errors`).toEqual([]);
  expect(result.data, `${source} must resolve data`).not.toBeNull();
  return after - before;
}

/**
 * Sweeps the page sizes SEQUENTIALLY (via async recursion — measured
 * windows must never interleave, so `Promise.all` would corrupt the
 * deltas; the recursion also keeps the lint rule's intent explicit).
 */
async function sweepPageSizes(source: string, key: "limit" | "pageSize"): Promise<number[]> {
  const deltas: number[] = [];
  const step = async (remaining: readonly number[]): Promise<void> => {
    const head = remaining.at(0);
    if (head === undefined) {
      return;
    }
    deltas.push(await measuredDelta(source, { [key]: head }));
    await step(remaining.slice(1));
  };
  await step(PAGE_SIZES);
  return deltas;
}

/** Constancy assertions over one operation's sweep (the N+1 oracle). */
function expectConstantDeltas(operation: string, deltas: readonly number[]): void {
  const [first] = deltas;
  expect(first, `${operation} as-found statement counts per page size: ${deltas.join(", ")}`).toBeGreaterThan(0);
  for (const delta of deltas) {
    expect(delta, `${operation} statement count grew with page size (deltas: ${deltas.join(", ")})`).toBe(first);
  }
}

describe("query-count regression oracle (N+1) — row 6.5", () => {
  beforeAll(async () => {
    const userId = await seedFixture();
    const token = await signAccessToken({ userId, role: UserRole.Student });
    const request = new Request("https://query-count.test/api/graphql", {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "accept-language": "en", cookie: "NEXT_LOCALE=en" },
    });
    const context = await createGraphQLContext(request);
    fixture = { userId, context };

    // Warm-up executions (one per operation) before counting: the real
    // context factory fires a throttled activity stamp at build time, and
    // per-actor caches (if any) settle on the first call — the measured
    // windows must contain ONLY the operation's own statements.
    const warmInbox = await runOperation(INBOX_DOCUMENT, { limit: 5 });
    expect(warmInbox.errors ?? []).toEqual([]);
    const warmDirectory = await runOperation(DIRECTORY_DOCUMENT, { pageSize: 5 });
    expect(warmDirectory.errors ?? []).toEqual([]);

    querySpy = installQuerySpy();
  }, 60_000);

  afterAll(async () => {
    querySpy?.mockRestore();
    const state = fixture;
    if (state !== null) {
      await db.delete(notifications).where(eq(notifications.userId, state.userId));
      await db.delete(students).where(eq(students.id, state.userId));
      await db.delete(users).where(eq(users.id, state.userId));
    }
  }, 60_000);

  test("myNotifications: constant SQL statements as the page size grows", async () => {
    const deltas = await sweepPageSizes(INBOX_DOCUMENT, "limit");
    expectConstantDeltas("myNotifications", deltas);
  });

  test("browseAvailableTeachers: constant SQL statements as the page size grows", async () => {
    const deltas = await sweepPageSizes(DIRECTORY_DOCUMENT, "pageSize");
    expectConstantDeltas("browseAvailableTeachers", deltas);
  });
});
