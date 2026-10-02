import { defineNamespace } from "@/shared/locale/namespaces/define-namespace";
import type { UpNextLabels } from "@/shared/locale/types/upNext";

export const UpNext = defineNamespace<UpNextLabels>("upNext.upNext", translations => translations.upNextTranslations);
