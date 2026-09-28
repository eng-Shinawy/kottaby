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

import { ApplicantCooldownState } from "@/frontend/graphql/generated/gql/graphql";
import { formatApplicantDate } from "@/frontend/lib/i18n/format-date";
import { formatUnboundedRelativeTime } from "@/frontend/lib/i18n/relative-time";
import type { AdminSurfaceRole } from "@/frontend/views/admin/users/ui";
import type { AppLocale } from "@/shared/locale";

/** Role literal union used by the directory filters and row chips. */
export type DirectoryRole = AdminSurfaceRole;

/** Governance headline buckets derived from the boolean governance triple. */
export type DirectoryGovernance = "Active" | "Suspended" | "Blocked" | "Deleted";

/**
 * Applicant-lifecycle filter draft unions — the directory's draft
 * vocabulary for the two lifecycle filters. The members mirror the
 * codegen enum KEY/wire names (`ApplicantStatus` / `ApplicantCooldownState`)
 * verbatim; the exhaustive-switch conversions in `directoryConversions.ts`
 * map them onto the generated enums without a cast. `DirectoryCooldownState`
 * carries `None` because the wire enum has it — filtering `None` narrows to
 * applicants with no cooldown stamped (non-applicant rows carry a null wire
 * state and never match any arm, mirroring the backend filter contract).
 */
export type DirectoryApplicantStatus = "Pending" | "InEvaluation" | "Failed" | "Passed";

export type DirectoryCooldownState = "None" | "Active" | "Expired";

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

/** Chip descriptor the cooldown slot of the directory status cell paints. */
export interface DirectoryCooldownChip {
  /** Active → warning lane (re-purchase blocked); expired → neutral lane. */
  readonly tone: "warning" | "neutral";
  /** Localized chip label from the `directoryChips` block. */
  readonly label: string;
  /** Localized absolute instant for the chip's native `title` tooltip. */
  readonly tooltip: string | null;
}

/** Minimal cooldown-observable slice a list item carries for the helper. */
export interface DirectoryCooldownObservables {
  readonly cooldownState?: ApplicantCooldownState | null;
  readonly cooldownUntil?: string | null;
}

/** Label slices the cooldown helper needs from the `directoryChips` block. */
export interface DirectoryCooldownChipLabels {
  readonly cooldownActive: string;
  readonly cooldownExpired: string;
}

/**
 * Directory cooldown chip from a row's read-time cooldown observables.
 *
 * Semantics (deliberate design decision — the directory surfaces the
 * cooldown STATE, not the raw date, to stay scannable):
 *  - `Active`  → warning-lane chip (the applicant cannot re-purchase
 *    verification while it runs);
 *  - `Expired` → neutral-lane chip (informational — the applicant may
 *    re-purchase; the expired state is context, not an alarm);
 *  - `None`/null (non-applicants and applicants without a cooldown row)
 *    → `null` — the caller renders its existing status content instead,
 *    so no noise is added to the quiet rows.
 *
 * The label vocabulary mirrors the detail page's
 * `detail.applicantCooldownState` block verbatim (one concept, identical
 * copy on both surfaces). The tooltip carries the FULL absolute instant
 * (same deterministic formatter the relative-time cell uses) so the exact
 * "until when" answer stays one hover away without widening the column.
 */
export function directoryCooldownChipOf(
  user: DirectoryCooldownObservables,
  labels: DirectoryCooldownChipLabels,
  locale: AppLocale
): DirectoryCooldownChip | null {
  if (user.cooldownState === ApplicantCooldownState.Active) {
    return {
      tone: "warning",
      label: labels.cooldownActive,
      tooltip: user.cooldownUntil ? formatApplicantDate(user.cooldownUntil, locale) : null,
    };
  }
  if (user.cooldownState === ApplicantCooldownState.Expired) {
    return {
      tone: "neutral",
      label: labels.cooldownExpired,
      tooltip: user.cooldownUntil ? formatApplicantDate(user.cooldownUntil, locale) : null,
    };
  }
  return null;
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
