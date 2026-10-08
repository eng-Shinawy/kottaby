import { defineNamespace } from "@/shared/locale/namespaces/define-namespace";
import type { PhoneInputLabels } from "@/shared/locale/types/phoneInput";

export const PhoneInput = defineNamespace<PhoneInputLabels>(
  "phoneInput.phoneInput",
  translations => translations.phoneInputTranslations
);
