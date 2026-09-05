import { defineNamespace } from "@/shared/locale/namespaces/define-namespace";
import type { AdminBroadcastsLabels } from "@/shared/locale/types/adminBroadcasts";

export const AdminBroadcasts = defineNamespace<AdminBroadcastsLabels>(
  "adminBroadcasts.adminBroadcasts",
  t => t.adminBroadcastsTranslations
);
