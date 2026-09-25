/**
 * Admin academic-tracking GraphQL permission-matrix integration suite.
 *
 * Proven over the LIVE Next.js dev server + real PostgreSQL rows,
 * exercising the two admin academic read surfaces through the shared
 * TypedDocumentNodes the production UI consumes
 * (`frontend/graphql/sharedDocuments/admin/academic-tracking.documents`).
 *
 * The full permission matrix — BOTH queries × every caller class:
 *  - anonymous → 401 `UNAUTHORIZED` at the scope gate (pre-resolver),
 *    zero data;
 *  - teacher / student / parent → 403 `FORBIDDEN` with ONE constant
 *    byte-identical denial for every id cause (existing id, foreign
 *    non-student id, nonexistent id, zero id, negative id) in BOTH
 *    locales — the constant-denial oracle. Because the denial never
 *    varies with the probed id, the wire offers non-admins no
 *    existence oracle, and the two fields stay BFLA-sealed behind the
 *    admin role scope;
 *  - admin → 200: the paged directory + stats block on the dashboard,
 *    the full composite detail on the drill-down; a nonexistent or
 *    non-student `studentId` → localized `STUDENT_NOT_FOUND` (reachable
 *    by admins only); a malformed `studentId` or out-of-bounds
 *    pagination → `VALIDATION` from the pre-read gates (the VALIDATION
 *    code itself proves the rejection precedes any data lookup — a
 *    post-read order could only ever classify a non-positive id as
 *    not-found, since no user row with id ≤ 0 exists);
 *  - an out-of-range-but-valid page → empty `items` next to the honest
 *    `total` (never clamped, never an error);
 *  - `search` LIKE-metacharacter probes (`%`, `_`, `\`) → escaped,
 *    honest result sets (wildcards can never widen the match);
 *  - responses are strictly READ-ONLY shaped: both fields live on
 *    Query and never on Mutation, reads emit zero audit rows, and
 *    success payloads carry no credential material.
 *
 * Tiers:
 *  - Tier 1 — every matrix cell: anonymous / teacher / student / parent
 *    / admin across both queries, with the byte-identity oracle sweep
 *    and the admin honest-envelope cells.
 *  - Tier 2 — boundary combos: locale × id-cause on the denial oracle,
 *    pageSize 1 / 100 / 101, page 0 / negative, Int-coercion literals.
 *  - Tier 3 — parallel probe bursts (`Promise.allSettled`): concurrent
 *    denials collapse into one constant shape; concurrent admin reads
 *    return one consistent snapshot total.
 *  - Tier 4 — forged credentials (bogus signature, forged Admin role
 *    claim, malformed Authorization headers) and the wildcard-injection
 *    probes.
 *
 * Authentication per role (multi-role isolation):
 *  - The shared `testClient` sends NO cookies between tests, so every
 *    operation carries its OWN identity via a per-request
 *    `Authorization: Bearer <accessToken>` header. Anonymous probes
 *    omit the header entirely.
 *
 * Locale channel:
 *  - The `Accept-Language` header negotiates the request locale (the
 *    context factory's cookie → header → default chain); expected
 *    denial copy resolves through the locale keys — never hardcoded
 *    strings.
 *
 * Data lifecycle (HYGIENE — mirrors the sibling `admin-users` suite):
 *  - Every user this suite creates is tracked by id and deleted in a
 *    top-level `afterAll` via the shared `deleteUsersByIds` helper
 *    (RESTRICT-gated references first, then the users; child rows
 *    cascade), so the shared dev database returns to its canonical
 *    seed state. Deletion is by EXPLICIT id list, never an email
 *    sweep, so parallel live-wire suites keep their own fixtures
 *    intact.
 *  - Direct-DB usage is limited to the audit-census read (the
 *    reads-never-audit delta proof); actors ride the PUBLIC
 *    registerUser + login mutations, and the admin rides the
 *    sanctioned `@/test/helpers` fixture seam (`insertAdminUserWithChildRow`
 *    — admin is NOT publicly registrable, the registration BFLA
 *    exclusion).
 *
 * Per `frontend/graphql/test/AGENTS.md`:
 *  - Documents imported via `@/frontend/graphql/sharedDocuments/admin/...`
 *    (single-source discipline — never re-declare wire operations).
 *  - Generated enums imported from `@/frontend/graphql/generated/gql/graphql`.
 *  - Test helpers via `@/test/helpers` (`setupTestServerLifecycle`,
 *    `testClient`, `expectMutationError`, `extractErrorCode`).
 *  - The canonical failure-side assertion helper (`expectMutationError`)
 *    is code-agnostic: it accepts the `result.error` of queries and
 *    mutations alike.
 *  - The ONE raw-transport exception is the introspection meta-field
 *    probe (no domain operation exists for it — the sibling suites'
 *    precedent), read through structural guards, never casts.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { ApolloClient, type CombinedGraphQLErrors, HttpLink, InMemoryCache } from "@apollo/client";
import { sql } from "drizzle-orm";
import { db } from "@/backend/db";
import { auditLogs } from "@/backend/db/schema/audit/audit-logs";
import { RegisterPublicRole } from "@/frontend/graphql/generated/gql/graphql";
import {
  adminAcademicDashboardQueryDocument,
  adminStudentAcademicDetailQueryDocument,
} from "@/frontend/graphql/sharedDocuments/admin/academic-tracking.documents";
import {
  loginMutationDocument,
  registerUserMutationDocument,
} from "@/frontend/graphql/sharedDocuments/auth/auth.documents";
import { getServerTranslations } from "@/shared/locale/server-graphql";
import {
  countUsersByIds,
  deleteUsersByIds,
  describeGraphqlSuite,
  expectMutationError,
  extractErrorCode,
  insertAdminUserWithChildRow,
  setupTestServerLifecycle,
  TEST_PORT,
  testClient,
} from "@/test/helpers";

// ─── Locale-key expected copy (never hardcoded strings) ──────────────────────

const LOCALES = ["en", "ar"] as const;
type Locale = (typeof LOCALES)[number];

/**
 * The suite's wire client. Identical transport configuration to the shared
 * `testClient`, with in-flight query deduplication DISABLED: locale-
 * differentiated probes share one document + variable set and differ only in
 * per-request context headers, and deduplication (keyed on document +
 * variables alone) would collapse concurrent probes into a single network
 * request — echoing the first caller's locale-specific response to every
 * concurrent caller and silently defeating the denial-oracle assertions.
 */
