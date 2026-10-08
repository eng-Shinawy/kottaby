/**
 * Pothos scalar registry — single canonical registration of every custom
 * GraphQL scalar exposed through the schema.
 *
 * Same discipline as `shared/enum.pothos.ts`:
 *  - Each scalar is registered ONCE here via `addScalarType` — re-registering
 *    the same name is a runtime error ("has already been declared").
 *  - Domain Pothos files reference the scalar by NAME (`type: "DateTime"`);
 *    the backing TypeScript types come from the `Scalars` slot on
 *    `gqlSchemaBuilder` (`backend/graphql/pothos/builder.ts`).
 *  - Registered scalars MUST keep their two sides in sync: the runtime
 *    registration HERE and the `Scalars` typing on the builder.
 *
 * Registered scalars:
 *  - `DateTime` — `DateTimeResolver` from `graphql-scalars`. Serializes
 *    `Date` to an ISO-8601 UTC string; wire format is identical to the old
 *    manual `toISOString()` convention, so existing String consumers are
 *    unaffected. Frontend codegen maps it to `string` (codegen.ts).
 *  - `CountryCode` — `CountryCodeResolver` from `graphql-scalars`
 *    (ISO 3166-1 alpha-2; validates against the library's full-country list,
 *    case-insensitive, returns the value unchanged — normalization +
 *    curated-set membership stay in the service; frontend codegen maps it to
 *    `string`).
 *  - `PhoneNumber` — `PhoneNumberScalar` from
 *    `backend/graphql/scalars/phoneNumberScalar.ts`. Validates E.164
 *    SEMANTICALLY via the ported google-libphonenumber library
 *    (`shared/lib/phone/`, deep-import `@/shared/lib/phone/parse` — the
 *    bare `@/shared/lib/phone` alias resolves to the legacy zod shape gate
 *    in `shared/lib/phone.ts`): input coercion accepts a String, returns
 *    the canonical E.164 form when valid, and otherwise throws a
 *    `GraphQLError` whose message is the machine code `PHONE_INVALID`
 *    (never the submitted value); serialization is a lenient String
 *    pass-through for future output fields that may expose legacy stored
 *    values. Registered for FUTURE input fields — existing phone mutation
 *    inputs intentionally remain `String`: the localized VALIDATION
 *    field-error envelope (`extensions.fields[]` with
 *    `{field:"phone", code, message}`) produced by the service-level
 *    `validatePhoneField` gate is the documented wire contract
 *    (docs/validation/phone-validation.md), and scalar-level coercion
 *    errors cannot be localized per-request-locale. Frontend codegen maps
 *    it to `string` (codegen.ts).
 *
 * After registering a new scalar here, update the builder's `Scalars` type,
 * then run `bun run generate:gqlSchema` and `bun codegen` to refresh the SDL
 * + frontend codegen.
 */
import { CountryCodeResolver, DateTimeResolver } from "graphql-scalars";
import { gqlSchemaBuilder } from "@/backend/graphql/pothos/builder";
import { PhoneNumberScalar } from "@/backend/graphql/scalars/phoneNumberScalar";

// ISO-8601 UTC date-time scalar (serializes `Date`; accepts ISO strings
// pass-through) — registered by side effect when this module loads; domain
// Pothos fields reference it by NAME (`type: "DateTime"`).
gqlSchemaBuilder.addScalarType("DateTime", DateTimeResolver, {});

// ISO 3166-1 alpha-2 country-code scalar (accepts any code from the
// library's hardcoded full-country list, case-insensitively, and returns
// the value UNCHANGED — no normalization; dataset membership + trimming
// stay in the service layer) — registered by side effect when this module
// loads; domain Pothos fields reference it by NAME (`type: "CountryCode"`).
gqlSchemaBuilder.addScalarType("CountryCode", CountryCodeResolver, {});

// E.164 phone-number scalar (semantic validation via the ported
// google-libphonenumber library in `shared/lib/phone/`; input coercion
// returns the canonical E.164 form or throws the machine code
// `PHONE_INVALID`; serialization is a lenient String pass-through).
// Registered for FUTURE input fields — existing phone mutation inputs
// intentionally remain `String` because the localized VALIDATION
// field-error envelope (`extensions.fields[]` with
// `{field:"phone", code, message}`) from the service-level
// `validatePhoneField` gate is the documented wire contract
// (docs/validation/phone-validation.md), and scalar-level coercion errors
// cannot be localized per-request-locale.
gqlSchemaBuilder.addScalarType("PhoneNumber", PhoneNumberScalar, {});
