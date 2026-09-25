import { defineNamespace } from "@/shared/locale/namespaces/define-namespace";
import type { AdminAcademicLabels } from "@/shared/locale/types/adminAcademic";

export const AdminAcademic = defineNamespace<AdminAcademicLabels>(
  "adminAcademic.adminAcademic",
  translations => translations.adminAcademicTranslations
);
