"use client";

import { useQuery } from "@apollo/client/react";
import { Container, Stack, Typography } from "@mui/material";
import { type ReactNode, useCallback, useState } from "react";
import type { BrowseAvailableTeachersQuery_browseAvailableTeachers_items } from "@/frontend/graphql/generated/gql/graphql";
import { browseAvailableTeachersQueryDocument } from "@/frontend/graphql/sharedDocuments";
import { extractErrorCode } from "@/frontend/lib/graphql-error-utils";
import { TeacherDirectoryAppliedFilters } from "@/frontend/views/student/teachers/TeacherDirectoryAppliedFilters";
import { TeacherDirectoryBody } from "@/frontend/views/student/teachers/TeacherDirectoryBody";
import { TeacherDirectoryFilterBar } from "@/frontend/views/student/teachers/TeacherDirectoryFilterBar";
import { TeacherDirectoryRequestDialog } from "@/frontend/views/student/teachers/TeacherDirectoryRequestDialog";
import {
  BROWSE_PAGE_SIZE,
  type BrowseFilterChoices,
  DEFAULT_BROWSE_CHOICES,
} from "@/frontend/views/student/teachers/teacherDirectoryPresentation";
import { Common, Errors, TeacherDirectory, useAppTranslation } from "@/shared/locale";

/** One settled browse item — the request dialog's selection payload. */
type BrowseItem = BrowseAvailableTeachersQuery_browseAvailableTeachers_items;

/**
 * TeacherDirectoryContainer — the client orchestrator behind
 * `/student/teachers` (the student-facing teacher directory browse).
 *
 * Page-level authorization is owned by the server guard (`withPageAuth`) —
 * the container performs no role logic (the `browseAvailableTeachers` read
 * is student-gated server-side; the client sends the filter CHOICES only,
 * never an id). Filter state (the `PaymentsFilterBar` discipline): the bar
 * edits a DRAFT choice set (the OPTIONAL, default-`null` recitation +
 * subject-intent filters — `null` = no constraint, browse across ALL
 * readings/subjects — plus the optional name search, the minimum-rating
 * floor, and the ordering key; the sort default stays top-rated
 * `RATING_DESC` and the rating floor defaults to `null` = any rating)
 * and ONLY the form submit narrows the query; the applied set + the
 * 1-based page drive the stateful `useQuery` variables (`useLazyQuery`
 * is banned; the search is trimmed here — an empty remainder sends
 * `null`, meaning "no search"). Applying or resetting ALWAYS returns to
 * page 1; the applied set is echoed back as the state chips under the
 * bar.
 *
 * Render branches (resolved by `TeacherDirectoryBody` below the always-on
 * chrome — title + subtitle + filter bar + applied-filter chip render in
 * EVERY branch):
 *
 * | # | Condition | Body |
 * |---|-----------|------|
 * | 1 | query in flight (no settled payload) | card skeleton grid (`aria-busy`) |
 * | 2 | error `UNAUTHORIZED`/`FORBIDDEN` (denial family) | shared `PermissionDeniedFallback` |
 * | 3 | error in the retryable taxonomy (`RATE_LIMITED`/`SERVICE_UNAVAILABLE`) | shared `RetryableNotice` (retry disabled while in flight) |
 * | 4 | any other query error (masked 500 …) | inline error `Alert` + retry CTA (`errors.internalServerError`) |
 * | 5 | settled, zero items (an honest empty page) | empty state (`noTeachersAvailable` + `emptyStateHint`) |
 * | 6 | settled, items present | results header + card grid + pagination footer |
 *
 * The request-session dialog is ONE grid-level instance (never per card):
 * a card CTA sets `requestTarget`, the dialog reads it, and its success
 * lanes refetch the browse + route to `/student/sessions`. Its
 * `appliedIntent` seed is the applied set's subject filter — `null`
 * while the browse isn't narrowed to a subject, in which case the
 * dialog's select opens on its placeholder and Confirm stays disabled
 * until the student picks one.
 *
 * Query errors classify through `extensions.code` (shared error utils) —
 * never the server `message`. All copy resolves through the compile-time
 * `TeacherDirectory` / `Errors` / `Common` handles (property access only).
 * MUI v9 `sx`-only styling, theme-palette colors, RTL-safe composition.
 */
