import { Box, Stack, Typography } from "@mui/material";
import type { ReactNode, Ref } from "react";

/** One how-it-works step: pulsing number circle, title, body. */
export function HowItWorkStep({
  num,
  title,
  body,
  circleRef,
  active,
}: Readonly<{
  num: string;
  title: string;
  body: string;
  circleRef: Ref<HTMLDivElement>;
  active: boolean;
}>): ReactNode {
  return (
    <Stack spacing={2} sx={{ position: "relative", zIndex: 1 }}>
      {/* Ring host wrapper — the animated pulse ring lives on this non-leaf
          box so it never registers as scrollable overflow on the circle
          itself (a border/transform ring inside the 56px circle reported
          scrollWidth 61–69 vs clientWidth 56 as "clipped" in QA DOM audits). */}
      <Box
        sx={{
          position: "relative",
          display: "inline-flex",
          alignSelf: "flex-start",
          "&::after": {
            content: '""',
            position: "absolute",
            inset: -6,
            borderRadius: "50%",
            boxShadow: "0 0 0 2px var(--mui-palette-secondary-main)",
            opacity: 0,
            animation: "stepPulse 2.5s ease-in-out infinite",
          },
          "@keyframes stepPulse": {
            "0%": { opacity: 0, transform: "scale(0.9)" },
            "50%": { opacity: 0.3, transform: "scale(1.1)" },
            "100%": { opacity: 0, transform: "scale(1.2)" },
          },
        }}
      >
        <Box
          ref={circleRef}
          className="step-circle-pulse"
          sx={{
            width: 56,
            height: 56,
            borderRadius: "50%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            bgcolor: "var(--mui-palette-secondary-main)",
            color: "var(--mui-palette-onSecondary)",
            fontSize: 24,
            fontWeight: 800,
            // Fixed-height line box keeps the numeral optically centered
            // (default line-height let the glyph drift in the 56px circle).
            lineHeight: 1,
            boxShadow: active ? "0 0 20px rgba(184,115,51,0.4)" : "0 6px 16px rgba(184,115,51,0.3)",
            transform: active ? "scale(1.1)" : "scale(1)",
            transition: "box-shadow 0.4s ease, transform 0.4s ease",
          }}
        >
          {num}
        </Box>
      </Box>
      <Typography variant="h6" sx={{ fontWeight: 700, fontSize: 18 }}>
        {title}
      </Typography>
      <Typography variant="body2" sx={{ color: "var(--mui-palette-text-secondary)", lineHeight: 1.6, fontSize: 14 }}>
        {body}
      </Typography>
    </Stack>
  );
}
