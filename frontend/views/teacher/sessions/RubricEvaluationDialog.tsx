"use client";

/**
 * RubricEvaluationDialog — the evaluator's rubric form for ONE completed
 * evaluation session, mounted keyed by session id (the report-dialog
 * pattern: the closed dialog leaves the tree, so every open starts from a
 * pristine draft). The draft state + edit intents live in
 * {@link useRubricDraftState}, the controls in
 * {@link RubricScoreField}/{@link RubricNotesField}/{@link RubricWeaknessField},
 * the notice lanes in the notices module, the draft resolution in
 * {@link resolveRubricDraft}.
 *
 * The draft SURVIVES the keyed mount: every edit parks a versioned
 * snapshot under the session's `localStorage` key
 * (`saveStoredRubricDraft`), a successful submit clears it, and the next
 * open of the SAME session re-seeds the controls from the last
 * unsubmitted snapshot — re-validated through the same rules the live
 * draft enforces — and says so through the localized "draft restored"
 * notice (dismissed by the first edit). A dismissal or reload mid-review
 * therefore costs the evaluator nothing, while a submitted session always
 * starts pristine.
 *
 * The client MIRRORS the wire contract — the server stays the authority:
 * the weakness control renders ONLY while the entered score is a legal
 * value BELOW the pass threshold (the iff rule) and the pick is forced
 * back to null the moment the draft leaves that band. Outcome lanes
 * (`submitRubricEvaluation` through the container's
 * {@link useRubricEvaluation} arms): success → the pending read already
 * refetched, the localized success snackbar rendered through the
 * container's notice lane, and the dialog closes; typed denials → the
 * localized toast/notice renders app-scope through the single error-
 * mapping table and the dialog STAYS OPEN with the draft intact for an
 * in-place retry.
 *
 * The sealed submit payload carries ONLY the session locator plus the
 * score/notes/weakness draft — no applicant or evaluator identity ever
 * rides the client input. Submit runs through `React.SubmitEvent` (NEVER
 * `FormEvent` — React 19 rules); dismissal (backdrop/Escape) is gated
 * while the submit is on the wire; MUI v9 `Dialog fullWidth maxWidth="xs"`
 * with `sx`-only styling and theme-palette callbacks. The submit affordance
 * rides an explicit inner form (the CreateUserDialog pattern) — MUI's paper
 * slot types only its default div element, so `component: "form"` cannot
 * typecheck; `display: contents` keeps the paper's flex layout intact.
 */

import { RateReviewOutlined } from "@mui/icons-material";
import { Dialog, DialogContent, DialogTitle, Stack } from "@mui/material";
import type { CSSObject, Theme } from "@mui/material/styles";
import type { ReactNode } from "react";
import type { RubricEvaluationSubmitInput } from "@/frontend/graphql/generated/gql/graphql";
import {
  RubricDraftRestoredNotice,
  RubricSubmitButton,
  RubricVerdictImpactLane,
} from "@/frontend/views/teacher/sessions/RubricEvaluationDialog.notices";
import {
  RubricNotesField,
  RubricScoreField,
  RubricWeaknessField,
} from "@/frontend/views/teacher/sessions/RubricEvaluationDialog.parts";
import { clearStoredRubricDraft } from "@/frontend/views/teacher/sessions/rubricDraftStorage.helpers";
import { resolveRubricDraft } from "@/frontend/views/teacher/sessions/rubricEvaluationDialog.helpers";
import { useRubricDraftState } from "@/frontend/views/teacher/sessions/useRubricDraftState";
import type { RubricSubmitOutcome } from "@/frontend/views/teacher/sessions/useRubricEvaluation";
import { Sessions, useAppTranslation } from "@/shared/locale";

/** A11y + test wiring ids for the single rubric dialog instance. */
const DIALOG_TITLE_ID = "rubric-evaluation-dialog-title";
const DIALOG_TEST_ID = "rubric-evaluation-dialog";

/** The title row's composition — hoisted so the dialog function stays inside the per-function budget. */
const dialogTitleSx = (theme: Theme) =>
  ({
    display: "flex",
    alignItems: "center",
    gap: 1.5,
    fontWeight: 700,
    color: theme.palette.text.primary,
    pb: 1,
  }) satisfies CSSObject;