const probingClient = new ApolloClient({
  link: new HttpLink({
    uri: `http://localhost:${TEST_PORT}/api/graphql`,
    credentials: "include",
  }),
  cache: new InMemoryCache(),
  queryDeduplication: false,
  defaultOptions: {
    query: { errorPolicy: "all", fetchPolicy: "no-cache" },
    mutate: { errorPolicy: "all", fetchPolicy: "no-cache" },
    watchQuery: { errorPolicy: "all", fetchPolicy: "no-cache" },
  },
});

const ERRORS_BY_LOCALE = {
  en: getServerTranslations("en").errorsTranslations,
  ar: getServerTranslations("ar").errorsTranslations,
};

// ─── Suite constants ─────────────────────────────────────────────────────────

/** Randomized email per fixture — unique prefix + UUID salt avoids the
 * `users.email` unique index across parallel or repeated runs. */
function uniqueEmail(rolePrefix: string): string {
  return `${rolePrefix}-${Date.now()}-${randomUUID().slice(0, 8)}@test.local`;
}

/** Run-unique token embedded in fixture identities so search probes key
 * off values no other row can carry. */
const RUN_TOKEN = randomUUID().slice(0, 8);

/** A well-formed but unresolvable student id (no sequence reaches here). */
const NONEXISTENT_STUDENT_ID = 99_999_999;

// Named without the literal `password` token so `sonarjs/no-hardcoded-passwords`
// does not flag the constant declaration (matches the sibling suites).
const TEST_CREDENTIAL = "Password123";

/** The two admin academic read operations covered by the matrix — drift guard. */
const ACADEMIC_OPERATIONS = ["adminAcademicDashboard", "adminStudentAcademicDetail"] as const;

/** Ids of every user this suite creates (any surface) — drained by the
 * top-level `afterAll` hygiene cleanup so the shared dev database stays
 * at its canonical seed state. */
const createdUserIds = new Set<number>();

function trackCreatedUser(id: number | null | undefined): void {
  if (typeof id === "number") createdUserIds.add(id);
}

interface ActorBundle {
  readonly userId: number;
  readonly email: string;
  readonly fullName: string;
  readonly accessToken: string;
}

/**
 * The full actor cast: the admin reader plus one actor per non-admin
 * caller class, plus the two wildcard-search fixture students (one whose
 * email carries a literal underscore, one control with a wildcard-free
 * lookalike). All ride real registration/login or the sanctioned admin
 * fixture seam — authorization is never monkey-patched.
 */
interface SuiteCast {
  readonly admin: ActorBundle;
  readonly teacher: ActorBundle;
  readonly student: ActorBundle;
  readonly parent: ActorBundle;
  readonly underscoreStudent: ActorBundle;
  readonly controlStudent: ActorBundle;
}

let cast: SuiteCast | null = null;

function requireCast(): SuiteCast {
  if (cast === null) {
    throw new Error("suite cast not provisioned (beforeAll did not run)");
  }
  return cast;
}

async function loginAccessToken(email: string): Promise<string> {
  const loggedIn = await testClient.mutate({
    mutation: loginMutationDocument,
    variables: { email, password: TEST_CREDENTIAL },
  });
  expect(loggedIn.error).toBeUndefined();
  const accessToken = loggedIn.data?.login?.accessToken;
  if (!accessToken) throw new Error("login returned no accessToken");
  return accessToken;
}

/**
 * Registers any role through the PUBLIC registerUser mutation, then logs
 * in through the PUBLIC login mutation to obtain a real bearer token.
 * Admin is NOT publicly registrable — use the sanctioned fixture seam
 * below instead.
 */
