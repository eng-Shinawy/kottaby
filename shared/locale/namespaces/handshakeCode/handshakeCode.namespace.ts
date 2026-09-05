import { defineNamespace } from "@/shared/locale/namespaces/define-namespace";
import type { HandshakeCodeLabels } from "@/shared/locale/types/handshakeCode";

export const HandshakeCode = defineNamespace<HandshakeCodeLabels>(
  "handshakeCode.handshakeCode",
  translations => translations.handshakeCodeTranslations
);
