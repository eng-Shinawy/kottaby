/**
 * Plan catalog input objects — `CreatePlanInput` + `UpdatePlanInput`.
 *
 * BOPLA boundary at the SDL layer (REQ-011/REQ-013/REQ-014/REQ-015):
 *  - Both inputs carry EXACTLY the five caller-editable commercial fields —
 *    `title`, `sessionCount`, `price`, `currency`, `intervalDays` — and
 *    NOTHING else. The server-controlled lifecycle/identity/bookkeeping
 *    columns (`id`, `isActive`, `deactivatedAt`, `createdAt`, `updatedAt`)
 *    are STRUCTURALLY ABSENT from the input surface, so a caller can never
 *    even express them on the wire — GraphQL validation rejects any attempt
 *    (unknown input field) before a resolver runs. The service layer keeps
 *    the runtime BOPLA boundary (explicit field-by-field mapping); this file
 *    is the schema-layer half of that defense.
 *  - `price` is a decimal STRING (`t.string`) — the drizzle `decimal` column
 *    maps to `string` at the type boundary and REQ-013 forbids `Float`
 *    anywhere in the plan contract (binary floats corrupt monetary values).
 *  - `CreatePlanInput` — all five fields REQUIRED: the service's
 *    `validatePlanInput` runs the requireAll contract, so a creation payload
 *    missing any field is a validation violation, not a silent default.
 *  - `UpdatePlanInput` — the same five fields ALL OPTIONAL (`required:
 *    false`): the service validates only the supplied keys and rejects an
 *    entirely-empty patch (`planPatchEmpty`). Empty-patch absence is
 *    expressible ({}), which is exactly what lets the service own that
 *    contract — the input layer does not duplicate it.
 *
 * Input-ref idiom (mirrors `backend/graphql/pothos/auth/register-input.pothos.ts`):
 *  - Named exports of `gqlSchemaBuilder.inputType(...)` refs — the ONLY
 *    pothos files with named exports are refs consumed by query/mutation
 *    files via `t.arg({ type: ... })`.
 *  - No barrel import is required: `plan-catalog.mutation.ts` imports this
 *    file directly, which registers both inputs before `toSchema()` runs.
 */

import { gqlSchemaBuilder } from "@/backend/graphql/pothos/builder";

/** Input type for the admin `createPlan` mutation — all fields required. */
export const CreatePlanInput = gqlSchemaBuilder.inputType("CreatePlanInput", {
  fields: t => ({
    title: t.string({ required: true }),
    sessionCount: t.int({ required: true }),
    // Decimal string — exact decimal semantics; Float is prohibited (REQ-013).
    price: t.string({ required: true }),
    currency: t.string({ required: true }),
    intervalDays: t.int({ required: true }),
  }),
});

/** Input type for the admin `updatePlan` mutation — all fields optional. */
export const UpdatePlanInput = gqlSchemaBuilder.inputType("UpdatePlanInput", {
  fields: t => ({
    title: t.string({ required: false }),
    sessionCount: t.int({ required: false }),
    price: t.string({ required: false }),
    currency: t.string({ required: false }),
    intervalDays: t.int({ required: false }),
  }),
});
