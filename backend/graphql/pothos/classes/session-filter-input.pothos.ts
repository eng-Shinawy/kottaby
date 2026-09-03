/**
 * SessionListFilterInput — Pothos input type for the participant session
 * list filters (plan §3.1 SDL: `input SessionListFilterInput { status:
 * SessionStatus }`).
 *
 * Contract:
 *  - Backed by the canonical `SessionListFilterInput` from `@/backend/types`
 *    (single-source discipline — no local type is declared here; the Pothos
 *    field shape is a structural map of that backend type, per the Input
 *    Exception Policy in `backend/graphql/AGENTS.md`).
 *  - `status` is the ONLY member: an absent/null member drops out at the
 *    service guard (`SessionLifecycleService.guardStatusFilter`) — filters
 *    never error. The `SessionStatusPothosEnum` type rejects
 *    out-of-vocabulary values at GraphQL validation, before any resolver
 *    runs; the service guard remains the fail-closed backstop for
 *    `undefined`/`null` members.
 *  - Registered on the shared builder at import time; imported by the
 *    session query module (`backend/graphql/query/classes/
 *    session-lifecycle.query.ts`), whose transitive registration wires it
 *    into the production schema through the `gqlSchema.ts` side-effect
 *    chain. Deliberately NOT registered anywhere else (single canonical
 *    input definition).
 */
import { gqlSchemaBuilder } from "@/backend/graphql/pothos/builder";
import { SessionStatusPothosEnum } from "@/backend/graphql/pothos/shared/enum.pothos";

/** Input type for the participant session list filters (REQ-020). */
export const SessionListFilterPothosInput = gqlSchemaBuilder.inputType("SessionListFilterInput", {
  fields: t => ({
    // Optional lifecycle filter — absent/null drops out (never errors).
    status: t.field({ type: SessionStatusPothosEnum, required: false }),
  }),
});
