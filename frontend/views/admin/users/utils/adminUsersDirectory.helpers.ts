"use client";

/**
 * Pure helpers for the admin user-directory surfaces (no JSX, no component
 * exports — safe to export non-component values from here without tripping
 * `react-refresh/only-export-components`).
 *
 * Centralizes the role/governance narrowing and the tonal-palette mapping so
 * the desktop table and the mobile card list render identical semantics:
 *  - `asDirectoryRole` narrows the codegen `role` string to the admin-surface
 *    role union (same runtime check the pre-refactor container used).
 *  - `directoryGovernanceOf` derives the governance headline from the
 *    boolean triple (`isDeleted` > `isBlocked` > `suspended` > active), the
 *    same priority the legacy `StatusChip` used.
 *  - Tone keys (`roleToneKey` / `governanceToneKey`) decouple the *semantic*
 *    mapping from the *token* lookup, which lives in `DirectoryRowCells` as
 *    theme-callback sx (the M3 container/`on<Color>Container` pairs).
 *  - `formatDirectoryRelativeTime` renders `lastActiveAt` as localized
 *    relative copy, delegating to the platform's shared relative-time
 *    module (`frontend/lib/i18n/relative-time.ts`) with the em-dash
 *    fallback kept local.
 */

import { formatUnboundedRelativeTime } from "@/frontend/lib/i18n/relative-time";
import type { AdminSurfaceRole } from "@/frontend/views/admin/users/ui";
import type { AppLocale } from "@/shared/locale";

/** Role literal union used by the directory filters and row chips. */
export type DirectoryRole = AdminSurfaceRole;

/** Governance headline buckets derived from the boolean governance triple. */
export type DirectoryGovernance = "Active" | "Suspended" | "Blocked" | "Deleted";

/** Tonal palette lanes the row chips/pills paint from. */
export type DirectoryTone = "error" | "secondary" | "primary" | "neutral" | "success" | "warning";

/** Minimal governance shape derived fields need from a list item. */
export interface DirectoryGovernanceFlags {
  readonly isDeleted?: boolean | null;
  readonly isBlocked?: boolean | null;
  readonly suspended?: boolean | null;
}

/**
 * Runtime narrowing of the codegen `role` string to the admin-surface role
 * union. The codegen emits `UserRole` as a string enum, so the value-level
 * comparison narrows it exhaustively; the fallback covers any future backend
 * value the codegen has not learned about yet (renders as a neutral chip).
 */
export function asDirectoryRole(value: string | null | undefined): DirectoryRole {
  if (value === "Admin" || value === "Teacher" || value === "Student" || value === "Parent") {
    return value;
  }
  return "Student";
}

/**
 * Role → tonal palette key. Mirrors `rolePaletteKey` in `AdminUserAvatar`
 * (kept private there on purpose) so the avatar tint and the role chip tint
 * always agree; parent/default rows take the neutral container lane.
 */
export function roleToneKey(role: DirectoryRole): "error" | "secondary" | "primary" | "neutral" {
  if (role === "Admin") return "error";
  if (role === "Teacher") return "secondary";
  if (role === "Student") return "primary";
  return "neutral";
}

/**
 * Governance headline from the boolean triple. Priority order matches the
 * legacy `StatusChip`: deleted outranks blocked, blocked outranks suspended.
 */
export function directoryGovernanceOf(user: DirectoryGovernanceFlags): DirectoryGovernance {
  if (user.isDeleted) return "Deleted";
  if (user.isBlocked) return "Blocked";
  if (user.suspended) return "Suspended";
  return "Active";
}

/** Governance headline → tonal lane for the pill/dot pair. */
export function governanceToneKey(governance: DirectoryGovernance): "success" | "warning" | "error" {
  if (governance === "Active") return "success";
  if (governance === "Suspended") return "warning";
  return "error";
}

/** Localized governance label from the `statusBadges` block. */
export function governanceLabel(
  governance: DirectoryGovernance,
  badges: { readonly active: string; readonly suspended: string; readonly blocked: string; readonly deleted: string }
): string {
  if (governance === "Active") return badges.active;
  if (governance === "Suspended") return badges.suspended;
  if (governance === "Blocked") return badges.blocked;
  return badges.deleted;
}

/**
 * Localized relative-time rendering of an ISO-8601 server timestamp
 * (`lastActiveAt`). Returns the em-dash for missing/unparseable input so
 * both directory surfaces share one fallback. `numeric: "auto"` gives the
 * "yesterday"-style words where the locale has them.
 *
 * The ladder itself lives in the platform's ONE relative-time module
 * (`frontend/lib/i18n/relative-time.ts`) — this wrapper delegates with an
 * UNBOUNDED window (the `lastActiveAt` stamp renders relatively at any
 * age, future instants included) and keeps the em-dash fallback local.
 */
export function formatDirectoryRelativeTime(raw: string | null | undefined, locale: AppLocale): string {
  if (!raw) return "—";
  return formatUnboundedRelativeTime(raw, locale) ?? "—";
}

/**
 * Stable skeleton keys for the loading state (table rows and mobile cards).
 * Hard-coded identifiers (not array indices) keep React reconciliation
 * stable and satisfy `react/no-array-index-key`; no state lives on a
 * skeleton row, so identity is unambiguous.
 */
export const DIRECTORY_SKELETON_KEYS = [
  "skeleton-1",
  "skeleton-2",
  "skeleton-3",
  "skeleton-4",
  "skeleton-5",
  "skeleton-6",
  "skeleton-7",
  "skeleton-8",
] as const;
