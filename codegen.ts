import type { CodegenConfig } from "@graphql-codegen/cli";

const JSON_SCALAR_TYPE = "unknown"; // Or "JsonValue" if you define it elsewhere
// Inline shape (kept inline so the generated file is self-contained). The
// locale union mirrors `AppLocale` ("ar" | "en" today) from
// `@/shared/locale/AppLocale`.
const LOCALIZED_STRING_TYPE = "Partial<Record<'ar' | 'en', string>>";

const sharedGqlConfig: CodegenConfig["config"] = {
  useTypeImports: true,
  avoidOptionals: true,
  enumType: "native" as const,
  dedupeFragments: true,
  onlyOperationTypes: false,
  inlineFragmentTypes: false,
  extractAllFieldsToTypes: true,
  skipTypeNameForRoot: false,
  strictScalars: true,
  defaultScalarType: "unknown",
  scalars: {
    CountryCode: "string",
    Date: "string",
    DateTime: "string",
    Email: "string",
    JSON: JSON_SCALAR_TYPE,
    LocalizedString: LOCALIZED_STRING_TYPE,
    PhoneNumber: "string",
    StringMap: "Record<string, string>",
    IanaTimezone: "@/shared/constants/iana-timezone.enum#IanaTimezone",
  },
};

const config: CodegenConfig = {
  overwrite: true,
  schema: "./frontend/graphql/generated/schema.graphql",
  documents: ["./frontend/graphql/sharedDocuments/**/*.ts", "./frontend/views/**/*.documents.ts"],
  ignoreNoDocuments: true,
  noSilentErrors: true,
  generates: {
    "./frontend/graphql/generated/gql/graphql.ts": {
      plugins: ["typescript-operations", "typed-document-node"],
      config: {
        ...sharedGqlConfig,
        extractAllFieldsToTypes: false,
        extractAllFieldsToTypesCompact: true,
      },
    },
  },
};

export default config;
