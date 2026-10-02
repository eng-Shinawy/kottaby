import { defineNamespace } from "@/shared/locale/namespaces/define-namespace";
import type { AdminFinanceLabels } from "@/shared/locale/types/adminFinance";

export const AdminFinance = defineNamespace<AdminFinanceLabels>(
  "adminFinance.adminFinance",
  t => t.adminFinanceTranslations
);
