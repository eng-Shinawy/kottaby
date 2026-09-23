"use client";

/**
 * DirectoryMobileCardHeader — the header atoms of the mobile directory
 * cards' 3-track grid (consumed through `DirectoryMobileCard`'s `name` /
 * `trailing` slots):
 *  - `DirectoryMobileCardName` — the single-line ellipsized NAME (the
 *    shared bidi ellipsis recipe); soft-deleted items dim + strike through;
 *  - `DirectoryMobileCardCaption` — the trailing timestamp caption (dimmed
 *    for soft-deleted items);
 *  - `DirectoryMobileCardAction` — the trailing quick action (the
 *    view-details / view-profile affordance — a plain button or a profile
 *    link, ≥44px touch target via transparent padding).
 *
 * Bidi note (Latin names inside an RTL page): the HTML `dir="ltr"`
 * ATTRIBUTE isolates glyph direction — a CSS `direction` rule MUST NOT be
 * added (stylis-plugin-rtl would flip it and clip the string's head).
 */

import { VisibilityOutlined as ActionIcon } from "@mui/icons-material";
import { IconButton, Tooltip, Typography } from "@mui/material";
import Link from "next/link";
import type { ReactNode } from "react";

interface DirectoryMobileCardNameProps {
  readonly name: string;
  readonly deleted?: boolean;
}

/** The header grid's single-line ellipsized name (see file docblock). */
export function DirectoryMobileCardName({ name, deleted = false }: DirectoryMobileCardNameProps): ReactNode {
  return (
    <Typography
      component="div"
      title={name}
      dir="ltr"
      sx={theme => ({
        fontSize: 15,
        fontWeight: 600,
        unicodeBidi: "isolate",
        textAlign: "start",
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
        minWidth: 0,
        color: deleted ? theme.palette.text.disabled : theme.palette.text.primary,
        ...(deleted && { textDecoration: "line-through" }),
      })}
    >
      {name}
    </Typography>
  );
}

interface DirectoryMobileCardCaptionProps {
  readonly caption: string;
  readonly deleted?: boolean;
}

/** The trailing timestamp caption (dimmed for soft-deleted items). */
export function DirectoryMobileCardCaption({ caption, deleted = false }: DirectoryMobileCardCaptionProps): ReactNode {
  return (
    <Typography
      variant="caption"
      sx={theme => ({
        color: deleted ? theme.palette.text.disabled : theme.palette.text.secondary,
        textAlign: "end",
      })}
    >
      {caption}
    </Typography>
  );
}

interface DirectoryMobileCardActionProps {
  /** The tooltip label. */
  readonly tooltipLabel: string;
  /** The accessible name (profile links suffix the item's name). */
  readonly ariaLabel: string;
  /** Opens the detail drawer (plain button). */
  readonly onClick?: () => void;
  /** When set, the action renders as a profile link instead of a button. */
  readonly href?: string;
}

/**
 * The trailing quick action — the view-details / view-profile affordance
 * (≥44px touch target via transparent padding; the icon stays visually
 * 20px).
 */
export function DirectoryMobileCardAction({
  tooltipLabel,
  ariaLabel,
  onClick,
  href,
}: DirectoryMobileCardActionProps): ReactNode {
  const linkProps = href === undefined ? {} : { component: Link, href };
  return (
    <Tooltip title={tooltipLabel} placement="top">
      <IconButton
        size="small"
        {...linkProps}
        aria-label={ariaLabel}
        onClick={onClick}
        sx={theme => ({
          // ≥44px touch target via transparent padding; the icon
          // stays visually 20px.
          p: 1.5,
          my: -0.75,
          color: theme.palette.text.secondary,
        })}
      >
        <ActionIcon fontSize="small" />
      </IconButton>
    </Tooltip>
  );
}
