import { defineNamespace } from "@/shared/locale/namespaces/define-namespace";
import type { NotificationsLabels } from "@/shared/locale/types/notifications";

export const Notifications = defineNamespace<NotificationsLabels>(
  "notifications.notifications",
  translations => translations.notificationsTranslations
);
