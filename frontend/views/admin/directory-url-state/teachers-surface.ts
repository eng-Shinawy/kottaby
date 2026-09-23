/**
 * Directory URL state — `/teachers` tab flag + surface composition.
 *
 * The full `/teachers` URL contract is the `tab` flag PLUS the active
 * tab's view params: this module parses the tab and composes the
 * surface-level query string out of the per-tab contracts in
 * `teachers-directory.ts` / `teachers-applicants.ts`.
 */

import type { ReadableSearchParams } from "@/frontend/views/admin/directory-url-state/shared";
import { serializeApplicantsUrlState } from "@/frontend/views/admin/directory-url-state/teachers-applicants";
import { serializeTeachersDirectoryUrlState } from "@/frontend/views/admin/directory-url-state/teachers-directory";

export type TeachersUrlTab = "teachers" | "applicants";

/** Parses the `tab` param — ANY non-`applicants` value (or its absence)
 * resolves to the default teachers tab (fail-safe single-direction flag). */
export function parseTeachersUrlTab(searchParams: ReadableSearchParams): TeachersUrlTab {
  return searchParams.get("tab") === "applicants" ? "applicants" : "teachers";
}

/**
 * Full `/teachers` URL contract: the tab PLUS the active tab's view params.
 * The surface's write effect composes this — `tab` is omitted on the
 * default teachers tab, and ONLY the active tab's filter keys serialize
 * (the hidden tab's state is intentionally not mirrored — the URL always
 * describes what an admin sees).
 */
export function serializeTeachersSurfaceUrlState(input: {
  tab: TeachersUrlTab;
  directory: Parameters<typeof serializeTeachersDirectoryUrlState>[0];
  applicants: Parameters<typeof serializeApplicantsUrlState>[0];
}): string {
  if (input.tab === "applicants") {
    // The tab flag itself is non-default state — it serializes even when
    // the queue view underneath is entirely default (a shared link to
    // `?tab=applicants` must open the QUEUE, not the directory).
    const applicants = serializeApplicantsUrlState(input.applicants);
    return applicants === "" ? "tab=applicants" : withTab(applicants);
  }
  const directory = serializeTeachersDirectoryUrlState(input.directory);
  return directory;
}

/** Prepends `tab=applicants` to a non-empty applicants query string. */
function withTab(applicantsQuery: string): string {
  return `tab=applicants&${applicantsQuery}`;
}
