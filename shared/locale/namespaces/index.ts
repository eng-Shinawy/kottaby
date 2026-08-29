import { Applicant } from "@/shared/locale/namespaces/applicant";
import { Audit } from "@/shared/locale/namespaces/audit";
import { Auth } from "@/shared/locale/namespaces/auth";
import { Common } from "@/shared/locale/namespaces/common";
import { Dashboard } from "@/shared/locale/namespaces/dashboard";
import { Errors } from "@/shared/locale/namespaces/errors";
import { Landing } from "@/shared/locale/namespaces/landing";
import { PaymentVerification } from "@/shared/locale/namespaces/paymentVerification";
import { Plans } from "@/shared/locale/namespaces/plans";
import { Recitation } from "@/shared/locale/namespaces/recitation";
import { StudentPlans } from "@/shared/locale/namespaces/studentPlans";
import { SubscriptionManagement } from "@/shared/locale/namespaces/subscriptionManagement";

export * from "./applicant";
export * from "./audit";
export * from "./auth";
export * from "./common";
export * from "./dashboard";
export * from "./define-namespace";
export * from "./errors";
export * from "./landing";
export * from "./paymentVerification";
export * from "./plans";
export * from "./recitation";
export * from "./studentPlans";
export * from "./subscriptionManagement";
export * from "./translation";

export const namespaces = {
  Applicant,
  Audit,
  Auth,
  Common,
  Dashboard,
  Errors,
  Landing,
  PaymentVerification,
  Plans,
  Recitation,
  StudentPlans,
  SubscriptionManagement,
} as const;
