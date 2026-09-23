/**
 * Plan catalog balance-lane end-to-end tests.
 *
 * Proves the lane contract across every layer at once — GraphQL input →
 * resolver mapping → service validation → repository write:
 *  - `CreatePlanInput.balanceLane` reaches the service and persists.
 *  - `UpdatePlanInput.balanceLane` is forwarded by the resolver: a member
 *    re-targets the stored lane, an explicit `null` clears it, and an
 *    absent field leaves it untouched.
 *  - Unknown lane members are rejected by GraphQL enum coercion before any
 *    resolver runs (the service re-validates for non-GraphQL callers).
 *  - A laneless plan reads back with a `null` lane — the fail-closed
 *    purchase precondition.
 *
 * Harness: in-process `graphql()` against the real schema and the real
 * database (plan-catalog roles/concurrency precedent). The mutations run on
 * the default executor, so created rows COMMIT — each plan id is tracked and
 * hard-deleted in `afterAll` with a zero-residue probe.
 */

import { afterAll, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { graphql } from "graphql";
import { db } from "@/backend/db";
import { PlanRepository } from "@/backend/db/repo/billing/plan.repository";
import { plans } from "@/backend/db/schema/billing/plans";
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
    requestId: `req-lane-${Date.now()}`,
    user: adminUser,
    safeUser: adminUser,
    permissions: [],
    isSuperAdmin: true,
    role: UserRole.Admin,
    cookies: {},
    authCookieOut: [],
  };
}

interface LaneResultPayload {
  readonly id: string;
  readonly title: string;
  readonly balanceLane?: string | null;
}

interface LaneOperationResult {
  readonly createPlan?: LaneResultPayload;
  readonly updatePlan?: LaneResultPayload;
}

function extractResultData(res: { data?: unknown }): LaneOperationResult | undefined {
  if (typeof res.data === "object" && res.data !== null) {
    const payload: LaneOperationResult = res.data;
    return payload;
  }
  return undefined;
}

const CREATE_DOCUMENT = `
  mutation CreateLanePlan($input: CreatePlanInput!) {
    createPlan(input: $input) {
      id
      title
      balanceLane
    }
  }
`;

const UPDATE_DOCUMENT = `
  mutation UpdateLanePlan($id: ID!, $input: UpdatePlanInput!) {
    updatePlan(id: $id, input: $input) {
      id
      title
      balanceLane
    }
  }
`;

const baseInput = {
  sessionCount: 5,
  price: "120.00",
  currency: "EGP",
  intervalDays: 30,
};

/** Committed plan ids created by this suite — hard-deleted in `afterAll`. */
const createdPlanIds: number[] = [];

/** Tracks a created plan for cleanup, failing the test if the id is unusable. */
function trackCreatedPlan(planId: number): number {
  expect(Number.isInteger(planId)).toBe(true);
  if (Number.isInteger(planId)) {
    createdPlanIds.push(planId);
  }
  return planId;
}

async function executeMutation(source: string, variableValues: Record<string, unknown>) {
  return graphql({
    schema: graphQLSchema,
    source,
    variableValues,
    contextValue: buildAdminContext(),
  });
}

afterAll(async () => {
  await Promise.all(createdPlanIds.map(planId => db.delete(plans).where(eq(plans.id, planId))));
  // Zero-residue proof: every tracked plan is gone from the default executor.
  const residues = await Promise.all(createdPlanIds.map(planId => PlanRepository.findById(planId)));
  expect(residues.every(row => row === null)).toBe(true);
});

