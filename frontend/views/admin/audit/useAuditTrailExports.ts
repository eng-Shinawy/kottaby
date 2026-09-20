"use client";

/**
 * useAuditTrailExports — the audit-trail view's export pair state machine:
 * the page export (serializes the rows the view already holds) and the
 * export-all (filtered) walk. Owns the feedback snackbar slot (the shared
 * `DirectorySnackbar` shape) and the export-all in-flight flag so the
 * view stays a pure composition. Split from `AuditTrailView` (the
 * 150-line view-file convention).
 *
 * Export-all: walks the applied-filter query page-by-page through the
 * export-all flow (bounded loop, hard ceiling, honest truncation
 * feedback) and downloads one CSV. The imperative fetch loop rides
 * `client.query` with `no-cache` — a one-shot command, not view state;
 * pages beyond the first never enter the normalized cache.
 */

import { useApolloClient } from "@apollo/client/react";
import { useState } from "react";
import type { AdminAuditLogsQuery_adminAuditLogs_items } from "@/frontend/graphql/generated/gql/graphql";
import { adminAuditLogsQueryDocument } from "@/frontend/graphql/sharedDocuments";
import { type AuditExportFeedback, runAuditTrailCsvExport } from "@/frontend/views/admin/audit/audit-trail-export";
import { EXPORT_ALL_PAGE_SIZE, runAuditTrailFullCsvExport } from "@/frontend/views/admin/audit/audit-trail-export-all";
import { type AppliedAuditTrailFilters, buildFiltersInput } from "@/frontend/views/admin/audit/audit-trail-filters";
import { AdminUsers, useAppTranslation } from "@/shared/locale";

interface UseAuditTrailExportsOptions {
  /** The settled page rows the page export serializes (may be empty). */
  readonly items: readonly AdminAuditLogsQuery_adminAuditLogs_items[];
  /** The applied-filter record the export-all walk replays page-by-page. */
  readonly appliedFilters: AppliedAuditTrailFilters;
}

export function useAuditTrailExports({ items, appliedFilters }: UseAuditTrailExportsOptions): {
  readonly feedback: AuditExportFeedback | null;
  readonly exportAllLoading: boolean;
  readonly exportPage: () => void;
  readonly exportAll: () => void;
  readonly closeFeedback: () => void;
} {
  const t = useAppTranslation(AdminUsers);
  const client = useApolloClient();
  const [feedback, setFeedback] = useState<AuditExportFeedback | null>(null);
  const [exportAllLoading, setExportAllLoading] = useState(false);

  const exportPage = (): void => {
    setFeedback(runAuditTrailCsvExport(items, t));
  };

  const exportAll = (): void => {
    setExportAllLoading(true);
    void runAuditTrailFullCsvExport(async page => {
      const result = await client.query({
        query: adminAuditLogsQueryDocument,
        variables: { filters: buildFiltersInput(appliedFilters), page, pageSize: EXPORT_ALL_PAGE_SIZE },
        fetchPolicy: "no-cache",
      });
      // A query result without data (skipped/errored fetch) is a walk
      // failure — throwing lets the walker's guard rails resolve it to the
      // honest failure feedback instead of exporting a phantom page.
      if (!result.data) {
        throw new Error("audit-trail export-all: query returned no data");
      }
      return result.data.adminAuditLogs;
    }, t)
      .then(settled => {
        setFeedback(settled);
        return settled;
      })
      .finally(() => {
        setExportAllLoading(false);
      });
  };

  const closeFeedback = (): void => {
    setFeedback(null);
  };

  return { feedback, exportAllLoading, exportPage, exportAll, closeFeedback };
}
