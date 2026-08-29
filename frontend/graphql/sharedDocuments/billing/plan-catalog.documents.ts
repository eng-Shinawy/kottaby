import { gql, type TypedDocumentNode } from "@apollo/client";
import type {
  AdminPlansQuery,
  AdminPlansQueryVariables,
  CreatePlanMutation,
  CreatePlanMutationVariables,
  PlanCatalogQuery,
  SetPlanActiveStatusMutation,
  SetPlanActiveStatusMutationVariables,
  UpdatePlanMutation,
  UpdatePlanMutationVariables,
} from "@/frontend/graphql/generated/gql/graphql";

/**
 * Plan-catalog shared documents (DEV1-005 / REQ-061).
 *
 * Every selection set below takes the FULL ten-field REQ-060 `Plan` shape:
 *
 *   id, title, sessionCount, price, currency, intervalDays,
 *   isActive, deactivatedAt, createdAt, updatedAt
 *
 * `id` is present on EVERY `Plan` selection set so Apollo Client normalizes
 * each returned plan to `Plan:<id>` — all five operations converge on the
 * same cache entries (the mutations return the canonical `RETURNING *` row,
 * so a create/update/lifecycle-toggle immediately refreshes both the
 * consumer `planCatalog` read and the admin `adminPlans` read without
 * refetch gymnastics). `price` is the server-canonical decimal STRING —
 * never a float on this surface.
 *
 * TypedDocumentNode style with codegen types ONLY — no inline type
 * literals, no mapping layers, no hooks (consumers own `useQuery` from
 * `@apollo/client/react`; `useLazyQuery` is banned project-wide).
 */

/**
 * `planCatalog` — the public storefront catalog (authenticated callers):
 * active plans only. Lifecycle columns (`isActive` / `deactivatedAt`) are
 * still selected so both roles read ONE canonical shape.
 */
export const planCatalogQueryDocument: TypedDocumentNode<PlanCatalogQuery> = gql`
  query PlanCatalog {
    planCatalog {
      id
      title
      sessionCount
      price
      currency
      intervalDays
      isActive
      deactivatedAt
      createdAt
      updatedAt
    }
  }
`;

/**
 * `adminPlans` — the admin-management listing (Admin role, server-enforced).
 * `includeInactive` defaults to `true` server-side, so passing no variables
 * yields the full catalog including deactivated plans; pass `false` for
 * active-only. Same ten-field selection as `planCatalog` — one canonical
 * `Plan` shape across both read channels.
 */
export const adminPlansQueryDocument: TypedDocumentNode<AdminPlansQuery, AdminPlansQueryVariables> = gql`
  query AdminPlans($includeInactive: Boolean = true) {
    adminPlans(includeInactive: $includeInactive) {
      id
      title
      sessionCount
      price
      currency
      intervalDays
      isActive
      deactivatedAt
      createdAt
      updatedAt
    }
  }
`;

/**
 * `createPlan` — Admin mutation returning the canonical `RETURNING *` row
 * (ten-field selection ⇒ Apollo normalizes the new plan into the cache on
 * the spot). Input is the BOPLA `CreatePlanInput!` surface: title,
 * sessionCount, price (decimal string), currency, intervalDays — lifecycle
 * fields are structurally unrepresentable.
 */
export const createPlanMutationDocument: TypedDocumentNode<CreatePlanMutation, CreatePlanMutationVariables> = gql`
  mutation CreatePlan($input: CreatePlanInput!) {
    createPlan(input: $input) {
      id
      title
      sessionCount
      price
      currency
      intervalDays
      isActive
      deactivatedAt
      createdAt
      updatedAt
    }
  }
`;

/**
 * `updatePlan` — Admin partial patch (BOPLA `UpdatePlanInput!`, every field
 * optional; empty patches are rejected server-side). Returns the full
 * canonical row so the cache entry for `Plan:<id>` refreshes atomically.
 */
export const updatePlanMutationDocument: TypedDocumentNode<UpdatePlanMutation, UpdatePlanMutationVariables> = gql`
  mutation UpdatePlan($id: ID!, $input: UpdatePlanInput!) {
    updatePlan(id: $id, input: $input) {
      id
      title
      sessionCount
      price
      currency
      intervalDays
      isActive
      deactivatedAt
      createdAt
      updatedAt
    }
  }
`;

/**
 * `setPlanActiveStatus` — Admin lifecycle toggle (soft-deactivate /
 * reactivate). Returns the full canonical row, flipping both `isActive` and
 * `deactivatedAt` in the normalized cache entry. This is the ONLY lifecycle
 * surface — no delete operation exists (INV-PC3).
 */
export const setPlanActiveStatusMutationDocument: TypedDocumentNode<
  SetPlanActiveStatusMutation,
  SetPlanActiveStatusMutationVariables
> = gql`
  mutation SetPlanActiveStatus($id: ID!, $isActive: Boolean!) {
    setPlanActiveStatus(id: $id, isActive: $isActive) {
      id
      title
      sessionCount
      price
      currency
      intervalDays
      isActive
      deactivatedAt
      createdAt
      updatedAt
    }
  }
`;
