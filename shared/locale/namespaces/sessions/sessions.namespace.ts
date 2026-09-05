import { defineNamespace } from "@/shared/locale/namespaces/define-namespace";
import type { SessionsLabels } from "@/shared/locale/types/sessions";

export const Sessions = defineNamespace<SessionsLabels>(
  "sessions.sessions",
  translations => translations.sessionsTranslations
);
