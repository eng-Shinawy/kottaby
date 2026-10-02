/**
 * CountryCode scalar behavior suite — registration + coercion-boundary pins
 * over the BUILT production schema (the same `graphQLSchema` instance the
 * Apollo server mounts).
 *
 * What this locks down:
 *  - **Single registration** — `CountryCode` is registered exactly once
 *    through the scalar registry (`shared/scalar.pothos.ts`), surfaces as a
 *    `GraphQLScalarType` (leaf value type — never an object/input/enum), and
 *    carries the library's ISO 3166-1 alpha-2 description.
 *  - **Coercion boundary (runtime values)** — input coercion accepts every
 *    code on the library's hardcoded full-country list, CASE-INSENSITIVELY,
 *    and returns the value UNCHANGED (no trim, no upper-casing —
 *    normalization is deliberately NOT the scalar's job). Clearly invalid
 *    values are rejected with a thrown coercion error.
 *  - **Curated-out codes stay wire-accepted** — codes present in the library
 *    list but curated out of the shared dataset (`IL`, `XK`) pass the
 *    scalar: dataset membership remains the SERVICE layer's mandatory gate,
 *    so this suite pins the pass-through (defense-in-depth split, never a
 *    single-layer guarantee).
 *  - **Literal AST tier** — String literals coerce through; non-String
 *    literals (Int/Boolean) fail coercion.
 *  - **Wire tier** — executing a document declaring a `CountryCode`-typed
 *    variable through the real schema's execution engine rejects an invalid
 *    code during variable coercion (the exact execution path the server
 *    harness exercises after document validation, run here context-free
 *    against the scopeless `_health` probe).
 *  - **Leaf discipline (no smuggling)** — the scalar exposes no fields of its
 *    own, and the ONLY schema fields typed with it are the register +
 *    admin-create input `country` fields (input-leaf surface — no object
 *    surface to smuggle extra fields through).
 *
 * Pure unit tier — NO server boot, NO network, NO DB. Runs via the mandated
 * runner: `bun run test/scripts/run-test.ts backend/graphql/test/country-code-scalar.test.ts`.
 */

import { describe, expect, test } from "bun:test";
import {
  coerceInputLiteral,
  execute,
  GraphQLInputObjectType,
  GraphQLInterfaceType,
  GraphQLList,
  GraphQLNonNull,
  GraphQLObjectType,
  GraphQLScalarType,
  type GraphQLType,
  Kind,
  parse,
} from "graphql";
import { graphQLSchema } from "@/backend/graphql/gqlSchema";

// ─── Runtime guards (no casts, per test-tier discipline) ─────────────────────

function countryCodeScalar(): GraphQLScalarType {
  const scalar = graphQLSchema.getType("CountryCode");
  if (!(scalar instanceof GraphQLScalarType)) {
    throw new Error("CountryCode must be registered as a GraphQL scalar type");
  }
  return scalar;
}

function registeredCountryCodeType(): GraphQLType {
  const type = graphQLSchema.getType("CountryCode");
  if (type === undefined) {
    throw new Error("CountryCode must be registered in the schema");
  }
  return type;
}

/** Runs one coercion error expectation and returns the caught error. */
function coercionErrorOf(action: () => unknown): Error {
  let errorCaught: unknown = null;
  try {
    action();
  } catch (error) {
    errorCaught = error;
  }
  expect(errorCaught).not.toBeNull();
  if (!(errorCaught instanceof Error)) {
    throw new Error("expected an Error-shaped coercion failure");
  }
  return errorCaught;
}

/** Unwraps NonNull/List wrappers down to the named type's name. */
function namedTypeNameOf(type: GraphQLType): string {
  if (type instanceof GraphQLNonNull || type instanceof GraphQLList) {
    return namedTypeNameOf(type.ofType);
  }
  return type.name;
}

/** Collects the `TypeName.fieldName` path of every schema field typed with CountryCode. */
function countryCodeFieldPaths(): string[] {
  const paths: string[] = [];
  for (const type of Object.values(graphQLSchema.getTypeMap())) {
    if (
      !(type instanceof GraphQLObjectType) &&
      !(type instanceof GraphQLInterfaceType) &&
      !(type instanceof GraphQLInputObjectType)
    ) {
      continue;
    }
    for (const [fieldName, field] of Object.entries(type.getFields())) {
      if (namedTypeNameOf(field.type) === "CountryCode") {
        paths.push(`${type.name}.${fieldName}`);
      }
    }
  }
  return paths.toSorted((a, b) => a.localeCompare(b));
}

// ─── Tier 1: registration shape ──────────────────────────────────────────────

describe("CountryCode registration — single scalar registry entry, leaf value type", () => {
  test("is a registered GraphQLScalarType with the library's ISO description", () => {
    const scalar = countryCodeScalar();
    expect(scalar.name).toBe("CountryCode");
    expect(scalar.description).toBe("A country code as defined by ISO 3166-1 alpha-2");
    // Leaf value type: scalars carry no field set and no value container —
    // there is no object surface to smuggle extra fields through.
    expect("getFields" in registeredCountryCodeType()).toBe(false);
  });

  test("exactly the register + admin-create input country fields are typed with CountryCode (nothing else widened)", () => {
    expect(countryCodeFieldPaths()).toEqual(["AdminCreateUserInput.country", "RegisterUserInput.country"]);
  });
});

