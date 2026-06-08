import eslint from "@eslint/js";
import tseslint from "typescript-eslint";
import { logEventIdRules } from "../../eslint/log-event-ids.js";

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  { ignores: ["dist/**", "node_modules/**"] },
  {
    files: ["src/**/*.ts"],
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      ...logEventIdRules,
    },
  },
);
