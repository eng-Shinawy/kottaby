/**
 * Directory URL state — `/teachers` directory-tab contract.
 *
 * The certified-teacher directory tab's keys: `approval` (`approved` |
 * `pending`), `online` (`online` | `offline`), `evaluator` (`yes` | `no`)
 * — on top of the shared `q`/`page`/`size` trio. The URL ALWAYS describes
 * the ACTIVE tab's view; the tab flag itself lives in
 * `teachers-surface.ts`.
 */

import {
  appendBaseParams,
  type BaseDirectoryUrlState,
  parseBaseParams,
  parseMappedParam,
  type ReadableSearchParams,
} from "@/frontend/views/admin/directory-url-state/shared";

const TEACHER_APPROVAL_WIRE: Readonly<Record<string, "Approved" | "Pending">> = {
  approved: "Approved",
  pending: "Pending",
};
const TEACHER_ONLINE_WIRE: Readonly<Record<string, "Online" | "Offline">> = {
  online: "Online",
  offline: "Offline",
};
const TEACHER_EVALUATOR_WIRE: Readonly<Record<string, "Evaluator" | "NonEvaluator">> = {
  yes: "Evaluator",
  no: "NonEvaluator",
};

export interface TeachersDirectoryUrlState extends BaseDirectoryUrlState {
  readonly approval: "Approved" | "Pending" | "";
  readonly online: "Online" | "Offline" | "";
  readonly evaluator: "Evaluator" | "NonEvaluator" | "";
}

/** Parses the `/teachers` TEACHERS-tab URL contract. */
export function parseTeachersDirectoryUrlState(searchParams: ReadableSearchParams): TeachersDirectoryUrlState {
  return {
    ...parseBaseParams(searchParams),
    approval: parseMappedParam(searchParams, "approval", TEACHER_APPROVAL_WIRE) ?? "",
    online: parseMappedParam(searchParams, "online", TEACHER_ONLINE_WIRE) ?? "",
    evaluator: parseMappedParam(searchParams, "evaluator", TEACHER_EVALUATOR_WIRE) ?? "",
  };
}

export function serializeTeachersDirectoryUrlState(input: {
  q: string;
  approval: "Approved" | "Pending" | "";
  online: "Online" | "Offline" | "";
  evaluator: "Evaluator" | "NonEvaluator" | "";
  page: number;
  pageSize: number;
}): string {
  const params = new URLSearchParams();
  appendBaseParams(params, input);
  if (input.approval === "Approved") {
    params.set("approval", "approved");
  } else if (input.approval === "Pending") {
    params.set("approval", "pending");
  }
  if (input.online === "Online") {
    params.set("online", "online");
  } else if (input.online === "Offline") {
    params.set("online", "offline");
  }
  if (input.evaluator === "Evaluator") {
    params.set("evaluator", "yes");
  } else if (input.evaluator === "NonEvaluator") {
    params.set("evaluator", "no");
  }
  return params.toString();
}
