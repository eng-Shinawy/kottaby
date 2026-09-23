"use client";

/**
 * OnboardStudentCompletenessMeter — the quiet progress readout at the top
 * of the onboarding form: a determinate bar tracking the submit-required
 * text fields, a tabular-nums percentage caption (locale-aware copy), and
 * — once something is drafted — the "saved at" autosave stamp fed by the
 * draft mirror's last persist. The credential never rides the draft, so
 * the stamp never follows a secret.
 */

import { CheckCircleOutlined as SavedIcon } from "@mui/icons-material";
import { LinearProgress, Stack, Typography } from "@mui/material";
import type { SxProps, Theme } from "@mui/material/styles";
import { useMemo } from "react";
import { useAppLocale } from "@/frontend/hooks/locale";
import { useAppTranslation } from "@/shared/locale/client";
import { StudentOnboarding } from "@/shared/locale/namespaces/studentOnboarding";

/** The meter's track — thin, rounded, and quiet so the sections stay the focus. */
const PROGRESS_SX: SxProps<Theme> = theme => ({
  height: 6,
  borderRadius: 3,
  bgcolor: theme.palette.action.hover,
  flex: 1,
});

export interface OnboardStudentCompletenessMeterProps {
  /** The rounded completeness percentage (0–100). */
  readonly completeness: number;
  /** Epoch millis of the draft mirror's last persist — `null` before the first edit. */
  readonly lastSavedAt: number | null;
}

export function OnboardStudentCompletenessMeter({
  completeness,
  lastSavedAt,
}: OnboardStudentCompletenessMeterProps): React.ReactElement {
  const t = useAppTranslation(StudentOnboarding);
  const locale = useAppLocale();
  // Locale-bound Intl instance, recreated only when the stamp or the
  // locale moves — the same cheap pattern as the admin user-detail
  // formatters (formatting is derived display, not state).
  const savedLabel = useMemo(() => {
    if (lastSavedAt === null) return null;
    const formatter = new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit" });
    return t.draft.savedAt(formatter.format(new Date(lastSavedAt)));
  }, [lastSavedAt, locale, t.draft]);

  return (
    <Stack sx={{ gap: 0.75 }}>
      <Stack direction="row" sx={{ alignItems: "center", gap: 1.5 }}>
        <LinearProgress
          variant="determinate"
          value={completeness}
          aria-label={t.draft.progressLabel}
          sx={PROGRESS_SX}
        />
        <Typography
          variant="caption"
          sx={theme => ({
            fontVariantNumeric: "tabular-nums",
            color: theme.palette.text.secondary,
            fontWeight: 600,
            whiteSpace: "nowrap",
          })}
        >
          {t.draft.progressValue(completeness)}
        </Typography>
      </Stack>
      {savedLabel ? (
        <Stack direction="row" sx={{ alignItems: "center", gap: 0.5 }}>
          <SavedIcon aria-hidden sx={theme => ({ fontSize: 14, color: theme.palette.success.main })} />
          <Typography variant="caption" sx={theme => ({ color: theme.palette.text.secondary })}>
            {savedLabel}
          </Typography>
        </Stack>
      ) : null}
    </Stack>
  );
}
