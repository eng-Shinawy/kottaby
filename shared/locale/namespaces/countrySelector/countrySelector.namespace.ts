import { defineNamespace } from "@/shared/locale/namespaces/define-namespace";
import type { CountrySelectorLabels } from "@/shared/locale/types/countrySelector";

export const CountrySelector = defineNamespace<CountrySelectorLabels>(
  "countrySelector.countrySelector",
  translations => translations.countrySelectorTranslations
);
