import { MenuBookOutlined, RadioButtonCheckedOutlined, RadioButtonUncheckedOutlined } from "@mui/icons-material";
import { Box, Chip, Stack, Typography } from "@mui/material";

export interface RecitationCardContentProps {
  /** Translated reading label (e.g. "Hafs 'an Asim"). */
  readonly label: string;
  /** Translated short description (region/context); empty when unavailable. */
  readonly description: string;
  /** Whether this reading is the currently selected one. */
  readonly isSelected: boolean;
  /** Whether this reading gets the "Most popular" badge. */
  readonly isPopular: boolean;
  /** Translated "Most popular" chip label. */
  readonly mostPopularLabel: string;
}

export function RecitationCardContent({
  label,
  description,
  isSelected,
  isPopular,
  mostPopularLabel,
}: RecitationCardContentProps) {
  return (
    <Stack direction="row" spacing={1.5} sx={{ alignItems: "flex-start" }}>
      {/* Radio indicator */}
      <Box
        sx={{
          mt: 0.25,
          color: isSelected ? "var(--mui-palette-primary-main)" : "var(--mui-palette-text-disabled)",
        }}
      >
        {isSelected ? (
          <RadioButtonCheckedOutlined fontSize="small" />
        ) : (
          <RadioButtonUncheckedOutlined fontSize="small" />
        )}
      </Box>

      {/* Content */}
      <Stack spacing={0.5} sx={{ flex: 1, minWidth: 0 }}>
        <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
          <MenuBookOutlined
            sx={{
              fontSize: 18,
              color: isSelected ? "var(--mui-palette-secondary-main)" : "var(--mui-palette-text-secondary)",
              flexShrink: 0,
            }}
          />
          <Typography
            variant="body2"
            sx={{
              fontWeight: 600,
              color: isSelected ? "var(--mui-palette-onPrimaryContainer)" : "var(--mui-palette-text-primary)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {label}
          </Typography>
          {isPopular ? (
            <Chip
              component="span"
              label={mostPopularLabel}
              size="small"
              sx={{
                height: 22,
                fontSize: 12,
                fontWeight: 700,
                letterSpacing: "0.04em",
                textTransform: "uppercase",
                bgcolor: "var(--mui-palette-secondaryContainer)",
                color: "var(--mui-palette-onSecondaryContainer)",
                border: 1,
                borderColor: "var(--mui-palette-secondary-main)",
                flexShrink: 0,
              }}
            />
          ) : null}
        </Stack>
        {description ? (
          <Typography
            variant="caption"
            sx={{
              color: isSelected ? "var(--mui-palette-onPrimaryContainer)" : "var(--mui-palette-text-secondary)",
              opacity: 0.85,
              lineHeight: 1.3,
            }}
          >
            {description}
          </Typography>
        ) : null}
      </Stack>
    </Stack>
  );
}
