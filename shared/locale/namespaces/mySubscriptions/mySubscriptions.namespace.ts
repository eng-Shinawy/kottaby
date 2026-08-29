import { defineNamespace } from "@/shared/locale/namespaces/define-namespace";
import type { MySubscriptionsLabels } from "@/shared/locale/types/mySubscriptions";

export const MySubscriptions = defineNamespace<MySubscriptionsLabels>(
  "student.mySubscriptions",
  translations => translations.mySubscriptionsTranslations
);
