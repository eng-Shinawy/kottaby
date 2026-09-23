"use client";

/**
 * DirectoryPageHeader — the shared page header of the admin directory
 * client surfaces: an `h1` `h4`-variant title over a `text.secondary`
 * body-1 subtitle (copy from the surface's locale namespace).
 */

import { Box, Typography } from "@mui/material";
import type { ReactNode } from "react";

interface DirectoryPageHeaderProps {
  readonly title: string;
  readonly subtitle: string;
}

export function DirectoryPageHeader({ title, subtitle }: DirectoryPageHeaderProps): ReactNode {
  return (
    <Box>
      <Typography variant="h4" component="h1">
        {title}
      </Typography>
      <Typography variant="body1" sx={theme => ({ color: theme.palette.text.secondary })}>
        {subtitle}
      </Typography>
    </Box>
  );
}