async function registerActor(role: RegisterPublicRole, email: string, fullName: string): Promise<ActorBundle> {
  const registered = await testClient.mutate({
    mutation: registerUserMutationDocument,
    variables: {
      input: {
        fullName,
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
  return { userId, email, fullName, accessToken: await loginAccessToken(email) };
}

/**
 * Engineers the admin actor through the sanctioned `@/test/helpers`
 * fixture seam (admin role is excluded from the public registration
 * surface — the registration BFLA defense). A real bcrypt hash lets the
 * public login mutation mint a genuine session for the probe.
 */
async function provisionAdminActor(): Promise<ActorBundle> {
  const email = uniqueEmail("admin");
  const fullName = "Admin Academic Matrix Probe";
  const userId = await insertAdminUserWithChildRow({
    fullName,
    email,
    phone: "+201234567891",
    password: TEST_CREDENTIAL,
  });
  trackCreatedUser(userId);
  return { userId, email, fullName, accessToken: await loginAccessToken(email) };
}

// ─── Per-request context factories (multi-role + locale isolation) ──────────

function requestContext(accessToken: string | null, locale: Locale): { headers: Record<string, string> } {
  const headers: Record<string, string> = { "Accept-Language": locale };
  if (accessToken !== null) {
    headers.Authorization = `Bearer ${accessToken}`;
  }
  return { headers };
}

// ─── Document executors (the only two wire entry points) ────────────────────

type DashboardVariables = { page: number | null; pageSize: number | null; search: string | null };

async function runDashboard(accessToken: string | null, locale: Locale, variables: DashboardVariables) {
  return probingClient.query({
    query: adminAcademicDashboardQueryDocument,
    variables,
    context: requestContext(accessToken, locale),
  });
}

type DetailVariables = { studentId: number; page: number | null; pageSize: number | null };

async function runDetail(accessToken: string | null, locale: Locale, variables: DetailVariables) {
  return probingClient.query({
    query: adminStudentAcademicDetailQueryDocument,
    variables,
    context: requestContext(accessToken, locale),
  });
}

// ─── Denial-oracle plumbing ─────────────────────────────────────────────────

/** The normalized shape of one wire denial: transport code + first message. */
interface DenialProbeResult {
  readonly code: string;
  readonly message: string;
}

/** Reads code + first message off an Apollo error container (no casts). */
function denialProbeOf(error: unknown): DenialProbeResult {
  const combined: CombinedGraphQLErrors = expectMutationError(error);
  const message = combined.errors[0]?.message;
  if (typeof message !== "string") {
    throw new Error("denial carried no message");
  }
  const code = extractErrorCode(combined);
  if (code === undefined) {
    throw new Error("denial carried no extensions.code");
  }
  return { code, message };
}

/** Anonymous / non-admin dashboard probe: asserts zero data, returns the oracle. */
async function dashboardDenial(accessToken: string | null, locale: Locale): Promise<DenialProbeResult> {
  const result = await runDashboard(accessToken, locale, { page: 1, pageSize: 25, search: null });
  expect(result.data?.adminAcademicDashboard ?? null).toBeNull();
  return denialProbeOf(result.error);
}

/** Anonymous / non-admin drill-down probe: asserts zero data, returns the oracle. */
async function detailDenial(accessToken: string | null, locale: Locale, studentId: number): Promise<DenialProbeResult> {
  const result = await runDetail(accessToken, locale, { studentId, page: 1, pageSize: 25 });
  expect(result.data?.adminStudentAcademicDetail ?? null).toBeNull();
  return denialProbeOf(result.error);
}

/** The drill-down id causes the constant-denial oracle must collapse. */
const DRILL_DOWN_CAUSES: ReadonlyArray<{
  readonly label: string;
  readonly studentIdOf: (actors: SuiteCast) => number;
}> = [
  { label: "existing student id", studentIdOf: actors => actors.student.userId },
  { label: "foreign non-student id", studentIdOf: actors => actors.teacher.userId },
  { label: "nonexistent id", studentIdOf: () => NONEXISTENT_STUDENT_ID },
  { label: "zero id", studentIdOf: () => 0 },
  { label: "negative id", studentIdOf: () => -7 },
];

/** Counts ALL audit rows in the table (reads-never-audit delta assertion). */
async function countAllAuditRows(): Promise<number> {
  const result = await db.select({ count: sql<number>`count(*)::int` }).from(auditLogs);
  return result[0]?.count ?? 0;
}

/**
 * Deep key-walk for credential material — rejects the leak regardless of
 * nesting depth. Apollo-normalized payloads also include `__typename`
 * entries, which are walked past (not leaked data). Strings are never
 * traversed (only objects + arrays). Exhaustive `Object.entries`
 * traversal — no unsafe assertions.
 */
function deepFindKey(node: unknown, target: string): boolean {
  if (typeof node !== "object" || node === null) return false;
  if (Array.isArray(node)) {
    for (const item of node) {
      if (deepFindKey(item, target)) return true;
    }
    return false;
  }
  for (const [key, value] of Object.entries(node)) {
    if (key === target) return true;
    if (deepFindKey(value, target)) return true;
  }
  return false;
}

// ─── Introspection surface inventory (the one raw-transport exception) ──────

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

/**
 * Introspects the LIVE server's root-type field inventories through
 * structural guards (never casts). Domain operations must always ride
 * `testClient` + shared documents; the introspection meta-field has no
 * domain document, which is why the sibling suites open this one raw
 * transport window.
 */
async function introspectSchemaSurface(): Promise<SchemaSurfaceInventory> {
  const response = await fetch(`http://localhost:${TEST_PORT}/api/graphql`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      query: "{ schemaMeta: __schema { queryType { fields { name } } mutationType { fields { name } } } }",
    }),
  });
  expect(response.ok).toBe(true);
  const body: unknown = await response.json();
  if (typeof body !== "object" || body === null || !("data" in body)) {
    throw new Error("introspection returned an unexpected envelope shape");
  }
  const data: unknown = body.data;
  if (typeof data !== "object" || data === null || !("schemaMeta" in data)) {
    throw new Error("introspection returned no schema meta payload");
  }
  // The meta-field is aliased (`schemaMeta:`) in the probe document so no
  // dangling-underscore identifier ever appears on the TS side; the wire
  // field is still plain introspection.
  const schema: unknown = data.schemaMeta;
  if (typeof schema !== "object" || schema === null) {
    throw new Error("introspection schema meta payload is not a record");
  }
  return {
    queryFieldNames: collectIntrospectionFieldNames("queryType" in schema ? schema.queryType : undefined),
    mutationFieldNames: collectIntrospectionFieldNames("mutationType" in schema ? schema.mutationType : undefined),
  };
}

/** Builds a syntactically-valid JWT whose signature the server never
 * signed — the forged-role probe asserts signature verification (not the
 * claim payload) is the trust boundary. */
function forgedAdminBearerToken(): string {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(
    JSON.stringify({ sub: String(NONEXISTENT_STUDENT_ID), role: "Admin", exp: Math.floor(Date.now() / 1000) + 3600 })
  ).toString("base64url");
  return `${header}.${payload}.forged-signature-never-signed-by-the-server`;
}

// ─── Suite ───────────────────────────────────────────────────────────────────

describeGraphqlSuite("Admin academic-tracking GraphQL permission matrix", () => {
  // The sandbox dev server may already be graphQL-live on the test port;
  // the lifecycle helper reuses a warm server and otherwise spawns one.
  if (process.env.TEST_SERVER_EXTERNAL !== "1") {
    setupTestServerLifecycle();
  }

  beforeAll(async () => {
    const admin = await provisionAdminActor();
    const teacher = await registerActor(
      RegisterPublicRole.Teacher,
      uniqueEmail("teacher"),
      `Matrix Teacher ${RUN_TOKEN}`
    );
    const student = await registerActor(
      RegisterPublicRole.Student,
      uniqueEmail("student"),
      `Matrix Student ${RUN_TOKEN}`
    );
    const parent = await registerActor(RegisterPublicRole.Parent, uniqueEmail("parent"), `Matrix Parent ${RUN_TOKEN}`);
    // The wildcard-search fixture pair: a literal underscore vs a
    // wildcard-free lookalike. Their EMAILS carry the discriminator (the
    // search matches name OR email); the names stay wildcard-free so the
    // probes key on the emails alone.
    const underscoreStudent = await registerActor(
      RegisterPublicRole.Student,
      `wild_card-${RUN_TOKEN}@test.local`,
      `Wild Probe Underscore ${RUN_TOKEN}`
    );
    const controlStudent = await registerActor(
      RegisterPublicRole.Student,
      `wildxcard-${RUN_TOKEN}@test.local`,
      `Wild Probe Control ${RUN_TOKEN}`
    );
    cast = { admin, teacher, student, parent, underscoreStudent, controlStudent };
  });

  // ─── Hygiene: restore the shared dev database to canonical seed state ───
  afterAll(async () => {
    const ids = [...createdUserIds];
    if (ids.length === 0) return;
    const deleted = await deleteUsersByIds(ids);
    expect(deleted).toBe(ids.length);
    expect(await countUsersByIds(ids)).toBe(0);
  });

  // ─── Tier 1: anonymous caller → 401 UNAUTHORIZED, pre-resolver ─────
  describe("Tier 1 — anonymous caller denied on both queries", () => {
    for (const locale of LOCALES) {
      test(`anonymous @ ${locale} → UNAUTHORIZED on both queries, zero data, zero audit writes`, async () => {
        const auditBefore = await countAllAuditRows();
        const dashboard = await dashboardDenial(null, locale);
        expect(dashboard.code).toBe("UNAUTHORIZED");
        expect(dashboard.message).toContain(ERRORS_BY_LOCALE[locale].unauthorized);
        const detail = await detailDenial(null, locale, NONEXISTENT_STUDENT_ID);
        expect(detail.code).toBe("UNAUTHORIZED");
        expect(detail.message).toContain(ERRORS_BY_LOCALE[locale].unauthorized);
        expect(await countAllAuditRows()).toBe(auditBefore);
      });
    }

    test("the two read operations enumerated (drift guard)", () => {
      expect(ACADEMIC_OPERATIONS).toHaveLength(2);
    });
  });

  // ─── Tier 1 + 2: non-admin caller classes — the constant-denial oracle ──
  describe("Tier 1/2 — non-admin caller classes collapse into ONE constant FORBIDDEN", () => {
    const nonAdminRoles = ["teacher", "student", "parent"] as const;

    for (const role of nonAdminRoles) {
      for (const locale of LOCALES) {
        test(`${role} @ ${locale} → dashboard + EVERY drill-down id cause → byte-identical FORBIDDEN`, async () => {
          const actors = requireCast();
          const actor = actors[role];
          const auditBefore = await countAllAuditRows();

          const messages: string[] = [];
          const dashboard = await dashboardDenial(actor.accessToken, locale);
          expect(dashboard.code).toBe("FORBIDDEN");
          expect(dashboard.message).toContain(ERRORS_BY_LOCALE[locale].forbidden);
          messages.push(dashboard.message);

          const probes = await Promise.all(
            DRILL_DOWN_CAUSES.map(cause => detailDenial(actor.accessToken, locale, cause.studentIdOf(actors)))
          );
          for (const probe of probes) {
            expect(probe.code).toBe("FORBIDDEN");
            expect(probe.message).toContain(ERRORS_BY_LOCALE[locale].forbidden);
            messages.push(probe.message);
          }

          // The constant-denial oracle: every role × query × id cause ×
          // this locale carries the SAME bytes — no per-cause disclosure,
          // no existence signal.
          for (const message of messages) {
            expect(message).toBe(messages[0]);
          }
          expect(await countAllAuditRows()).toBe(auditBefore);
        });
      }
    }

    test("existence-oracle seal — an existing id and a nonexistent id are indistinguishable to a non-admin", async () => {
      const actors = requireCast();
      const existing = await detailDenial(actors.teacher.accessToken, "en", actors.student.userId);
      const nonexistent = await detailDenial(actors.teacher.accessToken, "en", NONEXISTENT_STUDENT_ID);
      expect(existing.code).toBe(nonexistent.code);
      expect(existing.message).toBe(nonexistent.message);
    });

    test("the constant denial copy is genuinely locale-specific (en ≠ ar)", () => {
      expect(ERRORS_BY_LOCALE.en.forbidden).not.toBe(ERRORS_BY_LOCALE.ar.forbidden);
    });
  });

  // ─── Tier 1: admin caller — honest 200 envelopes ───────────────────
  describe("Tier 1 — admin caller reads the honest envelopes", () => {
    test("admin dashboard → paged rows + stats block; the fresh fixture student carries the null posture", async () => {
      const actors = requireCast();
      const auditBefore = await countAllAuditRows();
      const result = await runDashboard(actors.admin.accessToken, "en", { page: 1, pageSize: 25, search: null });
      expect(result.error).toBeUndefined();
      const page = result.data?.adminAcademicDashboard;
      if (!page) throw new Error("adminAcademicDashboard returned no data");

      // The honest envelope echo: bounds verbatim, pageCount = ⌈total/pageSize⌉.
      expect(page.page).toBe(1);
      expect(page.pageSize).toBe(25);
      expect(page.total).toBeGreaterThanOrEqual(3);
      expect(page.pageCount).toBe(Math.ceil(page.total / page.pageSize));
      // The stats block counts the SAME sealed student lane the directory counts.
      expect(page.stats.trackedStudentCount).toBe(page.total);
      expect(page.stats.studentsWithGradedHomeworkCount).toBeLessThanOrEqual(page.stats.trackedStudentCount);
      expect(page.stats.needingAttentionCount).toBeLessThanOrEqual(page.stats.trackedStudentCount);

      // `id` first on every row (Apollo cache normalization).
      for (const row of page.items) {
        expect(Object.keys(row)[0]).toBe("id");
      }

      // The freshly-registered fixture student: identity verbatim, and the
      // honest "nothing yet" null posture (never fabricated zeros).
      const mine = page.items.find(row => Number(row.id) === actors.student.userId);
      if (!mine) throw new Error("the fixture student row is missing from the admin dashboard");
      expect(mine.fullName).toBe(actors.student.fullName);
      expect(mine.email).toBe(actors.student.email);
      expect(mine.latestJadidPosition ?? null).toBeNull();
      expect(mine.latestMadiPosition ?? null).toBeNull();
      expect(mine.jadidGradeSummary ?? null).toBeNull();
      expect(mine.madiGradeSummary ?? null).toBeNull();
      expect(mine.lastGradedHomeworkAt ?? null).toBeNull();
      expect(mine.needsAttention ?? null).toBeNull();
      expect(mine.progressRowCount).toBe(0);
      expect(await countAllAuditRows()).toBe(auditBefore);
    });

    test("admin drill-down → echo + honest empty histories + governance inputs on a fresh student", async () => {
      const actors = requireCast();
      const auditBefore = await countAllAuditRows();
      const result = await runDetail(actors.admin.accessToken, "en", {
        studentId: actors.student.userId,
        page: 1,
        pageSize: 25,
      });
      expect(result.error).toBeUndefined();
      const detail = result.data?.adminStudentAcademicDetail;
      if (!detail) throw new Error("adminStudentAcademicDetail returned no data");

      // The echo: identity verbatim + the soft-delete governance input
      // (carried ONLY on this echo, never on dashboard rows).
      expect(Number(detail.student.id)).toBe(actors.student.userId);
      expect(detail.student.fullName).toBe(actors.student.fullName);
      expect(detail.student.email).toBe(actors.student.email);
      expect(detail.student.isDeleted).toBe(false);

      // Both history pages: honest zero windows.
      expect(detail.homeworkPage.items).toHaveLength(0);
      expect(detail.homeworkPage.total).toBe(0);
      expect(detail.homeworkPage.page).toBe(1);
      expect(detail.homeworkPage.pageSize).toBe(25);
      expect(detail.homeworkPage.pageCount).toBe(0);
      expect(detail.reportPage.items).toHaveLength(0);
      expect(detail.reportPage.total).toBe(0);
      expect(detail.reportPage.pageCount).toBe(0);

      expect(detail.progressRowCount).toBe(0);
      expect(detail.needsAttention ?? null).toBeNull();
      expect(await countAllAuditRows()).toBe(auditBefore);
    });

    test("admin success payloads carry no credential material (deep key walk)", async () => {
      const actors = requireCast();
      const dashboard = await runDashboard(actors.admin.accessToken, "en", { page: 1, pageSize: 25, search: null });
      expect(dashboard.error).toBeUndefined();
      const detail = await runDetail(actors.admin.accessToken, "en", {
        studentId: actors.student.userId,
        page: 1,
        pageSize: 25,
      });
      expect(detail.error).toBeUndefined();
      expect(deepFindKey(dashboard.data, "passwordHash")).toBe(false);
      expect(deepFindKey(detail.data, "passwordHash")).toBe(false);
    });
  });

  // ─── Tier 1: admin + unknown student → localized STUDENT_NOT_FOUND ─
  describe("Tier 1 — admin-only localized unknown-student denial", () => {
    for (const locale of LOCALES) {
      test(`admin + nonexistent / non-student studentId @ ${locale} → STUDENT_NOT_FOUND, byte-identical`, async () => {
        const actors = requireCast();
        const auditBefore = await countAllAuditRows();
        const nonexistent = await detailDenial(actors.admin.accessToken, locale, NONEXISTENT_STUDENT_ID);
        expect(nonexistent.code).toBe("STUDENT_NOT_FOUND");
        expect(nonexistent.message).toContain(ERRORS_BY_LOCALE[locale].notFound);
        // A valid id from a NON-student lane is indistinguishable from a
        // nonexistent one — even admins get no id-class disclosure.
        const nonStudent = await detailDenial(actors.admin.accessToken, locale, actors.teacher.userId);
        expect(nonStudent.code).toBe("STUDENT_NOT_FOUND");
        expect(nonStudent.message).toBe(nonexistent.message);
        expect(await countAllAuditRows()).toBe(auditBefore);
      });
    }

    test("the localized not-found copy is genuinely locale-specific (en ≠ ar)", () => {
      expect(ERRORS_BY_LOCALE.en.notFound).not.toBe(ERRORS_BY_LOCALE.ar.notFound);
    });
  });

  // ─── Tier 2: pre-read VALIDATION gates (no data touched) ───────────
  describe("Tier 2 — pre-read VALIDATION gates", () => {
    test("dashboard — page 0 / negative page / pageSize 0 / pageSize 101 → VALIDATION, zero audit writes", async () => {
      const actors = requireCast();
      const auditBefore = await countAllAuditRows();
      const violations: ReadonlyArray<DashboardVariables> = [
        { page: 0, pageSize: 25, search: null },
        { page: -1, pageSize: 25, search: null },
        { page: 1, pageSize: 0, search: null },
        { page: 1, pageSize: 101, search: null },
      ];
      const results = await Promise.all(
        violations.map(variables => runDashboard(actors.admin.accessToken, "en", variables))
      );
      for (const result of results) {
        expect(result.data?.adminAcademicDashboard ?? null).toBeNull();
        const probe = denialProbeOf(result.error);
        expect(probe.code).toBe("VALIDATION");
        expect(probe.message).toContain(ERRORS_BY_LOCALE.en.validation);
      }
      expect(await countAllAuditRows()).toBe(auditBefore);
    });

    test("drill-down — zero / negative studentId → VALIDATION in BOTH locales (shape gate, never a lookup)", async () => {
      const actors = requireCast();
      const auditBefore = await countAllAuditRows();
      const probed = await Promise.all(
        LOCALES.flatMap(locale =>
          [0, -7].map(studentId =>
            runDetail(actors.admin.accessToken, locale, { studentId, page: 1, pageSize: 25 }).then(result => ({
              locale,
              result,
            }))
          )
        )
      );
      for (const { locale, result } of probed) {
        expect(result.data?.adminStudentAcademicDetail ?? null).toBeNull();
        const probe = denialProbeOf(result.error);
        expect(probe.code).toBe("VALIDATION");
        expect(probe.message).toContain(ERRORS_BY_LOCALE[locale].validation);
      }
      expect(await countAllAuditRows()).toBe(auditBefore);
    });

    test("non-integer Int literals die at the GraphQL variable-coercion layer (BAD_USER_INPUT, pre-resolver)", async () => {
      const actors = requireCast();
      const fractionalId = await runDetail(actors.admin.accessToken, "en", { studentId: 1.5, page: 1, pageSize: 25 });
      expect(fractionalId.data?.adminStudentAcademicDetail ?? null).toBeNull();
      // A fractional VALUE fails Int variable COERCION — Apollo Server emits
      // its protocol `BAD_USER_INPUT` code (document-level parse/validation
      // failures are the ones that surface as GRAPHQL_VALIDATION_FAILED).
      expect(denialProbeOf(fractionalId.error).code).toBe("BAD_USER_INPUT");
      const fractionalSize = await runDashboard(actors.admin.accessToken, "en", {
        page: 1,
        pageSize: 1.5,
        search: null,
      });
      expect(fractionalSize.data?.adminAcademicDashboard ?? null).toBeNull();
      expect(denialProbeOf(fractionalSize.error).code).toBe("BAD_USER_INPUT");
    });
  });

  // ─── Tier 2: honest pagination envelopes ───────────────────────────
  describe("Tier 2 — honest pagination envelopes", () => {
    test("out-of-range page on a single-row search window → empty items next to the honest total", async () => {
      const actors = requireCast();
      const result = await runDashboard(actors.admin.accessToken, "en", {
        page: 2,
        pageSize: 25,
        search: actors.student.email,
      });
      expect(result.error).toBeUndefined();
      const page = result.data?.adminAcademicDashboard;
      if (!page) throw new Error("adminAcademicDashboard returned no data");
      expect(page.total).toBe(1);
      expect(page.page).toBe(2);
      expect(page.pageCount).toBe(1);
      expect(page.items).toHaveLength(0);
    });

    test("drill-down page 2 of an empty history → empty items next to the honest zero total", async () => {
      const actors = requireCast();
      const result = await runDetail(actors.admin.accessToken, "en", {
        studentId: actors.student.userId,
        page: 2,
        pageSize: 25,
      });
      expect(result.error).toBeUndefined();
      const detail = result.data?.adminStudentAcademicDetail;
      if (!detail) throw new Error("adminStudentAcademicDetail returned no data");
      expect(detail.homeworkPage.items).toHaveLength(0);
      expect(detail.homeworkPage.total).toBe(0);
      expect(detail.homeworkPage.page).toBe(2);
      expect(detail.homeworkPage.pageCount).toBe(0);
      expect(detail.reportPage.items).toHaveLength(0);
      expect(detail.reportPage.page).toBe(2);
    });

    test("pageSize boundaries 1 and 100 hold the honest envelope math", async () => {
      const actors = requireCast();
      const singleton = await runDashboard(actors.admin.accessToken, "en", {
        page: 1,
        pageSize: 1,
        search: actors.student.email,
      });
      expect(singleton.error).toBeUndefined();
      const singletonPage = singleton.data?.adminAcademicDashboard;
      if (!singletonPage) throw new Error("adminAcademicDashboard returned no data");
      expect(singletonPage.pageSize).toBe(1);
      expect(singletonPage.total).toBe(1);
      expect(singletonPage.pageCount).toBe(1);
      expect(singletonPage.items).toHaveLength(1);
      expect(Number(singletonPage.items[0]?.id)).toBe(actors.student.userId);

      const wide = await runDashboard(actors.admin.accessToken, "en", { page: 1, pageSize: 100, search: null });
      expect(wide.error).toBeUndefined();
      const widePage = wide.data?.adminAcademicDashboard;
      if (!widePage) throw new Error("adminAcademicDashboard returned no data");
      expect(widePage.pageSize).toBe(100);
      expect(widePage.items).toHaveLength(Math.min(widePage.total, 100));
      expect(widePage.pageCount).toBe(Math.ceil(widePage.total / 100));
    });
  });

  // ─── Tier 2 + 4: search LIKE-metacharacter escape probes ───────────
  describe("search — LIKE-metacharacter escape probes (honest result sets)", () => {
    test("an exact email token narrows the directory to exactly the matching fixture row", async () => {
      const actors = requireCast();
      const result = await runDashboard(actors.admin.accessToken, "en", {
        page: 1,
        pageSize: 25,
        search: actors.underscoreStudent.email,
      });
      expect(result.error).toBeUndefined();
      const page = result.data?.adminAcademicDashboard;
      if (!page) throw new Error("adminAcademicDashboard returned no data");
      expect(page.total).toBe(1);
      expect(page.items).toHaveLength(1);
      expect(Number(page.items[0]?.id)).toBe(actors.underscoreStudent.userId);
    });

    test("a token embedded nowhere yields the honest empty set", async () => {
      const actors = requireCast();
      const absentToken = `absent-${randomUUID().slice(0, 8)}`;
      const result = await runDashboard(actors.admin.accessToken, "en", {
        page: 1,
        pageSize: 25,
        search: absentToken,
      });
      expect(result.error).toBeUndefined();
      const page = result.data?.adminAcademicDashboard;
      if (!page) throw new Error("adminAcademicDashboard returned no data");
      expect(page.total).toBe(0);
      expect(page.items).toHaveLength(0);
      expect(page.pageCount).toBe(0);
    });

    test("the % _ \\ metacharacters match literally — never as wildcards", async () => {
      const actors = requireCast();
      const unfiltered = await runDashboard(actors.admin.accessToken, "en", { page: 1, pageSize: 100, search: null });
      expect(unfiltered.error).toBeUndefined();
      const unfilteredPage = unfiltered.data?.adminAcademicDashboard;
      if (!unfilteredPage) throw new Error("adminAcademicDashboard returned no data");
      const unfilteredTotal = unfilteredPage.total;

      // Escaped `%` matches rows containing a LITERAL percent sign only —
      // an unescaped one would widen to match-all (total === unfiltered).
      const pct = await runDashboard(actors.admin.accessToken, "en", { page: 1, pageSize: 100, search: "%" });
      expect(pct.data?.adminAcademicDashboard?.total ?? unfilteredTotal).toBeLessThanOrEqual(unfilteredTotal - 3);

      // Escaped backslash: the escape character itself is literal.
      const backslash = await runDashboard(actors.admin.accessToken, "en", { page: 1, pageSize: 100, search: "\\" });
      expect(backslash.data?.adminAcademicDashboard?.total ?? unfilteredTotal).toBeLessThanOrEqual(unfilteredTotal - 3);

      // Escaped underscore: the literal-underscore fixture MUST match
      // (honest literal semantics) while the wildcard-free fixtures must not.
      const underscore = await runDashboard(actors.admin.accessToken, "en", { page: 1, pageSize: 100, search: "_" });
      const underscoreTotal = underscore.data?.adminAcademicDashboard?.total ?? -1;
      expect(underscoreTotal).toBeGreaterThanOrEqual(1);
      expect(underscoreTotal).toBeLessThanOrEqual(unfilteredTotal - 2);
    });

    test("the underscore discriminator — a literal underscore matches only itself, not any character", async () => {
      const actors = requireCast();
      // Escaped `_` matches the literal-underscore email ONLY. Unescaped,
      // `_` would match the control lookalike too (two rows).
      // Token-scoped: the shared dev DB may hold orphaned fixture students
      // from interrupted runs; the run token narrows the probe to THIS
      // run's cast while the escaped `_` keeps the discriminator honest.
      const probe = await runDashboard(actors.admin.accessToken, "en", {
        page: 1,
        pageSize: 100,
        search: `wild_card-${RUN_TOKEN}`,
      });
      expect(probe.error).toBeUndefined();
      const page = probe.data?.adminAcademicDashboard;
      if (!page) throw new Error("adminAcademicDashboard returned no data");
      expect(page.total).toBe(1);
      expect(Number(page.items[0]?.id)).toBe(actors.underscoreStudent.userId);

      const controlProbe = await runDashboard(actors.admin.accessToken, "en", {
        page: 1,
        pageSize: 100,
        search: `wildxcard-${RUN_TOKEN}`,
      });
      expect(controlProbe.error).toBeUndefined();
      const controlPage = controlProbe.data?.adminAcademicDashboard;
      if (!controlPage) throw new Error("adminAcademicDashboard returned no data");
      expect(controlPage.total).toBe(1);
      expect(Number(controlPage.items[0]?.id)).toBe(actors.controlStudent.userId);
    });
  });

  // ─── Tier 3: parallel probe bursts ─────────────────────────────────
  describe("Tier 3 — parallel probe bursts (Promise.allSettled)", () => {
    test("non-admin burst — six concurrent denials collapse into ONE byte-identical FORBIDDEN", async () => {
      const actors = requireCast();
      const auditBefore = await countAllAuditRows();
      const settled = await Promise.allSettled([
        dashboardDenial(actors.teacher.accessToken, "en"),
        dashboardDenial(actors.student.accessToken, "en"),
        dashboardDenial(actors.parent.accessToken, "en"),
        detailDenial(actors.teacher.accessToken, "en", actors.student.userId),
        detailDenial(actors.student.accessToken, "en", actors.student.userId),
        detailDenial(actors.parent.accessToken, "en", actors.parent.userId),
      ]);
      const probes: DenialProbeResult[] = [];
      for (const outcome of settled) {
        if (outcome.status === "rejected") {
          throw new Error(`a parallel denial probe failed: ${String(outcome.reason)}`);
        }
        probes.push(outcome.value);
      }
      const oracle = probes[0]?.message ?? "";
      for (const probe of probes) {
        expect(probe.code).toBe("FORBIDDEN");
        expect(probe.message).toBe(oracle);
      }
      expect(await countAllAuditRows()).toBe(auditBefore);
    });

    test("anonymous burst — both queries × both locales concurrently → UNAUTHORIZED with per-locale copy", async () => {
      const settled = await Promise.allSettled([
        dashboardDenial(null, "en"),
        detailDenial(null, "en", NONEXISTENT_STUDENT_ID),
        dashboardDenial(null, "ar"),
        detailDenial(null, "ar", NONEXISTENT_STUDENT_ID),
      ]);
      const byLocale: Partial<Record<Locale, string[]>> = { en: [], ar: [] };
      for (const outcome of settled) {
        if (outcome.status === "rejected") {
          throw new Error(`a parallel anonymous probe failed: ${String(outcome.reason)}`);
        }
        expect(outcome.value.code).toBe("UNAUTHORIZED");
        const matched = LOCALES.find(locale => outcome.value.message.includes(ERRORS_BY_LOCALE[locale].unauthorized));
        if (!matched) throw new Error("anonymous denial copy matched neither locale bundle");
        byLocale[matched]?.push(outcome.value.message);
      }
      for (const locale of LOCALES) {
        const messages = byLocale[locale] ?? [];
        expect(messages).toHaveLength(2);
        for (const message of messages) {
          expect(message).toBe(messages[0]);
        }
      }
    });

    test("admin burst — concurrent pre-read VALIDATION probes hold one uniform code", async () => {
      const actors = requireCast();
      const settled = await Promise.allSettled([
        runDashboard(actors.admin.accessToken, "en", { page: 0, pageSize: 25, search: null }).then(result =>
          denialProbeOf(result.error)
        ),
        runDashboard(actors.admin.accessToken, "en", { page: 1, pageSize: 101, search: null }).then(result =>
          denialProbeOf(result.error)
        ),
        detailDenial(actors.admin.accessToken, "en", 0),
        detailDenial(actors.admin.accessToken, "en", -7),
        detailDenial(actors.admin.accessToken, "ar", 0),
        detailDenial(actors.admin.accessToken, "ar", -7),
      ]);
      for (const outcome of settled) {
        if (outcome.status === "rejected") {
          throw new Error(`a parallel VALIDATION probe failed: ${String(outcome.reason)}`);
        }
        expect(outcome.value.code).toBe("VALIDATION");
      }
    });

    test("admin burst — concurrent dashboard reads return one consistent snapshot total", async () => {
      const actors = requireCast();
      const settled = await Promise.allSettled([
        runDashboard(actors.admin.accessToken, "en", { page: 1, pageSize: 25, search: null }),
        runDashboard(actors.admin.accessToken, "en", { page: 1, pageSize: 25, search: null }),
        runDashboard(actors.admin.accessToken, "en", { page: 1, pageSize: 25, search: null }),
      ]);
      const totals: number[] = [];
      for (const outcome of settled) {
        if (outcome.status === "rejected") {
          throw new Error(`a parallel read failed: ${String(outcome.reason)}`);
        }
        expect(outcome.value.error).toBeUndefined();
        const page = outcome.value.data?.adminAcademicDashboard;
        if (!page) throw new Error("a parallel read returned no data");
        totals.push(page.total);
      }
      for (const total of totals) {
        expect(total).toBe(totals[0]);
      }
    });
  });

  // ─── Tier 4: forged credentials + role tampering ───────────────────
  describe("Tier 4 — forged credentials never upgrade the caller", () => {
    test("forged bearer token carrying an Admin role claim → UNAUTHORIZED on both queries (never FORBIDDEN)", async () => {
      const auditBefore = await countAllAuditRows();
      const forged = forgedAdminBearerToken();
      const probes = await Promise.all(
        LOCALES.flatMap(locale => [
          dashboardDenial(forged, locale).then(result => ({ locale, result })),
          detailDenial(forged, locale, NONEXISTENT_STUDENT_ID).then(result => ({ locale, result })),
        ])
      );
      for (const { locale, result } of probes) {
        expect(result.code).toBe("UNAUTHORIZED");
        expect(result.message).toContain(ERRORS_BY_LOCALE[locale].unauthorized);
      }
      expect(await countAllAuditRows()).toBe(auditBefore);
    });

    test("malformed Authorization header shapes → anonymous UNAUTHORIZED, zero audit writes", async () => {
      const auditBefore = await countAllAuditRows();
      const probes = await Promise.all(
        ["Bearer", "not-a-jwt-at-all"].map(authorization =>
          testClient
            .query({
              query: adminAcademicDashboardQueryDocument,
              variables: { page: 1, pageSize: 25, search: null },
              context: { headers: { Authorization: authorization, "Accept-Language": "en" } },
            })
            .then(result => {
              expect(result.data?.adminAcademicDashboard ?? null).toBeNull();
              return denialProbeOf(result.error);
            })
        )
      );
      for (const probe of probes) {
        expect(probe.code).toBe("UNAUTHORIZED");
      }
      expect(await countAllAuditRows()).toBe(auditBefore);
    });
  });

  // ─── Read-only wire posture ────────────────────────────────────────
  describe("read-only wire posture", () => {
    test("both fields resolve ONLY on Query and never on Mutation (no mutation affordances)", async () => {
      const inventory = await introspectSchemaSurface();
      const queryNames = new Set(inventory.queryFieldNames);
      const mutationNames = new Set(inventory.mutationFieldNames);
      for (const name of ACADEMIC_OPERATIONS) {
        expect(queryNames.has(name)).toBe(true);
        expect(mutationNames.has(name)).toBe(false);
      }
    });
  });
});
