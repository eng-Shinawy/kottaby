"use client";

/**
 * useStudentsExportAll — the server-side EXPORT-ALL flow of the student
 * directory.
 *
 * Executes the DEDICATED export document with the current filter state (NO
 * page/pageSize — the backend caps the dump at its own EXPORT_MAX_ROWS and
 * reports `truncated`). `useLazyQuery` is banned in this repo, so the
 * one-shot query runs through the Apollo client directly. Resolves `null`
 * on failure — the caller owns the error feedback through the shared
 * snackbar.
 *
 * Extracted from `useAdminStudentsDirectory`, which composes it with the
 * filter draft state, the URL-sync effect, and the query.
 */

import { useApolloClient } from "@apollo/client/react";
import { useState } from "react";
import type {
  AdminStudentFiltersInput,
  AdminStudentsExportQuery,
  AdminStudentsExportQueryVariables,
} from "@/frontend/graphql/generated/gql/graphql";
import { adminStudentsExportQueryDocument } from "@/frontend/graphql/sharedDocuments/admin";

export function useStudentsExportAll(filters: AdminStudentFiltersInput): {
  exportLoading: boolean;
  exportAll: () => Promise<AdminStudentsExportQuery["adminStudentsExport"] | null>;
} {
  const client = useApolloClient();
  const [exportLoading, setExportLoading] = useState(false);

  const exportAll = async (): Promise<AdminStudentsExportQuery["adminStudentsExport"] | null> => {
    setExportLoading(true);
    try {
      const result = await client.query({
        query: adminStudentsExportQueryDocument,
        variables: { filters } satisfies AdminStudentsExportQueryVariables,
        fetchPolicy: "network-only",
      });
      return result.data?.adminStudentsExport ?? null;
    } catch {
      return null;
    } finally {
      setExportLoading(false);
    }
  };

  return { exportLoading, exportAll };
}
