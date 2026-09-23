/**
 * Lessons GraphQL Role-Matrix Integration Suite
 *
 * Implements REQ-016, REQ-030, REQ-051, REQ-053:
 * Proves BFLA and authScopes across all roles (Anonymous, Student, Parent,
 * Teacher, Admin) for all 4 lesson operations (planLessons, createLesson,
 * updateLesson, deleteLesson), plus the wire error-code inventory
 * (extensions.fields[] field codes and LESSON_NOT_FOUND).
 */

import { afterAll, describe, expect, test } from "bun:test";
import { and, eq, inArray } from "drizzle-orm";
import { graphql } from "graphql";
import { db } from "@/backend/db";
import { auditLogs } from "@/backend/db/schema/audit/audit-logs";
import { plans as plansSchema } from "@/backend/db/schema/billing/plans";
import { lessons as lessonsSchema } from "@/backend/db/schema/classes/lessons";
import { users } from "@/backend/db/schema/users/users";
import { toUserRole, UserRole } from "@/backend/enum";
import type { Context } from "@/backend/graphql/gqlContextFactory";
import { graphQLSchema } from "@/backend/graphql/gqlSchema";
import type { RegistrationReturnType, UserSelectType } from "@/backend/types";
import { getServerTranslations } from "@/shared/locale/server-graphql";
import type { Translations } from "@/shared/locale/types/message";
import { withAuditDeleteTriggersSuspended } from "@/test/helpers/db-cleanup";

const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? "[EMAIL_REDACTED]";

/**
 * Plan and lesson rows created by the admin happy-path tests are committed to
 * the real database (the mutation stack owns its pool transactions), so their
 * ids are tracked and the rows are removed — together with the audit rows they
 * minted — once the suite finishes.
 */
const trackedPlanIds: number[] = [];
const trackedLessonIds: number[] = [];
let seededAdminRow: UserSelectType | null = null;
let sharedPlanId: number | null = null;

async function resolveSeededAdmin(): Promise<UserSelectType> {
  if (seededAdminRow) return seededAdminRow;
  const [row] = await db.select().from(users).where(eq(users.email, ADMIN_EMAIL)).limit(1);
  if (!row) {
    throw new Error(`seeded admin ${ADMIN_EMAIL} not found — run the seed step before this suite`);
  }
  seededAdminRow = row;
  return row;
}

async function createSharedPlan(): Promise<number> {
  const admin = await resolveSeededAdmin();
  const res = await graphql({
    schema: graphQLSchema,
    source: `
      mutation CreateSharedPlan($input: CreatePlanInput!) {
        createPlan(input: $input) { id }
      }
    `,
    variableValues: {
      input: {
        title: `Lessons Shared Plan ${Date.now()}`,
        sessionCount: 5,
        price: "100.00",
        currency: "EGP",
        intervalDays: 30,
      },
    },
    contextValue: buildContextForUser(admin),
  });
  const createdId = extractResultData(res)?.createPlan?.id;
  expect(createdId).toBeDefined();
  const planId = Number(createdId);
  trackedPlanIds.push(planId);
  return planId;
}

async function ensureSharedPlan(): Promise<number> {
  if (sharedPlanId !== null) return sharedPlanId;
  sharedPlanId = await createSharedPlan();
  return sharedPlanId;
}

afterAll(async () => {
  const lessonIds = [...trackedLessonIds];
  const planIds = [...trackedPlanIds];
  if (lessonIds.length > 0) {
    await withAuditDeleteTriggersSuspended(async () => {
      await db.delete(auditLogs).where(and(eq(auditLogs.entityType, "lesson"), inArray(auditLogs.entityId, lessonIds)));
    });
    await db.delete(lessonsSchema).where(inArray(lessonsSchema.id, lessonIds));
    trackedLessonIds.length = 0;
  }
  if (planIds.length > 0) {
    await withAuditDeleteTriggersSuspended(async () => {
      await db.delete(auditLogs).where(and(eq(auditLogs.entityType, "plan"), inArray(auditLogs.entityId, planIds)));
    });
    await db.delete(plansSchema).where(inArray(plansSchema.id, planIds));
    trackedPlanIds.length = 0;
  }
});

function buildContextForUser(user: UserSelectType | null): Context {
  let safeUser: RegistrationReturnType | null = null;
  if (user) {
    const { passwordHash: _passwordHash, ...rest } = user;
    safeUser = { ...rest, preferredRecitation: null };
  }

  return {
    locale: "en",
    t: async <K extends keyof Translations>(ns: K) => getServerTranslations("en")[ns],
    requestId: "req-test-1234",
    user: safeUser,
    safeUser,
    permissions: [],
    isSuperAdmin: user?.role === "admin",
    role: user ? toUserRole(user.role) : null,
    cookies: {},
    authCookieOut: [],
  };
}

