import { defineNamespace } from "@/shared/locale/namespaces/define-namespace";
import type { TeacherDirectoryLabels } from "@/shared/locale/types/teacherDirectory";

export const TeacherDirectory = defineNamespace<TeacherDirectoryLabels>(
  "teacherDirectory.teacherDirectory",
  translations => translations.teacherDirectoryTranslations
);
