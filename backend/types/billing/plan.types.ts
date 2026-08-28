import type { plans } from "@/backend/db/schema/billing/plans";

export type PlanSelectType = typeof plans.$inferSelect;
export type PlanInsertType = typeof plans.$inferInsert;

/**
 * Canonical API-facing plan shape. Plans carry no forbidden fields, so the
 * return type keeps the select shape unchanged — deepened to read-only so a
 * returned plan can never be mutated in place. Wrapping PlanSelectType (rather
 * than aliasing it) keeps every future field exclusion on the select type
 * flowing into the return type.
 */
export type PlanReturnType = Readonly<PlanSelectType>;

/**
 * Client-submittable plan creation payload. Lifecycle and bookkeeping columns
 * are server-controlled and structurally absent; `price` is a decimal string
 * so exact decimal semantics survive every transport boundary.
 */
export interface PlanSubmitInput {
  readonly title: string;
  readonly sessionCount: number;
  readonly price: string;
  readonly currency: string;
  readonly intervalDays: number;
}

/**
 * Partial plan mutation payload; each field independently optional.
 */
export type PlanUpdateInput = {
  readonly [K in keyof PlanSubmitInput]?: PlanSubmitInput[K];
};
