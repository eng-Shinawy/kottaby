import { defineNamespace } from "@/shared/locale/namespaces/define-namespace";
import type { ScheduleLabels } from "@/shared/locale/types/schedule";

export const Schedule = defineNamespace<ScheduleLabels>(
  "schedule.schedule",
  translations => translations.scheduleTranslations
);
