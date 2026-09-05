/**
 * Broadcast-compose contract + pure plumbing (JSX-free).
 *
 * Owns the boundary between the compose surface's pieces:
 *  - `ComposeState` — the controlled compose draft (title/body copy plus the
 *    audience-kind selector and its companion values);
 *  - `ComposeFieldErrors` — the per-field inline error state the server's
 *    VALIDATION projection may address (whitelisted form paths only,
 *    first-wins);
 *  - the pure audience plumbing: companion readiness per kind and the wire
 *    `BroadcastAudienceInput` builder (exactly one meaningful companion per
 *    kind — absent companions ride as explicit `null` wire slots);
 *  - the label resolvers + value guards shared by the field components
 *    (runtime enums are VALUE imports — members, never raw string literals);
 *  - the VALIDATION field-error projection wrapper over the shared
 *    `mutationFieldErrors` seam (never a bespoke error renderer — each
 *    whitelisted pair carries the server-localized message verbatim).
 */

import type { Dispatch, SetStateAction } from "react";
import { type BroadcastAudienceInput, BroadcastAudienceType, UserRole } from "@/frontend/graphql/generated/gql/graphql";
import { applyProjectedFieldErrors, projectMutationFieldErrors } from "@/frontend/lib/mutationFieldErrors";
import type { AdminBroadcastsLabels } from "@/shared/locale/types/adminBroadcasts";
import type { AdminUsersLabels } from "@/shared/locale/types/adminUsers";

/** Form-bound field paths the server's VALIDATION projection may address. */
type ComposeFieldPath = "title" | "audience";

/** Per-field inline error copy keyed by the compose form's field paths. */
export type ComposeFieldErrors = Partial<Record<ComposeFieldPath, string>>;

/** The controlled compose draft (copy + audience selector + companions). */
export interface ComposeState {
  readonly title: string;
  readonly body: string;
  readonly audienceType: BroadcastAudienceType;
  readonly role: UserRole | null;
  readonly country: string;
  readonly planId: string | null;
}

/** Fresh draft: system-wide audience, empty copy, no companion selection. */
export const initialComposeState: ComposeState = {
  title: "",
  body: "",
  audienceType: BroadcastAudienceType.All,
  role: null,
  country: "",
  planId: null,
};

/** Role cohorts offered by the role select — every codegen `UserRole` member. */
export const ROLE_OPTIONS: readonly UserRole[] = [UserRole.Admin, UserRole.Teacher, UserRole.Student, UserRole.Parent];

/** The four audience kinds, in radio-group display order. */
export const AUDIENCE_KINDS: readonly BroadcastAudienceType[] = [
  BroadcastAudienceType.All,
  BroadcastAudienceType.Role,
  BroadcastAudienceType.Country,
  BroadcastAudienceType.Plan,
];

/** Plain-string membership sets backing the runtime enum guards below. */
const AUDIENCE_KIND_VALUES: ReadonlySet<string> = new Set<string>(AUDIENCE_KINDS);
const ROLE_OPTION_VALUES: ReadonlySet<string> = new Set<string>(ROLE_OPTIONS);

/** Title ceiling shared with the server's title-validation bound. */
export const TITLE_MAX_LENGTH = 255;

/** Country ceiling matching the `countryHelperText` exact-match contract. */
export const COUNTRY_MAX_LENGTH = 100;

export const ROLE_SELECT_LABEL_ID = "broadcast-compose-role-label";
export const PLAN_SELECT_LABEL_ID = "broadcast-compose-plan-label";
export const CONFIRM_DIALOG_TITLE_ID = "broadcast-compose-confirm-title";

/** Fresh compose-session idempotency key (UUID v4, transport-header carrier). */
export function randomUUID(): string {
  return crypto.randomUUID();
}

function isComposeFieldPath(field: string): field is ComposeFieldPath {
  return field === "title" || field === "audience";
}

export function isAudienceKind(value: string): value is BroadcastAudienceType {
  return AUDIENCE_KIND_VALUES.has(value);
}

export function isUserRoleValue(value: string): value is UserRole {
  return ROLE_OPTION_VALUES.has(value);
}

/** Radio-group option label for one audience kind. */
export function audienceKindLabel(kind: BroadcastAudienceType, t: AdminBroadcastsLabels): string {
  if (kind === BroadcastAudienceType.Country) return t.audienceCountry;
  if (kind === BroadcastAudienceType.Plan) return t.audiencePlan;
  if (kind === BroadcastAudienceType.Role) return t.audienceRole;
  return t.audienceAll;
}

/** Role option label for one cohort, resolved from the admin roleLabels group. */
export function roleOptionLabel(role: UserRole, roleLabels: AdminUsersLabels["roleLabels"]): string {
  if (role === UserRole.Admin) return roleLabels.admin;
  if (role === UserRole.Teacher) return roleLabels.teacher;
  if (role === UserRole.Student) return roleLabels.student;
  return roleLabels.parent;
}

/** Trimmed value — `null` when absent, so the nullable wire slot stays null. */
export function trimmedOrNullable(value: string): string | null {
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

/** Whether the selected audience kind's companion field is complete. */
export function isAudienceReady(state: ComposeState): boolean {
  if (state.audienceType === BroadcastAudienceType.Role) return state.role !== null;
  if (state.audienceType === BroadcastAudienceType.Country) return state.country.trim() !== "";
  if (state.audienceType === BroadcastAudienceType.Plan) {
    if (state.planId === null) return false;
    const parsedPlanId = Number(state.planId);
    return Number.isSafeInteger(parsedPlanId) && parsedPlanId > 0;
  }
  return true;
}

/** Wire audience selector — exactly one meaningful companion per kind. */
export function buildAudienceInput(state: ComposeState): BroadcastAudienceInput {
  return {
    type: state.audienceType,
    role: state.audienceType === BroadcastAudienceType.Role ? state.role : null,
    country: state.audienceType === BroadcastAudienceType.Country ? state.country.trim() : null,
    planId: state.audienceType === BroadcastAudienceType.Plan && state.planId !== null ? Number(state.planId) : null,
  };
}

/**
 * Server-tier VALIDATION projection: feeds the failure's whitelisted
 * `extensions.fields[]` pairs through the shared mapping into the compose
 * field-error state and reports whether ANY pair was applied. Per-field
 * mapping wins only when a fields[] payload is present; broadcast domain
 * rejections (localized codes without one) fall through to the global
 * fallback copy.
 */
export function applyBroadcastFieldErrors(
  mutationError: unknown,
  setFieldErrors: Dispatch<SetStateAction<ComposeFieldErrors>>
): boolean {
  const projected = projectMutationFieldErrors(mutationError);
  const applied = applyProjectedFieldErrors(projected, isComposeFieldPath, (field, errorOptions) => {
    setFieldErrors(current => ({ ...current, [field]: errorOptions.message }));
  });
  return applied > 0;
}
