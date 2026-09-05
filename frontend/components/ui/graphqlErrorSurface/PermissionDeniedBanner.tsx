"use client";

import { Close as CloseIcon, LockOutlined } from "@mui/icons-material";
import { Alert, AlertTitle, Box, IconButton } from "@mui/material";
import type { GraphQLErrorAction } from "@/frontend/providers/apollo/error-link.map";
import { Common, Errors, useAppTranslation } from "@/shared/locale";

interface PermissionDeniedBannerProps {
  readonly action: GraphQLErrorAction;
  readonly onDismiss: () => void;
}

/**
 * Non-blocking pinned banner for `permission-fallback` actions, built on
 * the shared `PermissionDeniedFallback` copy (LockOutlined +
 * `errors.forbiddenRole`), dismissible. Page-level role gating itself stays
 * owned by `withPageAuth` redirects, so this banner covers GraphQL query
 * denials that slip past route guards.
 */
export function PermissionDeniedBanner({ action, onDismiss }: PermissionDeniedBannerProps) {
  const t = useAppTranslation(Errors);
  const commonT = useAppTranslation(Common);
  return (
    <Box
      sx={{
        position: "fixed",
        top: 72,
        insetInlineStart: 0,
        insetInlineEnd: 0,
        zIndex: 1400,
        px: { xs: 2, sm: 3 },
        pointerEvents: "none",
      }}
    >
      <Alert
        severity="error"
        variant="filled"
        icon={<LockOutlined />}
        action={
          <IconButton aria-label={commonT.close} size="small" onClick={onDismiss}>
            <CloseIcon fontSize="small" />
          </IconButton>
        }
        sx={theme => ({
          pointerEvents: "auto",
          mx: "auto",
          maxWidth: 560,
          borderRadius: 2,
          boxShadow: theme.shadows[8],
          border: "1px solid",
          borderColor: `color-mix(in srgb, ${theme.palette.common.white} 16%, transparent)`,
          "@media (prefers-reduced-motion: no-preference)": {
            animation: `ghBannerIn ${theme.transitions.duration.enteringScreen}ms ${theme.transitions.easing.easeOut}`,
          },
          "@keyframes ghBannerIn": {
            from: { opacity: 0, transform: "translateY(-10px)" },
            to: { opacity: 1, transform: "translateY(0)" },
          },
        })}
      >
        <AlertTitle sx={{ fontWeight: 700 }}>{t.forbiddenRole}</AlertTitle>
        {t[action.messageKey]}
      </Alert>
    </Box>
  );
}
