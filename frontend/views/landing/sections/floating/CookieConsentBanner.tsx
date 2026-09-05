import { Box, Container, Stack, Typography } from "@mui/material";
import type { ReactNode } from "react";
import { CookieConsentActions } from "@/frontend/views/landing/sections/floating/CookieConsentActions";
import { Landing, useAppTranslation } from "@/shared/locale";

/** Bottom-fixed cookie consent banner (decline / settings / accept). */
export function CookieConsentBanner({
  onDecline,
  onOpenSettings,
  onAccept,
}: Readonly<{
  onDecline: () => void;
  onOpenSettings: () => void;
  onAccept: () => void;
}>): ReactNode {
  const t = useAppTranslation(Landing);

  return (
    <Box
      sx={{
        position: "fixed",
        bottom: 0,
        left: 0,
        right: 0,
        zIndex: 150,
        borderTop: "2px solid var(--mui-palette-secondary-main)",
        backdropFilter: "blur(16px)",
        bgcolor: "color-mix(in srgb, var(--mui-palette-background-paper) 80%, transparent)",
      }}
    >
      <Container maxWidth="lg">
        <Stack
          direction={{ xs: "column", sm: "row" }}
          spacing={2}
          sx={{
            alignItems: { xs: "flex-start", sm: "center" },
            justifyContent: "space-between",
            py: 2.5,
            gap: 2,
          }}
        >
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 0.5, color: "var(--mui-palette-text-primary)" }}>
              {t.cookieTitle}
            </Typography>
            <Typography
              variant="body2"
              sx={{ color: "var(--mui-palette-text-secondary)", lineHeight: 1.5, fontSize: 13 }}
            >
              {t.cookieBody}
            </Typography>
          </Box>
          <CookieConsentActions onDecline={onDecline} onOpenSettings={onOpenSettings} onAccept={onAccept} />
        </Stack>
      </Container>
    </Box>
  );
}
