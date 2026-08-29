import { gql, type TypedDocumentNode } from "@apollo/client";
import type { AdminAuditLogsQuery, AdminAuditLogsQueryVariables } from "@/frontend/graphql/generated/gql/graphql";

/**
 * Audit-trail shared documents (DEV3-020 Phase 1: the admin trail viewer).
 *
 * Selection set takes the canonical `AdminAuditLogConnection` shape — the
 * page envelope (`items`, `total`, `limit`, `offset`) with each item's
 * narrow actor summary embedded. `id` is present on EVERY selection set
 * (both `AdminAuditLog` and the nested `AdminAuditActor`) so Apollo
 * normalizes `AdminAuditLog:<id>` → `actor: AdminAuditActor:<id>`.
 *
 * TypedDocumentNode style with codegen types ONLY — no inline type
 * literals, no mapping layers, no hooks (the container owns `useQuery`).
 */

/**
 * `adminAuditLogs` — the admin-gated immutable trail read: filtered +
 * paginated server-side (the service clamps limit/offset), newest first.
 * Powers the `/audit` viewer's table and pagination footer.
 */
export const adminAuditLogsQueryDocument: TypedDocumentNode<AdminAuditLogsQuery, AdminAuditLogsQueryVariables> = gql`
  query AdminAuditLogs(
    $actorId: Int
    $actionType: String
    $entityType: String
    $entityId: Int
    $createdFrom: DateTime
    $createdTo: DateTime
    $limit: Int
    $offset: Int
  ) {
    adminAuditLogs(
      actorId: $actorId
      actionType: $actionType
      entityType: $entityType
      entityId: $entityId
      createdFrom: $createdFrom
      createdTo: $createdTo
      limit: $limit
      offset: $offset
    ) {
      items {
        id
        actionType
        entityType
        entityId
        details
        createdAt
        actor {
          id
          fullName
          email
        }
      }
      total
      limit
      offset
    }
  }
`;
