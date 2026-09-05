"use client";

/**
 * DirectoryActionsMenu — the kebab actions menu each directory row renders
 * on both surfaces (desktop table cell, mobile card trailing column).
 */

import {
  BlockOutlined as BlockIcon,
  EditOutlined as EditIcon,
  MoreVertOutlined as MoreVertIcon,
  RefreshOutlined as RefreshIcon,
} from "@mui/icons-material";
import { IconButton, Menu, MenuItem } from "@mui/material";
import { type ReactNode, useState } from "react";
import type { DirectoryUserItem } from "@/frontend/views/admin/users/directory";
import type { AdminUsersLabels } from "@/shared/locale/types/adminUsers";

interface DirectoryActionsMenuProps {
  readonly user: DirectoryUserItem;
  readonly labels: Pick<AdminUsersLabels, "headers" | "editDialog" | "deleteConfirm" | "reactivateConfirm">;
  readonly onEdit: (user: DirectoryUserItem) => void;
  readonly onDelete: (user: DirectoryUserItem) => void;
}

/**
 * Kebab actions menu per row — replaces the two verbal buttons the old
 * table rendered per row. The Deactivate item paints in the `error` lane;
 * for already-deleted rows the same slot becomes Reactivate (default
 * ink). Both wire straight into the container's existing dialog callbacks,
 * so the edit / soft-delete / reactivate flows are unchanged.
 */
export function DirectoryActionsMenu({ user, labels, onEdit, onDelete }: DirectoryActionsMenuProps): ReactNode {
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const isReactivate = user.isDeleted;
  const close = () => setAnchorEl(null);
  return (
    <>
      <IconButton
        aria-label={labels.headers.actions}
        aria-haspopup="menu"
        aria-expanded={anchorEl ? true : undefined}
        onClick={event => setAnchorEl(event.currentTarget)}
        sx={{ minWidth: 44, minHeight: 44 }}
      >
        <MoreVertIcon />
      </IconButton>
      <Menu anchorEl={anchorEl} open={anchorEl !== null} onClose={close}>
        <MenuItem
          onClick={() => {
            close();
            onEdit(user);
          }}
        >
          <EditIcon fontSize="small" sx={theme => ({ marginInlineEnd: 1.5, color: theme.palette.text.secondary })} />
          {labels.editDialog.title}
        </MenuItem>
        <MenuItem
          onClick={() => {
            close();
            onDelete(user);
          }}
          sx={theme =>
            isReactivate
              ? {}
              : {
                  color: theme.palette.error.main,
                  "& .MuiSvgIcon-root": { color: theme.palette.error.main },
                }
          }
        >
          {isReactivate ? (
            <RefreshIcon
              fontSize="small"
              sx={theme => ({ marginInlineEnd: 1.5, color: theme.palette.text.secondary })}
            />
          ) : (
            <BlockIcon fontSize="small" sx={{ marginInlineEnd: 1.5 }} />
          )}
          {isReactivate ? labels.reactivateConfirm.confirm : labels.deleteConfirm.confirm}
        </MenuItem>
      </Menu>
    </>
  );
}
