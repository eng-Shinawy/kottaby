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

import { CheckOutlined as ApplyIcon } from "@mui/icons-material";
import { IconButton, InputAdornment, TextField, Tooltip } from "@mui/material";
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
      sx={{ minWidth: 150, flex: { xs: "1 1 100%", sm: "0 1 auto" }, "& .MuiInputBase-root": { height: 44 } }}
    />
  );
}
