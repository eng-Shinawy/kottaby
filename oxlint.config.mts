import { defineConfig } from "oxlint";

const unusedVarOptions = {
  argsIgnorePattern: "^_",
  varsIgnorePattern: "^_",
  caughtErrorsIgnorePattern: "^_",
  destructuredArrayIgnorePattern: "^_",
} as const;

export default defineConfig({
  plugins: [
    "typescript",
    "unicorn",
    "oxc",
    "react",
    "nextjs",
    "import",
    "promise",
    "node",
    "vitest",
    "jsx-a11y",
    "jsdoc",
  ],
  categories: {
    correctness: "error",
    suspicious: "warn",
    perf: "warn",
  },
  rules: {
    "react/react-in-jsx-scope": "off",
    // Intentional dialog/field focus is valid a11y; this rule fights modal UX.
    "jsx-a11y/no-autofocus": "off",
    "no-console": "error",
    // Line-count standards (see docs/quality/linting-rules.md). Tiered limits in
    // `overrides` below: 150 lines for app/+frontend/views files, 100 for TSX
    // functions (JSX inflation). Never add oxlint-disable comments — fix root cause.
    "max-lines": ["error", { max: 300, skipBlankLines: true, skipComments: true }],
    "max-lines-per-function": ["error", { max: 75, skipBlankLines: true, skipComments: true, IIFEs: false }],
    "@typescript-eslint/no-non-null-assertion": "error",
    "@typescript-eslint/no-explicit-any": "error",
    "@typescript-eslint/no-namespace": "off",
    "no-unused-vars": ["error", unusedVarOptions],
    "@typescript-eslint/no-unused-vars": ["error", unusedVarOptions],
    "import/no-unassigned-import": [
      "error",
      {
        allow: [
          "**/*.css",
          "**/*.scss",
          "**/*.mutation",
          "**/*.mutation.ts",
          "**/*.query",
          "**/*.query.ts",
          "**/*.type",
          "**/*.type.ts",
          "**/*.enum",
          "**/*.enum.ts",
          "**/*.pothos",
          "**/*.pothos.ts",
          "./*",
          "@/backend/graphql/**",
          "@mui/x-data-grid/themeAugmentation",
        ],
      },
    ],
  },
  overrides: [
    {
      // Frontend views & app routes: 150-line file convention (see root AGENTS.md).
      files: ["app/**/*.{ts,tsx}", "frontend/views/**/*.{ts,tsx}"],
      rules: {
        "max-lines": ["error", { max: 150, skipBlankLines: true, skipComments: true }],
      },
    },
    {
      // JSX layout inflates line counts; components get a looser function cap.
      files: ["**/*.tsx"],
      rules: {
        "max-lines-per-function": ["error", { max: 100, skipBlankLines: true, skipComments: true, IIFEs: false }],
      },
    },
    {
      // Audit/demo seed scripts write through PGlite — a SINGLE-CONNECTION
      // WASM Postgres — so sequential awaits inside loops are structural
      // (parallel writes cannot exist on one connection).
      files: ["scripts/*seed*.ts"],
      rules: {
        "no-await-in-loop": "off",
      },
    },
    {
      // Test/story files: long describe blocks are idiomatic; size rules add no value.
      files: [
        "**/*.test.{ts,tsx}",
        "**/*.spec.{ts,tsx}",
        "**/*.test-d.{ts,tsx}",
        "test/**",
        "**/stories/**",
        "**/__tests__/**",
        "backend/db/test/**",
        "backend/services/**/test/**",
      ],
      rules: {
        "max-lines": "off",
        "max-lines-per-function": "off",
      },
    },
    {
      // Translation dictionaries & generated timezone constants scale with data size.
      files: ["shared/locale/**", "shared/constants/iana-timezone*.ts", "shared/constants/iana-timezones.ts"],
      rules: {
        "max-lines": "off",
      },
    },
    {
      files: [
        "frontend/lib/logger.ts",
        "frontend/utils/logger.ts",
        "scripts/**/*.ts",
        "scripts-e2e/**/*.ts",
        "backend/db/scripts/**/*.ts",
        "backend/db/test/**/*.ts",
        "next.config.ts",
      ],
      rules: {
        "no-console": "off",
      },
    },
    {
      files: [
        "**/*.test.ts",
        "**/*.test.tsx",
        "**/*.spec.ts",
        "**/*.spec.tsx",
        "test/**/*",
        "backend/db/test/**/*",
        "backend/services/**/test/**/*",
        "backend/services/**/*.test.ts",
        "frontend/**/test/**/*",
        "frontend/**/*.test.tsx",
        "frontend/**/*.test.ts",
        "app/**/*.test.ts",
      ],
      rules: {
        "@typescript-eslint/unbound-method": "off",
      },
    },
    {
      files: [
        "frontend/hooks/useApolloConnectivity.ts",
        "frontend/providers/apollo/useAuthRecoveryRegistration.ts",
        "frontend/views/dashboard/admin/shared/useAdminDashboard.ts",
        "frontend/views/dashboard/teachers/dashboard/utils/useTeacherDashboardLastUpdated.ts",
        "frontend/views/dashboard/components/DashboardProfileShell.tsx",
      ],
      rules: {
        "@typescript-eslint/consistent-return": "off",
      },
    },
    {
      // Apollo cache `Reference` entities carry the protocol-mandated `__ref`
      // wire property; the underscore prefix is not ours to rename and biome's
      // unsafe autofix reverts bracket access back to member access. This list
      // tracks the CURRENT modules holding `__ref` member access (the 4.4
      // refactor moved the cache-eviction arms out of the containers).
      files: [
        "frontend/views/student/sessions/sessionListCacheEviction.ts",
        "frontend/views/teacher/sessions/teacherSessionCacheArms.ts",
      ],
      rules: {
        "no-underscore-dangle": "off",
      },
    },
  ],
  ignorePatterns: [
    "**/.*/**",
    "!.storybook/**",
    "node_modules/**",
    "out/**",
    "build/**",
    "dist/**",
    "logs/**",
    "storage/**",
    "scratch/**",
    "Kottaby/**",
    "public/**",
    "storybook-static/**",
    "docs/**",
    "**/*.d.ts",
    "next-env.d.ts",
    "eslint.config.ts",
    "eslint.config.mjs",
    "oxlint.config.mts",
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
    // Sandbox VLM verification scripts (not part of the production codebase).
    "scripts/vlm-apollo-server.ts",
    "scripts/vlm-seed-fixtures.ts",
    "scripts/pglite-bootstrap.ts",
    "scripts/vlm-capture-round-1.sh",
    "scripts/vlm-capture-round-2.sh",
    "scripts/vlm-round-1.sh",
    "scripts/vlm-verify-auth.sh",
    "scripts/ts6-eslint-patch.cjs",
    // Cross-user verification script (sandbox-only; uses runtime type
    // narrowing via fetch JSON, so the strict no-unsafe-type-assertion
    // rule's exhaustive-switch adapter pattern would be overkill here).
    "scripts/cross-user-verify.test.ts",
    // Transpiled locale artifacts (gitignored, generated at dev time).
    "shared/locale/**/*.js",
  ],
  env: {
    builtin: true,
    browser: true,
    node: true,
  },
  options: {
    typeAware: true,
    typeCheck: true,
  },
});
