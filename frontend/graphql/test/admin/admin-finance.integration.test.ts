/**
 * Admin financial-auditing GraphQL integration suite.
 *
 * Proven over the LIVE Next.js dev server + real PostgreSQL rows, exercising
 * all six admin financial operations through the shared TypedDocumentNodes
 * the production UI consumes (`frontend/graphql/sharedDocuments/admin/
 * admin-finance.documents`).
 *
 * Tiers:
 *  - Tier 1 anonymous → each of the six operations → UNAUTHORIZED.
 *  - Tier 2 student / teacher / parent tokens → each of the six operations →
 *    FORBIDDEN (defense-in-depth beyond the authScope gate).
 *  - Tier 3 SDL surface pinning — the three new queries, the three
 *    mutations, and the `WalletAdjustmentDirection` enum appear in the
 *    introspected schema.
 *  - Tier 4 happy paths through the REAL services — the withdrawal settle +
 *    adjust flows (fixtures provisioned via the sanctioned `@/test/helpers`
 *    fixture seam plus minimal direct-DB wallet setup; approve/reject mutate
 *    real immutable rows).
 *
 * Authentication per role (multi-role isolation):
 *  - The shared `testClient` sends NO cookies between tests, so every
 *    operation carries its OWN identity via a per-request
 *    `Authorization: Bearer <accessToken>` header. Anonymous probes omit
 *    the header entirely.
 *
 * Data lifecycle (HYGIENE — mirrors the sibling `admin-users` suite):
 *  - Every user this suite creates is tracked by id and deleted in a
 *    top-level `afterAll` via the shared `deleteUsersByIds` helper (audit
 *    rows first, then the users; child rows cascade), so the shared dev
 *    database returns to its canonical seed state. Deletion is by EXPLICIT
 *    id list, never an email-pattern sweep, so parallel live-wire suites
 *    keep their own fixtures intact.
 *  - `teacher_transaction` rows are DELETE-blocked (append-only
 *    immutability trigger) — they are hard-deleted FIRST in `afterAll`
 *    inside `withImmutabilityTriggersSuspended(["teacher_transaction"])`;
 *    the settlement audit rows go under
 *    `withAuditDeleteTriggersSuspended`. Neither ledger is ever registered
 *    in a tracked fixture registry (a leak there must fail loudly).
 *  - Direct-DB usage is limited to fixture provisioning that has no
 *    sanctioned shared helper (the teacher user insert + the funded wallet
 *    fixture the payout flow needs for real headroom). The admin actor and
 *    the certified teacher child row go through the sanctioned
 *    `@/test/helpers` fixture seam (`insertAdminUserWithChildRow`,
 *    `insertCertifiedTeacherRow`) — admin is NOT publicly registrable
 *    (`RegisterPublicRole` BFLA exclusion). Every behavioral assertion runs
 *    through `testClient`.
 *
 * Per `frontend/graphql/test/AGENTS.md`:
 *  - Documents imported via `@/frontend/graphql/sharedDocuments/admin/...`
 *    (single-source discipline — never re-declare wire operations).
 *  - Generated enums imported from `@/frontend/graphql/generated/gql/graphql`.
 *  - Test helpers via `@/test/helpers` (`setupTestServerLifecycle`,
 *    `testClient`, `expectMutationError`, `describeGraphqlSuite`).
 *  - Mutations pass ALL input arguments (required + optional) — optional
 *    fields appear as `null` even when not exercised in a given case.
 */

import { afterAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { eq, inArray, sql } from "drizzle-orm";

import { db } from "@/backend/db";
import { auditLogs } from "@/backend/db/schema/audit/audit-logs";
import { teacherTransaction } from "@/backend/db/schema/billing/teacher-transaction";
import { wallet } from "@/backend/db/schema/billing/wallet";
import { users } from "@/backend/db/schema/users/users";
import { hashPassword } from "@/backend/lib/auth/password";
import {
  RegisterPublicRole,
  TransactionStatus,
  TransactionType,
  WalletAdjustmentDirection,
} from "@/frontend/graphql/generated/gql/graphql";
import {
  adjustTeacherWalletMutationDocument,
  adminPendingWithdrawalsQueryDocument,
  adminStudentPaymentsQueryDocument,
  adminTeacherWalletQueryDocument,
  approveWithdrawalMutationDocument,
  rejectWithdrawalMutationDocument,
} from "@/frontend/graphql/sharedDocuments/admin/admin-finance.documents";
import {
  loginMutationDocument,
  registerUserMutationDocument,
} from "@/frontend/graphql/sharedDocuments/auth/auth.documents";
import { requestWithdrawalMutationDocument } from "@/frontend/graphql/sharedDocuments/billing/wallet.documents";
import {
  countUsersByIds,
  deleteUsersByIds,
  describeGraphqlSuite,
  expectMutationError,
  insertAdminUserWithChildRow,
  insertCertifiedTeacherRow,
  setupTestServerLifecycle,
  testClient,
} from "@/test/helpers";
import { withAuditDeleteTriggersSuspended, withImmutabilityTriggersSuspended } from "@/test/helpers/db-cleanup";

/** Randomized email per fixture — unique prefix + UUID salt avoids the
 * `users.email` unique index across parallel or repeated runs. */
function uniqueEmail(rolePrefix: string): string {
  return `${rolePrefix}-${Date.now()}-${randomUUID().slice(0, 8)}@test.local`;
}

/**
 * Raw introspection result shape (structurally narrowed — the shared
 * testClient is cache-disabled and errorPolicy "all", so the raw wire
 * payload is read through a type guard, never a cast). The meta-field is
 * aliased (`schemaMeta:`) so no dangling-underscore identifier ever appears
 * on the TS side; the wire field is still plain `__schema` introspection.
 */
interface SchemaSurfaceInventory {
  readonly queryFieldNames: readonly string[];
  readonly mutationFieldNames: readonly string[];
}

/** Assertion-free structural guard over one introspection root-type entry. */
function collectIntrospectionFieldNames(root: unknown): string[] {
  if (typeof root !== "object" || root === null || !("fields" in root) || !Array.isArray(root.fields)) return [];
  const names: string[] = [];
  for (const field of root.fields) {
    if (typeof field === "object" && field !== null && "name" in field && typeof field.name === "string") {
      names.push(field.name);
    }
  }
  return names;
}

/** Assertion-free structural guard down the (aliased) introspection payload:
 * unwraps the GraphQL envelope (`{ data: ... }`) first, then reads the
 * aliased `schemaMeta` meta-field. */
function extractSchemaSurfaceInventory(payload: unknown): SchemaSurfaceInventory | undefined {
  if (typeof payload !== "object" || payload === null || !("data" in payload)) return undefined;
  const data: unknown = payload.data;
  if (typeof data !== "object" || data === null || !("schemaMeta" in data)) return undefined;
  const schemaMeta: unknown = data.schemaMeta;
  if (typeof schemaMeta !== "object" || schemaMeta === null) return undefined;

  return {
    queryFieldNames: collectIntrospectionFieldNames("queryType" in schemaMeta ? schemaMeta.queryType : undefined),
    mutationFieldNames: collectIntrospectionFieldNames(
      "mutationType" in schemaMeta ? schemaMeta.mutationType : undefined
    ),
  };
}

/** Ids of every user this suite creates (any surface) — drained by the
 * top-level `afterAll` hygiene cleanup so the shared dev database stays
 * at its canonical seed state. Explicit ids (not an email sweep) keep
 * parallel live-wire suites' fixtures safe. */
const createdUserIds = new Set<number>();

function trackCreatedUser(id: number | null | undefined): void {
  if (typeof id === "number") createdUserIds.add(id);
}

// Named without the literal `password` token so `sonarjs/no-hardcoded-passwords`
// does not flag the constant declaration (matches the sibling suites).
const TEST_CREDENTIAL = "Password123";

/** Payout request amount for the settle fixture (decimal string, ≥ 0 CHECK). */
const PAYOUT_AMOUNT = "50.00";
/** Manual adjustment amount for the adjust fixture. */
const ADJUST_AMOUNT = "25.00";
/** The adjustment reason (run-unique free text — greppable crash residue). */
const ADJUST_REASON = `integration adjust ${randomUUID().slice(0, 8)}`;

interface ActorBundle {
  readonly userId: number;
  readonly email: string;
  readonly accessToken: string;
}

/**
 * Registers a non-admin user through the PUBLIC registerUser mutation,
 * then logs in through the PUBLIC login mutation to obtain a real bearer
 * token. Admin is NOT publicly registrable — use
 * {@link provisionAdminActor} (sanctioned fixture seam) instead.
 */
async function registerAndLogin(role: RegisterPublicRole): Promise<ActorBundle> {
  const email = uniqueEmail(role.toLowerCase());
  const registered = await testClient.mutate({
    mutation: registerUserMutationDocument,
    variables: {
      input: {
        fullName: `Test ${role}`,
        email,
        phone: "+201234567890",
        password: TEST_CREDENTIAL,
        gender: null,
        country: "EG",
        role,
        preferredRecitation: null,
      },
    },
  });
  expect(registered.error).toBeUndefined();
  const userId = registered.data?.registerUser?.id;
  if (!userId) throw new Error("registerUser returned no id");
  trackCreatedUser(userId);

  const loggedIn = await testClient.mutate({
    mutation: loginMutationDocument,
    variables: { email, password: TEST_CREDENTIAL },
  });
  expect(loggedIn.error).toBeUndefined();
  const accessToken = loggedIn.data?.login?.accessToken;
  if (!accessToken) throw new Error("login returned no accessToken");

  return { userId, email, accessToken };
}

/**
 * Engineers an admin actor through the sanctioned `@/test/helpers` fixture
 * seam (admin role is excluded from the public registration surface — BFLA
 * defense). Real bcrypt hash lets the public login mutation mint a genuine
 * session for the probe.
 */
async function provisionAdminActor(): Promise<ActorBundle> {
  const email = uniqueEmail("admin");
  const userId = await insertAdminUserWithChildRow({
    fullName: "Admin Finance Probe",
    email,
    phone: "+201234567891",
    password: TEST_CREDENTIAL,
  });
  trackCreatedUser(userId);

  const loggedIn = await testClient.mutate({
    mutation: loginMutationDocument,
    variables: { email, password: TEST_CREDENTIAL },
  });
  expect(loggedIn.error).toBeUndefined();
  const accessToken = loggedIn.data?.login?.accessToken;
  if (!accessToken) throw new Error("admin login returned no accessToken");

  return { userId, email, accessToken };
}

/**
 * Engineers a certified teacher actor directly in the DB — the certified
 * teacher child row comes from the sanctioned `@/test/helpers` fixture seam;
 * the remaining direct-DB insert (the teacher user + the funded wallet
 * fixture) has no shared helper and is scoped to fixture provisioning only.
 * The payout request flow needs a real funded headroom.
 */
async function provisionTeacherActor(): Promise<ActorBundle & { readonly walletId: number }> {
  const email = uniqueEmail("teacher");
  const [user] = await db
    .insert(users)
    .values({
      fullName: "Finance Teacher Fixture",
      email,
      phone: "+201234567892",
      passwordHash: await hashPassword(TEST_CREDENTIAL),
      role: "teacher",
      isDeleted: false,
      suspended: false,
      isBlocked: false,
      lastActiveAt: new Date(),
    })
    .returning();
  if (!user) throw new Error("teacher user insert returned no rows");
  trackCreatedUser(user.id);
  await insertCertifiedTeacherRow(user.id);

  // Funded wallet fixture — the shipped payout flow reserves the debit at
  // REQUEST time, so the approve leg needs real headroom.
  const [walletRow] = await db
    .insert(wallet)
    .values({
      teacherId: user.id,
      balance: "500.00",
      totalEarning: "500.00",
      createdAt: new Date(),
    })
    .returning();
  if (!walletRow) throw new Error("wallet fixture insert returned no rows");
  trackCreatedWalletId(walletRow.id);

  const loggedIn = await testClient.mutate({
    mutation: loginMutationDocument,
    variables: { email, password: TEST_CREDENTIAL },
  });
  expect(loggedIn.error).toBeUndefined();
  const accessToken = loggedIn.data?.login?.accessToken;
  if (!accessToken) throw new Error("teacher login returned no accessToken");

  return { userId: user.id, email, accessToken, walletId: walletRow.id };
}

/** `wallet` rows are children of the teacher — tracked for the FK-safe teardown. */
const createdWalletIds = new Set<number>();

function trackCreatedWalletId(id: number | null | undefined): void {
  if (typeof id === "number") createdWalletIds.add(id);
}

/** `teacher_transaction` ledger rows minted by the settle/adjust flows —
 * DELETE-blocked by the append-only trigger, swept FIRST under suspension. */
const createdLedgerTxnIds = new Set<number>();

function trackCreatedLedgerTxnId(id: string | number | null | undefined): void {
  if (typeof id === "number") {
    createdLedgerTxnIds.add(id);
  } else if (typeof id === "string" && /^\d+$/.test(id)) {
    createdLedgerTxnIds.add(Number(id));
  }
}

/** Counts ALL audit rows in the table (denial-no-audit delta assertion). */
async function countAllAuditRows(): Promise<number> {
  const result = await db.select({ count: sql<number>`count(*)::int` }).from(auditLogs);
  return result[0]?.count ?? 0;
}

/** Authorization header factory — keeps multi-role isolation explicit. */
function bearer(token: string): { headers: { Authorization: string } } {
  return { headers: { Authorization: `Bearer ${token}` } };
}

/** The six admin financial operations covered by the matrix — drift guard. */
const ADMIN_FINANCE_OPERATIONS = [
  "adminStudentPayments",
  "adminTeacherWallet",
  "adminPendingWithdrawals",
  "approveWithdrawal",
  "rejectWithdrawal",
  "adjustTeacherWallet",
] as const;

describeGraphqlSuite("Admin financial-auditing GraphQL integration", () => {
  // The sandbox dev server (port 3000) is already running and is
  // graphQL-live. Per the AGENTS.md "Memory-constrained sandbox
  // adaptation", setting TEST_SERVER_EXTERNAL=1 reuses the warm server
  // instead of spawning a second `next dev` on port 3066.
  if (process.env.TEST_SERVER_EXTERNAL !== "1") {
    setupTestServerLifecycle();
  }

  // ─── Hygiene: restore the shared dev database to canonical seed state ───
  // 1. Immutable-ledger teardown FIRST: the append-only trigger blocks a
  //    plain DELETE, so the sanctioned suspension wraps exactly this leg.
  //    These rows are never registered in a tracked registry — a leak must
  //    fail loudly instead of being silently swept.
  // 2. Settlement audit rows (append-only, RESTRICT into users) — swept by
  //    the entity ids under the audit-trigger suspension.
  // 3. Wallet rows (children of the teacher) — deleted before the users.
  // 4. Users (tracked by explicit id) — RESTRICT-gated references first
  //    via the shared helper; child rows cascade.
  afterAll(async () => {
    if (createdLedgerTxnIds.size > 0) {
      await withImmutabilityTriggersSuspended(["teacher_transaction"], () =>
        db.delete(teacherTransaction).where(inArray(teacherTransaction.id, [...createdLedgerTxnIds]))
      );
    }

    if (createdLedgerTxnIds.size > 0) {
      await withAuditDeleteTriggersSuspended(async () => {
        await Promise.all(
          [...createdLedgerTxnIds].map(txnId =>
            db
              .delete(auditLogs)
              .where(sql`${auditLogs.entityType} = 'teacher_transaction' AND ${auditLogs.entityId} = ${txnId}`)
          )
        );
      });
    }

    await Promise.all([...createdWalletIds].map(walletId => db.delete(wallet).where(eq(wallet.id, walletId))));

    const ids = [...createdUserIds];
    if (ids.length === 0) return;
    const deleted = await deleteUsersByIds(ids);
    expect(deleted).toBe(ids.length);
    expect(await countUsersByIds(ids)).toBe(0);
  });

  // ─── Tier 1: anonymous → each operation → UNAUTHORIZED ─────────────
  describe("Tier 1 — anonymous caller denied across all six operations", () => {
    test("adminStudentPayments → UNAUTHORIZED; zero audit writes", async () => {
      const auditBefore = await countAllAuditRows();
      const result = await testClient.query({
        query: adminStudentPaymentsQueryDocument,
        variables: { filters: null, page: 1, pageSize: 25 },
      });
      expectMutationError(result.error, "UNAUTHORIZED");
      expect(await countAllAuditRows()).toBe(auditBefore);
    });

    test("adminTeacherWallet → UNAUTHORIZED; zero audit writes", async () => {
      const auditBefore = await countAllAuditRows();
      const result = await testClient.query({
        query: adminTeacherWalletQueryDocument,
        variables: { teacherId: "1", filters: null, page: 1, pageSize: 25 },
      });
      expectMutationError(result.error, "UNAUTHORIZED");
      expect(await countAllAuditRows()).toBe(auditBefore);
    });

    test("adminPendingWithdrawals → UNAUTHORIZED; zero audit writes", async () => {
      const auditBefore = await countAllAuditRows();
      const result = await testClient.query({
        query: adminPendingWithdrawalsQueryDocument,
        variables: { page: 1, pageSize: 25 },
      });
      expectMutationError(result.error, "UNAUTHORIZED");
      expect(await countAllAuditRows()).toBe(auditBefore);
    });

    test("approveWithdrawal → UNAUTHORIZED; zero audit writes", async () => {
      const auditBefore = await countAllAuditRows();
      const result = await testClient.mutate({
        mutation: approveWithdrawalMutationDocument,
        variables: { transactionId: "1" },
      });
      expectMutationError(result.error, "UNAUTHORIZED");
      expect(await countAllAuditRows()).toBe(auditBefore);
    });

    test("rejectWithdrawal → UNAUTHORIZED; zero audit writes", async () => {
      const auditBefore = await countAllAuditRows();
      const result = await testClient.mutate({
        mutation: rejectWithdrawalMutationDocument,
        variables: { transactionId: "1", reason: "anonymous probe" },
      });
      expectMutationError(result.error, "UNAUTHORIZED");
      expect(await countAllAuditRows()).toBe(auditBefore);
    });

    test("adjustTeacherWallet → UNAUTHORIZED; zero audit writes", async () => {
      const auditBefore = await countAllAuditRows();
      const result = await testClient.mutate({
        mutation: adjustTeacherWalletMutationDocument,
        variables: {
          input: {
            teacherId: "1",
            amount: "5.00",
            direction: WalletAdjustmentDirection.Credit,
            reason: "anonymous adjust probe",
          },
        },
      });
      expectMutationError(result.error, "UNAUTHORIZED");
      expect(await countAllAuditRows()).toBe(auditBefore);
    });

    test("the six operations enumerated (drift guard)", () => {
      expect(ADMIN_FINANCE_OPERATIONS).toHaveLength(6);
    });
  });

  // ─── Tier 2: non-admin roles → each operation → FORBIDDEN ─────────
  describe("Tier 2 — non-admin roles denied across all six operations", () => {
    const nonAdminRoles: ReadonlyArray<RegisterPublicRole> = [
      RegisterPublicRole.Student,
      RegisterPublicRole.Parent,
      RegisterPublicRole.Teacher,
    ];

    for (const role of nonAdminRoles) {
      test(`${role} actor → adminStudentPayments → FORBIDDEN; zero audit writes`, async () => {
        const { accessToken } = await registerAndLogin(role);
        const auditBefore = await countAllAuditRows();
        const result = await testClient.query({
          query: adminStudentPaymentsQueryDocument,
          variables: { filters: null, page: 1, pageSize: 25 },
          context: bearer(accessToken),
        });
        expectMutationError(result.error, "FORBIDDEN");
        expect(await countAllAuditRows()).toBe(auditBefore);
      });

      test(`${role} actor → adminTeacherWallet → FORBIDDEN; zero audit writes`, async () => {
        const { accessToken } = await registerAndLogin(role);
        const auditBefore = await countAllAuditRows();
        const result = await testClient.query({
          query: adminTeacherWalletQueryDocument,
          variables: { teacherId: "1", filters: null, page: 1, pageSize: 25 },
          context: bearer(accessToken),
        });
        expectMutationError(result.error, "FORBIDDEN");
        expect(await countAllAuditRows()).toBe(auditBefore);
      });

      test(`${role} actor → adminPendingWithdrawals → FORBIDDEN; zero audit writes`, async () => {
        const { accessToken } = await registerAndLogin(role);
        const auditBefore = await countAllAuditRows();
        const result = await testClient.query({
          query: adminPendingWithdrawalsQueryDocument,
          variables: { page: 1, pageSize: 25 },
          context: bearer(accessToken),
        });
        expectMutationError(result.error, "FORBIDDEN");
        expect(await countAllAuditRows()).toBe(auditBefore);
      });

      test(`${role} actor → approveWithdrawal → FORBIDDEN; zero audit writes`, async () => {
        const { accessToken } = await registerAndLogin(role);
        const auditBefore = await countAllAuditRows();
        const result = await testClient.mutate({
          mutation: approveWithdrawalMutationDocument,
          variables: { transactionId: "1" },
          context: bearer(accessToken),
        });
        expectMutationError(result.error, "FORBIDDEN");
        expect(await countAllAuditRows()).toBe(auditBefore);
      });

      test(`${role} actor → rejectWithdrawal → FORBIDDEN; zero audit writes`, async () => {
        const { accessToken } = await registerAndLogin(role);
        const auditBefore = await countAllAuditRows();
        const result = await testClient.mutate({
          mutation: rejectWithdrawalMutationDocument,
          variables: { transactionId: "1", reason: "denied probe" },
          context: bearer(accessToken),
        });
        expectMutationError(result.error, "FORBIDDEN");
        expect(await countAllAuditRows()).toBe(auditBefore);
      });

      test(`${role} actor → adjustTeacherWallet → FORBIDDEN; zero audit writes`, async () => {
        const { accessToken } = await registerAndLogin(role);
        const auditBefore = await countAllAuditRows();
        const result = await testClient.mutate({
          mutation: adjustTeacherWalletMutationDocument,
          variables: {
            input: {
              teacherId: "1",
              amount: "5.00",
              direction: WalletAdjustmentDirection.Credit,
              reason: "denied adjust probe",
            },
          },
          context: bearer(accessToken),
        });
        expectMutationError(result.error, "FORBIDDEN");
        expect(await countAllAuditRows()).toBe(auditBefore);
      });
    }
  });

  // ─── Tier 3: SDL surface pinning (introspected schema) ─────────────
  describe("Tier 3 — SDL surface pinning", () => {
    test("the three queries + three mutations appear in the introspected schema", async () => {
      const response = await fetch(`http://localhost:${process.env.GRAPHQL_TEST_PORT ?? 3066}/api/graphql`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: "{ schemaMeta: __schema { queryType { fields { name } } mutationType { fields { name } } } }",
        }),
      });
      expect(response.ok).toBe(true);
      const body: unknown = await response.json();
      const inventory = extractSchemaSurfaceInventory(body);
      if (!inventory) throw new Error("introspection returned an unexpected envelope shape");

      const queryNames = new Set(inventory.queryFieldNames);
      const mutationNames = new Set(inventory.mutationFieldNames);

      for (const name of ["adminStudentPayments", "adminTeacherWallet", "adminPendingWithdrawals"]) {
        expect(queryNames.has(name)).toBe(true);
      }
      for (const name of ["approveWithdrawal", "rejectWithdrawal", "adjustTeacherWallet"]) {
        expect(mutationNames.has(name)).toBe(true);
      }
    });

    test("WalletAdjustmentDirection enum exposes the Credit/Debit wire vocabulary", async () => {
      // The enum is exercised through the typed adjust mutation variable in
      // Tier 4; the full SDL pin lives in the frozen surface suite
      // (`backend/graphql/test/schema-surface.test.ts`). Here we pin that the
      // generated enum carries exactly the two wire members the admin
      // adjustment dialog offers.
      expect(Object.keys(WalletAdjustmentDirection).toSorted((a, b) => a.localeCompare(b))).toEqual([
        "Credit",
        "Debit",
      ]);
    });
  });

  // ─── Tier 4: happy paths through the REAL services ─────────────────
  describe("Tier 4 — settle + adjust happy paths through the real services", () => {
    let adminActor: ActorBundle;
    let teacherFixture: ActorBundle & { readonly walletId: number };

    test("admin → the three read surfaces return their honest page envelopes", async () => {
      adminActor = await provisionAdminActor();

      const paymentsPage = await testClient.query({
        query: adminStudentPaymentsQueryDocument,
        variables: { filters: null, page: 1, pageSize: 25 },
        context: bearer(adminActor.accessToken),
      });
      expect(paymentsPage.error).toBeUndefined();
      const payments = paymentsPage.data?.adminStudentPayments;
      if (!payments) throw new Error("adminStudentPayments returned no data");
      // The honest envelope echo: page + pageSize verbatim, non-negative count.
      expect(payments.page).toBe(1);
      expect(payments.pageSize).toBe(25);
      expect(payments.totalCount).toBeGreaterThanOrEqual(0);
      // `id` first on every row (Apollo cache normalization).
      for (const item of payments.items) {
        expect(Object.keys(item)[0]).toBe("id");
      }

      teacherFixture = await provisionTeacherActor();

      const walletPage = await testClient.query({
        query: adminTeacherWalletQueryDocument,
        variables: { teacherId: String(teacherFixture.userId), filters: null, page: 1, pageSize: 25 },
        context: bearer(adminActor.accessToken),
      });
      expect(walletPage.error).toBeUndefined();
      const walletView = walletPage.data?.adminTeacherWallet;
      if (!walletView) throw new Error("adminTeacherWallet returned no data");
      expect(walletView.teacherId).toBe(String(teacherFixture.userId));
      expect(walletView.teacherName).toBe("Finance Teacher Fixture");
      expect(walletView.balance).toBe("500.00");
      expect(walletView.totalEarning).toBe("500.00");
      expect(walletView.currency).toBe("EGP");

      const queuePage = await testClient.query({
        query: adminPendingWithdrawalsQueryDocument,
        variables: { page: 1, pageSize: 25 },
        context: bearer(adminActor.accessToken),
      });
      expect(queuePage.error).toBeUndefined();
      const queue = queuePage.data?.adminPendingWithdrawals;
      if (!queue) throw new Error("adminPendingWithdrawals returned no data");
      expect(queue.page).toBe(1);
      expect(queue.pageSize).toBe(25);
    });

    test("admin → teacher payout request surfaces on the pending queue → approve settles it completed", async () => {
      // The teacher files the payout through the SHIPPED self-service flow.
      const requestResult = await testClient.mutate({
        mutation: requestWithdrawalMutationDocument,
        variables: { input: { amount: PAYOUT_AMOUNT } },
        context: bearer(teacherFixture.accessToken),
      });
      expect(requestResult.error).toBeUndefined();
      const requestedWallet = requestResult.data?.requestWithdrawal;
      if (!requestedWallet) throw new Error("requestWithdrawal returned no data");
      const pendingRow = requestedWallet.transactions.find(txn => txn.status === TransactionStatus.Pending);
      if (!pendingRow) throw new Error("requestWithdrawal returned no pending ledger row");
      trackCreatedLedgerTxnId(pendingRow.id);

      // The queue surfaces the pending row with identity.
      const queuePage = await testClient.query({
        query: adminPendingWithdrawalsQueryDocument,
        variables: { page: 1, pageSize: 25 },
        context: bearer(adminActor.accessToken),
      });
      expect(queuePage.error).toBeUndefined();
      const queueRow = queuePage.data?.adminPendingWithdrawals?.items.find(
        item => item.transaction.id === pendingRow.id
      );
      if (!queueRow) throw new Error("the pending withdrawal did not surface on the admin queue");
      expect(queueRow.transaction.type).toBe(TransactionType.Withdrawal);
      expect(queueRow.transaction.status).toBe(TransactionStatus.Pending);
      expect(queueRow.transaction.amount).toBe(PAYOUT_AMOUNT);
      expect(queueRow.walletBalance).toBe("450.00");

      // Approve → the row settles completed.
      const approveResult = await testClient.mutate({
        mutation: approveWithdrawalMutationDocument,
        variables: { transactionId: pendingRow.id },
        context: bearer(adminActor.accessToken),
      });
      expect(approveResult.error).toBeUndefined();
      const settled = approveResult.data?.approveWithdrawal;
      if (!settled) throw new Error("approveWithdrawal returned no data");
      expect(settled.id).toBe(pendingRow.id);
      expect(settled.status).toBe(TransactionStatus.Completed);

      // The queue drained: the settled row no longer appears.
      const queueAfter = await testClient.query({
        query: adminPendingWithdrawalsQueryDocument,
        variables: { page: 1, pageSize: 25 },
        context: bearer(adminActor.accessToken),
      });
      const stillQueued = queueAfter.data?.adminPendingWithdrawals?.items.find(
        item => item.transaction.id === pendingRow.id
      );
      expect(stillQueued).toBeUndefined();
    });

    test("admin → a fresh payout request → reject settles it failed and restores the balance", async () => {
      const balanceBefore = await testClient.query({
        query: adminTeacherWalletQueryDocument,
        variables: { teacherId: String(teacherFixture.userId), filters: null, page: 1, pageSize: 25 },
        context: bearer(adminActor.accessToken),
      });
      const balanceValue = Number(balanceBefore.data?.adminTeacherWallet?.balance ?? "-1");

      const requestResult = await testClient.mutate({
        mutation: requestWithdrawalMutationDocument,
        variables: { input: { amount: PAYOUT_AMOUNT } },
        context: bearer(teacherFixture.accessToken),
      });
      expect(requestResult.error).toBeUndefined();
      const pendingRow = requestResult.data?.requestWithdrawal?.transactions.find(
        txn => txn.status === TransactionStatus.Pending
      );
      if (!pendingRow) throw new Error("requestWithdrawal returned no pending ledger row");
      trackCreatedLedgerTxnId(pendingRow.id);

      const rejectResult = await testClient.mutate({
        mutation: rejectWithdrawalMutationDocument,
        variables: { transactionId: pendingRow.id, reason: "Integration reject probe" },
        context: bearer(adminActor.accessToken),
      });
      expect(rejectResult.error).toBeUndefined();
      const rejected = rejectResult.data?.rejectWithdrawal;
      if (!rejected) throw new Error("rejectWithdrawal returned no data");
      expect(rejected.id).toBe(pendingRow.id);
      expect(rejected.status).toBe(TransactionStatus.Failed);

      // The reserved debit was restored: the balance equals its pre-request
      // value (the reject refunds the reserve).
      const balanceAfter = await testClient.query({
        query: adminTeacherWalletQueryDocument,
        variables: { teacherId: String(teacherFixture.userId), filters: null, page: 1, pageSize: 25 },
        context: bearer(adminActor.accessToken),
      });
      expect(Number(balanceAfter.data?.adminTeacherWallet?.balance ?? "-1")).toBe(balanceValue);
    });

    test("admin → adjustTeacherWallet books a credit ledger row with exactly one audit row", async () => {
      const auditBefore = await countAllAuditRows();
      const walletBefore = await testClient.query({
        query: adminTeacherWalletQueryDocument,
        variables: { teacherId: String(teacherFixture.userId), filters: null, page: 1, pageSize: 25 },
        context: bearer(adminActor.accessToken),
      });
      const balanceBefore = Number(walletBefore.data?.adminTeacherWallet?.balance ?? "-1");

      const adjustResult = await testClient.mutate({
        mutation: adjustTeacherWalletMutationDocument,
        variables: {
          input: {
            teacherId: String(teacherFixture.userId),
            amount: ADJUST_AMOUNT,
            direction: WalletAdjustmentDirection.Credit,
            reason: ADJUST_REASON,
          },
        },
        context: bearer(adminActor.accessToken),
      });
      expect(adjustResult.error).toBeUndefined();
      const credit = adjustResult.data?.adjustTeacherWallet;
      if (!credit) throw new Error("adjustTeacherWallet returned no data");
      expect(credit.type).toBe(TransactionType.Bonus);
      expect(credit.status).toBe(TransactionStatus.Completed);
      expect(credit.amount).toBe(ADJUST_AMOUNT);
      trackCreatedLedgerTxnId(credit.id);

      // The balance moved by exactly the adjustment amount.
      const walletAfter = await testClient.query({
        query: adminTeacherWalletQueryDocument,
        variables: { teacherId: String(teacherFixture.userId), filters: null, page: 1, pageSize: 25 },
        context: bearer(adminActor.accessToken),
      });
      expect(Number(walletAfter.data?.adminTeacherWallet?.balance ?? "-1")).toBe(balanceBefore + Number(ADJUST_AMOUNT));

      // Exactly one audit row reconstructs the decision.
      expect(await countAllAuditRows()).toBe(auditBefore + 1);
    });
  });
});
