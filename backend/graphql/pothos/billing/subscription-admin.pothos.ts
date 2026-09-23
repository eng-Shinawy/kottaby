/**
 * Admin subscription-management Pothos inputs — `ExtendSubscriptionInput`
 * + `RenewSubscriptionInput` + `CancelSubscriptionInput` +
 * `ChangeSubscriptionPlanInput` — plus the plan-change payload object
 * `ChangeSubscriptionPlanPayload` (the NEW row + the applied proration
 * settlement).
 *
 * Input types are the GraphQL schema's BOPLA boundary: the whitelist
 * carries exactly the fields the service accepts, so smuggled fields die
 * at GraphQL validation before a resolver ever runs. The wire
 * `subscriptionId` stays an `ID` and is coerced to the numeric row key
 * through the service's strict numeric parse; `days` is re-validated
 * server-side (whole number ≥ 1) — the GraphQL `Int` type alone does not
 * enforce the positivity floor for non-GraphQL callers.
 *
 * String-named `inputType` per the AGENTS input pattern (never
 * `inputRef<BackendType>`); registered ahead of its resolver module
 * through the billing Pothos barrel. The mutations return the existing
 * canonical `StudentSubscription` object — no new object type exists for
 * the admin surface.
 *
 * `RenewSubscriptionInput` carries the expired-source selector only: the
 * renewal's plan snapshot, window arithmetic, credit lane, and the
 * server-constructed idempotency claim are all derived server-side from
 * the source row and its fresh plan read, so the wire payload has
 * nothing else to smuggle.
 *
 * `CancelSubscriptionInput` carries the active-source selector plus an
 * OPTIONAL free-text reason: the flip is balance-preserving (no lane
 * field exists to smuggle), and the reason is trimmed and bounded
 * server-side before it can reach the audit trail — the wire length is
 * advisory only.
 *
 * `ChangeSubscriptionPlanInput` carries the active-source selector and
 * the target plan id ONLY: the proration direction, the carry/forfeit
 * arithmetic, the same-lane compatibility, and the server-constructed
 * `planChange:<sourceId>:<targetPlanId>` idempotency claim are all
 * derived server-side — the payload cannot claim a direction or a session
 * amount. The payload object composes the canonical `StudentSubscription`
 * (single canonical object type — no new subscription shape) with the
 * registered `ProrationDirection` enum and the two integer settlement
 * fields.
 */

import { SubscriptionPothosObject } from "@/backend/graphql/pothos/billing/subscription.pothos";
import { gqlSchemaBuilder } from "@/backend/graphql/pothos/builder";
import { ProrationDirectionPothosEnum } from "@/backend/graphql/pothos/shared/enum.pothos";
import { CANCEL_REASON_MAX_LENGTH } from "@/backend/services/billing/subscription-admin.helpers";
import type { ChangeSubscriptionPlanResult } from "@/backend/types";

/**
 * Input for the `adminExtendSubscription` mutation.
 */
export const ExtendSubscriptionInput = gqlSchemaBuilder.inputType("ExtendSubscriptionInput", {
  description: "Input for extending an active subscription's validity window.",
  fields: t => ({
    subscriptionId: t.id({
      required: true,
      description: "ID of the subscription row to extend.",
    }),
    days: t.int({
      required: true,
      description: "Whole number of days to add to the window's current end (>= 1, server-validated).",
    }),
  }),
});

/**
 * Input for the `adminRenewSubscription` mutation.
 */
export const RenewSubscriptionInput = gqlSchemaBuilder.inputType("RenewSubscriptionInput", {
  description: "Input for renewing an expired subscription into a fresh active period.",
  fields: t => ({
    subscriptionId: t.id({
      required: true,
      description: "ID of the expired subscription row to renew.",
    }),
  }),
});

/**
 * Input for the `adminCancelSubscription` mutation. The reason is
 * optional free text — trimmed and length-bounded server-side before it
 * reaches the audit trail, so the wire value is advisory only. The
 * documented bound is composed from the service's own
 * `CANCEL_REASON_MAX_LENGTH` constant — the single source of truth the
 * server-side bound enforces (the description can never drift from it).
 */
export const CancelSubscriptionInput = gqlSchemaBuilder.inputType("CancelSubscriptionInput", {
  description: "Input for cancelling an active subscription while preserving its balance lanes.",
  fields: t => ({
    subscriptionId: t.id({
      required: true,
      description: "ID of the active subscription row to cancel.",
    }),
    reason: t.string({
      required: false,
      description:
        "Optional free-text reason for the cancellation (trimmed and bounded to " +
        `${CANCEL_REASON_MAX_LENGTH} characters server-side).`,
    }),
  }),
});

/**
 * Input for the `adminChangeSubscriptionPlan` mutation. The target plan
 * must be active and credit the same balance lane — both properties are
 * SERVER-guarded (the wire carries only the two ids), and the proration
 * is derived server-side from the two plan rows and the student's current
 * lane balance.
 */
export const ChangeSubscriptionPlanInput = gqlSchemaBuilder.inputType("ChangeSubscriptionPlanInput", {
  description: "Input for changing an active subscription onto a different plan in the same balance lane.",
  fields: t => ({
    subscriptionId: t.id({
      required: true,
      description: "ID of the active subscription row to re-plan.",
    }),
    newPlanId: t.id({
      required: true,
      description: "ID of the target plan (must be active and credit the same balance lane; server-guarded).",
    }),
  }),
});

/**
 * Payload for the `adminChangeSubscriptionPlan` mutation: the NEW active
 * subscription row plus the proration settlement the change applied. On a
 * replayed duplicate the row is the FIRST change's result and the
 * carry/forfeit integers report zero (the replayed call moved nothing —
 * the original arithmetic lives in the committed audit row).
 */
export const ChangeSubscriptionPlanPayload = gqlSchemaBuilder
  .objectRef<ChangeSubscriptionPlanResult>("ChangeSubscriptionPlanPayload")
  .implement({
    description: "Result of an admin plan change: the new subscription row and the applied proration settlement.",
    fields: t => ({
      subscription: t.field({
        type: SubscriptionPothosObject,
        description: "The NEW active subscription row on the target plan (the first change's row on a replay).",
        resolve: parent => parent.subscription,
      }),
      direction: t.expose("direction", {
        type: ProrationDirectionPothosEnum,
        description:
          "Derived direction from the two plans' per-session unit values (a unit-value tie breaks on session count).",
      }),
      carrySessions: t.exposeInt("carrySessions", {
        description:
          "Sessions carried on top of the target plan's full session count (upgrades only; zero on downgrades and replays).",
      }),
      forfeitedSessions: t.exposeInt("forfeitedSessions", {
        description:
          "Remaining sessions forfeited by a downgrade (zero on upgrades and replays) — ids/ints vocabulary mirrors the audit row.",
      }),
    }),
  });
