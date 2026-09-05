import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  Stack,
  Switch,
  Typography,
} from "@mui/material";
import type { ReactNode } from "react";
import { ctaShimmerSx } from "@/frontend/views/landing/utils";
import { Landing, useAppTranslation } from "@/shared/locale";

/** Cookie preferences dialog: necessary (locked) + analytics + marketing toggles. */
export function CookieSettingsDialog({
  open,
  draftAnalytics,
  draftMarketing,
  onClose,
  onDraftAnalyticsChange,
  onDraftMarketingChange,
  onSave,
}: Readonly<{
  open: boolean;
  draftAnalytics: boolean;
  draftMarketing: boolean;
  onClose: () => void;
  onDraftAnalyticsChange: (checked: boolean) => void;
  onDraftMarketingChange: (checked: boolean) => void;
  onSave: () => void;
}>): ReactNode {
  const t = useAppTranslation(Landing);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="sm"
      fullWidth
      slotProps={{
        paper: {
          sx: {
            bgcolor: "var(--mui-palette-background-paper)",
            borderRadius: 3,
            border: "1px solid var(--mui-palette-divider)",
          },
        },
      }}
    >
      <DialogTitle sx={{ fontWeight: 700 }}>{t.cookieDialogTitle}</DialogTitle>
      <DialogContent>
        <Typography variant="body2" sx={{ color: "var(--mui-palette-text-secondary)", mb: 3, lineHeight: 1.6 }}>
          {t.cookieDialogBody}
        </Typography>
        <Stack spacing={2.5}>
          <Stack direction="row" spacing={2} sx={{ alignItems: "flex-start" }}>
            <FormControlLabel control={<Switch checked disabled />} label={t.cookieDialogNecessary} sx={{ m: 0 }} />
          </Stack>
          <Typography variant="caption" sx={{ color: "var(--mui-palette-text-secondary)", mt: -1.5, pl: 6 }}>
            {t.cookieDialogNecessaryDesc}
          </Typography>
          <Stack direction="row" spacing={2} sx={{ alignItems: "flex-start" }}>
            <FormControlLabel
              control={<Switch checked={draftAnalytics} onChange={e => onDraftAnalyticsChange(e.target.checked)} />}
              label={t.cookieDialogAnalytics}
              sx={{ m: 0 }}
            />
          </Stack>
          <Typography variant="caption" sx={{ color: "var(--mui-palette-text-secondary)", mt: -1.5, pl: 6 }}>
            {t.cookieDialogAnalyticsDesc}
          </Typography>
          <Stack direction="row" spacing={2} sx={{ alignItems: "flex-start" }}>
            <FormControlLabel
              control={<Switch checked={draftMarketing} onChange={e => onDraftMarketingChange(e.target.checked)} />}
              label={t.cookieDialogMarketing}
              sx={{ m: 0 }}
            />
          </Stack>
          <Typography variant="caption" sx={{ color: "var(--mui-palette-text-secondary)", mt: -1.5, pl: 6 }}>
            {t.cookieDialogMarketingDesc}
          </Typography>
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 3 }}>
        <Button onClick={onSave} variant="contained" sx={ctaShimmerSx}>
          {t.cookieDialogSave}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
