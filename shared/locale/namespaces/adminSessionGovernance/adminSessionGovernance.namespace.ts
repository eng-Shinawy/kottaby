import { defineNamespace } from "@/shared/locale/namespaces/define-namespace";
import type { AdminSessionGovernanceLabels } from "@/shared/locale/types/adminSessionGovernance";

export const AdminSessionGovernance = defineNamespace<AdminSessionGovernanceLabels>(
  "adminSessionGovernance.adminSessionGovernance",
  t => t.adminSessionGovernanceTranslations
);
