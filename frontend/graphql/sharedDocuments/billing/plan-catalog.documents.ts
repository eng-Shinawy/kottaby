/**
 * Plan Catalog GraphQL Documents — queries and mutations for plan catalog management.
 *
 * Implements REQ-061.
 * Follows TypedDocumentNode convention and includes `id` in every selection set.
 */

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

export const adminPlansQueryDocument: TypedDocumentNode<AdminPlansQuery, AdminPlansQueryVariables> = gql`
  query AdminPlans($includeInactive: Boolean) {
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
