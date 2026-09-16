// tests/db/scope-nesting.test.ts
//
// PR #177 follow-up — the ALS nest guard in db/scope.ts and the
// eslint import/no-restricted-paths rule both exist to keep
// withPlatformMetricsWriter's surface to a single caller. The
// guard is mechanical, not convention; this test proves it
// by mutation — one it() per direction, with the test's only job
// to call the scope in the wrong position and watch the throw.
//
// The narrowing PR (#177) was a security change; without this
// pinning a future refactor can quietly break the guarantee and the
// only thing left between an accidental caller and platform_metrics_
// daily is convention.
//
// Testcontainers-only, mirrors the existing isolation pattern.

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { v7 as uuidv7 } from "uuid";
import type { IsolatedDb } from "../helpers/isolated-db";
import { startIsolatedDb } from "../helpers/isolated-db";

let isolated: IsolatedDb;
let withTenant: typeof import("@/db/tenant").withTenant;
let withUser: typeof import("@/db/tenant").withUser;
let withPlatformMetricsWriter: typeof import("@/db/scope").withPlatformMetricsWriter;
let withPlatformAdmin: typeof import("@/db/scope").withPlatformAdmin;
let appPool: typeof import("@/db/client").pool;

beforeAll(async () => {
  isolated = await startIsolatedDb();
  process.env.DATABASE_URL = isolated.appUri;
  process.env.MIGRATION_DATABASE_URL = isolated.adminUri;
  process.env.APP_LOGIN_PASSWORD = decodeURIComponent(
    new URL(isolated.appUri).password,
  );
  vi.resetModules();
  ({ withTenant, withUser } = await import("@/db/tenant"));
  ({ withPlatformMetricsWriter, withPlatformAdmin } = await import("@/db/scope"));
  appPool = (await import("@/db/client")).pool;
}, 60_000);

afterAll(async () => {
  await appPool?.end();
  await isolated?.stop();
});

describe("withPlatformMetricsWriter is request-path-excluded", () => {
  it("throws when nested inside withTenant (request-path shape)", async () => {
    let err: unknown = null;
    try {
      await withTenant(uuidv7(), async () => {
        await withPlatformMetricsWriter(async () => {
          // should not reach here
        });
      });
    } catch (e) {
      err = e;
    }
    expect(err, "nesting withPlatformMetricsWriter inside withTenant must throw").not.toBeNull();
    expect(String(err)).toMatch(
      /Cannot enter platform_metrics_writer scope while already inside a tenant scope/i,
    );
  });

  it("throws when withTenant is nested inside withPlatformMetricsWriter (reverse)", async () => {
    let err: unknown = null;
    try {
      await withPlatformMetricsWriter(async () => {
        await withTenant(uuidv7(), async () => {
          // should not reach here
        });
      });
    } catch (e) {
      err = e;
    }
    expect(err, "nesting withTenant inside withPlatformMetricsWriter must throw").not.toBeNull();
    expect(String(err)).toMatch(
      /Cannot enter tenant scope while already inside a platform_metrics_writer scope/i,
    );
  });

  it("throws when nested inside withUser (the other request-path scope)", async () => {
    let err: unknown = null;
    try {
      await withUser(uuidv7(), async () => {
        await withPlatformMetricsWriter(async () => {
          // should not reach here
        });
      });
    } catch (e) {
      err = e;
    }
    expect(err, "nesting withPlatformMetricsWriter inside withUser must throw").not.toBeNull();
    expect(String(err)).toMatch(
      /Cannot enter platform_metrics_writer scope while already inside a user scope/i,
    );
  });

  it("does NOT throw when called at the top level (the legitimate caller shape)", async () => {
    // The platform.metrics-snapshot job calls withPlatformMetricsWriter
    // directly with no enclosing scope. This is the path the guard
    // must NOT break. We assert "doesn't throw" by reaching an
    // assertion inside the callback.
    let reached = false;
    await withPlatformMetricsWriter(async () => {
      reached = true;
    });
    expect(reached, "withPlatformMetricsWriter at top level must execute the callback").toBe(true);
  });

  it("does NOT throw when nested inside withPlatformAdmin (the two-scope job shape)", async () => {
    // The snapshot job's two-transaction shape in practice is sequential
    // (not nested), but the guard's contract is that platform_admin is
    // exempted from the throw because the platform variable ORs onto
    // tenant/user policies by design. Pin the exemption so a future
    // tightening can't drop it without a test catching it.
    //
    // NOTE: this exemption is a DESIGN INTENT, not a guard. The ALS
    // nest guard in db/scope.ts does not enforce it — the eslint
    // import/no-restricted-imports rule in eslint.config.mjs is what
    // keeps withPlatformMetricsWriter out of arbitrary call sites
    // outside lib/jobs/. If anyone removes that rule, the confinement
    // collapses — this assertion does not, and cannot, prevent that.
    // If a future refactor adds another "platform admin" call site
    // outside lib/jobs/, the new code must add itself to the eslint
    // rule's allow-list OR the import will fail lint.
    let reached = false;
    await withPlatformAdmin(async () => {
      await withPlatformMetricsWriter(async () => {
        reached = true;
      });
    });
    expect(reached, "withPlatformMetricsWriter inside withPlatformAdmin must execute").toBe(true);
  });
});
