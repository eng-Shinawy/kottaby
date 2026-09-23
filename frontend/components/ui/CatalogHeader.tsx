"use client";

import { AddOutlined as AddIcon } from "@mui/icons-material";
import { Box, Button, Stack, Typography } from "@mui/material";

export interface CatalogHeaderProps {
  readonly title: string;
  readonly subtitle: string;
  readonly actionLabel: string;
  readonly onCreateNew: () => void;
  /** Nothing can be created while no parent entity is selectable. */
  readonly canCreate?: boolean;
}

export function CatalogHeader({
  title,
  subtitle,
  actionLabel,
  onCreateNew,
  canCreate = true,
}: CatalogHeaderProps): React.ReactElement {
  return (
    <Stack
      sx={{
        mb: 4,
        gap: 2,
        flexDirection: { xs: "column", sm: "row" },
        justifyContent: "space-between",
        alignItems: { xs: "flex-start", sm: "center" },
      }}
    >
      <Box>
        <Typography variant="h4" component="h1" sx={{ fontWeight: 700, mb: 0.5 }}>
          {title}
        </Typography>
        <Typography variant="body1" sx={theme => ({ color: theme.palette.text.secondary })}>
          {subtitle}
        </Typography>
      </Box>
      <Button
        variant="contained"
        color="primary"
        startIcon={<AddIcon />}
        onClick={onCreateNew}
        disabled={!canCreate}
        sx={{ minHeight: 44 }}
      >
        {actionLabel}
      </Button>
    </Stack>
  );
}
