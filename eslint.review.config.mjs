// Mirrors the Obsidian plugin-review scanner: eslint-plugin-obsidianmd's
// recommended config over the shipped source. Run via `npm run lint:review`.
// Kept separate from eslint.config.mjs so review-parity rule churn (the
// scanner updates independently) never blocks day-to-day linting.
import obsidianmd from "eslint-plugin-obsidianmd";

export default [
  {
    ignores: [
      "main.js",
      "coverage/**",
      "node_modules/**",
      "tests/**",
      "scripts/**",
      "docs/**",
      "**/*.mjs",
      "**/*.js",
      "version-bump.mjs",
    ],
  },
  ...obsidianmd.configs.recommended,
  {
    files: ["**/*.ts"],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // Local-only rule the review does not surface (its suggestions are
      // unusable for this codebase: "Openrouter", "#Ff8800", "iOS webkit").
      "obsidianmd/ui/sentence-case": "off",
    },
  },
];
