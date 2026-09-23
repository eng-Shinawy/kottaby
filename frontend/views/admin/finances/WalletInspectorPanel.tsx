"use client";

/**
 * WalletInspectorPanel — the teacher wallet inspector tab of the admin
 * financial auditing console (`/admin/finances`): the picked teacher's
 * wallet surface, extracted from the original monolithic panel into the
 * focused siblings {@link WalletPickerHeader} (picker + adjust trigger) and
 * {@link WalletInspectorBody} (the body switch: the FORBIDDEN denied notice,
 * the shared retryable-error alert on any other wallet read failure — the
 * real `extensions.code`, never fabricated — the unpicked empty state, and
 * the summary cards + ledger).
 *
 * Deep-link + picker sync: the container hands down the CURRENT picked
 * teacher id (`?teacherId=` seed on mount, then the picker's own
 * selections mirrored through the container's URL effect); a sync effect
 * pushes every prop change into the wallet read hook
 * ({@link useAdminTeacherWallet.setTeacherId}), so the ledger and the
 * query variables always follow the picker.
 *
 * Honest wallet state: the null-pair `balance`/`totalEarning` means the
 * teacher has no wallet row yet — the summary cards render the namespace's
 * empty copy (never fake zeros) and the ledger stays in its empty state.
 *
 * The manual wallet-adjustment dialog lives in the sibling
 * {@link AdjustWalletDialog} component; its mutation owns the
 * cache-refresh arm and every outcome surfaces a container-level snackbar
 * (the raw server `message` is NEVER echoed).
 *
 * All copy comes from the `AdminFinance` namespace; MUI v9 `sx`-only
 * discipline, theme-palette colors, `*Outlined` icons.
 */

import { useQuery } from "@apollo/client/react";
import { Stack, Typography } from "@mui/material";
import { type ReactNode, useEffect, useState } from "react";
import { ErrorRetryAlert } from "@/frontend/components/ui/ErrorRetryAlert";
import { NoticeSnackbar } from "@/frontend/components/ui/NoticeSnackbar";
import {
  type AdminTeachersQuery_adminTeachers_items,
  WalletAdjustmentDirection,
} from "@/frontend/graphql/generated/gql/graphql";
import { adminTeachersQueryDocument } from "@/frontend/graphql/sharedDocuments/admin";
import { extractErrorCode } from "@/frontend/lib/graphql-error-utils";
import { mapGraphQLErrorByCode } from "@/frontend/providers/apollo/error-link.map";
import { AdjustWalletDialog } from "@/frontend/views/admin/finances/AdjustWalletDialog";
import { useAdjustTeacherWallet, useAdminTeacherWallet } from "@/frontend/views/admin/finances/useAdminFinanceQueries";
import { useWalletOutcomeCallbacks } from "@/frontend/views/admin/finances/useWalletOutcomeCallbacks";
import { WalletDeniedNotice, WalletEmptyState } from "@/frontend/views/admin/finances/WalletInspectorStates";
import { WalletLedger } from "@/frontend/views/admin/finances/WalletLedger";
import { WalletPickerHeader } from "@/frontend/views/admin/finances/WalletPickerHeader";
import { Common, useAppTranslation } from "@/shared/locale";
import { AdminFinance } from "@/shared/locale/namespaces/adminFinance";

/** Snackbar autohide — the shared container-notice cadence. */
const NOTICE_AUTOHIDE_MS = 4000;

/**
 * Narrows the dialog's "credit"|"debit" literal onto the generated
 * `WalletAdjustmentDirection` enum — a validated lookup (no unsafe
 * assertion; unknown values fail closed to Credit).
 */
function toWireDirection(option: "credit" | "debit"): WalletAdjustmentDirection {
  return option === "debit" ? WalletAdjustmentDirection.Debit : WalletAdjustmentDirection.Credit;
}

