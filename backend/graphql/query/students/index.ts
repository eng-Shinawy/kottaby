/**
 * Students-domain query barrel — side-effect-imports every query file in
 * this sub-directory.
 *
 * Per `backend/graphql/query/AGENTS.md`:
 *  - Sub-directory barrels use SIDE-EFFECT imports only
 *    (`import "./x.query";`) — the imported file registers root query fields
 *    on `gqlSchemaBuilder` at import time and has no named exports.
 *  - The top-level `backend/graphql/query/index.ts` imports THIS barrel;
 *    `gqlSchema.ts` imports that top-level barrel exactly once.
 *  - `handshake-code.query.ts` registers `myHandshakeCode` and
 *    `findStudentByHandshakeCode`.
 *  - `homework.query.ts` registers `myHomework` (the student's own paged
 *    homework history).
 *  - `session-balance.query.ts` registers `mySessionBalance` (the
 *    student's own prepaid session-credit lanes).
 */
import "./handshake-code.query";
import "./homework.query";
import "./session-balance.query";