export function TeacherDirectoryContainer(): ReactNode {
  const t = useAppTranslation(TeacherDirectory);
  const te = useAppTranslation(Errors);
  const commonT = useAppTranslation(Common);

  // Draft (in-bar) vs applied (query-driving) filter pair — the submit
  // boundary; reset restores the defaults + page 1.
  const [draftChoices, setDraftChoices] = useState<BrowseFilterChoices>(DEFAULT_BROWSE_CHOICES);
  const [appliedChoices, setAppliedChoices] = useState<BrowseFilterChoices>(DEFAULT_BROWSE_CHOICES);
  const [page, setPage] = useState(1);
  // Retry-after-query-error refetch in flight (disables the affordance).
  const [retryPending, setRetryPending] = useState(false);
  // The card CTA's selected teacher — the ONE request dialog reads it.
  const [requestTarget, setRequestTarget] = useState<BrowseItem | null>(null);

  const { data, loading, error, refetch } = useQuery(browseAvailableTeachersQueryDocument, {
    variables: {
      intent: appliedChoices.intent,
      minRating: appliedChoices.minRating,
      page,
      pageSize: BROWSE_PAGE_SIZE,
      recitation: appliedChoices.recitation,
      search: appliedChoices.search.trim() || null,
      sort: appliedChoices.sort,
    },
  });

  const handleApply = useCallback((choices: BrowseFilterChoices) => {
    setAppliedChoices(choices);
    setPage(1);
  }, []);

  const handleReset = useCallback(() => {
    setDraftChoices(DEFAULT_BROWSE_CHOICES);
    setAppliedChoices(DEFAULT_BROWSE_CHOICES);
    setPage(1);
  }, []);

  const handlePageChange = useCallback((nextPage: number) => {
    setPage(nextPage);
  }, []);

  const handleRetry = useCallback(() => {
    setRetryPending(true);
    void refetch()
      .catch(() => undefined)
      .finally(() => {
        setRetryPending(false);
      });
  }, [refetch]);

  const handleRequestSession = useCallback((teacher: BrowseItem) => {
    setRequestTarget(teacher);
  }, []);

  const closeRequestDialog = useCallback(() => {
    setRequestTarget(null);
  }, []);

  const queryErrorCode = error === undefined ? null : extractErrorCode(error);
  const envelope = data?.browseAvailableTeachers;

  return (
    <Container maxWidth="lg" sx={{ py: 4 }}>
      <Stack data-testid="student-teachers-directory" sx={{ gap: 3 }}>
        <Stack sx={{ gap: 1 }}>
          <Typography variant="h4" component="h1" sx={{ fontWeight: 700 }}>
            {t.browseTitle}
          </Typography>
          <Typography variant="body1" sx={theme => ({ color: theme.palette.text.secondary })}>
            {t.browseSubtitle}
          </Typography>
        </Stack>
        <TeacherDirectoryFilterBar
          draft={draftChoices}
          onDraftChange={setDraftChoices}
          onApply={handleApply}
          onReset={handleReset}
        />
        <TeacherDirectoryAppliedFilters choices={appliedChoices} />
        <TeacherDirectoryBody
          loading={loading}
          envelope={envelope}
          queryErrorCode={queryErrorCode}
          retryPending={retryPending}
          labels={t}
          genericErrorLabel={te.internalServerError}
          retryLabel={commonT.retry}
          onRetry={handleRetry}
          onPageChange={handlePageChange}
          onRequestSession={handleRequestSession}
        />
      </Stack>
      <TeacherDirectoryRequestDialog
        open={requestTarget !== null}
        teacher={requestTarget}
        appliedIntent={appliedChoices.intent}
        onClose={closeRequestDialog}
        refetchDirectory={() => refetch()}
      />
    </Container>
  );
}
