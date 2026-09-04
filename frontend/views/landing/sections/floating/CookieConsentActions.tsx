import { Button, Stack } from "@mui/material";
import type { ReactNode } from "react";
import { Landing, useAppTranslation } from "@/shared/locale";

/** Cookie banner action buttons: decline / settings / accept. */
export function CookieConsentActions({
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
    <Stack direction="row" spacing={1} sx={{ flexShrink: 0 }}>
      <Button
        onClick={onDecline}
        sx={{
          color: "var(--mui-palette-text-secondary)",
          textTransform: "none",
          fontWeight: 600,
          borderRadius: 2,
          minHeight: 44,
          "&:hover": { bgcolor: "color-mix(in srgb, var(--mui-palette-text-secondary) 8%, transparent)" },
        }}
      >
        {t.cookieDecline}
      </Button>
      <Button
        onClick={onOpenSettings}
        sx={{
          color: "var(--mui-palette-secondary-main)",
          textTransform: "none",
          fontWeight: 600,
          borderRadius: 2,
          minHeight: 44,
          "&:hover": { bgcolor: "color-mix(in srgb, var(--mui-palette-secondary-main) 8%, transparent)" },
        }}
      >
        {t.cookieSettings}
      </Button>
      <Button
        onClick={onAccept}
        variant="contained"
        sx={{
          position: "relative",
          overflow: "hidden",
          bgcolor: "var(--mui-palette-secondary-main)",
          color: "var(--mui-palette-onSecondary)",
          textTransform: "none",
          fontWeight: 700,
          borderRadius: 2,
          minHeight: 44,
          "&::after": {
            content: '""',
            position: "absolute",
            top: 0,
            left: "-100%",
            width: "100%",
            height: "100%",
            background: "linear-gradient(90deg, transparent, rgba(255,255,255,0.2), transparent)",
            transition: "left 0.5s ease",
          },
          "&:hover": {
            bgcolor: "var(--mui-palette-secondary-dark)",
            "&::after": { left: "100%" },
          },
        }}
      >
        {t.cookieAccept}
      </Button>
    </Stack>
  );
}
