"use client";

/**
 * MobileUserCardList — the mobile (< md) rendering of the admin user
 * directory: a vertical stack of per-user cards (16px gap). The stack keeps
 * a 96px `paddingBlockEnd` as a gap before the pagination card; the scroll
 * clearance that keeps the fixed create `Fab` off the final content at the
 * bottom of the page lives on the page container's bottom padding
 * (`AdminUsersDirectoryContainer`).
 *
 * Each card is rendered by `MobileUserCard` (header grid with avatar +
 * identity + time/kebab column; divider; two-column body rows for Status
 * and Governance). Loading renders stable-key skeleton cards; the empty
 * state wraps `DirectoryEmptyState` in a card. Soft-deleted users render
 * dimmed (details in `MobileUserCard`).
 */

import { Card, Stack } from "@mui/material";
import type { ReactNode } from "react";
import {
  DirectoryEmptyState,
  type DirectoryUserItem,
  MobileUserCard,
  type RowCellLabels,
} from "@/frontend/views/admin/users/directory";
import { DIRECTORY_SKELETON_KEYS } from "@/frontend/views/admin/users/utils";
import { useAppLocale } from "@/shared/locale";

interface MobileUserCardListProps {
  readonly labels: RowCellLabels;
  readonly items: readonly DirectoryUserItem[];
  readonly loading: boolean;
  readonly hasFilters: boolean;
  readonly onEdit: (user: DirectoryUserItem) => void;
  readonly onDelete: (user: DirectoryUserItem) => void;
}

export function MobileUserCardList(props: MobileUserCardListProps): ReactNode {
  const { labels, items, loading, hasFilters, onEdit, onDelete } = props;
  const locale = useAppLocale();
  return (
    <Stack
      spacing={2}
      sx={{ display: { xs: "flex", md: "none" }, paddingBlockEnd: 12 /* 96px gap before the pagination card */ }}
    >
      {loading &&
        items.length === 0 &&
        DIRECTORY_SKELETON_KEYS.slice(0, 4).map(rowKey => (
          <Card
            key={rowKey}
            sx={theme => ({
              borderRadius: "12px",
              border: `1px solid ${theme.palette.border.light}`,
              boxShadow: theme.palette.shadow.card,
              p: 2,
              height: 132,
            })}
          />
        ))}
      {!loading && items.length === 0 && (
        <Card
          sx={theme => ({
            borderRadius: "12px",
            border: `1px solid ${theme.palette.border.light}`,
            boxShadow: theme.palette.shadow.card,
          })}
        >
          <DirectoryEmptyState labels={labels} hasFilters={hasFilters} />
        </Card>
      )}
      {items.map(user => (
        <MobileUserCard key={user.id} labels={labels} user={user} locale={locale} onEdit={onEdit} onDelete={onDelete} />
      ))}
    </Stack>
  );
}
