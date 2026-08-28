import type { SeedConfig } from "@/backend/db/seeds/lib";
import { INITIAL_DEMO_USERS } from "@/backend/db/seeds/users";
import { logger } from "@/backend/lib/logger";
import { StudentTrialService } from "@/backend/services/students/student-trial.service";

/**
 * Trial-grant state for a single demo student resolved by the seed step.
 *
 * `trialGrantedAt` mirrors the live marker on the `students` row at the moment
 * the seed looked it up; `null` means the grant has not yet been applied and
 * the seed step is responsible for invoking the production grant entry point.
 */
interface ResolvedTrialState {
  email: string;
  studentId: number;
  trialGrantedAt: Date | null;
}

/**
 * Demo student seeder — reconciles the one-time free-trial grant for every
 * demo student declared in `INITIAL_DEMO_USERS` through the production student
 * trial provisioning service.
 *
 * The grant is invoked ONLY when the student row's `trialGrantedAt` marker is
 * `null`. On re-runs the marker is already set, so the seed step skips the
 * grant and remains a no-op — never surfacing a re-grant conflict. Demo user
 * creation itself stays owned by the user seeder; this step assumes those rows
 * already exist by the time it runs and only reconciles the trial lane.
 *
 * @param _config  Optional seed configuration accepted for orchestration
 *     parity with the master controller's `runSeedStep` wrapper. This step
 *     reads no configuration values — the demo student email list comes from
 *     the user-seed module and a stable locale is used for any localized
 *     grant-rejection diagnostics.
 */
export async function seedOrGet(_config?: SeedConfig): Promise<ResolvedTrialState[]> {
  const locale = "en";
  const demoStudentSpecs = INITIAL_DEMO_USERS.filter(spec => spec.role === "student");

  logger.info(`Reconciling trial grant for ${demoStudentSpecs.length} demo student(s)...`);

  const resolved: ResolvedTrialState[] = [];

  // Sequential reduce keeps the reconcile order stable and matches the
  // user-seed module's iteration discipline; demo student counts stay small
  // so parallelism would not buy meaningful throughput here.
  await demoStudentSpecs.reduce<Promise<void>>(async (previous, spec) => {
    await previous;

    // Find step: resolve the existing student row by login email through the
    // production service entry point so the seed never touches balance columns
    // directly. Returns `null` when the user is missing or is not a student.
    const state = await StudentTrialService.findTrialGrantStateByEmail(spec.email);
    if (!state) {
      logger.info(`Demo student row not found, skipping trial reconcile: ${spec.email}`);
      return;
    }

    if (state.trialGrantedAt === null) {
      // Grant-if-null: the marker is unset, so invoke the canonical grant
      // entry point. The grant's atomic guarded UPDATE guarantees one-time
      // application; the prior `null` check keeps this branch from firing on
      // idempotent re-runs.
      await StudentTrialService.grantFreeTrial(state.studentId, locale);
      logger.info(`Granted free trial to demo student: ${spec.email}`);
    } else {
      // If-not-null skip: the grant was already applied (typically inside the
      // registration transaction during the user-seed step). Skip silently so
      // the seed run stays idempotent across multiple invocations.
      logger.info(`Demo student already has trial grant, skipping: ${spec.email}`);
    }

    resolved.push({ email: spec.email, studentId: state.studentId, trialGrantedAt: state.trialGrantedAt });
  }, Promise.resolve());

  logger.info(`Demo student trial reconcile completed (${resolved.length} student(s) processed).`);
  return resolved;
}
