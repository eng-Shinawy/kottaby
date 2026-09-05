import type { FindStudentByHandshakeCodeQuery_findStudentByHandshakeCode } from "@/frontend/graphql/generated/gql/graphql";
import { extractErrorCode } from "@/frontend/lib/graphql-error-utils";

/** The derived outcome of the gated query — exactly one kind per render. */
export type HandshakeResultState =
  | { readonly kind: "idle" }
  | { readonly kind: "validation" }
  | { readonly kind: "generic-error" }
  | { readonly kind: "searching" }
  | { readonly kind: "not-found" }
  | { readonly kind: "found"; readonly maskedName: string; readonly linkable: boolean };

export interface DeriveHandshakeResultStateInputs {
  readonly validatedCode: string | null;
  readonly loading: boolean;
  readonly error: unknown;
  readonly data:
    | { readonly findStudentByHandshakeCode: FindStudentByHandshakeCodeQuery_findStudentByHandshakeCode | null }
    | undefined;
}

/**
 * Pure derivation of the outcome state — error states outrank data states,
 * and every settled miss (unknown code, governance-excluded student) lands
 * on the SAME not-found channel.
 */
export function deriveHandshakeResultState(inputs: Readonly<DeriveHandshakeResultStateInputs>): HandshakeResultState {
  if (inputs.validatedCode === null) {
    return { kind: "idle" };
  }
  if (inputs.error !== undefined) {
    return extractErrorCode(inputs.error) === "VALIDATION" ? { kind: "validation" } : { kind: "generic-error" };
  }
  if (inputs.loading) {
    return { kind: "searching" };
  }
  const lookup = inputs.data?.findStudentByHandshakeCode;
  if (lookup == null) {
    return { kind: "not-found" };
  }
  return { kind: "found", maskedName: lookup.maskedName, linkable: lookup.linkable };
}
