import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
    // Sequential file execution. Two reasons:
    //   1. The Testcontainer Postgres fixture (tests/tier1/*) is created
    //      once per suite and shared across files; parallel files
    //      race on the `delete from platform_users` / `delete from
    //      ...` beforeAll cleanups and produce spurious FK violations
    //      when one file's cleanup deletes rows another file's insert
    //      depends on (e.g. platform-auth.test.ts and
    //      platform-auth-actions.test.ts share the platform_users table).
    //   2. The two e2e-offline fixtures (scripts/e2e-offline.ts and
    //      e2e-offline-disabled.ts) each spin up a dev server on a
    //      different port but share Postgres state; running them in
    //      parallel under load flakes the offline sync assertions.
    // Tests within a file still run in parallel (vitest default).
    fileParallelism: false,
  },
  // K1 — the batch-detail click-through test imports the page module
  // (a .tsx file) directly. tsconfig sets jsx: "preserve" so Next can
  // transform at build time, but Vite 8's import-analysis runs before
  // that and chokes on untransformed JSX. The oxc option here is the
  // Vite-8 equivalent of the deprecated esbuild.jsx knob; without it
  // Vite respects the tsconfig "preserve" instruction and never
  // rewrites JSX, which the click-through test needs to invoke the
  // server-component page function (and any future route-driven
  // regression tests). Tests under tests/offline/* already get JSX
  // handling via @testing-library/react + the jsdom env; this is the
  // equivalent for tests that just want to call a server-component page
  // function and assert on its rendered output.
  oxc: {
    jsx: {
      runtime: "automatic",
    },
  },
  resolve: {
    alias: {
      "@": new URL(".", import.meta.url).pathname,
    },
  },
});
