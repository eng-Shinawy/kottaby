"use client";

import { useQuery } from "@apollo/client/react";
import { Button, Dialog, DialogActions, DialogContent, DialogTitle, Stack } from "@mui/material";
import type { ReactNode } from "react";
import { PermissionDeniedFallback } from "@/frontend/components/ui/PermissionDeniedFallback";
import type { StudentDisputeCaseQuery, TeacherDisputeCaseQuery } from "@/frontend/graphql/generated/gql/graphql";
import { studentDisputeCaseQueryDocument, teacherDisputeCaseQueryDocument } from "@/frontend/graphql/sharedDocuments";
import { extractErrorCode } from "@/frontend/lib/graphql-error-utils";
import { mapGraphQLErrorByCode, normalizeGraphQLErrorCode } from "@/frontend/providers/apollo/error-link.map";
import {
  DisputeCaseErrorSlot,
  DisputeCaseLoadingSkeleton,
} from "@/frontend/views/shared/disputes/DisputeCasePrimitives";
import {
  ParticipantCaseSessionFacts,
  type ParticipantCaseView,
} from "@/frontend/views/shared/disputes/ParticipantCaseBundleView";
import { ParticipantCaseDecisionSections } from "@/frontend/views/shared/disputes/ParticipantCaseDecision";
import { Common, Sessions, useAppLocale, useAppTranslation } from "@/shared/locale";

/**
 * ParticipantDisputeCaseDialog — the participant case-dialog CORE shared by
 * the two filing-participant mirrors: `StudentDisputeCaseDialog` (the
 * student sessions surface) and `TeacherDisputeCaseDialog` (the teacher
 * sessions surface). One stateful case query renders the SAME bundle — the
 * session detail (escrow class, fee, dispute moment + the FULL filed
 * reason), the arbitration decision (outcome + the FULL note + the
 * resolved moment, or the honest pending line while the case awaits
 * arbitration) and the participant-owned artifacts — with the counterparty
 * display name resolved server-side.
 *
 * Honesty contract: absent evidence artifacts arrive as honest `null`s and
 * render as localized empty-state lines — the dialog NEVER fabricates
 * placeholder data. The state matrix: `aria-busy` skeleton → denial
 * fallback (`PermissionDeniedFallback` for the mapping-table denial family
 * — the participant gate is SERVER-owned, this surface carries no role
 * logic) → generic inline alert → the bundle.
 *
 * Vocabulary seam: the arbitration vocabulary (the escrow chip, the outcome
 * labels, the decision section) is surface-neutral; only the
 * perspective-keyed attribution labels (`studentCase*` / `teacherCase*`)
 * differ per surface, chosen by the `surface` prop.
 *
 * Mobile: the SAME responsive dialog geometry the dispute family already
 * ships (fullWidth + theme-aware paper, ≥44px touch target on the close
 * action) — no route or navigation additions.
 *
 * MUI v9 discipline: `sx`-only styling, theme-palette colors through
 * callbacks, RTL-safe logical composition, ≥44px touch target on the close
 * action.
 */

/** The two participant surfaces the shared dialog core binds. */
type ParticipantDisputeCaseSurface = "student" | "teacher";

/**
 * Normalizes either participant wire envelope into the surface-agnostic
 * case view (the two envelopes differ only in WHICH counterparty name they
 * resolve server-side). The wire shape itself is the discriminator — the
 * `in` narrowing keeps the projection assertion-free.
 */
function projectParticipantCase(
  data: StudentDisputeCaseQuery | TeacherDisputeCaseQuery | undefined
): ParticipantCaseView | undefined {
  if (data === undefined) {
    return undefined;
  }
  if ("studentDisputeCase" in data) {
    const studentCase = data.studentDisputeCase;
    return {
      session: studentCase.session,
      counterpartyName: studentCase.teacherName,
      counterpartyId: studentCase.session.teacherId,
      report: studentCase.report,
      homework: studentCase.homework,
      recitation: studentCase.recitation,
    };
  }
  const teacherCase = data.teacherDisputeCase;
  return {
    session: teacherCase.session,
    counterpartyName: teacherCase.studentName,
    counterpartyId: teacherCase.session.studentId,
    report: teacherCase.report,
    homework: teacherCase.homework,
    recitation: teacherCase.recitation,
  };
}

