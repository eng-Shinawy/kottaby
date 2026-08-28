import { defineNamespace } from "@/shared/locale/namespaces/define-namespace";
import type { PlansLabels } from "@/shared/locale/types/plans";

export const Plans = defineNamespace<PlansLabels>("plans.plans", translations => translations.plansTranslations);
