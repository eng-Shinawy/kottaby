/**
 * Plan Catalog Seeder — seeds initial demo subscription plans.
 *
 * Implements REQ-019, REQ-021.
 * Consumes PlanCatalogService exclusively (zero raw DB imports).
 * Idempotent via title matching.
 */

import { ConflictError } from "@/backend/lib/errors";
import { logger } from "@/backend/lib/logger";
import { PlanCatalogService } from "@/backend/services/billing/plan-catalog.service";
import type { DBTransaction, PlanReturnType, PlanSubmitInput } from "@/backend/types";

export interface DemoPlanSpec extends PlanSubmitInput {
  readonly shouldBeActive?: boolean;
}

export const INITIAL_DEMO_PLANS: readonly DemoPlanSpec[] = [
  {
    title: "Hifz Jadid (Memorization)",
    sessionCount: 12,
    price: "450.00",
    currency: "EGP",
    intervalDays: 30,
    shouldBeActive: true,
  },
  {
    title: "Tajweed & Tilawa",
    sessionCount: 8,
    price: "300.00",
    currency: "EGP",
    intervalDays: 30,
    shouldBeActive: true,
  },
  {
    title: "New Teacher Verification & Evaluation Plan",
    sessionCount: 5,
    price: "150.00",
    currency: "EGP",
    intervalDays: 14,
    shouldBeActive: true,
  },
  {
    title: "Legacy Trial Plan",
    sessionCount: 4,
    price: "100.00",
    currency: "EGP",
    intervalDays: 7,
    shouldBeActive: false,
  },
] as const;

/**
 * Reads the existing plan matching `title` from a fresh admin listing.
 * Used by the create-race recovery path below.
 */
async function findPlanByTitle(title: string, locale: string, tx?: DBTransaction): Promise<PlanReturnType | undefined> {
  const plans = await PlanCatalogService.listForAdmin({ includeInactive: true }, locale, tx);
  return plans.find(p => p.title === title);
}

export async function seedOrGet(locale = "en", tx?: DBTransaction): Promise<PlanReturnType[]> {
  logger.info("Seeding plan catalog via PlanCatalogService...");
  const existingPlans = await PlanCatalogService.listForAdmin({ includeInactive: true }, locale, tx);
  const existingByTitle = new Map(existingPlans.map(p => [p.title, p]));

  const results: PlanReturnType[] = [];

  await INITIAL_DEMO_PLANS.reduce<Promise<void>>(async (previous, planSpec) => {
    await previous;
    let plan = existingByTitle.get(planSpec.title);
    if (!plan) {
      try {
        plan = await PlanCatalogService.createPlan(
          {
            title: planSpec.title,
            sessionCount: planSpec.sessionCount,
            price: planSpec.price,
            currency: planSpec.currency,
            intervalDays: planSpec.intervalDays,
          },
          locale,
          tx
        );
        logger.info(`Seeded new plan "${plan.title}" (ID: ${plan.id})`);
      } catch (error) {
        // Race recovery (seeds/AGENTS.md "seed or get" pattern): a concurrent
        // seed process may create the same title between our look and create.
        // Only the expected duplicate-title ConflictError is absorbed — any
        // other failure keeps propagating to `runAllSeeds`.
        if (!(error instanceof ConflictError)) {
          throw error;
        }
        if (tx) {
          // A uniqueness violation aborts the supplied transaction (any
          // further statement would fail with 25P02), and a single
          // transaction cannot race itself — true cross-process seeding
          // always runs without a tx. Recovery is therefore only meaningful
          // (and only possible) on the pooled non-tx path; fail fast with
          // the real ConflictError instead of a confusing aborted-tx error.
          throw error;
        }
        logger.warn(`Seed race on plan "${planSpec.title}" — recovering via re-read`);
        const raced = await findPlanByTitle(planSpec.title, locale, tx);
        if (!raced) {
          throw error;
        }
        plan = raced;
      }
    }

    if (planSpec.shouldBeActive === false && plan.isActive) {
      plan = await PlanCatalogService.setPlanActiveStatus(plan.id, false, locale, tx);
      logger.info(`Deactivated plan "${plan.title}" (ID: ${plan.id})`);
    }

    results.push(plan);
  }, Promise.resolve());

  return results;
}
