import { defineNamespace } from "@/shared/locale/namespaces/define-namespace";
import type { ParentLinkLabels } from "@/shared/locale/types/parentLink";

export const ParentLink = defineNamespace<ParentLinkLabels>(
  "parentLink.parentLink",
  translations => translations.parentLinkTranslations
);
