import { defineNamespace } from "@/shared/locale/namespaces/define-namespace";
import type { HomeworkLabels } from "@/shared/locale/types/homework";

export const Homework = defineNamespace<HomeworkLabels>(
  "homework.homework",
  translations => translations.homeworkTranslations
);
