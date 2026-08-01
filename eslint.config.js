import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

const typescriptFiles = ["**/*.{ts,tsx}"];

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/coverage/**",
      "**/node_modules/**",
      ".claude/**",
      "docs/features/0.1/ux-prototype.html",
    ],
  },
  {
    ...js.configs.recommended,
    files: ["**/*.{js,mjs,cjs}"],
    languageOptions: {
      globals: { ...globals.node },
    },
  },
  ...tseslint.configs.recommended.map((config) => ({ ...config, files: typescriptFiles })),
  {
    files: typescriptFiles,
    languageOptions: {
      globals: { ...globals.node },
    },
    rules: {
      "no-undef": "off",
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
    },
  },
  {
    files: ["web/src/**/*.{ts,tsx}"],
    ...reactHooks.configs.flat["recommended-latest"],
    languageOptions: {
      globals: { ...globals.browser },
    },
    rules: {
      ...reactHooks.configs.flat["recommended-latest"].rules,
      "react-hooks/set-state-in-effect": "off",
    },
  },
  {
    files: ["web/src/**/*.{ts,tsx}"],
    ...reactRefresh.configs.vite,
    rules: {
      "react-refresh/only-export-components": "off",
    },
  },
  {
    files: ["**/tests/**/*.{ts,tsx,js,mjs,cjs}", "**/*.test.{ts,tsx}"],
    linterOptions: {
      reportUnusedDisableDirectives: "off",
    },
    rules: {
      "no-empty": "off",
      "no-useless-escape": "off",
      "no-unused-vars": "off",
      "prefer-const": "off",
      "@typescript-eslint/no-unused-expressions": "off",
      "@typescript-eslint/no-unused-vars": "off",
    },
  },
);
