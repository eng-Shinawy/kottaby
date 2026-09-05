import { Box, Container, Stack } from "@mui/material";
import type { ReactNode } from "react";
import { newsletterShellSx } from "@/frontend/views/landing/utils";

export function NewsletterShell({ children }: Readonly<{ children: ReactNode }>): ReactNode {
  return (
    <Box component="section" sx={newsletterShellSx}>
      <Container maxWidth="lg">
        <Stack spacing={3} sx={{ alignItems: "center", textAlign: "center", maxWidth: 560, mx: "auto" }}>
          {children}
        </Stack>
      </Container>
    </Box>
  );
}
