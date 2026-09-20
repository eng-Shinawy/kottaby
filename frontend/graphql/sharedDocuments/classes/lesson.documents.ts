/**
 * Lesson GraphQL Documents — queries and mutations for Tajweed curriculum lesson management.
 *
 * Follows TypedDocumentNode convention and includes `id` in every selection set.
 */

import { gql, type TypedDocumentNode } from "@apollo/client";
import type {
  CreateLessonMutation,
  CreateLessonMutationVariables,
  DeleteLessonMutation,
  DeleteLessonMutationVariables,
  PlanLessonsQuery,
  PlanLessonsQueryVariables,
  UpdateLessonMutation,
  UpdateLessonMutationVariables,
} from "@/frontend/graphql/generated/gql/graphql";

export const planLessonsQueryDocument: TypedDocumentNode<PlanLessonsQuery, PlanLessonsQueryVariables> = gql`
  query PlanLessons($planId: ID!) {
    planLessons(planId: $planId) {
      id
      planId
      title
      createdAt
    }
  }
`;

export const createLessonMutationDocument: TypedDocumentNode<CreateLessonMutation, CreateLessonMutationVariables> = gql`
  mutation CreateLesson($input: CreateLessonInput!) {
    createLesson(input: $input) {
      id
      planId
      title
    }
  }
`;

export const updateLessonMutationDocument: TypedDocumentNode<UpdateLessonMutation, UpdateLessonMutationVariables> = gql`
  mutation UpdateLesson($id: ID!, $input: UpdateLessonInput!) {
    updateLesson(id: $id, input: $input) {
      id
      planId
      title
    }
  }
`;

export const deleteLessonMutationDocument: TypedDocumentNode<DeleteLessonMutation, DeleteLessonMutationVariables> = gql`
  mutation DeleteLesson($id: ID!) {
    deleteLesson(id: $id) {
      id
      planId
      title
    }
  }
`;
