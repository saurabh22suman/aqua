import { FlatCompat } from "@eslint/eslintrc";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const compat = new FlatCompat({
  baseDirectory: dirname(fileURLToPath(import.meta.url)),
});

const config = [
  {
    ignores: [".next/**", "node_modules/**", "next-env.d.ts", "db/drizzle/**"],
  },
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    files: ["**/*.ts", "**/*.tsx"],
    rules: {
      // Resolved-path based, not import-text based: a relative import
      // (../../db/client) resolves to the same file as the @/db/client
      // alias and is caught identically. String-pattern matching
      // (no-restricted-imports) missed exactly this — verified two real
      // call sites evaded it silently before this rule existed. See
      // docs/review-checklist.md, "a verification that passes while the
      // thing it verifies is already violated is worse than no
      // verification."
      "import/no-restricted-paths": [
        "error",
        {
          zones: [
            {
              target: "./{app,components,lib}/**/*",
              from: "./db/client.ts",
              message:
                "Raw client bypasses tenant scoping — use withTenant()/withUser() from @/db/tenant or withPlatform() from @/db/scope. The only other sanctioned handle is @/db/auth-db, for wiring better-auth's adapter.",
            },
          ],
        },
      ],
    },
  },
];

export default config;
