import { defineNamespace } from "@/shared/locale/namespaces/define-namespace";
import type { AuditLabels } from "@/shared/locale/types/audit";

export const Audit = defineNamespace<AuditLabels>("admin.audit", translations => translations.auditTranslations);
