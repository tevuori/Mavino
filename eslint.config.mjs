// @ts-check
// ESLint flat config — pragmatic baseline for the Mavino monorepo.
// Catches real bugs (unused vars, hooks violations, undefined refs) without
// being overly strict. Prettier handles formatting separately.
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import prettierConfig from "eslint-config-prettier";

export default tseslint.config(
  // Global ignores — build outputs, deps, generated files.
  {
    ignores: [
      "node_modules/",
      "**/node_modules/",
      "**/dist/",
      "**/build/",
      "client/public/",
      "android/",
      "server/prisma/migrations/",
      "**/*.d.ts",
    ],
  },

  // Base JS recommended rules.
  js.configs.recommended,

  // TypeScript recommended (non-type-checked for fast linting).
  ...tseslint.configs.recommended,

  // Disable formatting rules that conflict with Prettier.
  prettierConfig,

  // ---- Global rule overrides ----
  // Downgrade noisy rules to warnings so `bun run lint` passes with warnings
  // but fails on real errors. These can be tightened over time.
  {
    rules: {
      // Stylistic — warn, don't error.
      "no-useless-escape": "warn",
      "prefer-const": "warn",
      "no-useless-assignment": "warn",
      "preserve-caught-error": "warn",
      // Allow empty catch blocks (common pattern in this codebase for
      // best-effort cleanup operations like unlink).
      "no-empty": ["error", { allowEmptyCatch: true }],
      // TypeScript — warn on `any` and unused vars (don't block).
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },

  // ---- Server (Bun + Hono + Node) ----
  {
    files: ["server/src/**/*.ts"],
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.bun,
      },
    },
    rules: {
      // Allow console.* in server code (primary logging mechanism).
      "no-console": "off",
    },
  },

  // ---- Client (React + Vite) ----
  {
    files: ["client/src/**/*.{ts,tsx}"],
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.worker,
      },
    },
    plugins: {
      "react-hooks": reactHooks,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // The v7 react-hooks plugin is extremely aggressive — many of its rules
      // flag legitimate patterns in this codebase. Downgrade to warnings so
      // lint passes while still surfacing potential issues.
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/refs": "warn",
      "react-hooks/purity": "warn",
      "react-hooks/no-deriving-state-in-effects": "warn",
      "react-hooks/preserve-manual-memoization": "warn",
      "react-hooks/immutability": "warn",
      "react-hooks/static-components": "warn",
      "react-hooks/use-memo": "warn",
      "no-console": "warn",
    },
  },

  // ---- Test files ----
  {
    files: ["**/*.test.ts", "**/*.test.tsx"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
    },
  },

  // ---- Shared root scripts ----
  {
    files: ["scripts/**/*.ts", "scripts/**/*.js"],
    languageOptions: {
      globals: { ...globals.node },
    },
    rules: {
      "no-console": "off",
    },
  },

  // ---- Client build scripts (run under Node during install/build) ----
  {
    files: ["client/scripts/**/*.js"],
    languageOptions: {
      globals: { ...globals.node },
    },
    rules: {
      "no-console": "off",
    },
  }
);
