"use client";

/**
 * AdminStudentsToolbarFields — the student directory toolbar's specific text
 * input, extracted from `AdminStudentsToolbar` (same visual output):
 * `StudentLanguageField`, the exact-match language filter — the draft
 * commits on Enter or through the Apply icon button (rendered only while
 * the draft differs from the applied value) so intermediate keystrokes
 * never fire wasted queries. The toolbar's search input is the
 * directory-shared `DirectoryToolbarSearchField`.
 */

import {
  CheckOutlined as ApplyIcon,
  HighlightOutlined as HighlightIcon,
  HistoryOutlined as HistoryIcon,
  PersonAddOutlined as PersonAddIcon,
} from "@mui/icons-material";
import { Button, IconButton, InputAdornment, TextField, Tooltip } from "@mui/material";
import type { KeyboardEvent, ReactNode } from "react";
import type { AdminStudentsLabels } from "@/shared/locale/types/adminStudents";

/** Label slice consumed by the field. */
type ToolbarFieldLabels = Pick<AdminStudentsLabels, "filters">;

interface StudentLanguageFieldProps {
  readonly id: string;
  readonly labels: ToolbarFieldLabels;
  readonly value: string;
  readonly dirty: boolean;
  readonly onChange: (value: string) => void;
  readonly onApply: () => void;
}

/**
 * The language filter input — an exact-match predicate, so the draft
 * commits on Enter or through the Apply icon button (rendered only while
 * the draft differs from the applied value). The label stays pinned to the
 * notch so the field never renders without a visible label.
 */
export function StudentLanguageField({
  id,
  labels,
  value,
  dirty,
  onChange,
  onApply,
}: StudentLanguageFieldProps): ReactNode {
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      onApply();
    }
  };
  return (
    <TextField
      id={id}
      label={labels.filters.language}
      value={value}
      onChange={event => onChange(event.target.value)}
      onKeyDown={handleKeyDown}
      slotProps={{
        inputLabel: { shrink: true },
        htmlInput: { "aria-label": labels.filters.language },
        input: {
          ...(dirty && {
            endAdornment: (
              <InputAdornment position="end" sx={{ marginInlineStart: 0 }}>
                <Tooltip title={labels.filters.apply} placement="top">
                  <IconButton
                    size="small"
                    aria-label={labels.filters.apply}
                    onClick={onApply}
                    sx={theme => ({ color: theme.palette.text.secondary })}
                  >
                    <ApplyIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              </InputAdornment>
            ),
          }),
        },
      }}
      sx={{ minWidth: 150, flex: { xs: "1 1 100%", sm: "0 1 auto" }, "& .MuiInputBase-root": { minHeight: 54 } }}
    />
  );
}

interface HighlightRecentToggleProps {
  /** Whether highlight mode is active (the quiet lane dims non-matching rows). */
  readonly active: boolean;
  /** Flips the mode (the container owns the state). */
  readonly onToggle: () => void;
  /** The toolbar labels slice (the two toggle strings ride the filters group). */
  readonly labels: Pick<AdminStudentsLabels, "filters">;
}

/**
 * HighlightRecentToggle — the toolbar's aria-pressed toggle for the
 * directory's highlight mode: active paints the primary tint + a soft
 * selected background, inactive stays a quiet text button. The tooltip
 * carries the honest device-scoped wording (the recent set is the local
 * browser's last five onboardings, not a server fact).
 */
export function HighlightRecentToggle({ active, onToggle, labels }: HighlightRecentToggleProps): ReactNode {
  return (
    <Tooltip title={labels.filters.highlightRecentHint} placement="top" arrow>
      <Button
        variant="text"
        aria-pressed={active}
        onClick={onToggle}
        startIcon={<HighlightIcon />}
        sx={theme => ({
          // The 54px control token matches the toolbar's text buttons and
          // selects so one wrapped row reads as a single aligned band.
          minHeight: 54,
          flexShrink: 0,
          whiteSpace: "nowrap",
          color: active ? theme.palette.primary.main : theme.palette.text.secondary,
          bgcolor: active ? theme.palette.action.selected : "transparent",
          transition: theme.transitions.create("background-color"),
        })}
      >
        {labels.filters.highlightRecent}
      </Button>
    </Tooltip>
  );
}

interface OnboardingHistoryButtonProps {
  readonly labels: Pick<AdminStudentsLabels, "history">;
  readonly onClick: () => void;
}

/**
 * OnboardingHistoryButton — the toolbar's entry into the device-scoped
 * onboarding-history dialog (the cohort memory beyond the success screen):
 * a quiet icon button with the same 44px touch target as its toolbar
 * siblings and a tooltip carrying the honest device-scoped wording.
 */
export function OnboardingHistoryButton({ labels, onClick }: OnboardingHistoryButtonProps): ReactNode {
  return (
    <Tooltip title={labels.history.open} placement="top" arrow>
      <IconButton
        aria-label={labels.history.open}
        onClick={onClick}
        sx={theme => ({
          minHeight: 54,
          minWidth: 54,
          flexShrink: 0,
          color: theme.palette.text.secondary,
        })}
      >
        <HistoryIcon />
      </IconButton>
    </Tooltip>
  );
}

interface OnboardStudentButtonProps {
  /** The action label (rides the onboarding namespace's title slot). */
  readonly label: string;
  /** Opens the onboarding dialog (the container owns the flow). */
  readonly onClick: () => void;
  /** `true` while the dialog is open or its write is in flight. */
  readonly disabled: boolean;
}

/**
 * OnboardStudentButton — the toolbar's primary action (the direct student
 * onboarding entry): the contained primary button, 54px touch target
 * (the toolbar's shared control height), nowrap label, extracted to keep
 * the toolbar module inside its cap.
 */
export function OnboardStudentButton({ label, onClick, disabled }: OnboardStudentButtonProps): ReactNode {
  return (
    <Button
      variant="contained"
      startIcon={<PersonAddIcon />}
      onClick={onClick}
      disabled={disabled}
      sx={theme => ({
        borderRadius: "8px",
        minHeight: 54,
        flexShrink: 0,
        whiteSpace: "nowrap",
        bgcolor: theme.palette.primary.main,
        color: theme.palette.onPrimary,
        "&:hover": { bgcolor: theme.palette.primary.dark },
      })}
    >
      {label}
    </Button>
  );
}
