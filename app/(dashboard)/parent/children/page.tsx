import type { Metadata } from "next";
import { ComingSoonView } from "@/frontend/views/dashboard";
import { getTranslations } from "@/shared/locale/server";
import { getLocaleFromCookie } from "@/shared/locale/server-cookies";

/**
 * `/parent/children` — role-scoped alias of the `/children` "coming soon"
 * stub (the parent sidebar nav points at `/children`, which the
 * `(dashboard)/[feature]` catch-all already serves).
 *
 * Deep links / bookmarks pointing at the role-scoped path previously fell
 * through to a bare 404 because the single-segment catch-all cannot match
 * two-segment URLs. Rendering the same `ComingSoonView` here keeps the
 * dashboard shell (sidebar + footer) around the placeholder, exactly like
 * `/children`.
 */
export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocaleFromCookie();
  const t = getTranslations(locale).dashboardTranslations;
  return {
    title: t.comingSoonMetaTitle,
    description: t.comingSoonMetaDescription,
  };
}

export default function ParentChildrenComingSoonPage() {
  return <ComingSoonView feature="children" />;
}
