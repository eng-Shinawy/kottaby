import type { Metadata } from "next";
import { UserRole } from "@/backend/enum/users/user-role.enum";
import { withPageAuth } from "@/frontend/lib/auth/withPageAuth";
import { HandshakeDiscoveryContainer } from "@/frontend/views/parent/handshake";
import { getTranslations } from "@/shared/locale/server";
import { getLocaleFromCookie } from "@/shared/locale/server-cookies";

/**
 * `/parent/handshake` — the parent-side student discovery page.
 *
 * Server Component shell: the `withPageAuth` guard is the ONLY authorization
 * boundary (anonymous callers bounce to `/login?redirect=/parent/handshake`,
 * any non-parent role bounces to its own role dashboard), and the page
 * resolves the shell labels server-side (`getTranslations(locale)` is
 * synchronous) so the client container receives already-translated strings
 * for its static heading copy — every interactive label is resolved
 * client-side through the `HandshakeCode` namespace handle.
 *
 * The container below owns the search form + outcome states (idle / searching
 * / not-found / found) and calls the parent-gated `findStudentByHandshakeCode`
 * query through a stateful `useQuery` gated by a validated-code state variable
 * — no server-side GraphQL calls happen here.
 */
export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocaleFromCookie();
  const t = getTranslations(locale).handshakeCodeTranslations;
  return {
    title: t.pageTitle,
    description: t.pageDescription,
  };
}

export default async function ParentHandshakePage() {
  await withPageAuth({ roles: [UserRole.Parent], redirectTo: "/parent/handshake" });

  const locale = await getLocaleFromCookie();
  const t = getTranslations(locale).handshakeCodeTranslations;

  return <HandshakeDiscoveryContainer pageTitle={t.pageTitle} pageDescription={t.pageDescription} />;
}
