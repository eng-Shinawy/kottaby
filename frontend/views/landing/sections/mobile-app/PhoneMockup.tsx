import { Box, Stack } from "@mui/material";
import type { ReactNode } from "react";
import { PhoneCalendarCard } from "@/frontend/views/landing/sections/mobile-app/PhoneCalendarCard";
import { PhoneProfileCard } from "@/frontend/views/landing/sections/mobile-app/PhoneProfileCard";
import { PhoneProgressCard } from "@/frontend/views/landing/sections/mobile-app/PhoneProgressCard";

/** Floating phone mockup shown on md+ next to the mobile-app feature list. */
export function PhoneMockup(): ReactNode {
  return (
    <Box sx={{ display: { xs: "none", md: "flex" }, justifyContent: "center" }}>
      <Box
        sx={{
          width: 220,
          height: 440,
          borderRadius: 4,
          border: "3px solid var(--mui-palette-divider)",
          bgcolor: "var(--mui-palette-background-default)",
          position: "relative",
          overflow: "hidden",
          animation: "phoneFloat 4s ease-in-out infinite",
          boxShadow: "0 16px 40px rgba(0,0,0,0.15)",
          "@keyframes phoneFloat": {
            "0%, 100%": { transform: "rotate(-3deg) translateY(0)" },
            "50%": { transform: "rotate(-3deg) translateY(-12px)" },
          },
        }}
      >
        <Box
          aria-hidden
          sx={{
            position: "absolute",
            top: 6,
            left: "50%",
            transform: "translateX(-50%)",
            width: 48,
            height: 5,
            borderRadius: 99,
            bgcolor: "var(--mui-palette-secondary-main)",
            zIndex: 2,
          }}
        />
        <Box
          aria-hidden
          sx={{
            height: 50,
            background:
              "linear-gradient(135deg, var(--mui-palette-primary-dark) 0%, var(--mui-palette-primary-main) 100%)",
          }}
        />
        <Box aria-hidden sx={{ height: 3, bgcolor: "var(--mui-palette-secondary-main)" }} />
        <Stack spacing={2} sx={{ p: 2.5 }}>
          <PhoneProfileCard />
          <PhoneProgressCard />
          <PhoneCalendarCard />
        </Stack>
      </Box>
    </Box>
  );
}
