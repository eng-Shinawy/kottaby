import { defineNamespace } from "@/shared/locale/namespaces/define-namespace";
import type { CheckoutLabels } from "@/shared/locale/types/checkout";

export const Checkout = defineNamespace<CheckoutLabels>(
  "checkout.checkout",
  translations => translations.checkoutTranslations
);
