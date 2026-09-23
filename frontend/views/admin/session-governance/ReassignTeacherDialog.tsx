"use client";

import { TextField } from "@mui/material";
import { type ReactNode, useState } from "react";
import type { AdminSessionsQuery_adminSessions_items } from "@/frontend/graphql/generated/gql/graphql";
import {
  GovernanceDialogActions,
  GovernanceFormDialog,
} from "@/frontend/views/admin/session-governance/dialogFormAtoms";
import { SessionDialogWarningCallout } from "@/frontend/views/student/sessions/SessionDialogWarningCallout";
import { AdminSessionGovernance, Common, useAppTranslation } from "@/shared/locale";

/**
 * ReassignTeacherDialog — the admin teacher-reassignment seam for one
 * governance session (`/admin/session-governance`). Structural
 * sibling of the arbitration dialog:
 * portal/dialog/form discipline, `React.SubmitEvent`, dismissal gated
 * while the mutation is in flight (the shared {@link GovernanceFormDialog}
 * / {@link GovernanceDialogActions} atoms carry that shell).
 *
 * Teacher picker — a PLAIN user-id input field (BOPLA-minimal): the
 * codebase ships NO admin teacher-directory query document
 * (`sharedDocuments/admin/` exposes admin-users / audit-trail /
 * platform-analytics / teacher-certification only), so the dialog cannot
 * offer a verified teacher picker without a new read surface — out of this
 * ticket's blast radius. The certification gate (`is_approved`) stays
 * server-owned (INV-S5): an unapproved candidate id is REJECTED by the
 * localized `TEACHER_NOT_CERTIFIED` error, never silently accepted here.
 * The input accepts whole numbers only (the wire member is `Int`); the
 * bounded `WHOLE_NUMBER_PATTERN` digit window client-rejects out-of-range
 * digit runs BEFORE the wire.
 *
 * The mutation and its error classification live in the container; the
 * dialog stays open on every failure arm for a corrected submit.
 *
 * MUI v9 discipline: `sx`-only styling, theme-palette colors, ≥44px touch
 * targets, keyboard-focusable dialog (`aria-labelledby` + focusable field).
 */

/**
 * Whole-number id tokens only — 1..15 digits (the wire member is `Int`,
 * never a string; the container's id filters reuse this table). The digit
 * ceiling is the client-rejection gate for out-of-range tokens: fifteen
 * digits cannot exceed the JS safe-integer ceiling (10^15 − 1 < 2^53 − 1),
 * so `Number(token)` never silently rounds a larger id.
 */
export const WHOLE_NUMBER_PATTERN = /^\d{1,15}$/;

interface ReassignTeacherDialogProps {
  /** The session being reassigned (drives the testids). */
  readonly session: AdminSessionsQuery_adminSessions_items;
  readonly open: boolean;
  /**
   * Dismiss intent (cancel Button / backdrop click / Escape) — ignored
   * while the reassign mutation is pending.
   */
  readonly onClose: () => void;
  /** True while the container's reassign mutation is in flight. */
  readonly loading: boolean;
  /** Validated submit intent — receives the parsed numeric teacher id. */
  readonly onSubmit: (newTeacherUserId: number) => void;
}

/** Confirm-and-reassign dialog (plain teacher user-id input). */
export function ReassignTeacherDialog({
  session,
  open,
  onClose,
  loading,
  onSubmit,
}: Readonly<ReassignTeacherDialogProps>): ReactNode {
  const t = useAppTranslation(AdminSessionGovernance);
  const tc = useAppTranslation(Common);

  const [teacherIdToken, setTeacherIdToken] = useState("");
  const [invalidId, setInvalidId] = useState(false);

  const handleSubmit = (event: React.SubmitEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (loading) return;
    const trimmed = teacherIdToken.trim();
    if (!WHOLE_NUMBER_PATTERN.test(trimmed)) {
      setInvalidId(true);
      return;
    }
    setInvalidId(false);
    onSubmit(Number(trimmed));
  };

  return (
    <GovernanceFormDialog
      open={open}
      onClose={onClose}
      loading={loading}
      onSubmit={handleSubmit}
      titleId="reassign-teacher-dialog-title"
      title={t.reassignTitle}
      actions={
        <GovernanceDialogActions
          onClose={onClose}
          loading={loading}
          cancelLabel={tc.cancel}
          submitLabel={t.reassignSubmit}
          submitTestId={`reassign-teacher-submit-${session.id}`}
          submitDisabled={teacherIdToken.trim() === ""}
        />
      }
    >
      <SessionDialogWarningCallout message={t.reassignBody} />
      <TextField
        label={t.reassignTeacherIdLabel}
        placeholder={t.reassignTeacherIdPlaceholder}
        value={teacherIdToken}
        onChange={event => {
          setTeacherIdToken(event.target.value);
          setInvalidId(false);
        }}
        required
        error={invalidId}
        helperText={invalidId ? t.filterInvalidId : undefined}
        aria-invalid={invalidId}
        data-testid="reassign-teacher-id"
        slotProps={{ htmlInput: { inputMode: "numeric", autoComplete: "off" } }}
      />
    </GovernanceFormDialog>
  );
}
