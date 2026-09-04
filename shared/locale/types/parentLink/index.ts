/**
 * Parent-link namespace labels — the two surfaces of the parent-child link
 * request workflow:
 *
 *  1. Student incoming queue (`/student/link-requests`) — pending link
 *     requests from parents, each carrying the requesting parent's FULL
 *     name (the confirmation decision needs identity), a status chip, an
 *     expiry line, and confirm/reject affordances with their dialogs.
 *  2. Parent send + outgoing list (`/parent/handshake`) — the send
 *     affordance on a linkable discovery result, the outgoing request list
 *     with computed status chips and masked student names, and the cancel
 *     dialog on live pending rows.
 *
 * Copy functions receive ALREADY-ASSEMBLED display names only (full name on
 * the student side, masked name on the parent side) — never raw user input,
 * ids, codes, or contact data.
 *
 * Used by:
 *  - Frontend `StudentLinkRequestsContainer` (`useAppTranslation(ParentLink)`).
 *  - Frontend parent handshake send affordance + `OutgoingLinkRequestsSection`
 *    (`useAppTranslation(ParentLink)`).
 *
 * All keys MUST have both `en` and `ar` implementations with EXACT key-set
 * parity (compile-typed on both leaves + `parentLink-namespace.parity.test.ts`
 * runtime belt). Property access only — never call-by-key.
 */
export interface ParentLinkLabels {
  // ─── Student incoming queue ───────────────────────────────────────────────
  /** Page heading for the student link-requests inbox. */
  readonly studentPageTitle: string;
  /** Page intro copy under the student inbox heading. */
  readonly studentPageSubtitle: string;
  /** Empty-inbox state title (no link requests to show). */
  readonly incomingEmptyTitle: string;
  /** Empty-inbox state body — where new requests will appear. */
  readonly incomingEmptyBody: string;
  /** Accessible name for the compact per-status count strip above a short list. */
  readonly listSummaryLabel: string;
  /**
   * Summary-strip chip label — interpolates the ALREADY-LOCALIZED status word
   * (one of the `status*` labels) and its row count; the locale owns the
   * separator and the digit rendering.
   */
  readonly summaryCountChip: (statusLabel: string, count: number) => string;
  /** Friendly hint under a short request list — where new requests will appear. */
  readonly incomingHintBody: string;
  /** Per-row label introducing the requesting parent's name. */
  readonly fromLabel: string;
  /** Per-row label introducing the request's creation moment. */
  readonly sentAtLabel: string;
  /** Per-row expiry line — interpolates the request's formatted expiry moment. */
  readonly expiresLine: (date: string) => string;
  /** Status chip — request awaiting the student's response. */
  readonly statusPending: string;
  /** Status chip — request confirmed (accounts linked). */
  readonly statusConfirmed: string;
  /** Status chip — request rejected by the student. */
  readonly statusRejected: string;
  /** Status chip — request past its expiry moment (computed at render time). */
  readonly statusExpired: string;
  /** Row action — confirm the link request. */
  readonly confirmAction: string;
  /** Row action — reject the link request. */
  readonly rejectAction: string;
  /** Confirm-confirmation dialog title. */
  readonly confirmDialogTitle: string;
  /** Confirm-confirmation dialog body — interpolates the requesting parent's display name. */
  readonly confirmDialogBody: (parentName: string) => string;
  /** Reject-confirmation dialog title. */
  readonly rejectDialogTitle: string;
  /** Reject-confirmation dialog body — interpolates the requesting parent's display name. */
  readonly rejectDialogBody: (parentName: string) => string;
  /** Transient success toast after confirming a request. */
  readonly confirmSuccessToast: string;
  /** Transient success toast after rejecting a request. */
  readonly rejectSuccessToast: string;
  // ─── Parent outgoing list + send flow ─────────────────────────────────────
  /** Row action — cancel the parent's own pending outgoing request. */
  readonly cancelAction: string;
  /** Cancel-confirmation dialog title. */
  readonly cancelDialogTitle: string;
  /** Cancel-confirmation dialog body (what the action will do). */
  readonly cancelDialogBody: string;
  /** Transient success toast after cancelling an outgoing request. */
  readonly cancelSuccessToast: string;
  /** Outgoing-list section heading on the parent handshake surface. */
  readonly outgoingTitle: string;
  /** Outgoing-list empty state title (no requests sent yet). */
  readonly outgoingEmptyTitle: string;
  /** Outgoing-list empty state body — where sent requests and their status appear. */
  readonly outgoingEmptyBody: string;
  /** Send affordance on a linkable discovery result. */
  readonly sendRequestAction: string;
  /** Transient success toast after sending a link request. */
  readonly sendRequestSuccessToast: string;
  /** Inline notice when a link request to this student is already pending. */
  readonly requestPendingNotice: string;
  /** Inline notice when the send cannot be completed right now. */
  readonly sendUnavailableNotice: string;
}
