import { defineNamespace } from "@/shared/locale/namespaces/define-namespace";
import type { WalletLabels } from "@/shared/locale/types/wallet";

export const Wallet = defineNamespace<WalletLabels>("wallet.wallet", translations => translations.walletTranslations);
