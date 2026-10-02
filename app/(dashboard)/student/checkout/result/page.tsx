import type { Metadata } from "next";
import { UserRole } from "@/backend/enum/users/user-role.enum";
import { withPageAuth } from "@/frontend/lib/auth/withPageAuth";
import { PaymentResultContainer } from "@/frontend/views/student/checkout/result/PaymentResultContainer";
import { getTranslations } from "@/shared/locale/server";
import { getLocaleFromCookie } from "@/shared/locale/server-cookies";

/**
 * `/student/checkout/result` route — the server component shell that renders
 * the `PaymentResultContainer` client component after the gateway redirect.
 *
 * The guard is the ONLY authorization boundary:
 * `withPageAuth({ roles: [UserRole.Student] })` — anonymous callers redirect
 * to `/login?redirect=/student/checkout/result`; role mismatches bounce to
 * their own role dashboard. The container performs no role logic (the
 * `mySubscriptions` read scope IS the verified caller identity per BOPLA
 * hygiene).
 *
 * The gateway's GET redirect query params are display HINTS ONLY — never
 * state truth. The page forwards the raw search-params record to the
 * container, which derives every render branch from the authoritative
 * `mySubscriptions` re-query alone. Server-side consumption of the params
 * stops at this pass-through: nothing in the hint record can elevate or
 * suppress a render branch.
 *
 * Metadata is generated dynamically from the active locale (read from the
 * `NEXT_LOCALE` cookie).
 */
export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocaleFromCookie();
  const t = getTranslations(locale).checkoutTranslations;
  return {
    title: t.resultMetaTitle,
  };
}

export default async function StudentCheckoutResultPage({
  searchParams,
}: Readonly<{
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}>) {
  await withPageAuth({ roles: [UserRole.Student], redirectTo: "/student/checkout/result" });
  // Hints pass-through: awaited per the Next.js 16 promise contract, then
  // handed to the client verbatim. The container treats every value as
  // untrusted display context (zero state decisions key off it).
  const params = await searchParams;
  return <PaymentResultContainer hintParams={params} />;
}
