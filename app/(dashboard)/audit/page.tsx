import type { Metadata } from "next";
import { UserRole } from "@/backend/enum/users/user-role.enum";
import { AuditActionType } from "@/frontend/graphql/generated/gql/graphql";
import { withPageAuth } from "@/frontend/lib/auth/withPageAuth";
import { type AuditTrailFiltersSeed, AuditTrailView } from "@/frontend/views/admin/audit/AuditTrailView";
import { parseIdInput, parseUtcDayStart } from "@/frontend/views/admin/audit/audit-trail-filters";
import { getTranslations } from "@/shared/locale/server";
import { getLocaleFromCookie } from "@/shared/locale/server-cookies";

/**
 * `/audit` — the admin audit-trail surface.
 *
 * Server Component anatomy:
 *  1. `withPageAuth({ roles: [UserRole.Admin], redirectTo: "/audit" })` —
 *     the caller must be an admin. Anonymous callers are redirected to
 *     `/login?redirect=/audit`; a mismatched role is redirected to its own
 *     role dashboard (never bare `/dashboard`).
 *  2. The `?entityType=&entityId=` deep-link pair (plus the optional
 *     `actionType`, `actorId`, `from`, `to` params) is SANITIZED before it
 *     reaches the client: every value is validated independently and an
 *     invalid value is silently dropped, so a hostile or malformed query
 *     string degrades to a partially filtered — or unfiltered — listing
 *     instead of an error. The surviving values are handed to the client
 *     container as the `initialFilters` seed; the view owns all later
 *     filter edits.
 *  3. `AuditTrailView` is a client component (Apollo `useQuery` listing);
 *     it is imported directly from the view module — no barrel hop.
 *
 * Metadata rides the active locale cookie through the shared
 * `getTranslations(locale)` property chain.
 */

/** Longest accepted entity-type filter value, measured after trimming. */
const ENTITY_TYPE_MAX_LENGTH = 100;

/** Lowest accepted id filter value — ids are positive safe integers. */
const MIN_ID = 1;

/** Highest accepted id filter value — the GraphQL `Int` wire max (2^31 - 1). */
const MAX_ID = 2147483647;

/** Canonical generated action-type vocabulary, as plain strings for the guard. */
const ACTION_TYPE_VALUES: readonly string[] = Object.values(AuditActionType);

/** Async search params of the dashboard zone pages (Next.js shape). */
type AuditTrailPageSearchParams = Record<string, string | string[] | undefined>;

/** Type guard: `true` only for an exact generated action-type enum member. */
function isAuditActionType(value: string): value is AuditActionType {
  return ACTION_TYPE_VALUES.includes(value);
}

/** First value of a possibly repeated search param, or undefined when absent. */
function firstValueOf(params: AuditTrailPageSearchParams, key: string): string | undefined {
  const value = params[key];
  return Array.isArray(value) ? value[0] : value;
}

/** Entity-type filter: trimmed, non-empty, and at most 100 characters. */
function sanitizeEntityTypeParam(raw: string | undefined): string | undefined {
  if (raw === undefined) return undefined;
  const trimmed = raw.trim();
  return trimmed.length > 0 && trimmed.length <= ENTITY_TYPE_MAX_LENGTH ? trimmed : undefined;
}

/** Id filters (actor/entity): positive integers within the GraphQL `Int` wire range only. */
function sanitizeIdParam(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  const parsed = parseIdInput(raw);
  // Above the wire max an id can never survive variable coercion, so it is
  // dropped here — the same silent-drop posture as any other invalid value.
  return parsed !== null && parsed >= MIN_ID && parsed <= MAX_ID ? parsed : undefined;
}

/** Action-type filter: an exact generated enum member, fail-closed. */
function sanitizeActionTypeParam(raw: string | undefined): AuditActionType | undefined {
  if (raw === undefined || !isAuditActionType(raw)) return undefined;
  return raw;
}

/**
 * Day-range filters: each bound must parse as a real `YYYY-MM-DD` calendar
 * day (the date-input wire format the view consumes; impossible dates such
 * as `2026-02-30` never roll over silently). A bound present without its
 * pair stays a one-sided window. Zero-padded ISO days order chronologically
 * as plain strings, so an inverted range (start after end) — which could
 * only produce an empty query window — is dropped as a whole, while a
 * same-day pair survives: the view expands the inclusive end day to the
 * following midnight, selecting exactly that single day.
 */
function sanitizeDayRange(
  fromRaw: string | undefined,
  toRaw: string | undefined
): Pick<AuditTrailFiltersSeed, "from" | "to"> {
  const from = fromRaw !== undefined && parseUtcDayStart(fromRaw) !== null ? fromRaw : undefined;
  const to = toRaw !== undefined && parseUtcDayStart(toRaw) !== null ? toRaw : undefined;
  if (from !== undefined && to !== undefined && from > to) return {};
  return { from, to };
}

/**
 * Sanitizes the deep-link filter seed. Returns undefined when no filter
 * value survives, which renders the unfiltered first page.
 */
function sanitizeInitialFilters(params: AuditTrailPageSearchParams): AuditTrailFiltersSeed | undefined {
  const range = sanitizeDayRange(firstValueOf(params, "from"), firstValueOf(params, "to"));
  const initialFilters: AuditTrailFiltersSeed = {
    actionType: sanitizeActionTypeParam(firstValueOf(params, "actionType")),
    actorId: sanitizeIdParam(firstValueOf(params, "actorId")),
    entityId: sanitizeIdParam(firstValueOf(params, "entityId")),
    entityType: sanitizeEntityTypeParam(firstValueOf(params, "entityType")),
    from: range.from,
    to: range.to,
  };
  const hasAnyFilter = Object.values(initialFilters).some(value => value !== undefined);
  return hasAnyFilter ? initialFilters : undefined;
}

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocaleFromCookie();
  const t = getTranslations(locale).adminUsersTranslations;
  return {
    title: t.auditTrail.pageTitle,
    description: t.auditTrail.pageSubtitle,
  };
}

interface AuditTrailPageProps {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function AuditTrailPage({ searchParams }: AuditTrailPageProps) {
  await withPageAuth({ roles: [UserRole.Admin], redirectTo: "/audit" });
  const initialFilters = sanitizeInitialFilters(await searchParams);
  return <AuditTrailView initialFilters={initialFilters} />;
}
