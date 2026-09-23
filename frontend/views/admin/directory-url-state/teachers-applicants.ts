/**
 * Directory URL state — `/teachers` applicants-tab contract.
 *
 * The applicants (review queue) tab reuses the shared `q`/`page`/`size`
 * trio plus `status` — the four canonical wire values verbatim. The URL
 * ALWAYS describes the ACTIVE tab's view; the tab flag itself lives in
 * `teachers-surface.ts`.
 */

import {
  appendBaseParams,
  type BaseDirectoryUrlState,
  parseBaseParams,
  parseMappedParam,
  type ReadableSearchParams,
} from "@/frontend/views/admin/directory-url-state/shared";

/** The four canonical applicant-status wire values (parse direction). */
const APPLICANT_STATUS_WIRE: Readonly<Record<string, "pending" | "in_evaluation" | "failed" | "passed">> = {
  pending: "pending",
  in_evaluation: "in_evaluation",
  failed: "failed",
  passed: "passed",
};

export interface ApplicantsUrlState extends BaseDirectoryUrlState {
  readonly status: "pending" | "in_evaluation" | "failed" | "passed" | "";
}

/** Parses the `/teachers` APPLICANTS-tab URL contract. */
export function parseApplicantsUrlState(searchParams: ReadableSearchParams): ApplicantsUrlState {
  return {
    ...parseBaseParams(searchParams),
    status: parseMappedParam(searchParams, "status", APPLICANT_STATUS_WIRE) ?? "",
  };
}

export function serializeApplicantsUrlState(input: {
  q: string;
  status: "pending" | "in_evaluation" | "failed" | "passed" | "";
  page: number;
  pageSize: number;
}): string {
  const params = new URLSearchParams();
  appendBaseParams(params, input);
  if (input.status !== "") {
    params.set("status", input.status);
  }
  return params.toString();
}
