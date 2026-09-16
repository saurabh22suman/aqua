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
  // PR #177 follow-up — withPlatformMetricsWriter is the scope that
  // writes platform_metrics_daily. The only legitimate caller is
  // lib/jobs/platform-metrics-snapshot-job.ts (the
  // platform.metrics-snapshot queue). Allowing it anywhere else means
  // an accidentally-imported call could write a platform-wide
  // aggregate from inside a request-path transaction. The ALS nest
  // guard in db/scope.ts (SQL_SCOPED_SCOPE_KINDS) rejects at runtime;
  // this rule catches the same mistake at lint time, on every PR,
  // before the code can run.
  //
  // Use no-restricted-imports (the legacy rule, via FlatCompat) with
  // importNames for named-import granularity — import/no-restricted-paths
  // doesn't support importNames inside its zones. Apply per-file so the
  // exception (lib/jobs/**) is structural: "this rule does not apply
  // to files matching this pattern". The lib/jobs/** file glob
  // matches the legitimate caller plus its test.
  {
    files: [
      "app/**/*.ts",
      "app/**/*.tsx",
      "components/**/*.ts",
      "components/**/*.tsx",
      "db/**/*.ts",
      "lib/**/*.ts",
      "lib/**/*.tsx",
    ],
    ignores: ["lib/jobs/**", "lib/jobs/**/*"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@/db/scope",
              importNames: ["withPlatformMetricsWriter"],
              message:
                "withPlatformMetricsWriter is callable only from lib/jobs/ — the platform.metrics-snapshot job is the ONE legitimate writer of platform_metrics_daily. Reaching that table from a request-path transaction is a different surface than the platform_admin policy set is meant for; the ALS nest guard in db/scope.ts throws at runtime, this rule catches the same mistake at lint time, on every PR. Use withPlatformAdmin() for cross-tenant reads + RLS-gated cross-tenant writes via tenant-scoped tables' own platform_admin_write policies.",
            },
          ],
        },
      ],
    },
  },
];

export default config;
