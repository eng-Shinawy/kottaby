import { Button, DialogActions } from "@mui/material";
import type { ReactNode } from "react";

/** The dialog footer row: cancel (dismissal) + submit (arbitration) actions. */
export function ResolveDisputeActionsRow(
  props: Readonly<{
    loading: boolean;
    canSubmit: boolean;
    onCancel: () => void;
    cancelLabel: string;
    submitLabel: string;
  }>
): ReactNode {
  const { loading, canSubmit, onCancel, cancelLabel, submitLabel } = props;
  return (
    <DialogActions sx={{ px: 3, pb: 3, gap: 1 }}>
      <Button onClick={onCancel} disabled={loading} sx={{ minHeight: { xs: 44, sm: 40 }, px: 3 }}>
        {cancelLabel}
      </Button>
      <Button
        type="submit"
        variant="contained"
        color="primary"
        disabled={loading || !canSubmit}
        data-testid="resolve-dispute-submit"
        sx={{ minHeight: { xs: 44, sm: 40 }, px: 3 }}
      >
        {submitLabel}
      </Button>
    </DialogActions>
  );
}
