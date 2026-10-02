/**
 * Forced-reset operation gate — THE server-authoritative fence for callers
 * whose account requires a password change before anything else.
 *
 * Enforcement point: an Apollo Server plugin registered beside the error
 * finalizer in `createApolloServer`'s plugins array. The gate runs at
 * `requestDidStart → didResolveOperation` — AFTER parse/validation, BEFORE
 * any resolver — so a denied operation never executes and produces zero
 * writes, zero audit rows, and zero field-level errors.
 *
 * Identity source: `ctx.user.mustChangePassword`, the DB-backed user row the
 * context factory refreshes on EVERY request (`UserRepository.findById`).
 * The gate deliberately reads NO token claim — an admin-set forced-reset
 * flag takes effect on the very next request, without waiting for token
 * expiry. Anonymous callers (`ctx.user === null`) are a strict no-op here:
 * the per-field scope layer already denies them.
 *
 * Exemption model: a CLOSED allowlist of root field names (the self-service
 * escape hatches + the public auth operations). The allowlist is
 * per-OPERATION: if ANY root field of the operation is non-exempt, the whole
 * operation is denied — a caller can never smuggle a gated field in beside
 * an exempt one, nor reach one through a root-level fragment spread (the
 * root-field extraction flattens inline fragments and fragment spreads, so
 * every field the operation can execute is inspected).
 *
 * Denial shape: a `ForbiddenError`-family carrier with the stable domain
 * code `PASSWORD_CHANGE_REQUIRED` and the localized
 * `errorsTranslations.passwordChangeRequired` message. The wire carries the
 * CODE only — never the requested field name, the operation name, or any
 * other trigger detail — so the denial is constant and cannot be used as a
 * field-discovery oracle. The denial logs exactly once via the boundary
 * finalizer's domain-rejection observer (this plugin logs nothing itself).
 *
 * Structural seam: {@link isPasswordChangeRequired} and
 * {@link isExemptRootField} are pure predicates and
 * {@link extractOperationRootFieldNames} is a pure AST walk — the whole
 * branch logic is unit-testable without Apollo.
 */

import type {
  ApolloServerPlugin,
  GraphQLRequestContextDidResolveOperation,
  GraphQLRequestListener,
} from "@apollo/server";
import type { DocumentNode, OperationDefinitionNode, SelectionNode } from "graphql";
import type { Context } from "@/backend/graphql/gqlContextFactory";
import { ForbiddenError } from "@/backend/lib/errors";
import { getServerTranslations } from "@/shared/locale/server-graphql";

// ─── Closed exemption allowlist ──────────────────────────────────────────────

/**
 * The CLOSED set of root field names still callable while the caller is
 * flagged for a password change:
 *
 *  - `me`            — session restore (the client shell resolves the flag itself);
 *  - `changeMyPassword` — the ONLY operation that clears the flag;
 *  - `logout`        — cookie clear (sign-out must stay reachable);
 *  - `updateMyLocale` — shell-locale preference (chrome for the fence page);
 *  - `login`         — public auth entry;
 *  - `registerUser`  — public registration;
 *  - `refreshToken`  — session recovery.
 *
 * Adding a member is a security-posture decision: every addition is a field
 * a flagged caller may execute. Gated admin mutations are deliberately NOT
 * exempt — a flagged user is denied like every other gated field.
 */
export const PASSWORD_CHANGE_EXEMPT_ROOT_FIELDS: readonly string[] = Object.freeze([
  "me",
  "changeMyPassword",
  "logout",
  "updateMyLocale",
  "login",
  "registerUser",
  "refreshToken",
]);

const EXEMPT_ROOT_FIELD_LOOKUP: ReadonlySet<string> = new Set(PASSWORD_CHANGE_EXEMPT_ROOT_FIELDS);

/**
 * Allowlist membership predicate — true only for the exact exempt root field
 * names. Case-sensitive and closed: casing variants, suffixes, and unknown
 * names all fall outside the allowlist and are therefore gated.
 */
export function isExemptRootField(fieldName: string): boolean {
  return EXEMPT_ROOT_FIELD_LOOKUP.has(fieldName);
}

// ─── Root-field extraction (pure AST walk) ───────────────────────────────────

/**
 * Collects every field name the operation can execute at the root level,
 * flattening inline fragments and fragment spreads so a gated field cannot
 * hide behind `query { ...SomeRootFields }`. Fragment definitions come from
 * the same request document; spreads are visited once (cycle-guarded) and
 * unknown names are skipped (GraphQL validation already rejects them).
 *
 * The returned set is de-duplicated: membership — not multiplicity — drives
 * the deny decision.
 */
