/**
 * Balance-lane form vocabulary — the ONE plan-form source of the
 * `SubscriptionCreditLane` members. The admin plan form's lane select
 * (`PlanFormFields`) and its raw-value → wire-enum lookup (`usePlanForm`)
 * both derive from this module, so the form can never drift from the
 * generated wire enum: a lane joining or leaving `SubscriptionCreditLane`
 * fails the compile right here.
 */

import { SubscriptionCreditLane } from "@/frontend/graphql/generated/gql/graphql";

/**
 * The lane members in catalog order (memorization → recitation rules →
 * review), `as const` and typed against the generated enum — a non-member
 * literal in this tuple is a compile error, exactly like the
 * `readonly (keyof Labels)[]` reuse-set idiom.
 */
const BALANCE_LANE_MEMBERS = [
  SubscriptionCreditLane.Hifz,
  SubscriptionCreditLane.Tajweed,
  SubscriptionCreditLane.Reviews,
] as const satisfies readonly SubscriptionCreditLane[];

type BalanceLaneMember = (typeof BALANCE_LANE_MEMBERS)[number];

/**
 * Compile-time exhaustiveness gate over the tuple: `Exclude` collapses to
 * `never` exactly when every enum member appears in the tuple. While that
 * holds, the map below gets its normal lookup type; the moment a lane joins
 * or leaves the enum without the tuple being updated, the annotation
 * collapses to the (unassignable) self-documenting diagnostic and the
 * compile fails at this single vocabulary source.
 */
type BalanceLaneVocabulary =
  Exclude<SubscriptionCreditLane, BalanceLaneMember> extends never
    ? Readonly<Record<string, SubscriptionCreditLane>>
    : "BALANCE_LANE_MEMBERS must list every SubscriptionCreditLane member";

/**
 * Raw form value → wire enum, DERIVED from the tuple above (never a second
 * hand-written copy). Annotated {@link BalanceLaneVocabulary}: the lookup
 * accepts any raw string (the select's pre-pick state is `""`) and answers
 * `SubscriptionCreditLane | undefined` — no assertions, no per-key typing.
 */
const BALANCE_LANE_BY_VALUE: BalanceLaneVocabulary = BALANCE_LANE_MEMBERS.reduce<
  Record<string, SubscriptionCreditLane>
>((map, member) => {
  // Accumulator mutation (not spread) — the no-accumulating-spread rule.
  map[member] = member;
  return map;
}, {});

/** The select's options — the SAME tuple members, in catalog order. */
const BALANCE_LANE_OPTIONS: readonly SubscriptionCreditLane[] = BALANCE_LANE_MEMBERS;

export { BALANCE_LANE_BY_VALUE, BALANCE_LANE_OPTIONS };
