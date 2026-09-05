/**
 * PlanPothosObject — canonical GraphQL object type and inputs for `Plan`.
 *
 * Implements REQ-003, REQ-022, REQ-060.
 * Backed exclusively by `PlanReturnType` from `@/backend/types` (zero local types).
 */

import { gqlSchemaBuilder } from "@/backend/graphql/pothos/builder";
import type { PlanReturnType } from "@/backend/types";

/**
 * The canonical `Plan` GraphQL object type.
 */
export const PlanPothosObject = gqlSchemaBuilder.objectRef<PlanReturnType>("Plan").implement({
  description: "A subscription plan in the Kottaby catalog.",
  fields: t => ({
    id: t.exposeID("id", {
      description: "Unique plan identifier (Apollo cache normalization key).",
    }),
    title: t.exposeString("title", {
      description: "Human-readable title of the subscription plan.",
    }),
    sessionCount: t.exposeInt("sessionCount", {
      description: "Number of lesson sessions included in this plan.",
    }),
    price: t.exposeString("price", {
      description: "Plan price represented as an exact decimal string.",
    }),
    currency: t.exposeString("currency", {
      description: "Three-letter ISO currency code (e.g. EGP, USD).",
    }),
    intervalDays: t.exposeInt("intervalDays", {
      description: "Duration of the billing/service cycle in days.",
    }),
    isActive: t.exposeBoolean("isActive", {
      description: "Flag indicating whether this plan is actively offered in the student catalog.",
    }),
    deactivatedAt: t.string({
      nullable: true,
      description: "Timestamp when the plan was deactivated, or null if currently active.",
      resolve: parent => parent.deactivatedAt?.toISOString() ?? null,
    }),
    createdAt: t.string({
      description: "Timestamp when the plan record was created.",
      resolve: parent => parent.createdAt.toISOString(),
    }),
    updatedAt: t.string({
      description: "Timestamp when the plan record was last modified.",
      resolve: parent => parent.updatedAt.toISOString(),
    }),
  }),
});

/**
 * Input type for creating a new subscription plan.
 */
export const CreatePlanInput = gqlSchemaBuilder.inputType("CreatePlanInput", {
  description: "Input fields required to create a new subscription plan.",
  fields: t => ({
    title: t.string({
      required: true,
      description: "Plan title (1..255 characters).",
    }),
    sessionCount: t.int({
      required: true,
      description: "Total sessions included (integer >= 1).",
    }),
    price: t.string({
      required: true,
      description: "Exact price formatted as numeric string (e.g. '150.00').",
    }),
    currency: t.string({
      required: true,
      description: "3-letter uppercase currency code (e.g. 'EGP').",
    }),
    intervalDays: t.int({
      required: true,
      description: "Plan duration in days (integer >= 1).",
    }),
  }),
});

/**
 * Input type for updating an existing subscription plan.
 */
export const UpdatePlanInput = gqlSchemaBuilder.inputType("UpdatePlanInput", {
  description: "Mutable fields for updating an existing subscription plan.",
  fields: t => ({
    title: t.string({
      required: false,
      description: "Updated plan title.",
    }),
    sessionCount: t.int({
      required: false,
      description: "Updated session count.",
    }),
    price: t.string({
      required: false,
      description: "Updated price string.",
    }),
    currency: t.string({
      required: false,
      description: "Updated currency code.",
    }),
    intervalDays: t.int({
      required: false,
      description: "Updated duration in days.",
    }),
  }),
});
