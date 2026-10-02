/**
 * Plan Catalog GraphQL Role-Matrix Integration Suite
 *
 * Implements REQ-030, REQ-064, REQ-072:
 * Proves BFLA and authScopes across all roles (Anonymous, Student, Parent, Teacher, Admin)
 * for all 5 plan operations (planCatalog, adminPlans, createPlan, updatePlan, setPlanActiveStatus).
 */

import { afterAll, describe, expect, test } from "bun:test";
import { and, eq, inArray } from "drizzle-orm";
import { graphql } from "graphql";
import { db } from "@/backend/db";
import { auditLogs } from "@/backend/db/schema/audit/audit-logs";
import { plans as plansSchema } from "@/backend/db/schema/billing/plans";
import { users } from "@/backend/db/schema/users/users";
import { toUserRole, UserRole } from "@/backend/enum";
import type { Context } from "@/backend/graphql/gqlContextFactory";
import { graphQLSchema } from "@/backend/graphql/gqlSchema";
import type { RegistrationReturnType, UserSelectType } from "@/backend/types";
import { getServerTranslations } from "@/shared/locale/server-graphql";
import type { Translations } from "@/shared/locale/types/message";
import { withAuditDeleteTriggersSuspended } from "@/test/helpers/db-cleanup";

const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? "admin@draftacademy.local";

/**
 * Plan rows created by the admin happy-path tests are committed to the real
 * database (the mutation stack owns its pool transactions), so their ids are
 * tracked and the rows are removed — together with the audit rows they
 * minted — once the suite finishes.
 */
const trackedPlanIds: number[] = [];
let seededAdminRow: UserSelectType | null = null;

async function resolveSeededAdmin(): Promise<UserSelectType> {
  if (seededAdminRow) return seededAdminRow;
  const [row] = await db.select().from(users).where(eq(users.email, ADMIN_EMAIL)).limit(1);
  if (!row) {
    throw new Error(`seeded admin ${ADMIN_EMAIL} not found — run the seed step before this suite`);
  }
  seededAdminRow = row;
  return row;
}

