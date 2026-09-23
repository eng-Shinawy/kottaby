"use client";

/**
 * OnboardStudentPlanSection — the plan picker: a selectable card list over
 * the ACTIVE catalog plans (options arrive through props — the hooks layer
 * feeds `planCatalogQueryDocument`, active-only by construction). While the
 * catalog read is in flight the area renders skeleton placeholders (with
 * hidden loading copy); each card is the extracted
 * `OnboardStudentPlanCard`, and an empty resolved catalog swaps the cards
 * for the empty-catalog hint (the dialog keeps the submit unavailable).
 */

import { MenuBookOutlined as PlanIcon } from "@mui/icons-material";
import { Box, FormHelperText, Skeleton, Stack } from "@mui/material";
import type { SxProps, Theme } from "@mui/material/styles";
import type { Dispatch, ReactNode, SetStateAction } from "react";
import type { PlanCatalogQuery_planCatalog } from "@/frontend/graphql/generated/gql/graphql";
import { OnboardStudentPlanCard } from "@/frontend/views/admin/students/onboarding/OnboardStudentPlanCard";
import { OnboardStudentSectionHeading } from "@/frontend/views/admin/students/onboarding/OnboardStudentSectionHeading";
import type {
  OnboardStudentFieldErrors,
  OnboardStudentFormState,
} from "@/frontend/views/admin/students/onboarding/onboardingDialog.types";
import { useAppTranslation } from "@/shared/locale/client";
import { StudentOnboarding } from "@/shared/locale/namespaces/studentOnboarding";

/** Screen-reader-only recipe (the canonical `@mui/utils/visuallyHidden` values; px stay string literals — see the notifications feed). */
const VISUALLY_HIDDEN_TEXT_SX = {
  position: "absolute",
  width: "1px",
  height: "1px",
  padding: 0,
  margin: "-1px",
  overflow: "hidden",
  clip: "rect(0 0 0 0)",
  clipPath: "inset(50%)",
  whiteSpace: "nowrap",
  border: 0,
} as const;

/** Section caption glyph — rides `primary.main` (shared across the four sections). */
const SECTION_CAPTION_ICON_SX: SxProps<Theme> = theme => ({
  fontSize: 18,
  color: theme.palette.primary.main,
});

export interface OnboardStudentPlanSectionProps {
  /** The bound plan id token (the dialog pre-binds the first active plan). */
  readonly selectedPlanId: string;
  readonly planOptions: readonly PlanCatalogQuery_planCatalog[];
  /** True while the active-catalog read is in flight — renders placeholder cards. */
  readonly plansLoading: boolean;
  /** True when the catalog resolved empty — renders the inline hint. */
  readonly catalogEmpty: boolean;
  /** Draft setter owned by the dialog host (threaded through verbatim). */
  readonly setForm: Dispatch<SetStateAction<OnboardStudentFormState>>;
  readonly submitting: boolean;
  readonly fieldErrors: OnboardStudentFieldErrors;
}

export function OnboardStudentPlanSection({
  selectedPlanId,
  planOptions,
  plansLoading,
  catalogEmpty,
  setForm,
  submitting,
  fieldErrors,
}: OnboardStudentPlanSectionProps): ReactNode {
  const t = useAppTranslation(StudentOnboarding);

  return (
    <Stack sx={{ gap: 1 }}>
      <OnboardStudentSectionHeading
        index={3}
        icon={<PlanIcon aria-hidden sx={SECTION_CAPTION_ICON_SX} />}
        title={t.sections.plan}
      />
      {plansLoading ? (
        // In-flight placeholders — the option area never pops in empty while
        // the catalog read resolves (the empty hint only shows once it has).
        <Stack sx={{ gap: 1 }}>
          <Box component="span" sx={VISUALLY_HIDDEN_TEXT_SX}>
            {t.planSection.loadingPlans}
          </Box>
          <Skeleton variant="rounded" sx={{ height: 72, borderRadius: 1 }} />
          <Skeleton variant="rounded" sx={{ height: 72, borderRadius: 1 }} />
        </Stack>
      ) : (
        <Stack sx={{ gap: 1 }}>
          {planOptions.map(plan => (
            <OnboardStudentPlanCard
              key={plan.id}
              plan={plan}
              selected={plan.id === selectedPlanId}
              submitting={submitting}
              onSelect={() => setForm(prev => ({ ...prev, planId: plan.id }))}
            />
          ))}
        </Stack>
      )}
      {catalogEmpty ? <FormHelperText>{t.planSection.emptyCatalog}</FormHelperText> : null}
      {!catalogEmpty && fieldErrors.planId ? <FormHelperText error>{fieldErrors.planId}</FormHelperText> : null}
    </Stack>
  );
}
