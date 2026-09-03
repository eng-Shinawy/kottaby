/**
 * Scheduling-domain shared GraphQL documents barrel.
 *
 * Re-exports the session lifecycle + dispute documents (DEV3-004 +
 * DEV3-005): the participant reads (`sessionById`, `myStudentSessions`,
 * `myTeacherSessions`), the lifecycle mutation quartet (`createSession`,
 * `startSession`, `completeSession`, `cancelSession`) and the DEV3-005
 * dispute trio (`openSessionDispute`, `resolveSessionDispute`,
 * `adminDisputedSessions`).
 */
export * from "./session.documents";
