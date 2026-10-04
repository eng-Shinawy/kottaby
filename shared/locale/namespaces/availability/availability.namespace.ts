import { defineNamespace } from "@/shared/locale/namespaces/define-namespace";
import type { AvailabilityLabels } from "@/shared/locale/types/availability";

export const Availability = defineNamespace<AvailabilityLabels>(
  "availability.availability",
  translations => translations.availabilityTranslations
);
