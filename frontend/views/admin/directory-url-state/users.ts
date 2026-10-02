/**
 * Directory URL state — `/users` surface contract.
 *
 * Layers the admin user-directory keys on the shared trio: `role`
 * (`admin` | `teacher` | `student` | `parent`), `governance`
 * (`active` | `suspended` | `blocked` | `deleted`), `country` (the ISO
 * 3166-1 alpha-2 code the toolbar's selector commits; historical links may
 * still carry legacy display text — the consuming hook resolves the seed
 * through `countrySeedToCode` and drops unresolvable values) and the
 * applicant-lifecycle keys `status`
 * (`pending` | `in_evaluation` | `failed` | `passed`), `cooldown`
 * (`none` | `active` | `expired`) and `expiring` (`1` — the
 * expiring-soon window narrow the dashboard lifecycle panel deep-links
 * into; omitted when absent). `status`/`cooldown` are spelled with the
 * canonical lowercase runtime values verbatim (the same encoding the
 * `/teachers` applicants tab uses for `status`, so one lifecycle
 * vocabulary reads identically across admin surfaces). See
 * `directory-url-state.ts` for the URL contract (v1) and the
 * fail-closed parsing rules.
 */

import {
  appendBaseParams,
  type BaseDirectoryUrlState,
  parseBaseParams,
  parseMappedParam,
  type ReadableSearchParams,
} from "@/frontend/views/admin/directory-url-state/shared";
import type { DirectoryApplicantStatus, DirectoryCooldownState } from "@/frontend/views/admin/users/utils";

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

/** Canonical lowercase runtime values of `ApplicantStatus` (parse direction). */
const USERS_APPLICANT_STATUS_WIRE: Readonly<Record<string, DirectoryApplicantStatus>> = {
  pending: "Pending",
  in_evaluation: "InEvaluation",
  failed: "Failed",
  passed: "Passed",
};

/** Canonical lowercase runtime values of `ApplicantCooldownState` (parse direction). */
const USERS_COOLDOWN_STATE_WIRE: Readonly<Record<string, DirectoryCooldownState>> = {
  none: "None",
  active: "Active",
  expired: "Expired",
};

/**
 * Accepted spellings of the expiring-soon window narrow (parse direction):
 * the panel's deep-link emits `expiring=1`; `true` is tolerated as the
 * word-spelled equivalent — anything else parses to the default (absent),
 * fail-closed. A dedicated parser (not `parseMappedParam`): the narrow is
 * a boolean state, and the shared helper is string-typed by design.
 */
function parseExpiringNarrow(searchParams: ReadableSearchParams): boolean {
  const raw = searchParams.get("expiring");
  return raw === "1" || raw === "true";
}

/** Serialize-direction inverses — draft member → canonical lowercase URL value. */
const APPLICANT_STATUS_URL_VALUE: Readonly<Record<DirectoryApplicantStatus, string>> = {
  Pending: "pending",
  InEvaluation: "in_evaluation",
  Failed: "failed",
  Passed: "passed",
};

const COOLDOWN_STATE_URL_VALUE: Readonly<Record<DirectoryCooldownState, string>> = {
  None: "none",
  Active: "active",
  Expired: "expired",
};

interface UsersDirectoryUrlState extends BaseDirectoryUrlState {
  readonly role: "Admin" | "Teacher" | "Student" | "Parent" | "";
  readonly governance: "Active" | "Suspended" | "Blocked" | "Deleted" | "";
  readonly applicantStatus: DirectoryApplicantStatus | "";
  readonly cooldownState: DirectoryCooldownState | "";
  readonly cooldownExpiringSoon: boolean;
  readonly country: string;
}

/** Parses the `/users` URL contract into the hook's initial state. */
export function parseUsersUrlState(searchParams: ReadableSearchParams): UsersDirectoryUrlState {
  return {
    ...parseBaseParams(searchParams),
    role: parseMappedParam(searchParams, "role", USERS_ROLE_WIRE) ?? "",
    governance: parseMappedParam(searchParams, "governance", USERS_GOVERNANCE_WIRE) ?? "",
    applicantStatus: parseMappedParam(searchParams, "status", USERS_APPLICANT_STATUS_WIRE) ?? "",
    cooldownState: parseMappedParam(searchParams, "cooldown", USERS_COOLDOWN_STATE_WIRE) ?? "",
    cooldownExpiringSoon: parseExpiringNarrow(searchParams),
    country: searchParams.get("country") ?? "",
  };
}

/**
 * Serializes the users hook's APPLIED state into a query string. The country
 * filter is the selector's committed ISO code, so the serializer trims it —
 * a cleared draft shares as the default (omitted), and the shared link
 * always carries the exact predicate the query runs.
 */
export function serializeUsersUrlState(input: {
  q: string;
  role: "Admin" | "Teacher" | "Student" | "Parent" | "";
  governance: "Active" | "Suspended" | "Blocked" | "Deleted" | "";
  applicantStatus: DirectoryApplicantStatus | "";
  cooldownState: DirectoryCooldownState | "";
  cooldownExpiringSoon: boolean;
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
  if (input.applicantStatus !== "") {
    params.set("status", APPLICANT_STATUS_URL_VALUE[input.applicantStatus]);
  }
  if (input.cooldownState !== "") {
    params.set("cooldown", COOLDOWN_STATE_URL_VALUE[input.cooldownState]);
  }
  if (input.cooldownExpiringSoon) {
    params.set("expiring", "1");
  }
  if (input.country.trim() !== "") {
    params.set("country", input.country.trim());
  }
  return params.toString();
}
