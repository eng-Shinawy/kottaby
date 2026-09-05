/**
 * Parent-child link request mutations — request / respond / cancel.
 *
 * Contract:
 *  - `requestParentChildLink(code: String!): OutgoingParentLinkRequest`
 *      NULLABLE payload (the null-collapse contract): a valid-format code
 *      matching no eligible student, and a governance-excluded child, BOTH
 *      answer `null` through one indistinguishable channel (never an
 *      error) — the resolver maps the service's `null` through verbatim.
 *      A malformed code rejects with the localized `ValidationError`
 *      (VALIDATION) BEFORE any database read (service-internal, pre-DB).
 *  - `respondToParentLinkRequest(requestId: ID!, accept: Boolean!):
 *      IncomingParentLinkRequest!` — the deciding student accepts/rejects
 *      exactly one own incoming request; a foreign and a nonexistent id are
 *      INDISTINGUISHABLE (`PARENT_LINK_REQUEST_NOT_FOUND`, no existence
 *      oracle — the `markNotificationRead` precedent).
 *  - `cancelParentLinkRequest(requestId: ID!): OutgoingParentLinkRequest!`
 *      — the requesting parent withdraws (silent fold to `rejected`, zero
 *      notifications, same no-oracle id channel).
 *
 * Scope semantics — every field carries the EXPLICIT `$all` conjunction
 * (the proven pattern at `students/handshake-code.query.ts`):
 *  - Anonymous callers hit the `authenticated` scope's UnauthorizedError
 *    throw (extensions.code UNAUTHORIZED / 401 — explicit scope throws pass
 *    through builder.ts's unauthorizedError mapping VERBATIM);
 *    authenticated callers with a wrong role (including the sibling role on
 *    each field, teacher, and admin) fail the `role` scope into the
 *    canonical localized ForbiddenError (FORBIDDEN / 403). A plain scope
 *    map would combine with ANY semantics and leak access — the
 *    conjunction is load-bearing.
 *  - NO admin/supervisor override exists on any field: link requests are a
 *    user-to-user handshake (governance reads live on DEV3-016 surfaces
 *    ONLY; zero `audit_logs` rows by design).
 *
 * Thin-resolver discipline:
 *  - Bodies delegate to `ParentLinkRequestService` with `ctx.user.id` +
 *    `ctx.locale` — no business logic, no repository imports. Identity is
 *    derived EXCLUSIVELY from the verified context; NO field accepts an
 *    identity argument of any kind (BOLA probes die as GraphQL validation
 *    failures before a resolver ever runs).
 *  - ID-channel discipline for the two `requestId` arguments: the GraphQL
 *    ID arrives as a string or a number, so `parseLinkRequestIdArg`
 *    (canonical positive-integer wire form + `isPositiveSafeInt` — never an
 *    `as number` narrowing) reduces it to a number, and the shared
 *    module-private `requireVerifiedRequestId` guard rejects a malformed
 *    shape with the localized generic ValidationError BEFORE any service
 *    call (pre-DB) — `"12abc"` can never silently address row 12; `"0"`,
 *    `"-1"`, `"1.5"`, non-ASCII digit spellings, and out-of-range
 *    magnitudes all fail the same gate. The service re-validates the same
 *    bound as defense-in-depth.
 *  - `ctx.locale` propagates on every call so localized errors resolve
 *    through the service's translation seam.
 *
 * DomainErrors thrown deeper (the service classifier's constant-shape
 * denials) propagate uncaught to the masking boundary — NO try/catch here
 * by contract. All imports are top-level STATIC imports (Bun ESM rule).
 *
 * Per `backend/graphql/mutation/AGENTS.md`:
 *  - This file has NO named exports — the root fields register at import
 *    time via `gqlSchemaBuilder.mutationField(...)`.
 *  - Wired through side-effect barrels:
 *    `mutation/parents/index.ts` → `mutation/index.ts` → `gqlSchema.ts`.
 */

import { UserRole } from "@/backend/enum/users/user-role.enum";
import type { Context } from "@/backend/graphql/gqlContextFactory";
import { gqlSchemaBuilder } from "@/backend/graphql/pothos/builder";
import {
  IncomingParentLinkRequestPothosObject,
  OutgoingParentLinkRequestPothosObject,
} from "@/backend/graphql/pothos/parents/parent-link-request.pothos";
import { UnauthorizedError, ValidationError } from "@/backend/lib/errors";
import { ParentLinkRequestService } from "@/backend/services";
import { isPositiveSafeInt } from "@/backend/services/notifications/emit-validation";

/**
 * Wire-form guard for the `requestId` argument: the canonical decimal
 * representation of a positive integer (ASCII digits only — no sign,
 * exponent, decimal point, leading zeros, surrounding whitespace, or
 * trailing garbage). Mirrors the `markNotificationRead` precedent
 * (`../notifications/notification.mutation.ts`).
 */
const CANONICAL_POSITIVE_INT_ID = /^[1-9]\d*$/;

/** The value that FAILS the positive-safe-int gate below. */
const INVALID_PARENT_LINK_REQUEST_ID = Number.NaN;

/**
 * Parses the `requestId` argument into its numeric form through the
 * positive-safe-int guard (never an `as number` narrowing).
 *
 * The GraphQL ID arrives as a string or a number (Pothos models both input
 * coercions): a number passes straight through `isPositiveSafeInt`; a
 * string must be the canonical positive-integer form and parse into the
 * safe range. Every other shape — hostile strings like `"12abc"`, `"1.5"`,
 * `"1e3"`, non-ASCII digit spellings, or out-of-range magnitudes — yields
 * NaN, the value the gate below rejects.
 */
