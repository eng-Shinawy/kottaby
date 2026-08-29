import { seedOrGetPlanCatalog } from "@/backend/db/seeds/billing";
import {
  loadSeedConfig,
  logFailedSeedSteps,
  runSeedStep,
  type SeedConfig,
  type SeedStepResult,
} from "@/backend/db/seeds/lib";
import { seedOrGetUsers } from "@/backend/db/seeds/users";
import { logger } from "@/backend/lib/logger";

export async function runAllSeeds(config?: SeedConfig): Promise<void> {
  const seedConfig = config ?? loadSeedConfig();
  logger.info(`Starting database seeding (profile: ${seedConfig.profile})...`);

  const stepResults: SeedStepResult[] = [];

  // Step 1: Users (Admin, Teacher Applicant, Parent, Student)
  const usersStep = await runSeedStep("users", () => seedOrGetUsers(seedConfig));
  stepResults.push(usersStep);

  // Step 2: Billing plan catalog (demo plans — no user/role dependency;
  // bootstraps exclusively through PlanCatalogService, idempotent by title)
  const planCatalogStep = await runSeedStep("plan-catalog", () => seedOrGetPlanCatalog(seedConfig));
  stepResults.push(planCatalogStep);

  logFailedSeedSteps(stepResults);

  const failedCount = stepResults.filter(s => !s.ok).length;
  if (failedCount > 0) {
    throw new Error(`Seeding finished with ${failedCount} failed step(s).`);
  }

  logger.info("All seed steps executed successfully.");
}
