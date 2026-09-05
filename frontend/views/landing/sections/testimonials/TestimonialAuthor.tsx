import { Box, Stack, Typography } from "@mui/material";
import type { ReactNode } from "react";

/** Author row: avatar circle with initial + name/role. */
export function TestimonialAuthor({ name, role }: Readonly<{ name: string; role: string }>): ReactNode {
  return (
    <Stack direction="row" spacing={1.5} sx={{ alignItems: "center" }}>
      {/* Avatar circle with initial */}
      <Box
        sx={{
          width: 36,
          height: 36,
          borderRadius: "50%",
          bgcolor: "var(--mui-palette-secondary-main)",
          color: "var(--mui-palette-onSecondary)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontWeight: 700,
          fontSize: 15,
          flexShrink: 0,
        }}
      >
        {name.charAt(0)}
      </Box>
      <Box>
        <Typography sx={{ fontWeight: 700, fontSize: 14, lineHeight: 1.3 }}>{name}</Typography>
        <Typography variant="caption" sx={{ opacity: 0.7, lineHeight: 1.3 }}>
          {role}
        </Typography>
      </Box>
    </Stack>
  );
}