export function extractOperationRootFieldNames(
  operation: OperationDefinitionNode | null | undefined,
  document: DocumentNode | null | undefined
): ReadonlySet<string> {
  const names = new Set<string>();
  if (operation === null || operation === undefined) {
    return names;
  }

  const fragmentBodies = new Map<string, readonly SelectionNode[]>();
  if (document !== null && document !== undefined) {
    for (const definition of document.definitions) {
      if (definition.kind === "FragmentDefinition") {
        fragmentBodies.set(definition.name.value, definition.selectionSet.selections);
      }
    }
  }

  const visitedSpreads = new Set<string>();
  const visitSelections = (selections: readonly SelectionNode[]): void => {
    for (const selection of selections) {
      if (selection.kind === "Field") {
        names.add(selection.name.value);
      } else if (selection.kind === "InlineFragment") {
        visitSelections(selection.selectionSet.selections);
      } else if (selection.kind === "FragmentSpread") {
        const spreadName = selection.name.value;
        if (visitedSpreads.has(spreadName)) {
          continue;
        }
        visitedSpreads.add(spreadName);
        const body = fragmentBodies.get(spreadName);
        if (body !== undefined) {
          visitSelections(body);
        }
      }
    }
  };

  visitSelections(operation.selectionSet.selections);
  return names;
}

// ─── Deny predicate ──────────────────────────────────────────────────────────

/** Minimal structural identity the gate reads from the request context. */
export interface PasswordChangeGateIdentity {
  /** The DB-backed forced-reset flag on the caller's user row. */
  readonly mustChangePassword?: boolean;
}

/**
 * The single deny decision of the gate — pure and total:
 *
 *  - anonymous identity (`null`/`undefined`) → no-op (the scope layer owns
 *    the anonymous denial, per-field);
 *  - an identity NOT carrying `mustChangePassword === true` → strict no-op
 *    (zero behavior change for every existing un-flagged caller);
 *  - a flagged identity → deny when ANY observed root field is non-exempt
 *    (the allowlist is per-operation, not per-field-AND).
 */
export function isPasswordChangeRequired(
  user: PasswordChangeGateIdentity | null | undefined,
  rootFieldNames: ReadonlySet<string>
): boolean {
  if (user === null || user === undefined) {
    return false;
  }
  if (user.mustChangePassword !== true) {
    return false;
  }
  for (const fieldName of rootFieldNames) {
    if (!isExemptRootField(fieldName)) {
      return true;
    }
  }
  return false;
}

// ─── Denial carrier ──────────────────────────────────────────────────────────

/**
 * Builds the forced-reset denial: ForbiddenError transport family (403
 * semantics — the caller is authenticated but fenced) carrying the stable
 * `PASSWORD_CHANGE_REQUIRED` domain code, mirroring the typed-variant
 * pattern the ConflictError hierarchy uses for its specific codes. The
 * shared ForbiddenError constructor stamps its constant family code, so the
 * local carrier re-declares the `code` property (read FIRST by the boundary
 * finalizer's pass-through) and re-stamps `extensions.code` to keep every
 * surface consistent.
 *
 * The denial is thrown from `didResolveOperation` — OUTSIDE resolver
 * execution. Without an explicit `extensions.http` head Apollo would default
 * the whole response to 500, breaking the route's "domain denials ride HTTP
 * 200 with an `errors[]` payload" convention; the explicit head keeps the
 * denial on the same 200 channel every other DomainError uses, and Apollo
 * consumes the `http` key into the response status (it never reaches the
 * wire item).
 *
 * Exported as the gate's structural seam so the denial contract (family,
 * code, 200 channel, zero trigger-detail leak) is testable without Apollo.
 */
class PasswordChangeRequiredDenial extends ForbiddenError {
  /** The base hierarchy stamps its family code via a ctor param property; the re-declaration carries the specific forced-reset code. */
  override readonly code = "PASSWORD_CHANGE_REQUIRED";

  constructor(message: string) {
    super(message, { extensions: { http: { status: 200 } } });
    // The base ctor stamped the family code into extensions — re-stamp so
    // the structured extensions agree with the re-declared `code` property.
    this.extensions.code = "PASSWORD_CHANGE_REQUIRED";
  }
}

export function buildPasswordChangeRequiredDenial(localizedMessage: string): ForbiddenError {
  return new PasswordChangeRequiredDenial(localizedMessage);
}

// ─── Apollo plugin wrapper ───────────────────────────────────────────────────

/**
 * Builds the Apollo Server plugin. Locale and identity come from
 * `requestContext.contextValue` (the `Context` built once per request) — the
 * plugin resolves the localized message through the SAME per-request
 * translation seam the error finalizer uses
 * (`getServerTranslations(ctx.locale)`), never a boot-time locale.
 */
export function createPasswordChangeGatePlugin(): ApolloServerPlugin<Context> {
  return {
    async requestDidStart(): Promise<GraphQLRequestListener<Context>> {
      return {
        async didResolveOperation(requestContext: GraphQLRequestContextDidResolveOperation<Context>): Promise<void> {
          const rootFieldNames = extractOperationRootFieldNames(requestContext.operation, requestContext.document);
          if (!isPasswordChangeRequired(requestContext.contextValue.user, rootFieldNames)) {
            return;
          }
          const tErrors = getServerTranslations(requestContext.contextValue.locale).errorsTranslations;
          throw buildPasswordChangeRequiredDenial(tErrors.passwordChangeRequired);
        },
      };
    },
  };
}
