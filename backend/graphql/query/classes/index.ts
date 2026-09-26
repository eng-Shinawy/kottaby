/**
 * `classes` query-domain barrel — side-effect imports every query file in
 * this sub-directory.
 *
 * Per `backend/graphql/query/AGENTS.md`:
 *  - Each entry is a side-effect import — the imported file registers root
 *    query fields on `gqlSchemaBuilder` at import time. They have no named
 *    exports.
 *  - The top-level `backend/graphql/query/index.ts` imports THIS barrel;
 *    `gqlSchema.ts` imports the top-level barrel exactly once.
 *  - `session-lifecycle.query.ts` registers `sessionById`,
 *    `myStudentSessions`, `myTeacherSessions`, and
 *    `adminDisputedSessions`.
 *  - `session-arbitration.query.ts` registers `adminDisputeCase`.
 *  - `admin-session-governance.query.ts` registers `adminSessions` and
 *    `adminSession`.
 *  - `lesson.query.ts` registers `planLessons`.
 *  - `student-progress.query.ts` registers `studentProgress`.
 */
import "./admin-session-governance.query";
import "./lesson.query";
import "./recitation.query";
import "./session-arbitration.query";
import "./session-lifecycle.query";
import "./session-report.query";
import "./student-progress.query";
