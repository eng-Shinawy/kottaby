import { Box, Button, Stack, Typography } from "@mui/material";
import Link from "next/link";
import type { ReactNode } from "react";

/** One role card: animated icon, title, body, text CTA. */
export function RoleCard({
  icon,
  title,
  body,
  cta,
  href,
}: Readonly<{ icon: ReactNode; title: string; body: string; cta: string; href: string }>): ReactNode {
  return (
    <Stack
      spacing={2}
      sx={{
        p: 4,
        borderRadius: 3,
        position: "relative",
        background:
          "linear-gradient(to bottom, transparent, color-mix(in srgb, var(--mui-palette-secondary-main) 3%, transparent))",
        bgcolor: "var(--mui-palette-background-default)",
        border: "1px solid var(--mui-palette-divider)",
        borderTop: "3px solid transparent",
        borderImage: "linear-gradient(90deg, var(--mui-palette-secondary-main) 0%, transparent 100%) 1",
        transition: "border-color 0.2s ease, box-shadow 0.2s ease, transform 0.2s ease",
        "&::before": {
          content: '""',
          position: "absolute",
          inset: -1,
          borderRadius: 13,
          background:
            "conic-gradient(var(--mui-palette-secondary-main), transparent 25%, transparent 75%, var(--mui-palette-secondary-main))",
          opacity: 0,
          transition: "opacity 0.4s ease",
          pointerEvents: "none",
          zIndex: 0,
          animation: "rolesBorderSpin 6s linear infinite",
          "@keyframes rolesBorderSpin": {
            "0%": { transform: "rotate(0deg)" },
            "100%": { transform: "rotate(360deg)" },
          },
        },
        "&:hover": {
          borderColor: "var(--mui-palette-secondary-main)",
          boxShadow: "0 12px 32px rgba(0,0,0,0.08)",
          transform: "translateY(-4px)",
          "&::before": { opacity: 0.5 },
        },
        height: "100%",
        overflow: "visible",
      }}
    >
      <Box
        sx={{
          width: 52,
          height: 52,
          borderRadius: 2,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          bgcolor: "var(--mui-palette-primary-main)",
          color: "var(--mui-palette-onPrimary)",
          position: "relative",
          zIndex: 1,
          animation: "iconFloat 3s ease-in-out infinite",
          "@keyframes iconFloat": {
            "0%, 100%": { transform: "translateY(-2px)" },
            "50%": { transform: "translateY(2px)" },
          },
          "& svg": { fontSize: 28 },
        }}
      >
        {icon}
      </Box>
      <Typography variant="h6" sx={{ fontWeight: 700, fontSize: 20 }}>
        {title}
      </Typography>
      <Typography variant="body2" sx={{ color: "var(--mui-palette-text-secondary)", lineHeight: 1.6, flex: 1 }}>
        {body}
      </Typography>
      <Button
        component={Link}
        href={href}
        variant="text"
        sx={{
          alignSelf: "flex-start",
          color: "var(--mui-palette-secondary-main)",
          fontWeight: 700,
          textTransform: "none",
          p: 0,
          "&:hover": { bgcolor: "transparent", textDecoration: "underline" },
        }}
      >
        {cta} →
      </Button>
    </Stack>
  );
}
