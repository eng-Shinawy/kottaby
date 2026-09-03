import { adminBroadcastsAr } from "@/shared/locale/ar/adminBroadcasts";
import { adminUsersAr } from "@/shared/locale/ar/adminUsers";
import { applicantAr } from "@/shared/locale/ar/applicant";
import { authAr } from "@/shared/locale/ar/auth";
import { commonAr } from "@/shared/locale/ar/common";
import { dashboardAr } from "@/shared/locale/ar/dashboard";
import { errorsAr } from "@/shared/locale/ar/errors";
import { handshakeCodeAr } from "@/shared/locale/ar/handshakeCode";
import { landingAr } from "@/shared/locale/ar/landing";
import { notificationsAr } from "@/shared/locale/ar/notifications";
import { plansAr } from "@/shared/locale/ar/plans";
import { recitationAr } from "@/shared/locale/ar/recitation";
import { sessionsAr } from "@/shared/locale/ar/sessions";
import { walletAr } from "@/shared/locale/ar/wallet";
import type { Translations } from "@/shared/locale/types/message";

export const arMessages: Translations = {
  commonTranslations: commonAr,
  authTranslations: authAr,
  errorsTranslations: errorsAr,
  recitationTranslations: recitationAr,
  dashboardTranslations: dashboardAr,
  landingTranslations: landingAr,
  plansTranslations: plansAr,
  applicantTranslations: applicantAr,
  sessionsTranslations: sessionsAr,
  walletTranslations: walletAr,
  adminUsersTranslations: adminUsersAr,
  adminBroadcastsTranslations: adminBroadcastsAr,
  notificationsTranslations: notificationsAr,
  handshakeCodeTranslations: handshakeCodeAr,
};