interface ParticipantDisputeCaseDialogProps {
  /** Which participant mirror to bind (query document + perspective labels + testid prefix). */
  readonly surface: ParticipantDisputeCaseSurface;
  /** Id of the session whose case is on view (the case query's closed variable). */
  readonly sessionId: string;
  readonly open: boolean;
  /** Dismiss intent — the close action and the dismissal gate both route here. */
  readonly onClose: () => void;
}

/**
 * The case body — the state matrix (first-fetch skeleton → denial fallback →
 * generic alert → the bundle) with exactly its own surface's query active.
 * Extracted from the dialog shell for the cognitive-complexity tier; the
 * shell owns the chrome, this owns the content decision.
 */
function ParticipantDisputeCaseBody({
  surface,
  sessionId,
}: Readonly<{
  surface: ParticipantDisputeCaseSurface;
  sessionId: string;
}>): ReactNode {
  const t = useAppTranslation(Sessions);
  const locale = useAppLocale();
  const tid = (suffix: string) => `${surface}-dispute-case-${suffix}`;

  // Each mirror activates exactly its own document (the sibling stays
  // skipped — one network read per dialog, the surface's own query).
  const studentResult = useQuery(studentDisputeCaseQueryDocument, {
    variables: { id: sessionId },
    skip: surface !== "student",
  });
  const teacherResult = useQuery(teacherDisputeCaseQueryDocument, {
    variables: { id: sessionId },
    skip: surface !== "teacher",
  });
  const active = surface === "student" ? studentResult : teacherResult;

  if (active.loading && active.data === undefined) {
    // First fetch for this case: the `aria-busy` skeleton — no fabricated
    // section shells that could be mistaken for empty artifacts.
    return <DisputeCaseLoadingSkeleton surface={surface} testId={tid("loading")} />;
  }
  if (active.error) {
    const rawCode = extractErrorCode(active.error);
    const code = rawCode === null ? "" : normalizeGraphQLErrorCode(rawCode);
    const action = mapGraphQLErrorByCode(code, { contextKind: "query", hasForm: false });
    if (action?.kind === "permission-fallback" || action?.kind === "auth-recovery") {
      return <PermissionDeniedFallback />;
    }
    return <DisputeCaseErrorSlot testId={tid("error")} message={t.genericError} />;
  }
  if (!active.data) {
    return <DisputeCaseLoadingSkeleton surface={surface} testId={tid("loading")} />;
  }
  const caseView = projectParticipantCase(active.data);
  if (caseView === undefined) {
    return <DisputeCaseLoadingSkeleton surface={surface} testId={tid("loading")} />;
  }
  return (
    <Stack sx={{ gap: 3 }}>
      <ParticipantCaseSessionFacts
        surface={surface}
        caseView={caseView}
        t={t}
        locale={locale}
        counterpartyLabelText={surface === "student" ? t.studentCaseTeacherLabel : t.teacherCaseStudentLabel}
      />
      <ParticipantCaseDecisionSections
        surface={surface}
        caseView={caseView}
        t={t}
        locale={locale}
        reportTitleText={surface === "student" ? t.studentCaseReportTitle : t.teacherCaseReportTitle}
        ratingLabelText={surface === "student" ? t.studentCaseRatingLabel : t.teacherCaseRatingLabel}
      />
    </Stack>
  );
}

/** The participant case dialog: one query, session facts + decision + artifacts, honest nulls. */
export function ParticipantDisputeCaseDialog({
  surface,
  sessionId,
  open,
  onClose,
}: Readonly<ParticipantDisputeCaseDialogProps>): ReactNode {
  const t = useAppTranslation(Sessions);
  const tc = useAppTranslation(Common);

  const tid = (suffix: string) => `${surface}-dispute-case-${suffix}`;

  const body = <ParticipantDisputeCaseBody surface={surface} sessionId={sessionId} />;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      fullWidth
      maxWidth="md"
      scroll="paper"
      data-testid={tid("dialog")}
      aria-labelledby={tid("title")}
    >
      <DialogTitle id={tid("title")} sx={theme => ({ color: theme.palette.onSurface })}>
        {t.teacherCaseTitle}
      </DialogTitle>
      <DialogContent sx={{ display: "grid", gap: 3 }}>{body}</DialogContent>
      <DialogActions sx={{ px: 3, pb: 3 }}>
        <Button onClick={onClose} data-testid={tid("close")} sx={{ minHeight: { xs: 44, sm: 40 }, px: 3 }}>
          {tc.close}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
