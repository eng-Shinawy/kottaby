/**
 * Teacher re-evaluation order result — the canonical server-side return
 * shape of the admin-ordered re-evaluation flow (composed by the teacher
 * re-evaluation service inside its single ordering transaction and handed
 * back to the GraphQL layer verbatim).
 *
 * Money discipline: every monetary field is carried as a decimal STRING
 * verbatim — the charged amount comes straight from the re-evaluation fee
 * constant and the wallet balance straight from the post-debit wallet row —
 * never parsed into a number, never re-rounded, so the ledger row, the
 * audit trail, and this return shape all carry byte-identical money.
 *
 * `reEvaluationStartedAt` is the fresh re-evaluation cycle anchor stamped by
 * the guarded re-open write (the applicant's new in-evaluation start
 * instant) — `Date` because it is read back from the RETURNING row inside
 * the same transaction that charged the wallet.
 */

export type TeacherReEvaluationOrderReturnType = {
  /** users.id of the subject teacher whose wallet was charged. */
  teacherId: number;
  /** Exact charged fee as a verbatim decimal string (never a number). */
  amountCharged: string;
  /** ISO currency code the fee was charged in. */
  currency: string;
  /** Post-debit wallet balance as a verbatim decimal string (never a number). */
  walletBalance: string;
  /** Fresh re-evaluation cycle anchor (in-evaluation start instant). */
  reEvaluationStartedAt: Date;
};
