"use client";

/**
 * WalletInspectorStates — the FORBIDDEN notice and the unpicked-teacher
 * empty state of the admin wallet inspector (`/admin/finances`, wallet
 * tab), extracted from the panel as focused sibling components.
 *
 * The denial notice renders when the wallet read fails the admin role leg
 * into FORBIDDEN; the empty state is the unpicked-picker posture (the
 * picker seeds from the `?teacherId=` deep link).
 *
 * All copy comes from the `AdminFinance` namespace; MUI v9 `sx`-only
 * discipline, theme-palette colors, `*Outlined` icons.
 */

import { WalletOutlined as WalletIcon } from "@mui/icons-material";
import { Alert, AlertTitle, Card, Stack, Typography } from "@mui/material";
import type { ReactNode } from "react";
import { useAppTranslation } from "@/shared/locale";
import { AdminFinance } from "@/shared/locale/namespaces/adminFinance";

/** The FORBIDDEN denial notice for the wallet read (a non-admin caller). */
export function WalletDeniedNotice(): ReactNode {
  const t = useAppTranslation(AdminFinance);

  return (
    <Alert severity="error" variant="outlined" sx={{ borderRadius: "12px" }} data-testid="admin-finances-wallet-denied">
      <AlertTitle sx={{ fontWeight: 700 }}>{t.forbiddenTitle}</AlertTitle>
      <Typography variant="body2" component="p">
        {t.forbiddenBody}
      </Typography>
    </Alert>
  );
}

/**
 * The unpicked-teacher empty state — the picker seeds from the deep link.
 * The panel reserves the ledger's vertical footprint, so the card fills it
 * with a min-height and centers the icon + copy (no dead band below).
 */
export function WalletEmptyState(): ReactNode {
  const t = useAppTranslation(AdminFinance);

  return (
    <Card
      sx={theme => ({
        borderRadius: "12px",
        border: `1px solid ${theme.palette.border.light}`,
        boxShadow: theme.palette.shadow.card,
      })}
    >
      <Stack spacing={1.5} sx={{ alignItems: "center", justifyContent: "center", py: 6, px: 3, minHeight: 320 }}>
        <WalletIcon sx={theme => ({ fontSize: 48, color: theme.palette.text.secondary })} />
        <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
          {t.teacherPickerPlaceholder}
        </Typography>
        <Typography variant="body2" component="p" sx={theme => ({ color: theme.palette.text.secondary })}>
          {t.walletEmptyHint}
        </Typography>
      </Stack>
    </Card>
  );
}
