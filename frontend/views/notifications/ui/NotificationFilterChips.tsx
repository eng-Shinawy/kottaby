"use client";

import { FilterListOutlined } from "@mui/icons-material";
import { Box, Button, Chip, Divider, Stack } from "@mui/material";
import { type ReactNode, useState } from "react";
// audit-R4: shared keyboard-focus ring (v9 ButtonBase ships none).
import { focusVisibleRingSx } from "@/frontend/components/ui/focusRing";
import type { NotificationType } from "@/frontend/graphql/generated/gql/graphql";
import {
  NOTIFICATION_TYPE_CHIP_ORDER,
  NOTIFICATION_TYPE_ICONS,
  NOTIFICATION_TYPE_LABEL_ACCESSORS,
} from "@/frontend/views/notifications/utils";
import type { CommonLabels } from "@/shared/locale/types/common";
import type { NotificationsLabels } from "@/shared/locale/types/notifications";

/** Read-state filter selection: every notification vs. unread only. */
export type NotificationReadFilter = "all" | "unread";

interface NotificationFilterChipsProps {
  /** `notifications` namespace labels (property access only). */
  readonly labels: NotificationsLabels;
  /** `common` namespace labels (mobile collapsed-filter affordance). */
  readonly commonLabels: CommonLabels;
  /** Active read-state filter. */
  readonly readFilter: NotificationReadFilter;
  /** Read-state filter change handler (the container resets pagination). */
  readonly onReadFilterChange: (next: NotificationReadFilter) => void;
  /** Active type filter (`null` = no type narrowing). */
  readonly typeFilter: NotificationType | null;
  /** Type filter change handler — clicking the active chip clears it. */
  readonly onTypeFilterChange: (next: NotificationType | null) => void;
  /** Disables every chip (initial load keeps filters visible but inert). */
  readonly disabled?: boolean;
}

/**
 * NotificationFilterChips — the feed's filter rail (REQ-063b): a read-state
 * toggle (`All` / `Unread`) plus one chip per `NotificationType` value (all
 * seven, single-select — clicking the active type chip clears it).
 *
 * Selection semantics (QA round 2): "All" is selected IFF no other filter is
 * active — it reads as the unfiltered reset, so an active "Unread" or type
 * chip deselects it, and clicking it clears BOTH filters (the container
 * drops the type filter on the "all" read-filter transition). "Unread" and
 * a type chip MAY be pressed together (read-state × type are orthogonal).
 *
 * Responsive posture (plan §5.5): chips render inline on `sm+` and wrap on
 * tablet; on `xs` the rail collapses behind a translated
 * `FilterListOutlined` toggle row (`aria-expanded` announces the state).
 *
 * Chips are `aria-pressed` toggles so the selection state reaches assistive
 * tech without relying on color alone. MUI v9 discipline: `sx`-only styling,
 * theme-palette colors through the `color` prop slots, `*Outlined` icons,
 * RTL-safe logical layout (plain flex rows mirror under `dir="rtl"`).
 */
export function NotificationFilterChips({
  labels,
  commonLabels,
  readFilter,
  onReadFilterChange,
  typeFilter,
  onTypeFilterChange,
  disabled = false,
}: Readonly<NotificationFilterChipsProps>): ReactNode {
  // Mobile-only collapsed state — `sm+` always shows the rail (the toggle
  // button itself is hidden on `sm+`).
  const [filtersOpen, setFiltersOpen] = useState(false);

  // "All" is the no-filter state, not merely the read-state default: it is
  // selected IFF no other filter is active (single-selection semantics, QA
  // round 2). A read-state narrowing ("Unread") OR an active type chip
  // deselects "All"; the container's read-filter handler drops the type
  // filter when "All" is selected, so the two can never be pressed together.
  const allSelected = readFilter === "all" && typeFilter === null;

  return (
    <Stack spacing={1.5} sx={{ width: "100%" }}>
      <Button
        size="small"
        color="primary"
        variant="text"
        startIcon={<FilterListOutlined />}
        aria-expanded={filtersOpen}
        onClick={() => setFiltersOpen(open => !open)}
        sx={{
          ...focusVisibleRingSx,
          // Collapsed-filter affordance exists ONLY on the mobile breakpoint.
          display: { xs: "inline-flex", sm: "none" },
          alignSelf: "flex-start",
          minHeight: 44,
        }}
      >
        {commonLabels.filters}
      </Button>
      <Box
        sx={{
          display: filtersOpen ? "flex" : { xs: "none", sm: "flex" },
          flexDirection: "row",
          flexWrap: "wrap",
          alignItems: "center",
          gap: 1,
        }}
      >
        <Chip
          label={labels.filterAll}
          clickable
          disabled={disabled}
          aria-pressed={allSelected}
          color={allSelected ? "primary" : "default"}
          variant={allSelected ? "filled" : "outlined"}
          onClick={() => onReadFilterChange("all")}
          sx={{ ...focusVisibleRingSx, minHeight: 44 }}
        />
        <Chip
          label={labels.filterUnread}
          clickable
          disabled={disabled}
          aria-pressed={readFilter === "unread"}
          color={readFilter === "unread" ? "primary" : "default"}
          variant={readFilter === "unread" ? "filled" : "outlined"}
          onClick={() => onReadFilterChange("unread")}
          sx={{ ...focusVisibleRingSx, minHeight: 44 }}
        />
        <Divider
          orientation="vertical"
          flexItem
          sx={theme => ({ borderColor: theme.palette.outlineVariant, alignSelf: "stretch", my: 0.5 })}
        />
        {NOTIFICATION_TYPE_CHIP_ORDER.map(type => {
          const TypeIcon = NOTIFICATION_TYPE_ICONS[type];
          const selected = typeFilter === type;
          return (
            <Chip
              key={type}
              icon={<TypeIcon fontSize="small" />}
              label={NOTIFICATION_TYPE_LABEL_ACCESSORS[type](labels)}
              clickable
              disabled={disabled}
              aria-pressed={selected}
              color={selected ? "primary" : "default"}
              variant={selected ? "filled" : "outlined"}
              onClick={() => onTypeFilterChange(selected ? null : type)}
              // Generous height keeps taller Arabic glyphs unclipped.
              sx={{ ...focusVisibleRingSx, minHeight: 44 }}
            />
          );
        })}
      </Box>
    </Stack>
  );
}
