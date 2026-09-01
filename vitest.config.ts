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
  resolve: {
    alias: {
      "@": new URL(".", import.meta.url).pathname,
    },
  },
});
