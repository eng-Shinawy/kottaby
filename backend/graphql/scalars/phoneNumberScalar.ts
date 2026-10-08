/**
 * `PhoneNumber` GraphQL scalar — a validated phone number on the E.164 wire.
 *
 * Validation is semantic, not just lexical: values are coerced through the
 * ported libphonenumber library in `shared/lib/phone/` (deep-import
 * `@/shared/lib/phone/parse` — the bare `@/shared/lib/phone` alias resolves
 * to the legacy zod shape gate in `shared/lib/phone.ts`, which stays the
 * authority for the `validatePhoneField` service gate).
 *
 * Coercion contract:
 *  - `parseValue` / `parseLiteral` accept a String, run it through
 *    `parsePhoneToE164`, and return the canonical E.164 string when the
 *    number is valid. Any other outcome throws a `GraphQLError` whose
 *    message is the machine code `PHONE_INVALID` — the submitted value is
 *    NEVER echoed into the error (fixed-template discipline, see
 *    `docs/validation/phone-validation.md`).
 *  - `serialize` is deliberately lenient: a stored String is returned
 *    unchanged, with no validation pass, so future output fields may
 *    expose legacy stored values without a backfill migration gating them.
 *
 * Registration: `backend/graphql/pothos/shared/scalar.pothos.ts` (the single
 * scalar registry). The scalar is registered for FUTURE input fields —
 * every existing phone mutation input intentionally stays `String` because
 * the localized VALIDATION field-error envelope (`extensions.fields[]`)
 * produced by `validatePhoneField` is the documented wire contract
 * (`docs/validation/phone-validation.md`), and scalar-level coercion errors
 * cannot be localized per-request-locale.
 */
import { GraphQLError, GraphQLScalarType, Kind } from "graphql";
import { parsePhoneToE164 } from "@/shared/lib/phone/parse";

export const PhoneNumberScalar = new GraphQLScalarType({
  name: "PhoneNumber",
  description: "A type representing a validated phone number (E.164)",
  serialize(value: unknown): string {
    if (typeof value === "string") {
      return value;
    }
    throw new GraphQLError("PHONE_INVALID");
  },
  parseValue(value: unknown): string {
    if (typeof value === "string") {
      const parsed = parsePhoneToE164(value);
      if (parsed.valid && parsed.e164 !== null) {
        return parsed.e164;
      }
    }
    throw new GraphQLError("PHONE_INVALID");
  },
  parseLiteral(ast): string {
    if (ast.kind === Kind.STRING) {
      const parsed = parsePhoneToE164(ast.value);
      if (parsed.valid && parsed.e164 !== null) {
        return parsed.e164;
      }
    }
    throw new GraphQLError("PHONE_INVALID");
  },
});
