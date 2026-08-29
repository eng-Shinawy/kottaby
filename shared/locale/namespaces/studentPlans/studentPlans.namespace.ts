import { defineNamespace } from "@/shared/locale/namespaces/define-namespace";
import type { StudentPlansLabels } from "@/shared/locale/types/studentPlans";

export const StudentPlans = defineNamespace<StudentPlansLabels>(
  "plans.studentPlans",
  translations => translations.studentPlansTranslations
);
