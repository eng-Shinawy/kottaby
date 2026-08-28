/**
 * Type-Level Conformance Suite — billing plan catalog.
 * Validated by `bun tsgo` (the compiler is the test runner).
 * `.test-d.ts` suffix = outside bun test runner glob.
 *
 * POSITIVES use `satisfies` — must compile.
 * NEGATIVES use `@ts-expect-error` directly before the offending line.
 */
import type {
  PlanReturnType,
  PlanSelectType,
  PlanSubmitInput,
  PlanUpdateInput,
} from "@/backend/types/billing/plan.types";

// Helper to consume variables for TS6133
const v = (x: unknown): boolean => Boolean(x);

// ========== POSITIVES (must compile) ==========

// Positive — PlanReturnType is the PlanSelectType (identity); resolves to `true`
const planReturnTypeIsSelectType: [PlanSelectType] extends [PlanReturnType]
  ? [PlanReturnType] extends [PlanSelectType]
    ? true
    : never
  : never = true;
v(planReturnTypeIsSelectType);

// Positive — minimal valid submit payload
v({
  title: "Hifz Intensive",
  sessionCount: 8,
  price: "250.00",
  currency: "EGP",
  intervalDays: 30,
} satisfies PlanSubmitInput);

// Positive — partial update payload
v({ price: "275.50" } satisfies PlanUpdateInput);

// Positive — full update payload (all fields optional independently)
v({
  title: "Hifz Intensive",
  sessionCount: 12,
  price: "300.00",
  currency: "EGP",
  intervalDays: 30,
} satisfies PlanUpdateInput);

// ========== NEGATIVES (@ts-expect-error immediately before the error) ==========

// Negative — isActive server-controlled
v({
  title: "T",
  sessionCount: 1,
  price: "10.00",
  currency: "EGP",
  intervalDays: 30,
  // @ts-expect-error — isActive server-controlled
  isActive: true,
} satisfies PlanSubmitInput);

// Negative — deactivatedAt server-controlled
v({
  title: "T",
  sessionCount: 1,
  price: "10.00",
  currency: "EGP",
  intervalDays: 30,
  // @ts-expect-error — deactivatedAt server-controlled
  deactivatedAt: null,
} satisfies PlanSubmitInput);

// Negative — id system-set
v({
  title: "T",
  sessionCount: 1,
  price: "10.00",
  currency: "EGP",
  intervalDays: 30,
  // @ts-expect-error — id system-set
  id: 1,
} satisfies PlanSubmitInput);

// Negative — createdAt system-set
v({
  title: "T",
  sessionCount: 1,
  price: "10.00",
  currency: "EGP",
  intervalDays: 30,
  // @ts-expect-error — createdAt system-set
  createdAt: new Date(),
} satisfies PlanSubmitInput);

// Negative — updatedAt system-set
v({
  title: "T",
  sessionCount: 1,
  price: "10.00",
  currency: "EGP",
  intervalDays: 30,
  // @ts-expect-error — updatedAt system-set
  updatedAt: new Date(),
} satisfies PlanSubmitInput);

// Negative — price must be a decimal string, never a number
v({
  title: "T",
  sessionCount: 1,
  // @ts-expect-error — price is a decimal string
  price: 10,
  currency: "EGP",
  intervalDays: 30,
} satisfies PlanSubmitInput);

// Negative — lifecycle field forbidden on update payload too
v({
  // @ts-expect-error — isActive server-controlled
  isActive: true,
} satisfies PlanUpdateInput);

// Negative — price keeps decimal-string discipline on update payload
v({
  // @ts-expect-error — price is a decimal string
  price: 99.5,
} satisfies PlanUpdateInput);
