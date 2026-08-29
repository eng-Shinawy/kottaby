import { defineNamespace } from "@/shared/locale/namespaces/define-namespace";
import type { PaymentVerificationLabels } from "@/shared/locale/types/paymentVerification";

export const PaymentVerification = defineNamespace<PaymentVerificationLabels>(
  "admin.paymentVerification",
  translations => translations.paymentVerificationTranslations
);
