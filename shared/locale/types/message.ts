import type { AdminBroadcastsLabels } from "@/shared/locale/types/adminBroadcasts";
import type { AdminUsersLabels } from "@/shared/locale/types/adminUsers";
import type { ApplicantLabels } from "@/shared/locale/types/applicant";
import type { AuthLabels } from "@/shared/locale/types/auth";
import type { CommonLabels } from "@/shared/locale/types/common";
import type { DashboardLabels } from "@/shared/locale/types/dashboard";
import type { ErrorsLabels } from "@/shared/locale/types/errors";
import type { HandshakeCodeLabels } from "@/shared/locale/types/handshakeCode";
import type { LandingLabels } from "@/shared/locale/types/landing";
import type { NotificationsLabels } from "@/shared/locale/types/notifications";
import type { ParentLinkLabels } from "@/shared/locale/types/parentLink";
import type { PlansLabels } from "@/shared/locale/types/plans";
import type { RecitationLabels } from "@/shared/locale/types/recitation";
import type { SessionsLabels } from "@/shared/locale/types/sessions";
import type { WalletLabels } from "@/shared/locale/types/wallet";

export interface Translations {
  commonTranslations: CommonLabels;
  authTranslations: AuthLabels;
  errorsTranslations: ErrorsLabels;
  recitationTranslations: RecitationLabels;
  dashboardTranslations: DashboardLabels;
  landingTranslations: LandingLabels;
  plansTranslations: PlansLabels;
  applicantTranslations: ApplicantLabels;
  sessionsTranslations: SessionsLabels;
  walletTranslations: WalletLabels;
  adminUsersTranslations: AdminUsersLabels;
  adminBroadcastsTranslations: AdminBroadcastsLabels;
  notificationsTranslations: NotificationsLabels;
  handshakeCodeTranslations: HandshakeCodeLabels;
  parentLinkTranslations: ParentLinkLabels;
}
