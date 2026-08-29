import type { ApplicantLabels } from "@/shared/locale/types/applicant";
import type { AuditLabels } from "@/shared/locale/types/audit";
import type { AuthLabels } from "@/shared/locale/types/auth";
import type { CommonLabels } from "@/shared/locale/types/common";
import type { DashboardLabels } from "@/shared/locale/types/dashboard";
import type { ErrorsLabels } from "@/shared/locale/types/errors";
import type { LandingLabels } from "@/shared/locale/types/landing";
import type { MySubscriptionsLabels } from "@/shared/locale/types/mySubscriptions";
import type { PaymentVerificationLabels } from "@/shared/locale/types/paymentVerification";
import type { PlansLabels } from "@/shared/locale/types/plans";
import type { RecitationLabels } from "@/shared/locale/types/recitation";
import type { StudentPlansLabels } from "@/shared/locale/types/studentPlans";
import type { SubscriptionManagementLabels } from "@/shared/locale/types/subscriptionManagement";

export interface Translations {
  auditTranslations: AuditLabels;
  commonTranslations: CommonLabels;
  authTranslations: AuthLabels;
  errorsTranslations: ErrorsLabels;
  recitationTranslations: RecitationLabels;
  dashboardTranslations: DashboardLabels;
  landingTranslations: LandingLabels;
  applicantTranslations: ApplicantLabels;
  plansTranslations: PlansLabels;
  studentPlansTranslations: StudentPlansLabels;
  mySubscriptionsTranslations: MySubscriptionsLabels;
  paymentVerificationTranslations: PaymentVerificationLabels;
  subscriptionManagementTranslations: SubscriptionManagementLabels;
}
