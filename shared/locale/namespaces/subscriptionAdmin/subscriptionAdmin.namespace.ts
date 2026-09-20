import { defineNamespace } from "@/shared/locale/namespaces/define-namespace";
import type { SubscriptionAdminLabels } from "@/shared/locale/types/subscriptionAdmin";

export const SubscriptionAdmin = defineNamespace<SubscriptionAdminLabels>(
  "subscriptionAdmin.subscriptionAdmin",
  translations => translations.subscriptionAdminTranslations
);