function mockUser(role?: UserRole, userId = 100): UserSelectType | null {
  if (!role) return null;
  return {
    id: userId,
    email: `${role}@test.local`,
    fullName: `Test ${role}`,
    phone: "+[PHONE_REDACTED]",
    country: "Egypt",
    gender: "male",
    dateOfBirth: "1990-01-01",
    role,
    isDeleted: false,
    suspended: false,
    isBlocked: false,
    deletedAt: null,
    suspendedAt: null,
    blockedAt: null,
    lastActiveAt: null,
    suspendedPeriodDays: null,
    passwordHash: "hash",
    locale: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

interface LessonItemPayload {
  readonly id: string;
  readonly planId: number | null;
  readonly title: string;
}

interface GraphQLResultWithData {
  readonly planLessons?: readonly LessonItemPayload[];
  readonly createLesson?: LessonItemPayload;
  readonly updateLesson?: LessonItemPayload;
  readonly deleteLesson?: LessonItemPayload;
  readonly createPlan?: { readonly id: string };
}

function extractResultData(res: { data?: unknown }): GraphQLResultWithData | undefined {
  if (typeof res.data === "object" && res.data !== null) {
    return res.data;
  }
  return undefined;
}

async function lessonCountForPlan(planId: number): Promise<number> {
  const rows = await db.select({ id: lessonsSchema.id }).from(lessonsSchema).where(eq(lessonsSchema.planId, planId));
  return rows.length;
}

async function lessonAuditCount(): Promise<number> {
  const rows = await db.select({ id: auditLogs.id }).from(auditLogs).where(eq(auditLogs.entityType, "lesson"));
  return rows.length;
}

/**
 * Creates a committed probe lesson via the admin createLesson mutation so
 * denial tests can target a real row and prove ZERO writes against it. The
 * created id is registered with `trackedLessonIds` for the afterAll cleanup.
 */
async function createLessonAsAdmin(planId: number, title: string): Promise<string> {
  const admin = await resolveSeededAdmin();
  const createRes = await graphql({
    schema: graphQLSchema,
    source: `
      mutation CreateLessonAsAdmin($input: CreateLessonInput!) {
        createLesson(input: $input) { id }
      }
    `,
    variableValues: { input: { planId, title } },
    contextValue: buildContextForUser(admin),
  });
  const createdId = extractResultData(createRes)?.createLesson?.id;
  expect(createdId).toBeDefined();
  if (createdId != null) trackedLessonIds.push(Number(createdId));
  return createdId ?? "";
}

function firstFieldCode(res: { errors?: readonly { extensions?: Record<string, unknown> }[] }): string | undefined {
  const extensions = res.errors?.[0]?.extensions;
  if (extensions == null || typeof extensions !== "object") return undefined;
  const fields = extensions.fields;
  if (!Array.isArray(fields) || fields.length === 0) return undefined;
  const first = fields[0];
  if (first == null || typeof first !== "object") return undefined;
  const code = Reflect.get(first, "code");
  return typeof code === "string" ? code : undefined;
}

describe("Lessons GraphQL Role-Matrix (REQ-030)", () => {
  // ─── 1. Query: planLessons ──────────────────────────────────────────────────

  describe("query: planLessons", () => {
    const document = `
      query GetPlanLessons($planId: ID!) {
        planLessons(planId: $planId) {
          id
          planId
          title
        }
      }
    `;

    test("Anonymous receives UNAUTHORIZED", async () => {
      const res = await graphql({
        schema: graphQLSchema,
        source: document,
        variableValues: { planId: "1" },
        contextValue: buildContextForUser(null),
      });

      expect(res.errors).toBeDefined();
      expect(res.errors?.[0]?.extensions?.code).toBe("UNAUTHORIZED");
    });

    test.each([UserRole.Student, UserRole.Parent, UserRole.Teacher])(
      "Authenticated non-admin role %s successfully fetches plan lessons",
      async role => {
        const planId = await ensureSharedPlan();
        const user = mockUser(role);
        const res = await graphql({
          schema: graphQLSchema,
          source: document,
          variableValues: { planId: String(planId) },
          contextValue: buildContextForUser(user),
        });

        expect(res.errors).toBeUndefined();
        const data = extractResultData(res);
        const lessons = data?.planLessons ?? [];
        expect(Array.isArray(lessons)).toBe(true);
        for (const lesson of lessons) {
          expect(typeof lesson.id).toBe("string");
          expect(typeof lesson.title).toBe("string");
        }
      }
    );
  });

  // ─── 2. Mutation: createLesson ──────────────────────────────────────────────

  describe("mutation: createLesson", () => {
    const document = `
      mutation CreateLesson($input: CreateLessonInput!) {
        createLesson(input: $input) {
          id
          planId
          title
        }
      }
    `;

    test("Anonymous receives FORBIDDEN with zero writes", async () => {
      const planId = await ensureSharedPlan();
      const lessonsBefore = await lessonCountForPlan(planId);
      const auditBefore = await lessonAuditCount();

      const res = await graphql({
        schema: graphQLSchema,
        source: document,
        variableValues: { input: { planId, title: `Anon Create ${Date.now()}` } },
        contextValue: buildContextForUser(null),
      });

      expect(res.errors).toBeDefined();
      expect(res.errors?.[0]?.extensions?.code).toBe("FORBIDDEN");
      expect(await lessonCountForPlan(planId)).toBe(lessonsBefore);
      expect(await lessonAuditCount()).toBe(auditBefore);
    });

    test.each([UserRole.Student, UserRole.Parent, UserRole.Teacher])(
      "Non-admin role %s receives FORBIDDEN with zero writes",
      async role => {
        const planId = await ensureSharedPlan();
        const lessonsBefore = await lessonCountForPlan(planId);
        const auditBefore = await lessonAuditCount();

        const user = mockUser(role);
        const res = await graphql({
          schema: graphQLSchema,
          source: document,
          variableValues: { input: { planId, title: `Denied Create ${Date.now()}` } },
          contextValue: buildContextForUser(user),
        });

        expect(res.errors).toBeDefined();
        expect(res.errors?.[0]?.extensions?.code).toBe("FORBIDDEN");
        expect(await lessonCountForPlan(planId)).toBe(lessonsBefore);
        expect(await lessonAuditCount()).toBe(auditBefore);
      }
    );

    test("Admin create with empty title carries LESSON_TITLE_REQUIRED on extensions.fields[]", async () => {
      const planId = await ensureSharedPlan();
      const auditBefore = await lessonAuditCount();
      const admin = await resolveSeededAdmin();

      const res = await graphql({
        schema: graphQLSchema,
        source: document,
        variableValues: { input: { planId, title: "   " } },
        contextValue: buildContextForUser(admin),
      });

      expect(res.errors).toBeDefined();
      expect(res.errors?.[0]?.extensions?.code).toBe("VALIDATION");
      expect(firstFieldCode(res)).toBe("LESSON_TITLE_REQUIRED");
      expect(await lessonAuditCount()).toBe(auditBefore);
    });

    test("Admin create with non-existent plan carries LESSON_PLAN_NOT_FOUND on extensions.fields[]", async () => {
      const auditBefore = await lessonAuditCount();
      const admin = await resolveSeededAdmin();

      const res = await graphql({
        schema: graphQLSchema,
        source: document,
        variableValues: { input: { planId: 999999999, title: `Orphan Create ${Date.now()}` } },
        contextValue: buildContextForUser(admin),
      });

      expect(res.errors).toBeDefined();
      expect(res.errors?.[0]?.extensions?.code).toBe("VALIDATION");
      expect(firstFieldCode(res)).toBe("LESSON_PLAN_NOT_FOUND");
      expect(await lessonAuditCount()).toBe(auditBefore);
    });

    test("Admin successfully creates lesson on the shared plan", async () => {
      const planId = await ensureSharedPlan();
      const lessonsBefore = await lessonCountForPlan(planId);
      const admin = await resolveSeededAdmin();

      const res = await graphql({
        schema: graphQLSchema,
        source: document,
        variableValues: { input: { planId, title: `Admin Create Lesson ${Date.now()}` } },
        contextValue: buildContextForUser(admin),
      });

      expect(res.errors).toBeUndefined();
      const data = extractResultData(res);
      const created = data?.createLesson;
      expect(created?.title).toContain("Admin Create Lesson");
      expect(created?.planId).toBe(planId);
      if (created?.id != null) trackedLessonIds.push(Number(created.id));
      expect(await lessonCountForPlan(planId)).toBe(lessonsBefore + 1);
    });
  });

  // ─── 3. Mutation: updateLesson ──────────────────────────────────────────────

  describe("mutation: updateLesson", () => {
    const document = `
      mutation UpdateLesson($id: ID!, $input: UpdateLessonInput!) {
        updateLesson(id: $id, input: $input) {
          id
          planId
          title
        }
      }
    `;

    test("Anonymous receives FORBIDDEN with zero writes", async () => {
      const planId = await ensureSharedPlan();
      const createdId = await createLessonAsAdmin(planId, `Deny Update Target anon ${Date.now()}`);

      const lessonsBefore = await lessonCountForPlan(planId);
      const auditBefore = await lessonAuditCount();

      const res = await graphql({
        schema: graphQLSchema,
        source: document,
        variableValues: { id: createdId, input: { title: `Anon Update ${Date.now()}` } },
        contextValue: buildContextForUser(null),
      });

      expect(res.errors).toBeDefined();
      expect(res.errors?.[0]?.extensions?.code).toBe("FORBIDDEN");
      expect(await lessonCountForPlan(planId)).toBe(lessonsBefore);
      expect(await lessonAuditCount()).toBe(auditBefore);
    });

    test.each([UserRole.Student, UserRole.Parent, UserRole.Teacher])(
      "Non-admin role %s receives FORBIDDEN with zero writes",
      async role => {
        const planId = await ensureSharedPlan();
        const createdId = await createLessonAsAdmin(planId, `Deny Update Target ${role} ${Date.now()}`);

        const lessonsBefore = await lessonCountForPlan(planId);
        const auditBefore = await lessonAuditCount();

        const user = mockUser(role);
        const res = await graphql({
          schema: graphQLSchema,
          source: document,
          variableValues: { id: createdId, input: { title: `Denied Update ${Date.now()}` } },
          contextValue: buildContextForUser(user),
        });

        expect(res.errors).toBeDefined();
        expect(res.errors?.[0]?.extensions?.code).toBe("FORBIDDEN");
        expect(await lessonCountForPlan(planId)).toBe(lessonsBefore);
        expect(await lessonAuditCount()).toBe(auditBefore);
      }
    );

    test("Admin update with non-existent plan carries LESSON_PLAN_NOT_FOUND on extensions.fields[]", async () => {
      const admin = await resolveSeededAdmin();
      const planId = await ensureSharedPlan();

      const createRes = await graphql({
        schema: graphQLSchema,
        source: `
          mutation CreateForUpdate($input: CreateLessonInput!) {
            createLesson(input: $input) { id }
          }
        `,
        variableValues: { input: { planId, title: `Lesson To Update ${Date.now()}` } },
        contextValue: buildContextForUser(admin),
      });

      const createdId = extractResultData(createRes)?.createLesson?.id;
      expect(createdId).toBeDefined();
      if (createdId != null) trackedLessonIds.push(Number(createdId));

      const res = await graphql({
        schema: graphQLSchema,
        source: document,
        variableValues: { id: createdId, input: { planId: 999999999, title: `Relink ${Date.now()}` } },
        contextValue: buildContextForUser(admin),
      });

      expect(res.errors).toBeDefined();
      expect(res.errors?.[0]?.extensions?.code).toBe("VALIDATION");
      expect(firstFieldCode(res)).toBe("LESSON_PLAN_NOT_FOUND");
    });

    test("Admin update of unknown lesson id carries LESSON_NOT_FOUND", async () => {
      const admin = await resolveSeededAdmin();
      const auditBefore = await lessonAuditCount();

      const res = await graphql({
        schema: graphQLSchema,
        source: document,
        variableValues: { id: "999999999", input: { title: `Missing Update ${Date.now()}` } },
        contextValue: buildContextForUser(admin),
      });

      expect(res.errors).toBeDefined();
      expect(res.errors?.[0]?.extensions?.code).toBe("LESSON_NOT_FOUND");
      expect(await lessonAuditCount()).toBe(auditBefore);
    });

    test("Admin successfully updates lesson title", async () => {
      const admin = await resolveSeededAdmin();
      const planId = await ensureSharedPlan();

      const createRes = await graphql({
        schema: graphQLSchema,
        source: `
          mutation CreateForUpdate($input: CreateLessonInput!) {
            createLesson(input: $input) { id }
          }
        `,
        variableValues: { input: { planId, title: `Lesson For Update ${Date.now()}` } },
        contextValue: buildContextForUser(admin),
      });

      const createdId = extractResultData(createRes)?.createLesson?.id;
      expect(createdId).toBeDefined();
      if (createdId != null) trackedLessonIds.push(Number(createdId));

      const res = await graphql({
        schema: graphQLSchema,
        source: document,
        variableValues: { id: createdId, input: { planId, title: `Successfully Updated ${Date.now()}` } },
        contextValue: buildContextForUser(admin),
      });

      expect(res.errors).toBeUndefined();
      const data = extractResultData(res);
      const updated = data?.updateLesson;
      expect(updated?.title).toContain("Successfully Updated");
      expect(updated?.planId).toBe(planId);
    });
  });

  // ─── 4. Mutation: deleteLesson ──────────────────────────────────────────────

  describe("mutation: deleteLesson", () => {
    const document = `
      mutation DeleteLesson($id: ID!) {
        deleteLesson(id: $id) {
          id
          planId
          title
        }
      }
    `;

    test("Anonymous receives FORBIDDEN with zero writes", async () => {
      const planId = await ensureSharedPlan();
      const createdId = await createLessonAsAdmin(planId, `Deny Delete Target anon ${Date.now()}`);

      const lessonsBefore = await lessonCountForPlan(planId);
      const auditBefore = await lessonAuditCount();

      const res = await graphql({
        schema: graphQLSchema,
        source: document,
        variableValues: { id: createdId },
        contextValue: buildContextForUser(null),
      });

      expect(res.errors).toBeDefined();
      expect(res.errors?.[0]?.extensions?.code).toBe("FORBIDDEN");
      expect(await lessonCountForPlan(planId)).toBe(lessonsBefore);
      expect(await lessonAuditCount()).toBe(auditBefore);
    });

    test.each([UserRole.Student, UserRole.Parent, UserRole.Teacher])(
      "Non-admin role %s receives FORBIDDEN with zero writes",
      async role => {
        const planId = await ensureSharedPlan();
        const createdId = await createLessonAsAdmin(planId, `Deny Delete Target ${role} ${Date.now()}`);

        const lessonsBefore = await lessonCountForPlan(planId);
        const auditBefore = await lessonAuditCount();

        const user = mockUser(role);
        const res = await graphql({
          schema: graphQLSchema,
          source: document,
          variableValues: { id: createdId },
          contextValue: buildContextForUser(user),
        });

        expect(res.errors).toBeDefined();
        expect(res.errors?.[0]?.extensions?.code).toBe("FORBIDDEN");
        expect(await lessonCountForPlan(planId)).toBe(lessonsBefore);
        expect(await lessonAuditCount()).toBe(auditBefore);
      }
    );

    test("Admin delete of unknown lesson id carries LESSON_NOT_FOUND", async () => {
      const admin = await resolveSeededAdmin();
      const auditBefore = await lessonAuditCount();

      const res = await graphql({
        schema: graphQLSchema,
        source: document,
        variableValues: { id: "999999999" },
        contextValue: buildContextForUser(admin),
      });

      expect(res.errors).toBeDefined();
      expect(res.errors?.[0]?.extensions?.code).toBe("LESSON_NOT_FOUND");
      expect(await lessonAuditCount()).toBe(auditBefore);
    });

    test("Admin successfully deletes lesson (removed row returned, lesson disappears from planLessons)", async () => {
      const admin = await resolveSeededAdmin();
      const planId = await ensureSharedPlan();

      const createRes = await graphql({
        schema: graphQLSchema,
        source: `
          mutation CreateForDelete($input: CreateLessonInput!) {
            createLesson(input: $input) { id }
          }
        `,
        variableValues: { input: { planId, title: `Lesson For Delete ${Date.now()}` } },
        contextValue: buildContextForUser(admin),
      });

      const createdId = extractResultData(createRes)?.createLesson?.id;
      expect(createdId).toBeDefined();
      const lessonId = Number(createdId);

      const res = await graphql({
        schema: graphQLSchema,
        source: document,
        variableValues: { id: createdId },
        contextValue: buildContextForUser(admin),
      });

      expect(res.errors).toBeUndefined();
      const data = extractResultData(res);
      const deleted = data?.deleteLesson;
      expect(deleted?.id).toBe(createdId);
      expect(deleted?.title).toContain("Lesson For Delete");

      const listRes = await graphql({
        schema: graphQLSchema,
        source: `
          query ListAfterDelete($planId: ID!) {
            planLessons(planId: $planId) { id }
          }
        `,
        variableValues: { planId: String(planId) },
        contextValue: buildContextForUser(admin),
      });
      expect(listRes.errors).toBeUndefined();
      const remaining = extractResultData(listRes)?.planLessons ?? [];
      for (const lesson of remaining) {
        expect(lesson.id).not.toBe(createdId);
      }

      trackedLessonIds.push(lessonId);
    });
  });
});
