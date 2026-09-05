import { Box, Stack, Typography } from "@mui/material";
import type { ReactNode } from "react";

export function FeatureCard({
  icon,
  title,
  body,
}: Readonly<{ icon: ReactNode; title: string; body: string }>): ReactNode {
  return (
    <Stack
      spacing={1.5}
      sx={{
        p: 3,
        borderRadius: 3,
        bgcolor: "var(--mui-palette-background-paper)",
        border: "1px solid var(--mui-palette-divider)",
        transition: "border-color 0.2s ease, box-shadow 0.2s ease, transform 0.2s ease",
        "&:hover": {
          borderColor: "var(--mui-palette-secondary-main)",
          boxShadow:
            "0 8px 24px rgba(184,115,51,0.12), inset 0 1px 0 rgba(184,115,51,0.06), 0 0 20px rgba(184,115,51,0.08)",
          transform: "translateY(-2px)",
          backdropFilter: "blur(8px)",
          bgcolor: "color-mix(in srgb, var(--mui-palette-background-paper) 80%, transparent)",
        },
        height: "100%",
        position: "relative",
        overflow: "hidden",
        "&::after": {
          content: '""',
          position: "absolute",
          bottom: 0,
          left: 0,
          right: 0,
          height: "40%",
          background:
            "linear-gradient(to top, color-mix(in srgb, var(--mui-palette-secondary-main) 0.06), transparent)",
          opacity: 0,
          transition: "opacity 0.3s ease",
          pointerEvents: "none",
        },
        "&:hover::after": {
          opacity: 1,
        },
      }}
    >
      <Box
        sx={{
          width: 44,
          height: 44,
          borderRadius: 2,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          bgcolor: "color-mix(in srgb, var(--mui-palette-secondary-main) 10%, transparent)",
          color: "var(--mui-palette-secondary-main)",
          "& svg": { fontSize: 24 },
        }}
      >
        {icon}
      </Box>
      <Typography variant="h6" sx={{ fontWeight: 700, fontSize: 17, lineHeight: 1.3 }}>
        {title}
      </Typography>
      <Typography variant="body2" sx={{ color: "var(--mui-palette-text-secondary)", lineHeight: 1.6, fontSize: 14 }}>
        {body}
      </Typography>
    </Stack>
  );
}
