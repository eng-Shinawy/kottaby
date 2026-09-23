import { alpha, type Theme } from "@mui/material/styles";
import { type RefObject, useEffect, useRef } from "react";

const TAB_KEYS = ["attendance", "reports", "homework", "evaluations", "progress"] as const;
type TabKey = (typeof TAB_KEYS)[number];
const DEFAULT_TAB: TabKey = "attendance";

function isTabKey(value: string): value is TabKey {
  return (TAB_KEYS as readonly string[]).includes(value);
}

export function resolveTab(tab: string | null): TabKey {
  return tab !== null && isTabKey(tab) ? tab : DEFAULT_TAB;
}

export function buildDetailUrl(studentId: string | number, tab: TabKey, session: string | null): string {
  const params = new URLSearchParams();
  params.set("tab", tab);
  if (session !== null) {
    params.set("session", session);
  }
  return `/parent/children/${studentId}?${params.toString()}`;
}

/**
 * Whether a row is the `?session=` deep link's highlight target: the
 * pointer is present and equals the row's owning session id. This is the
 * one match rule every content tab's row (reports, homework, evaluations)
 * applies, so a single link highlights the same session's row on every tab.
 */
export function isDeepLinkTargetRow(deepLinkSessionId: number | null, rowSessionId: number): boolean {
  return deepLinkSessionId !== null && deepLinkSessionId === rowSessionId;
}

/**
 * Shared deep-link row highlight: resolves the match rule and scrolls the
 * owning row into view once it becomes the target. Every content tab's row
 * (reports, homework, evaluations) consumes this hook so a single link
 * produces the identical focus behavior on every tab — one effect, one
 * match rule, no per-tab divergence.
 */
export function useDeepLinkRowHighlight(
  deepLinkSessionId: number | null,
  rowSessionId: number
): { rowRef: RefObject<HTMLDivElement | null>; isDeepLinkTarget: boolean } {
  const rowRef = useRef<HTMLDivElement | null>(null);
  const isDeepLinkTarget = isDeepLinkTargetRow(deepLinkSessionId, rowSessionId);
  useEffect(() => {
    if (isDeepLinkTarget && rowRef.current !== null) {
      rowRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [isDeepLinkTarget]);
  return { rowRef, isDeepLinkTarget };
}

/**
 * Shared deep-link row treatment: the resting outlined card look with the
 * primary start-edge accent, escalating to the full highlight (thicker
 * primary border plus the selection wash) when the row is the `?session=`
 * target. Theme-palette tokens only — no literal colors.
 */
export function deepLinkRowSx(isDeepLinkTarget: boolean) {
  return (theme: Theme) => ({
    display: "flex",
    flexDirection: "column",
    gap: 1.5,
    padding: { xs: 2, sm: 2.5 },
    borderRadius: 2,
    borderColor: isDeepLinkTarget ? theme.palette.primary.main : theme.palette.border.main,
    borderWidth: isDeepLinkTarget ? 2 : 1,
    borderInlineStart: 4,
    borderInlineStartColor: isDeepLinkTarget ? theme.palette.primary.main : theme.palette.divider,
    backgroundColor: isDeepLinkTarget ? theme.palette.action.selected : "transparent",
    // Soft glow ring keeps the 2px selection border legible on dark card backgrounds.
    // Conditional spread, not a ternary-to-undefined: sx style objects reject
    // explicitly-undefined property values under strict SystemStyleObject typing.
    ...(isDeepLinkTarget ? { boxShadow: `0 0 0 1px ${alpha(theme.palette.primary.main, 0.35)}` } : {}),
    transition: theme.transitions.create(["box-shadow", "border-color", "background-color"], {
      duration: theme.transitions.duration.shorter,
    }),
    "&:hover": { boxShadow: theme.shadows[3] },
  });
}

export const TAB_LABEL_KEYS: Readonly<
  Record<TabKey, "tabAttendance" | "tabReports" | "tabHomework" | "tabEvaluations" | "tabProgress">
> = {
  attendance: "tabAttendance",
  reports: "tabReports",
  homework: "tabHomework",
  evaluations: "tabEvaluations",
  progress: "tabProgress",
};

export type { TabKey };
export { TAB_KEYS };
