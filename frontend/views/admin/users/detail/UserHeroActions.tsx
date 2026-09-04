"use client";

/**
 * UserHeroActions — the trailing action buttons of the admin user DETAIL
 * hero (`UserDetailHero`), extracted from `UserDetailHero.tsx`.
 *
 * Edit (contained `primary` → the shared edit dialog) and Deactivate
 * (outlined `error` → the shared delete dialog); for deleted users the slot
 * renders Reactivate (outlined `success`) instead.
 */

import {
  BlockOutlined as BlockIcon,
  EditOutlined as EditIcon,
  RefreshOutlined as ReactivateIcon,
} from "@mui/icons-material";
import { Button, Stack } from "@mui/material";
import type { ReactNode } from "react";
import type { AdminUsersLabels } from "@/shared/locale/types/adminUsers";

interface UserHeroActionsProps {
  readonly labels: Pick<AdminUsersLabels, "detail">;
  readonly isDeleted: boolean;
  readonly onEdit: () => void;
  readonly onDelete: () => void;
}

export function UserHeroActions({ labels, isDeleted, onEdit, onDelete }: UserHeroActionsProps): ReactNode {
  return (
    <Stack spacing={1.5} sx={{ flexShrink: 0, marginInlineStart: { md: "auto" } }}>
      <Button
        variant="contained"
        color="primary"
        startIcon={<EditIcon />}
        onClick={onEdit}
        sx={{ whiteSpace: "nowrap", flexShrink: 0, minWidth: 168, minHeight: 44 }}
      >
        {labels.detail.editAction}
      </Button>
      {isDeleted ? (
        <Button
          variant="outlined"
          color="success"
          startIcon={<ReactivateIcon />}
          onClick={onDelete}
          sx={{ whiteSpace: "nowrap", flexShrink: 0, minWidth: 168, minHeight: 44 }}
        >
          {labels.detail.reactivateAction}
        </Button>
      ) : (
        <Button
          variant="outlined"
          color="error"
          startIcon={<BlockIcon />}
          onClick={onDelete}
          sx={{ whiteSpace: "nowrap", flexShrink: 0, minWidth: 168, minHeight: 44 }}
        >
          {labels.detail.deleteAction}
        </Button>
      )}
    </Stack>
  );
}
