"use client";

/**
 * OnboardStudentParentSection — the optional parent association of the
 * onboarding dialog: an Autocomplete over the parent-role slice of the
 * admin users directory (options arrive through props — the hooks layer
 * feeds the role-filtered `adminUsersQueryDocument` page) joined below the
 * field with the picked parent's identity line. Leaving the picker empty
 * onboards the student without a parent link.
 */

import { FamilyRestroomOutlined as ParentIcon } from "@mui/icons-material";
import { Autocomplete, Box, Stack, TextField, Typography } from "@mui/material";
import type { SxProps, Theme } from "@mui/material/styles";
import type { Dispatch, ReactNode, SetStateAction } from "react";
import type { AdminUsersQuery_adminUsers_items } from "@/frontend/graphql/generated/gql/graphql";
import { OnboardStudentSectionHeading } from "@/frontend/views/admin/students/onboarding/OnboardStudentSectionHeading";
import type {
  OnboardStudentFieldErrors,
  OnboardStudentFormState,
} from "@/frontend/views/admin/students/onboarding/onboardingDialog.types";
import { useAppTranslation } from "@/shared/locale/client";
import { StudentOnboarding } from "@/shared/locale/namespaces/studentOnboarding";

/** Section caption glyph — rides `primary.main` (shared across the four sections). */
const SECTION_CAPTION_ICON_SX: SxProps<Theme> = theme => ({
  fontSize: 18,
  color: theme.palette.primary.main,
});

export interface OnboardStudentParentSectionProps {
  readonly form: OnboardStudentFormState;
  /** Draft setter owned by the dialog host (threaded through verbatim). */
  readonly setForm: Dispatch<SetStateAction<OnboardStudentFormState>>;
  readonly submitting: boolean;
  /** Parent-role directory rows — the picker's option set. */
  readonly parentOptions: readonly AdminUsersQuery_adminUsers_items[];
  /** True while the parent-page read is in flight — the picker shows its loading state. */
  readonly parentsLoading: boolean;
  readonly fieldErrors: OnboardStudentFieldErrors;
}

export function OnboardStudentParentSection({
  form,
  setForm,
  submitting,
  parentOptions,
  parentsLoading,
  fieldErrors,
}: OnboardStudentParentSectionProps): ReactNode {
  const t = useAppTranslation(StudentOnboarding);

  const pickedParent = parentOptions.find(option => option.id === form.parentId) ?? null;
  // The selected-state join is the view's job: the caption below carries
  // the linked-to line when a parent is picked, the none line otherwise.
  const stateLine = pickedParent ? `${t.parentSection.linkedTo} ${pickedParent.fullName}` : t.parentSection.none;

  return (
    <Stack sx={{ gap: 1 }}>
      <OnboardStudentSectionHeading
        index={2}
        icon={<ParentIcon aria-hidden sx={SECTION_CAPTION_ICON_SX} />}
        title={t.sections.parent}
      />
      <Autocomplete
        fullWidth
        disabled={submitting}
        loading={parentsLoading}
        loadingText={t.parentSection.loadingParents}
        options={[...parentOptions]}
        value={pickedParent}
        getOptionLabel={option => option.fullName}
        onChange={(_event, value) => {
          setForm(prev => ({ ...prev, parentId: value === null ? null : value.id }));
        }}
        renderOption={({ key, ...optionProps }, option) => (
          <li key={key} {...optionProps}>
            <Box sx={{ display: "grid", gap: 0.25 }}>
              <Typography variant="body2">{option.fullName}</Typography>
              <Typography variant="caption" sx={theme => ({ color: theme.palette.text.secondary })}>
                {option.email}
              </Typography>
            </Box>
          </li>
        )}
        renderInput={params => (
          <TextField
            {...params}
            placeholder={t.parentSection.searchPlaceholder}
            error={Boolean(fieldErrors.parentId)}
            helperText={fieldErrors.parentId ?? stateLine}
            aria-invalid={Boolean(fieldErrors.parentId)}
            slotProps={{
              // Merge (not replace) params.slotProps — the autocomplete's
              // endAdornment (popup chevron + clear affordance) lives there;
              // a bare slotProps prop would silently drop it.
              ...params.slotProps,
              htmlInput: { ...params.slotProps?.htmlInput, "aria-label": t.sections.parent },
            }}
          />
        )}
        sx={{
          // Popup indicator inherits action.active (dim on dark surfaces) —
          // lift it so the field reads as a picker, not a text input.
          "& .MuiAutocomplete-popupIndicator": {
            color: theme => theme.palette.text.primary,
          },
        }}
      />
    </Stack>
  );
}
