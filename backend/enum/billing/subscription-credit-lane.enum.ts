/**
 * SubscriptionCreditLane enum — mirrors the `subscription_credit_lane`
 * pgEnum in `backend/db/schema/enums.ts`. Values are canonical.
 * Names the single student balance lane a plan credits on activation:
 * `hifz` and `tajweed` are the memorization lesson lanes and `reviews`
 * is the revision-session lane. A plan without a lane fails closed at
 * purchase instead of crediting a guessed lane.
 */
export enum SubscriptionCreditLane {
  Hifz = "hifz",
  Tajweed = "tajweed",
  Reviews = "reviews",
}