function parseLinkRequestIdArg(rawId: string | number): number {
  if (typeof rawId === "number") {
    return isPositiveSafeInt(rawId) ? rawId : INVALID_PARENT_LINK_REQUEST_ID;
  }
  if (!CANONICAL_POSITIVE_INT_ID.test(rawId)) {
    return INVALID_PARENT_LINK_REQUEST_ID;
  }
  const parsed = Number.parseInt(rawId, 10);
  return isPositiveSafeInt(parsed) ? parsed : INVALID_PARENT_LINK_REQUEST_ID;
}

/**
 * Shared pre-service guard for the two `requestId`-taking mutations — one
 * construction site each for the localized `unauthorized` narrowing denial
 * and the localized `validation` id-wire denial (kept out of the resolver
 * bodies to honor the single-denial-site discipline AND the intra-file
 * clone budget; the `$all` scopes above remain the load-bearing gate, this
 * exists purely for TypeScript narrowing + the pre-DB parse).
 *
 * The `$all { authenticated: true }` scope guarantees a verified user row
 * at resolution time (anonymous callers never get past the scope step), so
 * the `!ctx.user` branch is unreachable in practice — the repo-wide
 * no-non-null-assertion rule just forbids dereferencing the nullable
 * context directly. Per the resolver-i18n rule the message flows through
 * `ctx.t` (its en copy is identical to builder.ts's `authenticated` scope
 * literal).
 *
 * Returns the verified caller id and the parsed request id; a malformed id
 * wire form throws the localized generic ValidationError BEFORE any
 * service call (pre-DB).
 */
async function requireVerifiedRequestId(
  ctx: Context,
  rawId: string | number
): Promise<{ callerId: number; requestId: number }> {
  if (!ctx.user) {
    const tErrors = await ctx.t("errorsTranslations");
    throw new UnauthorizedError(tErrors.unauthorized);
  }
  const requestId = parseLinkRequestIdArg(rawId);
  if (!isPositiveSafeInt(requestId)) {
    const tErrors = await ctx.t("errorsTranslations");
    throw new ValidationError(tErrors.validation);
  }
  return { callerId: ctx.user.id, requestId };
}

// Side-effect: register the `requestParentChildLink` mutation field.
gqlSchemaBuilder.mutationField("requestParentChildLink", t =>
  t.field({
    // NULLABLE on purpose (null collapse): a well-formed code that matches no
    // eligible student — and a governed child — collapse to `null`, never
    // an error (no existence oracle on the discovery path).
    type: OutgoingParentLinkRequestPothosObject,
    nullable: true,
    args: {
      code: t.arg({ type: "String", required: true }),
    },
    description:
      "Submits a parent-child link request for the student owning the handshake code. A valid-format code matching no eligible student answers null (missing and governance-excluded are indistinguishable); already-linked and already-pending targets surface their dedicated conflicts.",
    authScopes: {
      $all: {
        authenticated: true,
        role: [UserRole.Parent],
      },
    },
    resolve: async (_root, args, ctx) => {
      // No requestId on this field — only the context-narrowing guard
      // applies (see `requireVerifiedRequestId` for the rationale).
      if (!ctx.user) {
        const tErrors = await ctx.t("errorsTranslations");
        throw new UnauthorizedError(tErrors.unauthorized);
      }
      return ParentLinkRequestService.requestLink(args.code, ctx.user.id, ctx.locale);
    },
  })
);

// Side-effect: register the `respondToParentLinkRequest` mutation field.
gqlSchemaBuilder.mutationField("respondToParentLinkRequest", t =>
  t.field({
    type: IncomingParentLinkRequestPothosObject,
    args: {
      requestId: t.arg({ type: "ID", required: true }),
      accept: t.arg({ type: "Boolean", required: true }),
    },
    description:
      "Accepts or rejects exactly one of the caller's own pending link requests (one-directional claim). A foreign or nonexistent id is indistinguishable — PARENT_LINK_REQUEST_NOT_FOUND with no existence oracle; already-resolved and expired requests surface their dedicated conflicts.",
    authScopes: {
      $all: {
        authenticated: true,
        role: [UserRole.Student],
      },
    },
    resolve: async (_root, args, ctx) => {
      // Shared guard + pre-DB id gate; the accept flag forwards verbatim.
      const { callerId, requestId } = await requireVerifiedRequestId(ctx, args.requestId);
      return ParentLinkRequestService.respondToLinkRequest(requestId, args.accept, callerId, ctx.locale);
    },
  })
);

// Side-effect: register the `cancelParentLinkRequest` mutation field.
gqlSchemaBuilder.mutationField("cancelParentLinkRequest", t =>
  t.field({
    type: OutgoingParentLinkRequestPothosObject,
    args: {
      requestId: t.arg({ type: "ID", required: true }),
    },
    description:
      "Withdraws exactly one of the caller's own pending link requests (silent fold — zero notifications). A foreign or nonexistent id is indistinguishable — PARENT_LINK_REQUEST_NOT_FOUND with no existence oracle.",
    authScopes: {
      $all: {
        authenticated: true,
        role: [UserRole.Parent],
      },
    },
    resolve: async (_root, args, ctx) => {
      // Same shared guard + pre-DB id gate as respondToParentLinkRequest.
      const { callerId, requestId } = await requireVerifiedRequestId(ctx, args.requestId);
      return ParentLinkRequestService.cancelLinkRequest(requestId, callerId, ctx.locale);
    },
  })
);
