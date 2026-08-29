import { defineNamespace } from "@/shared/locale/namespaces/define-namespace";
import type { SubscriptionManagementLabels } from "@/shared/locale/types/subscriptionManagement";

export const SubscriptionManagement = defineNamespace<SubscriptionManagementLabels>(
  "admin.subscriptionManagement",
  translations => translations.subscriptionManagementTranslations
);
