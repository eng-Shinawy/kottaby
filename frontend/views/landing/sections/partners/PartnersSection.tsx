import { Box, Typography } from "@mui/material";
import type { ReactNode } from "react";
import { SectionWrapper } from "@/frontend/views/landing/layout";
import { Landing, useAppTranslation } from "@/shared/locale";

// ─── Partners / Trusted By section ───────────────────────────────────

export function PartnersSection(): ReactNode {
  const t = useAppTranslation(Landing);
  const partners = [t.partner1Name, t.partner2Name, t.partner3Name, t.partner4Name, t.partner5Name, t.partner6Name];
  const cardSx = {
    minWidth: 160,
    p: 2.5,
    borderRadius: 2,
    border: "1px solid var(--mui-palette-divider)",
    bgcolor: "var(--mui-palette-background-default)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    textAlign: "center",
    flexShrink: 0,
    transition: "border-color 0.2s ease",
    "&:hover": { borderColor: "var(--mui-palette-secondary-main)" },
  };

  return (
    <SectionWrapper badge={t.partnersBadge} title={t.partnersTitle} subtitle={t.partnersSubtitle} bg="paper">
      <Box sx={{ position: "relative", overflow: "hidden" }}>
        {/* Left fade gradient */}
        <Box
          aria-hidden
          sx={{
            position: "absolute",
            top: 0,
            left: 0,
            bottom: 0,
            width: 60,
            zIndex: 2,
            background: "linear-gradient(90deg, var(--mui-palette-background-paper), transparent)",
            pointerEvents: "none",
          }}
        />
        {/* Right fade gradient */}
        <Box
          aria-hidden
          sx={{
            position: "absolute",
            top: 0,
            right: 0,
            bottom: 0,
            width: 60,
            zIndex: 2,
            background: "linear-gradient(270deg, var(--mui-palette-background-paper), transparent)",
            pointerEvents: "none",
          }}
        />
        <Box
          sx={{
            display: "flex",
            gap: 2.5,
            width: "fit-content",
            animation: "partnersMarquee 35s linear infinite",
            "&:hover": { animationPlayState: "paused" },
            "@keyframes partnersMarquee": {
              "0%": { transform: "translateX(0)" },
              "100%": { transform: "translateX(calc(-50% - 10px))" },
            },
          }}
        >
          {partners.map(name => (
            <Box key={name} sx={cardSx}>
              <Typography
                sx={{
                  fontWeight: 700,
                  fontSize: { xs: 13, md: 15 },
                  color: "var(--mui-palette-text-primary)",
                  lineHeight: 1.3,
                  whiteSpace: "nowrap",
                }}
              >
                {name}
              </Typography>
            </Box>
          ))}
          {partners.map(name => (
            <Box key={`${name}-dup`} sx={cardSx}>
              <Typography
                sx={{
                  fontWeight: 700,
                  fontSize: { xs: 13, md: 15 },
                  color: "var(--mui-palette-text-primary)",
                  lineHeight: 1.3,
                  whiteSpace: "nowrap",
                }}
              >
                {name}
              </Typography>
            </Box>
          ))}
        </Box>
      </Box>
    </SectionWrapper>
  );
}