/** The wallet inspector body: denial / retryable error / empty / ledger. */
function WalletInspectorBody({
  inspector,
  onLedgerPageChange,
}: Readonly<{
  /** The wallet inspector read — the hook's state, the raw error + refetch included. */
  readonly inspector: ReturnType<typeof useAdminTeacherWallet>;
  /** Ledger pagination intent — pushed into the wallet read's page state. */
  readonly onLedgerPageChange: (nextPage: number) => void;
}>): ReactNode {
  const t = useAppTranslation(AdminFinance);
  const tc = useAppTranslation(Common);

  // Query-context denial classification — the REAL `extensions.code` off the
  // wallet read's error (never a fabricated literal): FORBIDDEN (a non-admin
  // caller fails the admin role leg) maps to the shared denied notice; every
  // other failure falls to the shared retry alert so real outages surface.
  const errorCode = inspector.error ? extractErrorCode(inspector.error) : null;
  const denied =
    errorCode !== null &&
    mapGraphQLErrorByCode(errorCode, { contextKind: "query", hasForm: false })?.kind === "permission-fallback";

  if (denied) {
    return <WalletDeniedNotice />;
  }
  if (inspector.hasError) {
    return (
      <ErrorRetryAlert
        title={t.errorTitle}
        retryLabel={tc.retry}
        retryPending={inspector.loading}
        onRetry={() => {
          void inspector.refetch();
        }}
      >
        <Typography variant="body2" component="p">
          {errorCode === null ? "" : `(${errorCode})`}
        </Typography>
      </ErrorRetryAlert>
    );
  }
  if (inspector.teacherId === null) {
    return <WalletEmptyState />;
  }
  return (
    <WalletLedger
      wallet={inspector.wallet}
      loading={inspector.loading}
      page={inspector.page}
      pageSize={inspector.pageSize}
      onPageChange={onLedgerPageChange}
    />
  );
}

/** The wallet inspector panel: picker + states + ledger + adjust dialog. */
export function WalletInspectorPanel({
  initialTeacherId,
  onTeacherChange,
}: Readonly<{
  /** The CURRENT picked teacher id — the container keeps this in sync with the URL seed + picker. */
  readonly initialTeacherId: number | null;
  /** Picker selection intent — the container mirrors it back into the URL. */
  readonly onTeacherChange: (teacherId: number | null) => void;
}>): ReactNode {
  // Teacher picker — the EXISTING admin teachers directory query (no new
  // read surface). The picker offers the first page's verified teachers.
  const teachers = useQuery(adminTeachersQueryDocument, {
    variables: { filters: null, page: 1, pageSize: 50 },
    fetchPolicy: "cache-and-network",
  });
  const teacherOptions: readonly AdminTeachersQuery_adminTeachers_items[] = teachers.data?.adminTeachers.items ?? [];

  const inspector = useAdminTeacherWallet(initialTeacherId);
  const [notice, setNotice] = useState<{ message: string; severity: "success" | "info" | "error" } | null>(null);
  const dismissNotice = (): void => {
    setNotice(null);
  };
  const [adjustOpen, setAdjustOpen] = useState(false);

  // Picker/URL → query sync: the container hands down the CURRENT picked
  // teacher id (the mount seed, then every picker selection it mirrors
  // through the URL effect) — push each change into the wallet read hook
  // so the query variables follow the picker. The useState-backed setter
  // is stable, so the prop alone drives the effect.
  const { setTeacherId } = inspector;
  useEffect(() => {
    setTeacherId(initialTeacherId);
  }, [initialTeacherId, setTeacherId]);

  const closeAdjustDialog = (): void => {
    setAdjustOpen(false);
  };
  const outcomeCallbacks = useWalletOutcomeCallbacks(setNotice, closeAdjustDialog);
  const adjust = useAdjustTeacherWallet(outcomeCallbacks);

  const pickedTeacher =
    teacherOptions.find(
      option => String(option.id) === (inspector.teacherId === null ? "" : String(inspector.teacherId))
    ) ?? null;

  const handleTeacherPick = (teacher: AdminTeachersQuery_adminTeachers_items | null): void => {
    onTeacherChange(teacher === null ? null : teacher.id);
  };

  const handleLedgerPageChange = (nextPage: number): void => {
    inspector.setPage(nextPage);
  };

  const handleAdjustSubmit = (input: { amount: string; direction: "credit" | "debit"; reason: string }): void => {
    if (inspector.teacherId === null) return;
    adjust.adjust({
      teacherId: inspector.teacherId,
      amount: input.amount,
      direction: toWireDirection(input.direction),
      reason: input.reason,
    });
  };

  return (
    <Stack spacing={3} data-testid="admin-finances-wallet-panel">
      <WalletPickerHeader
        teacherOptions={teacherOptions}
        pickedTeacher={pickedTeacher}
        onPick={handleTeacherPick}
        adjustDisabled={inspector.teacherId === null}
        onAdjustOpen={() => {
          setAdjustOpen(true);
        }}
      />

      <WalletInspectorBody inspector={inspector} onLedgerPageChange={handleLedgerPageChange} />

      {adjustOpen && inspector.wallet !== null ? (
        <AdjustWalletDialog
          key="adjust-wallet-dialog"
          teacherName={inspector.wallet.teacherName}
          open
          onClose={() => {
            setAdjustOpen(false);
          }}
          onSubmit={handleAdjustSubmit}
          loading={adjust.loading}
          submitTestId="admin-finances-adjust-submit"
        />
      ) : null}

      <NoticeSnackbar notice={notice} autoHideDuration={NOTICE_AUTOHIDE_MS} onClose={dismissNotice} />
    </Stack>
  );
}
