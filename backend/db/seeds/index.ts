import { seedOrGetPlans } from "@/backend/db/seeds/billing";
import { seedOrGetLessons } from "@/backend/db/seeds/classes";
import {
  loadSeedConfig,
  logFailedSeedSteps,
  runSeedStep,
  type SeedConfig,
  type SeedStepResult,
} from "@/backend/db/seeds/lib";
import { seedOrGetStudents } from "@/backend/db/seeds/students";
import { getDemoAdminActorId, seedOrGetUsers } from "@/backend/db/seeds/users";
import { SubscriptionCreditLane } from "@/backend/enum/billing/subscription-credit-lane.enum";
import { logger } from "@/backend/lib/logger";

export async function runAllSeeds(config?: SeedConfig): Promise<void> {
  const seedConfig = config ?? loadSeedConfig();
  logger.info(`Starting database seeding (profile: ${seedConfig.profile})...`);

  const stepResults: SeedStepResult[] = [];

  // Step 1: Users (Admin, Teacher Applicant, Parent, Student)
  const usersStep = await runSeedStep("users", () => seedOrGetUsers(seedConfig));
  stepResults.push(usersStep);

  // Resolve the demo admin actor from the users domain (read-only lookup) and
  // thread it into the admin-gated plans seeder — controller-context rule in
  // seeds/AGENTS.md: cross-seeder dependencies are wired HERE, never inside
  // the consuming seeder (no auth/provisioning fallbacks in domain seeders).
  const adminActorId = await getDemoAdminActorId();

  // Step 2: Plans (Catalog plans + verification plan + deactivated demo plan)
  const plansStep = await runSeedStep("plans", () => seedOrGetPlans("en", adminActorId));
  stepResults.push(plansStep);

  // Step 3: Lessons (starter Tajweed curriculum on the seeded Tajweed plan).
  // The Tajweed plan row is threaded from the plans-step result —
  // controller-context rule in seeds/AGENTS.md: cross-seeder dependencies are
  // wired HERE, never inside the consuming seeder (no seed-data lookups in
  // domain seeders). A missing row (plans step failed) is recorded as a
  // failed "lessons" step so the final summary reports both.
  const tajweedPlan = plansStep.value?.find(plan => plan.balanceLane === SubscriptionCreditLane.Tajweed);

  const lessonsStep = await runSeedStep("lessons", () => {
    if (!tajweedPlan) {
      throw new Error("Tajweed plan missing from the plans seeding result.");
    }
    return seedOrGetLessons("en", adminActorId, tajweedPlan.id);
  });
  stepResults.push(lessonsStep);

  // Step 4: Demo student trial-grant reconcile. Receives the users-step result
  // so the created demo student(s) are passed through explicitly; the seeder
  // falls back to the shared demo-user specs for rows that already existed
  // (the users-step result only contains newly created users) and applies the
  // production grant entry point only to rows whose trial marker is still null.
  const studentsStep = await runSeedStep("students", () => seedOrGetStudents(usersStep.value ?? []));
  stepResults.push(studentsStep);

  logFailedSeedSteps(stepResults);

  const failedCount = stepResults.filter(s => !s.ok).length;
  if (failedCount > 0) {
    throw new Error(`Seeding finished with ${failedCount} failed step(s).`);
  }

  logger.info("All seed steps executed successfully.");
}
