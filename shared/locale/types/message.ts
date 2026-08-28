import type { ApplicantLabels } from "@/shared/locale/types/applicant";
import type { AuthLabels } from "@/shared/locale/types/auth";
import type { CommonLabels } from "@/shared/locale/types/common";
import type { DashboardLabels } from "@/shared/locale/types/dashboard";
import type { ErrorsLabels } from "@/shared/locale/types/errors";
import type { LandingLabels } from "@/shared/locale/types/landing";
import type { PlansLabels } from "@/shared/locale/types/plans";
import type { RecitationLabels } from "@/shared/locale/types/recitation";

export interface Translations {
  commonTranslations: CommonLabels;
  authTranslations: AuthLabels;
  errorsTranslations: ErrorsLabels;
  recitationTranslations: RecitationLabels;
  dashboardTranslations: DashboardLabels;
  landingTranslations: LandingLabels;
  applicantTranslations: ApplicantLabels;
  plansTranslations: PlansLabels;
}
