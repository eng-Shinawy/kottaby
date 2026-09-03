/**
 * Admin-broadcast Pothos inputs — the compose surface of the admin broadcast
 * mutation. The inputs ship ahead of their resolver, matching the
 * notifications domain convention (schema types land first, the
 * mutation field follows).
 *
 * String-named `inputType` definitions per `backend/graphql/AGENTS.md`
 * (input-type exception) — NO local type shapes: the canonical compose
 * shapes live in `backend/types/notifications/broadcast.types.ts`
 * (`BroadcastAudienceSelector` + `BroadcastNotificationSubmitInput`), and
 * the resolver maps the validated GraphQL input onto them field-by-field.
 *
 * Closed-input posture (BOPLA-safe by construction):
 *  - `BroadcastAudienceInput` carries the discriminated `type` plus its
 *    three companion slots ONLY — no identity field of any kind, so a
 *    client can never name a recipient; the cohort is resolved
 *    server-side from the audience selector alone.
 *  - `AdminBroadcastNotificationInput` carries title/body/audience ONLY.
 *  - Any field beyond these whitelists dies as a GraphQL validation failure
 *    ("field not defined") before a resolver ever runs.
 *
 * Companion fields are optional and type-discriminated: which companion is
 * meaningful for the chosen `type` (and which combinations are coherent) is
 * enforced by the service's pre-DB coherence matrix — the schema layer only
 * guarantees the closed shape and the enum-backed `type`.
 */
import { gqlSchemaBuilder } from "@/backend/graphql/pothos/builder";
import { BroadcastAudienceTypePothosEnum, UserRolePothosEnum } from "@/backend/graphql/pothos/shared/enum.pothos";

/**
 * `BroadcastAudienceInput` — the type-discriminated audience selector.
 *
 *  - `type` (required) — the cohort kind, riding the registered
 *    {@link BroadcastAudienceTypePothosEnum} (unknown values are rejected at
 *    the GraphQL enum layer before a resolver ever runs).
 *  - `role` / `country` / `planId` — the companion slot of the `Role` /
 *    `Country` / `Plan` kinds respectively; optional and nullable on the
 *    wire. Country is an exact-match string (trim + length ceiling owned by
 *    the service boundary); planId is the plan whose active subscribers form
 *    the cohort (existence + positive-safe-int owned by the service).
 */
export const BroadcastAudienceInput = gqlSchemaBuilder.inputType("BroadcastAudienceInput", {
  fields: t => ({
    // Required cohort kind — the discriminator.
    type: t.field({ type: BroadcastAudienceTypePothosEnum, required: true }),
    // `Role` companion — the single targeted user role.
    role: t.field({ type: UserRolePothosEnum, required: false }),
    // `Country` companion — exact-match country string.
    country: t.string({ required: false }),
    // `Plan` companion — plan id whose active subscribers form the cohort.
    planId: t.int({ required: false }),
  }),
});

/**
 * `AdminBroadcastNotificationInput` — the compose payload: required title,
 * optional body, and the required audience selector. NO identity field of
 * any kind — recipients derive exclusively from the audience selector
 * evaluated server-side.
 */
export const AdminBroadcastNotificationInput = gqlSchemaBuilder.inputType("AdminBroadcastNotificationInput", {
  fields: t => ({
    // Required announcement title (trim + length ceiling owned by the
    // service boundary).
    title: t.string({ required: true }),
    // Optional body — nullable on the wire; stored verbatim when present.
    body: t.string({ required: false }),
    // Required audience selector.
    audience: t.field({ type: BroadcastAudienceInput, required: true }),
  }),
});
