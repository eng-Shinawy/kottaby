import { defineNamespace } from "@/shared/locale/namespaces/define-namespace";
import type { ParentMonitoringLabels } from "@/shared/locale/types/parentMonitoring";

export const ParentMonitoring = defineNamespace<ParentMonitoringLabels>(
  "parentMonitoring.parentMonitoring",
  translations => translations.parentMonitoringTranslations
);
