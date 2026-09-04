import type { Metadata } from "next";
import type { ReactNode } from "react";
import { NotFoundView } from "@/frontend/views/system";
import { getTranslations } from "@/shared/locale/server";
import { getLocaleFromCookie } from "@/shared/locale/server-cookies";

/**
 * Global 404 boundary — rendered for any URL no route matches (e.g.
 * `/parent/children`, `/xyz-not-exist`).
 *
 * Before this file existed, unmatched routes fell through to the default
 * English LTR Next.js error page — unbranded and direction-hostile inside an
 * Arabic-RTL app. The branded `NotFoundView` inherits the root layout, so
 * `<html lang>` / `<html dir>` and the client translation providers already
 * agree with the visitor's persisted locale (NEXT_LOCALE cookie).
 */
export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocaleFromCookie();
  const t = getTranslations(locale).landingTranslations;
  return {
    title: t.notFoundMetaTitle,
    description: t.notFoundMetaDescription,
  };
}

export default function NotFound(): ReactNode {
  return <NotFoundView />;
}
