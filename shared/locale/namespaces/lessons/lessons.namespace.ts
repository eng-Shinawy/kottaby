import { defineNamespace } from "@/shared/locale/namespaces/define-namespace";
import type { LessonsLabels } from "@/shared/locale/types/lessons";

export const Lessons = defineNamespace<LessonsLabels>(
  "lessons.lessons",
  translations => translations.lessonsTranslations
);
