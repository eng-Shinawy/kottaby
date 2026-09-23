import { defineNamespace } from "@/shared/locale/namespaces/define-namespace";
import type { StudentOnboardingLabels } from "@/shared/locale/types/studentOnboarding";

export const StudentOnboarding = defineNamespace<StudentOnboardingLabels>(
  "studentOnboarding.studentOnboarding",
  translations => translations.studentOnboardingTranslations
);
