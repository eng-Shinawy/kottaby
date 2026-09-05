/**
 * Handshake-code namespace labels — the two parent/student-facing surfaces
 * for the student handshake-code feature:
 *
 *  1. Student card — the student's own handshake-code card on the profile
 *     surface (code display + copy affordance).
 *  2. Parent discovery page — the `/parent/handshake` search surface where
 *     a parent submits a student's code and receives the masked-name
 *     confirmation card (found-linkable / found-already-linked / not-found
 *     states).
 *
 * Used by:
 *  - Frontend `HandshakeCodeCard` (`useAppTranslation(HandshakeCode)`) —
 *     student-side card.
 *  - Frontend `HandshakeDiscoveryContainer` + search form/result card
 *     (`useAppTranslation(HandshakeCode)`) — parent-side discovery page.
 *
 * All keys MUST have both `en` and `ar` implementations with EXACT key-set
 * parity (compile-typed on both leaves + `handshakeCode-namespace.parity.test.ts`
 * runtime belt). Property access only — never call-by-key.
 */
export interface HandshakeCodeLabels {
  // ─── Student card ─────────────────────────────────────────────────────────
  /** Card heading above the student's own code. */
  readonly yourCodeTitle: string;
  /** Card explanation of what the code is for and who to share it with. */
  readonly yourCodeDescription: string;
  /** Copy-to-clipboard button label. */
  readonly copyCode: string;
  /** Transient confirmation after a successful copy. */
  readonly codeCopied: string;
  /** Fallback notice when the clipboard write fails. */
  readonly copyFailed: string;
  // ─── Parent discovery page ────────────────────────────────────────────────
  /** Discovery page heading. */
  readonly pageTitle: string;
  /** Discovery page intro copy (idle state). */
  readonly pageDescription: string;
  /** Code input field label. */
  readonly inputLabel: string;
  /** Search-form submit button label. */
  readonly searchAction: string;
  /**
   * Inline field helper for a malformed code (client-side format check).
   * Teaches the FORMAT only — the placeholder `KSB-XXXXXXXX` is masked (not
   * hexadecimal) so the copy can never be mistaken for a working code.
   */
  readonly invalidFormat: string;
  /** Neutral (non-error) inline state heading when a lookup resolves `null`. */
  readonly notFoundTitle: string;
  /** Neutral inline state body when a lookup resolves `null` — identical copy for every miss reason (no existence oracle). */
  readonly notFoundDescription: string;
  /** Result-card heading when a code resolves to a student. */
  readonly foundTitle: string;
  /** Result-card body when the found student is linkable (next-step copy; the link-request action itself is out of scope here). */
  readonly canLinkDescription: string;
  /** Result-card heading when the found student is already linked to a parent account (any parent, not necessarily the caller). */
  readonly alreadyLinkedTitle: string;
  /** Result-card body when the found student is already linked to a parent account (any parent, not necessarily the caller). */
  readonly alreadyLinkedDescription: string;
  // ─── Parent navigation ─────────────────────────────────────────────────────
  /** Sidebar nav item (parent group) linking to the discovery page. */
  readonly navLinkMyChild: string;
}