describe("Plan catalog lane end-to-end (GraphQL → service → repository)", () => {
  test("createPlan carries the lane onto the wire and into the stored row", async () => {
    const res = await executeMutation(CREATE_DOCUMENT, {
      input: { ...baseInput, title: `Lane Create ${Date.now()}`, balanceLane: "Hifz" },
    });

    expect(res.errors).toBeUndefined();
    const created = extractResultData(res)?.createPlan;
    expect(created?.balanceLane).toBe("Hifz");

    const planId = trackCreatedPlan(Number(created?.id));
    expect((await PlanRepository.findById(planId))?.balanceLane).toBe("hifz");
  });

  test("createPlan without balanceLane leaves the plan laneless (fail-closed precondition)", async () => {
    const res = await executeMutation(CREATE_DOCUMENT, {
      input: { ...baseInput, title: `Laneless Create ${Date.now()}` },
    });

    expect(res.errors).toBeUndefined();
    const created = extractResultData(res)?.createPlan;
    expect(created?.balanceLane).toBeNull();

    const planId = trackCreatedPlan(Number(created?.id));
    expect((await PlanRepository.findById(planId))?.balanceLane).toBeNull();
  });

  test("updatePlan re-targets the stored lane through the resolver (Hifz → Tajweed → Reviews)", async () => {
    const createRes = await executeMutation(CREATE_DOCUMENT, {
      input: { ...baseInput, title: `Lane Retarget ${Date.now()}`, balanceLane: "Hifz" },
    });
    const planId = trackCreatedPlan(Number(extractResultData(createRes)?.createPlan?.id));

    const toTajweed = await executeMutation(UPDATE_DOCUMENT, {
      id: String(planId),
      input: { balanceLane: "Tajweed" },
    });
    expect(toTajweed.errors).toBeUndefined();
    expect(extractResultData(toTajweed)?.updatePlan?.balanceLane).toBe("Tajweed");

    const toReviews = await executeMutation(UPDATE_DOCUMENT, {
      id: String(planId),
      input: { balanceLane: "Reviews" },
    });
    expect(toReviews.errors).toBeUndefined();
    expect(extractResultData(toReviews)?.updatePlan?.balanceLane).toBe("Reviews");
    expect((await PlanRepository.findById(planId))?.balanceLane).toBe("reviews");
  });

  test("updatePlan with an explicit null clears the stored lane", async () => {
    const createRes = await executeMutation(CREATE_DOCUMENT, {
      input: { ...baseInput, title: `Lane Null ${Date.now()}`, balanceLane: "Tajweed" },
    });
    const planId = trackCreatedPlan(Number(extractResultData(createRes)?.createPlan?.id));

    const clearRes = await executeMutation(UPDATE_DOCUMENT, {
      id: String(planId),
      input: { balanceLane: null },
    });
    expect(clearRes.errors).toBeUndefined();
    expect(extractResultData(clearRes)?.updatePlan?.balanceLane).toBeNull();
    expect((await PlanRepository.findById(planId))?.balanceLane).toBeNull();
  });

  test("updatePlan with the lane field absent leaves the stored lane untouched", async () => {
    const createRes = await executeMutation(CREATE_DOCUMENT, {
      input: { ...baseInput, title: `Lane Absent ${Date.now()}`, balanceLane: "Reviews" },
    });
    const planId = trackCreatedPlan(Number(extractResultData(createRes)?.createPlan?.id));

    const priceOnlyRes = await executeMutation(UPDATE_DOCUMENT, {
      id: String(planId),
      input: { price: "135.00" },
    });
    expect(priceOnlyRes.errors).toBeUndefined();
    expect(extractResultData(priceOnlyRes)?.updatePlan?.balanceLane).toBe("Reviews");
  });

  test("unknown lane member is rejected by GraphQL coercion and the stored lane survives", async () => {
    const createRes = await executeMutation(CREATE_DOCUMENT, {
      input: { ...baseInput, title: `Lane Forged ${Date.now()}`, balanceLane: "Hifz" },
    });
    const planId = trackCreatedPlan(Number(extractResultData(createRes)?.createPlan?.id));

    const forgedRes = await executeMutation(UPDATE_DOCUMENT, {
      id: String(planId),
      input: { balanceLane: "chess" },
    });

    // The wire enum vocabulary rejects the value before any resolver runs.
    expect(forgedRes.errors).toBeDefined();
    expect(JSON.stringify(forgedRes.errors)).toContain("balanceLane");
    expect((await PlanRepository.findById(planId))?.balanceLane).toBe("hifz");
  });
});
