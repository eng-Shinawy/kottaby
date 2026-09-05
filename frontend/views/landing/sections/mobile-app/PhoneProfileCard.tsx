import { Box, Stack } from "@mui/material";
import type { ReactNode } from "react";

/** Teacher profile skeleton card in the phone mockup. */
export function PhoneProfileCard(): ReactNode {
  return (
    <Box
      sx={{
        p: 1.5,
        borderRadius: 2,
        border: "1px solid var(--mui-palette-divider)",
        bgcolor: "var(--mui-palette-background-paper)",
      }}
    >
      <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
        <Box
          sx={{
            width: 24,
            height: 24,
            borderRadius: "50%",
            bgcolor: "color-mix(in srgb, var(--mui-palette-secondary-main) 25%, transparent)",
            flexShrink: 0,
          }}
        />
        <Box sx={{ flex: 1 }}>
          <Box
            sx={{
              height: 5,
              width: "60%",
              borderRadius: 0.5,
              bgcolor: "var(--mui-palette-text-secondary)",
              opacity: 0.3,
            }}
          />
          <Box
            sx={{
              height: 4,
              width: "40%",
              borderRadius: 0.5,
              bgcolor: "var(--mui-palette-text-secondary)",
              opacity: 0.2,
              mt: 0.5,
            }}
          />
        </Box>
      </Stack>
    </Box>
  );
}
