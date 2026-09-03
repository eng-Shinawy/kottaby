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
 * payout mutation (`requestWithdrawal`, DEV3-013) and the admin plan-catalog
 * CRUD; `notifications/` wires the inbox read-latch mutations
 * (`markNotificationRead`, `markAllNotificationsRead`);
 * `user.mutation.ts` wires the caller-scoped profile mutations
 * (`updateMyLocale`).
 */
import "./auth.mutation";
import "./admin";
import "./billing";
import "./classes";
import "./notifications";
import "./plan-catalog.mutation";
import "./user.mutation";