// ─── Tier 2: coercion boundary (values + literals) ───────────────────────────

describe("CountryCode coercion boundary — full-ISO-list accept, case-insensitive, value UNCHANGED", () => {
  test("accepts dataset members verbatim (EG stays EG — no normalization)", () => {
    const scalar = countryCodeScalar();
    expect(scalar.coerceInputValue("EG")).toBe("EG");
    // Case-insensitive regex — lowercase is wire-accepted and returned
    // UNCHANGED; upper-casing stays in the service-layer schema.
    expect(scalar.coerceInputValue("eg")).toBe("eg");
    expect(scalar.coerceInputValue("eG")).toBe("eG");
    // Whitespace is NOT trimmed away by the scalar (anchored regex).
    coercionErrorOf(() => scalar.coerceInputValue(" EG "));
  });

  test("accepts full-ISO codes curated out of the shared dataset (IL, XK) — service gate stays mandatory", () => {
    const scalar = countryCodeScalar();
    for (const curatedOut of ["IL", "XK"]) {
      expect(scalar.coerceInputValue(curatedOut)).toBe(curatedOut);
    }
    // `PS` IS a shared-dataset member (only IL/XK are curated out) but also
    // rides the library list — the scalar passes it through verbatim too.
    expect(scalar.coerceInputValue("PS")).toBe("PS");
  });

  test("rejects clearly invalid values with the library's coercion error", () => {
    const scalar = countryCodeScalar();
    for (const invalid of [
      "XX", // valid shape, absent from the library's full-country list
      "EGY", // three letters
      "Egypt", // legacy free-text display name
      "ZZ", // unmapped pair
      "", // empty
      "12", // digits
      "Egypt, EG", // composite
    ]) {
      const error = coercionErrorOf(() => scalar.coerceInputValue(invalid));
      expect(error.message).toContain(`Value is not a valid country code: ${invalid}`);
    }
  });

  test("rejects non-string runtime values (number, boolean, null, object)", () => {
    const scalar = countryCodeScalar();
    for (const invalid of [42, true, null, { country: "EG" }, ["EG"]]) {
      const error = coercionErrorOf(() => scalar.coerceInputValue(invalid));
      expect(error.message).toContain("Value is not string");
    }
  });

  test("String literals coerce through; non-String AST kinds fail literal coercion", () => {
    expect(coerceInputLiteral({ kind: Kind.STRING, value: "EG" }, countryCodeScalar())).toBe("EG");
    expect(coerceInputLiteral({ kind: Kind.STRING, value: "il" }, countryCodeScalar())).toBe("il");
    expect(coerceInputLiteral({ kind: Kind.INT, value: "42" }, countryCodeScalar())).toBeUndefined();
    expect(coerceInputLiteral({ kind: Kind.BOOLEAN, value: true }, countryCodeScalar())).toBeUndefined();
    expect(coerceInputLiteral({ kind: Kind.OBJECT, fields: [] }, countryCodeScalar())).toBeUndefined();
  });
});

// ─── Tier 4: wire tier + leaf discipline ─────────────────────────────────────

describe("CountryCode wire coercion — variable input through the real schema execution", () => {
  const PROBE_DOCUMENT = parse(`
    query CountryCodeVariableProbe($country: CountryCode) {
      _health { status }
    }
  `);

  test("a valid dataset code coerces cleanly (anonymous execution succeeds)", async () => {
    const result = await execute({
      schema: graphQLSchema,
      document: PROBE_DOCUMENT,
      variableValues: { country: "EG" },
      contextValue: {},
    });
    expect(result.errors).toBeUndefined();
    // Wire-shape assertion over the serialized data map (no casts).
    expect(JSON.stringify(result.data)).toBe('{"_health":{"status":"ok"}}');
  });

  test("a valid-shape non-member (XX) is rejected during variable coercion before any resolver runs", async () => {
    const result = await execute({
      schema: graphQLSchema,
      document: PROBE_DOCUMENT,
      variableValues: { country: "XX" },
      contextValue: {},
    });
    expect(result.data).toBeUndefined();
    const messages = result.errors?.map(error => error.message).join(" | ") ?? "";
    expect(messages).toContain('Variable "$country" has invalid value');
    expect(messages).toContain("Value is not a valid country code: XX");
  });

  test("a non-string variable value is rejected with the type-mismatch coercion error", async () => {
    const result = await execute({
      schema: graphQLSchema,
      document: PROBE_DOCUMENT,
      variableValues: { country: 42 },
      contextValue: {},
    });
    expect(result.data).toBeUndefined();
    const messages = result.errors?.map(error => error.message).join(" | ") ?? "";
    expect(messages).toContain('Variable "$country" has invalid value');
    expect(messages).toContain("Value is not string: 42");
  });
});
