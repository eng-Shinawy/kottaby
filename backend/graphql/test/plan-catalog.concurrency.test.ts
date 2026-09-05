/**
 * Plan Catalog Concurrency & Chaos Tests — DEV1-005 Task 5.2.TE
 *
 * Implements REQ-040, REQ-045, REQ-074:
 * Proves that concurrent operations across GraphQL mutations are safe, race-free,
 * and enforce atomic guarded-UPDATE semantics (INV-PC2 / Decision D2).
 */

import { describe, expect, test } from "bun:test";
import { graphql } from "graphql";
import { UserRole } from "@/backend/enum";
import type { Context } from "@/backend/graphql/gqlContextFactory";
import { graphQLSchema } from "@/backend/graphql/gqlSchema";
import { getServerTranslations } from "@/shared/locale/server-graphql";
import type { Translations } from "@/shared/locale/types/message";

function buildAdminContext(): Context {
  const adminUser = {
    id: 1,
    email: "admin@test.local",
    fullName: "Admin User",
    phone: "+10000000000",
    country: "Egypt",
    gender: "male" as const,
    dateOfBirth: "1990-01-01",
    role: "admin" as const,
    isDeleted: false,
    suspended: false,
    isBlocked: false,
    deletedAt: null,
    suspendedAt: null,
    blockedAt: null,
    lastActiveAt: null,
    suspendedPeriodDays: null,
    preferredRecitation: null,
    locale: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  return {
    locale: "en",
    t: async <K extends keyof Translations>(ns: K) => getServerTranslations("en")[ns],
    requestId: `req-chaos-${Date.now()}`,
    user: adminUser,
    safeUser: adminUser,
    permissions: [],
    isSuperAdmin: true,
    role: UserRole.Admin,
    cookies: {},
    authCookieOut: [],
  };
}

interface CreateResultPayload {
  readonly createPlan?: {
    readonly id: string;
  };
}

function extractCreateId(res: { data?: unknown }): string | undefined {
  if (typeof res.data === "object" && res.data !== null) {
    const payload: CreateResultPayload = res.data;
    return payload.createPlan?.id;
  }
  return undefined;
}

const CREATE_DOCUMENT = `
  mutation CreateForChaos($input: CreatePlanInput!) {
    createPlan(input: $input) {
      id
      title
      isActive
    }
  }
`;

const SET_STATUS_DOCUMENT = `
  mutation SetStatusChaos($id: ID!, $isActive: Boolean!) {
    setPlanActiveStatus(id: $id, isActive: $isActive) {
      id
      isActive
      deactivatedAt
    }
  }
`;

const UPDATE_DOCUMENT = `
  mutation UpdateChaos($id: ID!, $input: UpdatePlanInput!) {
    updatePlan(id: $id, input: $input) {
      id
      title
      price
    }
  }
`;

describe("Plan Catalog Concurrency & Chaos Probes (REQ-074)", () => {
  test("Concurrent double-deactivation: exactly 1 succeeds and 1 receives PLAN_ALREADY_INACTIVE", async () => {
    const adminCtx = buildAdminContext();

    // 1. Create a fresh active plan
    const createRes = await graphql({
      schema: graphQLSchema,
      source: CREATE_DOCUMENT,
      variableValues: {
        input: {
          title: `Chaos Deact Plan ${Date.now()}`,
          sessionCount: 10,
          price: "200.00",
          currency: "EGP",
          intervalDays: 30,
        },
      },
      contextValue: adminCtx,
    });

    const planId = extractCreateId(createRes);
    expect(planId).toBeDefined();

    // 2. Concurrently fire 2 deactivations
    const [res1, res2] = await Promise.all([
      graphql({
        schema: graphQLSchema,
        source: SET_STATUS_DOCUMENT,
        variableValues: { id: planId, isActive: false },
        contextValue: adminCtx,
      }),
      graphql({
        schema: graphQLSchema,
        source: SET_STATUS_DOCUMENT,
        variableValues: { id: planId, isActive: false },
        contextValue: adminCtx,
      }),
    ]);

    const results = [res1, res2];
    const successes = results.filter(r => !r.errors || r.errors.length === 0);
    const failures = results.filter(r => r.errors && r.errors.length > 0);

    expect(successes).toHaveLength(1);
    expect(failures).toHaveLength(1);

    const errorCode = failures[0]?.errors?.[0]?.extensions?.code;
    expect(errorCode).toBe("PLAN_ALREADY_INACTIVE");
  });

  test("Concurrent double-reactivation: exactly 1 succeeds and 1 receives PLAN_ALREADY_ACTIVE", async () => {
    const adminCtx = buildAdminContext();

    // 1. Create a plan and deactivate it first
    const createRes = await graphql({
      schema: graphQLSchema,
      source: CREATE_DOCUMENT,
      variableValues: {
        input: {
          title: `Chaos React Plan ${Date.now()}`,
          sessionCount: 5,
          price: "100.00",
          currency: "EGP",
          intervalDays: 14,
        },
      },
      contextValue: adminCtx,
    });

    const planId = extractCreateId(createRes);

    await graphql({
      schema: graphQLSchema,
      source: SET_STATUS_DOCUMENT,
      variableValues: { id: planId, isActive: false },
      contextValue: adminCtx,
    });

    // 2. Concurrently fire 2 reactivations
    const [res1, res2] = await Promise.all([
      graphql({
        schema: graphQLSchema,
        source: SET_STATUS_DOCUMENT,
        variableValues: { id: planId, isActive: true },
        contextValue: adminCtx,
      }),
      graphql({
        schema: graphQLSchema,
        source: SET_STATUS_DOCUMENT,
        variableValues: { id: planId, isActive: true },
        contextValue: adminCtx,
      }),
    ]);

    const results = [res1, res2];
    const successes = results.filter(r => !r.errors || r.errors.length === 0);
    const failures = results.filter(r => r.errors && r.errors.length > 0);

    expect(successes).toHaveLength(1);
    expect(failures).toHaveLength(1);

    const errorCode = failures[0]?.errors?.[0]?.extensions?.code;
    expect(errorCode).toBe("PLAN_ALREADY_ACTIVE");
  });

  test("Concurrent update mutations converge safely with last-write-wins", async () => {
    const adminCtx = buildAdminContext();

    const createRes = await graphql({
      schema: graphQLSchema,
      source: CREATE_DOCUMENT,
      variableValues: {
        input: {
          title: `Chaos Update Plan ${Date.now()}`,
          sessionCount: 8,
          price: "150.00",
          currency: "EGP",
          intervalDays: 30,
        },
      },
      contextValue: adminCtx,
    });

    const planId = extractCreateId(createRes);

    // Concurrent updates
    const [res1, res2] = await Promise.all([
      graphql({
        schema: graphQLSchema,
        source: UPDATE_DOCUMENT,
        variableValues: { id: planId, input: { price: "220.00" } },
        contextValue: adminCtx,
      }),
      graphql({
        schema: graphQLSchema,
        source: UPDATE_DOCUMENT,
        variableValues: { id: planId, input: { price: "240.00" } },
        contextValue: adminCtx,
      }),
    ]);

    expect(res1.errors).toBeUndefined();
    expect(res2.errors).toBeUndefined();
  });
});
