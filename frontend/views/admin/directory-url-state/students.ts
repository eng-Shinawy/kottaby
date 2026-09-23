/**
 * Directory URL state — `/students` surface contract.
 *
 * Layers the students-directory keys on the shared trio: `parent`
 * (`with` | `independent`) and `lang` (applied exact-match language).
 * See `directory-url-state.ts` for the URL contract (v1) and the
 * fail-closed parsing rules.
 */

import {
  appendBaseParams,
  type BaseDirectoryUrlState,
  parseBaseParams,
  parseMappedParam,
  type ReadableSearchParams,
} from "@/frontend/views/admin/directory-url-state/shared";

/** Lowercase wire values for the parent-link union (parse direction). */
const STUDENT_PARENT_WIRE: Readonly<Record<string, "WithParent" | "Independent">> = {
  with: "WithParent",
  independent: "Independent",
};

interface StudentsDirectoryUrlState extends BaseDirectoryUrlState {
  readonly parent: "WithParent" | "Independent" | "";
  readonly lang: string;
}

/** Parses the `/students` URL contract into the hook's initial state. */
export function parseStudentsUrlState(searchParams: ReadableSearchParams): StudentsDirectoryUrlState {
  return {
    ...parseBaseParams(searchParams),
    parent: parseMappedParam(searchParams, "parent", STUDENT_PARENT_WIRE) ?? "",
    lang: searchParams.get("lang") ?? "",
  };
}

/** Serializes the students hook's APPLIED state into a query string. */
export function serializeStudentsUrlState(input: {
  q: string;
  parent: "WithParent" | "Independent" | "";
  lang: string;
  page: number;
  pageSize: number;
}): string {
  const params = new URLSearchParams();
  appendBaseParams(params, input);
  if (input.parent === "WithParent") {
    params.set("parent", "with");
  } else if (input.parent === "Independent") {
    params.set("parent", "independent");
  }
  if (input.lang !== "") {
    params.set("lang", input.lang);
  }
  return params.toString();
}
