/**
 * QA seed for the evaluation-rubric-scoring flow — provisions a small,
 * deterministic cast in the DEV postgres database so the evaluator UI can be
 * exercised end-to-end in a browser:
 *  - one certified evaluator (is_evaluator) with known credentials
 *  - one applicant held `in_evaluation`
 *  - five COMPLETED teacher_evaluation sessions owned by the evaluator
 *    (the pending rubric read + the row CTA render from exactly these)
 *
 * The provisioning itself lives in the SHARED fixtures helper
 * (`scripts/qa/fixtures/qaCast.ts`) so other QA entry points reuse the same
 * idempotent cast contract; this script is the thin orchestrator that runs
 * it and prints the credentials.
 *
 * Idempotent: re-running refreshes the same rows (unique qa_ emails).
 * Run: bun --env-file=.env scripts/qa/rubric-qa-seed.ts
 */
import {
  ensureRubricQaCast,
  QA_APPLICANT_EMAIL,
  QA_CAST_PASSWORD,
  QA_EVALUATOR_EMAIL,
} from "@/scripts/qa/fixtures/qaCast";

async function main(): Promise<void> {
  const cast = await ensureRubricQaCast();
  console.log(
    JSON.stringify({
      evaluator: { id: cast.evaluatorId, email: QA_EVALUATOR_EMAIL, password: QA_CAST_PASSWORD },
      applicant: { id: cast.applicantId, email: QA_APPLICANT_EMAIL, password: QA_CAST_PASSWORD },
      sessionCount: cast.sessionCount,
    })
  );
  process.exit(0);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
