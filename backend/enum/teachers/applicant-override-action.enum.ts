/**
 * AdminApplicantOverrideAction enum — the three manual-override directions an
 * admin may take on an applicant's automated evaluation result
 * (docs/planning/TICKETS.md "Admin Override of Evaluation Results"):
 *  - `certify`  — certify a failed/pending/in-evaluation applicant (the
 *    teacher row is created or elevated certified; the applicant is finalized
 *    `passed` with the cooldown cleared);
 *  - `reject`   — manually reject a certified (`passed`) applicant (the
 *    teacher row is demoted and the applicant enters a stamped cooldown);
 *  - `grant_re_evaluation` — clear an active cooldown so the applicant may
 *    re-purchase verification without waiting for it to expire.
 *
 * There is NO pgEnum backing this vocabulary — it is a pure transport/service
 * selector on the admin override mutation, never a stored column value. The
 * override SUPERSEDES the automated algorithm and each application appends
 * exactly ONE audit row with `action_type='override'`.
 */
export enum AdminApplicantOverrideAction {
  Certify = "certify",
  Reject = "reject",
  GrantReEvaluation = "grant_re_evaluation",
}