afterAll(async () => {
  if (trackedPlanIds.length === 0) return;
  const ids = [...trackedPlanIds];
  await withAuditDeleteTriggersSuspended(async () => {
    await db.delete(auditLogs).where(and(eq(auditLogs.entityType, "plan"), inArray(auditLogs.entityId, ids)));
  });
  await db.delete(plansSchema).where(inArray(plansSchema.id, ids));
  trackedPlanIds.length = 0;
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
    phone: "+10000000000",
    country: "Egypt",
    countryCode: "EG",
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

interface PlanItemPayload {
  readonly id: string;
  readonly title: string;
  readonly isActive?: boolean;
  readonly price?: string;
  readonly deactivatedAt?: string | null;
}

interface GraphQLResultWithData {
  readonly planCatalog?: readonly PlanItemPayload[];
  readonly adminPlans?: readonly PlanItemPayload[];
  readonly createPlan?: PlanItemPayload;
  readonly updatePlan?: PlanItemPayload;
  readonly setPlanActiveStatus?: PlanItemPayload;
}

function extractResultData(res: { data?: unknown }): GraphQLResultWithData | undefined {
  if (typeof res.data === "object" && res.data !== null) {
    return res.data;
  }
  return undefined;
}

describe("Plan Catalog GraphQL Role-Matrix (REQ-064)", () => {
  // ─── 1. Query: planCatalog ──────────────────────────────────────────────────

  describe("query: planCatalog", () => {
    const document = `
      query GetPlanCatalog {
        planCatalog {
          id
          title
          isActive
        }
      }
    `;

    test("Anonymous receives UNAUTHORIZED", async () => {
      const res = await graphql({
        schema: graphQLSchema,
        source: document,
        contextValue: buildContextForUser(null),
      });

      expect(res.errors).toBeDefined();
      expect(res.errors?.[0]?.extensions?.code).toBe("UNAUTHORIZED");
    });

    test.each([UserRole.Student, UserRole.Parent, UserRole.Teacher, UserRole.Admin])(
      "Role %s successfully fetches active catalog",
      async role => {
        const user = mockUser(role);
        const res = await graphql({
          schema: graphQLSchema,
          source: document,
          contextValue: buildContextForUser(user),
        });

        expect(res.errors).toBeUndefined();
        const data = extractResultData(res);
        const plans = data?.planCatalog ?? [];
        expect(Array.isArray(plans)).toBe(true);
        for (const p of plans) {
          expect(p.isActive).toBe(true);
        }
      }
    );
  });

  // ─── 2. Query: adminPlans ───────────────────────────────────────────────────

  describe("query: adminPlans", () => {
    const document = `
      query GetAdminPlans($includeInactive: Boolean) {
        adminPlans(includeInactive: $includeInactive) {
          id
          title
          isActive
        }
      }
    `;

    test("Anonymous receives UNAUTHORIZED", async () => {
      const res = await graphql({
        schema: graphQLSchema,
        source: document,
        contextValue: buildContextForUser(null),
      });

      expect(res.errors).toBeDefined();
      expect(res.errors?.[0]?.extensions?.code).toBe("UNAUTHORIZED");
    });

    test.each([UserRole.Student, UserRole.Parent, UserRole.Teacher])(
      "Non-admin role %s receives FORBIDDEN",
      async role => {
        const user = mockUser(role);
        const res = await graphql({
          schema: graphQLSchema,
          source: document,
          contextValue: buildContextForUser(user),
        });

        expect(res.errors).toBeDefined();
        expect(res.errors?.[0]?.extensions?.code).toBe("FORBIDDEN");
      }
    );

    test("Admin fetches all plans including inactive", async () => {
      const admin = mockUser(UserRole.Admin);
      const res = await graphql({
        schema: graphQLSchema,
        source: document,
        variableValues: { includeInactive: true },
        contextValue: buildContextForUser(admin),
      });

      expect(res.errors).toBeUndefined();
      const data = extractResultData(res);
      const plans = data?.adminPlans ?? [];
      expect(Array.isArray(plans)).toBe(true);
    });
  });

  // ─── 3. Mutation: createPlan ────────────────────────────────────────────────

  describe("mutation: createPlan", () => {
    const document = `
      mutation CreatePlan($input: CreatePlanInput!) {
        createPlan(input: $input) {
          id
          title
          sessionCount
          price
          currency
          intervalDays
          isActive
        }
      }
    `;

    const input = {
      title: "Integration Test Plan",
      sessionCount: 10,
      price: "250.00",
      currency: "EGP",
      intervalDays: 30,
    };

    test("Anonymous receives UNAUTHORIZED", async () => {
      const res = await graphql({
        schema: graphQLSchema,
        source: document,
        variableValues: { input },
        contextValue: buildContextForUser(null),
      });

      expect(res.errors).toBeDefined();
      expect(res.errors?.[0]?.extensions?.code).toBe("UNAUTHORIZED");
    });

    test.each([UserRole.Student, UserRole.Parent, UserRole.Teacher])(
      "Non-admin role %s receives FORBIDDEN",
      async role => {
        const user = mockUser(role);
        const res = await graphql({
          schema: graphQLSchema,
          source: document,
          variableValues: { input },
          contextValue: buildContextForUser(user),
        });

        expect(res.errors).toBeDefined();
        expect(res.errors?.[0]?.extensions?.code).toBe("FORBIDDEN");
      }
    );

    test("Admin successfully creates plan", async () => {
      const admin = await resolveSeededAdmin();
      const res = await graphql({
        schema: graphQLSchema,
        source: document,
        variableValues: { input: { ...input, title: `Admin Create ${Date.now()}` } },
        contextValue: buildContextForUser(admin),
      });

      expect(res.errors).toBeUndefined();
      const data = extractResultData(res);
      const created = data?.createPlan;
      expect(created?.title).toContain("Admin Create");
      expect(created?.isActive).toBe(true);
      if (created?.id != null) trackedPlanIds.push(Number(created.id));
    });
  });

  // ─── 4. Mutation: updatePlan ────────────────────────────────────────────────

  describe("mutation: updatePlan", () => {
    const document = `
      mutation UpdatePlan($id: ID!, $input: UpdatePlanInput!) {
        updatePlan(id: $id, input: $input) {
          id
          title
          price
        }
      }
    `;

    test("Anonymous receives UNAUTHORIZED", async () => {
      const res = await graphql({
        schema: graphQLSchema,
        source: document,
        variableValues: { id: "1", input: { title: "Updated Title" } },
        contextValue: buildContextForUser(null),
      });

      expect(res.errors).toBeDefined();
      expect(res.errors?.[0]?.extensions?.code).toBe("UNAUTHORIZED");
    });

    test.each([UserRole.Student, UserRole.Parent, UserRole.Teacher])(
      "Non-admin role %s receives FORBIDDEN",
      async role => {
        const user = mockUser(role);
        const res = await graphql({
          schema: graphQLSchema,
          source: document,
          variableValues: { id: "1", input: { title: "Updated Title" } },
          contextValue: buildContextForUser(user),
        });

        expect(res.errors).toBeDefined();
        expect(res.errors?.[0]?.extensions?.code).toBe("FORBIDDEN");
      }
    );

    test("Admin successfully updates plan", async () => {
      const admin = await resolveSeededAdmin();

      // Create a plan first to obtain a valid ID
      const createRes = await graphql({
        schema: graphQLSchema,
        source: `
          mutation CreateForUpdate($input: CreatePlanInput!) {
            createPlan(input: $input) { id }
          }
        `,
        variableValues: {
          input: {
            title: `Plan To Update ${Date.now()}`,
            sessionCount: 6,
            price: "180.00",
            currency: "EGP",
            intervalDays: 30,
          },
        },
        contextValue: buildContextForUser(admin),
      });

      const createdId = extractResultData(createRes)?.createPlan?.id;
      expect(createdId).toBeDefined();
      if (createdId != null) trackedPlanIds.push(Number(createdId));

      const res = await graphql({
        schema: graphQLSchema,
        source: document,
        variableValues: { id: createdId, input: { title: "Successfully Updated Title", price: "200.00" } },
        contextValue: buildContextForUser(admin),
      });

      expect(res.errors).toBeUndefined();
      const data = extractResultData(res);
      const updated = data?.updatePlan;
      expect(updated?.title).toBe("Successfully Updated Title");
      expect(updated?.price).toBe("200.00");
    });
  });

  // ─── 5. Mutation: setPlanActiveStatus ────────────────────────────────────────

  describe("mutation: setPlanActiveStatus", () => {
    const document = `
      mutation SetStatus($id: ID!, $isActive: Boolean!) {
        setPlanActiveStatus(id: $id, isActive: $isActive) {
          id
          isActive
          deactivatedAt
        }
      }
    `;

    test("Anonymous receives UNAUTHORIZED", async () => {
      const res = await graphql({
        schema: graphQLSchema,
        source: document,
        variableValues: { id: "1", isActive: false },
        contextValue: buildContextForUser(null),
      });

      expect(res.errors).toBeDefined();
      expect(res.errors?.[0]?.extensions?.code).toBe("UNAUTHORIZED");
    });

    test.each([UserRole.Student, UserRole.Parent, UserRole.Teacher])(
      "Non-admin role %s receives FORBIDDEN",
      async role => {
        const user = mockUser(role);
        const res = await graphql({
          schema: graphQLSchema,
          source: document,
          variableValues: { id: "1", isActive: false },
          contextValue: buildContextForUser(user),
        });

        expect(res.errors).toBeDefined();
        expect(res.errors?.[0]?.extensions?.code).toBe("FORBIDDEN");
      }
    );

    test("Admin successfully deactivates and reactivates plan", async () => {
      const admin = await resolveSeededAdmin();

      // Create a plan first to obtain a valid ID
      const createRes = await graphql({
        schema: graphQLSchema,
        source: `
          mutation CreateForStatus($input: CreatePlanInput!) {
            createPlan(input: $input) { id }
          }
        `,
        variableValues: {
          input: {
            title: `Plan For Status ${Date.now()}`,
            sessionCount: 5,
            price: "120.00",
            currency: "EGP",
            intervalDays: 14,
          },
        },
        contextValue: buildContextForUser(admin),
      });

      const createdId = extractResultData(createRes)?.createPlan?.id;
      expect(createdId).toBeDefined();
      if (createdId != null) trackedPlanIds.push(Number(createdId));

      // Deactivate
      const res1 = await graphql({
        schema: graphQLSchema,
        source: document,
        variableValues: { id: createdId, isActive: false },
        contextValue: buildContextForUser(admin),
      });

      expect(res1.errors).toBeUndefined();
      const data1 = extractResultData(res1);
      const deactivated = data1?.setPlanActiveStatus;
      expect(deactivated?.isActive).toBe(false);
      expect(deactivated?.deactivatedAt).not.toBeNull();

      // Reactivate
      const res2 = await graphql({
        schema: graphQLSchema,
        source: document,
        variableValues: { id: createdId, isActive: true },
        contextValue: buildContextForUser(admin),
      });

      expect(res2.errors).toBeUndefined();
      const data2 = extractResultData(res2);
      const reactivated = data2?.setPlanActiveStatus;
      expect(reactivated?.isActive).toBe(true);
      expect(reactivated?.deactivatedAt).toBeNull();
    });
  });
});
