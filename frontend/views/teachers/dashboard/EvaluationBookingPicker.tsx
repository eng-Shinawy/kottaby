"use client";

import {
  Alert,
  Box,
  FormControlLabel,
  LinearProgress,
  Radio,
  RadioGroup,
  Rating,
  Stack,
  Typography,
} from "@mui/material";
import type { ReactNode } from "react";
import type { AvailableEvaluatorsQuery_availableEvaluators_items } from "@/frontend/graphql/generated/gql/graphql";

interface EvaluatorOptionBodyProps {
  /** One PII-free evaluator picker row. */
  readonly option: AvailableEvaluatorsQuery_availableEvaluators_items;
}

/**
 * Evaluator option row body — the full name with a live-presence dot, the
 * teaching subjects as secondary copy, and the read-only rating. All values
 * come straight from the PII-free picker payload; RTL-safe via `dir="auto"`
 * on user-authored strings.
 */
function EvaluatorOptionBody({ option }: Readonly<EvaluatorOptionBodyProps>): ReactNode {
  const rating = Number.parseFloat(option.averageRating ?? "");
  return (
    <Stack spacing={0.5} sx={{ width: "100%" }}>
      <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
        <Typography variant="body1" sx={{ fontWeight: 600 }} dir="auto">
          {option.fullName}
        </Typography>
        <Box
          aria-hidden
          sx={theme => ({
            width: 8,
            height: 8,
            borderRadius: "50%",
            flexShrink: 0,
            bgcolor: option.isOnline ? theme.palette.success.main : theme.palette.text.disabled,
          })}
        />
      </Stack>
      {option.subjects !== null ? (
        <Typography variant="body2" sx={theme => ({ color: theme.palette.text.secondary })} dir="auto">
          {option.subjects}
        </Typography>
      ) : null}
      {option.averageRating !== null && Number.isFinite(rating) ? (
        <Rating value={rating} precision={0.5} readOnly size="small" />
      ) : null}
    </Stack>
  );
}

interface EvaluatorPickerListProps {
  /** The picker page items (empty until the open-gated read settles). */
  readonly evaluators: readonly AvailableEvaluatorsQuery_availableEvaluators_items[];
  /** `true` while the evaluator-page read is in flight. */
  readonly evaluatorsLoading: boolean;
  /** The selected evaluator's id, or `null` while nothing is chosen. */
  readonly selectedEvaluatorId: string | null;
  /** Marks one evaluator row as the confirm target. */
  readonly selectEvaluator: (id: string) => void;
  /** Localized exhausted-cycle copy (`applicant.availableEvaluatorsEmpty`). */
  readonly emptyLabel: string;
  /** Accessible label for the in-flight read marker. */
  readonly loadingLabel: string;
  /** `true` while the booking mutation is in flight (locks the radios). */
  readonly disabled: boolean;
}

/**
 * EvaluatorPickerList — the open-gated picker surface of the booking
 * dialog: the in-flight marker, the localized empty-page copy, and the
 * evaluator radio list (`{id, fullName, isOnline, averageRating,
 * subjects}`). All labels arrive localized from the caller; MUI v9
 * discipline (`sx`-only, theme palette callbacks) throughout.
 */
export function EvaluatorPickerList({
  evaluators,
  evaluatorsLoading,
  selectedEvaluatorId,
  selectEvaluator,
  emptyLabel,
  loadingLabel,
  disabled,
}: Readonly<EvaluatorPickerListProps>): ReactNode {
  return (
    <>
      {evaluatorsLoading ? <LinearProgress aria-label={loadingLabel} /> : null}
      {!evaluatorsLoading && evaluators.length === 0 ? (
        <Alert severity="info" variant="outlined">
          {emptyLabel}
        </Alert>
      ) : null}
      {evaluators.length > 0 ? (
        <RadioGroup
          value={selectedEvaluatorId ?? ""}
          onChange={event => {
            selectEvaluator(event.target.value);
          }}
        >
          {evaluators.map(option => (
            <FormControlLabel
              key={option.id}
              value={option.id}
              control={<Radio />}
              label={<EvaluatorOptionBody option={option} />}
              disabled={disabled}
              sx={{ alignItems: "flex-start" }}
            />
          ))}
        </RadioGroup>
      ) : null}
    </>
  );
}
