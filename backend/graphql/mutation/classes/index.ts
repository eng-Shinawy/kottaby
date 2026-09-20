/**
 * Classes-domain mutation barrel — side-effect-imports every mutation file
 * in this sub-directory.
 *
 * Per `backend/graphql/mutation/AGENTS.md`:
 *  - Sub-directory barrels use SIDE-EFFECT imports only
 *    (`import "./x.mutation";`) — the imported file registers root mutation
 *    fields on `gqlSchemaBuilder` at import time and has no named exports.
 *  - The top-level `backend/graphql/mutation/index.ts` imports THIS barrel;
 *    `gqlSchema.ts` imports that top-level barrel exactly once.
 *  - `session-lifecycle.mutation.ts` registers `createSession`,
 *    `startSession`, `completeSession`, and `cancelSession` (plus the
 *    `resolveSessionDispute` arbitration entry, which dispatches the two
 *    dispute generations by outcome family).
 *  - `session-arbitration.mutation.ts` registers
 *    `openPostConfirmationDispute`.
 *  - `session-report.mutation.ts` registers `submitSessionReport`.
 *  - `student-evaluation.mutation.ts` registers `submitTeacherEvaluation`.
 *  - `admin-session-governance.mutation.ts` registers
 *    `adminRescheduleSession`, `adminCancelSession`,
 *    `adminReassignTeacher`, and `adminJoinSession`.
 *  - `recitation.mutation.ts` registers `setSessionRecitation`.
 *  - `lesson.mutation.ts` registers `createLesson`, `updateLesson`, and
 *    `deleteLesson` (Admin-only, delegating to `LessonService`).
 */
import "./admin-session-governance.mutation";
import "./lesson.mutation";
import "./recitation.mutation";
import "./session-arbitration.mutation";
import "./session-lifecycle.mutation";
import "./session-report.mutation";
import "./student-evaluation.mutation";
