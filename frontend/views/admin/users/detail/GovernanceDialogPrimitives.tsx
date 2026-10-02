"use client";

/**
 * GovernanceDialogPrimitives — the shared building blocks of the admin
 * user-detail confirm dialogs (override / cooldown extension / governance
 * confirm): the DialogContent body (message + optional numeric days field
 * + conflict Alert), and the DialogActions shell (cancel +
 * spinner-in-confirm). Extracted verbatim from the three dialog modules so
 * the scaffolding lives in exactly one place — jscpd `-t 0` treats any
 * repeated block as a clone, and the dialogs previously carried three such
 * blocks.
 *
 * Visual contract (identical in all three dialogs): radius handled by the
 * caller's paper sx; `focusVisibleRingSx` on both buttons; 44px touch
 * targets; the confirm button shows the in-flight spinner as its start
 * icon while the label stays visible.
 */

import {
  Alert,
  Button,
  type ButtonProps,
  CircularProgress,
  DialogActions,
  DialogContent,
  TextField,
  Typography,
} from "@mui/material";
import type { ReactNode } from "react";
import { focusVisibleRingSx } from "@/frontend/components/ui/focusRing";

const TOUCH = 44;
const SPINNER = 20;

/** Structural shape of the hooks' in-dialog alert state. */
export interface GovernanceDialogAlertState {
  readonly severity: "info" | "warning" | "error" | "success";
  readonly message: string;
}

/** The varying runtime props of the shared dialog body's days field. */
export interface GovernanceDialogDaysProps {
  /** Whether the direction renders the days field at all. */
  readonly visible: boolean;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly error: boolean;
}

/**
 * The shared DialogContent body: intro message (spacing collapses when the
 * direction renders no days field below it), the optional numeric days
 * field, and the conflict Alert. Scalar-prop contract — callers pass
 * values, not JSX, so no dialog repeats the scaffolding (jscpd `-t 0`).
 */
export function GovernanceDialogBody(props: {
  readonly message: ReactNode;
  readonly messageSpacing: number;
  readonly daysLabel: string;
  /** Already-composed helper text (`daysErr ?? daysHelper` upstream). */
  readonly daysHelper: string;
  readonly days: GovernanceDialogDaysProps;
  readonly alert: GovernanceDialogAlertState | null;
  readonly onClearAlert: () => void;
}): ReactNode {
  return (
    <DialogContent>
      <Typography sx={{ mb: props.messageSpacing }}>{props.message}</Typography>
      {props.days.visible && (
        <GovernanceDaysField
          label={props.daysLabel}
          helper={props.daysHelper}
          value={props.days.value}
          onChange={props.days.onChange}
          error={props.days.error}
        />
      )}
      <GovernanceDialogAlert alert={props.alert} onClear={props.onClearAlert} />
    </DialogContent>
  );
}

/**
 * The numeric cooldown/suspend days field — `helper` is the ALREADY
 * composed helper text (the caller passes `daysErr ?? daysHelper`, so a
 * VALIDATION error renders in the error slot exactly as before).
 */
function GovernanceDaysField(props: {
  readonly label: string;
  readonly helper: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly error: boolean;
}): ReactNode {
  return (
    <TextField
      label={props.label}
      helperText={props.helper}
      value={props.value}
      onChange={e => props.onChange(e.target.value)}
      error={props.error}
      aria-invalid={props.error}
      fullWidth
      slotProps={{
        htmlInput: { inputMode: "numeric", pattern: "[0-9]*", "aria-label": props.label },
      }}
      sx={{ mt: 1 }}
    />
  );
}

/**
 * The in-dialog conflict Alert (typed domain rejections carry the
 * server-localized message). Renders nothing when `alert` is null —
 * FORBIDDEN rejections ride the caller's toast path instead.
 */
function GovernanceDialogAlert(props: {
  readonly alert: GovernanceDialogAlertState | null;
  readonly onClear: () => void;
}): ReactNode {
  if (props.alert === null) {
    return null;
  }
  return (
    <Alert severity={props.alert.severity} sx={{ mt: 2, alignItems: "center" }} onClose={props.onClear}>
      {props.alert.message}
    </Alert>
  );
}

/**
 * The shared DialogActions shell: borderless-top hairline, cancel
 * (inherit) + confirm (contained, spinner start icon while in flight),
 * both with the focus ring and 44px touch target.
 */
export function GovernanceDialogActions(props: {
  readonly cancelLabel: string;
  readonly onCancel: () => void;
  readonly cancelDisabled: boolean;
  readonly confirmLabel: string;
  readonly confirmColor: ButtonProps["color"];
  readonly confirmDisabled: boolean;
  readonly inFlight: boolean;
}): ReactNode {
  return (
    <DialogActions
      sx={theme => ({
        px: 3,
        pb: 2.5,
        pt: 1,
        gap: 1.5,
        justifyContent: "flex-end",
        borderTop: `1px solid ${theme.palette.divider}`,
      })}
    >
      <Button
        onClick={props.onCancel}
        color="inherit"
        disabled={props.cancelDisabled}
        sx={{ ...focusVisibleRingSx, minHeight: TOUCH }}
      >
        {props.cancelLabel}
      </Button>
      <Button
        type="submit"
        variant="contained"
        color={props.confirmColor}
        disabled={props.confirmDisabled}
        startIcon={props.inFlight ? <CircularProgress size={SPINNER} color="inherit" /> : undefined}
        sx={{ ...focusVisibleRingSx, minHeight: TOUCH }}
      >
        {props.confirmLabel}
      </Button>
    </DialogActions>
  );
}
