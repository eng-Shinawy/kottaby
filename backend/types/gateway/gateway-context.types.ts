/**
 * Gateway transport-guard contract types.
 *
 * Layer rules:
 *  - Types ONLY. Zero runtime exports (statically enforced by the gateway
 *    assertion suite).
 *  - `TransportErrorKind` is a TypeScript string union, NEVER a DB/
 *    Drizzle/Pothos enum — transport metadata is not a persisted value.
 *  - Every property is `readonly` across all shapes here.
 *  - No cross-layer imports (`shared/`, `frontend/`, `app/`) — pure types.
 */

/**
 * Exhaustive transport-level rejection taxonomy for the GraphQL route's
 * pre-engine guard tier (`guardTransport`).
 *
 * TS union ONLY — deliberately NOT represented as a `pgEnum`,
 * `backend/db/schema/enums.ts` entry, or Pothos enum. Producers map each
 * kind onto a real HTTP status at the route boundary (`METHOD_NOT_ALLOWED` → 405 + `Allow: POST`,
 * `UNSUPPORTED_CONTENT_TYPE` → 400, `PAYLOAD_TOO_LARGE` → 413,
 * `MALFORMED_JSON` → 400, `CROSS_ORIGIN_REJECTED` → 403,
 * `BATCH_OPERATION_LIMIT` → 400).
 */
export type TransportErrorKind =
  | "METHOD_NOT_ALLOWED"
  | "UNSUPPORTED_CONTENT_TYPE"
  | "PAYLOAD_TOO_LARGE"
  | "MALFORMED_JSON"
  | "CROSS_ORIGIN_REJECTED"
  | "BATCH_OPERATION_LIMIT";

/**
 * Result-object contract returned by every pure transport guard helper
 * (result unions, never throw-as-control-flow): the discriminated
 * union narrows on `ok`.
 *
 * - Success arm carries the parsed request body as `unknown` so consumers
 *   MUST run their own narrowing/validation before use (no implicit any
 *   escape hatch beyond explicit `unknown`).
 * - Failure arm carries ONLY the machine kind — no raw header echoes,
 *   body fragments, or internal paths cross this contract;
 *   localization + envelope shaping happen downstream in the route.
 */
export type TransportGuardResult =
  | {
      /** Discriminant — guard passed; engine invocation may proceed. */
      readonly ok: true;
      /** Parsed request body; typed `unknown` to force explicit narrowing. */
      readonly body: unknown;
    }
  | {
      /** Discriminant — guard rejected; route must short-circuit the engine. */
      readonly ok: false;
      /** Machine-readable transport failure kind (see {@link TransportErrorKind}). */
      readonly kind: TransportErrorKind;
    };
