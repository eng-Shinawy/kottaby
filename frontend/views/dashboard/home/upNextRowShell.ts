import type { Theme } from "@mui/material/styles";
import { focusVisibleRingSx } from "@/frontend/components/ui/focusRing";

/**
 * Shared Up Next glance-card row chrome (style layer) — the row metrics and
 * the clickable-row shell factory both role cards compose so their
 * mini-rows never drift visually (or re-derive the same sx blocks, which
 * jscpd would flag as clones).
 *
 * Constant/function exports live in this directive-free `.ts` leaf (the
 * component exports live in the sibling `UpNextRowChrome.tsx`) so Fast
 * Refresh sees component-only files.
 *
 * Consumers:
 *  - `frontend/views/students/dashboard/StudentUpNextCard.tsx`
 *  - `frontend/views/teachers/dashboard/TeacherUpNextCard.tsx`
 */

/** How many upcoming sessions the glance window shows — the rest live on the role's sessions surface. */
export const UP_NEXT_WINDOW_SIZE = 2;

/** Row metrics — comfortable ≥44px touch target + shared focus ring. */
const upNextRowSx = {
  ...focusVisibleRingSx,
  minHeight: 44,
  width: "100%",
  textAlign: "inherit",
} as const;

/**
 * The shared clickable-row shell for the glance rows: tinted card line,
 * short transition, hover wash + border emphasis. The hover border color
 * is the caller's emphasis choice (primary = the session hop, outline =
 * the quieter summary row), so the rows never drift visually.
 */
export function upNextRowShellSx(hoverBorderColor: "primary" | "outline") {
  return (theme: Theme) => ({
    ...upNextRowSx,
    display: "flex",
    alignItems: "center",
    gap: 1.5,
    padding: 1.5,
    borderRadius: 2,
    border: "1px solid",
    borderColor: theme.palette.outlineVariant,
    bgcolor: theme.palette.surfaceContainerLowest,
    transition: theme.transitions.create(["background-color", "border-color"], {
      duration: theme.transitions.duration.short,
      easing: theme.transitions.easing.easeOut,
    }),
    "&:hover": {
      bgcolor: theme.palette.action.hover,
      borderColor: hoverBorderColor === "primary" ? theme.palette.primary.main : theme.palette.outline,
    },
  });
}
