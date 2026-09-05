/**
 * Admin audit-trail GraphQL documents — the platform-wide read-back over the
 * append-only `audit_logs` table (newest-first paginated trail).
 *
 * Per `frontend/graphql/sharedDocuments/AGENTS.md`:
 *  - Document uses `gql` + `TypedDocumentNode` (codegen types only).
 *  - `id` is selected FIRST in the entry selection so Apollo normalizes the
 *    `AdminAuditLogEntry` cache entries; the `AdminAuditLogPage` wrapper is
 *    an embedded value type (`keyFields: false` in
 *    `frontend/providers/apollo/apolloCache.ts`) and never needs an `id`.
 *  - Consumed in views via `useQuery` from `@apollo/client/react` —
 *    NO `useLazyQuery`.
 *  - Variables are typed, never string-interpolated.
 */
import { gql, type TypedDocumentNode } from "@apollo/client";
import type { AdminAuditLogsQuery, AdminAuditLogsQueryVariables } from "@/frontend/graphql/generated/gql/graphql";

/**
 * Platform-wide audit-trail query — paginated, filterable `audit_logs`
 * read-back for admins. `id` selected FIRST per the Apollo
 * cache-normalization rule; `entityId`/`details` are nullable
 * (system-originated rows carry no entity; the raw `details` JSON is
 * projected verbatim for downstream rendering); the wrapper echoes the
 * resolved `page`/`pageSize`/`totalCount` (honest envelope).
 */
export const adminAuditLogsQueryDocument: TypedDocumentNode<AdminAuditLogsQuery, AdminAuditLogsQueryVariables> = gql`
  query AdminAuditLogs($filters: AdminAuditLogFiltersInput, $page: Int, $pageSize: Int) {
    adminAuditLogs(filters: $filters, page: $page, pageSize: $pageSize) {
      items {
        id
        actionType
        actorId
        actorName
        entityType
        entityId
        details
        createdAt
      }
      totalCount
      page
      pageSize
    }
  }
`;
