import { Landing, useAppTranslation } from "@/shared/locale";

/** Scroll-spy targets in visual order (module const: stable identity). */
export const LANDING_SECTION_IDS = [
  "verse",
  "features",
  "recitations",
  "curriculum",
  "how-it-works",
  "achievements",
  "teachers",
  "roles",
  "pricing",
  "testimonials",
  "faq",
  "newsletter",
  "contact",
  "app",
] as const;

export interface LandingNavLink {
  readonly label: string;
  readonly href: string;
}

/** Localized nav anchor list for the top bar and mobile drawer. */
export function useLandingNavLinks(): {
  readonly navLinks: readonly LandingNavLink[];
  readonly desktopNavLinks: readonly LandingNavLink[];
} {
  const t = useAppTranslation(Landing);
  const navLinks = [
    { label: t.navVerse, href: "#verse" },
    { label: t.navApp, href: "#app" },
    { label: t.navFeatures, href: "#features" },
    { label: t.navRecitations, href: "#recitations" },
    { label: t.navHowItWorks, href: "#how-it-works" },
    { label: t.navRoles, href: "#roles" },
    { label: t.navTestimonials, href: "#testimonials" },
    { label: t.navFaq, href: "#faq" },
    { label: t.navPricing, href: "#pricing" },
    { label: t.navContact, href: "#contact" },
    { label: t.navAchievements, href: "#achievements" },
    { label: t.navTeachers, href: "#teachers" },
    { label: t.navCurriculum, href: "#curriculum" },
    { label: t.navResources, href: "#resources" },
  ];

  // The desktop bar shows the 8 primary sections that measurably fit at
  // 1200-1366px alongside brand + actions. The landing now has 14 anchors
  // (teachers/resources added by the spotlight/resources sections): the
  // 12-link set overlapped the locale switcher by 76px at 1280, and a
  // 10-link set still clipped by 30px. Hidden anchors stay in the mobile
  // drawer and remain reachable by scroll (#verse = page top, #app = bottom,
  // #contact = footer column + newsletter CTA).
  const desktopNavHidden = new Set(["#verse", "#app", "#contact", "#resources", "#roles", "#testimonials"]);
  const desktopNavLinks = navLinks.filter(l => !desktopNavHidden.has(l.href));

  return { navLinks, desktopNavLinks };
}
