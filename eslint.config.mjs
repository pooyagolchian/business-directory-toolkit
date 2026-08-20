// @ts-check
import eslint from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/.next/**",
      "**/.open-next/**",
      "**/.sst/**",
      "**/node_modules/**",
      "fixtures/**",
      "data/**",
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // SST provides its global types through a triple-slash reference; that is
    // the documented mechanism, not a style slip.
    files: ["sst.config.ts"],
    rules: { "@typescript-eslint/triple-slash-reference": "off" },
  },
  {
    rules: {
      // Unused args are fine when prefixed — the destructure-to-omit idiom in
      // tests relies on binding a name it never reads.
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      // Data crossing the API boundary is genuinely unknown; narrowing it is
      // the point of the parse functions.
      "@typescript-eslint/no-explicit-any": "error",
    },
  },
);
