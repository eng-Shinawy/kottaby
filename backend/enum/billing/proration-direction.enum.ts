/**
 * ProrationDirection enum — the derived direction of an admin plan
 * change, computed from the two plans' per-session unit value. Values
 * are canonical (GraphQL `ProrationDirection` enum). An upgrade carries
 * the prorated remainder on top of the new plan's session count; a
 * downgrade credits the new plan's session count only and forfeits the
 * excess.
 */
export enum ProrationDirection {
  Upgrade = "upgrade",
  Downgrade = "downgrade",
}
