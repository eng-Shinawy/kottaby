/**
 * Top-level mutation barrel — side-effect imports every mutation file.
 *
 * Per `backend/graphql/mutation/AGENTS.md`:
 *  - `gqlSchema.ts` imports this module exactly once: `import "@/backend/graphql/mutation";`.
 *  - Each entry is a side-effect import — the imported file registers root
 *    mutation fields on `gqlSchemaBuilder` at import time. They have no
 *    named exports.
 *  - To add a new mutation: create `<entity>.mutation.ts` and add a
 *    side-effect import here.
 *
 * `auth.mutation.ts` wires the auth mutations (`registerUser`, `login`,
 * `refreshToken`, `logout`); `admin/` wires the admin user-management
 * mutations; the `classes` sub-directory barrel wires the session lifecycle
 * mutations (`createSession`, `startSession`, `completeSession`,
 * `cancelSession`); the `billing` sub-directory barrel wires the wallet
 * payout mutation (`requestWithdrawal`), the admin plan-catalog CRUD,
 * and the admin subscription lifecycle mutations (`adminExtendSubscription`,
 * `adminRenewSubscription`, `adminCancelSubscription`,
 * `adminChangeSubscriptionPlan`); `notifications/` wires the inbox read-latch mutations
 * (`markNotificationRead`, `markAllNotificationsRead`);
 * `subscription-purchase.mutation.ts` wires the student purchase mutation
 * (`purchaseSubscription`); `user.mutation.ts` wires the caller-scoped
 * profile mutations (`updateMyLocale`);
 * `verification-plan-purchase.mutation.ts` wires the teacher-applicant
 * verification purchase mutation (`purchaseVerificationPlan` — inputless;
 * identity from the session, plan resolved server-side);
 * `evaluation-booking.mutation.ts` wires the teacher-applicant evaluation
 * booking mutation (`bookEvaluationSession` — one sealed input field, the
 * evaluator id; identity from the session, every stored column derived
 * server-side).
 */
import "./auth.mutation";
import "./admin";
import "./billing";
import "./classes";
import "./evaluation-booking.mutation";
import "./notifications";
import "./parents";
import "./plan-catalog.mutation";
import "./subscription-purchase.mutation";
import "./user.mutation";
import "./verification-plan-purchase.mutation";