interface RubricEvaluationDialogProps {
  /** Id of the completed evaluation session being scored. */
  readonly sessionId: string;
  /** Dismiss intent (backdrop/Escape) — ignored while the submit is on the wire. */
  readonly onClose: () => void;
  /** Files the rubric verdict through the container's rubric arms. */
  readonly onSubmit: (sessionId: string, input: RubricEvaluationSubmitInput) => Promise<RubricSubmitOutcome>;
  /** `true` while the submit mutation is on the wire. */
  readonly submitting: boolean;
}

/** The evaluator's rubric form — see the module docblock. */
export function RubricEvaluationDialog({
  sessionId,
  onClose,
  onSubmit,
  submitting,
}: Readonly<RubricEvaluationDialogProps>): ReactNode {
  const t = useAppTranslation(Sessions);
  const draft = useRubricDraftState(sessionId);

  const runSubmit = async (): Promise<void> => {
    const resolution = resolveRubricDraft({
      scoreText: draft.scoreText,
      notes: draft.notes,
      weaknessArea: draft.weaknessArea,
      weaknessRequired: draft.weaknessRequired,
    });
    if (resolution.input === null) {
      draft.setDraftErrors(resolution.errors);
      return;
    }
    const submitted = await onSubmit(sessionId, resolution.input);
    if (submitted.ok) {
      clearStoredRubricDraft(sessionId); // the verdict settled — the parked draft is spent
      onClose();
    }
  };

  const handleSubmit = (event: React.SubmitEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (submitting) return;
    void runSubmit();
  };

  const handleDialogClose = (): void => (submitting ? undefined : onClose());

  return (
    <Dialog
      open
      onClose={handleDialogClose}
      fullWidth
      maxWidth="xs"
      aria-labelledby={DIALOG_TITLE_ID}
      data-testid={DIALOG_TEST_ID}
    >
      <DialogTitle id={DIALOG_TITLE_ID} sx={dialogTitleSx}>
        <RateReviewOutlined
          sx={theme => ({
            p: 1,
            boxSizing: "content-box",
            borderRadius: "50%",
            bgcolor: theme.palette.primaryContainer,
            color: theme.palette.onPrimaryContainer,
            fontSize: 20,
            // The r7 medallion ring echo — an outlineVariant hairline plus a
            // whisper of elevation so the glyph sits slightly above the
            // header instead of floating unanchored.
            border: "1px solid",
            borderColor: theme.palette.outlineVariant,
            boxShadow: theme.shadows[1],
          })}
        />
        {t.rubricDialogTitle}
      </DialogTitle>
      {/* `noValidate` keeps the browser's constraint validation out of the
          way — the native `min`/`max`/`required` attributes would otherwise
          silently cancel the submit event for an out-of-band draft (e.g. a
          score above the band) and the localized error flags would never
          render; the draft resolution above owns every validation message. */}
      <form onSubmit={handleSubmit} noValidate style={{ display: "contents" }}>
        <DialogContent>
          <Stack sx={{ gap: 2, pt: 1 }}>
            {draft.draftRestored ? (
              <RubricDraftRestoredNotice stamps={draft.restoredSavedAtStamps} onDiscard={draft.handleDiscardDraft} />
            ) : null}
            <RubricScoreField
              value={draft.scoreText}
              onChange={draft.handleScoreChange}
              error={draft.draftErrors.score}
              disabled={submitting}
            />
            <RubricNotesField
              value={draft.notes}
              onChange={draft.handleNotesChange}
              error={draft.draftErrors.notes}
              disabled={submitting}
            />
            {draft.weaknessRequired ? (
              <RubricWeaknessField
                value={draft.weaknessArea}
                onChange={draft.handleWeaknessChange}
                error={draft.draftErrors.weakness}
                disabled={submitting}
              />
            ) : null}
            <RubricVerdictImpactLane score={draft.score} weaknessRequired={draft.weaknessRequired} />
          </Stack>
        </DialogContent>
        <RubricSubmitButton submitting={submitting} submitLabel={t.rubricSubmitCta} />
      </form>
    </Dialog>
  );
}
