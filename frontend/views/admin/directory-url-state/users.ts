/**
 * Directory URL state — `/users` surface contract.
 *
 * Layers the admin user-directory keys on the shared trio: `role`
 * (`admin` | `teacher` | `student` | `parent`), `governance`
 * (`active` | `suspended` | `blocked` | `deleted`) and `country` (trimmed
 * free text). See `directory-url-state.ts` for the URL contract (v1) and
 * the fail-closed parsing rules.
 */

import {
  appendBaseParams,
  type BaseDirectoryUrlState,
  parseBaseParams,
  parseMappedParam,
  type ReadableSearchParams,
} from "@/frontend/views/admin/directory-url-state/shared";

/** Lowercase wire values for the admin-surface role union (parse direction). */
const USERS_ROLE_WIRE: Readonly<Record<string, "Admin" | "Teacher" | "Student" | "Parent">> = {
  admin: "Admin",
  teacher: "Teacher",
  student: "Student",
  parent: "Parent",
};

/** Lowercase wire values for the governance buckets (parse direction). */
const USERS_GOVERNANCE_WIRE: Readonly<Record<string, "Active" | "Suspended" | "Blocked" | "Deleted">> = {
  active: "Active",
  suspended: "Suspended",
  blocked: "Blocked",
  deleted: "Deleted",
};

interface UsersDirectoryUrlState extends BaseDirectoryUrlState {
  readonly role: "Admin" | "Teacher" | "Student" | "Parent" | "";
  readonly governance: "Active" | "Suspended" | "Blocked" | "Deleted" | "";
  readonly country: string;
}

/** Parses the `/users` URL contract into the hook's initial state. */
export function parseUsersUrlState(searchParams: ReadableSearchParams): UsersDirectoryUrlState {
  return {
    ...parseBaseParams(searchParams),
    role: parseMappedParam(searchParams, "role", USERS_ROLE_WIRE) ?? "",
    governance: parseMappedParam(searchParams, "governance", USERS_GOVERNANCE_WIRE) ?? "",
    country: searchParams.get("country") ?? "",
  };
}

/**
 * Serializes the users hook's APPLIED state into a query string. The country
 * filter is a free-text field committed per keystroke, so the serializer
 * trims it — a whitespace-only draft shares as the default (omitted), and
 * the shared link always carries the exact predicate the query runs.
 */
export function serializeUsersUrlState(input: {
  q: string;
  role: "Admin" | "Teacher" | "Student" | "Parent" | "";
  governance: "Active" | "Suspended" | "Blocked" | "Deleted" | "";
  country: string;
  page: number;
  pageSize: number;
}): string {
  const params = new URLSearchParams();
  appendBaseParams(params, input);
  if (input.role !== "") {
    params.set("role", input.role.toLowerCase());
  }
  if (input.governance !== "") {
    params.set("governance", input.governance.toLowerCase());
  }
  if (input.country.trim() !== "") {
    params.set("country", input.country.trim());
  }
  return params.toString();
}
