import type { Metadata } from "next";
import { UserRole } from "@/backend/enum/users/user-role.enum";
import { withPageAuth } from "@/frontend/lib/auth/withPageAuth";
import { TeacherWalletContainer } from "@/frontend/views/teacher/wallet/TeacherWalletContainer";
import { getTranslations } from "@/shared/locale/server";
import { getLocaleFromCookie } from "@/shared/locale/server-cookies";

/**
 * `/wallet` route — the teacher's self-service wallet (DEV3-013): the
 * balance surface + the withdrawal-request flow + the transaction ledger.
 *
 * This page replaces the catch-all ComingSoon stub the `/wallet` teacher
 * nav entry used to resolve to. It mirrors the sessions pages' structure
 * and runs the SAME server guard the dashboard pages use:
 * `withPageAuth({ roles: [UserRole.Teacher] })` — anonymous callers
 * redirect to `/login?redirect=/wallet`; role mismatches bounce to their
 * own role dashboard. The guard is the ONLY authorization boundary; the
 * container performs no role logic (the `myWallet` identity is
 * server-bound per BOPLA hygiene).
 *
 * Metadata is generated dynamically from the active locale (read from the
 * `NEXT_LOCALE` cookie).
 */
export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocaleFromCookie();
  const t = getTranslations(locale).walletTranslations;
  return {
    title: t.pageTitle,
  };
}

export default async function WalletPage() {
  await withPageAuth({ roles: [UserRole.Teacher], redirectTo: "/wallet" });
  return <TeacherWalletContainer />;
}
