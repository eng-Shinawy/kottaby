"use client";

/**
 * TeacherSessionReportDialog — the single dialog component. Mode-resolved
 * (prepare/submit/review). The mutation logic lives in
 * `useTeacherSessionReportMutation`; the queries in
 * `useTeacherSessionReportQueries`; the presentational parts in
 * `TeacherSessionReportDialog.parts`; the backend→codegen bridge in
 * `sessionReportConversions`; the submit form body in
 * `TeacherSessionReportSubmitForm`. This file is the orchestrator only.
 */

import { CircularProgress, Dialog, DialogContent, DialogTitle, Stack } from "@mui/material";
import { type ReactNode, useCallback, useMemo, useState } from "react";
import type { SubmitSessionReportInput } from "@/frontend/graphql/generated/gql/graphql";
import { toCodegenSubmitInput } from "@/frontend/views/teacher/sessions/sessionReportConversions";
import { ReviewState } from "@/frontend/views/teacher/sessions/TeacherSessionReportDialog.parts";
import { TeacherSessionReportHomeworkReview } from "@/frontend/views/teacher/sessions/TeacherSessionReportHomeworkReview";
import { SubmitForm } from "@/frontend/views/teacher/sessions/TeacherSessionReportSubmitForm";
import {
  buildSubmitPayload,
  isNewestRowUngraded,
  resolveNewestRow,
  type SessionReportFormState,
} from "@/frontend/views/teacher/sessions/teacherSessionReportDialog.helpers";
import type { ContainerNotice } from "@/frontend/views/teacher/sessions/teacherSessionSlots";
import { useTeacherSessionReportMutation } from "@/frontend/views/teacher/sessions/useTeacherSessionReportMutation";
import { useTeacherSessionReportQueries } from "@/frontend/views/teacher/sessions/useTeacherSessionReportQueries";
import { Sessions, useAppTranslation } from "@/shared/locale";

export interface TeacherSessionReportDialogProps {
  readonly sessionId: string;
  readonly studentId: string;
  readonly sessionStatus: "started" | "completed" | null;
  readonly open: boolean;
  readonly onClose: () => void;
  readonly setNotice: (notice: ContainerNotice | null) => void;
  readonly setRowAlert: (sessionId: string, message: string | null) => void;
}

type DialogMode = "prepare" | "submit" | "review";

function resolveMode(sessionStatus: "started" | "completed" | null, hasReport: boolean): DialogMode {
  if (sessionStatus === "started") return "prepare";
  if (hasReport) return "review";
  return "submit";
}

export function TeacherSessionReportDialog({
  sessionId,
  studentId,
  sessionStatus,
  open,
  onClose,
  setNotice,
  setRowAlert,
}: Readonly<TeacherSessionReportDialogProps>): ReactNode {
  const t = useAppTranslation(Sessions);
  const [form, setForm] = useState<SessionReportFormState>({
    teacherNotes: "",
    studentRatingByTeacher: null,
    jadid: null,
    madi: null,
    previousGrades: null,
  });
  const { reportQuery, homeworkQuery, historyQuery, loading, hasReport } = useTeacherSessionReportQueries({
    sessionId,
    studentId,
    open,
  });
  const mode = resolveMode(sessionStatus, hasReport);
  const newestRow = resolveNewestRow(historyQuery.data);
  const isNewestUngraded = isNewestRowUngraded(newestRow);
  const [mutate, mutationResult] = useTeacherSessionReportMutation({ t, sessionId, onClose, setNotice, setRowAlert });
  const dialogTitle = useMemo(() => {
    if (mode === "prepare") return t.reportDialogPrepareTitle;
    if (mode === "review") return t.reportDialogReviewTitle;
    return t.reportDialogSubmitTitle;
  }, [mode, t]);
  const handleSubmit = useCallback(
    (event: React.SubmitEvent<HTMLFormElement>) => {
      event.preventDefault();
      const input: SubmitSessionReportInput = toCodegenSubmitInput(buildSubmitPayload(form));
      void mutate({ variables: { id: sessionId, input } });
    },
    [form, mutate, sessionId]
  );
  if (loading) {
    return (
      <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
        <DialogTitle>{dialogTitle}</DialogTitle>
        <DialogContent>
          <Stack sx={{ alignItems: "center", py: 4 }}>
            <CircularProgress />
          </Stack>
        </DialogContent>
      </Dialog>
    );
  }
  return (
    <Dialog
      open={open}
      onClose={onClose}
      fullWidth
      maxWidth="sm"
      slotProps={{ paper: { component: "form", onSubmit: handleSubmit } }}
      aria-labelledby="teacher-session-report-dialog-title"
    >
      <DialogTitle id="teacher-session-report-dialog-title">{dialogTitle}</DialogTitle>
      <DialogContent sx={{ display: "grid", gap: 3 }}>
        {mode === "review" && reportQuery.data?.sessionReport ? (
          <ReviewState report={reportQuery.data.sessionReport} t={t} />
        ) : null}
        {mode === "review" || mode === "prepare" ? (
          // The session's homework row was fetched by the queries hook but
          // never rendered — review mode shows the recorded Jadid/Madi, prepare
          // mode the current assignment to build the report on.
          <TeacherSessionReportHomeworkReview homework={homeworkQuery.data?.sessionHomework ?? null} t={t} />
        ) : null}
        {/* Prepare mode is the read-only review above — the editable
            sub-forms have no submit path for a started session (the
            mutation denies it server-side), so they are submit-only. */}
        {mode === "submit" ? (
          <SubmitForm
            mode={mode}
            form={form}
            setForm={setForm}
            t={t}
            newestRow={newestRow}
            isNewestUngraded={isNewestUngraded}
            submitLoading={mutationResult.loading}
            onClose={onClose}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
