import { INITIAL_DEMO_USERS } from "@/backend/db/seeds/users";
import { ConflictError } from "@/backend/lib/errors";
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
 * grant and remains a no-op. If a concurrent seed run grants the trial between
 * the marker read and the grant call, the resulting `ConflictError` is caught
 * and treated as an idempotent success (the student now has the grant either
 * way). Demo user creation itself stays owned by the user seeder; this step
 * assumes those rows already exist by the time it runs.
 */
export async function seedOrGet(): Promise<ResolvedTrialState[]> {
  const locale = "en";
  const demoStudentSpecs = INITIAL_DEMO_USERS.filter(spec => spec.role === "student");

  logger.info(`Reconciling trial grant for ${demoStudentSpecs.length} demo student(s)...`);

  const resolved: ResolvedTrialState[] = [];

  await demoStudentSpecs.reduce<Promise<void>>(async (previous, spec) => {
    await previous;

    const state = await StudentTrialService.findTrialGrantStateByEmail(spec.email);
    if (!state) {
      logger.info("Demo student row not found, skipping trial reconcile");
      return;
    }

    if (state.trialGrantedAt === null) {
      try {
        await StudentTrialService.grantFreeTrial(state.studentId, locale);
        logger.info("Granted free trial to demo student");
      } catch (err) {
        if (err instanceof ConflictError) {
          const rechecked = await StudentTrialService.findTrialGrantStateByEmail(spec.email);
          if (rechecked?.trialGrantedAt) {
            logger.info("Demo student trial grant confirmed after concurrent grant");
          } else {
            throw err;
          }
        } else {
          throw err;
        }
      }
    } else {
      logger.info("Demo student already has trial grant, skipping");
    }

    resolved.push({ studentId: state.studentId, trialGrantedAt: state.trialGrantedAt });
  }, Promise.resolve());

  logger.info(`Demo student trial reconcile completed (${resolved.length} student(s) processed).`);
  return resolved;
}
