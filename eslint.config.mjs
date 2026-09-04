// import cspellESLintPluginRecommended from "@cspell/eslint-plugin/recommended"; disabled for performance
import eslint from "@eslint/js";
import graphqlPlugin from "@graphql-eslint/eslint-plugin";
import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import drizzle from "eslint-plugin-drizzle";
import { flatConfigs as importXFlatConfigs } from "eslint-plugin-import-x";
import reactHooks from "eslint-plugin-react-hooks";
import { reactRefresh } from "eslint-plugin-react-refresh";
import { configs as sonarjsConfigs } from "eslint-plugin-sonarjs";
import { configs as storybookConfigs } from "eslint-plugin-storybook";
import globals from "globals";
import { configs as tseslintConfigs } from "typescript-eslint";
import { localRulesPlugin } from "./scripts/eslint-rules/index.mjs";

/** Drizzle query executors used across repos (`db`, `tx`, `t`, `q`, `queryDb`, `client`). */
const drizzleObjectName = ["db", "tx", "t", "q", "queryDb", "client"];

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  importXFlatConfigs.recommended,
  importXFlatConfigs.typescript,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Ignore ALL dot-directories anywhere in the tree (e.g. .next, .git, .cursor,
    // .vscode, .scannerwork, .husky, ai, .agents, .playwright-mcp, .kiro, ...).
    // One pattern replaces the previous hand-maintained list that missed new dot dirs.
    // Next.js build output (dev, default, and per-port test dist dirs).
    "**/.next/**",
    "**/.next-dev/**",
    "**/.next-test*/**",
    // Dot-directories (except `.storybook`, which is linted explicitly).
    "**/.*/**",
    "!.storybook/**",
    // Build output / dependency dirs that don't start with a dot.
    "node_modules/**",
    "out/**",
    "build/**",
    "dist/**",
    "logs/**",
    "storage/**",
    "scratch/**",
    "Kottaby/**",
    "storybook-static/**",
    "docs/**",
    // Gitignored local/sandbox artifacts not covered by the dot-dir rule.
    "coverage/**",
    "prompt/**",
    "qa-shots/**",
    "tool-results/**",
    "download/**",
    "report/**",
    "jscpd-admin/**",
    "jscpd-intra/**",
    "jscpd-output/**",
    "jscpd-all/**",
    "agent-ctx/**",
    // Auto-generated msw service worker (says "do NOT modify"; not real source).
    "public/mockServiceWorker.js",
    // Transpiled locale artifacts (gitignored, generated at dev time).
    "shared/locale/**/*.js",
    // File patterns
    "**/*.d.ts",
    "next-env.d.ts",
    "eslint.config.ts",
    "debug-eslint.js",
    "bun.lock",
    "*.lock",
    "*.log",
    "**/*.md",
    "**/*.html",
    "**/messages/**",
    "frontend/graphql/generated/**",
    "**/unRefactored_tests/**",
    "*storybook.log",
    // Sandbox-provided skills directory (gitignored, not part of the project).
    "skills/**",
  ]),
  eslint.configs.recommended,
  sonarjsConfigs.recommended,
  // cspellESLintPluginRecommended, disabled for performance

  ...storybookConfigs["flat/recommended"],

  // TypeScript and React-specific configuration
  ...tseslintConfigs.recommended.map(config => ({
    ...config,
    files: ["**/*.{ts,tsx}"],
  })),

  // CommonJS configuration for .cjs files
  {
    files: ["**/*.cjs"],
    languageOptions: {
      sourceType: "commonjs",
      globals: {
        ...globals.node,
      },
    },
  },

  {
    files: ["**/*.{ts,tsx}"],
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh.plugin,
    },
    languageOptions: {
      // ecmaVersion: 2020,
      globals: globals.browser,
      parserOptions: {
        tsconfigRootDir: import.meta.dirname,
        ...(process.env.ESLINT_TYPE_AWARE === "true"
          ? {
              // Only files NOT covered by tsconfig.json belong here. Root/scripts
              // `*.ts` are already in the project service via `include: ["**/*.ts"]`,
              // so listing them in allowDefaultProject causes parse errors.
              projectService: {
                allowDefaultProject: ["*.mjs"],
                defaultProject: "tsconfig.json",
              },
            }
          : {}),
      },
    },
    rules: {
      // React rules
      ...reactHooks.configs.recommended.rules,
      "react-hooks/set-state-in-effect": "off",
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],

      // TypeScript rules
      // Note: you must disable the base rule as it can report incorrect errors
      "no-throw-literal": "off",
      "@typescript-eslint/only-throw-error": "off",

      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          destructuredArrayIgnorePattern: "^_",
        },
      ],
      "@typescript-eslint/no-namespace": "off",

      /**
       * Bans the `!` (non-null assertion) operator.
       * This is the #1 source of your runtime null errors.
       */
      "@typescript-eslint/no-non-null-assertion": "error",

      /**
       * Bans the `any` keyword, forcing you to use the safer `unknown`.
       * `any` disables all null checking.
       */
      "@typescript-eslint/no-explicit-any": "error",

      /**
       * Disallow direct use of console methods.
       * Use the logger utility instead: import { logger } from '@/utils/logger'
       */
      "no-console": "error",

      // SonarJS rules
      "sonarjs/no-nested-conditional": "error",
      "import-x/no-duplicates": ["error", { "prefer-inline": true }],

      ...(process.env.ESLINT_TYPE_AWARE === "true"
        ? {
            "@typescript-eslint/await-thenable": "error",
            "@typescript-eslint/no-unnecessary-type-assertion": "error",
            "@typescript-eslint/no-base-to-string": "error",
            "@typescript-eslint/prefer-optional-chain": "error",
            "@typescript-eslint/prefer-nullish-coalescing": "error",
            "sonarjs/deprecation": "error",
          }
        : {}),

      // `sonarjs/no-unused-vars` (S1481) is hardcoded with `defaultOptions: []`
      // and accepts no ignore patterns — it does NOT honor the `^_` underscore
      // convention that `@typescript-eslint/no-unused-vars` uses via
      // `varsIgnorePattern`/`argsIgnorePattern`/`destructuredArrayIgnorePattern`.
      // That makes it a strict subset of the TypeScript rule (which already runs
      // above with all the underscore exceptions), so it only ever produces
      // duplicate false positives on intentional `_`-prefixed discards such as
      // `const { key: _muiKey, ...rest } = props`. Disable it here and rely on
      // the TypeScript rule for unused-variable detection.
      "sonarjs/no-unused-vars": "off",

      "react-hooks/preserve-manual-memoization": "off",
      "@typescript-eslint/restrict-template-expressions": "off",

      // Spell checking disabled for performance;
      // "@cspell/spellchecker": [
      //   "warn",
      //   {
      //     autoFix: true,
      //     configFile: new URL("./cspell.config.yaml", import.meta.url).toString(),
      //     cspellOptionsRoot: import.meta.url,
      //   },
      // ],
    },
  },

  // Disable react-refresh rule for Next.js special files
  {
    files: [
      "**/page.tsx",
      "**/layout.tsx",
      "**/loading.tsx",
      "**/error.tsx",
      "**/not-found.tsx",
      "**/template.tsx",
      "**/default.tsx",
      "**/route.ts",
    ],
    rules: {
      "react-refresh/only-export-components": "off",
    },
  },

  // Disable react-refresh rule for UI test files (test utilities export non-component helpers)
  {
    files: ["test/ui/**/*.{ts,tsx}"],
    rules: {
      "react-refresh/only-export-components": "off",
    },
  },

  // Allow console and bypass security rules in specific files (logger, scripts, tests, config)
  {
    files: [
      "frontend/utils/logger.ts",
      "scripts/oxlint-categorize.ts",
      "scripts/**/*.ts",
      "backend/db/scripts/**/*.ts",
      "backend/db/test/**/*.ts",
      "next.config.ts",
    ],
    rules: {
      "no-console": "off",
      "sonarjs/no-nested-functions": "off",
      "sonarjs/no-os-command-from-path": "off",
      "sonarjs/no-hardcoded-ip": "off",
      "sonarjs/sql-queries": "off",
      "@typescript-eslint/no-unnecessary-condition": "off",
      "@cspell/spellchecker": "off",
    },
  },

  // Enforce @/ path alias — relative ./ or ../ imports are banned
  // except for barrel files (**/index.ts) which legitimately re-export siblings.
  {
    files: [
      "app/**/*.{ts,tsx}",
      "backend/**/*.{ts,tsx}",
      "frontend/**/*.{ts,tsx}",
      "shared/**/*.{ts,tsx}",
      "test/**/*.{ts,tsx}",
      "scripts/**/*.{ts,tsx}",
      ".storybook/**/*.{ts,tsx}",
    ],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "ImportDeclaration[source.value=/^\\.\\.?\\//]", // NoSonar
          message: "Imports must use @/ path alias, not relative ./ or ../ — see AGENTS.md",
        },
      ],
    },
  },

  // Shared code must not depend on frontend, backend, or app layers.
  {
    files: ["shared/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@/frontend/**", "@/backend/**", "@/app/**"],
              message: "Shared code must not import from frontend, backend, or app layers — see shared/AGENTS.md",
            },
          ],
        },
      ],
    },
  },

  // Frontend code must not depend on the backend layer (use GraphQL or shared/ instead).
  // Also ban raw MUI DataGrid / Table / Pagination outside owned list wrappers.
  {
    files: ["frontend/**/*.{ts,tsx}"],
    ignores: ["frontend/components/ui/dataGrid/AppDataGrid.tsx"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@mui/x-data-grid",
              importNames: ["DataGrid"],
              message:
                "Do not import DataGrid directly — use AppDataGrid / DesktopAppDataGrid / MobileAppDataGrid with paginationOptions",
            },
            {
              name: "@mui/material",
              importNames: [
                "Pagination",
                "TablePagination",
                "Table",
                "TableBody",
                "TableCell",
                "TableContainer",
                "TableHead",
                "TableRow",
              ],
              message:
                "Do not use MUI Table/Pagination — use *AppDataGrid / MobileCardList with paginationOptions, or *PaginationControls for intentional non-list footers",
            },
          ],
          patterns: [
            {
              group: ["@/backend/**"],
              message:
                "Frontend code must not import from the backend layer — use GraphQL, shared/, or app/ server entry points instead",
            },
          ],
        },
      ],
    },
  },

  // Enforce theme token colors (no hardcoded colors) + no hardcoded strings
  // in frontend + app code (per AGENTS.md: "NEVER use hex colors" +
  // "Never hardcode strings — always use typed translation functions").
  {
    files: ["frontend/**/*.{ts,tsx}", "app/**/*.{ts,tsx}"],
    ignores: ["frontend/providers/theme/**", "frontend/graphql/generated/**", "frontend/stories/**"],
    plugins: {
      local: localRulesPlugin,
    },
    rules: {
      "local/no-hardcoded-colors": "error",
      "local/no-hardcoded-strings": "error",
    },
  },

  // Backend code must not depend on the frontend layer.
  {
    files: ["backend/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@/frontend/**"],
              message:
                "Backend code must not import from the frontend layer — move shared logic to shared/ or backend/",
            },
          ],
        },
      ],
    },
  },

  // **/index.ts barrel files keep relative ./sibling re-exports by design.
  {
    files: ["**/index.ts"],
    rules: {
      "no-restricted-syntax": "off",
    },
  },

  // Disable react-refresh rule for Storybook config (exports helpers alongside components)
  {
    files: [".storybook/**/*.{ts,tsx}"],
    rules: {
      "react-refresh/only-export-components": "off",
    },
  },

  // Storybook config files use sibling relative imports within `.storybook/`.
  {
    files: [".storybook/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-syntax": "off",
    },
  },
  // Seeders must not import from the database layer directly — use services instead.
  {
    files: ["backend/db/seeds/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "@/backend/db/drizzleDb",
                "@/backend/db/schema",
                "@/backend/db/schema/**",
                "@/backend/db/repo",
                "@/backend/db/repo/**",
                "@/backend/db/migration",
                "@/backend/db/migration/**",
                "@/backend/db/scripts/**",
                "@/backend/drizzle/**",
              ],
              message:
                "Seeders must not import from the database layer — call backend services (bootstrap methods) instead. See backend/db/seeds/AGENTS.md",
            },
          ],
        },
      ],
    },
  },

  // Drizzle: require `.where()` on delete/update to avoid wiping whole tables.
  {
    files: ["backend/**/*.{ts,tsx}"],
    plugins: {
      drizzle,
    },
    rules: {
      "drizzle/enforce-delete-with-where": ["error", { drizzleObjectName }],
      "drizzle/enforce-update-with-where": ["error", { drizzleObjectName }],
    },
  },

  // GraphQL-ESLint: pluck `gql` operations from shared documents, then lint as virtual `.graphql`.
  {
    files: ["frontend/graphql/sharedDocuments/**/*.{ts,tsx}"],
    processor: graphqlPlugin.processor,
  },
  {
    files: ["**/*.graphql"],
    languageOptions: {
      parser: graphqlPlugin.parser,
    },
    plugins: {
      "@graphql-eslint": graphqlPlugin,
    },
    rules: {
      ...graphqlPlugin.configs["flat/operations-recommended"].rules,
      // Repo has mixed camelCase/PascalCase operation names; enforce only anti-patterns.
      "@graphql-eslint/naming-convention": [
        "error",
        {
          VariableDefinition: "camelCase",
          OperationDefinition: {
            forbiddenPrefixes: ["Query", "Mutation", "Subscription", "Get"],
            forbiddenSuffixes: ["Query", "Mutation", "Subscription"],
          },
          FragmentDefinition: {
            style: "PascalCase",
            forbiddenPrefixes: ["Fragment"],
            forbiddenSuffixes: ["Fragment"],
          },
        },
      ],
    },
  },

  // Mobile files must not import desktop files (and vice versa).
  // IMPORTANT: no-restricted-imports matches the raw import specifier string (the `from` value).
  // TypeScript imports omit the .tsx extension, so patterns must match extensionless imports.
  // Use regex for precise matching instead of glob group to catch both "foo.desktop" and "foo.desktop.tsx".
  {
    files: ["**/*.mobile.tsx", "**/*.mobile.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              regex: "\\.desktop(\\.tsx?)?$", // NoSonar
              message: "Mobile components must not import desktop components — see architecture rules in AGENTS.md",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["**/*.desktop.tsx", "**/*.desktop.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              regex: "\\.mobile(\\.tsx?)?$", // NoSonar
              message: "Desktop components must not import mobile components — see architecture rules in AGENTS.md",
            },
          ],
        },
      ],
    },
  },

  // Mobile and desktop files must not use useMediaQuery or useViewport.
  // They are pure presentation — the viewport tier is decided by the parent switcher.
  // `paths` and `patterns` coexist in the same rule entry (both fire independently).
  {
    files: ["**/*.mobile.tsx", "**/*.desktop.tsx", "**/*.mobile.ts", "**/*.desktop.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@mui/material",
              importNames: ["useMediaQuery"],
              allowTypeImports: true,
              message:
                "Mobile/desktop components must not use useMediaQuery — viewport tier is decided by the parent View switcher",
            },
          ],
          patterns: [
            {
              group: ["@/frontend/hooks/useViewport", "@/frontend/context/ViewportContext"],
              message: "Mobile/desktop components must not read viewport context — they are already tier-specific",
            },
          ],
        },
      ],
    },
  },

  // Person pickers: views must use tier userSelect Autocompletes + shared hooks — not directory queries / common facades.
  {
    files: [
      "frontend/**/views/**/*.{ts,tsx}",
      "frontend/desktop/views/**/*.{ts,tsx}",
      "frontend/mobile/views/**/*.{ts,tsx}",
    ],
    ignores: [
      "frontend/hooks/userAutocomplete/**",
      "frontend/**/views/**/*.stories.tsx",
      "frontend/**/students/quota/**",
    ],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@/frontend/graphql/sharedDocuments",
              importNames: [
                "teachersQueryDocument",
                "studentsDirectoryQueryDocument",
                "parentsDirectoryQueryDocument",
                "staffDirectoryQueryDocument",
              ],
              message:
                "Person pickers must use userSelect Autocomplete (tier components + hooks). Do not query lightweight directories from views.",
            },
            {
              name: "@/frontend/components/ui/input/userSelect",
              importNames: [
                "TeacherAutocomplete",
                "StudentAutocomplete",
                "ParentAutocomplete",
                "UserAutocomplete",
                "StaffAutocomplete",
                "AudienceAutocomplete",
              ],
              message:
                "Import TeacherAutocompleteDesktop/Mobile (or peer) from the tier UI kit — never common Autocomplete facades in views. Types/utils (PersonOption, resolvePersonOption) are allowed.",
            },
          ],
        },
      ],
    },
  },

  // Lazy translations Phase 4: tier views pass labels from ViewModel — not useAppTranslation in views.
  {
    files: ["**/*.mobile.tsx", "**/*.desktop.tsx"],
    ignores: ["frontend/desktop/components/ui/**", "frontend/mobile/components/ui/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@/shared/locale",
              importNames: ["useAppTranslation"],
              message:
                "Tier views must receive labels via props from the ViewModel — useAppTranslation is allowed only in shared tier UI (frontend/*/components/ui/). See frontend/views/AGENTS.md",
            },
            {
              name: "@/shared/locale/client",
              importNames: ["useAppTranslation"],
              message:
                "Tier views must receive labels via props from the ViewModel — useAppTranslation is allowed only in shared tier UI. See frontend/views/AGENTS.md",
            },
            {
              name: "@/shared/locale/client/use-app-translation",
              importNames: ["useAppTranslation"],
              message: "Tier views must receive labels via props from the ViewModel. See frontend/views/AGENTS.md",
            },
          ],
        },
      ],
    },
  },

  // Lazy translations Phase 4: client product code must not import eager messagesByLocale.
  {
    files: ["frontend/**/*.{ts,tsx}", "app/**/*.{ts,tsx}"],
    ignores: ["frontend/graphql/test/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@/shared/locale",
              importNames: ["messagesByLocale"],
              message:
                "Client code must not import messagesByLocale — use useAppTranslation(handle) or labels from ViewModel props",
            },
          ],
        },
      ],
    },
  },

  // Lazy translations Phase 4: product code imports @/shared/locale barrel only — no deep old/beta paths.
  {
    files: ["app/**/*.{ts,tsx}", "frontend/**/*.{ts,tsx}", "backend/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@/shared/locale/old/**", "@/shared/locale/beta/**"],
              message:
                "Import translation APIs from @/shared/locale or @/shared/locale/types only — never deep old/ or beta/ paths. See shared/AGENTS.md",
            },
          ],
        },
      ],
    },
  },
]);

export default eslintConfig;
